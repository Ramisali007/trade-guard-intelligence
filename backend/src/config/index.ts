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
const anthropicKey = optionalStr('ANTHROPIC_API_KEY');
const openAiKey = optionalStr('OPENAI_API_KEY');

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
    host: str('HOST', '0.0.0.0'),
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
  },

  upload: {
    uploadDir: resolveDir('UPLOAD_DIR', 'storage/uploads'),
    dataDir: resolveDir('DATA_DIR', 'storage/data'),
    maxFileSizeBytes: int('MAX_FILE_SIZE_MB', 50, 1, 500) * 1024 * 1024,
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
    mongoUri: str('MONGODB_URI', 'mongodb://127.0.0.1:27017'),
    mongoDb: str('MONGODB_DB', 'docuintel'),
    /** Memory driver: mirror documents to disk so restarts don't lose completed analyses. */
    persistToDisk: bool('PERSIST_TO_DISK', true),
  },

  processing: {
    /** Units per AI request. Batching units into one call is what makes large docs affordable and avoids rate limits. */
    unitsPerBatch: int('AI_UNITS_PER_BATCH', 60, 1, 250),
    /** Soft token ceiling for the total request (input + output) of a single batch. */
    batchTokenBudget: int('AI_BATCH_TOKEN_BUDGET', 30000, 300, 100_000),
    /** Parallel in-flight AI requests per document. Keep 1-2 for free-tier RPM limits. */
    concurrency: int('AI_CONCURRENCY', 2, 1, 32),
    /** Documents analysed concurrently across the whole process. */
    jobConcurrency: int('JOB_CONCURRENCY', 2, 1, 16),
    maxRetries: int('AI_MAX_RETRIES', 2, 0, 8),
    requestTimeoutMs: int('AI_TIMEOUT_MS', 35_000, 5_000, 600_000),
    /** Hard ceiling on analysed units per document. Anything skipped is reported, never hidden. */
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

  ai: {
    provider: resolveProvider(),
    anthropic: {
      apiKey: anthropicKey,
      model: str('AI_MODEL', 'claude-opus-5'),
      /** `low` is right for constrained classification; raise for nuanced documents. */
      effort: str('AI_EFFORT', 'low') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
      unitMaxOutputTokens: int('AI_UNIT_MAX_OUTPUT_TOKENS', 2500, 100, 8000),
      summaryMaxOutputTokens: int('AI_SUMMARY_MAX_OUTPUT_TOKENS', 1800, 200, 8000),
      chatMaxOutputTokens: int('AI_CHAT_MAX_OUTPUT_TOKENS', 1500, 200, 8000),
    },
    openAiCompatible: {
      apiKey: openAiKey,
      baseUrl: str('OPENAI_BASE_URL', 'https://api.groq.com/openai/v1'),
      model: str('OPENAI_MODEL', 'openai/gpt-oss-120b'),
      unitMaxOutputTokens: int('AI_UNIT_MAX_OUTPUT_TOKENS', 2500, 100, 8000),
      summaryMaxOutputTokens: int('AI_SUMMARY_MAX_OUTPUT_TOKENS', 1800, 200, 8000),
      chatMaxOutputTokens: int('AI_CHAT_MAX_OUTPUT_TOKENS', 1500, 200, 8000),
    },
  },
} as const;

export function ensureRuntimeDirectories(): void {
  for (const dir of [config.upload.uploadDir, config.upload.dataDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export type AppConfig = typeof config;