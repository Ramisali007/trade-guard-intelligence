import './test-env';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { setProviderForTesting } from '../ai';
import { config } from '../config';
import { ComplianceStore } from '../compliance/db/compliance-store';
import { readPdfTextItems } from '../document-processing/extractors/pdf.extractor';
import { initHostPayloadRepository } from '../host-payload/host-payload.repository';
import { deliverToHost, payloadPdfUrl, payloadUrl, sha256Hex, type DeliveryInput } from '../host-payload/host-payload.service';
import { escapeHtml, renderHostPage } from '../host-payload/host-payload-page';
import type { AuthenticatedUser } from '../middleware/auth.middleware';
import { signBankingToken } from '../middleware/auth.middleware';
import { findDemoAccount, initAccountDirectory, type DemoAccountKey } from '../services/account-directory';
import { CustomerRepository } from '../services/customer.repository';
import { getRepository, initRepository } from '../services/document.repository';
import { getDocumentService, type UploadedFile } from '../services/document.service';
import { getTradeCaseRepository, initTradeCaseRepository, verifyChain } from '../trade-cases/trade-case.repository';
import { getTradeCaseService } from '../trade-cases/trade-case.service';
import { DEFAULT_POLICY } from '../trade-cases/workflow.policy';
import { FakeReviewAi } from './fake-ai';

/**
 * The host payload: approving a pre-shipment request makes one PDF with the case in it, stored in the database with its
 * link; "Send to host" creates the TI reference once, issues the copy that carries it and records the delivery; the host
 * opens the PDF from the link without signing in. What it proves: the PDF says what the case says (read back from the
 * PDF itself, page by page); the link serves exactly the stored bytes and nothing for a wrong token; the TI reference is
 * unique and never changes on a second send; each step is in the audit chain; a failed delivery is reported and keeps the
 * reference; and who may see or send it. Synthetic data; the stores are in memory; no network.
 */

const svc = getTradeCaseService();
const as = (key: DemoAccountKey): AuthenticatedUser => ({ ...findDemoAccount(key)!, tokenType: 'BEARER' });
const customer = as('corporate_customer');
const maker = as('trade_maker');
const auditor = as('trade_auditor');
const load = async (id: string) => (await getTradeCaseRepository().findById(id))!;

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

const allText = async (pdf: Buffer): Promise<{ text: string; pages: number }> => {
  const pages = await readPdfTextItems(pdf);
  return { text: pages.map((p) => p.map((i) => i.str).join(' ')).join('\n'), pages: pages.length };
};

