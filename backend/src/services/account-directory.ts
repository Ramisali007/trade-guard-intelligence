import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { ROLE_DEFINITIONS, isRoleId, normalizeRole, type RoleId } from '../authorization/permissions';
import { AppError, Errors, describeUnknown } from '../utils/errors';
import { GENESIS_HASH, chainAlgorithmField, hashEntry, verifyHashChain, type ChainVerification } from '../utils/hash-chain';
import { KeyedMutex } from '../utils/async';
import { writeJsonAtomic } from '../utils/json-snapshot';
import { createLogger } from '../utils/logger';

const log = createLogger('accounts');

/**
 * Who may sign in, with which role, and whether their sessions are still good.
 *
 * Three sources, merged into one directory:
 *  - DEMO accounts (on by default outside production),
 *  - CONFIG accounts from `AUTH_USERS`,
 *  - MANAGED accounts created at runtime by a system administrator.
 *
 * Every account carries a `sessionVersion`. Tokens embed it, and `authenticate` compares it with the
 * directory on every request, so disabling an account, revoking its sessions or changing its role
 * takes effect at once — a stale token is refused, never trusted for its remaining lifetime.
 *
 * Roles and assignments of MANAGED accounts change only through a two-person access request: one
 * administrator requests, a different one approves, and neither may act on their own account.
 * DEMO and CONFIG roles are defined by configuration; they can be disabled or revoked here but not
 * re-roled. Every administrative action is appended to a hash-chained log.
 */

export interface AccountProfile {
  id: string;
  email: string;
  name: string;
  role: RoleId;
  institution: string;
  /** CORPORATE_CUSTOMER: the only customer whose trade cases the login may see. */
  customerRef?: string;
  /** RELATIONSHIP_MANAGER: customers whose cases this RM may see and act on. */
  assignedCustomerRefs?: string[];
}

export type AccountSource = 'DEMO' | 'CONFIG' | 'MANAGED';

export interface AccountRecord {
  id: string;
  email: string;
  name: string;
  institution: string;
  /** null until an access request assigns one: such an account cannot sign in. */
  role: RoleId | null;
  customerRef?: string;
  assignedCustomerRefs: string[];
  passwordHash: string;
  demoKey?: DemoAccountKey;
  source: AccountSource;
  status: 'ACTIVE' | 'DISABLED';
  sessionVersion: number;
  createdAt: string;
  createdBy: string;
}

export const DEMO_ACCOUNT_KEYS = [
  'compliance_officer',
  'risk_analyst',
  'trade_auditor',
  'post_trade_officer',
  'corporate_customer',
  'corporate_customer_2',
  'relationship_manager',
  'trade_maker',
  'trade_checker',
  'operations_desk',
  'credit_reviewer',
  'compliance_reviewer',
  'senior_approver',
  'lc_issuer',
  'settlement_officer',
  'system_admin',
  'security_admin',
] as const;

export type DemoAccountKey = (typeof DEMO_ACCOUNT_KEYS)[number];

type DemoSeed = Omit<AccountProfile, 'id'> & { demoKey: DemoAccountKey };

