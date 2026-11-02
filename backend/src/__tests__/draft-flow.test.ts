import './test-env';
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import PDFDocument from 'pdfkit';
import { createApp } from '../app';
import { ComplianceStore } from '../compliance/db/compliance-store';
import { signBankingToken } from '../middleware/auth.middleware';
import { findDemoAccount, initAccountDirectory, type DemoAccountKey } from '../services/account-directory';
import { CustomerRepository } from '../services/customer.repository';
import { initRepository } from '../services/document.repository';
import { getTradeCaseRepository, initTradeCaseRepository } from '../trade-cases/trade-case.repository';
import { ABANDONED_DRAFT_MINUTES, getTradeCaseService } from '../trade-cases/trade-case.service';

/**
 * A draft is the customer's own working copy until they send it. What it proves: a draft with no document is not work
 * and is not offered for sending; the server refuses to send an empty request; one draft is one case in the customer's
 * queues however many queues could hold it (a draft is not a "clarification"); an abandoned empty draft is listed
 * nowhere; and the bank's desks do not list a customer's unsent draft (lists, queues, counts) until it is sent.
 * Synthetic accounts and data only; the stores are in memory.
 */

const svc = getTradeCaseService();
const account = (key: DemoAccountKey) => findDemoAccount(key)!;

const pdf = (lines: string[]): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(10);
    for (const l of lines) doc.text(l);
    doc.end();
  });

