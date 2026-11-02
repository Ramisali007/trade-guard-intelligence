import './test-env';
import assert from 'node:assert';
import { PricingIntelligenceService, type BenchmarkProvider } from '../compliance/pricing/pricing-intelligence.service';
import { parsePricingPolicy, resolveThreshold, setPricingPolicyForTesting, DEFAULT_HIGH_PCT, DEFAULT_LOW_PCT } from '../compliance/pricing/pricing-policy';
import type { CommodityLineItem } from '../compliance/types';
import type { MarketPriceBenchmark } from '../compliance/pricing/pricing.types';

/**
 * The pricing framework. Every benchmark here is a SYNTHETIC fixture supplied through the provider interface: no
 * figure in this suite is a real market price, and nothing here is a methodology anyone has approved. What it
 * proves: the legacy +30% / -28% thresholds still apply and say they are an unapproved indicator; a category
 * threshold is used only with a methodology and an approval on record; a benchmark that is not like-for-like cannot
 * raise an over- or under-invoicing finding; and the inputs, conversions and policy behind a verdict are kept.
 */

const NOW = new Date('2026-10-26T10:00:00Z');
const line = (over: Partial<CommodityLineItem>): CommodityLineItem => ({
  id: 'L1', itemNumber: 1, productDescription: 'Steel coil', quantity: 100, unitOfMeasure: 'MT', unitPrice: 100, totalLineValue: 10000, currency: 'USD', hsCode: '720810',
  isAuthorizedScope: true, isControlledOrDualUse: false, riskSeverity: 'LOW', ...over,
});
const bench = (over: Partial<MarketPriceBenchmark> = {}): MarketPriceBenchmark => ({
  benchmarkId: 'SYN-7208', productKey: 'steel_coil', category: 'Steel (synthetic)', hsCodePrefix: '7208', benchmarkUnitPrice: 100, observedLowPrice: 90, observedMedianPrice: 100, observedHighPrice: 110,
  currency: 'USD', unitOfMeasure: 'MT', incotermBasis: 'FOB', destinationMarket: 'Pakistan', sampleCount: 12, confidenceLevel: 'HIGH', asOfDate: '2026-10-10T00:00:00Z',
  origin: 'BANK_SUPPLIED',
  evidence: [{ evidenceId: 'e1', url: 'https://example.invalid/synthetic', sourceTitle: 'Synthetic fixture', publisher: 'Synthetic test publisher', retrievedAt: '2026-10-10T00:00:00Z', sourceAuthorityLevel: 'LEVEL_4_VERIFIED_B2B_INDEX', sourceType: 'B2B_WHOLESALE', observedPrice: 100, observedCurrency: 'USD', observedUnit: 'MT', quotedExcerpt: 'synthetic', confidenceScore: 0.9, contentHashSha256: 'x', researchQuery: 'synthetic' }],
  ...over,
});
const providerOf = (b: MarketPriceBenchmark | null): BenchmarkProvider => ({ findMarketBenchmark: async () => b });
const run = (goods: CommodityLineItem[], b: MarketPriceBenchmark | null, over: { incoterm?: string; currency?: string } = {}) =>
  new PricingIntelligenceService(providerOf(b), () => NOW).evaluatePricingIntelligence({ goods, currency: over.currency ?? 'USD', incoterm: over.incoterm ?? 'FOB', destinationCountry: 'Pakistan', transactionDate: NOW.toISOString() });

const CATEGORY = {
  id: 'STEEL-7208', hsPrefix: '7208', highPct: 15, lowPct: 12,
  methodology: 'Thresholds set at twice the observed month-to-month dispersion of the bank-supplied steel index over 24 months (synthetic fixture text).',
  approvedBy: 'Synthetic Pricing Committee', approvedOn: '2026-09-01', minSamples: 5, maxBenchmarkAgeDays: 45,
};

