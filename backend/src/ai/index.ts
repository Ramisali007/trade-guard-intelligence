import { config, type AiProviderId } from '../config';
import { backoffDelay, sleep } from '../utils/async';
import { AppError, isAppError, describeUnknown } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAICompatibleProvider } from './providers/openai.provider';
import { HeuristicProvider, classifyUnit } from './providers/heuristic.provider';
import type {
  AIAnalysisService,
  ClassificationRequest,
  ClassificationRequestUnit,
  ClassificationResponse,
  SummaryRequest,
  SummaryResponse,
  UnitClassification,
} from './types';

export type {
  AIAnalysisService,
  ClassificationRequest,
  ClassificationRequestUnit,
  ClassificationResponse,
  SummaryRequest,
  SummaryResponse,
  UnitClassification,
} from './types';

const log = createLogger('ai');

/**
 * The single place in the codebase that knows which AI provider exists.
 *
 * `createAIAnalysisService` picks a provider from configuration. `ResilientAIService` wraps it
 * with the operational behaviour every provider needs and none should reimplement: bounded
 * retries with jittered backoff, retry of only the passages a model actually omitted, and a
 * guaranteed-complete result set. Adding a provider means adding a branch here.
 */

export function createAIAnalysisService(provider: AiProviderId = config.ai.provider): AIAnalysisService {
  switch (provider) {
    case 'anthropic': {
      const apiKey = config.ai.anthropic.apiKey;
      if (!apiKey) {
        log.warn('AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set; using the local engine instead');
        return new HeuristicProvider();
      }
      return new AnthropicProvider(apiKey);
    }
    case 'openai-compatible': {
      const apiKey = config.ai.openAiCompatible.apiKey;
      if (!apiKey) {
        log.warn('AI_PROVIDER=openai-compatible but OPENAI_API_KEY is not set; using the local engine instead');
        return new HeuristicProvider();
      }
      return new OpenAICompatibleProvider(apiKey);
    }
    case 'heuristic':
      return new HeuristicProvider();
  }
}

export interface AiRunStats {
  requests: number;
  retries: number;
  /** Batches that exhausted their retries and fell back to the local engine. */
  failures: number;
  /** Passages the model omitted and never returned, even after a targeted retry. */
  omitted: number;
  coercedFields: number;
  inputTokens: number;
  outputTokens: number;
  /** Distinct user-safe reasons for the failures, for the engine notes. */
  failureReasons: string[];
}

export interface ResilientClassificationResult extends ClassificationResponse {
  /** Ids classified by the local engine rather than the model. Surfaced per-row in the UI. */
  fallbackIds: string[];
}

/**
 * Batches that may exhaust their retries before the provider is written off for the rest of the
 * run. Two is enough to distinguish one awkward batch from an engine that is simply down.
 */
const MAX_BATCH_FAILURES_BEFORE_GIVING_UP = 5;

/**
 * Wraps a provider with retry, partial-response repair, a circuit breaker and fallback.
 *
 * The contract it adds is that `classifyBatch` **always** resolves with a classification for
 * every requested id. Anything the model could not produce is classified locally and its id
 * is listed in `fallbackIds`, so the degradation is recorded rather than hidden. A document
 * therefore never fails because one batch of one page misbehaved.
 *
 * The breaker matters as much as the retries. A rejected API key fails identically on every
 * attempt, so without it a 300-page document would discover the same dead provider several
 * hundred times, four attempts each, before finishing. Once the provider is written off for a
 * run, the remaining batches go straight to the local engine and the run finishes promptly —
 * still complete, still honestly labelled degraded.
 */
import { getRateLimiter } from './rate-limiter';
import { estimateBatchRequestTokens } from '../document-processing/chunker';

export class ResilientAIService implements AIAnalysisService {
  readonly id: string;
  readonly model: string;
  readonly supportsSummary: boolean;
  readonly isLocal: boolean;

  readonly stats: AiRunStats = {
    requests: 0,
    retries: 0,
    failures: 0,
    omitted: 0,
    coercedFields: 0,
    inputTokens: 0,
    outputTokens: 0,
    failureReasons: [],
  };

