import type { FindingSeverity } from '../trade-cases/trade-case.types';

/**
 * The shared language of external verification. One claim in a customer's document is compared with
 * what an outside source says, and the outcome is one of these states. Two rules hold throughout:
 *
 *  - "No issue found" is not "verified". VERIFIED is used only when an authoritative source was
 *    consulted and the claim matches its record; CONSISTENT means the evidence that was available does
 *    not contradict the claim, and says what the evidence was.
 *  - Missing data is never a clean result. A source that was down, stale or silent produces
 *    SOURCE_UNAVAILABLE or INSUFFICIENT_EVIDENCE, and the run lists what could not be checked.
 */
export const VERIFICATION_STATUSES = [
  'VERIFIED', // an authoritative record was found and matches the claim
  'CONSISTENT', // available evidence does not contradict the claim (limits stated)
  'DISCREPANCY', // the claim differs from the authoritative record
  'POTENTIALLY_RESTRICTED',
  'POTENTIAL_SANCTIONS_MATCH',
  'POTENTIAL_PRICING_ANOMALY',
  'INSUFFICIENT_EVIDENCE', // nothing checkable, or the description is too thin to judge
  'SOURCE_UNAVAILABLE', // the source could not be read, or is older than its freshness limit allows
  'HISTORICAL_STATUS_UNAVAILABLE',
  'HUMAN_REVIEW_REQUIRED',
  'NOT_APPLICABLE',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** The statuses that need a person to look; the rest are recorded in the run but do not raise a finding. */
export const RAISES_FINDING: ReadonlySet<VerificationStatus> = new Set([
  'DISCREPANCY',
  'POTENTIALLY_RESTRICTED',
  'POTENTIAL_SANCTIONS_MATCH',
  'POTENTIAL_PRICING_ANOMALY',
  'INSUFFICIENT_EVIDENCE',
  'SOURCE_UNAVAILABLE',
  'HISTORICAL_STATUS_UNAVAILABLE',
  'HUMAN_REVIEW_REQUIRED',
]);

export type VerificationModule = 'HS_CLASSIFICATION' | 'PORT_IDENTITY' | 'VESSEL_IDENTITY';

/** A piece of what an external source says, kept so an officer can reproduce the reasoning. */
export interface VerificationEvidence {
  sourceId: string;
  sourceName: string;
  /** The record in the source (for the HS reference: the heading or subheading code). */
  recordId: string;
  /** The source's own words for the record. */
  excerpt: string;
  url: string;
  retrievedAt: string;
  publishedOn: string | null;
  effectiveFrom: string | null;
  /** SHA-256 of the retrieved source file, so the exact version consulted can be identified. */
  contentHash: string;
  /** The publisher's own version marker for the file (an ETag, an edition or a dataset version), when it gave one. */
  datasetVersion: string | null;
  /** Where the data came from and who owns it, in one line (distributor, owner of the nomenclature). */
  lineage: string;
  /** Real source evidence, a built-in seed, or a synthetic test fixture. Reports must keep these apart. */
  origin: 'LIVE_SOURCE' | 'BANK_SUPPLIED' | 'SEED' | 'SYNTHETIC_TEST';
  /** True when the source is older than its freshness limit; the result is then not presented as current. */
  stale: boolean;
}

/** Where in a customer document the claim was read. */
export interface ClaimRef {
  documentId: string;
  filename: string;
  documentType: string;
  field: string;
  extractedValue: string;
  page: number | null;
  /** The version of the document on the case, so a result is tied to the exact file that was read. */
  documentVersion?: number | null;
  /** The value after normalisation (an HS code reduced to its digits). */
  normalizedValue?: string | null;
  /** How sure the extraction was. Per document (the classification confidence), not per field: the extractor gives no finer figure. */
  extractionConfidence?: number | null;
  /** The words around the value in the document, to find it on the page. */
  snippet?: string | null;
}

export interface ClaimVerification {
  /** Stable across re-runs for the same claim, so a reviewer's decision on it survives. */
  subject: string;
  module: VerificationModule;
  status: VerificationStatus;
  severity: FindingSeverity;
  /** Policy default for this outcome. A finding is blocking only where the rule says so. */
  blocking: boolean;
  humanReviewRequired: boolean;
  /** Whether the customer can act on it (confirm a code, send specifications). Officer-only outcomes are never put to the customer. */
  customerFixable: boolean;
  ruleId: string;
  title: string;
  explanation: string;
  /** What the document declared, and what the source says. */
  declared: string;
  retrieved: string | null;
  claims: ClaimRef[];
  evidence: VerificationEvidence[];
  /** The AI second opinion this result rests on, kept so an unchanged claim is not sent to the model again. */
  secondOpinion?: { key: string; verdict: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNCLEAR'; reason: string; referenceHash: string; at: string };
  /** What this result does not establish. Always shown with the result. */
  limitations: string[];
  assessedAt: string;
  /** The transaction milestone the assessment is dated to (the application date unless stated). */
  transactionDate: string | null;
}

export type ModuleState = 'COMPLETE' | 'PARTIAL' | 'NOT_RUN' | 'SOURCE_UNAVAILABLE';

export interface ModuleRun {
  module: VerificationModule;
  state: ModuleState;
  claimsChecked: number;
  sourcesConsulted: string[];
  /** AI second opinions asked for in this run, and how many were reused from the previous run (unchanged claim, same reference). */
  aiSecondOpinions?: { asked: number; reused: number };
  /** In plain words: what this module did not or could not check. Empty only when everything was. */
  notChecked: string[];
}

/** One verification pass over a case: what was checked, against what, and what could not be. */
export interface VerificationRun {
  runId: string;
  startedAt: string;
  finishedAt: string;
  modules: ModuleRun[];
  results: ClaimVerification[];
}

/** What the case keeps of a run in its validation record (the results themselves become findings). */
export interface VerificationRunSummary {
  runId: string;
  finishedAt: string;
  modules: ModuleRun[];
  /** Every result, clean ones included, so the screen can show what was checked and found consistent. */
  results: ClaimVerification[];
}

/** ADAPTER_READY: the code and the approval workflow exist; it is operational only once the bank has supplied and approved a dataset. */
export type IntegrationState = 'OPERATIONAL' | 'EXISTING_ENGINE' | 'ADAPTER_READY' | 'NOT_INTEGRATED';

/** One external source, with the terms it comes under. */
export interface ExternalSourceEntry {
  sourceId: string;
  name: string;
  publisher: string;
  category: 'TARIFF_CLASSIFICATION' | 'SANCTIONS' | 'REFERENCE_DATA' | 'PRICE_REFERENCE' | 'FOREIGN_EXCHANGE' | 'TRADE_POLICY' | 'MARITIME' | 'PORTS' | 'REGULATION';
  authority: 'OFFICIAL_INTERGOVERNMENTAL' | 'OFFICIAL_NATIONAL' | 'LICENSED_PROVIDER' | 'OFFICIAL_BANK_SUPPLIED' | 'OPEN_DATA' | 'WEB_SCRAPE';
  jurisdiction: string;
  subjects: string[];
  url: string;
  /** Hosts the platform may fetch this source from; nothing else is ever requested for it. */
  allowedHosts: string[];
  retrieval: 'PUBLIC_DOWNLOAD' | 'PUBLIC_API' | 'LICENSED_FEED' | 'BANK_SUPPLIED_FILE' | 'MANUAL';
  authRequired: boolean;
  licence: string;
  updateCadence: string;
  /** How old the data may be before a result built on it is no longer presented as current. */
  maxAgeHours: number | null;
  rateLimit: string;
  owner: string;
  integration: IntegrationState;
  /** Who owns the data and how it reaches the platform (for example: the WCO owns the nomenclature, the UN distributes a file). */
  lineage: string;
  /** What it does not cover. */
  gaps: string[];
}

/** The runtime state of a source, beside its catalogue entry. */
export interface SourceHealth {
  sourceId: string;
  lastSuccessfulRetrievalAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  recordCount: number | null;
  contentHash: string | null;
  /** The publisher's version marker for what is loaded, and the date the publisher last changed the file. */
  datasetVersion?: string | null;
  publishedOn?: string | null;
  state: 'CURRENT' | 'STALE' | 'UNAVAILABLE' | 'NOT_LOADED' | 'NOT_INTEGRATED';
  /** Where the data in memory came from. */
  origin: 'NETWORK' | 'LOCAL_CACHE' | 'TEST_FIXTURE' | 'SEED' | 'LIVE_FEED' | 'MANUAL_IMPORT' | null;
}
