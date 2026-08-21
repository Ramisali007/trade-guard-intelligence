import { emptyDistribution } from '../../config/taxonomy';
import type {
  AIAnalysisService,
  ClassificationRequest,
  ClassificationResponse,
  SummaryRequest,
  SummaryResponse,
  UnitClassification,
} from '../types';

/**
 * The local engine: a deterministic lexicon-and-rules classifier that runs entirely in
 * process, with no network call and no API key.
 *
 * It exists for two reasons, both structural rather than decorative:
 *
 *  1. **The pipeline must be runnable and demonstrable without credentials.** Every stage —
 *     extraction, segmentation, chunking, aggregation, reporting — is exercised identically
 *     whether the classifier is a language model or this one.
 *  2. **It is the per-batch fallback.** When an AI request has exhausted its retries, the
 *     affected passages are classified here instead of being dropped or left blank. Every
 *     row records `source: 'heuristic'`, so a partially degraded run is visible in the UI and
 *     stated in the report rather than passed off as model output.
 *
 * Its confidence values are deliberately modest and are computed from the strength of the
 * lexical signal actually found — they are never a fixed number dressed up as certainty.
 */

const POSITIVE = new Set([
  'good', 'great', 'excellent', 'outstanding', 'strong', 'success', 'successful', 'improve', 'improved',
  'improvement', 'benefit', 'benefits', 'beneficial', 'gain', 'gains', 'growth', 'grew', 'increase',
  'increased', 'advantage', 'advantages', 'effective', 'efficient', 'robust', 'reliable', 'valuable',
  'positive', 'opportunity', 'opportunities', 'achieve', 'achieved', 'achievement', 'exceed', 'exceeded',
  'best', 'better', 'happy', 'pleased', 'satisfied', 'satisfaction', 'delighted', 'thank', 'thanks',
  'grateful', 'appreciate', 'appreciated', 'recommend', 'recommended', 'praise', 'impressive', 'excited',
  'promising', 'favourable', 'favorable', 'profit', 'profitable', 'surpassed', 'resolved', 'helpful',
  'clear', 'smooth', 'seamless', 'confident', 'optimistic', 'well', 'solid', 'accurate', 'secure',
]);

const NEGATIVE = new Set([
  'bad', 'poor', 'weak', 'fail', 'failed', 'failure', 'failures', 'problem', 'problems', 'issue', 'issues',
  'error', 'errors', 'bug', 'bugs', 'defect', 'defects', 'loss', 'losses', 'lost', 'decline', 'declined',
  'decrease', 'decreased', 'drop', 'dropped', 'risk', 'risks', 'risky', 'threat', 'threats', 'concern',
  'concerns', 'concerning', 'difficult', 'difficulty', 'challenge', 'challenges', 'challenging', 'delay',
  'delays', 'delayed', 'negative', 'disappointing', 'disappointed', 'disappointment', 'unacceptable',
  'inadequate', 'insufficient', 'incorrect', 'wrong', 'broken', 'crash', 'crashed', 'outage', 'downtime',
  'complaint', 'complaints', 'frustrated', 'frustrating', 'frustration', 'angry', 'unhappy', 'dissatisfied',
  'worse', 'worst', 'severe', 'critical', 'vulnerable', 'vulnerability', 'breach', 'penalty', 'fine',
  'lawsuit', 'violation', 'noncompliance', 'shortfall', 'deficit', 'overrun', 'blocked', 'blocker',
  'regret', 'unfortunately', 'unable', 'refused', 'rejected', 'terminated', 'cancelled', 'canceled',
]);

const NEGATORS = new Set(['not', "n't", 'no', 'never', 'without', 'cannot', 'cant', 'neither', 'nor', 'lack', 'lacks', 'lacking', 'fails']);
const INTENSIFIERS = new Set(['very', 'extremely', 'highly', 'significantly', 'substantially', 'severely', 'critically', 'deeply', 'strongly', 'particularly']);
const DIMINISHERS = new Set(['slightly', 'somewhat', 'marginally', 'mildly', 'partly', 'fairly', 'relatively']);

