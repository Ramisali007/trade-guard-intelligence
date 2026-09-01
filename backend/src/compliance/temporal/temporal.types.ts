/**
 * Point-in-Time Compliance, Temporal Sanctions & Audit Evidence Types
 * Aligned with FATF, OFAC, UN, EU, UK, and SBP (State Bank of Pakistan) Regulatory Standards.
 */

export type TemporalSanctionsStatus =
  | 'NOT_LISTED_AT_TRANSACTION_TIME'
  | 'LISTED_AT_TRANSACTION_TIME'
  | 'ADDED_AFTER_TRANSACTION'
  | 'REMOVED_BEFORE_TRANSACTION'
  | 'REMOVED_AFTER_TRANSACTION'
  | 'STATUS_UNKNOWN'
  | 'HISTORICAL_DATA_INSUFFICIENT'
  | 'UNDER_REVIEW';

export type JurisdictionalApplicabilityStatus =
  | 'LEGALLY_APPLICABLE'
  | 'POTENTIALLY_APPLICABLE'
  | 'INTERNAL_POLICY_ONLY'
  | 'NOT_APPLICABLE'
  | 'JURISDICTION_UNKNOWN';

export type EnterpriseDecisionState =
  | 'CLEAR'
  | 'ALLOW_WITH_CONTROLS'
  | 'REVIEW'
  | 'ENHANCED_DUE_DILIGENCE'
  | 'LICENSE_REQUIRED'
  | 'ESCALATE_SANCTIONS'
  | 'ESCALATE_EXPORT_CONTROL'
  | 'BLOCK'
  | 'INSUFFICIENT_EVIDENCE';

export type SourceHealthState = 'HEALTHY' | 'STALE' | 'DEGRADED' | 'FAILED' | 'UNKNOWN';

export type DataQualityState =
  | 'VERIFIED'
  | 'PROBABLE'
  | 'POSSIBLE'
  | 'UNVERIFIED'
  | 'STALE'
  | 'CONFLICTING'
  | 'INSUFFICIENT_DATA';

export interface AuthoritativeSourceMetadata {
  sourceId: string;
  sourceName: string;
  jurisdiction: 'US' | 'UN' | 'EU' | 'UK' | 'PK' | 'GLOBAL';
  regulatoryAuthority: string;
  sourceUrl: string;
  sourceType: 'API' | 'DATASET_FEED' | 'XML_FEED' | 'OFFICIAL_GAZETTE' | 'REGULATORY_CIRCULAR';
  datasetType: 'SDN' | 'CONSOLIDATED_LIST' | 'SANCTIONS_LIST' | 'TFS_LIST' | 'EXPORT_CONTROL_CCL';
  currentVersion: string;
  publishedAt: string;
  retrievedAt: string;
  effectiveAt: string;
  checksumSha256: string;
  recordCount: number;
  healthStatus: SourceHealthState;
  lastSyncError?: string;
  nextScheduledSyncAt: string;
}

export interface SanctionEntityTemporalRecord {
  id: string;
  primaryName: string;
  aliases: string[];
  entityType: 'INDIVIDUAL' | 'ENTITY' | 'BANK' | 'VESSEL' | 'AIRCRAFT';
  jurisdiction: 'US' | 'UN' | 'EU' | 'UK' | 'PK';
  sanctionsList: string;
  programs: string[];
  country?: string;
  addresses?: string[];
  identifiers?: {
    swiftBic?: string;
    imoNumber?: string;
    taxVatNumber?: string;
    registrationNumber?: string;
    passportNumber?: string;
    nationalId?: string;
  };
  designationDate: string; // ISO timestamp
  effectiveDate: string;   // ISO timestamp
  removalDate?: string | null; // ISO timestamp if delisted
  legalAuthority: string;
  measures: string[];
  remarks: string;
  sourceSnapshotId: string;
}

export interface TemporalSanctionsMatch {
  matchId: string;
  matchedEntityId: string;
  matchedName: string;
  searchedName: string;
  partyRole: string;
  matchType: 'EXACT_MATCH' | 'HIGH_CONFIDENCE_MATCH' | 'POSSIBLE_MATCH' | 'IDENTIFIER_MATCH';
  matchConfidence: number; // 0 - 1.0
  sanctionsList: string;
  jurisdiction: 'US' | 'UN' | 'EU' | 'UK' | 'PK';
  programs: string[];
  
