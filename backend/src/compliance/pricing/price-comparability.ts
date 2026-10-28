import type { BenchmarkOrigin, ComparabilityFactor, ComparabilityGrade, MarketPriceBenchmark } from './pricing.types';
import type { ResolvedThreshold } from './pricing-policy';

/**
 * Whether a benchmark is a fair comparison for a declared price, factor by factor. A price is compared with a
 * benchmark only as far as the two describe the same thing; where they do not, the result says which factor
 * differs, and a mismatch makes the benchmark a weak proxy that may inform a reviewer but may not raise an
 * over- or under-invoicing finding on its own. Factors that cannot be known (specification, origin) are listed
 * as unknown rather than assumed to match.
 */

export interface ComparabilityInput {
  declaredHsCode?: string;
  declaredDescription: string;
  destinationCountry?: string;
  benchmark: MarketPriceBenchmark;
  threshold: ResolvedThreshold;
  unit: { declared: string; benchmark: string; converted: boolean };
  currency: { declared: string; basis: string };
  incoterm: { declared: string; benchmarkBasis: string; adjustmentPercent: number };
  now: Date;
}

export function benchmarkOrigin(b: MarketPriceBenchmark): BenchmarkOrigin {
  if (b.origin) return b.origin;
  const url = b.evidence[0]?.url ?? '';
  if (url.startsWith('internal://reference-corridors')) return 'BUILT_IN_REFERENCE';
  if (url.startsWith('internal://compliance_price_benchmarks')) return 'LOCAL_DATABASE';
  if (/^https?:\/\//i.test(url)) return 'LIVE_SOURCE';
  return 'UNSPECIFIED';
}

export function ageInDays(asOf: string, now: Date): number | null {
  const t = Date.parse(asOf);
  return Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 86_400_000)) : null;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

export function assessComparability(input: ComparabilityInput): { grade: ComparabilityGrade; factors: ComparabilityFactor[] } {
  const { benchmark: b, threshold } = input;
  const origin = benchmarkOrigin(b);
  const factors: ComparabilityFactor[] = [];
  const add = (factor: ComparabilityFactor['factor'], status: ComparabilityFactor['status'], detail: string) => factors.push({ factor, status, detail });

  // Product: the HS code is the only structured way to say two goods are the same kind of thing.
  const declaredHs = (input.declaredHsCode ?? '').replace(/\D/g, '');
  const benchHs = (b.hsCodePrefix ?? '').replace(/\D/g, '');
  if (!declaredHs || !benchHs) {
    add('PRODUCT', 'PARTIAL', `Matched on the description "${input.declaredDescription.slice(0, 60)}" alone; ${declaredHs ? 'the benchmark states no HS code' : 'the document states no HS code'}.`);
  } else {
    const n = commonPrefix(declaredHs, benchHs);
    if (n >= Math.min(4, benchHs.length)) add('PRODUCT', 'MATCH', `HS ${declaredHs} and the benchmark's HS ${benchHs} agree to ${n} digits.`);
    else if (n >= 2) add('PRODUCT', 'PARTIAL', `HS ${declaredHs} and the benchmark's HS ${benchHs} agree only to the chapter (${n} digits): a different product within the same chapter.`);
    else add('PRODUCT', 'MISMATCH', `HS ${declaredHs} and the benchmark's HS ${benchHs} are in different chapters: the benchmark describes a different product.`);
  }

  add('SPECIFICATION', 'UNKNOWN', 'Grade, size, brand and other specifications are not compared: a benchmark corridor does not carry them.');

  if (input.unit.converted) add('UNIT', 'ADJUSTED', `The declared price per ${input.unit.declared || 'unit'} was converted to the benchmark's ${input.unit.benchmark}.`);
  else add('UNIT', 'MATCH', `Both are per ${input.unit.benchmark}.`);

  add('CURRENCY', input.currency.declared.toUpperCase() === 'USD' ? 'MATCH' : 'ADJUSTED', input.currency.declared.toUpperCase() === 'USD' ? 'Both are in USD.' : `Converted from ${input.currency.declared.toUpperCase()} using the ${input.currency.basis}.`);

  if (input.incoterm.benchmarkBasis !== 'FOB' && input.incoterm.benchmarkBasis !== 'CIF') {
    add('INCOTERM', 'MISMATCH', `The benchmark is on a ${input.incoterm.benchmarkBasis} basis, which the platform cannot align the declared ${input.incoterm.declared || 'Incoterm'} price to.`);
  } else if (input.incoterm.adjustmentPercent !== 0) {
    add('INCOTERM', 'ADJUSTED', `The declared ${input.incoterm.declared} price was moved ${input.incoterm.adjustmentPercent > 0 ? '+' : ''}${input.incoterm.adjustmentPercent}% to the benchmark's ${input.incoterm.benchmarkBasis} basis with a flat allowance for freight and insurance, not the actual charges.`);
  } else {
    add('INCOTERM', 'MATCH', `Both are on a ${input.incoterm.benchmarkBasis} basis.`);
  }

  const market = (b.destinationMarket ?? '').toLowerCase();
  if (input.destinationCountry && market && market === input.destinationCountry.toLowerCase()) add('DESTINATION', 'MATCH', `The benchmark is for ${b.destinationMarket}.`);
  else add('DESTINATION', 'PARTIAL', `The benchmark is a ${b.destinationMarket || 'global'} reference, not specific to ${input.destinationCountry || 'the destination'}.`);

  add('ORIGIN', 'UNKNOWN', "The benchmark does not state the origin of the goods it describes; the declared origin's cost level is not compared.");

  const age = ageInDays(b.asOfDate, input.now);
  if (origin === 'BUILT_IN_REFERENCE') add('FRESHNESS', 'UNKNOWN', 'The corridor is bundled with the platform and carries no observation date.');
  else if (age === null) add('FRESHNESS', 'UNKNOWN', 'The benchmark has no usable date.');
  else if (threshold.maxBenchmarkAgeDays !== null && age > threshold.maxBenchmarkAgeDays) add('FRESHNESS', 'MISMATCH', `The benchmark is ${age} days old; the approved methodology allows ${threshold.maxBenchmarkAgeDays}.`);
  else add('FRESHNESS', age > 365 ? 'PARTIAL' : 'MATCH', `The benchmark is ${age} day${age === 1 ? '' : 's'} old.`);

  if (origin === 'BUILT_IN_REFERENCE' || b.sampleCount <= 0) add('SAMPLE', 'UNKNOWN', 'The number of observations behind the benchmark is not recorded.');
  else if (threshold.minSamples !== null && b.sampleCount < threshold.minSamples) add('SAMPLE', 'MISMATCH', `${b.sampleCount} observation${b.sampleCount === 1 ? '' : 's'}; the approved methodology needs ${threshold.minSamples}.`);
  else add('SAMPLE', b.sampleCount >= 3 ? 'MATCH' : 'PARTIAL', `${b.sampleCount} observation${b.sampleCount === 1 ? '' : 's'}.`);

  let grade: ComparabilityGrade;
  if (factors.some((f) => f.status === 'MISMATCH')) grade = 'WEAK';
  else if (factors.find((f) => f.factor === 'PRODUCT')!.status === 'MATCH' && !factors.some((f) => f.status === 'PARTIAL') && origin !== 'BUILT_IN_REFERENCE' && origin !== 'UNSPECIFIED') grade = 'COMPARABLE';
  else grade = 'PROXY';
  return { grade, factors };
}
