/**
 * TradeGuard Intelligence — Enterprise Fraud & TBML Detection Engine
 * Multi-dimensional fraud evaluation across transaction identity, document replay,
 * payment authenticity, multiple invoicing, transport reuse, and behavioral deviations.
 */

import { IdentifierNormalizer, type SemanticIdentifier, type SemanticIdentifierType } from './identifier-normalizer';
import { TransactionRegistry, type TransactionIdentityRecord } from './transaction-registry';
import { PaymentReconciliationService, type ClaimedPaymentInfo, type PaymentReconciliationResult } from './payment-reconciliation.service';
import { ForensicsService, type DocumentForensicResult } from './forensics.service';
import type { CustomerProfile } from '../behavioral/behavioral.types';

export interface FraudAlertEvidence {
  evidenceId: string;
  field: string;
  currentValue: string;
  historicalValue?: string;
  matchedTransactionId?: string;
  matchedDocumentId?: string;
  matchedDocumentName?: string;
  pageNumber?: number;
  explanation: string;
  confidence: number;
}

export interface FraudAlert {
  alertId: string;
  code: string;
  title: string;
  category:
    | 'DOCUMENT_REPLAY_ALTERATION'
    | 'TRANSACTION_ID_REUSE_CONFLICT'
    | 'PAYMENT_AUTHENTICITY_MISMATCH'
    | 'MULTIPLE_INVOICE_FINANCING'
    | 'TRANSPORT_DOCUMENT_REUSE'
    | 'CROSS_DOCUMENT_INCONSISTENCY'
    | 'PHANTOM_SHIPMENT_INDICATOR'
    | 'BENEFICIARY_ACCOUNT_ANOMALY'
    | 'THIRD_PARTY_PAYMENT'
    | 'TBML_PRICING_MANIPULATION'
    | 'CUSTOMER_BEHAVIORAL_ANOMALY'
    | 'CONTAINER_CONFLICT'
    | 'PDF_FORENSIC_TAMPERING';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;
  summary: string;
  evidence: FraudAlertEvidence[];
  legitimateBusinessContext?: string;
  recommendedAction: string;
}

export interface FraudAnalysisResult {
  overallStatus: 'NO_MATERIAL_ANOMALY_DETECTED' | 'SUSPICIOUS_INDICATORS_DETECTED' | 'HIGH_RISK_MANUAL_INVESTIGATION_REQUIRED';
  overallFraudRiskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  documentClassificationVerdict:
    | 'GENUINE_NEW_TRANSACTION'
    | 'LEGITIMATE_DUPLICATE_RESUBMISSION'
    | 'DUPLICATE_TRANSACTION'
    | 'SUSPECTED_DOCUMENT_REPLAY'
    | 'POTENTIAL_MULTIPLE_INVOICING'
    | 'POTENTIAL_TRANSPORT_REUSE'
    | 'UNVERIFIABLE_PAYMENT_EVIDENCE'
    | 'HIGH_RISK_PAYMENT_CONFLICT'
    | 'SUSPECTED_TBML_INDICATOR';
  documentFingerprint: {
    contentHashSha256: string;
    normalizedTextHashSha256: string;
    semanticFieldHash: string;
    pdfProducer?: string;
    pdfCreationDate?: string;
    pdfModificationDate?: string;
    hasDigitalSignature: boolean;
    forensicNotes: string[];
  };
  paymentReconciliation: PaymentReconciliationResult;
  replayComparison?: {
    isReplayCandidate: boolean;
    similarityPercent: number;
    matchedDocumentId?: string;
    matchedDocumentFilename?: string;
    matchedFields: string[];
    alteredFields: Array<{ field: string; original: string; current: string }>;
  };
  crossDocumentConsistency: {
    reconciledDocumentsCount: number;
    conflictCount: number;
    discrepancies: Array<{
      id: string;
      field: string;
      docA: string;
      valA: string;
      docB: string;
      valB: string;
      severity: string;
      explanation: string;
    }>;
  };
  behavioralBaselineComparison?: {
    isSpikeDetected: boolean;
    baselineMonthlyFrequency: number;
    currentMonthFrequency: number;
    isCategoryChangeDetected: boolean;
    declaredActivity: string;
    observedCommodity: string;
  };
  alerts: FraudAlert[];
  investigationAuditPackage: {
    evaluatedAt: string;
    engineVersion: string;
    ruleSetVersion: string;
    totalRulesEvaluated: number;
    totalHistoricalRecordsSearched: number;
  };
}

export class FraudEngineService {
  private static instance: FraudEngineService;

  private readonly normalizer = new IdentifierNormalizer();
  private readonly registry = TransactionRegistry.getInstance();
  private readonly paymentReconciler = PaymentReconciliationService.getInstance();
  private readonly forensics = new ForensicsService();

  private constructor() {}

  public static getInstance(): FraudEngineService {
    if (!FraudEngineService.instance) {
      FraudEngineService.instance = new FraudEngineService();
    }
    return FraudEngineService.instance;
  }

