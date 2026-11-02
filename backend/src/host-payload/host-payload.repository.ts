import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { KeyedMutex } from '../utils/async';
import { AppError, describeUnknown } from '../utils/errors';
import { createLogger } from '../utils/logger';

const log = createLogger('host-payload-repository');

/**
 * Storage for host payloads: the PDF of every version, the token in its link, its TI number counter and who opened it.
 *
 * The case keeps the readable part (status, versions, TI reference, delivery record); the bytes and the token are kept
 * here so that a case read, which happens on every screen, never carries a PDF and never carries the token.
 */

export interface StoredPayloadVersion {
  version: number;
  generatedAt: string;
  sha256: string;
  sizeBytes: number;
  filename: string;
  includesTiReference: boolean;
  pdf: Buffer;
}

export interface PayloadAccess {
  at: string;
  /** A short hash of the caller's address, so repeated opens can be told apart without keeping the address itself. */
  caller: string;
  version: number;
  /** What was opened: the host page, the payload PDF, or one of the client's documents (then `item` is its file name). */
  kind?: 'PAGE' | 'PAYLOAD_PDF' | 'DOCUMENT';
  item?: string;
}

export interface HostPayloadRecord {
  payloadId: string;
  caseId: string;
  /** In the link the host opens. Unguessable; never put in a case view. */
  token: string;
  createdAt: string;
  versions: StoredPayloadVersion[];
  accessCount: number;
  lastAccessAt: string | null;
  /** The most recent opens only (50), newest last. */
  accessLog: PayloadAccess[];
}

export interface HostPayloadRepository {
  readonly driver: 'memory' | 'mongo';
  init(): Promise<void>;
  close(): Promise<void>;
  findByPayloadId(payloadId: string): Promise<HostPayloadRecord | null>;
  findByCase(caseId: string): Promise<HostPayloadRecord | null>;
  /** Creates or replaces the record of a payload. */
  save(record: HostPayloadRecord): Promise<void>;
  recordAccess(payloadId: string, access: PayloadAccess): Promise<void>;
  /** Next host reference number for the year, unique across the store. */
  nextTiNumber(year: number): Promise<number>;
}

const ACCESS_LOG_LIMIT = 50;
const clone = (r: HostPayloadRecord): HostPayloadRecord => ({ ...r, versions: r.versions.map((v) => ({ ...v, pdf: Buffer.from(v.pdf) })), accessLog: r.accessLog.map((a) => ({ ...a })) });

// ---------------------------------------------------------------------------------------------
// Memory driver, mirrored to disk
// ---------------------------------------------------------------------------------------------

export class MemoryHostPayloadRepository implements HostPayloadRepository {
  readonly driver = 'memory' as const;
  private readonly records = new Map<string, HostPayloadRecord>();
  private readonly counters = new Map<number, number>();
  private readonly mutex = new KeyedMutex();
  private readonly file = path.join(config.upload.dataDir, 'host-payloads.json');

  async init(): Promise<void> {
    if (!config.storage.persistToDisk) return;
    try {
      const stored = JSON.parse(await fs.readFile(this.file, 'utf8')) as { records: Array<Omit<HostPayloadRecord, 'versions'> & { versions: Array<Omit<StoredPayloadVersion, 'pdf'> & { pdf: string }> }>; counters: Record<string, number> };
      for (const r of stored.records ?? []) this.records.set(r.payloadId, { ...r, versions: r.versions.map((v) => ({ ...v, pdf: Buffer.from(v.pdf, 'base64') })) });
      for (const [year, n] of Object.entries(stored.counters ?? {})) this.counters.set(Number(year), n);
    } catch {
      // First run.
    }
    log.info('host payloads loaded from disk', { payloads: this.records.size });
  }

  async close(): Promise<void> {
    // Writes are flushed as they happen.
  }

