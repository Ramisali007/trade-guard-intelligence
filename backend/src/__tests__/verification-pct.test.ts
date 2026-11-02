import './test-env';
import assert from 'node:assert';
import type { AuthenticatedUser } from '../middleware/auth.middleware';
import { findDemoAccount, type DemoAccountKey } from '../services/account-directory';
import { VerificationGovernance } from '../verification/governance';
import { verifyHsClaims, type GoodsClaim, type HsJudge } from '../verification/hs/hs-verifier';
import type { HsEntry, HsReference } from '../verification/hs/hs-reference';
import { parseCsv, parsePctCsv, MAX_PCT_LINES } from '../verification/pct/pct-dataset';
import { PctStore } from '../verification/pct/pct-store';

/**
 * The Pakistan Customs Tariff adapter. The data in this suite is invented for the tests: it is not the tariff.
 * What it proves: a file is accepted only if every row is valid, a dataset becomes a source only when a second
 * person approves it, a past transaction is assessed against the edition in force on its date, a file that no
 * longer matches its hash is not used, and an absent, partial or out-of-date tariff is never read as a pass.
 */

const as = (key: DemoAccountKey): AuthenticatedUser => ({ ...findDemoAccount(key)!, tokenType: 'BEARER' });
const analyst = as('risk_analyst');
const cco = as('compliance_officer');
const maker = as('trade_maker');
const customer = as('corporate_customer');

const HEADER = 'pct_code,hs6,description,unit,customs_duty_pct,regulatory_duty_pct,notes,restrictions,effective_from,effective_to';
const CSV_2024 = [
  HEADER,
  '5201.0000,520100,"Cotton, not carded or combed",kg,0,0,,,2024-07-01,',
  '5208.1100,520811,"Cotton woven fabrics, plain weave, unbleached",m2,20,0,"Note, with a comma",,2024-07-01,',
  '7208.1000,720810,"Iron or non-alloy steel flat-rolled, in coils, with patterns in relief",kg,16,0,,"Import permit required (invented for the test)",2024-07-01,',
].join('\n');
// A later edition: the cotton line is withdrawn from the end of 2026 and replaced by a differently coded one.
const CSV_2026 = [
  HEADER,
  '5201.0000,520100,"Cotton, not carded or combed",kg,0,0,,,2024-07-01,2026-12-31',
  '5201.0010,520100,"Cotton, not carded or combed, raw",kg,0,1,,,2027-01-01,',
  '7208.1000,720810,"Iron or non-alloy steel flat-rolled, in coils, with patterns in relief",kg,16,0,,,2024-07-01,',
].join('\n');

const e = (code: string, text: string, unit: string | null = null): HsEntry => ({ code, level: code.length as 2 | 4 | 6, text, parent: null, unit });
const reference = (): HsReference => ({
  available: true,
  entries: new Map([e('52', 'Cotton'), e('5201', 'Cotton; not carded or combed'), e('520100', 'Cotton; not carded or combed', 'kg'), e('5208', 'Woven fabrics of cotton'), e('520811', 'Cotton; plain weave, unbleached', 'm2'), e('72', 'Iron and steel'), e('7208', 'Iron or non-alloy steel; flat-rolled products'), e('720810', 'Iron or non-alloy steel; in coils, hot-rolled', 'kg')].map((x) => [x.code, x])),
  retrievedAt: '2026-10-01T00:00:00Z',
  contentHash: 'fixture-hash-0123456789',
  publishedOn: null,
  datasetVersion: 'synthetic-fixture',
  md5Verified: null,
  stale: false,
  origin: 'TEST_FIXTURE',
});

const claim = (over: Partial<GoodsClaim>): GoodsClaim => ({ documentId: 'doc-1', filename: '01_Proforma.pdf', documentType: 'PROFORMA_INVOICE', line: 1, description: 'Raw cotton fibre, not carded or combed', hsCode: '5201.0000', unit: 'KGS', ...over });
const judge: HsJudge = async () => ({ verdict: 'INCOMPATIBLE', reason: 'second opinion: different goods' });
const ctxAt = (store: PctStore, date: string) => ({ reference: reference(), judge, now: new Date('2026-10-26T10:00:00Z'), transactionDate: date, pct: (code: string, asOf: string) => store.lookup(code, asOf) });

function expectThrows(fn: () => unknown, status: number, label: string): void {
  try {
    fn();
  } catch (error) {
    assert.strictEqual((error as { status?: number }).status, status, `${label}: expected ${status}, got ${(error as { status?: number }).status} (${String(error).slice(0, 100)})`);
    return;
  }
  assert.fail(`${label}: expected a refusal`);
}

