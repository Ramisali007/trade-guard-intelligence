import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { createRunScopedService, type ResilientAIService } from '../ai';
import type { ClassificationRequestUnit } from '../ai/types';
import { detectFileType, extractDocument } from '../document-processing/extractors';
import { normalizeText } from '../document-processing/text-normalizer';
import { segment } from '../document-processing/segmenter';
import { planChunks, type AnalysisBatch } from '../document-processing/chunker';
import { mapWithConcurrency } from '../utils/async';
import { AppError, Errors, describeUnknown, isAppError } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { countWords } from '../document-processing/text-normalizer';
import {
  type AnalyzedUnit,
  type DocumentRecord,
  type Progress,
  type Stage,
  type StageId,
  type StageState,
} from '../models/document.model';
import { getRepository, type DocumentRepository } from './document.repository';
import { aggregate, deriveSummary, mergeAiSummary, selectExcerpts } from './aggregation.service';
import { generateTextReport } from './report.service';

const log = createLogger('analysis');

/**
 * The orchestrator: it runs one document through the whole pipeline and is the only writer of
 * that document's progress.
 *
 * Progress is measured, not animated. Each stage contributes a fixed share of the total, and
 * the analysis stage — which dominates the wall clock — advances strictly by the number of
 * passages a provider has actually returned. There is no timer anywhere in this file that
 * moves a bar forward on its own; if the model stalls, the percentage stops, which is the
 * honest thing for it to do.
 *
 * Failure is stage-local. An extraction failure ends the run with a specific, user-safe
 * message. A model failure does not end the run at all: the affected batch falls back to the
 * local engine, and the run is marked degraded so the UI and the report can say so.
 */

/** Each stage's share of the total percentage. Analysis dominates because it dominates the clock. */
const STAGE_WEIGHT: Record<StageId, number> = {
  upload: 2,
  extract: 15,
  structure: 6,
  chunk: 2,
  analyze: 65,
  aggregate: 6,
  report: 4,
};

export class AnalysisService {
  constructor(private readonly repository: DocumentRepository = getRepository()) {}

