import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { KeyedMutex } from '../utils/async';
import { describeUnknown, Errors } from '../utils/errors';
import { createLogger } from '../utils/logger';
import {
  toSummaryView,
  type AnalyzedUnit,
  type DocumentRecord,
  type DocumentSummaryView,
  type AnalysisEvent,
  type ImportEvent,
} from '../models/document.model';

export type { AnalyzedUnit, DocumentRecord, DocumentSummaryView, AnalysisEvent, ImportEvent };

const log = createLogger('repository');

/**
 * Persistence, behind one interface with two drivers.
 *
 * `memory` is the default so the application runs with no infrastructure at all; it mirrors
 * each record to a JSON file so a restart does not lose completed analyses. `mongo` is the
 * scalable driver: document metadata in one collection, the (potentially very large) units
 * array in a second, indexed collection so results can be paged server-side.
 *
 * Both drivers page and filter units in the *store*, never in the browser. A 4,000-unit
 * document ships 50 rows per request, not 4,000.
 */

export interface UnitQuery {
  /** 1-based page of results. */
  page: number;
  pageSize: number;
  sentiment?: string[];
  emotion?: string[];
  contentType?: string[];
  topic?: string[];
  unitType?: string[];
  /** Restrict to one page of the source document. */
  documentPage?: number;
  section?: string;
  search?: string;
  minConfidence?: number;
  /** Only rows classified by the given engine. */
  source?: 'ai' | 'heuristic';
}

export interface UnitPage {
  items: AnalyzedUnit[];
  total: number;
  page: number;
  pageSize: number;
  /** Total before filters, so the UI can say "42 of 327". */
  unfilteredTotal: number;
}

export interface DocumentRepository {
  init(): Promise<void>;
  close(): Promise<void>;
  readonly driver: 'memory' | 'mongo';

  create(record: DocumentRecord): Promise<void>;
  /** Find existing document by tenant/customer ID and SHA-256 contentHash */
  findByContentHash(customerId: string, contentHash: string, options?: { includeArchived?: boolean }): Promise<DocumentRecord | null>;
  /** Find candidate duplicate document by tenant/customer ID and normalized text hash */
  findByNormalizedTextHash(customerId: string, normalizedTextHash: string): Promise<DocumentRecord | null>;
  /** Metadata only — never carries the units array. */
  findMeta(id: string): Promise<DocumentRecord | null>;
  /** Full record including units. Used by the report writer. */
  findFull(id: string): Promise<DocumentRecord | null>;
  /** Read-modify-write, serialised per document id so concurrent writers cannot interleave. */
  update(id: string, mutate: (record: DocumentRecord) => void): Promise<DocumentRecord | null>;
  /** Replaces the units array wholesale, at the end of a run. */
  saveUnits(id: string, units: AnalyzedUnit[]): Promise<void>;
  queryUnits(id: string, query: UnitQuery): Promise<UnitPage>;
  list(limit: number, offset: number, options?: { includeArchived?: boolean }): Promise<{ items: DocumentSummaryView[]; total: number }>;
  delete(id: string): Promise<boolean>;
  deleteBatch(options: { all?: boolean; fromDate?: string; toDate?: string; ids?: string[] }): Promise<{ deletedIds: string[]; deletedCount: number }>;
  restoreBatch(options?: { all?: boolean; ids?: string[]; fromDate?: string; toDate?: string }): Promise<{ restoredIds: string[]; restoredCount: number }>;
  countArchived(options?: { fromDate?: string; toDate?: string }): Promise<{ total: number; matching: number }>;
  /** Documents in a terminal state whose upload file is older than the retention window. */
  findStaleUploads(olderThan: Date): Promise<Array<{ id: string; storagePath: string }>>;

  /** Analysis History Management */
  saveAnalysisEvent(event: AnalysisEvent): Promise<void>;
  updateAnalysisEvent(analysisId: string, mutate: (event: AnalysisEvent) => void): Promise<void>;
  listAnalysisEvents(documentId: string): Promise<AnalysisEvent[]>;

  /** Import Audit Events Management */
  saveImportEvent(event: ImportEvent): Promise<void>;
  listImportEvents(documentId: string): Promise<ImportEvent[]>;