const DEMO_ACCOUNTS: DemoSeed[] = [
  { demoKey: 'compliance_officer', email: 'ramis.ali@tradeguard.ai', name: 'Ramis Ali', role: 'CHIEF_COMPLIANCE_OFFICER', institution: 'National Bank of Pakistan · International Trade Operations' },
  { demoKey: 'risk_analyst', email: 'sara.khan@tradeguard.ai', name: 'Sara Khan', role: 'TBML_RISK_ANALYST', institution: 'National Bank of Pakistan · TBML & Financial Crime Compliance' },
  { demoKey: 'trade_auditor', email: 'tariq.mehmood@tradeguard.ai', name: 'Tariq Mehmood', role: 'TRADE_AUDITOR', institution: 'National Bank of Pakistan · Trade Audit' },
  { demoKey: 'corporate_customer', email: 'imports@kamrantextiles.pk', name: 'Kamran Textiles (Pvt) Ltd', role: 'CORPORATE_CUSTOMER', institution: 'Kamran Textiles (Pvt) Ltd · Importer', customerRef: 'TG-CORP-1001' },
  { demoKey: 'corporate_customer_2', email: 'trade@indusagro.pk', name: 'Indus Agro Imports Ltd', role: 'CORPORATE_CUSTOMER', institution: 'Indus Agro Imports Ltd · Importer', customerRef: 'TG-CORP-2002' },
  { demoKey: 'relationship_manager', email: 'ayesha.siddiqui@tradeguard.ai', name: 'Ayesha Siddiqui', role: 'RELATIONSHIP_MANAGER', institution: 'Corporate Banking · Relationship Management', assignedCustomerRefs: ['TG-CORP-1001'] },
  { demoKey: 'trade_maker', email: 'bilal.ahmed@tradeguard.ai', name: 'Bilal Ahmed', role: 'TRADE_MAKER', institution: 'Trade Operations · Import LC Desk' },
  { demoKey: 'post_trade_officer', email: 'hamza.sheikh@tradeguard.ai', name: 'Hamza Sheikh', role: 'POST_TRADE_OFFICER', institution: 'Trade Operations · All post-trade desks' },
  { demoKey: 'trade_checker', email: 'farah.naz@tradeguard.ai', name: 'Farah Naz', role: 'TRADE_CHECKER', institution: 'Trade Operations · Document Examination' },
  { demoKey: 'operations_desk', email: 'kashif.raza@tradeguard.ai', name: 'Kashif Raza', role: 'OPERATIONS_DESK', institution: 'Trade Operations · Post-Trade Documentary Desk' },
  { demoKey: 'credit_reviewer', email: 'usman.ghani@tradeguard.ai', name: 'Usman Ghani', role: 'CREDIT_REVIEWER', institution: 'Credit Administration' },
  { demoKey: 'compliance_reviewer', email: 'mehreen.aslam@tradeguard.ai', name: 'Mehreen Aslam', role: 'COMPLIANCE_REVIEWER', institution: 'Compliance · Trade Screening' },
  { demoKey: 'senior_approver', email: 'nadia.hussain@tradeguard.ai', name: 'Nadia Hussain', role: 'SENIOR_APPROVER', institution: 'Trade Finance · Senior Management' },
  { demoKey: 'lc_issuer', email: 'omar.farooq@tradeguard.ai', name: 'Omar Farooq', role: 'LC_ISSUER', institution: 'Trade Operations · LC Issuance' },
  { demoKey: 'settlement_officer', email: 'hina.raza@tradeguard.ai', name: 'Hina Raza', role: 'SETTLEMENT_OFFICER', institution: 'Trade Operations · Settlements' },
  { demoKey: 'system_admin', email: 'imran.qureshi@tradeguard.ai', name: 'Imran Qureshi', role: 'PLATFORM_ADMIN', institution: 'IT · Platform Administration' },
  { demoKey: 'security_admin', email: 'zara.malik@tradeguard.ai', name: 'Zara Malik', role: 'PLATFORM_ADMIN', institution: 'IT · Identity & Access Management' },
];

/** The demo password used outside production when DEMO_ACCOUNT_PASSWORD is not set. */
export const DEFAULT_DEV_DEMO_PASSWORD = 'TradeGuard-Demo-2026';

const SCRYPT_KEYLEN = 32;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
/** Node refuses scrypt above 32 MiB unless told otherwise; N=2^17, r=8 needs 128 MiB (+ headroom). */
const SCRYPT_MAXMEM = 512 * 1024 * 1024;

/**
 * Hashes are stored as `scrypt$<log2N>$<r>$<p>$<salt>$<hash>`, so the cost can be raised later and old
 * hashes still verify with the cost they were made with. The original three-part form
 * (`scrypt$<salt>$<hash>`, Node's default cost) is still accepted.
 */
