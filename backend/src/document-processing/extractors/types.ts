import type { UnitType } from '../../config/taxonomy';
import type { DocumentFileType } from '../../models/document.model';

/**
 * A block is the smallest structural item an extractor can recover from a source format.
 *
 * PDFs have no paragraph markup, so the PDF extractor rebuilds blocks from text geometry.
 * DOCX has real markup, so its blocks map directly onto the document's own elements.
 * Either way the segmenter downstream sees the same shape.
 */
export interface RawBlock {
  pageNumber: number;
  /** Structural role, where the source format makes it recoverable. */
  kind: UnitType;
  /** Heading depth (1 = top level) when `kind === 'heading'`. */
  level?: number;
  text: string;
}

export interface ExtractionResult {
  /** Identifier for the engine that produced this, reported to the user. */
  extractor: string;
  pageCount: number;
  /** True when page numbers are derived from content length rather than real page breaks. */
  pagesEstimated: boolean;
  blocks: RawBlock[];
  /** Plain text reconstruction, used for counts and as the report's source of truth. */
  text: string;
  /** Non-fatal caveats surfaced in the UI (dropped running headers, unsupported elements…). */
  warnings: string[];
}

export interface Extractor {
  readonly id: string;
  readonly fileType: DocumentFileType;
  extract(buffer: Buffer, filename: string): Promise<ExtractionResult>;
}