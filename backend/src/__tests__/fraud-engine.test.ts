/**
 * TradeGuard Intelligence — Enterprise Fraud & TBML Detection Automated Test Suite
 * 18 Comprehensive Scenarios covering Transaction Identity, Payment Authenticity,
 * Document Replay, Transport Reuse, ISO Check Digits, UCP 600 Partial Drawings, and Behavioral Baselines.
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  FraudEngineService,
  IdentifierNormalizer,
  TransactionRegistry,
  PaymentReconciliationService,
} from '../compliance/fraud';
import type { CustomerProfile } from '../compliance/behavioral/behavioral.types';

function createMockPdfBuffer(params: {
  producer?: string;
  creator?: string;
  creationDate?: string;
  modDate?: string;
  isSigned?: boolean;
  content: string;
}): Buffer {
  const parts: string[] = [
    '%PDF-1.4',
    `% ${params.content}`,
    params.producer ? `/Producer (${params.producer})` : '/Producer (Adobe Acrobat Pro 2024)',
    params.creator ? `/Creator (${params.creator})` : '/Creator (Enterprise Banking Suite)',
    params.creationDate ? `/CreationDate (${params.creationDate})` : '/CreationDate (D:20260301120000Z)',
    params.modDate ? `/ModDate (${params.modDate})` : '/ModDate (D:20260301120000Z)',
  ];

  if (params.isSigned) {
    parts.push('/Type /Sig /ByteRange [0 100 200 300] /Contents <308202...>');
  }

  parts.push('%%EOF');
  return Buffer.from(parts.join('\n'), 'utf8');
}

function createCustomerProfile(overrides: Partial<CustomerProfile> = {}): CustomerProfile {
  return {
    customerReferenceId: 'CUST-APEX-001',
    legalName: 'Apex Commodities International FZE',
    normalizedName: 'apex commodities international fze',
    aliases: ['Apex Commodities'],
    country: 'United Arab Emirates',
    businessType: 'Commodity Trading',
    declaredBusinessActivity: 'Agricultural Commodities & Grain Trading',
    riskRating: 'LOW',
    onboardingDate: '2023-01-15T00:00:00Z',
    lastActiveDate: '2026-03-01T00:00:00Z',
    lifetimeTransactionCount: 45,
    lifetimeVolumeUsd: 18500000,
    averageTransactionValueUsd: 411111,
    monthlyLcFrequency: 1.5,
    establishedProductCategories: ['Agricultural Commodities', 'Wheat', 'Grain', 'Fertilizer'],
    establishedCountries: ['Pakistan', 'United Arab Emirates', 'Singapore'],
    regularSuppliers: ['National Grain Exporters Ltd'],
    regularBuyers: ['Sindh Agro Processors Ltd'],
    historicalOriginPorts: ['Karachi Port'],
    historicalLoadingPorts: ['Karachi Port'],
    historicalDischargePorts: ['Port of Jebel Ali'],
    commonTransshipmentHubs: ['Salalah'],
    typicalRoutes: ['Pakistan -> United Arab Emirates'],
    pastSanctionsHitsCount: 0,
    pastPriceAnomaliesCount: 0,
    pastDiscrepanciesCount: 0,
    averageHistoricalRiskScore: 12,
    processedDocumentIds: [],
    processedTransactionIds: [],
    ...overrides,
  };
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('TRADEGUARD INTELLIGENCE — FRAUD & TBML DETECTION TEST SUITE');
  console.log('Testing 18 Mandatory Enterprise Banking Scenarios');
  console.log('================================================================\n');

  const fraudEngine = FraudEngineService.getInstance();
  const normalizer = new IdentifierNormalizer();
  const registry = TransactionRegistry.getInstance();
  const paymentReconciler = PaymentReconciliationService.getInstance();

  // Clear singleton caches for repeatable deterministic runs
  registry.clearAll();
  paymentReconciler.clearAll();

  // --------------------------------------------------------------------------
  // Scenario 1: Genuine New Transaction Baseline
  // --------------------------------------------------------------------------
  console.log('Scenario 1: Testing Genuine New Transaction Baseline...');
  const docBuf1 = createMockPdfBuffer({ content: 'Invoice INV-2026-001 Wheat $150,000' });
  const hash1 = crypto.createHash('sha256').update(docBuf1).digest('hex');

  const result1 = await fraudEngine.analyzeDocument({
    documentId: 'DOC-001',
    filename: 'Commercial_Invoice_001.pdf',
    rawBuffer: docBuf1,
    rawText: 'Commercial Invoice INV-2026-001 dated 2026-03-01 Total USD 150,000',
    customerId: 'CUST-APEX-001',
    contentHash: hash1,
    normalizedTextHash: hash1,
    docClass: {
      type: 'Commercial Invoice',
      number: 'INV-2026-001',
      date: '2026-03-01',
      transactionReference: 'TXN-2026-001',
      relatedLcNumber: 'LC-PK-2026-8891',
    },
    parties: {
      seller: { legalName: 'Apex Commodities International FZE' },
      buyer: { legalName: 'Sindh Agro Processors Ltd' },
    },
    commercial: {
      currency: 'USD',
      totalValue: 150000,
      paymentTerms: 'Letter of Credit 60 Days',
    },
    logistics: {
      billOfLadingNumber: 'BL-MAEU-9921001',
      containerNumbers: ['MSCU6543210'], // Valid container
      vesselImo: '9223456', // Valid IMO
      portOfLoading: 'Karachi Port',
      portOfDischarge: 'Port of Jebel Ali',
    },
    goods: [
      { productDescription: 'Milling Wheat Grade A', productCategory: 'Agricultural Commodities', quantity: 500, unitPrice: 300 },
    ],
    customerProfile: createCustomerProfile(),
  });

  assert.strictEqual(result1.documentClassificationVerdict, 'GENUINE_NEW_TRANSACTION');
  assert.strictEqual(result1.overallStatus, 'NO_MATERIAL_ANOMALY_DETECTED');
  assert.strictEqual(result1.riskLevel, 'LOW');
  assert.strictEqual(result1.replayComparison?.isReplayCandidate, false);
  assert.strictEqual(result1.alerts.filter((a) => a.severity === 'CRITICAL' || a.severity === 'HIGH').length, 0);
  console.log('✔ Scenario 1 Passed: Genuine new transaction baseline verified with 0 critical alerts.\n');

  // --------------------------------------------------------------------------
  // Scenario 2: Exact Document Re-Upload (Byte/Hash Match)
  // --------------------------------------------------------------------------
  console.log('Scenario 2: Testing Exact Document Re-Upload (Byte Hash Match)...');
  const result2 = await fraudEngine.analyzeDocument({
    documentId: 'DOC-001-REUPLOAD',
    filename: 'Commercial_Invoice_001_copy.pdf',
    rawBuffer: docBuf1,
    rawText: 'Commercial Invoice INV-2026-001 dated 2026-03-01 Total USD 150,000',
    customerId: 'CUST-APEX-001',
    contentHash: hash1,
    normalizedTextHash: hash1,
    docClass: {
      type: 'Commercial Invoice',
      number: 'INV-2026-001',
      date: '2026-03-01',
      transactionReference: 'TXN-2026-001',
      relatedLcNumber: 'LC-PK-2026-8891',
    },
    parties: {
      seller: { legalName: 'Apex Commodities International FZE' },
      buyer: { legalName: 'Sindh Agro Processors Ltd' },
    },
    commercial: {
      currency: 'USD',
      totalValue: 150000,
      paymentTerms: 'Letter of Credit 60 Days',
    },
    logistics: {
      billOfLadingNumber: 'BL-MAEU-9921001',
      containerNumbers: ['MSCU6543210'],
      vesselImo: '9223456',
      portOfLoading: 'Karachi Port',
      portOfDischarge: 'Port of Jebel Ali',
    },
    goods: [
      { productDescription: 'Milling Wheat Grade A', productCategory: 'Agricultural Commodities', quantity: 500, unitPrice: 300 },
    ],
    customerProfile: createCustomerProfile(),
  });

  assert.strictEqual(result2.documentClassificationVerdict, 'LEGITIMATE_DUPLICATE_RESUBMISSION');
  assert.strictEqual(result2.overallStatus, 'NO_MATERIAL_ANOMALY_DETECTED');
  console.log('✔ Scenario 2 Passed: Exact file byte re-upload recognized as legitimate duplicate resubmission.\n');

  // --------------------------------------------------------------------------
  // Scenario 3: Exact Transaction Identity Resubmission (Same metadata, different buffer)
  // --------------------------------------------------------------------------
  console.log('Scenario 3: Testing Exact Transaction Identity Resubmission...');
  const docBuf3 = createMockPdfBuffer({ content: 'Invoice INV-2026-001 Re-rendered Scan' });
  const hash3 = crypto.createHash('sha256').update(docBuf3).digest('hex');

  const result3 = await fraudEngine.analyzeDocument({
    documentId: 'DOC-001-SCAN2',
    filename: 'Commercial_Invoice_001_Scan2.pdf',
    rawBuffer: docBuf3,
    rawText: 'Commercial Invoice INV-2026-001 dated 2026-03-01 Total USD 150,000',
    customerId: 'CUST-APEX-001',
    contentHash: hash3,
    normalizedTextHash: hash3,
    docClass: {
      type: 'Commercial Invoice',
      number: 'INV-2026-001',
      date: '2026-03-01',
      transactionReference: 'TXN-2026-001',
      relatedLcNumber: 'LC-PK-2026-8891',
    },
    parties: {
      seller: { legalName: 'Apex Commodities International FZE' },
      buyer: { legalName: 'Sindh Agro Processors Ltd' },
    },
    commercial: {
      currency: 'USD',
      totalValue: 150000,
      paymentTerms: 'Letter of Credit 60 Days',
    },
    logistics: {
      billOfLadingNumber: 'BL-MAEU-9921001',
      containerNumbers: ['MSCU6543210'],
      vesselImo: '9223456',
      portOfLoading: 'Karachi Port',
      portOfDischarge: 'Port of Jebel Ali',
    },
    goods: [
      { productDescription: 'Milling Wheat Grade A', productCategory: 'Agricultural Commodities', quantity: 500, unitPrice: 300 },
    ],
    customerProfile: createCustomerProfile(),
  });

  assert.strictEqual(result3.documentClassificationVerdict, 'LEGITIMATE_DUPLICATE_RESUBMISSION');
  console.log('✔ Scenario 3 Passed: Re-rendered identical trade transaction recognized as duplicate resubmission.\n');

  // --------------------------------------------------------------------------
  // Scenario 4: Document Replay with Altered Amount & Date
  // --------------------------------------------------------------------------
  console.log('Scenario 4: Testing Document Replay with Altered Amount & Date...');
  const docBuf4 = createMockPdfBuffer({ content: 'Invoice INV-2026-001 Altered to $350,000' });
  const hash4 = crypto.createHash('sha256').update(docBuf4).digest('hex');

  const result4 = await fraudEngine.analyzeDocument({
    documentId: 'DOC-004-ALTERED',
    filename: 'Altered_Invoice_001.pdf',
    rawBuffer: docBuf4,
    rawText: 'Commercial Invoice INV-2026-001 dated 2026-04-15 Total USD 350,000',
    customerId: 'CUST-APEX-001',
    contentHash: hash4,
    normalizedTextHash: hash4,
    docClass: {
      type: 'Commercial Invoice',
      number: 'INV-2026-001', // SAME invoice number
      date: '2026-04-15',      // ALTERED date
      transactionReference: 'TXN-2026-001',
      relatedLcNumber: 'LC-PK-2026-8891',
    },
    parties: {
      seller: { legalName: 'Apex Commodities International FZE' },
      buyer: { legalName: 'Sindh Agro Processors Ltd' },
    },
    commercial: {
      currency: 'USD',
      totalValue: 350000, // ALTERED value (was 150000)
      paymentTerms: 'Letter of Credit 60 Days',
    },
    logistics: {
      billOfLadingNumber: 'BL-MAEU-9921001', // SAME B/L
      containerNumbers: ['MSCU6543210'],
      vesselImo: '9223456',
      portOfLoading: 'Karachi Port',
      portOfDischarge: 'Port of Jebel Ali',
    },
    goods: [
      { productDescription: 'Milling Wheat Grade A', productCategory: 'Agricultural Commodities', quantity: 1000, unitPrice: 350 },
    ],
    customerProfile: createCustomerProfile(),
  });

  assert.strictEqual(result4.documentClassificationVerdict, 'SUSPECTED_DOCUMENT_REPLAY');
  assert.strictEqual(result4.replayComparison?.isReplayCandidate, true);
  assert.ok(result4.replayComparison!.similarityPercent >= 70, 'Expected high replay similarity percentage');
  assert.ok(result4.replayComparison!.alteredFields.some((af) => af.field === 'TOTAL_AMOUNT'), 'Expected TOTAL_AMOUNT to be flagged as altered');
  assert.ok(result4.alerts.some((a) => a.code === 'DOCUMENT_REPLAY_ALTERATION' && a.severity === 'CRITICAL'));
  console.log('✔ Scenario 4 Passed: Suspicious document replay with altered amount/date flagged as CRITICAL.\n');

  // --------------------------------------------------------------------------
  // Scenario 5: Cross-Customer Transaction ID Conflict
  // --------------------------------------------------------------------------
  console.log('Scenario 5: Testing Cross-Customer Transaction ID Conflict...');
  const docBuf5 = createMockPdfBuffer({ content: 'Invoice INV-2026-001 used by another tenant' });
  const hash5 = crypto.createHash('sha256').update(docBuf5).digest('hex');

  const result5 = await fraudEngine.analyzeDocument({
    documentId: 'DOC-005-CONFLICT',
    filename: 'Hijacked_Invoice.pdf',
    rawBuffer: docBuf5,
    rawText: 'Commercial Invoice INV-2026-001 from Competitor Global Ltd',
    customerId: 'CUST-COMPETITOR-999', // DIFFERENT customer tenant
    contentHash: hash5,
    normalizedTextHash: hash5,
    docClass: {
      type: 'Commercial Invoice',
      number: 'INV-2026-001', // Same invoice number as CUST-APEX-001
      date: '2026-03-01',
      transactionReference: 'TXN-COMPETITOR-001',
    },
    parties: {
      seller: { legalName: 'Competitor Global Trading Ltd' },
      buyer: { legalName: 'Dubai Imports LLC' },
    },
    commercial: {
      currency: 'USD',
      totalValue: 95000,
      paymentTerms: 'Cash Against Documents',
    },
    logistics: {
      billOfLadingNumber: 'BL-COSCO-112233',
    },
    goods: [{ productDescription: 'Steel Rebars', quantity: 100, unitPrice: 950 }],
  });

  assert.ok(result5.alerts.some((a) => a.code === 'CROSS_CUSTOMER_CONFLICT' && a.severity === 'CRITICAL'));
  assert.strictEqual(result5.riskLevel, 'CRITICAL');
  console.log('✔ Scenario 5 Passed: Cross-customer transaction ID conflict correctly triggered CRITICAL alert.\n');

  // --------------------------------------------------------------------------
  // Scenario 6: Same Customer Different Transaction Reuse
  // --------------------------------------------------------------------------
  console.log('Scenario 6: Testing Same Customer Reusing Invoice for Different Buyer (Without Credit Note)...');
  const docBuf6 = createMockPdfBuffer({ content: 'Invoice INV-2026-001 to Third Party Buyer' });
  const hash6 = crypto.createHash('sha256').update(docBuf6).digest('hex');

  const result6 = await fraudEngine.analyzeDocument({
    documentId: 'DOC-006-REUSE',
    filename: 'Invoice_001_NewBuyer.pdf',
    rawBuffer: docBuf6,
    rawText: 'Commercial Invoice INV-2026-001 to Oman Grains Ltd',
    customerId: 'CUST-APEX-001',
    contentHash: hash6,
    normalizedTextHash: hash6,
    docClass: {
      type: 'Commercial Invoice',
      number: 'INV-2026-001', // Same invoice
      date: '2026-03-10',
      transactionReference: 'TXN-2026-006',
    },
    parties: {
      seller: { legalName: 'Apex Commodities International FZE' },
      buyer: { legalName: 'Oman Grains LLC' }, // DIFFERENT buyer
    },
    commercial: {
      currency: 'USD',
      totalValue: 120000,
      paymentTerms: 'Open Account',
    },
    logistics: {
      billOfLadingNumber: 'BL-HAPAG-445566',
    },
    goods: [{ productDescription: 'Barley Grade B', quantity: 400, unitPrice: 300 }],
    customerProfile: createCustomerProfile(),
  });

  assert.ok(result6.alerts.some((a) => a.code === 'INVOICE_NUMBER_REUSED_SAME_CUSTOMER'));
  console.log('✔ Scenario 6 Passed: Same customer invoice number reuse across different buyer alerted.\n');

  // --------------------------------------------------------------------------
  // Scenario 7: Payment Verification Tier 1 (Authoritative Core Banking / MT103 Match)
  // --------------------------------------------------------------------------
  console.log('Scenario 7: Testing Payment Verification Tier 1 (Core Banking / MT103 Match)...');
  paymentReconciler.registerAuthoritativePayment({
    paymentReference: 'PAY-HBL-2026-8801',
    amount: 250000,
    currency: 'USD',
    beneficiaryName: 'Habib Bank Karachi Exporter',
    payerName: 'UK Importers PLC',
    settlementStatus: 'SETTLED',
    settlementDate: '2026-03-05T00:00:00Z',
    sourceChannel: 'CORE_BANKING',
  });

  const payResult7 = paymentReconciler.reconcilePayment({
    paymentReference: 'PAY-HBL-2026-8801',
    claimedAmount: 250000,
    claimedCurrency: 'USD',
    claimedBeneficiary: 'Habib Bank Karachi Exporter',
    claimedStatusText: 'Settled and credited to beneficiary account',
  });

  assert.strictEqual(payResult7.verificationStrength, 'TIER_3_CORE_BANKING_STATEMENT');
  assert.strictEqual(payResult7.reconciliationStatus, 'RECONCILED_VERIFIED');
  assert.strictEqual(payResult7.authoritativeStatus, 'SETTLED');
  assert.strictEqual(payResult7.discrepancies.length, 0);
  console.log('✔ Scenario 7 Passed: Tier 1/3 authoritative bank payment record verified with 0 discrepancies.\n');

  // --------------------------------------------------------------------------
  // Scenario 8: Payment Verification Tier 2 (SWIFT GPI UETR Match)
  // --------------------------------------------------------------------------
  console.log('Scenario 8: Testing Payment Verification Tier 2 (SWIFT GPI UETR Match)...');
  const validUetr = 'c84a8bb3-8d65-4f4e-9b21-47cb23491d90';
  paymentReconciler.registerAuthoritativePayment({
    paymentReference: 'SWIFT-FT-99001',
    uetr: validUetr,
    amount: 500000,
    currency: 'USD',
    beneficiaryName: 'Indus Cotton Mills Ltd',
    payerName: 'Global Textile Sourcing AG',
    settlementStatus: 'SETTLED',
    settlementDate: '2026-03-02T10:00:00Z',
    sourceChannel: 'SWIFT_GPI',
  });

  const payResult8 = paymentReconciler.reconcilePayment({
    uetr: validUetr,
    claimedAmount: 500000,
    claimedCurrency: 'USD',
    claimedBeneficiary: 'Indus Cotton Mills Ltd',
  });

  assert.strictEqual(payResult8.verificationStrength, 'TIER_2_VERIFIED_SWIFT_MESSAGE');
  assert.strictEqual(payResult8.reconciliationStatus, 'RECONCILED_VERIFIED');
  console.log('✔ Scenario 8 Passed: SWIFT GPI UETR confirmed with Tier 2 authoritative verification.\n');

  // --------------------------------------------------------------------------
  // Scenario 9: Legitimate Repeated UETR Across Invoice and Payment Advice
  // --------------------------------------------------------------------------
  console.log('Scenario 9: Testing Legitimate Repeated UETR (Same Payment, Multiple Docs)...');
  const sharedUetr = 'd92b7cc4-9e76-4a5f-8c32-58da34502ea1';
  const docBuf9A = createMockPdfBuffer({ content: `Invoice INV-100 UETR ${sharedUetr} $75,000` });
  const docBuf9B = createMockPdfBuffer({ content: `Bank Advice UETR ${sharedUetr} $75,000` });

  await fraudEngine.analyzeDocument({
    documentId: 'DOC-INV-100',
    filename: 'Invoice_100.pdf',
    rawBuffer: docBuf9A,
    rawText: `Commercial Invoice INV-100 UETR ${sharedUetr} USD 75,000`,
    customerId: 'CUST-APEX-001',
    contentHash: crypto.createHash('sha256').update(docBuf9A).digest('hex'),
    normalizedTextHash: 'hash-9a',
    docClass: { type: 'Commercial Invoice', number: 'INV-100', date: '2026-03-01', transactionReference: 'TXN-100' },
    parties: { seller: { legalName: 'Apex Commodities International FZE' }, buyer: { legalName: 'Sindh Agro Processors Ltd' } },
    commercial: { currency: 'USD', totalValue: 75000, uetr: sharedUetr },
    logistics: {},
    goods: [{ productDescription: 'Grain', quantity: 100, unitPrice: 750 }],
  });

  const result9B = await fraudEngine.analyzeDocument({
    documentId: 'DOC-ADV-100',
    filename: 'Payment_Advice_100.pdf',
    rawBuffer: docBuf9B,
    rawText: `Bank Payment Advice UETR ${sharedUetr} USD 75,000 Beneficiary Apex Commodities`,
    customerId: 'CUST-APEX-001',
    contentHash: crypto.createHash('sha256').update(docBuf9B).digest('hex'),
    normalizedTextHash: 'hash-9b',
    docClass: { type: 'Payment Advice', number: 'ADV-100', date: '2026-03-02', transactionReference: 'TXN-100' },
    parties: { seller: { legalName: 'Apex Commodities International FZE' }, buyer: { legalName: 'Sindh Agro Processors Ltd' } },
    commercial: { currency: 'USD', totalValue: 75000, uetr: sharedUetr },
    logistics: {},
    goods: [{ productDescription: 'Grain', quantity: 100, unitPrice: 750 }],
  });

  // Legitimate repetition: No UETR_PAYMENT_CONFLICT alert
  assert.strictEqual(result9B.alerts.filter((a) => a.code === 'UETR_PAYMENT_CONFLICT').length, 0);
  console.log('✔ Scenario 9 Passed: Legitimate repeated UETR between invoice and payment advice permitted without conflict.\n');

  // --------------------------------------------------------------------------
  // Scenario 10: Conflicting UETR Across Different Transactions
  // --------------------------------------------------------------------------
  console.log('Scenario 10: Testing Conflicting UETR Across Different Transactions...');
  const docBuf10 = createMockPdfBuffer({ content: `Different Transaction Reusing UETR ${sharedUetr} for $400,000` });

  const result10 = await fraudEngine.analyzeDocument({
    documentId: 'DOC-INV-200',
    filename: 'Fraudulent_UETR_Reuse.pdf',
    rawBuffer: docBuf10,
    rawText: `Commercial Invoice INV-200 UETR ${sharedUetr} USD 400,000 to European Buyer`,
    customerId: 'CUST-APEX-001',
    contentHash: crypto.createHash('sha256').update(docBuf10).digest('hex'),
    normalizedTextHash: 'hash-10',
    docClass: { type: 'Commercial Invoice', number: 'INV-200', date: '2026-03-15', transactionReference: 'TXN-200' },
    parties: { seller: { legalName: 'Apex Commodities International FZE' }, buyer: { legalName: 'European Buyer GmbH' } },
    commercial: { currency: 'USD', totalValue: 400000, uetr: sharedUetr }, // CONFLICT: Amount $400k vs $75k, different buyer
    logistics: {},
    goods: [{ productDescription: 'Grain', quantity: 500, unitPrice: 800 }],
  });

  assert.ok(result10.alerts.some((a) => a.code === 'UETR_PAYMENT_CONFLICT' && a.severity === 'CRITICAL'));
  console.log('✔ Scenario 10 Passed: Synthetic UETR reuse across distinct transaction values triggered CRITICAL alert.\n');

  // --------------------------------------------------------------------------
  // Scenario 11: Document Says "Paid" Without Authoritative Bank Record
  // --------------------------------------------------------------------------
  console.log('Scenario 11: Testing Document Says "Paid" Without Authoritative Record (Tier 6)...');
  const payResult11 = paymentReconciler.reconcilePayment({
    claimedAmount: 85000,
    claimedCurrency: 'USD',
    claimedBeneficiary: 'Karachi Exports Ltd',
    claimedStatusText: 'Status: Fully Paid by T/T',
    paymentReference: 'UNVERIFIED-REF-9988',
  });

  assert.strictEqual(payResult11.verificationStrength, 'TIER_6_DOCUMENT_ONLY_UNVERIFIED');
  assert.strictEqual(payResult11.reconciliationStatus, 'UNVERIFIED_DOCUMENT_ONLY');
  console.log('✔ Scenario 11 Passed: Document-only unverified payment mapped strictly to Tier 6 (advisory, not fraud).\n');

  // --------------------------------------------------------------------------
  // Scenario 12: Authoritative Payment Contradicted (Rejected / Reversed)
  // --------------------------------------------------------------------------
  console.log('Scenario 12: Testing Authoritative Payment Contradiction (Rejected/Reversed)...');
  paymentReconciler.registerAuthoritativePayment({
    paymentReference: 'PAY-BOUNCE-001',
    amount: 180000,
    currency: 'USD',
    beneficiaryName: 'Apex Commodities',
    payerName: 'Defaulting Buyer Ltd',
    settlementStatus: 'REJECTED', // Authoritative status rejected!
    settlementDate: '2026-03-01T00:00:00Z',
    sourceChannel: 'CORE_BANKING',
  });

  const payResult12 = paymentReconciler.reconcilePayment({
    paymentReference: 'PAY-BOUNCE-001',
    claimedAmount: 180000,
    claimedCurrency: 'USD',
    claimedBeneficiary: 'Apex Commodities',
    claimedStatusText: 'Paid and settled in full',
  });

  assert.strictEqual(payResult12.verificationStrength, 'TIER_8_CONTRADICTED_PAYMENT');
  assert.strictEqual(payResult12.reconciliationStatus, 'CONTRADICTED_PAYMENT');
  assert.ok(payResult12.discrepancies.some((d) => d.includes('REJECTED')));
  console.log('✔ Scenario 12 Passed: False settlement claim contradicted by bank records triggered Tier 8 alert.\n');

  // --------------------------------------------------------------------------
  // Scenario 13: Bill of Lading Reused on Materially Different Voyage / Vessel
  // --------------------------------------------------------------------------
  console.log('Scenario 13: Testing Bill of Lading Reused on Different Voyage/Vessel...');
  const docBuf13 = createMockPdfBuffer({ content: 'B/L BL-MAEU-9921001 reused on feeder vessel to Singapore' });

  const result13 = await fraudEngine.analyzeDocument({
    documentId: 'DOC-013-BL-REUSE',
    filename: 'BL_Reused.pdf',
    rawBuffer: docBuf13,
    rawText: 'Bill of Lading BL-MAEU-9921001 Vessel IMO 9334567 Singapore Port',
    customerId: 'CUST-OTHER-123',
    contentHash: crypto.createHash('sha256').update(docBuf13).digest('hex'),
    normalizedTextHash: 'hash-13',
    docClass: { type: 'Bill of Lading', number: 'BL-MAEU-9921001', date: '2026-03-20', transactionReference: 'TXN-013' },
    parties: { seller: { legalName: 'Apex Commodities' }, buyer: { legalName: 'Singapore Feed Ltd' } },
    commercial: { currency: 'USD', totalValue: 90000 },
    logistics: {
      billOfLadingNumber: 'BL-MAEU-9921001', // REUSED from Scenario 1
      vesselImo: '9334567', // DIFFERENT vessel IMO (was 9223456)
      portOfLoading: 'Port Klang',
      portOfDischarge: 'Singapore Port',
    },
    goods: [{ productDescription: 'Wheat', quantity: 300, unitPrice: 300 }],
  });

  assert.ok(result13.alerts.some((a) => a.code === 'B_L_REUSED_ACROSS_SHIPMENTS' && a.severity === 'CRITICAL'));
  console.log('✔ Scenario 13 Passed: Bill of Lading reuse across incompatible voyages flagged as CRITICAL.\n');

  // --------------------------------------------------------------------------
  // Scenario 14: ISO 6346 Container Check Digit Verification
  // --------------------------------------------------------------------------
  console.log('Scenario 14: Testing ISO 6346 Container Check Digit Verification...');
  // MSCU6543210 -> Valid: M=23, S=30, C=13, U=32... check digit = 0
  const validContainerCheck = normalizer.validateContainerNumber('MSCU6543210');
  assert.strictEqual(validContainerCheck.isValid, true, 'Expected MSCU6543210 to be valid');

  // MSCU6543219 -> Invalid check digit 9 instead of 0
  const invalidContainerCheck = normalizer.validateContainerNumber('MSCU6543219');
  assert.strictEqual(invalidContainerCheck.isValid, false, 'Expected MSCU6543219 to have invalid check digit');
  console.log('✔ Scenario 14 Passed: ISO 6346 container check digit algorithm validated successfully.\n');

  // --------------------------------------------------------------------------
  // Scenario 15: Container Logistics Conflict (Incompatible Voyage Windows)
  // --------------------------------------------------------------------------
  console.log('Scenario 15: Testing Container Logistics Conflict Across Active Voyages...');
  const docBuf15 = createMockPdfBuffer({ content: 'Container MSCU6543210 in Rotterdam simultaneously' });

  const result15 = await fraudEngine.analyzeDocument({
    documentId: 'DOC-015-CNTR',
    filename: 'Container_Conflict.pdf',
    rawBuffer: docBuf15,
    rawText: 'Container MSCU6543210 Shipped on Board Rotterdam to Houston',
    customerId: 'CUST-ROTTERDAM-01',
    contentHash: crypto.createHash('sha256').update(docBuf15).digest('hex'),
    normalizedTextHash: 'hash-15',
    docClass: { type: 'Bill of Lading', number: 'BL-CNTR-ROT-01', date: '2026-03-02', transactionReference: 'TXN-015' },
    parties: { seller: { legalName: 'Rotterdam Trading BV' }, buyer: { legalName: 'Texas Petro LLC' } },
    commercial: { currency: 'USD', totalValue: 80000 },
    logistics: {
      containerNumbers: ['MSCU6543210'], // REUSED container while active on Karachi -> Jebel Ali
      portOfLoading: 'Port of Rotterdam',
      portOfDischarge: 'Port of Houston',
    },
    goods: [{ productDescription: 'Chemicals', quantity: 20, unitPrice: 4000 }],
  });

  assert.ok(result15.alerts.some((a) => a.code === 'CONTAINER_LOGISTICS_CONFLICT'));
  console.log('✔ Scenario 15 Passed: Container simultaneous shipment conflict detected across contradictory ports.\n');

  // --------------------------------------------------------------------------
  // Scenario 16: Multiple Invoicing / Duplicate Financing
  // --------------------------------------------------------------------------
  console.log('Scenario 16: Testing Multiple Invoicing Across Different Facilities...');
  const docBuf16 = createMockPdfBuffer({ content: 'Invoice INV-2026-001 Re-presented for Post-Shipment Loan' });

  const result16 = await fraudEngine.analyzeDocument({
    documentId: 'DOC-016-MULTIFINANCE',
    filename: 'Invoice_001_SecondFinancing.pdf',
    rawBuffer: docBuf16,
    rawText: 'Post-Shipment Financing Application for Invoice INV-2026-001 USD 150,000',
    customerId: 'CUST-APEX-001',
    contentHash: crypto.createHash('sha256').update(docBuf16).digest('hex'),
    normalizedTextHash: 'hash-16',
    docClass: {
      type: 'Commercial Invoice',
      number: 'INV-2026-001',
      date: '2026-03-01',
      transactionReference: 'FACILITY-LOAN-9922', // DIFFERENT facility reference
    },
    parties: {
      seller: { legalName: 'Apex Commodities International FZE' },
      buyer: { legalName: 'Sindh Agro Processors Ltd' },
    },
    commercial: {
      currency: 'USD',
      totalValue: 150000,
      paymentTerms: 'Commercial Loan 90 Days',
    },
    logistics: {
      billOfLadingNumber: 'BL-MAEU-9921001',
    },
    goods: [{ productDescription: 'Milling Wheat Grade A', quantity: 500, unitPrice: 300 }],
    customerProfile: createCustomerProfile(),
  });

  assert.ok(result16.alerts.some((a) => a.code === 'MULTIPLE_INVOICE_FINANCING'));
  console.log('✔ Scenario 16 Passed: Multiple invoice financing detection triggered.\n');

  // --------------------------------------------------------------------------
  // Scenario 17: Legitimate UCP 600 Partial Drawing / Partial Shipment
  // --------------------------------------------------------------------------
  console.log('Scenario 17: Testing Legitimate UCP 600 Partial Drawing / Shipment...');
  const docBuf17A = createMockPdfBuffer({ content: 'LC-9900 Partial Drawing 1: $60,000' });
  const docBuf17B = createMockPdfBuffer({ content: 'LC-9900 Partial Drawing 2: $40,000' });

  await fraudEngine.analyzeDocument({
    documentId: 'DOC-LC-DRAW-1',
    filename: 'Drawing_1.pdf',
    rawBuffer: docBuf17A,
    rawText: 'Letter of Credit LC-9900 Partial Drawing 1 of 2 for USD 60,000',
    customerId: 'CUST-APEX-001',
    contentHash: crypto.createHash('sha256').update(docBuf17A).digest('hex'),
    normalizedTextHash: 'hash-17a',
    docClass: { type: 'Commercial Invoice', number: 'INV-DRAW-1', date: '2026-03-01', transactionReference: 'TXN-DRAW-1', relatedLcNumber: 'LC-9900' },
    parties: { seller: { legalName: 'Apex Commodities' }, buyer: { legalName: 'Sindh Agro' } },
    commercial: { currency: 'USD', totalValue: 60000, isPartialShipment: true, partialShipmentDrawingNumber: 1 },
    logistics: {},
    goods: [{ productDescription: 'Wheat', quantity: 200, unitPrice: 300 }],
    customerProfile: createCustomerProfile(),
  });

  const result17B = await fraudEngine.analyzeDocument({
    documentId: 'DOC-LC-DRAW-2',
    filename: 'Drawing_2.pdf',
    rawBuffer: docBuf17B,
    rawText: 'Letter of Credit LC-9900 Partial Drawing 2 of 2 for USD 40,000',
    customerId: 'CUST-APEX-001',
    contentHash: crypto.createHash('sha256').update(docBuf17B).digest('hex'),
    normalizedTextHash: 'hash-17b',
    docClass: { type: 'Commercial Invoice', number: 'INV-DRAW-2', date: '2026-03-10', transactionReference: 'TXN-DRAW-2', relatedLcNumber: 'LC-9900' },
    parties: { seller: { legalName: 'Apex Commodities' }, buyer: { legalName: 'Sindh Agro' } },
    commercial: { currency: 'USD', totalValue: 40000, isPartialShipment: true, partialShipmentDrawingNumber: 2 },
    logistics: {},
    goods: [{ productDescription: 'Wheat', quantity: 133.33, unitPrice: 300 }],
    customerProfile: createCustomerProfile(),
  });

  // Legitimate partial drawings under UCP 600 do not trigger duplicate financing
  assert.strictEqual(result17B.alerts.filter((a) => a.code === 'MULTIPLE_INVOICE_FINANCING').length, 0);
  console.log('✔ Scenario 17 Passed: UCP 600 legitimate partial drawing recognized without false positive alert.\n');

  // --------------------------------------------------------------------------
  // Scenario 18: Behavioral Baseline Surge (Frequency Spike)
  // --------------------------------------------------------------------------
  console.log('Scenario 18: Testing Customer Behavioral Baseline Frequency Surge...');
  const baselineProfile = createCustomerProfile({
    monthlyLcFrequency: 1.0, // Historical baseline: 1 LC/month
    lifetimeTransactionCount: 12,
  });

  const docBuf18 = createMockPdfBuffer({ content: '10th Transaction in Single Month' });
  const result18 = await fraudEngine.analyzeDocument({
    documentId: 'DOC-018-SURGE',
    filename: 'Surge_Presentation_10.pdf',
    rawBuffer: docBuf18,
    rawText: 'Presentation 10 for Month of March 2026',
    customerId: 'CUST-APEX-001',
    contentHash: crypto.createHash('sha256').update(docBuf18).digest('hex'),
    normalizedTextHash: 'hash-18',
    docClass: { type: 'Commercial Invoice', number: 'INV-SURGE-10', date: '2026-03-25', transactionReference: 'TXN-SURGE-10' },
    parties: { seller: { legalName: 'Apex Commodities' }, buyer: { legalName: 'Sindh Agro' } },
    commercial: { currency: 'USD', totalValue: 800000 },
    logistics: {},
    goods: [{ productDescription: 'Industrial Machinery', productCategory: 'Machinery', quantity: 1, unitPrice: 800000 }], // Unestablished category!
    customerProfile: baselineProfile,
  });

  assert.ok(result18.behavioralBaselineComparison?.isSpikeDetected || result18.alerts.some((a) => a.code === 'CUSTOMER_FREQUENCY_SURGE'));
  console.log('✔ Scenario 18 Passed: Customer behavioral frequency surge successfully alerted.\n');

  console.log('================================================================');
  console.log('ALL 18 MANDATORY FRAUD & TBML DETECTION SCENARIOS PASSED 100%');
  console.log('================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
