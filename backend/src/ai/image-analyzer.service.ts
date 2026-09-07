import { config } from '../config';
import { createLogger } from '../utils/logger';
import { extractJsonObject } from './response-schema';
import { countWords } from '../document-processing/text-normalizer';
import { withTimeout } from '../utils/async';
import type { ClassificationResult, ImageType, AnalyzedUnit } from '../models/document.model';

const log = createLogger('ai:image-analyzer');

export interface ImageAnalysisInput {
  documentId: string;
  imageId: string;
  buffer: Buffer;
  mimeType: string;
  imageHash: string;
  pageNumber: number;
  isScannedPage?: boolean;
}

export interface ImageAnalysisOutput {
  imageType: ImageType;
  visionDescription: string;
  ocrText: string;
  extractedData: Record<string, unknown> | Array<unknown> | null;
  text: string;
  charCount: number;
  wordCount: number;
  classification: ClassificationResult;
}

// In-memory cache keyed by SHA-256 imageHash to prevent redundant vision & OCR calls
const imageAnalysisCache = new Map<string, ImageAnalysisOutput>();

export class ImageAnalyzerService {
  /**
   * Run dual-pass OCR and Vision-model analysis on an image buffer.
   */
  async analyzeImage(input: ImageAnalysisInput): Promise<ImageAnalysisOutput> {
    // 1. Check cache by image hash
    if (imageAnalysisCache.has(input.imageHash)) {
      log.debug('image cache hit for hash', { imageHash: input.imageHash, imageId: input.imageId });
      return imageAnalysisCache.get(input.imageHash)!;
    }

    // 2. Pass 1: OCR Extraction
    let ocrText = '';
    if (config.images.ocrEnabled) {
      ocrText = await this.runOcr(input.buffer);
    }

    // 3. Pass 2: Vision-Model AI Analysis
    let visionResult: {
      imageType: ImageType;
      visionDescription: string;
      extractedData: Record<string, unknown> | Array<unknown> | null;
      source: 'ai' | 'heuristic';
    } | null = null;

    if (config.images.visionEnabled) {
      try {
        visionResult = await this.runVisionModel(input, ocrText);
      } catch (err) {
        log.warn('vision model analysis failed, falling back to heuristic', {
          imageId: input.imageId,
          error: String(err),
        });
      }
    }

    if (!visionResult) {
      visionResult = this.runHeuristicAnalysis(input, ocrText);
    }

    // 4. Combine text for indexing and search
    const textComponents: string[] = [];
    if (visionResult.visionDescription) {
      textComponents.push(visionResult.visionDescription);
    }
    if (ocrText && ocrText.trim().length > 0) {
      textComponents.push(`OCR Extracted Text:\n${ocrText.trim()}`);
    }

    const combinedText = textComponents.join('\n\n').trim() || `[Image ${input.imageId}]`;
    const charCount = combinedText.length;
    const wordCount = countWords(combinedText);

    // Derive classification
    const classification: ClassificationResult = {
      sentiment: 'neutral',
      emotion: 'neutral',
      contentType:
        visionResult.imageType === 'chart' || visionResult.imageType === 'table'
          ? 'technical'
          : visionResult.imageType === 'scanned_text_page'
            ? 'informational'
            : 'informational',
      topic: 'other',
      confidence: visionResult.source === 'ai' ? 0.9 : 0.65,
      keywords: this.extractKeywords(combinedText),
      source: visionResult.source,
    };

    const output: ImageAnalysisOutput = {
      imageType: visionResult.imageType,
      visionDescription: visionResult.visionDescription,
      ocrText: ocrText.trim(),
      extractedData: visionResult.extractedData,
      text: combinedText,
      charCount,
      wordCount,
      classification,
    };

    // Store in cache
    imageAnalysisCache.set(input.imageHash, output);
    return output;
  }

