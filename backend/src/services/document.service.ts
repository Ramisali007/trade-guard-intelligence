import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { detectFileType } from '../document-processing/extractors';
import { Errors, describeUnknown } from '../utils/errors';
import { createLogger } from '../utils/logger';
import {
  createInitialProgress,
  toDetailView,
  type DocumentFileType,
  type DocumentRecord,
  type DocumentSummaryView,
} from '../models/document.model';
import { getRepository, normalizeUnitQuery, type UnitPage, type UnitQuery } from './document.repository';
import { AnalysisService } from './analysis.service';
import { getQueue } from './queue.service';
import { CleanupService } from './cleanup.service';
import { generateTextReport, reportFilename } from './report.service';

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

export class DocumentService {
  private readonly repository = getRepository();
  private readonly analysis = new AnalysisService(this.repository);
  private readonly queue = getQueue();

  async createFromUpload(file: UploadedFile | undefined, options: { autoStart: boolean }): Promise<DocumentRecord> {
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
    if (!extensionMatchesType(extension, fileType)) {
      log.warn('extension disagrees with the file signature', { filename, extension, fileType });
    }

    const id = randomUUID();
    const storagePath = path.join(config.upload.uploadDir, `${id}${extension}`);

    await fs.mkdir(config.upload.uploadDir, { recursive: true });
    try {
      // `wx` fails rather than overwriting, and 0600 keeps the upload private to this process.
      await fs.writeFile(storagePath, file.buffer, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      throw Errors.storage(`Could not write the upload to ${storagePath}: ${describeUnknown(error)}`);
    }

    const record: DocumentRecord = {
      id,
      filename,
      fileType,
      mimeType: file.mimetype,
      fileSize: file.size,
      storagePath,
      uploadedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      status: 'uploaded',
      progress: createInitialProgress(),
      extraction: null,
      analysis: null,
      units: [],
      error: null,
    };

    await this.repository.create(record);
    log.info('document uploaded', { id, filename, fileType, size: file.size });

    if (options.autoStart) await this.startAnalysis(id);
    return (await this.repository.findMeta(id)) ?? record;
  }

  /** Queue a document for analysis. A document already running or queued is left as it is. */
  async startAnalysis(id: string): Promise<DocumentRecord> {
    const record = await this.repository.findMeta(id);
    if (!record) throw Errors.notFound();

    if (record.status === 'processing' || record.status === 'queued') return record;
    if (record.status === 'completed') {
      throw Errors.conflict('This document has already been analysed. Its results are ready to view.');
    }
    if (!record.storagePath) {
      throw Errors.conflict('The uploaded file for this document is no longer available. Please upload it again.');
    }

    const updated = await this.repository.update(id, (doc) => {
      doc.status = 'queued';
      doc.error = null;
      // A retry after a failure starts from a clean checklist rather than a stale one.
      doc.progress = createInitialProgress();
    });

    this.queue.enqueue(id, () => this.analysis.run(id));
    log.info('document queued', { id, ...this.queue.stats() });
    return updated ?? record;
  }

  async getDetail(id: string): Promise<Omit<DocumentRecord, 'units' | 'storagePath'>> {
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

  async getResults(id: string): Promise<Omit<DocumentRecord, 'units' | 'storagePath'>> {
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

  async list(limit: number, offset: number): Promise<{ items: DocumentSummaryView[]; total: number }> {
    return this.repository.list(limit, offset);
  }

  async delete(id: string): Promise<void> {
    const record = await this.repository.findMeta(id);
    if (!record) throw Errors.notFound();

    this.queue.cancel(id);
    await CleanupService.removeArtifacts(record.storagePath, id);
    const deleted = await this.repository.delete(id);
    if (!deleted) throw Errors.notFound();
    log.info('document deleted', { id });
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