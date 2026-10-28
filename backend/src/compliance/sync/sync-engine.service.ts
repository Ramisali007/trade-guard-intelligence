import crypto from 'node:crypto';
import {
  ComplianceStore,
  type ComplianceEntityRecord,
  type CompliancePortRecord,
  type CompliancePriceBenchmarkRecord,
  type ComplianceSourceRecord,
  type ComplianceSyncRunRecord,
} from '../db/compliance-store';
import { getConnector, type FeedBenchmarkUpdate, type FeedEntity, type FeedFxRate, type FeedPort } from './feed-connectors';
import { SANCTIONED_JURISDICTIONS } from '../sanctions/jurisdictions.data';
import { normalizeName } from '../sanctions/name-matching';
import { createLogger } from '../../utils/logger';

const log = createLogger('sync-engine');

/**
 * The most a published list may shrink between two downloads before the new one is held back. Real
 * delistings are a handful of entries; a drop of a fifth is a truncated download or a parser that has
 * stopped understanding the format, and applying it would quietly delist parties that are still listed.
 */
const MAX_SHRINK_FRACTION = 0.2;

export interface SyncOptions {
  triggerType?: 'SCHEDULED' | 'MANUAL' | 'STARTUP_SEED';
  actor?: string;
  force?: boolean;
}

/** A background "synchronise every source" run: running or finished, with each source's recorded outcome. */
export interface SyncBatchStatus {
  state: 'RUNNING' | 'FINISHED';
  startedAt: string;
  finishedAt: string | null;
  actor: string | null;
  runs: ComplianceSyncRunRecord[];
  /** Set only when the batch itself failed; a failing source is reported in `runs`, not here. */
  error: string | null;
}

interface ApplyStats {
  inserted: number;
  updated: number;
  unchanged: number;
  deactivated: number;
}

/**
 * Keeps the local compliance store in step with the publishers that have a connector
 * (see `feed-connectors.ts`).
 *
 * One run: download → checksum (skip if identical) → depletion guard → bitemporal apply.
 *
 * The apply step is SCD Type-2 keyed on the publisher's own identifier: a changed record closes
 * its old version and opens a new one; a record that disappears from the feed is delisted
 * (`validTo` = today) rather than deleted, so a transaction dated before the delisting still
 * screens as listed. Sources with no connector are reported as not connected — never as synced.
 */
export class ComplianceSyncEngine {
  private static instance: ComplianceSyncEngine;
  private readonly store = ComplianceStore.getInstance();
  private readonly activeSyncs = new Set<string>();
  private batch: SyncBatchStatus | null = null;

  private constructor() {}

  public static getInstance(): ComplianceSyncEngine {
    if (!ComplianceSyncEngine.instance) {
      ComplianceSyncEngine.instance = new ComplianceSyncEngine();
    }
    return ComplianceSyncEngine.instance;
  }

