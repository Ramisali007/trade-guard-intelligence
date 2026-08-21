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
import { parseClassificationPayload, parseSummaryPayload } from '../response-schema';
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
 * Two details make the structured-output contract hold in practice:
 *
 *  - the assistant turn is **prefilled with `{`**, so the model continues a JSON object
 *    rather than opening with prose or a markdown fence;
 *  - `stop_sequences` is left alone and the token ceiling is generous, because a response
 *    truncated mid-object is unparseable — better to spend the tokens than to retry blind.
 *
 * Transport-level failures are translated into the application's error vocabulary here, so
 * the orchestrator can distinguish "retry this" (rate limit, timeout, 5xx) from "this will
 * never work" (bad credentials) without knowing anything about Anthropic's API.
 */

const JSON_PREFILL = '{';

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
    const text = await this.complete(
      this.systemPrompt,
      buildClassificationUserPrompt(request),
      config.ai.anthropic.maxOutputTokens,
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
    const text = await this.complete(buildSummarySystemPrompt(), buildSummaryUserPrompt(request), 1400);
    return parseSummaryPayload(text);
  }

  private async complete(system: string, user: string, maxTokens: number): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        temperature: 0,
        system,
        messages: [
          { role: 'user', content: user },
          { role: 'assistant', content: JSON_PREFILL },
        ],
      });

      const body = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (body.trim().length === 0) {
        throw Errors.aiInvalidResponse(`Empty completion (stop_reason=${response.stop_reason ?? 'unknown'})`);
      }
      if (response.stop_reason === 'max_tokens') {
        // The JSON is necessarily truncated; say so rather than failing later on a parse error.
        throw Errors.aiInvalidResponse('Response hit the output token limit and was truncated');
      }

      // The prefill is not echoed back, so it has to be put back on the front.
      return `${JSON_PREFILL}${body}`;
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