const EMOTION_LEXICON: Record<string, string[]> = {
  happy: ['happy', 'pleased', 'glad', 'delighted', 'satisfied', 'satisfaction', 'grateful', 'thank', 'thanks', 'appreciate', 'appreciated', 'enjoy', 'enjoyed', 'proud', 'content', 'warm', 'welcome', 'celebrate', 'wonderful', 'lovely'],
  sad: ['sad', 'unfortunate', 'unfortunately', 'regret', 'regrettable', 'disappointed', 'disappointing', 'disappointment', 'sorry', 'loss', 'lost', 'mourn', 'grief', 'decline', 'shortfall', 'setback', 'discouraging', 'unhappy'],
  angry: ['angry', 'furious', 'outraged', 'outrage', 'unacceptable', 'appalling', 'disgraceful', 'frustrated', 'frustrating', 'frustration', 'blame', 'negligent', 'negligence', 'incompetent', 'ridiculous', 'refuse', 'refused', 'demand', 'insist', 'complaint', 'complain', 'protest', 'dispute'],
  excited: ['excited', 'exciting', 'thrilled', 'eager', 'enthusiastic', 'enthusiasm', 'momentum', 'breakthrough', 'launch', 'launching', 'accelerate', 'accelerating', 'transform', 'transformative', 'milestone', 'record', 'boost', 'surge', 'ambitious', 'promising', 'anticipate', 'looking forward'],
  fear: ['risk', 'risks', 'threat', 'threats', 'danger', 'dangerous', 'concern', 'concerns', 'concerned', 'worry', 'worried', 'worrying', 'afraid', 'fear', 'anxious', 'anxiety', 'uncertain', 'uncertainty', 'warning', 'warn', 'caution', 'critical', 'severe', 'vulnerability', 'exposure', 'breach', 'liability', 'jeopardy'],
  surprise: ['surprising', 'surprised', 'surprisingly', 'unexpected', 'unexpectedly', 'unusual', 'remarkable', 'remarkably', 'striking', 'strikingly', 'notably', 'astonishing', 'unprecedented', 'suddenly', 'abrupt', 'anomaly', 'anomalous', 'counterintuitive'],
};

const TOPIC_LEXICON: Record<string, string[]> = {
  finance: ['revenue', 'profit', 'loss', 'margin', 'cost', 'costs', 'budget', 'invoice', 'tax', 'audit', 'cash', 'capital', 'investment', 'investor', 'funding', 'valuation', 'ebitda', 'dividend', 'expense', 'expenses', 'forecast', 'quarter', 'fiscal', 'accounting', 'balance', 'pricing', 'financial', 'currency', 'interest', 'debt', 'equity'],
  technology: ['software', 'hardware', 'server', 'database', 'api', 'code', 'deployment', 'deploy', 'infrastructure', 'cloud', 'network', 'algorithm', 'latency', 'throughput', 'architecture', 'framework', 'endpoint', 'authentication', 'encryption', 'repository', 'container', 'kubernetes', 'pipeline', 'runtime', 'frontend', 'backend', 'schema', 'query', 'cache', 'system', 'platform', 'integration'],
  healthcare: ['patient', 'patients', 'clinical', 'diagnosis', 'diagnostic', 'treatment', 'therapy', 'medical', 'medicine', 'hospital', 'physician', 'nurse', 'symptom', 'symptoms', 'disease', 'dose', 'dosage', 'trial', 'health', 'care', 'prescription', 'surgery', 'vaccine', 'epidemic', 'mortality'],
  education: ['student', 'students', 'teacher', 'teachers', 'curriculum', 'course', 'courses', 'lesson', 'learning', 'teaching', 'school', 'university', 'academic', 'exam', 'assessment', 'grade', 'grades', 'classroom', 'syllabus', 'tuition', 'lecture', 'training', 'pedagogy', 'enrolment', 'enrollment'],
  business: ['strategy', 'strategic', 'operations', 'operational', 'stakeholder', 'stakeholders', 'management', 'manager', 'team', 'teams', 'department', 'partnership', 'partner', 'vendor', 'supplier', 'contract', 'client', 'clients', 'organisation', 'organization', 'objective', 'objectives', 'kpi', 'roadmap', 'initiative', 'workflow', 'process', 'productivity', 'headcount', 'governance'],
  legal: ['contract', 'clause', 'agreement', 'liability', 'compliance', 'regulation', 'regulatory', 'statute', 'legal', 'law', 'court', 'litigation', 'plaintiff', 'defendant', 'jurisdiction', 'indemnity', 'breach', 'obligation', 'warranty', 'confidentiality', 'gdpr', 'consent', 'terms', 'party', 'parties', 'hereby', 'pursuant'],
  marketing: ['campaign', 'brand', 'branding', 'audience', 'engagement', 'conversion', 'funnel', 'advertising', 'advertisement', 'seo', 'content', 'social', 'impressions', 'reach', 'positioning', 'segment', 'segmentation', 'promotion', 'launch', 'messaging', 'awareness', 'lead', 'leads', 'churn', 'retention'],
  customer_support: ['ticket', 'tickets', 'customer', 'support', 'escalation', 'escalated', 'resolution', 'resolved', 'agent', 'helpdesk', 'sla', 'response', 'complaint', 'refund', 'inquiry', 'enquiry', 'chat', 'call', 'satisfaction', 'csat', 'queue', 'wait'],
  research: ['study', 'studies', 'research', 'hypothesis', 'methodology', 'experiment', 'experimental', 'sample', 'dataset', 'variable', 'correlation', 'significance', 'p-value', 'findings', 'literature', 'citation', 'analysis', 'observed', 'control', 'participants', 'survey', 'measurement', 'empirical', 'theory'],
};

