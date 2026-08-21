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

export interface AnalysisBatch {
  index: number;
  units: DocumentUnit[];
  /** Rough token estimate for the batch's text, used only for batch sizing. */
  estimatedTokens: number;
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

/** Cheap, provider-agnostic token estimate. Only ever used to decide where a batch ends. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
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
  let currentTokens = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const pages = current.map((unit) => unit.pageNumber);
    batches.push({
      index: batches.length,
      units: current,
      estimatedTokens: currentTokens,
      section: sharedSection(current),
      firstPage: Math.min(...pages),
      lastPage: Math.max(...pages),
    });
    current = [];
    currentTokens = 0;
  };

  for (const unit of aiUnits) {
    const tokens = estimateTokens(unit.text);
    const previous = current.at(-1);

    const full = current.length >= unitsPerBatch || (current.length > 0 && currentTokens + tokens > batchTokenBudget);
    // Keep sections together, but only once the batch is substantial enough to be worth closing.
    const crossesSection =
      previous !== undefined && previous.section !== unit.section && current.length >= Math.max(2, Math.floor(unitsPerBatch / 3));

    if (full || crossesSection) flush();

    current.push(unit);
    currentTokens += tokens;
  }
  flush();

  return { batches, localUnits, aiUnitCount: aiUnits.length };
}

function sharedSection(units: readonly DocumentUnit[]): string | null {
  const first = units[0]?.section ?? null;
  return units.every((unit) => unit.section === first) ? first : null;
}
