import { Errors, describeUnknown } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import type { Extractor, ExtractionResult, RawBlock } from './types';

const log = createLogger('extract:pdf');

/**
 * PDF text extraction that rebuilds document structure from glyph geometry.
 *
 * A PDF stores positioned glyph runs, not paragraphs — so recovering "page 4, paragraph 12"
 * means reassembling it: group text items into lines by baseline, group lines into blocks by
 * the vertical gap between them relative to the page's own median line spacing, and promote a
 * line to a heading when its font is larger than the body font or it looks like a numbered
 * section title. Running headers/footers repeated across pages are detected and dropped.
 */

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
  hasEOL?: boolean;
}

interface Line {
  y: number;
  xStart: number;
  xEnd: number;
  fontSize: number;
  text: string;
}

// pdfjs-dist v3 ships a CommonJS "legacy" build that runs in Node without a DOM.
/* eslint-disable @typescript-eslint/no-var-requires */
type PdfjsModule = {
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocumentProxy> };
};
interface PdfDocumentProxy {
  numPages: number;
  getPage(n: number): Promise<PdfPageProxy>;
  destroy(): Promise<void>;
}
interface PdfPageProxy {
  getTextContent(options?: Record<string, unknown>): Promise<{ items: unknown[] }>;
  getViewport(options: { scale: number }): { width: number; height: number };
  cleanup(): void;
}

let pdfjsCache: PdfjsModule | null = null;
function loadPdfjs(): PdfjsModule {
  if (!pdfjsCache) {
    // pdfjs tries to polyfill the browser drawing APIs from the optional `canvas` package and
    // warns loudly on every load when it is absent. Text extraction never draws anything, so a
    // pair of inert stubs satisfies the check and keeps the logs about documents instead.
    const globals = globalThis as Record<string, unknown>;
    globals['DOMMatrix'] ??= class {};
    globals['Path2D'] ??= class {};
    globals['ImageData'] ??= class {};

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pdfjsCache = require('pdfjs-dist/legacy/build/pdf.js') as PdfjsModule;
  }
  return pdfjsCache;
}

export class PdfExtractor implements Extractor {
  readonly id = 'pdfjs-dist/legacy';
  readonly fileType = 'pdf' as const;

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    const pdfjs = loadPdfjs();
    const warnings: string[] = [];

    let doc: PdfDocumentProxy;
    try {
      doc = await pdfjs.getDocument({
        // Copy into a fresh Uint8Array: pdfjs takes ownership of the buffer it is given.
        data: new Uint8Array(buffer),
        isEvalSupported: false,
        useSystemFonts: false,
        useWorkerFetch: false,
        disableFontFace: true,
        verbosity: 0,
      }).promise;
    } catch (error) {
      const detail = describeUnknown(error);
      if (/password/i.test(detail)) {
        throw Errors.corruptFile(`Password protected PDF: ${detail}`);
      }
      throw Errors.corruptFile(`pdfjs failed to open document: ${detail}`);
    }

    try {
      const pageLines: Line[][] = [];

      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        try {
          const content = await page.getTextContent({ includeMarkedContent: false });
          pageLines.push(buildLines(content.items as PdfTextItem[]));
        } catch (error) {
          warnings.push(`Page ${pageNumber} could not be read and was skipped.`);
          log.warn('page text extraction failed', { pageNumber, error: describeUnknown(error) });
          pageLines.push([]);
        } finally {
          page.cleanup();
        }
      }

      const bodyFontSize = medianOf(
        pageLines.flat().flatMap((line) => (line.text.length >= 12 ? [line.fontSize] : [])),
      );

      const repeated = findRepeatedEdgeLines(pageLines);
      if (repeated.size > 0) {
        warnings.push(
          `${repeated.size} running header/footer line${repeated.size === 1 ? '' : 's'} repeated across pages were excluded from analysis.`,
        );
      }

      const blocks: RawBlock[] = [];
      const textParts: string[] = [];

      pageLines.forEach((lines, index) => {
        const pageNumber = index + 1;
        const kept = lines.filter((line) => !repeated.has(normalizeForRepeat(line.text)));
        const pageBlocks = groupLinesIntoBlocks(kept, bodyFontSize, pageNumber);
        blocks.push(...pageBlocks);
        if (pageBlocks.length > 0) {
          textParts.push(pageBlocks.map((block) => block.text).join('\n\n'));
        }
      });

      const text = textParts.join('\n\n');
      if (text.trim().length === 0) {
        throw Errors.emptyDocument();
      }

      return {
        extractor: this.id,
        pageCount: doc.numPages,
        pagesEstimated: false,
        blocks,
        text,
        warnings,
      };
    } finally {
      await doc.destroy().catch(() => undefined);
    }
  }
}

