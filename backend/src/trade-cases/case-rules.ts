import type { AuthenticatedUser } from '../middleware/auth.middleware';
import { hasPermission } from '../authorization/permissions';
import type { ActorRef, CaseDocument, CaseStatus, CreditOfRecord, Finding, FindingCategory, LcApplicationData, TradeCase } from './trade-case.types';

/**
 * The plain rules about a case that need no state: who may see it, what counts as a draft, whether a finding still blocks,
 * where a post-shipment application stands. Pure functions of the case (and the user), shared by the case service and the
 * views that decide what each user sees. Kept apart from the service so each can be read, and tested, on its own.
 */

/** Never shown to a customer: disclosing a suspicion or a credit view is tipping-off or a confidentiality breach. */
export const INTERNAL_CATEGORIES: FindingCategory[] = ['COMPLIANCE_ALERT', 'TBML_RED_FLAG', 'REGULATORY_CONCERN', 'CREDIT_BLOCKER'];

/** Whether the case falls within the user's data scope. Outside it, a case does not exist for them. */
export function canViewCase(user: AuthenticatedUser, c: { customerRef: string }): boolean {
  if (hasPermission(user, 'tradecase.view.all')) return true;
  if (hasPermission(user, 'tradecase.view.assigned') && (user.assignedCustomerRefs ?? []).includes(c.customerRef)) return true;
  return hasPermission(user, 'tradecase.view.own') && Boolean(user.customerRef) && user.customerRef === c.customerRef;
}

/** Customer-facing view: the user reaches only their own customer's cases. */
export function isCustomerView(user: AuthenticatedUser): boolean {
  return !hasPermission(user, 'tradecase.view.all') && !hasPermission(user, 'tradecase.view.assigned');
}

/** One line of a user's own history on the dashboard: a case they worked on and what they did on it. */
export interface MyActivityRow {
  caseId: string;
  /** The number the bank knows it by (the case number once approved; a draft has none to show). */
  reference: string;
  draft: boolean;
  status: CaseStatus;
  stage: 'PRE' | 'POST';
  customerRef: string;
  applicant: string;
  beneficiary: string;
  currency: string;
  amount: number | null;
  postShipment: { reference: string; state: string } | null;
  parts: string[];
  lastActionAt: string;
  lastAction: string;
}

/**
 * Whether the bank has asked this request's customer for something: a message to them is open. It is the one reason to add a
 * document once the request has been sent. Without it, what the bank has received stays as it is.
 */
export function bankAskedForCorrection(c: Pick<TradeCase, 'queries'>): boolean {
  return c.queries.some((q) => q.assignee === 'CUSTOMER' && q.status === 'OPEN');
}

/** A document may be added to a request before it is sent, or after it when the bank has asked for a correction. */
export function mayAddDocuments(c: Pick<TradeCase, 'status' | 'queries'>): boolean {
  return c.status === 'DRAFT' || bankAskedForCorrection(c);
}

/** The documents a request holds before shipment: the latest of each, replaced ones left out. */
export function currentPreTradeDocuments(c: Pick<TradeCase, 'documents'>): CaseDocument[] {
  return c.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId);
}

/**
 * A draft is the customer's own working copy until they send it. The bank's desks do not list it, whatever their scope:
 * only the customer side and whoever started it see it in their lists, queues and counts. (The request is at the bank from
 * the moment it is sent.) This governs what is listed; a case opened by its exact reference is still subject to the
 * ordinary scope check only.
 */
export function isUnsentDraftHiddenFrom(user: AuthenticatedUser, c: Pick<TradeCase, 'status' | 'createdBy'>): boolean {
  if (c.status !== 'DRAFT' || isCustomerView(user)) return false;
  return typeof c.createdBy === 'string' || c.createdBy.id !== user.id;
}

/** How long a draft with no document may sit before it counts as abandoned. A draft is made as the first file is added, so a short wait is enough. */
export const ABANDONED_DRAFT_MINUTES = 5;

/** A draft the customer removed before sending it. It never reached the bank, so it is listed nowhere (the record and its audit trail stay). */
export function isRemovedDraft(c: Pick<TradeCase, 'status' | 'submittedAt'>): boolean {
  return c.status === 'WITHDRAWN' && c.submittedAt === null;
}

