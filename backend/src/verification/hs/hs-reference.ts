import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';
import { HS_REFERENCE_SOURCE_ID, HS_REFERENCE_URL, getSourceEntry } from '../source-catalogue';
import { externalSourcesOffline, retrieveSource } from '../retrieval';
import type { SourceHealth } from '../verification.types';
import { meaningfulTokens } from './text-match';

const log = createLogger('hs-reference');

/**
 * The official Harmonized System reference: every chapter, heading and 6-digit subheading with its
 * wording and standard unit, as published by the UN Statistics Division. It is downloaded (never
 * scraped), checked for plausibility before use, cached on disk with its hash and retrieval time,
 * and refreshed when older than the catalog's freshness limit. When a refresh fails the cached
 * copy is still used, but is marked stale so the result is not presented as current. With neither,
 * the reference is unavailable and the checks that need it say so.
 */

export interface HsEntry {
  code: string;
  level: 2 | 4 | 6;
  text: string;
  parent: string | null;
  /** HS standard unit of quantity (kg, u, m2 ...), when the source states one. */
  unit: string | null;
}

export interface HsReference {
  available: true;
  entries: Map<string, HsEntry>;
  retrievedAt: string;
  contentHash: string;
  /** The publisher's last-modified date and version marker for the file, when it sent them. */
  publishedOn: string | null;
  datasetVersion: string | null;
  md5Verified: boolean | null;
  stale: boolean;
  origin: 'NETWORK' | 'LOCAL_CACHE' | 'TEST_FIXTURE';
}
export interface HsReferenceUnavailable {
  available: false;
  error: string;
}
export type HsReferenceState = HsReference | HsReferenceUnavailable;

/** A real list has about 8,000 entries; far fewer means the download is not what it should be. */
const MIN_PLAUSIBLE_ENTRIES = 4000;

interface RawEntry {
  id?: unknown;
  text?: unknown;
  parent?: unknown;
  standardUnitAbbr?: unknown;
}

export function parseHsReference(body: string): Map<string, HsEntry> {
  const parsed = JSON.parse(body) as { results?: RawEntry[] };
  const entries = new Map<string, HsEntry>();
  for (const raw of parsed.results ?? []) {
    const code = String(raw.id ?? '');
    if (!/^(\d{2}|\d{4}|\d{6})$/.test(code)) continue;
    const text = String(raw.text ?? '').replace(/^\d+\s*-\s*/, '').trim();
    if (!text) continue;
    const unit = String(raw.standardUnitAbbr ?? '').trim();
    const parent = String(raw.parent ?? '');
    entries.set(code, {
      code,
      level: code.length as 2 | 4 | 6,
      text,
      parent: /^\d+$/.test(parent) ? parent : null,
      unit: unit && unit.toLowerCase() !== 'n/a' ? unit : null,
    });
  }
  return entries;
}

function assertPlausible(entries: Map<string, HsEntry>): void {
  const chapters = [...entries.values()].filter((e) => e.level === 2).length;
  if (entries.size < MIN_PLAUSIBLE_ENTRIES || chapters < 90) {
    throw new Error(`The downloaded HS reference is not plausible (${entries.size} entries, ${chapters} chapters).`);
  }
}

interface CacheMeta {
  retrievedAt: string;
  contentHash: string;
  publishedOn?: string | null;
  datasetVersion?: string | null;
  md5Verified?: boolean | null;
}

const metaOf = (meta: CacheMeta) => ({ publishedOn: meta.publishedOn ?? null, datasetVersion: meta.datasetVersion ?? null, md5Verified: meta.md5Verified ?? null });

const maxAgeMs = (): number => (getSourceEntry(HS_REFERENCE_SOURCE_ID)?.maxAgeHours ?? 720) * 3_600_000;
const cacheDir = (): string => path.join(config.upload.dataDir, 'reference');
const bodyFile = (): string => path.join(cacheDir(), 'hs-reference.json');
const metaFile = (): string => path.join(cacheDir(), 'hs-reference.meta.json');

function readCache(): { body: string; meta: CacheMeta } | null {
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile(), 'utf8')) as CacheMeta;
    return { body: fs.readFileSync(bodyFile(), 'utf8'), meta };
  } catch {
    return null;
  }
}

function writeCache(body: string, meta: CacheMeta): void {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(bodyFile(), body);
    fs.writeFileSync(metaFile(), JSON.stringify(meta));
  } catch (error) {
    log.warn('could not cache the HS reference', { error: error instanceof Error ? error.message : String(error) });
  }
}

let current: HsReference | null = null;
let loading: Promise<HsReferenceState> | null = null;
let lastAttemptAt: string | null = null;
let lastError: string | null = null;
let fixture: HsReference | null = null;

const isFresh = (retrievedAt: string): boolean => Date.now() - Date.parse(retrievedAt) < maxAgeMs();

