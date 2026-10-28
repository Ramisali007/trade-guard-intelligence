import crypto from 'node:crypto';
import { config } from '../config';

/**
 * Hash chaining for append-only logs (trade-case audit, identity administration).
 *
 * Each entry stores the hash of the previous entry and its own hash over a canonical (key-sorted)
 * serialisation, so editing, reordering or removing an entry from the middle breaks verification.
 * Removing entries from the *end* is only detectable against an anchor held elsewhere — the trade
 * case keeps its chain head on the case record for exactly that reason.
 *
 * This proves the log was not altered after the fact *relative to its anchor*; it does not prove the
 * recorded facts were true, and anyone able to rewrite both the log and the anchor can forge both.
 */
export const GENESIS_HASH = '0'.repeat(64);

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export type ChainAlgorithm = 'sha256' | 'hmac-sha256';

/** What a new entry should use: keyed when an audit key is configured. */
export function currentChainAlgorithm(): ChainAlgorithm {
  return config.auth.auditKey ? 'hmac-sha256' : 'sha256';
}

/** The field to merge into a new entry before hashing it; empty for the original unkeyed scheme. */
export function chainAlgorithmField(): { alg?: 'hmac-sha256' } {
  return currentChainAlgorithm() === 'hmac-sha256' ? { alg: 'hmac-sha256' } : {};
}

export class ChainKeyUnavailableError extends Error {
  constructor() {
    super('This entry is signed with the audit key, which is not configured on this server.');
  }
}

/**
 * Hash an entry with the scheme it names (`alg`, part of the hashed body). Entries without one use plain
 * SHA-256, so chains written before the audit key existed still verify.
 */
export function hashEntry(entry: Record<string, unknown>): string {
  if (entry['alg'] === 'hmac-sha256') {
    const key = config.auth.auditKey;
    if (!key) throw new ChainKeyUnavailableError();
    return crypto.createHmac('sha256', key).update(canonical(entry)).digest('hex');
  }
  return crypto.createHash('sha256').update(canonical(entry)).digest('hex');
}

export interface ChainEntry {
  seq: number;
  prevHash: string;
  hash: string;
}

export interface ChainVerification {
  valid: boolean;
  /** First sequence number at which the chain fails, when it fails inside the log. */
  brokenAtSeq: number | null;
  /** Why it failed, in words an auditor can act on. */
  problem: string | null;
}

/**
 * Verify a chain in the order stored. `anchor`, when given, is the head the owning record says the
 * chain should end at; a shorter or different chain means entries were removed or never written.
 */
export function verifyHashChain<T extends ChainEntry>(entries: T[], anchor?: { seq: number; hash: string } | null): ChainVerification {
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const entry of entries) {
    if (entry.seq !== expectedSeq) {
      return { valid: false, brokenAtSeq: entry.seq, problem: `Sequence ${entry.seq} found where ${expectedSeq} was expected (entry missing or reordered).` };
    }
    const { hash, ...rest } = entry as T & Record<string, unknown>;
    if (entry.prevHash !== prev) return { valid: false, brokenAtSeq: entry.seq, problem: `Entry ${entry.seq} does not link to the entry before it.` };
    let expected: string;
    try {
      expected = hashEntry(rest);
    } catch (error) {
      if (error instanceof ChainKeyUnavailableError) return { valid: false, brokenAtSeq: entry.seq, problem: `Entry ${entry.seq}: ${error.message}` };
      throw error;
    }
    if (expected !== hash) return { valid: false, brokenAtSeq: entry.seq, problem: `Entry ${entry.seq} was altered after it was written.` };
    prev = hash;
    expectedSeq += 1;
  }
  if (anchor) {
    const last = entries[entries.length - 1];
    if (!last || last.seq < anchor.seq) {
      return { valid: false, brokenAtSeq: (last?.seq ?? 0) + 1, problem: `The record expects ${anchor.seq} entries but the log ends at ${last?.seq ?? 0}: entries were removed or never written.` };
    }
    if (last.seq > anchor.seq) {
      return { valid: false, brokenAtSeq: anchor.seq + 1, problem: `The log has entries beyond the record's anchor (${anchor.seq}).` };
    }
    if (last.hash !== anchor.hash) return { valid: false, brokenAtSeq: last.seq, problem: 'The newest entry does not match the record\'s anchor.' };
  }
  return { valid: true, brokenAtSeq: null, problem: null };
}
