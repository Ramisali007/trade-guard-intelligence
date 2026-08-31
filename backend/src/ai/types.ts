import type { UnitType } from '../config/taxonomy';

/**
 * The provider-agnostic contract for AI analysis.
 *
 * Everything above this file — the orchestrator, the aggregator, the report writer, the API —
 * depends only on `AIAnalysisService`. Nothing outside `src/ai/providers` knows which model
 * is in use, and no provider SDK is imported anywhere else in the codebase. Swapping to a
 * different vendor means adding one file under `providers/` and one line in `index.ts`.
 */

/** One passage handed to the model, with the context needed to judge it. */
export interface ClassificationRequestUnit {
  /** Correlation id. Responses are matched back by this, never by array position. */
  id: string;
  unitType: UnitType;
  pageNumber: number;
  section: string | null;
  text: string;
}

export interface ClassificationRequest {
  documentName: string;
  batchIndex: number;
  /** Section shared by the whole batch, when there is one. */
  section: string | null;
  units: ClassificationRequestUnit[];
}

/** One classified passage as returned by a provider, already coerced into the taxonomy. */
export interface UnitClassification {
  id: string;
  sentiment: string;
  emotion: string;
  contentType: string;
  topic: string;
  /** 0–1. */
  confidence: number;
  keywords: string[];
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ClassificationResponse {
  classifications: UnitClassification[];
  /** Ids the provider failed to return. The caller decides whether to retry or fall back. */
  missingIds: string[];
  /** Values the model returned that were not in the taxonomy and had to be coerced. */
  coercedFields: number;
  usage?: ProviderUsage;
}

export interface SummaryRequest {
  documentName: string;
  pageCount: number;
  unitCount: number;
  /** Distribution counts per dimension, so the model summarises the real numbers. */
  distributions: Record<string, Record<string, number>>;
  /** A representative sample of the document's passages, in reading order. */
  excerpts: Array<{ pageNumber: number; section: string | null; text: string }>;
  topSections: string[];
}

export interface SummaryResponse {
  headline: string;
  narrative: string;
  highlights: string[];
  usage?: ProviderUsage;
}

export interface AIAnalysisService {
  /** Stable identifier reported to the client, e.g. `anthropic`. */
  readonly id: string;
  /** Model identifier reported to the client, e.g. `claude-opus-5`. */
  readonly model: string;
  /** False for the local engine, which produces statistics-derived summaries instead. */
  readonly supportsSummary: boolean;
  /** True when the engine performs no network calls — used to label degraded runs. */
  readonly isLocal: boolean;

  classify(request: ClassificationRequest): Promise<ClassificationResponse>;
  summarize(request: SummaryRequest): Promise<SummaryResponse>;
  extractTradeDoc?(filename: string, text: string): Promise<any>;
}