  /** Set once the provider has been written off for this run. */
  private circuitOpen = false;

  constructor(private readonly inner: AIAnalysisService) {
    this.id = inner.id;
    this.model = inner.model;
    this.supportsSummary = inner.supportsSummary;
    this.isLocal = inner.isLocal;
  }

  async classify(request: ClassificationRequest): Promise<ClassificationResponse> {
    return this.classifyBatch(request);
  }

  async classifyBatch(request: ClassificationRequest): Promise<ResilientClassificationResult> {
    if (this.inner.isLocal) {
      const result = await this.inner.classify(request);
      this.stats.requests += 1;
      return { ...result, fallbackIds: request.units.map((unit) => unit.id) };
    }

    if (this.circuitOpen) return this.classifyLocally(request, 'the analysis engine was already unavailable');

    const rateLimiter = getRateLimiter();
    const outputBudget = config.ai.openAiCompatible.unitMaxOutputTokens || 700;
    const collected = new Map<string, ClassificationResponse['classifications'][number]>();
    let pending = request.units;
    let lastError: unknown = null;

    const maxAttempts = config.processing.maxRetries;
    for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      if (pending.length === 0) break;
      if (attempt > 0) {
        this.stats.retries += 1;
        // If last error was a 429 rate limit, wait for the requested period + buffer
        if (isAppError(lastError) && lastError.status === 429) {
          const match = lastError.internal?.match(/try again in ([\d\.]+)s/i);
          const waitMs = match && match[1] ? Math.ceil(parseFloat(match[1]) * 1000) + 1500 : 8000;
          log.info('rate-limit backoff pause', { batchIndex: request.batchIndex, attempt, waitMs });
          await sleep(waitMs);
        } else {
          await sleep(backoffDelay(attempt - 1));
        }
      }

      // Proactively acquire rate limiter budget before sending request
      const tokenEst = estimateBatchRequestTokens(pending as any, outputBudget);
      const reservedTs = await rateLimiter.acquire(tokenEst.totalTokens);

      try {
        this.stats.requests += 1;
        const response = await this.inner.classify({ ...request, units: pending });

        const actualIn = response.usage?.inputTokens ?? tokenEst.inputTokens;
        const actualOut = response.usage?.outputTokens ?? tokenEst.outputTokens;
        const actualTotal = actualIn + actualOut;

        rateLimiter.reconcile(reservedTs, tokenEst.totalTokens, actualTotal);

        log.info('AI request completed', {
          model: this.model,
          batch: request.batchIndex,
          inputTokens: actualIn,
          outputTokens: actualOut,
          estimatedTotalTokens: tokenEst.totalTokens,
          actualTotalTokens: actualTotal,
          rollingTPM: rateLimiter.getRollingTPM(),
          rateLimitThreshold: config.processing.tpmSafeThreshold,
          status: 'success',
        });

        for (const classification of response.classifications) collected.set(classification.id, classification);
        this.stats.coercedFields += response.coercedFields;
        this.stats.inputTokens += actualIn;
        this.stats.outputTokens += actualOut;

        // Retry only what came back missing, rather than re-billing the whole batch.
        const missing = new Set(response.missingIds);
        pending = pending.filter((unit) => missing.has(unit.id));
        lastError = null;
        if (pending.length > 0) {
          log.warn('retrying omitted passages', { batchIndex: request.batchIndex, pending: pending.length, attempt });
        }
      } catch (error) {
        lastError = error;
        const retryable = isAppError(error) ? error.retryable : true;
        const isRateLimit = isAppError(error) && error.status === 429;
        const isAuthOrNotFound = isAppError(error) && (error.status === 401 || error.status === 403 || error.status === 404);

        if (isRateLimit) {
          const match = isAppError(error) ? error.internal?.match(/try again in ([\d\.]+)s/i) : null;
          const waitMs = match && match[1] ? Math.ceil(parseFloat(match[1]) * 1000) + 1500 : 8000;
          rateLimiter.recordRateLimit(waitMs);

          log.warn('AI request rate_limited', {
            model: this.model,
            batch: request.batchIndex,
            status: 'rate_limited',
            retryAfterMs: waitMs,
            rollingTPM: rateLimiter.getRollingTPM(),
          });
        } else {
          log.warn('classification attempt failed', {
            batchIndex: request.batchIndex,
            attempt,
            retryable,
            isRateLimit,
            code: isAppError(error) ? error.code : undefined,
            error: describeUnknown(error),
            internal: isAppError(error) ? error.internal : undefined,
          });
        }

        // Permanent failures (401, 403, 404) fail fast without infinite retries
        if (isAuthOrNotFound || (!retryable && !isRateLimit)) {
          this.openCircuit(`permanent configuration or credential failure (${isAppError(error) ? error.code : 'unknown'})`);
          break;
        }
      }
    }