async function main(): Promise<void> {
  console.log('================================================================');
  console.log('Pricing framework (synthetic benchmarks; no figure here is a real market price)');
  console.log('================================================================\n');

  // ------------------------------------------------------------------ 1. the default thresholds, labeled
  setPricingPolicyForTesting({ entries: [], rejected: [], source: null });
  assert.deepStrictEqual([DEFAULT_HIGH_PCT, DEFAULT_LOW_PCT], [30, 28], 'the legacy thresholds are unchanged');
  const [over] = await run([line({ unitPrice: 140 })], bench());
  assert.strictEqual(over!.classification, 'HIGH_PRICE_ANOMALY', '+40% is above the default +30%');
  assert.strictEqual(over!.assessment!.policy.basis, 'GLOBAL_DEFAULT_UNAPPROVED');
  assert.strictEqual(over!.assessment!.approvedControl, false, 'a default threshold is never an approved control');
  assert.match(over!.explanation, /screening indicator[^.]*not an approved control/);
  const [mid] = await run([line({ unitPrice: 125 })], bench());
  assert.strictEqual(mid!.classification, 'WITHIN_EXPECTED_RANGE', '+25% is inside the default band');
  const [under] = await run([line({ unitPrice: 70 })], bench());
  assert.strictEqual(under!.classification, 'LOW_PRICE_ANOMALY', '-30% is below the default -28%');
  const kept = over!.assessment!;
  assert.ok(kept.inputs.declaredUnitPrice === 140 && kept.inputs.comparedUsdPerUnit === 140 && kept.inputs.fxBasis === 'USD' && kept.benchmark!.id === 'SYN-7208' && kept.benchmark!.origin === 'BANK_SUPPLIED' && kept.assessedAt === NOW.toISOString(), 'the exact inputs, benchmark and time are kept');
  assert.ok(kept.limitations.some((l) => /flat allowance/.test(l)) && kept.limitations.some((l) => /not compared/.test(l)), 'the limits of the comparison are stated');
  console.log('✔ Scenario 1 Passed: the legacy +30% / -28% still apply, are labeled an unapproved indicator, and keep their inputs.\n');

  // ------------------------------------------------------------------ 2. a category threshold needs a methodology and an approval
  const parsed = parsePricingPolicy([
    CATEGORY,
    { ...CATEGORY, id: 'NO-METHOD', methodology: 'too short' },
    { ...CATEGORY, id: 'NO-APPROVER', approvedBy: '' },
    { ...CATEGORY, id: 'NO-DATE', approvedOn: 'sometime' },
    { ...CATEGORY, id: 'BAD-PREFIX', hsPrefix: '7' },
    { ...CATEGORY, id: 'BAD-LOW', lowPct: 140 },
    { ...CATEGORY, id: 'STEEL-7208' },
  ], 'fixture');
  assert.deepStrictEqual(parsed.entries.map((e) => e.id), ['STEEL-7208'], 'only the complete, approved entry is usable');
  assert.deepStrictEqual(parsed.rejected.map((r) => r.id).sort(), ['BAD-LOW', 'BAD-PREFIX', 'NO-APPROVER', 'NO-DATE', 'NO-METHOD', 'STEEL-7208'].sort(), 'each unusable entry is reported with a reason');
  assert.ok(parsePricingPolicy({ nonsense: true }, 'x').rejected.length === 1 && parsePricingPolicy('garbage', 'x').entries.length === 0, 'a malformed file yields no thresholds');
  setPricingPolicyForTesting(parsed);
  assert.strictEqual(resolveThreshold(['720810']).policyId, 'STEEL-7208');
  assert.strictEqual(resolveThreshold(['520811']).basis, 'GLOBAL_DEFAULT_UNAPPROVED', 'a category with no approved entry keeps the default');
  const specific = parsePricingPolicy([CATEGORY, { ...CATEGORY, id: 'STEEL-720810', hsPrefix: '720810', highPct: 8 }], 'x');
  assert.strictEqual(resolveThreshold(['720810'], specific).policyId, 'STEEL-720810', 'the longest matching prefix wins');
  const [cat] = await run([line({ unitPrice: 120 })], bench());
  assert.strictEqual(cat!.classification, 'HIGH_PRICE_ANOMALY', '+20% is within the default band but above the approved +15%');
  assert.ok(cat!.assessment!.policy.basis === 'APPROVED_CATEGORY' && cat!.assessment!.policy.approvedBy === 'Synthetic Pricing Committee' && /twice the observed/.test(cat!.assessment!.policy.methodology!), 'the methodology and approver travel with the result');
  assert.strictEqual(cat!.assessment!.approvedControl, true, 'an approved threshold on a real, comparable benchmark is a control');
  assert.doesNotMatch(cat!.explanation, /not an approved control/);
  assert.ok(cat!.assessment!.limitations.some((l) => /6 entries in the pricing policy file were not used/.test(l)), 'a policy file with unusable entries says so on every result');
  console.log('✔ Scenario 2 Passed: a category threshold is used only with a methodology, an approver and a date; the rest are reported and ignored.\n');

  // ------------------------------------------------------------------ 3. a weak proxy cannot raise a finding
  setPricingPolicyForTesting({ entries: [], rejected: [], source: null });
  const [chapter] = await run([line({ hsCode: '520811', unitPrice: 300 })], bench());
  assert.ok(chapter!.assessment!.comparability.grade === 'WEAK' && chapter!.classification === 'INSUFFICIENT_MARKET_DATA', 'a benchmark for a different chapter is not a comparison, however large the variance');
  assert.match(chapter!.explanation, /WEAK PROXY[^]*different chapters/);
  assert.ok(chapter!.priceVariancePercent === 200, 'the variance is still shown, as an indication');
  const [sameChapter] = await run([line({ hsCode: '721011', unitPrice: 300 })], bench());
  assert.strictEqual(sameChapter!.assessment!.comparability.factors.find((f) => f.factor === 'PRODUCT')!.status, 'PARTIAL', 'same chapter, different heading: a proxy at best');
  assert.strictEqual(sameChapter!.assessment!.comparability.grade, 'PROXY');
  const [noHs] = await run([line({ hsCode: undefined, unitPrice: 300 })], bench());
  assert.strictEqual(noHs!.assessment!.comparability.factors.find((f) => f.factor === 'PRODUCT')!.status, 'PARTIAL', 'no HS code: matched on words only');
  setPricingPolicyForTesting({ entries: [CATEGORY].map((e) => ({ ...e })), rejected: [], source: 'fixture' });
  const [stale] = await run([line({ unitPrice: 300 })], bench({ asOfDate: '2026-06-01T00:00:00Z' }));
  assert.ok(stale!.assessment!.comparability.grade === 'WEAK' && /allows 45/.test(stale!.assessment!.comparability.factors.find((f) => f.factor === 'FRESHNESS')!.detail) && stale!.classification === 'INSUFFICIENT_MARKET_DATA', 'a benchmark older than the approved methodology allows cannot raise a finding');
  const [thin] = await run([line({ unitPrice: 300 })], bench({ sampleCount: 2 }));
  assert.ok(thin!.assessment!.comparability.grade === 'WEAK' && thin!.classification === 'INSUFFICIENT_MARKET_DATA', 'too few observations for the approved methodology');
  setPricingPolicyForTesting({ entries: [], rejected: [], source: null });
  const [lowConf] = await run([line({ unitPrice: 300 })], bench({ confidenceLevel: 'LOW' }));
  assert.strictEqual(lowConf!.classification, 'INSUFFICIENT_MARKET_DATA', 'a low-confidence benchmark is an indication only');
  const [none] = await run([line({ unitPrice: 300 })], null);
  assert.ok(none!.classification === 'INSUFFICIENT_MARKET_DATA' && !none!.hasMarketData && none!.assessment === undefined, 'no benchmark: no verdict, and no pretence of one');
  console.log('✔ Scenario 3 Passed: a benchmark that is not like-for-like, too old, too thin or low-confidence cannot raise an over- or under-invoicing finding.\n');

  // ------------------------------------------------------------------ 4. conversions are made and recorded
  const [perKg] = await run([line({ unitOfMeasure: 'KG', unitPrice: 0.1 })], bench());
  assert.ok(perKg!.classification === 'WITHIN_EXPECTED_RANGE' && perKg!.assessment!.inputs.comparedUsdPerUnit === 100 && perKg!.assessment!.comparability.factors.find((f) => f.factor === 'UNIT')!.status === 'ADJUSTED', 'USD 0.10 per kg is USD 100 per MT; the conversion is recorded');
  const [cif] = await run([line({ unitPrice: 100 })], bench({ incotermBasis: 'CIF' }), { incoterm: 'FOB' });
  assert.ok(cif!.assessment!.inputs.incotermAdjustmentPercent === 8 && cif!.assessment!.inputs.comparedUsdPerUnit === 108, 'a FOB price against a CIF benchmark is moved to CIF, not compared as it stands');
  assert.strictEqual(cif!.assessment!.comparability.factors.find((f) => f.factor === 'INCOTERM')!.status, 'ADJUSTED');
  const [cfr] = await run([line({ unitPrice: 100 })], bench({ incotermBasis: 'CFR' }));
  assert.ok(cfr!.assessment!.comparability.grade === 'WEAK' && cfr!.classification === 'INSUFFICIENT_MARKET_DATA', 'a basis the platform cannot align to makes the benchmark a weak proxy');
  const [noUnit] = await run([line({ unitOfMeasure: 'BOXES', unitPrice: 100 })], bench());
  assert.match(noUnit!.explanation, /NOT COMPARABLE/, 'units that cannot be converted are not compared');
  const [noFx] = await run([line({ currency: 'XYZ', unitPrice: 100 })], bench());
  assert.match(noFx!.explanation, /NOT COMPARABLE/, 'a currency with no rate is not compared');
  console.log('✔ Scenario 4 Passed: unit, currency and Incoterm are brought to the benchmark and recorded; what cannot be converted is not compared.\n');

  // ------------------------------------------------------------------ 5. bundled corridors are never a control
  const builtIn = bench({ origin: undefined, category: 'Steel (built-in reference corridor)', sampleCount: 0, confidenceLevel: 'MODERATE', asOfDate: NOW.toISOString(), destinationMarket: 'Global Parity', evidence: [{ ...bench().evidence[0]!, url: 'internal://reference-corridors', publisher: 'TradeGuard built-in reference corridor' }] });
  setPricingPolicyForTesting({ entries: [CATEGORY].map((e) => ({ ...e, minSamples: undefined })), rejected: [], source: 'fixture' });
  const [bundled] = await run([line({ unitPrice: 160 })], builtIn);
  assert.strictEqual(bundled!.assessment!.benchmark!.origin, 'BUILT_IN_REFERENCE', 'a bundled corridor is recognized as such');
  assert.ok(bundled!.assessment!.comparability.grade === 'PROXY' && bundled!.assessment!.comparability.factors.find((f) => f.factor === 'FRESHNESS')!.status === 'UNKNOWN', 'its date and sample size are unknown, not "fresh"');
  assert.strictEqual(bundled!.assessment!.approvedControl, false, 'even under an approved threshold, a bundled corridor is not a control');
  assert.ok(bundled!.classification === 'HIGH_PRICE_ANOMALY' && /bundled or unverified source/.test(bundled!.explanation), 'the legacy flag is kept, labeled an indicator');
  console.log('✔ Scenario 5 Passed: a bundled reference corridor stays a labeled screening indicator, never an approved control.\n');

  setPricingPolicyForTesting(null);
}

main()
  .then(() => {
    console.log('================================================================');
    console.log('ALL PRICING FRAMEWORK SCENARIOS PASSED');
    console.log('================================================================');
    process.exit(0);
  })
  .catch((error) => {
    console.error('PRICING FRAMEWORK TEST FAILED:', error);
    process.exit(1);
  });
