import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { KeyedMutex } from '../utils/async';
import { config } from '../config';
import { assertPdfComplete, detectFileType } from '../document-processing/extractors';
import { AppError, Errors, describeUnknown, errorFields } from '../utils/errors';
import { createLogger } from '../utils/logger';
import {
  createInitialProgress,
  toDetailView,
  type DocumentFileType,
  type DocumentRecord,
  type DocumentSummaryView,
  type AnalysisEvent,
  type ImportEvent,
} from '../models/document.model';
import { getRepository, normalizeUnitQuery, type DocumentRepository, type UnitPage, type UnitQuery } from './document.repository';
import { AnalysisService } from './analysis.service';
import { getQueue } from './queue.service';
import { CleanupService } from './cleanup.service';
import { generateTextReport, reportFilename } from './report.service';
import { generatePdfReport } from './pdf-report.service';
import { getImageStorageService } from './image-storage.service';
import type { ComplianceDecision, HumanOverrideRecord } from '../compliance/types';

const log = createLogger('documents');

/**
 * The document lifecycle: validate, store, queue, report, delete.
 *
 * Validation happens in a deliberate order, cheapest and most trustworthy last. The extension
 * and the browser-supplied MIME type are checked because they filter out obvious mistakes for
 * free, but neither is trusted: both are client-controlled. The decision is made by
 * `detectFileType`, which reads the file's magic bytes. A `.pdf` that is really something else
 * is caught there, before any parser opens it.
 *
 * The upload is buffered in memory and only written to disk after it has been identified, so a
 * rejected file never touches the filesystem at all.
 */

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface DocumentStatusView {
  id: string;
  status: DocumentRecord['status'];
  progress: DocumentRecord['progress'];
  queuePosition: number | null;
  error: DocumentRecord['error'];
  extraction: DocumentRecord['extraction'];
  finishedAt: string | null;
}

import { computeContentHash } from '../utils/fingerprint';

export interface UploadOptions {
  autoStart: boolean;
  /** See DocumentRecord.analysisProfile. */
  profile?: 'PRESHIPMENT';
  customerId?: string;
  source?: 'manual_upload' | 'batch_upload';
}

export interface UploadResult extends DocumentRecord {
  duplicate?: boolean;
  isDuplicate?: boolean;
  hasBeenAnalyzed?: boolean;
  originalFilename?: string;
  currentUploadedFilename?: string;
  firstImportedAt?: string;
  lastImportedAt?: string;
  firstAnalyzedAt?: string | null;
  lastAnalyzedAt?: string | null;
  analysisCount?: number;
  importCount?: number;
}

export interface BatchItemResult {
  id: string;
  documentId: string;
  filename: string;
  originalFilename?: string;
  status: 'NEW' | 'DUPLICATE' | 'FAILED';
  isDuplicate: boolean;
  duplicate: boolean;
  duplicateOf: string | null;
  contentHash: string;
  fileSize: number;
  fileType: DocumentFileType;
  uploadedAt: string;
  firstImportedAt?: string;
  lastImportedAt?: string;
  firstAnalyzedAt?: string | null;
  lastAnalyzedAt?: string | null;
  analysisCount?: number;
  importCount?: number;
  hasBeenAnalyzed: boolean;
  analysisStarted: boolean;
  errorMessage?: string;
}

export interface BatchUploadResult {
  count: number;
  summary: {
    total: number;
    new: number;
    duplicates: number;
    failed: number;
  };
  documents: BatchItemResult[];
}

export class DocumentService {
  private readonly repository: DocumentRepository;
  private readonly analysis: AnalysisService;
  private readonly queue = getQueue();
  /** Serializes start/restart per document so two requests cannot both pass the status check and queue it twice. */
  private readonly startLock = new KeyedMutex();

  constructor(repository?: DocumentRepository) {
    this.repository = repository ?? getRepository();
    this.analysis = new AnalysisService(this.repository);
  }