  /** Global Analytics aggregation queries */
  getAllDocumentsForAnalytics(filter?: { fromDate?: string; toDate?: string }): Promise<DocumentRecord[]>;
  getAllAnalysisEvents(filter?: { fromDate?: string; toDate?: string }): Promise<AnalysisEvent[]>;
  getAllImportEvents(filter?: { fromDate?: string; toDate?: string }): Promise<ImportEvent[]>;
  getSyncStatus?(): { primaryConnected: boolean; cloudConnected: boolean; dualSyncEnabled: boolean };
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export function normalizeUnitQuery(raw: Partial<UnitQuery> & Record<string, unknown>): UnitQuery {
  const page = Math.max(1, toInt(raw['page'], 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, toInt(raw['pageSize'], DEFAULT_PAGE_SIZE)));
  return {
    page,
    pageSize,
    ...(raw.sentiment?.length ? { sentiment: raw.sentiment } : {}),
    ...(raw.emotion?.length ? { emotion: raw.emotion } : {}),
    ...(raw.contentType?.length ? { contentType: raw.contentType } : {}),
    ...(raw.topic?.length ? { topic: raw.topic } : {}),
    ...(raw.unitType?.length ? { unitType: raw.unitType } : {}),
    ...(raw.documentPage !== undefined ? { documentPage: raw.documentPage } : {}),
    ...(raw.section ? { section: raw.section } : {}),
    ...(raw.search ? { search: raw.search } : {}),
    ...(raw.minConfidence !== undefined ? { minConfidence: raw.minConfidence } : {}),
    ...(raw.source ? { source: raw.source } : {}),
  };
}

function toInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Shared filter predicate so both drivers apply identical semantics. */
function matches(unit: AnalyzedUnit, query: UnitQuery): boolean {
  const { classification } = unit;
  if (query.sentiment && !query.sentiment.includes(classification.sentiment)) return false;
  if (query.emotion && !query.emotion.includes(classification.emotion)) return false;
  if (query.contentType && !query.contentType.includes(classification.contentType)) return false;
  if (query.topic && !query.topic.includes(classification.topic)) return false;
  if (query.unitType && !query.unitType.includes(unit.unitType)) return false;
  if (query.documentPage !== undefined && unit.pageNumber !== query.documentPage) return false;
  if (query.section && (unit.section ?? '') !== query.section) return false;
  if (query.source && classification.source !== query.source) return false;
  if (query.minConfidence !== undefined && classification.confidence < query.minConfidence) return false;
  if (query.search) {
    const needle = query.search.toLowerCase();
    const haystack = `${unit.text}\n${unit.section ?? ''}\n${classification.keywords.join(' ')}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// In-memory driver
// ---------------------------------------------------------------------------------------------

export class MemoryDocumentRepository implements DocumentRepository {
  readonly driver = 'memory' as const;

  private readonly records = new Map<string, DocumentRecord>();
  private readonly analysisEvents = new Map<string, AnalysisEvent>();
  private readonly importEvents = new Map<string, ImportEvent>();
  private readonly mutex = new KeyedMutex();
  private readonly dir = config.storage.persistToDisk ? config.upload.dataDir : null;

  async init(): Promise<void> {
    if (!this.dir) return;
    await fs.mkdir(this.dir, { recursive: true });

    let restored = 0;
    for (const entry of await fs.readdir(this.dir).catch(() => [])) {
      if (!entry.endsWith('.json')) continue;
      if (entry === 'analysis_events.json' || entry === 'import_events.json') continue;
      try {
        const raw = await fs.readFile(path.join(this.dir, entry), 'utf8');
        const record = JSON.parse(raw) as DocumentRecord;
        if (typeof record.id !== 'string') continue;
        // A process that died mid-run leaves a record claiming to be in progress; it is not.
        if (record.status === 'processing' || record.status === 'queued') {
          record.status = 'failed';
          record.error = {
            code: 'PROCESSING_INTERRUPTED',
            message: 'Processing was interrupted before it finished. Please upload the document again.',
            at: new Date().toISOString(),
          };
        }
        this.records.set(record.id, record);
        restored += 1;
      } catch (error) {
        log.warn('could not restore persisted document', { entry, error: describeUnknown(error) });
      }
    }

    // Restore analysis events
    try {
      const evRaw = await fs.readFile(path.join(this.dir, 'analysis_events.json'), 'utf8');
      const events = JSON.parse(evRaw) as AnalysisEvent[];
      for (const ev of events) {
        if (ev.analysisId) this.analysisEvents.set(ev.analysisId, ev);
      }
    } catch {}

    // Restore import events
    try {
      const impRaw = await fs.readFile(path.join(this.dir, 'import_events.json'), 'utf8');
      const events = JSON.parse(impRaw) as ImportEvent[];
      for (const ev of events) {
        if (ev.importEventId) this.importEvents.set(ev.importEventId, ev);
      }
    } catch {}

    if (restored > 0) log.info('restored persisted documents', { count: restored, dir: this.dir });
  }

  async close(): Promise<void> {
    /* Nothing to release. */
  }

  async create(record: DocumentRecord): Promise<void> {
    const customerId = record.customerId || 'default_customer';
    // Concurrency guard: simulate unique index { customerId: 1, contentHash: 1 } in memory
    for (const doc of this.records.values()) {
      if (doc.isArchived) continue;
      const docCust = doc.customerId || 'default_customer';
      if (docCust === customerId && doc.contentHash === record.contentHash) {
        const err: any = new Error(
          `E11000 duplicate key error collection: documents index: uniq_customer_contentHash dup key: { customerId: "${customerId}", contentHash: "${record.contentHash}" }`,
        );
        err.code = 11000;
        throw err;
      }
    }
    this.records.set(record.id, record);
    await this.flush(record);
  }

  async findByContentHash(customerId: string, contentHash: string, options?: { includeArchived?: boolean }): Promise<DocumentRecord | null> {
    const targetCust = customerId || 'default_customer';
    for (const doc of this.records.values()) {
      if (!options?.includeArchived && doc.isArchived) continue;
      const docCust = doc.customerId || 'default_customer';
      if (docCust === targetCust && doc.contentHash === contentHash) {
        return { ...doc, units: [] };
      }
    }
    return null;
  }

  async findByNormalizedTextHash(customerId: string, normalizedTextHash: string): Promise<DocumentRecord | null> {
    if (!normalizedTextHash) return null;
    const targetCust = customerId || 'default_customer';
    for (const doc of this.records.values()) {
      if (doc.isArchived) continue;
      const docCust = doc.customerId || 'default_customer';
      if (docCust === targetCust && doc.normalizedTextHash && doc.normalizedTextHash === normalizedTextHash) {
        return { ...doc, units: [] };
      }
    }
    return null;
  }

  async findMeta(id: string): Promise<DocumentRecord | null> {
    const record = this.records.get(id);
    return record ? { ...record, units: [] } : null;
  }

  async findFull(id: string): Promise<DocumentRecord | null> {
    const record = this.records.get(id);
    if (!record) return null;
    // Sorted strictly by pageNumber and paragraphNumber
    const sortedUnits = [...record.units].sort((a, b) => {
      if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
      return a.paragraphNumber - b.paragraphNumber;
    });
    return { ...record, units: sortedUnits };
  }

  async update(id: string, mutate: (record: DocumentRecord) => void): Promise<DocumentRecord | null> {
    return this.mutex.run(id, async () => {
      const record = this.records.get(id);
      if (!record) return null;
      mutate(record);
      await this.flush(record);
      return { ...record, units: [] };
    });
  }

  async saveUnits(id: string, units: AnalyzedUnit[]): Promise<void> {
    await this.mutex.run(id, async () => {
      const record = this.records.get(id);
      if (!record) return;
      record.units = units;
      await this.flush(record);
    });
  }

  async queryUnits(id: string, query: UnitQuery): Promise<UnitPage> {
    const record = this.records.get(id);
    if (!record) throw Errors.notFound();

    const sorted = [...record.units].sort((a, b) => {
      if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
      return a.paragraphNumber - b.paragraphNumber;
    });
    const filtered = sorted.filter((unit) => matches(unit, query));
    const start = (query.page - 1) * query.pageSize;
    return {
      items: filtered.slice(start, start + query.pageSize),
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
      unfilteredTotal: record.units.length,
    };
  }

  async list(limit: number, offset: number, options?: { includeArchived?: boolean }): Promise<{ items: DocumentSummaryView[]; total: number }> {
    const all = [...this.records.values()]
      .filter((doc) => options?.includeArchived ? true : !doc.isArchived)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return {
      items: all.slice(offset, offset + limit).map(toSummaryView),
      total: all.length,
    };
  }

  async delete(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) return false;
    record.isArchived = true;
    record.archivedAt = new Date().toISOString();
    await this.flush(record);
    return true;
  }

  async deleteBatch(options: { all?: boolean; fromDate?: string; toDate?: string; ids?: string[] }): Promise<{ deletedIds: string[]; deletedCount: number }> {
    const toArchive: string[] = [];
    const fromTime = options.fromDate ? new Date(options.fromDate).getTime() : -Infinity;
    const toTime = options.toDate ? new Date(options.toDate).setHours(23, 59, 59, 999) : Infinity;

    for (const record of this.records.values()) {
      if (record.isArchived) continue;
      if (options.all) {
        toArchive.push(record.id);
        continue;
      }
      if (options.ids && options.ids.includes(record.id)) {
        toArchive.push(record.id);
        continue;
      }
      const uploaded = new Date(record.uploadedAt).getTime();
      if (uploaded >= fromTime && uploaded <= toTime) {
        toArchive.push(record.id);
      }
    }

    for (const id of toArchive) {
      const record = this.records.get(id);
      if (record) {
        record.isArchived = true;
        record.archivedAt = new Date().toISOString();
        await this.flush(record);
      }
    }

    return { deletedIds: toArchive, deletedCount: toArchive.length };
  }

  async restoreBatch(options?: { all?: boolean; ids?: string[]; fromDate?: string; toDate?: string }): Promise<{ restoredIds: string[]; restoredCount: number }> {
    const toRestore: string[] = [];
    const fromTime = options?.fromDate ? new Date(options.fromDate).getTime() : -Infinity;
    const toTime = options?.toDate ? new Date(options.toDate).setHours(23, 59, 59, 999) : Infinity;

    for (const record of this.records.values()) {
      if (!record.isArchived) continue;
      if (options?.all) {
        toRestore.push(record.id);
      } else if (options?.ids && options.ids.includes(record.id)) {
        toRestore.push(record.id);
      } else if (options?.fromDate || options?.toDate) {
        const uploaded = new Date(record.uploadedAt).getTime();
        if (uploaded >= fromTime && uploaded <= toTime) {
          toRestore.push(record.id);
        }
      } else {
        toRestore.push(record.id);
      }
    }
    for (const id of toRestore) {
      const record = this.records.get(id);
      if (record) {
        record.isArchived = false;
        record.archivedAt = null;
        await this.flush(record);
      }
    }
    return { restoredIds: toRestore, restoredCount: toRestore.length };
  }

  async countArchived(options?: { fromDate?: string; toDate?: string }): Promise<{ total: number; matching: number }> {
    let total = 0;
    let matching = 0;
    const fromTime = options?.fromDate ? new Date(options.fromDate).getTime() : -Infinity;
    const toTime = options?.toDate ? new Date(options.toDate).setHours(23, 59, 59, 999) : Infinity;

    for (const record of this.records.values()) {
      if (!record.isArchived) continue;
      total++;
      const uploaded = new Date(record.uploadedAt).getTime();
      if (uploaded >= fromTime && uploaded <= toTime) {
        matching++;
      }
    }
    return { total, matching };
  }

  async findStaleUploads(olderThan: Date): Promise<Array<{ id: string; storagePath: string }>> {
    const rows: Array<{ id: string; storagePath: string }> = [];
    for (const record of this.records.values()) {
      if (record.storagePath && (record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled')) {
        const finishedOrUploaded = new Date(record.finishedAt ?? record.uploadedAt);
        if (finishedOrUploaded <= olderThan) {
          rows.push({ id: record.id, storagePath: record.storagePath });
        }
      }
    }
    return rows;
  }

  async saveAnalysisEvent(event: AnalysisEvent): Promise<void> {
    this.analysisEvents.set(event.analysisId, event);
    await this.flushAnalysisEvents();
  }

  async updateAnalysisEvent(analysisId: string, mutate: (event: AnalysisEvent) => void): Promise<void> {
    const ev = this.analysisEvents.get(analysisId);
    if (ev) {
      mutate(ev);
      await this.flushAnalysisEvents();
    }
  }

  async listAnalysisEvents(documentId: string): Promise<AnalysisEvent[]> {
    const list: AnalysisEvent[] = [];
    for (const ev of this.analysisEvents.values()) {
      if (ev.documentId === documentId) list.push(ev);
    }
    return list.sort((a, b) => a.analysisVersion - b.analysisVersion);
  }

  async saveImportEvent(event: ImportEvent): Promise<void> {
    this.importEvents.set(event.importEventId, event);
    await this.flushImportEvents();
  }

  async listImportEvents(documentId: string): Promise<ImportEvent[]> {
    const list: ImportEvent[] = [];
    for (const ev of this.importEvents.values()) {
      if (ev.documentId === documentId) list.push(ev);
    }
    return list.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  }

  async getAllDocumentsForAnalytics(filter?: { fromDate?: string; toDate?: string }): Promise<DocumentRecord[]> {
    const fromTime = filter?.fromDate ? new Date(filter.fromDate).getTime() : -Infinity;
    const toTime = filter?.toDate ? new Date(filter.toDate).getTime() : Infinity;
    return [...this.records.values()]
      .filter((doc) => {
        if (doc.isArchived) return false;
        const uploaded = new Date(doc.uploadedAt).getTime();
        return uploaded >= fromTime && uploaded <= toTime;
      })
      .map((doc) => ({ ...doc, units: [] }));
  }

  async getAllAnalysisEvents(filter?: { fromDate?: string; toDate?: string }): Promise<AnalysisEvent[]> {
    const fromTime = filter?.fromDate ? new Date(filter.fromDate).getTime() : -Infinity;
    const toTime = filter?.toDate ? new Date(filter.toDate).getTime() : Infinity;
    return [...this.analysisEvents.values()].filter((ev) => {
      const t = new Date(ev.startedAt || ev.createdAt).getTime();
      return t >= fromTime && t <= toTime;
    });
  }

  async getAllImportEvents(filter?: { fromDate?: string; toDate?: string }): Promise<ImportEvent[]> {
    const fromTime = filter?.fromDate ? new Date(filter.fromDate).getTime() : -Infinity;
    const toTime = filter?.toDate ? new Date(filter.toDate).getTime() : Infinity;
    return [...this.importEvents.values()].filter((ev) => {
      const t = new Date(ev.uploadedAt).getTime();
      return t >= fromTime && t <= toTime;
    });
  }

  private async flush(record: DocumentRecord): Promise<void> {
    if (!this.dir) return;
    const target = path.join(this.dir, `${record.id}.json`);
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fs.writeFile(temporary, JSON.stringify(record, null, 2), 'utf8');
      await fs.rename(temporary, target);
    } catch (error) {
      log.warn('could not persist document', { id: record.id, error: describeUnknown(error) });
    }
  }

  private async flushAnalysisEvents(): Promise<void> {
    if (!this.dir) return;
    const target = path.join(this.dir, 'analysis_events.json');
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fs.writeFile(temporary, JSON.stringify(Array.from(this.analysisEvents.values()), null, 2), 'utf8');
      await fs.rename(temporary, target);
    } catch (error) {
      log.warn('could not persist analysis events', { error: describeUnknown(error) });
    }
  }

  private async flushImportEvents(): Promise<void> {
    if (!this.dir) return;
    const target = path.join(this.dir, 'import_events.json');
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fs.writeFile(temporary, JSON.stringify(Array.from(this.importEvents.values()), null, 2), 'utf8');
      await fs.rename(temporary, target);
    } catch (error) {
      log.warn('could not persist import events', { error: describeUnknown(error) });
    }
  }

  getSyncStatus(): { primaryConnected: boolean; cloudConnected: boolean; dualSyncEnabled: boolean } {
    return { primaryConnected: true, cloudConnected: false, dualSyncEnabled: false };
  }
}

// ---------------------------------------------------------------------------------------------
// MongoDB driver
// ---------------------------------------------------------------------------------------------

interface MongoLike {
  client: import('mongodb').MongoClient;
  documents: import('mongodb').Collection<DocumentRecord>;
  units: import('mongodb').Collection<AnalyzedUnit & { documentId: string }>;
  analysisEvents: import('mongodb').Collection<AnalysisEvent>;
  importEvents: import('mongodb').Collection<ImportEvent>;
}

export class MongoDocumentRepository implements DocumentRepository {
  readonly driver = 'mongo' as const;

  private handle: MongoLike | null = null;
  private cloudHandle: MongoLike | null = null;
  private readonly mutex = new KeyedMutex();

  getSyncStatus(): { primaryConnected: boolean; cloudConnected: boolean; dualSyncEnabled: boolean } {
    return {
      primaryConnected: !!this.handle,
      cloudConnected: !!this.cloudHandle,
      dualSyncEnabled: !!(config.storage.enableDualSync && config.storage.cloudMongoUri),
    };
  }

  async init(): Promise<void> {
    try {
      const dns = await import('node:dns');
      dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
    } catch {
      // fallback
    }

    // Imported lazily so the memory driver never pays for the MongoDB driver.
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(config.storage.mongoUri, { serverSelectionTimeoutMS: 15000 });
    await client.connect();

    const db = client.db(config.storage.mongoDb);
    const documents = db.collection<DocumentRecord>('documents');
    const units = db.collection<AnalyzedUnit & { documentId: string }>('document_units');
    const analysisEvents = db.collection<AnalysisEvent>('analysis_events');
    const importEvents = db.collection<ImportEvent>('import_events');

    // Indexes
    await documents.createIndex({ id: 1 }, { unique: true });
    await documents.createIndex({ uploadedAt: -1 });
    // 1. Compound index for tenant-scoped byte-level deduplication
    await documents.createIndex(
      { customerId: 1, contentHash: 1 },
      { unique: true, name: 'uniq_customer_contentHash' },
    );
    // 2. High performance compound index for per-document granular retrieval
    await units.createIndex(
      { documentId: 1, pageNumber: 1, paragraphNumber: 1 },
      { name: 'documentId_page_paragraph' },
    );
    await units.createIndex({ documentId: 1, paragraphNumber: 1 });
    await units.createIndex({ documentId: 1, pageNumber: 1 });
    // Supports the explorer's free-text search without pulling rows into the process.
    await units.createIndex({ documentId: 1, text: 'text' }).catch(() => undefined);

    // 3. Analysis & Import Events indexes
    await analysisEvents.createIndex({ documentId: 1, analysisVersion: -1 });
    await analysisEvents.createIndex({ analysisId: 1 }, { unique: true });
    await importEvents.createIndex({ documentId: 1, uploadedAt: -1 });
    await importEvents.createIndex({ contentHash: 1 });

    this.handle = { client, documents, units, analysisEvents, importEvents };

    // Connect to Secondary MongoDB (Cloud Atlas) if Dual-Sync is enabled
    if (config.storage.enableDualSync && config.storage.cloudMongoUri) {
      try {
        const cloudClient = new MongoClient(config.storage.cloudMongoUri, { serverSelectionTimeoutMS: 12000 });
        await cloudClient.connect();

        const cloudDb = cloudClient.db(config.storage.mongoDb);
        const cloudDocs = cloudDb.collection<DocumentRecord>('documents');
        const cloudUnits = cloudDb.collection<AnalyzedUnit & { documentId: string }>('document_units');
        const cloudEvents = cloudDb.collection<AnalysisEvent>('analysis_events');
        const cloudImports = cloudDb.collection<ImportEvent>('import_events');

        await Promise.allSettled([
          cloudDocs.createIndex({ id: 1 }, { unique: true }),
          cloudDocs.createIndex({ uploadedAt: -1 }),
          cloudDocs.createIndex({ customerId: 1, contentHash: 1 }, { unique: true, name: 'uniq_customer_contentHash' }),
          cloudUnits.createIndex({ documentId: 1, pageNumber: 1, paragraphNumber: 1 }, { name: 'documentId_page_paragraph' }),
          cloudUnits.createIndex({ documentId: 1, paragraphNumber: 1 }),
          cloudUnits.createIndex({ documentId: 1, pageNumber: 1 }),
          cloudEvents.createIndex({ documentId: 1, analysisVersion: -1 }),
          cloudEvents.createIndex({ analysisId: 1 }, { unique: true }),
          cloudImports.createIndex({ documentId: 1, uploadedAt: -1 }),
          cloudImports.createIndex({ contentHash: 1 }),
        ]);

        this.cloudHandle = {
          client: cloudClient,
          documents: cloudDocs,
          units: cloudUnits,
          analysisEvents: cloudEvents,
          importEvents: cloudImports,
        };
        log.info('connected to Secondary MongoDB (Cloud Atlas) - Dual-Write Live Sync ACTIVE', { db: config.storage.mongoDb });
      } catch (cloudErr) {
        log.warn('Could not connect to Secondary MongoDB (Cloud Atlas) at startup, will operate primarily on Local', {
          error: describeUnknown(cloudErr),
        });
      }
    }

    // Migration pass: Seed initial AnalysisEvent and populate missing identity fields for historical documents
    try {
      const existingDocs = await documents.find({}).toArray();
      for (const doc of existingDocs) {
        let needsUpdate = false;
        const updates: Partial<DocumentRecord> = {};

        if (!doc.firstImportedAt) {
          updates.firstImportedAt = doc.uploadedAt;
          needsUpdate = true;
        }
        if (!doc.lastImportedAt) {
          updates.lastImportedAt = doc.uploadedAt;
          needsUpdate = true;
        }
        if (doc.importCount === undefined || doc.importCount === null) {
          updates.importCount = 1;
          needsUpdate = true;
        }
        if (doc.analysis && (doc.analysisCount === undefined || doc.analysisCount === null)) {
          updates.analysisCount = 1;
          updates.firstAnalyzedAt = doc.analysis.completedAt || doc.finishedAt;
          updates.lastAnalyzedAt = doc.analysis.completedAt || doc.finishedAt;
          updates.analysisStatus = 'completed';
          needsUpdate = true;

          const existingEvent = await analysisEvents.findOne({ documentId: doc.id, analysisVersion: 1 });
          if (!existingEvent) {
            await analysisEvents.insertOne({
              analysisId: `analysis-init-${doc.id}`,
              documentId: doc.id,
              analysisVersion: 1,
              startedAt: doc.startedAt || doc.uploadedAt,
              completedAt: doc.analysis.completedAt || doc.finishedAt,
              status: 'completed',
              engine: {
                provider: doc.analysis.engine?.provider || 'ai',
                model: doc.analysis.engine?.model || 'default',
                batchCount: doc.analysis.engine?.batchCount,
                degraded: doc.analysis.engine?.degraded,
                notes: doc.analysis.engine?.notes,
              },
              summary: doc.analysis.summary || null,
              statistics: doc.analysis.statistics || null,
              tradeCompliance: doc.analysis.tradeCompliance || null,
              createdAt: doc.analysis.completedAt || doc.uploadedAt,
            });
          }
        }

        if (needsUpdate) {
          await documents.updateOne({ id: doc.id }, { $set: updates });
        }
      }
    } catch (migErr) {
      log.warn('Startup migration pass completed with warning', { error: describeUnknown(migErr) });
    }

    log.info('connected to MongoDB Primary', { db: config.storage.mongoDb });
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      this.handle?.client.close(),
      this.cloudHandle?.client.close(),
    ]);
    this.handle = null;
    this.cloudHandle = null;
  }

  private get store(): MongoLike {
    if (!this.handle) throw Errors.storage('MongoDB repository used before init()');
    return this.handle;
  }

  async create(record: DocumentRecord): Promise<void> {
    const { units: _units, ...meta } = record;
    const cleanDoc = { ...meta, units: [] } as DocumentRecord;

    const localPromise = this.store.documents.insertOne(cleanDoc);
    const cloudPromise = this.cloudHandle
      ? this.cloudHandle.documents.insertOne({ ...cleanDoc }).catch((err) => {
          log.warn('Failed to mirror create document to Cloud Atlas', { id: record.id, error: describeUnknown(err) });
        })
      : Promise.resolve();

    await Promise.all([localPromise, cloudPromise]);
  }

  async findByContentHash(customerId: string, contentHash: string, options?: { includeArchived?: boolean }): Promise<DocumentRecord | null> {
    const targetCust = customerId || 'default_customer';
    const filter: Record<string, unknown> = { customerId: targetCust, contentHash };
    if (!options?.includeArchived) {
      filter['isArchived'] = { $ne: true };
    }
    const found = await this.store.documents.findOne(
      filter,
      { projection: { _id: 0, units: 0 } },
    );
    return found ? ({ ...found, units: [] } as DocumentRecord) : null;
  }

  async findByNormalizedTextHash(customerId: string, normalizedTextHash: string): Promise<DocumentRecord | null> {
    if (!normalizedTextHash) return null;
    const targetCust = customerId || 'default_customer';
    const found = await this.store.documents.findOne(
      { customerId: targetCust, normalizedTextHash, isArchived: { $ne: true } },
      { projection: { _id: 0, units: 0 } },
    );
    return found ? ({ ...found, units: [] } as DocumentRecord) : null;
  }

  async findMeta(id: string): Promise<DocumentRecord | null> {
    const found = await this.store.documents.findOne({ id }, { projection: { _id: 0 } });
    return found ? { ...found, units: [] } : null;
  }

  async findFull(id: string): Promise<DocumentRecord | null> {
    const meta = await this.findMeta(id);
    if (!meta) return null;
    const units = await this.store.units
      .find({ documentId: id }, { projection: { _id: 0, documentId: 0 } })
      .sort({ pageNumber: 1, paragraphNumber: 1 })
      .toArray();
    return { ...meta, units: units as AnalyzedUnit[] };
  }

  async update(id: string, mutate: (record: DocumentRecord) => void): Promise<DocumentRecord | null> {
    return this.mutex.run(id, async () => {
      const record = await this.findMeta(id);
      if (!record) return null;
      mutate(record);
      const { units: _units, ...meta } = record;
      const cleanDoc = { ...meta, units: [] } as DocumentRecord;

      const localPromise = this.store.documents.replaceOne({ id }, cleanDoc);
      const cloudPromise = this.cloudHandle
        ? this.cloudHandle.documents.replaceOne({ id }, cleanDoc, { upsert: true }).catch((err) => {
            log.warn('Failed to mirror update document to Cloud Atlas', { id, error: describeUnknown(err) });
          })
        : Promise.resolve();

      await Promise.all([localPromise, cloudPromise]);
      return record;
    });
  }

  async saveUnits(id: string, units: AnalyzedUnit[]): Promise<void> {
    const writeUnits = async (h: MongoLike) => {
      await h.units.deleteMany({ documentId: id });
      if (units.length === 0) return;
      const size = 500;
      for (let start = 0; start < units.length; start += size) {
        await h.units.insertMany(
          units.slice(start, start + size).map((unit) => ({ ...unit, documentId: id })),
          { ordered: false },
        );
      }
    };

    const localPromise = writeUnits(this.store);
    const cloudPromise = this.cloudHandle
      ? writeUnits(this.cloudHandle).catch((err) => {
          log.warn('Failed to mirror saveUnits to Cloud Atlas', { id, count: units.length, error: describeUnknown(err) });
        })
      : Promise.resolve();

    await Promise.all([localPromise, cloudPromise]);
  }

  async queryUnits(id: string, query: UnitQuery): Promise<UnitPage> {
    const filter: Record<string, unknown> = { documentId: id };
    if (query.sentiment) filter['classification.sentiment'] = { $in: query.sentiment };
    if (query.emotion) filter['classification.emotion'] = { $in: query.emotion };
    if (query.contentType) filter['classification.contentType'] = { $in: query.contentType };
    if (query.topic) filter['classification.topic'] = { $in: query.topic };
    if (query.unitType) filter['unitType'] = { $in: query.unitType };
    if (query.documentPage !== undefined) filter['pageNumber'] = query.documentPage;
    if (query.section) filter['section'] = query.section;
    if (query.source) filter['classification.source'] = query.source;
    if (query.minConfidence !== undefined) filter['classification.confidence'] = { $gte: query.minConfidence };
    if (query.search) {
      // Regex rather than $text so partial words match, which is what a filter box implies.
      filter['text'] = { $regex: escapeRegex(query.search), $options: 'i' };
    }

    const [items, total, unfilteredTotal] = await Promise.all([
      this.store.units
        .find(filter, { projection: { _id: 0, documentId: 0 } })
        .sort({ pageNumber: 1, paragraphNumber: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .toArray(),
      this.store.units.countDocuments(filter),
      this.store.units.countDocuments({ documentId: id }),
    ]);

    return { items: items as AnalyzedUnit[], total, page: query.page, pageSize: query.pageSize, unfilteredTotal };
  }

  async list(limit: number, offset: number, options?: { includeArchived?: boolean }): Promise<{ items: DocumentSummaryView[]; total: number }> {
    const filter = options?.includeArchived ? {} : { isArchived: { $ne: true } };
    const [rows, total] = await Promise.all([
      this.store.documents
        .find(filter, { projection: { _id: 0, units: 0, fileBase64: 0 } })
        .sort({ uploadedAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      this.store.documents.countDocuments(filter),
    ]);
    return { items: rows.map((row) => toSummaryView({ ...row, units: [] } as DocumentRecord)), total };
  }

  async delete(id: string): Promise<boolean> {
    const timestamp = new Date().toISOString();
    const localPromise = this.store.documents.updateOne(
      { id },
      { $set: { isArchived: true, archivedAt: timestamp } }
    );
    const cloudPromise = this.cloudHandle
      ? this.cloudHandle.documents.updateOne(
          { id },
          { $set: { isArchived: true, archivedAt: timestamp } }
        ).catch((err) => {
          log.warn('Failed to mirror archive document to Cloud Atlas', { id, error: describeUnknown(err) });
        })
      : Promise.resolve();

    const [result] = await Promise.all([localPromise, cloudPromise]);
    return result.matchedCount > 0;
  }

  async deleteBatch(options: { all?: boolean; fromDate?: string; toDate?: string; ids?: string[] }): Promise<{ deletedIds: string[]; deletedCount: number }> {
    const filter: Record<string, any> = { isArchived: { $ne: true } };
    if (!options.all) {
      if (options.ids && options.ids.length > 0) {
        filter.id = { $in: options.ids };
      } else if (options.fromDate || options.toDate) {
        filter.uploadedAt = {};
        if (options.fromDate) filter.uploadedAt.$gte = new Date(options.fromDate).toISOString();
        if (options.toDate) {
          const end = new Date(options.toDate);
          end.setHours(23, 59, 59, 999);
          filter.uploadedAt.$lte = end.toISOString();
        }
      }
    }
    const docs = await this.store.documents.find(filter, { projection: { id: 1 } }).toArray();
    const targetIds = docs.map((d) => d.id);
    if (targetIds.length > 0) {
      const timestamp = new Date().toISOString();
      const localPromise = this.store.documents.updateMany(
        { id: { $in: targetIds } },
        { $set: { isArchived: true, archivedAt: timestamp } }
      );
      const cloudPromise = this.cloudHandle
        ? this.cloudHandle.documents.updateMany(
            { id: { $in: targetIds } },
            { $set: { isArchived: true, archivedAt: timestamp } }
          ).catch((err) => {
            log.warn('Failed to mirror deleteBatch to Cloud Atlas', { count: targetIds.length, error: describeUnknown(err) });
          })
        : Promise.resolve();

      await Promise.all([localPromise, cloudPromise]);
    }
    return { deletedIds: targetIds, deletedCount: targetIds.length };
  }

  async restoreBatch(options?: { all?: boolean; ids?: string[]; fromDate?: string; toDate?: string }): Promise<{ restoredIds: string[]; restoredCount: number }> {
    const filter: Record<string, any> = { isArchived: true };
    if (options?.ids && options.ids.length > 0) {
      filter.id = { $in: options.ids };
    } else if (!options?.all && (options?.fromDate || options?.toDate)) {
      filter.uploadedAt = {};
      if (options.fromDate) filter.uploadedAt.$gte = new Date(options.fromDate).toISOString();
      if (options.toDate) {
        const end = new Date(options.toDate);
        end.setHours(23, 59, 59, 999);
        filter.uploadedAt.$lte = end.toISOString();
      }
    }
    const docs = await this.store.documents.find(filter, { projection: { id: 1 } }).toArray();
    const targetIds = docs.map((d) => d.id);
    if (targetIds.length > 0) {
      const localPromise = this.store.documents.updateMany(
        { id: { $in: targetIds } },
        { $set: { isArchived: false, archivedAt: null } }
      );
      const cloudPromise = this.cloudHandle
        ? this.cloudHandle.documents.updateMany(
            { id: { $in: targetIds } },
            { $set: { isArchived: false, archivedAt: null } }
          ).catch((err) => {
            log.warn('Failed to mirror restoreBatch to Cloud Atlas', { count: targetIds.length, error: describeUnknown(err) });
          })
        : Promise.resolve();

      await Promise.all([localPromise, cloudPromise]);
    }
    return { restoredIds: targetIds, restoredCount: targetIds.length };
  }

  async countArchived(options?: { fromDate?: string; toDate?: string }): Promise<{ total: number; matching: number }> {
    const total = await this.store.documents.countDocuments({ isArchived: true });

    const filter: Record<string, any> = { isArchived: true };
    if (options?.fromDate || options?.toDate) {
      filter.uploadedAt = {};
      if (options.fromDate) filter.uploadedAt.$gte = new Date(options.fromDate).toISOString();
      if (options.toDate) {
        const end = new Date(options.toDate);
        end.setHours(23, 59, 59, 999);
        filter.uploadedAt.$lte = end.toISOString();
      }
    }
    const matching = await this.store.documents.countDocuments(filter);
    return { total, matching };
  }

  async findStaleUploads(olderThan: Date): Promise<Array<{ id: string; storagePath: string }>> {
    const rows = await this.store.documents
      .find(
        {
          storagePath: { $ne: null },
          status: { $in: ['completed', 'failed', 'cancelled'] },
        },
        { projection: { _id: 0, id: 1, storagePath: 1, finishedAt: 1, uploadedAt: 1 } },
      )
      .toArray();

    return rows
      .filter((row) => new Date(row.finishedAt ?? row.uploadedAt) <= olderThan)
      .map((row) => ({ id: row.id, storagePath: row.storagePath as string }));
  }

  async saveAnalysisEvent(event: AnalysisEvent): Promise<void> {
    const localPromise = this.store.analysisEvents.insertOne(event);
    const cloudPromise = this.cloudHandle
      ? this.cloudHandle.analysisEvents.replaceOne({ analysisId: event.analysisId }, event, { upsert: true }).catch((err) => {
          log.warn('Failed to mirror saveAnalysisEvent to Cloud Atlas', { id: event.analysisId, error: describeUnknown(err) });
        })
      : Promise.resolve();

    await Promise.all([localPromise, cloudPromise]);
  }

  async updateAnalysisEvent(analysisId: string, mutate: (event: AnalysisEvent) => void): Promise<void> {
    const ev = await this.store.analysisEvents.findOne({ analysisId });
    if (ev) {
      mutate(ev);
      const { _id, ...clean } = ev as any;
      const localPromise = this.store.analysisEvents.replaceOne({ analysisId }, clean as AnalysisEvent);
      const cloudPromise = this.cloudHandle
        ? this.cloudHandle.analysisEvents.replaceOne({ analysisId }, clean as AnalysisEvent, { upsert: true }).catch((err) => {
            log.warn('Failed to mirror updateAnalysisEvent to Cloud Atlas', { analysisId, error: describeUnknown(err) });
          })
        : Promise.resolve();

      await Promise.all([localPromise, cloudPromise]);
    }
  }

  async listAnalysisEvents(documentId: string): Promise<AnalysisEvent[]> {
    const list = await this.store.analysisEvents
      .find({ documentId }, { projection: { _id: 0 } })
      .sort({ analysisVersion: 1 })
      .toArray();
    return list;
  }

  async saveImportEvent(event: ImportEvent): Promise<void> {
    const localPromise = this.store.importEvents.insertOne(event);
    const cloudPromise = this.cloudHandle
      ? this.cloudHandle.importEvents.insertOne({ ...event }).catch((err) => {
          log.warn('Failed to mirror saveImportEvent to Cloud Atlas', { id: event.importEventId, error: describeUnknown(err) });
        })
      : Promise.resolve();

    await Promise.all([localPromise, cloudPromise]);
  }

  async listImportEvents(documentId: string): Promise<ImportEvent[]> {
    const list = await this.store.importEvents
      .find({ documentId }, { projection: { _id: 0 } })
      .sort({ uploadedAt: -1 })
      .toArray();
    return list;
  }

  async getAllDocumentsForAnalytics(filter?: { fromDate?: string; toDate?: string }): Promise<DocumentRecord[]> {
    const query: Record<string, any> = { isArchived: { $ne: true } };
    if (filter?.fromDate || filter?.toDate) {
      query.uploadedAt = {};
      if (filter.fromDate) query.uploadedAt.$gte = new Date(filter.fromDate).toISOString();
      if (filter.toDate) query.uploadedAt.$lte = new Date(filter.toDate).toISOString();
    }
    const docs = await this.store.documents
      .find(query, { projection: { units: 0, fileBase64: 0, reportTxt: 0 } })
      .sort({ uploadedAt: -1 })
      .toArray();
    return docs as DocumentRecord[];
  }

  async getAllAnalysisEvents(filter?: { fromDate?: string; toDate?: string }): Promise<AnalysisEvent[]> {
    const query: Record<string, any> = {};
    if (filter?.fromDate || filter?.toDate) {
      query.createdAt = {};
      if (filter.fromDate) query.createdAt.$gte = new Date(filter.fromDate).toISOString();
      if (filter.toDate) query.createdAt.$lte = new Date(filter.toDate).toISOString();
    }
    return await this.store.analysisEvents.find(query).sort({ createdAt: -1 }).toArray();
  }

  async getAllImportEvents(filter?: { fromDate?: string; toDate?: string }): Promise<ImportEvent[]> {
    const query: Record<string, any> = {};
    if (filter?.fromDate || filter?.toDate) {
      query.uploadedAt = {};
      if (filter.fromDate) query.uploadedAt.$gte = new Date(filter.fromDate).toISOString();
      if (filter.toDate) query.uploadedAt.$lte = new Date(filter.toDate).toISOString();
    }
    return await this.store.importEvents.find(query).sort({ uploadedAt: -1 }).toArray();
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------------------------

let repository: DocumentRepository | null = null;

/**
 * Create the configured driver, falling back to memory if MongoDB is unreachable.
 *
 * Refusing to start because an optional database is down would make the application harder to
 * demonstrate than it needs to be; the fallback is logged loudly and reported on `/api/health`.
 */
export async function initRepository(): Promise<DocumentRepository> {
  if (repository) return repository;

  if (config.storage.driver === 'mongo') {
    const mongo = new MongoDocumentRepository();
    try {
      await mongo.init();
      repository = mongo;
      return repository;
    } catch (error) {
      log.error('MongoDB unavailable, falling back to the in-memory store', { error: describeUnknown(error) });
      await mongo.close();
    }
  }

  const memory = new MemoryDocumentRepository();
  await memory.init();
  repository = memory;
  return repository;
}

export function getRepository(): DocumentRepository {
  if (!repository) throw Errors.storage('Repository accessed before initRepository()');
  return repository;
}

export async function closeRepository(): Promise<void> {
  await repository?.close();
  repository = null;
}