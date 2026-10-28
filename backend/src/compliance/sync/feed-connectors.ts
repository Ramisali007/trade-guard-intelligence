import { createLogger } from '../../utils/logger';
import { parseTradeDate } from '../../utils/trade-date';

const log = createLogger('feed-connectors');

/**
 * Connectors for the public regulatory feeds the sync engine can actually reach.
 *
 * Each connector downloads one authoritative publication and turns it into plain records; it
 * knows nothing about versioning or storage (the sync engine does that). The parsers are exported
 * separately so they can be tested against saved fixtures without the network.
 *
 * Sources without a connector here are not "synced" at all — the engine reports them as not
 * connected rather than pretending.
 */

export interface FeedEntity {
  externalId: string;
  entityType: 'INDIVIDUAL' | 'ENTITY' | 'BANK' | 'VESSEL' | 'AIRCRAFT';
  name: string;
  aliases: string[];
  country: string;
  programs: string[];
  identifiers: { imoNumber?: string; swiftBic?: string; mmsi?: string };
  /** Designation date when the publisher states one (YYYY-MM-DD). OFAC's CSV does not. */
  listedOn?: string;
  remarks?: string;
}

export interface FeedFxRate {
  currencyCode: string;
  /** Units of this currency per 1 USD (the store's convention). */
  rateToUsd: number;
}

export interface FeedPort {
  locode: string;
  name: string;
  countryCode: string;
  latitude: number;
  longitude: number;
}

/** A refreshed benchmark corridor for an existing benchmark, from published trade statistics. */
export interface FeedBenchmarkUpdate {
  benchmarkId: string;
  lowUsd: number;
  medianUsd: number;
  highUsd: number;
  sampleCount: number;
  referenceYear: number;
  note: string;
}

export type ConnectorResult =
  | { kind: 'SANCTIONS'; entities: FeedEntity[]; publishedAt?: string; endpoint: string }
  | { kind: 'FX_RATES'; rates: FeedFxRate[]; effectiveDate: string; endpoint: string }
  | { kind: 'PORTS'; ports: FeedPort[]; endpoint: string }
  | { kind: 'PRICING'; updates: FeedBenchmarkUpdate[]; endpoint: string; skipped: string[] };

export interface FeedConnector {
  sourceId: string;
  endpoint: string;
  fetch(): Promise<ConnectorResult>;
}

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

const USER_AGENT = 'TradeGuard-Compliance-Sync/1.0 (+sanctions screening; contact: compliance desk)';

async function download(url: string, timeoutMs = 120_000): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------------------------------------
// CSV (RFC 4180: quoted fields may contain commas, doubled quotes and newlines)
// ---------------------------------------------------------------------------------------------

