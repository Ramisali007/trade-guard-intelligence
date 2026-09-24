/**
 * TradeGuard Intelligence — Payment Authenticity & Reconciliation Service
 * Evaluates payment claims across an 8-tier verification hierarchy and reconciles
 * against authoritative bank payment messages (SWIFT GPI, MT103, pacs.008, bank statements).
 */

export type PaymentVerificationStrength =
  | 'TIER_1_INDEPENDENTLY_CONFIRMED'     // Direct core banking settlement / verified MT103/pacs.008
  | 'TIER_2_VERIFIED_SWIFT_MESSAGE'      // Validated SWIFT GPI UETR tracking confirmation
  | 'TIER_3_CORE_BANKING_STATEMENT'      // Reconciled against core banking ledger / MT940 / CAMT.053
  | 'TIER_3_IMPORTED_BANK_STATEMENT'     // Reconciled against uploaded MT940 / CAMT.053 ledger
  | 'TIER_4_INTERNAL_BANK_SYSTEM'        // Matched against internal AD / trade desk record
  | 'TIER_5_EXTERNAL_PAYMENT_TRACKING'   // Validated third-party payment tracker / correspondent feed
  | 'TIER_6_DOCUMENT_ONLY_UNVERIFIED'    // PDF states "Paid" but no authoritative settlement evidence exists
  | 'TIER_7_UNVERIFIABLE_PAYMENT'        // Conflicting, un-parseable, or missing payment details
  | 'TIER_8_CONTRADICTED_PAYMENT';       // Document claims "Settled", but authoritative banking record shows REJECTED/REVERSED

export interface ClaimedPaymentInfo {
  paymentReference?: string;
  uetr?: string;
  claimedAmount: number;
  claimedCurrency: string;
  claimedBeneficiary: string;
  claimedPayer?: string;
  claimedDate?: string;
  claimedStatusText?: string;
}

export interface AuthoritativePaymentRecord {
  paymentReference: string;
  uetr?: string;
  amount: number;
  currency: string;
  beneficiaryName: string;
  payerName: string;
  settlementStatus: 'SETTLED' | 'PENDING' | 'REJECTED' | 'REVERSED' | 'CANCELLED';
  settlementDate: string;
  sourceChannel: 'SWIFT_GPI' | 'CORE_BANKING' | 'BANK_STATEMENT_MT940' | 'FEDWIRE' | 'CHAPS';
  intermediaryBank?: string;
}

export interface PaymentReconciliationResult {
  uetr?: string;
  paymentReference?: string;
  claimedAmount: number;
  claimedCurrency: string;
  claimedBeneficiary: string;
  claimedDate?: string;
  verificationStrength: PaymentVerificationStrength;
  authoritativeAmount?: number;
  authoritativeCurrency?: string;
  authoritativeBeneficiary?: string;
  authoritativeStatus?: 'SETTLED' | 'PENDING' | 'REJECTED' | 'REVERSED' | 'CANCELLED' | 'UNKNOWN';
  reconciliationStatus:
    | 'RECONCILED_VERIFIED'
    | 'UNVERIFIED_DOCUMENT_ONLY'
    | 'MATERIAL_MISMATCH'
    | 'CONTRADICTED_PAYMENT'
    | 'NO_PAYMENT_CLAIMED';
  discrepancies: string[];
  investigationGuidance: string;
}

export class PaymentReconciliationService {
  private static instance: PaymentReconciliationService;

  // Authoritative payment store for reconciliation simulation & testing
  private readonly authoritativePayments = new Map<string, AuthoritativePaymentRecord>();

  private constructor() {}

  public static getInstance(): PaymentReconciliationService {
    if (!PaymentReconciliationService.instance) {
      PaymentReconciliationService.instance = new PaymentReconciliationService();
    }
    return PaymentReconciliationService.instance;
  }

  public clearAll(): void {
    this.authoritativePayments.clear();
  }

  /**
   * Registers authoritative payment records (e.g. from bank statements or SWIFT feeds).
   */
  public registerAuthoritativePayment(record: AuthoritativePaymentRecord): void {
    if (record.uetr) {
      this.authoritativePayments.set(`UETR:${record.uetr.toLowerCase()}`, record);
    }
    if (record.paymentReference) {
      this.authoritativePayments.set(`REF:${record.paymentReference.toUpperCase()}`, record);
    }
  }