const TECHNICAL_TERMS = new Set([...(TOPIC_LEXICON['technology'] ?? []), 'configuration', 'configure', 'parameter', 'module', 'component', 'protocol', 'specification', 'implementation', 'interface', 'version', 'library', 'dependency', 'compile', 'build']);

const COMPLAINT_MARKERS = ['unacceptable', 'complaint', 'complain', 'disappointed', 'poor service', 'no response', 'still waiting', 'refund', 'demand', 'escalate', 'escalation', 'not working', "doesn't work", 'failed to', 'never received', 'worst'];
const FEEDBACK_MARKERS = ['feedback', 'review', 'suggestion', 'suggest', 'would be better', 'could improve', 'rating', 'in my experience', 'found it', 'overall the'];
const OPINION_MARKERS = ['i think', 'i believe', 'we believe', 'in my view', 'in our view', 'arguably', 'should be', 'ought to', 'it seems', 'i feel', 'clearly', 'undoubtedly', 'the best', 'better than', 'worth'];
const INSTRUCTION_MARKERS = ['must', 'shall', 'should', 'ensure', 'do not', 'please', 'follow these', 'step', 'steps', 'first,', 'then,', 'finally,', 'click', 'select', 'enter', 'install', 'configure', 'run the', 'navigate'];
const NARRATIVE_MARKERS = ['he ', 'she ', 'they ', 'we ', 'i ', 'was ', 'were ', 'had ', 'went', 'said', 'told', 'remembered', 'later that', 'one day', 'afterwards', 'meanwhile', 'eventually'];
const IMPERATIVE_VERBS = new Set(['add', 'apply', 'avoid', 'check', 'choose', 'click', 'configure', 'confirm', 'connect', 'copy', 'create', 'define', 'delete', 'download', 'enable', 'ensure', 'enter', 'follow', 'install', 'keep', 'launch', 'make', 'note', 'open', 'press', 'read', 'remove', 'repeat', 'replace', 'review', 'run', 'save', 'select', 'set', 'start', 'stop', 'submit', 'update', 'upload', 'use', 'verify', 'wait']);