export function parseCsv(text: string, delimiter = ','): string[][] {
  // Copies whole runs with slice() rather than appending a character at a time: the UK list is
  // ~50 MB and this runs on the server's event loop during a sync.
  const rows: string[][] = [];
  let row: string[] = [];
  const n = text.length;
  let i = 0;

  const endRow = () => {
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    row = [];
  };

  while (i <= n) {
    if (i === n) {
      // Text ended right after a delimiter or line break.
      if (row.length > 0) {
        row.push('');
        endRow();
      }
      break;
    }
    let field: string;
    if (text.charCodeAt(i) === 34 /* " */) {
      // Quoted field: may contain delimiters, line breaks and doubled quotes.
      let value = '';
      let j = i + 1;
      for (;;) {
        const q = text.indexOf('"', j);
        if (q < 0) {
          value += text.slice(j);
          j = n;
          break;
        }
        value += text.slice(j, q);
        if (text.charCodeAt(q + 1) === 34) {
          value += '"';
          j = q + 2;
        } else {
          j = q + 1;
          break;
        }
      }
      // Anything between the closing quote and the next separator belongs to the field too.
      let k = j;
      while (k < n && text[k] !== delimiter && text[k] !== '\n' && text[k] !== '\r') k++;
      field = value + text.slice(j, k);
      i = k;
    } else {
      let k = i;
      while (k < n && text[k] !== delimiter && text[k] !== '\n' && text[k] !== '\r') k++;
      field = text.slice(i, k);
      i = k;
    }
    row.push(field);

    if (i >= n) {
      endRow();
      break;
    }
    const sep = text[i];
    if (sep === delimiter) {
      i++;
      if (i === n) {
        row.push('');
        endRow();
        break;
      }
    } else {
      // \r\n, \n or \r
      i += sep === '\r' && text[i + 1] === '\n' ? 2 : 1;
      endRow();
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// OFAC SDN (SDN.CSV + ALT.CSV, no header rows; "-0-" means empty)
// ---------------------------------------------------------------------------------------------

function ofacValue(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  return value === '-0-' ? '' : value;
}

export function parseOfacSdnCsv(sdnCsv: string, altCsv = ''): FeedEntity[] {
  const aliasesById = new Map<string, string[]>();
  for (const cols of parseCsv(altCsv)) {
    const id = ofacValue(cols[0]);
    const alias = ofacValue(cols[3]);
    if (!id || !alias) continue;
    const list = aliasesById.get(id) ?? [];
    list.push(alias);
    aliasesById.set(id, list);
  }

  const entities: FeedEntity[] = [];
  for (const cols of parseCsv(sdnCsv)) {
    const id = ofacValue(cols[0]);
    const name = ofacValue(cols[1]);
    if (!/^\d+$/.test(id) || !name) continue;

    const type = ofacValue(cols[2]).toLowerCase();
    const remarks = ofacValue(cols[11]);
    const programs = ofacValue(cols[3])
      .split(/\]\s*\[/)
      .map((p) => p.replace(/[[\]]/g, '').trim())
      .filter(Boolean);

    const imo = remarks.match(/\bIMO\s+(\d{7})\b/)?.[1];
    const swift = remarks.match(/SWIFT\/BIC\s+([A-Z0-9]{8,11})\b/)?.[1];
    const mmsi = remarks.match(/\bMMSI\s+(\d{9})\b/)?.[1];
    const nationality = remarks.match(/\bnationality\s+([A-Za-z .'-]+?)[;.]/i)?.[1];

    let entityType: FeedEntity['entityType'] = 'ENTITY';
    if (type === 'individual') entityType = 'INDIVIDUAL';
    else if (type === 'vessel') entityType = 'VESSEL';
    else if (type === 'aircraft') entityType = 'AIRCRAFT';
    else if (swift) entityType = 'BANK';

    entities.push({
      externalId: id,
      entityType,
      name,
      aliases: aliasesById.get(id) ?? [],
      country: ofacValue(cols[9]) || nationality?.trim() || '',
      programs,
      identifiers: {
        ...(imo ? { imoNumber: imo } : {}),
        ...(swift ? { swiftBic: swift } : {}),
        ...(mmsi ? { mmsi } : {}),
      },
      remarks: remarks.slice(0, 500) || undefined,
    });
  }
  return entities;
}

// ---------------------------------------------------------------------------------------------
// EU Financial Sanctions Files (semicolon CSV, one row per entity × name/address/ID/... combination)
// ---------------------------------------------------------------------------------------------

/** Columns located by header name, so a reordered publication still parses. */
function columnIndex(header: string[], name: string): number {
  return header.findIndex((h) => h.replace(/^﻿/, '').trim() === name);
}

const SWIFT_IN_TEXT = /SWIFT\s*\/?\s*BIC\s*(?:code)?[:\s]*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/;
const IMO_IN_TEXT = /\bIMO(?:\s*(?:number|no\.?))?[:\s]*(\d{7})\b/i;

export function parseEuFsfCsv(csv: string): { entities: FeedEntity[]; publishedAt?: string } {
  const rows = parseCsv(csv, ';');
  const header = rows[0] ?? [];
  const col = (name: string) => columnIndex(header, name);
  const c = {
    generated: col('fileGenerationDate'),
    id: col('Entity_LogicalId'),
    ref: col('Entity_EU_ReferenceNumber'),
    designated: col('Entity_DesignationDate'),
    remark: col('Entity_Remark'),
    type: col('Entity_SubjectType_ClassificationCode'),
    regPublished: col('Entity_Regulation_PublicationDate'),
    programme: col('Entity_Regulation_Programme'),
    wholeName: col('NameAlias_WholeName'),
    addressCountry: col('Address_CountryDescription'),
    citizenship: col('Citizenship_CountryDescription'),
    idNumber: col('Identification_Number'),
    idType: col('Identification_TypeDescription'),
  };
  if (c.id < 0 || c.wholeName < 0) throw new Error('EU FSF CSV: expected columns not found (format changed?)');

  const byId = new Map<string, { names: string[]; entity: FeedEntity }>();
  for (const row of rows.slice(1)) {
    const id = (row[c.id] ?? '').trim();
    if (!id) continue;
    let entry = byId.get(id);
    if (!entry) {
      const classification = (row[c.type] ?? '').trim().toLowerCase();
      const listed = (row[c.designated] ?? '').trim() || (row[c.regPublished] ?? '').trim();
      entry = {
        names: [],
        entity: {
          externalId: (row[c.ref] ?? '').trim() || id,
          entityType: classification === 'person' ? 'INDIVIDUAL' : 'ENTITY',
          name: '',
          aliases: [],
          country: '',
          programs: [],
          identifiers: {},
          listedOn: /^\d{4}-\d{2}-\d{2}$/.test(listed) ? listed : undefined,
          remarks: (row[c.remark] ?? '').trim().slice(0, 500) || undefined,
        },
      };
      byId.set(id, entry);
    }
    const e = entry.entity;
    const name = (row[c.wholeName] ?? '').trim();
    if (name && !entry.names.includes(name)) entry.names.push(name);
    const programme = (row[c.programme] ?? '').trim();
    if (programme && !e.programs.includes(programme)) e.programs.push(programme);
    if (!e.country) e.country = (row[c.citizenship] ?? '').trim() || (row[c.addressCountry] ?? '').trim();

    const idText = `${row[c.idType] ?? ''} ${row[c.idNumber] ?? ''} ${e.remarks ?? ''}`;
    const swift = idText.match(SWIFT_IN_TEXT)?.[1];
    if (swift && !e.identifiers.swiftBic) {
      e.identifiers.swiftBic = swift;
      e.entityType = 'BANK';
    }
    const imo = /imo/i.test(row[c.idType] ?? '') ? (row[c.idNumber] ?? '').replace(/\D/g, '') : idText.match(IMO_IN_TEXT)?.[1];
    if (imo && /^\d{7}$/.test(imo) && !e.identifiers.imoNumber) e.identifiers.imoNumber = imo;
  }

  const entities: FeedEntity[] = [];
  for (const { names, entity } of byId.values()) {
    if (names.length === 0) continue;
    entity.name = names[0]!;
    entity.aliases = names.slice(1);
    entities.push(entity);
  }
  const generated = rows[1]?.[c.generated]?.trim();
  return { entities, publishedAt: generated ? toIsoDate(generated) : undefined };
}

/** "15/10/2026" or "2026-10-15" → "2026-10-15". */
function toIsoDate(raw: string): string | undefined {
  const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : undefined;
}

// ---------------------------------------------------------------------------------------------
// UN Security Council Consolidated List (XML)
// ---------------------------------------------------------------------------------------------

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function xmlTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1]!).trim() : '';
}

function xmlTags(block: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const value = decodeXml(m[1]!).trim();
    if (value) out.push(value);
  }
  return out;
}

export function parseUnConsolidatedXml(xml: string): { entities: FeedEntity[]; publishedAt?: string } {
  const publishedAt = xml.match(/dateGenerated="([^"]+)"/)?.[1];
  const entities: FeedEntity[] = [];

  for (const [kind, tag] of [
    ['INDIVIDUAL', 'INDIVIDUAL'],
    ['ENTITY', 'ENTITY'],
  ] as const) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const block = m[1]!;
      const name = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME']
        .map((t) => xmlTag(block, t))
        .filter(Boolean)
        .join(' ');
      const externalId = xmlTag(block, 'REFERENCE_NUMBER') || xmlTag(block, 'DATAID');
      if (!name || !externalId) continue;

      const nationality = block.match(/<NATIONALITY>[\s\S]*?<VALUE>([\s\S]*?)<\/VALUE>/)?.[1];
      const addressCountry = xmlTag(block, 'COUNTRY');
      const listedOn = xmlTag(block, 'LISTED_ON');

      entities.push({
        externalId,
        entityType: kind,
        name,
        aliases: [...new Set([...xmlTags(block, 'ALIAS_NAME'), xmlTag(block, 'NAME_ORIGINAL_SCRIPT')].filter(Boolean))],
        country: (nationality ? decodeXml(nationality).trim() : '') || addressCountry,
        programs: [xmlTag(block, 'UN_LIST_TYPE')].filter(Boolean),
        identifiers: {},
        listedOn: /^\d{4}-\d{2}-\d{2}$/.test(listedOn) ? listedOn : undefined,
        remarks: xmlTag(block, 'COMMENTS1').slice(0, 500) || undefined,
      });
    }
  }
  return { entities, publishedAt };
}