  /**
   * Pass 1: OCR using tesseract.js
   */
  private async runOcr(buffer: Buffer): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Tesseract = require('tesseract.js');
      const result: any = await withTimeout(
        Tesseract.recognize(buffer, 'eng', {
          errorHandler: () => undefined,
        }),
        20000,
      );
      return result?.data?.text?.trim() ?? '';
    } catch (err) {
      log.warn('OCR pass failed or timed out', { error: String(err) });
      return '';
    }
  }

  /**
   * Pass 2: Vision-Model AI call
   */
  private async runVisionModel(
    input: ImageAnalysisInput,
    ocrText: string,
  ): Promise<{
    imageType: ImageType;
    visionDescription: string;
    extractedData: Record<string, unknown> | Array<unknown> | null;
    source: 'ai';
  } | null> {
    const base64Data = input.buffer.toString('base64');
    const mimeType = input.mimeType || 'image/png';
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    const promptText = `Analyze this document image in detail.
Identify its visual type and content.
If it is a chart or graph, extract all underlying data points, series, axis labels, and trends into a structured JSON object.
If it is a table rendered as an image, extract headers and rows into structured JSON.
If it is a scanned document page, indicate scanned_text_page.

${ocrText ? `Additional OCR Text detected in this image:\n"""\n${ocrText.slice(0, 1500)}\n"""\n` : ''}

You must return a raw JSON object with this exact shape:
{
  "imageType": "photo" | "chart" | "diagram" | "table" | "logo" | "screenshot" | "signature" | "scanned_text_page" | "other",
  "visionDescription": "A clear natural-language explanation of what the image shows",
  "extractedData": { ... } or [ ... ] or null
}`;

    // 1. If OpenAI-compatible provider configured (e.g. Gemini / OpenAI / Groq)
    if (config.ai.openAiCompatible.apiKey) {
      const url = `${config.ai.openAiCompatible.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const response = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.ai.openAiCompatible.apiKey}`,
          },
          body: JSON.stringify({
            model: config.ai.openAiCompatible.model,
            temperature: 0.1,
            max_tokens: 3000,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content:
                  'You are an expert document vision AI. Analyze images and return ONLY valid JSON matching the requested schema.',
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: promptText },
                  { type: 'image_url', image_url: { url: dataUrl } },
                ],
              },
            ],
          }),
        }),
        Math.max(35000, config.processing.requestTimeoutMs),
      );

      if (response.ok) {
        const json: any = await response.json();
        const content = json.choices?.[0]?.message?.content;
        if (content) {
          const parsed = this.parseVisionResponse(content, input.isScannedPage);
          if (parsed) return { ...parsed, source: 'ai' };
        }
      }
    }

    // 2. If Anthropic provider configured
    if (config.ai.anthropic.apiKey) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Anthropic } = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: config.ai.anthropic.apiKey });
      const response = await client.messages.create({
        model: config.ai.anthropic.model,
        max_tokens: 3000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
                  data: base64Data,
                },
              },
              { type: 'text', text: promptText },
            ],
          },
        ],
      });

      const textBlock = response.content?.find((c: any) => c.type === 'text');
      if (textBlock?.text) {
        const parsed = this.parseVisionResponse(textBlock.text, input.isScannedPage);
        if (parsed) return { ...parsed, source: 'ai' };
      }
    }

    return null;
  }

  private parseVisionResponse(
    rawText: string,
    isScannedPage?: boolean,
  ): {
    imageType: ImageType;
    visionDescription: string;
    extractedData: Record<string, unknown> | Array<unknown> | null;
  } | null {
    try {
      const jsonStr = extractJsonObject(rawText) || rawText.trim();
      const obj = JSON.parse(jsonStr);

      const validTypes: ImageType[] = [
        'photo',
        'chart',
        'diagram',
        'table',
        'logo',
        'screenshot',
        'signature',
        'scanned_text_page',
        'other',
      ];

      let imageType: ImageType = validTypes.includes(obj.imageType) ? obj.imageType : 'other';
      if (isScannedPage && imageType === 'other') {
        imageType = 'scanned_text_page';
      }

      return {
        imageType,
        visionDescription: typeof obj.visionDescription === 'string' ? obj.visionDescription : 'Document image illustration.',
        extractedData: typeof obj.extractedData === 'object' ? obj.extractedData : null,
      };
    } catch (err) {
      log.warn('could not parse vision model JSON output', { error: String(err) });
      return null;
    }
  }

  /**
   * Resilient local Heuristic classification when Vision API is not active or offline.
   */
  private runHeuristicAnalysis(
    input: ImageAnalysisInput,
    ocrText: string,
  ): {
    imageType: ImageType;
    visionDescription: string;
    extractedData: Record<string, unknown> | Array<unknown> | null;
    source: 'heuristic';
  } {
    const textLower = ocrText.toLowerCase();

    // 1. Scanned page
    if (input.isScannedPage) {
      return {
        imageType: 'scanned_text_page',
        visionDescription: `Full-page scanned document (${ocrText.length} characters detected via OCR).`,
        extractedData: null,
        source: 'heuristic',
      };
    }

    // 2. Chart / Graph detection heuristics
    const chartKeywords = ['chart', 'graph', 'axis', 'trend', 'sales', 'revenue', '%', 'growth', 'q1', 'q2', 'q3', 'q4', 'percentage'];
    const hasChartTerms = chartKeywords.filter((k) => textLower.includes(k)).length >= 2;
    const hasNumbers = (ocrText.match(/\d+(?:\.\d+)?%?/g) || []).length >= 3;

    if (hasChartTerms && hasNumbers) {
      const numbers = (ocrText.match(/\d+(?:\.\d+)?/g) || []).slice(0, 8).map(Number);
      return {
        imageType: 'chart',
        visionDescription: `Visual chart illustration depicting numerical distributions: ${ocrText.slice(0, 120)}...`,
        extractedData: {
          chartType: 'inferred_chart',
          summary: 'Extracted trend metrics from embedded chart',
          dataPoints: numbers.map((n, i) => ({ label: `Point ${i + 1}`, value: n })),
        },
        source: 'heuristic',
      };
    }

    // 3. Table rendered as image detection heuristics
    const hasTableDelimiters = /\||\t|(?:\s{3,})/.test(ocrText);
    const lineCount = ocrText.split('\n').filter((l) => l.trim().length > 0).length;

    if (hasTableDelimiters && lineCount >= 3) {
      const lines = ocrText.split('\n').filter((l) => l.trim().length > 0);
      const rows = lines.map((l) => l.split(/\||\t|\s{3,}/).map((c) => c.trim()).filter(Boolean));
      return {
        imageType: 'table',
        visionDescription: `Tabular data grid with ${rows.length} rows extracted from image.`,
        extractedData: {
          headers: rows[0] || [],
          rows: rows.slice(1),
        },
        source: 'heuristic',
      };
    }

    // 4. Logo detection
    if (ocrText.length < 35 && ocrText.length > 0 && /inc|llc|corp|ltd|company|brand/i.test(ocrText)) {
      return {
        imageType: 'logo',
        visionDescription: `Brand emblem / logo containing text "${ocrText}".`,
        extractedData: null,
        source: 'heuristic',
      };
    }

    // 5. Default Photo / Diagram
    return {
      imageType: 'photo',
      visionDescription: ocrText.length > 0
        ? `Embedded document image containing caption/text: ${ocrText.slice(0, 100)}`
        : 'Embedded photo / figure illustration.',
      extractedData: null,
      source: 'heuristic',
    };
  }

  private extractKeywords(text: string): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
    const counts = new Map<string, number>();
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k]) => k);
  }
}

const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'were', 'which', 'there', 'their',
  'image', 'document', 'extracted', 'containing', 'figure', 'about', 'these',
]);

let singleton: ImageAnalyzerService | null = null;
export function getImageAnalyzerService(): ImageAnalyzerService {
  if (!singleton) {
    singleton = new ImageAnalyzerService();
  }
  return singleton;
}
