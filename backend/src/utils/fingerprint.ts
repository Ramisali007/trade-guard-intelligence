import crypto from 'node:crypto';

/**
 * Compute SHA-256 hash of raw uploaded file bytes for strict byte-identical deduplication.
 */
export function computeContentHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Compute SHA-256 hash of extracted text after canonical normalization:
 * - Convert to lower case
 * - Strip out common header/footer page markers (e.g. "page 1 of 5", "page 1", "--- page 2 ---")
 * - Collapse all consecutive whitespace, tabs, and newlines to a single space
 * - Trim edges
 */
export function computeNormalizedTextHash(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const normalized = text
    .toLowerCase()
    .replace(/(?:---|\b)?\s*page\s+\d+(?:\s+of\s+\d+)?\s*(?:---|:)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Compute best-effort document fingerprint for historical documents when raw bytes are unavailable.
 */
export function computeBestEffortFingerprint(filename: string, pageCount: number, wordCount: number): string {
  const normName = (filename || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const raw = `${normName}:${pageCount}:${wordCount}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}
