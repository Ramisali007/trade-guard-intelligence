import { hasAnyPermission, type Permission } from './permissions';

/**
 * What each signed-in user's portal shows: the screens they may open and the work queues they own.
 *
 * Both are derived from permissions, never from role names, so a role's portal is exactly what its
 * permissions allow — the same registry the API enforces. The frontend renders this list; hiding a
 * screen there is a convenience, the server's route guards are the control.
 */

export interface WorkspaceSection {
  id: string;
  title: string;
  /** The frontend route. */
  route: string;
  description: string;
  /** Any one of these grants the section. Empty = every signed-in user. */
  anyOf: Permission[];
}

export const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  { id: 'workspace', title: 'My workspace', route: '/workspace', description: 'Your queues and what needs your attention.', anyOf: [] },
  {
    id: 'trade-cases',
    title: 'Trade cases',
    route: '/trade-cases',
    description: 'Import LC applications through issuance, presentation and settlement.',
    anyOf: ['tradecase.view.own', 'tradecase.view.assigned', 'tradecase.view.all'],
  },
  { id: 'post-shipment', title: 'Post-Shipment', route: '/post-shipment', description: 'Send the shipping documents for a request the bank approved.', anyOf: ['tradecase.postshipment.apply'] },
  { id: 'new-case', title: 'New LC application', route: '/trade-cases/new', description: 'Start an import LC application.', anyOf: ['tradecase.create'] },
  { id: 'documents', title: 'Document workbench', route: '/dashboard', description: 'Post-trade document analysis and TBML screening.', anyOf: ['documents.read'] },
  { id: 'compare', title: 'Document comparison', route: '/compare', description: 'Cross-document consistency checks.', anyOf: ['documents.read'] },
  { id: 'auditor', title: 'Document auditor', route: '/auditor', description: 'Field-level evidence and math integrity.', anyOf: ['documents.read'] },
  { id: 'analytics', title: 'Analytics', route: '/analytics', description: 'Portfolio risk analytics.', anyOf: ['analytics.read'] },
  { id: 'customers', title: 'Customer 360', route: '/customers', description: 'Counterparty history and exposure.', anyOf: ['customers360.read'] },
  { id: 'sources', title: 'Sanctions sources', route: '/sources', description: 'Sanctions list freshness and sync status.', anyOf: ['compliance.sources.read'] },
  { id: 'import', title: 'Master data', route: '/import', description: 'Reference data imports.', anyOf: ['masterdata.read'] },
  { id: 'audit', title: 'Audit explorer', route: '/audit', description: 'Case audit trails and hash-chain verification.', anyOf: ['audit.overview'] },
  {
    id: 'admin',
    title: 'Administration',
    route: '/admin',
    description: 'Accounts, access requests, the permission matrix and platform health.',
    anyOf: ['admin.users.view', 'admin.rbac.view', 'system.health.view'],
  },
];

export function sectionsFor(user: { role: string }): Array<Omit<WorkspaceSection, 'anyOf'>> {
  return WORKSPACE_SECTIONS.filter((s) => s.anyOf.length === 0 || hasAnyPermission(user, s.anyOf)).map(({ anyOf: _anyOf, ...s }) => s);
}

/** A work queue: the cases where the user can take one of these next actions now. */
export interface QueueDefinition {
  id: string;
  title: string;
  description: string;
  actions: string[];
}

export const WORK_QUEUES: QueueDefinition[] = [
  { id: 'to-submit', title: 'Applications to complete and submit', description: 'Drafts you can still edit and submit.', actions: ['SUBMIT'] },
  { id: 'clarifications', title: 'Clarifications requested', description: 'The bank asked for a correction or more information.', actions: ['EDIT_APPLICATION'] },
  { id: 'scrutiny', title: 'Documents to scrutinise', description: 'Cases whose documents the trade desk analyses and checks, and writes back to the customer about.', actions: ['REVALIDATE'] },
  { id: 'review-rm', title: 'Relationship review', description: 'Applications awaiting the RM review.', actions: ['REVIEW_RM'] },
  { id: 'review-trade-ops', title: 'Trade operations review', description: 'Applications awaiting the Trade Ops (checker) review.', actions: ['REVIEW_TRADE_OPS'] },
  { id: 'review-compliance', title: 'Compliance review', description: 'Applications awaiting compliance clearance.', actions: ['REVIEW_COMPLIANCE'] },
  { id: 'review-credit', title: 'Credit review', description: 'Applications awaiting the credit decision.', actions: ['REVIEW_CREDIT', 'RECORD_CREDIT_FACILITY'] },
  { id: 'request-approval', title: 'Ready to send for approval', description: 'All reviews done: assemble the approval request.', actions: ['REQUEST_APPROVAL'] },
  { id: 'approve', title: 'Awaiting your approval', description: 'Maker-checker authorisation of the credit.', actions: ['APPROVE'] },
  { id: 'issue', title: 'Authorised for issuance', description: 'Record (sandbox) issuance with the Financial Instrument.', actions: ['RECORD_ISSUANCE'] },
  {
    id: 'amendments',
    title: 'Amendments',
    description: 'Amendments to issued credits needing your step.',
    actions: ['REVIEW_AMENDMENT_RM', 'REVIEW_AMENDMENT_TRADE_OPS', 'REVIEW_AMENDMENT_COMPLIANCE', 'REVIEW_AMENDMENT_CREDIT', 'SUBMIT_AMENDMENT', 'DECIDE_AMENDMENT', 'ISSUE_AMENDMENT', 'AMENDMENT_BENEFICIARY_RESPONSE'],
  },
  { id: 'presentations', title: 'Presentations', description: 'Documents presented under issued credits.', actions: ['RECORD_PRESENTATION', 'EXAMINE_PRESENTATION', 'DECIDE_PRESENTATION'] },
  { id: 'settlement', title: 'Awaiting settlement', description: 'Record settlement against the effective terms.', actions: ['RECORD_SETTLEMENT'] },
  { id: 'investigations', title: 'Open investigations', description: 'TBML investigations awaiting a decision.', actions: ['CLOSE_INVESTIGATION'] },
  { id: 'closure', title: 'Ready to close', description: 'Settled cases out of monitoring.', actions: ['CLOSE_CASE'] },
];