// ---------------------------------------------------------------------------------------------
// FX (open.er-api.com: USD base, covers PKR/AED/SAR which the ECB reference rates do not)
// ---------------------------------------------------------------------------------------------

export function parseUsdBaseRatesJson(json: unknown): { rates: FeedFxRate[]; effectiveDate: string } {
  const data = json as { result?: string; rates?: Record<string, unknown>; time_last_update_utc?: string };
  if (data?.result && data.result !== 'success') throw new Error(`FX feed reported "${data.result}"`);
  const rates: FeedFxRate[] = [];
  for (const [code, value] of Object.entries(data?.rates ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && /^[A-Z]{3}$/.test(code)) {
      rates.push({ currencyCode: code, rateToUsd: value });
    }
  }
  const updated = data?.time_last_update_utc ? new Date(data.time_last_update_utc) : new Date();
  const effectiveDate = (Number.isNaN(updated.getTime()) ? new Date() : updated).toISOString().slice(0, 10);
  return { rates, effectiveDate };
}

// ---------------------------------------------------------------------------------------------
// UK Sanctions List (CSV; first line is "Report Date: …"; one row per name variant)
// ---------------------------------------------------------------------------------------------

/** "04/08/2026" (dd/mm/yyyy) → "2026-08-04". */
function dmyToIso(raw: string): string | undefined {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : undefined;
}

