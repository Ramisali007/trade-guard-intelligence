import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { KeyedMutex } from '../utils/async';
import { AppError, describeUnknown } from '../utils/errors';
import { GENESIS_HASH, chainAlgorithmField, hashEntry, verifyHashChain, type ChainVerification } from '../utils/hash-chain';
import { createLogger } from '../utils/logger';
import { CASE_HEADER_PROJECTION, type CaseHeader, type CaseStatus, type TradeCase, type TradeCaseEvent } from './trade-case.types';

const log = createLogger('trade-case-repository');

/**
 * Storage for trade cases and their audit log.
 *
 * Cases are written whole, guarded by a revision number: a writer that read revision 7 cannot
 * save over revision 8. The audit log is append-only — there is no update or delete on it — and
 * each event carries the hash of the one before it on the same case, so a removed or edited entry
 * breaks the chain and `verifyChain` reports where.
 */

export type NewEvent = Omit<TradeCaseEvent, 'eventId' | 'seq' | 'prevHash' | 'hash'>;

export interface TradeCaseRepository {
  readonly driver: 'memory' | 'mongo';
  /**
   * True when `commit` and `createWithEvent` save a case and its audit event as one all-or-nothing unit
   * (MongoDB on a replica set or sharded cluster). Otherwise the caller saves the case, then the event, and a
   * failure between the two leaves a saved change without its audit entry, which verification reports.
   */
  readonly atomic: boolean;
  commit?(tradeCase: TradeCase, expectedRevision: number, event: TradeCaseEvent): Promise<void>;
  createWithEvent?(tradeCase: TradeCase, event: TradeCaseEvent): Promise<void>;
  init(): Promise<void>;
  close(): Promise<void>;
  /** Next case number for the year, unique across the store. */
  nextCaseNumber(year: number): Promise<number>;
  create(tradeCase: TradeCase): Promise<void>;
  findById(caseId: string): Promise<TradeCase | null>;
  findByClientRequest(customerRef: string, clientRequestId: string): Promise<TradeCase | null>;
  /** Cases without the bulky AI-review and screening results (see `CaseHeader`). Read one with `findById` for the whole case. */
  list(filter: { customerRef?: string; statuses?: CaseStatus[] }): Promise<CaseHeader[]>;
  /** Saves `tradeCase` if the stored revision is still `expectedRevision`; otherwise a 409. */
  replace(tradeCase: TradeCase, expectedRevision: number): Promise<void>;
  findCaseIdsByDocumentId(documentId: string): Promise<string[]>;
  /** The next event for the case, chained to the last stored one; not yet stored. */
  prepareEvent(event: NewEvent): Promise<TradeCaseEvent>;
  /** Store a prepared event. Refuses one that does not extend the stored chain. */
  insertEvent(event: TradeCaseEvent): Promise<void>;
  listEvents(caseId: string): Promise<TradeCaseEvent[]>;
}

export { GENESIS_HASH };

export function hashEvent(event: Omit<TradeCaseEvent, 'hash'>): string {
  return hashEntry(event as unknown as Record<string, unknown>);
}

/**
 * Verify a case's log in stored order, against the case's own anchor when given: editing,
 * reordering, removing from the middle and removing from the end are all reported.
 */
export function verifyChain(events: TradeCaseEvent[], anchor?: { seq: number; hash: string } | null): ChainVerification {
  return verifyHashChain(events, anchor);
}

function conflict(caseId: string): AppError {
  return new AppError({
    status: 409,
    code: 'CONFLICT',
    message: 'This case was changed by someone else a moment ago. Reload it and try again.',
    internal: `stale revision on ${caseId}`,
    retryable: true,
  });
}

