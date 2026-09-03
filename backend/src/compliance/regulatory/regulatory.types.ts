/**
 * Product Regulatory & Bitemporal Trade Policy Intelligence Types
 */

export type ProductRestrictionStatus =
  | 'PERMITTED'             // Unrestricted commercial import/export
  | 'RESTRICTED'            // Importable under specific statutory conditions / quotas
  | 'LICENSED'              // Requires formal ministry / defense / SBP / EPA import license
  | 'SPECIAL_CONDITIONS'    // Pre-shipment inspection, lab certificate, cold-chain required
  | 'PROHIBITED'            // Statutorily banned under Import/Export Policy Orders
  | 'UNKNOWN';              // Insufficient official statutory gazette data

export type BitemporalRegulatoryStatus =
  | 'ACTIVE_AT_TRANSACTION_DATE'
  | 'NOT_ACTIVE_AT_TRANSACTION_DATE'
  | 'ADDED_AFTER_TRANSACTION'
  | 'EXPIRED_BEFORE_TRANSACTION'
  | 'UNKNOWN_DUE_TO_MISSING_HISTORICAL_DATA';

export interface StatutoryLegalInstrument {
  instrumentId: string;
  authority: string;                  // e.g. 'Ministry of Commerce / FBR / Pakistan Customs'
  instrumentType: 'IMPORT_POLICY_ORDER' | 'SRO_NOTIFICATION' | 'EXPORT_POLICY_ORDER' | 'CUSTOMS_ACT' | 'TRADE_DIRECTIVE';
  referenceNumber: string;            // e.g. 'S.R.O. 543(I)/2022' or 'IPO 2022 Appendix B'
  title: string;
  effectiveDate: string;              // Valid time start
  expiryDate?: string;                // Valid time end (if temporary)
  ingestedAt: string;                 // System time
  sourceUrl: string;
  sourceAuthorityLevel: 'LEVEL_1_OFFICIAL_REGULATOR' | 'LEVEL_2_INTERGOVERNMENTAL';
}

export interface PakistanTradePolicyAssessment {
  isSubjectToImportPolicyOrder: boolean;
  ipoAppendixClassification?: 'APPENDIX_A_BANNED' | 'APPENDIX_B_RESTRICTED' | 'APPENDIX_C_HEALTH_SAFETY' | 'STANDARD_FREE_LIST';
  requiresSpecialAuthorization: boolean;
  requiredPermits: string[];
  customsTariffChapter?: string;
  applicableSro?: string;
  originSpecificRule?: {
    originCountry: string;
    isRestrictedOrigin: boolean;
    statutoryBasis: string;
    exceptionsApplicable: string[];
    isExemptedForThisTransaction: boolean;
  };
  statutoryVerdict: ProductRestrictionStatus;
  summaryExplanation: string;
}

export interface ProductRegulatoryIntelligenceResult {
  lineItemId: string;
  itemNumber: number;
  productDescription: string;
  hsCode?: string;
  countryOfOrigin: string;
  destinationCountry: string;
  transactionDate: string;

  // Bitemporal Position
  temporalStatus: BitemporalRegulatoryStatus;
  restrictionStatusAtTransactionDate: ProductRestrictionStatus;
  currentRestrictionStatus: ProductRestrictionStatus;

  // Pakistan-Specific Trade Policy Assessment
  pakistanAssessment?: PakistanTradePolicyAssessment;

  // Multilateral / Export Control Intersection
  dualUseClassification?: string;
  licenseRequirement?: string;

  // Statutory Provenance
  governingInstruments: StatutoryLegalInstrument[];
  regulatoryExplanation: string;
  confidence: 'HIGH' | 'MODERATE' | 'LOW';
  limitations: string[];
}
