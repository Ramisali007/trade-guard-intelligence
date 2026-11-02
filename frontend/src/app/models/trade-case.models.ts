/** The trade case as the API returns it (already filtered for the signed-in role). */

export type CaseStatus =
  | 'DRAFT'
  | 'UNDER_REVIEW'
  | 'PENDING_CUSTOMER_CLARIFICATION'
  | 'APPROVAL_PENDING'
  | 'AUTHORIZED_FOR_ISSUANCE'
  | 'LC_ISSUED'
  | 'DOCUMENT_EXAMINATION'
  | 'DISCREPANCY_RESOLUTION'
  | 'AWAITING_SETTLEMENT'
  | 'SETTLED_MONITORING'
  | 'UNDER_INVESTIGATION'
  | 'CLOSED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'CANCELLED';

export type Department = 'RM' | 'TRADE_OPS' | 'COMPLIANCE' | 'CREDIT';
export const DEPARTMENTS: Department[] = ['RM', 'TRADE_OPS', 'COMPLIANCE', 'CREDIT'];

export const PRE_TRADE_DOCUMENT_TYPES = ['PROFORMA_INVOICE', 'LC_APPLICATION_FORM', 'PURCHASE_CONTRACT', 'PURCHASE_ORDER', 'IMPORT_PERMIT', 'OTHER_SUPPORTING'] as const;
export const PRESENTATION_DOCUMENT_TYPES = ['COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'PACKING_LIST', 'INSURANCE_DOCUMENT', 'CERTIFICATE_OF_ORIGIN', 'INSPECTION_CERTIFICATE', 'OTHER_SUPPORTING'] as const;
export type PresentationDocumentType = (typeof PRESENTATION_DOCUMENT_TYPES)[number];

export interface ActorRef {
  id: string;
  name: string;
  role: string;
}

export interface PartyDetails {
  name: string;
  address: string;
  country: string;
}

export interface LcApplicationData {
  applicant: PartyDetails;
  beneficiary: PartyDetails;
  purpose: string;
  proformaInvoiceNumber: string;
  currency: string;
  amount: number | null;
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
  presentationPeriodDays: number;
  paymentTerms: 'SIGHT' | 'USANCE' | '';
  usanceDays: number | null;
  requiredDocuments: PresentationDocumentType[];
}

export interface ApplicationVersion {
  version: number;
  createdAt: string;
  createdBy: ActorRef | 'SYSTEM';
  reason: string;
  data: LcApplicationData;
  changedFields: string[];
}

export interface CaseDocument {
  linkId: string;
  documentId: string;
  documentType: string;
  stage: 'PRE_TRADE' | 'POST_TRADE';
  version: number;
  filename: string;
  uploadedAt: string;
  uploadedBy: ActorRef;
  supersededByLinkId: string | null;
  presentationId: string | null;
  duplicateUpload: boolean;
  /** null: the customer added it after sending the request and has not sent it to the bank yet. Absent: it has reached the bank. */
  sentToBankAt?: string | null;
  /** Who chose the type: the AI that read the document, the customer who corrected it, or nobody (the AI was unavailable). */
  typeSource?: 'AI' | 'CUSTOMER' | 'UNDETECTED';
  /** What the AI made of the document when it was uploaded. */
  detection?: DocumentDetection | null;
  detectionError?: string | null;
}

export interface DocumentDetection {
  /** A pre-trade type, UNKNOWN, or SHIPPING_DOCUMENT for something that belongs to the later stage. */
  type: string;
  confidence: number;
  title: string;
  reason: string;
  model: string;
  at: string;
}

export interface AiIssue {
  code: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  title: string;
  description: string;
  evidence: string;
  regulation: string;
  customerAction: string;
  documentsInvolved: string[];
  quotes?: Array<{ file: string; text: string }>;
}

/** A point the AI raised that was left out because the words it quoted are not in the documents. */
export interface DiscardedAiPoint {
  title: string;
  description: string;
  reason: string;
}

export interface AiDocumentReview {
  summary: string;
  present: string[];
  missing: string[];
  notCheckable: string[];
  issues: AiIssue[];
  /** Bank-only issues the viewer may not read. */
  withheld: number;
  discarded?: DiscardedAiPoint[];
  model: string;
  at: string;
}

export interface ScrutinyStep {
  linkId: string;
  documentId: string;
  filename: string;
  documentType: string;
  status: 'PENDING' | 'READING' | 'REVIEWING' | 'DONE' | 'FAILED';
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ScrutinyRun {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  steps: ScrutinyStep[];
  caseReview: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';
  error: string | null;
}

export interface Evidence {
  source: 'APPLICATION' | 'DOCUMENT' | 'SCREENING' | 'CASE_HISTORY' | 'POLICY' | 'EXTERNAL_SOURCE';
  label: string;
  value: string;
  documentId?: string;
  filename?: string;
  pageNumber?: number;
  snippet?: string;
  applicationVersion?: number;
}

export interface Finding {
  findingId: string;
  key: string;
  ruleId: string;
  ruleVersion: string;
  stage: 'PRE_TRADE' | 'POST_TRADE' | 'AMENDMENT';
  category: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  blocking: boolean;
  title: string;
  description: string;
  fields: string[];
  observed: Evidence[];
  expected: string;
  confidence: number | null;
  origin: string;
  recommendedAction: string;
  ownerDepartment: Department;
  status: 'OPEN' | 'RESOLVED' | 'DISPOSITIONED';
  disposition: { code: string; rationale: string; by: ActorRef; at: string } | null;
  applicantWaiver: { accepted: boolean; by: ActorRef; at: string; note: string } | null;
  presentationId: string | null;
  /** Set on findings raised by revalidating an amendment. */
  amendmentId?: string | null;
  raisedAt: string;
  lastEvaluatedAt: string;
  applicationVersion: number;
  history: Array<{ at: string; actor: ActorRef | 'SYSTEM'; event: string; detail: string }>;
}

export type ScrutinyRuleStatus = 'FLAGGED' | 'REVIEWED' | 'PASSED' | 'NOT_CHECKED' | 'NOT_APPLICABLE' | 'MANUAL';

export interface ScrutinyRule {
  ruleId: string;
  name: string;
  description: string;
  group: string;
  source: string;
  jurisdiction: string;
  status: ScrutinyRuleStatus;
  /** Why the rule could not be judged (not checked / not applicable / manual). */
  reason: string | null;
  openFindings: number;
  totalFindings: number;
}

interface ScrutinyParty {
  legalName?: string;
  address?: string;
  country?: string;
}

/** The pre-shipment scrutiny report of one case (GET /trade-cases/:id/scrutiny). */
export type VerificationStatus =
  | 'VERIFIED'
  | 'CONSISTENT'
  | 'DISCREPANCY'
  | 'POTENTIALLY_RESTRICTED'
  | 'POTENTIAL_SANCTIONS_MATCH'
  | 'POTENTIAL_PRICING_ANOMALY'
  | 'INSUFFICIENT_EVIDENCE'
  | 'SOURCE_UNAVAILABLE'
  | 'HISTORICAL_STATUS_UNAVAILABLE'
  | 'HUMAN_REVIEW_REQUIRED'
  | 'NOT_APPLICABLE';

export interface VerificationEvidence {
  sourceId: string;
  sourceName: string;
  recordId: string;
  excerpt: string;
  url: string;
  retrievedAt: string;
  contentHash: string;
  stale: boolean;
}

export interface ClaimVerification {
  subject: string;
  module: string;
  status: VerificationStatus;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  blocking: boolean;
  humanReviewRequired: boolean;
  ruleId: string;
  title: string;
  explanation: string;
  declared: string;
  retrieved: string | null;
  claims: Array<{ documentId: string; filename: string; documentType: string; field: string; extractedValue: string; page: number | null }>;
  evidence: VerificationEvidence[];
  limitations: string[];
  assessedAt: string;
  transactionDate: string | null;
}

export interface VerificationModuleRun {
  module: string;
  state: 'COMPLETE' | 'PARTIAL' | 'NOT_RUN' | 'SOURCE_UNAVAILABLE';
  claimsChecked: number;
  sourcesConsulted: string[];
  notChecked: string[];
}

export interface ExternalSourceEntry {
  /** Where the data came from and who owns it. */
  lineage?: string;
  sourceId: string;
  name: string;
  publisher: string;
  authority: string;
  jurisdiction: string;
  licence: string;
  updateCadence: string;
  owner: string;
  integration: 'OPERATIONAL' | 'EXISTING_ENGINE' | 'ADAPTER_READY' | 'NOT_INTEGRATED';
  gaps: string[];
}

export interface ExternalVerificationView {
  rules?: Record<string, { mode: 'ENFORCED' | 'DEMO_ENFORCED' | 'SHADOW'; mayBlock: boolean; label: string }>;
  lastRun: { runId: string; finishedAt: string; modules: VerificationModuleRun[]; results: ClaimVerification[] } | null;
  sources: { catalogue: ExternalSourceEntry[]; health: Array<{ sourceId: string; state: string; lastSuccessfulRetrievalAt: string | null; lastError: string | null; recordCount: number | null; origin: string | null }> };
}

export interface ScrutinyReport {
  /** Checks against official sources; null for a viewer who may not read them. */
  externalVerification: ExternalVerificationView | null;
  caseId: string;
  status: CaseStatus;
  customerRef: string;
  generatedAt: string;
  intakeMode: string | null;
  lastValidatedAt: string | null;
  ruleSetVersion: string;
  extractionSource: string;
  documents: Array<{
    linkId: string;
    documentId: string;
    documentType: string;
    version: number;
    filename: string;
    uploadedAt: string;
    active: boolean;
    analysisStatus: string;
    progress: number | null;
    error: string | null;
    extractionSource: string | null;
    typeSource: 'AI' | 'CUSTOMER' | 'UNDETECTED' | null;
    detection: DocumentDetection | null;
    detectionError: string | null;
    review: AiDocumentReview | null;
    step: ScrutinyStep | null;
  }>;
  pendingAnalysis: number;
  /** Whether a model is required for the scrutiny (the built-in parser is never used in its place). */
  aiRequired: boolean;
  run: ScrutinyRun | null;
  /** The AI's comparison of the current documents with each other. */
  comparison: { summary: string; issues: AiIssue[]; withheld: number; notCheckable: string[]; discarded?: DiscardedAiPoint[]; model: string; at: string; current: boolean } | null;
  extracted: {
    filename: string | null;
    number: string | null;
    date: string | null;
    seller: ScrutinyParty | null;
    buyer: ScrutinyParty | null;
    currency: string | null;
    totalValue: number | null;
    incoterm: string | null;
    paymentTerms: string | null;
    originCountry: string | null;
    destinationCountry: string | null;
    portOfLoading: string | null;
    portOfDischarge: string | null;
    goods: Array<{ description: string; hsCode: string | null; quantity: number; unit: string; unitPrice: number; total: number; origin: string | null }>;
    arithmetic: { sound: boolean; notes: string[] };
  } | null;
  applicationVersion: number;
  missing: Array<{ path: string; label: string }>;
  rules: ScrutinyRule[];
  screening: {
    application: {
      screenedAt: string;
      datasetVersion: string;
      parties: Array<{ role: string; name: string; country: string }>;
      jurisdictions: Array<{ nodeRole: string; countryName: string; sanctionsStatus: string }>;
      matchCount: number;
      error: string | null;
    } | null;
    document: {
      status: string;
      riskScore: number;
      matches: Array<{ subject: string; role: string; matched: string; list: string; program: string | null; type: string; confidence: number }>;
      jurisdictions: Array<{ role: string; country: string; status: string; description: string }>;
      screenedEntities: number;
      screenedCountries: number;
      unscreenedNames: string[];
      datasetVersion: string;
      screenedAt: string;
    } | null;
  };
  analysis: {
    exportControls: { status: string | null; goods: Array<{ item: string; category: string; reason: string; licence: string; severity: string }>; concerns: string[] };
    tbml: { level: string | null; score: number | null; redFlags: Array<{ category: string; severity: string; title: string; description: string; evidence: string }> };
    sbp: { verdict: string; explanation: string; circulars: Array<{ ref: string; title: string; requirement: string; status: string }> } | null;
  } | null;
  findings: Finding[];
  /** What this user may do to a finding on this case now. */
  viewer: { canDisposition: boolean; canDispositionCompliance: boolean };
  /** Whether this user may approve now, what stands in the way, and the approval once given. */
  approval: { canApprove: boolean; blockers: string[]; approved: { by: string; at: string | null; rationale: string } | null };
  /** The messages sent to the customer, and what came back. */
  mails: Array<{
    queryId: string;
    subject: string | null;
    raisedAt: string;
    raisedBy: string;
    status: 'OPEN' | 'ANSWERED' | 'RESOLVED';
    findingIds: string[];
    replies: Array<{ by: string; at: string; text: string; documents: string[] }>;
  }>;
  counts: { documents: number; rulesChecked: number; rulesTotal: number; rulesFlagged: number; openFindings: number; blocking: number; missing: number };
}

/** A drafted message to the customer (POST /trade-cases/:id/queries/compose). */
export interface ComposedMail {
  caseId: string;
  subject: string;
  body: string;
  issues: Array<{ findingId: string; ruleId: string; title: string; severity: string; text: string; alreadyAsked: boolean }>;
  available: Array<{ findingId: string; title: string; severity: string; alreadyAsked: boolean }>;
  /** Open findings kept out of the message (compliance, credit, operational). */
  withheld: number;
  /** Who wrote the text: the AI, or a plain template because the AI was unavailable. */
  drafted: 'AI' | 'TEMPLATE' | 'NONE';
  model: string | null;
  aiError: string | null;
}

export interface Review {
  department: Department;
  required: boolean;
  status: string;
  checklist?: Record<string, { checked: boolean; by: ActorRef; at: string }>;
  decidedBy?: ActorRef | null;
  decidedAt?: string | null;
  rationale?: string;
  applicationVersion?: number | null;
  history?: Array<{ at: string; actor: ActorRef | 'SYSTEM'; status: string; note: string }>;
}

export interface CaseQuery {
  queryId: string;
  findingIds: string[];
  raisedBy: ActorRef;
  raisedAt: string;
  department: Department;
  assignee: 'CUSTOMER' | Department;
  /** Set when the query is a message to the customer listing every issue at once. */
  subject?: string;
  question: string;
  requiresCorrection: boolean;
  status: 'OPEN' | 'ANSWERED' | 'RESOLVED';
  responses: Array<{ by: ActorRef; at: string; text: string; applicationVersion: number | null; documentLinkIds: string[] }>;
  resolution: { by: ActorRef; at: string; rationale: string } | null;
  reopenedCount: number;
}

export interface ChecklistItem {
  itemId: string;
  label: string;
  ruleId: string | null;
}

export interface ApprovalRecord {
  approvalId: string;
  requestedBy: ActorRef;
  requestedAt: string;
  applicationVersion: number;
  status: string;
  decidedBy: ActorRef | null;
  decidedAt: string | null;
  rationale: string;
}

export interface IssuedLc {
  lcNumber: string;
  mode: 'SANDBOX';
  adapter: string;
  issuedAt: string;
  issuedBy: ActorRef;
  approvalId: string;
  applicationVersion: number;
  terms: LcApplicationData;
  /** The terms in force: the issued terms with every accepted amendment applied. */
  effectiveTerms?: LcApplicationData;
  effectiveAmendmentNumber?: number;
  financialInstrument: { number: string; expiryDate: string };
  adapterMessage: string;
}

export type AmendmentStatus =
  | 'UNDER_REVIEW'
  | 'APPROVAL_PENDING'
  | 'APPROVED'
  | 'ISSUED_AWAITING_BENEFICIARY'
  | 'EFFECTIVE'
  | 'BENEFICIARY_REFUSED'
  | 'REJECTED'
  | 'IN_PROGRESS';

/** An amendment to an issued credit. Customers receive a reduced form (no reviews or decision). */
export interface Amendment {
  amendmentId: string;
  number: number;
  status: AmendmentStatus;
  reason: string;
  requestedBy?: ActorRef;
  requestedAt: string;
  changedFields: string[];
  proposedTerms: LcApplicationData;
  reviews?: Partial<Record<Department, { status: 'PENDING' | 'APPROVED' | 'REJECTED'; by: ActorRef | null; at: string | null; rationale: string }>>;
  decision?: { decision: 'APPROVED' | 'REJECTED'; by: ActorRef; at: string; rationale: string } | null;
  issuance: { reference: string; mode: 'SANDBOX'; at: string; message?: string; financialInstrumentExpiry?: string } | null;
  beneficiaryResponse: { accepted: boolean; at: string; note?: string } | null;
}

export interface Presentation {
  presentationId: string;
  /** The post-shipment application reference: the case number and the application number. */
  reference?: string | null;
  origin?: 'CLIENT' | 'BANK';
  applicationStatus?: string;
  /** Where the application stands (see ApplicationState); computed by the server. */
  state?: string;
  documentCount?: number;
  receivedAt: string;
  recordedBy?: ActorRef;
  documentLinkIds: string[];
  examination: { examinedAt: string; examinedBy?: ActorRef; result: 'COMPLYING' | 'DISCREPANT'; findingIds?: string[] } | null;
  decision: { decision: 'ACCEPTED' | 'REFUSED'; by: ActorRef; at: string; rationale: string } | null;
}

export interface TradeCaseView {
  caseId: string;
  /** Present for staff who may see it, once the request is approved. */
  hostPayload?: HostPayloadMeta | null;
  transactionType: string;
  customerRef: string;
  status: CaseStatus;
  statusHistory: Array<{ from: CaseStatus | null; to: CaseStatus; at: string; actor: ActorRef | 'SYSTEM'; reason: string }>;
  applicationVersions: ApplicationVersion[];
  currentApplicationVersion: number;
  documents: CaseDocument[];
  findings: Finding[];
  reviews: Record<Department, Review>;
  queries: CaseQuery[];
  approvals?: ApprovalRecord[];
  creditFacility?: {
    facilityReference: string;
    availableLimit: number;
    currency: string;
    marginPercent: number;
    verificationSource: 'MANUAL_OFFICER_VERIFIED' | 'SANDBOX_DEMO_DATA';
    verifiedBy: ActorRef;
    verifiedAt: string;
    note: string;
  } | null;
  issuedLc: IssuedLc | null;
  /** Assigned when the pre-shipment request was approved: the key that joins it to its post-shipment application. */
  preShipmentReference?: string | null;
  amendments?: Amendment[];
  presentations: Presentation[];
  settlement: { mode: string; amount: number; currency: string; valueDate: string; reference: string; recordedBy: ActorRef; recordedAt: string; note: string } | null;
  investigations?: Array<{ investigationId: string; openedBy: ActorRef; openedAt: string; reason: string; closedAt: string | null; outcome: string | null; rationale: string }>;
  validation: { lastRunAt: string | null; piExtractionSource: string; amountInPkr?: number | null };
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  closedAt: string | null;
  availableActions: string[];
  approvalBlockers: string[];
  checklists: Partial<Record<Department, ChecklistItem[]>>;
  reviewBlockers: Partial<Record<Department, string[]>>;
  /** Only when one case is opened: how far the AI has got with its pre-trade documents. */
  readingProgress?: { total: number; read: number; failed: number };
}

export interface TradeCaseListItem {
  caseId: string;
  /** The pre-shipment reference, once the request is approved. */
  reference?: string | null;
  status: CaseStatus;
  /** The signed-in user cleared this approved case from their list (it is kept and shown under cleared history). */
  cleared: boolean;
  /** What the headline boxes count, per case. */
  openCustomerQueries: number;
  blocked: boolean;
  complianceAlerts: number;
  customerRef: string;
  applicant: string;
  beneficiary: string;
  currency: string;
  amount: number | null;
  goodsDescription: string;
  openFindings: number;
  blockingFindings: number;
  openQueries: number;
  lcNumber: string | null;
  updatedAt: string;
  availableActions: string[];
}

export interface TradeCaseDashboard {
  totalCases: number;
  byStatus: Record<string, number>;
  pendingReviewsByDepartment?: Record<Department, number>;
  openCustomerQueries: number;
  casesBlockedByFindings: number;
  openComplianceAlerts?: number;
  medianHoursSubmissionToAuthorisation: number | null;
  recentCases: Array<{ caseId: string; status: CaseStatus; updatedAt: string }>;
}

export interface TradeCaseAuditEvent {
  eventId: string;
  seq: number;
  at: string;
  actor: { id: string; name: string; role: string };
  action: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus | null;
  detail: Record<string, unknown>;
  ruleSetVersion: string;
  hash: string;
}

export const STATUS_LABELS: Record<CaseStatus, string> = {
  DRAFT: 'Draft',
  UNDER_REVIEW: 'Submitted to bank',
  PENDING_CUSTOMER_CLARIFICATION: 'Awaiting customer',
  APPROVAL_PENDING: 'Approval pending',
  AUTHORIZED_FOR_ISSUANCE: 'Approved (authorized for issuance)',
  LC_ISSUED: 'LC issued — awaiting documents',
  DOCUMENT_EXAMINATION: 'Document examination',
  DISCREPANCY_RESOLUTION: 'Discrepancy resolution',
  AWAITING_SETTLEMENT: 'Awaiting settlement',
  SETTLED_MONITORING: 'Settled — monitoring',
  UNDER_INVESTIGATION: 'Under investigation',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
};

export const DEPARTMENT_LABELS: Record<Department, string> = {
  RM: 'Relationship Manager',
  TRADE_OPS: 'Trade Operations',
  COMPLIANCE: 'Compliance',
  CREDIT: 'Credit',
};

/** Lifecycle stages, in order, for the progress rail. */
export const LIFECYCLE_STAGES: Array<{ label: string; statuses: CaseStatus[] }> = [
  { label: 'Request', statuses: ['DRAFT'] },
  { label: 'Review', statuses: ['UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION'] },
  { label: 'Approval', statuses: ['APPROVAL_PENDING', 'AUTHORIZED_FOR_ISSUANCE'] },
  { label: 'Issued', statuses: ['LC_ISSUED'] },
  { label: 'Examination', statuses: ['DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION'] },
  { label: 'Settlement', statuses: ['AWAITING_SETTLEMENT', 'SETTLED_MONITORING', 'UNDER_INVESTIGATION'] },
  { label: 'Closed', statuses: ['CLOSED'] },
];

// ---------------------------------------------------------------- host payload

export interface HostPayloadVersion {
  version: number;
  generatedAt: string;
  sha256: string;
  sizeBytes: number;
  filename: string;
  includesTiReference: boolean;
}

export interface HostDeliveryAttempt {
  at: string;
  by: ActorRef;
  mode: 'RECORDED_ONLY' | 'HTTP';
  ok: boolean;
  httpStatus: number | null;
  message: string;
}

/** What the case keeps of the payload handed to the host after the pre-shipment approval. */
export interface HostPayloadMeta {
  payloadId: string;
  status: 'GENERATED' | 'SENT_TO_HOST' | 'DELIVERY_FAILED';
  generatedAt: string;
  generatedBy: ActorRef | 'SYSTEM';
  currentVersion: number;
  versions: HostPayloadVersion[];
  tiReference: { reference: string; createdAt: string; createdBy: ActorRef } | null;
  deliveries: HostDeliveryAttempt[];
  lastSentAt: string | null;
}

/** The officer's view of the payload: the meta plus the link, the file and how often the host opened it. */
export interface HostPayloadView {
  approved: boolean;
  canSend: boolean;
  delivery: { endpointConfigured: boolean; publicAddressConfigured: boolean };
  payload: (HostPayloadMeta & { url: string; filename: string; sha256: string; sizeBytes: number; opened: { count: number; lastAt: string | null }; activity: Array<{ at: string; kind: 'PAGE' | 'PAYLOAD_PDF' | 'DOCUMENT'; item: string | null }> }) | null;
}