  async createFromUpload(file: UploadedFile | undefined, options: UploadOptions): Promise<UploadResult> {
    if (!file) throw Errors.noFile();

    const filename = sanitizeFilename(file.originalname);
    const extension = path.extname(filename).toLowerCase();

    if (!(config.upload.allowedExtensions as readonly string[]).includes(extension)) {
      throw Errors.unsupportedType(`Extension "${extension || '(none)'}" is not in the allow-list`);
    }
    if (!(config.upload.allowedMimeTypes as readonly string[]).includes(file.mimetype)) {
      throw Errors.unsupportedType(`Client-reported MIME type "${file.mimetype}" is not in the allow-list`);
    }
    if (file.size <= 0 || file.buffer.length === 0) {
      throw Errors.emptyDocument();
    }
    if (file.size > config.upload.maxFileSizeBytes) {
      throw Errors.fileTooLarge(config.upload.maxFileSizeBytes);
    }

    // The real gate: the file's own bytes decide what it is.
    const fileType: DocumentFileType = detectFileType(file.buffer, filename);
    if (fileType === 'pdf') assertPdfComplete(file.buffer);
    if (!extensionMatchesType(extension, fileType)) {
      log.warn('extension disagrees with the file signature', { filename, extension, fileType });
    }

    // 1. Content Fingerprint: Compute SHA-256 of raw file bytes BEFORE any parsing/OCR/LLM step
    const contentHash = computeContentHash(file.buffer);
    const customerId = (options.customerId || 'default_customer').trim();

    // 2. Dedup-First Check: Look for existing document under same tenant/customer with identical contentHash
    let existing = await this.repository.findByContentHash(customerId, contentHash);
    if (!existing) {
      // If it exists in archived/soft-deleted state, restore it
      const archived = await this.repository.findByContentHash(customerId, contentHash, { includeArchived: true });
      if (archived) {
        await this.repository.update(archived.id, (doc: DocumentRecord) => {
          doc.isArchived = false;
          doc.archivedAt = null;
        });
        existing = await this.repository.findMeta(archived.id);
      }
    }

    if (existing) {
      const now = new Date().toISOString();
      const updatedImportCount = (existing.importCount || 1) + 1;

      // The same bytes are already known; make sure the stored original and the working copy exist.
      const targetStoragePath = existing.storagePath || path.join(config.upload.uploadDir, `${existing.id}${extension}`);
      if (!existing.storagePath || !fsSync.existsSync(targetStoragePath)) {
        await fs.mkdir(path.dirname(targetStoragePath), { recursive: true });
        await fs.writeFile(targetStoragePath, file.buffer, { mode: 0o600 });
      }
      if (!(await this.repository.hasSourceFile(existing.id))) await this.repository.saveSourceFile(existing.id, file.buffer);

      await this.repository.update(existing.id, (doc: DocumentRecord) => {
        doc.lastImportedAt = now;
        doc.importCount = updatedImportCount;
        doc.updatedAt = now;
        doc.storagePath = targetStoragePath;
      });
      existing.storagePath = targetStoragePath;

      const importEvent: ImportEvent = {
        importEventId: `imp-${randomUUID()}`,
        documentId: existing.id,
        filename,
        fileSize: file.size,
        mimeType: file.mimetype,
        contentHash,
        customerId,
        uploadedAt: now,
        isDuplicate: true,
        status: 'DUPLICATE_DETECTED',
        source: options.source || 'manual_upload',
      };
      await this.repository.saveImportEvent(importEvent);

      log.info('[AUDIT_LOG] duplicate_upload_detected', {
        action: 'duplicate_upload_detected',
        customerId,
        documentId: existing.id,
        contentHash,
        originalFilename: existing.originalFilename || existing.filename,
        currentUploadedFilename: filename,
        lastAnalyzedAt: existing.lastAnalyzedAt || (existing.analysis ? existing.finishedAt : null),
        analysisCount: existing.analysisCount || (existing.analysis ? 1 : 0),
        status: existing.status,
        timestamp: now,
      });

      // DO NOT increment customer lifetimeVolume
      // DO NOT run OCR/parsing/LLM pipeline
      // DO NOT insert into document_units
      return {
        ...existing,
        isDuplicate: true,
        duplicateOf: existing.id,
        duplicate: true,
        originalFilename: existing.originalFilename || existing.filename,
        currentUploadedFilename: filename,
        firstImportedAt: existing.firstImportedAt || existing.uploadedAt,
        lastImportedAt: now,
        firstAnalyzedAt: existing.firstAnalyzedAt || (existing.analysis ? existing.finishedAt : null),
        lastAnalyzedAt: existing.lastAnalyzedAt || (existing.analysis ? existing.finishedAt : null),
        analysisCount: existing.analysisCount || (existing.analysis ? 1 : 0),
        importCount: updatedImportCount,
        hasBeenAnalyzed: Boolean(existing.analysis || existing.status === 'completed'),
        analysisStatus: existing.status === 'completed' ? 'completed' : (existing.status === 'failed' ? 'failed' : (existing.analysisStatus || 'never_analyzed')),
      };
    }

    // 3. Persist new upload with unique index concurrency protection
    const id = randomUUID();
    const now = new Date().toISOString();
    const normalizedFilename = filename.toLowerCase().trim();
    const storagePath = path.join(config.upload.uploadDir, `${id}${extension}`);

    await fs.mkdir(config.upload.uploadDir, { recursive: true });
    try {
      await fs.writeFile(storagePath, file.buffer, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      throw Errors.storage(`Could not write the upload to ${storagePath}: ${describeUnknown(error)}`);
    }

    const record: DocumentRecord = {
      id,
      customerId,
      contentHash,
      normalizedTextHash: null,
      isDuplicate: false,
      duplicateOf: null,
      originalFilename: filename,
      normalizedFilename,
      filename,
      fileType,
      mimeType: file.mimetype,
      fileSize: file.size,
      storagePath,
      ...(options.profile ? { analysisProfile: options.profile } : {}),
      uploadedAt: now,
      firstImportedAt: now,
      lastImportedAt: now,
      importCount: 1,
      firstAnalyzedAt: null,
      lastAnalyzedAt: null,
      analysisCount: 0,
      analysisStatus: 'never_analyzed',
      documentStatus: 'active',
      startedAt: null,
      finishedAt: null,
      status: 'uploaded',
      progress: createInitialProgress(),
      extraction: null,
      analysis: null,
      units: [],
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.repository.create(record);
      // The canonical copy of the original. The working file on disk is deleted after the retention window.
      await this.repository.saveSourceFile(id, file.buffer);
      log.info('[AUDIT_LOG] document_created', { id, customerId, contentHash, filename, size: file.size, timestamp: now });

      const importEvent: ImportEvent = {
        importEventId: `imp-${randomUUID()}`,
        documentId: id,
        filename,
        fileSize: file.size,
        mimeType: file.mimetype,
        contentHash,
        customerId,
        uploadedAt: now,
        isDuplicate: false,
        status: 'NEW_DOCUMENT',
        source: options.source || 'manual_upload',
      };
      await this.repository.saveImportEvent(importEvent);
    } catch (err) {
      // Concurrency protection: If two simultaneous uploads occur milliseconds apart,
      // the unique compound index { customerId: 1, contentHash: 1 } throws a duplicate-key error (code 11000).
      const { code: errCode, message: errMessage } = errorFields(err);
      if (errCode === 11000 || errMessage.includes('duplicate key') || errMessage.includes('E11000')) {
        // Clean up redundant local file
        await fs.unlink(storagePath).catch(() => undefined);

        let winner = await this.repository.findByContentHash(customerId, contentHash, { includeArchived: true });
        if (winner) {
          if (winner.isArchived) {
            await this.repository.update(winner.id, (doc: DocumentRecord) => {
              doc.isArchived = false;
              doc.archivedAt = null;
            });
            winner = await this.repository.findMeta(winner.id);
          }
          const winnerImportCount = (winner!.importCount || 1) + 1;
          await this.repository.update(winner!.id, (doc: DocumentRecord) => {
            doc.lastImportedAt = now;
            doc.importCount = winnerImportCount;
            doc.updatedAt = now;
          });

          const importEvent: ImportEvent = {
            importEventId: `imp-${randomUUID()}`,
            documentId: winner!.id,
            filename,
            fileSize: file.size,
            mimeType: file.mimetype,
            contentHash,
            customerId,
            uploadedAt: now,
            isDuplicate: true,
            status: 'DUPLICATE_DETECTED',
            source: options.source || 'manual_upload',
          };
          await this.repository.saveImportEvent(importEvent);

          log.info('[AUDIT_LOG] concurrent_duplicate_upload_prevented', {
            action: 'concurrent_duplicate_upload_prevented',
            customerId,
            winningDocumentId: winner?.id,
            contentHash,
            timestamp: now,
          });
          return {
            ...winner!,
            isDuplicate: true,
            duplicateOf: winner!.id,
            duplicate: true,
            originalFilename: winner!.originalFilename || winner!.filename,
            currentUploadedFilename: filename,
            firstImportedAt: winner!.firstImportedAt || winner!.uploadedAt,
            lastImportedAt: now,
            firstAnalyzedAt: winner!.firstAnalyzedAt || (winner!.analysis ? winner!.finishedAt : null),
            lastAnalyzedAt: winner!.lastAnalyzedAt || (winner!.analysis ? winner!.finishedAt : null),
            analysisCount: winner!.analysisCount || (winner!.analysis ? 1 : 0),
            importCount: winnerImportCount,
            hasBeenAnalyzed: Boolean(winner!.analysis || winner!.status === 'completed'),
            analysisStatus: winner!.status === 'completed' ? 'completed' : (winner!.status === 'failed' ? 'failed' : (winner!.analysisStatus || 'never_analyzed')),
          };
        }
      }
      throw err;
    }

    if (options.autoStart) await this.startAnalysis(id);
    const created = (await this.repository.findMeta(id)) ?? record;
    return {
      ...created,
      duplicate: false,
      isDuplicate: false,
      originalFilename: filename,
      currentUploadedFilename: filename,
      firstImportedAt: now,
      lastImportedAt: now,
      importCount: 1,
      analysisCount: 0,
      hasBeenAnalyzed: false,
      analysisStatus: 'never_analyzed',
    };
  }

  /** Batch upload supporting multi-file imports with intra-batch duplicate detection. */
  async createFromBatch(files: UploadedFile[], options: UploadOptions): Promise<BatchUploadResult> {
    if (!files || files.length === 0) {
      throw Errors.noFile();
    }

    const customerId = (options.customerId || 'default_customer').trim();
    const results: BatchItemResult[] = [];
    const seenInBatch = new Map<string, BatchItemResult>();

    let newCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;

    for (const file of files) {
      try {
        const filename = sanitizeFilename(file.originalname);
        const contentHash = computeContentHash(file.buffer);

        // 1. Intra-batch duplicate check: Did an earlier file in THIS SAME upload request have identical bytes?
        if (seenInBatch.has(contentHash)) {
          const primaryInBatch = seenInBatch.get(contentHash)!;
          duplicateCount++;

          const now = new Date().toISOString();
          const importEvent: ImportEvent = {
            importEventId: `imp-${randomUUID()}`,
            documentId: primaryInBatch.documentId,
            filename,
            fileSize: file.size,
            mimeType: file.mimetype,
            contentHash,
            customerId,
            uploadedAt: now,
            isDuplicate: true,
            status: 'DUPLICATE_DETECTED',
            source: 'batch_upload',
          };
          await this.repository.saveImportEvent(importEvent);

          results.push({
            id: primaryInBatch.id,
            documentId: primaryInBatch.documentId,
            filename,
            originalFilename: primaryInBatch.originalFilename || primaryInBatch.filename,
            status: 'DUPLICATE',
            isDuplicate: true,
            duplicate: true,
            duplicateOf: primaryInBatch.documentId,
            contentHash,
            fileSize: file.size,
            fileType: primaryInBatch.fileType,
            uploadedAt: primaryInBatch.uploadedAt,
            firstImportedAt: primaryInBatch.firstImportedAt,
            lastImportedAt: now,
            firstAnalyzedAt: primaryInBatch.firstAnalyzedAt,
            lastAnalyzedAt: primaryInBatch.lastAnalyzedAt,
            analysisCount: primaryInBatch.analysisCount || 0,
            importCount: (primaryInBatch.importCount || 1) + 1,
            hasBeenAnalyzed: primaryInBatch.hasBeenAnalyzed,
            analysisStarted: false,
          });
          continue;
        }

        // 2. Process against database
        const res = await this.createFromUpload(file, { ...options, source: 'batch_upload' });
        const isDup = Boolean(res.isDuplicate || res.duplicate);
        if (isDup) {
          duplicateCount++;
        } else {
          newCount++;
        }

        const docEntry: BatchItemResult = {
          id: res.id,
          documentId: res.id,
          filename: res.filename,
          originalFilename: res.originalFilename || res.filename,
          status: isDup ? 'DUPLICATE' : 'NEW',
          isDuplicate: isDup,
          duplicate: isDup,
          duplicateOf: res.duplicateOf || null,
          contentHash: res.contentHash,
          fileSize: res.fileSize,
          fileType: res.fileType,
          uploadedAt: res.uploadedAt,
          firstImportedAt: res.firstImportedAt || res.uploadedAt,
          lastImportedAt: res.lastImportedAt || res.uploadedAt,
          firstAnalyzedAt: res.firstAnalyzedAt || null,
          lastAnalyzedAt: res.lastAnalyzedAt || null,
          analysisCount: res.analysisCount || 0,
          importCount: res.importCount || 1,
          hasBeenAnalyzed: Boolean(res.hasBeenAnalyzed || res.analysis || res.status === 'completed'),
          analysisStarted: !isDup && options.autoStart,
        };

        seenInBatch.set(contentHash, docEntry);
        results.push(docEntry);
      } catch (err) {
        failedCount++;
        log.error('Failed to process file in batch', { filename: file.originalname, error: describeUnknown(err) });
        results.push({
          id: 'failed',
          documentId: 'failed',
          filename: file.originalname,
          status: 'FAILED',
          isDuplicate: false,
          duplicate: false,
          duplicateOf: null,
          contentHash: '',
          fileSize: file.size,
          fileType: 'pdf',
          uploadedAt: new Date().toISOString(),
          hasBeenAnalyzed: false,
          analysisStarted: false,
          errorMessage: describeUnknown(err),
        });
      }
    }

    return {
      count: results.length,
      summary: {
        total: files.length,
        new: newCount,
        duplicates: duplicateCount,
        failed: failedCount,
      },
      documents: results,
    };
  }

  /** Queue a document for analysis. A document already running or queued is left as it is. */
  startAnalysis(id: string): Promise<DocumentRecord> {
    return this.startLock.run(id, () => this.startAnalysisLocked(id));
  }

  private async startAnalysisLocked(id: string): Promise<DocumentRecord> {
    const record = await this.repository.findMeta(id);
    if (!record) throw Errors.notFound();

    if (record.status === 'processing' || record.status === 'queued') return record;
    if (record.status === 'completed') {
      throw Errors.conflict('This document has already been analyzed. Its results are ready to view.');
    }

    await this.restoreWorkingCopy(record);

    const version = (record.analysisCount || 0) + 1;
    const now = new Date().toISOString();
    const analysisId = `analysis-${randomUUID()}`;

    const analysisEvent: AnalysisEvent = {
      analysisId,
      documentId: id,
      analysisVersion: version,
      startedAt: now,
      completedAt: null,
      status: 'processing',
      engine: {
        provider: config.ai.provider,
        model: 'default',
        notes: ['Initial compliance analysis run'],
      },
      summary: null,
      statistics: null,
      tradeCompliance: null,
      errorMessage: null,
      createdAt: now,
    };
    await this.repository.saveAnalysisEvent(analysisEvent);

    const updated = await this.repository.update(id, (doc: DocumentRecord) => {
      doc.status = 'queued';
      doc.analysisStatus = 'queued';
      doc.analysisCount = version;
      doc.error = null;
      doc.progress = createInitialProgress();
      doc.updatedAt = now;
    });

    this.queue.enqueue(id, () => this.analysis.run(id, analysisId));
    log.info('document queued for analysis', { id, analysisId, version, ...this.queue.stats() });
    return updated ?? record;
  }

  /** Explicit re-analysis: creates a new AnalysisEvent without duplicating document entity. */
  reanalyzeDocument(id: string): Promise<DocumentRecord> {
    return this.startLock.run(id, () => this.reanalyzeLocked(id));
  }

  private async reanalyzeLocked(id: string): Promise<DocumentRecord> {
    const record = await this.repository.findMeta(id);
    if (!record) throw Errors.notFound();

    if (record.status === 'processing' || record.status === 'queued') return record;

    await this.restoreWorkingCopy(record);

    const nextVersion = (record.analysisCount || (record.analysis ? 1 : 0)) + 1;
    const now = new Date().toISOString();
    const analysisId = `analysis-${randomUUID()}`;

    const analysisEvent: AnalysisEvent = {
      analysisId,
      documentId: id,
      analysisVersion: nextVersion,
      startedAt: now,
      completedAt: null,
      status: 'processing',
      engine: {
        provider: config.ai.provider,
        model: 'default',
        notes: ['Manual re-analysis triggered by user'],
      },
      summary: null,
      statistics: null,
      tradeCompliance: null,
      errorMessage: null,
      createdAt: now,
    };
    await this.repository.saveAnalysisEvent(analysisEvent);

    const updated = await this.repository.update(id, (doc: DocumentRecord) => {
      doc.status = 'queued';
      doc.analysisStatus = 'queued';
      doc.analysisCount = nextVersion;
      doc.error = null;
      doc.progress = createInitialProgress();
      doc.updatedAt = now;
    });

    log.info('[AUDIT_LOG] reanalysis_started', {
      action: 'reanalysis_started',
      documentId: id,
      version: nextVersion,
      analysisId,
      timestamp: now,
    });

    this.queue.enqueue(id, () => this.analysis.run(id, analysisId));
    return updated ?? record;
  }

  async getAnalysisHistory(id: string): Promise<{ documentId: string; totalRuns: number; history: AnalysisEvent[] }> {
    const record = await this.repository.findMeta(id);
    if (!record) throw Errors.notFound();

    const history = await this.repository.listAnalysisEvents(id);
    return {
      documentId: id,
      totalRuns: history.length,
      history,
    };
  }

  async getImportHistory(id: string): Promise<{ documentId: string; totalImports: number; history: ImportEvent[] }> {
    const record = await this.repository.findMeta(id);
    if (!record) throw Errors.notFound();

    const history = await this.repository.listImportEvents(id);
    return {
      documentId: id,
      totalImports: history.length,
      history,
    };
  }

  async getDetail(id: string): Promise<ReturnType<typeof toDetailView>> {
    const record = await this.repository.findMeta(id);
    if (!record) throw Errors.notFound();
    return toDetailView(record);
  }

  /**
   * Status payload for the processing screen. Includes the queue position so a waiting document
   * can say *why* it has not started, instead of showing a bar that appears stalled.
   */
  async getStatus(id: string): Promise<DocumentStatusView> {
    const record = await this.repository.findMeta(id);
    if (!record) throw Errors.notFound();

    return {
      id: record.id,
      status: record.status,
      progress: record.progress,
      queuePosition: record.status === 'queued' ? this.queue.position(id) : null,
      error: record.error,
      extraction: record.extraction,
      finishedAt: record.finishedAt,
    };
  }

  async getResults(id: string): Promise<ReturnType<typeof toDetailView>> {
    const record = await this.repository.findMeta(id);
    if (!record) throw Errors.notFound();
    if (record.status !== 'completed' || !record.analysis) throw Errors.notReady(record.status);
    return toDetailView(record);
  }

  /** Paged, filtered passages. The browser never receives the whole units array. */
  async getUnits(id: string, rawQuery: Partial<UnitQuery> & Record<string, unknown>): Promise<UnitPage> {
    const record = await this.repository.findMeta(id);
    if (!record) throw Errors.notFound();
    if (record.status !== 'completed') throw Errors.notReady(record.status);
    return this.repository.queryUnits(id, normalizeUnitQuery(rawQuery));
  }

  /** The `.txt` report: served from the cached file when present, regenerated when not. */
  async getReport(id: string): Promise<{ filename: string; content: string }> {
    const meta = await this.repository.findMeta(id);
    if (!meta) throw Errors.notFound();
    if (meta.status !== 'completed' || !meta.analysis) throw Errors.notReady(meta.status);

    const cachePath = path.join(config.upload.dataDir, `${id}.report.txt`);
    const cached = await fs.readFile(cachePath, 'utf8').catch(() => null);
    if (cached !== null && cached.length > 0) {
      return { filename: reportFilename(meta), content: cached };
    }

    const full = await this.repository.findFull(id);
    if (!full) throw Errors.notFound();
    const content = generateTextReport(full);
    await fs.writeFile(cachePath, content, 'utf8').catch(() => undefined);
    return { filename: reportFilename(full), content };
  }

  async getPdfReport(id: string): Promise<{ filename: string; buffer: Buffer }> {
    const meta = await this.repository.findMeta(id);
    if (!meta) throw Errors.notFound();
    if (meta.status !== 'completed' || !meta.analysis) throw Errors.notReady(meta.status);

    const full = await this.repository.findFull(id);
    if (!full) throw Errors.notFound();

    const buffer = await generatePdfReport(full);
    const tc = full.analysis?.tradeCompliance;
    const custRef = tc?.transaction.customerReference || 'GENERAL';
    const txnRef = (tc?.transaction.transactionId || full.id.slice(0, 8)).replace(/[^A-Za-z0-9_-]/g, '_');
    const filename = `TradeGuard_Compliance_Dossier_${custRef}_${txnRef}.pdf`;
    return { filename, buffer };
  }

  /**
   * Stop an analysis that has not finished. A waiting job is dropped and its record says so (otherwise
   * it would read "queued" forever and could never be started again); a running one is flagged and
   * abandons itself at its next checkpoint.
   */
  private async cancelAnalysis(id: string): Promise<void> {
    const dropped = this.queue.cancel(id);
    if (!dropped) return;
    await this.repository.update(id, (doc) => {
      if (doc.status !== 'queued') return;
      const at = new Date().toISOString();
      doc.status = 'cancelled';
      doc.analysisStatus = 'failed';
      doc.finishedAt = at;
      doc.error = { code: 'ANALYSIS_CANCELLED', message: 'The analysis was cancelled before it started.', at };
    });
  }

  /**
   * Make sure the analysis has a local file to read. The working copy is deleted after the retention
   * window; the stored original is what it is rebuilt from.
   */
  private async restoreWorkingCopy(record: DocumentRecord): Promise<void> {
    const ext = path.extname(record.filename) || (record.fileType === 'docx' ? '.docx' : record.fileType === 'doc' ? '.doc' : '.pdf');
    const target = record.storagePath || path.join(config.upload.uploadDir, `${record.id}${ext}`);
    if (record.storagePath && fsSync.existsSync(target)) return;
    const stored = await this.repository.loadSourceFile(record.id);
    if (!stored) return;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, stored, { mode: 0o600 });
    record.storagePath = target;
    await this.repository.update(record.id, (doc) => {
      doc.storagePath = target;
    });
    log.info('restored the working copy from the stored original', { id: record.id, filename: record.filename });
  }

