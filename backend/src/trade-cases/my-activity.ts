import type { TradeCaseEvent } from './trade-case.types';

/**
 * What the audit trail says a person did on a case, in the words they would use. The trail records every step with its actor;
 * the dashboard shows each person the cases they took part in and what their part was.
 */
const ACTION_LABELS: Record<string, string> = {
  CASE_CREATED: 'Started the request',
  APPLICATION_UPDATED: 'Changed the transaction details',
  DOCUMENT_ATTACHED: 'Added documents',
  DOCUMENT_RETYPED: 'Corrected a document type',
  DOCUMENT_REMOVED: 'Removed a document',
  DOCUMENTS_SENT: 'Sent documents to the bank',
  SUBMITTED: 'Sent the request to the bank',
  WITHDRAWN: 'Withdrew the request',
  CANCELLED: 'Cancelled the request',
  REJECTED: 'Rejected the request',
  SCRUTINY_STARTED: 'Started the scrutiny',
  REVALIDATED: 'Re-scanned the request',
  QUERY_RAISED: 'Sent a message to the customer',
  QUERY_ANSWERED: 'Answered a message',
  QUERY_RESOLVED: 'Resolved a message',
  FINDING_DISPOSITIONED: 'Decided on a finding',
  MANUAL_FINDING_ADDED: 'Recorded a finding',
  QUERY_REOPENED: 'Replied to a message',
  REVIEW_APPROVE: 'Approved a review',
  REVIEW_RETURN: 'Returned the request for correction',
  REVIEW_HOLD: 'Put a review on hold',
  REVIEW_RECOMMEND_REJECT: 'Recommended rejection',
  APPROVAL_REQUESTED: 'Asked for authorization',
  PRESHIPMENT_APPROVED: 'Approved the request',
  CREDIT_FACILITY_RECORDED: 'Recorded the credit facility',
  LC_ISSUED: 'Issued the credit',
  POST_SHIPMENT_STARTED: 'Started the post-shipment application',
  PRESENTATION_DOCUMENT_ATTACHED: 'Added post-shipment documents',
  PRESENTATION_DOCUMENT_REMOVED: 'Removed a post-shipment document',
  POST_SHIPMENT_DRAFT_REMOVED: 'Removed the post-shipment draft',
  POST_SHIPMENT_SUBMITTED: 'Sent the post-shipment documents to the bank',
  PRESENTATION_RECEIVED: 'Recorded the presented documents',
  PRESENTATION_EXAMINED: 'Examined the post-shipment documents',
  PRESENTATION_AI_SCRUTINY: 'Ran the post-shipment AI reading',
  PRESENTATION_ACCEPTED: 'Accepted the post-shipment documents',
  PRESENTATION_REFUSED: 'Refused the post-shipment documents',
  APPLICANT_WAIVER: 'Answered a discrepancy',
  AMENDMENT_REQUESTED: 'Requested an amendment',
  AMENDMENT_SUBMITTED: 'Submitted an amendment',
  AMENDMENT_ISSUED: 'Issued an amendment',
  SETTLEMENT_RECORDED: 'Recorded the settlement',
  INVESTIGATION_OPENED: 'Opened an investigation',
  INVESTIGATION_CLOSED: 'Closed an investigation',
  CASE_CLOSED: 'Closed the case',
  HOST_REFERENCE_CREATED: 'Recorded the host reference',
};

/** Steps that are a person's display choice or the system's own work, not part of working a case. */
const NOT_A_PART = new Set(['HISTORY_CLEARED', 'HISTORY_RECOVERED', 'APPLICATION_READ_FROM_DOCUMENTS', 'SCRUTINY_FINISHED', 'VERIFICATION_REPORT_EXPORTED', 'HOST_PAYLOAD_DOWNLOADED']);

export function describeAction(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const words = action.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface MyPart {
  /** Each different thing they did, in the order they first did it. */
  parts: string[];
  lastAt: string;
  lastAction: string;
}

/** What this person did on a case, or null when they took no part in it. */
export function summariseMyPart(events: readonly TradeCaseEvent[], userId: string): MyPart | null {
  const mine = events.filter((e) => e.actor.id === userId && !NOT_A_PART.has(e.action));
  if (mine.length === 0) return null;
  const parts: string[] = [];
  for (const e of mine) {
    const label = describeAction(e.action);
    if (!parts.includes(label)) parts.push(label);
  }
  const last = mine.reduce((a, b) => (a.at >= b.at ? a : b));
  return { parts, lastAt: last.at, lastAction: describeAction(last.action) };
}
