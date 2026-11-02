/**
 * The one place that says who may do what.
 *
 * Routes, services and the frontend all ask "does this user hold permission X", never "is this user
 * role Y". A role is only a named bundle of permissions, defined here; anything not granted is
 * denied, and a role this file does not know grants nothing.
 *
 * Changing this matrix is a code change under review, not a runtime setting: role *assignment* is
 * managed at runtime (with dual control, see account-directory), but what a role may do is not.
 */

export const PERMISSIONS = {
  // ---------------------------------------------------------------- post-trade workbench
  'documents.read': 'Read the document store: analyses, reports, files, comparisons',
  'documents.upload': 'Upload documents and start or re-run analysis',
  'documents.delete': 'Delete or archive documents and restore archived history',
  'documents.purge': 'Permanently erase a document, its passages, events and stored original (irreversible)',
  'documents.override': 'Override a document-level compliance decision',
  'compliance.sources.read': 'Read sanctions-feed status, FX rates and retrospective alerts',
  'compliance.sources.sync': 'Trigger sanctions and reference-data feed synchronization',
  'compliance.screening.run': 'Run ad-hoc and point-in-time sanctions screening',
  'analytics.read': 'Read platform analytics',
  'customers360.read': 'Read Customer 360 counterparty profiles',
  'masterdata.read': 'Read master/reference data',
  'masterdata.write': 'Submit changes to master/reference data (applied only after a second person approves) and synchronize feeds',
  'masterdata.approve': 'Approve or reject another person\'s master-data change (four-eyes control)',
  'chat.use': 'Use the document assistant (reads the document store)',
  'system.storage.status': 'See database connectivity and targets',

  // ---------------------------------------------------------------- trade cases: scope
  'tradecase.view.own': 'View trade cases of the customer the login belongs to',
  'tradecase.view.assigned': 'View trade cases of customers assigned to this user',
  'tradecase.view.all': 'View trade cases across the institution',
  'tradecase.findings.internal.view': 'See compliance, TBML and regulatory findings in full',
  'tradecase.credit.view': 'See credit facility details and credit findings',
  'tradecase.investigation.view': 'See TBML investigations',
  'tradecase.audit.view': 'Read a case\'s hash-chained audit log',
  'audit.overview': 'Audit explorer: every case\'s chain verification',
  'tradecase.rules.view': 'Read the rule registry and workflow policy',
  'tradecase.verification.view': 'Read external verification results, their evidence and the source catalog',
  'tradecase.verification.export': 'Download the evidence-based scrutiny report of a case (what the holder may read in the case, nothing more)',
  'verification.rules.propose': 'Propose that a verification rule be approved as a bank control (a second person decides)',
  'verification.rules.approve': 'Approve, reject or revoke a verification rule as a bank control (never the person who proposed it)',
  'verification.reference.submit': 'Submit a reference dataset (for example the Pakistan Customs Tariff) for approval',
  'verification.reference.approve': 'Approve or reject a submitted reference dataset, and retire an approved one (never the person who submitted it)',

  // ---------------------------------------------------------------- trade cases: request
  'tradecase.create': 'Create an import request',
  'tradecase.application.edit': 'Edit the transaction details (new version)',
  'tradecase.document.attach': 'Attach pre-trade documents to a case',
  'tradecase.document.remove': 'Remove a pre-trade document that was attached by mistake',
  'tradecase.document.download': 'Download a case document',
  'tradecase.submit': 'Submit a draft for review',
  'tradecase.withdraw': 'Withdraw a request',
  'tradecase.revalidate': 'Re-scan (run the checks again)',
  'tradecase.postshipment.apply': 'Start, prepare and submit a post-shipment application against an approved request, and send corrected documents (the customer, for their own requests)',
  'tradecase.hostpayload.view': 'See the host payload of an approved pre-shipment request (its link, status, TI reference and delivery record) and download the PDF',
  'tradecase.hostpayload.send': 'Send the host payload of an approved pre-shipment request to the host system (this creates its TI reference), and generate it again if it is missing',
  'tradecase.history.clear': 'Hide approved pre-shipment cases from your own case list and counts (nothing is deleted: the case, its documents and its audit trail stay in the database, and the hidden cases can be recovered for any period, then cleared again)',
  'tradecase.preshipment.approve':'Approve a pre-shipment request after the trade desk\'s scrutiny (single step, no separate approver)',

  // ---------------------------------------------------------------- trade cases: review
  'tradecase.review.rm': 'Perform the RM review',
  'tradecase.review.trade_ops': 'Perform Trade Operations scrutiny',
  'tradecase.review.compliance': 'Perform the compliance review (including holds)',
  'tradecase.review.credit': 'Perform the credit review',
  'tradecase.query.raise': 'Raise a query for the user\'s department',
  'tradecase.query.respond.customer': 'Answer a query addressed to the customer',
  'tradecase.query.respond.internal': 'Answer a query addressed to the user\'s department',
  'tradecase.query.resolve': 'Resolve or reply to a query the user\'s department raised',
  'tradecase.finding.disposition.data': 'Disposition data, document and LC-term findings',
  'tradecase.finding.disposition.compliance': 'Disposition compliance, TBML and regulatory findings',
  'tradecase.finding.disposition.credit': 'Disposition credit findings',
  'tradecase.credit.record': 'Record a credit facility verification',

  // ---------------------------------------------------------------- trade cases: authorization
  'tradecase.approval.request': 'Request authorization (maker)',
  'tradecase.approval.decide': 'Authorize or return (checker)',
  'tradecase.reject': 'Reject a case',
  'tradecase.cancel': 'Cancel an authorized case before issuance',
  'tradecase.issuance.record': 'Record (sandbox) LC issuance',

  // ---------------------------------------------------------------- trade cases: amendments
  'tradecase.amendment.request': 'Request an LC amendment',
  'tradecase.amendment.submit': 'Submit a reviewed amendment for approval (maker)',
  'tradecase.amendment.approve': 'Approve or reject an amendment (checker)',
  'tradecase.amendment.issue': 'Record (sandbox) amendment issuance',
  'tradecase.amendment.beneficiary_response': 'Record the beneficiary\'s acceptance or refusal of an amendment',

  // ---------------------------------------------------------------- trade cases: post-trade
  'tradecase.presentation.record': 'Record a documentary presentation',
  'tradecase.presentation.examine': 'Examine a presentation',
  'tradecase.presentation.waive': 'Give the applicant\'s waiver on a discrepancy',
  'tradecase.presentation.decide': 'Accept or refuse a presentation (bank decision)',
  'tradecase.settlement.record': 'Record settlement (sandbox / manual record)',
  'tradecase.investigation.open': 'Open a TBML investigation',
  'tradecase.investigation.close': 'Close a TBML investigation',
  'tradecase.close': 'Close a settled case',

  // ---------------------------------------------------------------- administration
  'admin.users.view': 'List user accounts and access requests',
  'admin.users.manage': 'Create users, disable accounts, revoke sessions',
  'admin.access.request': 'Request a role or assignment change',
  'admin.access.approve': 'Approve or reject another administrator\'s access request',
  'admin.rbac.view': 'Read the role-permission matrix',
  'system.health.view': 'Read technical health and security-denial metrics',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_IDS = [
  'CORPORATE_CUSTOMER',
  'RELATIONSHIP_MANAGER',
  'TRADE_MAKER',
  'TRADE_CHECKER',
  'OPERATIONS_DESK',
  'CREDIT_REVIEWER',
  'COMPLIANCE_REVIEWER',
  'TBML_RISK_ANALYST',
  'CHIEF_COMPLIANCE_OFFICER',
  'SENIOR_APPROVER',
  'LC_ISSUER',
  'SETTLEMENT_OFFICER',
  'TRADE_AUDITOR',
  'POST_TRADE_OFFICER',
  'PLATFORM_ADMIN',
  'INTEGRATION_GATEWAY',
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

export type DataScope = 'OWN_CUSTOMER' | 'ASSIGNED_CUSTOMERS' | 'INSTITUTION' | 'NONE';

export interface RoleDefinition {
  displayName: string;
  description: string;
  /** Which trade cases the role reaches (permissions decide *what* it may do with them). */
  dataScope: DataScope;
  /** Whether people may be assigned this role through the admin workflow (machine roles may not). */
  assignable: boolean;
  permissions: Permission[];
  /**
   * One person holds every desk's work (a deliberate choice for a small team or a demonstration). Separation of
   * duties between the desks cannot apply to one person, so the service skips it for this role; every step is still
   * recorded under that person's name in the audit chain.
   */
  consolidated?: true;
}

const WORKBENCH_READ: Permission[] = ['documents.read', 'compliance.sources.read', 'masterdata.read', 'chat.use'];
// Bank staff who read cases also read the rule registry that explains findings. Customers do not:
// TBML thresholds published to the people they screen would help them stay under the thresholds.
const CASE_READ: Permission[] = ['tradecase.view.all', 'tradecase.document.download', 'tradecase.rules.view', 'tradecase.verification.view', 'tradecase.verification.export'];
const COMPLIANCE_CORE: Permission[] = [
  ...CASE_READ,
  ...WORKBENCH_READ,
  'tradecase.review.compliance',
  'tradecase.findings.internal.view',
  'tradecase.investigation.view',
  'tradecase.finding.disposition.compliance',
  'tradecase.query.raise',
  'tradecase.query.respond.internal',
  'tradecase.query.resolve',
  'tradecase.revalidate',
  'tradecase.audit.view',
  'compliance.screening.run',
  'customers360.read',
  'analytics.read',
  'masterdata.approve',
  // Compliance prepares the case for a rule or a reference dataset to become a control; the policy owner decides.
  'verification.rules.propose',
  'verification.reference.submit',
];

export const ROLE_DEFINITIONS: Record<RoleId, RoleDefinition> = {
  CORPORATE_CUSTOMER: {
    displayName: 'Corporate Customer',
    description: 'An importer: files and follows its own LC requests. Never sees internal findings.',
    dataScope: 'OWN_CUSTOMER',
    assignable: true,
    permissions: [
      'tradecase.view.own',
      'tradecase.create',
      'tradecase.application.edit',
      'tradecase.document.attach',
      'tradecase.document.remove',
      'tradecase.document.download',
      'tradecase.submit',
      'tradecase.withdraw',
      'tradecase.query.respond.customer',
      'tradecase.presentation.waive',
      'tradecase.postshipment.apply',
      'tradecase.amendment.request',
    ],
  },
  RELATIONSHIP_MANAGER: {
    displayName: 'Relationship Manager',
    description: 'Owns assigned customers: RM review, acts for the customer, no compliance or credit authority.',
    dataScope: 'ASSIGNED_CUSTOMERS',
    assignable: true,
    permissions: [
      'tradecase.view.assigned',
      'tradecase.document.download',
      'tradecase.create',
      'tradecase.application.edit',
      'tradecase.document.attach',
      'tradecase.document.remove',
      'tradecase.submit',
      'tradecase.withdraw',
      'tradecase.review.rm',
      'tradecase.query.raise',
      'tradecase.query.respond.customer',
      'tradecase.query.resolve',
      'tradecase.presentation.waive',
      'tradecase.amendment.request',
    ],
  },
  TRADE_MAKER: {
    displayName: 'Trade Operations (Maker)',
    description: 'Scrutiny and preparation; cannot authorize its own work.',
    dataScope: 'INSTITUTION',
    assignable: true,
    permissions: [
      ...CASE_READ,
      ...WORKBENCH_READ,
      'documents.upload',
      'tradecase.revalidate',
      // The pre-shipment scrutiny includes the sanctions, jurisdiction and TBML results of the documents.
      'tradecase.findings.internal.view',
      // The desk that does the scrutiny also clears what the AI and the engines flag (false positive, risk accepted, escalated), with a recorded reason.
      'tradecase.finding.disposition.compliance',
      'tradecase.preshipment.approve',
      'tradecase.hostpayload.view',
      'tradecase.hostpayload.send',
      'tradecase.history.clear',
      'tradecase.review.trade_ops',
      'tradecase.query.raise',
      'tradecase.query.respond.internal',
      'tradecase.query.resolve',
      'tradecase.finding.disposition.data',
      'tradecase.approval.request',
      'tradecase.presentation.record',
      'tradecase.presentation.examine',
      'tradecase.amendment.request',
      'tradecase.amendment.submit',
      'tradecase.amendment.beneficiary_response',
    ],
  },
  TRADE_CHECKER: {
    displayName: 'Trade Operations (Checker)',
    description: 'Independent check of maker work: authorizes versions and decides presentations.',
    dataScope: 'INSTITUTION',
    assignable: true,
    permissions: [
      ...CASE_READ,
      ...WORKBENCH_READ,
      'tradecase.review.trade_ops',
      'tradecase.query.raise',
      'tradecase.query.resolve',
      'tradecase.finding.disposition.data',
      'tradecase.approval.decide',
      'tradecase.presentation.examine',
      'tradecase.presentation.decide',
      'tradecase.amendment.approve',
      'tradecase.close',
    ],
  },
  OPERATIONS_DESK: {
    displayName: 'Post-Trade Documentary Operations',
    description: 'Receives and examines presentations; maintains feeds and reference data.',
    dataScope: 'INSTITUTION',
    assignable: true,
    permissions: [
      ...CASE_READ,
      ...WORKBENCH_READ,
      'documents.upload',
      'compliance.sources.sync',
      'masterdata.write',
      'system.storage.status',
      'tradecase.review.trade_ops',
      'tradecase.query.raise',
      'tradecase.query.respond.internal',
      'tradecase.query.resolve',
      'tradecase.finding.disposition.data',
      'tradecase.presentation.record',
      'tradecase.presentation.examine',
      'tradecase.amendment.beneficiary_response',
    ],
  },
  CREDIT_REVIEWER: {
    displayName: 'Credit Reviewer',
    description: 'Facility verification and credit decisions; no compliance or issuance authority.',
    dataScope: 'INSTITUTION',
    assignable: true,
    permissions: [
      ...CASE_READ,
      'tradecase.review.credit',
      'tradecase.credit.view',
      'tradecase.credit.record',
      'tradecase.finding.disposition.credit',
      'tradecase.query.raise',
      'tradecase.query.respond.internal',
      'tradecase.query.resolve',
    ],
  },
  COMPLIANCE_REVIEWER: {
    displayName: 'Compliance Reviewer',
    description: 'Compliance review, holds and dispositions; cannot run or close investigations.',
    dataScope: 'INSTITUTION',
    assignable: true,
    permissions: [...COMPLIANCE_CORE],
  },
  TBML_RISK_ANALYST: {
    displayName: 'TBML Risk Analyst / Investigator',
    description: 'Compliance review plus TBML investigations and document-level overrides.',
    dataScope: 'INSTITUTION',
    assignable: true,
    permissions: [...COMPLIANCE_CORE, 'tradecase.investigation.open', 'tradecase.investigation.close', 'documents.override'],
  },
  CHIEF_COMPLIANCE_OFFICER: {
    displayName: 'Chief Compliance Officer',
    description: 'Head of compliance: everything an analyst does, plus document lifecycle and feed control. No credit, approval or issuance authority.',
    dataScope: 'INSTITUTION',
    assignable: true,
    permissions: [
      ...COMPLIANCE_CORE,
      'tradecase.investigation.open',
      'tradecase.investigation.close',
      'documents.override',
      'documents.upload',
      'documents.delete',
      'documents.purge',
      'compliance.sources.sync',
      'masterdata.write',
      'system.storage.status',
      'audit.overview',
      // The policy owner: decides which verification rules and reference datasets become bank controls.
      'verification.rules.approve',
      'verification.reference.approve',
    ],
  },
  SENIOR_APPROVER: {
    displayName: 'Senior Approver',
    description: 'Checker for authorization; rejects and cancels. Sees the full risk picture it decides on.',
    dataScope: 'INSTITUTION',
    assignable: true,
    permissions: [
      ...CASE_READ,
      'tradecase.findings.internal.view',
      'tradecase.credit.view',
      'tradecase.approval.decide',
      'tradecase.reject',
      'tradecase.cancel',
      'tradecase.close',
      'tradecase.amendment.approve',
      'tradecase.audit.view',
    ],
  },
  LC_ISSUER: {
    displayName: 'LC Issuance Officer',
    description: 'Records issuance and amendment issuance of authorized credits (sandbox).',
    dataScope: 'INSTITUTION',
    assignable: true,
    permissions: [...CASE_READ, 'tradecase.issuance.record', 'tradecase.amendment.issue'],
  },
  SETTLEMENT_OFFICER: {
    displayName: 'Settlement Officer',
    description: 'Records settlement of accepted presentations. Never initiates payment.',
    dataScope: 'INSTITUTION',
    assignable: true,
    permissions: [...CASE_READ, 'tradecase.settlement.record'],
  },
  POST_TRADE_OFFICER: {
    displayName: 'Trade Operations Officer (all desks)',
    description: 'One officer for all the bank-side work of an import LC after it is authorized: reviews, approval, issuance, presentations, settlement, amendments, investigations and closure. Separation of duties between desks does not apply to this role; the audit trail names the officer on every step.',
    dataScope: 'INSTITUTION',
    assignable: false,
    consolidated: true,
    // Filled below from the desks it replaces.
    permissions: [],
  },
  TRADE_AUDITOR: {
    displayName: 'Auditor (read-only)',
    description: 'Reads everything in scope including audit chains; changes nothing.',
    dataScope: 'INSTITUTION',
    assignable: true,
    permissions: [
      ...CASE_READ,
      ...WORKBENCH_READ.filter((p) => p !== 'chat.use'),
      'tradecase.findings.internal.view',
      'tradecase.hostpayload.view',
      'tradecase.credit.view',
      'tradecase.investigation.view',
      'tradecase.audit.view',
      'audit.overview',
      'analytics.read',
      'customers360.read',
      'admin.rbac.view',
    ],
  },
  PLATFORM_ADMIN: {
    displayName: 'System Administrator',
    description: 'Accounts, access requests and technical health. No business data or business decisions.',
    dataScope: 'NONE',
    assignable: true,
    permissions: ['admin.users.view', 'admin.users.manage', 'admin.access.request', 'admin.access.approve', 'admin.rbac.view', 'system.health.view', 'system.storage.status'],
  },
  INTEGRATION_GATEWAY: {
    displayName: 'Integration Gateway (machine)',
    description: 'The X-API-Key principal: uploads and reads documents for a core-banking caller. No case or compliance authority.',
    dataScope: 'NONE',
    assignable: false,
    permissions: ['documents.upload', 'documents.read'],
  },
};

/** Departments of the trade review and the permission that lets a user act for each. */
export const DEPARTMENT_PERMISSION = {
  RM: 'tradecase.review.rm',
  TRADE_OPS: 'tradecase.review.trade_ops',
  COMPLIANCE: 'tradecase.review.compliance',
  CREDIT: 'tradecase.review.credit',
} as const satisfies Record<string, Permission>;

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === 'string' && (ROLE_IDS as readonly string[]).includes(value);
}

// The all-desks officer holds what each bank-side desk holds, plus the relationship review (the first of the four
// reviews). It holds nothing of the customer, the administrator or the API gateway.
ROLE_DEFINITIONS.POST_TRADE_OFFICER.permissions = [
  ...new Set<Permission>([
    'tradecase.review.rm',
    ...(['TRADE_MAKER', 'TRADE_CHECKER', 'OPERATIONS_DESK', 'CREDIT_REVIEWER', 'COMPLIANCE_REVIEWER', 'TBML_RISK_ANALYST', 'CHIEF_COMPLIANCE_OFFICER', 'SENIOR_APPROVER', 'LC_ISSUER', 'SETTLEMENT_OFFICER', 'TRADE_AUDITOR'] as const).flatMap((r) => ROLE_DEFINITIONS[r].permissions),
  ]),
];

/** Whether one person holds every desk in this role, so separation of duties between desks cannot apply. */
export function isConsolidatedRole(role: string | null | undefined): boolean {
  return isRoleId(role) && ROLE_DEFINITIONS[role].consolidated === true;
}

/** Permissions of a role; an unknown role has none. */
const NO_PERMISSIONS: ReadonlySet<Permission> = new Set();
const permissionSets = new Map<RoleId, ReadonlySet<Permission>>();

export function permissionsOf(role: string | null | undefined): ReadonlySet<Permission> {
  if (!isRoleId(role)) return NO_PERMISSIONS;
  // Built once per role: this runs for every permission check, and a list of cases checks several per case.
  let set = permissionSets.get(role);
  if (!set) {
    set = new Set(ROLE_DEFINITIONS[role].permissions);
    permissionSets.set(role, set);
  }
  return set;
}

export function hasPermission(user: { role: string } | null | undefined, permission: Permission): boolean {
  return Boolean(user) && permissionsOf(user!.role).has(permission);
}

export function hasAnyPermission(user: { role: string } | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => hasPermission(user, p));
}

export const TRADE_CASE_VIEW: Permission[] = ['tradecase.view.own', 'tradecase.view.assigned', 'tradecase.view.all'];

/**
 * A configured role string to a role, or null. Accepts the canonical id ("TRADE_MAKER") or a role's
 * exact display name, case-insensitively ("Trade Operations (Maker)"). Nothing else: keyword or
 * substring guessing once turned "System Admin" into a compliance officer and any unknown title
 * into a privileged desk. An unrecognised role is no role.
 */
export function normalizeRole(raw: string | null | undefined): RoleId | null {
  if (!raw) return null;
  const canonical = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (isRoleId(canonical)) return canonical;
  const lower = raw.trim().toLowerCase();
  for (const role of ROLE_IDS) {
    if (ROLE_DEFINITIONS[role].displayName.toLowerCase() === lower) return role;
  }
  return null;
}
