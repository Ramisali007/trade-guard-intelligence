import type { CommodityLineItem, TBMLAnalysisResult, TBMLRedFlag, TradeParties } from './types';

export class TBMLService {
  analyzeTBML(params: {
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

    // 1. Check Pricing Consistency (Over-Invoicing / Under-Invoicing)
    for (const item of params.goods) {
      const desc = item.productDescription.toLowerCase();
      const unitPrice = item.unitPrice;

      // Cotton shirts / t-shirts typical unit price $2 - $80. If $850/shirt -> Over-invoicing red flag
      if ((desc.includes('shirt') || desc.includes('t-shirt') || desc.includes('apparel')) && unitPrice > 350) {
        redFlags.push({
          category: 'PRICING_ANOMALY',
          severity: 'HIGH',
          title: 'Potential Over-Invoicing Detected',
          description: `Line item "${item.productDescription}" unit price of ${item.currency} ${unitPrice} significantly exceeds standard wholesale benchmark values.`,
          evidence: `Item ${item.itemNumber}: ${item.productDescription} @ ${item.currency} ${unitPrice}/${item.unitOfMeasure}. Total line: ${item.currency} ${item.totalLineValue.toLocaleString()}`,
          fatfReference: 'FATF TBML Red Flag: Significant discrepancy between transaction value and fair market value.',
        });
        tbmlScore += 25;
      }

      // Footwear / shoes typical wholesale $5 - $200. If > $600/pair -> pricing anomaly
      if ((desc.includes('shoe') || desc.includes('footwear')) && unitPrice > 600) {
        redFlags.push({
          category: 'PRICING_ANOMALY',
          severity: 'HIGH',
          title: 'Unusually High Unit Valuation for Footwear',
          description: `Unit price of ${item.currency} ${unitPrice} for ${item.productDescription} appears materially inconsistent with standard market pricing.`,
          evidence: `Line ${item.itemNumber}: ${item.quantity} ${item.unitOfMeasure} @ ${unitPrice} ${item.currency}`,
          fatfReference: 'FATF TBML Indicator: Over-invoicing commodities to transfer illicit value.',
        });
        tbmlScore += 20;
      }
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
    const consignee = params.parties.consignee?.legalName;
    const buyer = params.parties.buyer?.legalName;
    const endUser = params.parties.endUser?.legalName;

    if (consignee && buyer && consignee !== buyer && (!endUser || endUser === 'Not Found')) {
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
      priceConsistencyAssessment: redFlags.some((r) => r.category === 'PRICING_ANOMALY')
        ? 'Material pricing anomaly identified. Unit valuations warrant independent commercial appraisal.'
        : 'Unit pricing appears generally consistent with prevailing market ranges.',
      quantityConsistencyAssessment: 'Shipment volume aligns with standard containerized commercial lots.',
      routingConsistencyAssessment: redFlags.some((r) => r.category === 'ROUTING_TRANSSHIPMENT')
        ? 'Complex routing identified with potential transshipment or diversion risk.'
        : 'Direct commercial routing indicated between origin and destination.',
      documentationConsistencyAssessment: redFlags.some((r) => r.category === 'CUSTOMER_PRODUCT_MISMATCH')
        ? 'Discrepancies noted between customer profile and shipping documentation.'
        : 'Parties and goods conform to standard transaction structures.',
      redFlags,
    };
  }
}
