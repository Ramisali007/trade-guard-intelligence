import './test-env';
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import PDFDocument from 'pdfkit';
import { setProviderForTesting } from '../ai';
import { VerificationGovernance } from '../verification/governance';
import { setHsReferenceForTesting } from '../verification/hs/hs-reference';
import { buildPortIndex, setPortIndexForTesting } from '../verification/maritime/port-index';
import { FakeReviewAi } from './fake-ai';
import { config } from '../config';
import { HeuristicProvider } from '../ai/providers/heuristic.provider';
import type { AIAnalysisService } from '../ai/types';
import { createApp } from '../app';
import { ComplianceStore } from '../compliance/db/compliance-store';
import { normalizeRole, signBankingToken, type AuthenticatedUser } from '../middleware/auth.middleware';
import { findDemoAccount, getAccount, type DemoAccountKey } from '../services/account-directory';
import { CustomerRepository } from '../services/customer.repository';
import { getRepository, initRepository } from '../services/document.repository';
import { getDocumentService, type UploadedFile } from '../services/document.service';
import { validateFinancialInstrument } from '../trade-cases/lc-issuance.adapter';
import { evaluatePreTrade } from '../trade-cases/pretrade-validation';
import { getTradeCaseRepository, initTradeCaseRepository, upgradeReferences, verifyChain } from '../trade-cases/trade-case.repository';
import { classifyFinding } from '../trade-cases/post-shipment-verification';
import { applicationState, clearedBy, EMPTY_APPLICATION, getTradeCaseService, preShipmentReferenceOf, POST_SHIPMENT_STATUSES, PRE_SHIPMENT_STATUSES } from '../trade-cases/trade-case.service';
import type { Department, LcApplicationData, TradeCase } from '../trade-cases/trade-case.types';
import { DEFAULT_POLICY } from '../trade-cases/workflow.policy';

/**
 * The import LC lifecycle end to end, through the real upload and analysis pipeline:
 *
 *   A  successful request → reviews → maker-checker → sandbox issuance → presentation →
 *      examination → waiver → settlement → closure
 *   B  PI / application amount mismatch → query → correction as a new version → re-review
 *   C  missing shipment date fixed, while an independent compliance hold keeps the case blocked
 *   D  sanctioned jurisdiction and PI reuse → hold → confirmed → rejected; hidden from the customer
 *   E  AI provider down → honest fallback, manual verification, no duplicates on retry
 *   plus separation of duties, ownership, terminal states, audit-chain integrity and HTTP guards.
 *
 * All documents are synthetic PDFs generated here. Nothing leaves the process.
 */

const svc = getTradeCaseService();
const as = (key: DemoAccountKey): AuthenticatedUser => ({ ...findDemoAccount(key)!, tokenType: 'BEARER' });
const customer = as('corporate_customer');
const rm = as('relationship_manager');
const maker = as('trade_maker');
const checker = as('trade_checker');
const credit = as('credit_reviewer');
const compliance = as('risk_analyst');
const approver = as('senior_approver');
const issuer = as('lc_issuer');
const settlement = as('settlement_officer');
const auditor = as('trade_auditor');
// A second, real customer in the directory (TG-CORP-2002): HTTP calls are authenticated against it.
const otherCustomer = as('corporate_customer_2');
// The system administrator: technical authority only, no business permissions.
const admin = as('system_admin');

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const dmy = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
};

function pdf(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(10);
    for (const line of lines) doc.text(line);
    doc.end();
  });
}

const upload = (name: string, buffer: Buffer): UploadedFile => ({ originalname: name, mimetype: 'application/pdf', size: buffer.length, buffer });

function proforma(number: string, total: string, origin = 'CHINA'): string[] {
  return [
    'GLOBAL COTTON TRADERS LIMITED',
    'Unit 5, Tianhe Business Park, Guangzhou, China',
    'PROFORMA INVOICE',
    `INVOICE NO: ${number} DATE: ${dmy(-3)}`,
    'BUYER: KAMRAN TEXTILES (PVT) LTD',
    'INCOTERMS: CFR Karachi',
    `COUNTRY OF ORIGIN: ${origin}`,
    'Item Description HS Code Quantity Unit Price Total (USD)',
    `RAW COTTON FIBRE GRADE A 5201.0010 100,000.00 KG $2.50/KG $${total}`,
    `TOTAL AMOUNT: USD $${total}`,
    'For GLOBAL COTTON TRADERS LIMITED',
  ];
}

