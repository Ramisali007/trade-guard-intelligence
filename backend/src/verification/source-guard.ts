/**
 * Protection for the sources the verification layer fetches, one guard per source:
 *
 *  - SINGLE FLIGHT: concurrent requests for the same source share one retrieval, so a burst of cases opening at once
 *    makes one request to the publisher, not one each;
 *  - MINIMUM INTERVAL: after any attempt, the next is not made before `minIntervalMs`, so a failing or slow source is
 *    not hammered, and a publisher's rate limit is respected;
 *  - CIRCUIT BREAKER: after `failureThreshold` failures in a row the circuit opens and attempts are refused for
 *    `openMs`; then one trial attempt is allowed. A success closes the circuit.
 *
 * A refused attempt is an error like any other failure of the source: the caller reports the check as not done. It
 * is never turned into a clean result. The guard holds no data and changes nothing about what is retrieved.
 */

export class CircuitOpenError extends Error {
  constructor(
    readonly sourceId: string,
    readonly retryAt: string,
    reason: string,
  ) {
    super(reason);
    this.name = 'CircuitOpenError';
  }
}

export interface GuardState {
  sourceId: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  consecutiveFailures: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  /** When the next attempt may be made, if one is being held back. */
  nextAttemptAt: string | null;
  attempts: number;
  refused: number;
}

export interface GuardOptions {
  failureThreshold: number;
  openMs: number;
  minIntervalMs: number;
  clock: () => number;
}

const DEFAULTS: GuardOptions = { failureThreshold: 3, openMs: 10 * 60_000, minIntervalMs: 30_000, clock: () => Date.now() };

export class SourceGuard {
  private readonly opts: GuardOptions;
  private failures = 0;
  private openedAt: number | null = null;
  private lastAttempt: number | null = null;
  private lastSuccess: number | null = null;
  private lastFailure: number | null = null;
  private lastError: string | null = null;
  private inFlight: Promise<unknown> | null = null;
  private attempts = 0;
  private refused = 0;

  constructor(
    readonly sourceId: string,
    options: Partial<GuardOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  private iso(t: number | null): string | null {
    return t === null ? null : new Date(t).toISOString();
  }

  private mode(): GuardState['state'] {
    if (this.openedAt === null) return 'CLOSED';
    return this.opts.clock() - this.openedAt >= this.opts.openMs ? 'HALF_OPEN' : 'OPEN';
  }

  state(): GuardState {
    const mode = this.mode();
    const next = mode === 'OPEN' ? this.openedAt! + this.opts.openMs : this.lastAttempt !== null && this.failures > 0 ? this.lastAttempt + this.opts.minIntervalMs : null;
    return {
      sourceId: this.sourceId,
      state: mode,
      consecutiveFailures: this.failures,
      lastAttemptAt: this.iso(this.lastAttempt),
      lastSuccessAt: this.iso(this.lastSuccess),
      lastFailureAt: this.iso(this.lastFailure),
      lastError: this.lastError,
      nextAttemptAt: next !== null && next > this.opts.clock() ? this.iso(next) : null,
      attempts: this.attempts,
      refused: this.refused,
    };
  }

  /** Run one retrieval under the guard. Concurrent callers share the one in flight. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.inFlight) return this.inFlight as Promise<T>;
    const now = this.opts.clock();
    const mode = this.mode();
    if (mode === 'OPEN') {
      this.refused++;
      const retryAt = this.iso(this.openedAt! + this.opts.openMs)!;
      throw new CircuitOpenError(this.sourceId, retryAt, `${this.sourceId} failed ${this.failures} times in a row; it is not requested again until ${retryAt}.${this.lastError ? ` Last error: ${this.lastError}` : ''}`);
    }
    if (this.failures > 0 && this.lastAttempt !== null && now - this.lastAttempt < this.opts.minIntervalMs) {
      this.refused++;
      const retryAt = this.iso(this.lastAttempt + this.opts.minIntervalMs)!;
      throw new CircuitOpenError(this.sourceId, retryAt, `${this.sourceId} failed a moment ago; it is not requested again until ${retryAt}.${this.lastError ? ` Last error: ${this.lastError}` : ''}`);
    }
    this.attempts++;
    this.lastAttempt = now;
    const attempt = (async () => {
      try {
        const value = await work();
        this.failures = 0;
        this.openedAt = null;
        this.lastSuccess = this.opts.clock();
        this.lastError = null;
        return value;
      } catch (error) {
        this.failures++;
        this.lastFailure = this.opts.clock();
        this.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 160);
        if (this.failures >= this.opts.failureThreshold) this.openedAt = this.opts.clock();
        throw error;
      } finally {
        this.inFlight = null;
      }
    })();
    this.inFlight = attempt;
    return attempt;
  }
}

const guards = new Map<string, SourceGuard>();

export function guardFor(sourceId: string): SourceGuard {
  let guard = guards.get(sourceId);
  if (!guard) {
    guard = new SourceGuard(sourceId);
    guards.set(sourceId, guard);
  }
  return guard;
}

export function allGuardStates(): GuardState[] {
  return [...guards.values()].map((g) => g.state());
}

export function resetGuardsForTesting(): void {
  guards.clear();
}