export function parseUkSanctionsCsv(csv: string): { entities: FeedEntity[]; publishedAt?: string } {
  const rows = parseCsv(csv);
  const reportLine = rows[0]?.join(',') ?? '';
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.trim() === 'Unique ID'));
  if (headerIndex < 0) throw new Error('UK sanctions CSV: header row not found (format changed?)');
  const header = rows[headerIndex]!;
  const col = (name: string) => columnIndex(header, name);
  const c = {
    id: col('Unique ID'),
    nameParts: ['Name 1', 'Name 2', 'Name 3', 'Name 4', 'Name 5', 'Name 6'].map(col),
    nameType: col('Name type'),
    regime: col('Regime Name'),
    designationType: col('Designation Type'),
    designated: col('Date Designated'),
    addressCountry: col('Address Country'),
    nationality: col('Nationality(/ies)'),
    imo: col('IMO number'),
    other: col('Other Information'),
  };
  if (c.id < 0 || c.nameParts.some((i) => i < 0)) throw new Error('UK sanctions CSV: expected columns not found');

  const byId = new Map<string, { primary?: string; names: string[]; entity: FeedEntity }>();
  for (const row of rows.slice(headerIndex + 1)) {
    const id = (row[c.id] ?? '').trim();
    if (!id) continue;
    const name = c.nameParts.map((i) => (row[i] ?? '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
    let entry = byId.get(id);
    if (!entry) {
      const kind = (row[c.designationType] ?? '').trim().toLowerCase();
      entry = {
        names: [],
        entity: {
          externalId: id,
          entityType: kind === 'individual' ? 'INDIVIDUAL' : kind === 'ship' ? 'VESSEL' : 'ENTITY',
          name: '',
          aliases: [],
          country: (row[c.nationality] ?? '').trim() || (row[c.addressCountry] ?? '').trim(),
          programs: [],
          identifiers: {},
          listedOn: dmyToIso(row[c.designated] ?? ''),
          remarks: (row[c.other] ?? '').trim().slice(0, 500) || undefined,
        },
      };
      byId.set(id, entry);
    }
    if (name) {
      if (/primary/i.test(row[c.nameType] ?? '') && !entry.primary) entry.primary = name;
      if (!entry.names.includes(name)) entry.names.push(name);
    }
    const regime = (row[c.regime] ?? '').trim();
    if (regime && !entry.entity.programs.includes(regime)) entry.entity.programs.push(regime);
    const imo = (row[c.imo] ?? '').replace(/\D/g, '');
    if (/^\d{7}$/.test(imo)) entry.entity.identifiers.imoNumber = imo;
    const swift = (row[c.other] ?? '').match(SWIFT_IN_TEXT)?.[1];
    if (swift && !entry.entity.identifiers.swiftBic) {
      entry.entity.identifiers.swiftBic = swift;
      entry.entity.entityType = 'BANK';
    }
  }

  const entities: FeedEntity[] = [];
  for (const { primary, names, entity } of byId.values()) {
    const name = primary ?? names[0];
    if (!name) continue;
    entity.name = name;
    entity.aliases = names.filter((n) => n !== name);
    entities.push(entity);
  }
  const reported = reportLine.match(/Report Date:\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  const publishedAt = reported ? new Date(`${reported[2]} ${reported[1]}, ${reported[3]} UTC`).toISOString().slice(0, 10) : undefined;
  return { entities, publishedAt };
}

// ---------------------------------------------------------------------------------------------
// NACTA proscribed organisations (PDF, two side-by-side columns of "S# · Name · Date")
// ---------------------------------------------------------------------------------------------

export interface PositionedText {
  x: number;
  y: number;
  str: string;
}

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const DATE_TEXT = `\\d{1,2}\\s+${MONTH},?\\s+\\d{4}`;
const TRAILING_DATE = new RegExp(`(${DATE_TEXT})\\s*$`, 'i');
const DATE_ONLY = new RegExp(`^(${DATE_TEXT})$`, 'i');
// The whitespace sits inside the lookahead: "10 May, 2019" is a date, not serial 10.
const SERIAL_LINE = new RegExp(`^(\\d{1,3})\\b(?!\\s*${MONTH},?\\s+\\d{4})\\s*(.*)$`, 'i');
const LEADING_DATE = new RegExp(`^(${DATE_TEXT})\\s+(.+)$`, 'i');
const ROMAN_ITEM = /^(i{1,3}|iv|vi{0,3}|ix|x)\.\s+(.+)$/i;
/** Several affiliates can share one printed line: "v. A, Lahore vi. B, Lahore vii. C". */
const ROMAN_SPLIT = /(?:^|\s)(i{1,3}|iv|vi{0,3}|ix|x)\.\s+/g;

type NactaSection = 'PROSCRIBED' | 'WATCH' | 'UN1267';
const SECTION_PREFIX: Record<NactaSection, string> = { PROSCRIBED: '', WATCH: 'W-', UN1267: 'UN-' };
const SECTION_PROGRAM: Record<NactaSection, string> = {
  PROSCRIBED: 'ATA-1997-SCHEDULE-I',
  WATCH: 'ATA-1997-SCHEDULE-II-WATCH',
  UN1267: 'UNSCR-1267',
};

/**
 * Turn the NACTA PDF's positioned text into organisations.
 *
 * Layout: each page has two side-by-side columns of "S# · Name · Date of Notification". Names wrap,
 * some rows list "Affiliated Organizations" (i., ii., …) whose notification date is printed once
 * beside the group, and page 2 adds two full-width sections (Schedule-II watch list, UNSCR 1267).
 * The header states the proscribed total ("82 Organizations Proscribed …"); callers check against it.
 */
export function parseNactaProscribedText(pages: PositionedText[][]): { entities: FeedEntity[]; declaredCount?: number } {
  const all = pages.flat();
  const declared = all.map((t) => t.str.match(/(\d{1,3})\s+Organizations\s+Proscribed/i)?.[1]).find(Boolean);
  const serialHeaders = all.filter((t) => /^S#$/i.test(t.str.trim())).map((t) => t.x).sort((a, b) => a - b);
  const split = serialHeaders.length >= 2 ? serialHeaders[serialHeaders.length - 1]! - 5 : 300;

  type Line = { section: NactaSection; serial?: number; text: string };
  const columns: Line[][] = [[], []];
  let section: NactaSection = 'PROSCRIBED';

  for (const items of pages) {
    const rows = new Map<number, PositionedText[]>();
    for (const item of items) {
      const key = [...rows.keys()].find((y) => Math.abs(y - item.y) <= 2.5) ?? item.y;
      rows.set(key, [...(rows.get(key) ?? []), item]);
    }
    const pageColumns: Line[][] = [[], []];
    for (const [, rowItems] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      const full = rowItems.sort((a, b) => a.x - b.x).map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
      if (/Organi[sz]ations\s+U\/?Watch|Schedule-II/i.test(full)) {
        section = 'WATCH';
        continue;
      }
      if (/Organi[sz]ations\s+enlisted\s+under\s+UN/i.test(full)) {
        section = 'UN1267';
        continue;
      }
      if (/^(NOTE:|This list is)/i.test(full)) continue;

      for (const side of [0, 1] as const) {
        const text = rowItems
          .filter((t) => (side === 0 ? t.x < split : t.x >= split))
          .map((t) => t.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text || /^S#|Name of Organi|GOVERNMENT OF PAKISTAN|NATIONAL COUNTER|ISLAMABAD|nacta\.gov\.pk|Organizations Proscribed/i.test(text)) continue;
        const m = text.match(SERIAL_LINE);
        pageColumns[side]!.push(m ? { section, serial: Number(m[1]), text: m[2]!.trim() } : { section, text });
      }
    }
    columns[0]!.push(...pageColumns[0]!);
    columns[1]!.push(...pageColumns[1]!);
  }

  const entities: FeedEntity[] = [];
  type Org = { section: NactaSection; serial: number; name: string; date?: string };
  type Affiliate = { name: string; date?: string; key: string };

  for (const lines of columns) {
    let current: Org | null = null;
    let affiliates: Affiliate[] = [];
    let groupDate: string | undefined;
    let inAffiliates = false;
    let pending: string[] = [];

    const close = (org: Org | null) => {
      if (!org) return;
      entities.push(toNacta(org.section, String(org.serial), org.name, org.date));
      for (const a of affiliates) {
        entities.push(toNacta(org.section, `${org.serial}-${a.key}`, a.name, a.date ?? groupDate ?? org.date));
      }
      affiliates = [];
      groupDate = undefined;
      inAffiliates = false;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let text = line.text;
      const onlyDate = text.match(DATE_ONLY);
      if (line.serial === undefined && onlyDate) {
        if (inAffiliates) groupDate ??= onlyDate[1];
        else if (current && !current.date) current.date = onlyDate[1];
        continue;
      }
      // A group's date printed at the start of a line that continues with affiliates.
      const lead = line.serial === undefined ? text.match(LEADING_DATE) : null;
      if (lead) {
        if (inAffiliates) groupDate ??= lead[1];
        text = lead[2]!;
      }
      const dated = text.match(TRAILING_DATE);
      const body = (dated ? text.slice(0, dated.index) : text).trim();

      if (line.serial !== undefined) {
        close(current);
        let name = body;
        // A wrapped name can sit on the lines around a row holding only the number and date.
        if (!name) {
          const next = lines[i + 1];
          const after = next && next.serial === undefined && !DATE_ONLY.test(next.text) ? lines[++i]!.text : '';
          name = [...pending, after].join(' ').trim();
        }
        pending = [];
        current = { section: line.section, serial: line.serial, name, date: dated?.[1] };
        continue;
      }
      if (/^Affiliated Organi[sz]ations:?/i.test(body)) {
        inAffiliates = true;
        continue;
      }
      if (inAffiliates && current && ROMAN_ITEM.test(body)) {
        const markers = [...body.matchAll(ROMAN_SPLIT)];
        markers.forEach((m, k) => {
          const start = m.index! + m[0].length;
          const end = k + 1 < markers.length ? markers[k + 1]!.index! : body.length;
          affiliates.push({ name: body.slice(start, end).trim(), key: m[1]!.toLowerCase() });
        });
        // The date printed beside an affiliate group applies to the whole group.
        if (dated) groupDate ??= dated[1];
        continue;
      }
      // A text line directly above a "number + date only" row belongs to that row, not the previous one.
      const next = lines[i + 1];
      const belongsToNext = next?.serial !== undefined && !next.text.replace(TRAILING_DATE, '').trim();
      if (belongsToNext) pending.push(body);
      else if (inAffiliates && affiliates.length > 0) affiliates[affiliates.length - 1]!.name += ` ${body}`;
      else if (current) current.name = `${current.name} ${body}`.trim();
      else pending.push(body);
      if (dated && current && !current.date) current.date = dated[1];
    }
    close(current);
  }
  return { entities, declaredCount: declared ? Number(declared) : undefined };
}

function toNacta(section: NactaSection, serial: string, name: string, date?: string): FeedEntity {
  return {
    externalId: `NACTA-${SECTION_PREFIX[section]}${serial}`,
    entityType: 'ENTITY',
    name: name.replace(/\s+/g, ' ').trim(),
    // Acronyms in brackets (LeJ, JeM, PTM) are how these groups are named; place names are not aliases.
    aliases: [...name.matchAll(/\(([^)]{2,12})\)/g)]
      .map((m) => m[1]!.trim())
      .filter((a) => /^[A-Za-z-]+$/.test(a) && (a.match(/[A-Z]/g) ?? []).length >= 2),
    country: 'Pakistan',
    programs: [SECTION_PROGRAM[section]],
    identifiers: {},
    listedOn: parseTradeDate(date)?.slice(0, 10),
  };
}

// ---------------------------------------------------------------------------------------------
// UN/LOCODE (CSV) — seaports only
// ---------------------------------------------------------------------------------------------

/** "4230N 00131E" → [42.5, 1.5167]. */
function locodeCoordinates(raw: string): [number, number] | null {
  const m = raw.trim().match(/^(\d{2})(\d{2})([NS])\s+(\d{3})(\d{2})([EW])$/);
  if (!m) return null;
  const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3] === 'S' ? -1 : 1);
  const lon = (Number(m[4]) + Number(m[5]) / 60) * (m[6] === 'W' ? -1 : 1);
  return [Number(lat.toFixed(4)), Number(lon.toFixed(4))];
}

export function parseUnLocodeCsv(csv: string): FeedPort[] {
  const rows = parseCsv(csv);
  const header = rows[0] ?? [];
  const col = (name: string) => columnIndex(header, name);
  const c = { change: col('Change'), country: col('Country'), location: col('Location'), name: col('NameWoDiacritics'), fn: col('Function'), coords: col('Coordinates') };
  if (c.country < 0 || c.location < 0 || c.fn < 0) throw new Error('UN/LOCODE CSV: expected columns not found');

  const ports: FeedPort[] = [];
  for (const row of rows.slice(1)) {
    // Function position 1 = "1" marks a port; "X" in Change marks an entry marked for deletion.
    if ((row[c.fn] ?? '')[0] !== '1' || (row[c.change] ?? '').trim() === 'X') continue;
    const country = (row[c.country] ?? '').trim();
    const location = (row[c.location] ?? '').trim();
    if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z0-9]{3}$/.test(location)) continue;
    const coords = locodeCoordinates(row[c.coords] ?? '');
    ports.push({
      locode: `${country}${location}`,
      name: (row[c.name] ?? '').trim(),
      countryCode: country,
      latitude: coords?.[0] ?? 0,
      longitude: coords?.[1] ?? 0,
    });
  }
  return ports;
}