/** A request submitted from the clean sample set, scrutinized and approved by the trade maker. Returns the case id. */
async function approvedRequest(round: number): Promise<string> {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), `host-payload-${round}-`));
  execFileSync(process.execPath, [require.resolve('tsx/cli'), path.resolve(__dirname, '../../scripts/generate-sample-documents.ts'), `--out=${out}`, `--round=${round}`], { stdio: 'pipe' });
  const application = {
    applicant: { name: 'Kamran Textiles (Pvt) Ltd', address: 'Plot 12, Sector 15, Korangi Industrial Area, Karachi 74900', country: 'Pakistan' },
    beneficiary: { name: 'Brasil Cotton Exports Ltda', address: 'Rua Augusta 1500, Sao Paulo, SP 01304-001', country: 'Brazil' },
    purpose: 'Raw material for the spinning unit',
    proformaInvoiceNumber: `PI-2026-0${715 + round - 1}`,
    currency: 'USD', amount: 250000, amountTolerancePercent: 0,
    goodsDescription: 'RAW COTTON FIBRE, NOT CARDED OR COMBED, GRADE A', hsCode: '5201.0010', quantity: 100000, unitOfMeasure: 'KG', unitPrice: 2.5,
    incoterm: 'CFR', namedPlace: 'Karachi', countryOfOrigin: 'Brazil', portOfLoading: 'Santos', portOfDischarge: 'Karachi',
    partialShipments: 'NOT_ALLOWED', transshipment: 'NOT_ALLOWED', latestShipmentDate: '2026-12-15', expiryDate: '2027-01-31', presentationPeriodDays: 21,
    paymentTerms: 'SIGHT', usanceDays: null,
    requiredDocuments: ['COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'PACKING_LIST', 'CERTIFICATE_OF_ORIGIN', 'INSPECTION_CERTIFICATE'],
  };
  const caseId = (await svc.createCase(customer, { clientRequestId: `HOSTPAYLOAD-${round}`, application })).tradeCase.caseId;
  const dir = path.join(out, 'A_clean_set');
  for (const name of fs.readdirSync(dir).sort()) {
    const type = name.includes('Proforma') ? 'PROFORMA_INVOICE' : name.includes('Contract') ? 'PURCHASE_CONTRACT' : name.includes('Order') ? 'PURCHASE_ORDER' : name.includes('Permit') ? 'IMPORT_PERMIT' : 'LC_APPLICATION_FORM';
    const { document } = await svc.attachDocument(customer, caseId, file(dir, name), type);
    if ((await getRepository().findMeta(document.documentId))?.status !== 'completed') await getDocumentService().startAnalysis(document.documentId);
  }
  await waitFor('the analysis of the documents', async () => {
    const c = await load(caseId);
    const metas = await Promise.all(c.documents.map((d) => getRepository().findMeta(d.documentId)));
    return metas.every((m) => m && (m.status === 'completed' || m.status === 'failed')) ? c : null;
  });
  await svc.submit(customer, caseId);
  await svc.startScrutiny(maker, caseId);
  const c = await waitFor('the scrutiny', async () => {
    const x = await load(caseId);
    return x.scrutinyRun && x.scrutinyRun.status !== 'RUNNING' ? x : null;
  });
  for (const f of c.findings.filter((x) => x.status === 'OPEN' && DEFAULT_POLICY.complianceCategories.includes(x.category))) {
    await svc.dispositionFinding(maker, caseId, f.findingId, { code: f.category === 'REGULATORY_CONCERN' ? 'JUSTIFIED' : 'FALSE_POSITIVE', rationale: `Reviewed ${f.ruleId}: nothing in the documents points to a concern.` });
  }
  await svc.approvePreShipment(maker, caseId, 'Documents scrutinized; they agree with one another.');
  return caseId;
}

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('Host payload: PDF at approval, link, send to host, TI reference');
  console.log('================================================================\n');
  await initRepository();
  await CustomerRepository.getInstance().init();
  await ComplianceStore.getInstance().init();
  await initTradeCaseRepository();
  await initAccountDirectory();
  const payloads = await initHostPayloadRepository();
  setProviderForTesting(new FakeReviewAi());
  // The address the host reaches, as an operator would set it.
  (config.hostPayload as { publicBaseUrl?: string }).publicBaseUrl = 'https://bank.example.pk/';

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (p: string, user: DemoAccountKey | null, init: RequestInit = {}) => {
    const res = await fetch(`${base}/api${p}`, { ...init, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${signBankingToken(findDemoAccount(user)!, 1)}` } : {}) } });
    return res;
  };

  const caseA = await approvedRequest(3);

  // ---- H1: approving makes the payload ------------------------------------------------------------------------
  let c = await load(caseA);
  assert.strictEqual(c.status, 'AUTHORIZED_FOR_ISSUANCE');
  assert.ok(c.hostPayload, 'approval makes the host payload');
  assert.strictEqual(c.hostPayload!.status, 'GENERATED');
  assert.strictEqual(c.hostPayload!.versions.length, 1);
  assert.strictEqual(c.hostPayload!.tiReference, null, 'no TI reference before the payload is sent');
  assert.strictEqual(c.hostPayload!.payloadId, caseA, 'the payload carries the case number, no number of its own');
  const stored = (await payloads.findByCase(caseA))!;
  assert.strictEqual(stored.versions.length, 1);
  const v1 = stored.versions[0]!;
  assert.strictEqual(v1.pdf.subarray(0, 5).toString(), '%PDF-', 'a PDF');
  assert.strictEqual(v1.sha256, c.hostPayload!.versions[0]!.sha256, 'the case records the fingerprint of the stored bytes');
  assert.ok(v1.pdf.length > 8_000, 'a real document, not a stub');
  const url = payloadUrl(caseA, stored.payloadId, stored.token);
  assert.ok(url.startsWith(`https://bank.example.pk/api/host-payloads/${stored.payloadId}/`), 'the link uses the configured public address, without a doubled slash');
  assert.ok(stored.token.length >= 40, 'the token is long and random');
  console.log(`✔ H1 Passed: approval made ${v1.filename} (${v1.pdf.length} bytes) and stored it with its link.`);

  // ---- H2: the PDF says what the case says --------------------------------------------------------------------
  let doc = await allText(v1.pdf);
  assert.ok(doc.pages >= 2, `more than one page (${doc.pages})`);
  for (const must of [
    caseA, 'Kamran Textiles (Pvt) Ltd', 'Brasil Cotton Exports Ltda', 'Approval decision', 'Credit terms', 'Goods and shipment',
    'Documents on the request', 'Findings and how each was settled', 'Integrity', '250,000.00', '5201.0010', 'Santos', 'Documents scrutinized; they agree with one another.',
    'Bilal Ahmed', 'Assigned when sent to the host', 'CASE REFERENCE',
  ]) assert.ok(doc.text.includes(must), `the PDF says "${must}"`);
  // One reference number for the case: no PSR- or HP- number appears anywhere in the document; only the TI reference differs.
  assert.ok(!/\bPSR-\d|\bHP-\d/.test(doc.text), 'the PDF carries no second or third reference number');
  assert.deepStrictEqual([...new Set(doc.text.match(/\bT[CI]-\d{4}-\d+/g) ?? [])], [caseA], 'before sending, the only reference number is the case number');
  assert.ok(doc.text.replace(/\s+/g, '').includes(url.replace(/\s+/g, '')), 'the link is written on the PDF');
  for (const d of c.documents) assert.ok(doc.text.includes(d.filename.slice(0, 30)), `the PDF lists ${d.filename}`);
  assert.ok(/Page 1 of \d+/.test(doc.text) && doc.text.includes(`Page ${doc.pages} of ${doc.pages}`), 'every page is numbered');
  console.log(`✔ H2 Passed: the ${doc.pages}-page PDF carries the parties, terms, goods, documents, findings, approval and the link.`);

  // ---- H3: who sees what --------------------------------------------------------------------------------------
  await assert.rejects(svc.hostPayloadView(customer, caseA), /permission|access|not found/i, 'the customer cannot read the host payload');
  await assert.rejects(svc.sendToHost(customer, caseA), /permission|access|not found/i, 'the customer cannot send it');
  const customerView = svc.toView(customer, c) as Record<string, unknown>;
  assert.ok(!('hostPayload' in customerView), 'the customer view of the case carries no host payload');
  const auditorView = await svc.hostPayloadView(auditor, caseA);
  assert.ok((auditorView['payload'] as { url: string }).url.includes(stored.token), 'the auditor may read it');
  assert.strictEqual(auditorView['canSend'], false, 'but not send it');
  await assert.rejects(svc.sendToHost(auditor, caseA), /permission/i, 'the auditor cannot send');
  const makerView = await svc.hostPayloadView(maker, caseA);
  assert.strictEqual(makerView['canSend'], true);
  assert.strictEqual(((makerView['payload'] as { opened: { count: number } }).opened.count), 0);
  assert.strictEqual((await api(`/trade-cases/${caseA}/host-payload`, 'corporate_customer')).status, 403, 'HTTP: the customer is refused');
  assert.strictEqual((await api(`/trade-cases/${caseA}/host-payload`, null)).status, 401, 'HTTP: anonymous is refused');
  assert.strictEqual((await api(`/trade-cases/${caseA}/host-payload/send`, 'trade_auditor', { method: 'POST', body: '{}' })).status, 403, 'HTTP: the auditor cannot send');
  console.log('✔ H3 Passed: the maker sends, the auditor reads, the customer and anonymous callers get nothing.');

  // ---- H4: the host opens the link ----------------------------------------------------------------------------
  const linkPath = new URL(payloadPdfUrl(caseA, stored.payloadId, stored.token)).pathname; // the payload PDF itself; the bare link is the page (H13)
  const open = await fetch(`${base}${linkPath}`);
  assert.strictEqual(open.status, 200);
  assert.strictEqual(open.headers.get('content-type'), 'application/pdf');
  assert.ok((open.headers.get('content-disposition') ?? '').startsWith('inline'), 'shown in the browser');
  assert.strictEqual(open.headers.get('cache-control'), 'no-store');
  const bytes = Buffer.from(await open.arrayBuffer());
  assert.ok(bytes.equals(v1.pdf), 'the link serves exactly the stored bytes');
  const download = await fetch(`${base}${linkPath}?download=1`);
  assert.ok((download.headers.get('content-disposition') ?? '').startsWith('attachment'), '?download=1 saves it');
  assert.strictEqual((await fetch(`${base}${linkPath.replace(stored.token, 'x'.repeat(stored.token.length))}`)).status, 404, 'a wrong token gets nothing');
  assert.strictEqual((await fetch(`${base}/api/host-payloads/TC-2026-99999/${stored.token}/a.pdf`)).status, 404, 'an unknown payload gets nothing');
  assert.strictEqual((await fetch(`${base}/api/host-payloads/${stored.payloadId}/short/a.pdf`)).status, 404, 'a malformed token gets nothing');
  const opened = (await svc.hostPayloadView(maker, caseA))['payload'] as { opened: { count: number; lastAt: string | null } };
  assert.strictEqual(opened.opened.count, 2, 'the two good opens are counted (and the bad ones are not)');
  assert.ok(opened.opened.lastAt);
  const record = (await payloads.findByCase(caseA))!;
  assert.ok(record.accessLog.every((a) => a.caller.length === 10 && !a.caller.includes('127')), 'the log keeps a hash, not the address');
  console.log('✔ H4 Passed: the link opens the stored PDF without a sign-in, a wrong token gets 404, each open is counted.');

  // ---- H5: send to the host -----------------------------------------------------------------------------------
  const sent = await svc.sendToHost(maker, caseA);
  const p1 = sent['payload'] as { status: string; tiReference: { reference: string } | null; versions: Array<{ includesTiReference: boolean }>; deliveries: Array<{ mode: string; ok: boolean; message: string }>; lastSentAt: string | null };
  const year = new Date().getUTCFullYear();
  assert.match(p1.tiReference!.reference, new RegExp(`^TI-${year}-\\d{6}$`), 'TI-YEAR-NNNNNN');
  assert.strictEqual(p1.status, 'SENT_TO_HOST');
  assert.strictEqual(p1.versions.length, 2, 'the copy that carries the reference is a second version');
  assert.strictEqual(p1.versions[1]!.includesTiReference, true);
  assert.strictEqual(p1.deliveries.length, 1);
  assert.strictEqual(p1.deliveries[0]!.mode, 'RECORDED_ONLY', 'no host endpoint is configured, and the record says so');
  assert.ok(/Nothing was posted/.test(p1.deliveries[0]!.message), 'it does not claim to have posted anything');
  assert.ok(p1.lastSentAt);
  const ti = p1.tiReference!.reference;
  const v2 = (await payloads.findByCase(caseA))!.versions[1]!;
  doc = await allText(v2.pdf);
  assert.ok(doc.text.includes(ti), 'the PDF the host gets carries the TI reference');
  assert.deepStrictEqual([...new Set(doc.text.match(/\bT[CI]-\d{4}-\d+/g) ?? [])].sort(), [caseA, ti].sort(), 'the copy for the host has exactly two reference numbers: the case number and the TI reference');
  assert.ok(!/\bPSR-\d|\bHP-\d/.test(doc.text), 'and no PSR- or HP- number');
  assert.ok(!doc.text.includes('Assigned when sent to the host'));
  if (process.env['HOST_PAYLOAD_SAMPLE_OUT']) {
    // For looking at the document: HOST_PAYLOAD_SAMPLE_OUT=<dir> writes both versions there.
    fs.mkdirSync(process.env['HOST_PAYLOAD_SAMPLE_OUT'], { recursive: true });
    fs.writeFileSync(path.join(process.env['HOST_PAYLOAD_SAMPLE_OUT'], 'v1-at-approval.pdf'), v1.pdf);
    fs.writeFileSync(path.join(process.env['HOST_PAYLOAD_SAMPLE_OUT'], 'v2-sent-to-host.pdf'), v2.pdf);
  }
  const again = (await (await fetch(`${base}${linkPath}`)).arrayBuffer()) as ArrayBuffer;
  assert.ok(Buffer.from(again).equals(v2.pdf), 'the same link now serves the copy with the reference');
  console.log(`✔ H5 Passed: sent to the host as ${ti}; the PDF carries it; the record says nothing was posted (no endpoint).`);

  // ---- H6: a second send reuses the reference -----------------------------------------------------------------
  const second = (await svc.sendToHost(maker, caseA))['payload'] as typeof p1;
  assert.strictEqual(second.tiReference!.reference, ti, 'the TI reference never changes');
  assert.strictEqual(second.versions.length, 2, 'no new version is made');
  assert.strictEqual(second.deliveries.length, 2, 'the second send is recorded');
  c = await load(caseA);
  const audit = await getTradeCaseRepository().listEvents(caseA);
  const actions = audit.map((e) => e.action);
  for (const a of ['PRESHIPMENT_APPROVED', 'HOST_PAYLOAD_GENERATED', 'HOST_REFERENCE_CREATED', 'HOST_PAYLOAD_ISSUED_WITH_REFERENCE', 'HOST_PAYLOAD_SENT']) assert.ok(actions.includes(a), `the audit trail has ${a}`);
  assert.strictEqual(actions.filter((a) => a === 'HOST_REFERENCE_CREATED').length, 1, 'the reference is created once');
  assert.ok(verifyChain(audit, c.auditHead).valid, 'the audit chain still verifies');
  console.log('✔ H6 Passed: a second send keeps the same TI reference; every step is in the verified audit chain.');

  // ---- H7: a second case gets the next reference; a download by an officer is audited -------------------------
  const caseB = await approvedRequest(4);
  const b = (await svc.sendToHost(maker, caseB))['payload'] as typeof p1;
  assert.strictEqual(Number(b.tiReference!.reference.slice(-6)), Number(ti.slice(-6)) + 1, 'the next TI number');
  const before = (await getTradeCaseRepository().listEvents(caseB)).length;
  const file1 = await svc.hostPayloadPdf(maker, caseB);
  assert.ok(file1.pdf.subarray(0, 5).toString() === '%PDF-' && file1.filename.endsWith('.pdf'));
  assert.strictEqual((await getTradeCaseRepository().listEvents(caseB)).length, before + 1, 'the download is one audit entry');
  const httpPdf = await api(`/trade-cases/${caseB}/host-payload/pdf`, 'trade_maker');
  assert.strictEqual(httpPdf.status, 200);
  assert.ok(Buffer.from(await httpPdf.arrayBuffer()).equals(file1.pdf), 'HTTP download returns the stored PDF');
  assert.strictEqual((await api(`/trade-cases/${caseB}/host-payload/pdf`, 'corporate_customer')).status, 403);
  console.log('✔ H7 Passed: the next case gets the next TI number; an officer download is audited.');

  // ---- H8: a request that is not approved has no payload ------------------------------------------------------
  const open2 = await svc.createCase(customer, { clientRequestId: 'HOSTPAYLOAD-DRAFT', application: { applicant: { name: 'Kamran Textiles (Pvt) Ltd', address: 'Karachi', country: 'Pakistan' } } as never });
  await assert.rejects(svc.generateHostPayload(maker, open2.tradeCase.caseId), /not been approved|not possible now/i);
  await assert.rejects(svc.sendToHost(maker, open2.tradeCase.caseId), /not been approved|not possible now/i);
  console.log('✔ H8 Passed: a request that is not approved cannot produce or send a payload.');

  // ---- H9: delivery to a host endpoint --------------------------------------------------------------------------
  const input: DeliveryInput = { tiReference: ti, caseId: caseA, payloadUrl: url, pdfUrl: url + "/x.pdf", sha256: 'ab', sizeBytes: 1, version: 2, generatedAt: new Date().toISOString(), approvedAt: null, applicant: 'A', beneficiary: 'B', currency: 'USD', amount: 1 };
  const hostCfg = config.hostPayload as { deliveryUrl?: string; deliveryToken?: string };
  hostCfg.deliveryUrl = 'https://host.example.pk/hook';
  hostCfg.deliveryToken = 'secret-host-token';
  let seen: { url: string; init: RequestInit } | null = null;
  const okFetch = (async (u: URL | string, init: RequestInit) => { seen = { url: String(u), init }; return new Response('{}', { status: 202 }); }) as unknown as typeof fetch;
  const ok = await deliverToHost(input, okFetch);
  assert.deepStrictEqual([ok.mode, ok.ok, ok.httpStatus], ['HTTP', true, 202]);
  const headers = (seen!.init.headers ?? {}) as Record<string, string>;
  assert.strictEqual(headers['authorization'], 'Bearer secret-host-token');
  assert.strictEqual(headers['idempotency-key'], ti, 'the host can deduplicate on the TI reference');
  const sentBody = JSON.parse(String(seen!.init.body)) as Record<string, unknown>;
  assert.strictEqual(sentBody['tiReference'], ti);
  assert.strictEqual(sentBody['payloadUrl'], url);
  assert.ok(!('pdf' in sentBody) && !JSON.stringify(sentBody).includes('secret-host-token'), 'the PDF and the host token are not in the body');
  assert.strictEqual(seen!.init.redirect, 'error', 'a redirect is not followed');
  const refused = await deliverToHost(input, (async () => new Response('no', { status: 503 })) as unknown as typeof fetch);
  assert.deepStrictEqual([refused.ok, refused.httpStatus], [false, 503]);
  assert.ok(/TI reference is kept/.test(refused.message));
  const down = await deliverToHost(input, (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
  assert.strictEqual(down.ok, false);
  assert.ok(!/ECONNREFUSED/.test(down.message), 'the failure text for the screen does not leak internals');
  hostCfg.deliveryUrl = 'ftp://nope';
  assert.strictEqual((await deliverToHost(input, okFetch)).ok, false, 'a non-http endpoint is refused');
  hostCfg.deliveryUrl = undefined;
  hostCfg.deliveryToken = undefined;
  console.log('✔ H9 Passed: delivery posts the link and TI reference with the token as a header; refusals and outages are reported, not hidden.');

  // ---- H10: a failed delivery keeps the reference and can be repeated ----------------------------------------------
  const caseC = await approvedRequest(5);
  hostCfg.deliveryUrl = 'https://127.0.0.1:1/unreachable';
  const failed = (await svc.sendToHost(maker, caseC))['payload'] as typeof p1;
  assert.strictEqual(failed.status, 'DELIVERY_FAILED');
  assert.ok(failed.tiReference, 'the reference is kept although the host could not be reached');
  assert.strictEqual(failed.deliveries[0]!.ok, false);
  const failedAudit = (await getTradeCaseRepository().listEvents(caseC)).map((e) => e.action);
  assert.ok(failedAudit.includes('HOST_PAYLOAD_SEND_FAILED') && !failedAudit.includes('HOST_PAYLOAD_SENT'));
  hostCfg.deliveryUrl = undefined;
  const retried = (await svc.sendToHost(maker, caseC))['payload'] as typeof p1;
  assert.strictEqual(retried.tiReference!.reference, failed.tiReference!.reference, 'the retry reuses the reference');
  assert.strictEqual(retried.status, 'SENT_TO_HOST');
  assert.strictEqual(retried.versions.length, 2);
  console.log('✔ H10 Passed: an unreachable host leaves DELIVERY_FAILED with the reference kept; the retry succeeds with the same reference.');

  // ---- H11: a case approved before payloads existed can have one made ----------------------------------------------
  const legacy = await approvedRequest(6);
  await getTradeCaseRepository().replace({ ...(await load(legacy)), hostPayload: null } as never, (await load(legacy)).revision);
  const made = (await svc.generateHostPayload(maker, legacy))['payload'] as { status: string; versions: unknown[] } | null;
  assert.ok(made && made.status === 'GENERATED' && made.versions.length === 1, 'the missing payload is made on request');
  const again2 = (await svc.generateHostPayload(maker, legacy))['payload'] as { versions: unknown[] };
  assert.strictEqual(again2.versions.length, 1, 'asking again does not make another');
  console.log('✔ H11 Passed: a missing payload is made on request, once.');

  // ---- H12: retiring a leaked link ---------------------------------------------------------------------------------
  // An operator deletes the stored record; the old link then gives nothing, and generating again makes a new token,
  // keeps the TI reference, and keeps counting the versions.
  const oldRecord = (await payloads.findByCase(caseA))!;
  const oldLink = new URL(payloadUrl(caseA, oldRecord.payloadId, oldRecord.token)).pathname;
  assert.strictEqual((await fetch(`${base}${oldLink}`)).status, 200, 'the link works before it is retired');
  (payloads as unknown as { records: Map<string, unknown> }).records.delete(oldRecord.payloadId);
  assert.strictEqual((await fetch(`${base}${oldLink}`)).status, 404, 'the retired link gives nothing');
  assert.strictEqual(((await svc.hostPayloadView(maker, caseA))['payload']), null, 'the screen offers to generate it again');
  const reissued = (await svc.generateHostPayload(maker, caseA))['payload'] as { url: string; tiReference: { reference: string } | null; currentVersion: number; versions: Array<{ version: number; includesTiReference: boolean }> };
  assert.notStrictEqual(new URL(reissued.url).pathname, oldLink, 'a new token');
  assert.strictEqual(reissued.tiReference!.reference, ti, 'the TI reference is kept');
  assert.strictEqual(reissued.currentVersion, 3, 'versions keep counting');
  assert.strictEqual(reissued.versions[reissued.versions.length - 1]!.includesTiReference, true, 'and the new copy carries the reference');
  assert.strictEqual((await fetch(`${base}${oldLink}`)).status, 404, 'the old link stays dead');
  assert.strictEqual((await fetch(`${base}${new URL(reissued.url).pathname}`)).status, 200, 'the new link works');
  const sentAgain = (await svc.sendToHost(maker, caseA))['payload'] as { tiReference: { reference: string } };
  assert.strictEqual(sentAgain.tiReference.reference, ti, 'sending after the retirement still reuses the reference');
  console.log('✔ H12 Passed: a retired link gives nothing; generating again makes a new token and keeps the TI reference.');

  // ---- H13: the page the host opens: references, client, payload, and the client's documents ----------------------
  const rec = (await payloads.findByCase(caseA))!;
  const pagePath = new URL(payloadUrl(caseA, rec.payloadId, rec.token)).pathname;
  const pageRes = await fetch(`${base}${pagePath}`);
  assert.strictEqual(pageRes.status, 200);
  assert.ok((pageRes.headers.get('content-type') ?? '').startsWith('text/html'), 'the link opens a page');
  const html = await pageRes.text();
  const csp = pageRes.headers.get('content-security-policy') ?? '';
  const nonce = /style-src 'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce && html.includes(`<style nonce="${nonce}">`), 'the page may use its one inline style and nothing else');
  assert.ok(/default-src 'none'/.test(csp) && !/script-src/.test(csp) && !/<script/i.test(html), 'no script, ever');
  // A nonce covers the <style> element but not style="..." attributes: a browser blocks those, so there must be none.
  assert.ok(!/\sstyle\s*=/i.test(html) && !/\son[a-z]+\s*=/i.test(html), 'no inline style attribute and no event handler');
  assert.strictEqual(pageRes.headers.get('cache-control'), 'no-store');
  const caseNow = await load(caseA);
  for (const must of [caseA, ti, 'Kamran Textiles (Pvt) Ltd', 'Brasil Cotton Exports Ltda', 'TG-CORP-1001', '250,000.00', 'RAW COTTON FIBRE', "The client's pre-shipment documents (5)", 'View PDF', 'Download PDF']) assert.ok(html.includes(must), `the page says "${must}"`);
  const preDocs = caseNow.documents.filter((d) => d.stage === 'PRE_TRADE');
  assert.strictEqual(preDocs.length, 5);
  assert.ok(!/\bPSR-\d|\bHP-\d/.test(html), 'only the case number and the TI reference');
  for (const d of preDocs) {
    assert.ok(html.includes(d.filename), `the page lists ${d.filename}`);
    const view = `${pagePath}/documents/${d.linkId}`;
    assert.ok(html.includes(`href="${view}"`) && html.includes(`href="${view}?download=1"`), `${d.filename} has View and Download`);
    // View: the stored file, shown inline.
    const shown = await fetch(`${base}${view}`);
    assert.strictEqual(shown.status, 200);
    assert.strictEqual(shown.headers.get('content-type'), 'application/pdf');
    assert.ok((shown.headers.get('content-disposition') ?? '').startsWith('inline'), 'View shows it in the browser');
    const bytes = Buffer.from(await shown.arrayBuffer());
    assert.strictEqual(sha256Hex(bytes), (await getRepository().findMeta(d.documentId))!.contentHash, 'the file the host gets is byte for byte the file the client uploaded');
    assert.ok(html.includes(sha256Hex(bytes).slice(0, 32)), 'and the fingerprint on the page is that file\'s');
    // Download.
    const saved = await fetch(`${base}${view}?download=1`);
    assert.ok((saved.headers.get('content-disposition') ?? '').startsWith('attachment') && (saved.headers.get('content-disposition') ?? '').includes(d.filename.slice(0, 20)), 'Download saves it under its own name');
    assert.ok(Buffer.from(await saved.arrayBuffer()).equals(bytes));
  }
  // Nothing outside this case's pre-shipment documents is reachable.
  assert.strictEqual((await fetch(`${base}${pagePath}/documents/NOPE-1`)).status, 404, 'an unknown document');
  assert.strictEqual((await fetch(`${base}${pagePath}/documents/..%2f..%2fetc`)).status, 404, 'a path is not a document');
  assert.strictEqual((await fetch(`${base}${pagePath.replace(rec.token, 'y'.repeat(rec.token.length))}`)).status, 404, 'a wrong token gets no page');
  assert.strictEqual((await fetch(`${base}${pagePath.replace(rec.token, 'y'.repeat(rec.token.length))}/documents/${preDocs[0]!.linkId}`)).status, 404, 'and no document');
  // The other case's token opens the other case's file under the same link id, never this case's.
  const recB = (await payloads.findByCase(caseB))!;
  const bPage = new URL(payloadUrl(caseB, recB.payloadId, recB.token)).pathname;
  const aFile = Buffer.from(await (await fetch(`${base}${pagePath}/documents/${preDocs[0]!.linkId}`)).arrayBuffer());
  const bFile = Buffer.from(await (await fetch(`${base}${bPage}/documents/${preDocs[0]!.linkId}`)).arrayBuffer());
  assert.ok(!aFile.equals(bFile), 'a link opens its own case\'s documents only');
  // A document the client added after sending, and has not yet sent to the bank, is not shown.
  const withUnsent = { ...caseNow, documents: caseNow.documents.map((d, i) => (i === 0 ? { ...d, sentToBankAt: null } : d)) };
  await getTradeCaseRepository().replace(withUnsent as never, caseNow.revision);
  const htmlUnsent = await (await fetch(`${base}${pagePath}`)).text();
  assert.ok(!htmlUnsent.includes(preDocs[0]!.filename) && htmlUnsent.includes(preDocs[1]!.filename), 'a document not yet sent to the bank is not on the host page');
  assert.strictEqual((await fetch(`${base}${pagePath}/documents/${preDocs[0]!.linkId}`)).status, 404, 'nor can it be fetched');
  // Everything is escaped.
  assert.strictEqual(escapeHtml(`<script>alert("x")</script>&'`), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;');
  const hostile = renderHostPage({
    data: { ...(await svc.hostPortalData(caseA))!, applicant: '<img src=x onerror=alert(1)>', documents: [{ linkId: 'L-1', type: 'PROFORMA_INVOICE', filename: '"><script>alert(1)</script>.pdf', version: 1, uploadedAt: new Date().toISOString(), uploadedBy: '<b>x</b>', current: true, sizeBytes: 10, sha256: null, mimeType: 'application/pdf' }] },
    basePath: '/api/host-payloads/TC-2026-00001/tok', payload: { filename: 'a.pdf', sizeBytes: 1, sha256: 'ab', version: 1, generatedAt: new Date().toISOString() }, nonce: 'n',
  });
  assert.ok(!/<img |<script|<b>x/i.test(hostile), 'a hostile name cannot add markup to the page');
  console.log('✔ H13 Passed: the link opens a page with the references, the client, the payload and all 5 documents; each can be viewed or downloaded byte for byte; nothing outside this case is reachable; everything is escaped.');

  // ---- H14: what the host opened is recorded and shown to the officer ---------------------------------------------------
  assert.strictEqual((await fetch(`${base}${new URL(payloadPdfUrl(caseA, rec.payloadId, rec.token)).pathname}`)).status, 200);
  const acts = ((await svc.hostPayloadView(maker, caseA))['payload'] as { activity: Array<{ kind: string; item: string | null }>; opened: { count: number } });
  assert.ok(acts.activity.some((a) => a.kind === 'PAGE'), 'the page opening is recorded');
  assert.ok(preDocs.every((d) => acts.activity.some((a) => a.kind === 'DOCUMENT' && a.item === d.filename)), 'each document opened is recorded by name');
  assert.ok(acts.activity.some((a) => a.kind === 'PAYLOAD_PDF'), 'and the payload PDF');
  const full = (await payloads.findByCase(caseA))!;
  assert.ok(full.accessLog.every((a) => !('ip' in a) && a.caller.length === 10), 'only a short hash of the caller is kept');
  console.log('✔ H14 Passed: every opening of the page, the payload and each document is recorded, and the officer sees what the host opened.');

  server.close();
  console.log('\n================================================================\nALL HOST PAYLOAD SCENARIOS PASSED\n================================================================');
  process.exit(0);
}

run().catch((error) => {
  console.error('HOST PAYLOAD TEST FAILED:', error);
  process.exit(1);
});