  /**
   * Reconciles a document's extracted payment claim against authoritative banking records.
   */
  public reconcilePayment(claimed: ClaimedPaymentInfo): PaymentReconciliationResult {
    const discrepancies: string[] = [];

    const hasExplicitPaymentClaim = Boolean(
      claimed.paymentReference ||
      claimed.uetr ||
      claimed.claimedStatusText?.toLowerCase().includes('paid') ||
      claimed.claimedStatusText?.toLowerCase().includes('settled') ||
      claimed.claimedStatusText?.toLowerCase().includes('remitted') ||
      claimed.claimedStatusText?.toLowerCase().includes('received')
    );

    // Case 1: No settlement claimed in presentation (commercial invoice or forward trade terms)
    if (!hasExplicitPaymentClaim) {
      return {
        claimedAmount: claimed.claimedAmount || 0,
        claimedCurrency: claimed.claimedCurrency || 'USD',
        claimedBeneficiary: claimed.claimedBeneficiary || 'N/A',
        verificationStrength: 'TIER_6_DOCUMENT_ONLY_UNVERIFIED',
        reconciliationStatus: 'NO_PAYMENT_CLAIMED',
        discrepancies: [],
        investigationGuidance: 'Presentation reflects standard forward commercial terms or trade credit; no historical settlement claim declared.',
      };
    }

    // Attempt lookup in authoritative banking repository
    let authRecord: AuthoritativePaymentRecord | undefined;
    if (claimed.uetr) {
      authRecord = this.authoritativePayments.get(`UETR:${claimed.uetr.toLowerCase()}`);
    }
    if (!authRecord && claimed.paymentReference) {
      authRecord = this.authoritativePayments.get(`REF:${claimed.paymentReference.toUpperCase()}`);
    }

    // Case 2: No authoritative banking record found (Document-only evidence)
    if (!authRecord) {
      const guidance = claimed.claimedStatusText?.toLowerCase().includes('paid') || claimed.claimedStatusText?.toLowerCase().includes('settled')
        ? 'Document self-declares settlement, but payment cannot be independently confirmed against authoritative bank ledger or SWIFT messaging. Classify as unverified document claim.'
        : 'Payment details extracted from document. Awaiting independent bank statement or SWIFT MT103 confirmation.';

      return {
        uetr: claimed.uetr,
        paymentReference: claimed.paymentReference,
        claimedAmount: claimed.claimedAmount,
        claimedCurrency: claimed.claimedCurrency,
        claimedBeneficiary: claimed.claimedBeneficiary,
        claimedDate: claimed.claimedDate,
        verificationStrength: 'TIER_6_DOCUMENT_ONLY_UNVERIFIED',
        reconciliationStatus: 'UNVERIFIED_DOCUMENT_ONLY',
        discrepancies: ['No independent banking ledger or SWIFT record matches this payment claim.'],
        investigationGuidance: guidance,
      };
    }

    // Case 3: Authoritative record exists — Perform full forensic field reconciliation
    let strength: PaymentVerificationStrength = 'TIER_1_INDEPENDENTLY_CONFIRMED';
    if (authRecord.sourceChannel === 'SWIFT_GPI') strength = 'TIER_2_VERIFIED_SWIFT_MESSAGE';
    else if (authRecord.sourceChannel === 'CORE_BANKING' || authRecord.sourceChannel === 'BANK_STATEMENT_MT940') strength = 'TIER_3_CORE_BANKING_STATEMENT';
    else strength = 'TIER_4_INTERNAL_BANK_SYSTEM';

    // 1. Check Settlement Status Contradiction
    if (authRecord.settlementStatus === 'REJECTED' || authRecord.settlementStatus === 'REVERSED' || authRecord.settlementStatus === 'CANCELLED') {
      discrepancies.push(`Document claims completed settlement, but authoritative banking record confirms payment was ${authRecord.settlementStatus}.`);
      return {
        uetr: claimed.uetr,
        paymentReference: claimed.paymentReference,
        claimedAmount: claimed.claimedAmount,
        claimedCurrency: claimed.claimedCurrency,
        claimedBeneficiary: claimed.claimedBeneficiary,
        claimedDate: claimed.claimedDate,
        verificationStrength: 'TIER_8_CONTRADICTED_PAYMENT',
        authoritativeAmount: authRecord.amount,
        authoritativeCurrency: authRecord.currency,
        authoritativeBeneficiary: authRecord.beneficiaryName,
        authoritativeStatus: authRecord.settlementStatus,
        reconciliationStatus: 'CONTRADICTED_PAYMENT',
        discrepancies,
        investigationGuidance: `CRITICAL CONTRADICTION: Bank payment was explicitly ${authRecord.settlementStatus} on ${authRecord.settlementDate}. Re-presentation or document alteration suspect.`,
      };
    }

    // 2. Check Amount Variance
    if (Math.abs(claimed.claimedAmount - authRecord.amount) > 0.01) {
      discrepancies.push(`Claimed payment amount (${claimed.claimedCurrency} ${claimed.claimedAmount.toLocaleString()}) does not match authoritative settlement amount (${authRecord.currency} ${authRecord.amount.toLocaleString()}).`);
    }

    // 3. Check Currency Variance
    if (claimed.claimedCurrency && claimed.claimedCurrency.toUpperCase() !== authRecord.currency.toUpperCase()) {
      discrepancies.push(`Claimed currency (${claimed.claimedCurrency}) conflicts with settled currency (${authRecord.currency}).`);
    }

    // 4. Check Beneficiary Identity
    const cleanClaimedBen = (claimed.claimedBeneficiary || '').toLowerCase().replace(/[\s\-_.,]/g, '');
    const cleanAuthBen = authRecord.beneficiaryName.toLowerCase().replace(/[\s\-_.,]/g, '');
    if (cleanClaimedBen && cleanAuthBen && !cleanClaimedBen.includes(cleanAuthBen) && !cleanAuthBen.includes(cleanClaimedBen)) {
      discrepancies.push(`Payment beneficiary mismatch: Document designates "${claimed.claimedBeneficiary}", but bank funds were credited to "${authRecord.beneficiaryName}".`);
    }

    if (discrepancies.length > 0) {
      return {
        uetr: claimed.uetr,
        paymentReference: claimed.paymentReference,
        claimedAmount: claimed.claimedAmount,
        claimedCurrency: claimed.claimedCurrency,
        claimedBeneficiary: claimed.claimedBeneficiary,
        claimedDate: claimed.claimedDate,
        verificationStrength: 'TIER_8_CONTRADICTED_PAYMENT',
        authoritativeAmount: authRecord.amount,
        authoritativeCurrency: authRecord.currency,
        authoritativeBeneficiary: authRecord.beneficiaryName,
        authoritativeStatus: authRecord.settlementStatus,
        reconciliationStatus: 'MATERIAL_MISMATCH',
        discrepancies,
        investigationGuidance: 'HIGH-RISK PAYMENT CONFLICT: Payment identifier matches an existing banking transaction but with materially conflicting amount or beneficiary. Hold transaction for manual trade desk verification.',
      };
    }

    // All fields match authoritative record flawlessly
    return {
      uetr: claimed.uetr,
      paymentReference: claimed.paymentReference,
      claimedAmount: claimed.claimedAmount,
      claimedCurrency: claimed.claimedCurrency,
      claimedBeneficiary: claimed.claimedBeneficiary,
      claimedDate: claimed.claimedDate,
      verificationStrength: strength,
      authoritativeAmount: authRecord.amount,
      authoritativeCurrency: authRecord.currency,
      authoritativeBeneficiary: authRecord.beneficiaryName,
      authoritativeStatus: authRecord.settlementStatus,
      reconciliationStatus: 'RECONCILED_VERIFIED',
      discrepancies: [],
      investigationGuidance: `Payment independently confirmed via ${authRecord.sourceChannel} on ${authRecord.settlementDate}. All commercial details reconcile 100%.`,
    };
  }

  /**
   * Resets authoritative payments store (for testing).
   */
  public resetForTesting(): void {
    this.authoritativePayments.clear();
  }
}
