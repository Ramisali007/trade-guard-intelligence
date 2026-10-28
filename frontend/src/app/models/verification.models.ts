import type { ExternalSourceEntry } from './trade-case.models';

/** What the verification governance screen shows: the rules, the bank's decision on each, and the sources. */

export type RuleApprovalStatus = 'PENDING_BANK_SIGN_OFF' | 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'REVOKED';

export interface GovernanceActor {
  id: string;
  name: string;
  role: string;
}

export interface RuleApprovalState {
  ruleId: string;
  version: string;
  status: RuleApprovalStatus;
  proposedBy: GovernanceActor | null;
  proposedAt: string | null;
  decidedBy: GovernanceActor | null;
  decidedAt: string | null;
  rationale: string;
}

export interface RuleEnforcement {
  ruleId: string;
  version: string;
  approval: RuleApprovalStatus;
  mode: 'ENFORCED' | 'DEMO_ENFORCED' | 'SHADOW';
  mayBlock: boolean;
  label: string;
}

export interface VerificationRuleView {
  rule: {
    ruleId: string;
    version: string;
    name: string;
    description: string;
    jurisdiction: string;
    sourceId: string;
    sourceReference: string;
    interpretationStatus: string;
    defaultSeverity: string;
    workflowAction: string;
    tests: string[];
    applicability?: { basis: string; appliesTo: string; doesNotEstablish: string };
  };
  approval: RuleApprovalState;
  enforcement: RuleEnforcement;
  history: Array<{ seq: number; at: string; event: string; by: GovernanceActor; rationale: string }>;
}

export interface SourceHealthView {
  sourceId: string;
  lastSuccessfulRetrievalAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  recordCount: number | null;
  contentHash: string | null;
  datasetVersion?: string | null;
  publishedOn?: string | null;
  state: 'CURRENT' | 'STALE' | 'UNAVAILABLE' | 'NOT_LOADED' | 'NOT_INTEGRATED';
  origin: string | null;
}

export interface VerificationOverview {
  ruleSetVersion: string;
  policy: { unapprovedRuleMode: 'DEMO_ENFORCE' | 'SHADOW'; mandatorySources: string[]; note: string };
  governanceIntegrity: { valid: boolean; problem: string | null; entries: number };
  rules: VerificationRuleView[];
  sources: { catalogue: ExternalSourceEntry[]; health: SourceHealthView[] };
}

export interface PctDatasetView {
  datasetId: string;
  version: string;
  publisher: string;
  sourceReference: string;
  publicationDate: string | null;
  licenceNote: string;
  origin: 'BANK_SUPPLIED' | 'SYNTHETIC_TEST';
  scope: 'FULL_TARIFF' | 'EXTRACT';
  contentHash: string;
  ingestedAt: string;
  ingestedBy: GovernanceActor;
  lineCount: number;
  coverageFrom: string;
  coverageTo: string | null;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RETIRED';
  decidedBy: GovernanceActor | null;
  decidedAt: string | null;
  rationale: string;
}