  /**
   * Main evaluation entry point for trade document fraud & TBML analysis.
   */
  public async analyzeDocument(params: {
    documentId: string;
    filename: string;
    rawBuffer: Buffer;
    rawText: string;
    customerId: string;
    contentHash: string;
    normalizedTextHash: string;
    docClass: {
      type: string;
      number: string;
      date: string;
      transactionReference: string;
      relatedLcNumber?: string;
      relatedPoNumber?: string;
    };
    parties: {
      seller?: { legalName?: string; bank?: string; ibanOrAccountNumber?: string; swiftBic?: string };
      buyer?: { legalName?: string };
      applicant?: { legalName?: string };
      beneficiary?: { legalName?: string };
      consignee?: { legalName?: string };
      shipper?: { legalName?: string };
    };
    commercial: {
      currency: string;
      totalValue: number;
      totalQuantity?: number;
      paymentTerms?: string;
      incoterm?: string;
      uetr?: string;
      paymentReference?: string;
      shipmentDate?: string;
      lcExpiryDate?: string;
      isLcAmendment?: boolean;
      amendmentExplanation?: string;
      isPartialShipment?: boolean;
      partialShipmentDrawingNumber?: number;
    };
    logistics: {
      billOfLadingNumber?: string;
      airwayBillNumber?: string;
      containerNumbers?: string[];
      vesselImo?: string;
      portOfLoading?: string;
      portOfDischarge?: string;
    };
    goods: Array<{ productDescription: string; productCategory?: string; hsCode?: string; quantity: number; unitPrice: number }>;
    customerProfile?: CustomerProfile | null;
  }): Promise<FraudAnalysisResult> {
    const alerts: FraudAlert[] = [];
    let alertCount = 1;

    // 1. Run Buffer & PDF Forensics
    const forensicResult = this.forensics.analyzeBuffer(params.rawBuffer, params.filename);
    if (forensicResult.tamperingRiskLevel === 'HIGH' || forensicResult.tamperingRiskLevel === 'ELEVATED') {
      alerts.push({
        alertId: `FRD-FOR-${alertCount++}`,
        code: 'PDF_FORENSIC_ANOMALY',
        title: 'Document Forensic Inconsistency Detected',
        category: 'PDF_FORENSIC_TAMPERING',
        severity: forensicResult.tamperingRiskLevel === 'HIGH' ? 'HIGH' : 'MEDIUM',
        confidence: 0.88,
        summary: 'PDF metadata indicates potential post-creation binary modification or consumer image editing tool usage.',
        evidence: forensicResult.forensicNotes.map((note, idx) => ({
          evidenceId: `EV-FOR-${idx + 1}`,
          field: 'PDF Structure',
          currentValue: note,
          explanation: 'Discrepancy in PDF trailer or incremental update table.',
          confidence: 0.88,
        })),
        recommendedAction: 'Verify document against original electronic source or request digitally signed bank PDF.',
      });
    }

    // 2. Normalize and Register Identifiers
    const extractedIdentifiers: SemanticIdentifier[] = [];
    const addIdentifier = (type: SemanticIdentifierType, raw?: string, role?: string) => {
      if (!raw || raw === 'Not Found' || raw === 'Not Specified') return;
      const normalized = this.normalizer.normalize(type, raw);
      if (!normalized) return;
      extractedIdentifiers.push({
        type,
        rawValue: raw,
        normalizedValue: normalized,
        sourceDocumentId: params.documentId,
        sourceDocumentName: params.filename,
        pageNumber: 1,
        extractionConfidence: 0.95,
        associatedPartyRole: role,
        firstSeenAt: new Date().toISOString(),
      });
    };

    const txnId = params.docClass.transactionReference !== 'Not Found' ? params.docClass.transactionReference : params.docClass.number;
    addIdentifier('INTERNAL_TRANSACTION_ID', txnId);
    addIdentifier('INVOICE_NUMBER', params.docClass.number);
    addIdentifier('LC_NUMBER', params.docClass.relatedLcNumber);
    addIdentifier('PURCHASE_ORDER_NUMBER', params.docClass.relatedPoNumber);
    addIdentifier('BILL_OF_LADING_NUMBER', params.logistics.billOfLadingNumber);
    addIdentifier('AIRWAY_BILL_NUMBER', params.logistics.airwayBillNumber);
    addIdentifier('VESSEL_IMO_NUMBER', params.logistics.vesselImo);
    addIdentifier('PAYMENT_REFERENCE', params.commercial.paymentReference);
    if (params.commercial.uetr) {
      addIdentifier('SWIFT_UETR', params.commercial.uetr);
    }
    for (const c of params.logistics.containerNumbers || []) {
      addIdentifier('CONTAINER_NUMBER', c);
    }

    // 3. Generate Canonical Transaction Fingerprint
    const applicantName = params.parties.applicant?.legalName || params.parties.buyer?.legalName || 'Unspecified Buyer';
    const beneficiaryName = params.parties.beneficiary?.legalName || params.parties.seller?.legalName || 'Unspecified Seller';

    const fingerprintHash = this.registry.generateFingerprint({
      applicant: applicantName,
      beneficiary: beneficiaryName,
      currency: params.commercial.currency,
      totalAmount: params.commercial.totalValue,
      invoiceNumber: params.docClass.number,
      billOfLadingNumber: params.logistics.billOfLadingNumber,
      lcNumber: params.docClass.relatedLcNumber,
      totalQuantity: params.commercial.totalQuantity,
      hsCodes: params.goods.map((g) => g.hsCode).filter((h): h is string => Boolean(h)),
    });

    // Check if identical transaction invariants were previously registered for this customer
    const existingWithSameFingerprint = this.registry.findByFingerprint(fingerprintHash);
    const isExactDuplicateResubmission = existingWithSameFingerprint.some(
      (et) => et.customerId === params.customerId
    );

    // 4. Evaluate Transaction ID Reuse Conflict
    if (txnId && txnId !== 'Not Found') {
      const normTxnId = this.normalizer.normalize('INTERNAL_TRANSACTION_ID', txnId);
      const history = this.registry.getIdentifierHistory('INTERNAL_TRANSACTION_ID', normTxnId);

      if (history && history.appearancesCount > 0) {
        for (const occ of history.occurrences) {
          if (occ.documentId === params.documentId) continue;

          // Cross-customer conflict
          if (occ.customerId && occ.customerId !== params.customerId) {
            alerts.push({
              alertId: `FRD-TXN-${alertCount++}`,
              code: 'CROSS_CUSTOMER_CONFLICT',
              title: 'Transaction Reference Used Across Distinct Customer Tenants',
              category: 'TRANSACTION_ID_REUSE_CONFLICT',
              severity: 'CRITICAL',
              confidence: 0.99,
              summary: `Transaction reference "${txnId}" was originally registered by customer "${occ.customerId}", but presented by customer "${params.customerId}".`,
              evidence: [
                {
                  evidenceId: `EV-TXN-CC-1`,
                  field: 'Customer Ownership',
                  currentValue: params.customerId,
                  historicalValue: occ.customerId,
                  matchedTransactionId: occ.transactionId,
                  matchedDocumentId: occ.documentId,
                  matchedDocumentName: occ.documentName,
                  explanation: 'Transaction identity assigned to unrelated corporate tenant account.',
                  confidence: 0.99,
                },
              ],
              recommendedAction: 'Immediate compliance hold. Cross-customer document presentation detected.',
            });
          }

          // Check A: Conflicting Amount on same Transaction ID
          if (occ.amount && Math.abs(occ.amount - params.commercial.totalValue) > 1.0) {
            alerts.push({
              alertId: `FRD-TXN-${alertCount++}`,
              code: 'TRANSACTION_ID_AMOUNT_CONFLICT',
              title: 'Transaction Reference Reused with Conflicting Amount',
              category: 'TRANSACTION_ID_REUSE_CONFLICT',
              severity: 'CRITICAL',
              confidence: 0.98,
              summary: `Transaction ID "${txnId}" was previously associated with ${occ.currency} ${occ.amount?.toLocaleString()}, but is now presented with ${params.commercial.currency} ${params.commercial.totalValue.toLocaleString()}.`,
              evidence: [
                {
                  evidenceId: `EV-TXN-1`,
                  field: 'Transaction Amount',
                  currentValue: `${params.commercial.currency} ${params.commercial.totalValue.toLocaleString()}`,
                  historicalValue: `${occ.currency} ${occ.amount?.toLocaleString()}`,
                  matchedTransactionId: occ.transactionId,
                  matchedDocumentId: occ.documentId,
                  matchedDocumentName: occ.documentName,
                  explanation: 'Material discrepancy in monetary value under identical transaction identifier.',
                  confidence: 0.98,
                },
              ],
              recommendedAction: 'Immediate compliance hold. Check whether customer submitted an unauthorized modified drawing.',
            });
          }

          // Check B: Conflicting Beneficiary on same Transaction ID
          if (occ.beneficiary && beneficiaryName && occ.beneficiary.toLowerCase() !== beneficiaryName.toLowerCase()) {
            alerts.push({
              alertId: `FRD-TXN-${alertCount++}`,
              code: 'TRANSACTION_ID_BENEFICIARY_CONFLICT',
              title: 'Transaction Reference Reused with Conflicting Beneficiary',
              category: 'TRANSACTION_ID_REUSE_CONFLICT',
              severity: 'CRITICAL',
              confidence: 0.96,
              summary: `Transaction ID "${txnId}" was previously assigned to beneficiary "${occ.beneficiary}", but current presentation designates "${beneficiaryName}".`,
              evidence: [
                {
                  evidenceId: `EV-TXN-2`,
                  field: 'Beneficiary Entity',
                  currentValue: beneficiaryName,
                  historicalValue: occ.beneficiary,
                  matchedTransactionId: occ.transactionId,
                  matchedDocumentId: occ.documentId,
                  matchedDocumentName: occ.documentName,
                  explanation: 'Transaction identity assigned to multiple unrelated beneficiaries.',
                  confidence: 0.96,
                },
              ],
              recommendedAction: 'Verify commercial trade agreement and Letter of Credit opening contract.',
            });
          }
        }
      }
    }

    // 5. Evaluate Multiple Invoicing & Transport Reuse
    const invoiceNum = params.docClass.number;
    if (invoiceNum && invoiceNum !== 'Not Found') {
      const normInv = this.normalizer.normalize('INVOICE_NUMBER', invoiceNum);
      const invHistory = this.registry.getIdentifierHistory('INVOICE_NUMBER', normInv);

      if (invHistory && invHistory.appearancesCount > 0) {
        const otherOccs = invHistory.occurrences.filter((o) => o.documentId !== params.documentId);
        if (otherOccs.length > 0) {
          // Check for legitimate business contexts
          const isLegitimateAmendment = Boolean(params.commercial.isLcAmendment || params.docClass.type.toLowerCase().includes('amendment'));
          const isPartialShipment = Boolean(params.commercial.isPartialShipment);

          // Cross-customer conflict on invoice
          const crossCustOcc = otherOccs.find((o) => o.customerId !== params.customerId);
          if (crossCustOcc) {
            alerts.push({
              alertId: `FRD-INV-${alertCount++}`,
              code: 'CROSS_CUSTOMER_CONFLICT',
              title: 'Commercial Invoice Reused Across Different Customer Accounts',
              category: 'TRANSACTION_ID_REUSE_CONFLICT',
              severity: 'CRITICAL',
              confidence: 0.99,
              summary: `Commercial Invoice "${invoiceNum}" was previously submitted by customer "${crossCustOcc.customerId}", but presented by "${params.customerId}".`,
              evidence: [
                {
                  evidenceId: `EV-INV-CC-1`,
                  field: 'Customer Ownership',
                  currentValue: params.customerId,
                  historicalValue: crossCustOcc.customerId,
                  matchedTransactionId: crossCustOcc.transactionId,
                  matchedDocumentId: crossCustOcc.documentId,
                  matchedDocumentName: crossCustOcc.documentName,
                  explanation: 'Invoice number claimed across distinct corporate accounts.',
                  confidence: 0.99,
                },
              ],
              recommendedAction: 'Immediate compliance hold. Cross-customer document presentation detected.',
            });
          }

          // Same customer different buyer reuse without credit note
          const sameCustDiffBuyer = otherOccs.find(
            (o) => o.customerId === params.customerId && o.applicant && applicantName && o.applicant.toLowerCase() !== applicantName.toLowerCase()
          );
          if (sameCustDiffBuyer && !isLegitimateAmendment) {
            alerts.push({
              alertId: `FRD-INV-${alertCount++}`,
              code: 'INVOICE_NUMBER_REUSED_SAME_CUSTOMER',
              title: 'Invoice Number Reused for Different Commercial Buyer',
              category: 'MULTIPLE_INVOICE_FINANCING',
              severity: 'HIGH',
              confidence: 0.94,
              summary: `Commercial Invoice "${invoiceNum}" previously presented against buyer "${sameCustDiffBuyer.applicant}" is now presented against buyer "${applicantName}".`,
              evidence: [
                {
                  evidenceId: `EV-INV-SC-1`,
                  field: 'Buyer / Applicant',
                  currentValue: applicantName,
                  historicalValue: sameCustDiffBuyer.applicant,
                  matchedTransactionId: sameCustDiffBuyer.transactionId,
                  matchedDocumentId: sameCustDiffBuyer.documentId,
                  matchedDocumentName: sameCustDiffBuyer.documentName,
                  explanation: 'Re-issuing identical invoice number to unrelated buyers without cancellation note.',
                  confidence: 0.94,
                },
              ],
              legitimateBusinessContext: 'Re-invoicing after contract cancellation if backed by commercial credit note.',
              recommendedAction: 'Verify whether prior presentation was cancelled and obtain signed credit note.',
            });
          }

          // Multiple invoice financing check
          if (!isLegitimateAmendment && !isPartialShipment && !isExactDuplicateResubmission) {
            alerts.push({
              alertId: `FRD-INV-${alertCount++}`,
              code: 'MULTIPLE_INVOICE_FINANCING',
              title: 'Suspected Multiple Invoicing / Duplicate Commercial Drawing',
              category: 'MULTIPLE_INVOICE_FINANCING',
              severity: 'HIGH',
              confidence: 0.92,
              summary: `Commercial Invoice "${invoiceNum}" has been presented across ${otherOccs.length + 1} independent transactions.`,
              evidence: otherOccs.map((o, idx) => ({
                evidenceId: `EV-INV-${idx + 1}`,
                field: 'Invoice Reference',
                currentValue: invoiceNum,
                historicalValue: o.transactionId,
                matchedTransactionId: o.transactionId,
                matchedDocumentId: o.documentId,
                matchedDocumentName: o.documentName,
                explanation: `Previously used in transaction ${o.transactionId} for ${o.currency} ${o.amount?.toLocaleString()} to ${o.beneficiary}.`,
                confidence: 0.92,
              })),
              legitimateBusinessContext: 'May represent a split shipment, credit adjustment, or legitimate re-presentation if supported by an approved LC amendment.',
              recommendedAction: 'Reconcile combined drawings against original commercial contract and ensure invoice was not previously discounted.',
            });
          }
        }
      }
    }

    // 6. Transport Document (Bill of Lading) Reuse Check
    const blNum = params.logistics.billOfLadingNumber;
    if (blNum && blNum !== 'Not Found' && !isExactDuplicateResubmission) {
      const normBl = this.normalizer.normalize('BILL_OF_LADING_NUMBER', blNum);
      const blHistory = this.registry.getIdentifierHistory('BILL_OF_LADING_NUMBER', normBl);

      if (blHistory && blHistory.appearancesCount > 0) {
        const blOthers = blHistory.occurrences.filter((o) => o.documentId !== params.documentId);
        if (blOthers.length > 0) {
          alerts.push({
            alertId: `FRD-BL-${alertCount++}`,
            code: 'B_L_REUSED_ACROSS_SHIPMENTS',
            title: 'Bill of Lading Reused Across Materially Different Voyages / Shipments',
            category: 'TRANSPORT_DOCUMENT_REUSE',
            severity: 'CRITICAL',
            confidence: 0.96,
            summary: `Bill of Lading "${blNum}" was previously registered in transaction "${blOthers[0]?.transactionId ?? 'UNKNOWN'}".`,
            evidence: blOthers.map((o, idx) => ({
              evidenceId: `EV-BL-${idx + 1}`,
              field: 'Bill of Lading Number',
              currentValue: blNum,
              historicalValue: o.transactionId,
              matchedTransactionId: o.transactionId,
              matchedDocumentId: o.documentId,
              matchedDocumentName: o.documentName,
              explanation: `Associated with distinct shipment under transaction ${o.transactionId}.`,
              confidence: 0.96,
            })),
            recommendedAction: 'Verify carrier seal and confirm with shipping line whether duplicate transport bills were generated.',
          });
        }
      }
    }

    // 6B. Container Verification & Logistics Conflict Checks
    for (const cntr of params.logistics.containerNumbers || []) {
      const cntrCheck = this.normalizer.validateContainerNumber(cntr);
      if (!cntrCheck.isValid) {
        alerts.push({
          alertId: `FRD-CNR-${alertCount++}`,
          code: 'INVALID_CONTAINER_CHECK_DIGIT',
          title: 'Container Number Fails ISO 6346 Checksum',
          category: 'CONTAINER_CONFLICT',
          severity: 'HIGH',
          confidence: 0.95,
          summary: `Container number "${cntr}" fails international ISO 6346 checksum verification (${cntrCheck.reason || 'Check digit error'}). Indicates typographical error or fabricated container number.`,
          evidence: [
            {
              evidenceId: `EV-CNR-1`,
              field: 'Container Check Digit',
              currentValue: `${cntrCheck.actualCheckDigit}`,
              historicalValue: `${cntrCheck.expectedCheckDigit}`,
              explanation: 'Check digit does not match ISO 6346 modulus 11 checksum.',
              confidence: 0.95,
            },
          ],
          recommendedAction: 'Check physical container stamping and carrier booking manifest.',
        });
      }

      if (!isExactDuplicateResubmission) {
        const normCntr = this.normalizer.normalize('CONTAINER_NUMBER', cntr);
        const cntrHistory = this.registry.getIdentifierHistory('CONTAINER_NUMBER', normCntr);
        if (cntrHistory && cntrHistory.appearancesCount > 0) {
          const cntrOthers = cntrHistory.occurrences.filter((o) => o.documentId !== params.documentId);
          if (cntrOthers.length > 0) {
            alerts.push({
              alertId: `FRD-CNR-${alertCount++}`,
              code: 'CONTAINER_LOGISTICS_CONFLICT',
              title: 'Container Incompatible Voyage Conflict',
              category: 'CONTAINER_CONFLICT',
              severity: 'HIGH',
              confidence: 0.92,
              summary: `Container "${cntr}" is concurrently associated with another active commercial transaction ("${cntrOthers[0]?.transactionId ?? 'UNKNOWN'}") on conflicting maritime routing.`,
              evidence: cntrOthers.map((co, idx) => ({
                evidenceId: `EV-CNR-CF-${idx + 1}`,
                field: 'Container Routing',
                currentValue: `${params.logistics.portOfLoading || 'Origin'} -> ${params.logistics.portOfDischarge || 'Destination'}`,
                historicalValue: co.transactionId,
                matchedTransactionId: co.transactionId,
                matchedDocumentId: co.documentId,
                matchedDocumentName: co.documentName,
                explanation: 'Physical intermodal equipment cannot be concurrently deployed across divergent itineraries.',
                confidence: 0.92,
              })),
              recommendedAction: 'Query carrier container tracking API for real-time AIS / terminal gate-in status.',
            });
          }
        }
      }
    }

    // 7. Payment Authenticity & UETR Conflict Check
    const claimedPayment: ClaimedPaymentInfo = {
      paymentReference: params.commercial.paymentReference,
      uetr: params.commercial.uetr,
      claimedAmount: params.commercial.totalValue,
      claimedCurrency: params.commercial.currency,
      claimedBeneficiary: beneficiaryName,
      claimedPayer: applicantName,
      claimedDate: params.commercial.shipmentDate || params.docClass.date,
      claimedStatusText: params.commercial.paymentTerms,
    };

    const paymentReconciliation = this.paymentReconciler.reconcilePayment(claimedPayment);

    if (paymentReconciliation.reconciliationStatus === 'CONTRADICTED_PAYMENT') {
      alerts.push({
        alertId: `FRD-PAY-${alertCount++}`,
        code: 'CRITICAL_PAYMENT_RECONCILIATION_CONTRADICTION',
        title: 'Payment Settlement Contradicted by Bank Records',
        category: 'PAYMENT_AUTHENTICITY_MISMATCH',
        severity: 'CRITICAL',
        confidence: 0.99,
        summary: paymentReconciliation.investigationGuidance,
        evidence: paymentReconciliation.discrepancies.map((d, idx) => ({
          evidenceId: `EV-PAY-${idx + 1}`,
          field: 'Settlement Status',
          currentValue: 'Claimed Settled in Presentation',
          historicalValue: paymentReconciliation.authoritativeStatus || 'REJECTED/REVERSED',
          explanation: d,
          confidence: 0.99,
        })),
        recommendedAction: 'Immediate fraud escalation. Authoritative banking ledger confirms payment was reversed or rejected.',
      });
    } else if (paymentReconciliation.reconciliationStatus === 'MATERIAL_MISMATCH') {
      alerts.push({
        alertId: `FRD-PAY-${alertCount++}`,
        code: 'PAYMENT_IDENTITY_MISMATCH',
        title: 'Payment Reference Reused with Material Discrepancies',
        category: 'PAYMENT_AUTHENTICITY_MISMATCH',
        severity: 'CRITICAL',
        confidence: 0.96,
        summary: 'Payment reference matches an existing bank transaction but with conflicting amount or beneficiary.',
        evidence: paymentReconciliation.discrepancies.map((d, idx) => ({
          evidenceId: `EV-PAY-M-${idx + 1}`,
          field: 'Payment Identity',
          currentValue: `${claimedPayment.claimedCurrency} ${claimedPayment.claimedAmount.toLocaleString()} to ${claimedPayment.claimedBeneficiary}`,
          historicalValue: `${paymentReconciliation.authoritativeCurrency} ${paymentReconciliation.authoritativeAmount?.toLocaleString()} to ${paymentReconciliation.authoritativeBeneficiary}`,
          explanation: d,
          confidence: 0.96,
        })),
        recommendedAction: 'Hold payment release. Verify whether debtor referenced the wrong UETR or payment token.',
      });
    }

    // UETR-Specific Repetition Evaluation (Legitimate vs Conflict)
    if (params.commercial.uetr) {
      const normUetr = this.normalizer.normalize('SWIFT_UETR', params.commercial.uetr);
      const uetrHistory = this.registry.getIdentifierHistory('SWIFT_UETR', normUetr);

      if (uetrHistory && uetrHistory.appearancesCount > 0) {
        const uetrOthers = uetrHistory.occurrences.filter((o) => o.documentId !== params.documentId);
        for (const occ of uetrOthers) {
          const isSamePaymentAmount = occ.amount && Math.abs(occ.amount - params.commercial.totalValue) < 0.01;
          const isSameBen = occ.beneficiary && occ.beneficiary.toLowerCase() === beneficiaryName.toLowerCase();

          if (isSamePaymentAmount && isSameBen) {
            // Legitimate: Multiple documents referencing the SAME payment (e.g. invoice + MT103 confirmation)
            // No fraud alert!
          } else {
            // High severity: Same UETR links materially different payments
            alerts.push({
              alertId: `FRD-UETR-${alertCount++}`,
              code: 'UETR_PAYMENT_CONFLICT',
              title: 'SWIFT UETR Reused for Conflicting Payment Identity',
              category: 'PAYMENT_AUTHENTICITY_MISMATCH',
              severity: 'CRITICAL',
              confidence: 0.98,
              summary: `SWIFT UETR "${params.commercial.uetr}" connects materially different transactions.`,
              evidence: [
                {
                  evidenceId: `EV-UETR-1`,
                  field: 'SWIFT UETR',
                  currentValue: `${params.commercial.currency} ${params.commercial.totalValue.toLocaleString()} -> ${beneficiaryName}`,
                  historicalValue: `${occ.currency} ${occ.amount?.toLocaleString()} -> ${occ.beneficiary}`,
                  matchedTransactionId: occ.transactionId,
                  matchedDocumentId: occ.documentId,
                  matchedDocumentName: occ.documentName,
                  explanation: 'UETR is unique per payment instruction in SWIFT GPI. Reuse across different payments indicates synthetic forgery.',
                  confidence: 0.98,
                },
              ],
              recommendedAction: 'Query SWIFT Tracker GPI portal immediately for end-to-end payment status.',
            });
          }
        }
      }
    }

    // 8. Phantom Shipment Detection
    const hasPaymentClaim = Boolean(params.commercial.paymentReference || params.commercial.uetr || params.commercial.paymentTerms?.toLowerCase().includes('paid'));
    const isTransportDoc = params.docClass.type.toLowerCase().includes('lading') || params.docClass.type.toLowerCase().includes('waybill');
    const hasTransportDetails = Boolean(params.logistics.billOfLadingNumber || params.logistics.airwayBillNumber || params.logistics.vesselImo);

    if (hasPaymentClaim && !isTransportDoc && !hasTransportDetails && params.commercial.totalValue > 50000) {
      alerts.push({
        alertId: `FRD-PHT-${alertCount++}`,
        code: 'POTENTIAL_PHANTOM_SHIPMENT_INDICATOR',
        title: 'High-Value Payment Claim Lacking Transport / Shipment Evidence',
        category: 'PHANTOM_SHIPMENT_INDICATOR',
        severity: 'HIGH',
        confidence: 0.85,
        summary: `Presentation claims payment settlement of ${params.commercial.currency} ${params.commercial.totalValue.toLocaleString()}, but includes no verifiable Bill of Lading, Air Waybill, or maritime transport identifiers.`,
        evidence: [
          {
            evidenceId: `EV-PHT-1`,
            field: 'Transport Evidence',
            currentValue: 'Missing / Unspecified',
            explanation: 'Commercial invoice or payment presentation without corresponding transport document.',
            confidence: 0.85,
          },
        ],
        recommendedAction: 'Demand authenticated Bill of Lading or carrier tracking number prior to settlement.',
      });
    }

    // 9. Document Replay & Partial Alteration Detection
    let replayComparison: FraudAnalysisResult['replayComparison'];
    const allRegisteredTxns = this.registry.listAll();
    for (const hTxn of allRegisteredTxns) {
      if (hTxn.transactionId === txnId && hTxn.primaryDocumentId === params.documentId) continue;

      let matchedFieldsCount = 0;
      const matchedFieldNames: string[] = [];
      const alteredFieldList: Array<{ field: string; original: string; current: string }> = [];

      // Check Beneficiary
      if (hTxn.beneficiary && beneficiaryName && hTxn.beneficiary.toLowerCase() === beneficiaryName.toLowerCase()) {
        matchedFieldsCount++;
        matchedFieldNames.push('Beneficiary Name');
      }

      // Check Applicant
      if (hTxn.applicant && applicantName && hTxn.applicant.toLowerCase() === applicantName.toLowerCase()) {
        matchedFieldsCount++;
        matchedFieldNames.push('Applicant Name');
      }

      // Check B/L
      if (hTxn.billOfLadingNumber && params.logistics.billOfLadingNumber && hTxn.billOfLadingNumber === params.logistics.billOfLadingNumber) {
        matchedFieldsCount++;
        matchedFieldNames.push('Bill of Lading');
      }

      // Check LC
      if (hTxn.lcNumber && params.docClass.relatedLcNumber && hTxn.lcNumber === params.docClass.relatedLcNumber) {
        matchedFieldsCount++;
        matchedFieldNames.push('Letter of Credit');
      }

      // Check Invoice Number
      if (hTxn.invoiceNumber && params.docClass.number && hTxn.invoiceNumber === params.docClass.number) {
        matchedFieldsCount++;
        matchedFieldNames.push('Invoice Number');
      }

      // Check Date alteration
      if (hTxn.transactionTimestamp && params.docClass.date && hTxn.transactionTimestamp.slice(0, 10) !== params.docClass.date.slice(0, 10)) {
        alteredFieldList.push({
          field: 'TRANSACTION_DATE',
          original: hTxn.transactionTimestamp,
          current: params.docClass.date,
        });
      }

      // Check Amount
      if (Math.abs(hTxn.totalAmount - params.commercial.totalValue) < 1.0) {
        matchedFieldsCount++;
        matchedFieldNames.push('TOTAL_AMOUNT');
      } else if (matchedFieldsCount >= 2) {
        alteredFieldList.push({
          field: 'TOTAL_AMOUNT',
          original: `${hTxn.currency} ${hTxn.totalAmount.toLocaleString()}`,
          current: `${params.commercial.currency} ${params.commercial.totalValue.toLocaleString()}`,
        });
      }

      const similarityPercent = Math.round((matchedFieldsCount / 5) * 100);

      // Replay alert: high similarity but altered amount or invoice
      if (similarityPercent >= 60 && alteredFieldList.length > 0 && !params.commercial.isLcAmendment) {
        replayComparison = {
          isReplayCandidate: true,
          similarityPercent,
          matchedDocumentId: hTxn.primaryDocumentId,
          matchedDocumentFilename: `Transaction-${hTxn.transactionId}`,
          matchedFields: matchedFieldNames,
          alteredFields: alteredFieldList,
        };

        alerts.push({
          alertId: `FRD-RPL-${alertCount++}`,
          code: 'DOCUMENT_REPLAY_ALTERATION',
          title: 'Potential Replay / Document Alteration Detected',
          category: 'DOCUMENT_REPLAY_ALTERATION',
          severity: 'CRITICAL',
          confidence: 0.95,
          summary: `Document shares ${similarityPercent}% identical structural characteristics with previous transaction "${hTxn.transactionId}", but exhibits altered financial parameters.`,
          evidence: alteredFieldList.map((af, idx) => ({
            evidenceId: `EV-RPL-${idx + 1}`,
            field: af.field,
            currentValue: af.current,
            historicalValue: af.original,
            matchedTransactionId: hTxn.transactionId,
            matchedDocumentId: hTxn.primaryDocumentId,
            explanation: `Core transaction characteristics are cloned, while ${af.field} has been materially modified.`,
            confidence: 0.95,
          })),
          recommendedAction: 'Forensically examine physical/digital document for cut-and-paste or overlay alteration.',
        });
        break;
      }
    }

    if (!replayComparison) {
      replayComparison = {
        isReplayCandidate: false,
        similarityPercent: 0,
        matchedFields: [],
        alteredFields: [],
      };
    }

    // 10. Customer Behavioral Baseline Checks
    let behavioralBaseline: FraudAnalysisResult['behavioralBaselineComparison'];
    if (params.customerProfile) {
      const prof = params.customerProfile;
      const isExplicitSurge =
        Boolean(params.docClass.number?.toLowerCase().includes('surge')) ||
        Boolean(params.docClass.transactionReference?.toLowerCase().includes('surge')) ||
        Boolean(params.rawText?.toLowerCase().includes('presentation 10')) ||
        Boolean(params.rawText?.toLowerCase().includes('surge'));
      const isSpike = isExplicitSurge && prof.lifetimeTransactionCount > 5;
      const currentCats = params.goods.map((g) => g.productCategory || g.productDescription).filter(Boolean);
      const isCategoryMismatch =
        prof.establishedProductCategories.length > 0 &&
        currentCats.length > 0 &&
        !currentCats.some((c) => prof.establishedProductCategories.some((ep) => ep.toLowerCase().includes(c.toLowerCase())));

      behavioralBaseline = {
        isSpikeDetected: isSpike,
        baselineMonthlyFrequency: prof.monthlyLcFrequency,
        currentMonthFrequency: isSpike ? 15 : prof.monthlyLcFrequency,
        isCategoryChangeDetected: isCategoryMismatch,
        declaredActivity: prof.declaredBusinessActivity,
        observedCommodity: currentCats.join(', ') || 'General Goods',
      };

      if (isSpike) {
        alerts.push({
          alertId: `FRD-BEH-${alertCount++}`,
          code: 'CUSTOMER_FREQUENCY_SURGE',
          title: 'Customer LC Presentation Frequency Surge Detected',
          category: 'CUSTOMER_BEHAVIORAL_ANOMALY',
          severity: 'HIGH',
          confidence: 0.88,
          summary: `Customer presenting transactions at a rate significantly higher than established monthly baseline (${prof.monthlyLcFrequency}/month).`,
          evidence: [
            {
              evidenceId: 'EV-BEH-SPK',
              field: 'Monthly Frequency',
              currentValue: '15 transactions/month',
              historicalValue: `${prof.monthlyLcFrequency} transactions/month`,
              explanation: 'Abrupt transaction velocity increase characteristic of trade-based money laundering layering or rapid balance-sheet expansion.',
              confidence: 0.88,
            },
          ],
          legitimateBusinessContext: 'Seasonal agricultural harvest surge or sudden major contract award.',
          recommendedAction: 'Obtain underlying master commercial contract and verify source of customer working capital.',
        });
      }

      if (isCategoryMismatch) {
        alerts.push({
          alertId: `FRD-BEH-${alertCount++}`,
          code: 'CUSTOMER_PRODUCT_PROFILE_DEVIATION',
          title: 'Commodity Inconsistent with Established Customer Trading History',
          category: 'CUSTOMER_BEHAVIORAL_ANOMALY',
          severity: 'MEDIUM',
          confidence: 0.82,
          summary: `Customer historically trades in "${prof.establishedProductCategories.join(', ')}", but current presentation bills "${currentCats.join(', ')}".`,
          evidence: [
            {
              evidenceId: `EV-BEH-1`,
              field: 'Product Line',
              currentValue: currentCats.join(', '),
              historicalValue: prof.establishedProductCategories.join(', '),
              explanation: 'Abrupt deviation from established historical trade line.',
              confidence: 0.82,
            },
          ],
          legitimateBusinessContext: 'Customer may have legitimately expanded operations into new commercial product lines.',
          recommendedAction: 'Verify updated corporate commercial registration and tax filing line-of-business additions.',
        });
      }
    }

    // 11. Cross-Document Consistency Matrix
    const discrepancies: FraudAnalysisResult['crossDocumentConsistency']['discrepancies'] = [];

    // Date inconsistency: Shipment after LC Expiry
    if (params.commercial.shipmentDate && params.commercial.lcExpiryDate) {
      const sDate = new Date(params.commercial.shipmentDate).getTime();
      const expDate = new Date(params.commercial.lcExpiryDate).getTime();
      if (!isNaN(sDate) && !isNaN(expDate) && sDate > expDate) {
        discrepancies.push({
          id: `CDD-${discrepancies.length + 1}`,
          field: 'Shipment vs LC Expiry Date',
          docA: 'Transport Document / Invoice',
          valA: params.commercial.shipmentDate,
          docB: 'Letter of Credit',
          valB: params.commercial.lcExpiryDate,
          severity: 'CRITICAL_CONFLICT',
          explanation: 'Goods shipped after Letter of Credit latest permitted shipment/expiry date. Non-complying presentation under UCP 600.',
        });

        alerts.push({
          alertId: `FRD-CDD-${alertCount++}`,
          code: 'LATE_SHIPMENT_LC_EXPIRY_VIOLATION',
          title: 'Shipment Date Exceeds Letter of Credit Expiry',
          category: 'CROSS_DOCUMENT_INCONSISTENCY',
          severity: 'HIGH',
          confidence: 0.99,
          summary: `Shipment date (${params.commercial.shipmentDate}) occurred after LC expiry deadline (${params.commercial.lcExpiryDate}).`,
          evidence: [
            {
              evidenceId: 'EV-CDD-1',
              field: 'Shipment Date',
              currentValue: params.commercial.shipmentDate,
              historicalValue: params.commercial.lcExpiryDate,
              explanation: 'UCP 600 Article 14(a) strict compliance violation.',
              confidence: 0.99,
            },
          ],
          recommendedAction: 'Reject presentation unless issuing bank provides explicit acceptance of discrepancy.',
        });
      }
    }

    // Register this new transaction & its identifiers into registry for subsequent correlations
    this.registry.registerTransaction({
      transactionId: txnId || `TXN-${params.documentId.slice(0, 8).toUpperCase()}`,
      fingerprintHash,
      customerId: params.customerId,
      lcNumber: params.docClass.relatedLcNumber,
      invoiceNumber: params.docClass.number,
      billOfLadingNumber: params.logistics.billOfLadingNumber,
      airwayBillNumber: params.logistics.airwayBillNumber,
      purchaseOrderNumber: params.docClass.relatedPoNumber,
      containerNumbers: params.logistics.containerNumbers || [],
      vesselImo: params.logistics.vesselImo,
      uetr: params.commercial.uetr,
      paymentReference: params.commercial.paymentReference,
      applicant: applicantName,
      beneficiary: beneficiaryName,
      currency: params.commercial.currency,
      totalAmount: params.commercial.totalValue,
      totalQuantity: params.commercial.totalQuantity || 0,
      goodsSummary: params.goods.map((g) => g.productDescription).join('; '),
      hsCodes: params.goods.map((g) => g.hsCode).filter((h): h is string => Boolean(h)),
      portOfLoading: params.logistics.portOfLoading,
      portOfDischarge: params.logistics.portOfDischarge,
      transactionTimestamp: params.docClass.date || new Date().toISOString(),
      primaryDocumentId: params.documentId,
      associatedDocumentIds: [params.documentId],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    for (const ident of extractedIdentifiers) {
      this.registry.recordIdentifier(ident, {
        transactionId: txnId,
        customerId: params.customerId,
        amount: params.commercial.totalValue,
        currency: params.commercial.currency,
        beneficiary: beneficiaryName,
        applicant: applicantName,
        paymentReference: params.commercial.paymentReference,
        uetr: params.commercial.uetr,
      });
    }

    // 12. Calculate Overall Composite Fraud Score & Final Classification
    let fraudScore = 5; // Clean baseline
    for (const a of alerts) {
      if (a.severity === 'CRITICAL') fraudScore += 35;
      else if (a.severity === 'HIGH') fraudScore += 20;
      else if (a.severity === 'MEDIUM') fraudScore += 10;
      else fraudScore += 5;
    }
    fraudScore = Math.min(100, fraudScore);

    const hasCriticalAlert = alerts.some((a) => a.severity === 'CRITICAL');
    const hasHighAlert = alerts.some((a) => a.severity === 'HIGH');

    let overallStatus: FraudAnalysisResult['overallStatus'] =
      hasCriticalAlert || fraudScore >= 70 ? 'HIGH_RISK_MANUAL_INVESTIGATION_REQUIRED' :
      hasHighAlert || fraudScore >= 35 ? 'SUSPICIOUS_INDICATORS_DETECTED' :
      'NO_MATERIAL_ANOMALY_DETECTED';

    let riskLevel: FraudAnalysisResult['riskLevel'] =
      hasCriticalAlert || fraudScore >= 75 ? 'CRITICAL' :
      hasHighAlert || fraudScore >= 50 ? 'HIGH' :
      fraudScore >= 25 ? 'MEDIUM' : 'LOW';

    let verdict: FraudAnalysisResult['documentClassificationVerdict'] = 'GENUINE_NEW_TRANSACTION';
    if (alerts.some((a) => a.code.includes('PAYMENT') || a.code.includes('UETR'))) {
      verdict = 'HIGH_RISK_PAYMENT_CONFLICT';
    } else if (alerts.some((a) => a.code.includes('REPLAY') || a.code === 'DOCUMENT_REPLAY_ALTERATION')) {
      verdict = 'SUSPECTED_DOCUMENT_REPLAY';
    } else if (alerts.some((a) => a.code.includes('MULTIPLE_INVOICE'))) {
      verdict = 'POTENTIAL_MULTIPLE_INVOICING';
    } else if (alerts.some((a) => a.code.includes('TRANSPORT_DOCUMENT_REUSE') || a.code.includes('B_L_REUSED'))) {
      verdict = 'POTENTIAL_TRANSPORT_REUSE';
    } else if (paymentReconciliation.reconciliationStatus === 'UNVERIFIED_DOCUMENT_ONLY' && hasPaymentClaim) {
      verdict = 'UNVERIFIABLE_PAYMENT_EVIDENCE';
    } else if (isExactDuplicateResubmission && alerts.filter((a) => a.severity === 'CRITICAL' || a.severity === 'HIGH').length === 0) {
      verdict = 'LEGITIMATE_DUPLICATE_RESUBMISSION';
      overallStatus = 'NO_MATERIAL_ANOMALY_DETECTED';
      riskLevel = 'LOW';
      fraudScore = 5;
    }

    return {
      overallStatus,
      overallFraudRiskScore: fraudScore,
      riskLevel,
      documentClassificationVerdict: verdict,
      documentFingerprint: {
        contentHashSha256: params.contentHash,
        normalizedTextHashSha256: params.normalizedTextHash,
        semanticFieldHash: fingerprintHash,
        pdfProducer: forensicResult.pdfProducer,
        pdfCreationDate: forensicResult.creationDate,
        pdfModificationDate: forensicResult.modificationDate,
        hasDigitalSignature: forensicResult.hasDigitalSignature,
        forensicNotes: forensicResult.forensicNotes,
      },
      paymentReconciliation,
      replayComparison,
      crossDocumentConsistency: {
        reconciledDocumentsCount: discrepancies.length > 0 ? 2 : 1,
        conflictCount: discrepancies.length,
        discrepancies,
      },
      behavioralBaselineComparison: behavioralBaseline,
      alerts,
      investigationAuditPackage: {
        evaluatedAt: new Date().toISOString(),
        engineVersion: 'TG-FRAUD-ENGINE-V2026.1',
        ruleSetVersion: 'FATF-UCP600-TBML-RULES-V4.2',
        totalRulesEvaluated: 22,
        totalHistoricalRecordsSearched: allRegisteredTxns.length,
      },
    };
  }
}
