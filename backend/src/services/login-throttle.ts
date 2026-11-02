/**
 * Brakes on password guessing, in two layers.
 *
 * The per-address rate limit stops one machine; it does nothing against a botnet taking a few guesses per address at one
 * account. So failures are counted per *email*, whether or not that email exists, which keeps the lock from being used to
 * find out which addresses are real.
 *
 * Two counters, because one counter lets anybody who knows an officer's email keep that officer out:
 *  - per email *and address*: five wrong passwords from the same address lock that address out of that account. A person who
 *    mistypes, or an attacker working from one machine, is stopped here, and nobody else is affected.
 *  - per email across all addresses: a much higher count (25) that locks the account for everyone. It is what stops a botnet,
 *    and it takes an attacker many addresses and many attempts to reach, instead of five requests from one.
 *
 * Each lock lasts a time that doubles with every repeat, up to an hour. In-process, like the rate limiter: a multi-instance
 * deployment needs a shared store behind the same three calls.
 */

const WINDOW_MS = 15 * 60_000;
const BASE_LOCK_MS = 15 * 60_000;
const MAX_LOCK_MS = 60 * 60_000;
const MAX_TRACKED = 20_000;

/** Wrong passwords from one address, for one account, before that address is locked out of it. */
export const MAX_FAILURES_PER_ADDRESS = 5;
/** Wrong passwords for one account from any addresses, before the account is locked for everyone. */
export const MAX_FAILURES_PER_ACCOUNT = 25;

interface Entry {
  failures: number;
  windowStart: number;
  lockedUntil: number;
  locks: number;
}

class FailureTracker {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly maxFailures: number) {}

  private sweep(now: number): void {
    if (this.entries.size < MAX_TRACKED) return;
    for (const [k, e] of this.entries) {
      if (e.lockedUntil <= now && now - e.windowStart > WINDOW_MS) this.entries.delete(k);
    }
    // Still full of live locks: drop the oldest rather than grow without bound.
    while (this.entries.size >= MAX_TRACKED) {
      const first = this.entries.keys().next().value;
      if (first === undefined) break;
      this.entries.delete(first);
    }
  }

  /** Seconds to wait, or 0. */
  retryAfterSeconds(key: string, now: number): number {
    const entry = this.entries.get(key);
    if (!entry || entry.lockedUntil <= now) return 0;
    return Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000));
  }

  fail(key: string, now: number): void {
    this.sweep(now);
    const existing = this.entries.get(key);
    const entry: Entry =
      existing && now - existing.windowStart <= WINDOW_MS ? existing : { failures: 0, windowStart: now, lockedUntil: 0, locks: existing?.locks ?? 0 };
    entry.failures += 1;
    if (entry.failures >= this.maxFailures) {
      entry.locks += 1;
      entry.lockedUntil = now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (entry.locks - 1));
      entry.failures = 0;
      entry.windowStart = now;
    }
    this.entries.set(key, entry);
  }

  clear(key?: string): void {
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }
}

const perAddress = new FailureTracker(MAX_FAILURES_PER_ADDRESS);
const perAccount = new FailureTracker(MAX_FAILURES_PER_ACCOUNT);

const accountKey = (email: string): string => email.trim().toLowerCase();
const addressKey = (email: string, address: string | undefined): string => `${accountKey(email)}|${address ?? 'unknown'}`;

/** Seconds this sign-in must wait, or 0 when it may try: the longer of the address lock and the account lock. */
export function loginRetryAfterSeconds(email: string, address?: string, now = Date.now()): number {
  return Math.max(perAddress.retryAfterSeconds(addressKey(email, address), now), perAccount.retryAfterSeconds(accountKey(email), now));
}

export function recordLoginFailure(email: string, address?: string, now = Date.now()): void {
  perAddress.fail(addressKey(email, address), now);
  perAccount.fail(accountKey(email), now);
}

/** A correct password clears the counts for this account, so the person who owns it is not left counting old mistakes. */
export function recordLoginSuccess(email: string, address?: string): void {
  perAddress.clear(addressKey(email, address));
  perAccount.clear(accountKey(email));
}

/** Test seam. */
export function resetLoginThrottle(): void {
  perAddress.clear();
  perAccount.clear();
}
