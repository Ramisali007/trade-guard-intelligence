import assert from 'node:assert';
import crypto from 'node:crypto';
import { getDocumentService, type UploadedFile } from '../services/document.service';
import { initRepository, closeRepository, getRepository } from '../services/document.repository';
import type { DocumentRecord } from '../models/document.model';

function createMockFile(filename: string, content: string): UploadedFile {
  const buffer = Buffer.from(content, 'utf8');
  return {
    originalname: filename,
    mimetype: filename.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
    size: buffer.length,
    buffer,
  };
}

async function runTests() {
  console.log('================================================================');
  console.log('STARTING DOCUMENT DEDUPLICATION & ANALYSIS HISTORY TEST SUITE');
  console.log('================================================================\n');

  const repository = await initRepository();
  const service = getDocumentService();

  const fileBytesA = '%PDF-1.4 Mock Trade Presentation Letter of Credit LC-9988231';
  const fileBytesB = '%PDF-1.4 Mock Bill of Lading BL-445566 Singapore Port';
  const fileBytesC = '%PDF-1.4 Mock Certificate of Origin COO-778811 Chamber';

  const customer1 = `test-tenant-${Date.now()}-A`;
  const customer2 = `test-tenant-${Date.now()}-B`;

  // --------------------------------------------------------------------------
  // Scenario 1: Initial Upload
  // --------------------------------------------------------------------------
  console.log('Scenario 1: Testing initial upload of a brand new trade document...');
  const file1 = createMockFile('Letter_of_Credit.pdf', fileBytesA);
  const doc1 = await service.createFromUpload(file1, { autoStart: false, customerId: customer1 });

  assert.strictEqual(doc1.isDuplicate, false, 'Expected isDuplicate to be false on first upload');
  assert.strictEqual(doc1.duplicate, false, 'Expected duplicate to be false on first upload');
  assert.strictEqual(doc1.importCount, 1, 'Expected importCount to be 1 on first upload');
  assert.ok(doc1.contentHash, 'Expected contentHash to be computed');
  assert.strictEqual(doc1.firstImportedAt, doc1.lastImportedAt, 'firstImportedAt and lastImportedAt should match on first upload');
  assert.strictEqual(doc1.analysisStatus, 'never_analyzed', 'analysisStatus should be never_analyzed');

  const importEvents1 = await service.getImportHistory(doc1.id);
  assert.strictEqual(importEvents1.totalImports, 1, 'Import history should record 1 event');
  assert.strictEqual(importEvents1.history[0]!.isDuplicate, false, 'Initial import event should not be marked duplicate');
  assert.strictEqual(importEvents1.history[0]!.status, 'NEW_DOCUMENT', 'Initial import event status should be NEW_DOCUMENT');
  console.log('✔ Scenario 1 Passed: Initial document entity created with importCount=1 and audit event.\n');

  // --------------------------------------------------------------------------
  // Scenario 2: Immediate Re-Upload (Single Document)
  // --------------------------------------------------------------------------
  console.log('Scenario 2: Testing immediate re-upload of identical file bytes...');
  const file1Dup = createMockFile('Letter_of_Credit.pdf', fileBytesA);
  const doc1Dup = await service.createFromUpload(file1Dup, { autoStart: false, customerId: customer1 });

  assert.strictEqual(doc1Dup.isDuplicate, true, 'Expected isDuplicate to be true on re-upload');
  assert.strictEqual(doc1Dup.duplicate, true, 'Expected duplicate to be true on re-upload');
  assert.strictEqual(doc1Dup.id, doc1.id, 'Expected canonical document ID to remain identical');
  assert.strictEqual(doc1Dup.duplicateOf, doc1.id, 'Expected duplicateOf to reference canonical ID');
  assert.strictEqual(doc1Dup.importCount, 2, 'Expected importCount to increment to 2');
  assert.strictEqual(doc1Dup.firstImportedAt, doc1.firstImportedAt, 'firstImportedAt should remain unchanged');
  assert.ok(new Date(doc1Dup.lastImportedAt!).getTime() >= new Date(doc1.firstImportedAt!).getTime(), 'lastImportedAt should be updated');

  const importEvents2 = await service.getImportHistory(doc1.id);
  assert.strictEqual(importEvents2.totalImports, 2, 'Import history should record 2 events');
  assert.strictEqual(importEvents2.history[0]!.isDuplicate, true, 'Latest import event should be marked duplicate');
  assert.strictEqual(importEvents2.history[0]!.status, 'DUPLICATE_DETECTED', 'Latest event status should be DUPLICATE_DETECTED');
  console.log('✔ Scenario 2 Passed: Deduplication triggered, canonical entity preserved, importCount incremented.\n');

  // --------------------------------------------------------------------------
  // Scenario 3: Re-Upload With Different Filename & Casing
  // --------------------------------------------------------------------------
  console.log('Scenario 3: Testing re-upload with modified filenames and casing...');
  const file1DiffName = createMockFile('LC_copy_version2.PDF', fileBytesA);
  const doc1DiffName = await service.createFromUpload(file1DiffName, { autoStart: false, customerId: customer1 });

  assert.strictEqual(doc1DiffName.isDuplicate, true, 'Different filename with identical content must be detected as duplicate');
  assert.strictEqual(doc1DiffName.id, doc1.id, 'Must resolve to the same canonical ID');
  assert.strictEqual(doc1DiffName.importCount, 3, 'Import count should increment to 3');
  assert.strictEqual(doc1DiffName.currentUploadedFilename, 'LC_copy_version2.PDF', 'Should reflect current uploaded filename');

  const importEvents3 = await service.getImportHistory(doc1.id);
  assert.strictEqual(importEvents3.totalImports, 3, 'Import history should reflect 3 attempts');
  assert.strictEqual(importEvents3.history[0]!.filename, 'LC_copy_version2.PDF', 'Import history tracks individual filename');
  console.log('✔ Scenario 3 Passed: Content-hash identity prevails over filenames and casing.\n');

  // --------------------------------------------------------------------------
  // Scenario 4: Different Customer / Tenant Scope
  // --------------------------------------------------------------------------
  console.log('Scenario 4: Testing cross-tenant boundary isolation with identical file bytes...');
  const fileCustomer2 = createMockFile('Letter_of_Credit.pdf', fileBytesA);
  const docCustomer2 = await service.createFromUpload(fileCustomer2, { autoStart: false, customerId: customer2 });

  assert.strictEqual(docCustomer2.isDuplicate, false, 'Same bytes under different tenant/customer must NOT be duplicate');
  assert.notStrictEqual(docCustomer2.id, doc1.id, 'Tenant 2 must receive a new distinct document entity');
  assert.strictEqual(docCustomer2.customerId, customer2, 'Tenant ID must be customer2');
  console.log('✔ Scenario 4 Passed: Compound tenant isolation { customerId, contentHash } verified.\n');

  // --------------------------------------------------------------------------
  // Scenario 5: Re-Upload of Completed Document
  // --------------------------------------------------------------------------
  console.log('Scenario 5: Testing re-upload of a previously completed/analyzed document...');
  // Simulate previous analysis completion
  await repository.update(doc1.id, (doc: DocumentRecord) => {
    doc.status = 'completed';
    doc.analysisStatus = 'completed';
    doc.firstAnalyzedAt = new Date().toISOString();
    doc.lastAnalyzedAt = new Date().toISOString();
    doc.analysisCount = 1;
    doc.analysis = {
      summary: { headline: 'Clean LC', narrative: 'All clear', dominantSentiment: 'neutral', dominantEmotion: 'trust', dominantContentType: 'trade', dominantTopic: 'lc', source: 'derived', highlights: [] },
      statistics: {} as any,
      timing: { extractionMs: 10, segmentationMs: 5, analysisMs: 20, aggregationMs: 5, totalMs: 40 },
      engine: { provider: 'gemini', model: 'flash', batchCount: 1, aiRequests: 1, aiRetries: 0, aiFailures: 0, degraded: false, notes: [] },
      completedAt: new Date().toISOString(),
    };
  });

  await repository.saveAnalysisEvent({
    analysisId: `analysis-v1-${crypto.randomUUID()}`,
    documentId: doc1.id,
    analysisVersion: 1,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: 'completed',
    engine: { provider: 'gemini', model: 'flash' },
    summary: { headline: 'Clean LC', narrative: 'All clear' } as any,
    statistics: {} as any,
    tradeCompliance: {} as any,
    errorMessage: null,
    createdAt: new Date().toISOString(),
  });

  const file1CompletedReupload = createMockFile('Letter_of_Credit_Resubmitted.pdf', fileBytesA);
  const docCompletedResult = await service.createFromUpload(file1CompletedReupload, { autoStart: false, customerId: customer1 });

  assert.strictEqual(docCompletedResult.isDuplicate, true, 'Completed document re-upload should be duplicate');
  assert.strictEqual(docCompletedResult.hasBeenAnalyzed, true, 'hasBeenAnalyzed must be true');
  assert.strictEqual(docCompletedResult.analysisStatus, 'completed', 'analysisStatus must indicate completed');
  console.log('✔ Scenario 5 Passed: Completed document returned with previous analysis metadata.\n');

  // --------------------------------------------------------------------------
  // Scenario 6: Re-Upload of Failed Document
  // --------------------------------------------------------------------------
  console.log('Scenario 6: Testing re-upload of a document whose previous run failed...');
  const fileFailed = createMockFile('Failed_Doc.pdf', '%PDF-1.4 Mock Corrupted Structure');
  const docFailed = await service.createFromUpload(fileFailed, { autoStart: false, customerId: customer1 });
  await repository.update(docFailed.id, (doc: DocumentRecord) => {
    doc.status = 'failed';
    doc.analysisStatus = 'failed';
    doc.error = { code: 'EXTRACTION_FAILED', message: 'Unreadable PDF font encodings', at: new Date().toISOString() };
  });

  const docFailedReupload = await service.createFromUpload(fileFailed, { autoStart: false, customerId: customer1 });
  assert.strictEqual(docFailedReupload.isDuplicate, true, 'Re-uploading failed document must be detected as duplicate');
  assert.strictEqual(docFailedReupload.analysisStatus, 'failed', 'analysisStatus must indicate failed');
  assert.strictEqual(docFailedReupload.hasBeenAnalyzed, false, 'hasBeenAnalyzed should be false when previous run failed');
  console.log('✔ Scenario 6 Passed: Failed document recognized and returned with failure context.\n');

  // --------------------------------------------------------------------------
  // Scenario 7: Explicit Re-Analysis
  // --------------------------------------------------------------------------
  console.log('Scenario 7: Testing explicit re-analysis creation...');
  const reanalyzedDoc = await service.reanalyzeDocument(doc1.id);

  assert.strictEqual(reanalyzedDoc.id, doc1.id, 'Re-analysis must retain the canonical document ID');
  assert.strictEqual(reanalyzedDoc.analysisCount, 2, 'analysisCount should increment to 2');
  assert.strictEqual(reanalyzedDoc.status, 'queued', 'Document status should be queued');

  const analysisHistory = await service.getAnalysisHistory(doc1.id);
  assert.strictEqual(analysisHistory.totalRuns, 2, 'Analysis history must contain 2 runs');
  const versions = analysisHistory.history.map((h) => h.analysisVersion);
  assert.ok(versions.includes(1) && versions.includes(2), 'Analysis history must include versions 1 and 2');
  console.log('✔ Scenario 7 Passed: Explicit re-analysis preserves canonical entity and records version 2 run.\n');

  // --------------------------------------------------------------------------
  // Scenario 8: Multi-File Batch Upload With In-Batch Duplicates
  // --------------------------------------------------------------------------
  console.log('Scenario 8: Testing batch upload with DB duplicate and intra-batch duplicates...');
  const batchFiles: UploadedFile[] = [
    createMockFile('Batch_Existing_LC.pdf', fileBytesA), // Matches existing doc1 in DB
    createMockFile('Batch_New_BL.pdf', fileBytesB),       // Brand new doc
    createMockFile('Batch_New_COO.pdf', fileBytesC),      // Brand new doc
    createMockFile('Batch_New_BL_Duplicate.pdf', fileBytesB), // Duplicate of 2nd item in this SAME batch!
  ];

  const batchResult = await service.createFromBatch(batchFiles, { autoStart: false, customerId: customer1 });

  assert.strictEqual(batchResult.summary.total, 4, 'Batch total must be 4');
  assert.strictEqual(batchResult.summary.new, 2, 'Batch should identify exactly 2 new documents');
  assert.strictEqual(batchResult.summary.duplicates, 2, 'Batch should identify exactly 2 duplicates');
  assert.strictEqual(batchResult.summary.failed, 0, 'No files should fail');

  assert.strictEqual(batchResult.documents[0]!.status, 'DUPLICATE', 'Item 0 (fileBytesA) is DB duplicate');
  assert.strictEqual(batchResult.documents[0]!.documentId, doc1.id, 'Item 0 matches doc1 ID');

  assert.strictEqual(batchResult.documents[1]!.status, 'NEW', 'Item 1 (fileBytesB) is brand new');
  assert.strictEqual(batchResult.documents[2]!.status, 'NEW', 'Item 2 (fileBytesC) is brand new');

  assert.strictEqual(batchResult.documents[3]!.status, 'DUPLICATE', 'Item 3 (fileBytesB copy) is intra-batch duplicate');
  assert.strictEqual(batchResult.documents[3]!.duplicateOf, batchResult.documents[1]!.documentId, 'Intra-batch duplicate points to earlier item in batch');
  console.log('✔ Scenario 8 Passed: Intra-batch and DB deduplication correctly separated and reported.\n');

  // --------------------------------------------------------------------------
  // Scenario 9: Analysis History Immutability
  // --------------------------------------------------------------------------
  console.log('Scenario 9: Testing analysis history immutability...');
  const historyCheck = await service.getAnalysisHistory(doc1.id);
  assert.strictEqual(historyCheck.history.length, 2);
  const versions2 = historyCheck.history.map((h) => h.analysisVersion);
  assert.ok(versions2.includes(1) && versions2.includes(2));
  assert.notStrictEqual(historyCheck.history[0]!.analysisId, historyCheck.history[1]!.analysisId);
  console.log('✔ Scenario 9 Passed: Versioned analysis events are distinct and immutable.\n');

  // --------------------------------------------------------------------------
  // Scenario 10: Document Deletion & Re-Upload (Soft Deletion / Restore)
  // --------------------------------------------------------------------------
  console.log('Scenario 10: Testing soft-delete and re-upload unarchiving...');
  // Soft-delete / archive docCustomer2
  await repository.update(docCustomer2.id, (doc: DocumentRecord) => {
    doc.isArchived = true;
    doc.archivedAt = new Date().toISOString();
  });

  const listBefore = await repository.list(100, 0);
  const foundBefore = listBefore.items.find((d) => d.id === docCustomer2.id);
  assert.strictEqual(foundBefore, undefined, 'Archived document should be hidden from normal list view');

  // Re-upload exact same document for customer 2
  const restoredDoc = await service.createFromUpload(createMockFile('Restored_Letter_of_Credit.pdf', fileBytesA), {
    autoStart: false,
    customerId: customer2,
  });

  assert.strictEqual(restoredDoc.id, docCustomer2.id, 'Should restore the same canonical document entity');
  assert.strictEqual(restoredDoc.isDuplicate, true, 'Should indicate duplicate / existing');
  assert.strictEqual(restoredDoc.isArchived, false, 'Should unarchive the document');
  assert.strictEqual(restoredDoc.importCount, 2, 'Import count should increment to 2');

  const listAfter = await repository.list(100, 0);
  const foundAfter = listAfter.items.find((d) => d.id === docCustomer2.id);
  assert.ok(foundAfter, 'Restored document should now be visible in document list');
  console.log('✔ Scenario 10 Passed: Soft-deleted document successfully unarchived on re-upload without unique constraint error.\n');

  console.log('================================================================');
  console.log('ALL 10 DOCUMENT DEDUPLICATION & HISTORY SCENARIOS PASSED 100%!');
  console.log('================================================================');

  await closeRepository();
  process.exit(0);
}

runTests().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
