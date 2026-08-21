import { randomUUID } from 'node:crypto';
import { config } from '../config';
import type { UnitType } from '../config/taxonomy';
import type { DocumentUnit } from '../models/document.model';
import type { RawBlock } from './extractors';
import { countWords, isMeaningless, normalizeUnitText } from './text-normalizer';

/**
 * Stage 3 of the pipeline: turn extractor blocks into the analysable units the rest of the
 * system reasons about.
 *
 * What happens here, and why:
 *
 *  - **Structure is preserved, not flattened.** Every unit keeps its page, its nearest
 *    enclosing heading (the section), its index within the page and within the document,
 *    and its structural role. That context travels with the unit into the AI prompt, the
 *    results explorer and the TXT report.
 *  - **Fragments are re-joined.** Extraction routinely leaves orphaned scraps behind — a
 *    stray clause split across a column break, a wrapped list continuation. A short
 *    fragment that clearly continues the previous paragraph is merged back into it rather
 *    than being analysed as if it were a standalone thought.
 *  - **Oversized units are split on sentence boundaries.** A 12,000-character wall of text
 *    is split where sentences end, never mid-word and never mid-sentence.
 *  - **Nothing is silently discarded.** Units too short to classify meaningfully are still
 *    kept and still appear in the results; they are simply routed to the local lexicon
 *    engine instead of costing an AI call. Only a document that exceeds the hard unit cap
 *    loses content, and that count is reported to the user.
 */

export interface SegmentationResult {
  /** Every unit that will be classified and shown, in reading order. */
  units: DocumentUnit[];
  /** Units the segmenter produced before the cap was applied. */
  totalUnits: number;
  /** Units below the AI threshold — analysed locally rather than sent to the model. */
  shortUnits: number;
  /** Units dropped because the document exceeded MAX_ANALYSIS_UNITS. Always reported. */
  skippedOverCapUnits: number;
  totalWords: number;
  totalCharacters: number;
  hasDetectedHeadings: boolean;
  sections: string[];
  warnings: string[];
}

interface Pending {
  pageNumber: number;
  kind: UnitType;
  level?: number;
  text: string;
}

/** Merge a block shorter than this into the preceding paragraph when it looks like a continuation. */
const FRAGMENT_MERGE_CHARS = 40;

export function segment(blocks: RawBlock[]): SegmentationResult {
  const warnings: string[] = [];
  const merged = mergeFragments(blocks);

  const sections: string[] = [];
  const units: DocumentUnit[] = [];

  let currentSection: string | null = null;
  let currentSectionLevel: number | null = null;
  let paragraphNumber = 0;
  let pageParagraphNumber = 0;
  let currentPage = -1;
  let shortUnits = 0;
  let totalWords = 0;
  let totalCharacters = 0;
  let produced = 0;
  let skippedOverCapUnits = 0;

  for (const block of merged) {
    const text = normalizeUnitText(block.text);
    if (text.length === 0 || isMeaningless(text)) continue;

    if (block.kind === 'heading') {
      currentSection = text;
      currentSectionLevel = block.level ?? 2;
      if (!sections.includes(text)) sections.push(text);
    }

    // A single block may yield several units when it is very long.
    for (const piece of splitOversized(text, config.processing.maxUnitChars)) {
      produced += 1;
      if (units.length >= config.processing.maxUnits) {
        skippedOverCapUnits += 1;
        continue;
      }

      if (block.pageNumber !== currentPage) {
        currentPage = block.pageNumber;
        pageParagraphNumber = 0;
      }
      paragraphNumber += 1;
      pageParagraphNumber += 1;

      const words = countWords(piece);
      totalWords += words;
      totalCharacters += piece.length;
      if (piece.length < config.processing.minUnitChars) shortUnits += 1;

      units.push({
        id: randomUUID(),
        pageNumber: block.pageNumber,
        // A heading names its own section; it is not nested inside itself.
        section: block.kind === 'heading' ? (sectionParentOf(sections, text) ?? null) : currentSection,
        sectionLevel: block.kind === 'heading' ? (block.level ?? 2) : currentSectionLevel,
        paragraphNumber,
        pageParagraphNumber,
        unitType: block.kind,
        text: piece,
        charCount: piece.length,
        wordCount: words,
      });
    }
  }

  if (skippedOverCapUnits > 0) {
    warnings.push(
      `This document produced ${produced.toLocaleString()} analysable units; the first ${config.processing.maxUnits.toLocaleString()} were analysed and ${skippedOverCapUnits.toLocaleString()} were left out to keep processing within limits.`,
    );
  }

  return {
    units,
    totalUnits: produced,
    shortUnits,
    skippedOverCapUnits,
    totalWords,
    totalCharacters,
    hasDetectedHeadings: sections.length > 0,
    sections,
    warnings,
  };
}