    // Whatever is still unresolved is classified locally so the document completes.
    const fallbackIds: string[] = [];
    if (pending.length > 0) {
      this.stats.failures += 1;
      this.stats.omitted += pending.length;
      const reason = toSafeReason(lastError);
      if (reason && !this.stats.failureReasons.includes(reason)) this.stats.failureReasons.push(reason);

      for (const unit of pending) {
        collected.set(unit.id, classifyUnit(unit.id, unit.text, unit.unitType));
        fallbackIds.push(unit.id);
      }
      log.warn('batch fell back to the local engine', {
        batchIndex: request.batchIndex,
        units: pending.length,
        reason: describeUnknown(lastError),
        internal: isAppError(lastError) ? lastError.internal : undefined,
      });

      if (!this.circuitOpen && this.stats.failures >= MAX_BATCH_FAILURES_BEFORE_GIVING_UP) {
        this.openCircuit(`${this.stats.failures} batches exhausted their retries`);
      }
    }

    return {
      classifications: request.units.map((unit) => collected.get(unit.id)).filter(isPresent),
      missingIds: [],
      coercedFields: 0,
      fallbackIds,
    };
  }

  async summarize(request: SummaryRequest): Promise<SummaryResponse> {
    if (!this.inner.supportsSummary || this.circuitOpen) return EMPTY_SUMMARY;

    const rateLimiter = getRateLimiter();
    const summaryEstTokens = 1200; // Prompt + output estimate
    const reservedTs = await rateLimiter.acquire(summaryEstTokens);

    for (let attempt = 0; attempt <= 1; attempt += 1) {
      try {
        this.stats.requests += 1;
        if (attempt > 0) {
          this.stats.retries += 1;
          await sleep(backoffDelay(attempt - 1));
        }
        const res = await this.inner.summarize(request);
        rateLimiter.reconcile(reservedTs, summaryEstTokens, 1000);
        log.info('AI summary request completed', {
          model: this.model,
          rollingTPM: rateLimiter.getRollingTPM(),
          status: 'success',
        });
        return res;
      } catch (error) {
        const retryable = isAppError(error) ? error.retryable : true;
        log.warn('summary attempt failed', {
          attempt,
          error: describeUnknown(error),
          internal: isAppError(error) ? error.internal : undefined,
        });
        if (!retryable || attempt === 1) {
          const reason = toSafeReason(error);
          if (reason && !this.stats.failureReasons.includes(reason)) this.stats.failureReasons.push(reason);
          return EMPTY_SUMMARY;
        }
      }
    }
    return EMPTY_SUMMARY;
  }

  async extractTradeDoc(filename: string, text: string): Promise<any> {
    if (!this.inner.extractTradeDoc || this.circuitOpen) return null;
    try {
      this.stats.requests += 1;
      return await this.inner.extractTradeDoc(filename, text);
    } catch (err) {
      log.warn('Trade extraction AI call failed, fallback will be used', { error: describeUnknown(err) });
      return null;
    }
  }

  /**
   * Classify passages that were deliberately never sent to the model — headings, labels and
   * anything below `MIN_UNIT_CHARS`, where a request costs more than the answer is worth.
   *
   * This is by design rather than a failure, so it is counted nowhere in `stats`: a run whose
   * only local classifications came through here is a clean run, not a degraded one.
   */
  classifyLocal(units: ClassificationRequestUnit[]): UnitClassification[] {
    return units.map((unit) => classifyUnit(unit.id, unit.text, unit.unitType));
  }

  /** Classify a whole batch locally without touching the provider, after the breaker has tripped. */
  private classifyLocally(request: ClassificationRequest, why: string): ResilientClassificationResult {
    this.stats.omitted += request.units.length;
    log.debug('batch classified locally', { batchIndex: request.batchIndex, units: request.units.length, why });

    return {
      classifications: this.classifyLocal(request.units),
      missingIds: [],
      coercedFields: 0,
      fallbackIds: request.units.map((unit) => unit.id),
    };
  }

  private openCircuit(why: string): void {
    if (this.circuitOpen) return;
    this.circuitOpen = true;
    log.warn(`writing off the analysis engine for the rest of this run: ${why}`, { provider: this.inner.id });
  }
}

