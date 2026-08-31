import { config } from '../config';
import type { DocumentUnit } from '../models/document.model';

/**
 * Stage 4: group units into the batches that will each become one AI request.
 *
 * This is the answer to "you cannot send a 400-page document in one call". The grouping is
 * deliberately *logical* rather than a blind character split:
 *
 *  - a batch never straddles a section boundary while it still has room elsewhere, so the
 *    model sees passages that share a context;
 *  - a batch closes on whichever limit is reached first — unit count or token budget — so
 *    twelve one-line list items and two dense pages of prose both produce a sane request;
 *  - each unit keeps its identity (`id`) inside the batch, so the model's answers are
 *    matched back by id rather than by position, and a partial response can be detected and
 *    retried instead of silently mis-assigning classifications.
 *
 * Units below the configured minimum length are excluded here: they are still analysed and
 * still shown, but by the local lexicon engine, which costs nothing and is more predictable
 * on fragments than a language model.
 */

const PROMPT_BASELINE_TOKENS = 410; // System prompt (~380 tokens) + request header (~30 tokens)
const PER_UNIT_ENVELOPE_TOKENS = 25; // XML tags, id, type, page metadata

export interface AnalysisBatch {
  index: number;
  units: DocumentUnit[];
  /** Total estimated request tokens (input prompt text + system prompt + unit metadata + reserved output). */
  estimatedTokens: number;
  /** Estimated input prompt tokens alone. */
  inputTokens: number;
  /** Reserved output tokens for this batch. */
  outputTokens: number;
  /** The section shared by the batch, when it has one — included in the prompt as context. */
  section: string | null;
  firstPage: number;
  lastPage: number;
}

export interface ChunkPlan {
  batches: AnalysisBatch[];
  /** Units routed to the local engine because they are shorter than MIN_UNIT_CHARS. */
  localUnits: DocumentUnit[];
  aiUnitCount: number;
}

/** Cheap, provider-agnostic token estimate. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

/** Estimate total tokens for a hypothetical batch with given units */
export function estimateBatchRequestTokens(units: readonly DocumentUnit[], outputBudget?: number): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const unitsTextTokens = units.reduce((sum, u) => sum + estimateTokens(u.text), 0);
  const metadataTokens = units.length * PER_UNIT_ENVELOPE_TOKENS;
  const inputTokens = PROMPT_BASELINE_TOKENS + unitsTextTokens + metadataTokens;
  // Estimate ~55 output tokens per classified unit with a baseline buffer
  const outTokens = outputBudget && outputBudget > 0 ? outputBudget : Math.max(300, units.length * 55 + 100);
  const totalTokens = inputTokens + outTokens;
  return { inputTokens, outputTokens: outTokens, totalTokens };
}

export function planChunks(units: readonly DocumentUnit[]): ChunkPlan {
  const { unitsPerBatch, batchTokenBudget, minUnitChars } = config.processing;

  const localUnits: DocumentUnit[] = [];
  const aiUnits: DocumentUnit[] = [];
  for (const unit of units) {
    if (unit.charCount < minUnitChars) localUnits.push(unit);
    else aiUnits.push(unit);
  }

  const batches: AnalysisBatch[] = [];
  let current: DocumentUnit[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const pages = current.map((unit) => unit.pageNumber);
    const { inputTokens, outputTokens, totalTokens } = estimateBatchRequestTokens(current);

    batches.push({
      index: batches.length,
      units: current,
      estimatedTokens: totalTokens,
      inputTokens,
      outputTokens,
      section: sharedSection(current),
      firstPage: Math.min(...pages),
      lastPage: Math.max(...pages),
    });
    current = [];
  };

  for (const unit of aiUnits) {
    const candidate = [...current, unit];
    const { totalTokens } = estimateBatchRequestTokens(candidate);
    const previous = current.at(-1);

    const exceedsUnits = current.length >= unitsPerBatch;
    // Allow single unit even if it slightly exceeds budget on its own, but close batch before adding 2nd unit
    const exceedsTokens = current.length > 0 && totalTokens > batchTokenBudget;
    // Keep sections together when batch is large enough, but don't fracture batches when tiny
    const crossesSection =
      previous !== undefined &&
      previous.section !== unit.section &&
      current.length >= Math.max(6, Math.floor(unitsPerBatch / 2));

    if (exceedsUnits || exceedsTokens || crossesSection) {
      flush();
    }

    current.push(unit);
  }
  flush();

  return { batches, localUnits, aiUnitCount: aiUnits.length };
}

function sharedSection(units: readonly DocumentUnit[]): string | null {
  const first = units[0]?.section ?? null;
  return units.every((unit) => unit.section === first) ? first : null;
}
