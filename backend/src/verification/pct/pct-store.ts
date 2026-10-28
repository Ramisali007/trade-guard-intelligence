import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config';
import { hasPermission } from '../../authorization/permissions';
import type { AuthenticatedUser } from '../../middleware/auth.middleware';
import { AppError, Errors } from '../../utils/errors';
import { DebouncedSnapshot, readJsonIfPresent } from '../../utils/json-snapshot';
import { createLogger } from '../../utils/logger';
import { VerificationGovernance, type GovernanceActor } from '../governance';
import type { SourceHealth } from '../verification.types';
import { lineInForce, parsePctCsv, type PctLine } from './pct-dataset';

const log = createLogger('pct-store');

export const PCT_SOURCE_ID = 'PAKISTAN-CUSTOMS-TARIFF';

export interface PctDatasetMeta {
  datasetId: string;
  /** The label the publisher or the bank gives this edition (for example "Finance Act 2026, July 2026"). */
  version: string;
  publisher: string;
  /** Where the bank got it: the FBR publication, a notification number, an internal export. */
  sourceReference: string;
  publicationDate: string | null;
  /** The bank's statement that it may use this copy for this purpose. Recorded, not interpreted. */
  licenceNote: string;
  origin: 'BANK_SUPPLIED' | 'SYNTHETIC_TEST';
  /** FULL_TARIFF: absence of a line is meaningful. EXTRACT: only part of the tariff, so absence proves nothing. The submitter states which. */
  scope: 'FULL_TARIFF' | 'EXTRACT';
  /** SHA-256 of the submitted file. Re-checked every time the dataset is loaded. */
  contentHash: string;
  ingestedAt: string;
  ingestedBy: GovernanceActor;
  lineCount: number;
  coverageFrom: string;
  coverageTo: string | null;
}

export type PctDatasetStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RETIRED';

export interface PctDatasetView extends PctDatasetMeta {
  status: PctDatasetStatus;
  decidedBy: GovernanceActor | null;
  decidedAt: string | null;
  rationale: string;
}

export type PctLookup =
  | { available: false; reason: string }
  | { available: true; dataset: PctDatasetView; outcome: 'FOUND'; line: PctLine }
  | { available: true; dataset: PctDatasetView; outcome: 'NOT_FOUND' }
  | { available: true; dataset: PctDatasetView; outcome: 'NOT_IN_FORCE' };

const forbidden = (message: string): AppError => new AppError({ status: 403, code: 'FORBIDDEN', message });
const actorOf = (user: AuthenticatedUser): GovernanceActor => ({ id: user.id, name: user.name, role: user.role });
const dir = (): string => path.join(config.upload.dataDir, 'reference', 'pct');

export class PctStore {
  private static instance: PctStore;
  private readonly metas = new Map<string, PctDatasetMeta>();
  private readonly lineCache = new Map<string, PctLine[]>();
  /** Datasets installed by a test: approved without a governance decision, and labelled synthetic. */
  private readonly forcedApproved = new Set<string>();
  private readonly memoryFiles = new Map<string, string>();
  private snapshot: DebouncedSnapshot | null = null;
  private integrityError: string | null = null;

  static getInstance(): PctStore {
    if (!PctStore.instance) PctStore.instance = new PctStore();
    return PctStore.instance;
  }

  resetForTesting(): void {
    this.metas.clear();
    this.lineCache.clear();
    this.forcedApproved.clear();
    this.memoryFiles.clear();
    this.snapshot = null;
    this.integrityError = null;
  }

  async init(): Promise<void> {
    if (!config.storage.persistToDisk) return;
    try {
      for (const meta of (await readJsonIfPresent<PctDatasetMeta[]>(path.join(dir(), 'index.json'))) ?? []) this.metas.set(meta.datasetId, meta);
    } catch (error) {
      log.error('the tariff dataset index could not be read', { error: String(error) });
    }
    this.snapshot = new DebouncedSnapshot(path.join(dir(), 'index.json'), () => [...this.metas.values()], 250);
  }

  async flush(): Promise<void> {
    await this.snapshot?.flush();
  }