  /**
   * Run the pipeline for one document. Resolves when the document reaches a terminal state;
   * never rejects, because the queue's job is to keep running and the failure is already
   * recorded on the document itself.
   */
  async run(documentId: string): Promise<void> {
    const started = Date.now();
    const ai = createRunScopedService();
    const timing = { extractionMs: 0, segmentationMs: 0, analysisMs: 0, aggregationMs: 0, totalMs: 0 };

    const record = await this.repository.findMeta(documentId);
    if (!record) {
      log.warn('run requested for a document that no longer exists', { documentId });
      return;
    }
    if (record.status === 'completed') return;

    log.info('analysis started', { documentId, filename: record.filename, provider: ai.id, model: ai.model });

    try {
      await this.patch(documentId, (doc) => {
        doc.status = 'processing';
        doc.startedAt = new Date().toISOString();
        doc.error = null;
        setStage(doc.progress, 'upload', 'done', `${formatBytes(doc.fileSize)} received`);
        recomputePercent(doc.progress);
      });

      // ------------------------------------------------------------------ extract
      const buffer = await this.readSource(record);
      const fileType = detectFileType(buffer, record.filename);

      await this.patch(documentId, (doc) => {
        doc.fileType = fileType;
        setStage(doc.progress, 'extract', 'active');
        recomputePercent(doc.progress);
      });

      const extractStart = Date.now();
      const extraction = await extractDocument(fileType, buffer, record.filename);
      timing.extractionMs = Date.now() - extractStart;

      const normalizedText = normalizeText(extraction.text);
      const extractionInfo = {
        pageCount: extraction.pageCount,
        pagesEstimated: extraction.pagesEstimated,
        characterCount: normalizedText.length,
        wordCount: countWords(normalizedText),
        hasDetectedHeadings: extraction.blocks.some((block) => block.kind === 'heading'),
        extractor: extraction.extractor,
        warnings: [...extraction.warnings],
      };

      await this.patch(documentId, (doc) => {
        doc.extraction = extractionInfo;
        setStage(
          doc.progress,
          'extract',
          'done',
          `${extraction.pageCount} ${extraction.pagesEstimated ? 'estimated pages' : 'pages'} · ${extractionInfo.wordCount.toLocaleString('en-US')} words`,
        );
        setStage(doc.progress, 'structure', 'active');
        recomputePercent(doc.progress);
      });

      // ------------------------------------------------------------------ structure
      const segmentStart = Date.now();
      const segmentation = segment(extraction.blocks);
      timing.segmentationMs = Date.now() - segmentStart;

      if (segmentation.units.length === 0) throw Errors.emptyDocument();

      await this.patch(documentId, (doc) => {
        if (doc.extraction) doc.extraction.warnings.push(...segmentation.warnings);
        setStage(
          doc.progress,
          'structure',
          'done',
          `${segmentation.units.length.toLocaleString('en-US')} units · ${segmentation.sections.length} sections`,
        );
        setStage(doc.progress, 'chunk', 'active');
        doc.progress.totalUnits = segmentation.units.length;
        recomputePercent(doc.progress);
      });

      // ------------------------------------------------------------------ chunk
      const plan = planChunks(segmentation.units);

      await this.patch(documentId, (doc) => {
        setStage(
          doc.progress,
          'chunk',
          'done',
          plan.batches.length > 0
            ? `${plan.batches.length} batch${plan.batches.length === 1 ? '' : 'es'} · ${plan.aiUnitCount.toLocaleString('en-US')} units for the model`
            : 'no batches required',
        );
        setStage(doc.progress, 'analyze', 'active');
        doc.progress.totalBatches = plan.batches.length;
        recomputePercent(doc.progress);
      });

      // ------------------------------------------------------------------ analyze
      const analysisStart = Date.now();
      const classified = new Map<string, AnalyzedUnit['classification']>();

      // Short units are never worth a model request: a heading or a table label costs as much to
      // send as a paragraph and tells the model far less. They are classified locally and counted
      // immediately, so the progress figure reflects genuinely finished work from the first update.
      if (plan.localUnits.length > 0) {
        for (const row of ai.classifyLocal(plan.localUnits.map(toRequestUnit))) {
          classified.set(row.id, { ...row, source: 'heuristic' });
        }
        await this.patch(documentId, (doc) => {
          doc.progress.analyzedUnits = classified.size;
          recomputePercent(doc.progress);
        });
      }

      let completedBatches = 0;
      await mapWithConcurrency(plan.batches, config.processing.concurrency, async (batch) => {
        const result = await ai.classifyBatch(toClassificationRequest(record.filename, batch));
        const fallback = new Set(result.fallbackIds);

        for (const row of result.classifications) {
          classified.set(row.id, { ...row, source: fallback.has(row.id) ? 'heuristic' : 'ai' });
        }

        completedBatches += 1;
        const analyzed = classified.size;
        const elapsed = Date.now() - analysisStart;

        await this.patch(documentId, (doc) => {
          doc.progress.analyzedUnits = analyzed;
          doc.progress.completedBatches = completedBatches;
          doc.progress.etaSeconds = estimateEta(elapsed, completedBatches, plan.batches.length);
          setStage(
            doc.progress,
            'analyze',
            'active',
            `${analyzed.toLocaleString('en-US')} / ${segmentation.units.length.toLocaleString('en-US')} passages`,
          );
          recomputePercent(doc.progress);
        });
      });
      timing.analysisMs = Date.now() - analysisStart;

      // Every unit is guaranteed a classification: the resilient wrapper falls back rather than
      // returning nothing. This last check is a safety net, not an expected path.
      const units: AnalyzedUnit[] = segmentation.units.map((unit) => ({
        ...unit,
        classification:
          classified.get(unit.id) ??
          { sentiment: 'neutral', emotion: 'neutral', contentType: 'other', topic: 'other', confidence: 0.3, keywords: [], source: 'heuristic' as const },
      }));

      await this.patch(documentId, (doc) => {
        doc.progress.analyzedUnits = units.length;
        doc.progress.etaSeconds = null;
        setStage(doc.progress, 'analyze', 'done', `${units.length.toLocaleString('en-US')} passages classified`);
        setStage(doc.progress, 'aggregate', 'active');
        recomputePercent(doc.progress);
      });

      // ------------------------------------------------------------------ aggregate
      const aggregateStart = Date.now();
      const statistics = aggregate({
        units,
        pageCount: extraction.pageCount,
        totalUnits: segmentation.totalUnits,
        shortUnits: segmentation.shortUnits,
        skippedOverCapUnits: segmentation.skippedOverCapUnits,
        totalWords: segmentation.units.reduce((sum, unit) => sum + unit.wordCount, 0),
        totalCharacters: segmentation.units.reduce((sum, unit) => sum + unit.charCount, 0),
      });

      let summary = deriveSummary(statistics, record.filename, extraction.pagesEstimated);
      if (config.processing.enableSummary && ai.supportsSummary) {
        const written = await ai.summarize({
          documentName: record.filename,
          pageCount: extraction.pageCount,
          unitCount: units.length,
          distributions: statistics.distributions,
          excerpts: selectExcerpts(units),
          topSections: statistics.sectionBreakdown.slice(0, 8).map((entry) => entry.section),
        });
        summary = mergeAiSummary(summary, written);
      }
      timing.aggregationMs = Date.now() - aggregateStart;

      await this.repository.saveUnits(documentId, units);

      const degraded = ai.stats.failures > 0 || ai.stats.omitted > 0;
      const notes = buildEngineNotes(ai, statistics.heuristicClassifiedUnits, statistics.aiClassifiedUnits);

      await this.patch(documentId, (doc) => {
        setStage(doc.progress, 'aggregate', 'done', `${statistics.pageTimeline.length} pages summarised`);
        setStage(doc.progress, 'report', 'active');
        recomputePercent(doc.progress);
        doc.analysis = {
          summary,
          statistics,
          timing: { ...timing, totalMs: Date.now() - started },
          engine: {
            provider: ai.id,
            model: ai.model,
            batchCount: plan.batches.length,
            aiRequests: ai.stats.requests,
            aiRetries: ai.stats.retries,
            aiFailures: ai.stats.failures,
            degraded,
            notes,
          },
          completedAt: new Date().toISOString(),
        };
      });

      // ------------------------------------------------------------------ report
      const full = await this.repository.findFull(documentId);
      if (!full || !full.analysis) throw Errors.processingFailed('Analysis vanished before the report stage');
      const report = generateTextReport(full);
      await this.writeReport(documentId, report);

      await this.patch(documentId, (doc) => {
        const totalMs = Date.now() - started;
        if (doc.analysis) doc.analysis.timing.totalMs = totalMs;
        setStage(doc.progress, 'report', 'done', `${formatBytes(Buffer.byteLength(report, 'utf8'))} text report`);
        doc.progress.percent = 100;
        doc.progress.etaSeconds = 0;
        doc.status = 'completed';
        doc.finishedAt = new Date().toISOString();
      });

      log.info('analysis completed', {
        documentId,
        units: units.length,
        batches: plan.batches.length,
        aiRequests: ai.stats.requests,
        degraded,
        ms: Date.now() - started,
      });
    } catch (error) {
      await this.fail(documentId, error);
    }
  }