const meta = (csv: string, over: Record<string, unknown> = {}) => ({ csv, version: 'Synthetic edition 2024', publisher: 'Test publisher', sourceReference: 'Invented for the automated tests', publicationDate: '2026-09-15', scope: 'FULL_TARIFF', licenceNote: 'Synthetic data; no license is involved.', licenceConfirmed: true, ...over });

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('Pakistan Customs Tariff adapter (synthetic test data only)');
  console.log('================================================================\n');
  const gov = VerificationGovernance.getInstance();
  gov.resetForTesting();
  const store = PctStore.getInstance();
  store.resetForTesting();

  // ------------------------------------------------------------------ 1. the file format
  const ok = parsePctCsv(CSV_2024);
  assert.deepStrictEqual(ok.errors, []);
  assert.strictEqual(ok.lines.length, 3);
  assert.strictEqual(ok.lines[0]!.pctCode, '52010000', 'dots are removed from the code');
  assert.strictEqual(ok.lines[1]!.notes, 'Note, with a comma', 'a quoted field keeps its comma');
  assert.strictEqual(ok.lines[1]!.customsDutyPct, 20);
  assert.strictEqual(ok.lines[2]!.restrictions, 'Import permit required (invented for the test)');
  assert.deepStrictEqual(parseCsv('﻿a,b\r\n"x ""y""",\n"line\nbreak",z'), [['a', 'b'], ['x "y"', ''], ['line\nbreak', 'z']], 'a BOM, CRLF, doubled quotes and a line break inside quotes are read correctly');
  const bad = (rows: string[]) => parsePctCsv([HEADER, ...rows].join('\n')).errors.map((x) => x.message).join(' | ');
  assert.match(bad(['5201.00,520100,Cotton,kg,0,0,,,2024-07-01,']), /pct_code must be 8 digits/);
  assert.match(bad(['52010000,520200,Cotton,kg,0,0,,,2024-07-01,']), /not the first six digits/);
  assert.match(bad(['52010000,520100,Cotton,kg,0,0,,,2024-13-01,']), /effective_from must be a date/);
  assert.match(bad(['52010000,520100,Cotton,kg,0,0,,,2025-01-01,2024-01-01']), /effective_to is before effective_from/);
  assert.match(bad(['52010000,520100,Cotton,kg,900,0,,,2024-01-01,']), /customs_duty_pct must be a number from 0 to 500/);
  assert.match(bad(['52010000,520100,Cotton,kg,0,0,,,2024-01-01,', '52010000,520100,Cotton again,kg,0,0,,,2024-01-01,']), /given twice/);
  assert.match(parsePctCsv('pct_code,description\n52010000,Cotton').errors[0]!.message, /Required column\(s\) missing: hs6, effective_from/);
  assert.strictEqual(parsePctCsv([HEADER, '52010000,520100,Cotton,kg,0,0,,,2024-01-01,', '5201,520100,Bad,kg,0,0,,,2024-01-01,'].join('\n')).lines.length, 0, 'one bad row means no line is accepted: a half-read tariff never becomes a source');
  assert.ok(MAX_PCT_LINES >= 20_000);
  console.log('✔ Scenario 1 Passed: the CSV is read strictly; any invalid row rejects the whole file.\n');

  // ------------------------------------------------------------------ 2. permissions, dual control, hash
  expectThrows(() => store.submit(maker, meta(CSV_2024)), 403, 'a trade maker submitting');
  expectThrows(() => store.submit(customer, meta(CSV_2024)), 403, 'a customer submitting');
  expectThrows(() => store.submit(analyst, meta(CSV_2024, { licenceConfirmed: false })), 400, 'without the license confirmation');
  expectThrows(() => store.submit(analyst, meta(CSV_2024, { scope: 'MOSTLY' })), 400, 'without stating full tariff or extract');
  expectThrows(() => store.submit(analyst, meta('pct_code,hs6\n1,2')), 400, 'an unreadable file');
  const submitted = store.submit(analyst, meta(CSV_2024));
  assert.strictEqual(submitted.status, 'SUBMITTED');
  assert.strictEqual(submitted.origin, 'BANK_SUPPLIED');
  assert.ok(/^PCT-\d{8}-[0-9a-f]{8}$/.test(submitted.datasetId) && submitted.lineCount === 3 && submitted.coverageFrom === '2024-07-01' && submitted.coverageTo === null);
  expectThrows(() => store.submit(analyst, meta(CSV_2024)), 409, 'the same file twice');
  assert.strictEqual(store.lookup('52010000', '2026-10-20').available, false, 'a submitted dataset is not a source until it is approved');
  expectThrows(() => store.decide(analyst, submitted.datasetId, true, 'I approve my own submission.'), 403, 'an analyst without approval authority');
  const soloCco = store.submit(cco, meta(`${CSV_2024}
5209.0000,520900,"Woven cotton fabric",m2,20,0,,,2024-07-01,`, { version: 'Submitted by the policy owner' }));
  expectThrows(() => store.decide(cco, soloCco.datasetId, true, 'Approving the file I submitted myself.'), 403, 'the submitter approving their own dataset');
  expectThrows(() => store.decide(cco, submitted.datasetId, true, 'short'), 400, 'a rationale of fewer than ten characters');
  const approved = store.decide(cco, submitted.datasetId, true, 'Checked against the FBR publication; lines sampled.');
  assert.strictEqual(approved.status, 'APPROVED');
  assert.ok(approved.decidedBy?.id === cco.id && approved.ingestedBy.id === analyst.id, 'who submitted and who approved are both recorded');
  expectThrows(() => store.decide(cco, submitted.datasetId, true, 'Approving it a second time.'), 409, 'deciding twice');
  console.log('✔ Scenario 2 Passed: submission needs the permission and a license statement; approval needs a different person.\n');

  // ------------------------------------------------------------------ 3. what the dataset says, on a date
  const found = store.lookup('52010000', '2026-10-20');
  assert.ok(found.available && found.outcome === 'FOUND' && found.line.description === 'Cotton, not carded or combed');
  const missing = store.lookup('99999999', '2026-10-20');
  assert.ok(missing.available && missing.outcome === 'NOT_FOUND');
  const before = store.lookup('52010000', '2020-01-01');
  assert.strictEqual(before.available, false, 'no approved dataset covers a date before its coverage begins');
  assert.match((before as { reason: string }).reason, /No approved tariff dataset covers 2020-01-01/);
  console.log('✔ Scenario 3 Passed: an approved dataset answers for the dates it covers and says so when it does not.\n');

  // ------------------------------------------------------------------ 4. editions, effective dates, retirement
  const reviewer = as('compliance_reviewer');
  const edition2026 = store.submit(reviewer, meta(CSV_2026, { version: 'Synthetic edition 2026', publicationDate: '2026-10-10' }));
  store.decide(cco, edition2026.datasetId, true, 'Checked the withdrawn and the new cotton line against the notification.');
  const at = (code: string, date: string) => store.lookup(code, date) as { available: true; outcome: string; dataset: { version: string } };
  assert.ok(at('52010000', '2026-10-20').outcome === 'FOUND' && at('52010000', '2026-10-20').dataset.version === 'Synthetic edition 2026', 'the most recently published approved edition answers');
  assert.strictEqual(at('52010000', '2027-02-01').outcome, 'NOT_IN_FORCE', 'a line the later edition ended is not in force afterwards');
  assert.strictEqual(at('52010010', '2026-10-20').outcome, 'NOT_IN_FORCE', 'and a line that starts later is not in force before');
  assert.strictEqual(at('52010010', '2027-02-01').outcome, 'FOUND');
  store.retire(cco, edition2026.datasetId, 'Superseded by the corrected edition.');
  assert.ok(at('52010000', '2027-02-01').outcome === 'FOUND' && at('52010000', '2027-02-01').dataset.version === 'Synthetic edition 2024', 'a retired edition no longer answers');
  const kept = store.list().find((d) => d.datasetId === edition2026.datasetId)!;
  assert.ok(kept.status === 'RETIRED' && kept.contentHash === edition2026.contentHash && kept.lineCount === 3, 'but it is kept with its hash, so an assessment made against it can be reproduced');
  expectThrows(() => store.retire(maker, edition2026.datasetId, 'A maker cannot retire a dataset.'), 403, 'a maker retiring');
  expectThrows(() => store.retire(cco, edition2026.datasetId, 'Retiring it a second time.'), 409, 'retiring twice');
  console.log('✔ Scenario 4 Passed: lines carry effective dates, the newest approved edition answers, and a retired edition is kept.\n');

  // ------------------------------------------------------------------ 5. a file or a log that cannot be trusted
  const files = (store as unknown as { memoryFiles: Map<string, string> }).memoryFiles;
  files.set(submitted.datasetId, `${CSV_2024}\n5201.0099,520100,"Added afterwards",kg,0,0,,,2024-07-01,`);
  const tampered = store.lookup('52010000', '2026-10-20');
  assert.strictEqual(tampered.available, false, 'a file that no longer matches its hash is not used');
  assert.strictEqual(store.health().state, 'UNAVAILABLE');
  assert.match(store.health().lastError ?? '', /does not match the hash/);
  files.set(submitted.datasetId, CSV_2024);
  assert.ok(store.lookup('52010000', '2026-10-20').available, 'restoring the file restores the dataset');
  (gov as unknown as { entries: Array<{ rationale: string }> }).entries[0]!.rationale = 'Edited afterwards.';
  assert.strictEqual(store.lookup('52010000', '2026-10-20').available, false, 'a governance log that fails its integrity check approves nothing');
  gov.resetForTesting();
  store.resetForTesting();
  console.log('✔ Scenario 5 Passed: a tampered file or decision log is never used as a source.\n');

  // ------------------------------------------------------------------ 6. what the verifier does with each outcome
  const install = (csv: string, over: Record<string, unknown> = {}) => {
    const submittedFile = store.submit(analyst, meta(csv, over));
    return store.decide(cco, submittedFile.datasetId, true, 'Approved for the test of the verifier.');
  };
  const date = '2026-10-20T00:00:00Z';

  // 6a. a full tariff
  install(CSV_2024);
  const fits = await verifyHsClaims([claim({})], ctxAt(store, date));
  const fit = fits.results[0]!;
  assert.strictEqual(fit.status, 'CONSISTENT');
  assert.ok(fit.evidence.some((ev) => ev.sourceId === 'PAKISTAN-CUSTOMS-TARIFF' && ev.recordId === '52010000' && ev.origin === 'BANK_SUPPLIED' && ev.datasetVersion === 'Synthetic edition 2024' && ev.publishedOn === '2026-09-15'), 'the tariff line is evidence, with its dataset version, publication date and origin');
  assert.ok(fit.evidence.find((ev) => ev.sourceId === 'PAKISTAN-CUSTOMS-TARIFF')!.excerpt.includes('customs duty 0%'));
  assert.ok(fit.limitations.some((l) => /not proof that the duty/.test(l)) && !fit.limitations.some((l) => /No approved Pakistan/.test(l)), 'the limits say what the dataset cannot prove');
  assert.deepStrictEqual(fits.module.sourcesConsulted, ['UN-HS-REFERENCE', 'PAKISTAN-CUSTOMS-TARIFF']);
  assert.ok(fits.module.notChecked.some((n) => /Duties, permits and import eligibility/.test(n)));

  // 6b. a line the full tariff does not have, under a real international heading
  const absent = await verifyHsClaims([claim({ hsCode: '5201.0099' })], ctxAt(store, date));
  const gone = absent.results.find((r) => r.ruleId === 'EXT-PCT-VALID')!;
  assert.ok(gone && gone.status === 'DISCREPANCY' && gone.severity === 'HIGH' && gone.blocking && gone.customerFixable, 'a line missing from a full tariff is a blocking discrepancy the customer can fix');
  assert.match(gone.explanation, /not a finding of wrongdoing/);
  assert.ok(absent.results.some((r) => r.ruleId === 'EXT-HS-CLASS' && r.status === 'CONSISTENT'), 'the international check is reported on its own');

  // 6c. a recorded condition
  const steel = await verifyHsClaims([claim({ description: 'Iron or steel flat-rolled coil', hsCode: '7208.1000', unit: 'KGS' })], ctxAt(store, date));
  const condition = steel.results.find((r) => r.ruleId === 'EXT-PCT-RESTRICTION')!;
  assert.ok(condition && condition.status === 'POTENTIALLY_RESTRICTED' && !condition.blocking && !condition.customerFixable && condition.humanReviewRequired, 'a condition on the line goes to an officer and never blocks by itself');
  assert.ok(/not a legal determination/.test(condition.explanation) && /Import permit required/.test(condition.explanation));

  // 6d. a six-digit claim does not pretend to be checked at the national line
  const six = await verifyHsClaims([claim({ hsCode: '520100' })], ctxAt(store, date));
  assert.ok(!six.results.some((r) => r.ruleId.startsWith('EXT-PCT')), 'no national result for a six-digit declaration');
  assert.ok(six.module.notChecked.some((n) => /no document states an 8-digit tariff code/.test(n)));
  store.resetForTesting();
  gov.resetForTesting();

  // 6e. an extract: absence proves nothing
  install(CSV_2024, { scope: 'EXTRACT', version: 'Extract' });
  const extract = await verifyHsClaims([claim({ hsCode: '5201.0099' })], ctxAt(store, date));
  const partial = extract.results.find((r) => r.ruleId === 'EXT-PCT-VALID')!;
  assert.ok(partial.status === 'HUMAN_REVIEW_REQUIRED' && !partial.blocking && !partial.customerFixable && /EXTRACT/.test(partial.explanation), 'a line missing from an extract goes to an officer and does not block');
  store.resetForTesting();
  gov.resetForTesting();

  // 6f. a line that is not in force on the date
  install(CSV_2026, { version: 'Edition 2026' });
  const ended = await verifyHsClaims([claim({})], ctxAt(store, '2027-02-01T00:00:00Z'));
  const notInForce = ended.results.find((r) => r.ruleId === 'EXT-PCT-VALID')!;
  assert.ok(notInForce.status === 'DISCREPANCY' && /not in force/.test(notInForce.title) && /2027-02-01/.test(notInForce.explanation), 'a withdrawn line is reported against the transaction date');
  const asItWas = await verifyHsClaims([claim({})], ctxAt(store, '2026-06-01T00:00:00Z'));
  assert.ok(!asItWas.results.some((r) => r.ruleId === 'EXT-PCT-VALID'), 'the same code is fine as at an earlier date: assessments are dated to the transaction');
  store.resetForTesting();
  gov.resetForTesting();

  // 6g. an old dataset is used but says so
  install(CSV_2024, { publicationDate: '2026-03-01', version: 'Old edition' });
  const old = await verifyHsClaims([claim({})], ctxAt(store, date));
  assert.ok(old.results[0]!.evidence.find((ev) => ev.sourceId === 'PAKISTAN-CUSTOMS-TARIFF')!.stale && old.results[0]!.limitations.some((l) => /older than 120 days/.test(l)), 'a dataset published long ago is flagged as possibly predating later notifications');
  store.resetForTesting();
  gov.resetForTesting();

  // 6h. no dataset at all
  const none = await verifyHsClaims([claim({})], ctxAt(store, date));
  assert.strictEqual(none.results[0]!.status, 'CONSISTENT', 'the international check still runs');
  assert.ok(none.results[0]!.limitations.some((l) => /No approved Pakistan Customs Tariff dataset has been supplied/.test(l)), 'and the result says the national tariff was not checked');
  assert.ok(none.module.notChecked.some((n) => /no approved Pakistan Customs Tariff dataset/.test(n)) && none.module.sourcesConsulted.length === 1);
  console.log('✔ Scenario 6 Passed: every tariff outcome is its own result with its limits; a missing or partial tariff is never a pass.\n');

  // ------------------------------------------------------------------ 7. source health and labeling
  assert.ok(/No approved dataset/.test(store.health().lastError ?? '') && store.health().state === 'NOT_LOADED');
  const waiting = store.submit(analyst, meta(CSV_2024));
  assert.match(store.health().lastError ?? '', /waiting for approval/);
  store.decide(cco, waiting.datasetId, true, 'Approved so the health view can be checked.');
  const health = store.health();
  assert.ok(health.state === 'CURRENT' && health.recordCount === 3 && health.datasetVersion === 'Synthetic edition 2024' && health.publishedOn === '2026-09-15' && health.contentHash === waiting.contentHash);
  store.resetForTesting();
  gov.resetForTesting();
  store.installForTesting(parsePctCsv(CSV_2024).lines);
  const synthetic = await verifyHsClaims([claim({})], ctxAt(store, date));
  const tariffEvidence = synthetic.results[0]!.evidence.find((ev) => ev.sourceId === 'PAKISTAN-CUSTOMS-TARIFF')!;
  assert.ok(tariffEvidence.origin === 'SYNTHETIC_TEST' && /SYNTHETIC TEST DATASET/.test(tariffEvidence.sourceName), 'test data is labeled as test data on its evidence');
  store.resetForTesting();
  console.log('✔ Scenario 7 Passed: source health shows what is loaded; synthetic data is labeled synthetic.\n');

  console.log('================================================================');
  console.log('ALL PAKISTAN CUSTOMS TARIFF ADAPTER SCENARIOS PASSED');
  console.log('================================================================');
}

run().catch((error) => {
  console.error('PCT TEST FAILED:', error);
  process.exit(1);
});