  /**
   * Erase a document and everything derived from it: the record, passages, events, the stored
   * original, extracted images and cached reports. Unlike archiving this cannot be undone, so the
   * caller must hold a dedicated permission and give a reason, and the erasure itself is logged.
   */
  async purge(id: string, actor: { id: string; name: string; role: string }, reason: string): Promise<void> {
    const record = await this.repository.findMeta(id);
    if (!record) throw Errors.notFound();
    await this.cancelAnalysis(id);
    await CleanupService.removeArtifacts(record.storagePath, id);
    await getImageStorageService().deleteDocumentImages(id);
    const removed = await this.repository.purge(id);
    if (!removed) throw Errors.notFound();
    log.warn('[AUDIT_LOG] document_purged', {
      action: 'document_purged',
      documentId: id,
      contentHash: record.contentHash,
      filename: record.filename,
      customerId: record.customerId,
      actorId: actor.id,
      actorRole: actor.role,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  /** Retrieve the original uploaded file: the working copy when present, else the stored original. */
  async getSourceFile(id: string): Promise<{ filename: string; mimeType: string; buffer: Buffer }> {
    const doc = await this.repository.findMeta(id);
    if (!doc) throw Errors.notFound();

    // 1. Try reading from local disk
    if (doc.storagePath && fsSync.existsSync(doc.storagePath)) {
      try {
        const buf = await fs.readFile(doc.storagePath);
        return { filename: doc.filename, mimeType: sourceMimeType(doc.fileType), buffer: buf };
      } catch {
        // file missing on laptop disk, recover from cloud db
      }
    }

    // 2. The stored original (GridFS / source store)
    const stored = await this.repository.loadSourceFile(id);
    if (stored) return { filename: doc.filename, mimeType: sourceMimeType(doc.fileType), buffer: stored };

    throw Errors.notFound('The original file binary is no longer available.');
  }

  async list(limit: number, offset: number): Promise<{ items: DocumentSummaryView[]; total: number }> {
    return this.repository.list(limit, offset);
  }

  async delete(id: string): Promise<void> {
    const record = await this.repository.findMeta(id);
    if (!record) throw Errors.notFound();

    await this.cancelAnalysis(id);
    await CleanupService.removeArtifacts(record.storagePath, id);
    const deleted = await this.repository.delete(id);
    if (!deleted) throw Errors.notFound();
    log.info('document deleted', { id });
  }

  async deleteHistory(options: {
    all?: boolean;
    fromDate?: string;
    toDate?: string;
    ids?: string[];
  }): Promise<{ deletedCount: number; remainingCount: number }> {
    // 1. Safe archival: marks documents as archived without deleting data from MongoDB Atlas
    const { deletedIds, deletedCount } = await this.repository.deleteBatch(options);

    // 2. Cancel queue items for archived docs
    for (const id of deletedIds) {
      await this.cancelAnalysis(id);
    }

    const { total } = await this.repository.list(1, 0);
    log.info('history archived from active view (preserved safely in cloud database)', { archivedCount: deletedCount, remaining: total, options });
    return { deletedCount, remainingCount: total };
  }

  async restoreHistory(options?: { all?: boolean; ids?: string[]; fromDate?: string; toDate?: string }): Promise<{ restoredCount: number; remainingCount: number }> {
    const { restoredCount } = await this.repository.restoreBatch(options);
    const { total } = await this.repository.list(1, 0);
    log.info('history restored from cloud database archive', { restoredCount, activeTotal: total, options });
    return { restoredCount, remainingCount: total };
  }

  async getArchivedCount(options?: { fromDate?: string; toDate?: string }): Promise<{ total: number; matching: number }> {
    return this.repository.countArchived(options);
  }

  /**
   * Record a human decision on a document-level result.
   *
   * What an officer may do is narrower than "set any decision":
   *  - the action has to fit the decision it produces (a note changes nothing; escalating cannot lower),
   *  - a decision only ever moves one step toward ALLOW, so BLOCK_ESCALATE must pass through REVIEW,
   *  - a block founded on a confirmed sanctions listing or a comprehensively sanctioned jurisdiction cannot
   *    be lowered here at all (it is a legal prohibition, not a risk opinion),
   *  - lowering any block is reserved for the Chief Compliance Officer, with a longer written reason.
   *
   * The change is made inside one serialized update, so two officers acting together cannot overwrite
   * each other's record.
   */
  async overrideComplianceDecision(
    id: string,
    override: {
      action: HumanOverrideRecord['action'] | 'APPROVE' | 'ESCALATE';
      officerName: string;
      officerRole: string;
      officerId: string;
      newDecision: ComplianceDecision;
      reason: string;
      notes?: string;
    },
  ): Promise<ReturnType<typeof toDetailView>> {
    const existing = await this.repository.findMeta(id);
    if (!existing?.analysis?.tradeCompliance) throw Errors.notFound();

    let record: (HumanOverrideRecord & { officerId: string }) | null = null;
    let previousDecision: ComplianceDecision = existing.analysis.tradeCompliance.decision.decision;

    const updated = await this.repository.update(id, (d: DocumentRecord) => {
      const tc = d.analysis?.tradeCompliance;
      if (!tc) throw Errors.notFound();
      const current = tc.decision.decision;
      previousDecision = current;
      const effective = assertOverrideAllowed({
        action: override.action,
        officerRole: override.officerRole,
        current,
        requested: override.newDecision,
        reason: override.reason,
        triggeredRules: tc.decision.triggeredRules,
      });

      record = {
        id: 'OVR-' + randomUUID(),
        action: override.action as HumanOverrideRecord['action'],
        officerName: override.officerName,
        officerRole: override.officerRole,
        officerId: override.officerId,
        timestamp: new Date().toISOString(),
        previousDecision: current,
        overriddenDecision: override.newDecision,
        reason: override.reason,
        notes: override.notes || '',
        analysisVersion: d.analysisCount ?? 1,
      };
      tc.decision.decision = effective;
      record.overriddenDecision = effective;
      tc.auditTrail.humanOverrides = [...(tc.auditTrail.humanOverrides || []), record];
    });
    if (!updated || !record) throw Errors.notFound();
    const applied: HumanOverrideRecord = record;

    // Keep the cached text report in step with the decision it describes.
    const full = await this.repository.findFull(id);
    if (full) {
      const reportContent = generateTextReport(full);
      await fs.writeFile(path.join(config.upload.dataDir, id + '.report.txt'), reportContent, 'utf8').catch(() => undefined);
    }

    log.info('[AUDIT_LOG] compliance_decision_overridden', {
      id,
      overrideId: applied.id,
      action: applied.action,
      previousDecision,
      newDecision: override.newDecision,
      officerId: override.officerId,
      officerRole: override.officerRole,
    });
    return toDetailView(full ?? updated);
  }

  queueStats(): { active: number; pending: number; concurrency: number } {
    return this.queue.stats();
  }
}

/**
 * Strip every path component and anything that could confuse a filesystem or an HTTP header.
 * The result is only ever used for display and for the report filename; the file on disk is
 * named by its UUID, so nothing downstream depends on this string being unique.
 */
export function sanitizeFilename(raw: string): string {
  const base = path.basename(String(raw ?? '').replace(/\\/g, '/'));
  const cleaned = base
    // Control characters, including the CR and LF that would let a filename forge a header.
    .split('')
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 31 && code !== 127;
    })
    .join('')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned.length > 0 ? cleaned : 'document').slice(0, 180);
}

