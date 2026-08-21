/**
 * The classification taxonomy is data, not code.
 *
 * Every consumer derives from this file: the AI prompt enumerates these values, the
 * response validator accepts only these ids, the aggregator builds its distributions
 * from them, the TXT report labels rows with them, and the Angular client fetches the
 * whole thing from `GET /api/taxonomy` so its filters and legends stay in sync.
 *
 * Adding a dimension or a value means editing this file only.
 */

export type DimensionId = 'sentiment' | 'emotion' | 'contentType' | 'topic';

/** Coarse polarity hint so the UI can style a value without knowing its name. */
export type ValueTone = 'positive' | 'negative' | 'neutral' | 'informational';

export interface TaxonomyValue {
  id: string;
  label: string;
  /** Sent to the model as the decision criterion for this value. */
  description: string;
  tone: ValueTone;
}

export interface TaxonomyDimension {
  id: DimensionId;
  label: string;
  description: string;
  /** Value id used when the model omits the field or returns something unrecognised. */
  fallback: string;
  /** Dimensions marked optional may legitimately come back as the fallback value. */
  required: boolean;
  values: TaxonomyValue[];
}

export const TAXONOMY: TaxonomyDimension[] = [
  {
    id: 'sentiment',
    label: 'Sentiment',
    description: 'Overall polarity the passage expresses.',
    fallback: 'neutral',
    required: true,
    values: [
      {
        id: 'positive',
        label: 'Positive',
        description: 'Approval, praise, satisfaction, good news, or a favourable outcome.',
        tone: 'positive',
      },
      {
        id: 'negative',
        label: 'Negative',
        description: 'Criticism, dissatisfaction, loss, risk, failure, or an unfavourable outcome.',
        tone: 'negative',
      },
      {
        id: 'neutral',
        label: 'Neutral',
        description: 'Factual, procedural, or descriptive text with no evaluative charge.',
        tone: 'neutral',
      },
    ],
  },
  {
    id: 'emotion',
    label: 'Emotion',
    description: 'Dominant emotion carried by the passage.',
    fallback: 'neutral',
    required: true,
    values: [
      { id: 'happy', label: 'Happy', description: 'Contentment, gratitude, warmth, or satisfaction.', tone: 'positive' },
      { id: 'sad', label: 'Sad', description: 'Disappointment, regret, loss, or sorrow.', tone: 'negative' },
      { id: 'angry', label: 'Angry', description: 'Frustration, indignation, blame, or hostility.', tone: 'negative' },
      { id: 'excited', label: 'Excited', description: 'Enthusiasm, anticipation, momentum, or celebration.', tone: 'positive' },
      { id: 'fear', label: 'Fear', description: 'Anxiety, concern, warning, threat, or uncertainty about harm.', tone: 'negative' },
      { id: 'surprise', label: 'Surprise', description: 'Unexpectedness, astonishment, or a notable deviation from expectation.', tone: 'informational' },
      { id: 'neutral', label: 'Neutral', description: 'No discernible emotional colouring.', tone: 'neutral' },
    ],
  },
  {
    id: 'contentType',
    label: 'Content type',
    description: 'What kind of content the passage is, structurally and rhetorically.',
    fallback: 'other',
    required: true,
    values: [
      {
        id: 'mathematical',
        label: 'Mathematical',
        description: 'Equations, derivations, proofs, formulae, quantitative notation, or statistical workings.',
        tone: 'informational',
      },
      {
        id: 'technical',
        label: 'Technical',
        description: 'Engineering, scientific, or systems detail: specifications, architecture, code, protocols.',
        tone: 'informational',
      },
      { id: 'narrative', label: 'Narrative', description: 'Story, chronology, anecdote, or account of events.', tone: 'informational' },
      { id: 'informational', label: 'Informational', description: 'Neutral exposition, definitions, background, or reporting of facts.', tone: 'informational' },
      { id: 'question', label: 'Question', description: 'An interrogative passage seeking information.', tone: 'informational' },
      { id: 'instruction', label: 'Instruction', description: 'Directives, procedures, steps, or requirements telling the reader what to do.', tone: 'informational' },
      { id: 'opinion', label: 'Opinion', description: 'Subjective judgement, argument, recommendation, or editorial stance.', tone: 'informational' },
      { id: 'complaint', label: 'Complaint', description: 'An expressed grievance about a product, service, person, or process.', tone: 'negative' },
      { id: 'feedback', label: 'Feedback', description: 'Evaluative commentary offered as a response, review, or appraisal.', tone: 'informational' },
      { id: 'other', label: 'Other', description: 'Content that fits none of the above (boilerplate, fragments, tabular residue).', tone: 'neutral' },
    ],
  },
  {
    id: 'topic',
    label: 'Topic',
    description: 'Subject-matter domain of the passage.',
    fallback: 'other',
    required: false,
    values: [
      { id: 'finance', label: 'Finance', description: 'Accounting, revenue, funding, markets, pricing, or financial performance.', tone: 'informational' },
      { id: 'technology', label: 'Technology', description: 'Software, hardware, data, infrastructure, or engineering practice.', tone: 'informational' },
      { id: 'healthcare', label: 'Healthcare', description: 'Medicine, clinical care, patients, pharmaceuticals, or public health.', tone: 'informational' },
      { id: 'education', label: 'Education', description: 'Teaching, curricula, learning, academia, or training.', tone: 'informational' },
      { id: 'business', label: 'Business', description: 'Strategy, operations, org structure, partnerships, or commercial performance.', tone: 'informational' },
      { id: 'legal', label: 'Legal', description: 'Contracts, regulation, compliance, liability, or litigation.', tone: 'informational' },
      { id: 'marketing', label: 'Marketing', description: 'Brand, campaigns, positioning, audience, or demand generation.', tone: 'informational' },
      { id: 'customer_support', label: 'Customer support', description: 'Service interactions, tickets, escalations, or support processes.', tone: 'informational' },
      { id: 'research', label: 'Research', description: 'Studies, methodology, experiments, literature, or findings.', tone: 'informational' },
      { id: 'other', label: 'Other', description: 'A domain outside the list above, or too general to place.', tone: 'neutral' },
    ],
  },
];

