import crypto from 'node:crypto';
import { config } from '../config';
import { z } from 'zod';
import { SanctionsEngine } from '../compliance/sanctions';
import type { SanctionsScreeningResult } from '../compliance/types';
import type { AuthenticatedUser } from '../middleware/auth.middleware';
import { DEPARTMENT_PERMISSION, hasAnyPermission, hasPermission, isConsolidatedRole, type Permission } from '../authorization/permissions';
import { getRepository as getDocumentRepository } from '../services/document.repository';
import { analysisEvents } from '../services/analysis.service';
import { getDocumentService, type UploadedFile } from '../services/document.service';
import { KeyedMutex, backoffDelay, sleep } from '../utils/async';
import { computeContentHash } from '../utils/fingerprint';
import { FINDING_CLASS_LABELS, buildComparison, classifyFinding, crossVerifyPresentation, type ApprovedDocument, type VerifiedDocument } from './post-shipment-verification';
import { AppError, Errors, describeUnknown } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { getLcIssuanceAdapter, validateFinancialInstrument } from './lc-issuance.adapter';
import { evaluatePresentation, type PresentedDocument } from './presentation-examination';
import { evaluateAmendment, evaluatePreTrade, fieldLabel, type PiContext } from './pretrade-validation';
import { candidate, getField, isMissing, type CandidateFinding } from './rule-helpers';
import { RULES, RULE_SET_VERSION, type RuleDefinition } from './rule-registry';
import type { TradeComplianceAnalysis } from '../compliance/types';
import { getTradeCaseRepository, verifyChain } from './trade-case.repository';
import type { ChainVerification } from '../utils/hash-chain';
import {
  DEPARTMENTS,
  PRE_TRADE_DOCUMENT_TYPES,
  PRESENTATION_DOCUMENT_TYPES,
  type ActorRef,
  type Amendment,
  type CaseDocument,
  type CreditOfRecord,
  type FindingSeverity,
  type CaseDocumentType,
  type Classification,
  type PreTradeDocumentType,
  type ScrutinyRun,
  type ScrutinyStep,
  type CaseStatus,
  type Department,
  type Finding,
  type FindingCategory,
  type FindingDispositionCode,
  type LcApplicationData,
  type PresentationDocumentType,
  type Review,
  type ScreeningSummary,
  type TradeCase,
  type TradeCaseEvent,
} from './trade-case.types';
import { blanksToFill, fieldsFromAnalysis, isDocumentsOnly, type ApplicationFill } from './application-from-documents';
import { currentVerificationPolicy, enforcementOf, mandatorySources } from '../verification/governance';
import { buildVerificationReportModel, renderVerificationReportPdf, type ReportRuleMode } from '../verification/verification-report';
import { hsReferenceHealth } from '../verification/hs/hs-reference';
import { PctStore } from '../verification/pct/pct-store';
import { SOURCE_CATALOGUE } from '../verification/source-catalogue';
import { runExternalVerification, type VerifiableDocument } from '../verification/verification.service';
import type { ExternalSourceEntry, SourceHealth, VerificationRun, VerificationRunSummary } from '../verification/verification.types';
import { AiUnavailable, classifyDocument, draftCustomerMail, reviewCase, reviewDocument, reviewPresentation, type CaseDocumentDigest, type MailIssue, type PresentationDigest } from './preshipment-ai.service';
import { digestFacts, readDocumentText } from './document-text';
import { ACTION_PERMISSIONS, STATE_TRANSITIONS, getWorkflowPolicy, type CaseAction, type WorkflowPolicy } from './workflow.policy';

const log = createLogger('trade-cases');

/**
 * The import LC lifecycle: request, document intake, validation, departmental review, queries,
 * maker-checker approval, issuance, presentation, examination, settlement, investigation, closure.
 *
 * Every rule about *who* may do *what* *when* is enforced here, on the server: the permission
 * (central registry, ACTION_PERMISSIONS), the case's scope (own customer / assigned customers /
 * institution), its status (STATE_TRANSITIONS) and separation of duties (policy.separationOfDuties).
 * What a user may *see* of a case is decided here too (toView): compliance, credit and investigation
 * detail is removed for users without the matching permission before anything leaves the server.
 * The UI only hides what this would refuse anyway.
 *
 * Nothing here talks to a real bank system. Issuance goes through the adapter (sandbox only);
 * credit figures are recorded with their source; settlement is recorded, never initiated.
 */

// ------------------------------------------------------------------------------------------ input

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'dates are YYYY-MM-DD')
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), 'not a real date');
const text = (max: number) => z.string().trim().max(max);
const party = z.object({ name: text(200), address: text(400), country: text(80) }).partial();

const ApplicationSchema = z
  .object({
    applicant: party,
    beneficiary: party,
    purpose: text(1000),
    proformaInvoiceNumber: text(80),
    currency: z.string().trim().toUpperCase().regex(/^([A-Z]{3})?$/, 'currency is a 3-letter ISO code'),
    amount: z.number().positive().max(1e12).nullable(),
    amountTolerancePercent: z.number().min(0).max(10),
    goodsDescription: text(2000),
    hsCode: z.string().trim().regex(/^(\d{4}(\.?\d{2}){0,3})?$/, 'HS code is 4–10 digits'),
    quantity: z.number().positive().max(1e12).nullable(),
    unitOfMeasure: z.string().trim().toUpperCase().max(20),
    unitPrice: z.number().positive().max(1e12).nullable(),
    incoterm: z.string().trim().toUpperCase().refine((v) => v === '' || INCOTERMS.includes(v), 'unknown Incoterm'),
    namedPlace: text(120),
    countryOfOrigin: text(80),
    portOfLoading: text(120),
    portOfDischarge: text(120),
    partialShipments: z.enum(['ALLOWED', 'NOT_ALLOWED', '']),
    transshipment: z.enum(['ALLOWED', 'NOT_ALLOWED', '']),
    latestShipmentDate: isoDate.nullable(),
    expiryDate: isoDate.nullable(),
    presentationPeriodDays: z.number().int().min(1).max(90),
    paymentTerms: z.enum(['SIGHT', 'USANCE', '']),
    usanceDays: z.number().int().min(1).max(720).nullable(),
    requiredDocuments: z.array(z.enum(PRESENTATION_DOCUMENT_TYPES)).max(10),
  })
  .partial()
  .strict();

export type ApplicationInput = z.infer<typeof ApplicationSchema>;

export const EMPTY_APPLICATION: LcApplicationData = {
  applicant: { name: '', address: '', country: '' },
  beneficiary: { name: '', address: '', country: '' },
  purpose: '',
  proformaInvoiceNumber: '',
  currency: '',
  amount: null,
  amountTolerancePercent: 0,
  goodsDescription: '',
  hsCode: '',
  quantity: null,
  unitOfMeasure: '',
  unitPrice: null,
  incoterm: '',
  namedPlace: '',
  countryOfOrigin: '',
  portOfLoading: '',
  portOfDischarge: '',
  partialShipments: '',
  transshipment: '',
  latestShipmentDate: null,
  expiryDate: null,
  presentationPeriodDays: 21,
  paymentTerms: '',
  usanceDays: null,
  requiredDocuments: [],
};

