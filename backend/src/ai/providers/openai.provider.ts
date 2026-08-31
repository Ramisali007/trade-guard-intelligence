import { config } from '../../config';
import { Errors, describeUnknown, isAppError } from '../../utils/errors';
import { withTimeout } from '../../utils/async';
import {
  buildClassificationSystemPrompt,
  buildClassificationUserPrompt,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
} from '../prompt';
import { buildTradeComplianceSystemPrompt, buildTradeComplianceUserPrompt } from '../trade-prompt';
import { parseClassificationPayload, parseSummaryPayload, extractJsonObject } from '../response-schema';
import type {
  AIAnalysisService,
  ClassificationRequest,
  ClassificationResponse,
  SummaryRequest,
  SummaryResponse,
} from '../types';

/**
 * Any OpenAI-compatible chat-completions endpoint: OpenAI itself, Azure OpenAI, Groq,
 * Together, Ollama, vLLM, OpenRouter — anything that speaks `/chat/completions`.
 *
 * This provider exists to demonstrate the point of the abstraction: it is roughly a hundred
 * lines, imports no vendor SDK, and nothing outside this file changes when you switch to it.
 * `response_format: {type: 'json_object'}` is requested because most of these servers honour
 * it; the validator still treats the reply as untrusted text either way.
 */

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
}

export class OpenAICompatibleProvider implements AIAnalysisService {
  readonly id = 'openai-compatible';
  readonly model: string;
  readonly supportsSummary = true;
  readonly isLocal = false;

  private readonly systemPrompt = buildClassificationSystemPrompt();

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = config.ai.openAiCompatible.baseUrl,
    model = config.ai.openAiCompatible.model,
  ) {
    this.model = model;
  }

  async classify(request: ClassificationRequest): Promise<ClassificationResponse> {
    const minTokens = config.ai.openAiCompatible.unitMaxOutputTokens || 4096;
    const maxTokens = Math.min(8192, Math.max(minTokens, request.units.length * 85 + 500));
    const { content, usage } = await this.complete(
      this.systemPrompt,
      buildClassificationUserPrompt(request),
      maxTokens,
    );
    const parsed = parseClassificationPayload(content, request.units.map((unit) => unit.id));
    return {
      ...parsed,
      usage,
    };
  }

  async summarize(request: SummaryRequest): Promise<SummaryResponse> {
    const maxTokens = config.ai.openAiCompatible.summaryMaxOutputTokens || 1400;
    const { content } = await this.complete(
      buildSummarySystemPrompt(),
      buildSummaryUserPrompt(request),
      maxTokens,
    );
    return parseSummaryPayload(content);
  }

  async extractTradeDoc(filename: string, text: string): Promise<any> {
    try {
      const maxTokens = 3500;
      const { content } = await this.complete(
        buildTradeComplianceSystemPrompt(),
        buildTradeComplianceUserPrompt(filename, text),
        maxTokens,
      );
      const jsonStr = extractJsonObject(content) || content;
      return JSON.parse(jsonStr);
    } catch (e) {
      return null;
    }
  }


  private async complete(
    system: string,
    user: string,
    maxTokens: number,
  ): Promise<{ content: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    let response: Response;
    try {
      response = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        }),
        config.processing.requestTimeoutMs,
      );
    } catch (error) {
      const detail = describeUnknown(error);
      if (/timed out/i.test(detail)) throw Errors.aiTimeout(detail);
      throw Errors.aiUnavailable(`Network failure reaching ${url}: ${detail}`);
    }

    const raw = await response.text();

    if (!response.ok) {
      const detail = `${response.status} ${raw.slice(0, 2000)}`;
      if (response.status === 429) throw Errors.aiRateLimited(detail);
      if (response.status === 401 || response.status === 403) throw Errors.aiAuthFailed(`Credentials rejected: ${detail}`);
      if (response.status === 404) throw Errors.aiUnavailable(`Model not found (404): ${detail}`);
      if (response.status >= 500) throw Errors.aiUnavailable(detail);
      throw Errors.aiInvalidResponse(detail);
    }

    let payload: ChatCompletionResponse;
    try {
      payload = JSON.parse(raw) as ChatCompletionResponse;
    } catch (error) {
      throw Errors.aiInvalidResponse(`Endpoint did not return JSON: ${describeUnknown(error)}`);
    }

    const choice = payload.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw Errors.aiInvalidResponse(`Empty completion (finish_reason=${choice?.finish_reason ?? 'unknown'})`);
    }
    if (choice?.finish_reason === 'length') {
      throw Errors.aiInvalidResponse('Response hit the output token limit and was truncated');
    }

    const usage = payload.usage
      ? {
          inputTokens: payload.usage.prompt_tokens ?? 0,
          outputTokens: payload.usage.completion_tokens ?? 0,
        }
      : undefined;

    return { content, usage };
  }
}

/** Re-exported so the factory can special-case an already-translated failure. */
export { isAppError };