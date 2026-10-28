import fs from 'node:fs';
import { z } from 'zod';
import type { Permission } from '../authorization/permissions';
import { createLogger } from '../utils/logger';
import { DEPARTMENTS, type CaseStatus, type Department, type FindingCategory } from './trade-case.types';

const log = createLogger('trade-workflow-policy');

/**
 * The bank's operating procedure for import LCs, as configuration.
 *
 * Which departments must review, what each checklist asks, which duties must be held by different
 * people, and the tolerances the comparison rules use. *Who* holds which permission is not here: it
 * is the central role-permission registry (authorization/permissions.ts). The values below are a
 * reasonable default, not an approved procedure: a bank replaces them with its own by pointing
 * TRADE_WORKFLOW_POLICY_FILE at a JSON file. The file is validated at start-up and an invalid one
 * stops the server rather than being half-applied.
 *
 * What is NOT configurable is the shape of the lifecycle itself (STATE_TRANSITIONS): which status
 * an action may start from. Changing that changes the meaning of every guard in the service.
 */

export const CASE_ACTIONS = [
  'VIEW',
  'CREATE',
  'EDIT_APPLICATION',
  'ATTACH_PRETRADE_DOCUMENT',
  'REMOVE_PRETRADE_DOCUMENT',
  'SEND_DOCUMENTS',
  'START_POST_SHIPMENT',
  'ATTACH_PRESENTATION_DOCUMENT',
  'REMOVE_PRESENTATION_DOCUMENT',
  'SUBMIT_POST_SHIPMENT',
  'REQUEST_CLARIFICATION',
  'ADD_MANUAL_FINDING',
  'SUBMIT',
  'WITHDRAW',
  'REVALIDATE',
  'RAISE_QUERY',
  'RESPOND_QUERY',
  'RESOLVE_QUERY',
  'DISPOSITION_FINDING',
  'DISPOSITION_COMPLIANCE_FINDING',
  'RECORD_CREDIT_FACILITY',
  'REQUEST_APPROVAL',
  'APPROVE',
  'APPROVE_PRESHIPMENT',
  'REJECT',
  'CANCEL',
  'RECORD_ISSUANCE',
  'RECORD_PRESENTATION',
  'EXAMINE_PRESENTATION',
  'APPLICANT_WAIVER',
  'DECIDE_PRESENTATION',
  'RECORD_SETTLEMENT',
  'OPEN_INVESTIGATION',
  'CLOSE_INVESTIGATION',
  'CLOSE_CASE',
  'REQUEST_AMENDMENT',
  'SUBMIT_AMENDMENT',
  'DECIDE_AMENDMENT',
  'ISSUE_AMENDMENT',
  'AMENDMENT_BENEFICIARY_RESPONSE',
] as const;
export type CaseAction = (typeof CASE_ACTIONS)[number];