const MATH_SYMBOLS = /[=≈≤≥≠±×÷∑∏∫√∞∂∇∈∉⊂⊆→←↔]/g;
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must', 'this', 'that', 'these', 'those', 'it', 'its', 'their', 'them', 'they', 'we', 'our', 'us', 'you', 'your', 'he', 'she', 'his', 'her', 'not', 'no', 'nor', 'so', 'than', 'then', 'there', 'here', 'when', 'where', 'which', 'who', 'whom', 'what', 'how', 'why', 'all', 'any', 'both', 'each', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'also', 'into', 'over', 'under', 'about', 'after', 'before', 'between', 'through', 'during', 'up', 'down', 'out', 'off', 'again', 'further', 'once', 'because', 'while', 'very', 'per', 'via', 'upon', 'shall']);

export class HeuristicProvider implements AIAnalysisService {
  readonly id = 'heuristic';
  readonly model = 'local-lexicon-v1';
  readonly supportsSummary = false;
  readonly isLocal = true;

  async classify(request: ClassificationRequest): Promise<ClassificationResponse> {
    const classifications = request.units.map((unit) => classifyUnit(unit.id, unit.text, unit.unitType));
    return { classifications, missingIds: [], coercedFields: 0 };
  }

  /**
   * The local engine writes no prose. The orchestrator detects `supportsSummary === false`
   * and builds a summary from the aggregated statistics instead, which is why this returns a
   * clearly-marked placeholder rather than inventing an overview.
   */
  async summarize(_request: SummaryRequest): Promise<SummaryResponse> {
    return { headline: '', narrative: '', highlights: [] };
  }
}

/** Exported so the orchestrator can classify individual fallback units without a batch. */
export function classifyUnit(id: string, text: string, unitType: string): UnitClassification {
  const tokens = tokenize(text);
  const lower = ` ${text.toLowerCase()} `;

  const sentiment = scoreSentiment(tokens);
  const emotion = scoreEmotion(tokens, sentiment.label);
  const contentType = scoreContentType(text, lower, tokens, unitType);
  const topic = scoreTopic(tokens);

  // Confidence reflects how much lexical evidence was actually found, plus enough text to
  // judge it on. A five-word fragment with no lexicon hits lands near the floor.
  const evidence = sentiment.hits + emotion.hits + contentType.strength + topic.hits;
  const lengthFactor = Math.min(1, tokens.length / 40);
  const confidence = round2(0.32 + Math.min(0.42, evidence * 0.055) + lengthFactor * 0.16);

  return {
    id,
    sentiment: sentiment.label,
    emotion: emotion.label,
    contentType: contentType.label,
    topic: topic.label,
    confidence: Math.min(0.9, confidence),
    keywords: extractKeywords(tokens),
  };
}

function scoreSentiment(tokens: string[]): { label: string; hits: number } {
  let score = 0;
  let hits = 0;

  tokens.forEach((token, index) => {
    const polarity = POSITIVE.has(token) ? 1 : NEGATIVE.has(token) ? -1 : 0;
    if (polarity === 0) return;
    hits += 1;

    let weight = 1;
    // Look back two tokens for a negator or a modifier.
    for (let back = 1; back <= 2; back += 1) {
      const previous = tokens[index - back];
      if (previous === undefined) break;
      if (NEGATORS.has(previous)) weight *= -0.85;
      else if (INTENSIFIERS.has(previous)) weight *= 1.5;
      else if (DIMINISHERS.has(previous)) weight *= 0.6;
    }
    score += polarity * weight;
  });

  // A margin is required before calling polarity, so mixed or barely-charged text stays neutral.
  const threshold = 0.8;
  if (score >= threshold) return { label: 'positive', hits };
  if (score <= -threshold) return { label: 'negative', hits };
  return { label: 'neutral', hits };
}

function scoreEmotion(tokens: string[], sentiment: string): { label: string; hits: number } {
  const joined = tokens.join(' ');
  let best = { label: 'neutral', score: 0 };
  let hits = 0;

  for (const [emotion, terms] of Object.entries(EMOTION_LEXICON)) {
    let score = 0;
    for (const term of terms) {
      const occurrences = term.includes(' ')
        ? countOccurrences(joined, term)
        : tokens.reduce((total, token) => total + (token === term ? 1 : 0), 0);
      score += occurrences;
    }
    hits += score;
    if (score > best.score) best = { label: emotion, score };
  }

  if (best.score === 0) return { label: 'neutral', hits: 0 };
  // A single weak hit that contradicts the overall polarity is not enough to claim an emotion.
  const contradicts =
    (sentiment === 'positive' && (best.label === 'angry' || best.label === 'sad' || best.label === 'fear')) ||
    (sentiment === 'negative' && (best.label === 'happy' || best.label === 'excited'));
  if (contradicts && best.score < 2) return { label: 'neutral', hits };

  return { label: best.label, hits };
}