/** A draft nobody added a document to: someone started and left. It is not a request, so it is listed nowhere and is not work. */
export function isAbandonedEmptyDraft(c: Pick<TradeCase, 'status' | 'documents' | 'updatedAt'>, now: number = Date.now()): boolean {
  return c.status === 'DRAFT' && currentPreTradeDocuments(c).length === 0 && now - Date.parse(c.updatedAt) > ABANDONED_DRAFT_MINUTES * 60_000;
}

/**
 * What the post-shipment desk works on: a request that was approved in pre-shipment, and everything after that. A
 * request still in review, awaiting the customer, or rejected, withdrawn or cancelled never reaches that desk.
 */
export const POST_SHIPMENT_STATUSES: readonly CaseStatus[] = ['AUTHORIZED_FOR_ISSUANCE', 'LC_ISSUED', 'DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION', 'AWAITING_SETTLEMENT', 'SETTLED_MONITORING', 'UNDER_INVESTIGATION', 'CLOSED'];

/**
 * What the pre-shipment desk works on: a request from its start until it is approved (or turned down, withdrawn or
 * cancelled). Once the credit is issued the case belongs to the post-shipment desk.
 */
export const PRE_SHIPMENT_STATUSES: readonly CaseStatus[] = ['DRAFT', 'UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION', 'APPROVAL_PENDING', 'AUTHORIZED_FOR_ISSUANCE', 'REJECTED', 'WITHDRAWN', 'CANCELLED'];

/**
 * Whether the post-shipment desk has anything to work on in this case: the customer has sent a post-shipment application
 * (or the bank recorded a presentation). An approved request whose customer is still preparing a draft is not there yet.
 */
export function reachedPostShipment(c: TradeCase): boolean {
  return POST_SHIPMENT_STATUSES.includes(c.status) && c.presentations.some((p) => p.applicationStatus !== 'DRAFT');
}

/** Whether this user cleared the case from their list and it still stands approved (a case that moved on is shown again). */
export function clearedBy(user: AuthenticatedUser, c: TradeCase): boolean {
  return c.status === 'AUTHORIZED_FOR_ISSUANCE' && Boolean(c.historyClearedBy?.some((x) => x.userId === user.id));
}

export const RESTRICTED_TITLE = 'Restricted compliance matter';

/** A finding that, as it stands, stops the case moving on. */
export function blocksNow(f: Finding): boolean {
  if (!f.blocking) return false;
  if (f.status === 'OPEN') return true;
  return f.disposition?.code === 'CONFIRMED_ESCALATED' || f.disposition?.code === 'DISCREPANCY_UPHELD';
}

export function currentApplication(c: TradeCase): LcApplicationData {
  return c.applicationVersions[c.applicationVersions.length - 1]!.data;
}

/** A current document the customer added after the request (or the application) was sent and has not yet sent to the bank. */
export function awaitingSend(c: TradeCase): CaseDocument[] {
  return c.documents.filter((d) => !d.supersededByLinkId && d.sentToBankAt === null);
}

/**
 * The key that joins an approved request, its approved documents, its post-shipment application and the bank's
 * decision. Stored when the approval is granted; for a request approved before it existed it is recomputed the same way.
 */
export function preShipmentReferenceOf(c: TradeCase): string | null {
  // The reference is the case number: one number for the request from the first draft to the post-shipment decision.
  const approved = c.preShipmentReference?.reference || c.approvals.some((a) => a.status === 'APPROVED') || POST_SHIPMENT_STATUSES.includes(c.status);
  return approved ? c.caseId : null;
}

export function assignPreShipmentReference(c: TradeCase, actor: ActorRef | 'SYSTEM'): string {
  if (!c.preShipmentReference) c.preShipmentReference = { reference: c.caseId, assignedAt: new Date().toISOString(), assignedBy: actor };
  return c.preShipmentReference.reference;
}

