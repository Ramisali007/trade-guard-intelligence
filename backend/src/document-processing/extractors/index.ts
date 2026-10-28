import path from 'node:path';
import { Errors } from '../../utils/errors';
import type { DocumentFileType } from '../../models/document.model';
import { PdfExtractor } from './pdf.extractor';
import { DocxExtractor } from './docx.extractor';
import { DocExtractor } from './doc.extractor';
import type { Extractor, ExtractionResult } from './types';
import { DOCX_LIMITS, ZipFormatError, isWordDocument, listZipEntries, zipBombReason } from './zip-guard';
import { config } from '../../config';
import { TimeoutError, withTimeout } from '../../utils/async';

export type { Extractor, ExtractionResult, RawBlock } from './types';
export type { ExtractedImageItem, PageImageExtractionResult } from './pdf-image.extractor';
export { PdfImageExtractor } from './pdf-image.extractor';

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

/**
 * Read a document, within limits. A hostile or merely enormous file must not be able to hold a worker
 * (or the process) hostage, so a DOCX archive is judged before it is unpacked and the whole read has a
 * wall-clock ceiling. Page limits are applied by the PDF extractor itself, which knows the page count.
 */
export async function extractDocument(fileType: DocumentFileType, buffer: Buffer, filename: string): Promise<ExtractionResult> {
  if (fileType === 'docx') {
    let reason: string | null;
    try {
      reason = zipBombReason(listZipEntries(buffer), DOCX_LIMITS);
    } catch (error) {
      if (error instanceof ZipFormatError) throw Errors.corruptFile(error.message);
      throw error;
    }
    if (reason) throw Errors.documentTooComplex(reason);
  }
  try {
    return await withTimeout(getExtractor(fileType).extract(buffer, filename), config.upload.extractionTimeoutMs);
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw Errors.documentTooComplex('reading it took longer than ' + Math.round(config.upload.extractionTimeoutMs / 1000) + ' seconds.');
    }
    throw error;
  }
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
    // A DOCX is a ZIP container; it must really hold the Word document part, not merely mention it.
    try {
      if (isWordDocument(listZipEntries(buffer))) return 'docx';
    } catch (error) {
      if (!(error instanceof ZipFormatError)) throw error;
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

/**
 * A PDF that begins correctly but has no `%%EOF` marker anywhere was cut off (an interrupted download, a stub). It
 * would only fail later, after it had replaced a good version of the same document. Lenient on purpose: trailing
 * bytes after the marker are common, so only a file with no marker at all is refused. Applied at upload, not in
 * `detectFileType`, so a document stored earlier is never made unreadable by this check.
 */
export function assertPdfComplete(buffer: Buffer): void {
  if (!buffer.includes('%%EOF', 0, 'latin1')) {
    throw Errors.corruptFile('PDF has no %%EOF marker: truncated or incomplete');
  }
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