import { z } from 'zod';
import { Errors } from '../utils/errors';
import { TAXONOMY, coerceValue, type DimensionId } from '../config/taxonomy';
import type { ClassificationResponse, SummaryResponse, UnitClassification } from './types';

/**
 * Validation of model output.
 *
 * Nothing a provider returns is trusted. A response is located inside whatever the model
 * actually emitted, parsed, shape-checked with zod, and then every field is coerced into the
 * taxonomy before it can reach storage. Values outside the taxonomy become the dimension's
 * documented fallback and are counted, so a drifting model shows up as a `coercedFields`
 * number in the logs rather than as invented categories in the UI.
 *
 * Ids are the contract: a row whose id was not in the request is discarded, and any requested
 * id the model omitted is returned in `missingIds` so the caller can retry or fall back
 * rather than shifting classifications onto the wrong passages.
 */

const MAX_KEYWORDS = 4;
const MAX_KEYWORD_LENGTH = 48;

/** Deliberately permissive: field-level correctness is enforced by coercion, not by rejection. */
const RowSchema = z
  .object({
    id: z.string().min(1),
    confidence: z.unknown().optional(),
    keywords: z.unknown().optional(),
  })
  .passthrough();

const PayloadSchema = z.object({
  results: z.array(z.unknown()).min(1),
});

const SummarySchema = z.object({
  headline: z.string().min(1),
  narrative: z.string().min(1),
  highlights: z.array(z.string()).optional(),
});

export function parseClassificationPayload(raw: string, expectedIds: readonly string[]): ClassificationResponse {
  const json = extractJsonObject(raw);
  if (json === null) {
    throw Errors.aiInvalidResponse(`No JSON object found in model output (${raw.slice(0, 300)})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw Errors.aiInvalidResponse(`Model output was not valid JSON: ${(error as Error).message}`);
  }

  const payload = PayloadSchema.safeParse(normalizeEnvelope(parsed));
  if (!payload.success) {
    throw Errors.aiInvalidResponse(`Model output did not match the expected shape: ${payload.error.message.slice(0, 300)}`);
  }

  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  const classifications: UnitClassification[] = [];
  let coercedFields = 0;

  for (const entry of payload.data.results) {
    const row = RowSchema.safeParse(entry);
    if (!row.success) continue;

    const id = row.data.id;
    // Rows for ids we never asked about cannot be placed, and duplicates would overwrite.
    if (!expected.has(id) || seen.has(id)) continue;
    seen.add(id);

    const record = entry as Record<string, unknown>;
    const values: Record<DimensionId, string> = {} as Record<DimensionId, string>;
    for (const dimension of TAXONOMY) {
      const coerced = coerceValue(dimension.id, record[dimension.id]);
      if (!coerced.exact) coercedFields += 1;
      values[dimension.id] = coerced.value;
    }

    classifications.push({
      id,
      sentiment: values.sentiment,
      emotion: values.emotion,
      contentType: values.contentType,
      topic: values.topic,
      confidence: normalizeConfidence(row.data.confidence),
      keywords: normalizeKeywords(row.data.keywords),
    });
  }

  return {
    classifications,
    missingIds: expectedIds.filter((id) => !seen.has(id)),
    coercedFields,
  };
}

export function parseSummaryPayload(raw: string): SummaryResponse {
  const json = extractJsonObject(raw);
  if (json === null) throw Errors.aiInvalidResponse('No JSON object found in summary output');

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw Errors.aiInvalidResponse(`Summary output was not valid JSON: ${(error as Error).message}`);
  }

  const result = SummarySchema.safeParse(parsed);
  if (!result.success) {
    throw Errors.aiInvalidResponse(`Summary output did not match the expected shape: ${result.error.message.slice(0, 300)}`);
  }

  return {
    headline: clampText(result.data.headline, 160),
    narrative: clampText(result.data.narrative, 900),
    highlights: (result.data.highlights ?? [])
      .map((highlight) => clampText(highlight, 200))
      .filter((highlight) => highlight.length > 0)
      .slice(0, 5),
  };
}

/** Accept `{results:[...]}`, a bare array, or a single-key wrapper around either. */
function normalizeEnvelope(parsed: unknown): unknown {
  if (Array.isArray(parsed)) return { results: parsed };
  if (parsed === null || typeof parsed !== 'object') return parsed;

  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record['results'])) return parsed;

  for (const key of ['classifications', 'passages', 'units', 'data', 'items', 'output']) {
    if (Array.isArray(record[key])) return { results: record[key] };
  }
  return parsed;
}

/**
 * Locate a JSON object inside arbitrary model output.
 *
 * Handles markdown fences, leading prose, and trailing commentary by scanning for the first
 * brace or bracket and tracking nesting depth while ignoring braces inside string literals.
 */
export function extractJsonObject(raw: string): string | null {
  const text = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');

  const start = firstIndexOfEither(text, '{', '[');
  if (start === -1) return null;

  const open = text[start] === '{' ? '{' : '[';
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  // Truncated output (hit the token ceiling mid-object) is not recoverable.
  return null;
}

function firstIndexOfEither(text: string, a: string, b: string): number {
  const indexA = text.indexOf(a);
  const indexB = text.indexOf(b);
  if (indexA === -1) return indexB;
  if (indexB === -1) return indexA;
  return Math.min(indexA, indexB);
}

function normalizeConfidence(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(value)) return 0.6;
  // Models sometimes answer on a 0–100 scale despite the instruction.
  const scaled = value > 1 && value <= 100 ? value / 100 : value;
  return Math.min(1, Math.max(0, Math.round(scaled * 100) / 100));
}

function normalizeKeywords(raw: unknown): string[] {
  const source = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;]/) : [];
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const entry of source) {
    if (typeof entry !== 'string') continue;
    const keyword = entry.trim().replace(/\s+/g, ' ').slice(0, MAX_KEYWORD_LENGTH);
    const key = keyword.toLowerCase();
    if (keyword.length < 2 || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
    if (keywords.length >= MAX_KEYWORDS) break;
  }
  return keywords;
}

function clampText(value: string, limit: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}