interface Queue {
  id: string;
  count: number;
  caseIds: string[];
  items: Array<{ caseId: string; status: string; documents: number }>;
}

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('Drafts: not work until they hold a document, private until sent');
  console.log('================================================================\n');
  await initRepository();
  await CustomerRepository.getInstance().init();
  await ComplianceStore.getInstance().init();
  await initTradeCaseRepository();
  await initAccountDirectory();

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (path: string, key: DemoAccountKey) => {
    const res = await fetch(base + path, { headers: { authorization: `Bearer ${signBankingToken(account(key), 1)}` } });
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };
  const queuesOf = async (key: DemoAccountKey) => ((await call('/workspace', key)).body!['queues'] as Queue[]) ?? [];
  const listedFor = async (key: DemoAccountKey) => ((await call('/trade-cases', key)).body!['items'] as Array<{ caseId: string }>).map((c) => c.caseId);

  try {
    const customer = { ...account('corporate_customer'), tokenType: 'BEARER' as const };
    const application = { applicant: { name: 'Kamran Textiles (Pvt) Ltd', address: '', country: 'Pakistan' } };

    // ---------------------------------------------------------------- D1 an empty draft is not work
    const empty = (await svc.createCase(customer, { clientRequestId: 'DF-1', application: application as never })).tradeCase.caseId;
    assert.deepStrictEqual(await queuesOf('corporate_customer'), [], 'a draft with no document is not work: no queue offers it');
    await assert.rejects(() => svc.submit(customer, empty), /at least one document/i, 'the server will not send an empty request');
    assert.strictEqual((await svc.getCase(customer, empty)).status, 'DRAFT', 'and it stays a draft');
    assert.ok((await listedFor('corporate_customer')).includes(empty), 'a draft started a moment ago is still listed for its customer (a first file may be on its way)');
    console.log('✔ D1 Passed: an empty draft is no work and cannot be sent.\n');

    // ---------------------------------------------------------------- D2 one draft with a document is one case
    const file = await pdf(['PROFORMA INVOICE', 'PI NO: PI-2026-0099', 'SELLER: GLOBAL COTTON TRADERS LIMITED', 'TOTAL USD 120,000.00']);
    await svc.attachDocument(customer, empty, { originalname: 'pi.pdf', mimetype: 'application/pdf', size: file.length, buffer: file } as never, 'PROFORMA_INVOICE');
    const queues = await queuesOf('corporate_customer');
    assert.deepStrictEqual(queues.map((q) => q.id), ['to-submit'], 'a draft is to be sent, not "a clarification requested by the bank"');
    assert.strictEqual(queues[0]!.items[0]!.documents, 1, 'the queue says how many documents it holds');
    assert.strictEqual(new Set(queues.flatMap((q) => q.caseIds)).size, 1, 'one draft is one case');
    console.log('✔ D2 Passed: a draft with a document waits in one queue and counts once.\n');

    // ---------------------------------------------------------------- D3 an abandoned empty draft is listed nowhere
    const abandoned = (await svc.createCase(customer, { clientRequestId: 'DF-2', application: application as never })).tradeCase.caseId;
    const repo = getTradeCaseRepository();
    const stale = (await repo.findById(abandoned))!;
    await repo.replace({ ...stale, updatedAt: new Date(Date.now() - (ABANDONED_DRAFT_MINUTES + 5) * 60_000).toISOString() }, stale.revision);
    const mine = await listedFor('corporate_customer');
    assert.ok(!mine.includes(abandoned), 'an empty draft left for a while is not listed: it is a start, not a request');
    assert.ok(mine.includes(empty), 'the draft that holds a document is');
    console.log('✔ D3 Passed: an abandoned empty draft shows nowhere.\n');

    // ---------------------------------------------------------------- D4 the bank does not see an unsent draft
    for (const key of ['trade_maker', 'trade_checker', 'compliance_officer', 'post_trade_officer'] as DemoAccountKey[]) {
      assert.ok(!(await listedFor(key)).includes(empty), `${key} does not list the customer's unsent draft`);
      assert.ok(!(await queuesOf(key)).some((q) => q.caseIds.includes(empty)), `${key} has it in no queue`);
    }
    await svc.submit(customer, empty);
    assert.ok((await listedFor('trade_maker')).includes(empty), 'once the customer sends it, the trade desk has it');
    assert.deepStrictEqual((await queuesOf('corporate_customer')).filter((q) => q.id === 'to-submit'), [], 'a sent request is no longer waiting to be sent');
    console.log('✔ D4 Passed: the bank sees a request only from the moment it is sent.\n');

    // ---------------------------------------------------------------- D5 the applicant is the company, not the person
    const person = { ...customer, name: 'Ramis', institution: 'Kamran Textiles (Pvt) Ltd · Importer' };
    const filed = await svc.createCase(person, { clientRequestId: 'DF-5', application: { applicant: { name: 'Ramis', address: '', country: 'Pakistan' } } as never });
    assert.strictEqual(filed.tradeCase.applicationVersions[0]!.data.applicant.name, 'Kamran Textiles (Pvt) Ltd', 'a customer files as their company, even when the browser sends the person\'s name');
    const spoof = await svc.createCase(person, { clientRequestId: 'DF-5b', application: { applicant: { name: 'Some Other Company Ltd', address: '', country: 'Pakistan' } } as never });
    assert.strictEqual(spoof.tradeCase.applicationVersions[0]!.data.applicant.name, 'Kamran Textiles (Pvt) Ltd', 'and cannot file as another company');
    const rm = { ...account('relationship_manager'), tokenType: 'BEARER' as const };
    const forCustomer = await svc.createCase(rm, { customerRef: 'TG-CORP-1001', clientRequestId: 'DF-6', application: {} as never });
    assert.strictEqual(forCustomer.tradeCase.applicationVersions[0]!.data.applicant.name, '', 'a relationship manager filing for a customer does not make their own desk the applicant');
    console.log('✔ D5 Passed: the applicant is the customer\'s company, never the person who typed or the bank desk that filed.\n');

    // ---------------------------------------------------------------- D6 a draft can be removed before it is sent
    const toRemove = (await svc.createCase(customer, { clientRequestId: 'DF-7', application: application as never })).tradeCase.caseId;
    await svc.attachDocument(customer, toRemove, { originalname: 'pi-remove.pdf', mimetype: 'application/pdf', size: file.length, buffer: Buffer.concat([file, Buffer.from('\n% removed draft')]) } as never, 'PROFORMA_INVOICE');
    assert.ok((await listedFor('corporate_customer')).includes(toRemove), 'the draft is listed before it is removed');
    assert.ok((await svc.getCase(customer, toRemove)).status === 'DRAFT');
    assert.ok(svc.availableActions(customer, await svc.getCase(customer, toRemove)).includes('WITHDRAW'), 'the customer is offered the removal');
    await svc.withdraw(customer, toRemove, 'Draft removed before it was sent to the bank');
    assert.ok(!(await listedFor('corporate_customer')).includes(toRemove), 'a removed draft is listed nowhere');
    assert.ok(!(await queuesOf('corporate_customer')).some((q) => q.caseIds.includes(toRemove)), 'and is in no queue');
    assert.ok(!(await listedFor('trade_maker')).includes(toRemove), 'the bank never saw it');
    assert.strictEqual((await svc.getCase(customer, toRemove)).status, 'WITHDRAWN', 'the record and its audit trail stay');
    console.log('✔ D6 Passed: a pre-shipment draft is removed before it is sent, and disappears from every list.\n');

    // ---------------------------------------------------------------- D7 a post-shipment draft can be removed, a sent one cannot
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const approvedApplication = {
      applicant: { name: 'Kamran Textiles (Pvt) Ltd', address: 'Plot 12, SITE, Karachi', country: 'Pakistan' },
      beneficiary: { name: 'Global Cotton Traders Limited', address: 'Tianhe Business Park, Guangzhou', country: 'China' },
      purpose: 'Raw material', proformaInvoiceNumber: 'PI-2026-0777', currency: 'USD', amount: 250000, amountTolerancePercent: 0,
      goodsDescription: 'Raw cotton fibre grade A', hsCode: '5201.0010', quantity: 100000, unitOfMeasure: 'KG', unitPrice: 2.5, incoterm: 'CFR', namedPlace: 'Karachi',
      countryOfOrigin: 'China', portOfLoading: 'Shanghai', portOfDischarge: 'Karachi', partialShipments: 'NOT_ALLOWED', transshipment: 'ALLOWED',
      latestShipmentDate: day(60), expiryDate: day(90), presentationPeriodDays: 21, paymentTerms: 'SIGHT', usanceDays: null,
      requiredDocuments: ['COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'PACKING_LIST'],
    };
    const approvedId = (await svc.createCase(customer, { clientRequestId: 'DF-8', application: approvedApplication as never })).tradeCase.caseId;
    const approvedCase = (await repo.findById(approvedId))!;
    const when = new Date().toISOString();
    const maker = { id: 'u', name: 'Bilal Ahmed', role: 'TRADE_MAKER' as const };
    await repo.replace({ ...approvedCase, status: 'AUTHORIZED_FOR_ISSUANCE', approvals: [{ approvalId: 'AP-01', requestedBy: maker, requestedAt: when, applicationVersion: approvedCase.currentApplicationVersion, findingsDigest: '', status: 'APPROVED', decidedBy: maker, decidedAt: when, rationale: 'Approved for the test' }] as never, preShipmentReference: { reference: approvedId, assignedAt: when, assignedBy: 'SYSTEM' } }, approvedCase.revision);

    const started = await svc.startPostShipment(customer, approvedId);
    assert.strictEqual(started.presentations[0]!.reference, `${approvedId}/P1`);
    const invoice = await pdf(['COMMERCIAL INVOICE', 'INVOICE NO: CI-2026-0042', 'TOTAL USD 250,000.00']);
    await svc.attachPresentationDocument(customer, approvedId, { originalname: 'ci.pdf', mimetype: 'application/pdf', size: invoice.length, buffer: invoice } as never, 'COMMERCIAL_INVOICE');
    assert.ok(svc.availableActions(customer, await svc.getCase(customer, approvedId)).includes('REMOVE_POST_SHIPMENT_DRAFT'), 'the customer is offered the removal of a draft application');
    await assert.rejects(() => svc.removePostShipmentDraft({ ...account('trade_maker'), tokenType: 'BEARER' }, approvedId), /./, 'the bank does not remove a client\'s draft');
    const removed = await svc.removePostShipmentDraft(customer, approvedId);
    assert.deepStrictEqual([removed.presentations.length, removed.documents.filter((d) => d.stage === 'POST_TRADE').length], [0, 0], 'the draft application and its documents are gone');
    assert.strictEqual(removed.sequences.presentation, 0, 'the number it took is given back');
    assert.strictEqual(removed.status, 'AUTHORIZED_FOR_ISSUANCE', 'the approved request itself is untouched');
    await assert.rejects(() => svc.removePostShipmentDraft(customer, approvedId), /no draft application/i, 'with nothing to remove it says so');
    assert.strictEqual((await svc.startPostShipment(customer, approvedId)).presentations[0]!.reference, `${approvedId}/P1`, 'the next application starts again as P1');
    console.log('✔ D7 Passed: a post-shipment draft can be removed with its documents; the approved request is untouched.\n');

    // ---------------------------------------------------------------- D8 the dashboard shows the cases a user worked on
    type Row = { caseId: string; parts: string[]; stage: string; draft: boolean; postShipment: { state: string } | null; lastAction: string };
    const history = async (key: DemoAccountKey) => (await call('/workspace/history', key)).body!['items'] as Row[];
    const myCases = await history('corporate_customer');
    const sentRow = myCases.find((r) => r.caseId === empty);
    assert.ok(sentRow && sentRow.parts.includes('Started the request') && sentRow.parts.includes('Sent the request to the bank'), 'the customer sees the request they started and sent, with what they did');
    assert.strictEqual(sentRow!.stage, 'PRE');
    const postRow = myCases.find((r) => r.caseId === approvedId);
    assert.ok(postRow && postRow.stage === 'POST' && postRow.postShipment?.state === 'DRAFT' && postRow.parts.includes('Started the post-shipment application'), 'and the request they took on to post-shipment, as a post-shipment case');
    assert.ok(!myCases.some((r) => r.caseId === toRemove || r.caseId === abandoned), 'a removed draft and an abandoned empty one are not history');
    assert.ok(!(await history('trade_maker')).some((r) => r.caseId === empty), 'the trade desk has no part in a case until it does something on it');
    const deskUser = { ...account('trade_maker'), tokenType: 'BEARER' as const };
    await svc.raiseQuery(deskUser, empty, { question: 'Please confirm the shipment window with the seller.', assignee: 'CUSTOMER', department: 'TRADE_OPS', findingIds: [] } as never);
    const deskRow = (await history('trade_maker')).find((r) => r.caseId === empty);
    assert.ok(deskRow && deskRow.parts.includes('Sent a message to the customer') && !deskRow.parts.includes('Sent the request to the bank'), 'once it acts, it is in the desk\'s history with the desk\'s own part only');
    assert.deepStrictEqual((await call('/workspace/history', 'system_admin')).body!['items'], [], 'a role with no trade cases has no case history');
    assert.strictEqual((await fetch(`${base}/workspace/history`)).status, 401, 'and it is not public');
    console.log('✔ D8 Passed: the dashboard history lists the cases a user worked on, pre- and post-shipment, with what they did.\n');

    // ---------------------------------------------------------------- D9 once sent, nothing is added unless the bank asks
    const unique = (tag: string) => ({ originalname: `${tag}.pdf`, mimetype: 'application/pdf', size: file.length + tag.length + 3, buffer: Buffer.concat([file, Buffer.from(`\n% ${tag}`)]) }) as never;
    const sentCase = (await svc.createCase(customer, { clientRequestId: 'DF-9', application: application as never })).tradeCase.caseId;
    const firstDoc = (await svc.attachDocument(customer, sentCase, unique('d9-first'), 'PROFORMA_INVOICE')).document;
    assert.ok(svc.availableActions(customer, await svc.getCase(customer, sentCase)).includes('ATTACH_PRETRADE_DOCUMENT'), 'in a draft, documents can be added');
    await svc.submit(customer, sentCase);
    assert.ok(!svc.availableActions(customer, await svc.getCase(customer, sentCase)).includes('ATTACH_PRETRADE_DOCUMENT'), 'once sent, the screen offers no upload');
    await assert.rejects(() => svc.attachDocument(customer, sentCase, unique('d9-late'), 'OTHER_SUPPORTING'), /with the bank/i, 'and the server refuses one');
    await assert.rejects(() => svc.retypeDocument(customer, sentCase, firstDoc.linkId, 'PURCHASE_CONTRACT'), /with the bank/i, 'nor can a sent document be re-typed');
    await assert.rejects(() => svc.removeDocument(customer, sentCase, firstDoc.linkId), /already has/i, 'nor taken away');
    await svc.raiseQuery(deskUser, sentCase, { question: 'Please send the supplier contract as well.', assignee: 'CUSTOMER', department: 'TRADE_OPS', findingIds: [] } as never);
    assert.ok(svc.availableActions(customer, await svc.getCase(customer, sentCase)).includes('ATTACH_PRETRADE_DOCUMENT'), 'when the bank asks, a document can be added');
    const extra = (await svc.attachDocument(customer, sentCase, unique('d9-asked'), 'PURCHASE_CONTRACT')).document;
    assert.strictEqual(extra.sentToBankAt, null, 'it waits to be sent with the reply');
    assert.ok(svc.availableActions(customer, await svc.getCase(customer, sentCase)).includes('REMOVE_PRETRADE_DOCUMENT'), 'and what was added but not yet sent can be taken back');
    await svc.removeDocument(customer, sentCase, extra.linkId);
    await assert.rejects(() => svc.removeDocument(customer, sentCase, firstDoc.linkId), /already has/i, 'while what the bank has stays');
    console.log('✔ D9 Passed: once documents are sent nothing is added or taken away, unless the bank asks for a correction.\n');
  } finally {
    server.close();
  }
}

run()
  .then(() => {
    console.log('================================================================');
    console.log('ALL DRAFT SCENARIOS PASSED');
    console.log('================================================================');
    process.exit(0);
  })
  .catch((error) => {
    console.error('DRAFT TEST FAILED:', error);
    process.exit(1);
  });
