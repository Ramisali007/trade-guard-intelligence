/**
 * Per-account brake on password guessing.
 *
 * The per-address rate limit stops one machine; it does nothing against a botnet taking one guess per
 * address at a single account. This counts failures per *email*, whether or not that email exists, so
 * the lock cannot be used to find out which addresses are real. After `MAX_FAILURES` wrong passwords
 * inside the window the account is locked for a time that doubles with every repeat, up to an hour.
 *
 * In-process, like the rate limiter: a multi-instance deployment needs a shared store behind the same
 * three calls.
 */

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const BASE_LOCK_MS = 15 * 60_000;
const MAX_LOCK_MS = 60 * 60_000;
const MAX_TRACKED = 20_000;

interface Entry {
  failures: number;
  windowStart: number;
  lockedUntil: number;
  locks: number;
}

const entries = new Map<string, Entry>();

function key(email: string): string {
  return email.trim().toLowerCase();
}

function sweep(now: number): void {
  if (entries.size < MAX_TRACKED) return;
  for (const [k, e] of entries) {
    if (e.lockedUntil <= now && now - e.windowStart > WINDOW_MS) entries.delete(k);
  }
  // Still full of live locks: drop the oldest rather than grow without bound.
  while (entries.size >= MAX_TRACKED) {
    const first = entries.keys().next().value;
    if (first === undefined) break;
    entries.delete(first);
  }
}

/** Seconds the account must wait, or 0 when it may try. */
export function loginRetryAfterSeconds(email: string, now = Date.now()): number {
  const entry = entries.get(key(email));
  if (!entry || entry.lockedUntil <= now) return 0;
  return Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000));
}

export function recordLoginFailure(email: string, now = Date.now()): void {
  sweep(now);
  const k = key(email);
  const existing = entries.get(k);
  const entry: Entry =
    existing && now - existing.windowStart <= WINDOW_MS ? existing : { failures: 0, windowStart: now, lockedUntil: 0, locks: existing?.locks ?? 0 };
  entry.failures += 1;
  if (entry.failures >= MAX_FAILURES) {
    entry.locks += 1;
    entry.lockedUntil = now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (entry.locks - 1));
    entry.failures = 0;
    entry.windowStart = now;
  }
  entries.set(k, entry);
}

export function recordLoginSuccess(email: string): void {
  entries.delete(key(email));
}

/** Test seam. */
export function resetLoginThrottle(): void {
  entries.clear();
}