/** The credit a presentation is examined against: the issued credit as amended, otherwise the approved pre-shipment application. */
export function creditOfRecord(c: TradeCase): CreditOfRecord | null {
  if (c.issuedLc) return { reference: c.issuedLc.lcNumber, basis: 'ISSUED_CREDIT', terms: c.issuedLc.effectiveTerms ?? c.issuedLc.terms, applicationVersion: c.issuedLc.applicationVersion };
  const approval = [...c.approvals].reverse().find((a) => a.status === 'APPROVED');
  if (!approval) return null;
  const version = c.applicationVersions.find((v) => v.version === approval.applicationVersion) ?? c.applicationVersions[c.applicationVersions.length - 1]!;
  return { reference: preShipmentReferenceOf(c) ?? c.caseId, basis: 'APPROVED_APPLICATION', terms: version.data, applicationVersion: version.version };
}

export type ApplicationState = 'DRAFT' | 'UNDER_EXAMINATION' | 'CLARIFICATION_REQUESTED' | 'REPLY_SENT' | 'DISCREPANCIES' | 'READY_FOR_DECISION' | 'ACCEPTED' | 'REFUSED';

/** Where a post-shipment application stands, in the words both the client and the officer use. */
export function applicationState(c: TradeCase, p: TradeCase['presentations'][number]): ApplicationState {
  if (p.applicationStatus === 'DRAFT') return 'DRAFT';
  if (p.decision) return p.decision.decision === 'ACCEPTED' ? 'ACCEPTED' : 'REFUSED';
  if (c.queries.some((q) => q.assignee === 'CUSTOMER' && q.status === 'OPEN')) return 'CLARIFICATION_REQUESTED';
  // The client has answered or sent corrections since the last examination: it is with the bank again.
  const examinedAt = p.examination ? Date.parse(p.examination.examinedAt) : null;
  if (examinedAt !== null) {
    const replied = c.queries.some((q) => q.assignee === 'CUSTOMER' && q.responses.some((r) => Date.parse(r.at) > examinedAt));
    const corrected = c.documents.some((d) => d.presentationId === p.presentationId && !d.supersededByLinkId && d.sentToBankAt && Date.parse(d.sentToBankAt) > examinedAt);
    if (replied || corrected) return 'REPLY_SENT';
  }
  if (p.examination?.result === 'DISCREPANT') return 'DISCREPANCIES';
  if (p.examination) return 'READY_FOR_DECISION';
  return 'UNDER_EXAMINATION';
}

/** What a client may know about an application: where it stands and what it holds, no internal findings. */
export function presentationSummary(c: TradeCase, p: TradeCase['presentations'][number]): Record<string, unknown> {
  const current = c.documents.filter((d) => d.presentationId === p.presentationId && !d.supersededByLinkId);
  return {
    presentationId: p.presentationId,
    reference: p.reference ?? null,
    origin: p.origin ?? 'BANK',
    state: applicationState(c, p),
    submittedAt: p.submittedAt ?? p.receivedAt,
    receivedAt: p.receivedAt,
    documentCount: current.length,
    documentTypes: current.map((d) => d.documentType),
    examination: p.examination ? { result: p.examination.result, examinedAt: p.examination.examinedAt } : null,
    decision: p.decision,
    termsBasis: p.termsBasis ?? null,
  };
}

/** A finding from external verification that the customer cannot act on stays with the bank. */
export function officerOnly(f: Finding): boolean {
  return f.origin === 'EXTERNAL_VERIFICATION' && !f.customerFixable;
}

/** An AI point on a presented document stays with the examiner until they include it in a request to the client. */
export function unconfirmedPostShipmentAi(c: TradeCase, f: Finding): boolean {
  return f.stage === 'POST_TRADE' && f.origin === 'AI_ASSISTED_EXTRACTION' && !c.queries.some((q) => q.assignee === 'CUSTOMER' && q.findingIds.includes(f.findingId));
}

export function isAiFinding(f: Finding): boolean {
  return f.origin === 'AI_ASSISTED_EXTRACTION' && f.ruleId.startsWith('AI-');
}

export function withoutModelNote(description: string): string {
  return description.replace(/\s*\(AI review by [^)]*\)\s*$/, '');
}
