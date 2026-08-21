import mammoth from 'mammoth';
import { parse as parseHtml, type HTMLElement, type Node as HtmlNode } from 'node-html-parser';
import { Errors, describeUnknown } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import type { Extractor, ExtractionResult, RawBlock } from './types';

const log = createLogger('extract:docx');

/**
 * Word (.docx) extraction via mammoth's HTML conversion.
 *
 * Unlike a PDF, a DOCX carries real structure — headings, lists, tables, blockquotes — so
 * we convert to semantic HTML and read the elements directly rather than guessing from
 * geometry. DOCX has no fixed pagination (pages are a rendering artefact), so page numbers
 * are estimated from cumulative character count and flagged as estimated in the response.
 */

/** Characters of body text per estimated page — roughly a densely typed A4 page. */
const CHARS_PER_ESTIMATED_PAGE = 1800;

const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
];

export class DocxExtractor implements Extractor {
  readonly id = 'mammoth/docx';
  readonly fileType = 'docx' as const;

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    const warnings: string[] = [];

    let html: string;
    try {
      const result = await mammoth.convertToHtml({ buffer }, { styleMap: STYLE_MAP });
      html = result.value;
      for (const message of result.messages) {
        if (message.type === 'warning' || message.type === 'error') {
          log.debug('mammoth message', { type: message.type, message: message.message });
        }
      }
      const unsupported = result.messages.filter((m) => m.type === 'warning').length;
      if (unsupported > 0) {
        warnings.push(
          `${unsupported} element${unsupported === 1 ? '' : 's'} (images, embedded objects or unmapped styles) had no text content and were skipped.`,
        );
      }
    } catch (error) {
      throw Errors.corruptFile(`mammoth failed to convert docx: ${describeUnknown(error)}`);
    }

    const root = parseHtml(html, { blockTextElements: { script: false, style: false } });
    const collected: Array<Omit<RawBlock, 'pageNumber'>> = [];
    walk(root, collected, warnings);

    const blocks: RawBlock[] = [];
    let runningChars = 0;
    for (const block of collected) {
      const pageNumber = Math.floor(runningChars / CHARS_PER_ESTIMATED_PAGE) + 1;
      blocks.push({ ...block, pageNumber });
      runningChars += block.text.length + 2;
    }

    const text = blocks.map((block) => block.text).join('\n\n');
    if (text.trim().length === 0) throw Errors.emptyDocument();

    const pageCount = Math.max(1, blocks.at(-1)?.pageNumber ?? 1);
    warnings.push(
      'Word documents have no fixed page breaks, so page numbers are estimated from content length.',
    );

    return {
      extractor: this.id,
      pageCount,
      pagesEstimated: true,
      blocks,
      text,
      warnings,
    };
  }
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function walk(node: HtmlNode, out: Array<Omit<RawBlock, 'pageNumber'>>, warnings: string[]): void {
  const element = node as HTMLElement;
  const tag = typeof element.rawTagName === 'string' ? element.rawTagName.toLowerCase() : '';

  if (HEADING_TAGS.has(tag)) {
    push(out, { kind: 'heading', level: Number(tag.slice(1)), text: cleanText(element.text) });
    return;
  }

  switch (tag) {
    case 'p': {
      const text = cleanText(element.text);
      push(out, { kind: looksLikeEquation(text) ? 'equation' : 'paragraph', text });
      return;
    }
    case 'li': {
      push(out, { kind: 'list_item', text: cleanText(element.text) });
      return;
    }
    case 'blockquote': {
      push(out, { kind: 'quote', text: cleanText(element.text) });
      return;
    }
    case 'tr': {
      const cells = element.querySelectorAll('td, th').map((cell) => cleanText(cell.text));
      const text = cells.filter((cell) => cell.length > 0).join(' | ');
      push(out, { kind: 'table_row', text });
      return;
    }
    case 'table': {
      // Recurse so each row becomes its own unit, keeping tabular context readable.
      for (const child of element.childNodes) walk(child, out, warnings);
      return;
    }
    default:
      break;
  }

  if (!element.childNodes || element.childNodes.length === 0) {
    // A bare text node outside any block element still counts as content.
    const text = cleanText(element.text ?? '');
    if (text.length > 0 && tag === '') push(out, { kind: 'paragraph', text });
    return;
  }

  for (const child of element.childNodes) walk(child, out, warnings);
}

function push(out: Array<Omit<RawBlock, 'pageNumber'>>, block: Omit<RawBlock, 'pageNumber'>): void {
  if (block.text.trim().length === 0) return;
  out.push(block);
}

function cleanText(raw: string): string {
  return decodeEntities(raw).replace(/[\u00a0\u200b]/g, ' ').replace(/\s+/g, ' ').trim();
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(value: string): string {
  return value
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (match) => ENTITIES[match] ?? match)
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

const MATH_SYMBOLS = /[=≈≤≥≠±×÷∑∏∫√∞∂∇πθλμσΔ∈∉⊂⊆→←↔]/g;

function looksLikeEquation(text: string): boolean {
  if (text.length === 0 || text.length > 220) return false;
  const symbols = text.match(MATH_SYMBOLS)?.length ?? 0;
  if (symbols === 0) return false;
  const letters = text.replace(/[^A-Za-z]/g, '').length;
  return text.split(/\s+/).length <= 24 && symbols * 6 >= letters;
}