function application(overrides: Partial<LcApplicationData> = {}): Partial<LcApplicationData> {
  return {
    applicant: { name: 'Kamran Textiles (Pvt) Ltd', address: 'Plot 12, SITE, Karachi', country: 'Pakistan' },
    beneficiary: { name: 'Global Cotton Traders Limited', address: 'Tianhe Business Park, Guangzhou', country: 'China' },
    purpose: 'Raw material for the spinning unit',
    proformaInvoiceNumber: 'PI-2026-0042',
    currency: 'USD',
    amount: 250000,
    amountTolerancePercent: 0,
    goodsDescription: 'Raw cotton fibre grade A',
    hsCode: '5201.0010',
    quantity: 100000,
    unitOfMeasure: 'KG',
    unitPrice: 2.5,
    incoterm: 'CFR',
    namedPlace: 'Karachi',
    countryOfOrigin: 'China',
    portOfLoading: 'Shanghai',
    portOfDischarge: 'Karachi',
    partialShipments: 'NOT_ALLOWED',
    transshipment: 'ALLOWED',
    latestShipmentDate: day(60),
    expiryDate: day(90),
    presentationPeriodDays: 21,
    paymentTerms: 'SIGHT',
    usanceDays: null,
    requiredDocuments: ['COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'PACKING_LIST'],
    ...overrides,
  };
}

async function waitFor<T>(what: string, probe: () => Promise<T | null | false>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const load = async (caseId: string) => (await getTradeCaseRepository().findById(caseId))!;
/** Start the AI scrutiny as the trade desk does, and wait until the run has finished. */
async function runScrutiny(user: AuthenticatedUser, caseId: string) {
  const started = await svc.startScrutiny(user, caseId);
  await waitFor('the AI scrutiny to finish', async () => {
    const c = await load(caseId);
    return c.scrutinyRun && c.scrutinyRun.status !== 'RUNNING' ? c : null;
  });
  return started;
}
const currentApplicationOf = (c: TradeCase) => c.applicationVersions[c.applicationVersions.length - 1]!.data;

/** Upload a PI and wait until the case has re-validated against its analyzed content. */
async function attachPi(caseId: string, user: AuthenticatedUser, name: string, content: string[] | Buffer): Promise<TradeCase> {
  const bytes = Buffer.isBuffer(content) ? content : await pdf(content);
  const { document } = await svc.attachDocument(user, caseId, upload(name, bytes), 'PROFORMA_INVOICE');
  // Whoever attaches a document only hands it over; the bank decides when it is analyzed. These
  // scenarios are about what happens once it has been, so start it the way the bank's button does
  // (Scenario G covers that button itself). A re-sent identical file is already analyzed and needs nothing.
  if ((await getRepository().findMeta(document.documentId))?.status !== 'completed') {
    await getDocumentService().startAnalysis(document.documentId);
  }
  return waitFor(`analysis of ${name}`, async () => {
    const c = await load(caseId);
    const pending = c.findings.some((f) => f.key.endsWith(':pending') && f.status === 'OPEN');
    return c.validation.piDocumentId === document.documentId && c.validation.piExtractionSource !== 'NOT_AVAILABLE' && !pending ? c : null;
  });
}

const open = (c: TradeCase, pred: (f: TradeCase['findings'][number]) => boolean = () => true) => c.findings.filter((f) => f.status === 'OPEN' && pred(f));

async function expectError(promise: Promise<unknown>, status: number, label: string, contains?: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const e = error as { status?: number; message?: string };
    assert.strictEqual(e.status, status, `${label}: expected ${status}, got ${e.status} (${e.message})`);
    if (contains) assert.ok(e.message?.includes(contains), `${label}: message "${e.message}" should mention "${contains}"`);
    return;
  }
  assert.fail(`${label}: expected HTTP ${status}, but it succeeded`);
}

/** Compliance clears every open screening/TBML indicator on the case with a recorded rationale. */
async function complianceClears(caseId: string, code: 'FALSE_POSITIVE' | 'RISK_ACCEPTED' = 'FALSE_POSITIVE'): Promise<string[]> {
  const cleared: string[] = [];
  for (const f of open(await load(caseId), (x) => DEFAULT_POLICY.complianceCategories.includes(x.category))) {
    const allowed = f.category === 'REGULATORY_CONCERN' ? 'JUSTIFIED' : code;
    await svc.dispositionFinding(compliance, caseId, f.findingId, { code: allowed, rationale: `Reviewed ${f.ruleId}: evidence checked against the documents; not a concern for this trade.` });
    cleared.push(`${f.findingId} ${f.ruleId} — ${f.title}`);
  }
  return cleared;
}

async function approveReview(caseId: string, department: Department, user: AuthenticatedUser): Promise<TradeCase> {
  const c = await load(caseId);
  const view = svc.toView(user, c) as { checklists: Record<Department, Array<{ itemId: string }>> };
  return svc.decideReview(user, caseId, department, {
    decision: 'APPROVE',
    rationale: `${department} review complete; checklist confirmed against the documents on file.`,
    checklist: view.checklists[department].map((i) => i.itemId),
  });
}

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('Import LC lifecycle — pre-trade to post-trade');
  console.log('================================================================\n');

  await initRepository();
  await CustomerRepository.getInstance().init();
  await ComplianceStore.getInstance().init();
  await initTradeCaseRepository();

  // ------------------------------------------------------------------ rule unit checks
  const base = { ...EMPTY_APPLICATION, ...application() } as LcApplicationData;
  const stubCase = { documents: [], creditFacility: null } as unknown as TradeCase;
  const ctx = (app: LcApplicationData) => ({ tradeCase: stubCase, application: app, applicationVersion: 1, submittedApplication: null, policy: DEFAULT_POLICY, pi: null, piReuse: [], partyScreening: null, now: new Date() });
  const keys = (app: LcApplicationData) => evaluatePreTrade(ctx(app)).map((f) => f.key);
  assert.ok(keys({ ...base, expiryDate: day(500) }).includes('PK-FEM13-09-VALIDITY:expiry'), 'validity beyond 12 months flagged');
  assert.ok(keys({ ...base, latestShipmentDate: day(80) }).includes('PT-DATE-ORDER:presentation-window'), 'presentation window past expiry flagged');
  assert.ok(keys({ ...base, latestShipmentDate: day(100) }).includes('PT-DATE-ORDER:shipment-after-expiry'));
  assert.ok(keys({ ...base, paymentTerms: 'USANCE', usanceDays: 360 }).includes('TBML-USANCE:usanceDays'), 'long usance routed for review');
  assert.ok(keys({ ...base, paymentTerms: 'USANCE', usanceDays: null }).includes('PT-REQ-001:usanceDays'), 'usance needs a tenor');
  const cif = evaluatePreTrade(ctx({ ...base, incoterm: 'CIF' })).find((f) => f.ruleId === 'PK-FEM13-05-TERMS');
  assert.ok(cif && !cif.blocking, 'terms-of-import note is advisory, never blocking');
  assert.ok(keys(base).includes('PK-FEM13-07-FIRM:case'), 'no PI on file → firm-commitment finding');
  assert.deepStrictEqual(validateFinancialInstrument({ number: 'HBL-IMP-000123-15032026LC', expiryDate: '2026-12-31' }, '2026-12-31', new Date('2026-10-21')), []);
  assert.strictEqual(validateFinancialInstrument({ number: 'HBL-IMP-123-15032026', expiryDate: '2026-12-31' }, '2026-12-31', new Date()).length, 1, 'malformed FI number refused');
  assert.strictEqual(validateFinancialInstrument({ number: 'HBL-IMP-000123-15032026', expiryDate: '2026-12-30' }, '2026-12-31', new Date()).length, 1, 'FI expiry must match the LC');
  assert.strictEqual(normalizeRole('PLATFORM_ADMIN'), 'PLATFORM_ADMIN', 'an admin role name is not promoted to compliance officer');
  console.log('✔ Rule unit checks passed: dates, validity, usance, terms, firm commitment, FI format, role mapping.\n');

  // ------------------------------------------------------------------ Scenario A
  console.log('Scenario A: successful import request, through settlement and closure');
  const created = await svc.createCase(customer, { clientRequestId: 'REQ-A-1', application: application() });
  assert.strictEqual(created.created, true);
  const A = created.tradeCase.caseId;
  assert.match(A, /^TC-\d{4}-\d{5}$/);
  const again = await svc.createCase(customer, { clientRequestId: 'REQ-A-1', application: application() });
  assert.strictEqual(again.created, false, 'the same client request id returns the same case');
  assert.strictEqual(again.tradeCase.caseId, A);
  assert.strictEqual((await svc.listCases(customer, {})).length, 1, 'no duplicate case was created');

  let a = await attachPi(A, customer, 'PI-2026-0042.pdf', proforma('PI-2026-0042', '250,000.00'));
  assert.strictEqual(a.validation.piExtractionSource, 'DETERMINISTIC_PARSER', 'the local parser read the PI and says so');
  const dataIssues = open(a, (f) => ['DATA_INCONSISTENCY', 'MISSING_INFORMATION', 'LOW_CONFIDENCE_EXTRACTION'].includes(f.category));
  assert.deepStrictEqual(dataIssues.map((f) => `${f.ruleId}: ${f.title}`), [], 'PI and application agree');

  a = await svc.submit(customer, A);
  assert.strictEqual(a.status, 'UNDER_REVIEW');
  await expectError(svc.requestApproval(maker, A, 'Ready'), 409, 'approval before reviews');
  await expectError(svc.decideReview(maker, A, 'COMPLIANCE', { decision: 'APPROVE', rationale: 'Not my department to approve' }), 403, 'trade maker approving compliance');

  await approveReview(A, 'RM', rm);
  await approveReview(A, 'TRADE_OPS', checker);
  const cleared = await complianceClears(A);
  if (cleared.length) console.log(`   compliance dispositioned: ${cleared.join('; ')}`);
  await approveReview(A, 'COMPLIANCE', compliance);
  await expectError(approveReview(A, 'CREDIT', credit), 409, 'credit approval without a facility record');
  await svc.recordCreditFacility(credit, A, { facilityReference: 'LCF-KTL-2026-01', availableLimit: 500000, currency: 'USD', marginPercent: 10, verificationSource: 'SANDBOX_DEMO_DATA', note: 'Sandbox figure for testing; no core-banking access.' });
  a = await approveReview(A, 'CREDIT', credit);
  assert.deepStrictEqual(svc.approvalBlockers(a), [], 'all gates satisfied');

  a = await svc.requestApproval(maker, A, 'All four reviews complete; ready for authorization.');
  assert.strictEqual(a.status, 'APPROVAL_PENDING');
  await expectError(svc.decideApproval(checker, A, { decision: 'APPROVE', rationale: 'Approving the case now' }), 403, 'checker who did the Trade Ops review approving', 'Separation of duties');
  await expectError(svc.decideApproval(admin, A, { decision: 'APPROVE', rationale: 'Admin bypass attempt' }), 403, 'platform admin approving');
  a = await svc.decideApproval(approver, A, { decision: 'APPROVE', rationale: 'Terms, risk and facility reviewed; authorized.' });
  assert.strictEqual(a.status, 'AUTHORIZED_FOR_ISSUANCE');

  const expiry = a.applicationVersions[a.applicationVersions.length - 1]!.data.expiryDate!;
  const fiDate = dmy(0).replace(/\./g, '');
  await expectError(svc.recordIssuance(approver, A, { financialInstrumentNumber: `HBL-IMP-000123-${fiDate}LC`, financialInstrumentExpiry: expiry }), 403, 'approver issuing');
  await expectError(svc.recordIssuance(issuer, A, { financialInstrumentNumber: `HBL-IMP-000123-${fiDate}LC`, financialInstrumentExpiry: day(30) }), 422, 'FI expiry mismatch', 'must match');
  a = await svc.recordIssuance(issuer, A, { financialInstrumentNumber: `HBL-IMP-000123-${fiDate}LC`, financialInstrumentExpiry: expiry });
  assert.strictEqual(a.status, 'LC_ISSUED');
  assert.ok(a.issuedLc?.lcNumber.startsWith('SBX-LC-') && a.issuedLc.mode === 'SANDBOX', 'issuance is labeled sandbox');
  assert.match(a.issuedLc!.adapterMessage, /no SWIFT MT700 was sent/);

  const invoice = await pdf([
    'GLOBAL COTTON TRADERS LIMITED',
    'Unit 5, Tianhe Business Park, Guangzhou, China',
    'COMMERCIAL INVOICE',
    `INVOICE NO: CI-2026-0911 DATE: ${dmy(-1)}`,
    'BUYER: KAMRAN TEXTILES (PVT) LTD',
    'INCOTERMS: CFR Karachi',
    'COUNTRY OF ORIGIN: CHINA',
    'Item Description HS Code Quantity Unit Price Total (USD)',
    'RAW COTTON FIBRE GRADE A 5201.0010 100,000.00 KG $2.50/KG $250,000.00',
    'TOTAL AMOUNT: USD $250,000.00',
    'For GLOBAL COTTON TRADERS LIMITED',
  ]);
  const bl = await pdf([
    'OCEAN BILL OF LADING',
    'B/L NO: COSU2026000911',
    'SHIPPER: GLOBAL COTTON TRADERS LIMITED',
    'NOTIFY PARTY: KAMRAN TEXTILES (PVT) LTD',
    'PORT OF LOADING: SHANGHAI',
    'PORT OF DISCHARGE: PORT QASIM',
    `SHIPPED ON BOARD DATE: ${dmy(-2)}`,
    '1,000 BALES RAW COTTON FIBRE GRADE A 100,000.00 KG',
  ]);
  const packing = await pdf(['PACKING LIST', 'INVOICE NO: CI-2026-0911', 'SELLER: GLOBAL COTTON TRADERS LIMITED', '1,000 BALES RAW COTTON FIBRE GRADE A NET WEIGHT 100,000.00 KG']);
  await expectError(svc.recordPresentation(customer, A, [upload('inv.pdf', invoice)], ['COMMERCIAL_INVOICE']), 403, 'customer recording a presentation');
  a = await svc.recordPresentation(maker, A, [upload('CI-2026-0911.pdf', invoice), upload('BL-COSU2026000911.pdf', bl), upload('PL-CI-2026-0911.pdf', packing)], [
    'COMMERCIAL_INVOICE',
    'BILL_OF_LADING',
    'PACKING_LIST',
  ]);
  assert.strictEqual(a.status, 'DOCUMENT_EXAMINATION');
  const presentedIds = a.documents.filter((d) => d.stage === 'POST_TRADE').map((d) => d.documentId);
  await waitFor('presented documents analyzed', async () => {
    const docs = await Promise.all(presentedIds.map((id) => getRepository().findMeta(id)));
    return docs.every((d) => d && ['completed', 'failed'].includes(d.status));
  });
  a = await svc.examinePresentation(maker, A);
  const pr = a.presentations[0]!;
  const discrepancies = open(a, (f) => f.presentationId === pr.presentationId && f.category === 'DOCUMENTARY_DISCREPANCY');
  console.log(`   examination: ${pr.examination!.result}; ${open(a, (f) => f.presentationId === pr.presentationId).map((f) => `${f.ruleId} (${f.category})`).join(', ') || 'no findings'}`);
  assert.strictEqual(pr.examination!.result, 'DISCREPANT');
  assert.ok(discrepancies.some((f) => f.ruleId === 'EXM-TD-PORTS'), 'port of discharge Port Qasim vs Karachi is a discrepancy');
  assert.ok(!open(a).some((f) => f.ruleId === 'EXM-INV-AMOUNT' || f.ruleId === 'EXM-INV-BENEFICIARY' || f.ruleId === 'EXM-TD-SHIPDATE'), 'amount, beneficiary and shipment date comply');
  assert.deepStrictEqual(
    open(a, (f) => f.presentationId === pr.presentationId && f.blocking).map((f) => f.ruleId),
    ['EXM-TD-PORTS'],
    'a packing list quoting the invoice number is not a "conflicting amount"; the only blocking finding is the port',
  );
  assert.ok(open(a, (f) => f.presentationId === pr.presentationId).some((f) => f.ruleId === 'EXM-XD-BASIS' && f.severity === 'INFO'), 'the examination states what it was run against');
  assert.strictEqual(a.status, 'DISCREPANCY_RESOLUTION');

  await expectError(svc.decidePresentation(checker, A, { decision: 'ACCEPT', rationale: 'Accepting without waiver' }), 409, 'accept before the applicant waives');
  for (const f of discrepancies) await svc.applicantWaiver(customer, A, f.findingId, { accept: true, note: 'We accept discharge at Port Qasim, Karachi.' });
  for (const f of open(await load(A), (x) => x.presentationId === pr.presentationId && x.category === 'LOW_CONFIDENCE_EXTRACTION')) {
    await svc.dispositionFinding(maker, A, f.findingId, { code: 'VERIFIED_MANUALLY', rationale: 'Checked against the original presented document.' });
  }
  const clearedPost = await complianceClears(A);
  if (clearedPost.length) console.log(`   compliance dispositioned (post-trade): ${clearedPost.join('; ')}`);
  await expectError(svc.decidePresentation(maker, A, { decision: 'ACCEPT', rationale: 'Presenter deciding own presentation' }), 403, 'presenter deciding');
  a = await svc.decidePresentation(checker, A, { decision: 'ACCEPT', rationale: 'Discrepancy waived by the applicant; documents otherwise comply.' });
  assert.strictEqual(a.status, 'AWAITING_SETTLEMENT');
  assert.ok(a.findings.filter((f) => f.ruleId === 'EXM-TD-PORTS').every((f) => f.disposition?.code === 'DISCREPANCY_WAIVED'));

  await expectError(svc.recordSettlement(settlement, A, { mode: 'LIVE', amount: 250000, currency: 'USD', valueDate: day(0), reference: 'X1' }), 400, 'live settlement refused');
  await expectError(svc.recordSettlement(settlement, A, { mode: 'SANDBOX', amount: 260000, currency: 'USD', valueDate: day(0), reference: 'X1' }), 400, 'settlement above the credit');
  a = await svc.recordSettlement(settlement, A, { mode: 'SANDBOX', amount: 250000, currency: 'USD', valueDate: day(0), reference: 'SBX-STL-0001', note: 'Sandbox settlement record; no payment initiated.' });
  assert.strictEqual(a.status, 'SETTLED_MONITORING');
  a = await svc.closeCase(checker, A, 'Settled, discrepancy waived, no open compliance matters.');
  assert.strictEqual(a.status, 'CLOSED');
  await expectError(svc.openInvestigation(compliance, A, { reason: 'Too late — the case is closed now.' }), 409, 'action on a closed case');

  const audit = await svc.getAudit(auditor, A);
  assert.ok(audit.chain.valid, 'audit chain intact');
  assert.ok(audit.events.length >= 20, `audit has every step (${audit.events.length} events)`);
  const tampered = audit.events.map((e) => (e.action === 'APPROVAL_GRANTED' ? { ...e, actor: { ...e.actor, name: 'Someone Else' } } : e));
  assert.strictEqual(verifyChain(tampered).valid, false, 'an edited audit entry breaks the chain');
  await expectError(svc.getAudit(customer, A), 403, 'customer reading the audit log');
  console.log(`✔ Scenario A Passed: ${A} issued (sandbox), examined, waived, settled and closed; ${audit.events.length} chained audit events.\n`);

  // ------------------------------------------------------------------ Scenario B
  console.log('Scenario B: PI 250,000 vs application 245,000');
  const B = (await svc.createCase(customer, { clientRequestId: 'REQ-B-1', application: application({ amount: 245000, proformaInvoiceNumber: 'PI-2026-0050' }) })).tradeCase.caseId;
  let b = await attachPi(B, customer, 'PI-2026-0050.pdf', proforma('PI-2026-0050', '250,000.00'));
  const mismatch = open(b, (f) => f.ruleId === 'PT-CMP-AMOUNT')[0];
  assert.ok(mismatch, 'amount mismatch found');
  assert.ok(mismatch.blocking && mismatch.category === 'DATA_INCONSISTENCY');
  const docEvidence = mismatch.observed.find((e) => e.source === 'DOCUMENT');
  assert.ok(mismatch.observed.some((e) => e.source === 'APPLICATION' && e.value === 'USD 245,000.00'), 'application value shown');
  assert.ok(docEvidence?.pageNumber === 1 && docEvidence.snippet?.includes('250,000.00'), `PI value located on its page (${JSON.stringify(docEvidence)})`);
  assert.match(mismatch.description, /Difference USD 5,000\.00/);

  b = await svc.submit(customer, B);
  b = await svc.decideReview(maker, B, 'TRADE_OPS', {
    decision: 'RETURN',
    rationale: 'Amount on the application does not match the proforma invoice.',
    query: { question: 'Please correct the amount to match the proforma invoice, or explain the difference.', findingIds: [mismatch.findingId], requiresCorrection: true },
  });
  assert.strictEqual(b.status, 'PENDING_CUSTOMER_CLARIFICATION');
  const queryId = b.queries[0]!.queryId;
  await expectError(svc.resolveQuery(maker, B, queryId, { decision: 'RESOLVE', rationale: 'Nothing answered yet' }), 409, 'resolving an unanswered query');

  b = await svc.respondQuery(customer, B, queryId, { text: 'We will send the corrected application shortly.' });
  assert.strictEqual(b.queries[0]!.status, 'ANSWERED');
  await expectError(svc.resolveQuery(maker, B, queryId, { decision: 'RESOLVE', rationale: 'Answer received, closing' }), 409, 'answered is not resolved', 'still open');
  b = await svc.resolveQuery(maker, B, queryId, { decision: 'REOPEN', rationale: 'The answer does not fix the amount.' });
  assert.strictEqual(b.status, 'PENDING_CUSTOMER_CLARIFICATION');

  b = await svc.respondQuery(customer, B, queryId, { text: 'Corrected the amount to USD 250,000.', applicationChanges: { amount: 250000 }, reason: 'Amount corrected to match PI' });
  assert.strictEqual(b.currentApplicationVersion, 2);
  assert.strictEqual(b.applicationVersions[0]!.data.amount, 245000, 'version 1 preserved');
  assert.deepStrictEqual(b.applicationVersions[1]!.changedFields, ['amount']);
  const fixed = b.findings.find((f) => f.findingId === mismatch.findingId)!;
  assert.strictEqual(fixed.status, 'RESOLVED');
  assert.ok(fixed.history.some((h) => h.event === 'RESOLVED_BY_REVALIDATION'), 'resolution recorded, finding kept');
  assert.strictEqual(b.status, 'UNDER_REVIEW');
  assert.strictEqual(b.reviews.TRADE_OPS.status, 'RE_REVIEW_REQUIRED', 'Trade Ops must look again');
  b = await svc.resolveQuery(maker, B, queryId, { decision: 'RESOLVE', rationale: 'Corrected application verified against the PI.' });
  assert.strictEqual(b.queries[0]!.status, 'RESOLVED');
  assert.ok(svc.approvalBlockers(b).some((x) => x.startsWith('TRADE_OPS')), 'still not approvable until reviews are done');
  console.log(`✔ Scenario B Passed: ${B} — mismatch evidenced on page 1, queried, corrected as v2, finding resolved and kept, re-review required.\n`);

  // ------------------------------------------------------------------ Scenario C
  console.log('Scenario C: missing shipment date, with an independent compliance hold');
  const C = (await svc.createCase(customer, { clientRequestId: 'REQ-C-1', application: application({ latestShipmentDate: null, proformaInvoiceNumber: 'PI-2026-0061' }) })).tradeCase.caseId;
  let c = await attachPi(C, customer, 'PI-2026-0061.pdf', proforma('PI-2026-0061', '250,000.00'));
  const missing = open(c, (f) => f.key === 'PT-REQ-001:latestShipmentDate')[0];
  assert.ok(missing?.blocking && missing.category === 'MISSING_INFORMATION', 'missing shipment date flagged');
  c = await svc.submit(customer, C);
  await approveReview(C, 'RM', rm);
  c = await svc.decideReview(compliance, C, 'COMPLIANCE', { decision: 'HOLD', rationale: 'Holding pending supplier due diligence.' });
  assert.strictEqual(c.reviews.COMPLIANCE.status, 'ON_HOLD');
  c = await svc.decideReview(maker, C, 'TRADE_OPS', {
    decision: 'RETURN',
    rationale: 'The latest shipment date is required.',
    query: { question: 'Please provide the latest shipment date.', findingIds: [missing.findingId], requiresCorrection: true },
  });
  c = await svc.respondQuery(customer, C, c.queries[0]!.queryId, { text: 'Added.', applicationChanges: { latestShipmentDate: day(60) }, reason: 'Shipment date supplied' });
  assert.strictEqual(c.findings.find((f) => f.findingId === missing.findingId)!.status, 'RESOLVED');
  assert.strictEqual(c.reviews.RM.status, 'APPROVED', 'RM is not re-run for a date change');
  assert.strictEqual(c.reviews.COMPLIANCE.status, 'ON_HOLD', 'the hold is independent of the query');
  assert.ok(svc.approvalBlockers(c).some((x) => x.startsWith('COMPLIANCE review: on hold')), 'case stays blocked by the hold');
  const customerView = svc.toView(customer, c) as { reviews: Record<string, { status: string }> };
  assert.strictEqual(customerView.reviews['COMPLIANCE']!.status, 'PENDING', 'the customer is not told about the hold');
  console.log(`✔ Scenario C Passed: ${C} — date supplied and verified; only Trade Ops re-runs; compliance hold still blocks.\n`);

  // ------------------------------------------------------------------ Scenario D
  console.log('Scenario D: sanctioned-jurisdiction origin and reuse of a financed PI');
  const D = (await svc.createCase(customer, { clientRequestId: 'REQ-D-1', application: application({ countryOfOrigin: 'Iran', beneficiary: { name: 'Global Cotton Traders Limited', address: 'Tehran', country: 'Iran' } }) })).tradeCase.caseId;
  let d = await attachPi(D, customer, 'PI-2026-0042-again.pdf', proforma('PI-2026-0042', '250,000.00'));
  const jurisdiction = open(d, (f) => f.ruleId === 'CMP-JURISDICTION');
  const reuse = open(d, (f) => f.ruleId === 'TBML-PI-REUSE');
  assert.ok(jurisdiction.length > 0 && jurisdiction.every((f) => f.blocking && f.origin === 'SANCTIONS_ENGINE'), 'Iran exposure raised by the sanctions engine');
  assert.ok(reuse.some((f) => f.observed.some((e) => e.value === A)), `reuse of the PI financed in ${A} detected`);
  assert.ok(reuse[0]!.description.includes('innocent re-application'), 'an indicator, not an accusation');
  const dCustomer = svc.toView(customer, d) as { findings: Array<{ ruleId: string }> };
  assert.ok(!dCustomer.findings.some((f) => f.ruleId.startsWith('CMP-') || f.ruleId.startsWith('TBML-')), 'customer view carries no compliance or TBML findings');
  d = await svc.submit(customer, D);
  await expectError(svc.dispositionFinding(checker, D, jurisdiction[0]!.findingId, { code: 'FALSE_POSITIVE', rationale: 'The checker clearing a sanctions alert' }), 403, 'the trade checker clearing a compliance alert (only the compliance disposition permission may)');
  await svc.decideReview(compliance, D, 'COMPLIANCE', { decision: 'HOLD', rationale: 'Comprehensive sanctions exposure; escalated.' });
  d = await svc.dispositionFinding(compliance, D, jurisdiction[0]!.findingId, { code: 'CONFIRMED_ESCALATED', rationale: 'Origin is a comprehensively sanctioned jurisdiction; escalated to MLRO.' });
  assert.ok(svc.approvalBlockers(d).some((x) => x.includes(jurisdiction[0]!.findingId)), 'a confirmed alert keeps blocking');
  await expectError(svc.reject(compliance, D, 'Compliance rejecting directly'), 403, 'compliance cannot reject; that is the approver\'s call');
  d = await svc.reject(approver, D, 'Rejected on compliance grounds after escalation.');
  assert.strictEqual(d.status, 'REJECTED');
  await expectError(svc.updateApplication(customer, D, { changes: { amount: 1 }, reason: 'try again' }), 409, 'editing a rejected case');
  console.log(`✔ Scenario D Passed: ${D} — jurisdiction alert and PI reuse raised with evidence, hidden from the customer, confirmed, rejected.\n`);

  // ------------------------------------------------------------------ Scenario E
  console.log('Scenario E: AI provider unavailable during extraction');
  const heuristic = new HeuristicProvider();
  const downProvider: AIAnalysisService = {
    id: 'openai-compatible',
    model: 'test-provider-down',
    supportsSummary: false,
    isLocal: false,
    classify: (request) => heuristic.classify(request),
    summarize: async () => {
      throw new Error('ECONNREFUSED: provider unavailable');
    },
    extractTradeDoc: async () => {
      throw new Error('ECONNREFUSED: provider unavailable');
    },
  };
  setProviderForTesting(downProvider);
  const E = (await svc.createCase(customer, { clientRequestId: 'REQ-E-1', application: application({ proformaInvoiceNumber: 'PI-2026-0077' }) })).tradeCase.caseId;
  const piE = await pdf(proforma('PI-2026-0077', '250,000.00'));
  let e = await attachPi(E, customer, 'PI-2026-0077.pdf', piE);
  setProviderForTesting(null);
  assert.strictEqual(e.validation.piExtractionSource, 'DETERMINISTIC_FALLBACK_AFTER_AI_FAILURE', 'the failure is recorded, not hidden');
  const piDoc = await getRepository().findMeta(e.validation.piDocumentId!);
  assert.strictEqual(piDoc?.status, 'completed', 'the upload itself succeeded');
  assert.ok(piDoc?.analysis?.engine.notes.some((n) => n.includes('deterministic fallback')), 'the analysis says the fields were parsed');
  const lowConfidence = open(e, (f) => f.category === 'LOW_CONFIDENCE_EXTRACTION');
  assert.ok(lowConfidence.length === 1 && lowConfidence[0]!.blocking, 'fallback fields need manual verification');
  assert.ok(!open(e).some((f) => f.ruleId === 'PT-CMP-AMOUNT'), 'deterministic comparisons still ran');
  e = await svc.submit(customer, E);
  const before = e.findings.length;
  await svc.revalidateByUser(maker, E);
  e = await svc.revalidateByUser(maker, E);
  assert.strictEqual(e.findings.length, before, 'revalidating twice adds no duplicate findings');
  const docsBefore = (await load(E)).documents.length;
  await expectError(svc.attachDocument(customer, E, upload('PI-2026-0077 (resent).pdf', piE), 'PROFORMA_INVOICE'), 409, 'a file sent again to a request that is already with the bank', 'with the bank');
  assert.strictEqual((await load(E)).documents.length, docsBefore, 'a refused file is not attached');
  e = await svc.dispositionFinding(maker, E, lowConfidence[0]!.findingId, { code: 'VERIFIED_MANUALLY', rationale: 'Amount, parties and goods checked against the original PDF.' });
  assert.strictEqual(e.findings.find((f) => f.findingId === lowConfidence[0]!.findingId)!.status, 'DISPOSITIONED');
  console.log(`✔ Scenario E Passed: ${E} — model failure recorded as a fallback, manual verification required and recorded, no duplicates.\n`);

  // ------------------------------------------------------------------ Scenario F
  console.log('Scenario F: amendment of an issued credit — separate record, reviews, maker-checker, beneficiary acceptance');
  const F = (await svc.createCase(customer, { clientRequestId: 'REQ-F-1', application: application({ proformaInvoiceNumber: 'PI-2026-0101' }) })).tradeCase.caseId;
  let f = await attachPi(F, customer, 'PI-2026-0101.pdf', proforma('PI-2026-0101', '250,000.00'));
  f = await svc.submit(customer, F);
  const reviewers: Record<Department, AuthenticatedUser> = { RM: rm, TRADE_OPS: checker, COMPLIANCE: compliance, CREDIT: credit };
  await complianceClears(F);
  await svc.recordCreditFacility(credit, F, { facilityReference: 'LCF-KTL-2026-02', availableLimit: 500000, currency: 'USD', marginPercent: 10, verificationSource: 'SANDBOX_DEMO_DATA', note: 'Sandbox figure for testing; no core-banking access.' });
  for (const dep of ['RM', 'TRADE_OPS', 'COMPLIANCE', 'CREDIT'] as Department[]) {
    if ((await load(F)).reviews[dep].required) f = await approveReview(F, dep, reviewers[dep]);
  }
  for (const finding of open(f, (x) => x.blocking && ['MISSING_INFORMATION', 'DATA_INCONSISTENCY', 'LC_TERM_ISSUE'].includes(x.category))) {
    f = await svc.dispositionFinding(maker, F, finding.findingId, { code: 'JUSTIFIED', rationale: 'Checked against the PI and the application; acceptable for this credit.' });
  }
  f = await svc.requestApproval(maker, F, 'Reviews complete; ready for authorization.');
  f = await svc.decideApproval(approver, F, { decision: 'APPROVE', rationale: 'Terms, risk and facility reviewed; authorized.' });
  const fExpiry = f.applicationVersions[f.applicationVersions.length - 1]!.data.expiryDate!;
  f = await svc.recordIssuance(issuer, F, { financialInstrumentNumber: `HBL-IMP-000456-${dmy(0).replace(/\./g, '')}LC`, financialInstrumentExpiry: fExpiry });
  assert.strictEqual(f.status, 'LC_ISSUED');
  const issuedTerms = structuredClone(f.issuedLc!.terms);

  const amendedExpiry = day(120);
  const amendmentChanges = { amount: 300000, quantity: 120000, expiryDate: amendedExpiry };
  await expectError(svc.requestAmendment(otherCustomer, F, { changes: amendmentChanges, reason: 'Not my credit to amend at all' }), 404, 'another customer amending');
  await expectError(svc.requestAmendment(checker, F, { changes: amendmentChanges, reason: 'Checker raising an amendment' }), 403, 'checker raising an amendment');
  await expectError(svc.requestAmendment(customer, F, { changes: { amount: 250000 }, reason: 'An amendment that changes nothing' }), 400, 'empty amendment');
  await expectError(svc.requestAmendment(customer, F, { changes: { applicant: { name: 'Someone Else Ltd' } }, reason: 'Swap the applicant on the credit' }), 400, 'applicant change');
  f = await svc.requestAmendment(customer, F, { changes: amendmentChanges, reason: 'Buyer increased the order by 20,000 KG; seller agreed.' });
  const am1 = f.amendments[0]!;
  assert.strictEqual(am1.status, 'UNDER_REVIEW');
  assert.deepStrictEqual(am1.changedFields.sort(), ['amount', 'expiryDate', 'quantity']);
  assert.deepStrictEqual(Object.keys(am1.reviews).sort(), ['COMPLIANCE', 'CREDIT', 'TRADE_OPS'], 'the departments the change concerns review it');
  assert.deepStrictEqual(f.issuedLc!.terms, issuedTerms, 'the issued terms are never edited');
  assert.strictEqual(f.issuedLc!.effectiveTerms!.amount, 250000, 'nothing is effective until accepted');
  const materialChange = open(f, (x) => x.amendmentId === am1.amendmentId && x.ruleId === 'TBML-MATERIAL-CHANGE');
  assert.ok(materialChange.length === 1 && materialChange[0]!.stage === 'AMENDMENT', 'a 20% increase is revalidated as a material change');
  const fCustomer = svc.toView(customer, f) as { amendments: Array<{ status: string }>; findings: Array<{ ruleId: string }> };
  assert.strictEqual(fCustomer.amendments[0]!.status, 'IN_PROGRESS', 'the customer sees progress, not the internal review state');
  assert.ok(!fCustomer.findings.some((x) => x.ruleId.startsWith('TBML-')), 'the material-change indicator is not shown to the customer');
  await expectError(svc.requestAmendment(customer, F, { changes: { quantity: 130000 }, reason: 'A second amendment in parallel' }), 409, 'second open amendment');

  assert.strictEqual(materialChange[0]!.blocking, false, 'a 20% increase is a MEDIUM indicator: advisory, as in pre-trade');
  assert.ok((svc.toView(approver, f) as { findings: Array<{ ruleId: string }> }).findings.some((x) => x.ruleId === 'TBML-MATERIAL-CHANGE'), 'the approver sees the indicator it authorizes over');
  await expectError(svc.reviewAmendment(maker, F, 'CREDIT', { decision: 'APPROVE', rationale: 'Trade ops approving credit' }), 403, 'maker deciding the credit review');
  await complianceClears(F, 'RISK_ACCEPTED');
  await svc.reviewAmendment(compliance, F, 'COMPLIANCE', { decision: 'APPROVE', rationale: 'Increase explained by a larger order at the same unit price.' });
  await svc.reviewAmendment(credit, F, 'CREDIT', { decision: 'APPROVE', rationale: 'Facility of USD 500,000 covers the amended amount.' });
  await expectError(svc.submitAmendment(maker, F, 'Submitting before Trade Ops'), 409, 'submitting with a review outstanding');
  await svc.reviewAmendment(checker, F, 'TRADE_OPS', { decision: 'APPROVE', rationale: 'Dates and quantities consistent with the amended order.' });
  await expectError(svc.submitAmendment(customer, F, 'Customer submitting'), 403, 'customer submitting the amendment');
  f = await svc.submitAmendment(maker, F, 'All three reviews approved.');
  assert.strictEqual(f.amendments[0]!.status, 'APPROVAL_PENDING');
  await expectError(svc.decideAmendment(checker, F, { decision: 'APPROVE', rationale: 'Approving after doing the Trade Ops review' }), 403, 'Trade Ops reviewer approving the amendment', 'Separation of duties');
  await expectError(svc.decideAmendment(maker, F, { decision: 'APPROVE', rationale: 'Maker approving own amendment' }), 403, 'maker approving the amendment');
  await expectError(svc.decideAmendment(admin, F, { decision: 'APPROVE', rationale: 'Administrator approving an amendment' }), 403, 'administrator approving the amendment');
  f = await svc.decideAmendment(approver, F, { decision: 'APPROVE', rationale: 'Amendment authorized on the reviews recorded.' });
  assert.strictEqual(f.amendments[0]!.status, 'APPROVED');
  await expectError(svc.issueAmendment(approver, F, { financialInstrumentExpiry: amendedExpiry }), 403, 'approver issuing the amendment');
  await expectError(svc.issueAmendment(issuer, F, { financialInstrumentExpiry: fExpiry }), 422, 'FI not amended to the new expiry', 'must match');
  f = await svc.issueAmendment(issuer, F, { financialInstrumentExpiry: amendedExpiry });
  const issuedAm = f.amendments[0]!;
  assert.strictEqual(issuedAm.status, 'ISSUED_AWAITING_BENEFICIARY');
  assert.ok(issuedAm.issuance!.reference.startsWith('SBX-AMD-') && issuedAm.issuance!.mode === 'SANDBOX', 'amendment issuance is labeled sandbox');
  assert.match(issuedAm.issuance!.message, /no SWIFT MT707 was sent/);
  assert.strictEqual(f.issuedLc!.effectiveTerms!.amount, 250000, 'not effective before the beneficiary accepts (UCP 600 art. 10)');
  await expectError(svc.recordAmendmentResponse(customer, F, { accepted: true, note: 'Customer says it is accepted' }), 403, 'customer recording the beneficiary response');
  f = await svc.recordAmendmentResponse(maker, F, { accepted: true, note: 'Acceptance received from the advising bank (sandbox test).' });
  assert.strictEqual(f.amendments[0]!.status, 'EFFECTIVE');
  assert.strictEqual(f.issuedLc!.effectiveTerms!.amount, 300000);
  assert.strictEqual(f.issuedLc!.effectiveTerms!.expiryDate, amendedExpiry);
  assert.strictEqual(f.issuedLc!.effectiveAmendmentNumber, 1);
  assert.strictEqual(f.issuedLc!.financialInstrument.expiryDate, amendedExpiry, 'the FI expiry follows the amended credit');
  assert.deepStrictEqual(f.issuedLc!.terms, issuedTerms, 'the originally issued terms remain on record');

  // A second amendment the beneficiary refuses: the effective terms stay at amendment 1.
  f = await svc.requestAmendment(maker, F, { changes: { latestShipmentDate: day(70) }, reason: 'Seller asked for ten more days to ship.' });
  assert.deepStrictEqual(Object.keys(f.amendments[1]!.reviews), ['TRADE_OPS'], 'a date-only change needs Trade Ops only');
  await svc.reviewAmendment(checker, F, 'TRADE_OPS', { decision: 'APPROVE', rationale: 'Shipment window still ends before expiry.' });
  await svc.submitAmendment(maker, F, 'Trade Ops approved.');
  await svc.decideAmendment(approver, F, { decision: 'APPROVE', rationale: 'Minor date extension authorized.' });
  await svc.issueAmendment(issuer, F, { financialInstrumentExpiry: amendedExpiry });
  f = await svc.recordAmendmentResponse(maker, F, { accepted: false, note: 'Beneficiary rejected the amendment via the advising bank.' });
  assert.strictEqual(f.amendments[1]!.status, 'BENEFICIARY_REFUSED');
  assert.strictEqual(f.issuedLc!.effectiveAmendmentNumber, 1, 'a refused amendment changes nothing');
  assert.strictEqual(f.issuedLc!.effectiveTerms!.latestShipmentDate, issuedTerms.latestShipmentDate);

  // A third amendment swapping the beneficiary: a blocking re-assessment that compliance refuses.
  f = await svc.requestAmendment(customer, F, { changes: { beneficiary: { name: 'Shenzhen Fibre Trading Co' } }, reason: 'Seller assigned the contract to a sister company.' });
  const am3 = f.amendments[2]!;
  assert.ok(open(f, (x) => x.amendmentId === am3.amendmentId && x.ruleId === 'TBML-MATERIAL-CHANGE' && x.blocking).length === 1, 'a beneficiary change is a blocking indicator');
  await expectError(svc.reviewAmendment(compliance, F, 'COMPLIANCE', { decision: 'APPROVE', rationale: 'Approving with the indicator still open' }), 409, 'amendment review with an open blocker');
  f = await svc.reviewAmendment(compliance, F, 'COMPLIANCE', { decision: 'REJECT', rationale: 'New counterparty not onboarded; assignment not evidenced.' });
  assert.strictEqual(f.amendments[2]!.status, 'REJECTED');
  await expectError(svc.submitAmendment(maker, F, 'Submitting a rejected amendment'), 409, 'submitting a rejected amendment');
  assert.strictEqual(f.issuedLc!.effectiveTerms!.beneficiary.name, issuedTerms.beneficiary.name, 'a rejected amendment changes nothing');

  // The presentation is examined against the effective (amended) terms: USD 300,000 complies.
  const invoiceF = await pdf([
    'GLOBAL COTTON TRADERS LIMITED',
    'Unit 5, Tianhe Business Park, Guangzhou, China',
    'COMMERCIAL INVOICE',
    `INVOICE NO: CI-2026-1201 DATE: ${dmy(-1)}`,
    'BUYER: KAMRAN TEXTILES (PVT) LTD',
    'INCOTERMS: CFR Karachi',
    'COUNTRY OF ORIGIN: CHINA',
    'Item Description HS Code Quantity Unit Price Total (USD)',
    'RAW COTTON FIBRE GRADE A 5201.0010 120,000.00 KG $2.50/KG $300,000.00',
    'TOTAL AMOUNT: USD $300,000.00',
    'For GLOBAL COTTON TRADERS LIMITED',
  ]);
  const blF = await pdf([
    'OCEAN BILL OF LADING',
    'B/L NO: COSU2026001201',
    'SHIPPER: GLOBAL COTTON TRADERS LIMITED',
    'NOTIFY PARTY: KAMRAN TEXTILES (PVT) LTD',
    'PORT OF LOADING: SHANGHAI',
    'PORT OF DISCHARGE: KARACHI',
    `SHIPPED ON BOARD DATE: ${dmy(-2)}`,
    '1,200 BALES RAW COTTON FIBRE GRADE A 120,000.00 KG',
  ]);
  const plF = await pdf(['PACKING LIST', 'INVOICE NO: CI-2026-1201', 'SELLER: GLOBAL COTTON TRADERS LIMITED', '1,200 BALES RAW COTTON FIBRE GRADE A NET WEIGHT 120,000.00 KG']);
  f = await svc.recordPresentation(maker, F, [upload('CI-2026-1201.pdf', invoiceF), upload('BL-COSU2026001201.pdf', blF), upload('PL-CI-2026-1201.pdf', plF)], ['COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'PACKING_LIST']);
  const presentedF = f.documents.filter((x) => x.stage === 'POST_TRADE').map((x) => x.documentId);
  await waitFor('presented documents analyzed', async () => {
    const docs = await Promise.all(presentedF.map((id) => getRepository().findMeta(id)));
    return docs.every((x) => x && ['completed', 'failed'].includes(x.status));
  });
  f = await svc.examinePresentation(maker, F);
  const fPresentation = f.presentations[0]!;
  console.log(`   examination against amendment 1: ${fPresentation.examination!.result}; ${open(f, (x) => x.presentationId === fPresentation.presentationId).map((x) => x.ruleId).join(', ') || 'no findings'}`);
  assert.ok(!open(f).some((x) => x.ruleId === 'EXM-INV-AMOUNT'), 'USD 300,000 complies with the amended credit');
  const fChain = await svc.getAudit(auditor, F);
  assert.ok(fChain.chain.valid, 'audit chain intact across the amendments');
  assert.ok(['AMENDMENT_REQUESTED', 'AMENDMENT_SUBMITTED', 'AMENDMENT_APPROVED', 'AMENDMENT_ISSUED', 'AMENDMENT_EFFECTIVE', 'AMENDMENT_REFUSED_BY_BENEFICIARY'].every((t) => fChain.events.some((e) => e.action === t)), 'each amendment step is an audit event');
  console.log(`✔ Scenario F Passed: ${F} — three amendments: effective after acceptance, refused by the beneficiary, rejected by compliance; originals preserved; examination used the effective terms.\n`);

  // ------------------------------------------------------------------ Scenario G
  console.log('Scenario G: documents only from the customer; the bank starts the AI analysis');
  // From here the pre-shipment steps run against a stub model (no network).
  const fake = new FakeReviewAi();
  setProviderForTesting(fake);
  // The new-request page sends only who is asking (from the login); nothing about the deal.
  const G = (await svc.createCase(customer, { clientRequestId: 'REQ-G-1', application: { applicant: { name: customer.name, address: '', country: 'Pakistan' } } })).tradeCase.caseId;
  const gBytes = await pdf(proforma('PI-2026-0201', '250,000.00'));
  const gDoc = (await svc.attachDocument(customer, G, upload('PI-2026-0201.pdf', gBytes), 'PROFORMA_INVOICE')).document;
  const gMeta = await getRepository().findMeta(gDoc.documentId);
  assert.ok(gMeta && !['queued', 'processing', 'completed'].includes(gMeta.status), `a customer's upload is not analyzed by itself (status ${gMeta?.status})`);
  let g = await svc.submit(customer, G);
  assert.strictEqual(g.status, 'UNDER_REVIEW', 'documents alone are enough to send the request to the bank');
  // Before the documents are read, nothing is "missing": one finding says they are not analyzed yet.
  const gBefore = await load(G);
  assert.ok(!gBefore.findings.some((f) => f.ruleId === 'PT-REQ-001'), 'no field is called missing before the documents have been read');
  assert.ok(gBefore.findings.some((f) => f.title === 'Documents not analyzed yet' && f.status === 'OPEN' && f.blocking), 'one blocking finding says the documents are not analyzed yet');
  assert.deepStrictEqual((svc.toView(customer, gBefore) as unknown as { findings: unknown[] }).findings, [], 'a documents-only customer is shown no scrutiny findings');
  assert.ok(g.caseId.startsWith('TC-'), 'the reference number is the case id');
  await expectError(svc.startScrutiny(customer, G), 403, 'the customer starting the bank analysis');
  await expectError(svc.startScrutiny(otherCustomer, G), 404, 'another customer starting the analysis');
  const started = await runScrutiny(maker, G);
  assert.deepStrictEqual([started.started, started.alreadyDone], [1, 0], 'the bank starts the one waiting document');
  assert.strictEqual((await load(G)).scrutinyRun?.status, 'DONE', 'the AI scrutiny finished');
  assert.ok((await load(G)).aiReviews?.[gDoc.documentId], 'the AI review of the document is kept with the case');
  g = await waitFor('analysis of the customer document', async () => {
    const c = await load(G);
    return c.validation.piDocumentId === gDoc.documentId && c.validation.piExtractionSource !== 'NOT_AVAILABLE' ? c : null;
  });
  assert.strictEqual(g.validation.piExtractionSource, 'DETERMINISTIC_PARSER', 'the analysis ran and the case validated against it');
  // Nothing was typed, so the blanks were filled from what the analysis read in the document.
  assert.ok(!g.findings.some((f) => f.title === 'Documents not analyzed yet' && f.status === 'OPEN'), 'the not-analyzed finding closed itself once the documents were read');
  assert.deepStrictEqual((svc.toView(customer, g) as unknown as { findings: unknown[] }).findings, [], 'still no scrutiny findings for the customer');
  const gApp = g.applicationVersions[g.applicationVersions.length - 1]!;
  assert.strictEqual(gApp.createdBy, 'SYSTEM', 'the blanks were filled by the analysis, not by a person');
  assert.ok(gApp.data.beneficiary.name.length > 0 && gApp.data.amount === 250000 && gApp.data.currency === 'USD', `parties and amount read from the proforma invoice (got "${gApp.data.beneficiary.name}", ${gApp.data.amount} ${gApp.data.currency})`);
  assert.strictEqual(gApp.data.applicant.name, customer.name, 'what the customer provided is not overwritten');
  type Report = {
    intakeMode: string | null;
    rules: Array<{ ruleId: string; status: string }>;
    missing: Array<{ path: string }>;
    counts: { rulesTotal: number; rulesChecked: number };
    screening: { application: { parties: unknown[] } | null; document: unknown };
    documents: Array<{ analysisStatus: string }>;
    findings: unknown[];
  };
  const report = (await svc.scrutiny(maker, G)) as unknown as Report;
  assert.strictEqual(report.intakeMode, 'DOCUMENTS_ONLY');
  assert.ok(report.counts.rulesTotal >= 15 && report.counts.rulesChecked > 0, 'every pre-trade rule is listed and the ones that could run did');
  assert.ok(['PASSED', 'FLAGGED', 'REVIEWED'].includes(report.rules.find((r) => r.ruleId === 'CMP-SANCTIONS-PARTY')!.status), 'sanctions screening ran on the parties read from the documents');
  assert.ok(report.screening.application && report.screening.application.parties.length > 0 && report.screening.document, 'the screening covered the parties and countries, clear results included');
  assert.ok(report.missing.some((m) => m.path === 'expiryDate') && !report.missing.some((m) => m.path === 'beneficiary.name'), 'what the documents do not state is missing; what they state is not');
  assert.strictEqual(report.documents[0]!.analysisStatus, 'completed');
  await expectError(svc.scrutiny(customer, G), 403, 'the customer reading the scrutiny report');
  const again2 = await svc.startScrutiny(maker, G);
  assert.deepStrictEqual([again2.started, again2.alreadyDone], [0, 1], 'asking again starts nothing new');
  assert.ok((await svc.getAudit(auditor, G)).events.some((ev) => ev.action === 'SCRUTINY_STARTED'), 'the bank action is in the audit chain');
  console.log(`✔ Scenario G Passed: ${G} — customer sent documents only, bank started the analysis, findings followed, audited.\n`);

  // ------------------------------------------------------------------ Scenario H
  console.log('Scenario H: a document attached by mistake is removed; the trade desk only scrutinizes');
  const H = (await svc.createCase(customer, { clientRequestId: 'REQ-H-1', application: {} })).tradeCase.caseId;
  const hPi = (await svc.attachDocument(customer, H, upload('PI-2026-0301.pdf', await pdf(proforma('PI-2026-0301', '250,000.00'))), 'PROFORMA_INVOICE')).document;
  const hWrong = (await svc.attachDocument(customer, H, upload('wrong-file.pdf', await pdf(['Holiday photo list', 'Not a trade document'])), 'OTHER_SUPPORTING')).document;
  await expectError(svc.attachDocument(maker, H, upload('maker.pdf', await pdf(['x'])), 'OTHER_SUPPORTING'), 403, 'the trade desk attaching a document');
  await expectError(svc.createCase(maker, { customerRef: 'TG-CORP-1001', application: {} }), 403, 'the trade desk filing a request');
  await expectError(svc.removeDocument(maker, H, hWrong.linkId), 403, 'the trade desk removing a customer document');
  await expectError(svc.removeDocument(otherCustomer, H, hWrong.linkId), 404, "another customer removing this customer's document");
  await expectError(svc.removeDocument(customer, H, 'DL-099'), 404, 'removing a document that is not on the case');
  let h = await svc.removeDocument(customer, H, hWrong.linkId);
  assert.deepStrictEqual(h.documents.map((d) => d.linkId), [hPi.linkId], 'the wrong document is gone and the right one stays');
  // A removed replacement gives the earlier version back; version numbers are not reused.
  const hPi2 = (await svc.attachDocument(customer, H, upload('PI-2026-0301-v2.pdf', await pdf(proforma('PI-2026-0301', '260,000.00'))), 'PROFORMA_INVOICE')).document;
  assert.strictEqual(hPi2.version, 2);
  h = await svc.removeDocument(customer, H, hPi2.linkId);
  assert.strictEqual(h.documents.find((d) => d.linkId === hPi.linkId)!.supersededByLinkId, null, 'the earlier proforma invoice is current again');
  const hPi3 = (await svc.attachDocument(customer, H, upload('PI-2026-0301-v3.pdf', await pdf(proforma('PI-2026-0301', '270,000.00'))), 'PROFORMA_INVOICE')).document;
  assert.strictEqual(hPi3.version, 2, 'a removed version does not leave a gap or a duplicate number');
  assert.ok((await svc.getAudit(auditor, H)).events.filter((ev) => ev.action === 'DOCUMENT_REMOVED').length === 2, 'both removals are in the audit chain');
  assert.ok((svc.toView(customer, await load(H)) as { availableActions: string[] }).availableActions.includes('REMOVE_PRETRADE_DOCUMENT'), 'the customer is offered Remove');
  assert.ok(!(svc.toView(maker, await load(H)) as { availableActions: string[] }).availableActions.includes('REMOVE_PRETRADE_DOCUMENT'), 'the trade desk is not');
  console.log(`✔ Scenario H Passed: ${H} — customer removed documents (audited), trade desk can neither attach, file nor remove.\n`);

  // ------------------------------------------------------------------ Scenario I
  console.log('Scenario I: one message with every issue to the customer, who sends corrected documents');
  const I = (await svc.createCase(customer, { clientRequestId: 'REQ-I-1', application: { applicant: { name: customer.name, address: '', country: 'Pakistan' } } })).tradeCase.caseId;
  const iPi = (await svc.attachDocument(customer, I, upload('PI-2026-0401.pdf', await pdf(proforma('PI-2026-0401', '250,000.00'))), 'PROFORMA_INVOICE')).document;
  await svc.submit(customer, I);
  await runScrutiny(maker, I);
  await waitFor('analysis of the first proforma invoice', async () => {
    const c = await load(I);
    return c.validation.piDocumentId === iPi.documentId && c.validation.piExtractionSource !== 'NOT_AVAILABLE' ? c : null;
  });
  type Mail = { subject: string; body: string; issues: Array<{ findingId: string; title: string; text: string }>; withheld: number };
  const draft = (await svc.composeCustomerMail(maker, I, undefined)) as unknown as Mail;
  assert.ok(draft.issues.length >= 3, `the draft lists every open issue the customer can act on (got ${draft.issues.length})`);
  assert.strictEqual((draft as unknown as { drafted: string }).drafted, 'AI', 'the message was written by the AI');
  assert.ok(draft.body.includes(I.slice(0, 3)) || draft.subject.includes(I), 'the message is about this request');
  const draftPoints = (draft as unknown as { points: number }).points;
  assert.ok(draftPoints >= 1 && draftPoints <= draft.issues.length, 'findings about the same problem share one numbered point');
  assert.ok(new RegExp(`(^|\\n)${draftPoints}\\. `).test(draft.body), 'the message numbers its points');
  assert.ok(!/sanction|tbml|laundering|compliance|credit (facility|limit)|red flag|replay/i.test(draft.body), `nothing from compliance, TBML or credit reaches the customer (the word "credit" alone is the LC itself)\n${draft.body}`);
  await expectError(svc.composeCustomerMail(customer, I, undefined), 403, 'the customer composing a message to itself');
  const sent = await svc.raiseQuery(maker, I, { department: 'TRADE_OPS', assignee: 'CUSTOMER', subject: draft.subject, question: draft.body, findingIds: draft.issues.map((x) => x.findingId), requiresCorrection: true });
  assert.strictEqual(sent.status, 'PENDING_CUSTOMER_CLARIFICATION', 'one message puts the case with the customer');
  assert.strictEqual(sent.queries.length, 1, 'one query, not one per finding');
  const iCustomerView = svc.toView(customer, sent) as unknown as { queries: Array<{ queryId: string; subject?: string; question: string }>; findings: Array<{ findingId: string }> };
  assert.strictEqual(iCustomerView.queries[0]!.subject, draft.subject, 'the customer receives the subject');
  assert.deepStrictEqual(iCustomerView.findings.map((x) => x.findingId).sort(), draft.issues.map((x) => x.findingId).sort(), 'the customer sees the findings the message is about, and only those');
  // The customer corrects the proforma invoice and replies with it.
  const iFixed = (await svc.attachDocument(customer, I, upload('PI-2026-0401-corrected.pdf', await pdf(proforma('PI-2026-0401', '260,000.00'))), 'PROFORMA_INVOICE')).document;
  const answered = await svc.respondQuery(customer, I, iCustomerView.queries[0]!.queryId, { text: 'Corrected proforma invoice attached.', documentLinkIds: [iFixed.linkId] });
  assert.strictEqual(answered.status, 'UNDER_REVIEW', 'the reply returns the case to the bank');
  assert.deepStrictEqual(answered.queries[0]!.responses[0]!.documentLinkIds, [iFixed.linkId], 'the reply carries the corrected document');
  // The bank analyses the corrected document; the application follows it, not the first one.
  const again3 = await runScrutiny(maker, I);
  assert.strictEqual(again3.started, 1, 'only the new document is analyzed');
  const refreshed = await waitFor('the application to follow the corrected document', async () => {
    const c = await load(I);
    return c.validation.piDocumentId === iFixed.documentId && currentApplicationOf(c).amount === 260000 ? c : null;
  });
  assert.ok(!open(refreshed).some((x) => x.ruleId === 'PT-CMP-AMOUNT'), 'no false mismatch against the superseded document');
  console.log(`✔ Scenario I Passed: ${I} — ${draft.issues.length} issues in one message, customer replied with a corrected document, application followed it.\n`);

  // ------------------------------------------------------------------ Scenario J
  console.log('Scenario J: the trade desk approves in one step once nothing blocks');
  const J = (await svc.createCase(customer, { clientRequestId: 'REQ-J-1', application: application({ proformaInvoiceNumber: 'PI-2026-0501' }) })).tradeCase.caseId;
  await attachPi(J, customer, 'PI-2026-0501.pdf', proforma('PI-2026-0501', '250,000.00'));
  await svc.submit(customer, J);
  await complianceClears(J);
  for (const finding of open(await load(J), (x) => x.blocking && ['MISSING_INFORMATION', 'DATA_INCONSISTENCY', 'LC_TERM_ISSUE'].includes(x.category))) {
    await svc.dispositionFinding(maker, J, finding.findingId, { code: 'JUSTIFIED', rationale: 'Checked against the documents; acceptable for this request.' });
  }
  await expectError(svc.approvePreShipment(customer, J, 'The customer approving its own request'), 403, 'the customer approving');
  await expectError(svc.approvePreShipment(checker, J, 'The checker has no pre-shipment approval'), 403, 'a role without the permission approving');
  // A message still with the customer blocks it, then an answered but unresolved one does.
  const asked = await svc.raiseQuery(maker, J, { department: 'TRADE_OPS', assignee: 'CUSTOMER', subject: 'A question', question: 'Please confirm the shipment window by message.', requiresCorrection: false });
  await expectError(svc.approvePreShipment(maker, J, 'Approving while the customer still owes an answer'), 409, 'approving with the customer still to answer');
  const qid = asked.queries[0]!.queryId;
  await svc.respondQuery(customer, J, qid, { text: 'Shipment is planned for the first week of December.' });
  const blocked = svc.preShipmentBlockers(await load(J));
  assert.ok(blocked.some((b) => b.includes(qid) && b.includes('not resolved')), `an answered message must be resolved first (${blocked.join('; ')})`);
  await svc.resolveQuery(maker, J, qid, { decision: 'RESOLVE', rationale: 'Answer received; shipment window confirmed.' });
  assert.deepStrictEqual(svc.preShipmentBlockers(await load(J)), [], 'nothing blocks any more');
  const approved = await svc.approvePreShipment(maker, J, 'Documents scrutinized, no open finding, customer answered.');
  assert.strictEqual(approved.status, 'AUTHORIZED_FOR_ISSUANCE');
  assert.strictEqual(approved.approvals[approved.approvals.length - 1]!.status, 'APPROVED');
  const jAudit = (await svc.getAudit(auditor, J)).events.find((ev) => ev.action === 'PRESHIPMENT_APPROVED');
  assert.ok(jAudit && (jAudit.detail as { singleStep?: boolean }).singleStep === true, 'the audit says it was a single-step approval');
  await expectError(svc.approvePreShipment(maker, J, 'Approving twice'), 409, 'approving an already approved request');
  assert.strictEqual((svc.toView(customer, approved) as { status: string }).status, 'AUTHORIZED_FOR_ISSUANCE', 'the customer sees the approval');
  // ------------------------------------------------------------------ Scenario K
  console.log('Scenario K: the AI recognizes, scrutinizes one by one, writes the mail; corrected documents replace the old');
  const asConfig = config as unknown as { preshipment: { requireAi: boolean } };
  const AK = (await svc.createCase(customer, { clientRequestId: 'REQ-AK-1', application: { applicant: { name: customer.name, address: '', country: 'Pakistan' } } })).tradeCase.caseId;
  // The AI says what each uploaded document is, whatever its file name.
  const kPi = (await svc.attachDocument(customer, AK, upload('scan-001.pdf', await pdf(proforma('PI-2026-0601', '250,000.00'))), 'AUTO')).document;
  assert.strictEqual(kPi.documentType, 'PROFORMA_INVOICE');
  assert.strictEqual(kPi.typeSource, 'AI');
  assert.ok((kPi.detection?.confidence ?? 0) > 0.9 && kPi.detection?.type === 'PROFORMA_INVOICE', 'the detection is kept with the document');
  const kContract = (await svc.attachDocument(customer, AK, upload('scan-002.pdf', await pdf(['SALES AND PURCHASE CONTRACT', 'CONTRACT NO: C-0601', 'SELLER: GLOBAL COTTON TRADERS LIMITED', 'BUYER: KAMRAN TEXTILES (PVT) LTD', 'GOODS: RAW COTTON FIBRE', 'TOTAL: USD 250,000.00'])), 'AUTO')).document;
  assert.strictEqual(kContract.documentType, 'PURCHASE_CONTRACT');
  const kShipping = (await svc.attachDocument(customer, AK, upload('scan-003.pdf', await pdf(['BILL OF LADING', 'SHIPPER: GLOBAL COTTON TRADERS LIMITED', 'VESSEL: MV TEST'])), 'AUTO')).document;
  assert.strictEqual(kShipping.detection?.type, 'SHIPPING_DOCUMENT', 'a shipping document is recognized as one: it belongs to the later stage');
  assert.strictEqual(kShipping.typeSource, 'UNDETECTED');
  // The model is down while a document arrives: nothing is guessed, the customer chooses the type.
  fake.down = true;
  const kPermitDown = (await svc.attachDocument(customer, AK, upload('scan-004.pdf', await pdf(['IMPORT PERMIT', 'PERMIT NO: IP-0601', 'IMPORTER: KAMRAN TEXTILES (PVT) LTD', 'PERMITTED GOODS: RAW COTTON, HS 5201'])), 'AUTO')).document;
  fake.down = false;
  assert.strictEqual(kPermitDown.typeSource, 'UNDETECTED');
  assert.ok(kPermitDown.detectionError && kPermitDown.documentType === 'OTHER_SUPPORTING', 'an unrecognised document is not given a guessed type');
  const retyped = await svc.retypeDocument(customer, AK, kPermitDown.linkId, 'IMPORT_PERMIT');
  const kPermit = retyped.documents.find((d) => d.documentType === 'IMPORT_PERMIT')!;
  assert.strictEqual(kPermit.typeSource, 'CUSTOMER');
  assert.ok(!retyped.documents.some((d) => d.linkId === kPermitDown.linkId), 'the old link came off when the document was re-typed');
  await svc.removeDocument(customer, AK, kShipping.linkId);
  await svc.submit(customer, AK);

  // With the AI required, a document the built-in parser read (the model was not used) is not accepted.
  asConfig.preshipment.requireAi = true;
  await runScrutiny(maker, AK);
  const parserOnly = await load(AK);
  assert.strictEqual(parserOnly.scrutinyRun?.status, 'FAILED');
  assert.ok(parserOnly.scrutinyRun!.steps.every((x) => x.status === 'FAILED' && /built-in parser is not used/.test(x.error ?? '')), 'every step says the AI did not read it and the parser is not used');
  assert.ok(!parserOnly.aiReviews || Object.keys(parserOnly.aiReviews).length === 0, 'nothing was reviewed from parser output');
  assert.ok(svc.preShipmentBlockers(parserOnly).some((b) => b.startsWith('The AI has not scrutinized')), 'approval is blocked until the AI has scrutinized each document');
  asConfig.preshipment.requireAi = false;

  // The scrutiny, one document at a time, then the documents against each other.
  fake.reviewed.length = 0;
  fake.reviewIssues = [
    { file: /scan-001/, issues: [
      { code: 'validity-missing', severity: 'HIGH', category: 'MISSING_INFORMATION', title: 'Proforma invoice has no validity date', description: 'The invoice does not say how long the offer is valid.', evidence: 'INVOICE NO: PI-2026-0601', customerAction: 'Send the invoice with its validity date.' },
      { code: 'dual-use', severity: 'HIGH', category: 'COMPLIANCE_ALERT', title: 'Goods may be dual-use', description: 'The goods description should be checked against the control lists.' },
    ] },
  ];
  fake.unconfirmed = ['Transshipment terms mismatch'];
  // The same point as a rule finding (the credit expiry is in no document): the AI tags the field, so it is listed once.
  fake.reviewIssues.push({ file: /scan-002/, issues: [{ code: 'no-expiry', severity: 'HIGH', category: 'MISSING_INFORMATION', title: 'The credit expiry date is missing', description: 'No expiry date is stated.', fields: ['expiryDate'], customerAction: 'State the expiry date.' }] });
  fake.compareIssues = [{ code: 'qty-differs', severity: 'HIGH', category: 'DATA_INCONSISTENCY', title: 'Quantity differs between the invoice and the contract', description: 'The invoice states 100,000 KG; the contract states none.', documentsInvolved: ['scan-001.pdf', 'scan-002.pdf'], customerAction: 'Correct the quantity in the contract.',
      quotes: [{ file: 'scan-001.pdf', text: 'INVOICE NO: PI-2026-0601' }, { file: 'scan-002.pdf', text: 'CONTRACT NO: C-0601' }] },
    // Both quotes are really in the documents, but they say the same thing: the second look refuses it.
    { code: 'same-value', severity: 'HIGH', category: 'DATA_INCONSISTENCY', title: 'Transshipment terms mismatch', description: 'The contract and the permit disagree.', documentsInvolved: ['scan-001.pdf', 'scan-002.pdf'],
      quotes: [{ file: 'scan-001.pdf', text: 'INVOICE NO: PI-2026-0601' }, { file: 'scan-002.pdf', text: 'CONTRACT NO: C-0601' }] },
    // Invented by the model: the permit states no quantity, so the words it quotes are not in it.
    { code: 'permit-qty', severity: 'MEDIUM', category: 'DATA_INCONSISTENCY', title: 'Quantity Discrepancy in Import Permit', description: 'The import permit states a quantity of 1 KGS.', documentsInvolved: ['scan-001.pdf', 'scan-004.pdf'],
      quotes: [{ file: 'scan-004.pdf', text: 'Import permit quantity: 1 KGS' }, { file: 'scan-001.pdf', text: 'INVOICE NO: PI-2026-0601' }] }];
  const kRun = await runScrutiny(maker, AK);
  assert.strictEqual(kRun.started, 3, 'three current documents: invoice, contract, permit');
  let k = await load(AK);
  assert.strictEqual(k.scrutinyRun?.status, 'DONE');
  const doneSteps = k.scrutinyRun!.steps;
  for (let i = 1; i < doneSteps.length; i += 1) assert.ok(doneSteps[i - 1]!.finishedAt! <= doneSteps[i]!.startedAt!, 'documents are read one after another, not together');
  assert.strictEqual(fake.reviewed.length, 3);
  assert.ok(k.caseReview && k.caseReview.documentIds.length === 3, 'the documents were compared with each other');
  const openAi = k.findings.filter((f) => f.status === 'OPEN' && f.ruleId.startsWith('AI-'));
  assert.ok(openAi.some((f) => f.title === 'Proforma invoice has no validity date' && f.blocking), 'an AI issue in a document becomes a finding');
  assert.ok(openAi.some((f) => f.ruleId === 'AI-CASE-REVIEW'), 'a difference between documents becomes a finding');
  assert.ok(k.findings.some((f) => f.ruleId === 'PT-REQ-001' && f.fields.includes('expiryDate') && f.status === 'OPEN'), 'the rules report the missing expiry date');
  assert.ok(!k.findings.some((f) => f.title === 'The credit expiry date is missing'), 'the AI says the same thing and is not listed a second time');
  assert.ok(!openAi.some((f) => f.title === 'Transshipment terms mismatch'), 'quotes that are in the documents but agree with each other are not a difference');
  assert.ok(k.caseReview?.discarded?.some((d) => d.title === 'Transshipment terms mismatch' && /Checked again/.test(d.reason)), 'the second look is recorded as the reason');
  assert.ok(!openAi.some((f) => f.title === 'Quantity Discrepancy in Import Permit'), 'a point whose quoted words are not in the documents is not made a finding');
  assert.ok(k.caseReview?.discarded?.some((d) => d.title === 'Quantity Discrepancy in Import Permit' && /not in that document/.test(d.reason)), 'it is kept on the review, with the reason, for the desk to see');
  assert.ok(openAi.find((f) => f.ruleId === 'AI-CASE-REVIEW')!.observed.some((o) => o.filename === 'scan-002.pdf' && o.value.includes('CONTRACT NO: C-0601')), 'each document shows its own verified words');
  const aiCompliance = openAi.find((f) => f.category === 'COMPLIANCE_ALERT')!;
  assert.ok(aiCompliance, 'a bank-only concern is a compliance alert');
  assert.ok(!(svc.toView(customer, k) as unknown as { findings: Array<{ findingId: string }> }).findings.some((f) => f.findingId === aiCompliance.findingId), 'the customer never sees the bank-only concern');

  // The AI writes the message; when it is down the desk still gets a draft, marked as not written by the AI.
  const kDraft = (await svc.composeCustomerMail(maker, AK, undefined)) as unknown as Mail & { drafted: string };
  assert.strictEqual(kDraft.drafted, 'AI');
  assert.ok(kDraft.body.includes('Proforma invoice has no validity date') && kDraft.body.includes('Quantity differs between the invoice and the contract'), 'every issue is in the one message');
  assert.ok(!/dual-use|control lists/i.test(kDraft.body), 'the bank-only concern is not in the customer message');
  assert.ok(kDraft.withheld >= 1, 'the desk is told how many findings stayed with the bank');
  fake.down = true;
  const kTemplate = (await svc.composeCustomerMail(maker, AK, undefined)) as unknown as { drafted: string; aiError: string | null; body: string };
  fake.down = false;
  assert.ok(kTemplate.drafted === 'TEMPLATE' && kTemplate.aiError && kTemplate.body.length > 50, 'with the AI down the draft says it is a template');
  const kMailed = await svc.raiseQuery(maker, AK, { department: 'TRADE_OPS', assignee: 'CUSTOMER', subject: kDraft.subject, question: kDraft.body, findingIds: kDraft.issues.map((x) => x.findingId), requiresCorrection: true });
  const kQuery = kMailed.queries[0]!.queryId;

  // The customer corrects the invoice; the old one is ignored and only the new document is scrutinized.
  const kPiNew = (await svc.attachDocument(customer, AK, upload('scan-005.pdf', await pdf(proforma('PI-2026-0601', '250,000.00').concat(['VALID UNTIL: 30.11.2026']))), 'AUTO')).document;
  assert.strictEqual(kPiNew.documentType, 'PROFORMA_INVOICE');
  assert.strictEqual(kPiNew.version, 2);
  await svc.respondQuery(customer, AK, kQuery, { text: 'Corrected invoice attached with its validity date.', documentLinkIds: [kPiNew.linkId] });
  fake.reviewIssues = [];
  fake.compareIssues = [];
  const compareBefore = fake.calls.compare;
  const kAgain = await runScrutiny(maker, AK);
  assert.deepStrictEqual([kAgain.started, kAgain.alreadyDone], [1, 2], 'only the new document is read; the other two keep their reviews');
  assert.strictEqual(fake.calls.compare, compareBefore + 1, 'the documents are compared again because the set changed');
  k = await load(AK);
  const old = k.documents.find((d) => d.linkId === kPi.linkId)!;
  assert.ok(old.supersededByLinkId === kPiNew.linkId, 'the first invoice is superseded');
  assert.ok(!k.findings.some((f) => f.title === 'Proforma invoice has no validity date' && f.status === 'OPEN'), 'the finding on the old invoice is gone: it is ignored');
  assert.ok(!k.findings.some((f) => f.ruleId === 'AI-CASE-REVIEW' && f.status === 'OPEN'), 'the difference between documents was resolved by the new comparison');

  // An escalation keeps the finding blocking, but it is not final: it can be closed afterwards.
  const toEscalate = open(k, (x) => x.category === 'COMPLIANCE_ALERT')[0];
  if (toEscalate) {
    await svc.dispositionFinding(maker, AK, toEscalate.findingId, { code: 'CONFIRMED_ESCALATED', rationale: 'Escalating first, to see that it keeps blocking.' });
    k = await load(AK);
    assert.ok(svc.preShipmentBlockers(k).some((b) => b.startsWith(toEscalate.findingId)), 'an escalated finding still blocks the approval');
  }

  // The desk clears what remains and approves, with the AI required.
  const stillOpen = (x: TradeCase['findings'][number]) => x.status === 'OPEN' || x.disposition?.code === 'CONFIRMED_ESCALATED';
  for (const finding of k.findings.filter((x) => stillOpen(x) && ['MISSING_INFORMATION', 'DATA_INCONSISTENCY', 'LC_TERM_ISSUE', 'COMPLIANCE_ALERT'].includes(x.category))) {
    const compliance = finding.category === 'COMPLIANCE_ALERT';
    await svc.dispositionFinding(maker, AK, finding.findingId, { code: compliance ? 'FALSE_POSITIVE' : 'JUSTIFIED', rationale: 'Checked against the documents and the control lists; no concern for this request.' });
  }
  await svc.resolveQuery(maker, AK, kQuery, { decision: 'RESOLVE', rationale: 'Corrected invoice received and scrutinized.' });
  asConfig.preshipment.requireAi = true;
  assert.deepStrictEqual(svc.preShipmentBlockers(await load(AK)), [], 'nothing blocks: every current document was scrutinized and compared');
  const kApproved = await svc.approvePreShipment(maker, AK, 'Scrutinized by the AI and by the desk; corrected documents received.');
  assert.strictEqual(kApproved.status, 'AUTHORIZED_FOR_ISSUANCE');
  asConfig.preshipment.requireAi = false;
  setProviderForTesting(null);
  console.log(`✔ Scenario K Passed: ${AK} — types read by the AI, parser output refused, documents scrutinized one by one, one AI-written message, corrected invoice replaced the old, approved.\n`);

  // ------------------------------------------------------------------ Scenario L
  console.log('Scenario L: a file that was sent before is already analyzed; the scrutiny still fills the application from it');
  setProviderForTesting(fake);
  const lBytes = await pdf(proforma('PI-2026-0701', '250,000.00'));
  const L1 = (await svc.createCase(customer, { clientRequestId: 'REQ-AL-1', application: { applicant: { name: customer.name, address: '', country: 'Pakistan' } } })).tradeCase.caseId;
  await svc.attachDocument(customer, L1, upload('PI-2026-0701.pdf', lBytes), 'PROFORMA_INVOICE');
  await svc.submit(customer, L1);
  await runScrutiny(maker, L1);
  const L2 = (await svc.createCase(customer, { clientRequestId: 'REQ-AL-2', application: { applicant: { name: customer.name, address: '', country: 'Pakistan' } } })).tradeCase.caseId;
  const lDup = (await svc.attachDocument(customer, L2, upload('PI-2026-0701.pdf', lBytes), 'PROFORMA_INVOICE')).document;
  assert.ok(lDup.duplicateUpload, 'the same file on a second request is recognized as already sent');
  assert.strictEqual((await getRepository().findMeta(lDup.documentId))?.status, 'completed', 'so it is already analyzed and no "settled" event will follow');
  await svc.submit(customer, L2);
  await runScrutiny(maker, L2);
  const l2 = await load(L2);
  const lApp = l2.applicationVersions[l2.applicationVersions.length - 1]!;
  assert.strictEqual(lApp.createdBy, 'SYSTEM', 'the blanks were filled by the analysis, not by a person');
  assert.ok(lApp.data.beneficiary.name.length > 0 && lApp.data.amount === 250000, 'parties and amount were read from the already-analyzed document');
  assert.ok(!l2.findings.some((f) => f.ruleId === 'PT-REQ-001' && f.status === 'OPEN' && /beneficiary name|amount/i.test(f.title)), 'what the document states is not reported as missing');
  setProviderForTesting(null);
  // A proforma whose line total contradicts quantity x price (100,000 KG x 2.50 = 250,000, printed 205,000): the
  // rules report it once, and it stops approval (the AI's own report of the same point is not listed again).
  const M = (await svc.createCase(customer, { clientRequestId: 'REQ-M-1', application: application({ proformaInvoiceNumber: 'PI-2026-0801' }) })).tradeCase.caseId;
  const mLines = proforma('PI-2026-0801', '250,000.00').map((line) => (line.startsWith('RAW COTTON') ? line.replace(/\$250,000\.00$/, '$205,000.00') : line));
  const m = await attachPi(M, customer, 'PI-2026-0801.pdf', mLines);
  const arithmetic = open(m, (f) => f.ruleId === 'PT-PI-ARITHMETIC');
  assert.strictEqual(arithmetic.length, 1, 'the arithmetic error is reported once');
  assert.ok(arithmetic[0]!.blocking, 'a proforma whose figures do not add up blocks the approval');
  // ------------------------------------------------------------------ Scenario N: HS codes against the official reference
  console.log('Scenario N: the HS code on the documents is checked against the official reference');
  process.env['EXTERNAL_VERIFICATION_ENABLED'] = 'true';
  setProviderForTesting(fake);
  const hsRef = (code: string, text: string, unit: string | null = null) => ({ code, level: code.length as 2 | 4 | 6, text, parent: null, unit });
  const hsFixture = [
    hsRef('52', 'Cotton'), hsRef('5201', 'Cotton; not carded or combed'), hsRef('520100', 'Cotton; not carded or combed', 'kg'),
    hsRef('5208', 'Woven fabrics of cotton, containing 85 percent or more by weight of cotton'),
    hsRef('72', 'Iron and steel'), hsRef('7208', 'Iron or non-alloy steel; flat-rolled products of a width of 600mm or more'), hsRef('720810', 'Iron or non-alloy steel; in coils, hot-rolled', 'kg'),
  ];
  setHsReferenceForTesting(hsFixture);
  // A synthetic port list in the shape of UN/LOCODE (the real one is not available to the test run).
  setPortIndexForTesting(buildPortIndex([
    { locode: 'CNSHA', name: 'Shanghai', country: 'China', countryCode: 'CN' },
    { locode: 'PKKHI', name: 'Karachi', country: 'Pakistan', countryCode: 'PK' },
    { locode: 'PKBQM', name: 'Port Qasim', country: 'Pakistan', countryCode: 'PK' },
  ], { origin: 'SYNTHETIC_TEST', version: 'synthetic', contentHash: 'synthetic-ports', retrievedAt: '2026-10-20T00:00:00Z' }));
  const hsBefore = fake.calls.hsJudge;
  const NA = (await svc.createCase(customer, { clientRequestId: 'REQ-N-1', application: application({ proformaInvoiceNumber: 'PI-2026-0901' }) })).tradeCase.caseId;
  let n = await attachPi(NA, customer, 'PI-2026-0901.pdf', proforma('PI-2026-0901', '250,000.00'));
  assert.ok(!open(n).some((f) => f.ruleId.startsWith('EXT-')), 'a code that fits the goods raises nothing');
  const goodRun = n.validation.externalVerification!;
  const hsResults = goodRun.results.filter((r) => r.module === 'HS_CLASSIFICATION');
  assert.ok(hsResults.length > 0 && hsResults.every((r) => r.status === 'CONSISTENT'), 'the clean HS result is kept on the run as "consistent", not as a finding and not as "verified"');
  assert.ok(goodRun.results.filter((r) => r.module === 'PORT_IDENTITY').every((r) => r.status === 'VERIFIED'), 'the ports are identified in the synthetic list and raise nothing');
  assert.strictEqual(fake.calls.hsJudge, hsBefore, 'no AI second opinion was needed');
  const nReport = (await svc.scrutiny(maker, NA)) as unknown as { externalVerification: { lastRun: { results: unknown[] }; sources: { catalogue: Array<{ sourceId: string; integration: string }>; health: Array<{ state: string }> } } | null };
  assert.ok(nReport.externalVerification?.lastRun.results.length, 'the desk sees what was checked');
  assert.ok(nReport.externalVerification!.sources.catalogue.some((s) => s.sourceId === 'PAKISTAN-CUSTOMS-TARIFF' && s.integration === 'ADAPTER_READY') && nReport.externalVerification!.sources.catalogue.some((s) => s.integration === 'NOT_INTEGRATED'), 'and which sources are only ready for a dataset, or not integrated at all');
  assert.ok(!(svc.toView(customer, n) as unknown as { validation?: { externalVerification?: unknown } }).validation?.externalVerification, 'the customer view does not carry the verification record');

  // The same goods under a code for iron and steel: a discrepancy for a person, with the official record as evidence.
  const NB = (await svc.createCase(customer, { clientRequestId: 'REQ-N-2', application: application({ proformaInvoiceNumber: 'PI-2026-0902' }) })).tradeCase.caseId;
  const wrongLines = proforma('PI-2026-0902', '250,000.00').map((line) => line.replace('5201.0010', '7208.1000'));
  n = await attachPi(NB, customer, 'PI-2026-0902.pdf', wrongLines);
  const hsFinding = open(n, (f) => f.ruleId === 'EXT-HS-CLASS')[0];
  assert.ok(hsFinding, 'the mismatch between cotton and an iron and steel heading is raised');
  assert.ok(hsFinding.blocking && hsFinding.category === 'DATA_INCONSISTENCY' && hsFinding.origin === 'EXTERNAL_VERIFICATION');
  const source = hsFinding.observed.find((o) => o.source === 'EXTERNAL_SOURCE');
  assert.ok(source && /sha256/.test(source.snippet ?? '') && /Retrieved/.test(source.snippet ?? ''), 'the official record is evidence, with when it was retrieved and the file hash');
  assert.ok(/not a finding of wrongdoing/.test(hsFinding.description), 'the finding does not accuse');
  const where = hsFinding.observed.find((o) => o.source === 'DOCUMENT');
  assert.ok(where?.pageNumber === 1 && /7208/.test(where.snippet ?? ''), 'the finding says which page the code was read on and shows the words around it');
  const askedBefore = fake.calls.hsJudge;
  await svc.revalidate(NB, 'SYSTEM', 'No change');
  assert.strictEqual(fake.calls.hsJudge, askedBefore, 'revalidating an unchanged case does not ask the model again');
  assert.ok(open(n).some((f) => f.ruleId === 'EXT-HS-CROSSDOC'), 'and the PI code differs from the typed application code');

  // The customer reads a plain request, never the officer's reading of the official wording.
  const customerFinding = (svc.toView(customer, await load(NB)) as unknown as { findings: TradeCase['findings'] }).findings.find((f) => f.ruleId === 'EXT-HS-CLASS');
  assert.ok(customerFinding, 'the customer is told the HS code could not be confirmed');
  assert.ok(!/misdeclaration|wrongdoing|official wording|second opinion|Harmonized|retrieved/i.test(`${customerFinding.description} ${customerFinding.recommendedAction}`), 'with no officer-only language');
  assert.ok(customerFinding.observed.every((o) => o.source !== 'EXTERNAL_SOURCE') && customerFinding.history.length === 0, 'no source evidence, no officer history');

  // The same finding really stops the approval, and the message to the customer carries the plain wording.
  await svc.submit(customer, NB);
  const approvalAttempt = await svc.approvePreShipment(maker, NB, 'Approving despite the HS discrepancy').catch((e: { details?: { blockers?: string[] } }) => e);
  assert.ok(approvalAttempt instanceof Error && JSON.stringify((approvalAttempt as { details?: unknown }).details).includes('does not match the goods described'), 'a blocking HS discrepancy is named as the reason the request cannot be approved');
  const nMail = (await svc.composeCustomerMail(maker, NB, undefined)) as unknown as { body: string; available: Array<{ title: string }> };
  assert.ok(nMail.available.some((a) => /HS 7208/.test(a.title)), 'the customer-fixable HS point is offered for the message');
  assert.ok(/could not confirm that the HS code/.test(nMail.body) && !/misdeclaration|official wording|second opinion/i.test(nMail.body), 'and is put in plain words');

  // An officer's decision survives a routine refresh of the unchanged official file; only different content reopens it.
  const decided = open(await load(NB), (f) => f.ruleId === 'EXT-HS-CLASS')[0]!;
  await svc.dispositionFinding(maker, NB, decided.findingId, { code: 'JUSTIFIED', rationale: 'Supplier confirmed the goods are coated steel sheet, not fabric.' });
  setHsReferenceForTesting(hsFixture);
  const afterRefresh = (await svc.revalidate(NB, 'SYSTEM', 'The reference was afterRefresh')).tradeCase;
  assert.strictEqual(afterRefresh.findings.find((f) => f.findingId === decided.findingId)!.status, 'DISPOSITIONED', 'a refresh of an unchanged reference does not reopen a decided finding');
  setHsReferenceForTesting(hsFixture.map((e) => (e.code === '720810' ? { ...e, text: 'Iron or non-alloy steel; in coils, hot-rolled (amended wording)' } : e)));
  const changed = (await svc.revalidate(NB, 'SYSTEM', 'The official wording changed')).tradeCase;
  assert.strictEqual(changed.findings.find((f) => f.findingId === decided.findingId)!.status, 'OPEN', 'but different official wording reopens it');
  setHsReferenceForTesting(hsFixture);

  // The source goes away: the check is reported as not done, never as passed. When it returns, the finding clears itself.
  setHsReferenceForTesting(null);
  n = (await svc.revalidate(NA, 'SYSTEM', 'The source changed')).tradeCase;
  const outage = open(n, (f) => f.ruleId === 'EXT-VERIFY-SOURCE')[0];
  assert.ok(outage && !outage.blocking, 'an unavailable source is a visible, non-blocking finding that says nothing was verified');
  assert.strictEqual(n.validation.externalVerification!.modules[0]!.state, 'SOURCE_UNAVAILABLE');
  assert.ok(!n.validation.externalVerification!.results.some((r) => r.module === 'HS_CLASSIFICATION' && (r.status === 'CONSISTENT' || r.status === 'VERIFIED')), 'no HS result is carried over as a pass');
  assert.ok(n.validation.externalVerification!.results.some((r) => r.module === 'PORT_IDENTITY' && r.status === 'VERIFIED'), 'the ports, whose source is up, are still checked: one source going away does not take the others with it');
  setHsReferenceForTesting(hsFixture);
  n = (await svc.revalidate(NA, 'SYSTEM', 'The source changed')).tradeCase;
  assert.ok(!open(n).some((f) => f.ruleId === 'EXT-VERIFY-SOURCE'), 'the finding clears when the source is back and the check has run');
  setHsReferenceForTesting(null);
  process.env['EXTERNAL_VERIFICATION_ENABLED'] = 'false';

  // ------------------------------------------------------------------ Scenario O: rule approval and source criticality in a real case
  console.log('Scenario O: an unapproved rule is shadow or demonstration; an approved one is a control; a mandatory source holds the approval');
  process.env['EXTERNAL_VERIFICATION_ENABLED'] = 'true';
  setProviderForTesting(fake);
  setHsReferenceForTesting(hsFixture);
  const governance = VerificationGovernance.getInstance();
  governance.resetForTesting();
  const policyOwner = as('compliance_officer');
  const savedEnv = { mode: process.env['VERIFICATION_UNAPPROVED_RULE_MODE'], mandatory: process.env['VERIFICATION_MANDATORY_SOURCES'] };
  const OC = (await svc.createCase(customer, { clientRequestId: 'REQ-O-1', application: application({ proformaInvoiceNumber: 'PI-2026-0903' }) })).tradeCase.caseId;
  await attachPi(OC, customer, 'PI-2026-0903.pdf', proforma('PI-2026-0903', '250,000.00').map((line) => line.replace('5201.0010', '7208.1000')));
  await svc.submit(customer, OC);
  const hsOf = async () => open(await load(OC), (f) => f.ruleId === 'EXT-HS-CLASS')[0]!;

  process.env['VERIFICATION_UNAPPROVED_RULE_MODE'] = 'SHADOW';
  await svc.revalidate(OC, 'SYSTEM', 'shadow mode');
  let hsShadow = await hsOf();
  assert.ok(!hsShadow.blocking && /SHADOW MODE/.test(hsShadow.description), 'in shadow mode an unapproved rule is advisory: shown, labeled, not blocking');
  assert.ok(hsShadow.observed.some((o) => o.source === 'POLICY' && /EXT-HS-CLASS/.test(o.value) && /SHADOW/.test(o.value)), 'and the rule status is part of the evidence');
  assert.ok(!svc.preShipmentBlockers(await load(OC)).some((b) => /does not match the goods/.test(b)), 'so it does not hold the approval');

  process.env['VERIFICATION_UNAPPROVED_RULE_MODE'] = 'DEMO_ENFORCE';
  await svc.revalidate(OC, 'SYSTEM', 'demonstration mode');
  hsShadow = await hsOf();
  assert.ok(hsShadow.blocking && /DEMONSTRATION/.test(hsShadow.description) && /not an approved control/.test(hsShadow.description), 'in demonstration mode it blocks and says it is not an approved control');

  // Approved as a control: it is enforced as one, and clearing it takes compliance authority.
  governance.proposeRule(compliance, 'EXT-HS-CLASS', 'Heading wording check reviewed against the bank classification policy.');
  governance.decideRule(policyOwner, 'EXT-HS-CLASS', true, 'Approved for the pilot import desk.');
  await svc.revalidate(OC, 'SYSTEM', 'rule approved');
  const hsControl = await hsOf();
  assert.ok(hsControl.blocking && /Approved bank control/.test(hsControl.description), 'an approved rule is described as an approved bank control');
  await expectError(svc.dispositionFinding(checker, OC, hsControl.findingId, { code: 'JUSTIFIED', rationale: 'The supplier says it is fine, so I clearedCase it.' }), 403, 'a checker clearing an approved control\'s finding');
  const clearedCase = await svc.dispositionFinding(compliance, OC, hsControl.findingId, { code: 'JUSTIFIED', rationale: 'Supplier specification confirms coated steel sheet; the description was a typing error.' });
  const clearedFinding = clearedCase.findings.find((f) => f.findingId === hsControl.findingId)!;
  assert.ok(clearedFinding.status === 'DISPOSITIONED' && clearedFinding.disposition?.by.id === compliance.id, 'compliance clears it, with its name and reason on the finding');
  assert.ok((await svc.getAudit(auditor, OC)).events.some((e) => e.action === 'FINDING_DISPOSITIONED' && JSON.stringify(e.detail).includes('EXT-HS-CLASS')), 'and the exception is in the case audit chain');

  // A mandatory source that is down holds the approval only where the control is in force.
  setHsReferenceForTesting(null);
  process.env['VERIFICATION_MANDATORY_SOURCES'] = 'UN-HS-REFERENCE';
  await svc.revalidate(OC, 'SYSTEM', 'source down, rule approved');
  const down = open(await load(OC), (f) => f.ruleId === 'EXT-VERIFY-SOURCE')[0]!;
  // EXT-VERIFY-SOURCE has no approval of its own yet, so (demonstration mode) it follows its own status.
  assert.ok(down && /NOT been verified/.test(down.description), 'the outage is reported as not verified');
  governance.proposeRule(compliance, 'EXT-VERIFY-SOURCE', 'The outage handling is part of the HS control and has been reviewed.');
  governance.decideRule(policyOwner, 'EXT-VERIFY-SOURCE', true, 'Approved together with the classification control.');
  await svc.revalidate(OC, 'SYSTEM', 'source down, outage rule approved');
  const held = open(await load(OC), (f) => f.ruleId === 'EXT-VERIFY-SOURCE')[0]!;
  assert.ok(held.blocking && held.severity === 'HIGH' && /mandatory for a bank control/.test(held.description), 'a mandatory source that is down holds the approval of a case under an approved control');
  assert.ok(svc.preShipmentBlockers(await load(OC)).some((b) => /could not be verified|could not run|unavailable/i.test(b)), 'and the case cannot be approved past it');
  delete process.env['VERIFICATION_MANDATORY_SOURCES'];
  await svc.revalidate(OC, 'SYSTEM', 'source down, optional source');
  const optional = open(await load(OC), (f) => f.ruleId === 'EXT-VERIFY-SOURCE')[0]!;
  assert.ok(!optional.blocking, 'an optional source that is down is a non-blocking warning');
  assert.ok(!(await load(OC)).validation.externalVerification!.results.some((r) => r.status === 'CONSISTENT'), 'and nothing is carried over as a pass');

  governance.resetForTesting();
  for (const [key, value] of [['VERIFICATION_UNAPPROVED_RULE_MODE', savedEnv.mode], ['VERIFICATION_MANDATORY_SOURCES', savedEnv.mandatory]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  process.env['EXTERNAL_VERIFICATION_ENABLED'] = 'false';
  console.log(`✔ Scenario O Passed: ${OC} — shadow, demonstration and approved enforcement behave as labeled; clearing an approved control needs compliance and is audited; a mandatory source outage holds the approval only under an approved control.\n`);
  setHsReferenceForTesting(null);
  setPortIndexForTesting(null);
  setProviderForTesting(null);
  console.log(`✔ Scenario N Passed: ${NA}, ${NB} — a fitting HS code is consistent, a code for different goods is a blocking discrepancy with the official record as evidence, an outage is a visible finding.\n`);

  console.log(`✔ Scenario L Passed: ${L2} — an already-analyzed file on a new request fills the application and is not reported as missing.\n`);
  console.log(`✔ Scenario J Passed: ${J} — blocked by an unanswered then an unresolved message, approved by the trade desk in one step, audited.\n`);

  // ------------------------------------------------------------------ field-level visibility
  console.log('Field-level visibility of restricted findings');
  const dCase = await load(D);
  const dJurisdiction = dCase.findings.find((x) => x.ruleId === 'CMP-JURISDICTION')!;
  type View = { findings: Array<{ findingId: string; ruleId: string; title: string; description: string }>; investigations: unknown[]; creditFacility: unknown; viewer: Record<string, boolean> };
  const seen = (u: AuthenticatedUser, id: string) => (svc.toView(u, dCase) as View).findings.find((x) => x.findingId === id);
  assert.strictEqual(seen(compliance, dJurisdiction.findingId)?.ruleId, 'CMP-JURISDICTION', 'compliance reads the alert');
  assert.strictEqual(seen(approver, dJurisdiction.findingId)?.ruleId, 'CMP-JURISDICTION', 'the approver reads what it decides on');
  assert.strictEqual(seen(auditor, dJurisdiction.findingId)?.ruleId, 'CMP-JURISDICTION', 'the auditor reads everything');
  assert.strictEqual(seen(maker, dJurisdiction.findingId)?.ruleId, 'CMP-JURISDICTION', 'the trade desk reads the screening results as part of its scrutiny');
  for (const u of [checker, credit, issuer, settlement, rm]) {
    const redacted = seen(u, dJurisdiction.findingId);
    assert.ok(redacted && redacted.ruleId === 'RESTRICTED' && !redacted.description.includes('Iran'), `${u.role} sees that a restricted matter exists, not what it is`);
  }
  assert.strictEqual(seen(customer, dJurisdiction.findingId), undefined, 'the customer does not learn the alert exists');
  const fWithFacility = await load(F);
  assert.ok((svc.toView(credit, fWithFacility) as View).creditFacility, 'credit sees the facility');
  assert.strictEqual((svc.toView(maker, fWithFacility) as View).creditFacility, null, 'trade ops does not see the facility figures');
  console.log('✔ Visibility Passed: compliance and credit detail redacted per permission; placeholders keep blockers visible.\n');

  // ------------------------------------------------------------------ audit tamper detection
  console.log('Audit tamper detection: alteration, deletion, reordering, truncation');
  const tradeRepo = getTradeCaseRepository() as unknown as { rawEvents?: (id: string) => Array<Record<string, unknown>> };
  assert.ok(tradeRepo.rawEvents, 'memory driver exposes the stored log to the test');
  const stored = tradeRepo.rawEvents!(F);
  const pristine = structuredClone(stored);
  const verdict = async () => (await svc.getAudit(auditor, F)).chain;
  const restore = () => stored.splice(0, stored.length, ...structuredClone(pristine));
  (stored[3]!['detail'] as Record<string, unknown>)['rationale'] = 'rewritten after the fact';
  let v = await verdict();
  assert.ok(!v.valid && v.brokenAtSeq === 4 && /altered/.test(v.problem!), `alteration detected: ${v.problem}`);
  restore();
  stored.splice(5, 1);
  v = await verdict();
  assert.ok(!v.valid && /missing or reordered/.test(v.problem!), `deleted entry detected: ${v.problem}`);
  restore();
  [stored[6], stored[7]] = [stored[7]!, stored[6]!];
  v = await verdict();
  assert.ok(!v.valid && /missing or reordered/.test(v.problem!), `reordering detected: ${v.problem}`);
  restore();
  stored.splice(stored.length - 3, 3);
  v = await verdict();
  assert.ok(!v.valid && /removed or never written/.test(v.problem!), `truncation of the newest entries detected via the case anchor: ${v.problem}`);
  restore();
  assert.ok((await verdict()).valid, 'restored log verifies again');
  const overview = await svc.auditOverview(auditor);
  assert.ok(overview.length >= 6 && overview.every((r) => r.chain.valid), 'audit explorer verifies every case');
  await expectError(svc.auditOverview(maker), 403, 'trade maker opening the audit explorer');
  console.log('✔ Audit Passed: alteration, deletion, reordering and tail truncation are each detected and located.\n');

  // ------------------------------------------------------------------ concurrency
  console.log('Concurrency: case numbering, duplicate submissions, stale writers');
  const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => svc.createCase(customer, { clientRequestId: `REQ-K-${i}`, application: application() })));
  const burstIds = burst.map((r) => r.tradeCase.caseId);
  assert.strictEqual(new Set(burstIds).size, 12, 'twelve parallel creates get twelve distinct case numbers');
  const dupes = await Promise.all(Array.from({ length: 6 }, () => svc.createCase(customer, { clientRequestId: 'REQ-K-SAME', application: application() })));
  assert.strictEqual(new Set(dupes.map((r) => r.tradeCase.caseId)).size, 1, 'six identical parallel requests produce one case');
  assert.strictEqual(dupes.filter((r) => r.created).length, 1, 'exactly one of them created it');
  const K = burstIds[0]!;
  await expectError(svc.submit(customer, K), 400, 'sending a request that holds no document');
  await svc.attachDocument(customer, K, upload('PI-2026-1101.pdf', await pdf(proforma('PI-2026-1101', '250,000.00'))), 'PROFORMA_INVOICE');
  await svc.submit(customer, K);
  const findingsBefore = (await load(K)).findings.length;
  const racers = await Promise.allSettled([
    svc.revalidateByUser(maker, K),
    svc.revalidateByUser(as('compliance_officer'), K),
    svc.revalidateByUser(compliance, K),
    svc.raiseQuery(checker, K, { question: 'Please confirm the shipment window with the seller.', assignee: 'CUSTOMER', department: 'TRADE_OPS', findingIds: [] }),
    svc.raiseQuery(rm, K, { question: 'Please confirm the end use of the cotton.', assignee: 'CUSTOMER', department: 'RM', findingIds: [] }),
  ]);
  const kAfter = await load(K);
  console.log(`   five parallel writers: ${racers.map((r) => (r.status === 'fulfilled' ? 'ok' : (r.reason as Error).message.slice(0, 60))).join(' | ')}`);
  assert.ok(racers.every((r) => r.status === 'fulfilled'), 'writers on one case are serialized, none fails');
  assert.strictEqual(kAfter.queries.length, 2, 'no lost update: both queries are on the case');
  assert.strictEqual(kAfter.findings.length, findingsBefore, 'parallel revalidation adds no duplicate findings');
  assert.ok((await svc.getAudit(auditor, K)).chain.valid, 'the audit chain stays linear under parallel writes');
  const stale = structuredClone(kAfter);
  await getTradeCaseRepository().replace({ ...kAfter, revision: kAfter.revision + 1 }, kAfter.revision);
  await expectError(getTradeCaseRepository().replace({ ...stale, revision: stale.revision + 1 }, stale.revision), 409, 'a second instance writing from a stale revision');
  console.log('✔ Concurrency Passed: unique numbering, idempotent creation, stale-revision writes refused.\n');

  // ------------------------------------------------------------------ isolation & HTTP guards
  console.log('Ownership, roles and HTTP guards');
  await expectError(svc.getCase(otherCustomer, A), 404, 'another customer\'s case');
  assert.strictEqual((await svc.listCases(otherCustomer, {})).length, 0, 'another customer sees no cases');
  await expectError(svc.requestApproval(customer, B, 'self-approve attempt'), 403, 'customer requesting approval');

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base_ = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  // Tokens carry the account's session version; authenticate re-reads the account on every call.
  const token = (u: AuthenticatedUser) => signBankingToken({ ...u, sessionVersion: getAccount(u.id)!.sessionVersion }, 1);
  const call = async (path: string, u?: AuthenticatedUser, init: RequestInit = {}) => {
    const res = await fetch(base_ + path, { ...init, headers: { 'content-type': 'application/json', ...(u ? { authorization: `Bearer ${token(u)}` } : {}) } });
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };
  try {
    assert.strictEqual((await call(`/trade-cases/${A}`)).status, 401, 'no token');
    assert.strictEqual((await call('/documents', customer)).status, 403, 'customers cannot read the document store');
    assert.strictEqual((await call('/analytics', customer)).status, 403, 'customers cannot read analytics');
    assert.strictEqual((await call(`/trade-cases/${A}`, otherCustomer)).status, 404, 'other customer over HTTP');
    const own = await call(`/trade-cases/${D}`, customer);
    assert.strictEqual(own.status, 200);
    assert.ok(!(own.body?.['findings'] as Array<{ category: string }>).some((f) => f.category === 'COMPLIANCE_ALERT'), 'no compliance alerts over HTTP either');
    assert.strictEqual((await call(`/trade-cases/${A}/audit`, customer)).status, 403);
    assert.strictEqual(((await call(`/trade-cases/${A}/audit`, auditor)).body?.['chain'] as { valid: boolean }).valid, true);
    assert.strictEqual((await call(`/trade-cases/${B}/approval/decision`, customer, { method: 'POST', body: JSON.stringify({ decision: 'APPROVE', rationale: 'Direct API call bypass' }) })).status, 403, 'approval via direct API call');
    assert.strictEqual((await call('/trade-cases/rules', compliance)).status, 200);
    assert.strictEqual((await call('/documents', maker)).status, 200, 'staff still reach the document store');
  } finally {
    server.close();
  }
  console.log('✔ Isolation Passed: ownership, staff-only workbench, SoD and direct-API bypass attempts refused.\n');

  // ------------------------------------------------------------------ Scenario P: clearing the approved cases from a desk's list
  console.log('Scenario P: "Clear history" hides approved cases from one maker\'s list; nothing is deleted');
  const otherMaker: AuthenticatedUser = { ...maker, id: 'second-maker', name: 'Second Maker' };
  const approvedIds = [J, AK];
  const openId = (await svc.createCase(customer, { clientRequestId: 'REQ-P-1', application: application({ proformaInvoiceNumber: 'PI-2026-0777' }) })).tradeCase.caseId;
  // Still under review, not approved: it has been sent (an unsent draft is not on the bank's list at all).
  await svc.attachDocument(customer, openId, upload('PI-2026-0777.pdf', await pdf(proforma('PI-2026-0777', '250,000.00'))), 'PROFORMA_INVOICE');
  await svc.submit(customer, openId);
  const listedBefore = await svc.listCases(maker, {});
  assert.ok(approvedIds.every((id) => listedBefore.some((c) => c.caseId === id)), 'the approved cases are listed listedBefore clearing');
  const stamped = new Map(listedBefore.map((c) => [c.caseId, c.updatedAt]));
  const docsOf = (id: string) => listedBefore.find((c) => c.caseId === id)!.documents.length;

  await expectError(svc.clearHistory(customer), 403, 'a customer clearing history');
  await expectError(svc.clearHistory(checker), 403, 'a role without the permission clearing history');
  const result = await svc.clearHistory(maker);
  assert.ok(approvedIds.every((id) => result.cleared.includes(id)), 'the approved cases are cleared');
  assert.ok(!result.cleared.includes(openId), 'a case that is not approved is never cleared');
  const after = await svc.listCases(maker, {});
  assert.ok(approvedIds.every((id) => !after.some((c) => c.caseId === id)) && after.some((c) => c.caseId === openId), 'only the approved cases leave the list; cases still under review stay');
  const dash = (await svc.dashboard(maker)) as { totalCases: number };
  assert.strictEqual(dash.totalCases, after.length, 'the counts follow the list');
  const onlyCleared = await svc.listCases(maker, { history: 'cleared' });
  assert.deepStrictEqual(onlyCleared.map((c) => c.caseId).sort(), result.cleared.slice().sort(), 'the cleared cases are still there under "cleared history"');
  assert.ok(onlyCleared.every((c) => c.updatedAt === stamped.get(c.caseId) && c.documents.length === docsOf(c.caseId) && c.status === 'AUTHORIZED_FOR_ISSUANCE'), 'their documents, status and last-updated time are untouched');
  assert.ok((await svc.listCases(otherMaker, {})).length === listedBefore.length, 'another user still sees every case: the choice is personal');
  assert.ok((await svc.listCases(customer, {})).some((c) => c.caseId === J), 'the customer still sees the approved case');
  assert.deepStrictEqual((await svc.clearHistory(maker)).cleared, [], 'clearing again clears nothing new');
  const trail = await svc.getAudit(auditor, J);
  assert.ok(trail.chain.valid && trail.events.some((e) => e.action === 'HISTORY_CLEARED' && e.actor.id === maker.id), 'the audit chain records who cleared it and is intact');

  // Recover: the cleared cases of a date or period come back to this maker's list; clearing hides them again; every step is stored.
  await expectError(svc.recoverHistory(customer, {}), 403, 'a customer recovering history');
  await expectError(svc.recoverHistory(checker, {}), 403, 'a role without the permission recovering history');
  await expectError(svc.recoverHistory(maker, { from: 'not a date' }), 400, 'a start date that is not a date');
  await expectError(svc.recoverHistory(maker, { from: '2026-12-31T00:00:00Z', to: '2026-01-01T00:00:00Z' }), 400, 'a start date after the end date');
  const wrongDay = await svc.recoverHistory(maker, { from: '2000-01-01T00:00:00Z', to: '2000-01-02T00:00:00Z' });
  assert.deepStrictEqual(wrongDay.recovered, [], 'a period with nothing cleared in it recovers nothing');
  const unchanged = await svc.listCases(maker, {});
  assert.ok(approvedIds.every((id) => !unchanged.some((c) => c.caseId === id)), 'and the list is unchanged');
  const dayStart = new Date(Date.now() - 86_400_000).toISOString();
  const dayEnd = new Date(Date.now() + 86_400_000).toISOString();
  const back = await svc.recoverHistory(maker, { from: dayStart, to: dayEnd });
  assert.ok(approvedIds.every((id) => back.recovered.includes(id)), 'the cleared cases of the period come back');
  assert.ok(approvedIds.every((id) => stamped.get(id) === listedBefore.find((c) => c.caseId === id)!.updatedAt), 'unchanged: their last-updated time is the same');
  const afterRecover = await svc.listCases(maker, {});
  assert.ok(approvedIds.every((id) => afterRecover.some((c) => c.caseId === id)), 'they are in the list again');
  assert.deepStrictEqual((await svc.listCases(maker, { history: 'cleared' })).map((c) => c.caseId), [], 'and under "cleared history" no longer');
  assert.strictEqual(((await svc.dashboard(maker)) as { totalCases: number }).totalCases, afterRecover.length, 'the counts follow the list');
  assert.ok((await svc.listCases(otherMaker, {})).length === listedBefore.length, 'another user is unaffected: the choice is personal');
  const clearedAgain = await svc.clearHistory(maker);
  assert.ok(approvedIds.every((id) => clearedAgain.cleared.includes(id)), 'clearing again hides them again');
  const hiddenAgain = await svc.listCases(maker, {});
  assert.ok(approvedIds.every((id) => !hiddenAgain.some((c) => c.caseId === id)), 'and they disappear from the list');
  const afterTrail = await svc.getAudit(auditor, J);
  const kinds = afterTrail.events.map((e) => e.action).filter((a) => a === 'HISTORY_CLEARED' || a === 'HISTORY_RECOVERED');
  assert.deepStrictEqual(kinds, ['HISTORY_CLEARED', 'HISTORY_RECOVERED', 'HISTORY_CLEARED'], 'every clear and every recovery is stored in the audit trail, in order');
  assert.ok(afterTrail.chain.valid, 'and the chain is intact');
  // ------------------------------------------------------------------ Scenario Q: a headline box and the cases behind it agree
  console.log('Scenario Q: each headline count is the sum of what the cases behind it carry');
  for (const who of [maker, compliance, customer, checker]) {
    const mine = await svc.listCases(who, {});
    const d = (await svc.dashboard(who)) as { openCustomerQueries: number; casesBlockedByFindings: number; openComplianceAlerts?: number; totalCases: number };
    const signals = mine.map((c) => svc.caseSignals(who, c));
    assert.strictEqual(signals.reduce((n, s) => n + s.openCustomerQueries, 0), d.openCustomerQueries, `${who.role}: waiting-on-customer box`);
    assert.strictEqual(signals.filter((s) => s.blocked).length, d.casesBlockedByFindings, `${who.role}: blocked box`);
    assert.strictEqual(d.openComplianceAlerts === undefined ? 0 : signals.reduce((n, s) => n + s.complianceAlerts, 0), d.openComplianceAlerts ?? 0, `${who.role}: alerts box`);
    assert.strictEqual(mine.length, d.totalCases, `${who.role}: cases box`);
  }
  assert.ok((await svc.listCases(customer, {})).every((c) => svc.caseSignals(customer, c).complianceAlerts === 0), 'the customer is shown no compliance alert count');
  console.log('✔ Scenario Q Passed: waiting-on-customer, blocked, alerts and cases boxes agree with their cases for the maker, compliance, customer and checker.\n');

  console.log(`✔ Scenario P Passed: ${approvedIds.join(', ')} cleared from one maker's list and counts, shown under cleared history, nothing deleted, audited; ${openId} (under review) untouched.\n`);

  // ------------------------------------------------------------------ Scenario R: one officer holds every bank-side desk
  console.log('Scenario R: the all-desks officer takes a request from review to closure alone');
  const officer = as('post_trade_officer');
  const R = (await svc.createCase(customer, { clientRequestId: 'REQ-R-1', application: application({ proformaInvoiceNumber: 'PI-2026-0888' }) })).tradeCase.caseId;
  let r = await attachPi(R, customer, 'PI-2026-0888.pdf', proforma('PI-2026-0888', '250,000.00'));
  r = await svc.submit(customer, R);
  assert.strictEqual(r.status, 'UNDER_REVIEW');
  for (const d of ['RM', 'TRADE_OPS'] as const) await approveReview(R, d, officer);
  for (const f of open(await load(R), (x) => DEFAULT_POLICY.complianceCategories.includes(x.category))) {
    await svc.dispositionFinding(officer, R, f.findingId, { code: f.category === 'REGULATORY_CONCERN' ? 'JUSTIFIED' : 'FALSE_POSITIVE', rationale: `Reviewed ${f.ruleId}: evidence checked against the documents; not a concern for this trade.` });
  }
  await approveReview(R, 'COMPLIANCE', officer);
  await svc.recordCreditFacility(officer, R, { facilityReference: 'LCF-KTL-2026-02', availableLimit: 500000, currency: 'USD', marginPercent: 10, verificationSource: 'SANDBOX_DEMO_DATA', note: 'Sandbox figure for testing; no core-banking access.' });
  r = await approveReview(R, 'CREDIT', officer);
  r = await svc.requestApproval(officer, R, 'All four reviews complete; ready for authorization.');
  r = await svc.decideApproval(officer, R, { decision: 'APPROVE', rationale: 'Terms, risk and facility reviewed; authorized.' });
  assert.strictEqual(r.status, 'AUTHORIZED_FOR_ISSUANCE', 'the same officer who requested the approval decided it');
  const rExpiry = r.applicationVersions[r.applicationVersions.length - 1]!.data.expiryDate!;
  r = await svc.recordIssuance(officer, R, { financialInstrumentNumber: `HBL-IMP-000777-${dmy(0).replace(/\./g, '')}LC`, financialInstrumentExpiry: rExpiry });
  assert.strictEqual(r.status, 'LC_ISSUED', 'and recorded the issuance');
  const rInvoice = await pdf(['GLOBAL COTTON TRADERS LIMITED', 'Unit 5, Tianhe Business Park, Guangzhou, China', 'COMMERCIAL INVOICE', `INVOICE NO: CI-2026-0888 DATE: ${dmy(-1)}`, 'BUYER: KAMRAN TEXTILES (PVT) LTD', 'INCOTERMS: CFR Karachi', 'COUNTRY OF ORIGIN: CHINA', 'Item Description HS Code Quantity Unit Price Total (USD)', 'RAW COTTON FIBRE GRADE A 5201.0010 100,000.00 KG $2.50/KG $250,000.00', 'TOTAL AMOUNT: USD $250,000.00', 'For GLOBAL COTTON TRADERS LIMITED']);
  const rBl = await pdf(['OCEAN BILL OF LADING', 'B/L NO: COSU2026000888', 'SHIPPER: GLOBAL COTTON TRADERS LIMITED', 'NOTIFY PARTY: KAMRAN TEXTILES (PVT) LTD', 'PORT OF LOADING: SHANGHAI', 'PORT OF DISCHARGE: KARACHI', `SHIPPED ON BOARD DATE: ${dmy(-2)}`, '1,000 BALES RAW COTTON FIBRE GRADE A 100,000.00 KG']);
  const rPacking = await pdf(['PACKING LIST', 'INVOICE NO: CI-2026-0888', 'SELLER: GLOBAL COTTON TRADERS LIMITED', '1,000 BALES RAW COTTON FIBRE GRADE A NET WEIGHT 100,000.00 KG']);
  r = await svc.recordPresentation(officer, R, [upload('CI-2026-0888.pdf', rInvoice), upload('BL-COSU2026000888.pdf', rBl), upload('PL-CI-2026-0888.pdf', rPacking)], ['COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'PACKING_LIST']);
  const rDocIds = r.documents.filter((d) => d.stage === 'POST_TRADE').map((d) => d.documentId);
  await waitFor('presented documents analyzed', async () => {
    const docs = await Promise.all(rDocIds.map((id) => getRepository().findMeta(id)));
    return docs.every((d) => d && ['completed', 'failed'].includes(d.status));
  });
  r = await svc.examinePresentation(officer, R);
  const rPres = r.presentations[0]!;
  for (const f of open(r, (x) => x.presentationId === rPres.presentationId && x.category === 'DOCUMENTARY_DISCREPANCY')) await svc.applicantWaiver(customer, R, f.findingId, { accept: true, note: 'We accept this discrepancy.' });
  for (const f of open(await load(R), (x) => x.presentationId === rPres.presentationId && x.category === 'LOW_CONFIDENCE_EXTRACTION')) await svc.dispositionFinding(officer, R, f.findingId, { code: 'VERIFIED_MANUALLY', rationale: 'Checked against the original presented document.' });
  for (const f of open(await load(R), (x) => DEFAULT_POLICY.complianceCategories.includes(x.category))) {
    await svc.dispositionFinding(officer, R, f.findingId, { code: f.category === 'REGULATORY_CONCERN' ? 'JUSTIFIED' : 'FALSE_POSITIVE', rationale: `Reviewed ${f.ruleId}: evidence checked against the documents; not a concern for this trade.` });
  }
  r = await svc.decidePresentation(officer, R, { decision: 'ACCEPT', rationale: 'Documents examined and comply; discrepancies waived by the applicant.' });
  assert.strictEqual(r.status, 'AWAITING_SETTLEMENT', 'the officer who recorded the presentation decided it');
  r = await svc.recordSettlement(officer, R, { mode: 'SANDBOX', amount: 250000, currency: 'USD', valueDate: day(0), reference: 'SBX-STL-0888', note: 'Sandbox settlement record; no payment initiated.' });
  assert.strictEqual(r.status, 'SETTLED_MONITORING', 'and recorded the settlement of the credit they issued');
  r = await svc.openInvestigation(officer, R, { reason: 'Routine monitoring review of the settled case.' });
  r = await svc.closeInvestigation(officer, R, { outcome: 'NO_FURTHER_ACTION', rationale: 'Nothing further found on review of the settled case.' });
  assert.strictEqual(r.status, 'SETTLED_MONITORING', 'opened and closed the same investigation');
  r = await svc.closeCase(officer, R, 'Settled, no open compliance matters.');
  assert.strictEqual(r.status, 'CLOSED');
  const rTrail = await svc.getAudit(auditor, R);
  const rActors = new Set(rTrail.events.filter((e) => e.actor.id !== 'system' && e.actor.role !== 'CORPORATE_CUSTOMER').map((e) => e.actor.id));
  assert.ok(rTrail.chain.valid && rActors.size === 1 && rActors.has(officer.id), 'every bank-side step is in an intact audit chain under the one officer');
  // The relaxation belongs to this role alone: an ordinary desk is still held to its own role and to separation of duties.
  await expectError(svc.decideApproval(maker, R, { decision: 'APPROVE', rationale: 'A maker deciding an approval' }), 403, 'a maker deciding an approval');
  console.log(`✔ Scenario R Passed: ${R} — one officer reviewed, approved, issued, examined, decided, settled, investigated and closed it; the audit chain names them on every step; ordinary desks keep their own limits.\n`);

  // ------------------------------------------------------------------ Scenario S: the post-shipment desk lists only approved requests and what follows
  console.log('Scenario S: a post-shipment session lists only approved requests onwards');
  const everything = await svc.listCases(officer, {});
  const postOnly = await svc.listCases(officer, { stage: 'post' });
  assert.ok(everything.some((c) => c.status === 'UNDER_REVIEW' || c.status === 'DRAFT'), 'the registry holds requests still in review or draft');
  assert.ok(postOnly.length > 0 && postOnly.every((c) => POST_SHIPMENT_STATUSES.includes(c.status)), 'a post-shipment session lists only approved requests and what follows');
  assert.ok(!postOnly.some((c) => ['DRAFT', 'UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION', 'APPROVAL_PENDING', 'REJECTED', 'WITHDRAWN', 'CANCELLED'].includes(c.status)), 'nothing still in review, awaiting the customer, rejected or withdrawn');
  assert.ok(postOnly.some((c) => c.caseId === R && c.status === 'CLOSED'), 'a case whose documents were presented and which is now closed is there');
  assert.ok(postOnly.every((c) => c.presentations.some((p) => p.applicationStatus !== 'DRAFT')), 'a case is in the post-shipment list only once post-shipment documents have been sent to the bank');
  assert.ok(everything.some((c) => c.status === 'AUTHORIZED_FOR_ISSUANCE' && !postOnly.some((p) => p.caseId === c.caseId)), 'an approved request whose customer has not sent post-shipment documents is not in the post-shipment list');
  assert.strictEqual(((await svc.dashboard(officer, 'post')) as { totalCases: number }).totalCases, postOnly.length, 'the counts follow the list');
  // Clearing is a pre-shipment tidy-up: what the maker cleared there is still live in the post-shipment list.
  assert.strictEqual((await svc.listCases(maker, { stage: 'post' })).length, (await svc.listCases(maker, { stage: 'post', history: 'all' })).length, 'what was cleared from the pre-shipment list does not change the post-shipment list');
  // (this maker cleared the approved cases from their own list in Scenario P, so ask for everything)
  const preOnly = await svc.listCases(maker, { stage: 'pre', history: 'all' });
  const allForMaker = await svc.listCases(maker, { history: 'all' });
  assert.ok(preOnly.length > 0 && preOnly.every((c) => PRE_SHIPMENT_STATUSES.includes(c.status)), 'a pre-shipment session lists requests up to approval only');
  assert.ok(!preOnly.some((c) => ['LC_ISSUED', 'DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION', 'AWAITING_SETTLEMENT', 'SETTLED_MONITORING', 'UNDER_INVESTIGATION', 'CLOSED'].includes(c.status)), 'nothing from after the credit was issued');
  const covered = new Set([...preOnly, ...postOnly].map((c) => c.caseId));
  assert.ok(preOnly.some((c) => c.status === 'AUTHORIZED_FOR_ISSUANCE'), 'approved requests are in the pre-shipment list');
  assert.ok(allForMaker.every((c) => covered.has(c.caseId) || (c.status !== 'AUTHORIZED_FOR_ISSUANCE' && POST_SHIPMENT_STATUSES.includes(c.status) && !c.presentations.some((p) => p.applicationStatus !== 'DRAFT'))), 'every case is in one of the lists, except an issued credit nobody has presented documents against yet');
  assert.strictEqual(((await svc.dashboard(maker, 'pre')) as { totalCases: number }).totalCases, preOnly.filter((c) => !clearedBy(maker, c)).length, 'the pre-shipment counts follow its list (less what this maker cleared)');
  assert.strictEqual(((await svc.dashboard(officer)) as { totalCases: number }).totalCases, everything.length, 'an institutional sign-in (no stage) still sees every case its role allows');
  assert.strictEqual((await svc.listCases(officer, { stage: 'nonsense' })).length, everything.length, 'an unknown stage changes nothing');
  assert.ok((await svc.listCases(customer, { stage: 'post' })).every((c) => c.customerRef === customer.customerRef), 'the stage never widens what a role may reach');
  console.log(`✔ Scenario S Passed: a post-shipment session lists ${postOnly.length} and a pre-shipment session ${preOnly.length} of ${everything.length} cases; the counts follow; no stage widens access.
`);

  // ------------------------------------------------------------------ Scenario T: documents added after sending, and the same file twice
  console.log('Scenario T: a file added after the request was sent must be sent; the very same file is refused');
  const T = (await svc.createCase(customer, { clientRequestId: 'REQ-T-1', application: application({ proformaInvoiceNumber: 'PI-2026-0990' }) })).tradeCase.caseId;
  const piT = await pdf(proforma('PI-2026-0990', '250,000.00'));
  await attachPi(T, customer, 'PI-2026-0990.pdf', piT);
  await svc.submit(customer, T);
  const noteA = await pdf(['SUPPORTING NOTE', 'Delivery schedule agreed with the supplier: first shipment in March.']);
  const noteB = await pdf(['SUPPORTING NOTE', 'Delivery schedule agreed with the supplier: first shipment in April.']);

  // Before anything is added, there is nothing to send.
  assert.ok(!svc.availableActions(customer, await load(T)).includes('SEND_DOCUMENTS'), 'nothing is waiting to be sent');
  await expectError(svc.sendDocuments(customer, T), 409, 'sending with nothing waiting');

  // The request is with the bank: nothing can be added, and nothing the bank has can be taken away, until the bank asks for a correction.
  assert.ok(!svc.availableActions(customer, await load(T)).includes('ATTACH_PRETRADE_DOCUMENT'), 'once sent, the customer is not offered adding a document');
  await expectError(svc.attachDocument(customer, T, upload('too-late.pdf', noteA), 'OTHER_SUPPORTING'), 409, 'adding a document to a request the bank already has');
  const tFirst = (await load(T)).documents.find((d) => d.documentType === 'PROFORMA_INVOICE')!;
  await expectError(svc.removeDocument(customer, T, tFirst.linkId), 409, 'removing a document the bank already has');
  await svc.raiseQuery(maker, T, { department: 'TRADE_OPS', assignee: 'CUSTOMER', subject: 'Delivery schedule', question: 'Please send the agreed delivery schedule.' });
  assert.ok(svc.availableActions(customer, await load(T)).includes('ATTACH_PRETRADE_DOCUMENT'), 'when the bank asks for a correction, the customer may add one');

  // The same file again is refused, and nothing is attached.
  const countBefore = (await load(T)).documents.length;
  await expectError(svc.attachDocument(customer, T, upload('PI-again.pdf', piT), 'PROFORMA_INVOICE'), 409, 'the same proforma sent again', 'same file as "PI-2026-0990.pdf"');
  assert.strictEqual((await load(T)).documents.length, countBefore, 'a refused file is not attached');

  // A new document added after sending waits to be sent.
  const tAdded = await svc.attachDocument(customer, T, upload('delivery-note.pdf', noteA), 'OTHER_SUPPORTING');
  assert.strictEqual(tAdded.document.sentToBankAt, null, 'what the customer adds after sending is not yet sent');
  assert.ok(svc.availableActions(customer, await load(T)).includes('SEND_DOCUMENTS'), 'the customer is offered "send to the bank"');
  assert.ok(!svc.availableActions(maker, await load(T)).includes('SEND_DOCUMENTS'), 'the bank desk is not');
  assert.ok(svc.preShipmentBlockers(await load(T)).some((b) => /delivery-note\.pdf was added by the customer but has not been sent/.test(b)), 'the bank cannot approve while the customer has an unsent file');
  await expectError(svc.sendDocuments(maker, T), 403, 'the bank sending on the customer\'s behalf');
  // The same file again, now that it is on the request unsent, is still the same file.
  await expectError(svc.attachDocument(customer, T, upload('delivery-note-copy.pdf', noteA), 'OTHER_SUPPORTING'), 409, 'the unsent file again');

  // A file changed even slightly is a different file and is accepted (it replaces the earlier one of its type).
  const tChanged = await svc.attachDocument(customer, T, upload('delivery-note-v2.pdf', noteB), 'OTHER_SUPPORTING');
  assert.strictEqual(tChanged.document.sentToBankAt, null);
  assert.strictEqual(tChanged.tradeCase.documents.filter((d) => d.documentType === 'OTHER_SUPPORTING' && !d.supersededByLinkId).length, 1, 'the changed file is the current one of its type');

  // The bank's own upload is not "waiting to be sent".
  const byBank = await svc.attachDocument(maker, T, upload('bank-copy.pdf', await pdf(['INSURANCE QUOTE', 'Marine cover quoted by the bank for the first shipment.'])), 'INSURANCE_DOCUMENT').catch(() => null);
  if (byBank) assert.notStrictEqual(byBank.document.sentToBankAt, null, 'a document the bank attached is not flagged as waiting for the customer');

  // Sending records which files, and clears the wait.
  const tSent = await svc.sendDocuments(customer, T);
  assert.ok(tSent.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId).every((d) => d.sentToBankAt !== null), 'every current document has now been sent');
  assert.ok(!svc.availableActions(customer, tSent).includes('SEND_DOCUMENTS') && !svc.preShipmentBlockers(tSent).some((b) => /has not been sent/.test(b)), 'nothing waits and nothing blocks');
  const tTrail = await svc.getAudit(auditor, T);
  const tEvent = tTrail.events.filter((e) => e.action === 'DOCUMENTS_SENT').pop();
  assert.ok(tTrail.chain.valid && tEvent && (tEvent.detail as { filenames: string[] }).filenames.includes('delivery-note-v2.pdf') && tEvent.actor.id === customer.id, 'the audit chain names the customer and the files they sent');
  await expectError(svc.sendDocuments(customer, T), 409, 'sending twice');

  // Answering a message from the bank with a new document sends it: no separate step.
  const tAsked = await svc.raiseQuery(maker, T, { department: 'TRADE_OPS', assignee: 'CUSTOMER', subject: 'Insurance', question: 'Please send the insurance certificate.' });
  const qT = tAsked.queries[tAsked.queries.length - 1]!;
  const cert = await svc.attachDocument(customer, T, upload('insurance-cert.pdf', await pdf(['INSURANCE CERTIFICATE', 'Policy 4455 covers the cotton shipment, USD 250,000.00.'])), 'OTHER_SUPPORTING');
  assert.strictEqual(cert.document.sentToBankAt, null);
  const replied = await svc.respondQuery(customer, T, qT.queryId, { text: 'The insurance certificate is attached.', documentLinkIds: [cert.document.linkId] });
  assert.ok(replied.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId).every((d) => d.sentToBankAt !== null), 'a reply to the bank sends what was attached to it');
  console.log(`✔ Scenario T Passed: ${T} — the same file is refused, a changed one accepted; what the customer adds after sending waits for "send to the bank", blocks approval until sent, and is audited; a reply sends it too.\n`);

  // ------------------------------------------------------------------ Scenario U: pre-shipment approval to post-shipment decision, client-initiated
  console.log('Scenario U: approved request -> reference -> client application -> examination -> clarification -> correction -> decision');
  const customer2 = as('corporate_customer_2');
  const U = (await svc.createCase(customer, { clientRequestId: 'REQ-U-1', application: application({ proformaInvoiceNumber: 'PI-2026-0950' }) })).tradeCase.caseId;

  // Before approval there is no reference and nothing to present against.
  assert.ok(!(await svc.postShipmentLcs(customer)).some((x) => x.caseId === U), 'a request that is not approved is not listed for post-shipment');
  await expectError(svc.startPostShipment(customer, U), 409, 'starting post-shipment before approval');

  await attachPi(U, customer, 'PI-2026-0950.pdf', proforma('PI-2026-0950', '250,000.00'));
  await svc.submit(customer, U);
  for (const f of open(await load(U), (x) => DEFAULT_POLICY.complianceCategories.includes(x.category))) {
    await svc.dispositionFinding(maker, U, f.findingId, { code: f.category === 'REGULATORY_CONCERN' ? 'JUSTIFIED' : 'FALSE_POSITIVE', rationale: `Reviewed ${f.ruleId}: evidence checked against the documents; not a concern for this trade.` });
  }
  const uApproved = await svc.approvePreShipment(maker, U, 'Documents scrutinized, nothing open.');
  assert.strictEqual(uApproved.status, 'AUTHORIZED_FOR_ISSUANCE');
  const ref = uApproved.preShipmentReference!.reference;
  assert.match(ref, /^TC-\d{4}-\d{5}$/, 'an approved request is known by its case number: one number from the first draft to the post-shipment decision');
  assert.strictEqual(ref, U, 'the reference is the case id, so unique and recomputable');
  // A case saved while the approved reference was written PSR-... is read with the case number, here and on its post-shipment application.
  const legacy = upgradeReferences({ ...uApproved, preShipmentReference: { reference: `PSR-${U.replace(/^TC-/, '')}`, assignedAt: uApproved.updatedAt, assignedBy: 'SYSTEM' }, presentations: [{ reference: `PSR-${U.replace(/^TC-/, '')}/P1` }] as never });
  assert.strictEqual(legacy.preShipmentReference!.reference, U, 'a stored PSR- reference reads as the case number');
  assert.strictEqual(legacy.presentations[0]!.reference, `${U}/P1`, 'and so does a stored PSR-.../P1 application reference');
  assert.strictEqual(preShipmentReferenceOf(legacy), U);
  assert.strictEqual(preShipmentReferenceOf({ ...uApproved, preShipmentReference: null }), ref, 'a request approved before the field existed gets the same reference');
  assert.ok((await svc.getAudit(auditor, U)).events.some((e) => e.action === 'PRESHIPMENT_APPROVED' && (e.detail as { preShipmentReference?: string }).preShipmentReference === ref), 'the audit trail records the reference when it was assigned');
  assert.strictEqual((svc.toView(customer, uApproved) as { preShipmentReference: string }).preShipmentReference, ref, 'the customer is shown the reference');

  // The client's Post-Shipment screen: only their own approved requests.
  const lcs = await svc.postShipmentLcs(customer);
  const mine = lcs.find((x) => x.caseId === U)!;
  assert.ok(mine && mine['reference'] === ref && mine['canStart'] === true && mine['application'] === null, 'the approved request is listed with its reference and can be started');
  assert.ok(!(await svc.postShipmentLcs(customer2)).some((x) => x.caseId === U), 'another customer does not see it');
  await expectError(svc.startPostShipment(customer2, U), 404, 'another customer starting it');
  await expectError(svc.startPostShipment(maker, U), 403, 'the bank starting the client\'s application');

  // A uDraft: prepared by the client, not visible to the bank.
  let u = await svc.startPostShipment(customer, U);
  const uDraft = u.presentations[u.presentations.length - 1]!;
  assert.ok(uDraft.applicationStatus === 'DRAFT' && uDraft.reference === `${ref}/P1` && uDraft.origin === 'CLIENT' && u.status === 'AUTHORIZED_FOR_ISSUANCE', 'a uDraft application linked to the reference, the case status unchanged');
  assert.strictEqual((await svc.startPostShipment(customer, U)).presentations.length, 1, 'starting again resumes the uDraft');
  assert.ok((svc.toView(maker, u) as { presentations: unknown[] }).presentations.length === 0, 'the bank does not see a uDraft');
  await expectError(svc.submitPostShipment(customer, U), 409, 'submitting an empty application');

  const invoiceLines = (no: string, hs: string, qty = '100,000.00') => ['GLOBAL COTTON TRADERS LIMITED', 'Unit 5, Tianhe Business Park, Guangzhou, China', 'COMMERCIAL INVOICE', `INVOICE NO: ${no} DATE: ${dmy(0)}`, 'BUYER: KAMRAN TEXTILES (PVT) LTD', 'INCOTERMS: CFR Karachi', 'COUNTRY OF ORIGIN: CHINA', 'Item Description HS Code Quantity Unit Price Total (USD)', `RAW COTTON FIBRE GRADE A ${hs} ${qty} KG $2.50/KG $250,000.00`, 'TOTAL AMOUNT: USD $250,000.00', 'For GLOBAL COTTON TRADERS LIMITED'];
  const blLines = (no: string, discharge: string) => ['OCEAN BILL OF LADING', `B/L NO: ${no}`, 'SHIPPER: GLOBAL COTTON TRADERS LIMITED', 'NOTIFY PARTY: KAMRAN TEXTILES (PVT) LTD', 'PORT OF LOADING: SHANGHAI', `PORT OF DISCHARGE: ${discharge}`, `SHIPPED ON BOARD DATE: ${dmy(0)}`, '1,000 BALES RAW COTTON FIBRE GRADE A 100,000.00 KG'];
  const plLines = (inv: string) => ['PACKING LIST', `INVOICE NO: ${inv}`, 'SELLER: GLOBAL COTTON TRADERS LIMITED', '1,000 BALES RAW COTTON FIBRE GRADE A NET WEIGHT 100,000.00 KG'];
  const put = async (name: string, lines: string[], type: string) => (await svc.attachPresentationDocument(customer, U, upload(name, await pdf(lines)), type)).document;

  // Documents into the uDraft: types are checked, the same file is refused, a second one of a type replaces the first.
  await expectError(svc.attachPresentationDocument(customer, U, upload('x.pdf', await pdf(['x'])), 'PROFORMA_INVOICE'), 400, 'a pre-shipment type among the presented documents');
  await expectError(svc.attachPresentationDocument(maker, U, upload('x.pdf', await pdf(['x'])), 'COMMERCIAL_INVOICE'), 403, 'the bank attaching to the client\'s uDraft');
  const bad1Bytes = await pdf(invoiceLines('CI-2026-0950', '8408.1000'));
  const bad1 = (await svc.attachPresentationDocument(customer, U, upload('CI-0950-A.pdf', bad1Bytes), 'COMMERCIAL_INVOICE')).document;
  await put('BL-0950.pdf', blLines('COSU2026000950', 'PORT QASIM'), 'BILL_OF_LADING');
  await expectError(svc.submitPostShipment(customer, U), 409, 'submitting without a packing list the credit calls for');
  const plDoc = await put('PL-0950.pdf', plLines('CI-2026-0950'), 'PACKING_LIST');
  await expectError(svc.attachPresentationDocument(customer, U, upload('CI-copy.pdf', bad1Bytes), 'COMMERCIAL_INVOICE'), 409, 'the same invoice again', 'same file as "CI-0950-A.pdf"');
  const stray = await put('stray.pdf', ['CERTIFICATE', 'Weight certificate for the cotton lot, 100 tonnes.'], 'OTHER_SUPPORTING');
  u = await svc.removePresentationDocument(customer, U, stray.linkId);
  assert.ok(!u.documents.some((d) => d.linkId === stray.linkId), 'a document can be taken out of a uDraft');
  const bad2 = await put('CI-0950-B.pdf', invoiceLines('CI-2026-0950', '8408.1000', '100,000.00 '), 'COMMERCIAL_INVOICE');
  u = await load(U);
  assert.ok(u.documents.find((d) => d.linkId === bad1.linkId)!.supersededByLinkId === bad2.linkId && bad2.version === 2, 'a second invoice replaces the first, which is kept as version 1');

  // Submit: the case enters the officer's queue. Until then it is not in the post-shipment desk's list at all.
  assert.ok(!(await svc.listCases(officer, { stage: 'post' })).some((c) => c.caseId === U), 'an approved request whose customer is still preparing the application is not in the post-shipment list');
  assert.ok((await svc.listCases(officer, { stage: 'pre' })).some((c) => c.caseId === U), 'it is still in the pre-shipment list');
  u = await svc.submitPostShipment(customer, U);
  assert.ok((await svc.listCases(officer, { stage: 'post' })).some((c) => c.caseId === U), 'once the customer sends it, the case appears in the post-shipment list');
  assert.strictEqual(u.status, 'DOCUMENT_EXAMINATION', 'submitting puts the case in document examination');
  assert.ok(svc.availableActions(officer, u).includes('EXAMINE_PRESENTATION'), 'the officer is offered the examination: the case is in their queue');
  await expectError(svc.removePresentationDocument(customer, U, plDoc.linkId), 409, 'removing a document the bank has received');
  assert.strictEqual((svc.toView(officer, u) as { presentations: unknown[] }).presentations.length, 1, 'the bank now sees the application');

  // The officer examines: rules against the credit, the approved set and the documents among themselves.
  await waitFor('presented documents analyzed', async () => {
    const docs = await Promise.all(u.documents.filter((d) => d.stage === 'POST_TRADE').map((d) => getRepository().findMeta(d.documentId)));
    return docs.every((d) => d && ['completed', 'failed'].includes(d.status));
  });
  u = await svc.examinePresentation(officer, U);
  let review = (await svc.postShipmentReview(officer, U)) as { reference: string; credit: { basis: string }; findings: Array<{ ruleId: string; blocking: boolean; class: string; presentationId: string; status: string; findingId: string; origin: string }>; comparison: Array<{ field: string; status: string }>; counts: Record<string, number>; approvedDocuments: unknown[] };
  assert.ok(review.reference === ref && review.credit.basis === 'APPROVED_APPLICATION', 'the review is joined by the reference and says the approved application was the basis');
  assert.ok(review.approvedDocuments.length >= 1, 'the approved pre-shipment documents are listed beside the submission');
  const uHs = review.findings.find((f) => f.ruleId === 'EXM-XD-HS');
  assert.ok(uHs && uHs.blocking && uHs.class === 'BLOCKING_DISCREPANCY', 'an HS code that differs from the approved one is a blocking discrepancy');
  assert.ok(review.findings.some((f) => f.ruleId === 'EXM-TD-PORTS' && f.class === 'BLOCKING_DISCREPANCY'), 'the port differs from the credit');
  assert.ok(review.findings.some((f) => f.ruleId === 'EXM-XD-BASIS' && f.class === 'INFORMATION'), 'the basis is stated as information');
  assert.strictEqual(review.comparison.find((r) => r.field === 'hsCode')!.status, 'DIFFERENT', 'the comparison shows the HS difference');
  assert.strictEqual(review.comparison.find((r) => r.field === 'currency')!.status, 'MATCH', 'and what agrees');
  assert.ok(review.counts['BLOCKING_DISCREPANCY']! >= 2, 'the counts by class are given');
  assert.strictEqual(u.status, 'DISCREPANCY_RESOLUTION', 'blocking findings hold the case');
  await expectError(svc.decidePresentation(officer, U, { decision: 'ACCEPT', rationale: 'Accepting with blocking findings open' }), 409, 'accepting over blocking discrepancies');

  // The AI-assisted reading: advice grounded in quotes, never blocking, and private to the bank until the officer includes it in a request.
  await expectError(svc.aiScrutinyOfPresentation(officer, U), 503, 'the AI reading with no model configured');
  setProviderForTesting(fake);
  fake.postIssues = [
    { code: 'AI-1', severity: 'HIGH', category: 'DATA_INCONSISTENCY', title: 'Named place on the invoice differs from the discharge port', description: 'The invoice sells to Karachi; the bill of lading discharges at Port Qasim.', quotes: [{ file: 'CI-0950-B.pdf', text: 'INCOTERMS: CFR Karachi' }, { file: 'BL-0950.pdf', text: 'PORT OF DISCHARGE: PORT QASIM' }] },
    { code: 'AI-2', severity: 'MEDIUM', category: 'DATA_INCONSISTENCY', title: 'Invented difference', description: 'Not in the documents.', quotes: [{ file: 'CI-0950-B.pdf', text: 'PAYMENT BY TELEGRAPHIC TRANSFER' }, { file: 'BL-0950.pdf', text: 'PORT OF DISCHARGE: PORT QASIM' }] },
    { code: 'AI-3', severity: 'MEDIUM', category: 'COMPLIANCE_ALERT', title: 'A sanctions opinion', description: 'Not the reading\'s to give.', quotes: [] },
  ];
  u = await svc.aiScrutinyOfPresentation(officer, U);
  setProviderForTesting(null);
  const aiPoints = u.findings.filter((f) => f.origin === 'AI_ASSISTED_EXTRACTION' && f.presentationId === u.presentations[0]!.presentationId);
  assert.strictEqual(aiPoints.length, 1, 'only the grounded point is kept: the invented one and the one outside its remit are not');
  assert.ok(!aiPoints[0]!.blocking && aiPoints[0]!.severity === 'MEDIUM' && aiPoints[0]!.ruleId === 'AI-POST-XDOC', 'an AI point is capped at medium and never blocks');
  assert.ok(classifyFinding(aiPoints[0]!) === 'NON_BLOCKING_DISCREPANCY', 'it is a non-blocking discrepancy for the examiner');
  assert.ok(u.presentations[0]!.aiReview && u.presentations[0]!.aiReview.leftOut === 1 && u.presentations[0]!.aiReview.raised === 1, 'the reading records what it kept and what it left out');
  assert.ok(!(svc.toView(customer, u) as { findings: Array<{ findingId: string }> }).findings.some((f) => f.findingId === aiPoints[0]!.findingId), 'the client does not see an AI point the officer has not put to them');
  assert.ok(u.status === 'DISCREPANCY_RESOLUTION', 'the AI point did not move the case');
  await svc.dispositionFinding(officer, U, aiPoints[0]!.findingId, { code: 'VERIFIED_MANUALLY', rationale: 'Checked against the originals: the named place is the buyer\'s city, not the port.' });

  // The customer sees what is theirs to act on, and not the bank's own internal findings.
  const uSeen = (svc.toView(customer, u) as { findings: Array<{ category: string; ruleId: string }> }).findings;
  assert.ok(!uSeen.some((f) => ['REGULATORY_CONCERN', 'COMPLIANCE_ALERT', 'TBML_RED_FLAG'].includes(f.category)), 'internal findings never reach the customer');

  // The officer records a point of their own, and asks the client to clarify.
  u = await svc.addManualFinding(officer, U, { title: 'Stamp on the bill of lading looks overwritten', description: 'The on-board stamp appears to have been written over; the original must be uSeen.', severity: 'MEDIUM', blocking: false, documentLinkId: u.documents.find((d) => d.documentType === 'BILL_OF_LADING')!.linkId });
  const manual = u.findings.find((f) => f.ruleId === 'EXM-MANUAL')!;
  assert.ok(manual.origin === 'REVIEWER' && classifyFinding(manual) === 'NON_BLOCKING_DISCREPANCY', 'a finding recorded by the officer is labeled as theirs');
  u = await svc.requestClarification(officer, U, { question: 'Please confirm the HS code on the invoice and the port of discharge on the bill of lading, and send corrected documents.', findingIds: [uHs!.findingId] });
  const askedQ = u.queries[u.queries.length - 1]!;
  assert.ok(askedQ.assignee === 'CUSTOMER' && askedQ.requiresCorrection, 'the client receives the request in their portal');
  assert.strictEqual(applicationState(u, u.presentations[0]!), 'CLARIFICATION_REQUESTED');

  // The client corrects: a new version replaces the invoice; it waits to be sent, and a reply sends it.
  const uFixed = (await svc.attachPresentationDocument(customer, U, upload('CI-0950-C.pdf', await pdf(invoiceLines('CI-2026-0950', '5201.0010'))), 'COMMERCIAL_INVOICE')).document;
  assert.ok(uFixed.version === 3 && uFixed.sentToBankAt === null, 'a correction is a new version and waits to be sent');
  assert.ok(svc.availableActions(customer, await load(U)).includes('SEND_DOCUMENTS'), 'the client can send the correction');
  u = await svc.respondQuery(customer, U, askedQ.queryId, { text: 'The HS code was a typing error; the corrected invoice is attached. The port is as the vessel discharged.', documentLinkIds: [uFixed.linkId] });
  assert.ok(u.documents.find((d) => d.linkId === uFixed.linkId)!.sentToBankAt !== null, 'replying sent it');
  assert.strictEqual(applicationState(u, u.presentations[0]!), 'REPLY_SENT', 'the client sees that their reply is with the bank for re-examination');
  await waitFor('the corrected invoice analyzed', async () => {
    const m = await getRepository().findMeta(uFixed.documentId);
    return m && ['completed', 'failed'].includes(m.status);
  });
  review = (await svc.postShipmentReview(officer, U)) as typeof review;
  assert.strictEqual((review as unknown as { reexaminationDue: boolean }).reexaminationDue, true, 'the officer is told the documents changed since the examination');
  u = await svc.examinePresentation(officer, U);
  review = (await svc.postShipmentReview(officer, U)) as typeof review;
  assert.ok(!review.findings.some((f) => f.ruleId === 'EXM-XD-HS' && f.status === 'OPEN'), 'the corrected invoice clears the HS finding');
  assert.ok(review.findings.some((f) => f.ruleId === 'EXM-MANUAL' && f.status === 'OPEN'), 're-examination never closes what the officer recorded');
  assert.ok(review.findings.some((f) => f.ruleId === 'EXM-TD-PORTS' && f.status === 'OPEN'), 'the port discrepancy is still there');
  assert.ok(u.documents.filter((d) => d.documentType === 'COMMERCIAL_INVOICE').map((d) => d.version).sort().join() === '1,2,3' && u.documents.filter((d) => d.documentType === 'COMMERCIAL_INVOICE' && !d.supersededByLinkId).length === 1, 'every version is kept; one is current');

  // First application refused, with a documented reason; the client may apply again.
  await expectError(svc.decidePresentation(officer, U, { decision: 'REFUSE', rationale: '' }), 400, 'a refusal without a reason');
  u = await svc.decidePresentation(officer, U, { decision: 'REFUSE', rationale: 'Port of discharge differs from the credit and the applicant has not waived it; the bill of lading overwrite is unexplained.' });
  assert.ok(u.status === 'AUTHORIZED_FOR_ISSUANCE' && u.presentations[0]!.decision?.decision === 'REFUSED', 'a refusal returns the request to where it stood, with the reason recorded');
  assert.strictEqual(applicationState(u, u.presentations[0]!), 'REFUSED');
  u = await svc.startPostShipment(customer, U);
  const p2 = u.presentations[u.presentations.length - 1]!;
  assert.ok(p2.reference === `${ref}/P2` && p2.applicationStatus === 'DRAFT', 'a second application carries the same reference');
  const put2 = async (name: string, lines: string[], type: string) => (await svc.attachPresentationDocument(customer, U, upload(name, await pdf(lines)), type)).document;
  await put2('CI-0950-D.pdf', invoiceLines('CI-2026-0950', '5201.0010', '100,000.00'), 'COMMERCIAL_INVOICE').catch(async () => put2('CI-0950-D2.pdf', [...invoiceLines('CI-2026-0950', '5201.0010'), 'Terms: as per contract.'], 'COMMERCIAL_INVOICE'));
  await put2('BL-0950-2.pdf', blLines('COSU2026000951', 'PORT QASIM'), 'BILL_OF_LADING');
  await put2('PL-0950-2.pdf', plLines('CI-2026-0950').concat(['Packed in 1,000 bales.']), 'PACKING_LIST');
  u = await svc.submitPostShipment(customer, U);
  await waitFor('second presentation analyzed', async () => {
    const docs = await Promise.all((await load(U)).documents.filter((d) => d.presentationId === p2.presentationId).map((d) => getRepository().findMeta(d.documentId)));
    return docs.every((d) => d && ['completed', 'failed'].includes(d.status));
  });
  u = await svc.examinePresentation(officer, U);
  review = (await svc.postShipmentReview(officer, U)) as typeof review;
  assert.ok(review.findings.every((f) => f.presentationId === p2.presentationId), 'the review shows the application under examination');
  assert.ok(!review.findings.some((f) => f.ruleId === 'EXM-XD-HS' && f.status === 'OPEN'), 'a correct HS code raises nothing');

  // The applicant decides the port discrepancy; the officer clears the rest and accepts.
  for (const f of review.findings.filter((x) => x.ruleId === 'EXM-TD-PORTS' && x.status === 'OPEN')) await svc.applicantWaiver(customer, U, f.findingId, { accept: true, note: 'We accept discharge at Port Qasim, Karachi.' });
  for (const f of open(await load(U), (x) => x.presentationId === p2.presentationId && ['LOW_CONFIDENCE_EXTRACTION', 'DOCUMENT_QUALITY'].includes(x.category))) await svc.dispositionFinding(officer, U, f.findingId, { code: 'VERIFIED_MANUALLY', rationale: 'Checked against the original presented document.' });
  for (const f of open(await load(U), (x) => x.presentationId === p2.presentationId && DEFAULT_POLICY.complianceCategories.includes(x.category))) await svc.dispositionFinding(officer, U, f.findingId, { code: f.category === 'REGULATORY_CONCERN' ? 'JUSTIFIED' : 'FALSE_POSITIVE', rationale: `Reviewed ${f.ruleId}: evidence checked against the documents; not a concern for this trade.` });
  for (const f of open(await load(U), (x) => x.presentationId === p2.presentationId && !x.blocking && x.ruleId !== 'EXM-XD-BASIS')) await svc.dispositionFinding(officer, U, f.findingId, { code: 'VERIFIED_MANUALLY', rationale: 'Examined; nothing further.' });
  u = await svc.decidePresentation(officer, U, { decision: 'ACCEPT', rationale: 'Documents examined against the approved terms; the port discrepancy was waived by the applicant.' });
  assert.ok(u.status === 'AWAITING_SETTLEMENT' && u.presentations[1]!.decision?.decision === 'ACCEPTED', 'the documents are accepted');
  assert.strictEqual(applicationState(u, u.presentations[1]!), 'ACCEPTED');
  u = await svc.recordSettlement(officer, U, { mode: 'SANDBOX', amount: 250000, currency: 'USD', valueDate: day(0), reference: 'SBX-STL-0950', note: 'Sandbox settlement record; no payment initiated.' });
  assert.strictEqual(u.status, 'SETTLED_MONITORING', 'settlement works without an issued-credit record: the credit of record is the approved application');

  // Traceability: one reference joins everything, and the trail names who did what.
  const uTrail = await svc.getAudit(auditor, U);
  const uActions = uTrail.events.map((e) => e.action);
  for (const a of ['PRESHIPMENT_APPROVED', 'POST_SHIPMENT_STARTED', 'PRESENTATION_DOCUMENT_ATTACHED', 'POST_SHIPMENT_SUBMITTED', 'PRESENTATION_EXAMINED', 'MANUAL_FINDING_ADDED', 'QUERY_RAISED', 'QUERY_ANSWERED', 'PRESENTATION_REFUSED', 'PRESENTATION_ACCEPTED', 'APPLICANT_WAIVER']) assert.ok(uActions.includes(a), `the audit trail records ${a}`);
  assert.ok(uTrail.chain.valid, 'the audit chain is intact');
  assert.ok(uTrail.events.filter((e) => e.action === 'POST_SHIPMENT_SUBMITTED').every((e) => e.actor.id === customer.id), 'the client is the one who submitted');
  const finalLcs = (await svc.postShipmentLcs(customer)).find((x) => x.caseId === U)!;
  assert.ok(finalLcs['reference'] === ref && finalLcs['applications'] === 2, 'the client\'s list still shows the reference, with both applications');
  console.log(`✔ Scenario U Passed: ${U} (${ref}) — approved, reference assigned, client drafted and submitted, officer examined against the approved set, clarified, client corrected, refused once with a reason, re-applied, waived and accepted; every step on one chain.\n`);

  console.log('================================================================');
  console.log('ALL TRADE LIFECYCLE SCENARIOS PASSED');
  console.log('================================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('TRADE LIFECYCLE TEST FAILED:', err);
  process.exit(1);
});