/** Group positioned text items into visual lines by baseline, then order left to right. */
function buildLines(items: PdfTextItem[]): Line[] {
  const candidates = items.filter(
    (item): item is PdfTextItem => typeof item?.str === 'string' && Array.isArray(item.transform),
  );

  interface Bucket {
    y: number;
    items: PdfTextItem[];
  }
  const buckets: Bucket[] = [];

  for (const item of candidates) {
    if (item.str.trim().length === 0) continue;
    const y = item.transform[5] ?? 0;
    const fontSize = itemFontSize(item);
    const tolerance = Math.max(1.5, fontSize * 0.35);
    const bucket = buckets.find((entry) => Math.abs(entry.y - y) <= tolerance);
    if (bucket) {
      bucket.items.push(item);
      // Keep the bucket anchored on its densest baseline.
      bucket.y = (bucket.y * (bucket.items.length - 1) + y) / bucket.items.length;
    } else {
      buckets.push({ y, items: [item] });
    }
  }

  // PDF user space has y increasing upward, so descending y is reading order.
  buckets.sort((a, b) => b.y - a.y);

  return buckets
    .map((bucket) => {
      const ordered = [...bucket.items].sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0));
      let text = '';
      let cursorX: number | null = null;

      for (const item of ordered) {
        const x = item.transform[4] ?? 0;
        const fontSize = itemFontSize(item);
        if (cursorX !== null) {
          const gap = x - cursorX;
          const needsSpace = gap > fontSize * 0.22 && !text.endsWith(' ') && !item.str.startsWith(' ');
          if (needsSpace) text += ' ';
        }
        text += item.str;
        cursorX = x + (item.width ?? 0);
      }

      const xs = ordered.map((item) => item.transform[4] ?? 0);
      const fontSizes = ordered.filter((item) => item.str.trim().length > 0).map(itemFontSize);

      return {
        y: bucket.y,
        xStart: Math.min(...xs),
        xEnd: cursorX ?? Math.max(...xs),
        fontSize: medianOf(fontSizes) || 10,
        text: text.replace(/\s+/g, ' ').trim(),
      } satisfies Line;
    })
    .filter((line) => line.text.length > 0);
}

function itemFontSize(item: PdfTextItem): number {
  const [, b = 0, c = 0, d = 0] = item.transform;
  const scaled = Math.hypot(b, d) || Math.hypot(c, d) || Math.abs(d);
  return scaled > 0 ? scaled : (item.height ?? 10);
}

/**
 * Turn a page's lines into blocks. The decision to break is relative to the page's own
 * median line gap, so it adapts to single- vs double-spaced documents instead of using a
 * fixed pixel threshold.
 */
