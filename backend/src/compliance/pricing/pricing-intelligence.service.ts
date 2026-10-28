import { PriceNormalizationService } from './price-normalization.service';
import { MarketDataProvider } from './market-data.provider';
import { convertUnitPrice } from './unit-conversion';
import { assessComparability, ageInDays, benchmarkOrigin } from './price-comparability';
import { currentPricingPolicy, resolveThreshold } from './pricing-policy';
import type { CommodityLineItem } from '../types';
import type { MarketPriceBenchmark, PriceAssessment, PriceClassification, ProductPriceIntelligenceResult } from './pricing.types';

/** A source of price benchmarks. The platform's own provider is one; a licensed price index is another. */
export interface BenchmarkProvider {
  findMarketBenchmark(params: {
    productDescription: string;
    hsCode?: string;
    destinationCountry?: string;
    declaredUnitPrice?: number;
    unitOfMeasure?: string;
  }): Promise<MarketPriceBenchmark | null>;
}

export class PricingIntelligenceService {
  private readonly normalizer = new PriceNormalizationService();

  constructor(
    private readonly marketDataProvider: BenchmarkProvider = new MarketDataProvider(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Evaluate real-time market pricing intelligence for all line items in a trade presentation.
   *
   * The order matters. The declared price is brought to USD (at the rate for the transaction date where
   * one is held) and to the benchmark's Incoterm basis, and then to the benchmark's *own* unit of
   * measure; only then is it compared. A price that cannot be brought to the benchmark's unit or
   * currency is reported as not comparable, never compared as if the numbers matched.
   *
   * Each result keeps its `assessment`: the inputs and conversions, the threshold and where it came from,
   * and how comparable the benchmark is. The over- and under-invoicing thresholds are the platform default
   * unless an approved category policy applies; a result under the default says it is an indicator, not a control.
   */
  async evaluatePricingIntelligence(params: {
    goods: CommodityLineItem[];
    currency: string;
    incoterm: string;
    destinationCountry?: string;
    /** The transaction's own date (ISO), for point-in-time currency conversion. */
    transactionDate?: string;
  }): Promise<ProductPriceIntelligenceResult[]> {
    const results: ProductPriceIntelligenceResult[] = [];
    const now = this.clock();

    for (const item of params.goods) {
      const declaredCurrency = item.currency || params.currency;
      const rawPrice = item.unitPrice || (item.quantity > 0 ? item.totalLineValue / item.quantity : 0);

      const base = {
        lineItemId: item.id,
        itemNumber: item.itemNumber,
        productDescription: item.productDescription,
        hsCode: item.hsCode,
        declaredQuantity: item.quantity,
        declaredUnitOfMeasure: item.unitOfMeasure,
        declaredUnitPrice: rawPrice,
        declaredCurrency,
        declaredIncoterm: params.incoterm,
        destination: params.destinationCountry || 'Destination Country',
        normalizedIncotermBasis: 'FOB' as const,
      };

      // 1. Currency: an unknown currency is "not comparable", not "dollars".
      const converted = await this.normalizer.normalizeCurrencyToUsd(rawPrice, declaredCurrency, params.transactionDate);
      if (converted === null) {
        results.push(this.notComparable(base, 0, `No exchange rate is held for ${declaredCurrency.toUpperCase()}, so the price cannot be compared with a USD benchmark. Obtain the equivalent in USD or add the rate.`));
        continue;
      }
      const incotermNorm = this.normalizer.normalizeIncotermBasis(converted.usd, params.incoterm, 'FOB');
      const declaredUsdPerDeclaredUnit = incotermNorm.normalizedPrice;

      // 2. Query authoritative market data
      const benchmark = await this.marketDataProvider.findMarketBenchmark({
        productDescription: item.productDescription,
        hsCode: item.hsCode,
        destinationCountry: params.destinationCountry,
        declaredUnitPrice: declaredUsdPerDeclaredUnit,
        unitOfMeasure: item.unitOfMeasure,
      });

      if (!benchmark) {
        results.push({
          ...base,
          normalizedUnitPriceUsd: declaredUsdPerDeclaredUnit,
          hasMarketData: false,
          classification: 'INSUFFICIENT_MARKET_DATA',
          confidence: 'NONE',
          explanation: `[INSUFFICIENT DATA] Insufficient authoritative market pricing data available for "${item.productDescription}". Customary trade invoice due diligence advised.`,
          evidenceRecords: [],
          limitations: ['No verified Level 1-3 commodity benchmark exists for this customized or non-standard merchandise.'],
        });
        continue;
      }

      // The comparison is made on the benchmark's own Incoterm basis, not a fixed one.
      const benchmarkBasis = benchmark.incotermBasis;
      const incotermFinal = benchmarkBasis === 'CIF' ? this.normalizer.normalizeIncotermBasis(converted.usd, params.incoterm, 'CIF') : incotermNorm;
      const declaredUsdOnBasis = incotermFinal.normalizedPrice;

      // 3. Bring the declared price to the benchmark's unit of measure.
      const comparable = convertUnitPrice(declaredUsdOnBasis, item.unitOfMeasure, benchmark.unitOfMeasure);
      if (comparable === null) {
        results.push(
          this.notComparable(
            base,
            declaredUsdOnBasis,
            `The invoice prices "${item.productDescription}" per ${item.unitOfMeasure || 'an unstated unit'}, but the benchmark is per ${benchmark.unitOfMeasure}; the two cannot be converted, so no over- or under-invoicing conclusion is drawn.`,
          ),
        );
        continue;
      }
      const normalizedPriceUsd = Number(comparable.toFixed(4));

      // 4. Variance against the benchmark
      const variancePercent = this.normalizer.calculatePriceVariancePercent(normalizedPriceUsd, benchmark.benchmarkUnitPrice);

      // Which threshold applies, and how comparable the benchmark is.
      const policy = currentPricingPolicy();
      const threshold = resolveThreshold([item.hsCode, benchmark.hsCodePrefix], policy);
      const origin = benchmarkOrigin(benchmark);
      const comparability = assessComparability({
        declaredHsCode: item.hsCode,
        declaredDescription: item.productDescription,
        destinationCountry: params.destinationCountry,
        benchmark,
        threshold,
        unit: { declared: item.unitOfMeasure, benchmark: benchmark.unitOfMeasure, converted: (item.unitOfMeasure ?? '').toUpperCase().trim() !== (benchmark.unitOfMeasure ?? '').toUpperCase().trim() },
        currency: { declared: declaredCurrency, basis: converted.basis },
        incoterm: { declared: params.incoterm, benchmarkBasis, adjustmentPercent: incotermFinal.adjustmentAppliedPercent },
        now,
      });

      // Only a benchmark someone can stand behind may raise an over/under-invoicing flag. A LOW
      // confidence figure (open-web snippets) or a weak proxy is reported as an indication and nothing more.
      const benchmarkConfidence = benchmark.confidenceLevel;
      const confidentSource = benchmarkConfidence === 'VERY_HIGH' || benchmarkConfidence === 'HIGH' || benchmarkConfidence === 'MODERATE';
      const canClassify = confidentSource && comparability.grade !== 'WEAK';
      const corridor = `USD $${benchmark.observedLowPrice.toFixed(2)}–$${benchmark.observedHighPrice.toFixed(2)} per ${benchmark.unitOfMeasure}`;
      const declared = `USD $${normalizedPriceUsd.toFixed(2)} per ${benchmark.unitOfMeasure}`;
      const sourceLabel = benchmark.evidence[0]?.publisher || benchmark.category;
      const signed = `${variancePercent > 0 ? '+' : ''}${variancePercent}%`;

      let classification: PriceClassification = 'WITHIN_EXPECTED_RANGE';
      let confidence: 'HIGH' | 'MODERATE' | 'LOW' = benchmarkConfidence === 'MODERATE' ? 'MODERATE' : 'HIGH';
      let explanation = `[OK PRICE - FAIR MARKET] Declared unit price (${declared}) is consistent with the benchmark (${corridor}). Variance from the benchmark: ${signed}. Benchmark source: ${sourceLabel}.`;

      if (!canClassify) {
        classification = 'INSUFFICIENT_MARKET_DATA';
        confidence = 'LOW';
        const weak = comparability.grade === 'WEAK' ? comparability.factors.filter((f) => f.status === 'MISMATCH').map((f) => f.detail).join(' ') : '';
        explanation = weak
          ? `[WEAK PROXY] The benchmark is not a like-for-like comparison: ${weak} The figures suggest ${corridor} (declared ${declared}, variance ${signed}). Not used for an invoicing finding; obtain a comparable benchmark if material.`
          : `[INDICATIVE ONLY] No reviewed benchmark exists for this item. Unverified open-web figures suggest ${corridor} (declared ${declared}, variance ${signed}). Not used for an invoicing finding; obtain an independent valuation if material.`;
      } else if (variancePercent > threshold.highPct) {
        classification = 'HIGH_PRICE_ANOMALY';
        explanation = `[OVER PRICED / HIGH ANOMALY] Declared unit price (${declared}) is +${variancePercent}% ABOVE the benchmark (${corridor}; source: ${sourceLabel}). Flagged for potential capital flight or TBML over-invoicing indicators.`;
      } else if (variancePercent < -threshold.lowPct) {
        classification = 'LOW_PRICE_ANOMALY';
        explanation = `[UNDER PRICED / LOW ANOMALY] Declared unit price (${declared}) is ${variancePercent}% BELOW the benchmark (${corridor}; source: ${sourceLabel}). Flagged for potential customs under-invoicing or tax evasion indicators.`;
      }

      // A real, non-bundled benchmark under an approved threshold is a control; anything else is a screening indicator.
      const approvedControl = threshold.basis === 'APPROVED_CATEGORY' && (origin === 'LIVE_SOURCE' || origin === 'BANK_SUPPLIED') && comparability.grade !== 'WEAK';
      const anomaly = classification === 'HIGH_PRICE_ANOMALY' || classification === 'LOW_PRICE_ANOMALY';
      if (anomaly && !approvedControl) {
        const why = threshold.basis === 'GLOBAL_DEFAULT_UNAPPROVED' ? 'the platform default thresholds, which have no approved methodology' : 'a benchmark from a bundled or unverified source';
        explanation += ` This is a screening indicator on ${why}, not an approved control: a reviewer should confirm it against a comparable benchmark before it is relied on.`;
      }

      const assessment: PriceAssessment = {
        policy: { basis: threshold.basis, policyId: threshold.policyId, highPct: threshold.highPct, lowPct: threshold.lowPct, methodology: threshold.methodology, approvedBy: threshold.approvedBy, approvedOn: threshold.approvedOn, note: threshold.note },
        comparability,
        inputs: {
          declaredUnitPrice: rawPrice,
          declaredCurrency,
          declaredUnit: item.unitOfMeasure,
          declaredIncoterm: params.incoterm,
          usdPerDeclaredUnit: declaredUsdOnBasis,
          fxBasis: converted.basis,
          incotermAdjustmentPercent: incotermFinal.adjustmentAppliedPercent,
          comparedUnit: benchmark.unitOfMeasure,
          comparedUsdPerUnit: normalizedPriceUsd,
        },
        benchmark: {
          id: benchmark.benchmarkId,
          category: benchmark.category,
          hsCodePrefix: benchmark.hsCodePrefix ?? null,
          origin,
          confidence: benchmark.confidenceLevel,
          sampleCount: benchmark.sampleCount,
          asOfDate: benchmark.asOfDate,
          ageDays: origin === 'BUILT_IN_REFERENCE' ? null : ageInDays(benchmark.asOfDate, now),
          incotermBasis: benchmark.incotermBasis,
          unit: benchmark.unitOfMeasure,
          sources: [...new Set(benchmark.evidence.map((e) => e.publisher).filter(Boolean))],
        },
        approvedControl,
        limitations: [
          incotermFinal.note,
          'Freight and insurance are a flat allowance, not the invoice\'s own charges.',
          'Quantity, specification and origin are not compared.',
          ...(policy.rejected.length ? [`${policy.rejected.length} entr${policy.rejected.length === 1 ? 'y' : 'ies'} in the pricing policy file ${policy.rejected.length === 1 ? 'was' : 'were'} not used (incomplete or unapproved).`] : []),
        ],
        assessedAt: now.toISOString(),
      };

      results.push({
        ...base,
        normalizedUnitPriceUsd: normalizedPriceUsd,
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
          incotermFinal.note,
          `Converted to USD using the ${converted.basis}; compared per ${benchmark.unitOfMeasure}.`,
          `Benchmark (${benchmark.confidenceLevel} confidence) as of ${String(benchmark.asOfDate).slice(0, 10)}; source: ${sourceLabel}.`,
          `Comparability: ${comparability.grade.toLowerCase()}. Threshold: ${threshold.note}`,
        ],
        assessment,
      });
    }

    return results;
  }

  private notComparable(
    base: Omit<ProductPriceIntelligenceResult, 'normalizedUnitPriceUsd' | 'hasMarketData' | 'classification' | 'confidence' | 'explanation' | 'evidenceRecords' | 'limitations'>,
    normalizedUnitPriceUsd: number,
    reason: string,
  ): ProductPriceIntelligenceResult {
    return {
      ...base,
      normalizedUnitPriceUsd,
      hasMarketData: false,
      classification: 'INSUFFICIENT_MARKET_DATA',
      confidence: 'NONE',
      explanation: `[NOT COMPARABLE] ${reason}`,
      evidenceRecords: [],
      limitations: [reason],
    };
  }
}