  private status(datasetId: string): { status: PctDatasetStatus; decidedBy: GovernanceActor | null; decidedAt: string | null; rationale: string } {
    if (this.forcedApproved.has(datasetId)) return { status: 'APPROVED', decidedBy: null, decidedAt: null, rationale: 'Installed by a test; not a bank decision.' };
    const governance = VerificationGovernance.getInstance();
    const events = governance.datasetEvents(datasetId); // newest first
    const last = events[0];
    if (!last) return { status: 'SUBMITTED', decidedBy: null, decidedAt: null, rationale: '' };
    const status: PctDatasetStatus = last.event === 'DATASET_APPROVED' ? 'APPROVED' : last.event === 'DATASET_REJECTED' ? 'REJECTED' : last.event === 'DATASET_RETIRED' ? 'RETIRED' : 'SUBMITTED';
    // A log that may have been altered approves nothing.
    const honoured = status === 'APPROVED' && !governance.datasetIntegrityValid() ? 'SUBMITTED' : status;
    return { status: honoured, decidedBy: honoured === status && status !== 'SUBMITTED' ? last.by : null, decidedAt: status !== 'SUBMITTED' ? last.at : null, rationale: last.rationale };
  }

  private view(meta: PctDatasetMeta): PctDatasetView {
    return { ...meta, ...this.status(meta.datasetId) };
  }

  list(): PctDatasetView[] {
    return [...this.metas.values()].map((m) => this.view(m)).sort((a, b) => (a.ingestedAt < b.ingestedAt ? 1 : -1));
  }

  // ------------------------------------------------------------------ the workflow

  submit(
    user: AuthenticatedUser,
    input: { csv: unknown; version: unknown; publisher: unknown; sourceReference: unknown; publicationDate?: unknown; scope?: unknown; licenceNote: unknown; licenceConfirmed: unknown },
  ): PctDatasetView {
    if (!hasPermission(user, 'verification.reference.submit')) throw forbidden('You do not have permission to submit a reference dataset.');
    const text = (value: unknown, label: string, min: number, max = 300): string => {
      const s = typeof value === 'string' ? value.trim() : '';
      if (s.length < min) throw Errors.validation(`${label} is required${min > 1 ? ` (at least ${min} characters)` : ''}.`);
      return s.slice(0, max);
    };
    const version = text(input.version, 'The dataset version', 2, 80);
    const publisher = text(input.publisher, 'The publisher', 3, 120);
    const sourceReference = text(input.sourceReference, 'The source reference (publication or notification)', 5);
    const licenceNote = text(input.licenceNote, 'The licence or permission note', 10, 500);
    if (input.licenceConfirmed !== true) throw Errors.validation('Confirm that the bank may use this copy of the tariff for this purpose.');
    const publicationDate = typeof input.publicationDate === 'string' && input.publicationDate.trim() ? input.publicationDate.trim() : null;
    if (publicationDate && !/^\d{4}-\d{2}-\d{2}$/.test(publicationDate)) throw Errors.validation('The publication date must be YYYY-MM-DD.');
    if (input.scope !== 'FULL_TARIFF' && input.scope !== 'EXTRACT') throw Errors.validation('State whether the file is the FULL_TARIFF or an EXTRACT of it.');
    const csv = typeof input.csv === 'string' ? input.csv : '';
    const { lines, errors } = parsePctCsv(csv);
    if (errors.length > 0) throw Errors.validation(`The file was not accepted: ${errors.slice(0, 5).map((e) => (e.row ? `row ${e.row}: ${e.message}` : e.message)).join(' | ')}${errors.length > 5 ? ` (and ${errors.length - 5} more)` : ''}`);

    const contentHash = crypto.createHash('sha256').update(csv, 'utf8').digest('hex');
    if ([...this.metas.values()].some((m) => m.contentHash === contentHash)) throw Errors.conflict('This exact file has already been submitted.');
    const from = lines.map((l) => l.effectiveFrom).sort()[0]!;
    const open = lines.some((l) => !l.effectiveTo);
    const to = open ? null : lines.map((l) => l.effectiveTo!).sort().pop() ?? null;
    const meta: PctDatasetMeta = {
      datasetId: `PCT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${contentHash.slice(0, 8)}`,
      version,
      publisher,
      sourceReference,
      publicationDate,
      licenceNote,
      origin: 'BANK_SUPPLIED',
      scope: input.scope,
      contentHash,
      ingestedAt: new Date().toISOString(),
      ingestedBy: actorOf(user),
      lineCount: lines.length,
      coverageFrom: from,
      coverageTo: to,
    };
    this.store(meta, csv, lines);
    VerificationGovernance.getInstance().recordDatasetEvent('DATASET_SUBMITTED', meta.datasetId, actorOf(user), `Submitted ${version}: ${lines.length} lines (${sourceReference})`, { contentHash, lineCount: lines.length });
    return this.view(meta);
  }

