import WordExtractorLib from 'word-extractor';
import { Errors, describeUnknown } from '../../utils/errors';
import type { Extractor, ExtractionResult, RawBlock } from './types';

/**
 * Legacy Word (.doc, OLE compound binary) extraction.
 *
 * The binary format exposes no reliable style information through `word-extractor`, so
 * structure is inferred from the plain text: blank-line separated blocks, with headings and
 * list items recognised by shape. Pages are estimated, as with DOCX.
 */

const CHARS_PER_ESTIMATED_PAGE = 1800;
const LIST_PREFIX = /^\s*(?:[•▪◦●·‣∙*+-]|\(?\d{1,2}[.)]|[a-z][.)])\s+\S/i;
const NUMBERED_HEADING = /^\s*\d{1,2}(?:\.\d{1,2}){0,3}\.?\s+[A-Z(]/;
const MATH_SYMBOLS = /[=≈≤≥≠±×÷∑∏∫√∞∂∇πθλμσΔ∈∉⊂⊆→←↔]/g;

export class DocExtractor implements Extractor {
  readonly id = 'word-extractor/doc';
  readonly fileType = 'doc' as const;

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    const warnings: string[] = [];

    let body: string;
    try {
      // The package exports a class in both CJS and ESM interop shapes.
      const Ctor = (WordExtractorLib as unknown as { default?: new () => { extract(b: Buffer): Promise<{ getBody(): string; getFootnotes(): string }> } }).default
        ?? (WordExtractorLib as unknown as new () => { extract(b: Buffer): Promise<{ getBody(): string; getFootnotes(): string }> });
      const extractor = new Ctor();
      const document = await extractor.extract(buffer);
      body = document.getBody();
      const footnotes = document.getFootnotes?.() ?? '';
      if (footnotes.trim().length > 0) body = `${body}\n\n${footnotes}`;
    } catch (error) {
      throw Errors.corruptFile(`word-extractor failed to read .doc: ${describeUnknown(error)}`);
    }

    const normalized = body.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    const rawBlocks = normalized
      .split(/\n{2,}/)
      .flatMap((chunk) => chunk.split('\n').map((line) => line.trim()))
      .filter((line) => line.length > 0);

    if (rawBlocks.length === 0) throw Errors.emptyDocument();

    const blocks: RawBlock[] = [];
    let runningChars = 0;

    for (const line of rawBlocks) {
      const text = line.replace(/\s+/g, ' ').trim();
      if (text.length === 0) continue;
      const kind = classifyLine(text);
      const pageNumber = Math.floor(runningChars / CHARS_PER_ESTIMATED_PAGE) + 1;
      blocks.push({
        pageNumber,
        kind,
        ...(kind === 'heading' ? { level: headingLevel(text) } : {}),
        text,
      });
      runningChars += text.length + 2;
    }

    const text = blocks.map((block) => block.text).join('\n\n');
    if (text.trim().length === 0) throw Errors.emptyDocument();

    warnings.push(
      'Legacy .doc files carry no recoverable style information, so headings and page numbers are inferred from the text itself. Converting to .docx yields a more accurate structural breakdown.',
    );

    return {
      extractor: this.id,
      pageCount: Math.max(1, blocks.at(-1)?.pageNumber ?? 1),
      pagesEstimated: true,
      blocks,
      text,
      warnings,
    };
  }
}

function classifyLine(text: string): RawBlock['kind'] {
  if (looksLikeEquation(text)) return 'equation';
  if (LIST_PREFIX.test(text)) return 'list_item';
  if (text.split('\t').length >= 3 || (text.match(/\s{3,}/g)?.length ?? 0) >= 2) return 'table_row';
  if (isHeading(text)) return 'heading';
  return 'paragraph';
}

function isHeading(text: string): boolean {
  if (text.length > 120) return false;
  const wordCount = text.split(/\s+/).length;
  const endsLikeSentence = /[.!?,;]$/.test(text);
  if (NUMBERED_HEADING.test(text) && wordCount <= 14 && !endsLikeSentence) return true;
  const letters = text.replace(/[^A-Za-z]/g, '');
  const isAllCaps = letters.length >= 3 && letters === letters.toUpperCase();
  return isAllCaps && wordCount <= 12 && !endsLikeSentence;
}

function headingLevel(text: string): number {
  const numbering = text.match(/^\s*(\d{1,2}(?:\.\d{1,2})*)/)?.[1];
  if (numbering) return Math.min(4, numbering.split('.').length);
  return 2;
}

function looksLikeEquation(text: string): boolean {
  if (text.length === 0 || text.length > 220) return false;
  const symbols = text.match(MATH_SYMBOLS)?.length ?? 0;
  if (symbols === 0) return false;
  const letters = text.replace(/[^A-Za-z]/g, '').length;
  return text.split(/\s+/).length <= 24 && symbols * 6 >= letters;
}