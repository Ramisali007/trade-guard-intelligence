import type { UnitType } from '../config/taxonomy';

export type DocumentFileType = 'pdf' | 'doc' | 'docx';

export type DocumentStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Pipeline stages, in order. Mirrored 1:1 by the Angular processing screen. */
export const STAGE_IDS = ['upload', 'extract', 'structure', 'chunk', 'analyze', 'aggregate', 'report'] as const;
export type StageId = (typeof STAGE_IDS)[number];
export type StageState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface Stage {
  id: StageId;
  label: string;
  state: StageState;
  /** Short human-readable note, e.g. "48 pages · 327 units". */
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface Progress {
  stages: Stage[];
  /** 0–100, derived from completed stages plus real analysis throughput. Never synthetic. */
  percent: number;
  analyzedUnits: number;
  totalUnits: number;
  completedBatches: number;
  totalBatches: number;
  /** Populated once analysis has enough samples to extrapolate; null before that. */
  etaSeconds: number | null;
}

export interface ClassificationResult {
  sentiment: string;
  emotion: string;
  contentType: string;
  topic: string;
  /** 0–1. Model-reported for AI results, lexicon-derived for heuristic results. */
  confidence: number;
  keywords: string[];
  /** Which engine produced this row — surfaced in the UI and the report, never hidden. */
  source: 'ai' | 'heuristic';
}

/** A structural unit of the document, before classification. */
export interface DocumentUnit {
  id: string;
  pageNumber: number;
  /** Nearest preceding heading; null before the first heading. */
  section: string | null;
  sectionLevel: number | null;
  /** 1-based index across the whole document (analysed units only). */
  paragraphNumber: number;
  /** 1-based index within the page. */
  pageParagraphNumber: number;
  unitType: UnitType;
  text: string;
  charCount: number;
  wordCount: number;
}

export interface AnalyzedUnit extends DocumentUnit {
  classification: ClassificationResult;
}

export interface PageTimelineEntry {
  pageNumber: number;
  units: number;
  sentiment: Record<string, number>;
  /** Mean of (+1 positive, 0 neutral, −1 negative) over the page: −1…+1. */
  netSentiment: number;
  dominantSentiment: string;
  dominantEmotion: string;
  dominantContentType: string;
}

export interface Statistics {
  totalPages: number;
  /** Units the extractor found, including ones below the analysis threshold. */
  totalUnits: number;
  analyzedUnits: number;
  skippedShortUnits: number;
  /** > 0 only when MAX_ANALYSIS_UNITS truncated the document; always reported. */
  skippedOverCapUnits: number;
  totalWords: number;
  totalCharacters: number;
  aiClassifiedUnits: number;
  heuristicClassifiedUnits: number;
  averageConfidence: number;
  distributions: Record<string, Record<string, number>>;
  unitTypeDistribution: Record<string, number>;
  pageTimeline: PageTimelineEntry[];
  topKeywords: Array<{ term: string; count: number }>;
  sectionBreakdown: Array<{
    section: string;
    units: number;
    dominantSentiment: string;
    dominantContentType: string;
    netSentiment: number;
  }>;
}

export interface AnalysisSummary {
  /** Prose overview. AI-written when the summary step is enabled, otherwise derived from statistics. */
  headline: string;
  narrative: string;
  dominantSentiment: string;
  dominantEmotion: string;
  dominantContentType: string;
  dominantTopic: string;
  source: 'ai' | 'derived';
  highlights: string[];
}

export interface AnalysisTiming {
  extractionMs: number;
  segmentationMs: number;
  analysisMs: number;
  aggregationMs: number;
  totalMs: number;
}

export interface AnalysisEngineInfo {
  provider: string;
  model: string;
  batchCount: number;
  aiRequests: number;
  aiRetries: number;
  aiFailures: number;
  degraded: boolean;
  /** Human-readable notes: fallbacks used, caps applied, structure caveats. */
  notes: string[];
}

export interface Analysis {
  summary: AnalysisSummary;
  statistics: Statistics;
  timing: AnalysisTiming;
  engine: AnalysisEngineInfo;
  completedAt: string;
}

export interface ExtractionInfo {
  pageCount: number;
  /** True when page numbers are estimated rather than intrinsic (DOC/DOCX have no fixed pages). */
  pagesEstimated: boolean;
  characterCount: number;
  wordCount: number;
  hasDetectedHeadings: boolean;
  extractor: string;
  warnings: string[];
}

export interface DocumentError {
  code: string;
  /** Safe for display. */
  message: string;
  at: string;
}

export interface DocumentRecord {
  id: string;
  filename: string;
  fileType: DocumentFileType;
  mimeType: string;
  fileSize: number;
  /** Absolute path to the stored upload; cleared once the file is cleaned up. */
  storagePath: string | null;
  uploadedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: DocumentStatus;
  progress: Progress;
  extraction: ExtractionInfo | null;
  analysis: Analysis | null;
  /** Persisted separately from `analysis` because it is the large payload. */
  units: AnalyzedUnit[];
  error: DocumentError | null;
}

/** Trimmed shape for list views — never ships the units array. */
export interface DocumentSummaryView {
  id: string;
  filename: string;
  fileType: DocumentFileType;
  fileSize: number;
  uploadedAt: string;
  finishedAt: string | null;
  status: DocumentStatus;
  percent: number;
  pageCount: number | null;
  analyzedUnits: number | null;
  dominantSentiment: string | null;
  processingMs: number | null;
}

export function stageLabel(id: StageId): string {
  switch (id) {
    case 'upload':
      return 'Document uploaded';
    case 'extract':
      return 'Extracting document text';
    case 'structure':
      return 'Detecting document structure';
    case 'chunk':
      return 'Splitting document into sections';
    case 'analyze':
      return 'AI analysing content';
    case 'aggregate':
      return 'Aggregating classifications';
    case 'report':
      return 'Generating report';
  }
}

export function createInitialProgress(): Progress {
  return {
    stages: STAGE_IDS.map((id) => ({ id, label: stageLabel(id), state: 'pending' as StageState })),
    percent: 0,
    analyzedUnits: 0,
    totalUnits: 0,
    completedBatches: 0,
    totalBatches: 0,
    etaSeconds: null,
  };
}

export function toSummaryView(doc: DocumentRecord): DocumentSummaryView {
  const sentiment = doc.analysis?.summary.dominantSentiment ?? null;
  return {
    id: doc.id,
    filename: doc.filename,
    fileType: doc.fileType,
    fileSize: doc.fileSize,
    uploadedAt: doc.uploadedAt,
    finishedAt: doc.finishedAt,
    status: doc.status,
    percent: doc.progress.percent,
    pageCount: doc.extraction?.pageCount ?? null,
    analyzedUnits: doc.analysis?.statistics.analyzedUnits ?? null,
    dominantSentiment: sentiment,
    processingMs: doc.analysis?.timing.totalMs ?? null,
  };
}

/** The document payload sent to the client: everything except the units array. */
export function toDetailView(doc: DocumentRecord): Omit<DocumentRecord, 'units' | 'storagePath'> {
  const { units: _units, storagePath: _storagePath, ...rest } = doc;
  return rest;
}