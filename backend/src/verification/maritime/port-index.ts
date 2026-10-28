import { ComplianceStore } from '../../compliance/db/compliance-store';
import type { VerificationEvidence } from '../verification.types';

/**
 * The UN/LOCODE port list as the platform holds it (loaded from UNECE by the scheduled synchroniser), indexed so a
 * port named in a document can be identified: which port it is, and in which country. UN/LOCODE identifies a place; it
 * says nothing about whether a port or terminal is sanctioned or restricted, and nothing here pretends otherwise.
 */

export const PORT_SOURCE_ID = 'UN_LOCODE_PORTS';

export interface PortLite {
  locode: string;
  name: string;
  country: string;
  countryCode: string;
  aliases: string[];
  /** True when the name is the place itself, not a terminal or a port of it ("Karachi", not "Karachi Container Terminal"). */
  plain?: boolean;
}

export interface PortIndex {
  available: true;
  byName: Map<string, PortLite[]>;
  /** The same, keyed by the whole normalised name with its words kept ("karachi container terminal"). */
  exactByName: Map<string, PortLite[]>;
  byLocode: Map<string, PortLite>;
  /** Lower-case country name or ISO code -> ISO code, learned from the list itself. */
  countries: Map<string, string>;
  size: number;
  /** Real feed, a built-in seed, a manual import, or a synthetic test index. */
  origin: VerificationEvidence['origin'];
  version: string | null;
  contentHash: string | null;
  retrievedAt: string | null;
  stale: boolean;
}
export type PortIndexState = PortIndex | { available: false; reason: string };

/** The real list has around 17,000 locations; a handful means only the built-in sample is loaded. */
export const MIN_FULL_LIST = 5000;

/** Names that are conventions, not data: the short forms invoices use for countries. */
const COUNTRY_SHORT_FORMS: Record<string, string> = { uae: 'AE', usa: 'US', 'u.s.a.': 'US', 'u.s.': 'US', uk: 'GB', 'u.k.': 'GB', 'great britain': 'GB', korea: 'KR', 'south korea': 'KR', russia: 'RU', vietnam: 'VN', 'viet nam': 'VN' };

const NOISE = /\b(port of|port|harbou?r|terminal|seaport|sea port|container terminal|icd)\b/gi;

export function normalizePortName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(NOISE, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalised like the port name but keeping words such as "terminal" and "port", so a full name can match exactly. */
export function normalizeExact(raw: string): string {
  return raw.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildPortIndex(
  ports: Array<{ locode: string; name: string; country: string; countryCode: string; aliases?: string[] }>,
  meta: { origin: PortIndex['origin']; version?: string | null; contentHash?: string | null; retrievedAt?: string | null; stale?: boolean },
): PortIndex {
  const byName = new Map<string, PortLite[]>();
  const exactByName = new Map<string, PortLite[]>();
  const byLocode = new Map<string, PortLite>();
  const countries = new Map<string, string>();
  const add = (key: string, port: PortLite) => {
    if (!key) return;
    const list = byName.get(key) ?? [];
    if (!list.some((p) => p.locode === port.locode)) list.push(port);
    byName.set(key, list);
  };
  for (const raw of ports) {
    const port: PortLite = { locode: raw.locode.toUpperCase(), name: raw.name, country: raw.country, countryCode: raw.countryCode.toUpperCase(), aliases: raw.aliases ?? [], plain: normalizeExact(raw.name) === normalizePortName(raw.name) };
    byLocode.set(port.locode, port);
    add(normalizePortName(port.name), port);
    const exactKey = normalizeExact(port.name);
    const exactList = exactByName.get(exactKey) ?? [];
    if (exactKey && !exactList.some((p) => p.locode === port.locode)) exactByName.set(exactKey, [...exactList, port]);
    for (const alias of port.aliases) add(normalizePortName(alias), port);
    if (port.country) countries.set(port.country.toLowerCase(), port.countryCode);
    countries.set(port.countryCode.toLowerCase(), port.countryCode);
  }
  for (const [form, code] of Object.entries(COUNTRY_SHORT_FORMS)) if ([...byLocode.values()].some((p) => p.countryCode === code)) countries.set(form, code);
  return { available: true, byName, exactByName, byLocode, countries, size: byLocode.size, origin: meta.origin, version: meta.version ?? null, contentHash: meta.contentHash ?? null, retrievedAt: meta.retrievedAt ?? null, stale: meta.stale ?? false };
}

let cached: { at: number; state: PortIndexState } | null = null;
let fixture: PortIndexState | null = null;
const TTL_MS = 10 * 60_000;

export function setPortIndexForTesting(state: PortIndexState | null): void {
  fixture = state;
  cached = null;
}

/** The port index from the compliance store, refreshed every ten minutes. Unavailable when the full list is not loaded. */
export async function getPortIndex(): Promise<PortIndexState> {
  if (fixture) return fixture;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.state;
  let state: PortIndexState;
  try {
    const store = ComplianceStore.getInstance();
    const ports = await store.getAllPorts();
    const source = (await store.getSources()).find((s) => s.sourceId === PORT_SOURCE_ID);
    if (ports.length < MIN_FULL_LIST) {
      state = { available: false, reason: `Only ${ports.length} ports are loaded; the UN/LOCODE list has not been synchronised in full, so a port cannot be identified reliably.` };
    } else {
      const origin: PortIndex['origin'] = source?.dataOrigin === 'LIVE_FEED' ? 'LIVE_SOURCE' : source?.dataOrigin === 'MANUAL_IMPORT' ? 'BANK_SUPPLIED' : 'SEED';
      state = buildPortIndex(ports, { origin, version: source?.currentVersion ?? null, contentHash: source?.checksumSha256 ?? null, retrievedAt: source?.lastSuccessfulSync ?? null, stale: source ? source.freshnessStatus === 'STALE' || source.freshnessStatus === 'SYNC_FAILED' : false });
    }
  } catch (error) {
    state = { available: false, reason: `The port list could not be read (${error instanceof Error ? error.message.slice(0, 100) : 'error'}).` };
  }
  cached = { at: Date.now(), state };
  return state;
}