/** The type served for a download comes from the detected file type, never from the client's claim. */
function sourceMimeType(fileType: DocumentFileType): string {
  switch (fileType) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return 'application/msword';
  }
}

const DECISION_RANK: Record<ComplianceDecision, number> = { ALLOW: 0, REVIEW: 1, BLOCK_ESCALATE: 2 };

/** Decisions each action can produce. An action that only adds a note produces the current decision. */
const ACTION_OUTCOMES: Record<string, ComplianceDecision[] | 'UNCHANGED'> = {
  ADD_INVESTIGATION_NOTE: 'UNCHANGED',
  REQUEST_ADDITIONAL_DOCS: ['REVIEW'],
  APPROVE_WITH_REVIEW: ['REVIEW', 'ALLOW'],
  APPROVE: ['ALLOW'],
  MARK_FALSE_POSITIVE: ['REVIEW', 'ALLOW'],
  ESCALATE: ['REVIEW', 'BLOCK_ESCALATE'],
  ESCALATE_TO_COMPLIANCE: ['REVIEW', 'BLOCK_ESCALATE'],
  REJECT: ['BLOCK_ESCALATE'],
};

const NEVER_LOWERS = new Set(['ESCALATE', 'ESCALATE_TO_COMPLIANCE', 'REQUEST_ADDITIONAL_DOCS']);

