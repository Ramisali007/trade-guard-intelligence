import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../../utils/logger';

/**
 * The thresholds a declared price is judged against. There are two kinds, and they are never confused:
 *
 *  - the platform's GLOBAL DEFAULT (+30% / -28%), carried over from the first version. It has no documented
 *    methodology and no approval. It stays as a screening indicator so existing behavior does not change, and
 *    every result that uses it says so;
 *  - an APPROVED CATEGORY threshold, read from a policy file the bank supplies. An entry is used only when it
 *    names the methodology it rests on, who approved it and when. An entry that does not is ignored and reported,
 *    never half-used. No category threshold ships with the platform: none has a methodology behind it.
 */

const log = createLogger('pricing-policy');

export const DEFAULT_HIGH_PCT = 30;
export const DEFAULT_LOW_PCT = 28;
export const GLOBAL_DEFAULT_ID = 'GLOBAL-DEFAULT';
export const GLOBAL_DEFAULT_NOTE =
  'The platform default (+30% / -28%) has no documented methodology and no approval. It is a screening indicator, not an approved control.';

export interface PricingPolicyEntry {
  id: string;
  /** Digits of the HS code the entry applies to, 2 to 8 long; the longest matching prefix wins. */
  hsPrefix: string;
  highPct: number;
  lowPct: number;
  methodology: string;
  approvedBy: string;
  approvedOn: string;
  /** A benchmark with fewer observations than this is a weak proxy for this category. */
  minSamples?: number;
  /** A benchmark older than this many days is a weak proxy for this category. */
  maxBenchmarkAgeDays?: number;
}

export interface ResolvedThreshold {
  basis: 'GLOBAL_DEFAULT_UNAPPROVED' | 'APPROVED_CATEGORY';
  policyId: string;
  highPct: number;
  lowPct: number;
  methodology: string | null;
  approvedBy: string | null;
  approvedOn: string | null;
  minSamples: number | null;
  maxBenchmarkAgeDays: number | null;
  note: string;
}

export interface LoadedPricingPolicy {
  entries: PricingPolicyEntry[];
  /** Entries in the file that were not used, with why. */
  rejected: Array<{ id: string; reason: string }>;
  source: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** Strict: an entry is either complete and usable or rejected with a reason. */
export function parsePricingPolicy(raw: unknown, source: string | null): LoadedPricingPolicy {
  const entries: PricingPolicyEntry[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { categories?: unknown }).categories) ? (raw as { categories: unknown[] }).categories : null;
  if (!list) return { entries, rejected: [{ id: '(file)', reason: 'Expected a list of category entries.' }], source };
  const seen = new Set<string>();
  for (const item of list) {
    const e = (item ?? {}) as Record<string, unknown>;
    const id = typeof e['id'] === 'string' && e['id'].trim() ? e['id'].trim() : '(no id)';
    const fail = (reason: string) => rejected.push({ id, reason });
    const hsPrefix = typeof e['hsPrefix'] === 'string' ? e['hsPrefix'].replace(/\D/g, '') : '';
    const high = Number(e['highPct']);
    const low = Number(e['lowPct']);
    if (id === '(no id)') fail('Entry has no id.');
    else if (seen.has(id)) fail('Duplicate id.');
    else if (hsPrefix.length < 2 || hsPrefix.length > 8) fail('hsPrefix must be 2 to 8 digits.');
    else if (!Number.isFinite(high) || high <= 0 || high > 1000) fail('highPct must be a positive number.');
    else if (!Number.isFinite(low) || low <= 0 || low >= 100) fail('lowPct must be between 0 and 100.');
    else if (typeof e['methodology'] !== 'string' || e['methodology'].trim().length < 30) fail('A threshold needs a written methodology (at least a sentence); none given.');
    else if (typeof e['approvedBy'] !== 'string' || !e['approvedBy'].trim()) fail('A threshold needs the person or committee that approved it.');
    else if (typeof e['approvedOn'] !== 'string' || !ISO_DATE.test(e['approvedOn'])) fail('A threshold needs the date it was approved (YYYY-MM-DD).');
    else {
      seen.add(id);
      entries.push({
        id,
        hsPrefix,
        highPct: high,
        lowPct: low,
        methodology: (e['methodology'] as string).trim(),
        approvedBy: (e['approvedBy'] as string).trim(),
        approvedOn: (e['approvedOn'] as string).slice(0, 10),
        ...(Number(e['minSamples']) > 0 ? { minSamples: Number(e['minSamples']) } : {}),
        ...(Number(e['maxBenchmarkAgeDays']) > 0 ? { maxBenchmarkAgeDays: Number(e['maxBenchmarkAgeDays']) } : {}),
      });
    }
  }
  return { entries, rejected, source };
}

let loaded: LoadedPricingPolicy | null = null;
let fixture: LoadedPricingPolicy | null = null;

export function setPricingPolicyForTesting(policy: LoadedPricingPolicy | null): void {
  fixture = policy;
  loaded = null;
}

function policyFilePath(): string {
  return process.env['PRICING_POLICY_FILE'] || path.resolve(process.cwd(), 'data', 'pricing-policy.json');
}

/** The bank's policy file when there is one; an empty policy (the default thresholds only) when there is not. */
export function currentPricingPolicy(): LoadedPricingPolicy {
  if (fixture) return fixture;
  if (loaded) return loaded;
  const file = policyFilePath();
  if (!fs.existsSync(file)) {
    loaded = { entries: [], rejected: [], source: null };
    return loaded;
  }
  try {
    loaded = parsePricingPolicy(JSON.parse(fs.readFileSync(file, 'utf8')), file);
    for (const r of loaded.rejected) log.warn('pricing policy entry not used', { id: r.id, reason: r.reason });
  } catch (error) {
    log.error('pricing policy file could not be read', { error: error instanceof Error ? error.message : String(error) });
    loaded = { entries: [], rejected: [{ id: '(file)', reason: 'The policy file could not be read as JSON.' }], source: file };
  }
  return loaded;
}

/** The threshold for an HS code: the longest approved prefix that matches, otherwise the unapproved default. */
export function resolveThreshold(hsCodes: Array<string | undefined>, policy: LoadedPricingPolicy = currentPricingPolicy()): ResolvedThreshold {
  const digits = hsCodes.map((h) => (h ?? '').replace(/\D/g, '')).filter(Boolean);
  let best: PricingPolicyEntry | null = null;
  for (const entry of policy.entries) {
    if (digits.some((d) => d.startsWith(entry.hsPrefix)) && (!best || entry.hsPrefix.length > best.hsPrefix.length)) best = entry;
  }
  if (best) {
    return {
      basis: 'APPROVED_CATEGORY',
      policyId: best.id,
      highPct: best.highPct,
      lowPct: best.lowPct,
      methodology: best.methodology,
      approvedBy: best.approvedBy,
      approvedOn: best.approvedOn,
      minSamples: best.minSamples ?? null,
      maxBenchmarkAgeDays: best.maxBenchmarkAgeDays ?? null,
      note: `Category threshold ${best.id} (HS ${best.hsPrefix}), approved by ${best.approvedBy} on ${best.approvedOn}.`,
    };
  }
  return { basis: 'GLOBAL_DEFAULT_UNAPPROVED', policyId: GLOBAL_DEFAULT_ID, highPct: DEFAULT_HIGH_PCT, lowPct: DEFAULT_LOW_PCT, methodology: null, approvedBy: null, approvedOn: null, minSamples: null, maxBenchmarkAgeDays: null, note: GLOBAL_DEFAULT_NOTE };
}
