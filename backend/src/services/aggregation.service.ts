import { TAXONOMY, emptyDistribution, getDimension, UNIT_TYPES, type DimensionId } from '../config/taxonomy';
import type {
  AnalysisSummary,
  AnalyzedUnit,
  PageTimelineEntry,
  Statistics,
} from '../models/document.model';

/**
 * Stage 6: fold per-passage classifications into the document-level numbers the dashboard,
 * the charts and the report all read from.
 *
 * Every figure here is counted from real classified passages. Nothing is estimated, seeded or
 * padded: a distribution that is all zeros means no passage carried that value, and a
 * document with two paragraphs reports two paragraphs.
 */

export interface AggregationInput {
  units: AnalyzedUnit[];
  pageCount: number;
  totalUnits: number;
  shortUnits: number;
  skippedOverCapUnits: number;
  totalWords: number;
  totalCharacters: number;
}

const SENTIMENT_WEIGHT: Record<string, number> = { positive: 1, neutral: 0, negative: -1 };

export function aggregate(input: AggregationInput): Statistics {
  const { units } = input;

  const distributions: Record<string, Record<string, number>> = {};
  for (const dimension of TAXONOMY) distributions[dimension.id] = emptyDistribution(dimension.id);

  const unitTypeDistribution: Record<string, number> = {};
  for (const type of UNIT_TYPES) unitTypeDistribution[type.id] = 0;

  const pages = new Map<number, AnalyzedUnit[]>();
  const sections = new Map<string, AnalyzedUnit[]>();
  const keywordCounts = new Map<string, { term: string; count: number }>();

  let confidenceTotal = 0;
  let aiClassifiedUnits = 0;
  let heuristicClassifiedUnits = 0;

  for (const unit of units) {
    for (const dimension of TAXONOMY) {
      const value = unit.classification[dimension.id];
      const bucket = distributions[dimension.id];
      if (bucket && typeof value === 'string' && value in bucket) {
        bucket[value] = (bucket[value] ?? 0) + 1;
      }
    }

    unitTypeDistribution[unit.unitType] = (unitTypeDistribution[unit.unitType] ?? 0) + 1;

    const pageBucket = pages.get(unit.pageNumber);
    if (pageBucket) pageBucket.push(unit);
    else pages.set(unit.pageNumber, [unit]);

    const sectionKey = unit.section ?? 'Untitled section';
    const sectionBucket = sections.get(sectionKey);
    if (sectionBucket) sectionBucket.push(unit);
    else sections.set(sectionKey, [unit]);

    for (const keyword of unit.classification.keywords) {
      const key = keyword.toLowerCase();
      const existing = keywordCounts.get(key);
      if (existing) existing.count += 1;
      else keywordCounts.set(key, { term: keyword, count: 1 });
    }

    confidenceTotal += unit.classification.confidence;
    if (unit.classification.source === 'ai') aiClassifiedUnits += 1;
    else heuristicClassifiedUnits += 1;
  }

  const pageTimeline: PageTimelineEntry[] = [...pages.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, pageUnits]) => {
      const sentiment = emptyDistribution('sentiment');
      for (const unit of pageUnits) {
        const value = unit.classification.sentiment;
        if (value in sentiment) sentiment[value] = (sentiment[value] ?? 0) + 1;
      }
      return {
        pageNumber,
        units: pageUnits.length,
        sentiment,
        netSentiment: netSentimentOf(pageUnits),
        dominantSentiment: dominantOf(pageUnits, 'sentiment'),
        dominantEmotion: dominantOf(pageUnits, 'emotion'),
        dominantContentType: dominantOf(pageUnits, 'contentType'),
      };
    });

  const sectionBreakdown = [...sections.entries()]
    .map(([section, sectionUnits]) => ({
      section,
      units: sectionUnits.length,
      dominantSentiment: dominantOf(sectionUnits, 'sentiment'),
      dominantContentType: dominantOf(sectionUnits, 'contentType'),
      netSentiment: netSentimentOf(sectionUnits),
    }))
    .sort((a, b) => b.units - a.units)
    .slice(0, 40);

  return {
    totalPages: Math.max(input.pageCount, pageTimeline.at(-1)?.pageNumber ?? 0),
    totalUnits: input.totalUnits,
    analyzedUnits: units.length,
    skippedShortUnits: input.shortUnits,
    skippedOverCapUnits: input.skippedOverCapUnits,
    totalWords: input.totalWords,
    totalCharacters: input.totalCharacters,
    aiClassifiedUnits,
    heuristicClassifiedUnits,
    averageConfidence: units.length > 0 ? round3(confidenceTotal / units.length) : 0,
    distributions,
    unitTypeDistribution,
    pageTimeline,
    topKeywords: [...keywordCounts.values()]
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
      .slice(0, 20),
    sectionBreakdown,
  };
}

/**
 * The overview used when the model wrote no prose — either because the local engine is in
 * use or because the summary call failed. It states only what the counts support, and the
 * `source: 'derived'` flag tells the UI to label it as such.
 */
