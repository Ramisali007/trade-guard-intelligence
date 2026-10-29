// Seeds the throwaway test server (demo login on) with three cases over HTTP, the way the UI does: TC-...01 a draft, TC-...02 the
// set with mistakes submitted and scrutinised, TC-...03 approved with shipping documents (with mistakes) examined by the officer.
// Needs generated sample PDFs: `cd backend && npx tsx scripts/generate-sample-documents.ts --round=17 --out=../test-pdfs/round_17`.
//   API=http://127.0.0.1:4100/api SEED_PDFS=../../test-pdfs/round_17 node seed.cjs
const fs = require('fs');
const path = require('path');
const BASE = process.env.API || 'http://127.0.0.1:4100/api';
const PDFS = path.resolve(__dirname, process.env.SEED_PDFS || '../../test-pdfs/round_17');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(account) {
  const r = await fetch(BASE + '/auth/demo-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account }) });
  const b = await r.json();
  return b.token;
}
const call = async (token, method, url, body) => {
  const r = await fetch(BASE + url, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${t.slice(0, 300)}`);
  return j;
};
const upload = async (token, url, dir, name, documentType) => {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(dir, name))], { type: 'application/pdf' }), name);
  if (documentType) fd.append('documentType', documentType);
  const r = await fetch(BASE + url, { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: fd });
  const t = await r.text();
  if (!r.ok) throw new Error(`upload ${name} -> ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
};
const preType = (n) => (n.includes('Proforma') ? 'PROFORMA_INVOICE' : n.includes('Contract') ? 'PURCHASE_CONTRACT' : n.includes('Order') ? 'PURCHASE_ORDER' : n.includes('Permit') ? 'IMPORT_PERMIT' : 'LC_APPLICATION_FORM');
const postType = (n) => (n.includes('Commercial_Invoice') ? 'COMMERCIAL_INVOICE' : n.includes('Bill_of') ? 'BILL_OF_LADING' : n.includes('Packing') ? 'PACKING_LIST' : n.includes('Origin') ? 'CERTIFICATE_OF_ORIGIN' : 'INSPECTION_CERTIFICATE');

const application = (n) => ({
  applicant: { name: 'Kamran Textiles (Pvt) Ltd', address: 'Plot 12, Sector 15, Korangi Industrial Area, Karachi 74900', country: 'Pakistan' },
  beneficiary: { name: 'Brasil Cotton Exports Ltda', address: 'Rua Augusta 1500, Sao Paulo, SP 01304-001', country: 'Brazil' },
  purpose: 'Raw material for the spinning unit', proformaInvoiceNumber: 'PI-2026-0731', currency: 'USD', amount: 250000, amountTolerancePercent: 0,
  goodsDescription: 'RAW COTTON FIBRE, NOT CARDED OR COMBED, GRADE A', hsCode: '5201.0010', quantity: 100000, unitOfMeasure: 'KG', unitPrice: 2.5,
  incoterm: 'CFR', namedPlace: 'Karachi', countryOfOrigin: 'Brazil', portOfLoading: 'Santos', portOfDischarge: 'Karachi',
  partialShipments: 'NOT_ALLOWED', transshipment: 'NOT_ALLOWED', latestShipmentDate: '2026-12-15', expiryDate: '2027-01-31', presentationPeriodDays: 21,
  paymentTerms: 'SIGHT', usanceDays: null,
  requiredDocuments: ['COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'PACKING_LIST', 'CERTIFICATE_OF_ORIGIN', 'INSPECTION_CERTIFICATE'],
});

async function settled(token, id) {
  for (let i = 0; i < 120; i++) {
    const c = await call(token, 'GET', `/trade-cases/${id}`);
    const rp = c.readingProgress;
    if (!rp || rp.read + rp.failed >= rp.total) return c;
    await wait(500);
  }
  throw new Error('documents never settled');
}

(async () => {
  const cust = await login('corporate_customer');
  const maker = await login('trade_maker');
  const officer = await login('post_trade_officer');
  const out = {};

  // Case 3: a draft with two documents
  let r = await call(cust, 'POST', '/trade-cases', { clientRequestId: 'SEED-DRAFT', application: application(13) });
  out.draft = r.tradeCase?.caseId || r.caseId;
  const dirA = path.join(PDFS, 'A_clean_set');
  for (const n of fs.readdirSync(dirA).sort().slice(0, 2)) await upload(cust, `/trade-cases/${out.draft}/documents`, dirA, n, preType(n));

  // Case 2: the set with mistakes, submitted and scrutinised
  r = await call(cust, 'POST', '/trade-cases', { clientRequestId: 'SEED-B', application: application(12) });
  out.mistakes = r.tradeCase?.caseId || r.caseId;
  const dirB = path.join(PDFS, 'B_set_with_mistakes');
  for (const n of fs.readdirSync(dirB).sort()) await upload(cust, `/trade-cases/${out.mistakes}/documents`, dirB, n, preType(n));
  await settled(cust, out.mistakes);
  await call(cust, 'POST', `/trade-cases/${out.mistakes}/submit`, {});
  await call(maker, 'POST', `/trade-cases/${out.mistakes}/documents/analyze`, {});
  await wait(4000);

  // Case 1: the clean set approved, then shipping documents with mistakes examined
  r = await call(cust, 'POST', '/trade-cases', { clientRequestId: 'SEED-A', application: application(11) });
  out.approved = r.tradeCase?.caseId || r.caseId;
  for (const n of fs.readdirSync(dirA).sort()) await upload(cust, `/trade-cases/${out.approved}/documents`, dirA, n, preType(n));
  await settled(cust, out.approved);
  await call(cust, 'POST', `/trade-cases/${out.approved}/submit`, {});
  await call(maker, 'POST', `/trade-cases/${out.approved}/documents/analyze`, {});
  await wait(4000);
  let sc = await call(maker, 'GET', `/trade-cases/${out.approved}/scrutiny`);
  const findings = (sc.findings || sc.tradeCase?.findings || []).filter((f) => f.status === 'OPEN');
  for (const f of findings) {
    try { await call(maker, 'POST', `/trade-cases/${out.approved}/findings/${f.findingId}/disposition`, { code: 'FALSE_POSITIVE', rationale: 'Reviewed for the seed: nothing points to a concern.' }); } catch (e) { console.log('disposition skip', f.ruleId, e.message.slice(0, 120)); }
  }
  try { await call(maker, 'POST', `/trade-cases/${out.approved}/approval/preshipment`, { rationale: 'Seed approval after scrutiny.' }); } catch (e) { console.log('APPROVE FAILED', e.message.slice(0, 400)); }

  try {
    await call(cust, 'POST', `/trade-cases/${out.approved}/post-shipment`, {});
    const dirE = path.join(PDFS, 'E_post_shipment_with_mistakes');
    for (const n of fs.readdirSync(dirE).sort()) await upload(cust, `/trade-cases/${out.approved}/post-shipment/documents`, dirE, n, postType(n));
    const dirD = path.join(PDFS, 'D_post_shipment_clean'); // the rest of the set, which the mistakes set does not repeat
    for (const n of fs.readdirSync(dirD).sort().filter((x) => !/Commercial_Invoice|Bill_of/.test(x))) await upload(cust, `/trade-cases/${out.approved}/post-shipment/documents`, dirD, n, postType(n));
    await call(cust, 'POST', `/trade-cases/${out.approved}/post-shipment/submit`, {});
    await wait(5000);
    await call(officer, 'POST', `/trade-cases/${out.approved}/presentations/examine`, {});
  } catch (e) { console.log('POST SHIPMENT STEP FAILED', e.message.slice(0, 400)); }

  console.log(JSON.stringify(out));
})().catch((e) => { console.error('SEED FAILED', e.message); process.exit(1); });
