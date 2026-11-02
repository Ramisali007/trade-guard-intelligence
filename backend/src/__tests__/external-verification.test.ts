import './test-env';
import assert from 'node:assert';
import { getHsReference, hsReferenceHealth, parseHsReference, searchHeadings, setHsReferenceForTesting, type HsEntry, type HsReference } from '../verification/hs/hs-reference';
import { verifyHsClaims, type GoodsClaim, type HsJudge } from '../verification/hs/hs-verifier';
import { assertAllowedUrl, retrieveSource, SourceNotAllowedError } from '../verification/retrieval';
import { SOURCE_CATALOGUE } from '../verification/source-catalogue';
import { locateValue, runExternalVerification } from '../verification/verification.service';
import { RAISES_FINDING } from '../verification/verification.types';

/**
 * External verification of HS codes against an official reference. The reference here is a small
 * synthetic list in the real file's format, so nothing depends on the network or on real data. What
 * the suite proves: a wrong code is a discrepancy for a person (never a verdict of fraud), a code that
 * fits is only "consistent", and an unavailable, stale or silent source is never read as a pass.
 */

const e = (code: string, text: string, unit: string | null = null): HsEntry => ({ code, level: code.length as 2 | 4 | 6, text, parent: code.length === 2 ? null : code.slice(0, code.length - 2), unit });
const ENTRIES: HsEntry[] = [
  e('52', 'Cotton'),
  e('5201', 'Cotton; not carded or combed'),
  e('520100', 'Cotton; not carded or combed', 'kg'),
  e('5208', 'Woven fabrics of cotton, containing 85 percent or more by weight of cotton, weighing not more than 200 g/m2'),
  e('520811', 'Cotton; plain weave, unbleached, weighing not more than 100 g/m2', 'm2'),
  e('72', 'Iron and steel'),
  e('7208', 'Iron or non-alloy steel; flat-rolled products of a width of 600mm or more, hot-rolled, not clad, plated or coated'),
  e('720810', 'Iron or non-alloy steel; in coils, flat-rolled, hot-rolled, with patterns in relief', 'kg'),
];

function reference(over: Partial<HsReference> = {}): HsReference {
  return { available: true, entries: new Map(ENTRIES.map((x) => [x.code, x])), retrievedAt: new Date().toISOString(), contentHash: 'fixture-hash-0123456789', publishedOn: null, datasetVersion: 'synthetic-fixture', md5Verified: null, stale: false, origin: 'TEST_FIXTURE', ...over };
}

const claim = (over: Partial<GoodsClaim>): GoodsClaim => ({ documentId: 'doc-1', filename: '01_Proforma.pdf', documentType: 'PROFORMA_INVOICE', line: 1, description: 'Raw cotton fibre, not carded or combed', hsCode: '5201.0010', unit: 'KGS', ...over });

