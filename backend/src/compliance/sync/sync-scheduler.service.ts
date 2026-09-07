import { ComplianceSyncEngine } from './sync-engine.service';
import { ComplianceStore } from '../db/compliance-store';
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
  public async syncNow(sourceId: string, actor = 'OPERATOR'): Promise<any> {
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

export const syncScheduler = ComplianceSyncScheduler.getInstance();
