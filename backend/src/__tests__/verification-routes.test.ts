import './test-env';
import assert from 'node:assert';
import { buildPortIndex, getPortIndex, normalizePortName, setPortIndexForTesting, MIN_FULL_LIST } from '../verification/maritime/port-index';
import { verifyPortClaims, type PortClaim } from '../verification/maritime/port-verifier';
import { isValidImo, verifyVesselClaims, NOT_CONFIGURED_VESSEL_PROVIDER, type VesselClaim, type VesselIntelligenceProvider } from '../verification/maritime/vessel';
import { runExternalVerification } from '../verification/verification.service';
import { RAISES_FINDING } from '../verification/verification.types';
import { CircuitOpenError, SourceGuard } from '../verification/source-guard';

/**
 * Ports and vessels. The port list here is a small synthetic list in the shape of the real one: nothing in this
 * suite is the real UN/LOCODE. What it proves: a port is identified by name, code or alias and country; a name that
 * means several places is never guessed; a port in the wrong country is a discrepancy; an incomplete port list is
 * reported as unavailable, not as "port not found"; an IMO number is checked by its check digit; and vessel identity
 * without a provider is reported as NOT verified.
 */

const PORTS = [
  { locode: 'PKKHI', name: 'Karachi', country: 'Pakistan', countryCode: 'PK', aliases: ['karachi port', 'port of karachi'] },
  { locode: 'BRSSZ', name: 'Santos', country: 'Brazil', countryCode: 'BR', aliases: [] },
  { locode: 'ESSAN', name: 'Santos', country: 'Spain', countryCode: 'ES', aliases: [] },
  { locode: 'INBOM', name: 'Mumbai', country: 'India', countryCode: 'IN', aliases: [] },
  { locode: 'AEJEA', name: 'Jebel Ali', country: 'United Arab Emirates', countryCode: 'AE', aliases: ['mina jebel ali'] },
  { locode: 'CIABJ', name: 'Abidjan', country: "Cote d'Ivoire", countryCode: 'CI', aliases: [] },
];
const index = (over: Partial<Parameters<typeof buildPortIndex>[1]> = {}) => buildPortIndex(PORTS, { origin: 'SYNTHETIC_TEST', version: 'synthetic', contentHash: 'synthetic-hash-0123', retrievedAt: '2026-10-20T00:00:00Z', ...over });
const ctx = { now: new Date('2026-10-26T10:00:00Z'), transactionDate: '2026-10-20T00:00:00Z' };
const claim = (value: string, field: PortClaim['field'] = 'portOfLoading'): PortClaim => ({ documentId: 'd1', filename: '01_Proforma.pdf', documentType: 'PROFORMA_INVOICE', field, value });

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('Ports and vessels (synthetic list; nothing here is the real UN/LOCODE)');
  console.log('================================================================\n');

  // ------------------------------------------------------------------ 1. identifying a port
  assert.strictEqual(normalizePortName('Port of KARACHI'), 'karachi');
  assert.strictEqual(normalizePortName("Abidjan Container Terminal"), 'abidjan');
  assert.strictEqual(normalizePortName('São  Tomé'), 'sao tome');
  const idx = index();
  const check = (value: string) => verifyPortClaims([claim(value)], idx, ctx).results[0]!;
  for (const [text, locode] of [['Karachi, Pakistan', 'PKKHI'], ['Karachi (PKKHI)', 'PKKHI'], ['PKKHI', 'PKKHI'], ['Port of Karachi', 'PKKHI'], ['Karachi Port, Pakistan', 'PKKHI'], ['Santos, Brazil', 'BRSSZ'], ['Santos - ES', 'ESSAN'], ['Mina Jebel Ali, UAE', 'AEJEA']] as const) {
    const r = check(text);
    assert.ok(r.status === 'VERIFIED' && r.claims[0]!.normalizedValue === locode, `"${text}" is identified as ${locode} (got ${r.status} ${r.claims[0]!.normalizedValue})`);
  }
  const verified = check('Karachi, Pakistan');
  assert.ok(!RAISES_FINDING.has(verified.status), 'a port that is identified raises no finding');
  assert.ok(verified.evidence[0]!.origin === 'SYNTHETIC_TEST' && verified.evidence[0]!.recordId === 'PKKHI' && verified.evidence[0]!.contentHash === 'synthetic-hash-0123', 'the UN/LOCODE record is the evidence, with its origin and hash');
  assert.ok(verified.limitations.some((l) => /NOT checked: no source for it is integrated/.test(l)), 'every result says restrictions on ports were not checked');
  console.log('✔ Scenario 1 Passed: ports are identified by name, alias, code and country.\n');

  // ------------------------------------------------------------------ 2. what is not guessed
  const ambiguous = check('Santos');
  assert.ok(ambiguous.status === 'HUMAN_REVIEW_REQUIRED' && ambiguous.customerFixable && /more than one place/.test(ambiguous.title) && /Brazil/.test(ambiguous.explanation) && /Spain/.test(ambiguous.explanation), 'a name that means two places is not guessed');
  const wrongCountry = check('Santos, India');
  assert.ok(wrongCountry.status === 'DISCREPANCY' && wrongCountry.blocking && /not in India/.test(wrongCountry.title) && /Brazil/.test(wrongCountry.explanation) && /not a finding of wrongdoing/.test(wrongCountry.explanation), 'a port stated in the wrong country is a discrepancy, with where it really is');
  const unknown = check('Nowhereville');
  assert.ok(unknown.status === 'INSUFFICIENT_EVIDENCE' && !unknown.blocking && unknown.customerFixable, 'an unknown port is "could not be identified", not an error');
  const mars = check('Karachi, Mars');
  assert.ok(mars.status === 'VERIFIED' && /"Mars" after the port name was not recognized as a country and was not used/.test(mars.explanation), 'text that is not a known country is not silently ignored: the result says it was not used');
  assert.match(check('Karachi').explanation, /no country/);
  const seed = verifyPortClaims([claim('Karachi')], index({ origin: 'SEED' }), ctx).results[0]!;
  assert.match(seed.explanation, /built-in seed/, 'a seed list says so');
  const stale = verifyPortClaims([claim('Karachi')], index({ stale: true }), ctx);
  assert.strictEqual(stale.module.state, 'PARTIAL');
  assert.ok(stale.results[0]!.limitations.some((l) => /could not be refreshed/.test(l)));
  // The real list holds both "Karachi" and "Karachi Container Terminal": the place itself wins over its terminal when only the place is named, and a terminal named in full is that terminal.
  const withTerminal = buildPortIndex([...PORTS, { locode: 'PKKCT', name: 'Karachi Container Terminal', country: 'Pakistan', countryCode: 'PK', aliases: [] }], { origin: 'SYNTHETIC_TEST', version: 'synthetic', contentHash: 'synthetic-hash-0123', retrievedAt: '2026-10-20T00:00:00Z' });
  const viaTerminals = (value: string) => verifyPortClaims([claim(value)], withTerminal, ctx).results[0]!;
  for (const [text, locode] of [['Karachi, Pakistan', 'PKKHI'], ['Karachi', 'PKKHI'], ['Port of Karachi, Pakistan', 'PKKHI'], ['Karachi Container Terminal, Pakistan', 'PKKCT']] as const) {
    const r = viaTerminals(text);
    assert.ok(r.status === 'VERIFIED' && r.claims[0]!.normalizedValue === locode, `"${text}" with a terminal in the list is identified as ${locode} (got ${r.status} ${r.claims[0]!.normalizedValue})`);
  }
  assert.strictEqual(viaTerminals('Santos').status, 'HUMAN_REVIEW_REQUIRED', 'two plain places of the same name are still never guessed');
  console.log('✔ Scenario 2 Passed: ambiguity, a wrong country, an unknown port, a seed list and a stale list are each reported for what they are.\n');

  // ------------------------------------------------------------------ 3. an incomplete list is not "port not found"
  setPortIndexForTesting(null);
  const loaded = await getPortIndex();
  assert.strictEqual(loaded.available, false, 'with only a sample of ports loaded the list is unavailable');
  assert.match((loaded as { reason: string }).reason, /not been synchronized in full/);
  assert.ok(MIN_FULL_LIST >= 5000);
  const noList = await runExternalVerification({ documents: [{ documentId: 'd1', filename: 'a.pdf', documentType: 'PROFORMA_INVOICE', goods: [], route: { portOfLoading: 'Karachi, Pakistan' } }], transactionDate: null, ports: { available: false, reason: 'list not loaded' } });
  const portModule = noList.modules.find((m) => m.module === 'PORT_IDENTITY')!;
  assert.strictEqual(portModule.state, 'SOURCE_UNAVAILABLE');
  assert.ok(noList.results.some((r) => r.status === 'SOURCE_UNAVAILABLE' && /NOT been identified/.test(r.explanation)) && !noList.results.some((r) => r.status === 'VERIFIED'), 'the ports are reported as not identified, never as verified');
  console.log('✔ Scenario 3 Passed: an incomplete port list is a visible source problem, not a flood of "port not found".\n');

  // ------------------------------------------------------------------ 4. IMO numbers
  assert.ok(isValidImo('1234567') && isValidImo('IMO 1234567'), '1234567 passes: 1x7+2x6+3x5+4x4+5x3+6x2 = 77, check digit 7');
  assert.ok(!isValidImo('1234568') && !isValidImo('123456') && !isValidImo('12345678') && !isValidImo('ABCDEFG'), 'a wrong check digit, wrong length or letters fail');
  const vessel = (name: string | null, imo: string | null): VesselClaim => ({ documentId: 'd1', filename: '07_BL.pdf', documentType: 'BILL_OF_LADING', name, imo });
  const none = await verifyVesselClaims([vessel('MV TEST', null)], NOT_CONFIGURED_VESSEL_PROVIDER, ctx);
  assert.ok(none.results[0]!.status === 'INSUFFICIENT_EVIDENCE' && none.results[0]!.customerFixable && /no IMO/.test(none.results[0]!.title));
  const bad = await verifyVesselClaims([vessel('MV TEST', '1234568')], NOT_CONFIGURED_VESSEL_PROVIDER, ctx);
  assert.ok(bad.results[0]!.status === 'DISCREPANCY' && bad.results[0]!.blocking && /check digit/.test(bad.results[0]!.explanation) && /not a finding of wrongdoing/.test(bad.results[0]!.explanation));
  const noProvider = await verifyVesselClaims([vessel('MV TEST', '1234567')], NOT_CONFIGURED_VESSEL_PROVIDER, ctx);
  assert.ok(noProvider.results[0]!.status === 'INSUFFICIENT_EVIDENCE' && !noProvider.results[0]!.customerFixable && !noProvider.results[0]!.blocking && /no licensed maritime data provider/.test(noProvider.results[0]!.explanation), 'a well-formed IMO without a provider is "not verified", for the bank only');
  assert.ok(noProvider.module.state === 'PARTIAL' && noProvider.module.notChecked.some((n) => /flag, ownership/.test(n)) && noProvider.module.sourcesConsulted.length === 0, 'the module says what was not checked');
  console.log('✔ Scenario 4 Passed: the IMO check digit is verified; identity without a provider is reported as not verified.\n');

  // ------------------------------------------------------------------ 5. the provider boundary (synthetic provider)
  const record = { imo: '1234567', name: 'MV EXAMPLE', flag: 'Panama', registeredOwner: 'Example Shipping SA', operator: 'Example Ship Management', formerNames: ['OLD NAME'], sourceName: 'Synthetic provider', retrievedAt: '2026-10-25T00:00:00Z' };
  const provider: VesselIntelligenceProvider = { id: 'SYNTHETIC-PROVIDER', configured: true, lookupByImo: async (imo) => (imo === '1234567' ? record : null) };
  const match = await verifyVesselClaims([vessel('MV Example', '1234567')], provider, ctx);
  assert.ok(match.results[0]!.status === 'CONSISTENT' && match.results[0]!.evidence[0]!.sourceId === 'SYNTHETIC-PROVIDER' && match.module.state === 'COMPLETE' && match.module.sourcesConsulted[0] === 'SYNTHETIC-PROVIDER');
  const former = await verifyVesselClaims([vessel('Old Name', '1234567')], provider, ctx);
  assert.strictEqual(former.results[0]!.status, 'CONSISTENT', 'a former name of the same vessel matches');
  const other = await verifyVesselClaims([vessel('MV SOMETHING ELSE', '1234567')], provider, ctx);
  assert.ok(other.results[0]!.status === 'DISCREPANCY' && /belongs to "MV EXAMPLE"/.test(other.results[0]!.title) && other.results[0]!.humanReviewRequired);
  const absent = await verifyVesselClaims([vessel('MV X', '7654329')], provider, ctx);
  assert.ok(isValidImo('7654329'));
  assert.ok(absent.results[0]!.status === 'INSUFFICIENT_EVIDENCE' && /not proof it does not exist/.test(absent.results[0]!.explanation));
  const broken: VesselIntelligenceProvider = { id: 'SYNTHETIC-PROVIDER', configured: true, lookupByImo: async () => { throw new Error('timeout'); } };
  const outage = await verifyVesselClaims([vessel('MV EXAMPLE', '1234567')], broken, ctx);
  assert.ok(outage.results[0]!.status === 'SOURCE_UNAVAILABLE' && /NOT been verified/.test(outage.results[0]!.explanation), 'a provider outage is never read as a pass');
  console.log('✔ Scenario 5 Passed: a provider record can confirm or contradict a vessel; absence and outage are never a pass.\n');

  // ------------------------------------------------------------------ 6. modules are independent
  const docs = [{ documentId: 'd1', filename: 'a.pdf', documentType: 'PROFORMA_INVOICE', goods: [{ productDescription: 'Cotton', hsCode: '5201' }], route: { portOfLoading: 'Santos, Brazil', portOfDischarge: 'Karachi, Pakistan' } }];
  const ref = { available: true as const, entries: new Map([['52', { code: '52', level: 2 as const, text: 'Cotton', parent: null, unit: null }], ['5201', { code: '5201', level: 4 as const, text: 'Cotton; not carded or combed', parent: null, unit: null }]]), retrievedAt: '2026-10-01T00:00:00Z', contentHash: 'h', publishedOn: null, datasetVersion: 'v', md5Verified: null, stale: false, origin: 'TEST_FIXTURE' as const };
  const full = await runExternalVerification({ documents: docs, transactionDate: null, reference: ref, ports: idx, judge: async () => ({ verdict: 'UNCLEAR', reason: 'n/a' }), pct: () => ({ available: false, reason: 'none' }) });
  assert.deepStrictEqual(full.modules.map((m) => `${m.module}:${m.state}`), ['HS_CLASSIFICATION:COMPLETE', 'PORT_IDENTITY:COMPLETE', 'VESSEL_IDENTITY:NOT_RUN']);
  assert.strictEqual(full.results.filter((r) => r.module === 'PORT_IDENTITY' && r.status === 'VERIFIED').length, 2, 'both ports are identified');
  const exploding = { get available(): boolean { throw new Error('the port list exploded'); } } as never;
  const isolated = await runExternalVerification({ documents: docs, transactionDate: null, reference: ref, ports: exploding, judge: async () => ({ verdict: 'UNCLEAR', reason: 'n/a' }), pct: () => ({ available: false, reason: 'none' }) });
  assert.ok(isolated.results.some((r) => r.module === 'HS_CLASSIFICATION' && r.status === 'CONSISTENT'), 'the HS check still ran');
  assert.ok(isolated.results.some((r) => r.status === 'SOURCE_UNAVAILABLE' && /step failed to run/.test(r.title) && /NOT been verified/.test(r.explanation)), 'and the step that failed says so instead of passing');
  console.log('✔ Scenario 6 Passed: a failing module is reported and never hides or takes down another.\n');

  // ------------------------------------------------------------------ 7. a failing source is protected, not hammered
  let clock = 1_000_000;
  const guard = new SourceGuard('SYN-SOURCE', { failureThreshold: 3, openMs: 600_000, minIntervalMs: 30_000, clock: () => clock });
  let calls = 0;
  const callCount = () => calls;
  const failing = async () => {
    calls++;
    throw new Error('connection reset');
  };
  const refusal = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      return error;
    }
    return null;
  };
  // Concurrent callers share one retrieval.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let started = 0;
  const slow = async () => {
    started++;
    await held;
    return 'body';
  };
  const burst = Promise.all([guard.run(slow), guard.run(slow), guard.run(slow)]);
  release();
  assert.deepStrictEqual(await burst, ['body', 'body', 'body']);
  assert.strictEqual(started, 1, 'three simultaneous requests make one retrieval');
  // First failure: allowed; a second at once is held back (minimum interval), not sent.
  assert.match(String(await refusal(() => guard.run(failing))), /connection reset/);
  assert.ok((await refusal(() => guard.run(failing))) instanceof CircuitOpenError && callCount() === 1, 'after a failure the source is not asked again straight away');
  clock += 31_000;
  await refusal(() => guard.run(failing));
  clock += 31_000;
  await refusal(() => guard.run(failing));
  assert.strictEqual(guard.state().state, 'OPEN', 'three failures in a row open the circuit');
  clock += 120_000;
  const blocked = await refusal(() => guard.run(failing));
  assert.ok(blocked instanceof CircuitOpenError && /not requested again until/.test(blocked.message) && callCount() === 3, 'while open, the source is not requested');
  assert.ok(guard.state().refused >= 2 && guard.state().nextAttemptAt !== null && /connection reset/.test(guard.state().lastError ?? ''), 'the state shows why, and when it is tried again');
  clock += 600_000;
  assert.strictEqual(guard.state().state, 'HALF_OPEN');
  assert.strictEqual(await guard.run(async () => 'recovered'), 'recovered', 'after the pause one trial is allowed, and a success closes the circuit');
  assert.ok(guard.state().state === 'CLOSED' && guard.state().consecutiveFailures === 0 && guard.state().lastSuccessAt !== null);
  console.log('✔ Scenario 7 Passed: concurrent requests share one retrieval; a failing source is paused, then its circuit opens, then one trial closes it.\n');

  console.log('================================================================');
  console.log('ALL PORT AND VESSEL VERIFICATION SCENARIOS PASSED');
  console.log('================================================================');
  setPortIndexForTesting(null);
}

run().catch((error) => {
  console.error('PORT AND VESSEL TEST FAILED:', error);
  process.exit(1);
});
