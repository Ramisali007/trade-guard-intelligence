import './test-env';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setProviderForTesting } from '../ai';
import { ComplianceStore } from '../compliance/db/compliance-store';
import { findDemoAccount, type DemoAccountKey } from '../services/account-directory';
import { CustomerRepository } from '../services/customer.repository';
import { getRepository, initRepository } from '../services/document.repository';
import { getDocumentService, type UploadedFile } from '../services/document.service';
import type { AuthenticatedUser } from '../middleware/auth.middleware';
import { classifyFinding } from '../trade-cases/post-shipment-verification';
import { getTradeCaseRepository, initTradeCaseRepository } from '../trade-cases/trade-case.repository';
import { getTradeCaseService } from '../trade-cases/trade-case.service';
import type { CaseDocumentType, TradeCase } from '../trade-cases/trade-case.types';
import { DEFAULT_POLICY } from '../trade-cases/workflow.policy';
import { FakeReviewAi } from './fake-ai';

/**
 * The generated sample documents (scripts/generate-sample-documents.ts), through the real pipeline.
 *
 *   round 1: the clean pre-shipment set is submitted, scrutinized and approved; the clean shipping documents are sent by
 *            the client and examined against what was approved: nothing may be blocking, and the set is accepted.
 *   round 2: the shipping documents with mistakes (another HS code, a short quantity, another discharge port) must be
 *            caught; the officer asks for corrections; the corrected invoice and bill of lading clear it.
 *
 * The model is the test stand-in (no network): it reads nothing into the documents, so what is checked here is the
 * local reading and the rules. The real model is expected to do no worse, but that is not shown by this test.
 */

const svc = getTradeCaseService();
const as = (key: DemoAccountKey): AuthenticatedUser => ({ ...findDemoAccount(key)!, tokenType: 'BEARER' });
const customer = as('corporate_customer');
const maker = as('trade_maker');
const officer = as('post_trade_officer');

const load = async (id: string) => (await getTradeCaseRepository().findById(id))!;
const openFindings = (c: TradeCase) => c.findings.filter((f) => f.status === 'OPEN');
const describe = (c: TradeCase) => openFindings(c).map((f) => `${f.findingId} ${f.ruleId} ${f.blocking ? '[BLOCKING]' : ''} ${f.title}`);
const postOpen = (c: TradeCase) => c.findings.filter((f) => f.stage === 'POST_TRADE' && f.status === 'OPEN');
const blockingPost = (c: TradeCase) => postOpen(c).filter((f) => classifyFinding(f) === 'BLOCKING_DISCREPANCY');

