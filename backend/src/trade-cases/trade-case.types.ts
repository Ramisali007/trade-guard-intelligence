import type { BankingRole } from '../middleware/auth.middleware';
import type { VerificationRunSummary } from '../verification/verification.types';

/**
 * The trade case: one import transaction from the customer's request to case closure.
 *
 * It links, by identifier, to the documents the existing post-trade pipeline already stores and
 * analyses (`DocumentRecord`). Nothing here copies that pipeline's output wholesale; findings lift
 * the parts a reviewer has to act on and point back at the document for the rest.
 */

/** Only import LCs are implemented end to end; other payment modes need their own rules first. */
export type TransactionType = 'IMPORT_LC';

export const CASE_STATUSES = [
  'DRAFT',
  'UNDER_REVIEW',
  'PENDING_CUSTOMER_CLARIFICATION',
  'APPROVAL_PENDING',
  'AUTHORIZED_FOR_ISSUANCE',
  'LC_ISSUED',
  'DOCUMENT_EXAMINATION',
  'DISCREPANCY_RESOLUTION',
  'AWAITING_SETTLEMENT',
  'SETTLED_MONITORING',
  'UNDER_INVESTIGATION',
  'CLOSED',
  'REJECTED',
  'WITHDRAWN',
  'CANCELLED',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const DEPARTMENTS = ['RM', 'TRADE_OPS', 'COMPLIANCE', 'CREDIT'] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const PRE_TRADE_DOCUMENT_TYPES = [
  'PROFORMA_INVOICE',
  'LC_APPLICATION_FORM',
  'PURCHASE_CONTRACT',
  'PURCHASE_ORDER',
  'IMPORT_PERMIT',
  'OTHER_SUPPORTING',
] as const;
export const PRESENTATION_DOCUMENT_TYPES = [
  'COMMERCIAL_INVOICE',
  'BILL_OF_LADING',
  'PACKING_LIST',
  'INSURANCE_DOCUMENT',
  'CERTIFICATE_OF_ORIGIN',
  'INSPECTION_CERTIFICATE',
  /** Anything else the transaction needs presented (a weight or quality certificate, a beneficiary's certificate). */
  'OTHER_SUPPORTING',
] as const;
export type PreTradeDocumentType = (typeof PRE_TRADE_DOCUMENT_TYPES)[number];
export type PresentationDocumentType = (typeof PRESENTATION_DOCUMENT_TYPES)[number];
export type CaseDocumentType = PreTradeDocumentType | PresentationDocumentType;

export interface ActorRef {
  id: string;
  name: string;
  role: BankingRole;
}

export interface PartyDetails {
  name: string;
  address: string;
  country: string;
}

/**
 * The transaction details as the customer states them. An absent value is `''` or `null` — never a
 * default that would look like data.
 */
export interface LcApplicationData {
  applicant: PartyDetails;
  beneficiary: PartyDetails;
  purpose: string;
  proformaInvoiceNumber: string;
  currency: string;
  amount: number | null;
  /** UCP 600 art. 30(a): "about"/"approximately" allows 10%; zero unless the credit says so. */
  amountTolerancePercent: number;
  goodsDescription: string;
  hsCode: string;
  quantity: number | null;
  unitOfMeasure: string;
  unitPrice: number | null;
  incoterm: string;
  namedPlace: string;
  countryOfOrigin: string;
  portOfLoading: string;
  portOfDischarge: string;
  partialShipments: 'ALLOWED' | 'NOT_ALLOWED' | '';
  transshipment: 'ALLOWED' | 'NOT_ALLOWED' | '';
  latestShipmentDate: string | null;
  expiryDate: string | null;
  /** Days after shipment within which documents must be presented (UCP 600 art. 14(c) default 21). */
  presentationPeriodDays: number;
  paymentTerms: 'SIGHT' | 'USANCE' | '';
  usanceDays: number | null;
  requiredDocuments: PresentationDocumentType[];
}

export interface ApplicationVersion {
  version: number;
  createdAt: string;
  /** 'SYSTEM' for the version that filled blank fields from the analyzed documents. */
  createdBy: ActorRef | 'SYSTEM';
  reason: string;
  data: LcApplicationData;
  /** Field paths that differ from the previous version. */
  changedFields: string[];
}

export interface CaseDocument {
  linkId: string;
  /** The `DocumentRecord` id in the existing document store. */
  documentId: string;
  documentType: CaseDocumentType;
  stage: 'PRE_TRADE' | 'POST_TRADE';
  /** Version within this document type on this case, from 1. */
  version: number;
  filename: string;
  uploadedAt: string;
  uploadedBy: ActorRef;
  /** Set when a later upload of the same type replaced this one; the record itself stays. */
  supersededByLinkId: string | null;
  presentationId: string | null;
  /** True when the upload was byte-identical to a document already in the store. */
  duplicateUpload: boolean;
  /**
   * Set to null when the customer added this document after the request was first sent, until they send it to the bank.
   * Absent on every other document (it reached the bank with the request or the reply, or the bank itself attached it).
   */
  sentToBankAt?: string | null;
  /** Who chose the document type: the AI that read it, the customer who corrected it, or nobody (the AI was unavailable). */
  typeSource?: 'AI' | 'CUSTOMER' | 'UNDETECTED';
  /** What the AI made of the document when it was uploaded. */
  detection?: Classification | null;
  /** Why the document could not be recognized (the AI was unavailable), when that is the case. */
  detectionError?: string | null;
}

// ---------------------------------------------------------------- AI scrutiny records

export type IssueCategory = 'MISSING_INFORMATION' | 'DATA_INCONSISTENCY' | 'DOCUMENT_QUALITY' | 'LC_TERM_ISSUE' | 'REGULATORY_CONCERN' | 'COMPLIANCE_ALERT';

/** One thing the AI found wrong or missing in a document, or between documents. */
export interface AiIssue {
  code: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: IssueCategory;
  title: string;
  description: string;
  /** Exact words from the document, or empty. */
  evidence: string;
  /** The rule or source behind the issue, only when it was given to the model; else empty. */
  regulation: string;
  /** What the customer must send or correct; empty for a bank-only issue. */
  customerAction: string;
  documentsInvolved: string[];
  /** For a difference between documents: the words quoted from each, each checked against that document's text. */
  quotes?: Array<{ file: string; text: string }>;
  /** The application fields the issue is about (the names the rules use), so the same point is not listed twice. */
  fields?: string[];
}

/** A point the AI raised that was not used because the words it quoted are not in the documents. */
export interface DiscardedIssue {
  title: string;
  description: string;
  reason: string;
}

/** What the AI made of a document when it was uploaded. */
export interface Classification {
  /** One of the pre-trade types, UNKNOWN, or SHIPPING_DOCUMENT for a document that belongs to the post-shipment stage. */
  type: PreTradeDocumentType | 'UNKNOWN' | 'SHIPPING_DOCUMENT';
  confidence: number;
  title: string;
  reason: string;
  model: string;
  at: string;
}

/** The AI's review of one document against the checklist for its kind. */
export interface DocumentReview {
  documentType: PreTradeDocumentType;
  filename: string;
  summary: string;
  present: string[];
  missing: string[];
  notCheckable: string[];
  issues: AiIssue[];
  /** Points the AI raised that were left out because they could not be matched to the document text. */
  discarded?: DiscardedIssue[];
  model: string;
  at: string;
}

/** The AI's review of the current documents against each other. */
export interface CaseReview {
  summary: string;
  issues: AiIssue[];
  notCheckable: string[];
  discarded?: DiscardedIssue[];
  /** The documents it covered; a review of a different set is out of date and is not used. */
  documentIds: string[];
  model: string;
  at: string;
}

export interface ScrutinyStep {
  linkId: string;
  documentId: string;
  filename: string;
  documentType: CaseDocumentType;
  status: 'PENDING' | 'READING' | 'REVIEWING' | 'DONE' | 'FAILED';
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** One run of the AI scrutiny over the current documents, one document at a time. Kept with the case. */
export interface ScrutinyRun {
  runId: string;
  startedBy: ActorRef;
  startedAt: string;
  finishedAt: string | null;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  steps: ScrutinyStep[];
  caseReview: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';
  error: string | null;
}

export const FINDING_CATEGORIES = [
  'MISSING_INFORMATION',
  'DATA_INCONSISTENCY',
  'DOCUMENT_QUALITY',
  'LC_TERM_ISSUE',
  'REGULATORY_CONCERN',
  'CREDIT_BLOCKER',
  'COMPLIANCE_ALERT',
  'TBML_RED_FLAG',
  'LOW_CONFIDENCE_EXTRACTION',
  'OPERATIONAL',
  'DOCUMENTARY_DISCREPANCY',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];
export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/** How a finding came about — kept so an AI suspicion is never mistaken for a checked fact. */
export type FindingOrigin =
  | 'DETERMINISTIC_RULE'
  | 'SANCTIONS_ENGINE'
  | 'TBML_ENGINE'
  | 'FRAUD_ENGINE'
  | 'AI_ASSISTED_EXTRACTION'
  | 'EXTERNAL_VERIFICATION'
  | 'REVIEWER';

export interface Evidence {
  source: 'APPLICATION' | 'DOCUMENT' | 'SCREENING' | 'CASE_HISTORY' | 'POLICY' | 'EXTERNAL_SOURCE';
  label: string;
  value: string;
  documentId?: string;
  filename?: string;
  /** Page the value was found on in the document's extracted text, when it could be located. */
  pageNumber?: number;
  snippet?: string;
  applicationVersion?: number;
}

export type FindingStatus = 'OPEN' | 'RESOLVED' | 'DISPOSITIONED';

export type FindingDispositionCode =
  | 'VERIFIED_MANUALLY'
  | 'JUSTIFIED'
  | 'CHECKPOINT_CONFIRMED'
  | 'FALSE_POSITIVE'
  | 'RISK_ACCEPTED'
  | 'CONFIRMED_ESCALATED'
  | 'DISCREPANCY_WAIVED'
  | 'DISCREPANCY_UPHELD';

export interface FindingHistoryEntry {
  at: string;
  actor: ActorRef | 'SYSTEM';
  event:
    | 'RAISED'
    | 'RE_EVALUATED'
    | 'RESOLVED_BY_REVALIDATION'
    | 'NO_LONGER_TRIGGERED_AWAITING_DISPOSITION'
    | 'REOPENED'
    | 'DISPOSITIONED'
    | 'APPLICANT_WAIVER';
  detail: string;
}

export interface Finding {
  findingId: string;
  /** External verification only: the customer can act on this point. Officer-only outcomes are never shown or mailed to the customer. */
  customerFixable?: boolean;
  /** Stable identity across revalidations: rule id plus the field or subject it concerns. */
  key: string;
  ruleId: string;
  ruleVersion: string;
  stage: 'PRE_TRADE' | 'POST_TRADE' | 'AMENDMENT';
  category: FindingCategory;
  severity: FindingSeverity;
  /** Blocks approval, presentation acceptance or closure while open. */
  blocking: boolean;
  title: string;
  description: string;
  fields: string[];
  observed: Evidence[];
  expected: string;
  /** 0–1, only where it means something (an extraction or a name match). */
  confidence: number | null;
  origin: FindingOrigin;
  recommendedAction: string;
  ownerDepartment: Department;
  status: FindingStatus;
  disposition: {
    code: FindingDispositionCode;
    rationale: string;
    by: ActorRef;
    at: string;
  } | null;
  /** Post-trade discrepancies: the applicant's own decision on waiving it (UCP 600 art. 16(b)). */
  applicantWaiver: { accepted: boolean; by: ActorRef; at: string; note: string } | null;
  presentationId: string | null;
  /** Set for findings raised by an amendment's revalidation. */
  amendmentId: string | null;
  raisedAt: string;
  lastEvaluatedAt: string;
  applicationVersion: number;
  history: FindingHistoryEntry[];
}

export type ReviewStatus = 'NOT_REQUIRED' | 'PENDING' | 'RE_REVIEW_REQUIRED' | 'APPROVED' | 'RETURNED' | 'ON_HOLD' | 'REJECT_RECOMMENDED';

export interface CreditFacilityVerification {
  facilityReference: string;
  availableLimit: number;
  currency: string;
  marginPercent: number;
  /**
   * Where the figure came from. No core-banking integration exists, so the only honest values are a
   * figure an officer verified by hand, or sandbox data that must never be read as a real limit.
   */
  verificationSource: 'MANUAL_OFFICER_VERIFIED' | 'SANDBOX_DEMO_DATA';
  verifiedBy: ActorRef;
  verifiedAt: string;
  note: string;
}

export interface Review {
  department: Department;
  required: boolean;
  status: ReviewStatus;
  checklist: Record<string, { checked: boolean; by: ActorRef; at: string }>;
  decidedBy: ActorRef | null;
  decidedAt: string | null;
  rationale: string;
  /** Which application version the decision was made on; a later version needs a fresh decision. */
  applicationVersion: number | null;
  history: Array<{ at: string; actor: ActorRef | 'SYSTEM'; status: ReviewStatus; note: string }>;
}

export type QueryAssignee = 'CUSTOMER' | Department;

export interface CaseQuery {
  queryId: string;
  findingIds: string[];
  raisedBy: ActorRef;
  raisedAt: string;
  department: Department;
  assignee: QueryAssignee;
  /** The subject line when the query is sent as a message to the customer (one mail for all issues). */
  subject?: string;
  question: string;
  requiresCorrection: boolean;
  status: 'OPEN' | 'ANSWERED' | 'RESOLVED';
  responses: Array<{
    by: ActorRef;
    at: string;
    text: string;
    applicationVersion: number | null;
    documentLinkIds: string[];
  }>;
  resolution: { by: ActorRef; at: string; rationale: string } | null;
  reopenedCount: number;
}

export interface ApprovalRecord {
  approvalId: string;
  requestedBy: ActorRef;
  requestedAt: string;
  applicationVersion: number;
  /** Digest of the findings as they stood when approval was requested, so a later change is visible. */
  findingsDigest: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'INVALIDATED';
  decidedBy: ActorRef | null;
  decidedAt: string | null;
  rationale: string;
}

export interface IssuedLc {
  lcNumber: string;
  /** No SWIFT channel is integrated; a sandbox issuance is labeled as such everywhere. */
  mode: 'SANDBOX';
  adapter: string;
  issuedAt: string;
  issuedBy: ActorRef;
  approvalId: string;
  applicationVersion: number;
  /** The terms as originally issued. Never changed. */
  terms: LcApplicationData;
  /** The terms in force now: the original, or as last amended with the beneficiary's acceptance. */
  effectiveTerms: LcApplicationData;
  /** 0 for the original issue; n once amendment n became effective. */
  effectiveAmendmentNumber: number;
  financialInstrument: { number: string; expiryDate: string };
  adapterMessage: string;
}

export type AmendmentStatus =
  | 'UNDER_REVIEW'
  | 'APPROVAL_PENDING'
  | 'APPROVED'
  | 'ISSUED_AWAITING_BENEFICIARY'
  | 'EFFECTIVE'
  | 'REJECTED'
  | 'BENEFICIARY_REFUSED';

export interface Amendment {
  amendmentId: string;
  number: number;
  status: AmendmentStatus;
  reason: string;
  requestedBy: ActorRef;
  requestedAt: string;
  /** The terms this amendment was raised against (amendment number in force at the time). */
  baseAmendmentNumber: number;
  changes: Partial<LcApplicationData>;
  proposedTerms: LcApplicationData;
  changedFields: string[];
  reviews: Partial<Record<Department, { status: 'PENDING' | 'APPROVED' | 'REJECTED'; by: ActorRef | null; at: string | null; rationale: string }>>;
  submittedBy: ActorRef | null;
  submittedAt: string | null;
  decision: { decision: 'APPROVED' | 'REJECTED'; by: ActorRef; at: string; rationale: string } | null;
  issuance: { reference: string; mode: 'SANDBOX'; by: ActorRef; at: string; message: string; financialInstrumentExpiry: string } | null;
  beneficiaryResponse: { accepted: boolean; by: ActorRef; at: string; note: string } | null;
}

/**
 * The credit a presentation is examined against: the issued credit with its amendments when one is recorded,
 * otherwise the pre-shipment application the bank approved. Every examination says which.
 */
export interface CreditOfRecord {
  reference: string;
  basis: 'ISSUED_CREDIT' | 'APPROVED_APPLICATION';
  terms: LcApplicationData;
  applicationVersion: number;
}

export interface Presentation {
  presentationId: string;
  /** The post-shipment application reference: the case number and the application number ("TC-2026-00012/P1"). */
  reference?: string;
  /** Started by the client in their portal, or recorded by the bank from documents it received. Absent on older records (bank). */
  origin?: 'CLIENT' | 'BANK';
  /** DRAFT: the client is still preparing it and the bank does not see it. SUBMITTED: with the bank. Absent: recorded by the bank. */
  applicationStatus?: 'DRAFT' | 'SUBMITTED';
  submittedAt?: string | null;
  submittedBy?: ActorRef | null;
  /** The status the case returns to if the presentation is refused, so a re-presentation is possible. */
  returnStatus?: CaseStatus;
  /** What the examination ran against. */
  termsBasis?: CreditOfRecord['basis'];
  /** The last AI-assisted reading of the documents: advice for the examiner, never a decision. */
  aiReview?: { summary: string; at: string; model: string; raised: number; leftOut: number } | null;
  receivedAt: string;
  recordedBy: ActorRef;
  documentLinkIds: string[];
  examination: {
    examinedAt: string;
    examinedBy: ActorRef;
    result: 'COMPLYING' | 'DISCREPANT';
    findingIds: string[];
    ruleSetVersion: string;
  } | null;
  decision: { decision: 'ACCEPTED' | 'REFUSED'; by: ActorRef; at: string; rationale: string } | null;
}

export interface SettlementRecord {
  /** Recording only: no payment is initiated by this platform. */
  mode: 'SANDBOX' | 'MANUAL_RECORD';
  amount: number;
  currency: string;
  valueDate: string;
  reference: string;
  recordedBy: ActorRef;
  recordedAt: string;
  note: string;
}

export interface Investigation {
  investigationId: string;
  openedBy: ActorRef;
  /** Investigator responsible; the opener unless reassigned. */
  assignedTo: ActorRef;
  openedAt: string;
  reason: string;
  findingIds: string[];
  /** Status to return to when the investigation closes. */
  resumeStatus: CaseStatus;
  closedBy: ActorRef | null;
  closedAt: string | null;
  outcome: 'NO_FURTHER_ACTION' | 'MONITORING_CONTINUED' | 'REPORTED_EXTERNALLY_RECORDED' | null;
  rationale: string;
}

export interface StatusChange {
  from: CaseStatus | null;
  to: CaseStatus;
  at: string;
  actor: ActorRef | 'SYSTEM';
  reason: string;
}

export interface ScreeningSummary {
  screenedAt: string;
  datasetVersion: string;
  /** The parties and countries that were checked: what the screening covered, not only what it found. */
  parties: Array<{ role: string; name: string; country: string }>;
  jurisdictions: Array<{ nodeRole: string; countryName: string; sanctionsStatus: string }>;
  matchCount: number;
  /** Set when the screening could not run; the case is then NOT treated as screened. */
  error: string | null;
}

/** One stored rendering of the host payload PDF. A version is never changed; a new rendering is a new version. */
export interface HostPayloadVersion {
  version: number;
  generatedAt: string;
  /** SHA-256 of the PDF bytes, so the copy the host holds can be shown to be the copy the bank stored. */
  sha256: string;
  sizeBytes: number;
  filename: string;
  /** True once the document carries the host (TI) reference, i.e. it was rendered when the payload was sent. */
  includesTiReference: boolean;
}

export interface HostDeliveryAttempt {
  at: string;
  by: ActorRef;
  /** RECORDED_ONLY: no host endpoint is configured, so the payload and its link were recorded for the host to fetch. HTTP: posted to the configured endpoint. */
  mode: 'RECORDED_ONLY' | 'HTTP';
  ok: boolean;
  httpStatus: number | null;
  message: string;
}

export interface HostPayloadMeta {
  /** The case number: the payload has no number of its own. */
  payloadId: string;
  status: 'GENERATED' | 'SENT_TO_HOST' | 'DELIVERY_FAILED';
  generatedAt: string;
  generatedBy: ActorRef | 'SYSTEM';
  currentVersion: number;
  versions: HostPayloadVersion[];
  /** Created when the payload is sent to the host, once, and never changed or reused. */
  tiReference: { reference: string; createdAt: string; createdBy: ActorRef } | null;
  deliveries: HostDeliveryAttempt[];
  lastSentAt: string | null;
}

export interface TradeCase {
  caseId: string;
  /** Incremented on every write; the repository refuses a stale write. */
  revision: number;
  transactionType: TransactionType;
  customerRef: string;
  /** Client-chosen key for idempotent creation: the same key returns the same case. */
  clientRequestId: string | null;
  status: CaseStatus;
  statusHistory: StatusChange[];
  applicationVersions: ApplicationVersion[];
  currentApplicationVersion: number;
  documents: CaseDocument[];
  findings: Finding[];
  reviews: Record<Department, Review>;
  queries: CaseQuery[];
  approvals: ApprovalRecord[];
  creditFacility: CreditFacilityVerification | null;
  issuedLc: IssuedLc | null;
  presentations: Presentation[];
  settlement: SettlementRecord | null;
  investigations: Investigation[];
  amendments: Amendment[];
  /**
   * Assigned when the pre-shipment request is approved and never changed: the key that joins the approval, the
   * approved documents, the post-shipment application and its decision. Derived from the case id, so it is unique
   * without a second counter and can be recomputed for a case approved before this field existed.
   */
  preShipmentReference?: { reference: string; assignedAt: string; assignedBy: ActorRef | 'SYSTEM' } | null;
  /**
   * The host payload: the PDF the bank's host system is given when a pre-shipment request is approved, and what became of it.
   * The bytes and the access token live in the host-payload store; this is the part the case itself keeps and shows.
   */
  hostPayload?: HostPayloadMeta | null;
  /**
   * Users who cleared this case from their own list while it stood approved. A display choice only: the case, its
   * documents and its audit trail are untouched, and it reappears if the case moves on from the approved state.
   */
  historyClearedBy?: Array<{ userId: string; at: string }>;
  /**
   * Head of this case's audit chain, written with the case itself. A log that ends before it (events
   * deleted) or beyond it is reported by verification; the log alone cannot detect truncation.
   */
  auditHead: { seq: number; hash: string } | null;
  validation: {
    lastRunAt: string | null;
    ruleSetVersion: string;
    /** Where the PI's structured fields came from on the last run. */
    piExtractionSource: 'AI_MODEL' | 'DETERMINISTIC_PARSER' | 'DETERMINISTIC_FALLBACK_AFTER_AI_FAILURE' | 'UNKNOWN_LEGACY_ANALYSIS' | 'NOT_AVAILABLE';
    piDocumentId: string | null;
    /** The application amount in PKR at the last run, or null when no rate was available. */
    amountInPkr: number | null;
    /** What party and jurisdiction screening covered on the last run, clear results included. */
    screening?: ScreeningSummary | null;
    /** The last external verification run: what was checked against which source, clean results included. */
    externalVerification?: VerificationRunSummary | null;
  };
  /** The application version the customer first submitted; material changes are measured from it. */
  submittedApplicationVersion: number | null;
  createdBy: ActorRef;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  closedAt: string | null;
  sequences: { finding: number; query: number; document: number; approval: number; presentation: number; investigation: number; amendment?: number };
  /** The AI's review of each document, by document id. */
  aiReviews?: Record<string, DocumentReview>;
  /** The AI's review of the current documents against each other. */
  caseReview?: CaseReview | null;
  /** The latest AI scrutiny run and its per-document progress. */
  scrutinyRun?: ScrutinyRun | null;
}

/**
 * What every list, queue and count needs of a case: the whole case except the bulky results of the AI review and the
 * screening runs (about 70% of a stored case, and read only on the case's own page). Lists are loaded without them, and
 * because the type leaves them out the compiler stops list code from reading what was not loaded. A full `TradeCase` is
 * a `CaseHeader`, so the same helpers serve both.
 */
export type CaseHeader = Omit<TradeCase, 'aiReviews' | 'caseReview' | 'scrutinyRun' | 'validation'> & {
  validation: Omit<TradeCase['validation'], 'screening' | 'externalVerification'>;
};

/** The same exclusions as a database projection (a field set to 0 is left out). */
export const CASE_HEADER_PROJECTION = {
  _id: 0,
  aiReviews: 0,
  caseReview: 0,
  scrutinyRun: 0,
  'validation.screening': 0,
  'validation.externalVerification': 0,
} as const;

/** One entry in the case's append-only, hash-chained audit log. */
export interface TradeCaseEvent {
  eventId: string;
  caseId: string;
  seq: number;
  at: string;
  actor: ActorRef | { id: 'system'; name: string; role: 'SYSTEM' };
  action: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus | null;
  detail: Record<string, unknown>;
  ruleSetVersion: string;
  prevHash: string;
  /** Hash scheme of this entry; absent means plain SHA-256 (chains written before the audit key existed). */
  alg?: 'hmac-sha256';
  hash: string;
}
