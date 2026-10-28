/**
 * Pakistan Customs Tariff (PCT) data, as the bank supplies it.
 *
 * The platform does not fetch the tariff: no machine-readable copy that it may lawfully retrieve was found,
 * and the tariff changes by notification. The bank supplies a controlled copy (exported from its own tariff
 * system or prepared from the FBR publication) as a CSV in the format below, and a different person approves it
 * before any check relies on it. Every line carries its own effective dates, so a past transaction can be
 * assessed against the tariff as it stood on its date.
 */

export const PCT_COLUMNS = ['pct_code', 'hs6', 'description', 'unit', 'customs_duty_pct', 'regulatory_duty_pct', 'notes', 'restrictions', 'effective_from', 'effective_to'] as const;

export interface PctLine {
  /** The 8-digit tariff line, digits only. */
  pctCode: string;
  /** The international 6-digit heading it sits under; always the first six digits of the tariff line. */
  hs6: string;
  description: string;
  unit: string | null;
  customsDutyPct: number | null;
  regulatoryDutyPct: number | null;
  /** The tariff's own note for this line, as supplied. */
  notes: string | null;
  /** A permit, licence or condition the dataset records for this line, as supplied. Not interpreted here. */
  restrictions: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PctRowError {
  row: number;
  message: string;
}

export const MAX_PCT_LINES = 25_000;
export const MAX_PCT_BYTES = 12 * 1024 * 1024;

/** RFC 4180 style: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string): boolean => ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function duty(value: string, label: string, errors: string[]): number | null {
  const text = value.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 500) errors.push(`${label} must be a number from 0 to 500`);
  return Number.isFinite(n) ? n : null;
}

/** Strict: a dataset is submitted only when every row is valid, so a half-read tariff never becomes a source. */
export function parsePctCsv(text: string): { lines: PctLine[]; errors: PctRowError[] } {
  const errors: PctRowError[] = [];
  if (Buffer.byteLength(text, 'utf8') > MAX_PCT_BYTES) return { lines: [], errors: [{ row: 0, message: `The file is larger than ${MAX_PCT_BYTES / 1024 / 1024} MB.` }] };
  const rows = parseCsv(text);
  if (rows.length < 2) return { lines: [], errors: [{ row: 0, message: 'The file has no data rows.' }] };
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const missing = (['pct_code', 'hs6', 'description', 'effective_from'] as const).filter((c) => !header.includes(c));
  if (missing.length > 0) return { lines: [], errors: [{ row: 1, message: `Required column(s) missing: ${missing.join(', ')}. Expected: ${PCT_COLUMNS.join(', ')}.` }] };
  if (rows.length - 1 > MAX_PCT_LINES) return { lines: [], errors: [{ row: 0, message: `More than ${MAX_PCT_LINES} lines.` }] };
  const col = (name: (typeof PCT_COLUMNS)[number]) => header.indexOf(name);
  const seen = new Set<string>();
  const lines: PctLine[] = [];

  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r]!;
    const cell = (name: (typeof PCT_COLUMNS)[number]): string => (col(name) >= 0 ? (cells[col(name)] ?? '').trim() : '');
    const problems: string[] = [];
    const pctCode = cell('pct_code').replace(/[.\s-]/g, '');
    const hs6 = cell('hs6').replace(/[.\s-]/g, '');
    if (!/^\d{8}$/.test(pctCode)) problems.push('pct_code must be 8 digits');
    if (!/^\d{6}$/.test(hs6)) problems.push('hs6 must be 6 digits');
    else if (/^\d{8}$/.test(pctCode) && pctCode.slice(0, 6) !== hs6) problems.push(`hs6 (${hs6}) is not the first six digits of pct_code (${pctCode})`);
    const description = cell('description');
    if (description.length < 3) problems.push('description is required');
    if (description.length > 600) problems.push('description is longer than 600 characters');
    const effectiveFrom = cell('effective_from');
    const effectiveTo = cell('effective_to');
    if (!validDate(effectiveFrom)) problems.push('effective_from must be a date as YYYY-MM-DD');
    if (effectiveTo && !validDate(effectiveTo)) problems.push('effective_to must be a date as YYYY-MM-DD, or empty');
    if (validDate(effectiveFrom) && effectiveTo && validDate(effectiveTo) && effectiveTo < effectiveFrom) problems.push('effective_to is before effective_from');
    const customs = duty(cell('customs_duty_pct'), 'customs_duty_pct', problems);
    const regulatory = duty(cell('regulatory_duty_pct'), 'regulatory_duty_pct', problems);
    const key = `${pctCode}|${effectiveFrom}`;
    if (seen.has(key)) problems.push(`the line ${pctCode} is given twice for ${effectiveFrom}`);
    seen.add(key);
    if (problems.length > 0) {
      errors.push({ row: r + 1, message: problems.join('; ') });
      if (errors.length >= 25) break;
      continue;
    }
    lines.push({
      pctCode,
      hs6,
      description,
      unit: cell('unit') || null,
      customsDutyPct: customs,
      regulatoryDutyPct: regulatory,
      notes: cell('notes').slice(0, 1000) || null,
      restrictions: cell('restrictions').slice(0, 1000) || null,
      effectiveFrom,
      effectiveTo: effectiveTo || null,
    });
  }
  return { lines: errors.length > 0 ? [] : lines, errors };
}

/** The tariff line in force on a date (effective_from <= date <= effective_to, or open-ended), the newest start winning. */
export function lineInForce(lines: PctLine[], pctCode: string, asOf: string): { line: PctLine | null; anyVersion: boolean } {
  const matching = lines.filter((l) => l.pctCode === pctCode);
  const day = asOf.slice(0, 10);
  const inForce = matching.filter((l) => l.effectiveFrom <= day && (!l.effectiveTo || day <= l.effectiveTo)).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return { line: inForce[0] ?? null, anyVersion: matching.length > 0 };
}
