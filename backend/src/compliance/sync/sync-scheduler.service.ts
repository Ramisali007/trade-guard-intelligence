import { ComplianceSyncEngine } from './sync-engine.service';
import { ComplianceStore, type ComplianceSourceRecord } from '../db/compliance-store';
import { createLogger } from '../../utils/logger';

const log = createLogger('sync-scheduler');

export class ComplianceSyncScheduler {
  private static instance: ComplianceSyncScheduler;
  private readonly syncEngine = ComplianceSyncEngine.getInstance();
  private readonly store = ComplianceStore.getInstance();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private constructor() {}

  public static getInstance(): ComplianceSyncScheduler {
    if (!ComplianceSyncScheduler.instance) {
      ComplianceSyncScheduler.instance = new ComplianceSyncScheduler();
    }
    return ComplianceSyncScheduler.instance;
  }

  /**
   * Start the asynchronous background scheduler.
   * Periodically checks registered sources and triggers updates when due.
   */
  public start(intervalMinutes = 5): void {
    if (this.timer) return;
    const intervalMs = intervalMinutes * 60 * 1000;

    log.info('Starting Compliance Synchronization Scheduler', { checkIntervalMinutes: intervalMinutes });

    // Initial check after 10 seconds to allow complete bootstrap
    setTimeout(() => void this.tick(), 10_000).unref();

    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('Compliance Synchronization Scheduler stopped');
    }
  }

  /**
   * Trigger a manual synchronization on a specific source immediately.
   */
  public async syncNow(sourceId: string, actor = 'OPERATOR') {
    return this.syncEngine.syncSource(sourceId, {
      triggerType: 'MANUAL',
      actor,
      force: true,
    });
  }

  /**
   * Scheduled tick: sweeps all sources and triggers sync for any whose nextScheduledSyncAt is in the past.
   */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      await this.store.init();
      const sources = await this.store.getSources();
      const now = new Date().toISOString();

      for (const source of sources) {
        if (!source.enabled) continue;

        // Freshness is a function of time since the last successful download, so it is recomputed
        // on every sweep; without this a feed that silently stopped updating would read FRESH forever.
        if (source.dataOrigin === 'LIVE_FEED' && source.lastSuccessfulSync && source.syncStatus !== 'RUNNING') {
          const freshness = freshnessOf(source);
          if (source.freshnessStatus !== freshness && source.freshnessStatus !== 'SYNC_FAILED') {
            source.freshnessStatus = freshness;
            await this.store.saveSource(source);
          }
        }

        // Check if scheduled time reached or source is flagged stale
        if (source.nextScheduledSyncAt <= now || source.freshnessStatus === 'STALE') {
          log.info('Source due for scheduled synchronization', {
            sourceId: source.sourceId,
            sourceName: source.sourceName,
            nextScheduled: source.nextScheduledSyncAt,
          });

          void this.syncEngine
            .syncSource(source.sourceId, {
              triggerType: 'SCHEDULED',
              actor: 'SYSTEM_SCHEDULER',
            })
            .catch((err) => {
              log.error('Scheduled sync execution error', { sourceId: source.sourceId, error: err });
            });
        }
      }
    } catch (err) {
      log.warn('Scheduled sync sweep encountered an issue', { error: err });
    } finally {
      this.running = false;
    }
  }
}

/** Minutes between scheduled syncs for each cadence (the same offsets the sync engine schedules with). */
const CADENCE_MINUTES: Record<ComplianceSourceRecord['updateFrequency'], number> = {
  HOURLY: 60,
  EVERY_4_HOURS: 240,
  DAILY: 24 * 60,
  WEEKLY: 7 * 24 * 60,
  MONTHLY: 30 * 24 * 60,
};

/**
 * How current a live feed is, judged against how often it is *supposed* to update.
 *
 * A feed that syncs every 24 h is fresh for the whole of that day, not for half of it: it is FRESH
 * until its next sync is due (10% grace), AGING once that sync is overdue, and STALE after twice the
 * cadence (or the source's own staleAfterMinutes if that is longer).
 */
export function freshnessOf(source: ComplianceSourceRecord, now = Date.now()): 'FRESH' | 'AGING' | 'STALE' {
  const cadence = CADENCE_MINUTES[source.updateFrequency] ?? CADENCE_MINUTES.DAILY;
  const ageMinutes = (now - new Date(source.lastSuccessfulSync as string).getTime()) / 60_000;
  const staleAfter = Math.max(source.staleAfterMinutes, cadence * 2);
  if (ageMinutes > staleAfter) return 'STALE';
  if (ageMinutes > cadence * 1.1) return 'AGING';
  return 'FRESH';
}

export const syncScheduler = ComplianceSyncScheduler.getInstance();
