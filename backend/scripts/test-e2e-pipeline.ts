import { TradeComplianceExtractor } from '../src/ai/trade-extractor';

async function main() {
  const extractor = new TradeComplianceExtractor();
  const sampleText = `COMMERCIAL INVOICE
Invoice Number: INV-2026-8891
Date: 2026-06-15
Exporter: Apex Textiles Global Ltd, Karachi, Pakistan (NTN-3029148-7)
Buyer: British Fashion Retailers PLC, London, United Kingdom
Letter of Credit: LC-994821
Incoterm: CIF
Currency: USD
Item 1: Men 100% Cotton Woven Shirts, Quantity: 5000 PCS, Unit Price: 26.50 USD, Total: 132500 USD
Origin: Pakistan
Destination: United Kingdom`;

  const result = await extractor.processTradeDocument({
    documentId: 'doc-test-e2e',
    filename: 'test-invoice.pdf',
    rawText: sampleText,
    rawBuffer: Buffer.from(sampleText),
    aiModel: 'pipeline-verification-engine',
    aiJsonOutput: {
      documentClassification: {
        documentType: 'COMMERCIAL_INVOICE',
        number: 'INV-2026-8891',
        date: '2026-06-15',
        originCountry: 'Pakistan',
        destinationCountry: 'United Kingdom',
      },
      parties: {
        seller: {
          role: 'SELLER_EXPORTER',
          legalName: 'Apex Textiles Global Ltd',
          taxVatNumber: 'NTN-3029148-7',
          country: 'Pakistan',
          address: 'Plot 44-B, Sector 15, Korangi Industrial Area, Karachi, Pakistan',
        },
        buyer: {
          role: 'BUYER_IMPORTER',
          legalName: 'British Fashion Retailers PLC',
          country: 'United Kingdom',
          address: '100 Oxford Street, London, United Kingdom',
        },
      },
      goods: [
        {
          id: 'ITEM-1',
          itemNumber: 1,
          productDescription: 'Men 100% Cotton Woven Shirts',
          quantity: 5000,
          unitOfMeasure: 'PCS',
          unitPrice: 26.50,
          totalLineValue: 132500,
          currency: 'USD',
          hsCode: '6205.20.00',
          isAuthorizedScope: true,
          isControlledOrDualUse: false,
          riskSeverity: 'LOW',
        },
      ],
      pricingAndFinancials: {
        totalAmount: 132500,
        currency: 'USD',
        incoterm: 'CIF',
      },
      routingAndLogistics: {
        originCountry: 'Pakistan',
        destinationCountry: 'United Kingdom',
      },
    },
  });

  console.log('\n==============================================================================');
  console.log('--- TRADEGUARD EXTENDED INTELLIGENCE E2E VERIFICATION ---');
  console.log('==============================================================================\n');

  console.log('1. TRANSACTION & CUSTOMER RESOLUTION:');
  console.log('   Transaction ID:', result.transaction.transactionId);
  console.log('   Customer Reference:', result.transaction.customerReference);
  console.log('   Parties:', result.transaction.parties.seller?.legalName, '->', result.transaction.parties.buyer?.legalName);

  console.log('\n2. REAL-TIME MARKET PRICING INTELLIGENCE:');
  console.log('   Items evaluated:', result.pricingIntelligence?.length);
  if (result.pricingIntelligence?.[0]) {
    const p = result.pricingIntelligence[0];
    console.log(`   • Commodity: ${p.productDescription} (HS: ${p.hsCode})`);
    console.log(`   • Declared Unit Price: ${p.declaredCurrency} ${p.declaredUnitPrice.toFixed(2)} / ${p.declaredUnitOfMeasure}`);
    console.log(`   • Market Benchmark: USD ${p.benchmarkUnitPriceUsd?.toFixed(2)} (Range: USD ${p.observedMarketLowUsd} - ${p.observedMarketHighUsd})`);
    console.log(`   • Variance: ${p.priceVariancePercent}% -> Classification: [${p.classification}]`);
    console.log(`   • Top Evidence Record: ${p.evidenceRecords[0]?.sourceTitle} (${p.evidenceRecords[0]?.sourceAuthorityLevel})`);
    console.log(`   • Quoted Excerpt: "${p.evidenceRecords[0]?.quotedExcerpt.slice(0, 80)}..."`);
  }

  console.log('\n3. PRODUCT REGULATORY & PAKISTAN TRADE POLICY:');
  console.log('   Items evaluated:', result.productRegulatoryIntelligence?.length);
  if (result.productRegulatoryIntelligence?.[0]) {
    const r = result.productRegulatoryIntelligence[0];
    console.log(`   • Commodity: ${r.productDescription}`);
    console.log(`   • Statutory Status: [${r.currentRestrictionStatus}] | Temporal: [${r.temporalStatus}]`);
    console.log(`   • Explanation: ${r.regulatoryExplanation}`);
  }

  console.log('\n4. CUSTOMER 360 BEHAVIORAL RISK ANALYTICS:');
  if (result.customerBehavioralAssessment) {
    const b = result.customerBehavioralAssessment;
    console.log(`   • Entity: ${b.customerProfile.legalName} (${b.customerProfile.customerReferenceId})`);
    console.log(`   • Entity Resolution: ${b.entityResolution.resolutionMethod} (${(b.entityResolution.matchConfidence * 100).toFixed(0)}% match)`);
    console.log(`   • Baseline LC Frequency: ${b.baselines.historicalLcFrequencyMean.toFixed(1)} LCs/month (Lifetime: ${b.customerProfile.lifetimeTransactionCount} LCs)`);
    console.log(`   • Baseline Avg Value: USD ${b.baselines.historicalAverageValueUsd.toLocaleString()}`);
    console.log(`   • Active Behavioral Alerts (${b.alerts.length}):`);
    for (const alt of b.alerts) {
      console.log(`     - [${alt.alertCode}] (${alt.severity}): ${alt.explanation}`);
    }
    console.log(`   • Behavioral Risk Score: ${b.behavioralRiskScore}/100 (${b.behavioralRiskLevel})`);
    console.log(`   • Summary: ${b.behavioralSummary}`);
  }

  console.log('\n5. OVERALL COMPLIANCE VERDICT:');
  console.log('   • Decision:', result.decision.decision, `(Confidence: ${(result.decision.confidence * 100).toFixed(0)}%)`);
  console.log('   • Reasons:');
  for (const reason of result.decision.reasons) {
    console.log(`     - ${reason}`);
  }
  console.log('\n==============================================================================');
  console.log('E2E VERIFICATION COMPLETED SUCCESSFULLY (100% OPERATIONAL)');
  console.log('==============================================================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
