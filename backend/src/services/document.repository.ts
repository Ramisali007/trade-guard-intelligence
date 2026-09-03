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
} from '../models/document.model';

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
  restoreBatch(options?: { all?: boolean; ids?: string[] }): Promise<{ restoredIds: string[]; restoredCount: number }>;
  /** Documents in a terminal state whose upload file is older than the retention window. */
  findStaleUploads(olderThan: Date): Promise<Array<{ id: string; storagePath: string }>>;
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
  private readonly mutex = new KeyedMutex();
  private readonly dir = config.storage.persistToDisk ? config.upload.dataDir : null;

  async init(): Promise<void> {
    if (!this.dir) return;
    await fs.mkdir(this.dir, { recursive: true });

    let restored = 0;
    for (const entry of await fs.readdir(this.dir).catch(() => [])) {
      if (!entry.endsWith('.json')) continue;
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
    if (restored > 0) log.info('restored persisted documents', { count: restored, dir: this.dir });
  }

  async close(): Promise<void> {
    /* Nothing to release. */
  }

  async create(record: DocumentRecord): Promise<void> {
    this.records.set(record.id, record);
    await this.flush(record);
  }

  async findMeta(id: string): Promise<DocumentRecord | null> {
    const record = this.records.get(id);
    return record ? { ...record, units: [] } : null;
  }

  async findFull(id: string): Promise<DocumentRecord | null> {
    return this.records.get(id) ?? null;
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

    const filtered = record.units.filter((unit) => matches(unit, query));
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
      const uploadedTime = new Date(record.uploadedAt).getTime();
      if (uploadedTime >= fromTime && uploadedTime <= toTime) {
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

  async restoreBatch(options?: { all?: boolean; ids?: string[] }): Promise<{ restoredIds: string[]; restoredCount: number }> {
    const restored: string[] = [];
    for (const record of this.records.values()) {
      if (!record.isArchived) continue;
      if (options?.ids && !options.ids.includes(record.id)) continue;
      record.isArchived = false;
      record.archivedAt = null;
      await this.flush(record);
      restored.push(record.id);
    }
    return { restoredIds: restored, restoredCount: restored.length };
  }

  async findStaleUploads(olderThan: Date): Promise<Array<{ id: string; storagePath: string }>> {
    const stale: Array<{ id: string; storagePath: string }> = [];
    for (const record of this.records.values()) {
      if (!record.storagePath) continue;
      if (record.status !== 'completed' && record.status !== 'failed' && record.status !== 'cancelled') continue;
      const reference = record.finishedAt ?? record.uploadedAt;
      if (new Date(reference) <= olderThan) stale.push({ id: record.id, storagePath: record.storagePath });
    }
    return stale;
  }

  private async flush(record: DocumentRecord): Promise<void> {
    if (!this.dir) return;
    const target = path.join(this.dir, `${record.id}.json`);
    try {
      // Write-then-rename so a crash mid-write cannot leave a half-written record behind.
      const temporary = `${target}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(record), 'utf8');
      await fs.rename(temporary, target);
    } catch (error) {
      // Persistence is a convenience here; losing it must not fail the request.
      log.warn('could not persist document', { id: record.id, error: describeUnknown(error) });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// MongoDB driver
// ---------------------------------------------------------------------------------------------

interface MongoLike {
  client: import('mongodb').MongoClient;
  documents: import('mongodb').Collection<DocumentRecord>;
  units: import('mongodb').Collection<AnalyzedUnit & { documentId: string }>;
}

export class MongoDocumentRepository implements DocumentRepository {
  readonly driver = 'mongo' as const;

  private handle: MongoLike | null = null;
  private readonly mutex = new KeyedMutex();

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

    await documents.createIndex({ id: 1 }, { unique: true });
    await documents.createIndex({ uploadedAt: -1 });
    await units.createIndex({ documentId: 1, paragraphNumber: 1 });
    await units.createIndex({ documentId: 1, pageNumber: 1 });
    // Supports the explorer's free-text search without pulling rows into the process.
    await units.createIndex({ documentId: 1, text: 'text' }).catch(() => undefined);

    this.handle = { client, documents, units };
    log.info('connected to MongoDB', { db: config.storage.mongoDb });
  }

  async close(): Promise<void> {
    await this.handle?.client.close().catch(() => undefined);
    this.handle = null;
  }

  private get store(): MongoLike {
    if (!this.handle) throw Errors.storage('MongoDB repository used before init()');
    return this.handle;
  }

  async create(record: DocumentRecord): Promise<void> {
    const { units: _units, ...meta } = record;
    await this.store.documents.insertOne({ ...meta, units: [] } as DocumentRecord);
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
      .sort({ paragraphNumber: 1 })
      .toArray();
    return { ...meta, units: units as AnalyzedUnit[] };
  }

  async update(id: string, mutate: (record: DocumentRecord) => void): Promise<DocumentRecord | null> {
    return this.mutex.run(id, async () => {
      const record = await this.findMeta(id);
      if (!record) return null;
      mutate(record);
      const { units: _units, ...meta } = record;
      await this.store.documents.replaceOne({ id }, { ...meta, units: [] } as DocumentRecord);
      return record;
    });
  }

  async saveUnits(id: string, units: AnalyzedUnit[]): Promise<void> {
    await this.store.units.deleteMany({ documentId: id });
    if (units.length === 0) return;
    // Chunked so a very large document does not build one enormous insert command.
    const size = 500;
    for (let start = 0; start < units.length; start += size) {
      await this.store.units.insertMany(
        units.slice(start, start + size).map((unit) => ({ ...unit, documentId: id })),
        { ordered: false },
      );
    }
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
        .sort({ paragraphNumber: 1 })
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
    const result = await this.store.documents.updateOne(
      { id },
      { $set: { isArchived: true, archivedAt: new Date().toISOString() } }
    );
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
      await this.store.documents.updateMany(
        { id: { $in: targetIds } },
        { $set: { isArchived: true, archivedAt: new Date().toISOString() } }
      );
    }
    return { deletedIds: targetIds, deletedCount: targetIds.length };
  }

  async restoreBatch(options?: { all?: boolean; ids?: string[] }): Promise<{ restoredIds: string[]; restoredCount: number }> {
    const filter: Record<string, any> = { isArchived: true };
    if (options?.ids && options.ids.length > 0) {
      filter.id = { $in: options.ids };
    }
    const docs = await this.store.documents.find(filter, { projection: { id: 1 } }).toArray();
    const targetIds = docs.map((d) => d.id);
    if (targetIds.length > 0) {
      await this.store.documents.updateMany(
        { id: { $in: targetIds } },
        { $set: { isArchived: false, archivedAt: null } }
      );
    }
    return { restoredIds: targetIds, restoredCount: targetIds.length };
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