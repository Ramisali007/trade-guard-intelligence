/**
 * Run `worker` over `items` with at most `limit` in flight, preserving result order.
 *
 * Results come back in input order even though completion order varies, so downstream
 * code can zip results back onto their inputs by index.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, run));
  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter, capped. */
export function backoffDelay(attempt: number, baseMs = 600, capMs = 20_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(exponential / 2 + Math.random() * (exponential / 2));
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/** Reject with `TimeoutError` if `promise` hasn't settled within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Serialises async work per key so two callers never mutate the same document record
 * concurrently. Used by the repository layer's read-modify-write updates.
 */
export class KeyedMutex {
  private readonly chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    // `then(task, task)` so a rejected predecessor still lets the next caller run.
    const next = previous.then(task, task);
    const tracked: Promise<unknown> = next.catch(() => undefined);
    this.chains.set(key, tracked);
    void tracked.then(() => {
      if (this.chains.get(key) === tracked) this.chains.delete(key);
    });
    return next;
  }
}