export function buildEvent(input: NewEvent, seq: number, prevHash: string): TradeCaseEvent {
  const withoutHash = { ...input, eventId: `EV-${input.caseId}-${String(seq).padStart(5, '0')}`, seq, prevHash, ...chainAlgorithmField() };
  return { ...withoutHash, hash: hashEvent(withoutHash) };
}

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Makes a stored case read-only all the way down. The memory driver keeps one frozen copy per case and hands that same
 * object to list readers, so a list of a thousand cases copies nothing (a deep copy of each took over a second per request
 * and blocked every other user). A reader that tries to change one gets a TypeError instead of silently changing the store;
 * code that needs to change a case reads it with `findById`, which returns a private copy.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
const frozenCase = (c: TradeCase): TradeCase => deepFreeze(upgradeReferences(c));

/**
 * A request is known by its case number (`TC-2026-00001`) everywhere: before and after approval, on the post-shipment
 * application (`TC-2026-00001/P1`) and on the host payload. Cases saved while the approved reference was written
 * `PSR-2026-00001` are read with the case number instead; what was saved is not rewritten until the case next changes,
 * and the audit log keeps what it said at the time.
 */
export function upgradeReferences(c: TradeCase): TradeCase;
export function upgradeReferences(c: CaseHeader): CaseHeader;
export function upgradeReferences(c: CaseHeader): CaseHeader {
  if (c.preShipmentReference?.reference?.startsWith('PSR-')) c.preShipmentReference.reference = c.caseId;
  for (const p of c.presentations ?? []) if (typeof p.reference === 'string' && p.reference.startsWith('PSR-')) p.reference = `${c.caseId}${p.reference.slice(p.reference.indexOf('/'))}`;
  return c;
}

// ---------------------------------------------------------------------------------------------
// Memory driver, mirrored to disk
// ---------------------------------------------------------------------------------------------

export class MemoryTradeCaseRepository implements TradeCaseRepository {
  readonly driver = 'memory' as const;
  readonly atomic = false;
  private readonly cases = new Map<string, TradeCase>();
  private readonly events = new Map<string, TradeCaseEvent[]>();
  private readonly counters = new Map<number, number>();
  private readonly mutex = new KeyedMutex();
  private readonly casesFile = path.join(config.upload.dataDir, 'trade-cases.json');
  private readonly eventsFile = path.join(config.upload.dataDir, 'trade-case-events.jsonl');

  async init(): Promise<void> {
    if (!config.storage.persistToDisk) return;
    try {
      const stored = JSON.parse(await fs.readFile(this.casesFile, 'utf8')) as { cases: TradeCase[]; counters: Record<string, number> };
      for (const c of stored.cases ?? []) this.cases.set(c.caseId, frozenCase(c));
      for (const [year, n] of Object.entries(stored.counters ?? {})) this.counters.set(Number(year), n);
    } catch {
      // First run.
    }
    try {
      const lines = (await fs.readFile(this.eventsFile, 'utf8')).split('\n').filter(Boolean);
      for (const line of lines) {
        const event = JSON.parse(line) as TradeCaseEvent;
        const list = this.events.get(event.caseId) ?? [];
        list.push(event);
        this.events.set(event.caseId, list);
      }
    } catch {
      // First run.
    }
    log.info('trade cases loaded from disk', { cases: this.cases.size });
  }

  async close(): Promise<void> {
    // Writes are flushed as they happen.
  }

  private async flushCases(): Promise<void> {
    if (!config.storage.persistToDisk) return;
    const body = JSON.stringify({ cases: [...this.cases.values()], counters: Object.fromEntries(this.counters) });
    await fs.mkdir(path.dirname(this.casesFile), { recursive: true });
    // Write-then-rename, so a crash mid-write leaves the previous file intact.
    const tmp = `${this.casesFile}.${process.pid}.tmp`;
    await fs.writeFile(tmp, body, { mode: 0o600 });
    await fs.rename(tmp, this.casesFile);
  }

  nextCaseNumber(year: number): Promise<number> {
    return this.mutex.run('counter', async () => {
      const next = (this.counters.get(year) ?? 0) + 1;
      this.counters.set(year, next);
      await this.flushCases();
      return next;
    });
  }