function scoreContentType(text: string, lower: string, tokens: string[], unitType: string): { label: string; strength: number } {
  if (unitType === 'equation') return { label: 'mathematical', strength: 4 };

  const symbols = text.match(MATH_SYMBOLS)?.length ?? 0;
  const digits = (text.match(/\d/g) ?? []).length;
  const letters = text.replace(/[^A-Za-z]/g, '').length;
  if (symbols >= 2 || (symbols >= 1 && digits > letters * 0.35)) return { label: 'mathematical', strength: 3 };

  if (/\?\s*$/.test(text.trim()) || /^(?:what|why|how|when|where|who|which|is|are|do|does|can|could|should|would)\b/i.test(text.trim())) {
    if (text.includes('?')) return { label: 'question', strength: 3 };
  }

  const complaint = countMarkers(lower, COMPLAINT_MARKERS);
  const feedback = countMarkers(lower, FEEDBACK_MARKERS);
  const opinion = countMarkers(lower, OPINION_MARKERS);
  const instruction = countMarkers(lower, INSTRUCTION_MARKERS);
  const narrative = countMarkers(lower, NARRATIVE_MARKERS);
  const technical = tokens.reduce((total, token) => total + (TECHNICAL_TERMS.has(token) ? 1 : 0), 0);

  const firstToken = tokens[0];
  const startsImperative = firstToken !== undefined && IMPERATIVE_VERBS.has(firstToken);

  const scores: Array<{ label: string; score: number }> = [
    { label: 'complaint', score: complaint * 2 },
    { label: 'feedback', score: feedback * 2 },
    { label: 'opinion', score: opinion * 1.6 },
    { label: 'instruction', score: instruction + (startsImperative ? 2.5 : 0) },
    { label: 'technical', score: technical * 1.1 },
    { label: 'narrative', score: narrative * 0.7 },
  ].sort((a, b) => b.score - a.score);

  const top = scores[0];
  if (top && top.score >= 2) return { label: top.label, strength: Math.min(4, top.score) };
  if (unitType === 'heading' || unitType === 'table_row') return { label: 'informational', strength: 1 };
  return { label: 'informational', strength: top ? Math.min(2, top.score) : 0 };
}

function scoreTopic(tokens: string[]): { label: string; hits: number } {
  const counts = new Map<string, number>();
  let hits = 0;

  for (const token of tokens) {
    for (const [topic, terms] of Object.entries(TOPIC_LEXICON)) {
      if (terms.includes(token)) {
        counts.set(topic, (counts.get(topic) ?? 0) + 1);
        hits += 1;
      }
    }
  }

  let best: { label: string; score: number } = { label: 'other', score: 0 };
  for (const [topic, score] of counts) {
    if (score > best.score) best = { label: topic, score };
  }
  return best.score >= 2 ? { label: best.label, hits } : { label: 'other', hits };
}

function extractKeywords(tokens: string[]): string[] {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (token.length < 4 || STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    // Frequency first, then longer terms, which are the more specific ones.
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 4)
    .map(([term]) => term);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .match(/[a-z][a-z'-]*/g)
    ?.map((token) => token.replace(/^-+|-+$/g, ''))
    .filter((token) => token.length > 0) ?? [];
}

function countMarkers(haystack: string, markers: string[]): number {
  return markers.reduce((total, marker) => total + countOccurrences(haystack, marker), 0);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Exposed for the aggregator's sanity checks and tests. */
export function emptySentimentDistribution(): Record<string, number> {
  return emptyDistribution('sentiment');
}