let judgeCalls = 0;
const judge = (verdict: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNCLEAR'): HsJudge => async () => {
  judgeCalls += 1;
  return { verdict, reason: `second opinion: ${verdict}` };
};
const ctx = (j: HsJudge = judge('INCOMPATIBLE'), ref: HsReference = reference()) => ({ reference: ref, judge: j, now: new Date('2026-10-26T10:00:00Z'), transactionDate: '2026-10-20T00:00:00Z' });

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('External verification: HS classification against the official reference');
  console.log('================================================================\n');

  // ------------------------------------------------------------------ 1. the reference file
  const realFormat = JSON.stringify({ more: false, classCode: 'HS', results: [{ id: 'TOTAL', text: 'Total - All H6 commodities', parent: '#' }, { id: '52', text: '52 - Cotton', parent: 'TOTAL', standardUnitAbbr: 'n/a' }, { id: '520100', text: '520100 - Cotton; not carded or combed', parent: '5201', standardUnitAbbr: 'kg' }, { id: 'abc', text: 'ignored' }] });
  const parsed = parseHsReference(realFormat);
  assert.deepStrictEqual([...parsed.keys()], ['52', '520100'], 'only chapter, heading and subheading codes are kept');
  assert.strictEqual(parsed.get('52')!.text, 'Cotton', 'the code prefix is removed from the wording');
  assert.strictEqual(parsed.get('520100')!.unit, 'kg');
  assert.strictEqual(parsed.get('52')!.unit, null, '"n/a" is not a unit');
  setHsReferenceForTesting(null);
  const missing = await getHsReference();
  assert.strictEqual(missing.available, false, 'with no network and no local copy the reference is unavailable, not empty');
  assert.strictEqual(hsReferenceHealth().state, 'NOT_LOADED');
  console.log('✔ Scenario 1 Passed: the reference file is parsed strictly and an absent reference is reported as unavailable.\n');

  // ------------------------------------------------------------------ 2. a code that fits
  const fits = await verifyHsClaims([claim({})], ctx());
  const ok = fits.results[0]!;
  assert.strictEqual(ok.status, 'CONSISTENT', 'a fitting code is "consistent", never "verified"');
  assert.ok(!RAISES_FINDING.has(ok.status), 'a consistent result is not a finding');
  assert.ok(ok.evidence.some((x) => x.recordId === '520100' && x.excerpt.includes('Cotton; not carded or combed') && x.contentHash === 'fixture-hash-0123456789'), 'the official record, its wording and the file hash are kept');
  assert.ok(ok.limitations.some((l) => /national tariff extensions/.test(l)), 'digits beyond the sixth are said not to be verified');
  assert.ok(ok.limitations.some((l) => /Explanatory Notes/.test(l)), 'what the wording check cannot establish is stated');
  assert.strictEqual(judgeCalls, 0, 'no AI is asked when the wording already agrees');
  console.log('✔ Scenario 2 Passed: a fitting code is consistent, with the source record, the file hash and the limits stated.\n');

  // ------------------------------------------------------------------ 3. a code for different goods
  const wrong = await verifyHsClaims([claim({ description: 'Cotton fabric, plain weave', hsCode: '7208.10', unit: 'MTR' })], ctx(judge('INCOMPATIBLE')));
  const bad = wrong.results[0]!;
  assert.strictEqual(bad.status, 'DISCREPANCY');
  assert.strictEqual(bad.severity, 'HIGH');
  assert.ok(bad.blocking && bad.humanReviewRequired);
  assert.ok(/classification discrepancy or possible misdeclaration/.test(bad.explanation) && /not a finding of wrongdoing/.test(bad.explanation), 'a mismatch is never called fraud');
  assert.ok(bad.explanation.includes('5208'), 'the headings whose wording matches the description are offered as a lead');
  assert.ok(bad.evidence.some((x) => x.recordId === '7208') && bad.evidence.some((x) => x.recordId === '5208'), 'both the declared and the suggested official records are evidence');
  assert.ok(bad.limitations.some((l) => /AI opinion is not proof/.test(l)));
  console.log('✔ Scenario 3 Passed: cotton fabric under an iron and steel heading is a classification discrepancy for a person, with a lead to the right heading.\n');

  // ------------------------------------------------------------------ 4. the second opinion decides nothing alone
  judgeCalls = 0;
  const unclear = await verifyHsClaims([claim({ description: 'Cotton fabric', hsCode: '7208.10' })], ctx(judge('UNCLEAR')));
  assert.strictEqual(unclear.results[0]!.status, 'HUMAN_REVIEW_REQUIRED');
  assert.strictEqual(unclear.results[0]!.blocking, false, 'an unclear second opinion is routed to a person, it does not stop the case');
  const compatible = await verifyHsClaims([claim({ description: 'Cotton fabric', hsCode: '7208.10' })], ctx(judge('COMPATIBLE')));
  assert.strictEqual(compatible.results[0]!.status, 'CONSISTENT');
  assert.ok(compatible.results[0]!.limitations.some((l) => /not proof/.test(l)), 'an AI "compatible" is recorded with its limit');
  const broken: HsJudge = async () => {
    throw new Error('AI unavailable');
  };
  const down = await verifyHsClaims([claim({ description: 'Cotton fabric', hsCode: '7208.10' })], ctx(broken));
  assert.strictEqual(down.results[0]!.status, 'HUMAN_REVIEW_REQUIRED', 'when the AI is down the case is not cleared and not condemned');
  judgeCalls = 0;
  const twice = await verifyHsClaims([claim({ description: 'Cotton fabric', hsCode: '7208.10', line: 1 }), claim({ description: 'Cotton fabric', hsCode: '7208.10', line: 2, documentId: 'doc-2', documentType: 'PURCHASE_ORDER' })], ctx(judge('INCOMPATIBLE')));
  assert.strictEqual(judgeCalls, 1, 'the same description and heading are asked about once');
  assert.strictEqual(twice.results.filter((r) => r.status === 'DISCREPANCY' && r.ruleId === 'EXT-HS-CLASS').length, 2, 'but each document line is judged and reported');
  console.log('✔ Scenario 4 Passed: the AI opinion never decides alone, and an AI outage is neither a pass nor a verdict.\n');

  // ------------------------------------------------------------------ 5. codes that cannot be right
  const shapes = await verifyHsClaims(
    [claim({ hsCode: '12345', line: 1 }), claim({ hsCode: '9999.00', line: 2 }), claim({ hsCode: '5201.99', line: 3 }), claim({ hsCode: 'Not Found', line: 4 }), claim({ hsCode: null, line: 5 })],
    ctx(),
  );
  const byLine = (n: number) => shapes.results.find((r) => r.claims[0]!.field.includes(`line ${n}`));
  assert.ok(/not in a valid format/.test(byLine(1)!.title) && byLine(1)!.blocking, 'a five-digit code is malformed');
  assert.ok(/does not exist in the Harmonized System/.test(byLine(2)!.title) && byLine(2)!.severity === 'HIGH', 'an unknown heading is a discrepancy');
  assert.ok(/not in the official reference/.test(byLine(3)!.title) && !byLine(3)!.blocking, 'an unknown subheading under a real heading is flagged for review without blocking');
  assert.strictEqual(byLine(4), undefined, 'a placeholder is not a code');
  assert.ok(shapes.module.notChecked.some((n) => /2 goods lines state no HS code/.test(n)), 'lines with no code are listed as not checked');
  const generic = await verifyHsClaims([claim({ description: 'General Merchandise' })], ctx());
  assert.strictEqual(generic.results[0]!.status, 'INSUFFICIENT_EVIDENCE', 'a description that says nothing cannot be checked, and is not passed');
  console.log('✔ Scenario 5 Passed: malformed, unknown and unverifiable codes are each reported for what they are.\n');

  // ------------------------------------------------------------------ 6. across documents, and units
  const cross = await verifyHsClaims([claim({}), claim({ documentId: 'doc-2', filename: '03_PO.pdf', documentType: 'PURCHASE_ORDER', description: 'Iron coils', hsCode: '7208.10' })], ctx());
  const x = cross.results.find((r) => r.ruleId === 'EXT-HS-CROSSDOC');
  assert.ok(x && x.status === 'DISCREPANCY' && /differs between documents/.test(x.title), 'two documents that each state one different code are reported');
  const agree = await verifyHsClaims([claim({}), claim({ documentId: 'doc-2', filename: '04_Permit.pdf', documentType: 'IMPORT_PERMIT', hsCode: '5201' })], ctx());
  assert.ok(!agree.results.some((r) => r.ruleId === 'EXT-HS-CROSSDOC'), 'a 4-digit permit code and a longer invoice code in the same heading agree');
  const unit = await verifyHsClaims([claim({ unit: 'PCS' })], ctx());
  assert.ok(unit.results[0]!.limitations.some((l) => /standard unit for this heading is "kg"/.test(l)), 'a quantity unit that does not match the HS standard unit is noted');
  console.log('✔ Scenario 6 Passed: different codes across documents are reported; compatible lengths are not; unit mismatches are noted.\n');

  // ------------------------------------------------------------------ 7. a whole run
  const nothing = await runExternalVerification({ documents: [{ documentId: 'd', filename: 'a.pdf', documentType: 'PROFORMA_INVOICE', goods: [{ productDescription: 'Cotton', hsCode: 'Not Found' }] }], transactionDate: null, reference: reference(), judge: judge('INCOMPATIBLE') });
  assert.strictEqual(nothing.modules[0]!.state, 'NOT_RUN');
  assert.deepStrictEqual(nothing.results, [], 'no code, no result: nothing is claimed');
  const noSource = await runExternalVerification({ documents: [{ documentId: 'd', filename: 'a.pdf', documentType: 'PROFORMA_INVOICE', goods: [{ productDescription: 'Cotton', hsCode: '5201' }] }], transactionDate: null, reference: { available: false, error: 'offline' } });
  assert.strictEqual(noSource.modules[0]!.state, 'SOURCE_UNAVAILABLE');
  assert.strictEqual(noSource.results.length, 1);
  assert.strictEqual(noSource.results[0]!.status, 'SOURCE_UNAVAILABLE');
  assert.ok(RAISES_FINDING.has(noSource.results[0]!.status) && /NOT been verified/.test(noSource.results[0]!.explanation), 'an unavailable source is a visible finding that says nothing was verified');
  const stale = await runExternalVerification({ documents: [{ documentId: 'd', filename: 'a.pdf', documentType: 'PROFORMA_INVOICE', goods: [{ productDescription: 'Raw cotton fibre', hsCode: '5201' }] }], transactionDate: null, reference: reference({ stale: true, retrievedAt: '2026-01-01T00:00:00Z' }) });
  assert.strictEqual(stale.modules[0]!.state, 'PARTIAL', 'a reference that could not be refreshed makes the module partial');
  assert.ok(stale.results[0]!.evidence.every((ev) => ev.stale), 'its evidence is marked stale');
  assert.ok(/not presented as current/.test(stale.modules[0]!.notChecked[0]!));
  console.log('✔ Scenario 7 Passed: no code is not checked, a missing source is a finding, a stale source is partial and its evidence says so.\n');

  // ------------------------------------------------------------------ 8. retrieval policy
  assert.throws(() => assertAllowedUrl('UN-HS-REFERENCE', 'https://evil.example/HS.json'), SourceNotAllowedError, 'a host outside the catalog is refused');
  assert.throws(() => assertAllowedUrl('UN-HS-REFERENCE', 'http://comtradeapi.un.org/files/v1/app/reference/HS.json'), SourceNotAllowedError, 'plain HTTP is refused');
  assert.throws(() => assertAllowedUrl('UN-HS-REFERENCE', 'https://127.0.0.1/HS.json'), SourceNotAllowedError, 'an internal address is not a cataloged host');
  assert.throws(() => assertAllowedUrl('PAKISTAN-CUSTOMS-TARIFF', 'https://www.fbr.gov.pk/x'), SourceNotAllowedError, 'a source that is not integrated is not retrieved');
  assert.throws(() => assertAllowedUrl('NOT-A-SOURCE', 'https://comtradeapi.un.org/x'), SourceNotAllowedError, 'an uncataloged source is refused');
  assert.ok(assertAllowedUrl('UN-HS-REFERENCE', 'https://comtradeapi.un.org/files/v1/app/reference/HS.json'), 'the cataloged URL is allowed');
  await assert.rejects(retrieveSource('UN-HS-REFERENCE', 'https://comtradeapi.un.org/files/v1/app/reference/HS.json'), /switched off/, 'retrieval is off in this environment');
  console.log('✔ Scenario 8 Passed: only cataloged HTTPS hosts of integrated sources are ever requested.\n');

  // ------------------------------------------------------------------ 9. the catalog is honest about what is not there
  const integrated = SOURCE_CATALOGUE.filter((s) => s.integration === 'OPERATIONAL').map((s) => s.sourceId);
  assert.deepStrictEqual(integrated, ['UN-HS-REFERENCE'], 'the only new operational integration is the HS reference');
  for (const s of SOURCE_CATALOGUE.filter((entry) => entry.integration === 'NOT_INTEGRATED')) assert.ok(s.gaps.length > 0 && s.allowedHosts.length === 0, `${s.sourceId} says what is missing and cannot be fetched`);
  assert.ok(SOURCE_CATALOGUE.every((s) => s.licence.length > 10 && s.owner.length > 0), 'every source states its license position and owner');
  const lead = searchHeadings(reference(), 'Cotton fabric, plain weave');
  assert.strictEqual(lead[0]?.code, '5208', 'a description is led to the heading whose wording matches it');
  console.log('✔ Scenario 9 Passed: the source catalog separates what runs from what is missing, with license and owner.\n');

  // ------------------------------------------------------------------ 10. where a claim was read, and not asking twice
  const located = locateValue([{ pageNumber: 1, text: 'PROFORMA INVOICE No 1' }, { pageNumber: 2, text: 'RAW COTTON FIBRE GRADE A 5201.0010 100,000.00 KG $2.50' }], '5201.0010');
  assert.ok(located && located.page === 2 && /5201.0010/.test(located.snippet), 'the page and the words around the value are found');
  assert.strictEqual(locateValue([{ pageNumber: 1, text: 'RAW COTTON 52010010' }], '5201.0010')!.page, 1, 'punctuation does not hide a value');
  assert.strictEqual(locateValue([{ pageNumber: 1, text: 'nothing here' }], '5201.0010'), null, 'a value that is not in the text is not given a page');
  const withWhere = await runExternalVerification({ documents: [{ documentId: 'd9', filename: 'a.pdf', documentType: 'PROFORMA_INVOICE', version: 3, extractionConfidence: 0.95, units: [{ pageNumber: 2, text: 'Cotton fabric 7208.10 100 KG' }], goods: [{ productDescription: 'Cotton fabric', hsCode: '7208.10' }] }], transactionDate: '2026-10-20T00:00:00Z', reference: reference(), judge: judge('INCOMPATIBLE'), pct: () => ({ available: false, reason: 'none' }) });
  const ref0 = withWhere.results[0]!.claims[0]!;
  assert.ok(ref0.page === 2 && ref0.documentVersion === 3 && ref0.extractionConfidence === 0.95 && ref0.normalizedValue === '720810' && /7208/.test(ref0.snippet ?? ''), 'a claim keeps its page, document version, normalized value, extraction confidence and the words around it');

  let asked = 0;
  const counting = (verdict: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNCLEAR'): HsJudge => async () => {
    asked += 1;
    return { verdict, reason: 'counted' };
  };
  const docs = [{ documentId: 'd1', filename: 'a.pdf', documentType: 'PROFORMA_INVOICE', goods: [{ productDescription: 'Cotton fabric', hsCode: '7208.10' }] }];
  const first = await runExternalVerification({ documents: docs, transactionDate: null, reference: reference(), judge: counting('INCOMPATIBLE') });
  assert.strictEqual(asked, 1);
  assert.deepStrictEqual(first.modules[0]!.aiSecondOpinions, { asked: 1, reused: 0 });
  assert.ok(first.results[0]!.secondOpinion?.referenceHash === 'fixture-hash-0123456789', 'the opinion is kept with the reference it was given');
  const again = await runExternalVerification({ documents: docs, transactionDate: null, reference: reference(), judge: counting('INCOMPATIBLE'), previous: first });
  assert.strictEqual(asked, 1, 'an unchanged claim is not sent to the model again');
  assert.deepStrictEqual(again.modules[0]!.aiSecondOpinions, { asked: 0, reused: 1 });
  assert.strictEqual(again.results[0]!.status, 'DISCREPANCY', 'and the result is the same');
  const edited = await runExternalVerification({ documents: [{ ...docs[0]!, goods: [{ productDescription: 'Cotton fabric, bleached', hsCode: '7208.10' }] }], transactionDate: null, reference: reference(), judge: counting('INCOMPATIBLE'), previous: first });
  assert.strictEqual(asked, 2, 'a changed description is asked about again');
  const newReference = await runExternalVerification({ documents: docs, transactionDate: null, reference: reference({ contentHash: 'another-file' }), judge: counting('INCOMPATIBLE'), previous: first });
  assert.strictEqual(asked, 3, 'and so is a claim when the reference changed');
  void edited;
  void newReference;
  const outage: HsJudge = async () => {
    throw new Error('AI unavailable');
  };
  const outageRun = await runExternalVerification({ documents: docs, transactionDate: null, reference: reference(), judge: outage });
  assert.ok(outageRun.results[0]!.status === 'HUMAN_REVIEW_REQUIRED' && !outageRun.results[0]!.secondOpinion, 'an outage is never kept as an opinion');
  const retried = await runExternalVerification({ documents: docs, transactionDate: null, reference: reference(), judge: counting('INCOMPATIBLE'), previous: outageRun });
  assert.strictEqual(asked, 4, 'so the next run asks again');
  assert.strictEqual(retried.results[0]!.status, 'DISCREPANCY');
  console.log('✔ Scenario 10 Passed: a claim keeps where it was read; an unchanged claim reuses its AI opinion, a changed one or an outage does not.\n');

  console.log('================================================================');
  console.log('ALL EXTERNAL VERIFICATION SCENARIOS PASSED');
  console.log('================================================================');
}

run().catch((error) => {
  console.error('EXTERNAL VERIFICATION TEST FAILED:', error);
  process.exit(1);
});
