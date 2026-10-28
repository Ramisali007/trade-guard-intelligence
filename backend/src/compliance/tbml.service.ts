import type { CommodityLineItem, TBMLAnalysisResult, TBMLRedFlag, TradeParties } from './types';
import type { ProductPriceIntelligenceResult } from './pricing/pricing.types';

export class TBMLService {
  analyzeTBML(params: {
    /** Benchmark comparison per line item; only HIGH/LOW anomalies from a reviewed benchmark count. */
    priceFindings?: ProductPriceIntelligenceResult[];
    goods: CommodityLineItem[];
    parties: TradeParties;
    originCountry?: string;
    destinationCountry?: string;
    transitCountries?: string[];
    totalValue: number;
    currency: string;
    paymentTerms?: string;
    hasOutOfScopeGoods?: boolean;
    hasDiscrepancies?: boolean;
    customerDeclaredBusiness?: string;
  }): TBMLAnalysisResult {
    const redFlags: TBMLRedFlag[] = [];
    let tbmlScore = 10;

    // 1. Pricing Consistency: over-/under-invoicing against a reviewed benchmark. A deviation of more
    // than double (or less than half) the corridor is treated as critical.
    for (const finding of params.priceFindings ?? []) {
      if (finding.classification !== 'HIGH_PRICE_ANOMALY' && finding.classification !== 'LOW_PRICE_ANOMALY') continue;
      const variance = finding.priceVariancePercent ?? 0;
      const critical = variance > 100 || variance < -50;
      const item = params.goods.find((g) => g.id === finding.lineItemId);
      if (item) item.riskSeverity = critical ? 'CRITICAL' : 'HIGH';

      const over = finding.classification === 'HIGH_PRICE_ANOMALY';
      redFlags.push({
        category: 'PRICING_ANOMALY',
        severity: critical ? 'CRITICAL' : 'HIGH',
        title: over ? 'Potential Over-Invoicing' : 'Potential Under-Invoicing',
        description: `Line item "${finding.productDescription}" is priced ${variance > 0 ? '+' : ''}${variance}% against the benchmark corridor (USD ${finding.observedMarketLowUsd?.toFixed(2)}–${finding.observedMarketHighUsd?.toFixed(2)}).`,
        evidence: `Item ${finding.itemNumber}: declared ${finding.declaredCurrency} ${finding.declaredUnitPrice}/${finding.declaredUnitOfMeasure} (≈ USD ${finding.normalizedUnitPriceUsd.toFixed(2)} ${finding.normalizedIncotermBasis}).`,
        fatfReference: over
          ? 'FATF TBML Red Flag: Over-invoicing of goods relative to fair market value (value transfer to the exporter).'
          : 'FATF TBML Red Flag: Under-invoicing of goods relative to fair market value (value transfer to the importer).',
      });
      tbmlScore += critical ? 30 : 20;
    }

    // 2. Check Customer Product Consistency vs Declared Business
    const declaredBiz = (params.customerDeclaredBusiness || '').toLowerCase();
    if (declaredBiz && !declaredBiz.includes('not found')) {
      for (const item of params.goods) {
        const itemDesc = item.productDescription.toLowerCase();
        if (declaredBiz.includes('textile') || declaredBiz.includes('apparel')) {
          if (itemDesc.includes('laser') || itemDesc.includes('machinery') || itemDesc.includes('chemical') || itemDesc.includes('server')) {
            redFlags.push({
              category: 'CUSTOMER_PRODUCT_MISMATCH',
              severity: 'HIGH',
              title: 'Commodity Inconsistent with Customer Profile',
              description: `Buyer business is declared as "${params.customerDeclaredBusiness}", but invoice contains high-value industrial/technical goods ("${item.productDescription}").`,
              evidence: `Declared Business: ${params.customerDeclaredBusiness} vs Invoice Item: ${item.productDescription}`,
              fatfReference: 'FATF TBML Red Flag: Commodity being shipped is inconsistent with the normal business activities of the customer.',
            });
            tbmlScore += 25;
          }
        }
      }
    }

    // 3. Routing & Transshipment Consistency
    if (params.transitCountries && params.transitCountries.length > 2) {
      redFlags.push({
        category: 'ROUTING_TRANSSHIPMENT',
        severity: 'ELEVATED',
        title: 'Circuitous / Unexplained Multi-Hub Routing',
        description: `Shipment passes through multiple intermediate transit countries (${params.transitCountries.join(' -> ')}), indicating potential transshipment obfuscation.`,
        evidence: `Route: ${params.originCountry || 'Origin'} via ${params.transitCountries.join(', ')} to ${params.destinationCountry || 'Destination'}`,
        fatfReference: 'FATF TBML Red Flag: Unnecessary transshipment or circuitous routing with no clear economic justification.',
      });
      tbmlScore += 20;
    }

    // 4. Undisclosed End-User or Consignee Ambiguity
    // Extraction marks absent fields with the string "Not Found"; that is not a consignee.
    const known = (value?: string): value is string =>
      Boolean(value && !/^(not found|not disclosed|not specified|n\/a)$/i.test(value.trim()));
    const consignee = params.parties.consignee?.legalName;
    const buyer = params.parties.buyer?.legalName;
    const endUser = params.parties.endUser?.legalName;

    if (known(consignee) && known(buyer) && consignee.trim().toLowerCase() !== buyer.trim().toLowerCase() && !known(endUser)) {
      redFlags.push({
        category: 'CUSTOMER_PRODUCT_MISMATCH',
        severity: 'ELEVATED',
        title: 'Consignee Disconnected from Buyer / Unidentified End-User',
        description: `Shipment consignee ("${consignee}") differs from purchasing buyer ("${buyer}"), with no declared ultimate end-user documentation.`,
        evidence: `Buyer: ${buyer} | Consignee: ${consignee} | Ultimate End User: Not Disclosed`,
        fatfReference: 'FATF TBML Red Flag: Disconnect between ordering customer and delivery consignee without clear agency relationship.',
      });
      tbmlScore += 15;
    }

    // 5. Payment Terms Anomaly (e.g. 100% advance or third-party bank)
    const pTerms = (params.paymentTerms || '').toLowerCase();
    if (pTerms.includes('third party') || pTerms.includes('unidentified payer') || pTerms.includes('cash settlement')) {
      redFlags.push({
        category: 'PAYMENT_ROUTING',
        severity: 'HIGH',
        title: 'High-Risk Payment Structure',
        description: `Payment terms indicate non-standard or third-party settlement structure (${params.paymentTerms}).`,
        evidence: `Payment Terms: ${params.paymentTerms}`,
        fatfReference: 'FATF TBML Red Flag: Settlement via third-party unrelated entities or non-bank channels.',
      });
      tbmlScore += 25;
    }

    // Cap score at 100
    tbmlScore = Math.min(100, tbmlScore);

    const riskLevel =
      tbmlScore >= 75 ? 'CRITICAL' :
      tbmlScore >= 55 ? 'HIGH' :
      tbmlScore >= 35 ? 'ELEVATED' :
      tbmlScore >= 20 ? 'MODERATE' : 'LOW';

    return {
      overallTbmlRiskScore: tbmlScore,
      riskLevel,
      // Each statement says what was actually checked. "Consistent" is claimed only where a check ran and
      // passed; where there was nothing to compare against, the assessment says so.
      priceConsistencyAssessment: redFlags.some((r) => r.category === 'PRICING_ANOMALY')
        ? 'Material pricing anomaly identified. Unit valuations warrant independent commercial appraisal.'
        : (params.priceFindings ?? []).some((f) => f.classification === 'WITHIN_EXPECTED_RANGE')
          ? 'Benchmarked line items are within their reference corridors. Lines without a benchmark were not assessed.'
          : 'No price benchmark was available for these goods; price consistency was not assessed.',
      quantityConsistencyAssessment: 'Not assessed: no quantity or shipment-volume benchmark is applied.',
      routingConsistencyAssessment: redFlags.some((r) => r.category === 'ROUTING_TRANSSHIPMENT')
        ? 'Complex routing identified with potential transshipment or diversion risk.'
        : params.transitCountries && params.transitCountries.length > 0
          ? 'The declared transit countries do not meet the multi-hub routing threshold.'
          : 'No transit countries are declared; routing was not assessed beyond origin and destination.',
      documentationConsistencyAssessment: redFlags.some((r) => r.category === 'CUSTOMER_PRODUCT_MISMATCH')
        ? 'Discrepancies noted between customer profile and shipping documentation.'
        : 'The customer-profile, consignee and end-user checks found no mismatch.',
      redFlags,
    };
  }
}