/** Statuses each action may start from. Review decisions are governed separately (UNDER_REVIEW only). */
export const STATE_TRANSITIONS: Partial<Record<CaseAction, CaseStatus[]>> = {
  EDIT_APPLICATION: ['DRAFT', 'PENDING_CUSTOMER_CLARIFICATION'],
  ATTACH_PRETRADE_DOCUMENT: ['DRAFT', 'UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION'],
  REMOVE_PRETRADE_DOCUMENT: ['DRAFT', 'UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION'],
  SEND_DOCUMENTS: ['UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION', 'DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION'],
  // The client's post-shipment application: prepared while the case stands approved, corrected while the bank examines it.
  START_POST_SHIPMENT: ['AUTHORIZED_FOR_ISSUANCE', 'LC_ISSUED'],
  ATTACH_PRESENTATION_DOCUMENT: ['AUTHORIZED_FOR_ISSUANCE', 'LC_ISSUED', 'DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION'],
  REMOVE_PRESENTATION_DOCUMENT: ['AUTHORIZED_FOR_ISSUANCE', 'LC_ISSUED'],
  SUBMIT_POST_SHIPMENT: ['AUTHORIZED_FOR_ISSUANCE', 'LC_ISSUED'],
  REQUEST_CLARIFICATION: ['DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION'],
  ADD_MANUAL_FINDING: ['DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION'],
  SUBMIT: ['DRAFT'],
  WITHDRAW: ['DRAFT', 'UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION', 'APPROVAL_PENDING'],
  REVALIDATE: ['UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION', 'APPROVAL_PENDING'],
  RAISE_QUERY: ['UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION', 'APPROVAL_PENDING', 'DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION'],
  RESPOND_QUERY: ['UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION', 'APPROVAL_PENDING', 'DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION'],
  RESOLVE_QUERY: ['UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION', 'APPROVAL_PENDING', 'DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION'],
  RECORD_CREDIT_FACILITY: ['UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION'],
  REQUEST_APPROVAL: ['UNDER_REVIEW'],
  APPROVE: ['APPROVAL_PENDING'],
  APPROVE_PRESHIPMENT: ['UNDER_REVIEW'],
  REJECT: ['UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION', 'APPROVAL_PENDING'],
  CANCEL: ['AUTHORIZED_FOR_ISSUANCE'],
  RECORD_ISSUANCE: ['AUTHORIZED_FOR_ISSUANCE'],
  RECORD_PRESENTATION: ['AUTHORIZED_FOR_ISSUANCE', 'LC_ISSUED'],
  // Examined again after a correction, so a discrepant presentation can be re-examined.
  EXAMINE_PRESENTATION: ['DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION'],
  APPLICANT_WAIVER: ['DISCREPANCY_RESOLUTION'],
  // A complying examination is decided from DOCUMENT_EXAMINATION; a discrepant one after resolution.
  DECIDE_PRESENTATION: ['DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION'],
  RECORD_SETTLEMENT: ['AWAITING_SETTLEMENT'],
  OPEN_INVESTIGATION: ['LC_ISSUED', 'DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION', 'AWAITING_SETTLEMENT', 'SETTLED_MONITORING'],
  CLOSE_INVESTIGATION: ['UNDER_INVESTIGATION'],
  CLOSE_CASE: ['SETTLED_MONITORING'],
  // Amendments run alongside an issued credit, before a presentation is received.
  REQUEST_AMENDMENT: ['LC_ISSUED'],
  SUBMIT_AMENDMENT: ['LC_ISSUED'],
  DECIDE_AMENDMENT: ['LC_ISSUED'],
  ISSUE_AMENDMENT: ['LC_ISSUED'],
  AMENDMENT_BENEFICIARY_RESPONSE: ['LC_ISSUED'],
};

/** The permission each action needs. Some actions accept either of two (see the service). */
export const ACTION_PERMISSIONS: Record<CaseAction, Permission[]> = {
  VIEW: ['tradecase.view.own', 'tradecase.view.assigned', 'tradecase.view.all'],
  CREATE: ['tradecase.create'],
  EDIT_APPLICATION: ['tradecase.application.edit'],
  ATTACH_PRETRADE_DOCUMENT: ['tradecase.document.attach'],
  REMOVE_PRETRADE_DOCUMENT: ['tradecase.document.remove'],
  SEND_DOCUMENTS: ['tradecase.submit'],
  START_POST_SHIPMENT: ['tradecase.postshipment.apply'],
  ATTACH_PRESENTATION_DOCUMENT: ['tradecase.postshipment.apply'],
  REMOVE_PRESENTATION_DOCUMENT: ['tradecase.postshipment.apply'],
  SUBMIT_POST_SHIPMENT: ['tradecase.postshipment.apply'],
  REQUEST_CLARIFICATION: ['tradecase.presentation.examine'],
  ADD_MANUAL_FINDING: ['tradecase.presentation.examine'],
  SUBMIT: ['tradecase.submit'],
  WITHDRAW: ['tradecase.withdraw'],
  REVALIDATE: ['tradecase.revalidate'],
  RAISE_QUERY: ['tradecase.query.raise'],
  RESPOND_QUERY: ['tradecase.query.respond.customer', 'tradecase.query.respond.internal'],
  RESOLVE_QUERY: ['tradecase.query.resolve'],
  DISPOSITION_FINDING: ['tradecase.finding.disposition.data', 'tradecase.finding.disposition.credit'],
  DISPOSITION_COMPLIANCE_FINDING: ['tradecase.finding.disposition.compliance'],
  RECORD_CREDIT_FACILITY: ['tradecase.credit.record'],
  REQUEST_APPROVAL: ['tradecase.approval.request'],
  APPROVE: ['tradecase.approval.decide'],
  APPROVE_PRESHIPMENT: ['tradecase.preshipment.approve'],
  REJECT: ['tradecase.reject'],
  CANCEL: ['tradecase.cancel'],
  RECORD_ISSUANCE: ['tradecase.issuance.record'],
  RECORD_PRESENTATION: ['tradecase.presentation.record'],
  EXAMINE_PRESENTATION: ['tradecase.presentation.examine'],
  APPLICANT_WAIVER: ['tradecase.presentation.waive'],
  DECIDE_PRESENTATION: ['tradecase.presentation.decide'],
  RECORD_SETTLEMENT: ['tradecase.settlement.record'],
  OPEN_INVESTIGATION: ['tradecase.investigation.open'],
  CLOSE_INVESTIGATION: ['tradecase.investigation.close'],
  CLOSE_CASE: ['tradecase.close'],
  REQUEST_AMENDMENT: ['tradecase.amendment.request'],
  SUBMIT_AMENDMENT: ['tradecase.amendment.submit'],
  DECIDE_AMENDMENT: ['tradecase.amendment.approve'],
  ISSUE_AMENDMENT: ['tradecase.amendment.issue'],
  AMENDMENT_BENEFICIARY_RESPONSE: ['tradecase.amendment.beneficiary_response'],
};