  create(tradeCase: TradeCase): Promise<void> {
    return this.mutex.run('cases', async () => {
      if (this.cases.has(tradeCase.caseId)) throw conflict(tradeCase.caseId);
      if (tradeCase.clientRequestId && (await this.findByClientRequest(tradeCase.customerRef, tradeCase.clientRequestId))) {
        throw conflict(tradeCase.caseId);
      }
      this.cases.set(tradeCase.caseId, frozenCase(clone(tradeCase)));
      await this.flushCases();
    });
  }

  async findById(caseId: string): Promise<TradeCase | null> {
    const found = this.cases.get(caseId);
    return found ? upgradeReferences(clone(found)) : null;
  }

  async findByClientRequest(customerRef: string, clientRequestId: string): Promise<TradeCase | null> {
    for (const c of this.cases.values()) {
      if (c.customerRef === customerRef && c.clientRequestId === clientRequestId) return upgradeReferences(clone(c));
    }
    return null;
  }

  async list(filter: { customerRef?: string; statuses?: CaseStatus[] }): Promise<CaseHeader[]> {
    return [...this.cases.values()]
      .filter((c) => !filter.customerRef || c.customerRef === filter.customerRef)
      .filter((c) => !filter.statuses || filter.statuses.includes(c.status));
  }

  replace(tradeCase: TradeCase, expectedRevision: number): Promise<void> {
    return this.mutex.run('cases', async () => {
      const current = this.cases.get(tradeCase.caseId);
      if (!current || current.revision !== expectedRevision) throw conflict(tradeCase.caseId);
      this.cases.set(tradeCase.caseId, frozenCase(clone(tradeCase)));
      await this.flushCases();
    });
  }

  async findCaseIdsByDocumentId(documentId: string): Promise<string[]> {
    return [...this.cases.values()].filter((c) => c.documents.some((d) => d.documentId === documentId)).map((c) => c.caseId);
  }

  async prepareEvent(input: NewEvent): Promise<TradeCaseEvent> {
    const list = this.events.get(input.caseId) ?? [];
    const last = list[list.length - 1];
    return buildEvent(input, (last?.seq ?? 0) + 1, last?.hash ?? GENESIS_HASH);
  }

  insertEvent(event: TradeCaseEvent): Promise<void> {
    return this.mutex.run(`events:${event.caseId}`, async () => {
      const list = this.events.get(event.caseId) ?? [];
      const last = list[list.length - 1];
      if (event.seq !== (last?.seq ?? 0) + 1 || event.prevHash !== (last?.hash ?? GENESIS_HASH)) throw conflict(event.caseId);
      list.push(clone(event));
      this.events.set(event.caseId, list);
      if (config.storage.persistToDisk) {
        await fs.mkdir(path.dirname(this.eventsFile), { recursive: true });
        await fs.appendFile(this.eventsFile, `${JSON.stringify(event)}\n`, { mode: 0o600 });
      }
    });
  }

  /** Test seam: the stored log itself, for tamper tests. */
  rawEvents(caseId: string): TradeCaseEvent[] {
    return this.events.get(caseId) ?? [];
  }

  async listEvents(caseId: string): Promise<TradeCaseEvent[]> {
    return clone(this.events.get(caseId) ?? []);
  }
}

// ---------------------------------------------------------------------------------------------
// MongoDB driver
// ---------------------------------------------------------------------------------------------

type MongoCollections = {
  client: import('mongodb').MongoClient;
  cases: import('mongodb').Collection<TradeCase>;
  events: import('mongodb').Collection<TradeCaseEvent>;
  counters: import('mongodb').Collection<{ _id: string; value: number }>;
};

export class MongoTradeCaseRepository implements TradeCaseRepository {
  readonly driver = 'mongo' as const;
  private handle: MongoCollections | null = null;
  private readonly mutex = new KeyedMutex();
  private transactions = false;

