import { config } from '../config';
import { sleep } from '../utils/async';
import { createLogger } from '../utils/logger';

const log = createLogger('rate-limiter');

interface TokenUsageRecord {
  timestamp: number;
  tokens: number;
}

/**
 * Sliding 60-second window rate limiter for proactive TPM management.
 * Guarantees that AI requests do not exceed the provider's token-per-minute limit.
 */
export class TokenBucketRateLimiter {
  private readonly windowMs = 60_000;
  private readonly usageHistory: TokenUsageRecord[] = [];
  private tpmLimit: number;
  private safeThreshold: number;
  private cooldownUntil = 0;

  constructor(
    tpmLimit = config.processing.tpmLimit || 8000,
    safeThreshold = config.processing.tpmSafeThreshold || 6800,
  ) {
    this.tpmLimit = tpmLimit;
    this.safeThreshold = Math.min(safeThreshold, tpmLimit - 500);
  }

  /**
   * Update limits dynamically if configuration changes.
   */
  updateLimits(tpmLimit: number, safeThreshold: number): void {
    this.tpmLimit = tpmLimit;
    this.safeThreshold = Math.min(safeThreshold, tpmLimit - 500);
  }

  /**
   * Prunes entries older than the 60-second rolling window and returns current rolling TPM.
   */
  getRollingTPM(): number {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    // Prune expired records
    while (this.usageHistory.length > 0 && this.usageHistory[0]!.timestamp < cutoff) {
      this.usageHistory.shift();
    }

    return this.usageHistory.reduce((sum, item) => sum + item.tokens, 0);
  }

  /**
   * Proactively throttles and waits before a request is dispatched if the projected tokens
   * would exceed the safe TPM threshold.
   */
  async acquire(estimatedTokens: number): Promise<number> {
    while (true) {
      const now = Date.now();

      // Check external cooldown if a 429 was recently encountered
      if (now < this.cooldownUntil) {
        const waitMs = this.cooldownUntil - now + 500;
        log.info('active rate-limit cooldown pause', { waitMs, cooldownUntil: this.cooldownUntil });
        await sleep(waitMs);
        continue;
      }

      const currentRollingTPM = this.getRollingTPM();
      const projectedTPM = currentRollingTPM + estimatedTokens;

      if (projectedTPM <= this.safeThreshold || this.usageHistory.length === 0) {
        // Reserve estimated tokens tentatively in the history
        const record: TokenUsageRecord = { timestamp: Date.now(), tokens: estimatedTokens };
        this.usageHistory.push(record);
        return record.timestamp;
      }

      // Find the oldest record that, once expired, frees up enough tokens
      let cumulativeFreed = 0;
      let targetRecordTimestamp = this.usageHistory[0]?.timestamp ?? now;

      for (const record of this.usageHistory) {
        cumulativeFreed += record.tokens;
        targetRecordTimestamp = record.timestamp;
        if (projectedTPM - cumulativeFreed <= this.safeThreshold) {
          break;
        }
      }

      const requiredWaitMs = Math.max(1000, targetRecordTimestamp + this.windowMs - now + 500);

      log.info('proactive rate-limit pacing wait', {
        estimatedTokens,
        currentRollingTPM,
        projectedTPM,
        threshold: this.safeThreshold,
        limit: this.tpmLimit,
        waitMs: requiredWaitMs,
      });

      await sleep(requiredWaitMs);
    }
  }

  /**
   * Reconcile tentative estimated tokens with the actual tokens reported by the provider.
   */
  reconcile(reservedTimestamp: number, estimatedTokens: number, actualTokens?: number): void {
    const tokens = actualTokens && actualTokens > 0 ? actualTokens : estimatedTokens;
    const match = this.usageHistory.find((r) => r.timestamp === reservedTimestamp);
    if (match) {
      match.tokens = tokens;
    } else {
      this.usageHistory.push({ timestamp: reservedTimestamp, tokens });
    }
  }

  /**
   * When a 429 is encountered, set a mandatory cooldown and record usage to prevent immediate repeat.
   */
  recordRateLimit(retryAfterMs = 8000): void {
    const now = Date.now();
    this.cooldownUntil = Math.max(this.cooldownUntil, now + retryAfterMs);
    log.warn('provider 429 rate limit recorded, pausing requests', {
      cooldownUntil: this.cooldownUntil,
      retryAfterMs,
    });
  }
}

let rateLimiterSingleton: TokenBucketRateLimiter | null = null;

export function getRateLimiter(): TokenBucketRateLimiter {
  if (!rateLimiterSingleton) {
    rateLimiterSingleton = new TokenBucketRateLimiter();
  }
  return rateLimiterSingleton;
}
