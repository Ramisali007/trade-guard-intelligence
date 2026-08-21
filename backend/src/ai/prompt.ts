import { TAXONOMY, describeDimensionForPrompt } from '../config/taxonomy';
import type { ClassificationRequest, SummaryRequest } from './types';

/**
 * Prompt construction.
 *
 * The prompts are generated from `config/taxonomy.ts`, so adding a dimension or a category
 * updates the instructions, the schema shown to the model and the validator together — the
 * three can never drift apart.
 *
 * Both prompts demand a single JSON object and nothing else. Providers additionally pin the
 * response format where the API supports it; the strict wording here is what makes the
 * fallback path (extract-then-validate) reliable rather than hopeful.
 */

const REQUIRED_KEYS = TAXONOMY.map((dimension) => dimension.id);

export function buildClassificationSystemPrompt(): string {
  const dimensions = TAXONOMY.map(describeDimensionForPrompt).join('\n\n');

  return `You are a precise document analysis engine. You classify passages of text and return structured data.

You will receive numbered passages extracted from a single document, each with an "id".
Classify every passage independently along these dimensions:

${dimensions}

Rules:
- Return one object per passage, using the passage's exact "id".
- Use ONLY the lowercase value ids listed above. Never invent a value, never return a label, never return prose.
- Judge the passage on its own content. Do not infer sentiment from the document's overall tone.
- Headings, table rows, equations and boilerplate are usually sentiment "neutral" and emotion "neutral". Do not manufacture emotion that is not in the text.
- "confidence" is your own calibrated certainty for that passage, a number between 0 and 1. Use lower values for short or ambiguous passages.
- "keywords" holds up to 4 short terms taken verbatim from the passage. Use an empty array when nothing stands out.

Respond with a single JSON object and nothing else — no markdown fences, no commentary:
{"results":[{"id":"<passage id>",${REQUIRED_KEYS.map((key) => `"${key}":"<value id>"`).join(',')},"confidence":0.0,"keywords":["..."]}]}`;
}

export function buildClassificationUserPrompt(request: ClassificationRequest): string {
  const header = [
    `Document: ${request.documentName}`,
    request.section ? `Section: ${request.section}` : null,
    `Passages: ${request.units.length}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const passages = request.units
    .map((unit) => {
      const context = [
        `id: ${unit.id}`,
        `type: ${unit.unitType}`,
        `page: ${unit.pageNumber}`,
        unit.section && unit.section !== request.section ? `section: ${unit.section}` : null,
      ]
        .filter((line): line is string => line !== null)
        .join(' | ');
      return `<passage ${context}>\n${unit.text}\n</passage>`;
    })
    .join('\n\n');

  return `${header}\n\n${passages}\n\nClassify all ${request.units.length} passages. Return the JSON object described in your instructions, with exactly ${request.units.length} entries in "results".`;
}

export function buildSummarySystemPrompt(): string {
  return `You are a document analyst. You are given aggregate classification statistics for a document plus a representative sample of its passages, and you write a short factual overview for a dashboard.

Rules:
- Ground every claim in the statistics and excerpts you are given. Never invent findings, numbers or topics.
- "headline" is one sentence, at most 110 characters, describing what the document is.
- "narrative" is 2 to 4 sentences on the document's character: what kind of content it holds, its dominant tone, and anything notable about how that varies across the document.
- "highlights" holds 3 to 5 short observations, each under 120 characters, each supported by the data provided.
- Write plainly. No marketing language, no bullet characters, no markdown.

Respond with a single JSON object and nothing else:
{"headline":"...","narrative":"...","highlights":["...","..."]}`;
}

export function buildSummaryUserPrompt(request: SummaryRequest): string {
  const distributions = Object.entries(request.distributions)
    .map(([dimension, counts]) => {
      const entries = Object.entries(counts)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => `${value}=${count}`)
        .join(', ');
      return `${dimension}: ${entries || 'none'}`;
    })
    .join('\n');

  const excerpts = request.excerpts
    .map((excerpt) => `[page ${excerpt.pageNumber}${excerpt.section ? `, ${excerpt.section}` : ''}] ${excerpt.text}`)
    .join('\n\n');

  return `Document: ${request.documentName}
Pages: ${request.pageCount}
Analysed passages: ${request.unitCount}
${request.topSections.length > 0 ? `Sections: ${request.topSections.join(' / ')}` : ''}

Classification counts:
${distributions}

Representative excerpts:
${excerpts}

Write the overview as the JSON object described in your instructions.`;
}