async function waitFor<T>(what: string, probe: () => Promise<T | null | false>, timeoutMs = 60_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const file = (dir: string, name: string): UploadedFile => {
  const buffer = fs.readFileSync(path.join(dir, name));
  return { originalname: name, mimetype: 'application/pdf', size: buffer.length, buffer };
};

const TYPES: Record<string, CaseDocumentType> = {
  Commercial_Invoice: 'COMMERCIAL_INVOICE',
  Bill_of_Lading: 'BILL_OF_LADING',
  Packing_List: 'PACKING_LIST',
  Certificate_of_Origin: 'CERTIFICATE_OF_ORIGIN',
  Inspection_Certificate: 'INSPECTION_CERTIFICATE',
};
const typeOf = (name: string): CaseDocumentType => Object.entries(TYPES).find(([k]) => name.includes(k))![1];

const analysed = (caseId: string) =>
  waitFor('the shipping documents to be analyzed', async () => {
    const docs = await Promise.all((await load(caseId)).documents.filter((d) => d.stage === 'POST_TRADE' && !d.supersededByLinkId).map((d) => getRepository().findMeta(d.documentId)));
    return docs.every((d) => d && ['completed', 'failed'].includes(d.status));
  });

/** Submit the clean pre-shipment set of one round as a new request, have it scrutinized and approved. */
async function approvedRequest(out: string, round: number): Promise<TradeCase> {
  // What the client confirms on the request form, as the transaction details form in the set states it (the stand-in model
  // does not read that form; the real model fills these from it).
  const application = {
    applicant: { name: 'Kamran Textiles (Pvt) Ltd', address: 'Plot 12, Sector 15, Korangi Industrial Area, Karachi 74900', country: 'Pakistan' },
    beneficiary: { name: 'Brasil Cotton Exports Ltda', address: 'Rua Augusta 1500, Sao Paulo, SP 01304-001', country: 'Brazil' },
    purpose: 'Raw material for the spinning unit',
    proformaInvoiceNumber: `PI-2026-0${715 + round - 1}`,
    currency: 'USD',
    amount: 250000,
    amountTolerancePercent: 0,
    goodsDescription: 'RAW COTTON FIBRE, NOT CARDED OR COMBED, GRADE A',
    hsCode: '5201.0010',
    quantity: 100000,
    unitOfMeasure: 'KG',
    unitPrice: 2.5,
    incoterm: 'CFR',
    namedPlace: 'Karachi',
    countryOfOrigin: 'Brazil',
    portOfLoading: 'Santos',
    portOfDischarge: 'Karachi',
    partialShipments: 'NOT_ALLOWED',
    transshipment: 'NOT_ALLOWED',
    latestShipmentDate: '2026-12-15',
    expiryDate: '2027-01-31',
    presentationPeriodDays: 21,
    paymentTerms: 'SIGHT',
    usanceDays: null,
    requiredDocuments: ['COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'PACKING_LIST', 'CERTIFICATE_OF_ORIGIN', 'INSPECTION_CERTIFICATE'],
  };
  const caseId = (await svc.createCase(customer, { clientRequestId: `SAMPLE-${round}`, application })).tradeCase.caseId;
  const preDir = path.join(out, 'A_clean_set');
  for (const name of fs.readdirSync(preDir).sort()) {
    const preType = name.includes('Proforma') ? 'PROFORMA_INVOICE' : name.includes('Contract') ? 'PURCHASE_CONTRACT' : name.includes('Order') ? 'PURCHASE_ORDER' : name.includes('Permit') ? 'IMPORT_PERMIT' : 'LC_APPLICATION_FORM';
    const { document } = await svc.attachDocument(customer, caseId, file(preDir, name), preType);
    if ((await getRepository().findMeta(document.documentId))?.status !== 'completed') await getDocumentService().startAnalysis(document.documentId);
  }
  await waitFor('the analysis of the five documents', async () => {
    const c = await load(caseId);
    const metas = await Promise.all(c.documents.map((d) => getRepository().findMeta(d.documentId)));
    return metas.every((m) => m && (m.status === 'completed' || m.status === 'failed')) ? c : null;
  });
  await svc.submit(customer, caseId);
  await svc.startScrutiny(maker, caseId);
  let c = await waitFor('the scrutiny', async () => {
    const x = await load(caseId);
    return x.scrutinyRun && x.scrutinyRun.status !== 'RUNNING' ? x : null;
  });
  console.log(`   [round ${round}] pre-shipment findings before the desk acts:`, describe(c));
  for (const f of openFindings(c).filter((x) => DEFAULT_POLICY.complianceCategories.includes(x.category))) {
    await svc.dispositionFinding(maker, caseId, f.findingId, { code: f.category === 'REGULATORY_CONCERN' ? 'JUSTIFIED' : 'FALSE_POSITIVE', rationale: `Reviewed ${f.ruleId}: nothing in the documents points to a concern.` });
  }
  c = await load(caseId);
  assert.deepStrictEqual(svc.preShipmentBlockers(c), [], `round ${round}: the clean pre-shipment set leaves nothing that stops the approval`);
  c = await svc.approvePreShipment(maker, caseId, 'Documents scrutinized; they agree with one another.');
  assert.strictEqual(c.status, 'AUTHORIZED_FOR_ISSUANCE');
  console.log(`   [round ${round}] approved ${c.preShipmentReference?.reference}`);
  return c;
}

async function sendSet(caseId: string, dir: string, only?: (name: string) => boolean): Promise<void> {
  for (const name of fs.readdirSync(dir).sort()) if (!only || only(name)) await svc.attachPresentationDocument(customer, caseId, file(dir, name), typeOf(name));
}

async function run(): Promise<void> {
  console.log('Sample documents: pre-shipment set -> approval -> post-shipment set -> examination');
  const gen = (round: number) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), `sample-docs-${round}-`));
    execFileSync(process.execPath, [require.resolve('tsx/cli'), path.resolve(__dirname, '../../scripts/generate-sample-documents.ts'), `--out=${out}`, `--round=${round}`], { stdio: 'pipe' });
    return out;
  };
  await initRepository();
  await CustomerRepository.getInstance().init();
  await ComplianceStore.getInstance().init();
  await initTradeCaseRepository();
  setProviderForTesting(new FakeReviewAi());

  // ---- round 1: everything clean
  const out1 = gen(1);
  const case1 = (await approvedRequest(out1, 1)).caseId;
  assert.ok(!(await svc.listCases(officer, { stage: 'post' })).some((x) => x.caseId === case1), 'not in the officer list before the client sends');
  await svc.startPostShipment(customer, case1);
  await sendSet(case1, path.join(out1, 'D_post_shipment_clean'));
  await svc.submitPostShipment(customer, case1);
  assert.ok((await svc.listCases(officer, { stage: 'post' })).some((x) => x.caseId === case1), 'in the officer list once sent');
  await analysed(case1);
  let c = await svc.examinePresentation(officer, case1);
  console.log('   [round 1] post-shipment findings:', postOpen(c).map((f) => `${f.ruleId} ${classifyFinding(f)} ${f.title}`));
  assert.deepStrictEqual(blockingPost(c).map((f) => `${f.ruleId}: ${f.title}`), [], 'the clean shipping documents leave no blocking discrepancy');
  assert.deepStrictEqual(postOpen(c).filter((f) => f.ruleId !== 'EXM-XD-BASIS').map((f) => f.title), [], 'and nothing else is raised either, besides the note on the basis of the examination');
  c = await svc.decidePresentation(officer, case1, { decision: 'ACCEPT', rationale: 'Documents agree with the approved application and with one another.' });
  assert.strictEqual(c.status, 'AWAITING_SETTLEMENT', 'the clean set is accepted');

  // ---- round 2: the same shipment with mistakes, then corrected
  const out2 = gen(2);
  const case2 = (await approvedRequest(out2, 2)).caseId;
  await svc.startPostShipment(customer, case2);
  const mistakes = path.join(out2, 'E_post_shipment_with_mistakes');
  const clean2 = path.join(out2, 'D_post_shipment_clean');
  await sendSet(case2, mistakes);
  await sendSet(case2, clean2, (n) => !/Commercial_Invoice|Bill_of_Lading/.test(n));
  await svc.submitPostShipment(customer, case2);
  await analysed(case2);
  c = await svc.examinePresentation(officer, case2);
  const caught = blockingPost(c).map((f) => `${f.ruleId}: ${f.title}`);
  console.log('   [round 2] blocking discrepancies caught:', caught);
  assert.ok(caught.some((t) => /EXM-XD-HS/.test(t)), 'the other HS code is caught');
  assert.ok(caught.length >= 2, 'the short quantity or value and the other discharge port are caught too');
  await assert.rejects(svc.decidePresentation(officer, case2, { decision: 'ACCEPT', rationale: 'Accepting over blocking discrepancies.' }), 'accepting over blocking discrepancies is refused');

  c = await svc.requestClarification(officer, case2, { question: 'The invoice and bill of lading differ from the approved request. Please send corrected documents.', findingIds: blockingPost(c).map((f) => f.findingId) });
  const asked = c.queries[c.queries.length - 1]!;
  const corrected = path.join(out2, 'F_post_shipment_corrected');
  const added: string[] = [];
  for (const name of fs.readdirSync(corrected).sort()) added.push((await svc.attachPresentationDocument(customer, case2, file(corrected, name), typeOf(name))).document.linkId);
  await svc.respondQuery(customer, case2, asked.queryId, { text: 'Corrected invoice and bill of lading attached.', documentLinkIds: added });
  await analysed(case2);
  c = await svc.examinePresentation(officer, case2);
  console.log('   [round 2] after the corrections:', postOpen(c).map((f) => `${f.ruleId} ${classifyFinding(f)} ${f.title}`));
  assert.deepStrictEqual(blockingPost(c).map((f) => `${f.ruleId}: ${f.title}`), [], 'the corrected documents leave nothing blocking');
  c = await svc.decidePresentation(officer, case2, { decision: 'ACCEPT', rationale: 'Corrected documents agree with the approved request.' });
  assert.strictEqual(c.status, 'AWAITING_SETTLEMENT');

  console.log('✔ Sample documents: clean sets are approved and accepted with nothing blocking; the set with mistakes is caught and cleared by the corrections.');
  process.exit(0);
}

run().catch((err) => {
  console.error('SAMPLE DOCUMENTS FLOW FAILED:', err);
  process.exit(1);
});