  private async readSource(record: DocumentRecord): Promise<Buffer> {
    if (!record.storagePath) {
      throw Errors.notFound('uploaded file');
    }
    try {
      return await fs.readFile(record.storagePath);
    } catch (error) {
      throw Errors.processingFailed(`Could not read the stored upload: ${describeUnknown(error)}`);
    }
  }

  private async writeReport(documentId: string, report: string): Promise<void> {
    try {
      await fs.mkdir(config.upload.dataDir, { recursive: true });
      await fs.writeFile(path.join(config.upload.dataDir, `${documentId}.report.txt`), report, 'utf8');
    } catch (error) {
      // The endpoint regenerates from stored analysis when the cache is missing.
      log.warn('could not cache the report file', { documentId, error: describeUnknown(error) });
    }
  }

  private async patch(documentId: string, mutate: (doc: DocumentRecord) => void): Promise<void> {
    await this.repository.update(documentId, mutate);
  }

  /** Record a terminal failure with a message written for the user; log the real cause. */
  private async fail(documentId: string, error: unknown): Promise<void> {
    const appError: AppError = isAppError(error) ? error : Errors.processingFailed(describeUnknown(error));

    log.error('analysis failed', {
      documentId,
      code: appError.code,
      internal: appError.internal ?? describeUnknown(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    await this.repository.update(documentId, (doc) => {
      doc.status = 'failed';
      doc.finishedAt = new Date().toISOString();
      doc.error = { code: appError.code, message: appError.message, at: new Date().toISOString() };
      for (const stage of doc.progress.stages) {
        if (stage.state === 'active') {
          stage.state = 'failed';
          stage.finishedAt = new Date().toISOString();
        } else if (stage.state === 'pending') {
          stage.state = 'skipped';
        }
      }
    });
  }
}

function toRequestUnit(unit: { id: string; unitType: AnalyzedUnit['unitType']; pageNumber: number; section: string | null; text: string }): ClassificationRequestUnit {
  return {
    id: unit.id,
    unitType: unit.unitType,
    pageNumber: unit.pageNumber,
    section: unit.section,
    text: unit.text,
  };
}

function toClassificationRequest(documentName: string, batch: AnalysisBatch) {
  return {
    documentName,
    batchIndex: batch.index,
    section: batch.section,
    units: batch.units.map(toRequestUnit),
  };
}

function buildEngineNotes(ai: ResilientAIService, heuristicUnits: number, aiUnits: number): string[] {
  const notes: string[] = [];

  if (ai.isLocal) {
    notes.push(
      'No AI provider is configured, so every passage was classified by the built-in local engine. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY) to use a language model.',
    );
  } else if (heuristicUnits > 0 && aiUnits > 0) {
    notes.push(
      `${heuristicUnits.toLocaleString('en-US')} of ${(heuristicUnits + aiUnits).toLocaleString('en-US')} passages were classified locally rather than by the model.`,
    );
  }
  if (ai.stats.retries > 0) notes.push(`${ai.stats.retries} AI request${ai.stats.retries === 1 ? '' : 's'} had to be retried.`);
  if (ai.stats.coercedFields > 0) {
    notes.push(`${ai.stats.coercedFields} model-returned values fell outside the configured taxonomy and were mapped to their fallback category.`);
  }
  notes.push(...ai.stats.failureReasons);
  return notes;
}

// ---------------------------------------------------------------------------------------------
// Progress accounting
// ---------------------------------------------------------------------------------------------

function setStage(progress: Progress, id: StageId, state: StageState, detail?: string): void {
  const stage: Stage | undefined = progress.stages.find((entry) => entry.id === id);
  if (!stage) return;

  const now = new Date().toISOString();
  if (state === 'active' && stage.state === 'pending') stage.startedAt = now;
  if ((state === 'done' || state === 'failed') && !stage.finishedAt) stage.finishedAt = now;
  if (state === 'active' && stage.startedAt === undefined) stage.startedAt = now;

  stage.state = state;
  if (detail !== undefined) stage.detail = detail;
}

/**
 * Percentage from completed stage weights plus, for the active stage, its real fractional
 * progress. Only the analysis stage has a meaningful fraction — the number of passages a
 * provider has actually returned — so every other active stage contributes nothing until it
 * finishes. Nothing here advances with time.
 */
function recomputePercent(progress: Progress): void {
  let earned = 0;

  for (const stage of progress.stages) {
    const weight = STAGE_WEIGHT[stage.id];
    if (stage.state === 'done' || stage.state === 'skipped') {
      earned += weight;
    } else if (stage.state === 'active' && stage.id === 'analyze' && progress.totalUnits > 0) {
      earned += weight * Math.min(1, progress.analyzedUnits / progress.totalUnits);
    }
  }

  const total = Object.values(STAGE_WEIGHT).reduce((sum, weight) => sum + weight, 0);
  // Capped below 100 until the run is actually finished, so 100% always means done.
  progress.percent = Math.min(99, Math.round((earned / total) * 100));
}

/** Linear extrapolation from observed batch throughput. Null until there is something to observe. */
function estimateEta(elapsedMs: number, completedBatches: number, totalBatches: number): number | null {
  if (completedBatches < 1 || completedBatches >= totalBatches) return null;
  const perBatch = elapsedMs / completedBatches;
  return Math.max(1, Math.round((perBatch * (totalBatches - completedBatches)) / 1000));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}