async function load(): Promise<HsReferenceState> {
  lastAttemptAt = new Date().toISOString();
  const cached = readCache();
  if (cached && isFresh(cached.meta.retrievedAt)) {
    try {
      const entries = parseHsReference(cached.body);
      assertPlausible(entries);
      current = { available: true, entries, retrievedAt: cached.meta.retrievedAt, contentHash: cached.meta.contentHash, ...metaOf(cached.meta), stale: false, origin: 'LOCAL_CACHE' };
      lastError = null;
      return current;
    } catch (error) {
      log.warn('the cached HS reference is unusable', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  try {
    const got = await retrieveSource(HS_REFERENCE_SOURCE_ID, HS_REFERENCE_URL);
    const entries = parseHsReference(got.body);
    assertPlausible(entries);
    writeCache(got.body, { retrievedAt: got.retrievedAt, contentHash: got.contentHash, publishedOn: got.publishedOn, datasetVersion: got.datasetVersion, md5Verified: got.md5Verified });
    current = { available: true, entries, retrievedAt: got.retrievedAt, contentHash: got.contentHash, publishedOn: got.publishedOn, datasetVersion: got.datasetVersion, md5Verified: got.md5Verified, stale: false, origin: 'NETWORK' };
    lastError = null;
    log.info('HS reference refreshed', { entries: entries.size });
    return current;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    log.warn('HS reference refresh failed', { error: lastError });
  }
  // A refresh failed: an older copy is still better than nothing, but it is not "current".
  if (cached) {
    try {
      const entries = parseHsReference(cached.body);
      assertPlausible(entries);
      current = { available: true, entries, retrievedAt: cached.meta.retrievedAt, contentHash: cached.meta.contentHash, ...metaOf(cached.meta), stale: true, origin: 'LOCAL_CACHE' };
      return current;
    } catch {
      /* fall through */
    }
  }
  return { available: false, error: lastError ?? 'The HS reference could not be loaded.' };
}

/** The reference, loading or refreshing it when needed. Concurrent callers share one load. */
export async function getHsReference(): Promise<HsReferenceState> {
  if (fixture) return fixture;
  if (current && isFresh(current.retrievedAt) && !current.stale) return current;
  // A stale copy that could not be refreshed is not re-requested on every case action: try again in ten minutes.
  if (current?.stale && lastAttemptAt && Date.now() - Date.parse(lastAttemptAt) < 10 * 60_000) return current;
  if (externalSourcesOffline() && !current) {
    const cached = readCache();
    if (!cached) return { available: false, error: 'External source retrieval is switched off and no local copy exists.' };
  }
  loading ??= load().finally(() => {
    loading = null;
  });
  return loading;
}

/** Tests install a small synthetic reference so no network or real data is involved. */
export function setHsReferenceForTesting(entries: HsEntry[] | null): void {
  fixture = entries
    ? { available: true, entries: new Map(entries.map((e) => [e.code, e])), retrievedAt: new Date().toISOString(), contentHash: 'test-fixture', publishedOn: null, datasetVersion: 'synthetic-fixture', md5Verified: null, stale: false, origin: 'TEST_FIXTURE' }
    : null;
  current = null;
}

export function hsReferenceHealth(): SourceHealth {
  const ref = fixture ?? current;
  const stale = ref ? ref.stale || !isFresh(ref.retrievedAt) : false;
  return {
    sourceId: HS_REFERENCE_SOURCE_ID,
    lastSuccessfulRetrievalAt: ref?.retrievedAt ?? null,
    lastAttemptAt,
    lastError,
    recordCount: ref?.entries.size ?? null,
    contentHash: ref?.contentHash ?? null,
    datasetVersion: ref?.datasetVersion ?? null,
    publishedOn: ref?.publishedOn ?? null,
    state: ref ? (stale ? 'STALE' : 'CURRENT') : lastError ? 'UNAVAILABLE' : 'NOT_LOADED',
    origin: ref?.origin ?? null,
  };
}

// ------------------------------------------------------------------ lookup and search

export interface HsLookup {
  chapter: HsEntry | null;
  heading: HsEntry | null;
  subheading: HsEntry | null;
}

export function lookupHs(ref: HsReference, digits: string): HsLookup {
  return {
    chapter: ref.entries.get(digits.slice(0, 2)) ?? null,
    heading: digits.length >= 4 ? ref.entries.get(digits.slice(0, 4)) ?? null : null,
    subheading: digits.length >= 6 ? ref.entries.get(digits.slice(0, 6)) ?? null : null,
  };
}

export interface HsCandidate {
  code: string;
  text: string;
  score: number;
}

const idfCache = new WeakMap<HsReference, Map<string, number>>();

function idfFor(ref: HsReference): Map<string, number> {
  const known = idfCache.get(ref);
  if (known) return known;
  const df = new Map<string, number>();
  let n = 0;
  for (const e of ref.entries.values()) {
    if (e.level === 2) continue;
    n += 1;
    for (const w of new Set(meaningfulTokens(e.text))) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [w, count] of df) idf.set(w, Math.log(1 + n / count));
  idfCache.set(ref, idf);
  return idf;
}

/** Headings whose official wording best matches a description, for a reviewer to look at: a lead, not a classification. */
export function searchHeadings(ref: HsReference, description: string, limit = 3): HsCandidate[] {
  const wanted = meaningfulTokens(description);
  if (wanted.length === 0) return [];
  const idf = idfFor(ref);
  const scored: HsCandidate[] = [];
  for (const e of ref.entries.values()) {
    if (e.level !== 4) continue;
    const theirs = new Set(meaningfulTokens(e.text));
    let score = 0;
    for (const w of wanted) if (theirs.has(w)) score += idf.get(w) ?? 1;
    if (score > 0) scored.push({ code: e.code, text: e.text, score: Number(score.toFixed(2)) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
