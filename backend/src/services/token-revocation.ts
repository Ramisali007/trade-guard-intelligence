import path from 'node:path';
import { config } from '../config';
import { DebouncedSnapshot, readJsonIfPresent } from '../utils/json-snapshot';
import { createLogger } from '../utils/logger';

const log = createLogger('token-revocation');

/**
 * Tokens that were signed out before they expired.
 *
 * A signed token is valid until its expiry on its own; signing out has to be remembered somewhere or
 * it only hides the token from the browser. Entries are kept until the token would have expired anyway,
 * and written to a small file so a restart does not bring a signed-out token back to life.
 */
const revoked = new Map<string, number>();
let snapshot: DebouncedSnapshot | null = null;

function prune(nowSeconds: number): void {
  for (const [id, exp] of revoked) if (exp <= nowSeconds) revoked.delete(id);
}

export async function initTokenRevocation(): Promise<void> {
  if (!config.storage.persistToDisk) return;
  const file = path.join(config.upload.dataDir, 'revoked-tokens.json');
  try {
    const stored = await readJsonIfPresent<Array<[string, number]>>(file);
    const now = Math.floor(Date.now() / 1000);
    for (const [id, exp] of stored ?? []) if (exp > now) revoked.set(id, exp);
  } catch (error) {
    log.error('the revoked-token list could not be read', { error: String(error) });
  }
  snapshot = new DebouncedSnapshot(file, () => [...revoked.entries()], 250);
}

export function revokeToken(tokenId: string, expiresAtSeconds: number): void {
  prune(Math.floor(Date.now() / 1000));
  revoked.set(tokenId, expiresAtSeconds);
  snapshot?.markDirty();
}

export function isTokenRevoked(tokenId: string | undefined): boolean {
  return tokenId !== undefined && revoked.has(tokenId);
}

export async function flushTokenRevocation(): Promise<void> {
  await snapshot?.flush();
}
