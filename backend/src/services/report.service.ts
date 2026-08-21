import { TAXONOMY, getDimension, type DimensionId } from '../config/taxonomy';
import type { AnalyzedUnit, DocumentRecord } from '../models/document.model';

/**
 * Stage 7: the downloadable `.txt` report.
 *
 * Written for a person reading it in Notepad — fixed-width rules, aligned columns, no markup.
 * It is generated from the same stored analysis the dashboard renders, so the two can never
 * disagree, and it states its own caveats (estimated pagination, locally-classified passages,
 * passages left out by the unit cap) instead of presenting a partial run as a complete one.
 */

const WIDTH = 78;
const MAJOR_RULE = '='.repeat(WIDTH);
const MINOR_RULE = '-'.repeat(WIDTH);

export function generateTextReport(document: DocumentRecord): string {
  const analysis = document.analysis;
  const lines: string[] = [];

  lines.push(MAJOR_RULE);
  lines.push(centre('DOCUMENT ANALYSIS REPORT'));
  lines.push(centre('DocuIntel — AI Document Intelligence'));
  lines.push(MAJOR_RULE);
  lines.push('');

  // ---------------------------------------------------------------- document meta
  const stats = analysis?.statistics;
  lines.push(field('File Name', document.filename));
  lines.push(field('File Type', document.fileType.toUpperCase()));
  lines.push(field('File Size', formatBytes(document.fileSize)));
  lines.push(
    field(
      'Total Pages',
      document.extraction
        ? `${document.extraction.pageCount}${document.extraction.pagesEstimated ? ' (estimated — this format has no fixed page breaks)' : ''}`
        : 'unknown',
    ),
  );
  lines.push(field('Total Paragraphs', stats ? String(stats.analyzedUnits) : '0'));
  lines.push(field('Total Words', stats ? stats.totalWords.toLocaleString('en-US') : '0'));
  lines.push(field('Uploaded', formatTimestamp(document.uploadedAt)));
  lines.push(field('Analysed', analysis ? formatTimestamp(analysis.completedAt) : 'not completed'));
  lines.push(field('Processing Time', analysis ? formatDuration(analysis.timing.totalMs) : 'n/a'));
  lines.push(field('Analysis Engine', analysis ? `${analysis.engine.provider} / ${analysis.engine.model}` : 'n/a'));
  lines.push('');

  if (!analysis || !stats) {
    lines.push(MINOR_RULE);
    lines.push('STATUS');
    lines.push(MINOR_RULE);
    lines.push('');
    lines.push(`This document has not been analysed. Current status: ${document.status}.`);
    if (document.error) lines.push(`Reason: ${document.error.message}`);
    lines.push('');
    lines.push(MAJOR_RULE);
    lines.push(centre('END OF REPORT'));
    lines.push(MAJOR_RULE);
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- overview
  lines.push(MINOR_RULE);
  lines.push('OVERVIEW');
  lines.push(MINOR_RULE);
  lines.push('');
  lines.push(...wrap(analysis.summary.headline, WIDTH));
  lines.push('');
  lines.push(...wrap(analysis.summary.narrative, WIDTH));
  if (analysis.summary.highlights.length > 0) {
    lines.push('');
    lines.push('Key findings:');
    for (const highlight of analysis.summary.highlights) {
      lines.push(...wrap(highlight, WIDTH - 4, '  * ', '    '));
    }
  }
  lines.push('');
  lines.push(
    `Overview source: ${analysis.summary.source === 'ai' ? 'written by the analysis model' : 'derived from the classification counts'}`,
  );
  lines.push('');

  // ---------------------------------------------------------------- per-dimension summaries
  const total = stats.analyzedUnits;
  for (const dimension of TAXONOMY) {
    lines.push(MINOR_RULE);
    lines.push(`${dimension.label.toUpperCase()} SUMMARY`);
    lines.push(MINOR_RULE);
    lines.push('');
    lines.push(...distributionBlock(stats.distributions[dimension.id] ?? {}, dimension.id, total));
    lines.push('');
  }

  // ---------------------------------------------------------------- structure
  lines.push(MINOR_RULE);
  lines.push('DOCUMENT STRUCTURE');
  lines.push(MINOR_RULE);
  lines.push('');
  for (const [type, count] of Object.entries(stats.unitTypeDistribution)) {
    if (count === 0) continue;
    lines.push(`  ${padEnd(titleCase(type), 22)} ${padStart(String(count), 6)}`);
  }
  lines.push('');
  if (stats.sectionBreakdown.length > 0) {
    lines.push('  Sections by size:');
    lines.push(`  ${padEnd('SECTION', 40)} ${padStart('UNITS', 6)}  ${padEnd('TONE', 10)} NET`);
    for (const section of stats.sectionBreakdown.slice(0, 15)) {
      lines.push(
        `  ${padEnd(truncate(section.section, 40), 40)} ${padStart(String(section.units), 6)}  ${padEnd(labelOf('sentiment', section.dominantSentiment), 10)} ${formatSigned(section.netSentiment)}`,
      );
    }
    lines.push('');
  }

  // ---------------------------------------------------------------- page timeline
  lines.push(MINOR_RULE);
  lines.push('PAGE-BY-PAGE SENTIMENT');
  lines.push(MINOR_RULE);
  lines.push('');
  lines.push(`  ${padStart('PAGE', 5)}  ${padStart('UNITS', 5)}  ${padStart('POS', 4)} ${padStart('NEU', 4)} ${padStart('NEG', 4)}  ${padStart('NET', 6)}  DOMINANT EMOTION`);
  for (const page of stats.pageTimeline) {
    lines.push(
      `  ${padStart(String(page.pageNumber), 5)}  ${padStart(String(page.units), 5)}  ` +
        `${padStart(String(page.sentiment['positive'] ?? 0), 4)} ${padStart(String(page.sentiment['neutral'] ?? 0), 4)} ${padStart(String(page.sentiment['negative'] ?? 0), 4)}  ` +
        `${padStart(formatSigned(page.netSentiment), 6)}  ${labelOf('emotion', page.dominantEmotion)}`,
    );
  }
  lines.push('');

  if (stats.topKeywords.length > 0) {
    lines.push(MINOR_RULE);
    lines.push('RECURRING TERMS');
    lines.push(MINOR_RULE);
    lines.push('');
    for (const keyword of stats.topKeywords) {
      lines.push(`  ${padEnd(keyword.term, 30)} ${padStart(String(keyword.count), 5)}`);
    }
    lines.push('');
  }

  // ---------------------------------------------------------------- detailed analysis
  lines.push(MAJOR_RULE);
  lines.push('DETAILED ANALYSIS');
  lines.push(MAJOR_RULE);
  lines.push('');

  let currentPage: number | null = null;
  let currentSection: string | null = null;

  for (const unit of document.units) {
    if (unit.pageNumber !== currentPage) {
      currentPage = unit.pageNumber;
      currentSection = null;
      lines.push('');
      lines.push(`PAGE ${currentPage}`);
      lines.push('-'.repeat(`PAGE ${currentPage}`.length));
    }
    if (unit.section !== currentSection) {
      currentSection = unit.section;
      if (currentSection) {
        lines.push('');
        lines.push(`  Section: ${truncate(currentSection, WIDTH - 13)}`);
      }
    }

    lines.push('');
    lines.push(`  Paragraph ${unit.paragraphNumber} (${titleCase(unit.unitType)})`);
    lines.push(...wrap(unit.text, WIDTH - 10, '    Text: ', '          '));
    lines.push(`    Sentiment    : ${labelOf('sentiment', unit.classification.sentiment)}`);
    lines.push(`    Emotion      : ${labelOf('emotion', unit.classification.emotion)}`);
    lines.push(`    Content Type : ${labelOf('contentType', unit.classification.contentType)}`);
    lines.push(`    Topic        : ${labelOf('topic', unit.classification.topic)}`);
    lines.push(`    Confidence   : ${(unit.classification.confidence * 100).toFixed(0)}%`);
    if (unit.classification.keywords.length > 0) {
      lines.push(`    Keywords     : ${unit.classification.keywords.join(', ')}`);
    }
    if (unit.classification.source !== 'ai') {
      lines.push('    Note         : classified by the local engine, not the AI model');
    }
  }

  // ---------------------------------------------------------------- caveats & footer
  const notes = buildNotes(document);
  if (notes.length > 0) {
    lines.push('');
    lines.push('');
    lines.push(MINOR_RULE);
    lines.push('NOTES AND LIMITATIONS');
    lines.push(MINOR_RULE);
    lines.push('');
    for (const note of notes) lines.push(...wrap(note, WIDTH - 4, '  * ', '    '));
    lines.push('');
  }

  lines.push('');
  lines.push(MAJOR_RULE);
  lines.push(centre('END OF REPORT'));
  lines.push(centre(`Generated ${formatTimestamp(new Date().toISOString())}`));
  lines.push(MAJOR_RULE);

  return lines.join('\n');
}

function buildNotes(document: DocumentRecord): string[] {
  const notes: string[] = [];
  const stats = document.analysis?.statistics;
  const engine = document.analysis?.engine;

  if (document.extraction?.pagesEstimated) {
    notes.push(
      'Page numbers are estimated. The source format stores no fixed page breaks, so pages were derived from content length.',
    );
  }
  for (const warning of document.extraction?.warnings ?? []) notes.push(warning);

  if (stats && stats.skippedOverCapUnits > 0) {
    notes.push(
      `${stats.skippedOverCapUnits.toLocaleString('en-US')} passages beyond the configured analysis limit were not classified and do not appear above.`,
    );
  }
  if (stats && stats.skippedShortUnits > 0) {
    notes.push(
      `${stats.skippedShortUnits.toLocaleString('en-US')} very short passages (headings, labels, fragments) were classified by the local engine rather than the AI model, which is more predictable on fragments.`,
    );
  }
  if (engine?.degraded) {
    notes.push(
      'Part of this document was classified by the local engine because the AI model could not be reached for every batch. Affected passages are marked above.',
    );
  }
  for (const note of engine?.notes ?? []) notes.push(note);

  return notes;
}

function distributionBlock(distribution: Record<string, number>, dimension: DimensionId, total: number): string[] {
  const definition = getDimension(dimension);
  const lines: string[] = [];

  for (const value of definition.values) {
    const count = distribution[value.id] ?? 0;
    const percent = total > 0 ? (count / total) * 100 : 0;
    lines.push(
      `  ${padEnd(value.label, 18)} ${padStart(count.toLocaleString('en-US'), 7)}  ${padStart(`${percent.toFixed(1)}%`, 6)}  ${bar(percent)}`,
    );
  }
  lines.push('');
  lines.push(`  ${padEnd('Total', 18)} ${padStart(total.toLocaleString('en-US'), 7)}`);
  return lines;
}

/** Fixed-scale bar so a reader can compare two reports side by side. */
function bar(percent: number): string {
  const filled = Math.round((percent / 100) * 28);
  return `${'#'.repeat(filled)}${'.'.repeat(28 - filled)}`;
}

function field(label: string, value: string): string {
  return `${padEnd(`${label}:`, 20)}${value}`;
}

function centre(text: string): string {
  const padding = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  return `${' '.repeat(padding)}${text}`;
}

/** Word wrap that never breaks a word and keeps a hanging indent aligned. */
function wrap(text: string, width: number, firstPrefix = '', continuation = ''): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = firstPrefix;
  let isFirst = true;

  for (const word of words) {
    const prefix = isFirst ? firstPrefix : continuation;
    if (current.length > prefix.length && current.length + 1 + word.length > width + prefix.length) {
      lines.push(current);
      isFirst = false;
      current = `${continuation}${word}`;
    } else if (current.length === prefix.length) {
      current = `${current}${word}`;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current.trim().length > 0) lines.push(current);
  return lines;
}

function labelOf(dimension: DimensionId, value: string): string {
  return getDimension(dimension).values.find((entry) => entry.id === value)?.label ?? value;
}

function padEnd(text: string, width: number): string {
  return text.length >= width ? text : `${text}${' '.repeat(width - text.length)}`;
}

function padStart(text: string, width: number): string {
  return text.length >= width ? text : `${' '.repeat(width - text.length)}${text}`;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

function formatSigned(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} seconds`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/** Filename for the download, derived from the source document. */
export function reportFilename(document: DocumentRecord): string {
  const base = document.filename.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'document';
  return `${base}-analysis.txt`;
}