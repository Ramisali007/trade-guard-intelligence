/**
 * End-to-end smoke test, run with `npm run smoke`.
 *
 * It generates a small PDF in memory, pushes it through the real pipeline — the same extractor,
 * segmenter, chunker, classifier, aggregator and report writer the API uses — and asserts on the
 * output. No HTTP, no browser, no fixtures on disk.
 *
 * The point is to catch the failures that are expensive to find by hand: an extractor that
 * returns nothing, a segmenter that loses pages, a classification that never arrives, a report
 * missing a section. It runs against the configured provider, so with no API key set it verifies
 * the local engine, and with a key set it verifies the model path too.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, ensureRuntimeDirectories } from '../src/config';
import { initRepository, closeRepository, getRepository } from '../src/services/document.repository';
import { DocumentService } from '../src/services/document.service';
import { AnalysisService } from '../src/services/analysis.service';
import { getProvider } from '../src/ai';
import { buildSamplePdf } from './build-sample-pdf';

const PASSAGES = [
  'The quarterly results exceeded every target we set. Revenue grew by 24 percent and customer satisfaction reached its highest level in three years. The team deserves real credit for this outcome.',
  'Unfortunately the migration failed twice during the maintenance window. Three services were unavailable for over an hour and the rollback did not complete cleanly. Customers noticed, and several complained.',
  'The system processes each request in three stages: validation, transformation and persistence. Each stage writes an audit record before handing off to the next.',
  'Let f(x) = 3x^2 + 2x - 5. The derivative f\'(x) = 6x + 2 is zero at x = -1/3, which is therefore the vertex of the parabola.',
  'Please submit your completed form before the fifteenth of the month. Attach a copy of your identification and sign both pages.',
  'What happens if the payment fails after the order has already shipped?',
  'I honestly think the new interface is a step backwards. It looks cleaner, but everything I do every day now takes two more clicks than it used to.',
  'Total assets increased to 4.2 billion at year end, against liabilities of 2.8 billion. Net interest margin was unchanged at 3.1 percent.',
];

async function main(): Promise<void> {
  const started = Date.now();
  console.log('DocuIntel smoke test');
  console.log('='.repeat(78));

  ensureRuntimeDirectories();
  const repository = await initRepository();
  const provider = getProvider();

  console.log(`storage : ${repository.driver}`);
  console.log(`engine  : ${provider.id} (${provider.model})${provider.isLocal ? ' — local, no API key set' : ''}`);
  console.log('');

  const documents = new DocumentService();
  const analysis = new AnalysisService(repository);

  // ---------------------------------------------------------------- 1. rejection paths
  console.log('1. validation');
  await expectRejection('an empty file', () =>
    documents.createFromUpload(
      { originalname: 'empty.pdf', mimetype: 'application/pdf', size: 0, buffer: Buffer.alloc(0) },
      { autoStart: false },
    ),
  );
  await expectRejection('a disallowed extension', () =>
    documents.createFromUpload(
      { originalname: 'notes.txt', mimetype: 'application/pdf', size: 12, buffer: Buffer.from('hello world!') },
      { autoStart: false },
    ),
  );
  await expectRejection('a file whose bytes are not a document', () =>
    documents.createFromUpload(
      { originalname: 'fake.pdf', mimetype: 'application/pdf', size: 12, buffer: Buffer.from('not a pdf at') },
      { autoStart: false },
    ),
  );

  // ---------------------------------------------------------------- 2. upload
  console.log('\n2. upload');
  const pdf = buildSamplePdf(PASSAGES);
  const record = await documents.createFromUpload(
    { originalname: 'smoke-test.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf },
    { autoStart: false },
  );
  assert.equal(record.status, 'uploaded');
  assert.equal(record.fileType, 'pdf');
  console.log(`   accepted ${record.filename} (${record.fileSize} bytes) as ${record.id}`);

  // ---------------------------------------------------------------- 3. pipeline
  console.log('\n3. analysis');
  await analysis.run(record.id);

  const status = await documents.getStatus(record.id);
  if (status.status !== 'completed') {
    console.error(`   FAILED: status is "${status.status}"`);
    console.error(`   ${status.error?.code}: ${status.error?.message}`);
    process.exitCode = 1;
    await closeRepository();
    return;
  }

  const results = await documents.getResults(record.id);
  const stats = results.analysis?.statistics;
  const summary = results.analysis?.summary;
  assert.ok(stats && summary, 'analysis is missing from a completed document');

  console.log(`   status    : ${status.status} at ${status.progress.percent}%`);
  console.log(`   pages     : ${stats.totalPages}`);
  console.log(`   passages  : ${stats.totalUnits} (${stats.aiClassifiedUnits} by model, ${stats.heuristicClassifiedUnits} local)`);
  console.log(`   sentiment : ${describeDistribution(stats.distributions['sentiment'])}`);
  console.log(`   emotion   : ${describeDistribution(stats.distributions['emotion'])}`);
  console.log(`   type      : ${describeDistribution(stats.distributions['contentType'])}`);
  console.log(`   dominant  : ${summary.dominantSentiment} / ${summary.dominantEmotion} / ${summary.dominantContentType}`);
  console.log(`   headline  : ${summary.headline}`);
  console.log(`   engine    : ${results.analysis?.engine.provider} — ${results.analysis?.engine.aiRequests} request(s), degraded=${results.analysis?.engine.degraded}`);
  console.log(`   duration  : ${results.analysis?.timing.totalMs} ms`);

  // Every stage finished, and progress is a real 100 rather than a hopeful one.
  assert.equal(status.progress.percent, 100, 'a completed document must report 100%');
  assert.ok(
    status.progress.stages.every((stage) => stage.state === 'done'),
    'every stage of a completed run must be done',
  );
  assert.ok(stats.totalUnits > 0, 'segmentation produced no passages');
  assert.equal(status.progress.analyzedUnits, stats.totalUnits, 'not every passage was classified');
  assert.ok(stats.totalWords > 100, `expected the sample text to survive extraction, got ${stats.totalWords} words`);

  // The fixture spans several pages on purpose: page context is the thing most easily lost in
  // extraction, and the page timeline is what the results dashboard charts.
  assert.ok(stats.totalPages > 1, `expected a multi-page document, got ${stats.totalPages}`);
  assert.equal(stats.pageTimeline.length, stats.totalPages, 'the page timeline does not cover every page');
  assert.ok(stats.sectionBreakdown.length > 0, 'no sections were detected in a document that has headings');

  // The distributions have to account for every passage, or a chart would silently under-report.
  for (const dimension of ['sentiment', 'emotion', 'contentType', 'topic'] as const) {
    const distribution = stats.distributions[dimension] as Record<string, number> | undefined;
    assert.ok(distribution, `no distribution for ${dimension}`);
    const counted = Object.values(distribution).reduce((sum: number, count: number) => sum + count, 0);
    assert.equal(counted, stats.totalUnits, `${dimension} distribution counts ${counted} of ${stats.totalUnits}`);
  }

  // The document is opinionated on purpose: the first passage is clearly positive, the second
  // clearly negative. An engine that finds neither is not working.
  const sentiment: Record<string, number> = stats.distributions['sentiment'] ?? {};
  assert.ok((sentiment['positive'] ?? 0) > 0, 'expected at least one positive passage');
  assert.ok((sentiment['negative'] ?? 0) > 0, 'expected at least one negative passage');

  // ---------------------------------------------------------------- 4. paging and filtering
  console.log('\n4. results paging');
  const firstPage = await documents.getUnits(record.id, { page: 1, pageSize: 3 });
  assert.equal(firstPage.items.length, Math.min(3, stats.totalUnits));
  assert.equal(firstPage.unfilteredTotal, stats.totalUnits);
  console.log(`   page 1 of ${Math.ceil(firstPage.total / firstPage.pageSize)}: ${firstPage.items.length} of ${firstPage.total}`);

  const negativeOnly = await documents.getUnits(record.id, { page: 1, pageSize: 50, sentiment: ['negative'] });
  assert.ok(negativeOnly.items.every((unit) => unit.classification.sentiment === 'negative'), 'filter leaked other rows');
  console.log(`   filtered to negative: ${negativeOnly.total} of ${negativeOnly.unfilteredTotal}`);

  const searched = await documents.getUnits(record.id, { page: 1, pageSize: 50, search: 'migration' });
  console.log(`   search "migration": ${searched.total} match(es)`);
  assert.ok(searched.total > 0, 'full-text search found nothing that is definitely present');

  // Passage context must survive the whole pipeline, or the report and explorer are meaningless.
  const first = firstPage.items[0];
  assert.ok(first, 'no passages returned');
  assert.ok(first.pageNumber >= 1, 'passage lost its page number');
  assert.ok(first.paragraphNumber >= 1, 'passage lost its paragraph number');
  assert.ok(first.text.trim().length > 0, 'passage lost its text');
  assert.ok(first.classification.confidence > 0 && first.classification.confidence <= 1, 'confidence out of range');

  // ---------------------------------------------------------------- 5. report
  console.log('\n5. report');
  const report = await documents.getReport(record.id);
  const requiredSections = [
    'DOCUMENT ANALYSIS REPORT',
    'OVERVIEW',
    'SENTIMENT SUMMARY',
    'EMOTION SUMMARY',
    'CONTENT TYPE SUMMARY',
    'PAGE-BY-PAGE SENTIMENT',
    'DETAILED ANALYSIS',
    'NOTES AND LIMITATIONS',
    'END OF REPORT',
  ];
  for (const section of requiredSections) {
    assert.ok(report.content.includes(section), `the report is missing its "${section}" section`);
  }
  assert.ok(report.content.includes('Paragraph 1'), 'the report has no per-paragraph detail');
  console.log(`   ${report.filename}: ${report.content.length.toLocaleString('en-US')} characters, ${report.content.split('\n').length} lines`);
  for (const section of requiredSections) console.log(`   contains ${section}`);

  // ---------------------------------------------------------------- 6. cleanup
  console.log('\n6. deletion');
  const storagePath = record.storagePath;
  await documents.delete(record.id);
  assert.equal(await getRepository().findMeta(record.id), null, 'the document survived deletion');
  if (storagePath) {
    assert.equal(await exists(storagePath), false, 'the uploaded file survived deletion');
  }
  assert.equal(
    await exists(path.join(config.upload.dataDir, `${record.id}.report.txt`)),
    false,
    'the cached report survived deletion',
  );
  console.log('   document, upload and cached report all removed');

  await closeRepository();
  console.log('');
  console.log('='.repeat(78));
  console.log(`PASSED in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function expectRejection(what: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`   rejected ${what}: ${message}`);
    return;
  }
  throw new Error(`${what} was accepted but should have been rejected`);
}

function describeDistribution(distribution: Record<string, number> | undefined): string {
  if (!distribution) return '(none)';
  return (
    Object.entries(distribution)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => `${value} ${count}`)
      .join(', ') || '(all zero)'
  );
}

async function exists(target: string): Promise<boolean> {
  return fs
    .access(target)
    .then(() => true)
    .catch(() => false);
}

void main().catch((error: unknown) => {
  console.error('\nFAILED');
  console.error(error);
  process.exitCode = 1;
  void closeRepository();
});