export function deriveSummary(statistics: Statistics, filename: string, pagesEstimated: boolean): AnalysisSummary {
  const sentiment = topValue(statistics.distributions['sentiment']);
  const emotion = topValue(statistics.distributions['emotion']);
  const contentType = topValue(statistics.distributions['contentType']);
  const topic = topValue(statistics.distributions['topic']);

  const total = statistics.analyzedUnits;
  const share = (dimension: DimensionId, value: string): number => {
    const count = statistics.distributions[dimension]?.[value] ?? 0;
    return total > 0 ? Math.round((count / total) * 100) : 0;
  };

  const contentLabel = labelOf('contentType', contentType);
  const sentimentLabel = labelOf('sentiment', sentiment);
  const pageWord = pagesEstimated ? 'estimated pages' : 'pages';

  const headline =
    total === 0
      ? `No classifiable passages were found in ${filename}.`
      : `${contentLabel} document, predominantly ${sentimentLabel.toLowerCase()} in tone across ${statistics.totalPages} ${pageWord}.`;

  const narrativeParts: string[] = [];
  if (total > 0) {
    narrativeParts.push(
      `${total.toLocaleString()} passages were classified across ${statistics.totalPages} ${pageWord}. ${share('sentiment', sentiment)}% read as ${sentimentLabel.toLowerCase()}, and ${labelOf('contentType', contentType).toLowerCase()} is the most common content type at ${share('contentType', contentType)}%.`,
    );
    if (emotion === 'neutral') {
      narrativeParts.push('Most passages carry no strong emotional charge, which is typical of factual or procedural writing.');
    } else {
      narrativeParts.push(
        `${labelOf('emotion', emotion)} is the most frequently detected emotion, in ${share('emotion', emotion)}% of passages.`,
      );
    }
    const swing = mostPolarisedPage(statistics.pageTimeline);
    if (swing) {
      narrativeParts.push(
        `Tone is not uniform: page ${swing.pageNumber} is the most strongly ${swing.netSentiment > 0 ? 'positive' : 'negative'} in the document.`,
      );
    }
  } else {
    narrativeParts.push('The document was read successfully but contained no passages long enough to classify.');
  }

  const highlights: string[] = [];
  if (total > 0) {
    highlights.push(`${share('sentiment', 'positive')}% positive, ${share('sentiment', 'neutral')}% neutral, ${share('sentiment', 'negative')}% negative`);
    highlights.push(`Dominant content type: ${labelOf('contentType', contentType)} (${share('contentType', contentType)}%)`);
    if (topic !== 'other') highlights.push(`Primary subject area: ${labelOf('topic', topic)} (${share('topic', topic)}%)`);
    const math = statistics.distributions['contentType']?.['mathematical'] ?? 0;
    if (math > 0) highlights.push(`${math.toLocaleString()} passages contain mathematical content`);
    if (statistics.topKeywords.length > 0) {
      highlights.push(`Recurring terms: ${statistics.topKeywords.slice(0, 5).map((entry) => entry.term).join(', ')}`);
    }
    if (statistics.heuristicClassifiedUnits > 0 && statistics.aiClassifiedUnits > 0) {
      highlights.push(`${statistics.heuristicClassifiedUnits.toLocaleString()} passages were classified locally rather than by the AI model`);
    }
  }

  return {
    headline,
    narrative: narrativeParts.join(' '),
    dominantSentiment: sentiment,
    dominantEmotion: emotion,
    dominantContentType: contentType,
    dominantTopic: topic,
    source: 'derived',
    highlights: highlights.slice(0, 5),
  };
}

/** Merge model-written prose onto the counted dominants, which are never taken from the model. */
export function mergeAiSummary(
  derived: AnalysisSummary,
  ai: { headline: string; narrative: string; highlights: string[] },
): AnalysisSummary {
  if (ai.headline.trim().length === 0 || ai.narrative.trim().length === 0) return derived;
  return {
    ...derived,
    headline: ai.headline,
    narrative: ai.narrative,
    highlights: ai.highlights.length > 0 ? ai.highlights : derived.highlights,
    source: 'ai',
  };
}

/** A spread of passages across the document, used as the summary prompt's evidence. */
export function selectExcerpts(units: AnalyzedUnit[], limit = 18): Array<{ pageNumber: number; section: string | null; text: string }> {
  const candidates = units.filter((unit) => unit.unitType !== 'table_row' && unit.wordCount >= 12);
  const pool = candidates.length >= limit ? candidates : units;
  if (pool.length === 0) return [];

  const step = Math.max(1, Math.floor(pool.length / limit));
  const picked: AnalyzedUnit[] = [];
  for (let i = 0; i < pool.length && picked.length < limit; i += step) {
    const unit = pool[i];
    if (unit) picked.push(unit);
  }

  return picked.map((unit) => ({
    pageNumber: unit.pageNumber,
    section: unit.section,
    // Excerpts are for the overview prompt only; the full text is never truncated in storage.
    text: unit.text.length > 420 ? `${unit.text.slice(0, 419)}…` : unit.text,
  }));
}

function dominantOf(units: AnalyzedUnit[], dimension: DimensionId): string {
  const counts = new Map<string, number>();
  for (const unit of units) {
    const value = unit.classification[dimension];
    if (typeof value !== 'string') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = getDimension(dimension).fallback;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function netSentimentOf(units: AnalyzedUnit[]): number {
  if (units.length === 0) return 0;
  const total = units.reduce((sum, unit) => sum + (SENTIMENT_WEIGHT[unit.classification.sentiment] ?? 0), 0);
  return round3(total / units.length);
}

function topValue(distribution: Record<string, number> | undefined): string {
  if (!distribution) return 'neutral';
  let best = 'neutral';
  let bestCount = -1;
  for (const [value, count] of Object.entries(distribution)) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function labelOf(dimension: DimensionId, value: string): string {
  return getDimension(dimension).values.find((entry) => entry.id === value)?.label ?? value;
}

function mostPolarisedPage(timeline: PageTimelineEntry[]): PageTimelineEntry | null {
  let best: PageTimelineEntry | null = null;
  for (const entry of timeline) {
    if (entry.units < 2) continue;
    if (best === null || Math.abs(entry.netSentiment) > Math.abs(best.netSentiment)) best = entry;
  }
  return best !== null && Math.abs(best.netSentiment) >= 0.3 ? best : null;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}