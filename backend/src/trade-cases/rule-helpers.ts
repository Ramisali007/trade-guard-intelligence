import type { RiskSeverity } from '../config/trade-taxonomy';
import { getRule } from './rule-registry';
import type { Department, Evidence, Finding, FindingCategory, FindingOrigin, FindingSeverity, LcApplicationData } from './trade-case.types';

/** What a rule produces. The service turns it into a `Finding` (id, status, history) on merge. */
export interface CandidateFinding {
  key: string;
  ruleId: string;
  ruleVersion: string;
  stage: Finding['stage'];
  category: FindingCategory;
  severity: FindingSeverity;
  blocking: boolean;
  title: string;
  description: string;
  fields: string[];
  observed: Evidence[];
  expected: string;
  confidence: number | null;
  origin: FindingOrigin;
  recommendedAction: string;
  ownerDepartment: Department;
  presentationId: string | null;
  amendmentId: string | null;
  /** Set by external verification: whether the customer can act on this point. Absent for every other rule. */
  customerFixable?: boolean;
}

const OWNER: Record<FindingCategory, Department> = {
  MISSING_INFORMATION: 'TRADE_OPS',
  DATA_INCONSISTENCY: 'TRADE_OPS',
  DOCUMENT_QUALITY: 'TRADE_OPS',
  LC_TERM_ISSUE: 'TRADE_OPS',
  LOW_CONFIDENCE_EXTRACTION: 'TRADE_OPS',
  OPERATIONAL: 'TRADE_OPS',
  DOCUMENTARY_DISCREPANCY: 'TRADE_OPS',
  REGULATORY_CONCERN: 'COMPLIANCE',
  COMPLIANCE_ALERT: 'COMPLIANCE',
  TBML_RED_FLAG: 'COMPLIANCE',
  CREDIT_BLOCKER: 'CREDIT',
};

/** Build a candidate from a registered rule; anything not given falls back to the rule's defaults. */
export function candidate(
  ruleId: string,
  subject: string,
  details: Pick<CandidateFinding, 'title' | 'description' | 'expected' | 'recommendedAction'> &
    Partial<Omit<CandidateFinding, 'key' | 'ruleId' | 'ruleVersion'>>,
): CandidateFinding {
  const rule = getRule(ruleId);
  const category = details.category ?? rule.category;
  const severity = details.severity ?? rule.defaultSeverity;
  return {
    key: `${ruleId}:${subject}`,
    ruleId,
    ruleVersion: rule.version,
    stage: details.stage ?? (rule.stage === 'POST_TRADE' ? 'POST_TRADE' : 'PRE_TRADE'),
    category,
    severity,
    blocking: details.blocking ?? (severity === 'CRITICAL' || severity === 'HIGH'),
    title: details.title,
    description: details.description,
    fields: details.fields ?? [],
    observed: details.observed ?? [],
    expected: details.expected,
    confidence: details.confidence ?? null,
    origin: details.origin ?? 'DETERMINISTIC_RULE',
    recommendedAction: details.recommendedAction,
    ownerDepartment: details.ownerDepartment ?? OWNER[category],
    presentationId: details.presentationId ?? null,
    amendmentId: details.amendmentId ?? null,
    ...(details.customerFixable !== undefined ? { customerFixable: details.customerFixable } : {}),
  };
}

export function fromRiskSeverity(severity: RiskSeverity | string | undefined): FindingSeverity {
  switch (severity) {
    case 'CRITICAL':
      return 'CRITICAL';
    case 'HIGH':
      return 'HIGH';
    case 'ELEVATED':
    case 'MODERATE':
    case 'MEDIUM':
      return 'MEDIUM';
    default:
      return 'LOW';
  }
}

// ------------------------------------------------------------------------------------------ fields

export function getField(app: LcApplicationData, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined), app);
}

export function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') return !Number.isFinite(value);
  return false;
}

/** Extracted values the pipeline writes when it found nothing. */
export function extractedOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || /^(not found|not specified|n\/a|unknown|unspecified)/i.test(text)) return null;
  return text;
}

/**
 * Whether a goods line states a quantity. A zero is "not stated"; a quantity of exactly 1 with no price
 * and no total is the old placeholder for "not stated", kept in analyses made before it was fixed.
 */
export function statesQuantity(g: { quantity: number; unitPrice: number; totalLineValue: number }): boolean {
  return g.quantity > 0 && !(g.quantity === 1 && !(g.unitPrice > 0) && !(g.totalLineValue > 0));
}

// ------------------------------------------------------------------------------------------ names

/** Lower-case, no "M/s", no corporate suffixes, no punctuation: "M/s KMART AUSTRALIA LTD" → "kmartaustralia". */
export function partyKey(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/^m\/s\.?\s+/, '')
    .replace(/,.*$/, '')
    .replace(/\b(?:limited|ltd|plc|inc|llc|pvt|private|co|company|corp|corporation|gmbh|sa|bv)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Same party when the keys match, or one is wholly contained in the other (a trading-name suffix). */
export function sameParty(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = partyKey(a);
  const kb = partyKey(b);
  if (!ka || !kb) return false;
  return ka === kb || (Math.min(ka.length, kb.length) >= 6 && (ka.includes(kb) || kb.includes(ka)));
}

export function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '');
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Share of the shorter description's significant words found in the other (0–1). */
export function wordOverlap(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  const [small, large] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  let hit = 0;
  for (const word of small) if (large.has(word)) hit += 1;
  return hit / small.size;
}

// ------------------------------------------------------------------------------------------ evidence

export interface TextUnit {
  pageNumber: number;
  text: string;
}

/** Ways an amount may be printed: 250,000.00 / 250000.00 / 250,000 / 250000. */
export function amountVariants(amount: number): string[] {
  const fixed = amount.toFixed(2);
  const grouped = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const variants = [grouped, fixed];
  if (Number.isInteger(amount)) variants.push(amount.toLocaleString('en-US'), String(amount));
  return [...new Set(variants)];
}

/**
 * Where a value appears in a document's extracted text: the page and a short excerpt. Returns
 * null when it cannot be found — the finding then says the location is unknown, it never invents one.
 */
export function locate(units: TextUnit[], variants: string[]): { pageNumber: number; snippet: string } | null {
  const wanted = variants.map((v) => v.toLowerCase()).filter((v) => v.length > 0);
  for (const unit of units) {
    const text = unit.text.replace(/\s+/g, ' ');
    const lower = text.toLowerCase();
    for (const variant of wanted) {
      const at = lower.indexOf(variant);
      if (at === -1) continue;
      const start = Math.max(0, at - 60);
      const end = Math.min(text.length, at + variant.length + 60);
      return { pageNumber: unit.pageNumber, snippet: `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}` };
    }
  }
  return null;
}

export function documentEvidence(
  label: string,
  value: string,
  doc: { documentId: string; filename: string; units: TextUnit[] },
  variants: string[] = [value],
): Evidence {
  const found = locate(doc.units, variants);
  return {
    source: 'DOCUMENT',
    label,
    value,
    documentId: doc.documentId,
    filename: doc.filename,
    ...(found ? { pageNumber: found.pageNumber, snippet: found.snippet } : {}),
  };
}

export function applicationEvidence(label: string, value: unknown, version: number): Evidence {
  return { source: 'APPLICATION', label, value: isMissing(value) ? '(not provided)' : String(Array.isArray(value) ? value.join(', ') : value), applicationVersion: version };
}

export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const DAY_MS = 86_400_000;

export function formatMoney(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
