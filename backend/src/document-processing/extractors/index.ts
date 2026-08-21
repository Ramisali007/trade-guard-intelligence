import path from 'node:path';
import { Errors } from '../../utils/errors';
import type { DocumentFileType } from '../../models/document.model';
import { PdfExtractor } from './pdf.extractor';
import { DocxExtractor } from './docx.extractor';
import { DocExtractor } from './doc.extractor';
import type { Extractor, ExtractionResult } from './types';

export type { Extractor, ExtractionResult, RawBlock } from './types';

/**
 * Extractor registry. Adding a format means implementing `Extractor` and registering it
 * here — nothing else in the pipeline changes.
 */
const REGISTRY: Record<DocumentFileType, Extractor> = {
  pdf: new PdfExtractor(),
  docx: new DocxExtractor(),
  doc: new DocExtractor(),
};

export function getExtractor(fileType: DocumentFileType): Extractor {
  const extractor = REGISTRY[fileType];
  if (!extractor) throw Errors.unsupportedType(`No extractor registered for ${fileType}`);
  return extractor;
}

export function extractDocument(fileType: DocumentFileType, buffer: Buffer, filename: string): Promise<ExtractionResult> {
  return getExtractor(fileType).extract(buffer, filename);
}

/**
 * Decide the real file type from magic bytes first, extension second.
 *
 * The browser-supplied MIME type is advisory only — it is trivially spoofed and is often
 * wrong for Office files. The signature check below is the actual gate.
 */
export function detectFileType(buffer: Buffer, filename: string): DocumentFileType {
  const extension = path.extname(filename).toLowerCase();

  if (hasPdfSignature(buffer)) return 'pdf';

  if (hasZipSignature(buffer)) {
    // A DOCX is a ZIP container; verify it actually holds a WordprocessingML part.
    const head = buffer.subarray(0, Math.min(buffer.length, 8192)).toString('latin1');
    if (head.includes('word/') || head.includes('[Content_Types].xml')) {
      if (extension === '.docx' || head.includes('word/document.xml') || head.includes('word/')) return 'docx';
    }
    throw Errors.unsupportedType(
      `ZIP container without WordprocessingML parts (extension ${extension || 'none'})`,
    );
  }

  if (hasOleSignature(buffer)) return 'doc';

  throw Errors.unsupportedType(
    `Unrecognised file signature (extension ${extension || 'none'}, first bytes ${buffer.subarray(0, 8).toString('hex')})`,
  );
}

function hasPdfSignature(buffer: Buffer): boolean {
  // Some producers emit leading whitespace/BOM before %PDF-.
  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  return head.trimStart().startsWith('%PDF-');
}

function hasZipSignature(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
}

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function hasOleSignature(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(OLE_MAGIC);
}