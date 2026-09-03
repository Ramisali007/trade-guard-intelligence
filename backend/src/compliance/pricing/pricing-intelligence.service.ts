import { PriceNormalizationService } from './price-normalization.service';
import { MarketDataProvider } from './market-data.provider';
import type { CommodityLineItem } from '../types';
import type { PriceClassification, ProductPriceIntelligenceResult } from './pricing.types';

export class PricingIntelligenceService {
  private readonly normalizer = new PriceNormalizationService();
  private readonly marketDataProvider = new MarketDataProvider();

  /**
   * Evaluate real-time market pricing intelligence for all line items in a trade presentation.
   */
  async evaluatePricingIntelligence(params: {
    goods: CommodityLineItem[];
    currency: string;
    incoterm: string;
    destinationCountry?: string;
  }): Promise<ProductPriceIntelligenceResult[]> {
    const results: ProductPriceIntelligenceResult[] = [];

    for (const item of params.goods) {
      // 1. Normalization
      const rawPrice = item.unitPrice || (item.quantity > 0 ? item.totalLineValue / item.quantity : 0);
      const priceUsd = this.normalizer.normalizeCurrencyToUsd(rawPrice, item.currency || params.currency);
      const uomNorm = this.normalizer.normalizeUnitOfMeasure(priceUsd, item.quantity, item.unitOfMeasure);
      const incotermNorm = this.normalizer.normalizeIncotermBasis(uomNorm.normalizedUnitPrice, params.incoterm, 'FOB');

      const normalizedPriceUsd = incotermNorm.normalizedPrice;

      // 2. Query Authoritative Market Data
      const benchmark = await this.marketDataProvider.findMarketBenchmark({
        productDescription: item.productDescription,
        hsCode: item.hsCode,
        destinationCountry: params.destinationCountry,
        declaredUnitPrice: normalizedPriceUsd,
        unitOfMeasure: item.unitOfMeasure,
      });

      if (!benchmark) {
        results.push({
          lineItemId: item.id,
          itemNumber: item.itemNumber,
          productDescription: item.productDescription,
          hsCode: item.hsCode,
          declaredQuantity: item.quantity,
          declaredUnitOfMeasure: item.unitOfMeasure,
          declaredUnitPrice: rawPrice,
          declaredCurrency: item.currency || params.currency,
          declaredIncoterm: params.incoterm,
          destination: params.destinationCountry || 'Destination Country',
          normalizedUnitPriceUsd: normalizedPriceUsd,
          normalizedIncotermBasis: 'FOB',
          hasMarketData: false,
          classification: 'INSUFFICIENT_MARKET_DATA',
          confidence: 'NONE',
          explanation: `[INSUFFICIENT DATA] Insufficient authoritative market pricing data available for "${item.productDescription}". Customary trade invoice due diligence advised.`,
          evidenceRecords: [],
          limitations: [
            'No verified Level 1-3 commodity benchmark exists for this customized or non-standard merchandise.',
          ],
        });
        continue;
      }

      // 3. Calculate Variance against authentic benchmark
      const variancePercent = this.normalizer.calculatePriceVariancePercent(normalizedPriceUsd, benchmark.benchmarkUnitPrice);

      let classification: PriceClassification = 'WITHIN_EXPECTED_RANGE';
      let confidence: 'HIGH' | 'MODERATE' | 'LOW' = 'HIGH';
      let explanation = `[OK PRICE - FAIR MARKET] Declared unit price (USD $${normalizedPriceUsd.toFixed(2)}/${item.unitOfMeasure || 'unit'}) is consistent with observed authentic market corridor (USD $${benchmark.observedLowPrice.toFixed(2)}–$${benchmark.observedHighPrice.toFixed(2)}). Variance: ${variancePercent > 0 ? '+' : ''}${variancePercent}%. Verified against UN Comtrade & official trade valuation indices.`;

      // Thresholds: High Price Anomaly (> +30%), Low Price Anomaly (< -28%)
      if (variancePercent > 30) {
        classification = 'HIGH_PRICE_ANOMALY';
        explanation = `[OVER PRICED / HIGH ANOMALY] Declared unit price (USD $${normalizedPriceUsd.toFixed(2)}/${item.unitOfMeasure || 'unit'}) is +${variancePercent}% ABOVE authentic market range (USD $${benchmark.observedLowPrice.toFixed(2)}–$${benchmark.observedHighPrice.toFixed(2)}). Flagged for potential capital flight or TBML over-invoicing indicators.`;
      } else if (variancePercent < -28) {
        classification = 'LOW_PRICE_ANOMALY';
        explanation = `[UNDER PRICED / LOW ANOMALY] Declared unit price (USD $${normalizedPriceUsd.toFixed(2)}/${item.unitOfMeasure || 'unit'}) is ${variancePercent}% BELOW authentic market range (USD $${benchmark.observedLowPrice.toFixed(2)}–$${benchmark.observedHighPrice.toFixed(2)}). Flagged for potential customs under-invoicing or tax evasion indicators.`;
      }

      results.push({
        lineItemId: item.id,
        itemNumber: item.itemNumber,
        productDescription: item.productDescription,
        hsCode: item.hsCode,
        declaredQuantity: item.quantity,
        declaredUnitOfMeasure: item.unitOfMeasure,
        declaredUnitPrice: rawPrice,
        declaredCurrency: item.currency || params.currency,
        declaredIncoterm: params.incoterm,
        destination: params.destinationCountry || 'Destination Country',
        normalizedUnitPriceUsd: normalizedPriceUsd,
        normalizedIncotermBasis: 'FOB',
        hasMarketData: true,
        benchmarkUnitPriceUsd: benchmark.benchmarkUnitPrice,
        observedMarketLowUsd: benchmark.observedLowPrice,
        observedMarketMedianUsd: benchmark.observedMedianPrice,
        observedMarketHighUsd: benchmark.observedHighPrice,
        priceVariancePercent: variancePercent,
        classification,
        confidence,
        explanation,
        evidenceRecords: benchmark.evidence,
        limitations: [
          incotermNorm.note,
          `Benchmark pricing reflects authentic wholesale trade observations retrieved as of ${new Date(benchmark.asOfDate).toLocaleDateString()}.`,
        ],
      });
    }

    return results;
  }
}