/**
 * The section a heading itself belongs to is its nearest shallower ancestor, so a level-3
 * heading reports the level-2 heading above it rather than naming itself.
 */
function sectionParentOf(sections: string[], heading: string): string | undefined {
  const index = sections.lastIndexOf(heading);
  return index > 0 ? sections[index - 1] : undefined;
}

/**
 * Re-join blocks the extractor over-split.
 *
 * Two cases matter: a very short block that does not start like a new sentence and follows
 * a paragraph that did not end like one (a clause orphaned by a column or page break), and
 * a paragraph whose predecessor ends mid-word or mid-clause.
 */
function mergeFragments(blocks: RawBlock[]): Pending[] {
  const out: Pending[] = [];

  for (const block of blocks) {
    const text = block.text.trim();
    if (text.length === 0) continue;

    const previous = out.at(-1);
    if (
      previous &&
      previous.kind === 'paragraph' &&
      block.kind === 'paragraph' &&
      shouldMerge(previous.text, text)
    ) {
      previous.text = joinContinuation(previous.text, text);
      continue;
    }

    out.push({
      pageNumber: block.pageNumber,
      kind: block.kind,
      ...(block.level !== undefined ? { level: block.level } : {}),
      text,
    });
  }

  return out;
}

function shouldMerge(previous: string, next: string): boolean {
  const previousEndsOpen = !/[.!?:;"'’”)\]]$/.test(previous);
  const nextStartsLower = /^[a-z,;)’”]/.test(next);

  // A dangling clause continuing in lower case is the clearest signal.
  if (previousEndsOpen && nextStartsLower) return true;
  // A tiny scrap that cannot stand alone belongs to whatever preceded it.
  if (next.length <= FRAGMENT_MERGE_CHARS && previousEndsOpen) return true;
  return false;
}

function joinContinuation(previous: string, next: string): string {
  if (/[A-Za-z]-$/.test(previous) && /^[a-z]/.test(next)) {
    return `${previous.slice(0, -1)}${next}`;
  }
  return `${previous} ${next}`;
}

/**
 * Split a unit that exceeds `limit` characters at sentence boundaries.
 *
 * Sentence ends are preferred; a clause boundary is the fallback; a hard cut at a word
 * boundary is the last resort. A word is never broken and no text is dropped.
 */
export function splitOversized(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const sentences = splitSentences(text);
  const pieces: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length === 0) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= limit) {
      current = `${current} ${sentence}`;
    } else {
      pieces.push(current);
      current = sentence;
    }

    // A single sentence longer than the limit still has to be broken.
    while (current.length > limit) {
      const cut = findWordBoundary(current, limit);
      pieces.push(current.slice(0, cut).trim());
      current = current.slice(cut).trim();
    }
  }

  if (current.length > 0) pieces.push(current);
  return pieces.filter((piece) => piece.length > 0);
}

/** Sentence boundary: terminator, optional closing quote/bracket, whitespace, capital or digit. */
const SENTENCE_BOUNDARY = /(?<=[.!?][")'’”\]]?)\s+(?=[A-Z0-9"'(‘“])/g;

function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function findWordBoundary(text: string, limit: number): number {
  const window = text.slice(0, limit);
  const clause = Math.max(window.lastIndexOf('; '), window.lastIndexOf(', '), window.lastIndexOf(' — '));
  if (clause > limit * 0.5) return clause + 1;
  const space = window.lastIndexOf(' ');
  return space > limit * 0.4 ? space : limit;
}