  private async flush(): Promise<void> {
    if (!config.storage.persistToDisk) return;
    const body = JSON.stringify({
      records: [...this.records.values()].map((r) => ({ ...r, versions: r.versions.map((v) => ({ ...v, pdf: v.pdf.toString('base64') })) })),
      counters: Object.fromEntries(this.counters),
    });
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, body, { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  async findByPayloadId(payloadId: string): Promise<HostPayloadRecord | null> {
    const found = this.records.get(payloadId);
    return found ? clone(found) : null;
  }

  async findByCase(caseId: string): Promise<HostPayloadRecord | null> {
    for (const r of this.records.values()) if (r.caseId === caseId) return clone(r);
    return null;
  }

  save(record: HostPayloadRecord): Promise<void> {
    return this.mutex.run('records', async () => {
      this.records.set(record.payloadId, clone(record));
      await this.flush();
    });
  }

  recordAccess(payloadId: string, access: PayloadAccess): Promise<void> {
    return this.mutex.run('records', async () => {
      const r = this.records.get(payloadId);
      if (!r) return;
      r.accessCount += 1;
      r.lastAccessAt = access.at;
      r.accessLog = [...r.accessLog, access].slice(-ACCESS_LOG_LIMIT);
      await this.flush();
    });
  }

  nextTiNumber(year: number): Promise<number> {
    return this.mutex.run('counter', async () => {
      const next = (this.counters.get(year) ?? 0) + 1;
      this.counters.set(year, next);
      await this.flush();
      return next;
    });
  }
}

// ---------------------------------------------------------------------------------------------
// MongoDB driver
// ---------------------------------------------------------------------------------------------

type MongoVersion = Omit<StoredPayloadVersion, 'pdf'> & { pdf: import('mongodb').Binary };
type MongoRecord = Omit<HostPayloadRecord, 'versions'> & { versions: MongoVersion[] };

type MongoCollections = {
  client: import('mongodb').MongoClient;
  payloads: import('mongodb').Collection<MongoRecord>;
  counters: import('mongodb').Collection<{ _id: string; value: number }>;
  Binary: typeof import('mongodb').Binary;
};

export class MongoHostPayloadRepository implements HostPayloadRepository {
  readonly driver = 'mongo' as const;
  private handle: MongoCollections | null = null;

  private get store(): MongoCollections {
    if (!this.handle) throw new AppError({ status: 503, code: 'STORAGE_UNAVAILABLE', message: 'The host payload store is not available.' });
    return this.handle;
  }

  async init(): Promise<void> {
    const { MongoClient, Binary } = await import('mongodb');
    const client = new MongoClient(config.storage.mongoUri, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    const db = client.db(config.storage.mongoDb);
    const payloads = db.collection<MongoRecord>('host_payloads');
    const counters = db.collection<{ _id: string; value: number }>('host_payload_counters');
    await payloads.createIndex({ payloadId: 1 }, { unique: true });
    await payloads.createIndex({ caseId: 1 }, { unique: true });
    this.handle = { client, payloads, counters, Binary };
    log.info('host payload store connected to MongoDB');
  }

  async close(): Promise<void> {
    await this.handle?.client.close().catch(() => undefined);
    this.handle = null;
  }

  private toRecord(row: MongoRecord): HostPayloadRecord {
    const { _id: _ignored, ...rest } = row as MongoRecord & { _id?: unknown };
    return { ...rest, versions: row.versions.map((v) => ({ ...v, pdf: Buffer.from(v.pdf.buffer) })) };
  }

  async findByPayloadId(payloadId: string): Promise<HostPayloadRecord | null> {
    const row = await this.store.payloads.findOne({ payloadId });
    return row ? this.toRecord(row) : null;
  }

  async findByCase(caseId: string): Promise<HostPayloadRecord | null> {
    const row = await this.store.payloads.findOne({ caseId });
    return row ? this.toRecord(row) : null;
  }

  async save(record: HostPayloadRecord): Promise<void> {
    const { Binary } = this.store;
    const doc: MongoRecord = { ...record, versions: record.versions.map((v) => ({ ...v, pdf: new Binary(v.pdf) })) };
    try {
      await this.store.payloads.replaceOne({ payloadId: record.payloadId }, doc, { upsert: true });
    } catch (error) {
      throw new AppError({ status: 503, code: 'STORAGE_WRITE_FAILED', message: 'The host payload could not be saved. Please try again.', internal: describeUnknown(error), retryable: true });
    }
  }

  async recordAccess(payloadId: string, access: PayloadAccess): Promise<void> {
    await this.store.payloads.updateOne(
      { payloadId },
      { $inc: { accessCount: 1 }, $set: { lastAccessAt: access.at }, $push: { accessLog: { $each: [access], $slice: -ACCESS_LOG_LIMIT } } },
    );
  }

  async nextTiNumber(year: number): Promise<number> {
    const result = await this.store.counters.findOneAndUpdate({ _id: `ti-${year}` }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after' });
    return result?.value ?? 1;
  }
}

let repository: HostPayloadRepository | null = null;

export async function initHostPayloadRepository(): Promise<HostPayloadRepository> {
  if (repository) return repository;
  if (config.storage.driver === 'mongo') {
    const mongo = new MongoHostPayloadRepository();
    try {
      await mongo.init();
      repository = mongo;
      return repository;
    } catch (error) {
      await mongo.close();
      if (!config.storage.allowMemoryFallback) {
        throw new AppError({ status: 503, code: 'STORAGE_UNAVAILABLE', message: 'The host payload store is not available.', internal: describeUnknown(error) });
      }
      log.error('MongoDB unavailable for host payloads, falling back to the in-memory store', { error: describeUnknown(error) });
    }
  }
  const memory = new MemoryHostPayloadRepository();
  await memory.init();
  repository = memory;
  return repository;
}

export function getHostPayloadRepository(): HostPayloadRepository {
  if (!repository) throw new AppError({ status: 503, code: 'STORAGE_UNAVAILABLE', message: 'The host payload store is not available.' });
  return repository;
}

export async function closeHostPayloadRepository(): Promise<void> {
  await repository?.close();
  repository = null;
}