  private store(meta: PctDatasetMeta, csv: string, lines: PctLine[]): void {
    this.metas.set(meta.datasetId, meta);
    this.lineCache.set(meta.datasetId, lines);
    this.memoryFiles.set(meta.datasetId, csv);
    if (config.storage.persistToDisk) {
      try {
        fs.mkdirSync(dir(), { recursive: true });
        fs.writeFileSync(path.join(dir(), `${meta.datasetId}.csv`), csv);
      } catch (error) {
        log.error('the tariff dataset file could not be written', { error: String(error) });
      }
    }
    this.snapshot?.markDirty();
  }

  decide(user: AuthenticatedUser, datasetId: string, approve: unknown, rationale: unknown): PctDatasetView {
    if (!hasPermission(user, 'verification.reference.approve')) throw forbidden('You do not have permission to approve a reference dataset.');
    const meta = this.metas.get(datasetId);
    if (!meta) throw Errors.notFound('dataset');
    if (typeof approve !== 'boolean') throw Errors.validation('Say whether the dataset is approved: approve must be true or false.');
    const reason = typeof rationale === 'string' ? rationale.trim() : '';
    if (reason.length < 10) throw Errors.validation('A rationale of at least 10 characters is required.');
    if (this.status(datasetId).status !== 'SUBMITTED') throw Errors.conflict('Only a submitted dataset can be decided.');
    if (meta.ingestedBy.id === user.id) throw forbidden('Dual control: the person who submitted a dataset cannot approve it.');
    if (approve === true && !this.linesOf(meta)) throw Errors.conflict(`The stored file no longer matches its hash: ${this.integrityError ?? 'it cannot be read'}. It cannot be approved.`);
    VerificationGovernance.getInstance().recordDatasetEvent(approve === true ? 'DATASET_APPROVED' : 'DATASET_REJECTED', datasetId, actorOf(user), reason);
    return this.view(meta);
  }

  retire(user: AuthenticatedUser, datasetId: string, rationale: unknown): PctDatasetView {
    if (!hasPermission(user, 'verification.reference.approve')) throw forbidden('You do not have permission to retire a reference dataset.');
    const meta = this.metas.get(datasetId);
    if (!meta) throw Errors.notFound('dataset');
    const reason = typeof rationale === 'string' ? rationale.trim() : '';
    if (reason.length < 10) throw Errors.validation('A rationale of at least 10 characters is required.');
    if (this.status(datasetId).status !== 'APPROVED') throw Errors.conflict('Only an approved dataset can be retired.');
    // Retired datasets are kept: an assessment made against one must stay reproducible.
    VerificationGovernance.getInstance().recordDatasetEvent('DATASET_RETIRED', datasetId, actorOf(user), reason);
    return this.view(meta);
  }

  /** Tests install a synthetic, already approved dataset; it is labelled synthetic on every piece of evidence. */
  installForTesting(lines: PctLine[], over: Partial<PctDatasetMeta> = {}): PctDatasetView {
    const csv = `synthetic:${JSON.stringify(lines)}`;
    const meta: PctDatasetMeta = {
      datasetId: over.datasetId ?? `PCT-SYNTHETIC-${crypto.createHash('sha256').update(csv).digest('hex').slice(0, 8)}`,
      version: 'synthetic test dataset',
      publisher: 'Synthetic test fixture',
      sourceReference: 'none: invented for the automated tests',
      publicationDate: null,
      licenceNote: 'Synthetic data; not the Pakistan Customs Tariff.',
      origin: 'SYNTHETIC_TEST',
      scope: 'FULL_TARIFF',
      contentHash: crypto.createHash('sha256').update(csv, 'utf8').digest('hex'),
      ingestedAt: new Date().toISOString(),
      ingestedBy: { id: 'test', name: 'Test fixture', role: 'TEST' },
      lineCount: lines.length,
      coverageFrom: lines.map((l) => l.effectiveFrom).sort()[0] ?? '1900-01-01',
      coverageTo: null,
      ...over,
    };
    this.metas.set(meta.datasetId, meta);
    this.lineCache.set(meta.datasetId, lines);
    this.memoryFiles.set(meta.datasetId, csv);
    this.forcedApproved.add(meta.datasetId);
    return this.view(meta);
  }