/** A block resting on these is a legal prohibition; no document-level opinion can lift it. */
const NON_OVERRIDABLE_RULES = ['RULE_SANCTIONS_ACTIVE_AT_TRANSACTION_DATE', 'RULE_SANCTIONS_CONFIRMED_MATCH', 'RULE_SANCTIONS_RESTRICTED_JURISDICTION', 'RULE_SBP_TFS_DIRECTIVE_PROHIBITION', 'RULE_OFAC_50_PERCENT_OWNERSHIP_RULE'];

export function assertOverrideAllowed(input: {
  action: string;
  officerRole: string;
  current: ComplianceDecision;
  requested: ComplianceDecision;
  reason: string;
  triggeredRules: string[];
}): ComplianceDecision {
  const outcomes = ACTION_OUTCOMES[input.action];
  if (!outcomes) throw Errors.validation('Unknown override action.');
  if (outcomes === 'UNCHANGED') {
    if (input.requested !== input.current) throw Errors.validation('Adding a note cannot change the decision; choose an action that does.');
    return input.current;
  }
  if (!outcomes.includes(input.requested)) {
    throw Errors.validation('The action ' + input.action + ' cannot produce the decision ' + input.requested + '.');
  }
  if (DECISION_RANK[input.requested] >= DECISION_RANK[input.current]) return input.requested;
  // Escalating and asking for more documents only ever add caution; they never lower a decision.
  if (NEVER_LOWERS.has(input.action)) return input.current;

  // Lowering a decision from here on.
  if (DECISION_RANK[input.current] - DECISION_RANK[input.requested] > 1) {
    throw Errors.validation('A decision can move one step at a time: a blocked document goes to REVIEW first.');
  }
  if (input.current === 'BLOCK_ESCALATE') {
    const prohibition = input.triggeredRules.find((rule) => NON_OVERRIDABLE_RULES.includes(rule));
    if (prohibition) {
      throw new AppError({
        status: 409,
        code: 'OVERRIDE_NOT_PERMITTED',
        message: 'This block rests on a sanctions prohibition (' + prohibition + ') and cannot be lowered by an override. Escalate it to the sanctions officer.',
      });
    }
    if (input.officerRole !== 'CHIEF_COMPLIANCE_OFFICER') {
      throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'Only the Chief Compliance Officer may lower a blocked document.' });
    }
    if (input.reason.trim().length < 30) throw Errors.validation('Lowering a block needs a written reason of at least 30 characters.');
  }
  return input.requested;
}

function extensionMatchesType(extension: string, fileType: DocumentFileType): boolean {
  return (
    (extension === '.pdf' && fileType === 'pdf') ||
    (extension === '.docx' && fileType === 'docx') ||
    (extension === '.doc' && fileType === 'doc')
  );
}

// The service reaches for the repository at construction time, so it cannot be instantiated
// before `initRepository()` has run. This lazy singleton keeps that ordering an internal detail
// rather than something every controller has to remember.
let instance: DocumentService | null = null;

export function getDocumentService(): DocumentService {
  if (!instance) instance = new DocumentService();
  return instance;
}