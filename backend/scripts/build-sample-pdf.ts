/**
 * A minimal PDF writer, used only by the smoke test.
 *
 * Generating the fixture is better than committing one: the test then asserts against text whose
 * exact wording it controls, and there is no binary in the repository whose provenance nobody
 * remembers. It emits a genuine PDF — object table, cross-reference table, real byte offsets —
 * so `pdfjs-dist` parses it exactly as it would parse a file from Word.
 *
 * Layout is deliberate. Headings are set larger than body text so the extractor's structure
 * detection has something to find, body lines are set on a 14pt leading and paragraphs are
 * separated by a doubled gap, so the geometric paragraph grouping has an unambiguous signal.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const BODY_SIZE = 11;
const HEADING_SIZE = 17;
const LEADING = 14;
const LINE_CHARS = 88;
// Low enough that the sample passages span several pages, so the page timeline, the per-page
// report sections and the running-header removal all get exercised rather than assumed.
const LINES_PER_PAGE = 9;

interface Line {
  text: string;
  size: number;
  /** Extra leading before this line, used to separate paragraphs. */
  gapBefore: number;
}

const SECTIONS = [
  'Executive Summary',
  'Operational Review',
  'Technical Notes',
  'Customer Feedback',
];

export function buildSamplePdf(passages: string[]): Buffer {
  const pages = layout(passages);
  return assemble(pages);
}

/** Wrap the passages into lines, insert headings, and break into pages. */
function layout(passages: string[]): Line[][] {
  const lines: Line[] = [];
  let sectionIndex = 0;

  passages.forEach((passage, index) => {
    // A heading every second passage gives the document a section structure to recover.
    if (index % 2 === 0 && sectionIndex < SECTIONS.length) {
      lines.push({ text: SECTIONS[sectionIndex] as string, size: HEADING_SIZE, gapBefore: index === 0 ? 0 : 26 });
      sectionIndex += 1;
    }
    wrap(passage, LINE_CHARS).forEach((text, lineIndex) => {
      lines.push({ text, size: BODY_SIZE, gapBefore: lineIndex === 0 ? 12 : 0 });
    });
  });

  const pages: Line[][] = [];
  for (let start = 0; start < lines.length; start += LINES_PER_PAGE) {
    pages.push(lines.slice(start, start + LINES_PER_PAGE));
  }
  return pages.length > 0 ? pages : [[]];
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** One content stream per page: absolute positioning, one `Td` per line. */
function contentStream(lines: Line[]): string {
  const parts: string[] = ['BT'];
  let y = PAGE_HEIGHT - MARGIN;

  for (const line of lines) {
    y -= line.gapBefore + LEADING;
    parts.push(`/F1 ${line.size} Tf`);
    parts.push(`1 0 0 1 ${MARGIN} ${y.toFixed(2)} Tm`);
    parts.push(`(${escapePdfString(line.text)}) Tj`);
  }

  parts.push('ET');
  return parts.join('\n');
}

function escapePdfString(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // The base fonts are single-byte; anything outside Latin-1 would not round-trip.
    .replace(/[^\x20-\x7e]/g, '?');
}

/**
 * Write the file. Objects are emitted in order, their byte offsets recorded as they go, and the
 * cross-reference table built from those offsets — which is what makes the result a valid PDF
 * rather than a plausible-looking one.
 */
function assemble(pages: Line[][]): Buffer {
  const pageCount = pages.length;
  // 1 catalog, 2 page tree, 3 font, then a dict and a stream per page.
  const firstPageObject = 4;
  const objects: string[] = [];

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');

  const kids = pages.map((_page, index) => `${firstPageObject + index * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [ ${kids} ] /Count ${pageCount} >>`);

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  pages.forEach((lines, index) => {
    const contentsObject = firstPageObject + index * 2 + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT} ] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentsObject} 0 R >>`,
    );

    const stream = contentStream(lines);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });

  const chunks: Buffer[] = [];
  let offset = 0;
  const push = (text: string): void => {
    const buffer = Buffer.from(text, 'latin1');
    chunks.push(buffer);
    offset += buffer.length;
  };

  push('%PDF-1.4\n');
  // A binary comment marks the file as non-ASCII for tools that sniff it.
  push('%\xe2\xe3\xcf\xd3\n');

  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(offset);
    push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefOffset = offset;
  const xrefRows = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((value) => `${String(value).padStart(10, '0')} 00000 n `),
  ].join('\n');

  push(`${xrefRows}\n`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
}