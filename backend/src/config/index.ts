import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

function str(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function optionalStr(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function int(key: string, fallback: number, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
  const raw = optionalStr(key);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function bool(key: string, fallback: boolean): boolean {
  const raw = optionalStr(key)?.toLowerCase();
  if (raw === undefined) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function list(key: string, fallback: string[]): string[] {
  const raw = optionalStr(key);
  if (raw === undefined) return fallback;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Values an operator copies from an example file and forgets to change. A signing key or API key that
 * is published in the repository is not a secret, however long it is.
 */
const PLACEHOLDER = /(your[_-]|changeme|change[_-]me|replace[_-]?me|placeholder|example|_here|secret[_-]?key[_-]?here|xxxx|0000000)/i;
const MIN_SIGNING_KEY_CHARS = 32;
const MIN_API_KEY_CHARS = 24;

/** Problems found in the secrets, reported at start-up (and fatal in production). */
export const secretProblems: string[] = [];

function secretValue(key: string, minChars: number, aliases: string[] = []): string | undefined {
  const name = [key, ...aliases].find((k) => optionalStr(k) !== undefined);
  if (!name) return undefined;
  const value = optionalStr(name)!;
  if (value.length < minChars) {
    secretProblems.push(name + ' is shorter than ' + minChars + ' characters and was ignored.');
    return undefined;
  }
  if (PLACEHOLDER.test(value)) {
    secretProblems.push(name + ' still holds an example/placeholder value and was ignored.');
    return undefined;
  }
  return value;
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host === '127.0.0.1' || host.startsWith('127.');
}

const rootDir = path.resolve(__dirname, '..', '..');

function resolveDir(key: string, fallback: string): string {
  const configured = optionalStr(key);
  return path.resolve(rootDir, configured ?? fallback);
}

/**
 * `anthropic` is the production provider. `heuristic` is a fully local, deterministic
 * lexicon classifier: it lets the whole pipeline run (and be demoed / tested) with no
 * API key, and it doubles as the per-unit fallback when an AI call fails irrecoverably.
 */
export type AiProviderId = 'anthropic' | 'openai-compatible' | 'heuristic';

const explicitProvider = optionalStr('AI_PROVIDER')?.toLowerCase() as AiProviderId | undefined;
// A provider key still holding the example text is no key: ignoring it keeps a fresh copy of the example file
// on the local engine instead of sending every request to a provider with a key that cannot work.
function providerKey(name: string): string | undefined {
  const value = optionalStr(name);
  if (value !== undefined && PLACEHOLDER.test(value)) {
    secretProblems.push(name + ' still holds an example/placeholder value and was ignored.');
    return undefined;
  }
  return value;
}

const anthropicKey = providerKey('ANTHROPIC_API_KEY');
const openAiKey = providerKey('OPENAI_API_KEY');

function resolveProvider(): AiProviderId {
  if (explicitProvider === 'anthropic' || explicitProvider === 'openai-compatible' || explicitProvider === 'heuristic') {
    return explicitProvider;
  }
  if (anthropicKey) return 'anthropic';
  if (openAiKey) return 'openai-compatible';
  return 'heuristic';
}

export const config = {
  env: str('NODE_ENV', 'development'),
  isProduction: str('NODE_ENV', 'development') === 'production',
  logLevel: str('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',

  server: {
    // Loopback unless the operator says otherwise: a fresh checkout must not listen on the network.
    host: str('HOST', '127.0.0.1'),
    port: int('PORT', 4000, 1, 65535),
    /** Angular dev server origins allowed by default. */
    corsOrigins: list('CORS_ORIGIN', ['http://localhost:4200', 'http://127.0.0.1:4200']),
    bodyLimit: str('BODY_LIMIT', '1mb'),
    /**
     * Enable only when a reverse proxy actually sits in front of this process. It makes Express
     * read the client address from `X-Forwarded-For`, which the rate limiter needs — and which,
     * without a proxy, would just be a client-supplied way to get a fresh bucket.
     */
    trustProxy: bool('TRUST_PROXY', false),
    /**
     * Resolvers for DNS record lookups (the SRV records behind a mongodb+srv:// URI). Public
     * resolvers by default because some networks cannot answer SRV queries; set `system` to keep
     * the operating system's resolvers, which a network with internal hostnames needs.
     */
    dnsServers: list('DNS_SERVERS', ['8.8.8.8', '8.8.4.4', '1.1.1.1']),
  },

  upload: {
    uploadDir: resolveDir('UPLOAD_DIR', 'storage/uploads'),
    dataDir: resolveDir('DATA_DIR', 'storage/data'),
    maxFileSizeBytes: int('MAX_FILE_SIZE_MB', 50, 1, 500) * 1024 * 1024,
    /** A longer PDF is refused with a clear message instead of tying a worker up for minutes. */
    maxPages: int('MAX_DOCUMENT_PAGES', 400, 1, 5000),
    /** Wall-clock ceiling for reading one document (text extraction, OCR). */
    extractionTimeoutMs: int('EXTRACTION_TIMEOUT_MS', 180_000, 10_000, 3_600_000),
    /** Uploaded source files are deleted this long after the job reaches a terminal state. */
    retentionMinutes: int('FILE_RETENTION_MINUTES', 120, 1, 60 * 24 * 30),
    cleanupIntervalMinutes: int('CLEANUP_INTERVAL_MINUTES', 15, 1, 24 * 60),
    allowedExtensions: ['.pdf', '.doc', '.docx'] as const,
    allowedMimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // Some browsers/OSes send generic types for .doc/.docx; the magic-byte sniff is the real gate.
      'application/octet-stream',
      'application/x-msword',
      'application/zip',
      '',
    ] as string[],
  },

  storage: {
    driver: str('STORAGE_DRIVER', 'memory') as 'memory' | 'mongo',
    mongoUri: str('MONGODB_URI', 'mongodb://127.0.0.1:27017/docuintel'),
    cloudMongoUri: str('MONGODB_CLOUD_URI', ''),
    enableDualSync: bool('ENABLE_DUAL_SYNC', false),
    mongoDb: str('MONGODB_DB', 'docuintel'),
    /**
     * With STORAGE_DRIVER=mongo, whether an unreachable database may be replaced by the in-memory
     * store at start-up. Convenient for a demo; in production it would accept cases and lose them on
     * the next restart, so production refuses to start instead unless this is set explicitly.
     */
    allowMemoryFallback: bool('STORAGE_ALLOW_MEMORY_FALLBACK', (process.env['NODE_ENV'] ?? 'development') !== 'production'),
    /** Memory driver: mirror documents to disk so restarts don't lose completed analyses. */
    persistToDisk: bool('PERSIST_TO_DISK', true),
    /** Disk mirror for the compliance store (sources, entities, benchmarks, ...). */
    complianceDir: resolveDir('COMPLIANCE_DIR', 'storage/compliance'),
  },

  processing: {
    /** Units per AI request. Batching units into one call is what makes large docs affordable and avoids rate limits. */
    unitsPerBatch: int('AI_UNITS_PER_BATCH', 60, 1, 250),
    /** Soft token ceiling for the total request (input + output) of a single batch. */
    batchTokenBudget: int('AI_BATCH_TOKEN_BUDGET', 30000, 300, 100_000),
    /** Parallel in-flight AI requests per document. Keep 1-2 for free-tier RPM limits. */
    concurrency: int('AI_CONCURRENCY', 2, 1, 32),
    /** Documents analyzed concurrently across the whole process. */
    jobConcurrency: int('JOB_CONCURRENCY', 2, 1, 16),
    maxRetries: int('AI_MAX_RETRIES', 2, 0, 8),
    requestTimeoutMs: int('AI_TIMEOUT_MS', 35_000, 5_000, 600_000),
    /** The longest a single large model call (a whole-document extraction or review) may take. */
    longCallTimeoutMs: int('AI_LONG_TIMEOUT_MS', 90_000, 5_000, 600_000),
    /** Hard ceiling on analyzed units per document. Anything skipped is reported, never hidden. */
    maxUnits: int('MAX_ANALYSIS_UNITS', 4000, 10, 100_000),
    /** Units shorter than this are kept in the extracted text but not sent for classification. */
    minUnitChars: int('MIN_UNIT_CHARS', 25, 1, 500),
    maxUnitChars: int('MAX_UNIT_CHARS', 4000, 200, 20_000),
    enableSummary: bool('AI_ENABLE_SUMMARY', true),
    /** Provider's nominal token-per-minute (TPM) limit. */
    tpmLimit: int('AI_TPM_LIMIT', 1_000_000, 1000, 5_000_000),
    /** Proactive safety ceiling for rolling TPM consumption. */
    tpmSafeThreshold: int('AI_SAFE_TPM_THRESHOLD', 800_000, 500, 5_000_000),
  },

  preshipment: {
    /**
     * The pre-shipment scrutiny reads documents with the AI model only. When true (the default), a
     * document the model did not read, because it was unavailable and the built-in parser stepped in,
     * counts as "not read": its values are not used and the step reports that the AI was unavailable.
     * Set PRESHIPMENT_REQUIRE_AI=false only where no model exists, such as the automated tests.
     */
    requireAi: bool('PRESHIPMENT_REQUIRE_AI', true),
  },
  ai: {
    provider: resolveProvider(),
    /**
     * The least time between two of the large calls the pre-shipment scrutiny makes (recognizing a
     * document, extracting its fields, reviewing it, comparing documents, writing the mail). Hosted
     * models on a free or small plan allow only about fifteen requests a minute, and a scrutiny of five
     * documents makes more than that; spacing the calls out is faster than being refused and waiting.
     * 0 turns it off.
     */
    minRequestGapMs: int('AI_MIN_GAP_MS', 4000, 0, 60_000),
    anthropic: {
      apiKey: anthropicKey,
      model: str('AI_MODEL', 'claude-opus-5-5'),
      /** `low` is right for constrained classification; raise for nuanced documents. */
      effort: str('AI_EFFORT', 'low') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
      unitMaxOutputTokens: int('AI_UNIT_MAX_OUTPUT_TOKENS', 2500, 100, 8000),
      summaryMaxOutputTokens: int('AI_SUMMARY_MAX_OUTPUT_TOKENS', 1800, 200, 8000),
    },
    openAiCompatible: {
      apiKey: openAiKey,
      baseUrl: str('OPENAI_BASE_URL', 'https://api.groq.com/openai/v1'),
      model: str('OPENAI_MODEL', 'openai/gpt-oss-120b'),
      unitMaxOutputTokens: int('AI_UNIT_MAX_OUTPUT_TOKENS', 2500, 100, 8000),
      summaryMaxOutputTokens: int('AI_SUMMARY_MAX_OUTPUT_TOKENS', 1800, 200, 8000),
    },
  },

  images: {
    imagesDir: resolveDir('IMAGES_DIR', 'storage/images'),
    minImageDimension: int('MIN_IMAGE_DIMENSION', 30, 5, 500),
    minImageArea: int('MIN_IMAGE_AREA', 1000, 25, 100000),
    scannedTextThresholdChars: int('SCANNED_TEXT_THRESHOLD_CHARS', 40, 0, 500),
    ocrEnabled: bool('OCR_ENABLED', true),
    visionEnabled: bool('VISION_ENABLED', true),
  },

  pricing: {
    /**
     * Look up indicative prices in public search results when no curated benchmark exists. Off by
     * default: the figures are unverified (never used for findings) and the lookup adds network
     * latency and non-determinism to every analysis.
     */
    enableWebPriceLookup: bool('ENABLE_WEB_PRICE_LOOKUP', false),
  },

  auth: {
    secret: secretValue('AUTH_SECRET', MIN_SIGNING_KEY_CHARS, ['JWT_SECRET']),
    apiKey: secretValue('API_SECRET_KEY', MIN_API_KEY_CHARS, ['API_KEY']),
    /**
     * Key for the audit hash chains. With it, each audit entry is an HMAC, so someone who can write to the
     * database but does not hold the key cannot rewrite history consistently. Keep it outside the database
     * (a secret store), and different from AUTH_SECRET. Without it the chains are plain SHA-256: they still
     * detect accidental damage and clumsy edits, but not a forger with database access.
     */
    auditKey: secretValue('AUDIT_HMAC_KEY', MIN_SIGNING_KEY_CHARS),
    sessionHours: int('AUTH_SESSION_HOURS', 12, 1, 168),
    /** scrypt cost as log2(N). 17 is the OWASP floor for scrypt (128 MiB, r=8, p=1); tests lower it for speed. */
    scryptLog2N: int('AUTH_SCRYPT_LOG2_N', 17, 14, 20),
    /**
     * One-click demo accounts, with a password that is printed in the README. On by default only for a
     * development or test run that listens on loopback; anywhere else they exist only when
     * ENABLE_DEMO_LOGIN is set explicitly.
     */
    demoLoginEnabled: bool(
      'ENABLE_DEMO_LOGIN',
      ['development', 'test'].includes(str('NODE_ENV', 'development')) && isLoopbackHost(str('HOST', '127.0.0.1')),
    ),
    /** Password for the demo accounts on the regular email/password form. */
    demoPassword: optionalStr('DEMO_ACCOUNT_PASSWORD'),
    /**
     * Provisioned users as a JSON array of { email, name, role, institution, passwordHash }.
     * Generate a hash with `npm run hash-password -- <password>`.
     */
    usersJson: optionalStr('AUTH_USERS'),
    /**
     * Google reCAPTCHA v2 ("I'm not a robot") on the sign-in form. The site key is public and goes to the browser; the
     * secret key stays here and is used to check each token with Google. The check is on only when both are set.
     * Keys come from https://www.google.com/recaptcha/admin (Google also publishes test keys that always pass).
     */
    recaptcha: {
      siteKey: optionalStr('RECAPTCHA_SITE_KEY'),
      secretKey: optionalStr('RECAPTCHA_SECRET_KEY'),
    },
  },

  /**
   * The host payload: the PDF handed to the bank's host system when a pre-shipment request is approved. The host opens it
   * from a link that carries an unguessable token, so `publicBaseUrl` must be an address the host can reach.
   */
  hostPayload: {
    /** The address the host reaches this API at (no trailing slash). Defaults to this server's own address, which only works on one machine. */
    publicBaseUrl: optionalStr('PUBLIC_BASE_URL'),
    /** Prefix of the host (TI) reference created when a payload is sent: PREFIX-YEAR-NNNNNN. */
    tiPrefix: str('HOST_TI_PREFIX', 'TI').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TI',
    /** Where a sent payload is posted (JSON with the link and the TI reference). Unset: the payload is recorded and the host fetches it by its link. */
    deliveryUrl: optionalStr('HOST_DELIVERY_URL'),
    /** Sent as a bearer token with the post, when the host endpoint needs one. Never logged or returned. */
    deliveryToken: optionalStr('HOST_DELIVERY_TOKEN'),
  },
} as const;

export function ensureRuntimeDirectories(): void {
  for (const dir of [config.upload.uploadDir, config.upload.dataDir, config.images.imagesDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // An ephemeral signing key in production would silently log every user out on each restart and
  // make tokens unverifiable across instances. Refuse to start instead of degrading quietly.
  if (config.isProduction && !config.auth.secret) {
    const detail = secretProblems.length > 0 ? ' ' + secretProblems.join(' ') : '';
    throw new Error('AUTH_SECRET must be set in production (32+ random bytes, e.g. `openssl rand -hex 32`).' + detail);
  }
  if (config.isProduction && optionalStr('API_SECRET_KEY') !== undefined && !config.auth.apiKey) {
    throw new Error('API_SECRET_KEY is set but unusable. ' + secretProblems.join(' '));
  }
}

/** Configuration choices that are legal but dangerous; logged loudly at start-up. */
export function securityWarnings(): string[] {
  const warnings = [...secretProblems];
  if (config.auth.demoLoginEnabled && (!isLoopbackHost(config.server.host) || config.isProduction)) {
    warnings.push('Demo accounts with a published password are enabled on ' + config.server.host + ' (' + config.env + '). Set ENABLE_DEMO_LOGIN=false.');
  }
  if (!config.auth.auditKey) {
    warnings.push('AUDIT_HMAC_KEY is not set: the audit chains are unkeyed, so they cannot prove history was not rewritten by someone with database access.');
  } else if (config.auth.auditKey === config.auth.secret) {
    warnings.push('AUDIT_HMAC_KEY equals AUTH_SECRET; use a separate key.');
  }
  if (!config.isProduction && !isLoopbackHost(config.server.host)) {
    warnings.push('The API listens on ' + config.server.host + ' with NODE_ENV=' + config.env + '; set NODE_ENV=production for any shared deployment.');
  }
  return warnings;
}

export type AppConfig = typeof config;