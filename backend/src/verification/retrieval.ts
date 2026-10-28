import crypto from 'node:crypto';
import { safeFetchResponse, type SafeFetchOptions } from '../utils/safe-fetch';
import { guardFor } from './source-guard';
import { getSourceEntry } from './source-catalogue';

/**
 * The only way the verification layer fetches an external source. A source may be requested from
 * its own catalogued hosts and nothing else, over HTTPS, through the SSRF-safe fetch (no internal
 * addresses, no redirects, capped size). A URL that comes from a document or from an AI answer is
 * never fetched: callers pass the catalogue's URL, and this refuses anything outside it.
 */
export class SourceNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceNotAllowedError';
  }
}

/** Whether network retrieval of external sources is switched off (the test suites, an air-gapped deployment). */
export function externalSourcesOffline(): boolean {
  return process.env['EXTERNAL_SOURCES_OFFLINE'] === 'true';
}

export function assertAllowedUrl(sourceId: string, rawUrl: string): URL {
  const entry = getSourceEntry(sourceId);
  if (!entry) throw new SourceNotAllowedError(`"${sourceId}" is not a catalogued source.`);
  if (entry.integration === 'NOT_INTEGRATED') throw new SourceNotAllowedError(`"${sourceId}" is not integrated; it cannot be retrieved.`);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SourceNotAllowedError('Invalid URL.');
  }
  if (url.protocol !== 'https:') throw new SourceNotAllowedError('Only HTTPS sources are retrieved.');
  if (!entry.allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new SourceNotAllowedError(`Host "${url.hostname}" is not an allowed host for ${sourceId}.`);
  }
  return url;
}

export interface Retrieved {
  body: string;
  contentHash: string;
  retrievedAt: string;
  /** The publisher's own date for the file (Last-Modified) as ISO, and its version marker (ETag), when sent. */
  publishedOn: string | null;
  datasetVersion: string | null;
  /** True when the publisher sent a Content-MD5 and the body matched it; null when none was sent. */
  md5Verified: boolean | null;
}

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrityError';
  }
}

const first = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

/**
 * Retrieval goes through the source's guard: one request in flight per source, a pause after a failure, and a circuit
 * that opens after repeated failures. A refused attempt is a failure of the source like any other.
 */
export async function retrieveSource(sourceId: string, rawUrl: string, options: SafeFetchOptions = {}): Promise<Retrieved> {
  const url = assertAllowedUrl(sourceId, rawUrl);
  if (externalSourcesOffline()) throw new Error('External source retrieval is switched off in this environment.');
  return guardFor(sourceId).run(() => fetchAndCheck(sourceId, url, options));
}

async function fetchAndCheck(_sourceId: string, url: URL, options: SafeFetchOptions): Promise<Retrieved> {
  const response = await safeFetchResponse(url.toString(), { timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024, ...options });
  const { body } = response;
  // A file that does not match the checksum its publisher sent was damaged or altered on the way: it is not used.
  const announced = first(response.headers['content-md5']);
  let md5Verified: boolean | null = null;
  if (announced) {
    md5Verified = crypto.createHash('md5').update(Buffer.from(body, 'utf8')).digest('base64') === announced;
    if (!md5Verified) throw new IntegrityError('The downloaded file does not match the Content-MD5 its publisher sent.');
  }
  const modified = first(response.headers['last-modified']);
  const parsed = modified ? new Date(modified) : null;
  return {
    body,
    contentHash: crypto.createHash('sha256').update(body).digest('hex'),
    retrievedAt: new Date().toISOString(),
    publishedOn: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
    datasetVersion: first(response.headers['etag']),
    md5Verified,
  };
}