  // ------------------------------------------------------------------ reading

  /** The dataset's lines, after checking the stored file still matches the hash recorded when it was submitted. */
  private linesOf(meta: PctDatasetMeta): PctLine[] | null {
    if (meta.origin === 'SYNTHETIC_TEST') return this.lineCache.get(meta.datasetId) ?? null;
    let csv = this.memoryFiles.get(meta.datasetId);
    if (csv === undefined && config.storage.persistToDisk) {
      try {
        csv = fs.readFileSync(path.join(dir(), `${meta.datasetId}.csv`), 'utf8');
      } catch {
        this.integrityError = `the file of ${meta.datasetId} is missing`;
        return null;
      }
    }
    if (csv === undefined) return null;
    if (crypto.createHash('sha256').update(csv, 'utf8').digest('hex') !== meta.contentHash) {
      this.integrityError = `the file of ${meta.datasetId} does not match the hash recorded when it was submitted`;
      log.error('a tariff dataset failed its integrity check and is not used', { datasetId: meta.datasetId });
      return null;
    }
    const cached = this.lineCache.get(meta.datasetId);
    if (cached) return cached;
    const parsed = parsePctCsv(csv);
    if (parsed.errors.length > 0) return null;
    this.lineCache.set(meta.datasetId, parsed.lines);
    return parsed.lines;
  }

  /** The approved dataset that covers a date; where several do, the most recently published wins. */
  activeFor(asOf: string): { dataset: PctDatasetView; lines: PctLine[] } | null {
    const day = asOf.slice(0, 10);
    const candidates = this.list()
      .filter((d) => d.status === 'APPROVED' && d.coverageFrom <= day && (!d.coverageTo || day <= d.coverageTo))
      .sort((a, b) => ((b.publicationDate ?? b.ingestedAt) > (a.publicationDate ?? a.ingestedAt) ? 1 : -1));
    for (const dataset of candidates) {
      const lines = this.linesOf(dataset);
      if (lines) return { dataset, lines };
    }
    return null;
  }

  lookup(pctCode: string, asOf: string): PctLookup {
    const active = this.activeFor(asOf);
    if (!active) {
      const approved = this.list().some((d) => d.status === 'APPROVED');
      return { available: false, reason: approved ? `No approved tariff dataset covers ${asOf.slice(0, 10)}.` : 'No approved Pakistan Customs Tariff dataset has been supplied.' };
    }
    const { line, anyVersion } = lineInForce(active.lines, pctCode, asOf);
    if (line) return { available: true, dataset: active.dataset, outcome: 'FOUND', line };
    return { available: true, dataset: active.dataset, outcome: anyVersion ? 'NOT_IN_FORCE' : 'NOT_FOUND' };
  }

  health(): SourceHealth {
    const approved = this.list().filter((d) => d.status === 'APPROVED');
    const newest = approved[0];
    if (!newest) {
      const waiting = this.list().some((d) => d.status === 'SUBMITTED');
      return { sourceId: PCT_SOURCE_ID, lastSuccessfulRetrievalAt: null, lastAttemptAt: null, lastError: waiting ? 'A dataset has been submitted and is waiting for approval.' : 'No approved dataset has been supplied by the bank.', recordCount: null, contentHash: null, state: 'NOT_LOADED', origin: null };
    }
    const usable = this.linesOf(newest) !== null;
    return {
      sourceId: PCT_SOURCE_ID,
      lastSuccessfulRetrievalAt: newest.ingestedAt,
      lastAttemptAt: newest.ingestedAt,
      lastError: usable ? null : this.integrityError,
      recordCount: newest.lineCount,
      contentHash: newest.contentHash,
      datasetVersion: newest.version,
      publishedOn: newest.publicationDate,
      state: usable ? 'CURRENT' : 'UNAVAILABLE',
      origin: newest.origin === 'SYNTHETIC_TEST' ? 'TEST_FIXTURE' : 'MANUAL_IMPORT',
    };
  }
}
