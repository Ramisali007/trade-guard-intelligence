/**
 * Client-side mirrors of the backend's API payloads.
 *
 * These are declarations only — they exist so the templates and services are type-checked
 * against the real contract. Anything the backend adds later is simply ignored here; anything
 * it renames breaks the build, which is the point.
 *
 * Two shapes are deliberately open: `distributions` and the classification values themselves.
 * The taxonomy is served as data from `GET /api/taxonomy`, so the client indexes by string
 * rather than by a hard-coded union. A new sentiment value on the backend appears in the UI
 * without a frontend change.
 */

export type DocumentFileType = 'pdf' | 'doc' | 'docx';

export type DocumentStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StageId =
  | 'upload'
  | 'extract'
  | 'structure'
  | 'chunk'
  | 'analyze'
  | 'aggregate'
  | 'report';

export type StageState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface Stage {
  id: StageId;
  label: string;
  state: StageState;
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface Progress {
  stages: Stage[];
  percent: number;
  analyzedUnits: number;
  totalUnits: number;
  completedBatches: number;
  totalBatches: number;
  etaSeconds: number | null;
}

export interface ClassificationResult {
  sentiment: string;
  emotion: string;
  contentType: string;
  topic: string;
  confidence: number;
  keywords: string[];
  source: 'ai' | 'heuristic';
}

export interface AnalyzedUnit {
  id: string;
  pageNumber: number;
  section: string | null;
  sectionLevel: number | null;
  paragraphNumber: number;
  pageParagraphNumber: number;
  unitType: string;
  text: string;
  charCount: number;
  wordCount: number;
  classification: ClassificationResult;
}

export interface PageTimelineEntry {
  pageNumber: number;
  units: number;
  sentiment: Record<string, number>;
  netSentiment: number;
  dominantSentiment: string;
  dominantEmotion: string;
  dominantContentType: string;
}

export interface SectionBreakdownEntry {
  section: string;
  units: number;
  dominantSentiment: string;
  dominantContentType: string;
  netSentiment: number;
}

export interface Statistics {
  totalPages: number;
  totalUnits: number;
  analyzedUnits: number;
  skippedShortUnits: number;
  skippedOverCapUnits: number;
  totalWords: number;
  totalCharacters: number;
  aiClassifiedUnits: number;
  heuristicClassifiedUnits: number;
  averageConfidence: number;
  /** Keyed by dimension id, then by value id. */
  distributions: Record<string, Record<string, number>>;
  unitTypeDistribution: Record<string, number>;
  pageTimeline: PageTimelineEntry[];
  topKeywords: Array<{ term: string; count: number }>;
  sectionBreakdown: SectionBreakdownEntry[];
}

export interface AnalysisSummary {
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
  pagesEstimated: boolean;
  characterCount: number;
  wordCount: number;
  hasDetectedHeadings: boolean;
  extractor: string;
  warnings: string[];
}

export interface DocumentErrorInfo {
  code: string;
  message: string;
  at: string;
}

/** `GET /api/documents/:id` and `GET /api/documents/:id/results`. */
export interface DocumentDetail {
  id: string;
  filename: string;
  fileType: DocumentFileType;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: DocumentStatus;
  progress: Progress;
  extraction: ExtractionInfo | null;
  analysis: Analysis | null;
  error: DocumentErrorInfo | null;
}

/** `GET /api/documents`. */
export interface DocumentSummary {
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

export interface DocumentListResponse {
  items: DocumentSummary[];
  total: number;
  limit: number;
  offset: number;
}

/** `POST /api/documents/upload`. */
export interface UploadResponse {
  id: string;
  filename: string;
  fileType: DocumentFileType;
  fileSize: number;
  uploadedAt: string;
  status: DocumentStatus;
  progress: Progress;
  analysisStarted: boolean;
}

/** `GET /api/documents/:id/status`. */
export interface StatusResponse {
  id: string;
  status: DocumentStatus;
  progress: Progress;
  queuePosition: number | null;
  error: DocumentErrorInfo | null;
  extraction: ExtractionInfo | null;
  finishedAt: string | null;
}

/** `GET /api/documents/:id/units`. */
export interface UnitPage {
  items: AnalyzedUnit[];
  total: number;
  page: number;
  pageSize: number;
  /** Total before filters, so the UI can say "42 of 327". */
  unfilteredTotal: number;
  totalPages: number;
}

export interface UnitQuery {
  page?: number;
  pageSize?: number;
  sentiment?: string[];
  emotion?: string[];
  contentType?: string[];
  topic?: string[];
  unitType?: string[];
  documentPage?: number;
  section?: string;
  search?: string;
  minConfidence?: number;
  source?: 'ai' | 'heuristic';
}

/** `GET /api/taxonomy`. */
export type ValueTone = 'positive' | 'negative' | 'neutral' | 'informational';

export interface TaxonomyValue {
  id: string;
  label: string;
  description: string;
  tone: ValueTone;
}

export interface TaxonomyDimension {
  id: string;
  label: string;
  description: string;
  fallback: string;
  required: boolean;
  values: TaxonomyValue[];
}

export interface Taxonomy {
  dimensions: TaxonomyDimension[];
  unitTypes: Array<{ id: string; label: string }>;
}

/** `GET /api/config` — the limits the client must respect before sending a file. */
export interface ClientConfig {
  upload: {
    maxFileSizeBytes: number;
    maxFileSizeMb: number;
    allowedExtensions: string[];
    retentionMinutes: number;
  };
  processing: {
    unitsPerBatch: number;
    maxUnits: number;
    minUnitChars: number;
    summaryEnabled: boolean;
  };
  results: {
    defaultPageSize: number;
    maxPageSize: number;
  };
  engine: {
    provider: string;
    model: string;
    remote: boolean;
  };
}

/** `GET /api/health`. */
export interface HealthResponse {
  status: string;
  uptimeSeconds: number;
  environment: string;
  storage: { driver: string; requestedDriver: string };
  engine: { provider: string; model: string; remote: boolean; supportsSummary: boolean };
  queue: { active: number; pending: number; concurrency: number };
  timestamp: string;
}

/** The error envelope every failing endpoint returns. Never carries a stack trace. */
export interface ApiErrorBody {
  code: string;
  message: string;
  requestId?: string;
  retryable?: boolean;
  details?: unknown;
}