// ---------------------------------------------------------------------------------------------
// UN Comtrade export unit values → benchmark corridors
// ---------------------------------------------------------------------------------------------

/** Benchmark unit → [Comtrade quantity unit code, multiplier from that unit to the benchmark unit]. */
const COMTRADE_UNITS: Record<string, [number, number]> = {
  PCS: [5, 1], UNIT: [5, 1], UNITS: [5, 1], SET: [5, 1], SETS: [5, 1], PAIRS: [5, 1], DOZ: [5, 12],
  KG: [8, 1], KGS: [8, 1], MT: [8, 1000], TON: [8, 1000], TONNE: [8, 1000],
  SQM: [2, 1], M2: [2, 1], L: [12, 1], LTR: [12, 1],
};

/** Large exporters across the goods the benchmarks cover: CN, IN, PK, BD, VN, TR, DE, US, TH, IT. */
const COMTRADE_REPORTERS = [156, 699, 586, 50, 704, 792, 276, 842, 764, 380];

export interface ComtradeRow {
  reporterCode: number;
  qtyUnitCode: number;
  qty: number | null;
  primaryValue: number | null;
}

/** Unit values (USD per benchmark unit) of the reporters whose quantity is in a compatible unit. */
export function comtradeUnitValues(rows: ComtradeRow[], benchmarkUnit: string): number[] {
  const mapping = COMTRADE_UNITS[benchmarkUnit.toUpperCase()];
  if (!mapping) return [];
  const [unitCode, multiplier] = mapping;
  return rows
    .filter((r) => r.qtyUnitCode === unitCode && (r.qty ?? 0) > 0 && (r.primaryValue ?? 0) > 0)
    .map((r) => Number((((r.primaryValue as number) / (r.qty as number)) * multiplier).toFixed(4)))
    .sort((a, b) => a - b);
}