const EMPTY_SUMMARY: SummaryResponse = { headline: '', narrative: '', highlights: [] };


function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** The user-facing half of an error only. Technical detail stays in the logs. */
function toSafeReason(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof AppError) return error.message;
  return 'The analysis engine could not classify part of this document.';
}

let providerSingleton: AIAnalysisService | null = null;

/**
 * The provider itself is process-wide — one HTTP client, one connection pool. The resilient
 * wrapper is per document, so retry counts and fallback reasons belong to that run alone and
 * can be reported honestly in its results.
 */
export function getProvider(): AIAnalysisService {
  if (!providerSingleton) providerSingleton = createAIAnalysisService();
  return providerSingleton;
}

export async function validateProviderOnStartup(): Promise<{ ok: boolean; message: string; availableModels?: string[] }> {
  const provider = getProvider();
  if (provider.isLocal) {
    return { ok: true, message: 'Built-in local heuristic engine active.' };
  }

  if (config.ai.provider === 'openai-compatible') {
    const apiKey = config.ai.openAiCompatible.apiKey;
    const baseUrl = config.ai.openAiCompatible.baseUrl.replace(/\/+$/, '');
    const model = config.ai.openAiCompatible.model;

    if (!apiKey) {
      return { ok: false, message: 'OPENAI_API_KEY is not configured.' };
    }

    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const available: string[] = Array.isArray(data?.data) ? data.data.map((m: any) => m.id) : [];
        if (available.length > 0) {
          const normalize = (name: string) => name.replace(/^models\//i, '').trim().toLowerCase();
          const normModel = normalize(model);
          const found = available.some((m) => normalize(m) === normModel || m.toLowerCase() === model.toLowerCase());
          if (!found) {
            const warning = `Configured model "${model}" was NOT found in provider's available models: [${available.join(', ')}]`;
            log.error(warning);
            return { ok: false, message: warning, availableModels: available };
          }
          log.info(`model "${model}" verified on ${baseUrl}`);
          return { ok: true, message: `Model "${model}" verified and ready.`, availableModels: available };
        }
      }
    } catch (err: any) {
      log.warn(`could not query /models endpoint (${describeUnknown(err)}), falling back to completion test`);
    }

    // Fallback dry-run check
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const errText = await res.text();
        const msg = `AI Provider startup check failed (${res.status}): ${errText.slice(0, 300)}`;
        log.error(msg);
        return { ok: false, message: msg };
      }

      log.info(`dry-run test succeeded for model "${model}" on ${baseUrl}`);
      return { ok: true, message: `Model "${model}" verified via dry-run.` };
    } catch (err: any) {
      const msg = `AI Provider startup check failed to reach endpoint: ${describeUnknown(err)}`;
      log.error(msg);
      return { ok: false, message: msg };
    }
  }

  return { ok: true, message: `Provider "${provider.id}" initialized with model "${provider.model}".` };
}

export function createRunScopedService(): ResilientAIService {
  return new ResilientAIService(getProvider());
}