  public async syncSource(sourceId: string, options: SyncOptions = {}): Promise<ComplianceSyncRunRecord> {
    await this.store.init();
    const source = await this.store.getSourceById(sourceId);
    if (!source) {
      throw new Error(`Source "${sourceId}" is not registered in the Source Registry`);
    }

    const triggerType = options.triggerType || 'SCHEDULED';
    const actor = options.actor || 'SYSTEM';
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const syncRunId = `SYNC-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const baseRun = (): ComplianceSyncRunRecord => ({
      syncRunId,
      sourceId,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      triggerType,
      actor,
      status: 'SUCCESS',
      recordsFetched: 0,
      recordsInserted: 0,
      recordsUpdated: 0,
      recordsUnchanged: 0,
      recordsDeactivated: 0,
      duplicateCandidatesDetected: 0,
      payloadChecksumSha256: source.checksumSha256,
      validationDetails: { passed: true, anomalyDetected: false },
    });

    if (this.activeSyncs.has(sourceId)) {
      log.warn('Sync already in progress for source, skipping duplicate invocation', { sourceId });
      return { ...baseRun(), status: 'SKIPPED_NOT_MODIFIED', errorMessage: 'Sync already running for this source' };
    }

    const connector = getConnector(sourceId);
    if (!connector) {
      const note =
        source.dataOrigin === 'MANUAL_IMPORT'
          ? 'No live connector; records are maintained through manual import.'
          : 'No live connector for this publisher. Records are bundled samples or manual imports (/import).';
      source.syncStatus = 'IDLE';
      source.lastAttemptedSync = startedAt;
      source.lastSyncNote = note;
      source.nextScheduledSyncAt = this.calculateNextSyncTime(source.updateFrequency);
      await this.store.saveSource(source);
      const run = { ...baseRun(), status: 'NOT_CONNECTED' as const, errorMessage: note };
      await this.store.recordSyncRun(run);
      return run;
    }

    this.activeSyncs.add(sourceId);
    log.info('Starting external data source synchronization', { sourceId, triggerType, actor, endpoint: connector.endpoint });

    source.syncStatus = 'RUNNING';
    source.lastAttemptedSync = startedAt;
    await this.store.saveSource(source);

    try {
      const fetched = await connector.fetch();
      const payload: unknown[] =
        fetched.kind === 'SANCTIONS' ? fetched.entities
          : fetched.kind === 'FX_RATES' ? fetched.rates
            : fetched.kind === 'PORTS' ? fetched.ports
              : fetched.updates;
      const payloadChecksum = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const wasLive = source.dataOrigin === 'LIVE_FEED';

      await this.store.saveRawSnapshot({
        snapshotId: `SNAP-${syncRunId}`,
        sourceId,
        syncRunId,
        fetchedAt: startedAt,
        contentHashSha256: payloadChecksum,
        recordCount: payload.length,
        // Raw payloads of full lists are large; the checksum and count are the audit evidence.
        rawPayload: { endpoint: fetched.endpoint, recordCount: payload.length },
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });

      if (payload.length === 0) {
        throw new Error(`${connector.endpoint} returned no records; refusing to treat an empty publication as a delisting.`);
      }

      if (!options.force && wasLive && payloadChecksum === source.checksumSha256) {
        const run = {
          ...baseRun(),
          status: 'SKIPPED_NOT_MODIFIED' as const,
          recordsFetched: payload.length,
          recordsUnchanged: payload.length,
          payloadChecksumSha256: payloadChecksum,
        };
        this.markSuccess(source, run.finishedAt, `Unchanged since last download (${payload.length.toLocaleString('en-US')} records).`);
        await this.store.saveSource(source);
        await this.store.recordSyncRun(run);
        return run;
      }

      // Depletion guard: a live list that suddenly shrinks by 80% is far more likely a truncated
      // download than a mass delisting. Hold the previous state and flag it.
      if (wasLive && source.recordCount > 20 && payload.length < source.recordCount * (1 - MAX_SHRINK_FRACTION)) {
        const warning = `Suspicious dataset depletion: previous ${source.recordCount} records, incoming ${payload.length} (drop > ${Math.round(MAX_SHRINK_FRACTION * 100)}%). Sync aborted to protect canonical state.`;
        log.error(warning, { sourceId });
        source.syncStatus = 'SUSPICIOUS';
        source.freshnessStatus = 'AGING';
        source.lastSyncNote = warning;
        source.nextScheduledSyncAt = this.calculateNextSyncTime(source.updateFrequency);
        await this.store.saveSource(source);
        const run = {
          ...baseRun(),
          status: 'SUSPICIOUS' as const,
          recordsFetched: payload.length,
          payloadChecksumSha256: payloadChecksum,
          validationDetails: { passed: false, anomalyDetected: true, anomalyReason: warning },
          errorMessage: warning,
        };
        await this.store.recordSyncRun(run);
        return run;
      }

      const stats =
        fetched.kind === 'SANCTIONS' ? await this.applySanctions(source, fetched.entities, wasLive)
          : fetched.kind === 'FX_RATES' ? await this.applyFxRates(fetched.rates, fetched.effectiveDate)
            : fetched.kind === 'PORTS' ? await this.applyPorts(fetched.ports)
              : await this.applyBenchmarks(fetched.updates);

      const finishedAt = new Date().toISOString();
      source.checksumSha256 = payloadChecksum;
      source.recordCount = payload.length;
      source.dataOrigin = 'LIVE_FEED';
      source.publishedAt =
        fetched.kind === 'SANCTIONS' ? fetched.publishedAt : fetched.kind === 'FX_RATES' ? fetched.effectiveDate : undefined;
      source.currentVersion = `${sourceId}-${finishedAt.slice(0, 10)}-${payloadChecksum.slice(0, 8)}`;
      const skippedNote =
        fetched.kind === 'PRICING' && fetched.skipped.length > 0
          ? ` ${fetched.skipped.length} benchmark(s) left unchanged: ${fetched.skipped.join('; ')}.`
          : '';
      this.markSuccess(
        source,
        finishedAt,
        `Downloaded ${payload.length.toLocaleString('en-US')} records from ${connector.endpoint}.${skippedNote}`,
      );
      await this.store.saveSource(source);

      const run: ComplianceSyncRunRecord = {
        ...baseRun(),
        finishedAt,
        durationMs: Date.now() - startTime,
        status: 'SUCCESS',
        recordsFetched: payload.length,
        recordsInserted: stats.inserted,
        recordsUpdated: stats.updated,
        recordsUnchanged: stats.unchanged,
        recordsDeactivated: stats.deactivated,
        payloadChecksumSha256: payloadChecksum,
      };
      await this.store.recordSyncRun(run);
      log.info('Synchronization completed', { sourceId, ...stats, durationMs: run.durationMs });
      return run;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Synchronization failed for source', { sourceId, error: message });
      source.syncStatus = 'FAILED';
      source.freshnessStatus = source.dataOrigin === 'LIVE_FEED' ? 'SYNC_FAILED' : 'UNKNOWN';
      source.lastSyncNote = `Last attempt failed: ${message}`;
      // Retry sooner than the normal cadence, but not in a tight loop.
      source.nextScheduledSyncAt = new Date(Date.now() + 30 * 60_000).toISOString();
      await this.store.saveSource(source);
      const run = {
        ...baseRun(),
        status: 'FAILED' as const,
        validationDetails: { passed: false, anomalyDetected: false },
        errorMessage: message,
      };
      await this.store.recordSyncRun(run);
      return run;
    } finally {
      this.activeSyncs.delete(sourceId);
    }
  }

  /**
   * Starts `syncAll` without making the caller wait for every download. One batch runs at a time: asking again while
   * one is running returns that batch. The outcome is read with `getBatchStatus`, so a caller never has to guess
   * whether the feeds were actually refreshed.
   */
  public startSyncAll(options: SyncOptions = {}): { started: boolean; batch: SyncBatchStatus } {
    if (this.batch?.state === 'RUNNING') return { started: false, batch: this.batch };
    const batch: SyncBatchStatus = { state: 'RUNNING', startedAt: new Date().toISOString(), finishedAt: null, actor: options.actor ?? null, runs: [], error: null };
    this.batch = batch;
    void this.syncAll(options)
      .then((runs) => {
        batch.runs = runs;
      })
      .catch((error: unknown) => {
        batch.error = error instanceof Error ? error.message : String(error);
        log.error('Batch sync failed', { error: batch.error });
      })
      .finally(() => {
        batch.state = 'FINISHED';
        batch.finishedAt = new Date().toISOString();
      });
    return { started: true, batch };
  }

  public getBatchStatus(): SyncBatchStatus | null {
    return this.batch;
  }

  public async syncAll(options: SyncOptions = {}): Promise<ComplianceSyncRunRecord[]> {
    await this.store.init();
    const sources = await this.store.getSources();
    const results: ComplianceSyncRunRecord[] = [];
    for (const source of sources) {
      if (!source.enabled || source.sourceId.startsWith('TEST_')) continue;
      try {
        results.push(await this.syncSource(source.sourceId, options));
      } catch (err) {
        log.error('Error syncing source in batch', { sourceId: source.sourceId, error: err });
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------------------------------------

  private async applySanctions(source: ComplianceSourceRecord, feed: FeedEntity[], wasLive: boolean): Promise<ApplyStats> {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const stats: ApplyStats = { inserted: 0, updated: 0, unchanged: 0, deactivated: 0 };
    const writes: ComplianceEntityRecord[] = [];

    // First live load: the bundled sample records for this list are replaced wholesale.
    if (!wasLive) {
      const samples = this.store.getEntitiesForSource(source.sourceId).map((e) => e.canonicalId);
      await this.store.deleteEntities(samples);
    }

    const current = new Map<string, ComplianceEntityRecord>();
    if (wasLive) {
      for (const e of this.store.getEntitiesForSource(source.sourceId)) {
        if (e.isCurrent) current.set(e.externalId, e);
      }
    }

    // A record first seen now, with no published date, can have been designated at any point since
    // the previous successful download — use that as the conservative start of validity.
    const firstObservedFrom = source.lastSuccessfulSync?.slice(0, 10) ?? today;
    const seen = new Set<string>();

    for (const item of feed) {
      if (seen.has(item.externalId)) continue;
      seen.add(item.externalId);
      const contentHash = hashEntity(item);
      const previous = current.get(item.externalId);

      if (previous && previous.contentHash === contentHash) {
        stats.unchanged++;
        continue;
      }

      let validFrom: string;
      let validFromBasis: ComplianceEntityRecord['validFromBasis'];
      if (item.listedOn) {
        validFrom = item.listedOn;
        validFromBasis = 'PUBLISHED';
      } else if (previous) {
        validFrom = previous.validFrom;
        validFromBasis = previous.validFromBasis;
      } else if (!wasLive) {
        validFrom = '1900-01-01';
        validFromBasis = 'UNKNOWN_ASSUMED_PRIOR';
      } else {
        validFrom = firstObservedFrom;
        validFromBasis = 'FIRST_OBSERVED';
      }

      const version = (previous?.version ?? 0) + 1;
      if (previous) {
        writes.push({ ...previous, isCurrent: false, effectiveTo: now });
        stats.updated++;
      } else {
        stats.inserted++;
      }
      writes.push(toEntityRecord(source.sourceId, item, { version, validFrom, validFromBasis, now, contentHash }));
    }

    // Present last time, absent now: delisted today. Kept (not deleted) for historical screening.
    for (const [externalId, previous] of current) {
      if (seen.has(externalId)) continue;
      writes.push({ ...previous, isCurrent: false, validTo: today, effectiveTo: now });
      stats.deactivated++;
    }

    if (writes.length > 0) await this.store.saveEntities(writes);
    return stats;
  }

  private async applyFxRates(rates: FeedFxRate[], effectiveDate: string): Promise<ApplyStats> {
    const syncedAt = new Date().toISOString();
    await this.store.saveFxRates(
      rates.map((rate) => ({
        currencyCode: rate.currencyCode,
        rateToUsd: rate.rateToUsd,
        effectiveDate,
        source: 'open.er-api.com',
        isCurrent: true,
        syncedAt,
      })),
    );
    return { inserted: rates.length, updated: 0, unchanged: 0, deactivated: 0 };
  }

  /** Upsert seaports by UN/LOCODE, keeping aliases and risk annotations already recorded for a port. */
  private async applyPorts(ports: FeedPort[]): Promise<ApplyStats> {
    const existing = new Map((await this.store.getAllPorts()).map((p) => [p.locode, p]));
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    const sanctioned = new Map(SANCTIONED_JURISDICTIONS.map((j) => [j.countryCode.toUpperCase(), j]));
    const stats: ApplyStats = { inserted: 0, updated: 0, unchanged: 0, deactivated: 0 };

    const records: CompliancePortRecord[] = ports.map((p) => {
      const prior = existing.get(p.locode);
      const jurisdiction = sanctioned.get(p.countryCode);
      const record: CompliancePortRecord = {
        locode: p.locode,
        name: p.name,
        normalizedName: p.name.toLowerCase(),
        country: names.of(p.countryCode) ?? p.countryCode,
        countryCode: p.countryCode,
        latitude: p.latitude,
        longitude: p.longitude,
        aliases: prior?.aliases ?? [],
        isSanctionedJurisdiction: prior?.isSanctionedJurisdiction ?? Boolean(jurisdiction && jurisdiction.sanctionsStatus === 'COMPREHENSIVE_SANCTIONED'),
        riskScore: prior?.riskScore ?? jurisdiction?.riskScore ?? 10,
      };
      if (!prior) stats.inserted++;
      else if (prior.name !== record.name || prior.latitude !== record.latitude || prior.longitude !== record.longitude) stats.updated++;
      else stats.unchanged++;
      return record;
    });

    await this.store.savePorts(records);
    return stats;
  }

  /** Replace benchmark corridors with the latest published export unit values. */
  private async applyBenchmarks(updates: FeedBenchmarkUpdate[]): Promise<ApplyStats> {
    const current = new Map((await this.store.getAllPriceBenchmarks()).map((b) => [b.benchmarkId, b]));
    const today = new Date().toISOString().slice(0, 10);
    const records: CompliancePriceBenchmarkRecord[] = [];
    for (const u of updates) {
      const b = current.get(u.benchmarkId);
      if (!b) continue;
      records.push({
        ...b,
        sourceId: 'UN_COMTRADE_PRICING',
        benchmarkUnitPriceUsd: u.medianUsd,
        observedLowUsd: u.lowUsd,
        observedMedianUsd: u.medianUsd,
        observedHighUsd: u.highUsd,
        sampleCount: u.sampleCount,
        confidenceLevel: u.sampleCount >= 4 ? 'HIGH' : 'MODERATE',
        effectiveFrom: today,
        version: (b.version ?? 1) + 1,
      });
    }
    await this.store.savePriceBenchmarks(records);
    return { inserted: 0, updated: records.length, unchanged: current.size - records.length, deactivated: 0 };
  }

  private markSuccess(source: ComplianceSourceRecord, finishedAt: string, note: string): void {
    source.syncStatus = 'SUCCESS';
    source.freshnessStatus = 'FRESH';
    source.lastSuccessfulSync = finishedAt;
    source.lastSyncNote = note;
    source.nextScheduledSyncAt = this.calculateNextSyncTime(source.updateFrequency);
  }

  private calculateNextSyncTime(frequency: ComplianceSourceRecord['updateFrequency']): string {
    const hour = 3_600_000;
    const offsets: Record<ComplianceSourceRecord['updateFrequency'], number> = {
      HOURLY: hour,
      EVERY_4_HOURS: 4 * hour,
      DAILY: 24 * hour,
      WEEKLY: 7 * 24 * hour,
      MONTHLY: 30 * 24 * hour,
    };
    return new Date(Date.now() + (offsets[frequency] ?? 24 * hour)).toISOString();
  }
}

function hashEntity(item: FeedEntity): string {
  const canonical = {
    t: item.entityType,
    n: item.name,
    a: [...item.aliases].sort(),
    c: item.country,
    p: [...item.programs].sort(),
    i: item.identifiers,
    l: item.listedOn ?? null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

const COUNTRY_CODES: Record<string, string> = {
  iran: 'IR', russia: 'RU', 'north korea': 'KP', syria: 'SY', cuba: 'CU', venezuela: 'VE', belarus: 'BY',
  china: 'CN', 'united arab emirates': 'AE', pakistan: 'PK', afghanistan: 'AF', iraq: 'IQ', lebanon: 'LB',
  yemen: 'YE', libya: 'LY', sudan: 'SD', somalia: 'SO', myanmar: 'MM', turkey: 'TR', india: 'IN',
};

function toEntityRecord(
  sourceId: string,
  item: FeedEntity,
  meta: {
    version: number;
    validFrom: string;
    validFromBasis: ComplianceEntityRecord['validFromBasis'];
    now: string;
    contentHash: string;
  },
): ComplianceEntityRecord {
  return {
    canonicalId: `${sourceId}:${item.externalId}:v${meta.version}`,
    sourceId,
    externalId: item.externalId,
    entityType: item.entityType,
    canonicalName: item.name,
    normalizedName: normalizeName(item.name),
    aliases: item.aliases,
    normalizedAliases: item.aliases.map(normalizeName).filter(Boolean),
    country: item.country,
    countryCode: COUNTRY_CODES[item.country.toLowerCase()],
    programs: item.programs,
    identifiers: {
      ...(item.identifiers.imoNumber ? { imoNumber: item.identifiers.imoNumber } : {}),
      ...(item.identifiers.swiftBic ? { swiftBic: item.identifiers.swiftBic } : {}),
    },
    validFrom: meta.validFrom,
    validFromBasis: meta.validFromBasis,
    validTo: null,
    observedAt: meta.now,
    effectiveFrom: meta.now,
    effectiveTo: null,
    isCurrent: true,
    version: meta.version,
    contentHash: meta.contentHash,
    remarks: item.remarks,
  };
}