function groupLinesIntoBlocks(lines: Line[], bodyFontSize: number, pageNumber: number): RawBlock[] {
  if (lines.length === 0) return [];

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const gap = (lines[i - 1] as Line).y - (lines[i] as Line).y;
    if (gap > 0 && gap < 200) gaps.push(gap);
  }
  const medianGap = medianOf(gaps) || (bodyFontSize || 10) * 1.2;
  const paragraphGap = medianGap * 1.4;
  const leftMargin = Math.min(...lines.map((line) => line.xStart));

  const blocks: RawBlock[] = [];
  let current: { lines: Line[]; kind: RawBlock['kind']; level?: number } | null = null;

  const flush = (): void => {
    if (!current || current.lines.length === 0) return;
    const text = joinWrappedLines(current.lines.map((line) => line.text));
    if (text.trim().length > 0) {
      blocks.push({
        pageNumber,
        kind: current.kind,
        ...(current.level !== undefined ? { level: current.level } : {}),
        text,
      });
    }
    current = null;
  };

  lines.forEach((line, index) => {
    const previous = index > 0 ? (lines[index - 1] as Line) : null;
    const gap = previous ? previous.y - line.y : 0;

    const heading = detectHeading(line, bodyFontSize);
    const listItem = LIST_PREFIX.test(line.text);
    const tableRow = looksLikeTableRow(line);
    const equation = looksLikeEquation(line.text);

    const kind: RawBlock['kind'] = heading
      ? 'heading'
      : equation
        ? 'equation'
        : listItem
          ? 'list_item'
          : tableRow
            ? 'table_row'
            : 'paragraph';

    const startsNewBlock =
      current === null ||
      kind !== current.kind ||
      heading ||
      listItem ||
      equation ||
      (previous !== null && gap > paragraphGap) ||
      // An indented line after a sentence-final line is a new paragraph, not a wrap.
      (previous !== null &&
        line.xStart > leftMargin + bodyFontSize * 0.8 &&
        /[.!?:;]["')\]]?$/.test(previous.text)) ||
      // A short previous line that ended a sentence also terminates the paragraph.
      (previous !== null &&
        previous.xEnd < Math.max(...lines.map((l) => l.xEnd)) * 0.78 &&
        /[.!?]["')\]]?$/.test(previous.text));

    if (startsNewBlock) {
      flush();
      current = { lines: [line], kind, ...(heading ? { level: heading.level } : {}) };
    } else {
      (current as { lines: Line[] }).lines.push(line);
    }
  });

  flush();
  return blocks;
}

const LIST_PREFIX = /^\s*(?:[•▪◦●·‣∙*+-]|\(?\d{1,2}[.)]|[a-z][.)]|[ivxlcdm]{1,5}[.)])\s+\S/i;
const NUMBERED_HEADING = /^\s*\d{1,2}(?:\.\d{1,2}){0,3}\.?\s+[A-Z(]/;

function detectHeading(line: Line, bodyFontSize: number): { level: number } | null {
  const text = line.text.trim();
  if (text.length === 0 || text.length > 140) return null;
  if (LIST_PREFIX.test(text) && !NUMBERED_HEADING.test(text)) return null;

  const relativeSize = bodyFontSize > 0 ? line.fontSize / bodyFontSize : 1;
  const endsLikeSentence = /[.!?,;]$/.test(text);
  const letters = text.replace(/[^A-Za-z]/g, '');
  const isAllCaps = letters.length >= 3 && letters === letters.toUpperCase();
  const wordCount = text.split(/\s+/).length;

  if (relativeSize >= 1.45) return { level: 1 };
  if (relativeSize >= 1.18) return { level: 2 };
  if (NUMBERED_HEADING.test(text) && wordCount <= 14 && !endsLikeSentence) {
    const depth = (text.match(/^\s*(\d{1,2}(?:\.\d{1,2})*)/)?.[1] ?? '').split('.').length;
    return { level: Math.min(4, depth) };
  }
  if (isAllCaps && wordCount <= 12 && !endsLikeSentence) return { level: 2 };
  return null;
}

function looksLikeTableRow(line: Line): boolean {
  // Multiple runs separated by wide whitespace, or pipe-delimited — typical of tabular text.
  if (/\|/.test(line.text) && line.text.split('|').length >= 3) return true;
  const wideGaps = line.text.match(/\s{3,}/g)?.length ?? 0;
  return wideGaps >= 2 && line.text.length < 200;
}

const MATH_SYMBOLS = /[=≈≤≥≠±×÷∑∏∫√∞∂∇πθλμσΔ∈∉⊂⊆→←↔^]/g;

function looksLikeEquation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 220) return false;
  const symbols = trimmed.match(MATH_SYMBOLS)?.length ?? 0;
  if (symbols === 0) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, '').length;
  const digitsAndSymbols = trimmed.replace(/[^0-9=≈≤≥≠±×÷∑∏∫√^+\-*/()]/g, '').length;
  // Equations are symbol-dense and word-sparse.
  return symbols >= 1 && digitsAndSymbols >= letters * 0.6 && trimmed.split(/\s+/).length <= 24;
}

/** Rejoin wrapped lines, repairing words split by a hyphen at the line break. */
function joinWrappedLines(lines: string[]): string {
  let result = '';
  for (const line of lines) {
    if (result.length === 0) {
      result = line;
      continue;
    }
    if (/[A-Za-z]-$/.test(result) && /^[a-z]/.test(line)) {
      result = `${result.slice(0, -1)}${line}`;
    } else {
      result = `${result} ${line}`;
    }
  }
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Lines that appear near the top or bottom edge of at least a third of the pages (and on
 * more than two pages) are running headers/footers. Page numbers vary, so digits are
 * masked before comparison.
 */
function findRepeatedEdgeLines(pageLines: Line[][]): Set<string> {
  const pagesWithText = pageLines.filter((lines) => lines.length > 0);
  if (pagesWithText.length < 4) return new Set();

  const counts = new Map<string, number>();
  for (const lines of pagesWithText) {
    const edge = new Set<string>();
    for (const line of lines.slice(0, 2)) edge.add(normalizeForRepeat(line.text));
    for (const line of lines.slice(-2)) edge.add(normalizeForRepeat(line.text));
    for (const key of edge) {
      if (key.length < 3) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.ceil(pagesWithText.length / 3));
  const repeated = new Set<string>();
  for (const [key, count] of counts) {
    if (count >= threshold) repeated.add(key);
  }
  return repeated;
}

function normalizeForRepeat(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
    : (sorted[middle] as number);
}