export function hashPassword(password: string): string {
  const log2N = config.auth.scryptLog2N;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: 2 ** log2N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${log2N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

interface ParsedHash {
  salt: Buffer;
  expected: Buffer;
  options: crypto.ScryptOptions;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') return null;
  try {
    if (parts.length === 3) {
      const expected = Buffer.from(parts[2]!, 'base64url');
      return { salt: Buffer.from(parts[1]!, 'base64url'), expected, options: {} };
    }
    if (parts.length === 6) {
      const log2N = Number(parts[1]);
      const r = Number(parts[2]);
      const p = Number(parts[3]);
      if (![log2N, r, p].every(Number.isInteger) || log2N < 10 || log2N > 22 || r < 1 || r > 32 || p < 1 || p > 8) return null;
      return {
        salt: Buffer.from(parts[4]!, 'base64url'),
        expected: Buffer.from(parts[5]!, 'base64url'),
        options: { N: 2 ** log2N, r, p, maxmem: SCRYPT_MAXMEM },
      };
    }
  } catch {
    return null;
  }
  return null;
}

// At most a few key derivations at once: each holds up to 128 MiB, and the login limit is per address.
const MAX_CONCURRENT_HASHES = 4;
let activeHashes = 0;
const hashQueue: Array<() => void> = [];

async function withHashSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeHashes >= MAX_CONCURRENT_HASHES) await new Promise<void>((resolve) => hashQueue.push(resolve));
  activeHashes += 1;
  try {
    return await task();
  } finally {
    activeHashes -= 1;
    hashQueue.shift()?.();
  }
}

/** Constant-time check on the thread pool, so a login never blocks the event loop. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed || parsed.expected.length === 0) return false;
  const actual = await withHashSlot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        crypto.scrypt(password, parsed.salt, parsed.expected.length, parsed.options, (error, derived) => (error ? reject(error) : resolve(derived)));
      }),
  );
  return parsed.expected.length === actual.length && crypto.timingSafeEqual(parsed.expected, actual);
}

function accountId(email: string): string {
  return `usr-${crypto.createHash('sha256').update(email).digest('hex').slice(0, 12)}`;
}

// A fixed hash to compare against when the email is unknown, so a miss costs the same scrypt
// round as a hit and response timing does not reveal which emails exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

// ------------------------------------------------------------------------------------------ store

export interface AccessRequest {
  requestId: string;
  targetUserId: string;
  change: { role?: RoleId | null; assignedCustomerRefs?: string[]; customerRef?: string | null };
  reason: string;
  requestedBy: { id: string; name: string };
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  rationale: string;
}

export interface IdentityEvent {
  seq: number;
  at: string;
  actor: { id: string; name: string };
  action: string;
  targetUserId: string | null;
  detail: Record<string, unknown>;
  prevHash: string;
  alg?: 'hmac-sha256';
  hash: string;
}

/** What is persisted: managed accounts in full; for DEMO/CONFIG accounts only status and sessionVersion. */
type StoredAccount = Partial<AccountRecord> & { id: string; source: AccountSource };

interface IdentityPersistence {
  load(): Promise<{ accounts: StoredAccount[]; requests: AccessRequest[]; events: IdentityEvent[] }>;
  saveAccount(account: StoredAccount): Promise<void>;
  saveRequest(request: AccessRequest): Promise<void>;
  insertEvent(event: IdentityEvent): Promise<void>;
  close(): Promise<void>;
}

class DiskIdentityPersistence implements IdentityPersistence {
  private readonly file = path.join(config.upload.dataDir, 'identity.json');
  private readonly eventsFile = path.join(config.upload.dataDir, 'identity-events.jsonl');
  private accounts = new Map<string, StoredAccount>();
  private requests = new Map<string, AccessRequest>();