function parseApplication(input: unknown): ApplicationInput {
  const parsed = ApplicationSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw Errors.validation(`The application is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'application'}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}

function mergeApplication(base: LcApplicationData, changes: ApplicationInput): LcApplicationData {
  return {
    ...base,
    ...changes,
    applicant: { ...base.applicant, ...(changes.applicant ?? {}) },
    beneficiary: { ...base.beneficiary, ...(changes.beneficiary ?? {}) },
  } as LcApplicationData;
}

const FIELD_PATHS = [
  'applicant.name', 'applicant.address', 'applicant.country', 'beneficiary.name', 'beneficiary.address', 'beneficiary.country',
  'purpose', 'proformaInvoiceNumber', 'currency', 'amount', 'amountTolerancePercent', 'goodsDescription', 'hsCode', 'quantity',
  'unitOfMeasure', 'unitPrice', 'incoterm', 'namedPlace', 'countryOfOrigin', 'portOfLoading', 'portOfDischarge', 'partialShipments',
  'transshipment', 'latestShipmentDate', 'expiryDate', 'presentationPeriodDays', 'paymentTerms', 'usanceDays', 'requiredDocuments',
];

function changedFields(before: LcApplicationData, after: LcApplicationData): string[] {
  return FIELD_PATHS.filter((p) => JSON.stringify(getField(before, p)) !== JSON.stringify(getField(after, p)));
}

/** Which departments must look again when a field changes. */
function departmentsAffectedBy(fields: string[]): Department[] {
  const affected = new Set<Department>();
  for (const f of fields) {
    affected.add('TRADE_OPS');
    if (/^(amount|currency|unitPrice|quantity|beneficiary|applicant|goodsDescription|hsCode|countryOfOrigin|portOf)/.test(f)) affected.add('COMPLIANCE');
    if (/^(amount|currency|amountTolerancePercent|paymentTerms|usanceDays|expiryDate)/.test(f)) affected.add('CREDIT');
    if (/^(beneficiary|applicant|purpose|amount)/.test(f)) affected.add('RM');
  }
  return [...affected];
}

// ------------------------------------------------------------------------------------------ helpers

const PRE_ISSUANCE_REVALIDATION: CaseStatus[] = ['DRAFT', 'UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION', 'APPROVAL_PENDING'];
const TERMINAL_STATUSES: CaseStatus[] = ['CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'];
/** Never shown to a customer: disclosing a suspicion or a credit view is tipping-off or a confidentiality breach. */
const INTERNAL_CATEGORIES: FindingCategory[] = ['COMPLIANCE_ALERT', 'TBML_RED_FLAG', 'REGULATORY_CONCERN', 'CREDIT_BLOCKER'];

const ALLOWED_DISPOSITIONS: Record<FindingCategory, FindingDispositionCode[]> = {
  MISSING_INFORMATION: ['JUSTIFIED'],
  DATA_INCONSISTENCY: ['JUSTIFIED'],
  LC_TERM_ISSUE: ['JUSTIFIED'],
  DOCUMENT_QUALITY: ['VERIFIED_MANUALLY'],
  LOW_CONFIDENCE_EXTRACTION: ['VERIFIED_MANUALLY'],
  OPERATIONAL: ['VERIFIED_MANUALLY'],
  CREDIT_BLOCKER: ['JUSTIFIED'],
  REGULATORY_CONCERN: ['JUSTIFIED', 'CHECKPOINT_CONFIRMED', 'CONFIRMED_ESCALATED'],
  COMPLIANCE_ALERT: ['FALSE_POSITIVE', 'RISK_ACCEPTED', 'CONFIRMED_ESCALATED'],
  TBML_RED_FLAG: ['FALSE_POSITIVE', 'RISK_ACCEPTED', 'CONFIRMED_ESCALATED'],
  // Decided through the presentation decision, with the applicant's waiver.
  DOCUMENTARY_DISCREPANCY: [],
};

function actorRef(user: AuthenticatedUser): ActorRef {
  return { id: user.id, name: user.name, role: user.role };
}

function forbidden(message: string): AppError {
  return new AppError({ status: 403, code: 'FORBIDDEN', message });
}

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

const RESTRICTED_TITLE = 'Restricted compliance matter';

function stateConflict(message: string, details?: Record<string, unknown>): AppError {
  return new AppError({ status: 409, code: 'INVALID_STATE', message, ...(details ? { details } : {}) });
}

/** The refusal for a file that is already current on the request or application it is being added to. */
function alreadyOnRequest(same: CaseDocument, where: 'on this request' | 'in this application'): AppError {
  return new AppError({
    status: 409,
    code: 'DOCUMENT_ALREADY_ON_REQUEST',
    message: `This is the same file as "${same.filename}", which is already ${where}, so it was not uploaded again. If you changed anything in it, save it as a new file and upload that.`,
    details: { linkId: same.linkId, filename: same.filename },
  });
}

function requireText(value: unknown, what: string, min = 10, max = 4000): string {
  const textValue = typeof value === 'string' ? value.trim() : '';
  if (textValue.length < min) throw Errors.validation(`${what} is required (at least ${min} characters).`);
  return textValue.slice(0, max);
}

/** A finding that, as it stands, stops the case moving on. */
export function blocksNow(f: Finding): boolean {
  if (!f.blocking) return false;
  if (f.status === 'OPEN') return true;
  return f.disposition?.code === 'CONFIRMED_ESCALATED' || f.disposition?.code === 'DISCREPANCY_UPHELD';
}

function findingsDigest(findings: Finding[]): string {
  const summary = findings.map((f) => `${f.findingId}:${f.status}:${f.disposition?.code ?? ''}:${f.blocking}`).sort().join('|');
  return crypto.createHash('sha256').update(summary).digest('hex');
}

function currentApplication(c: TradeCase): LcApplicationData {
  return c.applicationVersions[c.applicationVersions.length - 1]!.data;
}

/**
 * Every country the screening was given, with its result. The engine reports only the countries it
 * found a concern about, so one it checked and found clear is "CLEAR" here. A country with no name
 * was not checked and is left out rather than shown as clear.
 */
/** The vessel and IMO number the documents state, as the sanctions screening takes them. "Not Found" is the extractor's blank. */
function declaredVessel(documents: VerifiableDocument[]): { name: string | null; imo: string | null } {
  const pick = (read: (d: VerifiableDocument) => unknown): string | null => {
    for (const d of documents) {
      const v = typeof read(d) === 'string' ? (read(d) as string).trim() : '';
      if (v && !/^not found$/i.test(v)) return v;
    }
    return null;
  };
  return { name: pick((d) => d.route?.vesselName), imo: pick((d) => d.route?.vesselImo) };
}

function coverage(
  nodes: Array<{ role: string; country: string | null | undefined }>,
  risks: Array<{ nodeRole: string; countryName: string; sanctionsStatus: string; description?: string }>,
): Array<{ role: string; country: string; status: string; description: string }> {
  const seen = new Set<string>();
  const out: Array<{ role: string; country: string; status: string; description: string }> = [];
  for (const node of nodes) {
    const country = (node.country ?? '').trim();
    if (!country || /^(not found|not specified|n\/a|unknown)/i.test(country)) continue;
    const key = `${node.role}:${country.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lower = country.toLowerCase();
    const risk = risks.find((r) => r.nodeRole === node.role && (r.countryName.toLowerCase() === lower || r.countryName.toLowerCase().includes(lower) || lower.includes(r.countryName.toLowerCase())));
    out.push({ role: node.role, country: risk?.countryName ?? country, status: risk?.sanctionsStatus ?? 'CLEAR', description: risk?.description ?? '' });
  }
  return out;
}

/**
 * The current application with every field the analysis itself filled put back to blank. A field
 * counts as the analysis's when the last version that changed it was the analysis's; anything a
 * person entered, at filing or in a correction, stays.
 */
function withoutMachineFields(c: TradeCase): LcApplicationData {
  const owner = new Map<string, 'SYSTEM' | 'PERSON'>();
  for (const v of c.applicationVersions) for (const path of v.changedFields) owner.set(path, v.createdBy === 'SYSTEM' ? 'SYSTEM' : 'PERSON');
  const out = structuredClone(currentApplication(c)) as unknown as Record<string, unknown>;
  for (const [path, who] of owner) {
    if (who !== 'SYSTEM') continue;
    const blank = getField(EMPTY_APPLICATION, path);
    const [head, tail] = path.split('.');
    if (tail) (out[head!] as Record<string, unknown>)[tail] = blank;
    else out[head!] = blank;
  }
  return out as unknown as LcApplicationData;
}

/** A scrutiny run that has been "running" this long is taken to have died with its process, and may be started again. */
const STALE_RUN_MS = 15 * 60_000;
const ANALYSIS_WAIT_MS = 5 * 60_000;
/** How many times the model is asked to read one document before the step reports the AI as unavailable. */
const MODEL_READ_ATTEMPTS = 3;

const DOCUMENT_LABELS: Record<string, string> = {
  PROFORMA_INVOICE: 'Proforma invoice',
  PURCHASE_CONTRACT: 'Purchase contract',
  PURCHASE_ORDER: 'Purchase order',
  IMPORT_PERMIT: 'Import permit',
  LC_APPLICATION_FORM: 'LC application form',
  OTHER_SUPPORTING: 'Supporting document',
};

/**
 * Findings about the same problem, from different sources, become one point of the message. The topics
 * are the ones the same fact is usually reported under: the arithmetic of an invoice, the credit's dates,
 * the documents required. Anything else stands on its own.
 */
const POINT_TOPICS: Array<[string, RegExp]> = [
  ['arithmetic', /arithmetic|reconcil|sub-?total|line total|sum of the line|add up|quantity.{0,40}unit price/i],
  ['credit-dates', /expiry|latest shipment|shipment date|presentation period/i],
  ['required-documents', /documents required/i],
];

function groupMailPoints(issues: MailIssue[]): MailIssue[] {
  const out: MailIssue[] = [];
  const byTopic = new Map<string, MailIssue>();
  for (const issue of issues) {
    const topic = POINT_TOPICS.find(([, pattern]) => pattern.test(`${issue.title} ${issue.detail}`))?.[0];
    const existing = topic ? byTopic.get(topic) : undefined;
    if (!topic || !existing) {
      const point = { ...issue };
      out.push(point);
      if (topic) byTopic.set(topic, point);
    } else {
      // Same problem again: keep what the first said, add only what is new.
      if (!existing.detail.includes(issue.detail)) existing.detail = `${existing.detail} ${issue.detail}`;
      if (!existing.action && issue.action) existing.action = issue.action;
    }
  }
  return out;
}

/** A current document the customer added after the request (or the application) was sent and has not yet sent to the bank. */
function awaitingSend(c: TradeCase): CaseDocument[] {
  return c.documents.filter((d) => !d.supersededByLinkId && d.sentToBankAt === null);
}

/**
 * The key that joins an approved request, its approved documents, its post-shipment application and the bank's
 * decision. Stored when the approval is granted; for a request approved before it existed it is recomputed the same way.
 */
export function preShipmentReferenceOf(c: TradeCase): string | null {
  if (c.preShipmentReference?.reference) return c.preShipmentReference.reference;
  const approved = c.approvals.some((a) => a.status === 'APPROVED') || POST_SHIPMENT_STATUSES.includes(c.status);
  return approved ? `PSR-${c.caseId.replace(/^TC-/, '')}` : null;
}

function assignPreShipmentReference(c: TradeCase, actor: ActorRef | 'SYSTEM'): string {
  if (!c.preShipmentReference) c.preShipmentReference = { reference: `PSR-${c.caseId.replace(/^TC-/, '')}`, assignedAt: new Date().toISOString(), assignedBy: actor };
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
function presentationSummary(c: TradeCase, p: TradeCase['presentations'][number]): Record<string, unknown> {
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

/** Whether the AI's comparison of the documents covers exactly the documents that are current now. */
function caseReviewIsCurrent(c: TradeCase): boolean {
  const review = c.caseReview;
  if (!review) return false;
  const current = c.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId).map((d) => d.documentId);
  return review.documentIds.length === current.length && current.every((id) => review.documentIds.includes(id));
}

/** A finding raised from an AI review, as opposed to a rule or an engine. */
/**
 * Evidence compared for "has it changed": the time an official file was fetched, and whether it was stale
 * when fetched, are left out. A routine refresh of an unchanged reference must not reopen a finding an officer
 * already decided; a different file (its hash) or different wording does.
 */
function stableEvidence(observed: Finding['observed']): string {
  return JSON.stringify(observed.map((e) => (e.source === 'EXTERNAL_SOURCE' ? { ...e, snippet: (e.snippet ?? '').replace(/^Retrieved [^·]*· /, '').replace(/ · STALE.*$/, '') } : e)));
}

/** A finding from external verification that the customer cannot act on stays with the bank. */
function officerOnly(f: Finding): boolean {
  return f.origin === 'EXTERNAL_VERIFICATION' && !f.customerFixable;
}

/** An AI point on a presented document stays with the examiner until they include it in a request to the client. */
function unconfirmedPostShipmentAi(c: TradeCase, f: Finding): boolean {
  return f.stage === 'POST_TRADE' && f.origin === 'AI_ASSISTED_EXTRACTION' && !c.queries.some((q) => q.assignee === 'CUSTOMER' && q.findingIds.includes(f.findingId));
}

function isAiFinding(f: Finding): boolean {
  return f.origin === 'AI_ASSISTED_EXTRACTION' && f.ruleId.startsWith('AI-');
}

function withoutModelNote(description: string): string {
  return description.replace(/\s*\(AI review by [^)]*\)\s*$/, '');
}

/** Where a document's trade fields came from (the model, the built-in parser, or an older analysis). */
function extractionSourceOf(analysis: { engine: { tradeExtractionSource?: string; provider: string } } | null | undefined): TradeCase['validation']['piExtractionSource'] {
  if (!analysis) return 'NOT_AVAILABLE';
  return (analysis.engine.tradeExtractionSource ?? (analysis.engine.provider === 'heuristic' ? 'DETERMINISTIC_PARSER' : 'UNKNOWN_LEGACY_ANALYSIS')) as TradeCase['validation']['piExtractionSource'];
}

/** True when the model read the document, or when the platform is configured to accept the parser (tests only). */
function readByModel(analysis: { engine: { tradeExtractionSource?: string; provider: string } } | null | undefined): boolean {
  if (!analysis) return false;
  return !config.preshipment.requireAi || extractionSourceOf(analysis) === 'AI_MODEL';
}

function activeDocument(c: TradeCase, type: CaseDocumentType): CaseDocument | null {
  const candidates = c.documents.filter((d) => d.documentType === type && !d.supersededByLinkId);
  return candidates[candidates.length - 1] ?? null;
}

function setStatus(c: TradeCase, to: CaseStatus, actor: ActorRef | 'SYSTEM', reason: string): void {
  if (c.status === to) return;
  c.statusHistory.push({ from: c.status, to, at: new Date().toISOString(), actor, reason });
  c.status = to;
}

function reviewHistory(review: Review, actor: ActorRef | 'SYSTEM', status: Review['status'], note: string): void {
  review.status = status;
  review.history.push({ at: new Date().toISOString(), actor, status, note });
}

// ------------------------------------------------------------------------------------------ service

export interface CaseMutationResult {
  tradeCase: TradeCase;
  event: TradeCaseEvent;
}

export class TradeCaseService {
  private readonly mutex = new KeyedMutex();
  private readonly sanctions = new SanctionsEngine();

  private get repo() {
    return getTradeCaseRepository();
  }

  private get policy(): WorkflowPolicy {
    return getWorkflowPolicy();
  }

  // ---------------------------------------------------------------- authorisation

  private authorize(user: AuthenticatedUser, action: CaseAction, c?: TradeCase): void {
    if (!hasAnyPermission(user, ACTION_PERMISSIONS[action])) {
      throw forbidden(`You do not have permission to ${action.replace(/_/g, ' ').toLowerCase()}.`);
    }
    if (c) this.assertOwnership(user, c);
    if (c && action !== 'VIEW' && TERMINAL_STATUSES.includes(c.status)) {
      throw stateConflict(`This case is ${c.status.toLowerCase()} and can no longer change.`);
    }
    if (c && STATE_TRANSITIONS[action] && !STATE_TRANSITIONS[action]!.includes(c.status)) {
      throw stateConflict(`This case is ${c.status.replace(/_/g, ' ').toLowerCase()}; "${action.replace(/_/g, ' ').toLowerCase()}" is not possible now.`, {
        status: c.status,
        allowedFrom: STATE_TRANSITIONS[action],
      });
    }
  }

  /** A case outside the user's scope does not exist for them (404, not 403: no existence leak). */
  private assertOwnership(user: AuthenticatedUser, c: TradeCase): void {
    if (!canViewCase(user, c)) throw Errors.notFound('trade case');
  }

  private assertDepartmentRole(user: AuthenticatedUser, department: Department): void {
    if (!hasPermission(user, DEPARTMENT_PERMISSION[department])) {
      throw forbidden(`You do not act for ${department.replace(/_/g, ' ')}.`);
    }
  }

  private require(user: AuthenticatedUser, permission: Permission, what: string): void {
    if (!hasPermission(user, permission)) throw forbidden(`You do not have permission to ${what}.`);
  }

  // ---------------------------------------------------------------- write path

  /**
   * Read, change, save with the revision guard, then append the audit event. Serialised per case
   * in-process; the revision check catches writers in other processes. Where the store has
   * transactions the save and the event are one unit; otherwise they are two writes, and a failure
   * between them is reported by `writeEvent` and flagged by chain verification.
   */
  private mutate(
    caseId: string,
    actor: ActorRef | 'SYSTEM',
    action: string,
    work: (c: TradeCase) => Promise<Record<string, unknown>> | Record<string, unknown>,
    /** For a change that is not work on the case (a display choice): the case keeps its "last updated" time. */
    keepUpdatedAt = false,
  ): Promise<CaseMutationResult> {
    return this.mutex.run(caseId, async () => {
      const current = await this.repo.findById(caseId);
      if (!current) throw Errors.notFound('trade case');
      const before = current.status;
      const revision = current.revision;
      const next = structuredClone(current);
      const detail = await work(next);
      // The event is prepared first so the case carries the new chain head in the same write.
      const event = await this.repo.prepareEvent(this.eventInput(next.caseId, actor, action, before, next.status, detail));
      next.auditHead = { seq: event.seq, hash: event.hash };
      next.revision = revision + 1;
      if (!keepUpdatedAt) next.updatedAt = new Date().toISOString();
      if (this.repo.atomic && this.repo.commit) {
        await this.repo.commit(next, revision, event);
      } else {
        await this.repo.replace(next, revision);
        await this.writeEvent(event);
      }
      return { tradeCase: next, event };
    });
  }

  private eventInput(caseId: string, actor: ActorRef | 'SYSTEM', action: string, from: CaseStatus | null, to: CaseStatus | null, detail: Record<string, unknown>) {
    return {
      caseId,
      at: new Date().toISOString(),
      actor: actor === 'SYSTEM' ? { id: 'system' as const, name: 'Trade lifecycle engine', role: 'SYSTEM' as const } : actor,
      action,
      fromStatus: from,
      toStatus: to,
      detail,
      ruleSetVersion: RULE_SET_VERSION,
    };
  }

  private async writeEvent(event: TradeCaseEvent): Promise<void> {
    try {
      await this.repo.insertEvent(event);
    } catch (error) {
      // The case already carries the new chain head, so verification reports the missing entry.
      // Say so loudly rather than pretend the log is complete.
      log.error('AUDIT EVENT NOT WRITTEN — case change saved without its audit entry', { caseId: event.caseId, action: event.action, seq: event.seq, error: describeUnknown(error) });
      throw new AppError({
        status: 503,
        code: 'AUDIT_WRITE_FAILED',
        message: 'The change was saved but its audit entry could not be written. The audit check will show the gap; operations has been alerted in the logs.',
        retryable: false,
      });
    }
  }

  // ---------------------------------------------------------------- create & edit

  async createCase(
    user: AuthenticatedUser,
    input: { customerRef?: unknown; clientRequestId?: unknown; application?: unknown },
  ): Promise<{ tradeCase: TradeCase; created: boolean }> {
    this.authorize(user, 'CREATE');
    const ownOnly = isCustomerView(user);
    const customerRef = ownOnly ? user.customerRef : typeof input.customerRef === 'string' ? input.customerRef.trim() : '';
    if (!customerRef || !/^[A-Za-z0-9._-]{3,64}$/.test(customerRef)) {
      throw Errors.validation(ownOnly ? 'Your login is not linked to a customer record.' : 'customerRef (3–64 letters, digits, . _ -) is required.');
    }
    // An RM files only for assigned customers; the request body cannot widen the scope.
    if (!canViewCase(user, { customerRef })) throw forbidden('That customer is not within your assigned scope.');
    const clientRequestId = typeof input.clientRequestId === 'string' && input.clientRequestId.trim() ? input.clientRequestId.trim().slice(0, 100) : null;
    if (clientRequestId) {
      const existing = await this.repo.findByClientRequest(customerRef, clientRequestId);
      if (existing) return { tradeCase: existing, created: false };
    }
    const application = mergeApplication(EMPTY_APPLICATION, parseApplication(input.application));
    const now = new Date();
    const number = await this.repo.nextCaseNumber(now.getUTCFullYear());
    const caseId = `TC-${now.getUTCFullYear()}-${String(number).padStart(5, '0')}`;
    const actor = actorRef(user);
    const reviews = Object.fromEntries(
      DEPARTMENTS.map((d) => {
        const required = this.policy.requiredReviews.includes(d);
        const review: Review = {
          department: d,
          required,
          status: required ? 'PENDING' : 'NOT_REQUIRED',
          checklist: {},
          decidedBy: null,
          decidedAt: null,
          rationale: '',
          applicationVersion: null,
          history: [],
        };
        return [d, review];
      }),
    ) as Record<Department, Review>;

    const tradeCase: TradeCase = {
      caseId,
      revision: 1,
      transactionType: 'IMPORT_LC',
      customerRef,
      clientRequestId,
      status: 'DRAFT',
      statusHistory: [{ from: null, to: 'DRAFT', at: now.toISOString(), actor, reason: 'Import request created' }],
      applicationVersions: [{ version: 1, createdAt: now.toISOString(), createdBy: actor, reason: 'Initial application', data: application, changedFields: [] }],
      currentApplicationVersion: 1,
      documents: [],
      findings: [],
      reviews,
      queries: [],
      approvals: [],
      creditFacility: null,
      issuedLc: null,
      presentations: [],
      settlement: null,
      investigations: [],
      amendments: [],
      auditHead: null,
      validation: { lastRunAt: null, ruleSetVersion: RULE_SET_VERSION, piExtractionSource: 'NOT_AVAILABLE', piDocumentId: null, amountInPkr: null },      submittedApplicationVersion: null,
      createdBy: actor,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      submittedAt: null,
      closedAt: null,
      sequences: { finding: 0, query: 0, document: 0, approval: 0, presentation: 0, investigation: 0, amendment: 0 },
    };
    const firstEvent = await this.repo.prepareEvent(this.eventInput(caseId, actor, 'CASE_CREATED', null, 'DRAFT', { customerRef, clientRequestId, applicationVersion: 1 }));
    tradeCase.auditHead = { seq: firstEvent.seq, hash: firstEvent.hash };
    const atomic = this.repo.atomic && this.repo.createWithEvent !== undefined;
    try {
      if (atomic) await this.repo.createWithEvent!(tradeCase, firstEvent);
      else await this.repo.create(tradeCase);
    } catch (error) {
      // Two identical requests raced: the loser returns the winner's case rather than a second one.
      if (clientRequestId && error instanceof AppError && error.status === 409) {
        const winner = await this.repo.findByClientRequest(customerRef, clientRequestId);
        if (winner) return { tradeCase: winner, created: false };
      }
      throw error;
    }
    if (!atomic) await this.writeEvent(firstEvent);
    const { tradeCase: validated } = await this.revalidate(caseId, 'SYSTEM', 'Initial validation of the draft');
    return { tradeCase: validated, created: true };
  }

  async updateApplication(user: AuthenticatedUser, caseId: string, input: { changes?: unknown; reason?: unknown }): Promise<TradeCase> {
    const changes = parseApplication(input.changes);
    const reason = requireText(input.reason ?? 'Application updated', 'A reason for the change', 3, 500);
    const existing = await this.loadFor(user, 'EDIT_APPLICATION', caseId);
    this.applicationChange(existing, changes, actorRef(user), reason, true);
    await this.mutate(caseId, actorRef(user), 'APPLICATION_UPDATED', (c) => {
      const detail = this.applicationChange(c, changes, actorRef(user), reason, false);
      return detail;
    });
    return (await this.revalidate(caseId, 'SYSTEM', `Revalidated after application change: ${reason}`)).tradeCase;
  }

  /** New version, never an overwrite; re-review for the departments the change concerns. */
  private applicationChange(c: TradeCase, changes: ApplicationInput, actor: ActorRef | 'SYSTEM', reason: string, dryRun: boolean): Record<string, unknown> {
    const before = currentApplication(c);
    const after = mergeApplication(before, changes);
    const changed = changedFields(before, after);
    if (changed.length === 0) throw Errors.validation('Nothing in the application changed.');
    if (dryRun) return {};
    const version = c.currentApplicationVersion + 1;
    c.applicationVersions.push({ version, createdAt: new Date().toISOString(), createdBy: actor, reason, data: after, changedFields: changed });
    c.currentApplicationVersion = version;
    if (c.status !== 'DRAFT') this.requireReReview(c, departmentsAffectedBy(changed), `Application changed (${changed.join(', ')})`);
    return { applicationVersion: version, changedFields: changed, before: Object.fromEntries(changed.map((p) => [p, getField(before, p)])), after: Object.fromEntries(changed.map((p) => [p, getField(after, p)])) };
  }

  private requireReReview(c: TradeCase, departments: Department[], note: string): void {
    for (const d of departments) {
      const review = c.reviews[d];
      if (!review.required) continue;
      // A compliance hold or a recommendation to reject stands until its owner acts on it.
      if (review.status === 'APPROVED' || review.status === 'RETURNED') reviewHistory(review, 'SYSTEM', 'RE_REVIEW_REQUIRED', note);
    }
    const pending = c.approvals.find((a) => a.status === 'PENDING');
    if (pending) {
      pending.status = 'INVALIDATED';
      pending.rationale = `Invalidated: ${note}`;
      if (c.status === 'APPROVAL_PENDING') setStatus(c, 'UNDER_REVIEW', 'SYSTEM', `Approval request invalidated: ${note}`);
    }
  }

  // ---------------------------------------------------------------- documents

  async attachDocument(
    user: AuthenticatedUser,
    caseId: string,
    file: UploadedFile | undefined,
    documentTypeRaw: unknown,
  ): Promise<{ tradeCase: TradeCase; document: CaseDocument }> {
    const requested = String(documentTypeRaw ?? '').toUpperCase();
    // "AUTO" (or nothing): the AI reads the document and says what it is.
    const auto = requested === 'AUTO' || requested === '';
    if (!auto && !(PRE_TRADE_DOCUMENT_TYPES as readonly string[]).includes(requested)) {
      throw Errors.validation(`documentType must be AUTO or one of ${PRE_TRADE_DOCUMENT_TYPES.join(', ')}. Shipping documents are presented after issuance.`);
    }
    const existing = await this.loadFor(user, 'ATTACH_PRETRADE_DOCUMENT', caseId);
    // The very same file (byte for byte) that is already current on this request is refused: nothing would change, and
    // the bank would only read it twice. Changed even slightly, it is a different file and is accepted.
    if (file?.buffer) {
      const known = await getDocumentRepository().findByContentHash(existing.customerRef, computeContentHash(file.buffer));
      const same = known ? existing.documents.find((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId && d.documentId === known.id) : undefined;
      if (same) throw alreadyOnRequest(same, 'on this request');
    }
    // Whoever attaches a document only hands it over; the bank's trade desk decides when it is
    // scrutinised (startScrutiny).
    const stored = await getDocumentService().createFromUpload(file, { autoStart: false, profile: 'PRESHIPMENT', customerId: existing.customerRef, source: 'manual_upload' });

    let documentType = (auto ? 'OTHER_SUPPORTING' : requested) as CaseDocumentType;
    let typeSource: NonNullable<CaseDocument['typeSource']> = auto ? 'UNDETECTED' : 'CUSTOMER';
    let detection: Classification | null = null;
    let detectionError: string | null = null;
    if (auto) {
      // Slow (it calls the model), so it happens before the case is locked.
      try {
        const text = await readDocumentText(stored.id);
        if (text.trim().length < 20) throw new AiUnavailable('The document has no readable text (a scan or a photo?), so it could not be recognised. Choose its type yourself.');
        detection = await classifyDocument({ filename: stored.filename, text });
        if ((PRE_TRADE_DOCUMENT_TYPES as readonly string[]).includes(detection.type)) {
          documentType = detection.type as CaseDocumentType;
          typeSource = 'AI';
        }
      } catch (error) {
        detectionError = error instanceof AiUnavailable ? error.message : 'The document could not be recognised. Choose its type yourself.';
        log.warn('document type detection failed', { caseId, filename: stored.filename, error: describeUnknown(error).slice(0, 200) });
      }
    }

    let linked: CaseDocument | null = null;
    const { tradeCase } = await this.mutate(caseId, actorRef(user), 'DOCUMENT_ATTACHED', (c) => {
      // The check above ran before the case was locked: two identical uploads in flight (a double click) both passed it.
      const raced = c.documents.find((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId && d.documentId === stored.id);
      if (raced) throw alreadyOnRequest(raced, 'on this request');
      linked = this.linkDocument(c, user, stored.id, stored.filename, documentType, 'PRE_TRADE', null, Boolean(stored.isDuplicate), { typeSource, detection, detectionError });
      // After the request has been sent, what the customer adds is theirs to send: the bank is told when they do.
      if (c.status !== 'DRAFT' && isCustomerView(user)) linked.sentToBankAt = null;
      if (c.status !== 'DRAFT' && (documentType === 'PROFORMA_INVOICE' || documentType === 'LC_APPLICATION_FORM')) {
        this.requireReReview(c, ['TRADE_OPS', 'COMPLIANCE'], `New ${documentType.replace(/_/g, ' ').toLowerCase()} version ${linked.version}`);
      }
      return { linkId: linked.linkId, documentId: stored.id, documentType, version: linked.version, duplicateUpload: linked.duplicateUpload, typeSource, detectedType: detection?.type ?? null, detectionConfidence: detection?.confidence ?? null };
    });
    const { tradeCase: validated } = await this.revalidate(caseId, 'SYSTEM', `Document attached: ${documentType}`);
    void this.startReadingDocuments(caseId);
    return { tradeCase: validated ?? tradeCase, document: linked! };
  }

  /**
   * The customer sends what they added after the request went to the bank. It is recorded in the audit trail with the
   * files named, and from then on those documents are no longer "waiting to be sent".
   */
  async sendDocuments(user: AuthenticatedUser, caseId: string): Promise<TradeCase> {
    await this.loadFor(user, 'SEND_DOCUMENTS', caseId);
    const sent = await this.mutate(caseId, actorRef(user), 'DOCUMENTS_SENT', (c) => {
      const waiting = awaitingSend(c);
      if (waiting.length === 0) throw stateConflict('There is nothing waiting to be sent: every document on this request has already reached the bank.');
      const at = new Date().toISOString();
      for (const d of waiting) d.sentToBankAt = at;
      return { linkIds: waiting.map((d) => d.linkId), filenames: waiting.map((d) => d.filename), count: waiting.length };
    });
    void this.startReadingDocuments(caseId);
    return sent.tradeCase;
  }

  /**
   * Changes the type of a pre-trade document, for when the AI took it for something else. The same
   * stored file is linked again under the new type (a new version of that type, replacing the current
   * one of it), and the old link comes off exactly as in removeDocument.
   */
  async retypeDocument(user: AuthenticatedUser, caseId: string, linkId: string, typeRaw: unknown): Promise<TradeCase> {
    const documentType = String(typeRaw ?? '').toUpperCase() as CaseDocumentType;
    if (!(PRE_TRADE_DOCUMENT_TYPES as readonly string[]).includes(documentType)) throw Errors.validation(`documentType must be one of ${PRE_TRADE_DOCUMENT_TYPES.join(', ')}.`);
    const existing = await this.loadFor(user, 'ATTACH_PRETRADE_DOCUMENT', caseId);
    const link = existing.documents.find((d) => d.linkId === linkId);
    if (!link) throw Errors.notFound('case document');
    if (link.stage !== 'PRE_TRADE') throw stateConflict('Only a document attached before issuance can change type.');
    if (link.documentType === documentType) return existing;
    await this.mutate(caseId, actorRef(user), 'DOCUMENT_RETYPED', (c) => {
      const index = c.documents.findIndex((d) => d.linkId === linkId);
      if (index < 0) throw Errors.notFound('case document');
      const [old] = c.documents.splice(index, 1) as [CaseDocument];
      for (const d of c.documents) if (d.supersededByLinkId === old.linkId) d.supersededByLinkId = old.supersededByLinkId;
      const relinked = this.linkDocument(c, user, old.documentId, old.filename, documentType, 'PRE_TRADE', null, old.duplicateUpload, { typeSource: 'CUSTOMER', detection: old.detection ?? null, detectionError: old.detectionError ?? null });
      if (c.status !== 'DRAFT') this.requireReReview(c, ['TRADE_OPS', 'COMPLIANCE'], `A document was re-typed as ${documentType.replace(/_/g, ' ').toLowerCase()}`);
      return { from: old.documentType, to: documentType, oldLinkId: old.linkId, linkId: relinked.linkId, documentId: old.documentId };
    });
    await this.fillApplicationFromDocuments(caseId);
    void this.startReadingDocuments(caseId);
    return (await this.revalidate(caseId, 'SYSTEM', `Document re-typed: ${documentType}`)).tradeCase;
  }

  /**
   * Takes a pre-trade document off the case, for one attached by mistake. The case keeps the record
   * of it in its audit chain; the stored file itself is left alone (it may be shared with another
   * case through the duplicate check). If it had replaced an earlier version of its type, that
   * version is the current one again.
   */
  async removeDocument(user: AuthenticatedUser, caseId: string, linkId: string): Promise<TradeCase> {
    const existing = await this.loadFor(user, 'REMOVE_PRETRADE_DOCUMENT', caseId);
    const link = existing.documents.find((d) => d.linkId === linkId);
    if (!link) throw Errors.notFound('case document');
    if (link.stage !== 'PRE_TRADE') throw stateConflict('Only a document attached before issuance can be removed; presented documents are part of the presentation record.');
    await this.mutate(caseId, actorRef(user), 'DOCUMENT_REMOVED', (c) => {
      const index = c.documents.findIndex((d) => d.linkId === linkId);
      if (index < 0) throw Errors.notFound('case document');
      const [removed] = c.documents.splice(index, 1) as [CaseDocument];
      // Whatever it had replaced is current again, unless something newer replaced the removed one.
      for (const d of c.documents) if (d.supersededByLinkId === removed.linkId) d.supersededByLinkId = removed.supersededByLinkId;
      if (c.status !== 'DRAFT' && (removed.documentType === 'PROFORMA_INVOICE' || removed.documentType === 'LC_APPLICATION_FORM')) {
        this.requireReReview(c, ['TRADE_OPS', 'COMPLIANCE'], `${removed.documentType.replace(/_/g, ' ').toLowerCase()} version ${removed.version} was removed`);
      }
      return { linkId: removed.linkId, documentId: removed.documentId, documentType: removed.documentType, version: removed.version, filename: removed.filename };
    });
    // What the removed document stated goes with it: the application is read again from the documents that remain.
    await this.fillApplicationFromDocuments(caseId);
    return (await this.revalidate(caseId, 'SYSTEM', `Document removed: ${link.documentType}`)).tradeCase;
  }

  // ---------------------------------------------------------------- AI scrutiny, one document at a time

  /**
   * The trade desk starts the AI scrutiny of the current pre-trade documents. It runs in the
   * background, one document after another: the model reads the document, the engines screen it,
   * then the model reviews it against the checklist for its kind and the Pakistani import-LC checks;
   * when every document is done the model compares them with each other. Progress is kept on the
   * case, so a page that is closed and opened again finds it where it was. A document that already
   * has its review (an earlier one, or the same file sent again) is not read twice; one that failed
   * is tried again. Nothing is guessed when the model is unavailable: that step says so and stops.
   */
  async startScrutiny(user: AuthenticatedUser, caseId: string): Promise<{ tradeCase: TradeCase; started: number; alreadyDone: number; running: boolean }> {
    const existing = await this.loadFor(user, 'REVALIDATE', caseId);
    const current = existing.scrutinyRun;
    if (current?.status === 'RUNNING' && Date.now() - Date.parse(current.startedAt) < STALE_RUN_MS) {
      return { tradeCase: existing, started: 0, alreadyDone: 0, running: true };
    }
    const active = existing.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId);
    const todo = active.filter((d) => !existing.aiReviews?.[d.documentId]);
    const comparisonDue = active.length > 0 && !caseReviewIsCurrent(existing);
    if (todo.length === 0 && !comparisonDue) return { tradeCase: existing, started: 0, alreadyDone: active.length, running: false };

    const runId = `RUN-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const steps: ScrutinyStep[] = todo.map((d) => ({ linkId: d.linkId, documentId: d.documentId, filename: d.filename, documentType: d.documentType, status: 'PENDING', error: null, startedAt: null, finishedAt: null }));
    const { tradeCase } = await this.mutate(caseId, actorRef(user), 'SCRUTINY_STARTED', (c) => {
      c.scrutinyRun = { runId, startedBy: actorRef(user), startedAt: now, finishedAt: null, status: 'RUNNING', steps, caseReview: 'PENDING', error: null };
      return { runId, documents: steps.map((x) => x.filename), comparisonDue };
    });
    void this.runScrutiny(caseId, runId).catch((error) => log.error('scrutiny run crashed', { caseId, runId, error: describeUnknown(error).slice(0, 300) }));
    return { tradeCase, started: steps.length, alreadyDone: active.length - todo.length, running: true };
  }

  /** A save of progress that is not an audit event: the run's per-step state is bookkeeping, its start and end are the events. */
  private quietUpdate(caseId: string, work: (c: TradeCase) => void): Promise<void> {
    return this.mutex.run(caseId, async () => {
      const current = await this.repo.findById(caseId);
      if (!current) return;
      const next = structuredClone(current);
      work(next);
      next.revision = current.revision + 1;
      next.updatedAt = new Date().toISOString();
      await this.repo.replace(next, current.revision);
    });
  }

  private async runScrutiny(caseId: string, runId: string): Promise<void> {
    const patch = (fn: (c: TradeCase, run: ScrutinyRun) => void) =>
      this.quietUpdate(caseId, (c) => {
        if (c.scrutinyRun?.runId === runId) fn(c, c.scrutinyRun);
      });
    const stepOf = (run: ScrutinyRun, documentId: string) => run.steps.find((x) => x.documentId === documentId)!;
    const refresh = async (why: string) => {
      try {
        // A file sent before is already analysed, so no "settled" event follows its review; the
        // application is read from the documents here so it never stays blank while they are read.
        await this.fillApplicationFromDocuments(caseId);
        await this.revalidate(caseId, 'SYSTEM', why);
      } catch (error) {
        log.warn('revalidation during the scrutiny was skipped', { caseId, error: describeUnknown(error).slice(0, 200) });
      }
    };

    try {
      const started = await this.repo.findById(caseId);
      const steps = started?.scrutinyRun?.runId === runId ? started.scrutinyRun.steps : [];
      let failures = 0;

      for (const step of steps) {
        await patch((_c, run) => Object.assign(stepOf(run, step.documentId), { status: 'READING' as const, startedAt: new Date().toISOString() }));
        try {
          const analysis = await this.readByModelOrFail(step.documentId);
          await patch((_c, run) => Object.assign(stepOf(run, step.documentId), { status: 'REVIEWING' as const }));
          const review = await reviewDocument({
            filename: step.filename,
            documentType: step.documentType as PreTradeDocumentType,
            text: await readDocumentText(step.documentId),
            facts: digestFacts(analysis?.tradeCompliance ?? null),
          });
          await patch((c, run) => {
            c.aiReviews = { ...(c.aiReviews ?? {}), [step.documentId]: review };
            Object.assign(stepOf(run, step.documentId), { status: 'DONE' as const, error: null, finishedAt: new Date().toISOString() });
          });
        } catch (error) {
          failures += 1;
          const message = error instanceof AiUnavailable ? error.message : describeUnknown(error).slice(0, 300);
          await patch((_c, run) => Object.assign(stepOf(run, step.documentId), { status: 'FAILED' as const, error: message, finishedAt: new Date().toISOString() }));
        }
        // The findings follow each document as it is done.
        await refresh(`AI scrutiny of ${step.filename}`);
      }

      // The documents against each other, once every one of them has been read.
      let comparisonError: string | null = null;
      const afterSteps = await this.repo.findById(caseId);
      if (afterSteps && failures === 0 && !caseReviewIsCurrent(afterSteps)) {
        await patch((_c, run) => {
          run.caseReview = 'RUNNING';
        });
        try {
          const active = afterSteps.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId);
          const digests: CaseDocumentDigest[] = [];
          for (const d of active) {
            const review = afterSteps.aiReviews?.[d.documentId];
            if (!review) continue;
            const full = await getDocumentRepository().findFull(d.documentId);
            digests.push({
              documentType: d.documentType as PreTradeDocumentType,
              filename: d.filename,
              summary: review.summary,
              facts: digestFacts(full?.analysis?.tradeCompliance ?? null),
              text: await readDocumentText(d.documentId),
            });
          }
          const comparison = await reviewCase({ documents: digests, documentIds: active.map((d) => d.documentId) });
          await patch((c, run) => {
            c.caseReview = comparison;
            run.caseReview = 'DONE';
          });
        } catch (error) {
          failures += 1;
          comparisonError = error instanceof AiUnavailable ? error.message : describeUnknown(error).slice(0, 300);
          await patch((_c, run) => {
            run.caseReview = 'FAILED';
          });
        }
      } else if (failures > 0) {
        await patch((_c, run) => {
          run.caseReview = 'SKIPPED';
        });
      } else {
        await patch((_c, run) => {
          run.caseReview = 'DONE';
        });
      }

      await refresh('AI scrutiny finished');
      await this.mutate(caseId, 'SYSTEM', 'SCRUTINY_FINISHED', (c) => {
        if (c.scrutinyRun?.runId === runId) {
          c.scrutinyRun.status = failures > 0 ? 'FAILED' : 'DONE';
          c.scrutinyRun.finishedAt = new Date().toISOString();
          c.scrutinyRun.error = comparisonError ?? (failures > 0 ? 'The AI could not complete every step; see the documents that failed and run the scrutiny again.' : null);
        }
        return { runId, failures };
      });
    } catch (error) {
      log.error('scrutiny run failed', { caseId, runId, error: describeUnknown(error).slice(0, 300) });
      await this.quietUpdate(caseId, (c) => {
        if (c.scrutinyRun?.runId === runId) Object.assign(c.scrutinyRun, { status: 'FAILED' as const, finishedAt: new Date().toISOString(), error: describeUnknown(error).slice(0, 300) });
      }).catch(() => undefined);
    }
  }

  /**
   * Starts the model reading every pre-trade document on the case that has not been read yet, without waiting.
   * The application is filled from them as each one settles (onDocumentSettled), so a customer who has handed
   * their documents over sees the application fill in, and the bank is not the only one who can start the reading.
   */
  private async startReadingDocuments(caseId: string): Promise<void> {
    try {
      const c = await this.repo.findById(caseId);
      if (!c) return;
      // A file that was read before (the same file sent on another request) is already analysed, so no "settled"
      // event will follow it: the application is read from it now.
      if (await this.fillApplicationFromDocuments(caseId)) await this.revalidate(caseId, 'SYSTEM', 'Application read from the documents');
      const repo = getDocumentRepository();
      const documents = getDocumentService();
      for (const link of c.documents) {
        if (link.stage !== 'PRE_TRADE' || link.supersededByLinkId) continue;
        const meta = await repo.findMeta(link.documentId);
        if (!meta || meta.status === 'completed' || meta.status === 'queued' || meta.status === 'processing') continue;
        // One document that cannot be started (its file is missing, or another caller finished it first) must not keep the rest from being read.
        try {
          await documents.startAnalysis(link.documentId);
        } catch (error) {
          log.warn('could not start reading a document', { caseId, documentId: link.documentId, error: describeUnknown(error).slice(0, 200) });
        }
      }
    } catch (error) {
      log.warn('could not start reading the documents', { caseId, error: describeUnknown(error).slice(0, 200) });
    }
  }

  /**
   * Makes sure the model has read the document (starting and waiting for its analysis). A read the
   * built-in parser covered for, because the model timed out or was rate limited, is not accepted: the
   * analysis is run again, a few times with a pause, before the step gives up and says the AI was unavailable.
   */
  private async readByModelOrFail(documentId: string): Promise<NonNullable<Awaited<ReturnType<ReturnType<typeof getDocumentRepository>['findFull']>>>['analysis']> {
    const repo = getDocumentRepository();
    const documents = getDocumentService();
    for (let attempt = 0; attempt < MODEL_READ_ATTEMPTS; attempt += 1) {
      let meta = await repo.findMeta(documentId);
      if (!meta) throw new Error('The document is no longer available.');
      if (meta.status !== 'completed') {
        if (meta.status !== 'queued' && meta.status !== 'processing') await documents.startAnalysis(documentId);
        const deadline = Date.now() + ANALYSIS_WAIT_MS;
        for (;;) {
          meta = await repo.findMeta(documentId);
          if (!meta) throw new Error('The document is no longer available.');
          if (meta.status === 'completed' || meta.status === 'failed' || meta.status === 'cancelled') break;
          if (Date.now() > deadline) throw new Error('The analysis took too long. Run the scrutiny again.');
          await sleep(600);
        }
      }
      if (meta.status !== 'completed') throw new Error(meta.error?.message ?? 'The analysis did not complete.');
      const full = await repo.findFull(documentId);
      if (readByModel(full?.analysis)) return full?.analysis ?? null;
      if (attempt < MODEL_READ_ATTEMPTS - 1) {
        log.warn('the model did not read the document; reading it again', { documentId, attempt: attempt + 1 });
        await sleep(backoffDelay(attempt + 2));
        await documents.reanalyzeDocument(documentId);
      }
    }
    throw new AiUnavailable('The AI model could not read this document (it was unavailable or did not answer). The built-in parser is not used for the pre-shipment scrutiny, so nothing was taken from it. Run the scrutiny again.');
  }

  private linkDocument(
    c: TradeCase,
    user: AuthenticatedUser,
    documentId: string,
    filename: string,
    documentType: CaseDocumentType,
    stage: CaseDocument['stage'],
    presentationId: string | null,
    duplicateUpload: boolean,
    detected?: { typeSource: NonNullable<CaseDocument['typeSource']>; detection: Classification | null; detectionError: string | null },
    /** A document of the same type in the same presented application replaces the earlier one (a correction). */
    supersedeInPresentation = false,
  ): CaseDocument {
    c.sequences.document += 1;
    const linkId = `DL-${String(c.sequences.document).padStart(3, '0')}`;
    const sameSlot = (d: CaseDocument) => d.documentType === documentType && d.stage === stage && (!supersedeInPresentation || d.presentationId === presentationId);
    const previous = stage === 'PRE_TRADE' ? activeDocument(c, documentType) : supersedeInPresentation ? c.documents.filter((d) => sameSlot(d) && !d.supersededByLinkId).pop() ?? null : null;
    // Highest + 1, not a count: a removed version must not hand its number to the next upload.
    const version = Math.max(0, ...c.documents.filter(sameSlot).map((d) => d.version)) + 1;
    const link: CaseDocument = {
      linkId,
      documentId,
      documentType,
      stage,
      version,
      filename,
      uploadedAt: new Date().toISOString(),
      uploadedBy: actorRef(user),
      supersededByLinkId: null,
      presentationId,
      duplicateUpload,
      ...(detected ? { typeSource: detected.typeSource, detection: detected.detection, detectionError: detected.detectionError } : {}),
    };
    if (previous) previous.supersededByLinkId = linkId;
    c.documents.push(link);
    return link;
  }

  /** Streams a case document to anyone allowed to view the case (customers included). */
  async getDocumentFile(user: AuthenticatedUser, caseId: string, linkId: string): Promise<{ filename: string; mimeType: string; buffer: Buffer }> {
    const c = await this.loadFor(user, 'VIEW', caseId);
    const link = c.documents.find((d) => d.linkId === linkId);
    if (!link) throw Errors.notFound('case document');
    return getDocumentService().getSourceFile(link.documentId);
  }

  // ---------------------------------------------------------------- validation

  /** Re-run every pre-trade rule and merge the results. Safe to call any number of times. */
  async revalidate(caseId: string, actor: ActorRef | 'SYSTEM', reason: string): Promise<CaseMutationResult> {
    const snapshot = await this.repo.findById(caseId);
    if (!snapshot) throw Errors.notFound('trade case');
    if (!PRE_ISSUANCE_REVALIDATION.includes(snapshot.status)) {
      throw stateConflict('Pre-trade validation only runs before issuance.');
    }
    // Gather everything slow (document store, screening, FX) before taking the case lock.
    const inputs = await this.gatherPreTradeInputs(snapshot);
    return this.mutate(caseId, actor, 'REVALIDATED', (c) => {
      const application = currentApplication(c);
      const submitted = c.submittedApplicationVersion ? c.applicationVersions.find((v) => v.version === c.submittedApplicationVersion)?.data ?? null : null;
      const candidates = evaluatePreTrade({
        tradeCase: c,
        application,
        applicationVersion: c.currentApplicationVersion,
        submittedApplication: submitted,
        policy: this.policy,
        pi: inputs.pi,
        piReuse: inputs.piReuse,
        partyScreening: inputs.screening,
        externalVerification: inputs.externalVerification,
        externalVerificationError: inputs.externalVerificationError,
        verificationPolicy: currentVerificationPolicy(),
        holdCompleteness: inputs.holdCompleteness,
        now: new Date(),
      });
      if (inputs.screeningError) {
        candidates.push(
          candidate('CMP-SANCTIONS-PARTY', 'screening-unavailable', {
            category: 'OPERATIONAL',
            severity: 'HIGH',
            ownerDepartment: 'COMPLIANCE',
            title: 'Sanctions screening could not run',
            description: `Party screening failed (${inputs.screeningError}). The case has NOT been screened; it is not treated as clear.`,
            expected: 'Screening completed.',
            recommendedAction: 'Re-run validation once the screening service is available, or screen manually and record it.',
          }),
        );
      }
      c.validation = {
        lastRunAt: new Date().toISOString(),
        ruleSetVersion: RULE_SET_VERSION,
        piExtractionSource: inputs.pi?.extractionSource ?? 'NOT_AVAILABLE',
        piDocumentId: inputs.pi?.documentId ?? null,
        amountInPkr: inputs.amountInPkr,
        screening: inputs.screeningSummary,
        // Always this run's own outcome. A run that failed is recorded as failed, not left as the earlier
        // "consistent" one, and a switched-off module leaves nothing that could be read as current.
        externalVerification: inputs.externalVerification
          ? { runId: inputs.externalVerification.runId, finishedAt: inputs.externalVerification.finishedAt, modules: inputs.externalVerification.modules, results: inputs.externalVerification.results }
          : inputs.externalVerificationError
            ? {
                runId: 'FAILED',
                finishedAt: new Date().toISOString(),
                modules: [{ module: 'HS_CLASSIFICATION' as const, state: 'SOURCE_UNAVAILABLE' as const, claimsChecked: 0, sourcesConsulted: [], notChecked: [`The verification could not run (${inputs.externalVerificationError}); nothing was checked.`] }],
                results: [],
              }
            : null,
      };
      const summary = this.mergeFindings(c, candidates, (f) => f.stage === 'PRE_TRADE', c.currentApplicationVersion);
      return { reason, ...summary, piExtractionSource: c.validation.piExtractionSource };
    });
  }

  private async gatherPreTradeInputs(c: TradeCase): Promise<{
    pi: PiContext | null;
    piReuse: Array<{ caseId: string; reason: string }>;
    screening: SanctionsScreeningResult | null;
    screeningError: string | null;
    screeningSummary: ScreeningSummary | null;
    holdCompleteness: boolean;
    amountInPkr: number | null;
    externalVerification: VerificationRun | null;
    externalVerificationError: string | null;
  }> {
    const app = currentApplication(c);
    // Documents only and nothing analysed yet: the blanks are "not read yet", not "missing".
    let anyAnalysed = false;
    if (isDocumentsOnly(c)) {
      for (const link of c.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId)) {
        if ((await getDocumentRepository().findMeta(link.documentId))?.status === 'completed') {
          anyAnalysed = true;
          break;
        }
      }
    }
    const holdCompleteness = isDocumentsOnly(c) && !anyAnalysed;
    const piLink = activeDocument(c, 'PROFORMA_INVOICE');
    let pi: PiContext | null = null;
    if (piLink) {
      const doc = await getDocumentRepository().findFull(piLink.documentId);
      const analysis = doc?.analysis ?? null;
      pi = {
        documentId: piLink.documentId,
        filename: piLink.filename,
        status: doc?.status ?? 'failed',
        errorMessage: doc ? doc.error?.message ?? (doc.status === 'completed' && !readByModel(analysis) ? 'The AI model did not read this document (it was unavailable); the built-in parser is not used for the pre-shipment scrutiny. Run the scrutiny again.' : null) : 'The document record is no longer available.',
        extractionSource: extractionSourceOf(analysis),
        // The pre-shipment scrutiny reads with the AI model only: what the built-in parser produced when the
        // model was unavailable is not used, and the document is reported as not read.
        extraction: doc?.status === 'completed' && readByModel(analysis) ? analysis?.tradeCompliance ?? null : null,
        units: (doc?.units ?? []).map((u) => ({ pageNumber: u.pageNumber, text: u.text })),
      };
    }

    // The same PI behind another live case: the same file, or the same PI number.
    const piReuse: Array<{ caseId: string; reason: string }> = [];
    const piNumbers = new Set(
      [app.proformaInvoiceNumber, pi?.extraction?.documentClassification.number]
        .map((n) => (n ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
        .filter((n) => n.length >= 3 && n !== 'NOTFOUND'),
    );
    if (pi || piNumbers.size > 0) {
      for (const other of await this.repo.list({})) {
        if (other.caseId === c.caseId || other.status === 'WITHDRAWN' || other.status === 'CANCELLED') continue;
        if (pi && other.documents.some((d) => d.documentType === 'PROFORMA_INVOICE' && d.documentId === pi!.documentId)) {
          piReuse.push({ caseId: other.caseId, reason: 'The same proforma invoice file is attached to that case' });
          continue;
        }
        const theirs = currentApplication(other).proformaInvoiceNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (theirs && piNumbers.has(theirs)) piReuse.push({ caseId: other.caseId, reason: `That case quotes the same proforma invoice number (${currentApplication(other).proformaInvoiceNumber})` });
      }
    }

    // The documents the model read, once for both the vessel screening and the external verification.
    const verifiable = await this.verifiableDocuments(c);
    const vessel = declaredVessel(verifiable);

    let screening: SanctionsScreeningResult | null = null;
    let screeningError: string | null = null;
    if (app.applicant.name || app.beneficiary.name) {
      try {
        screening = await this.sanctions.screenTransaction({
          parties: {
            seller: { role: 'Beneficiary', legalName: app.beneficiary.name || 'Not Found', country: app.beneficiary.country || undefined },
            buyer: { role: 'Applicant', legalName: app.applicant.name || 'Not Found', country: app.applicant.country || undefined },
          },
          originCountry: app.countryOfOrigin || undefined,
          destinationCountry: app.applicant.country || undefined,
          portOfLoading: app.portOfLoading || undefined,
          portOfDischarge: app.portOfDischarge || undefined,
          vesselName: vessel.name ?? undefined,
          vesselImo: vessel.imo ?? undefined,
        });
      } catch (error) {
        screeningError = describeUnknown(error).slice(0, 200);
        log.error('party screening failed', { caseId: c.caseId, error: screeningError });
      }
    }

    const screeningSummary: ScreeningSummary | null =
      app.applicant.name || app.beneficiary.name
        ? {
            screenedAt: screening?.screeningTimestamp ?? new Date().toISOString(),
            datasetVersion: screening?.datasetVersion ?? '',
            parties: [
              { role: 'Beneficiary (supplier)', name: app.beneficiary.name, country: app.beneficiary.country },
              { role: 'Applicant (importer)', name: app.applicant.name, country: app.applicant.country },
            ].filter((p) => p.name),
            // The engine returns only the countries it found a concern about; the ones it checked and
            // found clear are listed too, so "clear" is shown as something that was actually looked at.
            jurisdictions: screening
              ? coverage(
                  [
                    { role: 'ORIGIN', country: app.countryOfOrigin },
                    { role: 'FINAL_DESTINATION', country: app.applicant.country },
                    { role: 'COUNTERPARTY_COUNTRY', country: app.beneficiary.country },
                    { role: 'COUNTERPARTY_COUNTRY', country: app.applicant.country },
                  ],
                  screening.jurisdictionRisks,
                ).map((j) => ({ nodeRole: j.role, countryName: j.country, sanctionsStatus: j.status }))
              : [],
            matchCount: screening?.matches.length ?? 0,
            error: screeningError,
          }
        : null;

    const verified = await this.verifyExternally(c, app, verifiable);
    return {
      pi,
      piReuse,
      screening,
      screeningError,
      screeningSummary,
      holdCompleteness,
      amountInPkr: await this.toPkr(app.amount, app.currency),
      externalVerification: verified.run,
      externalVerificationError: verified.error,
    };
  }

  /**
   * HS classification (and, as they are added, the other external checks) over the case's documents,
   * against official sources. It never throws: a failure comes back as an error that the revalidation
   * turns into a visible finding, so a check that did not run is never mistaken for one that passed.
   * Only what the AI model read is verified, as everywhere in the pre-shipment scrutiny.
   */
  /** What the AI model read from each current pre-trade document, in the shape the external checks take. */
  private async verifiableDocuments(c: TradeCase): Promise<VerifiableDocument[]> {
    const documents: VerifiableDocument[] = [];
    for (const link of c.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId)) {
      const doc = await getDocumentRepository().findFull(link.documentId);
      const analysis = doc?.status === 'completed' && readByModel(doc.analysis) ? doc.analysis?.tradeCompliance ?? null : null;
      if (analysis) {
        documents.push({
          documentId: link.documentId,
          filename: link.filename,
          documentType: link.documentType,
          version: link.version,
          extractionConfidence: analysis.documentClassification.confidence ?? null,
          units: (doc?.units ?? []).map((u) => ({ pageNumber: u.pageNumber, text: u.text })),
          goods: analysis.goods,
          route: { portOfLoading: analysis.transaction.portOfLoading, portOfDischarge: analysis.transaction.portOfDischarge, vesselName: analysis.transaction.vesselName, vesselImo: analysis.transaction.vesselImo, transshipmentDetails: analysis.transaction.transshipmentDetails },
        });
      }
    }
    return documents;
  }

  private async verifyExternally(c: TradeCase, app: LcApplicationData, documents: VerifiableDocument[]): Promise<{ run: VerificationRun | null; error: string | null }> {
    if (process.env['EXTERNAL_VERIFICATION_ENABLED'] === 'false') return { run: null, error: null };
    try {
      // A typed application is a claim of its own; one read from the documents would only repeat them.
      const typed = !isDocumentsOnly(c);
      const run = await runExternalVerification({
        documents,
        application: typed ? { description: app.goodsDescription, hsCode: app.hsCode, unit: app.unitOfMeasure, portOfLoading: app.portOfLoading, portOfDischarge: app.portOfDischarge } : null,
        transactionDate: c.submittedAt ?? c.createdAt,
        previous: c.validation.externalVerification ?? null,
      });
      return { run, error: null };
    } catch (error) {
      const message = describeUnknown(error).slice(0, 200);
      log.error('external verification failed', { caseId: c.caseId, error: message });
      return { run: null, error: message };
    }
  }

  /**
   * PKR equivalent from the rates already held, or null when there is no rate for the currency
   * (never a 1:1 guess). A refresh is started in the background; a case action never waits on the
   * external FX feed, which an isolated bank network may not reach at all.
   */
  private async toPkr(amount: number | null, currency: string): Promise<number | null> {
    if (amount === null || !currency) return null;
    if (currency === 'PKR') return amount;
    const { FxRatesService } = await import('../compliance/pricing/fx-rates.service');
    const fx = FxRatesService.getInstance();
    void fx.refreshLiveRates().catch(() => undefined);
    const from = fx.cachedRate(currency);
    const pkr = fx.cachedRate('PKR');
    if (!from || !pkr) return null;
    return Math.round(((amount * pkr) / from) * 100) / 100;
  }

  /**
   * Merge a fresh rule run into the case. A finding keeps its id and history across runs. A data
   * finding that no longer triggers is resolved by the revalidation; a compliance, TBML or
   * regulatory one is not — it waits for its owner's disposition. Evidence that changes under a
   * disposition reopens the finding.
   */
  private mergeFindings(
    c: TradeCase,
    candidates: CandidateFinding[],
    inScope: (f: Finding) => boolean,
    applicationVersion: number,
    touchReviews = true,
  ): { raised: string[]; resolved: string[]; reopened: string[]; awaitingDisposition: string[] } {
    const now = new Date().toISOString();
    const byKey = new Map(candidates.map((k) => [k.key, k]));
    const result = { raised: [] as string[], resolved: [] as string[], reopened: [] as string[], awaitingDisposition: [] as string[] };
    const touchedDepartments = new Set<Department>();

    for (const f of c.findings.filter(inScope)) {
      const k = byKey.get(f.key);
      if (k) {
        byKey.delete(f.key);
        const evidenceChanged = stableEvidence(f.observed) !== stableEvidence(k.observed);
        Object.assign(f, {
          ...(k.customerFixable !== undefined ? { customerFixable: k.customerFixable } : {}),
          ruleVersion: k.ruleVersion,
          category: k.category,
          severity: k.severity,
          blocking: k.blocking,
          title: k.title,
          description: k.description,
          fields: k.fields,
          observed: k.observed,
          expected: k.expected,
          confidence: k.confidence,
          recommendedAction: k.recommendedAction,
          lastEvaluatedAt: now,
          applicationVersion,
        });
        if (f.status === 'RESOLVED' || (f.status === 'DISPOSITIONED' && evidenceChanged && f.stage === 'PRE_TRADE')) {
          f.status = 'OPEN';
          f.history.push({ at: now, actor: 'SYSTEM', event: 'REOPENED', detail: f.disposition ? `Evidence changed since "${f.disposition.code}"` : 'Triggered again' });
          f.disposition = null;
          result.reopened.push(f.findingId);
          if (f.blocking) touchedDepartments.add(f.ownerDepartment);
        } else if (evidenceChanged) {
          f.history.push({ at: now, actor: 'SYSTEM', event: 'RE_EVALUATED', detail: 'Observed values changed' });
        }
      } else if (f.status === 'OPEN') {
        if (this.policy.complianceCategories.includes(f.category)) {
          if (f.history[f.history.length - 1]?.event !== 'NO_LONGER_TRIGGERED_AWAITING_DISPOSITION') {
            f.history.push({ at: now, actor: 'SYSTEM', event: 'NO_LONGER_TRIGGERED_AWAITING_DISPOSITION', detail: 'The rule no longer fires; compliance must still disposition it.' });
          }
          result.awaitingDisposition.push(f.findingId);
        } else {
          f.status = 'RESOLVED';
          f.lastEvaluatedAt = now;
          f.history.push({ at: now, actor: 'SYSTEM', event: 'RESOLVED_BY_REVALIDATION', detail: `Not triggered on application version ${applicationVersion}` });
          result.resolved.push(f.findingId);
        }
      }
    }

    for (const k of byKey.values()) {
      c.sequences.finding += 1;
      const finding: Finding = {
        ...k,
        findingId: `F-${String(c.sequences.finding).padStart(4, '0')}`,
        status: 'OPEN',
        disposition: null,
        applicantWaiver: null,
        raisedAt: now,
        lastEvaluatedAt: now,
        applicationVersion,
        history: [{ at: now, actor: 'SYSTEM', event: 'RAISED', detail: `${k.ruleId} v${k.ruleVersion}` }],
      };
      c.findings.push(finding);
      result.raised.push(finding.findingId);
      if (finding.blocking) touchedDepartments.add(finding.ownerDepartment);
    }

    // A department that already approved must look again at a new blocking issue in its remit.
    if (touchReviews && PRE_ISSUANCE_REVALIDATION.includes(c.status) && c.status !== 'DRAFT' && touchedDepartments.size > 0) {
      this.requireReReview(c, [...touchedDepartments], 'New or reopened blocking finding');
    }
    return result;
  }

  /** Called when a linked document's analysis settles: pre-trade documents trigger revalidation. */
  async onDocumentSettled(documentId: string): Promise<void> {
    for (const caseId of await this.repo.findCaseIdsByDocumentId(documentId)) {
      const c = await this.repo.findById(caseId);
      if (!c || !PRE_ISSUANCE_REVALIDATION.includes(c.status)) continue;
      const link = c.documents.find((d) => d.documentId === documentId);
      if (link?.stage !== 'PRE_TRADE') continue;
      await this.fillApplicationFromDocuments(caseId);
      await this.revalidate(caseId, 'SYSTEM', `Analysis of ${link.filename} finished`);
    }
  }

  /**
   * A documents-only request has no typed application. Once its documents are analysed, the blank
   * application fields are filled from what they state (a new version, attributed to the analysis),
   * so the pre-trade rules and the sanctions screening run on the real parties, countries and
   * amounts. Nothing a person entered is overwritten; what the documents do not state stays blank
   * and is reported as missing.
   */
  private async fillApplicationFromDocuments(caseId: string): Promise<boolean> {
    try {
      const c = await this.repo.findById(caseId);
      if (!c || !isDocumentsOnly(c)) return false;
      if (!['DRAFT', 'UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION'].includes(c.status)) return false;
      const documents = getDocumentRepository();
      // What the analysis itself filled earlier is read again from the current documents, so a
      // corrected document replaces it; what a person entered is never touched.
      const base = withoutMachineFields(c);
      let working = base;
      let total: ApplicationFill = {};
      const sources: string[] = [];
      for (const type of ['PROFORMA_INVOICE', 'LC_APPLICATION_FORM', 'PURCHASE_CONTRACT', 'PURCHASE_ORDER'] as const) {
        const link = activeDocument(c, type);
        if (!link) continue;
        const doc = await documents.findFull(link.documentId);
        const analysis = doc?.status === 'completed' && readByModel(doc.analysis) ? doc.analysis?.tradeCompliance : null;
        if (!analysis) continue;
        const blanks = blanksToFill(working, fieldsFromAnalysis(analysis, type));
        if (Object.keys(blanks).length === 0) continue;
        working = mergeApplication(working, blanks as ApplicationInput);
        total = {
          ...total,
          ...blanks,
          ...(blanks.applicant ? { applicant: { ...total.applicant, ...blanks.applicant } } : {}),
          ...(blanks.beneficiary ? { beneficiary: { ...total.beneficiary, ...blanks.beneficiary } } : {}),
        };
        sources.push(link.filename);
      }
      if (sources.length === 0) return false;
      const wouldChange = (app: LcApplicationData, fill: ApplicationFill): boolean => changedFields(app, mergeApplication(app, fill as ApplicationInput)).length > 0;
      if (!wouldChange(currentApplication(c), blanksToFill(base, total))) return false;
      let changed = false;
      await this.mutate(caseId, 'SYSTEM', 'APPLICATION_READ_FROM_DOCUMENTS', (next) => {
        // Re-checked against the case as it is now: a value entered in the meantime is kept.
        const live = blanksToFill(withoutMachineFields(next), total);
        if (!wouldChange(currentApplication(next), live)) return { filled: [] };
        changed = true;
        return this.applicationChange(next, live as ApplicationInput, 'SYSTEM', `Fields read from ${sources.join(', ')} by AI analysis; to be checked against the originals`, false);
      });
      return changed;
    } catch (error) {
      log.error('could not fill the application from the documents', { caseId, error: describeUnknown(error).slice(0, 200) });
      return false;
    }
  }

  /**
   * How far the model has got with the pre-trade documents on the case, for the screen that shows the application filling
   * in: how many documents there are, how many are read, and how many could not be.
   */
  async readingProgress(c: TradeCase): Promise<{ total: number; read: number; failed: number }> {
    const repo = getDocumentRepository();
    const progress = { total: 0, read: 0, failed: 0 };
    for (const link of c.documents) {
      if (link.stage !== 'PRE_TRADE' || link.supersededByLinkId) continue;
      progress.total += 1;
      const meta = await repo.findMeta(link.documentId);
      if (meta?.status === 'completed') progress.read += 1;
      else if (meta?.status === 'failed' || meta?.status === 'cancelled') progress.failed += 1;
    }
    return progress;
  }

  // ---------------------------------------------------------------- submission

  async submit(user: AuthenticatedUser, caseId: string): Promise<TradeCase> {
    await this.loadFor(user, 'SUBMIT', caseId);
    await this.mutate(caseId, actorRef(user), 'SUBMITTED', (c) => {
      c.submittedAt = new Date().toISOString();
      c.submittedApplicationVersion = c.currentApplicationVersion;
      for (const review of Object.values(c.reviews)) {
        if (review.required) reviewHistory(review, 'SYSTEM', 'PENDING', 'Submitted for review');
      }
      setStatus(c, 'UNDER_REVIEW', actorRef(user), 'Submitted by the customer');
      return { applicationVersion: c.currentApplicationVersion };
    });
    await this.fillApplicationFromDocuments(caseId);
    void this.startReadingDocuments(caseId);
    return (await this.revalidate(caseId, 'SYSTEM', 'Validation on submission')).tradeCase;
  }

  async withdraw(user: AuthenticatedUser, caseId: string, rationale: unknown): Promise<TradeCase> {
    const reason = requireText(rationale, 'A reason for withdrawing', 3);
    await this.loadFor(user, 'WITHDRAW', caseId);
    return (
      await this.mutate(caseId, actorRef(user), 'WITHDRAWN', (c) => {
        setStatus(c, 'WITHDRAWN', actorRef(user), reason);
        for (const a of c.approvals) if (a.status === 'PENDING') a.status = 'INVALIDATED';
        c.closedAt = new Date().toISOString();
        return { reason };
      })
    ).tradeCase;
  }

  async revalidateByUser(user: AuthenticatedUser, caseId: string): Promise<TradeCase> {
    await this.loadFor(user, 'REVALIDATE', caseId);
    await this.fillApplicationFromDocuments(caseId);
    return (await this.revalidate(caseId, actorRef(user), 'Revalidation requested by a reviewer')).tradeCase;
  }

  // ---------------------------------------------------------------- reviews

  async decideReview(
    user: AuthenticatedUser,
    caseId: string,
    departmentRaw: unknown,
    input: { decision?: unknown; rationale?: unknown; checklist?: unknown; query?: { question?: unknown; findingIds?: unknown; requiresCorrection?: unknown } },
  ): Promise<TradeCase> {
    const department = String(departmentRaw ?? '').toUpperCase() as Department;
    if (!(DEPARTMENTS as readonly string[]).includes(department)) throw Errors.validation(`department must be one of ${DEPARTMENTS.join(', ')}.`);
    const decision = String(input.decision ?? '');
    if (!['APPROVE', 'RETURN', 'HOLD', 'RECOMMEND_REJECT'].includes(decision)) throw Errors.validation('decision must be APPROVE, RETURN, HOLD or RECOMMEND_REJECT.');
    const rationale = requireText(input.rationale, 'A rationale for the review decision');
    const checked = Array.isArray(input.checklist) ? input.checklist.filter((v): v is string => typeof v === 'string') : [];

    const c0 = await this.loadFor(user, 'VIEW', caseId);
    this.assertDepartmentRole(user, department);
    const allowed: CaseStatus[] = decision === 'APPROVE' ? ['UNDER_REVIEW'] : ['UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION'];
    if (!allowed.includes(c0.status)) throw stateConflict(`A ${decision.toLowerCase()} decision is not possible while the case is ${c0.status.replace(/_/g, ' ').toLowerCase()}.`);
    if (!c0.reviews[department].required) throw stateConflict(`${department} review is not required for this case.`);
    if (decision === 'HOLD' && department !== 'COMPLIANCE') throw Errors.validation('Only compliance places a case on hold.');

    await this.mutate(caseId, actorRef(user), `REVIEW_${decision}`, (c) => {
      const review = c.reviews[department];
      const actor = actorRef(user);
      const now = new Date().toISOString();
      const validItems = new Set(this.applicableChecklist(c, department).map((i) => i.itemId));
      for (const itemId of checked) {
        if (!validItems.has(itemId)) throw Errors.validation(`Unknown checklist item ${itemId} for ${department}.`);
        review.checklist[itemId] = { checked: true, by: actor, at: now };
      }
      const detail: Record<string, unknown> = { department, decision, rationale, checklist: checked, applicationVersion: c.currentApplicationVersion };

      if (decision === 'APPROVE') {
        const blockers = this.reviewBlockers(c, department);
        if (blockers.length > 0) throw stateConflict(`${department} cannot approve yet.`, { blockers });
        review.decidedBy = actor;
        review.decidedAt = now;
        review.rationale = rationale;
        review.applicationVersion = c.currentApplicationVersion;
        reviewHistory(review, actor, 'APPROVED', rationale);
      } else if (decision === 'RETURN') {
        const question = requireText(input.query?.question, 'The question for the customer');
        const query = this.newQuery(c, actor, department, 'CUSTOMER', question, input.query?.findingIds, Boolean(input.query?.requiresCorrection));
        review.rationale = rationale;
        reviewHistory(review, actor, 'RETURNED', rationale);
        setStatus(c, 'PENDING_CUSTOMER_CLARIFICATION', actor, `${department} returned the case: ${question}`);
        detail['queryId'] = query.queryId;
      } else if (decision === 'HOLD') {
        review.rationale = rationale;
        reviewHistory(review, actor, 'ON_HOLD', rationale);
      } else {
        review.rationale = rationale;
        reviewHistory(review, actor, 'REJECT_RECOMMENDED', rationale);
      }
      return detail;
    });
    return (await this.repo.findById(caseId))!;
  }

  private applicableChecklist(c: TradeCase, department: Department) {
    const threshold = this.policy.thresholds.exporterReportPkr;
    return (this.policy.checklists[department] ?? []).filter((item) => {
      if (item.condition !== 'AMOUNT_AT_OR_ABOVE_EXPORTER_REPORT_THRESHOLD') return true;
      // Without a rate, assume the threshold may be met: the safer reading.
      return c.validation.amountInPkr === null || c.validation.amountInPkr >= threshold;
    });
  }

  /** What stops a department approving. */
  private reviewBlockers(c: TradeCase, department: Department): string[] {
    const blockers: string[] = [];
    const review = c.reviews[department];
    for (const item of this.applicableChecklist(c, department)) {
      if (!review.checklist[item.itemId]?.checked) blockers.push(`Checklist item not confirmed: ${item.label}`);
    }
    for (const f of c.findings) {
      if (f.stage === 'PRE_TRADE' && f.ownerDepartment === department && blocksNow(f)) blockers.push(`${f.findingId} ${f.title}`);
    }
    if (department === 'CREDIT' && !c.creditFacility) blockers.push('No facility verification recorded');
    if (department === 'COMPLIANCE' && c.validation.lastRunAt === null) blockers.push('Screening has not run');
    for (const q of c.queries) {
      if (q.department === department && q.status !== 'RESOLVED') blockers.push(`Query ${q.queryId} not resolved`);
    }
    return blockers;
  }

  // ---------------------------------------------------------------- queries

  private newQuery(c: TradeCase, actor: ActorRef, department: Department, assignee: CaseQuery_Assignee, question: string, findingIdsRaw: unknown, requiresCorrection: boolean, subject?: string) {
    const findingIds = Array.isArray(findingIdsRaw) ? findingIdsRaw.filter((v): v is string => typeof v === 'string') : [];
    for (const id of findingIds) if (!c.findings.some((f) => f.findingId === id)) throw Errors.validation(`Unknown finding ${id}.`);
    c.sequences.query += 1;
    const query = {
      queryId: `Q-${String(c.sequences.query).padStart(3, '0')}`,
      findingIds,
      raisedBy: actor,
      raisedAt: new Date().toISOString(),
      department,
      assignee,
      ...(subject ? { subject } : {}),
      question,
      requiresCorrection,
      status: 'OPEN' as const,
      responses: [],
      resolution: null,
      reopenedCount: 0,
    };
    c.queries.push(query);
    return query;
  }

  async raiseQuery(
    user: AuthenticatedUser,
    caseId: string,
    input: { department?: unknown; assignee?: unknown; subject?: unknown; question?: unknown; findingIds?: unknown; requiresCorrection?: unknown },
  ): Promise<TradeCase> {
    const department = String(input.department ?? '').toUpperCase() as Department;
    if (!(DEPARTMENTS as readonly string[]).includes(department)) throw Errors.validation('department is required.');
    const assignee = String(input.assignee ?? 'CUSTOMER').toUpperCase() as CaseQuery_Assignee;
    if (assignee !== 'CUSTOMER' && !(DEPARTMENTS as readonly string[]).includes(assignee)) throw Errors.validation('assignee must be CUSTOMER or a department.');
    // A message listing every issue can be long; 8000 characters is room for dozens of them.
    const question = requireText(input.question, 'The question', 10, 8000);
    const subject = typeof input.subject === 'string' && input.subject.trim() ? input.subject.trim().slice(0, 160) : undefined;
    await this.loadFor(user, 'RAISE_QUERY', caseId);
    this.assertDepartmentRole(user, department);
    return (
      await this.mutate(caseId, actorRef(user), 'QUERY_RAISED', (c) => {
        const query = this.newQuery(c, actorRef(user), department, assignee, question, input.findingIds, Boolean(input.requiresCorrection), subject);
        if (assignee === 'CUSTOMER' && c.status === 'UNDER_REVIEW') setStatus(c, 'PENDING_CUSTOMER_CLARIFICATION', actorRef(user), `Query ${query.queryId} to the customer`);
        if (c.status === 'APPROVAL_PENDING') this.requireReReview(c, [department], `Query ${query.queryId} raised during approval`);
        return { queryId: query.queryId, department, assignee, findingIds: query.findingIds };
      })
    ).tradeCase;
  }

  /**
   * One message to the customer for every issue the trade desk found, instead of a query per
   * finding. Only what the customer can act on goes in: missing or inconsistent details, an
   * unreadable document, LC terms. Compliance, TBML, credit and operational findings are the
   * bank's own business and never appear in it. The desk reads and edits the text, then sends it
   * with raiseQuery (subject, body and the listed findings).
   */
  async composeCustomerMail(user: AuthenticatedUser, caseId: string, selected: unknown): Promise<Record<string, unknown>> {
    const c = await this.loadFor(user, 'RAISE_QUERY', caseId);
    if (isCustomerView(user)) throw forbidden('Only the bank writes to the customer.');
    const customerSafe: FindingCategory[] = ['MISSING_INFORMATION', 'DATA_INCONSISTENCY', 'LC_TERM_ISSUE', 'DOCUMENT_QUALITY', 'LOW_CONFIDENCE_EXTRACTION'];
    const open = c.findings.filter((f) => f.status === 'OPEN' && f.stage === 'PRE_TRADE');
    // An AI note rated LOW needs no action from the customer, so it is not put in the message (it stays on the scrutiny page).
    const mailable = open.filter((f) => customerSafe.includes(f.category) && !officerOnly(f) && !(isAiFinding(f) && f.severity === 'LOW'));
    const wanted = Array.isArray(selected) ? new Set(selected.filter((v): v is string => typeof v === 'string')) : null;
    const issues = mailable.filter((f) => !wanted || wanted.has(f.findingId));
    // Already asked about in a message still waiting for the customer: do not ask twice.
    const alreadyAsked = new Set(c.queries.filter((q) => q.assignee === 'CUSTOMER' && q.status === 'OPEN').flatMap((q) => q.findingIds));

    const app = currentApplication(c);
    const name = app.applicant.name || c.customerRef;
    const mailIssues: MailIssue[] = issues.map((f) => (isAiFinding(f) ? { title: f.title, detail: withoutModelNote(f.description), action: f.recommendedAction } : { title: f.title, detail: this.customerWording(f), action: '' }));
    // The rules, the engines and the AI can each report the same problem; the customer is told it once.
    const points = groupMailPoints(mailIssues);

    let subject = issues.length === 0 ? `${c.caseId}: your import LC request` : `${c.caseId}: ${issues.length} point${issues.length === 1 ? '' : 's'} to correct in your documents`;
    let body = '';
    let drafted: 'AI' | 'TEMPLATE' | 'NONE' = 'NONE';
    let model: string | null = null;
    let aiError: string | null = null;
    if (issues.length > 0) {
      try {
        const draft = await draftCustomerMail({
          caseId: c.caseId,
          customerName: name,
          senderName: user.name,
          institution: user.institution,
          issues: points,
          documents: c.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId).map((d) => `${DOCUMENT_LABELS[d.documentType] ?? d.documentType} (${d.filename})`),
        });
        subject = draft.subject;
        body = draft.body;
        model = draft.model;
        drafted = 'AI';
      } catch (error) {
        // A letter the desk can edit is better than none; it says it was not written by the AI.
        aiError = error instanceof AiUnavailable ? error.message : 'The AI could not write the message.';
        drafted = 'TEMPLATE';
        const lines = points.map((p, i) => `${i + 1}. ${p.detail}${p.action ? ` ${p.action}` : ''}`);
        body = [
          `Dear ${name},`,
          '',
          `Thank you for your import LC request ${c.caseId}. The bank's trade operations team has reviewed the documents you sent and found ${points.length === 1 ? 'one point' : `${points.length} points`} that must be corrected before the request can go further:`,
          '',
          ...lines,
          '',
          'Please correct these points in your documents, upload the corrected documents when you reply to this message (a new upload replaces the earlier document of the same type), and tell us what you changed.',
          '',
          'Kind regards,',
          user.name,
          user.institution,
        ].join('\n');
      }
    }
    return {
      caseId: c.caseId,
      subject,
      body,
      drafted,
      model,
      aiError,
      issues: issues.map((f, i) => ({ findingId: f.findingId, ruleId: f.ruleId, title: f.title, severity: f.severity, text: mailIssues[i]!.detail, alreadyAsked: alreadyAsked.has(f.findingId) })),
      available: mailable.map((f) => ({ findingId: f.findingId, title: f.title, severity: f.severity, alreadyAsked: alreadyAsked.has(f.findingId) })),
      /** Open findings kept out of the message: compliance, credit and operational matters stay with the bank. */
      withheld: open.length - mailable.length,
      /** How many numbered points the message has once findings about the same problem are joined. */
      points: points.length,
    };
  }

  /** A finding in the customer's words: what is wrong, and what to send. Internal advice is not repeated. */
  /**
   * What the customer may read of a finding from external verification: the plain request, the value from their own
   * document, and nothing of the officer's reading (the official wording, an AI second opinion, "possible
   * misdeclaration", the source file, the rule's approval state, the officer's history).
   */
  private customerSafeExternalFinding(f: Finding): Finding {
    return {
      ...f,
      description: this.customerWording(f),
      recommendedAction: 'Please confirm the details, or send a corrected document.',
      expected: 'The details stated in your documents agree with each other and can be checked.',
      observed: f.observed.filter((o) => o.source === 'DOCUMENT' || o.source === 'APPLICATION'),
      confidence: null,
      history: [],
      disposition: f.disposition ? { ...f.disposition, rationale: '(internal)' } : null,
    };
  }

  private customerWording(f: Finding): string {
    if (f.ruleId === 'EXT-PORT-ID') return `We could not confirm the port named in your documents (${f.observed.find((o) => o.source === 'DOCUMENT')?.value ?? 'the port'}). Please confirm the port's exact name and country, or its UN/LOCODE, and send a corrected document if it is wrong.`;
    if (f.ruleId === 'EXT-VESSEL-ID') return `The vessel details in your documents could not be confirmed (${f.observed.find((o) => o.source === 'DOCUMENT')?.value ?? 'the vessel'}). Please confirm the vessel's name and IMO number.`;
    if (f.ruleId === 'EXT-PCT-VALID') return `We could not confirm the customs tariff code in your documents (${f.observed.find((o) => o.source === 'DOCUMENT')?.value ?? 'the code'}). Please confirm the full 8-digit tariff code from your supplier or clearing agent, and send a corrected document if it is wrong.`;
    if (f.ruleId === 'EXT-HS-VALID' || f.ruleId === 'EXT-HS-CLASS') {
      const stated = f.observed.find((o) => o.source === 'DOCUMENT')?.value ?? 'the HS code';
      return f.category === 'MISSING_INFORMATION'
        ? `The goods description in your documents is too general for us to check its HS code (${stated}). Please send the product name, material and use, for example from the supplier's specification.`
        : `We could not confirm that the HS code in your documents matches the goods described (${stated}). Please confirm the correct HS classification, for example from your supplier's tariff classification, and send a corrected document if it is wrong.`;
    }
    if (f.ruleId === 'EXT-HS-CROSSDOC') return 'Your documents state different HS codes for the goods. Please confirm which code is correct and send a corrected document.';
    if (isAiFinding(f)) return `${f.title}: ${withoutModelNote(f.description)}${f.recommendedAction ? ` ${f.recommendedAction}` : ''}`;
    if (f.ruleId === 'PT-REQ-001') {
      const label = f.title.replace(/ not provided$/i, '');
      return `${label}: this is not stated in the documents you sent. Please send a document that shows it.`;
    }
    if (f.ruleId === 'PK-FEM13-07-FIRM') return "We could not find the supplier's proforma invoice, purchase order or contract. Please send the supplier's proforma invoice.";
    if (f.ruleId === 'PT-DOC-EXTRACTION') {
      return f.category === 'LOW_CONFIDENCE_EXTRACTION'
        ? 'Some details of the proforma invoice could not be read with confidence. Please send a clear copy (a text-based PDF rather than a photo or scan, if you can).'
        : 'One of your documents could not be read. Please send a clearer copy.';
    }
    return `${f.title}. ${f.description} Please send a corrected document, or explain the difference.`;
  }

  async respondQuery(
    user: AuthenticatedUser,
    caseId: string,
    queryId: string,
    input: { text?: unknown; applicationChanges?: unknown; reason?: unknown; documentLinkIds?: unknown },
  ): Promise<TradeCase> {
    const responseText = requireText(input.text, 'A response', 3);
    const changes = input.applicationChanges ? parseApplication(input.applicationChanges) : null;
    const c0 = await this.loadFor(user, 'RESPOND_QUERY', caseId);
    const q0 = c0.queries.find((q) => q.queryId === queryId);
    if (!q0 || (isCustomerView(user) && q0.assignee !== 'CUSTOMER')) throw Errors.notFound('query');
    if (q0.assignee === 'CUSTOMER') {
      this.require(user, 'tradecase.query.respond.customer', 'answer a query addressed to the customer');
    } else {
      this.require(user, 'tradecase.query.respond.internal', 'answer an internal query');
      this.assertDepartmentRole(user, q0.assignee);
    }
    if (q0.status !== 'OPEN') throw stateConflict('Only an open query can be answered.');
    const linkIds = Array.isArray(input.documentLinkIds) ? input.documentLinkIds.filter((v): v is string => typeof v === 'string') : [];

    const answered = await this.mutate(caseId, actorRef(user), 'QUERY_ANSWERED', (c) => {
      const q = c.queries.find((x) => x.queryId === queryId)!;
      for (const id of linkIds) if (!c.documents.some((d) => d.linkId === id)) throw Errors.validation(`Unknown document ${id}.`);
      const detail: Record<string, unknown> = { queryId, documentLinkIds: linkIds };
      if (changes) {
        if (c.status !== 'PENDING_CUSTOMER_CLARIFICATION' && c.status !== 'DRAFT') {
          throw stateConflict('The application can only be corrected while the case is waiting for the customer.');
        }
        Object.assign(detail, this.applicationChange(c, changes, actorRef(user), requireText(input.reason ?? `Correction in response to ${queryId}`, 'A reason', 3, 500), false));
      }
      // A reply goes to the bank, so whatever the customer attached to answer it has now been sent.
      if (isCustomerView(user)) for (const d of awaitingSend(c)) d.sentToBankAt = new Date().toISOString();
      q.responses.push({ by: actorRef(user), at: new Date().toISOString(), text: responseText, applicationVersion: changes ? c.currentApplicationVersion : null, documentLinkIds: linkIds });
      q.status = 'ANSWERED';
      // The department that asked must look again; answering is not the same as resolving.
      // Reviews and pre-trade validation belong to the request before it is approved; an answer during post-shipment
      // examination goes to the examining officer and re-runs nothing by itself.
      if (PRE_ISSUANCE_REVALIDATION.includes(c.status)) this.requireReReview(c, [q.department], `Query ${queryId} answered`);
      const stillWaiting = c.queries.some((x) => x.assignee === 'CUSTOMER' && x.status === 'OPEN');
      if (c.status === 'PENDING_CUSTOMER_CLARIFICATION' && !stillWaiting) setStatus(c, 'UNDER_REVIEW', actorRef(user), `Customer answered ${queryId}`);
      return detail;
    });
    if (!PRE_ISSUANCE_REVALIDATION.includes(answered.tradeCase.status)) return answered.tradeCase;
    return (await this.revalidate(caseId, 'SYSTEM', `Revalidated after the answer to ${queryId}`)).tradeCase;
  }

  async resolveQuery(user: AuthenticatedUser, caseId: string, queryId: string, input: { decision?: unknown; rationale?: unknown }): Promise<TradeCase> {
    const decision = String(input.decision ?? '');
    if (decision !== 'RESOLVE' && decision !== 'REOPEN') throw Errors.validation('decision must be RESOLVE or REOPEN.');
    const rationale = requireText(input.rationale, 'A rationale');
    const c0 = await this.loadFor(user, 'RESOLVE_QUERY', caseId);
    const q0 = c0.queries.find((q) => q.queryId === queryId);
    if (!q0) throw Errors.notFound('query');
    this.assertDepartmentRole(user, q0.department);
    if (q0.status !== 'ANSWERED') throw stateConflict('Only an answered query can be resolved or reopened.');
    return (
      await this.mutate(caseId, actorRef(user), decision === 'RESOLVE' ? 'QUERY_RESOLVED' : 'QUERY_REOPENED', (c) => {
        const q = c.queries.find((x) => x.queryId === queryId)!;
        if (decision === 'RESOLVE') {
          const stillOpen = q.findingIds.filter((id) => c.findings.some((f) => f.findingId === id && f.status === 'OPEN'));
          if (stillOpen.length > 0) {
            throw stateConflict('The linked findings are still open; the answer has not fixed them. Reopen the query or disposition the findings first.', { openFindings: stillOpen });
          }
          q.status = 'RESOLVED';
          q.resolution = { by: actorRef(user), at: new Date().toISOString(), rationale };
        } else {
          q.status = 'OPEN';
          q.reopenedCount += 1;
          if (q.assignee === 'CUSTOMER' && c.status === 'UNDER_REVIEW') setStatus(c, 'PENDING_CUSTOMER_CLARIFICATION', actorRef(user), `Query ${queryId} reopened: ${rationale}`);
        }
        return { queryId, decision, rationale };
      })
    ).tradeCase;
  }

  // ---------------------------------------------------------------- findings & credit

  async dispositionFinding(user: AuthenticatedUser, caseId: string, findingId: string, input: { code?: unknown; rationale?: unknown }): Promise<TradeCase> {
    const code = String(input.code ?? '') as FindingDispositionCode;
    const rationale = requireText(input.rationale, 'A rationale for the disposition');
    const c0 = await this.loadFor(user, 'VIEW', caseId);
    const f0 = c0.findings.find((f) => f.findingId === findingId);
    if (!f0) throw Errors.notFound('finding');
    // A finding of a verification rule the bank approved as a control is a control's finding: clearing it is an
    // exception and takes compliance authority, whatever its category. While the rule is not approved (a
    // demonstration or shadow rule) the ordinary desk rules apply. The decision and its reason are audited either way.
    const approvedControl = f0.origin === 'EXTERNAL_VERIFICATION' && enforcementOf(f0.ruleId).mode === 'ENFORCED';
    const compliance = this.policy.complianceCategories.includes(f0.category) || approvedControl;
    this.authorize(user, compliance ? 'DISPOSITION_COMPLIANCE_FINDING' : 'DISPOSITION_FINDING', c0);
    // The exact permission for this kind of finding, then the owning department.
    this.require(
      user,
      compliance ? 'tradecase.finding.disposition.compliance' : f0.category === 'CREDIT_BLOCKER' ? 'tradecase.finding.disposition.credit' : 'tradecase.finding.disposition.data',
      `disposition a ${f0.category.replace(/_/g, ' ').toLowerCase()} finding`,
    );
    // A compliance-class finding is cleared by whoever holds the compliance disposition permission (the
    // trade desk holds it in the pre-shipment model); any other finding by its owning department.
    if (!compliance) this.assertDepartmentRole(user, f0.ownerDepartment);
    // An escalated finding still blocks and is not final: whoever holds the permission can close it after
    // looking again, and the history keeps both decisions.
    const escalated = f0.status === 'DISPOSITIONED' && f0.disposition?.code === 'CONFIRMED_ESCALATED';
    if (f0.status !== 'OPEN' && !escalated) throw stateConflict('Only an open or escalated finding can be dispositioned.');
    // A documentary discrepancy that blocks is decided through the applicant's waiver and the presentation decision; one that does
    // not block is an observation the examiner may mark as examined.
    const allowed: FindingDispositionCode[] = f0.category === 'DOCUMENTARY_DISCREPANCY' && f0.stage === 'POST_TRADE' && !f0.blocking ? ['VERIFIED_MANUALLY'] : ALLOWED_DISPOSITIONS[f0.category];
    if (!allowed.includes(code)) {
      throw Errors.validation(`A ${f0.category.replace(/_/g, ' ').toLowerCase()} finding takes one of: ${allowed.join(', ') || '(decided through the presentation decision)'}.`);
    }
    return (
      await this.mutate(caseId, actorRef(user), 'FINDING_DISPOSITIONED', (c) => {
        const f = c.findings.find((x) => x.findingId === findingId)!;
        const now = new Date().toISOString();
        f.status = 'DISPOSITIONED';
        f.disposition = { code, rationale, by: actorRef(user), at: now };
        f.history.push({ at: now, actor: actorRef(user), event: 'DISPOSITIONED', detail: `${code}: ${rationale}${escalated ? ' (replaces the earlier escalation)' : ''}` });
        return { findingId, code, rationale, category: f.category, ruleId: f.ruleId };
      })
    ).tradeCase;
  }

  async recordCreditFacility(
    user: AuthenticatedUser,
    caseId: string,
    input: { facilityReference?: unknown; availableLimit?: unknown; currency?: unknown; marginPercent?: unknown; verificationSource?: unknown; note?: unknown },
  ): Promise<TradeCase> {
    const facilityReference = requireText(input.facilityReference, 'The facility reference', 3, 80);
    const availableLimit = Number(input.availableLimit);
    if (!Number.isFinite(availableLimit) || availableLimit < 0) throw Errors.validation('availableLimit must be a non-negative number.');
    const currency = String(input.currency ?? '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw Errors.validation('currency is a 3-letter ISO code.');
    const marginPercent = Number(input.marginPercent ?? 0);
    if (!Number.isFinite(marginPercent) || marginPercent < 0 || marginPercent > 100) throw Errors.validation('marginPercent is 0–100.');
    const source = String(input.verificationSource ?? '');
    if (source !== 'MANUAL_OFFICER_VERIFIED' && source !== 'SANDBOX_DEMO_DATA') {
      throw Errors.validation('verificationSource must be MANUAL_OFFICER_VERIFIED (you checked the credit system yourself) or SANDBOX_DEMO_DATA.');
    }
    const note = requireText(input.note, 'A note on how the figure was verified');
    await this.loadFor(user, 'RECORD_CREDIT_FACILITY', caseId);
    await this.mutate(caseId, actorRef(user), 'CREDIT_FACILITY_RECORDED', (c) => {
      c.creditFacility = {
        facilityReference,
        availableLimit,
        currency,
        marginPercent,
        verificationSource: source,
        verifiedBy: actorRef(user),
        verifiedAt: new Date().toISOString(),
        note,
      };
      this.requireReReview(c, ['CREDIT'], 'Facility record changed');
      return { facilityReference, availableLimit, currency, marginPercent, verificationSource: source };
    });
    return (await this.revalidate(caseId, 'SYSTEM', 'Revalidated after the facility was recorded')).tradeCase;
  }

  // ---------------------------------------------------------------- approval (maker-checker)

  /** Everything that stops the maker asking for approval. Empty means ready. */
  approvalBlockers(c: TradeCase): string[] {
    const blockers: string[] = [];
    for (const review of Object.values(c.reviews)) {
      if (!review.required) continue;
      if (review.status !== 'APPROVED') blockers.push(`${review.department} review: ${review.status.replace(/_/g, ' ').toLowerCase()}`);
      else if (review.applicationVersion !== c.currentApplicationVersion) blockers.push(`${review.department} approved an earlier application version`);
    }
    for (const f of c.findings) if (f.stage === 'PRE_TRADE' && blocksNow(f)) blockers.push(`${f.findingId} ${f.title}`);
    for (const q of c.queries) if (q.status !== 'RESOLVED') blockers.push(`Query ${q.queryId} is ${q.status.toLowerCase()}`);
    if (c.reviews.CREDIT.required && !c.creditFacility) blockers.push('No credit facility verification recorded');
    return blockers;
  }

  async requestApproval(user: AuthenticatedUser, caseId: string, note: unknown): Promise<TradeCase> {
    const rationale = requireText(note, 'A note for the approver', 3);
    await this.loadFor(user, 'REQUEST_APPROVAL', caseId);
    return (
      await this.mutate(caseId, actorRef(user), 'APPROVAL_REQUESTED', (c) => {
        const blockers = this.approvalBlockers(c);
        if (blockers.length > 0) throw stateConflict('The case is not ready for approval.', { blockers });
        c.sequences.approval += 1;
        const approvalId = `AP-${String(c.sequences.approval).padStart(2, '0')}`;
        c.approvals.push({
          approvalId,
          requestedBy: actorRef(user),
          requestedAt: new Date().toISOString(),
          applicationVersion: c.currentApplicationVersion,
          findingsDigest: findingsDigest(c.findings),
          status: 'PENDING',
          decidedBy: null,
          decidedAt: null,
          rationale,
        });
        setStatus(c, 'APPROVAL_PENDING', actorRef(user), 'Submitted for authorisation (maker)');
        return { approvalId, applicationVersion: c.currentApplicationVersion };
      })
    ).tradeCase;
  }

  /**
   * What stops the single-step pre-shipment approval. No departmental review is involved: the case
   * needs a document, no open blocking finding, and every message to the customer resolved.
   */
  preShipmentBlockers(c: TradeCase): string[] {
    const blockers: string[] = [];
    if (!c.documents.some((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId)) blockers.push('No document has been received');
    for (const d of awaitingSend(c)) blockers.push(`${d.filename} was added by the customer but has not been sent to the bank yet`);
    for (const f of c.findings) if (f.stage === 'PRE_TRADE' && blocksNow(f)) blockers.push(`${f.findingId} ${f.title}`);
    // With the AI required, every current document must have been scrutinised and compared with the rest.
    if (config.preshipment.requireAi) {
      if (c.scrutinyRun?.status === 'RUNNING') blockers.push('The AI scrutiny is still running');
      const current = c.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId);
      for (const d of current) if (!c.aiReviews?.[d.documentId]) blockers.push(`The AI has not scrutinised ${d.filename}`);
      if (current.length > 0 && current.every((d) => c.aiReviews?.[d.documentId]) && !caseReviewIsCurrent(c)) blockers.push('The AI has not compared the current documents with each other');
    }
    for (const q of c.queries) {
      if (q.status === 'RESOLVED') continue;
      blockers.push(q.assignee === 'CUSTOMER' ? `Message ${q.queryId} ${q.status === 'OPEN' ? 'is waiting for the customer' : 'was answered and is not resolved yet'}` : `Query ${q.queryId} is ${q.status.toLowerCase()}`);
    }
    return blockers;
  }

  /**
   * The trade desk's own approval once its scrutiny leaves nothing blocking. One step, by the desk
   * that did the scrutiny: this deliberately has no separate approver, and the audit event says so.
   */
  async approvePreShipment(user: AuthenticatedUser, caseId: string, note: unknown): Promise<TradeCase> {
    const rationale = requireText(note, 'A rationale for the approval', 3);
    await this.loadFor(user, 'APPROVE_PRESHIPMENT', caseId);
    return (
      await this.mutate(caseId, actorRef(user), 'PRESHIPMENT_APPROVED', (c) => {
        const blockers = this.preShipmentBlockers(c);
        if (blockers.length > 0) throw stateConflict('The request cannot be approved yet.', { blockers });
        const now = new Date().toISOString();
        c.sequences.approval += 1;
        const approvalId = `AP-${String(c.sequences.approval).padStart(2, '0')}`;
        c.approvals.push({
          approvalId,
          requestedBy: actorRef(user),
          requestedAt: now,
          applicationVersion: c.currentApplicationVersion,
          findingsDigest: findingsDigest(c.findings),
          status: 'APPROVED',
          decidedBy: actorRef(user),
          decidedAt: now,
          rationale,
        });
        const preShipmentReference = assignPreShipmentReference(c, actorRef(user));
        setStatus(c, 'AUTHORIZED_FOR_ISSUANCE', actorRef(user), 'Approved by the trade desk after the pre-shipment scrutiny');
        return { approvalId, rationale, applicationVersion: c.currentApplicationVersion, singleStep: true, preShipmentReference };
      })
    ).tradeCase;
  }

  async decideApproval(user: AuthenticatedUser, caseId: string, input: { decision?: unknown; rationale?: unknown }): Promise<TradeCase> {
    const decision = String(input.decision ?? '');
    if (decision !== 'APPROVE' && decision !== 'RETURN') throw Errors.validation('decision must be APPROVE or RETURN.');
    const rationale = requireText(input.rationale, 'A rationale for the decision');
    await this.loadFor(user, 'APPROVE', caseId);
    const sod = this.sodFor(user);
    return (
      await this.mutate(caseId, actorRef(user), decision === 'APPROVE' ? 'APPROVAL_GRANTED' : 'APPROVAL_RETURNED', (c) => {
        const approval = c.approvals.find((a) => a.status === 'PENDING');
        if (!approval) throw stateConflict('There is no pending approval request.');
        if (sod.approverNotMaker && approval.requestedBy.id === user.id) throw forbidden('Separation of duties: the maker cannot authorise their own request.');
        for (const d of sod.approverNotReviewerOf) {
          if (c.reviews[d].decidedBy?.id === user.id) throw forbidden(`Separation of duties: you completed the ${d.replace(/_/g, ' ')} review on this case.`);
        }
        approval.decidedBy = actorRef(user);
        approval.decidedAt = new Date().toISOString();
        if (decision === 'RETURN') {
          approval.status = 'RETURNED';
          approval.rationale = rationale;
          setStatus(c, 'UNDER_REVIEW', actorRef(user), `Returned by the checker: ${rationale}`);
          return { approvalId: approval.approvalId, decision, rationale };
        }
        const blockers = this.approvalBlockers(c);
        if (blockers.length > 0) throw stateConflict('The case changed since approval was requested and is no longer ready.', { blockers });
        if (approval.applicationVersion !== c.currentApplicationVersion || approval.findingsDigest !== findingsDigest(c.findings)) {
          throw stateConflict('The application or its findings changed after the request; the maker must request approval again.');
        }
        approval.status = 'APPROVED';
        approval.rationale = rationale;
        assignPreShipmentReference(c, actorRef(user));
        setStatus(c, 'AUTHORIZED_FOR_ISSUANCE', actorRef(user), 'Authorised for LC issuance (checker)');
        return { approvalId: approval.approvalId, decision, rationale, applicationVersion: approval.applicationVersion };
      })
    ).tradeCase;
  }

  async reject(user: AuthenticatedUser, caseId: string, rationale: unknown): Promise<TradeCase> {
    const reason = requireText(rationale, 'A reason for rejection');
    await this.loadFor(user, 'REJECT', caseId);
    return (
      await this.mutate(caseId, actorRef(user), 'REJECTED', (c) => {
        for (const a of c.approvals) if (a.status === 'PENDING') Object.assign(a, { status: 'REJECTED', decidedBy: actorRef(user), decidedAt: new Date().toISOString(), rationale: reason });
        setStatus(c, 'REJECTED', actorRef(user), reason);
        c.closedAt = new Date().toISOString();
        return { reason };
      })
    ).tradeCase;
  }

  async cancel(user: AuthenticatedUser, caseId: string, rationale: unknown): Promise<TradeCase> {
    const reason = requireText(rationale, 'A reason for cancellation');
    await this.loadFor(user, 'CANCEL', caseId);
    return (
      await this.mutate(caseId, actorRef(user), 'CANCELLED', (c) => {
        setStatus(c, 'CANCELLED', actorRef(user), reason);
        c.closedAt = new Date().toISOString();
        return { reason };
      })
    ).tradeCase;
  }

  // ---------------------------------------------------------------- issuance & handover

  async recordIssuance(user: AuthenticatedUser, caseId: string, input: { financialInstrumentNumber?: unknown; financialInstrumentExpiry?: unknown }): Promise<TradeCase> {
    const fi = {
      number: String(input.financialInstrumentNumber ?? '').trim().toUpperCase(),
      expiryDate: String(input.financialInstrumentExpiry ?? '').trim(),
    };
    const c0 = await this.loadFor(user, 'RECORD_ISSUANCE', caseId);
    const approval = c0.approvals.find((a) => a.status === 'APPROVED');
    if (!approval) throw stateConflict('No approved authorisation on record.');
    if (this.sodFor(user).issuerNotApprover && approval.decidedBy?.id === user.id) {
      throw forbidden('Separation of duties: the approver cannot also record the issuance.');
    }
    if (approval.applicationVersion !== c0.currentApplicationVersion) throw stateConflict('The authorised application version is not the current one.');
    const terms = currentApplication(c0);
    const problems = validateFinancialInstrument(fi, terms.expiryDate, new Date());
    if (problems.length > 0) {
      throw new AppError({ status: 422, code: 'FINANCIAL_INSTRUMENT_INVALID', message: problems.join(' '), details: { ruleId: 'PK-FEM13-6B8-FI', problems } });
    }
    const adapter = getLcIssuanceAdapter();
    const result = await adapter.issue({ caseId, approvalId: approval.approvalId, terms, financialInstrument: fi });
    return (
      await this.mutate(caseId, actorRef(user), 'LC_ISSUED', (c) => {
        if (c.status !== 'AUTHORIZED_FOR_ISSUANCE') throw stateConflict('The case is no longer authorised for issuance.');
        c.issuedLc = {
          lcNumber: result.lcNumber,
          mode: result.mode,
          adapter: result.adapter,
          issuedAt: new Date().toISOString(),
          issuedBy: actorRef(user),
          approvalId: approval.approvalId,
          applicationVersion: c.currentApplicationVersion,
          terms: structuredClone(terms),
          effectiveTerms: structuredClone(terms),
          effectiveAmendmentNumber: 0,
          financialInstrument: fi,
          adapterMessage: result.message,
        };
        setStatus(c, 'LC_ISSUED', actorRef(user), `${result.mode} issuance ${result.lcNumber}; awaiting presentation`);
        // The handover: what post-trade inherits from pre-trade.
        const monitoring = c.findings.filter((f) => f.disposition?.code === 'RISK_ACCEPTED').map((f) => ({ findingId: f.findingId, title: f.title, ruleId: f.ruleId }));
        return {
          lcNumber: result.lcNumber,
          mode: result.mode,
          adapterMessage: result.message,
          financialInstrument: fi,
          handover: {
            applicationVersion: c.currentApplicationVersion,
            requiredDocuments: terms.requiredDocuments,
            latestShipmentDate: terms.latestShipmentDate,
            expiryDate: terms.expiryDate,
            preTradeFindings: c.findings.filter((f) => f.stage === 'PRE_TRADE').length,
            monitoringConditions: monitoring,
            creditSource: c.creditFacility?.verificationSource ?? null,
          },
        };
      })
    ).tradeCase;
  }

  // ---------------------------------------------------------------- presentation & examination

  async recordPresentation(
    user: AuthenticatedUser,
    caseId: string,
    files: UploadedFile[],
    documentTypesRaw: unknown,
  ): Promise<TradeCase> {
    const types = (Array.isArray(documentTypesRaw) ? documentTypesRaw : typeof documentTypesRaw === 'string' ? safeJsonArray(documentTypesRaw) : []).map(String);
    if (files.length === 0) throw Errors.validation('At least one presented document is required.');
    if (types.length !== files.length) throw Errors.validation('documentTypes must list one type per uploaded file, in order.');
    for (const t of types) {
      if (!(PRESENTATION_DOCUMENT_TYPES as readonly string[]).includes(t)) throw Errors.validation(`Unknown presentation document type ${t}.`);
    }
    const c0 = await this.loadFor(user, 'RECORD_PRESENTATION', caseId);
    if (!creditOfRecord(c0)) throw stateConflict('This request has not been approved, so there is nothing to present documents against.');
    const stored: Array<{ id: string; filename: string; isDuplicate?: boolean }> = [];
    for (const file of files) {
      stored.push(await getDocumentService().createFromUpload(file, { autoStart: true, customerId: c0.customerRef, source: 'batch_upload' }));
    }
    return (
      await this.mutate(caseId, actorRef(user), 'PRESENTATION_RECEIVED', (c) => {
        c.sequences.presentation += 1;
        const presentationId = `PR-${String(c.sequences.presentation).padStart(2, '0')}`;
        const links = stored.map((s, i) => this.linkDocument(c, user, s.id, s.filename, types[i] as PresentationDocumentType, 'POST_TRADE', presentationId, Boolean(s.isDuplicate)));
        const now = new Date().toISOString();
        c.presentations.push({
          presentationId,
          reference: `${preShipmentReferenceOf(c) ?? c.caseId}/P${c.sequences.presentation}`,
          origin: 'BANK',
          applicationStatus: 'SUBMITTED',
          submittedAt: now,
          submittedBy: actorRef(user),
          returnStatus: c.status,
          termsBasis: creditOfRecord(c)?.basis ?? 'ISSUED_CREDIT',
          receivedAt: now,
          recordedBy: actorRef(user),
          documentLinkIds: links.map((l) => l.linkId),
          examination: null,
          decision: null,
        });
        setStatus(c, 'DOCUMENT_EXAMINATION', actorRef(user), `Presentation ${presentationId} received`);
        return { presentationId, documents: links.map((l) => ({ linkId: l.linkId, documentType: l.documentType, documentId: l.documentId })) };
      })
    ).tradeCase;
  }

  // ---------------------------------------------------------------- post-shipment application

  /**
   * The signed-in customer's approved requests, each with its pre-shipment reference and its post-shipment
   * application if there is one. This is the list behind the client's Post-Shipment screen.
   */
  async postShipmentLcs(user: AuthenticatedUser): Promise<Array<Record<string, unknown>>> {
    this.authorize(user, 'VIEW');
    const cases = await this.listCases(user, { history: 'all' });
    return cases
      .filter((c) => POST_SHIPMENT_STATUSES.includes(c.status) && preShipmentReferenceOf(c))
      .map((c) => {
        const credit = creditOfRecord(c);
        const terms = credit?.terms ?? currentApplication(c);
        const approval = [...c.approvals].reverse().find((a) => a.status === 'APPROVED');
        const current = c.presentations[c.presentations.length - 1] ?? null;
        return {
          caseId: c.caseId,
          reference: preShipmentReferenceOf(c),
          status: c.status,
          approvedAt: c.preShipmentReference?.assignedAt ?? approval?.decidedAt ?? null,
          applicant: terms.applicant.name,
          beneficiary: terms.beneficiary.name,
          goodsDescription: terms.goodsDescription,
          currency: terms.currency,
          amount: terms.amount,
          latestShipmentDate: terms.latestShipmentDate,
          expiryDate: terms.expiryDate,
          requiredDocuments: terms.requiredDocuments,
          basis: credit?.basis ?? null,
          applications: c.presentations.length,
          application: current ? presentationSummary(c, current) : null,
          canStart: this.availableActions(user, c).includes('START_POST_SHIPMENT'),
        };
      });
  }

  /** The client starts (or resumes) the post-shipment application of an approved request. */
  async startPostShipment(user: AuthenticatedUser, caseId: string): Promise<TradeCase> {
    await this.loadFor(user, 'START_POST_SHIPMENT', caseId);
    return (
      await this.mutate(caseId, actorRef(user), 'POST_SHIPMENT_STARTED', (c) => {
        const credit = creditOfRecord(c);
        const reference = preShipmentReferenceOf(c);
        if (!credit || !reference) throw stateConflict('This request has not been approved, so there is nothing to present documents against.');
        const open = c.presentations.find((p) => !p.decision);
        if (open) {
          if (open.applicationStatus === 'DRAFT') return { presentationId: open.presentationId, reference: open.reference, resumed: true };
          throw stateConflict('A post-shipment application for this request is already with the bank.');
        }
        c.sequences.presentation += 1;
        const presentationId = `PR-${String(c.sequences.presentation).padStart(2, '0')}`;
        const now = new Date().toISOString();
        c.presentations.push({
          presentationId,
          reference: `${reference}/P${c.sequences.presentation}`,
          origin: 'CLIENT',
          applicationStatus: 'DRAFT',
          submittedAt: null,
          submittedBy: null,
          returnStatus: c.status,
          termsBasis: credit.basis,
          receivedAt: now,
          recordedBy: actorRef(user),
          documentLinkIds: [],
          examination: null,
          decision: null,
        });
        return { presentationId, reference: `${reference}/P${c.sequences.presentation}`, basis: credit.basis };
      })
    ).tradeCase;
  }

  /**
   * A document for the post-shipment application: into the draft, or, while the bank is examining, as a correction.
   * A document of the same type in the same application is replaced (the earlier one is kept, marked superseded);
   * the very same file is refused. A correction waits to be sent to the bank, like any document added after sending.
   */
  async attachPresentationDocument(user: AuthenticatedUser, caseId: string, file: UploadedFile | undefined, typeRaw: unknown): Promise<{ tradeCase: TradeCase; document: CaseDocument }> {
    const type = String(typeRaw ?? '').toUpperCase();
    if (!(PRESENTATION_DOCUMENT_TYPES as readonly string[]).includes(type)) throw Errors.validation(`documentType must be one of ${PRESENTATION_DOCUMENT_TYPES.join(', ')}.`);
    if (!file?.buffer) throw Errors.validation('Attach a file.');
    const c0 = await this.loadFor(user, 'ATTACH_PRESENTATION_DOCUMENT', caseId);
    const open = c0.presentations.find((p) => !p.decision);
    const examining = c0.status === 'DOCUMENT_EXAMINATION' || c0.status === 'DISCREPANCY_RESOLUTION';
    if (!open || (open.applicationStatus === 'DRAFT' ? examining : !examining)) throw stateConflict('Start the post-shipment application first, then add its documents.');
    const known = await getDocumentRepository().findByContentHash(c0.customerRef, computeContentHash(file.buffer));
    const same = known ? c0.documents.find((d) => d.presentationId === open.presentationId && !d.supersededByLinkId && d.documentId === known.id) : undefined;
    if (same) throw alreadyOnRequest(same, 'in this application');
    const stored = await getDocumentService().createFromUpload(file, { autoStart: true, customerId: c0.customerRef, source: 'manual_upload' });
    let linked: CaseDocument | null = null;
    const { tradeCase } = await this.mutate(caseId, actorRef(user), 'PRESENTATION_DOCUMENT_ATTACHED', (c) => {
      const p = c.presentations.find((x) => x.presentationId === open.presentationId);
      if (!p || p.decision) throw stateConflict('This application is no longer open.');
      // The check above ran before the case was locked: two identical uploads in flight (a double click) both passed it.
      const raced = c.documents.find((d) => d.presentationId === p.presentationId && !d.supersededByLinkId && d.documentId === stored.id);
      if (raced) throw alreadyOnRequest(raced, 'in this application');
      linked = this.linkDocument(c, user, stored.id, stored.filename, type as CaseDocumentType, 'POST_TRADE', p.presentationId, Boolean(stored.isDuplicate), undefined, true);
      // Once the application is with the bank, what the customer adds waits until they send it.
      if (p.applicationStatus !== 'DRAFT') linked.sentToBankAt = null;
      p.documentLinkIds.push(linked.linkId);
      return { presentationId: p.presentationId, linkId: linked.linkId, documentType: type, version: linked.version, correction: p.applicationStatus !== 'DRAFT' };
    });
    return { tradeCase, document: linked! };
  }

  /** Take a document out of a draft application (nothing the bank has received can be removed). */
  async removePresentationDocument(user: AuthenticatedUser, caseId: string, linkId: string): Promise<TradeCase> {
    await this.loadFor(user, 'REMOVE_PRESENTATION_DOCUMENT', caseId);
    return (
      await this.mutate(caseId, actorRef(user), 'PRESENTATION_DOCUMENT_REMOVED', (c) => {
        const link = c.documents.find((d) => d.linkId === linkId && d.stage === 'POST_TRADE');
        const p = link ? c.presentations.find((x) => x.presentationId === link.presentationId) : undefined;
        if (!link || !p) throw Errors.notFound('presented document');
        if (p.applicationStatus !== 'DRAFT' || p.decision) throw stateConflict('Only a document of a draft application can be removed; this one is with the bank.');
        c.documents = c.documents.filter((d) => d.linkId !== linkId);
        p.documentLinkIds = p.documentLinkIds.filter((id) => id !== linkId);
        // The version this one replaced is the current one again.
        for (const d of c.documents) if (d.supersededByLinkId === linkId) d.supersededByLinkId = null;
        return { presentationId: p.presentationId, linkId, filename: link.filename };
      })
    ).tradeCase;
  }

  /**
   * The client submits the application. It needs the documents the credit stipulates; once submitted it is with the
   * bank (the case moves to document examination, which is what puts it in the officer's queue) and the draft can no
   * longer be changed except by sending corrections when the bank asks for them.
   */
  async submitPostShipment(user: AuthenticatedUser, caseId: string): Promise<TradeCase> {
    await this.loadFor(user, 'SUBMIT_POST_SHIPMENT', caseId);
    return (
      await this.mutate(caseId, actorRef(user), 'POST_SHIPMENT_SUBMITTED', (c) => {
        const p = c.presentations.find((x) => !x.decision);
        if (!p || p.applicationStatus !== 'DRAFT') throw stateConflict('There is no draft application to submit.');
        const credit = creditOfRecord(c);
        const current = c.documents.filter((d) => d.presentationId === p.presentationId && !d.supersededByLinkId);
        if (current.length === 0) throw stateConflict('Add at least one document before submitting.');
        const presented = new Set(current.map((d) => d.documentType));
        const missing = (credit?.terms.requiredDocuments ?? []).filter((t) => (PRESENTATION_DOCUMENT_TYPES as readonly string[]).includes(t) && !presented.has(t as CaseDocumentType));
        if (missing.length > 0) throw stateConflict('The documents the credit calls for are not all here yet.', { missing });
        const now = new Date().toISOString();
        p.applicationStatus = 'SUBMITTED';
        p.submittedAt = now;
        p.submittedBy = actorRef(user);
        p.receivedAt = now;
        p.returnStatus = c.status;
        setStatus(c, 'DOCUMENT_EXAMINATION', actorRef(user), `Post-shipment application ${p.reference ?? p.presentationId} submitted`);
        return { presentationId: p.presentationId, reference: p.reference, documents: current.map((d) => ({ linkId: d.linkId, documentType: d.documentType, filename: d.filename, version: d.version })) };
      })
    ).tradeCase;
  }

  /**
   * The officer asks the client for a clarification or a corrected document. It reaches the client as a message in
   * their portal; the points asked about are attached to it. The case stays where it is until the officer decides.
   */
  async requestClarification(user: AuthenticatedUser, caseId: string, input: { subject?: unknown; question?: unknown; findingIds?: unknown }): Promise<TradeCase> {
    await this.loadFor(user, 'REQUEST_CLARIFICATION', caseId);
    const subject = typeof input.subject === 'string' && input.subject.trim() ? input.subject.trim() : `${caseId}: clarification needed on your post-shipment documents`;
    return this.raiseQuery(user, caseId, { department: 'TRADE_OPS', assignee: 'CUSTOMER', subject, question: input.question, findingIds: input.findingIds, requiresCorrection: true });
  }

  /** A finding the officer records themselves after reading the documents: it is theirs, labelled as such, and never automatic. */
  async addManualFinding(
    user: AuthenticatedUser,
    caseId: string,
    input: { title?: unknown; description?: unknown; severity?: unknown; blocking?: unknown; recommendedAction?: unknown; documentLinkId?: unknown },
  ): Promise<TradeCase> {
    const title = requireText(input.title, 'A title', 5, 160);
    const description = requireText(input.description, 'A description', 10, 2000);
    const severity = String(input.severity ?? 'MEDIUM').toUpperCase() as FindingSeverity;
    if (!['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(severity)) throw Errors.validation('severity must be CRITICAL, HIGH, MEDIUM, LOW or INFO.');
    await this.loadFor(user, 'ADD_MANUAL_FINDING', caseId);
    return (
      await this.mutate(caseId, actorRef(user), 'MANUAL_FINDING_ADDED', (c) => {
        const p = c.presentations.find((x) => !x.decision && x.applicationStatus !== 'DRAFT');
        if (!p) throw stateConflict('There is no application under examination.');
        const link = typeof input.documentLinkId === 'string' ? c.documents.find((d) => d.linkId === input.documentLinkId) : undefined;
        c.sequences.finding += 1;
        const findingId = `F-${String(c.sequences.finding).padStart(4, '0')}`;
        const now = new Date().toISOString();
        const blocking = input.blocking === true;
        const finding: Finding = {
          findingId,
          key: `EXM-MANUAL:${p.presentationId}:${findingId}`,
          ruleId: 'EXM-MANUAL',
          ruleVersion: '1',
          stage: 'POST_TRADE',
          category: 'DOCUMENTARY_DISCREPANCY',
          severity,
          blocking,
          title,
          description,
          fields: [],
          observed: link ? [{ source: 'DOCUMENT', label: 'Document the officer refers to', value: link.filename, documentId: link.documentId, filename: link.filename }] : [],
          expected: 'As the examiner reads the credit and the documents.',
          confidence: null,
          origin: 'REVIEWER',
          recommendedAction: typeof input.recommendedAction === 'string' && input.recommendedAction.trim() ? input.recommendedAction.trim() : 'Examiner to resolve.',
          ownerDepartment: 'TRADE_OPS',
          status: 'OPEN',
          disposition: null,
          applicantWaiver: null,
          presentationId: p.presentationId,
          amendmentId: null,
          raisedAt: now,
          lastEvaluatedAt: now,
          applicationVersion: c.currentApplicationVersion,
          history: [{ at: now, actor: actorRef(user), event: 'RAISED', detail: 'Recorded by the examining officer' }],
        };
        c.findings.push(finding);
        return { findingId, presentationId: p.presentationId, blocking, severity };
      })
    ).tradeCase;
  }

  /**
   * Everything an officer needs on one screen: the credit the application is examined against, the approved
   * pre-shipment documents beside what was submitted, a field-by-field comparison, and the findings by class.
   */
  async postShipmentReview(user: AuthenticatedUser, caseId: string): Promise<Record<string, unknown>> {
    const c = await this.loadFor(user, 'VIEW', caseId);
    if (isCustomerView(user)) throw forbidden('The examination screen is for the bank\'s officers.');
    const credit = creditOfRecord(c);
    const reference = preShipmentReferenceOf(c);
    if (!credit || !reference) throw stateConflict('This request has not been approved, so it has no post-shipment application.');
    const view = this.toView(user, c) as unknown as { findings: Finding[]; availableActions: string[] };
    const repo = getDocumentRepository();

    const approvedDocs = await this.approvedDocuments(c);
    const submitted = c.presentations.filter((p) => p.applicationStatus !== 'DRAFT');
    const active = submitted.find((p) => !p.decision) ?? submitted[submitted.length - 1] ?? null;
    const presented: VerifiedDocument[] = [];
    const documents = [];
    for (const p of submitted) {
      const links = p.documentLinkIds.map((id) => c.documents.find((d) => d.linkId === id)).filter((d): d is CaseDocument => Boolean(d));
      for (const link of links) {
        const meta = await repo.findMeta(link.documentId);
        const isCurrent = !link.supersededByLinkId;
        if (p === active && isCurrent) {
          const full = await repo.findFull(link.documentId);
          presented.push({ linkId: link.linkId, documentId: link.documentId, documentType: link.documentType, filename: link.filename, extraction: full?.status === 'completed' ? full.analysis?.tradeCompliance ?? null : null, units: (full?.units ?? []).map((u) => ({ pageNumber: u.pageNumber, text: u.text })) });
        }
        documents.push({
          presentationId: p.presentationId,
          linkId: link.linkId,
          documentType: link.documentType,
          filename: link.filename,
          version: link.version,
          superseded: Boolean(link.supersededByLinkId),
          uploadedAt: link.uploadedAt,
          uploadedBy: link.uploadedBy.name,
          sentToBankAt: link.sentToBankAt,
          analysisStatus: meta?.status ?? 'unknown',
        });
      }
    }
    const mine = active ? view.findings.filter((f) => f.presentationId === active.presentationId) : [];
    const classed = mine.map((f) => ({ ...f, class: classifyFinding(f), classLabel: FINDING_CLASS_LABELS[classifyFinding(f)] }));
    const counts = { BLOCKING_DISCREPANCY: 0, NON_BLOCKING_DISCREPANCY: 0, WARNING: 0, INFORMATION: 0 };
    for (const f of classed) if (f.status === 'OPEN') counts[f.class] += 1;
    const latestUpload = Math.max(0, ...presented.map((d) => Date.parse(c.documents.find((l) => l.linkId === d.linkId)?.uploadedAt ?? '') || 0));
    const terms = credit.terms;
    return {
      caseId: c.caseId,
      reference,
      status: c.status,
      customerRef: c.customerRef,
      credit: {
        reference: credit.reference,
        basis: credit.basis,
        applicationVersion: credit.applicationVersion,
        terms: {
          applicant: terms.applicant.name,
          beneficiary: terms.beneficiary.name,
          currency: terms.currency,
          amount: terms.amount,
          goodsDescription: terms.goodsDescription,
          hsCode: terms.hsCode,
          quantity: terms.quantity,
          unitOfMeasure: terms.unitOfMeasure,
          incoterm: terms.incoterm,
          portOfLoading: terms.portOfLoading,
          portOfDischarge: terms.portOfDischarge,
          latestShipmentDate: terms.latestShipmentDate,
          expiryDate: terms.expiryDate,
          presentationPeriodDays: terms.presentationPeriodDays,
          requiredDocuments: terms.requiredDocuments,
        },
      },
      approvedAt: c.preShipmentReference?.assignedAt ?? [...c.approvals].reverse().find((a) => a.status === 'APPROVED')?.decidedAt ?? null,
      approvedDocuments: approvedDocs.map((d) => ({ documentType: d.documentType, filename: d.filename, version: d.version })),
      applications: submitted.map((p) => ({ ...presentationSummary(c, p), documentLinkIds: p.documentLinkIds, aiReview: p.aiReview ?? null })),
      activePresentationId: active?.presentationId ?? null,
      documents,
      comparison: active ? buildComparison({ credit, approvedDocuments: approvedDocs, documents: presented }) : [],
      findings: classed,
      counts,
      queries: c.queries.filter((q) => q.assignee === 'CUSTOMER'),
      reexaminationDue: Boolean(active?.examination && latestUpload > Date.parse(active.examination.examinedAt)),
      requiredDocuments: terms.requiredDocuments,
      actions: view.availableActions,
    };
  }

  /** The documents that stood approved at the pre-shipment decision (the current version of each), with what the reader found in them. */
  private async approvedDocuments(c: TradeCase): Promise<ApprovedDocument[]> {
    const repo = getDocumentRepository();
    const out: ApprovedDocument[] = [];
    for (const link of c.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId)) {
      const full = await repo.findFull(link.documentId);
      out.push({
        documentType: link.documentType,
        filename: link.filename,
        documentId: link.documentId,
        version: link.version,
        extraction: full?.status === 'completed' ? full.analysis?.tradeCompliance ?? null : null,
        units: (full?.units ?? []).map((u) => ({ pageNumber: u.pageNumber, text: u.text })),
      });
    }
    return out;
  }


  /**
   * The AI-assisted reading of the presented documents against each other and the approved set. Every point must quote the
   * documents, a claimed difference is checked again, and what is kept is recorded as an advisory finding that never
   * blocks the case: the examiner decides. If the model is unavailable the rule-based examination is unaffected.
   */
  async aiScrutinyOfPresentation(user: AuthenticatedUser, caseId: string): Promise<TradeCase> {
    const c0 = await this.loadFor(user, 'EXAMINE_PRESENTATION', caseId);
    const p0 = [...c0.presentations].reverse().find((p) => !p.decision && p.applicationStatus !== 'DRAFT');
    const credit = creditOfRecord(c0);
    if (!p0 || !credit) throw stateConflict('There is no application under examination to read.');
    const t = credit.terms;
    const terms = JSON.stringify({ reference: credit.reference, basis: credit.basis, applicant: t.applicant.name, beneficiary: t.beneficiary.name, goods: t.goodsDescription, hsCode: t.hsCode, quantity: t.quantity, unit: t.unitOfMeasure, currency: t.currency, amount: t.amount, incoterm: t.incoterm, portOfLoading: t.portOfLoading, portOfDischarge: t.portOfDischarge, countryOfOrigin: t.countryOfOrigin, latestShipmentDate: t.latestShipmentDate }, null, 1);
    const digest = async (link: CaseDocument): Promise<PresentationDigest> => {
      const full = await getDocumentRepository().findFull(link.documentId);
      return { documentType: link.documentType, filename: link.filename, text: await readDocumentText(link.documentId), facts: full?.status === 'completed' && full.analysis?.tradeCompliance ? digestFacts(full.analysis.tradeCompliance) : '' };
    };
    const presented = [];
    for (const id of p0.documentLinkIds) {
      const link = c0.documents.find((d) => d.linkId === id);
      if (link && !link.supersededByLinkId) presented.push(await digest(link));
    }
    const approved = [];
    for (const link of c0.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId)) approved.push(await digest(link));
    if (presented.length === 0) throw stateConflict('The application has no document to read.');

    let review: Awaited<ReturnType<typeof reviewPresentation>>;
    try {
      review = await reviewPresentation({ terms, approved, documents: presented, documentIds: presented.map((d) => d.filename) });
    } catch (error) {
      if (error instanceof AiUnavailable) throw new AppError({ status: 503, code: 'AI_UNAVAILABLE', message: `${error.message} The examination by rules is not affected.`, retryable: true });
      throw error;
    }
    const known = new Map([...presented, ...approved].map((d) => [d.filename, c0.documents.find((l) => l.filename === d.filename)?.documentId]));
    const cap = (s: string): FindingSeverity => (s === 'LOW' ? 'LOW' : 'MEDIUM');
    const candidates = review.issues.map((issue) =>
      candidate('AI-POST-XDOC', `${p0.presentationId}:${issue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`, {
        stage: 'POST_TRADE',
        presentationId: p0.presentationId,
        category: 'DOCUMENTARY_DISCREPANCY',
        severity: cap(issue.severity),
        blocking: false,
        origin: 'AI_ASSISTED_EXTRACTION',
        title: issue.title,
        description: `${issue.description} This is the AI's reading, checked against the quoted words; the examiner confirms it against the originals.`,
        fields: issue.fields,
        observed: (issue.quotes ?? []).map((q) => ({ source: 'DOCUMENT' as const, label: 'Quoted by the AI', value: q.text, filename: q.file, ...(known.get(q.file) ? { documentId: known.get(q.file)! } : {}) })),
        expected: 'The documents agree, or the difference is explained.',
        recommendedAction: issue.customerAction || 'Examiner to confirm against the originals.',
      }),
    );
    return (
      await this.mutate(caseId, actorRef(user), 'PRESENTATION_AI_SCRUTINY', (c) => {
        const p = c.presentations.find((x) => x.presentationId === p0.presentationId);
        if (!p || p.decision) throw stateConflict('This application is no longer open.');
        // Only the AI's own points are merged: the rules' findings and the officer's are left as they are.
        const summary = this.mergeFindings(c, candidates, (f) => f.presentationId === p.presentationId && f.origin === 'AI_ASSISTED_EXTRACTION', c.currentApplicationVersion, false);
        const leftOut = (review.discarded ?? []).length;
        p.aiReview = { summary: review.summary, at: review.at, model: review.model, raised: review.issues.length, leftOut };
        return { presentationId: p.presentationId, model: review.model, issues: review.issues.length, leftOut, ...summary };
      })
    ).tradeCase;
  }

  async examinePresentation(user: AuthenticatedUser, caseId: string): Promise<TradeCase> {
    const c0 = await this.loadFor(user, 'EXAMINE_PRESENTATION', caseId);
    const presentation = c0.presentations[c0.presentations.length - 1];
    const credit = creditOfRecord(c0);
    if (!presentation || presentation.applicationStatus === 'DRAFT' || !credit) throw stateConflict('There is no presentation to examine.');
    const documents: PresentedDocument[] = [];
    const repo = getDocumentRepository();
    for (const linkId of presentation.documentLinkIds) {
      const link = c0.documents.find((d) => d.linkId === linkId);
      // A document that a correction replaced is kept on the record but is not examined again.
      if (!link || link.supersededByLinkId) continue;
      const doc = await repo.findFull(link.documentId);
      if (doc && ['uploaded', 'queued', 'processing'].includes(doc.status)) {
        throw stateConflict(`${link.filename} is still being analysed; examine once it has finished.`);
      }
      documents.push({
        linkId,
        documentId: link.documentId,
        documentType: link.documentType as PresentationDocumentType,
        filename: link.filename,
        extraction: doc?.status === 'completed' ? doc.analysis?.tradeCompliance ?? null : null,
        units: (doc?.units ?? []).map((u) => ({ pageNumber: u.pageNumber, text: u.text })),
      });
    }
    const piLink = activeDocument(c0, 'PROFORMA_INVOICE');
    const approvedPi = piLink ? (await repo.findMeta(piLink.documentId))?.analysis?.tradeCompliance ?? null : null;
    const approvedDocs = await this.approvedDocuments(c0);
    const approvedAt = c0.preShipmentReference?.assignedAt ?? [...c0.approvals].reverse().find((a) => a.status === 'APPROVED')?.decidedAt ?? null;
    // The credit's own rules, then the approved set and the documents against one another. Both are evidence for an examiner.
    const candidates = [
      ...evaluatePresentation({ credit, presentation, documents, approvedPi, policy: this.policy }),
      ...crossVerifyPresentation({ credit, presentation, documents: documents as VerifiedDocument[], approvedDocuments: approvedDocs, approvedAt, policy: this.policy }),
    ];

    return (
      await this.mutate(caseId, actorRef(user), 'PRESENTATION_EXAMINED', (c) => {
        const p = c.presentations.find((x) => x.presentationId === presentation.presentationId)!;
        // What the officer recorded by hand is theirs: a re-examination never closes it.
        const summary = this.mergeFindings(c, candidates, (f) => f.presentationId === p.presentationId && f.origin !== 'REVIEWER', c.currentApplicationVersion, false);
        const ids = c.findings.filter((f) => f.presentationId === p.presentationId).map((f) => f.findingId);
        const discrepant = c.findings.some((f) => f.presentationId === p.presentationId && blocksNow(f));
        p.examination = { examinedAt: new Date().toISOString(), examinedBy: actorRef(user), result: discrepant ? 'DISCREPANT' : 'COMPLYING', findingIds: ids, ruleSetVersion: RULE_SET_VERSION };
        if (discrepant) setStatus(c, 'DISCREPANCY_RESOLUTION', actorRef(user), `Presentation ${p.presentationId} discrepant`);
        else if (c.status === 'DISCREPANCY_RESOLUTION') setStatus(c, 'DOCUMENT_EXAMINATION', actorRef(user), `Presentation ${p.presentationId} re-examined: no blocking discrepancy remains`);
        return { presentationId: p.presentationId, result: p.examination.result, ...summary };
      })
    ).tradeCase;
  }

  async applicantWaiver(user: AuthenticatedUser, caseId: string, findingId: string, input: { accept?: unknown; note?: unknown }): Promise<TradeCase> {
    const accept = input.accept === true;
    const note = requireText(input.note, 'A note', 3);
    const c0 = await this.loadFor(user, 'APPLICANT_WAIVER', caseId);
    const f0 = c0.findings.find((f) => f.findingId === findingId);
    if (!f0 || f0.category !== 'DOCUMENTARY_DISCREPANCY') throw Errors.notFound('discrepancy');
    if (f0.status !== 'OPEN') throw stateConflict('This discrepancy has already been decided.');
    return (
      await this.mutate(caseId, actorRef(user), 'APPLICANT_WAIVER', (c) => {
        const f = c.findings.find((x) => x.findingId === findingId)!;
        const now = new Date().toISOString();
        f.applicantWaiver = { accepted: accept, by: actorRef(user), at: now, note };
        f.history.push({ at: now, actor: actorRef(user), event: 'APPLICANT_WAIVER', detail: `${accept ? 'Waived' : 'Not waived'}: ${note}` });
        return { findingId, accepted: accept, note };
      })
    ).tradeCase;
  }

  async decidePresentation(user: AuthenticatedUser, caseId: string, input: { decision?: unknown; rationale?: unknown }): Promise<TradeCase> {
    const decision = String(input.decision ?? '');
    if (decision !== 'ACCEPT' && decision !== 'REFUSE') throw Errors.validation('decision must be ACCEPT or REFUSE.');
    const rationale = requireText(input.rationale, 'A rationale');
    await this.loadFor(user, 'DECIDE_PRESENTATION', caseId);
    return (
      await this.mutate(caseId, actorRef(user), decision === 'ACCEPT' ? 'PRESENTATION_ACCEPTED' : 'PRESENTATION_REFUSED', (c) => {
        const p = c.presentations[c.presentations.length - 1];
        if (!p?.examination) throw stateConflict('The presentation has not been examined.');
        if (p.decision) throw stateConflict('This presentation has already been decided.');
        if (this.sodFor(user).presentationDeciderNotPresenter && p.recordedBy.id === user.id) {
          throw forbidden('Separation of duties: whoever recorded the presentation cannot decide it.');
        }
        const now = new Date().toISOString();
        const own = c.findings.filter((f) => f.presentationId === p.presentationId);
        if (decision === 'ACCEPT') {
          // Only a discrepancy that blocks needs the applicant's waiver; an observation that does not block is accepted with the presentation.
          const unwaived = own.filter((f) => f.category === 'DOCUMENTARY_DISCREPANCY' && f.blocking && f.status === 'OPEN' && !f.applicantWaiver?.accepted);
          if (unwaived.length > 0) throw stateConflict('Discrepancies without the applicant\'s waiver cannot be accepted.', { findings: unwaived.map((f) => f.findingId) });
          const other = own.filter((f) => f.category !== 'DOCUMENTARY_DISCREPANCY' && blocksNow(f));
          if (other.length > 0) throw stateConflict('Open compliance or verification findings on this presentation must be dispositioned first.', { findings: other.map((f) => f.findingId) });
          for (const f of own.filter((x) => x.category === 'DOCUMENTARY_DISCREPANCY' && x.status === 'OPEN')) {
            f.status = 'DISPOSITIONED';
            f.disposition = f.blocking ? { code: 'DISCREPANCY_WAIVED', rationale, by: actorRef(user), at: now } : { code: 'VERIFIED_MANUALLY', rationale, by: actorRef(user), at: now };
            f.history.push({ at: now, actor: actorRef(user), event: 'DISPOSITIONED', detail: f.blocking ? 'Waived by the applicant; accepted by the bank' : 'An observation that does not block; accepted with the presentation' });
          }
          p.decision = { decision: 'ACCEPTED', by: actorRef(user), at: now, rationale };
          setStatus(c, 'AWAITING_SETTLEMENT', actorRef(user), `Presentation ${p.presentationId} accepted`);
        } else {
          for (const f of own.filter((x) => x.category === 'DOCUMENTARY_DISCREPANCY' && x.status === 'OPEN')) {
            f.status = 'DISPOSITIONED';
            f.disposition = { code: 'DISCREPANCY_UPHELD', rationale, by: actorRef(user), at: now };
            f.history.push({ at: now, actor: actorRef(user), event: 'DISPOSITIONED', detail: 'Presentation refused' });
          }
          p.decision = { decision: 'REFUSED', by: actorRef(user), at: now, rationale };
          setStatus(c, p.returnStatus ?? 'LC_ISSUED', actorRef(user), `Presentation ${p.presentationId} refused; awaiting re-presentation`);
        }
        return { presentationId: p.presentationId, decision, rationale };
      })
    ).tradeCase;
  }

  // ---------------------------------------------------------------- settlement, investigation, closure

  async recordSettlement(
    user: AuthenticatedUser,
    caseId: string,
    input: { mode?: unknown; amount?: unknown; currency?: unknown; valueDate?: unknown; reference?: unknown; note?: unknown },
  ): Promise<TradeCase> {
    const mode = String(input.mode ?? '');
    if (mode !== 'SANDBOX' && mode !== 'MANUAL_RECORD') throw Errors.validation('mode must be SANDBOX or MANUAL_RECORD; this platform never initiates a payment.');
    const amount = Number(input.amount);
    const currency = String(input.currency ?? '').toUpperCase();
    const valueDate = String(input.valueDate ?? '');
    if (!isoDate.safeParse(valueDate).success) throw Errors.validation('valueDate is YYYY-MM-DD.');
    const reference = requireText(input.reference, 'The settlement reference', 3, 80);
    const note = requireText(input.note ?? 'Settlement recorded', 'A note', 3);
    const c0 = await this.loadFor(user, 'RECORD_SETTLEMENT', caseId);
    if (this.sodFor(user).settlementNotIssuer && c0.issuedLc?.issuedBy.id === user.id) {
      throw forbidden('Separation of duties: the issuer cannot also record settlement.');
    }
    const terms = creditOfRecord(c0)?.terms;
    if (!terms) throw stateConflict('There is no credit of record to settle against.');
    if (currency !== terms.currency) throw Errors.validation(`Settlement currency must be the credit currency (${terms.currency}).`);
    const ceiling = (terms.amount ?? 0) * (1 + terms.amountTolerancePercent / 100);
    if (!Number.isFinite(amount) || amount <= 0 || amount > ceiling + 0.005) throw Errors.validation(`Amount must be positive and within the credit (${ceiling.toFixed(2)} ${terms.currency}).`);
    return (
      await this.mutate(caseId, actorRef(user), 'SETTLEMENT_RECORDED', (c) => {
        c.settlement = { mode: mode as 'SANDBOX' | 'MANUAL_RECORD', amount, currency, valueDate, reference, recordedBy: actorRef(user), recordedAt: new Date().toISOString(), note };
        setStatus(c, 'SETTLED_MONITORING', actorRef(user), `${mode === 'SANDBOX' ? 'Sandbox' : 'Manually recorded'} settlement ${reference}`);
        return { mode, amount, currency, valueDate, reference };
      })
    ).tradeCase;
  }

  async openInvestigation(user: AuthenticatedUser, caseId: string, input: { reason?: unknown; findingIds?: unknown }): Promise<TradeCase> {
    const reason = requireText(input.reason, 'The reason for the investigation');
    await this.loadFor(user, 'OPEN_INVESTIGATION', caseId);
    return (
      await this.mutate(caseId, actorRef(user), 'INVESTIGATION_OPENED', (c) => {
        const findingIds = Array.isArray(input.findingIds) ? input.findingIds.filter((v): v is string => typeof v === 'string' && c.findings.some((f) => f.findingId === v)) : [];
        c.sequences.investigation += 1;
        const investigationId = `INV-${String(c.sequences.investigation).padStart(2, '0')}`;
        c.investigations.push({ investigationId, openedBy: actorRef(user), assignedTo: actorRef(user), openedAt: new Date().toISOString(), reason, findingIds, resumeStatus: c.status, closedBy: null, closedAt: null, outcome: null, rationale: '' });
        setStatus(c, 'UNDER_INVESTIGATION', actorRef(user), `Investigation ${investigationId} opened`);
        return { investigationId, reason, findingIds };
      })
    ).tradeCase;
  }

  async closeInvestigation(user: AuthenticatedUser, caseId: string, input: { outcome?: unknown; rationale?: unknown }): Promise<TradeCase> {
    const outcome = String(input.outcome ?? '');
    if (!['NO_FURTHER_ACTION', 'MONITORING_CONTINUED', 'REPORTED_EXTERNALLY_RECORDED'].includes(outcome)) {
      throw Errors.validation('outcome must be NO_FURTHER_ACTION, MONITORING_CONTINUED or REPORTED_EXTERNALLY_RECORDED (a report filed through the bank\'s own channel; this platform files nothing).');
    }
    const rationale = requireText(input.rationale, 'A rationale');
    await this.loadFor(user, 'CLOSE_INVESTIGATION', caseId);
    return (
      await this.mutate(caseId, actorRef(user), 'INVESTIGATION_CLOSED', (c) => {
        const inv = c.investigations.find((i) => !i.closedAt);
        if (!inv) throw stateConflict('No open investigation.');
        if (this.sodFor(user).investigationCloserNotOpener && inv.openedBy.id === user.id) {
          throw forbidden('Separation of duties: an investigation is closed by someone other than the investigator who opened it.');
        }
        Object.assign(inv, { closedBy: actorRef(user), closedAt: new Date().toISOString(), outcome, rationale });
        setStatus(c, inv.resumeStatus, actorRef(user), `Investigation ${inv.investigationId} closed: ${outcome}`);
        return { investigationId: inv.investigationId, outcome, rationale };
      })
    ).tradeCase;
  }

  async closeCase(user: AuthenticatedUser, caseId: string, rationale: unknown): Promise<TradeCase> {
    const reason = requireText(rationale, 'A closing rationale');
    await this.loadFor(user, 'CLOSE_CASE', caseId);
    return (
      await this.mutate(caseId, actorRef(user), 'CASE_CLOSED', (c) => {
        const open = c.findings.filter((f) => f.status === 'OPEN' && this.policy.complianceCategories.includes(f.category));
        if (open.length > 0) throw stateConflict('Compliance findings remain open; they must be dispositioned before closure.', { findings: open.map((f) => f.findingId) });
        setStatus(c, 'CLOSED', actorRef(user), reason);
        c.closedAt = new Date().toISOString();
        return { reason };
      })
    ).tradeCase;
  }

  // ---------------------------------------------------------------- reads

  private async loadFor(user: AuthenticatedUser, action: CaseAction, caseId: string): Promise<TradeCase> {
    // A role with no trade-case access at all (an administrator) is refused before any lookup, so
    // the answer is the same 403 whatever id it sends and reveals nothing about which cases exist.
    if (!hasAnyPermission(user, ACTION_PERMISSIONS.VIEW)) throw forbidden('You do not have access to trade cases.');
    const c = await this.repo.findById(caseId);
    if (!c) throw Errors.notFound('trade case');
    // Ownership first, so another customer's case reads as missing rather than forbidden.
    this.assertOwnership(user, c);
    this.authorize(user, action, c);
    return c;
  }

  async getCase(user: AuthenticatedUser, caseId: string): Promise<TradeCase> {
    return this.loadFor(user, 'VIEW', caseId);
  }

  /**
   * `history`: "active" (the default) leaves out what this user cleared from their list; "cleared" is only those;
   * "all" is both. Clearing hides an approved case from one user's list and counts; it deletes nothing.
   */
  async listCases(user: AuthenticatedUser, filter: { status?: unknown; history?: unknown; stage?: unknown }): Promise<TradeCase[]> {
    this.authorize(user, 'VIEW');
    const statuses = typeof filter.status === 'string' && filter.status ? (filter.status.split(',') as CaseStatus[]) : undefined;
    const history = filter.history === 'cleared' || filter.history === 'all' ? filter.history : 'active';
    const cases = await this.repo.list({ customerRef: isCustomerView(user) ? user.customerRef ?? '__none__' : undefined, statuses });
    // The stage the user signed in for narrows what is listed; it never widens what their role may reach.
    const inStage = (c: TradeCase) => (filter.stage === 'post' ? reachedPostShipment(c) : filter.stage === 'pre' ? PRE_SHIPMENT_STATUSES.includes(c.status) : true);
    return cases
      .filter((c) => canViewCase(user, c) && inStage(c))
      // Clearing is a pre-shipment tidy-up: an approved request is still live in post-shipment, so that stage ignores it.
      .filter((c) => filter.stage === 'post' || history === 'all' || clearedBy(user, c) === (history === 'cleared'))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  /**
   * The separation-of-duties rules that apply to this user. A role that holds every desk (the all-desks officer) is one
   * person by design, so the rules between desks do not apply to it; every step stays in the audit chain under their name.
   */
  private sodFor(user: AuthenticatedUser) {
    if (!isConsolidatedRole(user.role)) return this.policy.separationOfDuties;
    return {
      approverNotMaker: false,
      approverNotReviewerOf: [] as typeof this.policy.separationOfDuties.approverNotReviewerOf,
      issuerNotApprover: false,
      presentationDeciderNotPresenter: false,
      settlementNotIssuer: false,
      amendmentApproverNotMaker: false,
      amendmentIssuerNotApprover: false,
      investigationCloserNotOpener: false,
    };
  }

  /**
   * Clear the approved cases from this user's list. Only cases that stand approved (authorised for issuance) are
   * cleared, only for this user, and nothing is deleted: each is recorded in its audit trail and keeps its
   * "last updated" time. A cleared case that moves on from the approved state reappears.
   */
  async clearHistory(user: AuthenticatedUser): Promise<{ cleared: string[]; stillShown: number }> {
    this.require(user, 'tradecase.history.clear', 'clear your case history');
    const visible = (await this.repo.list({})).filter((c) => canViewCase(user, c));
    const cleared: string[] = [];
    for (const c of visible) {
      if (c.status !== 'AUTHORIZED_FOR_ISSUANCE' || clearedBy(user, c)) continue;
      await this.mutate(
        c.caseId,
        actorRef(user),
        'HISTORY_CLEARED',
        (next) => {
          if (next.status !== 'AUTHORIZED_FOR_ISSUANCE') return { skipped: 'The case is no longer approved.' };
          next.historyClearedBy = [...(next.historyClearedBy ?? []).filter((x) => x.userId !== user.id), { userId: user.id, at: new Date().toISOString() }];
          return { note: 'Hidden from this user\'s case list. The case, its documents and its audit trail are kept.' };
        },
        true,
      );
      cleared.push(c.caseId);
    }
    return { cleared, stillShown: (await this.listCases(user, {})).length };
  }

  async getAudit(user: AuthenticatedUser, caseId: string): Promise<{ events: TradeCaseEvent[]; chain: ChainVerification }> {
    this.require(user, 'tradecase.audit.view', 'read the audit log');
    const c = await this.loadFor(user, 'VIEW', caseId);
    const events = await this.repo.listEvents(caseId);
    return { events, chain: verifyChain(events, c.auditHead) };
  }

  /**
   * The evidence-based scrutiny report as a PDF. Built from the same view the officer already has (nothing more
   * than they may read in the case), and the export itself is an audited event with the report's content hash.
   */
  async exportVerificationReport(user: AuthenticatedUser, caseId: string): Promise<{ filename: string; pdf: Buffer; contentHash: string }> {
    this.require(user, 'tradecase.verification.export', 'download the evidence report');
    const report = (await this.scrutiny(user, caseId)) as {
      caseId: string; status: string; lastValidatedAt: string | null; ruleSetVersion: string | null; findings: Finding[];
      externalVerification: { lastRun: VerificationRunSummary | null; rules: Record<string, ReportRuleMode>; sources: { catalogue: ExternalSourceEntry[]; health: SourceHealth[] } } | null;
    };
    const ev = report.externalVerification;
    if (!ev) throw forbidden('You may not read the verification detail of this case.');
    const model = buildVerificationReportModel({
      caseId: report.caseId,
      status: report.status,
      generatedAt: new Date().toISOString(),
      generatedBy: { name: user.name, role: user.role },
      ruleSetVersion: report.ruleSetVersion,
      lastValidatedAt: report.lastValidatedAt,
      run: ev.lastRun,
      rules: ev.rules,
      sources: ev.sources,
      findings: report.findings.filter((f) => f.ruleId.startsWith('EXT-') && f.status === 'OPEN').map((f) => ({ findingId: f.findingId, ruleId: f.ruleId, title: f.title, severity: f.severity, status: f.status, blocking: blocksNow(f) })),
      mandatorySources: [...mandatorySources()],
    });
    const pdf = await renderVerificationReportPdf(model);
    await this.mutate(caseId, actorRef(user), 'VERIFICATION_REPORT_EXPORTED', () => ({ contentHash: model.contentHash, runId: model.runId, bytes: pdf.length, containsSyntheticEvidence: model.containsSyntheticEvidence }));
    return { filename: `${caseId}-evidence-report.pdf`, pdf, contentHash: model.contentHash };
  }

  /** Every case in scope with its chain verdict — the auditor's starting point. */
  async auditOverview(user: AuthenticatedUser): Promise<Array<{ caseId: string; status: CaseStatus; customerRef: string; events: number; chain: ChainVerification; updatedAt: string }>> {
    this.require(user, 'audit.overview', 'use the audit explorer');
    const rows = [];
    for (const c of await this.listCases(user, {})) {
      const events = await this.repo.listEvents(c.caseId);
      rows.push({ caseId: c.caseId, status: c.status, customerRef: c.customerRef, events: events.length, chain: verifyChain(events, c.auditHead), updatedAt: c.updatedAt });
    }
    return rows;
  }

  // ---------------------------------------------------------------- amendments

  private openAmendment(c: TradeCase): Amendment | null {
    return c.amendments?.find((a) => ['UNDER_REVIEW', 'APPROVAL_PENDING', 'APPROVED', 'ISSUED_AWAITING_BENEFICIARY'].includes(a.status)) ?? null;
  }

  private amendmentBlockers(c: TradeCase, a: Amendment, department?: Department): string[] {
    return c.findings
      .filter((f) => f.amendmentId === a.amendmentId && blocksNow(f) && (!department || f.ownerDepartment === department))
      .map((f) => `${f.findingId} ${f.title}`);
  }

  private async screenParties(app: LcApplicationData): Promise<{ result: SanctionsScreeningResult | null; error: string | null }> {
    if (!app.applicant.name && !app.beneficiary.name) return { result: null, error: null };
    try {
      const result = await this.sanctions.screenTransaction({
        parties: {
          seller: { role: 'Beneficiary', legalName: app.beneficiary.name || 'Not Found', country: app.beneficiary.country || undefined },
          buyer: { role: 'Applicant', legalName: app.applicant.name || 'Not Found', country: app.applicant.country || undefined },
        },
        originCountry: app.countryOfOrigin || undefined,
        destinationCountry: app.applicant.country || undefined,
        portOfLoading: app.portOfLoading || undefined,
        portOfDischarge: app.portOfDischarge || undefined,
      });
      return { result, error: null };
    } catch (error) {
      return { result: null, error: describeUnknown(error).slice(0, 200) };
    }
  }

  /**
   * An amendment to an issued credit. It never edits the issued record: the proposed terms live on
   * the amendment, are revalidated, reviewed by the departments the change concerns, authorised by
   * maker-checker, issued (sandbox) and become the effective terms only when the beneficiary accepts
   * (UCP 600 art. 10, paraphrased). Presentations are examined against the effective terms.
   */
  async requestAmendment(user: AuthenticatedUser, caseId: string, input: { changes?: unknown; reason?: unknown }): Promise<TradeCase> {
    const changes = parseApplication(input.changes);
    const reason = requireText(input.reason, 'The reason for the amendment');
    const c0 = await this.loadFor(user, 'REQUEST_AMENDMENT', caseId);
    if (this.openAmendment(c0)) throw stateConflict('An amendment is already in progress for this credit.');
    const lc = c0.issuedLc!;
    const current = lc.effectiveTerms ?? lc.terms;
    const proposed = mergeApplication(current, changes);
    const changed = changedFields(current, proposed);
    if (changed.length === 0) throw Errors.validation('The amendment changes nothing.');
    if (changed.some((f) => f.startsWith('applicant.'))) throw Errors.validation('The applicant of an issued credit cannot be changed by amendment.');
    const screening = await this.screenParties(proposed);

    return (
      await this.mutate(caseId, actorRef(user), 'AMENDMENT_REQUESTED', (c) => {
        c.sequences.amendment = (c.sequences.amendment ?? 0) + 1;
        const number = c.sequences.amendment;
        const amendmentId = `AM-${String(number).padStart(2, '0')}`;
        const departments = departmentsAffectedBy(changed).filter((d) => d !== 'RM');
        const amendment: Amendment = {
          amendmentId,
          number,
          status: 'UNDER_REVIEW',
          reason,
          requestedBy: actorRef(user),
            requestedAt: new Date().toISOString(),
          baseAmendmentNumber: c.issuedLc!.effectiveAmendmentNumber ?? 0,
          changes: Object.fromEntries([...new Set(changed.map((f) => f.split('.')[0]!))].map((k) => [k, structuredClone(proposed[k as keyof LcApplicationData])])) as Partial<LcApplicationData>,
          proposedTerms: proposed,
          changedFields: changed,
          reviews: Object.fromEntries(departments.map((d) => [d, { status: 'PENDING' as const, by: null, at: null, rationale: '' }])),
          submittedBy: null,
          submittedAt: null,
          decision: null,
          issuance: null,
          beneficiaryResponse: null,
        };
        c.amendments = [...(c.amendments ?? []), amendment];
        const candidates = evaluateAmendment({ tradeCase: c, amendmentId, proposed, current, policy: this.policy, partyScreening: screening.result, now: new Date() });
        if (screening.error) {
          candidates.push(
            candidate('CMP-SANCTIONS-PARTY', `${amendmentId}:screening-unavailable`, {
              stage: 'AMENDMENT',
              amendmentId,
              category: 'OPERATIONAL',
              severity: 'HIGH',
              ownerDepartment: 'COMPLIANCE',
              title: 'Sanctions screening could not run for the amendment',
              description: `Screening failed (${screening.error}). The amended parties have NOT been screened.`,
              expected: 'Screening completed.',
              recommendedAction: 'Screen manually and record it, or re-request once screening is available.',
            }),
          );
        }
        const summary = this.mergeFindings(c, candidates, (f) => f.amendmentId === amendmentId, c.currentApplicationVersion, false);
        return { amendmentId, changedFields: changed, reviewsRequired: departments, reason, ...summary };
      })
    ).tradeCase;
  }

  async reviewAmendment(user: AuthenticatedUser, caseId: string, departmentRaw: unknown, input: { decision?: unknown; rationale?: unknown }): Promise<TradeCase> {
    const department = String(departmentRaw ?? '').toUpperCase() as Department;
    if (!(DEPARTMENTS as readonly string[]).includes(department)) throw Errors.validation('Unknown department.');
    const decision = String(input.decision ?? '');
    if (decision !== 'APPROVE' && decision !== 'REJECT') throw Errors.validation('decision must be APPROVE or REJECT.');
    const rationale = requireText(input.rationale, 'A rationale');
    const c0 = await this.loadFor(user, 'VIEW', caseId);
    this.assertDepartmentRole(user, department);
    if (c0.status !== 'LC_ISSUED') throw stateConflict('Amendments are reviewed while the credit is issued and awaiting presentation.');
    return (
      await this.mutate(caseId, actorRef(user), `AMENDMENT_REVIEW_${decision}`, (c) => {
        const a = this.openAmendment(c);
        if (!a || a.status !== 'UNDER_REVIEW') throw stateConflict('There is no amendment under review.');
        const review = a.reviews[department];
        if (!review) throw stateConflict(`${department} review is not required for this amendment.`);
        if (review.status !== 'PENDING') throw stateConflict(`${department} has already decided this amendment.`);
        if (decision === 'APPROVE') {
          const blockers = this.amendmentBlockers(c, a, department);
          if (blockers.length) throw stateConflict(`${department} cannot approve the amendment yet.`, { blockers });
        }
        Object.assign(review, { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', by: actorRef(user), at: new Date().toISOString(), rationale });
        if (decision === 'REJECT') a.status = 'REJECTED';
        return { amendmentId: a.amendmentId, department, decision, rationale };
      })
    ).tradeCase;
  }

  async submitAmendment(user: AuthenticatedUser, caseId: string, note: unknown): Promise<TradeCase> {
    const rationale = requireText(note, 'A note for the approver', 3);
    await this.loadFor(user, 'SUBMIT_AMENDMENT', caseId);
    return (
      await this.mutate(caseId, actorRef(user), 'AMENDMENT_SUBMITTED', (c) => {
        const a = this.openAmendment(c);
        if (!a || a.status !== 'UNDER_REVIEW') throw stateConflict('There is no amendment ready to submit.');
        const pending = Object.entries(a.reviews).filter(([, r]) => r?.status !== 'APPROVED').map(([d]) => `${d} review not approved`);
        const blockers = [...pending, ...this.amendmentBlockers(c, a)];
        if (blockers.length) throw stateConflict('The amendment is not ready for approval.', { blockers });
        a.status = 'APPROVAL_PENDING';
        a.submittedBy = actorRef(user);
        a.submittedAt = new Date().toISOString();
        return { amendmentId: a.amendmentId, note: rationale };
      })
    ).tradeCase;
  }

  async decideAmendment(user: AuthenticatedUser, caseId: string, input: { decision?: unknown; rationale?: unknown }): Promise<TradeCase> {
    const decision = String(input.decision ?? '');
    if (decision !== 'APPROVE' && decision !== 'REJECT') throw Errors.validation('decision must be APPROVE or REJECT.');
    const rationale = requireText(input.rationale, 'A rationale');
    await this.loadFor(user, 'DECIDE_AMENDMENT', caseId);
    const sod = this.sodFor(user);
    return (
      await this.mutate(caseId, actorRef(user), decision === 'APPROVE' ? 'AMENDMENT_APPROVED' : 'AMENDMENT_REJECTED', (c) => {
        const a = this.openAmendment(c);
        if (!a || a.status !== 'APPROVAL_PENDING') throw stateConflict('There is no amendment awaiting approval.');
        if (sod.amendmentApproverNotMaker && (a.submittedBy?.id === user.id || a.reviews.TRADE_OPS?.by?.id === user.id)) {
          throw forbidden('Separation of duties: the maker or Trade Ops reviewer of this amendment cannot approve it.');
        }
        if (decision === 'APPROVE') {
          const blockers = this.amendmentBlockers(c, a);
          if (blockers.length) throw stateConflict('Blocking findings remain on the amendment.', { blockers });
        }
        a.decision = { decision: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', by: actorRef(user), at: new Date().toISOString(), rationale };
        a.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        return { amendmentId: a.amendmentId, decision, rationale };
      })
    ).tradeCase;
  }

  async issueAmendment(user: AuthenticatedUser, caseId: string, input: { financialInstrumentExpiry?: unknown }): Promise<TradeCase> {
    const c0 = await this.loadFor(user, 'ISSUE_AMENDMENT', caseId);
    const a0 = this.openAmendment(c0);
    if (!a0 || a0.status !== 'APPROVED') throw stateConflict('There is no approved amendment to issue.');
    if (this.sodFor(user).amendmentIssuerNotApprover && a0.decision?.by.id === user.id) {
      throw forbidden('Separation of duties: the approver of the amendment cannot also issue it.');
    }
    const fiExpiry = String(input.financialInstrumentExpiry ?? '').trim();
    if (fiExpiry !== a0.proposedTerms.expiryDate) {
      throw new AppError({
        status: 422,
        code: 'FINANCIAL_INSTRUMENT_INVALID',
        message: `The Financial Instrument expiry (${fiExpiry || 'none'}) must match the amended LC expiry ${a0.proposedTerms.expiryDate} (FE Manual Ch.13 para 6B(viii)).`,
        details: { ruleId: 'PK-FEM13-6B8-FI' },
      });
    }
    const result = await getLcIssuanceAdapter().amend({ caseId, lcNumber: c0.issuedLc!.lcNumber, amendmentNumber: a0.number, changes: a0.changes });
    return (
      await this.mutate(caseId, actorRef(user), 'AMENDMENT_ISSUED', (c) => {
        const a = this.openAmendment(c);
        if (!a || a.amendmentId !== a0.amendmentId || a.status !== 'APPROVED') throw stateConflict('The amendment changed while it was being issued.');
        a.issuance = { reference: result.reference, mode: result.mode, by: actorRef(user), at: new Date().toISOString(), message: result.message, financialInstrumentExpiry: fiExpiry };
        a.status = 'ISSUED_AWAITING_BENEFICIARY';
        return { amendmentId: a.amendmentId, reference: result.reference, mode: result.mode, message: result.message };
      })
    ).tradeCase;
  }

  async recordAmendmentResponse(user: AuthenticatedUser, caseId: string, input: { accepted?: unknown; note?: unknown }): Promise<TradeCase> {
    const accepted = input.accepted === true;
    const note = requireText(input.note, 'A note on how the response was received', 3);
    await this.loadFor(user, 'AMENDMENT_BENEFICIARY_RESPONSE', caseId);
    return (
      await this.mutate(caseId, actorRef(user), accepted ? 'AMENDMENT_EFFECTIVE' : 'AMENDMENT_REFUSED_BY_BENEFICIARY', (c) => {
        const a = this.openAmendment(c);
        if (!a || a.status !== 'ISSUED_AWAITING_BENEFICIARY') throw stateConflict('No issued amendment is awaiting the beneficiary.');
        a.beneficiaryResponse = { accepted, by: actorRef(user), at: new Date().toISOString(), note };
        if (accepted) {
          a.status = 'EFFECTIVE';
          const lc = c.issuedLc!;
          lc.effectiveTerms = structuredClone(a.proposedTerms);
          lc.effectiveAmendmentNumber = a.number;
          lc.financialInstrument = { ...lc.financialInstrument, expiryDate: a.issuance!.financialInstrumentExpiry };
        } else {
          a.status = 'BENEFICIARY_REFUSED';
        }
        return { amendmentId: a.amendmentId, accepted, note, effectiveAmendmentNumber: c.issuedLc!.effectiveAmendmentNumber };
      })
    ).tradeCase;
  }

  // ---------------------------------------------------------------- pre-shipment scrutiny report

  /**
   * The trade desk's pre-shipment scrutiny of a case, in one read: which documents were analysed and
   * how, what the analysis read in them, what is missing, every pre-trade rule with its outcome
   * (flagged, passed, or not checked and why), what the sanctions and jurisdiction screening covered,
   * and the findings. Nothing here is post-shipment: no vessel tracking, no presentation checks.
   */
  async scrutiny(user: AuthenticatedUser, caseId: string): Promise<Record<string, unknown>> {
    const c = await this.loadFor(user, 'VIEW', caseId);
    if (isCustomerView(user)) throw forbidden("The scrutiny report is for the bank's trade desk.");
    const view = this.toView(user, c) as unknown as { findings: Finding[] };
    const internal = hasPermission(user, 'tradecase.findings.internal.view');
    // Bank-only issues (sanctions, jurisdiction, dual-use, money laundering) are shown to those who may read them.
    const visibleIssues = <T extends { category: string }>(issues: T[]): T[] => (internal ? issues : issues.filter((i) => i.category !== 'COMPLIANCE_ALERT'));
    const documentsRepo = getDocumentRepository();
    const app = currentApplication(c);

    const documents: Array<Record<string, unknown>> = [];
    let pi: TradeComplianceAnalysis | null = null;
    let piFilename: string | null = null;
    for (const link of c.documents.filter((d) => d.stage === 'PRE_TRADE')) {
      const active = !link.supersededByLinkId;
      const doc = active ? await documentsRepo.findFull(link.documentId) : await documentsRepo.findMeta(link.documentId);
      const analysis = doc && 'analysis' in doc ? doc.analysis ?? null : null;
      const source = analysis ? analysis.engine.tradeExtractionSource ?? (analysis.engine.provider === 'heuristic' ? 'DETERMINISTIC_PARSER' : 'UNKNOWN_LEGACY_ANALYSIS') : null;
      if (active && link.documentType === 'PROFORMA_INVOICE' && doc?.status === 'completed' && analysis?.tradeCompliance) {
        pi = analysis.tradeCompliance;
        piFilename = link.filename;
      }
      documents.push({
        linkId: link.linkId,
        documentId: link.documentId,
        documentType: link.documentType,
        version: link.version,
        filename: link.filename,
        uploadedAt: link.uploadedAt,
        active,
        analysisStatus: doc?.status ?? 'missing',
        progress: doc?.progress ?? null,
        error: doc?.error?.message ?? null,
        extractionSource: source,
        typeSource: link.typeSource ?? null,
        detection: link.detection ?? null,
        detectionError: link.detectionError ?? null,
        review: c.aiReviews?.[link.documentId]
          ? (({ summary, present, missing, notCheckable, issues, discarded, model, at }) => ({ summary, present, missing, notCheckable, issues: visibleIssues(issues), withheld: issues.length - visibleIssues(issues).length, discarded: discarded ?? [], model, at }))(c.aiReviews[link.documentId]!)
          : null,
        step: c.scrutinyRun?.steps.find((x) => x.documentId === link.documentId) ?? null,
      });
    }

    const extracted = pi
      ? {
          filename: piFilename,
          number: pi.documentClassification.number || null,
          date: pi.documentClassification.date || null,
          seller: pi.transaction.parties.seller ?? null,
          buyer: pi.transaction.parties.buyer ?? null,
          currency: pi.transaction.currency || null,
          totalValue: pi.transaction.totalValue || null,
          incoterm: pi.transaction.incoterm || null,
          paymentTerms: pi.transaction.paymentTerms || null,
          originCountry: pi.transaction.originCountry || null,
          destinationCountry: pi.transaction.destinationCountry || null,
          portOfLoading: pi.transaction.portOfLoading || null,
          portOfDischarge: pi.transaction.portOfDischarge || null,
          goods: pi.goods.map((g) => ({ description: g.productDescription, hsCode: g.hsCode ?? null, quantity: g.quantity, unit: g.unitOfMeasure, unitPrice: g.unitPrice, total: g.totalLineValue, origin: g.countryOfOrigin ?? null })),
          arithmetic: { sound: pi.mathematicalValidation.isMathematicallySound, notes: pi.mathematicalValidation.discrepancies.map((d) => d.description) },
        }
      : null;

    const analysisChecks = pi
      ? {
          sanctions: {
            status: pi.sanctions.status,
            riskScore: pi.sanctions.overallSanctionsRiskScore,
            matches: pi.sanctions.matches.map((m) => ({ subject: m.entityOrSubject, role: m.roleOrField, matched: m.matchedSanctionedName, list: m.sanctionsList, program: m.sanctionProgram ?? null, type: m.matchType, confidence: m.matchConfidence })),
            jurisdictions: coverage(
              [
                { role: 'ORIGIN', country: pi.transaction.originCountry },
                { role: 'FINAL_DESTINATION', country: pi.transaction.destinationCountry },
                { role: 'COUNTERPARTY_COUNTRY', country: pi.transaction.parties.seller?.country },
                { role: 'COUNTERPARTY_COUNTRY', country: pi.transaction.parties.buyer?.country },
                ...(pi.transaction.transitCountries ?? []).map((country) => ({ role: 'TRANSIT_COUNTRY', country })),
              ],
              pi.sanctions.jurisdictionRisks,
            ).map((j) => ({ role: j.role, country: j.country, status: j.status, description: j.description })),
            screenedEntities: pi.sanctions.screenedEntitiesCount,
            screenedCountries: pi.sanctions.screenedCountriesCount,
            unscreenedNames: pi.sanctions.unscreenedNames ?? [],
            datasetVersion: pi.sanctions.datasetVersion,
            screenedAt: pi.sanctions.screeningTimestamp,
          },
          exportControls: { status: pi.exportControls?.riskStatus ?? null, goods: (pi.exportControls?.controlledGoods ?? []).map((g) => ({ item: g.itemDescription, category: g.category, reason: g.controlReason, licence: g.licenseRequirement, severity: g.riskSeverity })), concerns: pi.exportControls?.licenseConcerns ?? [] },
          tbml: { level: pi.tbml?.riskLevel ?? null, score: pi.tbml?.overallTbmlRiskScore ?? null, redFlags: (pi.tbml?.redFlags ?? []).map((f) => ({ category: f.category, severity: f.severity, title: f.title, description: f.description, evidence: f.evidence })) },
          sbp: pi.sbpCompliance
            ? { verdict: pi.sbpCompliance.overallSbpVerdict, explanation: pi.sbpCompliance.explanation, circulars: pi.sbpCompliance.triggeredSbpCirculars.map((s) => ({ ref: s.circularRef, title: s.title, requirement: s.requirement, status: s.complianceStatus })) }
            : null,
        }
      : null;

    const required = [...this.policy.requiredApplicationFields];
    if (app.paymentTerms === 'USANCE') required.push('usanceDays');
    const missing = required.filter((path) => isMissing(getField(app, path))).map((path) => ({ path, label: fieldLabel(path) }));

    const preTrade = c.findings.filter((f) => f.stage === 'PRE_TRADE');
    const screeningSummary = c.validation.screening ?? null;
    const screened = Boolean(screeningSummary && !screeningSummary.error) || Boolean(pi);
    const needsPi = 'The proforma invoice has not been analysed yet.';
    const compareField: Record<string, string> = {
      'PT-CMP-AMOUNT': 'amount', 'PT-CMP-CURRENCY': 'currency', 'PT-CMP-BENEFICIARY': 'beneficiary.name', 'PT-CMP-APPLICANT': 'applicant.name',
      'PT-CMP-INCOTERM': 'incoterm', 'PT-CMP-ORIGIN': 'countryOfOrigin', 'PT-CMP-QUANTITY': 'quantity', 'PT-CMP-UNITPRICE': 'unitPrice', 'PT-CMP-PINUMBER': 'proformaInvoiceNumber',
    };
    /** Why a rule could not be judged, or null when it ran. */
    const notRun = (rule: RuleDefinition): { status: 'NOT_CHECKED' | 'NOT_APPLICABLE' | 'MANUAL'; reason: string } | null => {
      const id = rule.ruleId;
      if (rule.implementation === 'MANUAL_CHECKPOINT') return { status: 'MANUAL', reason: 'A reviewer confirms this checkpoint; it cannot be judged from the documents alone.' };
      if (id in compareField) {
        if (!pi) return { status: 'NOT_CHECKED', reason: needsPi };
        if (isMissing(getField(app, compareField[id]!))) return { status: 'NOT_CHECKED', reason: `${fieldLabel(compareField[id]!)} is not on the application, so there is nothing to compare.` };
        return null;
      }
      switch (id) {
        case 'PT-PI-ARITHMETIC':
        case 'CMP-EXPORT-CONTROL':
        case 'TBML-PI-INDICATOR':
          return pi ? null : { status: 'NOT_CHECKED', reason: needsPi };
        case 'PK-FEM13-09-VALIDITY':
          return app.expiryDate ? null : { status: 'NOT_CHECKED', reason: 'No expiry date is stated in the documents or the application.' };
        case 'PT-DATE-ORDER':
          return app.expiryDate || app.latestShipmentDate ? null : { status: 'NOT_CHECKED', reason: 'No shipment or expiry date is stated in the documents or the application.' };
        case 'PK-FEM13-05-TERMS':
          return app.incoterm ? null : { status: 'NOT_CHECKED', reason: 'No incoterm is stated.' };
        case 'CMP-SANCTIONS-PARTY':
          if (screened) return null;
          return { status: 'NOT_CHECKED', reason: screeningSummary?.error ? `Screening could not run: ${screeningSummary.error}` : 'No party names are on file to screen yet.' };
        case 'CMP-JURISDICTION': {
          if (!screened) return { status: 'NOT_CHECKED', reason: screeningSummary?.error ? `Screening could not run: ${screeningSummary.error}` : 'No party names are on file to screen yet.' };
          const countries = (screeningSummary?.jurisdictions.length ?? 0) + (analysisChecks?.sanctions.jurisdictions.length ?? 0);
          return countries > 0 ? null : { status: 'NOT_CHECKED', reason: 'No country is stated in the documents or the application, so no jurisdiction could be checked.' };
        }
        case 'TBML-MATERIAL-CHANGE':
          return c.submittedApplicationVersion ? null : { status: 'NOT_APPLICABLE', reason: 'Measured from the submitted application; applies after submission.' };
        case 'TBML-USANCE':
          return app.paymentTerms === 'USANCE' ? null : { status: 'NOT_APPLICABLE', reason: 'Applies to usance (deferred) payment only.' };
        case 'CRD-FACILITY':
          return c.creditFacility ? null : { status: 'NOT_CHECKED', reason: 'Credit has not recorded a facility yet.' };
        default:
          return null;
      }
    };
    const groupOf = (id: string): string =>
      id.startsWith('PT-REQ') || id === 'PK-FEM13-07-FIRM' ? 'Completeness'
        : id.startsWith('PT-CMP') || id === 'PT-PI-ARITHMETIC' || id === 'PT-DOC-EXTRACTION' ? 'Document consistency'
        : id.startsWith('PK-') || id === 'PT-DATE-ORDER' ? 'Regulatory and LC terms (SBP FE Manual, UCP 600)'
        : id.startsWith('CMP-') ? 'Sanctions, jurisdiction and export control'
        : id.startsWith('TBML-') ? 'Trade-based money laundering indicators'
        : 'Credit';
    const rules = RULES.filter((r) => r.stage === 'PRE_TRADE').map((rule) => {
      const own = preTrade.filter((f) => f.ruleId === rule.ruleId);
      const open = own.filter((f) => f.status === 'OPEN');
      const skipped = notRun(rule);
      const status = skipped ? skipped.status : open.length > 0 ? 'FLAGGED' : own.length > 0 ? 'REVIEWED' : 'PASSED';
      return {
        ruleId: rule.ruleId,
        name: rule.name,
        description: rule.description,
        group: groupOf(rule.ruleId),
        source: rule.sourceReference,
        jurisdiction: rule.jurisdiction,
        status,
        reason: skipped?.reason ?? null,
        openFindings: open.length,
        totalFindings: own.length,
      };
    });

    const findings = view.findings.filter((f) => f.stage === 'PRE_TRADE');
    const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
    findings.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.findingId.localeCompare(b.findingId));
    const openFindings = findings.filter((f) => f.status === 'OPEN');

    return {
      caseId: c.caseId,
      status: c.status,
      customerRef: c.customerRef,
      generatedAt: new Date().toISOString(),
      intakeMode: isDocumentsOnly(c) ? 'DOCUMENTS_ONLY' : null,
      lastValidatedAt: c.validation.lastRunAt,
      ruleSetVersion: c.validation.ruleSetVersion,
      extractionSource: c.validation.piExtractionSource,
      documents,
      pendingAnalysis: documents.filter((d) => d['active'] && ['uploaded', 'queued', 'processing'].includes(String(d['analysisStatus']))).length,
      extracted,
      application: app,
      applicationVersion: c.currentApplicationVersion,
      missing,
      rules,
      screening: { application: screeningSummary, document: analysisChecks?.sanctions ?? null },
      // What was checked against official sources, with the evidence and the sources' own state. Staff who
      // may read it only: it names the catalogue of sources and what each one does not cover.
      externalVerification: hasPermission(user, 'tradecase.verification.view')
        ? {
            lastRun: c.validation.externalVerification ?? null,
            // What the platform does with each rule's findings right now: approved control, demonstration or shadow.
            rules: Object.fromEntries(['EXT-HS-VALID', 'EXT-HS-CLASS', 'EXT-HS-CROSSDOC', 'EXT-PCT-VALID', 'EXT-PCT-RESTRICTION', 'EXT-PORT-ID', 'EXT-VESSEL-ID', 'EXT-VERIFY-SOURCE'].map((id) => [id, enforcementOf(id)])),
            sources: { catalogue: SOURCE_CATALOGUE, health: [hsReferenceHealth(), PctStore.getInstance().health()] },
          }
        : null,
      analysis: analysisChecks ? { exportControls: analysisChecks.exportControls, tbml: analysisChecks.tbml, sbp: analysisChecks.sbp } : null,
      findings,
      /** What this user may do to a finding on this case now. */
      viewer: (() => {
        const actions = this.availableActions(user, c);
        return { canDisposition: actions.includes('DISPOSITION_FINDING'), canDispositionCompliance: actions.includes('DISPOSITION_COMPLIANCE_FINDING') };
      })(),
      /** Whether this user may approve now, what stands in the way, and the approval if it has been given. */
      approval: {
        canApprove: this.availableActions(user, c).includes('APPROVE_PRESHIPMENT'),
        blockers: c.status === 'UNDER_REVIEW' ? this.preShipmentBlockers(c) : [],
        approved: (() => {
          const a = [...c.approvals].reverse().find((x) => x.status === 'APPROVED');
          return a && c.status === 'AUTHORIZED_FOR_ISSUANCE' ? { by: a.decidedBy?.name ?? '', at: a.decidedAt, rationale: a.rationale } : null;
        })(),
      },
      /** The AI scrutiny: whether a model is required, the latest run with its per-document steps, and the documents compared with each other. */
      aiRequired: config.preshipment.requireAi,
      run: c.scrutinyRun ?? null,
      comparison: c.caseReview
        ? { summary: c.caseReview.summary, issues: visibleIssues(c.caseReview.issues), withheld: c.caseReview.issues.length - visibleIssues(c.caseReview.issues).length, notCheckable: c.caseReview.notCheckable, discarded: c.caseReview.discarded ?? [], model: c.caseReview.model, at: c.caseReview.at, current: caseReviewIsCurrent(c) }
        : null,
      /** The messages sent to the customer, and what came back. */
      mails: c.queries
        .filter((q) => q.assignee === 'CUSTOMER')
        .map((q) => ({
          queryId: q.queryId,
          subject: q.subject ?? null,
          raisedAt: q.raisedAt,
          raisedBy: q.raisedBy.name,
          status: q.status,
          findingIds: q.findingIds,
          replies: q.responses.map((r) => ({ by: r.by.name, at: r.at, text: r.text, documents: r.documentLinkIds.map((id) => c.documents.find((d) => d.linkId === id)?.filename ?? id) })),
        })),
      counts: {
        documents: documents.filter((d) => d['active']).length,
        rulesChecked: rules.filter((r) => ['FLAGGED', 'REVIEWED', 'PASSED'].includes(r.status)).length,
        rulesTotal: rules.length,
        rulesFlagged: rules.filter((r) => r.status === 'FLAGGED').length,
        openFindings: openFindings.length,
        blocking: openFindings.filter((f) => f.blocking).length,
        missing: missing.length,
      },
    };
  }

  // ---------------------------------------------------------------- what a user may do and see

  /** What this user could do next on this case — for the UI; the server re-checks each action. */
  availableActions(user: AuthenticatedUser, c: TradeCase): string[] {
    const actions: string[] = [];
    const amendment = this.openAmendment(c);
    const amendmentGate: Partial<Record<CaseAction, boolean>> = {
      REQUEST_AMENDMENT: !amendment,
      SUBMIT_AMENDMENT: amendment?.status === 'UNDER_REVIEW' && Object.values(amendment.reviews).every((r) => r?.status === 'APPROVED'),
      DECIDE_AMENDMENT: amendment?.status === 'APPROVAL_PENDING',
      ISSUE_AMENDMENT: amendment?.status === 'APPROVED',
      AMENDMENT_BENEFICIARY_RESPONSE: amendment?.status === 'ISSUED_AWAITING_BENEFICIARY',
      SEND_DOCUMENTS: awaitingSend(c).length > 0,
      START_POST_SHIPMENT: !c.presentations.some((p) => !p.decision),
      ATTACH_PRESENTATION_DOCUMENT: c.presentations.some((p) => !p.decision && (p.applicationStatus === 'DRAFT') === !(c.status === 'DOCUMENT_EXAMINATION' || c.status === 'DISCREPANCY_RESOLUTION')),
      REMOVE_PRESENTATION_DOCUMENT: c.presentations.some((p) => !p.decision && p.applicationStatus === 'DRAFT' && p.documentLinkIds.length > 0),
      SUBMIT_POST_SHIPMENT: c.presentations.some((p) => !p.decision && p.applicationStatus === 'DRAFT' && p.documentLinkIds.length > 0),
    };
    for (const action of Object.keys(STATE_TRANSITIONS) as CaseAction[]) {
      if (!hasAnyPermission(user, ACTION_PERMISSIONS[action])) continue;
      if (!STATE_TRANSITIONS[action]!.includes(c.status)) continue;
      if (action in amendmentGate && !amendmentGate[action]) continue;
      actions.push(action);
    }
    if (['UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION'].includes(c.status)) {
      for (const d of DEPARTMENTS) if (c.reviews[d].required && hasPermission(user, DEPARTMENT_PERMISSION[d])) actions.push(`REVIEW_${d}`);
    }
    if (amendment?.status === 'UNDER_REVIEW') {
      for (const d of DEPARTMENTS) if (amendment.reviews[d]?.status === 'PENDING' && hasPermission(user, DEPARTMENT_PERMISSION[d])) actions.push(`REVIEW_AMENDMENT_${d}`);
    }
    // Only an open or escalated finding can be dispositioned (see dispositionFinding), so with none
    // left there is nothing to do and the case must not show up as waiting on this user.
    const dispositionable = c.findings.some((f) => f.status === 'OPEN' || (f.status === 'DISPOSITIONED' && f.disposition?.code === 'CONFIRMED_ESCALATED'));
    if (dispositionable && !['DRAFT', 'CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'].includes(c.status)) {
      if (hasAnyPermission(user, ['tradecase.finding.disposition.data', 'tradecase.finding.disposition.credit'])) actions.push('DISPOSITION_FINDING');
      if (hasPermission(user, 'tradecase.finding.disposition.compliance')) actions.push('DISPOSITION_COMPLIANCE_FINDING');
    }
    return actions;
  }

  /** A finding reduced to "something restricted exists", for staff without the permission to read it. */
  private redactFinding(f: Finding, kind: 'compliance' | 'credit'): Finding {
    return {
      ...f,
      key: `restricted:${f.findingId}`,
      ruleId: 'RESTRICTED',
      title: kind === 'credit' ? 'Restricted credit matter' : RESTRICTED_TITLE,
      description: kind === 'credit' ? 'Details are visible to credit and approval roles only.' : 'Details are visible to compliance roles only.',
      fields: [],
      observed: [],
      expected: '',
      confidence: null,
      recommendedAction: kind === 'credit' ? 'Owned by Credit.' : 'Owned by Compliance.',
      history: [],
      disposition: f.disposition ? { ...f.disposition, rationale: '(restricted)' } : null,
    };
  }

  /**
   * The case as this user may see it, decided on the server. Customers get the customer view (no
   * internal findings, no holds, no investigations). Bank staff get the case with compliance, credit
   * and investigation detail removed unless they hold the permission to read it — a placeholder
   * stays, so they can see a blocker exists without seeing what it is.
   */
  toView(user: AuthenticatedUser, c: TradeCase): Record<string, unknown> {
    if (isCustomerView(user)) return this.customerView(user, c);

    const internal = hasPermission(user, 'tradecase.findings.internal.view');
    const credit = hasPermission(user, 'tradecase.credit.view');
    const investigations = hasPermission(user, 'tradecase.investigation.view');
    const restricted = new Map<string, string>();
    const findings = c.findings.map((f) => {
      if (this.policy.complianceCategories.includes(f.category) && !internal) {
        restricted.set(f.findingId, RESTRICTED_TITLE);
        return this.redactFinding(f, 'compliance');
      }
      if (f.category === 'CREDIT_BLOCKER' && !credit) {
        restricted.set(f.findingId, 'Restricted credit matter');
        return this.redactFinding(f, 'credit');
      }
      return f;
    });
    const scrub = (lines: string[]) =>
      lines.map((line) => {
        const id = line.split(' ')[0] ?? '';
        return restricted.has(id) ? `${id} ${restricted.get(id)}` : line;
      });
    const compliance = c.reviews.COMPLIANCE;
    const reviews = internal
      ? c.reviews
      : {
          ...c.reviews,
          COMPLIANCE: { ...compliance, rationale: compliance.rationale ? '(restricted)' : '', history: compliance.history.map((h) => ({ ...h, note: '(restricted)' })) },
        };
    const investigationRelated = (s: TradeCase['statusHistory'][number]) => s.to === 'UNDER_INVESTIGATION' || s.from === 'UNDER_INVESTIGATION';

    // A draft application is the customer's own until they submit it: the bank sees neither it nor its documents.
    const draftIds = new Set(c.presentations.filter((p) => p.applicationStatus === 'DRAFT').map((p) => p.presentationId));
    return {
      ...c,
      preShipmentReference: preShipmentReferenceOf(c),
      presentations: c.presentations.filter((p) => !draftIds.has(p.presentationId)).map((p) => ({ ...p, state: applicationState(c, p) })),
      documents: c.documents.filter((d) => !d.presentationId || !draftIds.has(d.presentationId)),
      findings,
      reviews,
      queries: internal ? c.queries : c.queries.map((q) => (q.department === 'COMPLIANCE' && q.assignee !== 'CUSTOMER' ? { ...q, question: '(restricted)', responses: [] } : q)),
      creditFacility: credit ? c.creditFacility : null,
      creditFacilityRecorded: Boolean(c.creditFacility),
      investigations: investigations ? c.investigations : [],
      statusHistory: investigations ? c.statusHistory : c.statusHistory.map((s) => (investigationRelated(s) ? { ...s, reason: 'Restricted: investigation activity' } : s)),
      availableActions: this.availableActions(user, c),
      approvalBlockers: ['UNDER_REVIEW', 'APPROVAL_PENDING'].includes(c.status) ? scrub(this.approvalBlockers(c)) : [],
      checklists: Object.fromEntries(DEPARTMENTS.map((d) => [d, this.applicableChecklist(c, d)])),
      reviewBlockers: Object.fromEntries(DEPARTMENTS.map((d) => [d, c.status === 'UNDER_REVIEW' ? scrub(this.reviewBlockers(c, d)) : []])),
      viewer: { internalFindings: internal, credit, investigations },
    };
  }

  private customerView(user: AuthenticatedUser, c: TradeCase): Record<string, unknown> {
    const investigating = c.status === 'UNDER_INVESTIGATION';
    const visibleStatus = investigating ? c.investigations.find((i) => !i.closedAt)?.resumeStatus ?? c.status : c.status;
    return {
      caseId: c.caseId,
      transactionType: c.transactionType,
      customerRef: c.customerRef,
      status: visibleStatus,
      statusHistory: c.statusHistory.filter((s) => s.to !== 'UNDER_INVESTIGATION' && s.from !== 'UNDER_INVESTIGATION').map((s) => ({ ...s, reason: s.actor === 'SYSTEM' ? s.reason : s.reason.slice(0, 200) })),
      applicationVersions: c.applicationVersions,
      currentApplicationVersion: c.currentApplicationVersion,
      documents: c.documents,
      // A customer who sent documents only typed nothing the bank could find "missing" or "wrong", so
      // the bank's scrutiny findings are not theirs to read: they see what the bank asks them in a
      // query, together with the finding that query is about.
      findings: c.findings
        .filter((f) => !INTERNAL_CATEGORIES.includes(f.category) && !officerOnly(f) && !unconfirmedPostShipmentAi(c, f) && (!isDocumentsOnly(c) || c.queries.some((q) => q.assignee === 'CUSTOMER' && q.findingIds.includes(f.findingId))))
        .map((f) => (f.origin === 'EXTERNAL_VERIFICATION' ? this.customerSafeExternalFinding(f) : f)),
      reviews: Object.fromEntries(
        DEPARTMENTS.map((d) => {
          const r = c.reviews[d];
          // A compliance hold reads as "in review": telling the customer would be tipping-off.
          const status = r.status === 'ON_HOLD' || r.status === 'REJECT_RECOMMENDED' ? 'PENDING' : r.status;
          return [d, { department: d, required: r.required, status }];
        }),
      ),
      queries: c.queries.filter((q) => q.assignee === 'CUSTOMER'),
      issuedLc: c.issuedLc,
      preShipmentReference: preShipmentReferenceOf(c),
      amendments: (c.amendments ?? []).map((a) => ({
        amendmentId: a.amendmentId,
        number: a.number,
        status: a.status === 'UNDER_REVIEW' || a.status === 'APPROVAL_PENDING' || a.status === 'APPROVED' ? 'IN_PROGRESS' : a.status,
        reason: a.reason,
        requestedAt: a.requestedAt,
        changedFields: a.changedFields,
        proposedTerms: a.proposedTerms,
        issuance: a.issuance ? { reference: a.issuance.reference, mode: a.issuance.mode, at: a.issuance.at } : null,
        beneficiaryResponse: a.beneficiaryResponse ? { accepted: a.beneficiaryResponse.accepted, at: a.beneficiaryResponse.at } : null,
      })),
      presentations: c.presentations.map((p) => ({ ...presentationSummary(c, p), documentLinkIds: p.documentLinkIds, applicationStatus: p.applicationStatus ?? 'SUBMITTED' })),
      settlement: c.settlement,
      validation: { lastRunAt: c.validation.lastRunAt, piExtractionSource: c.validation.piExtractionSource },
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      submittedAt: c.submittedAt,
      closedAt: c.closedAt,
      availableActions: investigating ? [] : this.availableActions(user, c),
      approvalBlockers: [],
      checklists: {},
      reviewBlockers: {},
      viewer: { internalFindings: false, credit: false, investigations: false },
    };
  }

  /** Queue counts for the dashboard, scoped to what the user may see. */
  /**
   * What each headline count on the case page is made of, for one case: the open questions to the customer, whether a
   * finding is blocking it, and its open compliance/TBML alerts (staff who may read them only). The dashboard adds
   * these up and the case list carries them, so a box and the cases behind it always agree.
   */
  caseSignals(user: AuthenticatedUser, c: TradeCase): { openCustomerQueries: number; blocked: boolean; complianceAlerts: number } {
    const internal = hasPermission(user, 'tradecase.findings.internal.view');
    return {
      openCustomerQueries: c.queries.filter((q) => q.assignee === 'CUSTOMER' && q.status === 'OPEN').length,
      blocked: c.findings.some((f) => blocksNow(f) && (!isCustomerView(user) || !INTERNAL_CATEGORIES.includes(f.category))),
      complianceAlerts: internal ? c.findings.filter((f) => f.status === 'OPEN' && (f.category === 'COMPLIANCE_ALERT' || f.category === 'TBML_RED_FLAG')).length : 0,
    };
  }

  async dashboard(user: AuthenticatedUser, stage?: unknown): Promise<Record<string, unknown>> {
    const cases = await this.listCases(user, { stage });
    const byStatus: Record<string, number> = {};
    const pendingByDepartment: Record<string, number> = { RM: 0, TRADE_OPS: 0, COMPLIANCE: 0, CREDIT: 0 };
    let openCustomerQueries = 0;
    let blockedByFindings = 0;
    let complianceAlerts = 0;
    const internal = hasPermission(user, 'tradecase.findings.internal.view');
    const toAuthorisation: number[] = [];
    for (const c of cases) {
      const shownStatus = !hasPermission(user, 'tradecase.investigation.view') && c.status === 'UNDER_INVESTIGATION' ? c.investigations.find((i) => !i.closedAt)?.resumeStatus ?? c.status : c.status;
      byStatus[shownStatus] = (byStatus[shownStatus] ?? 0) + 1;
      if (['UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION'].includes(c.status)) {
        for (const d of DEPARTMENTS) if (c.reviews[d].required && c.reviews[d].status !== 'APPROVED') pendingByDepartment[d]! += 1;
      }
      const signals = this.caseSignals(user, c);
      openCustomerQueries += signals.openCustomerQueries;
      if (signals.blocked) blockedByFindings += 1;
      complianceAlerts += signals.complianceAlerts;
      const submitted = c.statusHistory.find((s) => s.to === 'UNDER_REVIEW');
      const authorised = c.statusHistory.find((s) => s.to === 'AUTHORIZED_FOR_ISSUANCE');
      if (submitted && authorised) toAuthorisation.push(new Date(authorised.at).getTime() - new Date(submitted.at).getTime());
    }
    return {
      totalCases: cases.length,
      byStatus,
      pendingReviewsByDepartment: isCustomerView(user) ? undefined : pendingByDepartment,
      openCustomerQueries,
      casesBlockedByFindings: blockedByFindings,
      openComplianceAlerts: internal ? complianceAlerts : undefined,
      medianHoursSubmissionToAuthorisation: toAuthorisation.length ? Math.round((median(toAuthorisation) / 3_600_000) * 10) / 10 : null,
      recentCases: cases.slice(0, 8).map((c) => ({ caseId: c.caseId, status: c.status, updatedAt: c.updatedAt })),
    };
  }
}

type CaseQuery_Assignee = 'CUSTOMER' | Department;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function safeJsonArray(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
}

let service: TradeCaseService | null = null;
let listening = false;

export function getTradeCaseService(): TradeCaseService {
  if (!service) service = new TradeCaseService();
  if (!listening) {
    listening = true;
    analysisEvents.on('settled', ({ documentId }: { documentId: string }) => {
      void service!.onDocumentSettled(documentId).catch((error: unknown) => {
        log.warn('revalidation after document analysis failed', { documentId, error: describeUnknown(error) });
      });
    });
  }
  return service;
}
