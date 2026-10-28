import type { ActorRef, CaseStatus, Evidence } from './trade-case.models';

/** Where a post-shipment application stands, in the words the client and the officer share. */
export type ApplicationState = 'DRAFT' | 'UNDER_EXAMINATION' | 'CLARIFICATION_REQUESTED' | 'REPLY_SENT' | 'DISCREPANCIES' | 'READY_FOR_DECISION' | 'ACCEPTED' | 'REFUSED';

export const APPLICATION_STATE_LABELS: Record<ApplicationState, string> = {
  DRAFT: 'Draft: not submitted',
  UNDER_EXAMINATION: 'With the bank: under examination',
  CLARIFICATION_REQUESTED: 'The bank has asked you a question',
  REPLY_SENT: 'You replied: with the bank for re-examination',
  DISCREPANCIES: 'Discrepancies found',
  READY_FOR_DECISION: 'Examined: awaiting the bank\'s decision',
  ACCEPTED: 'Documents accepted',
  REFUSED: 'Documents refused',
};

export const APPLICATION_STATE_CHIP: Record<ApplicationState, string> = {
  DRAFT: 'chip-info',
  UNDER_EXAMINATION: 'chip-info',
  CLARIFICATION_REQUESTED: 'chip-warning',
  REPLY_SENT: 'chip-info',
  DISCREPANCIES: 'chip-warning',
  READY_FOR_DECISION: 'chip-info',
  ACCEPTED: 'chip-positive',
  REFUSED: 'chip-negative',
};

export interface PostShipmentApplicationSummary {
  presentationId: string;
  reference: string | null;
  origin: 'CLIENT' | 'BANK';
  state: ApplicationState;
  submittedAt: string;
  receivedAt: string;
  documentCount: number;
  documentTypes: string[];
  examination: { result: 'COMPLYING' | 'DISCREPANT'; examinedAt: string } | null;
  decision: { decision: 'ACCEPTED' | 'REFUSED'; by: ActorRef; at: string; rationale: string } | null;
  termsBasis: 'ISSUED_CREDIT' | 'APPROVED_APPLICATION' | null;
}

/** One approved pre-shipment request on the client's Post-Shipment screen. */
export interface PostShipmentLc {
  caseId: string;
  reference: string;
  status: CaseStatus;
  approvedAt: string | null;
  applicant: string;
  beneficiary: string;
  goodsDescription: string;
  currency: string;
  amount: number | null;
  latestShipmentDate: string | null;
  expiryDate: string | null;
  requiredDocuments: string[];
  basis: 'ISSUED_CREDIT' | 'APPROVED_APPLICATION' | null;
  applications: number;
  application: PostShipmentApplicationSummary | null;
  canStart: boolean;
}

export type FindingClass = 'BLOCKING_DISCREPANCY' | 'NON_BLOCKING_DISCREPANCY' | 'WARNING' | 'INFORMATION';

export const FINDING_CLASS_ORDER: FindingClass[] = ['BLOCKING_DISCREPANCY', 'NON_BLOCKING_DISCREPANCY', 'WARNING', 'INFORMATION'];

export const FINDING_CLASS_LABELS: Record<FindingClass, string> = {
  BLOCKING_DISCREPANCY: 'Blocking discrepancies',
  NON_BLOCKING_DISCREPANCY: 'Non-blocking discrepancies',
  WARNING: 'Warnings',
  INFORMATION: 'Information',
};

export const FINDING_CLASS_CHIP: Record<FindingClass, string> = {
  BLOCKING_DISCREPANCY: 'chip-negative',
  NON_BLOCKING_DISCREPANCY: 'chip-warning',
  WARNING: 'chip-warning',
  INFORMATION: 'chip-info',
};

export interface ReviewFinding {
  findingId: string;
  ruleId: string;
  ruleVersion: string;
  title: string;
  description: string;
  severity: string;
  blocking: boolean;
  status: 'OPEN' | 'RESOLVED' | 'DISPOSITIONED';
  class: FindingClass;
  classLabel: string;
  category: string;
  origin: string;
  observed: Evidence[];
  expected: string;
  recommendedAction: string;
  confidence: number | null;
  disposition: { code: string; rationale: string; by: ActorRef; at: string } | null;
  applicantWaiver: { accepted: boolean; by: ActorRef; at: string; note: string } | null;
  presentationId: string | null;
}

export interface ComparisonRow {
  field: string;
  label: string;
  approved: Array<{ source: string; value: string }>;
  presented: Array<{ documentType: string; filename: string; value: string }>;
  status: 'MATCH' | 'DIFFERENT' | 'SINGLE_SOURCE' | 'NOT_STATED';
}

export interface ReviewDocument {
  presentationId: string;
  linkId: string;
  documentType: string;
  filename: string;
  version: number;
  superseded: boolean;
  uploadedAt: string;
  uploadedBy: string;
  sentToBankAt: string | null | undefined;
  analysisStatus: string;
}

/** What the officer's examination screen is built from (GET /trade-cases/:id/post-shipment/review). */
export interface AiReadingSummary {
  summary: string;
  at: string;
  model: string;
  raised: number;
  leftOut: number;
}

export interface PostShipmentReview {
  caseId: string;
  reference: string;
  status: CaseStatus;
  customerRef: string;
  credit: {
    reference: string;
    basis: 'ISSUED_CREDIT' | 'APPROVED_APPLICATION';
    applicationVersion: number;
    terms: {
      applicant: string;
      beneficiary: string;
      currency: string;
      amount: number | null;
      goodsDescription: string;
      hsCode: string;
      quantity: number | null;
      unitOfMeasure: string;
      incoterm: string;
      portOfLoading: string;
      portOfDischarge: string;
      latestShipmentDate: string | null;
      expiryDate: string | null;
      presentationPeriodDays: number;
      requiredDocuments: string[];
    };
  };
  approvedAt: string | null;
  approvedDocuments: Array<{ documentType: string; filename: string; version: number }>;
  applications: Array<PostShipmentApplicationSummary & { documentLinkIds: string[]; aiReview: AiReadingSummary | null }>;
  activePresentationId: string | null;
  documents: ReviewDocument[];
  comparison: ComparisonRow[];
  findings: ReviewFinding[];
  counts: Record<FindingClass, number>;
  queries: Array<{ queryId: string; subject?: string; question: string; status: 'OPEN' | 'ANSWERED' | 'RESOLVED'; raisedAt: string; responses: Array<{ text: string; at: string; by: ActorRef }> }>;
  reexaminationDue: boolean;
  requiredDocuments: string[];
  actions: string[];
}