  /** Decided once at connect time from the server's topology; see `supportsTransactions`. */
  get atomic(): boolean {
    return this.transactions;
  }

  private get store(): MongoCollections {
    if (!this.handle) throw new AppError({ status: 503, code: 'STORAGE_UNAVAILABLE', message: 'The case store is not available.' });
    return this.handle;
  }

  async init(): Promise<void> {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(config.storage.mongoUri, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    const db = client.db(config.storage.mongoDb);
    const cases = db.collection<TradeCase>('trade_cases');
    const events = db.collection<TradeCaseEvent>('trade_case_events');
    const counters = db.collection<{ _id: string; value: number }>('trade_case_counters');
    await cases.createIndex({ caseId: 1 }, { unique: true });
    await cases.createIndex({ customerRef: 1, status: 1 });
    await cases.createIndex(
      { customerRef: 1, clientRequestId: 1 },
      { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } }, name: 'uniq_customer_client_request' },
    );
    await cases.createIndex({ 'documents.documentId': 1 });
    await events.createIndex({ caseId: 1, seq: 1 }, { unique: true });
    this.handle = { client, cases, events, counters };
    this.transactions = await supportsTransactions(client);
    log.info(
      this.transactions
        ? 'trade case store connected to MongoDB; a case change and its audit entry are saved in one transaction'
        : 'trade case store connected to MongoDB (standalone): a case change and its audit entry are two writes; use a replica set to make them atomic',
    );
  }

  /** One transaction: the case and its audit event are both stored, or neither is. */
  async commit(tradeCase: TradeCase, expectedRevision: number, event: TradeCaseEvent): Promise<void> {
    await this.inTransaction(tradeCase.caseId, async (session) => {
      const result = await this.store.cases.replaceOne({ caseId: tradeCase.caseId, revision: expectedRevision }, clone(tradeCase), { session });
      if (result.matchedCount === 0) throw conflict(tradeCase.caseId);
      await this.store.events.insertOne(clone(event), { session });
    });
  }

  async createWithEvent(tradeCase: TradeCase, event: TradeCaseEvent): Promise<void> {
    await this.inTransaction(tradeCase.caseId, async (session) => {
      await this.store.cases.insertOne(clone(tradeCase), { session });
      await this.store.events.insertOne(clone(event), { session });
    });
  }

  private async inTransaction(caseId: string, work: (session: import('mongodb').ClientSession) => Promise<void>): Promise<void> {
    const session = this.store.client.startSession();
    try {
      // withTransaction retries transient failures (such as a primary stepping down) before giving up.
      await session.withTransaction(() => work(session));
    } catch (error) {
      if (error instanceof AppError) throw error;
      // A duplicate key is the case number, the client request or the audit position already taken.
      if ((error as { code?: number }).code === 11000) throw conflict(caseId);
      throw new AppError({
        status: 503,
        code: 'STORAGE_WRITE_FAILED',
        message: 'The change could not be saved, and nothing was changed. Please try again.',
        internal: describeUnknown(error),
        retryable: true,
      });
    } finally {
      await session.endSession().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.handle?.client.close().catch(() => undefined);
    this.handle = null;
  }

  async nextCaseNumber(year: number): Promise<number> {
    const result = await this.store.counters.findOneAndUpdate(
      { _id: `case-${year}` },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
    return result?.value ?? 1;
  }

  async create(tradeCase: TradeCase): Promise<void> {
    try {
      await this.store.cases.insertOne(clone(tradeCase));
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw conflict(tradeCase.caseId);
      throw error;
    }
  }

  async findById(caseId: string): Promise<TradeCase | null> {
    const found = await this.store.cases.findOne({ caseId }, { projection: { _id: 0 } });
    return found ? upgradeReferences(found) : null;
  }

  async findByClientRequest(customerRef: string, clientRequestId: string): Promise<TradeCase | null> {
    const found = await this.store.cases.findOne({ customerRef, clientRequestId }, { projection: { _id: 0 } });
    return found ? upgradeReferences(found) : null;
  }

  async list(filter: { customerRef?: string; statuses?: CaseStatus[] }): Promise<CaseHeader[]> {
    const query: Record<string, unknown> = {};
    if (filter.customerRef) query['customerRef'] = filter.customerRef;
    if (filter.statuses) query['status'] = { $in: filter.statuses };
    return (await this.store.cases.find(query, { projection: CASE_HEADER_PROJECTION }).sort({ updatedAt: -1 }).toArray()).map(upgradeReferences);
  }

  async replace(tradeCase: TradeCase, expectedRevision: number): Promise<void> {
    const result = await this.store.cases.replaceOne({ caseId: tradeCase.caseId, revision: expectedRevision }, clone(tradeCase));
    if (result.matchedCount === 0) throw conflict(tradeCase.caseId);
  }

  async findCaseIdsByDocumentId(documentId: string): Promise<string[]> {
    const rows = await this.store.cases.find({ 'documents.documentId': documentId }, { projection: { caseId: 1 } }).toArray();
    return rows.map((r) => r.caseId);
  }

  async prepareEvent(input: NewEvent): Promise<TradeCaseEvent> {
    const last = await this.store.events.find({ caseId: input.caseId }).sort({ seq: -1 }).limit(1).next();
    return buildEvent(input, (last?.seq ?? 0) + 1, last?.hash ?? GENESIS_HASH);
  }

  async insertEvent(event: TradeCaseEvent): Promise<void> {
    // The unique (caseId, seq) index refuses a second event at the same position: the log cannot
    // fork, and the caller sees the failure instead of a silently diverging chain.
    try {
      await this.store.events.insertOne(clone(event));
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw conflict(event.caseId);
      throw error;
    }
  }

  /** Test seam: the raw collection, for tamper tests against a live database. */
  get eventsCollection() {
    return this.store.events;
  }

  async listEvents(caseId: string): Promise<TradeCaseEvent[]> {
    return this.store.events.find({ caseId }, { projection: { _id: 0 } }).sort({ seq: 1 }).toArray();
  }
}

/**
 * Multi-document transactions need a replica set member or a mongos; a standalone server refuses them.
 * Both are visible in the `hello` reply, so no test transaction has to be attempted.
 */
async function supportsTransactions(client: import('mongodb').MongoClient): Promise<boolean> {
  try {
    const hello = await client.db('admin').command({ hello: 1 });
    return typeof hello['setName'] === 'string' || hello['msg'] === 'isdbgrid';
  } catch {
    return false;
  }
}

let repository: TradeCaseRepository | null = null;

export async function initTradeCaseRepository(): Promise<TradeCaseRepository> {
  if (repository) return repository;
  if (config.storage.driver === 'mongo') {
    const mongo = new MongoTradeCaseRepository();
    try {
      await mongo.init();
      repository = mongo;
      return repository;
    } catch (error) {
      await mongo.close();
      if (!config.storage.allowMemoryFallback) {
        throw new AppError({ status: 503, code: 'STORAGE_UNAVAILABLE', message: 'The case store is not available.', internal: describeUnknown(error) });
      }
      log.error('MongoDB unavailable for trade cases, falling back to the in-memory store', { error: describeUnknown(error) });
    }
  }
  const memory = new MemoryTradeCaseRepository();
  await memory.init();
  repository = memory;
  return repository;
}

export function getTradeCaseRepository(): TradeCaseRepository {
  if (!repository) throw new AppError({ status: 503, code: 'STORAGE_UNAVAILABLE', message: 'The case store is not available.' });
  return repository;
}

export async function closeTradeCaseRepository(): Promise<void> {
  await repository?.close();
  repository = null;
}