let lastComtradeCall = 0;

/**
 * The keyless preview API throttles bursts (HTTP 429). Calls are spaced out and a 429 is retried
 * with back-off, honouring Retry-After when the server sends it.
 */
async function downloadComtrade(url: string): Promise<string> {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let attempt = 0; ; attempt++) {
    const wait = lastComtradeCall + 2000 - Date.now();
    if (wait > 0) await sleep(wait);
    lastComtradeCall = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) return res.text();
    if (res.status !== 429 || attempt >= 4) throw new Error(`UN Comtrade returned HTTP ${res.status}`);
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 8000 * (attempt + 1));
  }
}

async function fetchComtradeUpdates(): Promise<{ updates: FeedBenchmarkUpdate[]; skipped: string[] }> {
  const { ComplianceStore } = await import('../db/compliance-store');
  const store = ComplianceStore.getInstance();
  await store.init();
  const benchmarks = await store.getAllPriceBenchmarks();
  const updates: FeedBenchmarkUpdate[] = [];
  const skipped: string[] = [];
  const latestYear = new Date().getUTCFullYear() - 1;

  for (const b of benchmarks) {
    // Only corridors that are Comtrade-derived to begin with are refreshed from Comtrade. A curated or
    // imported benchmark for a specific product (e.g. Basmati rice) must not be replaced by the
    // average of its whole HS heading (all rice), which would mis-flag normal prices.
    if (!/^BENCH-COMTRADE-/i.test(b.benchmarkId)) {
      skipped.push(`${b.benchmarkId} (curated/imported benchmark; not refreshed from HS-level statistics)`);
      continue;
    }
    const hs = (b.hsCodePrefix || '').replace(/\D/g, '').slice(0, 6);
    if (hs.length < 4 || !COMTRADE_UNITS[b.unitOfMeasure.toUpperCase()]) {
      skipped.push(`${b.benchmarkId} (unit ${b.unitOfMeasure} has no Comtrade quantity equivalent)`);
      continue;
    }
    let values: number[] = [];
    let year = latestYear;
    try {
      for (; year >= latestYear - 2 && values.length < 2; year--) {
        const url = `${COMTRADE_PREVIEW_URL}?reporterCode=${COMTRADE_REPORTERS.join(',')}&period=${year}&cmdCode=${hs}&flowCode=X&partnerCode=0`;
        const json = JSON.parse(await downloadComtrade(url)) as { data?: ComtradeRow[] };
        values = comtradeUnitValues(json.data ?? [], b.unitOfMeasure);
      }
    } catch (error) {
      skipped.push(`${b.benchmarkId} (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    year += 1;
    if (values.length < 2) {
      skipped.push(`${b.benchmarkId} (fewer than two reporters with comparable quantities)`);
      continue;
    }
    // With five or more exporters the cheapest and dearest are set aside: one luxury or one
    // commodity-grade exporter would otherwise stretch the corridor until nothing looks anomalous.
    const core = values.length >= 5 ? values.slice(1, -1) : values;
    updates.push({
      benchmarkId: b.benchmarkId,
      lowUsd: core[0]!,
      medianUsd: values[Math.floor(values.length / 2)]!,
      highUsd: core[core.length - 1]!,
      sampleCount: values.length,
      referenceYear: year,
      note: `UN Comtrade ${year} export unit values for HS ${hs} across ${values.length} major exporters (USD per ${b.unitOfMeasure}).`,
    });
  }
  return { updates, skipped };
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

const OFAC_SDN_URL = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV';
const OFAC_ALT_URL = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV';
const UN_XML_URL = 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';
const FX_URL = 'https://open.er-api.com/v6/latest/USD';
const EU_FSF_URL =
  'https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw';
const UK_LIST_URL = 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv';
const NACTA_PAGE_URL = 'https://nacta.gov.pk/functions/counter-terrorism-wing/counter-terrorism/proscribed-organizations/';
const UN_LOCODE_URL = 'https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv';
const COMTRADE_PREVIEW_URL = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS';

async function downloadBinary(url: string, timeoutMs = 60_000): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const CONNECTORS: FeedConnector[] = [
  {
    sourceId: 'OFAC_SDN',
    endpoint: OFAC_SDN_URL,
    async fetch() {
      const [sdn, alt] = await Promise.all([download(OFAC_SDN_URL), download(OFAC_ALT_URL)]);
      const entities = parseOfacSdnCsv(sdn, alt);
      log.info('OFAC SDN downloaded', { entities: entities.length });
      return { kind: 'SANCTIONS', entities, endpoint: OFAC_SDN_URL };
    },
  },
  {
    sourceId: 'UN_CONSOLIDATED',
    endpoint: UN_XML_URL,
    async fetch() {
      const { entities, publishedAt } = parseUnConsolidatedXml(await download(UN_XML_URL));
      log.info('UN consolidated list downloaded', { entities: entities.length, publishedAt });
      return { kind: 'SANCTIONS', entities, publishedAt, endpoint: UN_XML_URL };
    },
  },
  {
    sourceId: 'CENTRAL_BANK_FX',
    endpoint: FX_URL,
    async fetch() {
      const { rates, effectiveDate } = parseUsdBaseRatesJson(JSON.parse(await download(FX_URL, 20_000)));
      return { kind: 'FX_RATES', rates, effectiveDate, endpoint: FX_URL };
    },
  },
  {
    sourceId: 'EU_FSF',
    endpoint: EU_FSF_URL,
    async fetch() {
      const { entities, publishedAt } = parseEuFsfCsv(await download(EU_FSF_URL, 180_000));
      log.info('EU financial sanctions list downloaded', { entities: entities.length, publishedAt });
      return { kind: 'SANCTIONS', entities, publishedAt, endpoint: EU_FSF_URL };
    },
  },
  {
    sourceId: 'UK_SANCTIONS_LIST',
    endpoint: UK_LIST_URL,
    async fetch() {
      const { entities, publishedAt } = parseUkSanctionsCsv(await download(UK_LIST_URL, 300_000));
      log.info('UK sanctions list downloaded', { entities: entities.length, publishedAt });
      return { kind: 'SANCTIONS', entities, publishedAt, endpoint: UK_LIST_URL };
    },
  },
  {
    sourceId: 'SBP_TFS_LIST',
    endpoint: NACTA_PAGE_URL,
    async fetch() {
      // The list is a PDF linked from the listing page; its filename carries the revision date.
      const page = await download(NACTA_PAGE_URL, 60_000);
      const pdfUrl = page.match(/href="(https?:\/\/[^"]*proscribed-organizations[^"]*\.pdf)"/i)?.[1];
      if (!pdfUrl) throw new Error('NACTA page no longer links a proscribed-organizations PDF');
      const { readPdfTextItems } = await import('../../document-processing/extractors/pdf.extractor');
      const { entities, declaredCount } = parseNactaProscribedText(await readPdfTextItems(await downloadBinary(pdfUrl)));
      const mainOrgs = entities.filter((e) => /^NACTA-\d+$/.test(e.externalId)).length;
      if (declaredCount && mainOrgs < declaredCount * 0.9) {
        throw new Error(`NACTA PDF parsed ${mainOrgs} organisations but declares ${declaredCount}; layout may have changed`);
      }
      log.info('NACTA proscribed organisations downloaded', { entities: entities.length, declaredCount, pdfUrl });
      const revision = pdfUrl.match(/(\d{1,2}-[a-z]{3}-\d{4})/i)?.[1];
      return { kind: 'SANCTIONS', entities, publishedAt: revision, endpoint: pdfUrl };
    },
  },
  {
    sourceId: 'UN_LOCODE_PORTS',
    endpoint: UN_LOCODE_URL,
    async fetch() {
      const ports = parseUnLocodeCsv(await download(UN_LOCODE_URL, 120_000));
      log.info('UN/LOCODE ports downloaded', { ports: ports.length });
      return { kind: 'PORTS', ports, endpoint: UN_LOCODE_URL };
    },
  },
  {
    sourceId: 'UN_COMTRADE_PRICING',
    endpoint: COMTRADE_PREVIEW_URL,
    async fetch() {
      const { updates, skipped } = await fetchComtradeUpdates();
      log.info('UN Comtrade unit values downloaded', { refreshed: updates.length, skipped: skipped.length });
      return { kind: 'PRICING', updates, skipped, endpoint: COMTRADE_PREVIEW_URL };
    },
  },
];

const overrides = new Map<string, FeedConnector>();

export function getConnector(sourceId: string): FeedConnector | undefined {
  const override = overrides.get(sourceId);
  if (override) return override;
  const real = CONNECTORS.find((connector) => connector.sourceId === sourceId);
  // EXTERNAL_SOURCES_OFFLINE means no network at all (the test environment sets it). The real connectors then refuse
  // at once, and the engine records an honest FAILED run, instead of waiting on the internet. An override is a
  // deliberate in-memory stand-in and is never blocked.
  if (real && process.env['EXTERNAL_SOURCES_OFFLINE'] === 'true') {
    return { ...real, fetch: async () => { throw new Error('External source retrieval is switched off in this environment (EXTERNAL_SOURCES_OFFLINE).'); } };
  }
  return real;
}

/** Test seam: serve a source from an in-memory connector instead of the network. */
export function overrideConnectorForTesting(connector: FeedConnector | null, sourceId?: string): void {
  if (connector) overrides.set(connector.sourceId, connector);
  else if (sourceId) overrides.delete(sourceId);
}

export function hasConnector(sourceId: string): boolean {
  return CONNECTORS.some((connector) => connector.sourceId === sourceId);
}