export interface ChecklistItem {
  itemId: string;
  label: string;
  ruleId: string | null;
  /** Only required when the named condition holds (evaluated by the service). */
  condition?: 'AMOUNT_AT_OR_ABOVE_EXPORTER_REPORT_THRESHOLD';
}

const departmentEnum = z.enum(DEPARTMENTS);

const PolicySchema = z.object({
  version: z.string().min(1),
  requiredReviews: z.array(departmentEnum).min(1),
  requiredApplicationFields: z.array(z.string()).min(1),
  checklists: z.record(
    departmentEnum,
    z.array(z.object({ itemId: z.string(), label: z.string(), ruleId: z.string().nullable(), condition: z.literal('AMOUNT_AT_OR_ABOVE_EXPORTER_REPORT_THRESHOLD').optional() })),
  ),
  separationOfDuties: z.object({
    approverNotMaker: z.boolean(),
    approverNotReviewerOf: z.array(departmentEnum),
    issuerNotApprover: z.boolean(),
    presentationDeciderNotPresenter: z.boolean(),
    settlementNotIssuer: z.boolean(),
    amendmentApproverNotMaker: z.boolean(),
    amendmentIssuerNotApprover: z.boolean(),
    investigationCloserNotOpener: z.boolean(),
  }),
  /** Finding categories that only compliance roles may disposition, and that a revalidation never clears. */
  complianceCategories: z.array(z.string()),
  tolerances: z.object({
    amountAbsolute: z.number().min(0),
    quantityPercent: z.number().min(0),
    unitPricePercent: z.number().min(0),
    postTradePriceDriftPercent: z.number().min(0),
  }),
  thresholds: z.object({
    exporterReportPkr: z.number().min(0),
    maxValidityMonths: z.number().int().min(1),
    maxUsanceDaysWithoutReview: z.number().int().min(0),
    materialAmountChangePercent: z.number().min(0),
  }),
});

export type WorkflowPolicy = z.infer<typeof PolicySchema> & {
  checklists: Record<Department, ChecklistItem[]>;
  complianceCategories: FindingCategory[];
};