  async load() {
    let events: IdentityEvent[] = [];
    if (config.storage.persistToDisk) {
      try {
        const stored = JSON.parse(await fs.readFile(this.file, 'utf8')) as { accounts: StoredAccount[]; requests: AccessRequest[] };
        for (const a of stored.accounts ?? []) this.accounts.set(a.id, a);
        for (const r of stored.requests ?? []) this.requests.set(r.requestId, r);
      } catch {
        // First run.
      }
      try {
        events = (await fs.readFile(this.eventsFile, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as IdentityEvent);
      } catch {
        // First run.
      }
    }
    return { accounts: [...this.accounts.values()], requests: [...this.requests.values()], events };
  }

  private async flush(): Promise<void> {
    if (!config.storage.persistToDisk) return;
    await writeJsonAtomic(this.file, { accounts: [...this.accounts.values()], requests: [...this.requests.values()] }, { mode: 0o600 });
  }

  async saveAccount(account: StoredAccount) {
    this.accounts.set(account.id, account);
    await this.flush();
  }

  async saveRequest(request: AccessRequest) {
    this.requests.set(request.requestId, request);
    await this.flush();
  }

  async insertEvent(event: IdentityEvent) {
    if (!config.storage.persistToDisk) return;
    await fs.mkdir(path.dirname(this.eventsFile), { recursive: true });
    await fs.appendFile(this.eventsFile, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  }

  async close() {}
}

class MongoIdentityPersistence implements IdentityPersistence {
  private client: import('mongodb').MongoClient | null = null;
  private db: import('mongodb').Db | null = null;

  async connect(): Promise<void> {
    const { MongoClient } = await import('mongodb');
    this.client = new MongoClient(config.storage.mongoUri, { serverSelectionTimeoutMS: 15000 });
    await this.client.connect();
    this.db = this.client.db(config.storage.mongoDb);
    await this.db.collection('platform_accounts').createIndex({ id: 1 }, { unique: true });
    await this.db.collection('platform_access_requests').createIndex({ requestId: 1 }, { unique: true });
    await this.db.collection('platform_identity_events').createIndex({ seq: 1 }, { unique: true });
  }

  private col(name: string) {
    if (!this.db) throw new AppError({ status: 503, code: 'STORAGE_UNAVAILABLE', message: 'The identity store is not available.' });
    return this.db.collection(name);
  }

  async load() {
    const projection = { projection: { _id: 0 } };
    return {
      accounts: (await this.col('platform_accounts').find({}, projection).toArray()) as unknown as StoredAccount[],
      requests: (await this.col('platform_access_requests').find({}, projection).toArray()) as unknown as AccessRequest[],
      events: (await this.col('platform_identity_events').find({}, projection).sort({ seq: 1 }).toArray()) as unknown as IdentityEvent[],
    };
  }

  async saveAccount(account: StoredAccount) {
    await this.col('platform_accounts').replaceOne({ id: account.id }, account, { upsert: true });
  }

  async saveRequest(request: AccessRequest) {
    await this.col('platform_access_requests').replaceOne({ requestId: request.requestId }, request, { upsert: true });
  }

  async insertEvent(event: IdentityEvent) {
    // The unique seq index refuses a forked chain from a second instance.
    await this.col('platform_identity_events').insertOne({ ...event });
  }

  async close() {
    await this.client?.close().catch(() => undefined);
  }
}

// ------------------------------------------------------------------------------------------ directory

let accounts: Map<string, AccountRecord> | null = null;
let requests = new Map<string, AccessRequest>();
let events: IdentityEvent[] = [];
let persistence: IdentityPersistence | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

/** Static accounts (DEMO + CONFIG), built synchronously so authentication works before the store loads. */
function staticAccounts(): Map<string, AccountRecord> {
  const map = new Map<string, AccountRecord>();
  const now = new Date().toISOString();

  if (config.auth.usersJson) {
    try {
      const parsed: unknown = JSON.parse(config.auth.usersJson);
      if (!Array.isArray(parsed)) throw new Error('AUTH_USERS must be a JSON array');
      for (const raw of parsed as Array<Record<string, unknown>>) {
        const email = String(raw['email'] ?? '').trim().toLowerCase();
        const passwordHash = String(raw['passwordHash'] ?? '');
        const role = normalizeRole(String(raw['role'] ?? ''));
        if (!email.includes('@') || !passwordHash.startsWith('scrypt$')) {
          log.warn('skipping malformed AUTH_USERS entry', { email: email || '(missing)' });
          continue;
        }
        if (!role) {
          // An unknown role grants nothing: the account is refused rather than given a default desk.
          log.error('AUTH_USERS entry has an unknown role and was not loaded', { email, role: String(raw['role'] ?? '') });
          continue;
        }
        map.set(email, {
          id: accountId(email),
          email,
          name: String(raw['name'] ?? email.split('@')[0]),
          institution: String(raw['institution'] ?? 'Authorized Trade Desk'),
          role,
          ...(raw['customerRef'] ? { customerRef: String(raw['customerRef']) } : {}),
          assignedCustomerRefs: Array.isArray(raw['assignedCustomerRefs']) ? (raw['assignedCustomerRefs'] as unknown[]).map(String) : [],
          passwordHash,
          source: 'CONFIG',
          status: 'ACTIVE',
          sessionVersion: 1,
          createdAt: now,
          createdBy: 'AUTH_USERS',
        });
      }
    } catch (error) {
      log.error('AUTH_USERS could not be parsed; no provisioned users loaded', { error: String(error) });
    }
  }

  if (config.auth.demoLoginEnabled) {
    const demoPassword = config.auth.demoPassword ?? (config.isProduction ? undefined : DEFAULT_DEV_DEMO_PASSWORD);
    if (demoPassword) {
      const demoHash = hashPassword(demoPassword);
      for (const demo of DEMO_ACCOUNTS) {
        if (map.has(demo.email)) continue;
        map.set(demo.email, {
          ...demo,
          id: accountId(demo.email),
          assignedCustomerRefs: demo.assignedCustomerRefs ?? [],
          passwordHash: demoHash,
          source: 'DEMO',
          status: 'ACTIVE',
          sessionVersion: 1,
          createdAt: now,
          createdBy: 'demo-seed',
        });
      }
    }
  }
  // Keyed by id from here on.
  return new Map([...map.values()].map((a) => [a.id, a]));
}

function directory(): Map<string, AccountRecord> {
  if (!accounts) accounts = staticAccounts();
  return accounts;
}

function applyStored(stored: StoredAccount[]): void {
  const dir = directory();
  for (const s of stored) {
    const existing = dir.get(s.id);
    if (s.source === 'MANAGED') {
      dir.set(s.id, s as AccountRecord);
    } else if (existing) {
      // Static accounts: only the runtime overlay (status, session version) is taken from the store.
      existing.status = s.status ?? existing.status;
      existing.sessionVersion = Math.max(existing.sessionVersion, s.sessionVersion ?? 1);
    }
  }
}

/** Load managed accounts, overlays, requests and the log. Called once at start-up. */
export async function initAccountDirectory(): Promise<void> {
  if (persistence) return;
  let store: IdentityPersistence;
  if (config.storage.driver === 'mongo') {
    const mongo = new MongoIdentityPersistence();
    try {
      await mongo.connect();
      store = mongo;
    } catch (error) {
      await mongo.close();
      if (!config.storage.allowMemoryFallback) {
        throw new AppError({ status: 503, code: 'STORAGE_UNAVAILABLE', message: 'The identity store is not available.', internal: describeUnknown(error) });
      }
      log.error('MongoDB unavailable for identity; using the local store', { error: describeUnknown(error) });
      store = new DiskIdentityPersistence();
    }
  } else {
    store = new DiskIdentityPersistence();
  }
  persistence = store;
  const loaded = await store.load();
  applyStored(loaded.accounts);
  requests = new Map(loaded.requests.map((r) => [r.requestId, r]));
  events = loaded.events.sort((a, b) => a.seq - b.seq);

  // Another instance may revoke a session or change a role: pick that up within seconds.
  if (store instanceof MongoIdentityPersistence) {
    refreshTimer = setInterval(() => {
      void store
        .load()
        .then((fresh) => {
          applyStored(fresh.accounts);
          requests = new Map(fresh.requests.map((r) => [r.requestId, r]));
          events = fresh.events.sort((a, b) => a.seq - b.seq);
        })
        .catch(() => undefined);
    }, 10_000);
    refreshTimer.unref();
  }
}

export async function closeAccountDirectory(): Promise<void> {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  await persistence?.close();
  persistence = null;
}

function toProfile(record: AccountRecord): AccountProfile {
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    role: record.role!,
    institution: record.institution,
    ...(record.customerRef ? { customerRef: record.customerRef } : {}),
    ...(record.assignedCustomerRefs.length ? { assignedCustomerRefs: [...record.assignedCustomerRefs] } : {}),
  };
}

/** The live account behind a token, or null when it no longer exists. */
export function getAccount(id: string): AccountRecord | null {
  return directory().get(id) ?? null;
}

/** Returns the profile when the credentials are valid and the account may sign in. Never says which part was wrong. */
export async function authenticateCredentials(email: string, password: string): Promise<(AccountProfile & { sessionVersion: number }) | null> {
  const record = [...directory().values()].find((a) => a.email === email.trim().toLowerCase());
  const ok = await verifyPassword(password, record?.passwordHash ?? DUMMY_HASH);
  if (!ok || !record || record.status !== 'ACTIVE' || !record.role) return null;
  return { ...toProfile(record), sessionVersion: record.sessionVersion };
}

export function findDemoAccount(key: DemoAccountKey): (AccountProfile & { sessionVersion: number }) | null {
  if (!config.auth.demoLoginEnabled) return null;
  for (const record of directory().values()) {
    if (record.demoKey === key && record.status === 'ACTIVE' && record.role) return { ...toProfile(record), sessionVersion: record.sessionVersion };
  }
  return null;
}

export function listDemoAccounts(): Array<AccountProfile & { demoKey: DemoAccountKey }> {
  if (!config.auth.demoLoginEnabled) return [];
  return [...directory().values()]
    .filter((r): r is AccountRecord & { demoKey: DemoAccountKey; role: RoleId } => Boolean(r.demoKey) && Boolean(r.role) && r.status === 'ACTIVE')
    .map((r) => ({ ...toProfile(r), demoKey: r.demoKey }));
}

/** Test seam: forget loaded accounts so a changed environment is picked up. */
export function resetAccountCache(): void {
  accounts = null;
}

// ------------------------------------------------------------------------------------------ administration

interface Actor {
  id: string;
  name: string;
}

async function record(actor: Actor, action: string, targetUserId: string | null, detail: Record<string, unknown>): Promise<IdentityEvent> {
  const last = events[events.length - 1];
  const base = { seq: (last?.seq ?? 0) + 1, at: new Date().toISOString(), actor, action, targetUserId, detail, prevHash: last?.hash ?? GENESIS_HASH, ...chainAlgorithmField() };
  const event: IdentityEvent = { ...base, hash: hashEntry(base) };
  await persistence?.insertEvent(event);
  events.push(event);
  return event;
}

async function persistAccount(account: AccountRecord): Promise<void> {
  const stored: StoredAccount =
    account.source === 'MANAGED' ? { ...account } : { id: account.id, source: account.source, status: account.status, sessionVersion: account.sessionVersion };
  await persistence?.saveAccount(stored);
}

function requireAccount(id: string): AccountRecord {
  const account = directory().get(id);
  if (!account) throw Errors.notFound('user account');
  return account;
}

export interface AccountSummary {
  id: string;
  email: string;
  name: string;
  institution: string;
  role: RoleId | null;
  roleDisplayName: string | null;
  customerRef: string | null;
  assignedCustomerRefs: string[];
  source: AccountSource;
  status: 'ACTIVE' | 'DISABLED';
  sessionVersion: number;
  createdAt: string;
}

export function listAccounts(): AccountSummary[] {
  return [...directory().values()]
    .map((a) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      institution: a.institution,
      role: a.role,
      roleDisplayName: a.role ? ROLE_DEFINITIONS[a.role].displayName : null,
      customerRef: a.customerRef ?? null,
      assignedCustomerRefs: [...a.assignedCustomerRefs],
      source: a.source,
      status: a.status,
      sessionVersion: a.sessionVersion,
      createdAt: a.createdAt,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export function listAccessRequests(): AccessRequest[] {
  return [...requests.values()].sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
}

export function identityAudit(): { events: IdentityEvent[]; chain: ChainVerification } {
  return { events: [...events], chain: verifyHashChain(events) };
}

/** A new MANAGED account with no role: it cannot sign in until an access request is approved. */
/**
 * Administrative changes run one at a time. Each reads the current log head to number its event and the
 * current account to change it; two at once would number two events alike (the second then fails on the
 * unique sequence after its change is already made) or overwrite each other's edit.
 */
const identityLock = new KeyedMutex();

async function createManagedAccountImpl(
  actor: Actor,
  input: { email?: unknown; name?: unknown; institution?: unknown },
): Promise<{ account: AccountSummary; temporaryPassword: string }> {
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) throw Errors.validation('A valid email is required.');
  if ([...directory().values()].some((a) => a.email === email)) throw Errors.conflict('An account with that email already exists.');
  const name = String(input.name ?? '').trim().slice(0, 120);
  if (name.length < 2) throw Errors.validation('A name is required.');
  const temporaryPassword = crypto.randomBytes(12).toString('base64url');
  const account: AccountRecord = {
    id: accountId(email),
    email,
    name,
    institution: String(input.institution ?? '').trim().slice(0, 160) || 'Authorized Trade Desk',
    role: null,
    assignedCustomerRefs: [],
    passwordHash: hashPassword(temporaryPassword),
    source: 'MANAGED',
    status: 'ACTIVE',
    sessionVersion: 1,
    createdAt: new Date().toISOString(),
    createdBy: actor.id,
  };
  directory().set(account.id, account);
  await persistAccount(account);
  await record(actor, 'ACCOUNT_CREATED', account.id, { email, name, role: null });
  return { account: listAccounts().find((a) => a.id === account.id)!, temporaryPassword };
}

/** Request a role or scope change. Applies only after a different administrator approves it. */
async function requestAccessChangeImpl(
  actor: Actor,
  input: { targetUserId?: unknown; role?: unknown; assignedCustomerRefs?: unknown; customerRef?: unknown; reason?: unknown },
): Promise<AccessRequest> {
  const target = requireAccount(String(input.targetUserId ?? ''));
  if (target.id === actor.id) throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'You cannot request a change to your own access.' });
  if (target.source !== 'MANAGED') {
    throw Errors.validation(`${target.email} is a ${target.source.toLowerCase()} account; its role is defined by configuration. Disable it here, or change AUTH_USERS.`);
  }
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 10) throw Errors.validation('A reason of at least 10 characters is required.');
  const change: AccessRequest['change'] = {};
  if (input.role !== undefined) {
    if (input.role === null) change.role = null;
    else if (!isRoleId(input.role) || !ROLE_DEFINITIONS[input.role].assignable) throw Errors.validation('That role does not exist or cannot be assigned to a person.');
    else change.role = input.role;
  }
  if (input.assignedCustomerRefs !== undefined) {
    if (!Array.isArray(input.assignedCustomerRefs) || !input.assignedCustomerRefs.every((r) => typeof r === 'string' && /^[A-Za-z0-9._-]{3,64}$/.test(r))) {
      throw Errors.validation('assignedCustomerRefs must be a list of customer references.');
    }
    change.assignedCustomerRefs = [...new Set(input.assignedCustomerRefs as string[])];
  }
  if (input.customerRef !== undefined) {
    if (input.customerRef !== null && (typeof input.customerRef !== 'string' || !/^[A-Za-z0-9._-]{3,64}$/.test(input.customerRef))) {
      throw Errors.validation('customerRef must be a customer reference.');
    }
    change.customerRef = input.customerRef as string | null;
  }
  if (Object.keys(change).length === 0) throw Errors.validation('Nothing to change.');
  if ([...requests.values()].some((r) => r.targetUserId === target.id && r.status === 'PENDING')) {
    throw Errors.conflict('This account already has a pending access request.');
  }
  const request: AccessRequest = {
    requestId: `AR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    targetUserId: target.id,
    change,
    reason,
    requestedBy: actor,
    requestedAt: new Date().toISOString(),
    status: 'PENDING',
    decidedBy: null,
    decidedAt: null,
    rationale: '',
  };
  requests.set(request.requestId, request);
  await persistence?.saveRequest(request);
  await record(actor, 'ACCESS_CHANGE_REQUESTED', target.id, { requestId: request.requestId, change, reason });
  return request;
}

/** The second administrator's decision. Approval applies the change and ends the account's sessions. */
async function decideAccessChangeImpl(actor: Actor, requestId: string, input: { approve?: unknown; rationale?: unknown }): Promise<AccessRequest> {
  const request = requests.get(requestId);
  if (!request) throw Errors.notFound('access request');
  if (request.status !== 'PENDING') throw Errors.conflict('This request has already been decided.');
  if (request.requestedBy.id === actor.id) throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'Dual control: the requester cannot approve their own request.' });
  if (request.targetUserId === actor.id) throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'You cannot decide a change to your own access.' });
  const rationale = String(input.rationale ?? '').trim();
  if (rationale.length < 10) throw Errors.validation('A rationale of at least 10 characters is required.');
  const target = requireAccount(request.targetUserId);
  request.status = input.approve === true ? 'APPROVED' : 'REJECTED';
  request.decidedBy = actor;
  request.decidedAt = new Date().toISOString();
  request.rationale = rationale;
  if (request.status === 'APPROVED') {
    const before = { role: target.role, assignedCustomerRefs: target.assignedCustomerRefs, customerRef: target.customerRef ?? null };
    if (request.change.role !== undefined) target.role = request.change.role;
    if (request.change.assignedCustomerRefs !== undefined) target.assignedCustomerRefs = request.change.assignedCustomerRefs;
    if (request.change.customerRef !== undefined) {
      if (request.change.customerRef === null) delete target.customerRef;
      else target.customerRef = request.change.customerRef;
    }
    target.sessionVersion += 1;
    await persistAccount(target);
    await record(actor, 'ACCESS_CHANGE_APPROVED', target.id, { requestId, before, after: request.change, rationale, sessionVersion: target.sessionVersion });
  } else {
    await record(actor, 'ACCESS_CHANGE_REJECTED', target.id, { requestId, rationale });
  }
  await persistence?.saveRequest(request);
  return request;
}

async function setAccountStatusImpl(actor: Actor, userId: string, input: { status?: unknown; reason?: unknown }): Promise<AccountSummary> {
  const target = requireAccount(userId);
  if (target.id === actor.id) throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'You cannot change the status of your own account.' });
  const status = String(input.status ?? '');
  if (status !== 'ACTIVE' && status !== 'DISABLED') throw Errors.validation('status must be ACTIVE or DISABLED.');
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 10) throw Errors.validation('A reason of at least 10 characters is required.');
  target.status = status;
  target.sessionVersion += 1;
  await persistAccount(target);
  await record(actor, status === 'DISABLED' ? 'ACCOUNT_DISABLED' : 'ACCOUNT_ENABLED', target.id, { reason, sessionVersion: target.sessionVersion });
  return listAccounts().find((a) => a.id === target.id)!;
}

async function revokeSessionsImpl(actor: Actor, userId: string, reason: unknown): Promise<AccountSummary> {
  const target = requireAccount(userId);
  const why = String(reason ?? '').trim();
  if (why.length < 10) throw Errors.validation('A reason of at least 10 characters is required.');
  target.sessionVersion += 1;
  await persistAccount(target);
  await record(actor, 'SESSIONS_REVOKED', target.id, { reason: why, sessionVersion: target.sessionVersion });
  return listAccounts().find((a) => a.id === target.id)!;
}

export const createManagedAccount = (...args: Parameters<typeof createManagedAccountImpl>): ReturnType<typeof createManagedAccountImpl> =>
  identityLock.run('identity', () => createManagedAccountImpl(...args));
export const requestAccessChange = (...args: Parameters<typeof requestAccessChangeImpl>): ReturnType<typeof requestAccessChangeImpl> =>
  identityLock.run('identity', () => requestAccessChangeImpl(...args));
export const decideAccessChange = (...args: Parameters<typeof decideAccessChangeImpl>): ReturnType<typeof decideAccessChangeImpl> =>
  identityLock.run('identity', () => decideAccessChangeImpl(...args));
export const setAccountStatus = (...args: Parameters<typeof setAccountStatusImpl>): ReturnType<typeof setAccountStatusImpl> =>
  identityLock.run('identity', () => setAccountStatusImpl(...args));
export const revokeSessions = (...args: Parameters<typeof revokeSessionsImpl>): ReturnType<typeof revokeSessionsImpl> =>
  identityLock.run('identity', () => revokeSessionsImpl(...args));