  // Point-in-time temporal evaluation
  transactionTimestamp: string;
  designationDate: string;
  effectiveDate: string;
  removalDate?: string | null;
  temporalStatus: TemporalSanctionsStatus;
  
  isCurrentlyListed: boolean;
  wasListedAtTransactionTime: boolean;
  
  legalExplanation: string;
  recommendedAction: string;
  sourceSnapshotId: string;
  sourceChecksum: string;
}

export interface JurisdictionalNexusAssessment {
  jurisdiction: 'US' | 'UN' | 'EU' | 'UK' | 'PK';
  regimeName: string;
  applicability: JurisdictionalApplicabilityStatus;
  nexusBasis: string[];
  reason: string;
  mandatoryLegalEffect: boolean;
  applicableAuthorities: string[];
}

export interface SBPComplianceAssessment {
  regime: 'SBP_PAKISTAN_FRAMEWORK';
  frameworkVersion: string;
  authorizedDealerChecks: {
    tfsMandatoryScreening: boolean;
    tbmlRiskRating: 'LOW' | 'MEDIUM' | 'HIGH' | 'PROHIBITED';
    feManualChapter12Compliant: boolean;
    eFormValidation: 'VERIFIED' | 'MISSING' | 'DISCREPANT' | 'EXEMPT';
    customerProfileConsistency: boolean;
  };
  triggeredSbpCirculars: Array<{
    circularRef: string;
    title: string;
    requirement: string;
    complianceStatus: 'COMPLIANT' | 'NON_COMPLIANT' | 'FURTHER_INQUIRY_REQUIRED';
  }>;
  overallSbpVerdict: 'COMPLIANT' | 'FURTHER_DUE_DILIGENCE' | 'REPORTABLE_EXCEPTION' | 'REJECT';
  explanation: string;
}

export interface TemporalOwnershipNode {
  id: string;
  name: string;
  country?: string;
  isSanctioned: boolean;
  sanctionProgram?: string;
  designationDate?: string;
}

export interface TemporalOwnershipEdge {
  ownerId: string;
  ownerName: string;
  targetId: string;
  targetName: string;
  ownershipPercentage: number;
  controlType: 'DIRECT_EQUITY' | 'INDIRECT_EQUITY' | 'VOTING_RIGHTS' | 'BOARD_CONTROL' | 'DOMINANT_INFLUENCE';
  effectiveFrom: string;
  effectiveTo?: string | null;
  source: string;
  confidence: number;
}

export interface OwnershipComplianceResult {
  targetEntityName: string;
  evaluatedAt: string;
  aggregateBlockedOwnershipPercentage: number;
  isBlockedUnderOfac50PercentRule: boolean;
  isBlockedUnderEuUkControlRule: boolean;
  blockingOwners: Array<{
    ownerName: string;
    ownershipPercentage: number;
    sanctionsProgram: string;
    designationDate: string;
  }>;
  explanation: string;
}

export interface RetrospectiveAlert {
  alertId: string;
  transactionId: string;
  tradeReference: string;
  transactionTimestamp: string;
  detectedAt: string;
  newlyDesignatedEntityName: string;
  partyRoleInTransaction: string;
  sanctionsList: string;
  designationDate: string;
  effectiveDate: string;
  retrospectiveImpact: 'NEW_EXPOSURE_IDENTIFIED' | 'POST_TRANSACTION_DESIGNATION_MONITORING';
  recommendedAction: string;
  status: 'PENDING_REVIEW' | 'REVIEWED_ACKNOWLEDGED' | 'ESCALATED';
}

export interface AuditEvidencePackage {
  evidencePackageId: string;
  transactionId: string;
  tradeReference: string;
  transactionTimestamp: string;
  generatedAt: string;
  
  // Tamper-evident cryptographic hashes
  documentSha256: string;
  transactionHashSha256: string;
  regulatorySnapshotsUsed: Array<{
    sourceId: string;
    version: string;
    checksumSha256: string;
    effectiveAt: string;
  }>;
  ruleSetVersion: string;
  scoringModelVersion: string;
  aiPromptVersion: string;
  
  // Signature & seal
  verificationDigestSha256: string;
  examinerSeal: {
    status: EnterpriseDecisionState;
    certifiedAt: string;
    examinerName?: string;
    examinerRole?: string;
  };
  limitations: string[];
}