export const DEFAULT_POLICY: WorkflowPolicy = {
  version: 'default-2026.10.21',
  requiredReviews: ['RM', 'TRADE_OPS', 'COMPLIANCE', 'CREDIT'],
  requiredApplicationFields: [
    'applicant.name',
    'applicant.country',
    'beneficiary.name',
    'beneficiary.address',
    'beneficiary.country',
    'proformaInvoiceNumber',
    'currency',
    'amount',
    'goodsDescription',
    'hsCode',
    'quantity',
    'unitOfMeasure',
    'unitPrice',
    'incoterm',
    'namedPlace',
    'countryOfOrigin',
    'portOfLoading',
    'portOfDischarge',
    'latestShipmentDate',
    'expiryDate',
    'paymentTerms',
    'requiredDocuments',
  ],
  checklists: {
    RM: [
      { itemId: 'RM-PROFILE', label: 'Transaction is consistent with the customer\'s known business activity', ruleId: null },
      { itemId: 'RM-PURPOSE', label: 'Purpose of the import understood and recorded', ruleId: null },
      { itemId: 'RM-SUPPLIER', label: 'Supplier relationship reviewed (new or established)', ruleId: null },
    ],
    TRADE_OPS: [
      { itemId: 'TO-FIRM-COMMITMENT', label: 'Firm commitment verified: PI/order issued or accepted by the supplier', ruleId: 'PK-FEM13-07-FIRM' },
      { itemId: 'TO-GOODS-PRICES', label: 'Full goods description with prices will appear in the credit', ruleId: 'PK-FEM13-07-FIRM' },
      { itemId: 'TO-ITC-CLASSIFICATION', label: 'Goods classifiable under the Import Trade Control schedules (HS code checked)', ruleId: null },
      { itemId: 'TO-IMPORT-POLICY', label: 'Goods importable under the current import policy order', ruleId: 'PK-FEM13-09-VALIDITY' },
      {
        itemId: 'TO-EXPORTER-REPORT',
        label: 'Bank-obtained report on the exporter\'s standing on file',
        ruleId: 'PK-FEM13-07-REPORT',
        condition: 'AMOUNT_AT_OR_ABOVE_EXPORTER_REPORT_THRESHOLD',
      },
      { itemId: 'TO-LC-TERMS', label: 'Credit terms, documents, shipment and expiry reviewed', ruleId: 'PT-DATE-ORDER' },
    ],
    COMPLIANCE: [
      { itemId: 'CO-SANCTIONS', label: 'Party and jurisdiction screening results reviewed', ruleId: 'CMP-SANCTIONS-PARTY' },
      { itemId: 'CO-TBML', label: 'TBML indicators reviewed and dispositioned', ruleId: 'TBML-PI-INDICATOR' },
      { itemId: 'CO-DUAL-USE', label: 'Goods checked for controlled / dual-use concerns', ruleId: null },
    ],
    CREDIT: [
      { itemId: 'CR-FACILITY', label: 'Facility verified in the credit system and recorded', ruleId: 'CRD-FACILITY' },
      { itemId: 'CR-MARGIN', label: 'Cash margin / collateral requirement met', ruleId: 'CRD-FACILITY' },
    ],
  },
  separationOfDuties: {
    approverNotMaker: true,
    approverNotReviewerOf: ['TRADE_OPS'],
    issuerNotApprover: true,
    presentationDeciderNotPresenter: true,
    settlementNotIssuer: true,
    amendmentApproverNotMaker: true,
    amendmentIssuerNotApprover: true,
    investigationCloserNotOpener: true,
  },
  complianceCategories: ['COMPLIANCE_ALERT', 'TBML_RED_FLAG', 'REGULATORY_CONCERN'],
  tolerances: {
    amountAbsolute: 0.01,
    quantityPercent: 0,
    unitPricePercent: 0.01,
    postTradePriceDriftPercent: 5,
  },
  thresholds: {
    exporterReportPkr: 1_500_000,
    maxValidityMonths: 12,
    maxUsanceDaysWithoutReview: 180,
    materialAmountChangePercent: 10,
  },
};

let active: WorkflowPolicy | null = null;

/** The policy in force: the default, or the bank's file merged over it (top-level keys replace). */
export function getWorkflowPolicy(): WorkflowPolicy {
  if (active) return active;
  const file = process.env['TRADE_WORKFLOW_POLICY_FILE']?.trim();
  if (!file) {
    active = DEFAULT_POLICY;
    return active;
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  if ('permissions' in raw || 'reviewRoles' in raw) {
    throw new Error('TRADE_WORKFLOW_POLICY_FILE: "permissions" and "reviewRoles" are no longer workflow policy; role permissions live in the central registry (authorization/permissions.ts).');
  }
  const merged = { ...DEFAULT_POLICY, ...raw };
  const parsed = PolicySchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(`TRADE_WORKFLOW_POLICY_FILE is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  active = merged as WorkflowPolicy;
  log.info('trade workflow policy loaded', { file, version: active.version });
  return active;
}

/** Test seam: run with a modified policy, then restore. */
export function setWorkflowPolicyForTesting(policy: WorkflowPolicy | null): void {
  active = policy;
}
