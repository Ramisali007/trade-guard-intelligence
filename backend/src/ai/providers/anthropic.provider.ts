import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';
import { Errors, describeUnknown } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import {
  buildClassificationSystemPrompt,
  buildClassificationUserPrompt,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
} from '../prompt';
import { buildTradeComplianceSystemPrompt, buildTradeComplianceUserPrompt } from '../trade-prompt';
import { extractJsonObject, parseClassificationPayload, parseSummaryPayload } from '../response-schema';
import type {
  AIAnalysisService,
  ClassificationRequest,
  ClassificationResponse,
  SummaryRequest,
  SummaryResponse,
} from '../types';

const log = createLogger('ai:anthropic');

/**
 * Claude provider.
 *
 * The request follows the current Messages API rules for the Opus 5 family: no assistant prefill and no
 * sampling parameters (both are rejected with a 400), depth of reasoning set with `output_config.effort`
 * rather than a thinking budget. The JSON contract is carried by the prompt and enforced by the
 * validator, which strips a code fence or a lead-in sentence if the model adds one. The token ceiling
 * leaves headroom for the model's own reasoning, because a response truncated mid-object is
 * unparseable — better to spend the tokens than to retry blind.
 *
 * Transport-level failures are translated into the application's error vocabulary here, so
 * the orchestrator can distinguish "retry this" (rate limit, timeout, 5xx) from "this will
 * never work" (bad credentials) without knowing anything about Anthropic's API.
 */

/** Reasoning shares the output budget; without headroom a "low effort" answer can still be cut off. */
const REASONING_HEADROOM_TOKENS = 4000;
const MAX_OUTPUT_TOKENS = 32_000;

export class AnthropicProvider implements AIAnalysisService {
  readonly id = 'anthropic';
  readonly model: string;
  readonly supportsSummary = true;
  readonly isLocal = false;

  private readonly client: Anthropic;
  private readonly systemPrompt = buildClassificationSystemPrompt();

  constructor(apiKey: string, model = config.ai.anthropic.model) {
    this.model = model;
    this.client = new Anthropic({
      apiKey,
      timeout: config.processing.requestTimeoutMs,
      // Retries are handled by the orchestrator, which also owns the fallback decision.
      maxRetries: 0,
    });
  }

  async classify(request: ClassificationRequest): Promise<ClassificationResponse> {
    const minTokens = config.ai.anthropic.unitMaxOutputTokens || 2500;
    const maxTokens = Math.max(minTokens, request.units.length * 60 + 300);
    const text = await this.complete(
      this.systemPrompt,
      buildClassificationUserPrompt(request),
      maxTokens,
    );
    const expectedIds = request.units.map((unit) => unit.id);
    const parsed = parseClassificationPayload(text, expectedIds);

    if (parsed.missingIds.length > 0) {
      log.warn('model omitted passages', {
        batchIndex: request.batchIndex,
        missing: parsed.missingIds.length,
        expected: expectedIds.length,
      });
    }
    return parsed;
  }

  async summarize(request: SummaryRequest): Promise<SummaryResponse> {
    const text = await this.complete(
      buildSummarySystemPrompt(),
      buildSummaryUserPrompt(request),
      config.ai.anthropic.summaryMaxOutputTokens || 1400,
    );
    return parseSummaryPayload(text);
  }

  /** Trade-document field extraction, as a JSON object. Throws on any failure; the resilient wrapper records why and falls back. */
  async extractTradeDoc(filename: string, text: string): Promise<any> {
    const content = await this.complete(buildTradeComplianceSystemPrompt(), buildTradeComplianceUserPrompt(filename, text), 3500);
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(content) || content);
    } catch (error) {
      throw Errors.aiInvalidResponse(`Trade extraction was not JSON: ${describeUnknown(error)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw Errors.aiInvalidResponse('Trade extraction was not a JSON object');
    }
    return parsed;
  }

  /** A general JSON completion for the pre-shipment scrutiny; throws on any failure. */
  async completeJson(system: string, user: string, maxTokens = 3500): Promise<Record<string, unknown>> {
    const content = await this.complete(system, user, maxTokens);
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(content) || content);
    } catch (error) {
      throw Errors.aiInvalidResponse(`The answer was not JSON: ${describeUnknown(error)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Errors.aiInvalidResponse('The answer was not a JSON object');
    return parsed as Record<string, unknown>;
  }

  private async complete(system: string, user: string, maxTokens: number): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: Math.min(MAX_OUTPUT_TOKENS, maxTokens + REASONING_HEADROOM_TOKENS),
        output_config: { effort: config.ai.anthropic.effort },
        system,
        messages: [{ role: 'user', content: user + '\n\nReply with one JSON object and nothing else.' }],
      });

      const body = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (body.trim().length === 0) {
        throw Errors.aiInvalidResponse(`Empty completion (stop_reason=${response.stop_reason ?? 'unknown'})`);
      }
      if (response.stop_reason === 'refusal') {
        throw Errors.aiInvalidResponse('The model declined to answer (' + (response.stop_details?.category ?? 'policy') + ')');
      }
      if (response.stop_reason === 'max_tokens') {
        // The JSON is necessarily truncated; say so rather than failing later on a parse error.
        throw Errors.aiInvalidResponse('Response hit the output token limit and was truncated');
      }

      return body;
    } catch (error) {
      throw translateError(error);
    }
  }
}

function translateError(error: unknown): Error {
  if (error instanceof Error && error.name === 'AppError') return error;

  const status = (error as { status?: number } | null)?.status;
  const detail = describeUnknown(error);

  if (status === 401 || status === 403) {
    return Errors.aiAuthFailed(`Anthropic rejected the credentials (${status}): ${detail}`);
  }
  if (status === 429) return Errors.aiRateLimited(detail);
  if (status === 408 || /timeout|timed out|ETIMEDOUT|ECONNRESET/i.test(detail)) return Errors.aiTimeout(detail);
  if (status !== undefined && status >= 500) return Errors.aiUnavailable(`Anthropic ${status}: ${detail}`);
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed/i.test(detail)) {
    return Errors.aiUnavailable(`Network failure reaching Anthropic: ${detail}`);
  }
  if (status !== undefined && status >= 400) return Errors.aiInvalidResponse(`Anthropic ${status}: ${detail}`);
  return Errors.aiUnavailable(detail);
}