/** Structural role of an extracted unit — assigned by the extractor, not the model. */
export const UNIT_TYPES = [
  { id: 'heading', label: 'Heading' },
  { id: 'paragraph', label: 'Paragraph' },
  { id: 'list_item', label: 'List item' },
  { id: 'table_row', label: 'Table row' },
  { id: 'equation', label: 'Equation' },
  { id: 'quote', label: 'Quote' },
] as const;

export type UnitType = (typeof UNIT_TYPES)[number]['id'];

const dimensionIndex = new Map<DimensionId, TaxonomyDimension>(TAXONOMY.map((d) => [d.id, d]));
const valueIndex = new Map<DimensionId, Map<string, TaxonomyValue>>(
  TAXONOMY.map((d) => [d.id, new Map(d.values.map((v) => [v.id, v]))]),
);

export function getDimension(id: DimensionId): TaxonomyDimension {
  const dimension = dimensionIndex.get(id);
  if (!dimension) throw new Error(`Unknown taxonomy dimension: ${id}`);
  return dimension;
}

export function isValidValue(dimension: DimensionId, value: string): boolean {
  return valueIndex.get(dimension)?.has(value) ?? false;
}

/**
 * Coerce a model-supplied value into the taxonomy. Accepts exact ids, then a few
 * forgiving shapes (case, spaces vs underscores, label text, common synonyms) before
 * giving up and returning the dimension's fallback.
 */
export function coerceValue(dimension: DimensionId, raw: unknown): { value: string; exact: boolean } {
  const dim = getDimension(dimension);
  if (typeof raw !== 'string') return { value: dim.fallback, exact: false };

  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (isValidValue(dimension, normalized)) return { value: normalized, exact: true };

  const byLabel = dim.values.find((v) => v.label.toLowerCase().replace(/[\s-]+/g, '_') === normalized);
  if (byLabel) return { value: byLabel.id, exact: true };

  const synonym = SYNONYMS[dimension]?.[normalized];
  if (synonym && isValidValue(dimension, synonym)) return { value: synonym, exact: true };

  return { value: dim.fallback, exact: false };
}

/** Model outputs drift toward near-misses; map the frequent ones instead of discarding the row. */
const SYNONYMS: Partial<Record<DimensionId, Record<string, string>>> = {
  sentiment: {
    pos: 'positive',
    neg: 'negative',
    mixed: 'neutral',
    objective: 'neutral',
    factual: 'neutral',
  },
  emotion: {
    joy: 'happy',
    joyful: 'happy',
    content: 'happy',
    satisfied: 'happy',
    grateful: 'happy',
    sorrow: 'sad',
    disappointed: 'sad',
    unhappy: 'sad',
    anger: 'angry',
    frustrated: 'angry',
    frustration: 'angry',
    enthusiastic: 'excited',
    enthusiasm: 'excited',
    anticipation: 'excited',
    afraid: 'fear',
    anxious: 'fear',
    anxiety: 'fear',
    worried: 'fear',
    concern: 'fear',
    surprised: 'surprise',
    astonished: 'surprise',
    none: 'neutral',
    calm: 'neutral',
  },
  contentType: {
    math: 'mathematical',
    maths: 'mathematical',
    mathematics: 'mathematical',
    equation: 'mathematical',
    formula: 'mathematical',
    statistical: 'mathematical',
    code: 'technical',
    specification: 'technical',
    story: 'narrative',
    informative: 'informational',
    factual: 'informational',
    description: 'informational',
    descriptive: 'informational',
    questions: 'question',
    interrogative: 'question',
    directive: 'instruction',
    procedure: 'instruction',
    procedural: 'instruction',
    steps: 'instruction',
    editorial: 'opinion',
    argument: 'opinion',
    grievance: 'complaint',
    customer_complaint: 'complaint',
    review: 'feedback',
    customer_feedback: 'feedback',
    testimonial: 'feedback',
    boilerplate: 'other',
    unknown: 'other',
  },
  topic: {
    financial: 'finance',
    accounting: 'finance',
    economics: 'finance',
    tech: 'technology',
    software: 'technology',
    engineering: 'technology',
    it: 'technology',
    medical: 'healthcare',
    health: 'healthcare',
    clinical: 'healthcare',
    academic: 'education',
    teaching: 'education',
    learning: 'education',
    corporate: 'business',
    operations: 'business',
    strategy: 'business',
    management: 'business',
    law: 'legal',
    compliance: 'legal',
    regulatory: 'legal',
    regulation: 'legal',
    advertising: 'marketing',
    brand: 'marketing',
    sales: 'marketing',
    support: 'customer_support',
    service: 'customer_support',
    customer_experience: 'customer_support',
    customer_service: 'customer_support',
    science: 'research',
    scientific: 'research',
    study: 'research',
    general: 'other',
    misc: 'other',
    unknown: 'other',
  },
};

/** Compact enumeration used inside the AI prompt. */
export function describeDimensionForPrompt(dimension: TaxonomyDimension): string {
  const lines = dimension.values.map((v) => `  - ${v.id}: ${v.description}`);
  return `${dimension.id} (${dimension.label}) — ${dimension.description}\n${lines.join('\n')}`;
}

export function emptyDistribution(dimension: DimensionId): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of getDimension(dimension).values) result[value.id] = 0;
  return result;
}