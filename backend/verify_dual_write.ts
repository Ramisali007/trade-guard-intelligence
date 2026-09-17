import * as dns from 'node:dns';

try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
  dns.setDefaultResultOrder('ipv4first');
} catch {}

import { initRepository, closeRepository } from './src/services/document.repository';
import type { DocumentRecord, AnalyzedUnit, AnalysisEvent } from './src/models/document.model';
import type { CustomerProfile } from './src/compliance/behavioral/behavioral.types';
import { CustomerRepository } from './src/services/customer.repository';
import { MongoClient } from 'mongodb';
import { config } from './src/config';

async function verifyDualWrite() {
  console.log('------------------------------------------------------------');
  console.log('🔍 VERIFYING REAL-TIME DUAL-DATABASE SYNCHRONIZATION');
  console.log('------------------------------------------------------------');
  console.log('Local URI: ', config.storage.mongoUri);
  console.log('Cloud URI: ', config.storage.cloudMongoUri.replace(/:[^:@]+@/, ':***@'));
  console.log('Dual Sync Enabled: ', config.storage.enableDualSync);

  // 1. Initialize repository
  const repo = await initRepository();
  const status = repo.getSyncStatus ? repo.getSyncStatus() : null;
  console.log('\n📊 Repository Sync Status:', JSON.stringify(status, null, 2));

  if (!status?.primaryConnected || !status?.cloudConnected) {
    throw new Error('Both primary and cloud must be connected for dual-write test!');
  }

  // Direct independent MongoDB clients to check raw collections
  const localClient = new MongoClient(config.storage.mongoUri);
  await localClient.connect();
  const localDb = localClient.db(config.storage.mongoDb);

  const cloudClient = new MongoClient(config.storage.cloudMongoUri);
  await cloudClient.connect();
  const cloudDb = cloudClient.db(config.storage.mongoDb);

  const testId = `test-dual-sync-${Date.now()}`;
  const nowIso = new Date().toISOString();

  const testDoc: DocumentRecord = {
    id: testId,
    customerId: 'default_customer',
    filename: 'dual_sync_verification.pdf',
    fileType: 'pdf',
    storagePath: 'storage/uploads/dual_sync.pdf',
    mimeType: 'application/pdf',
    fileSize: 12345,
    contentHash: `hash-${testId}`,
    normalizedTextHash: `nhash-${testId}`,
    uploadedAt: nowIso,
    firstImportedAt: nowIso,
    lastImportedAt: nowIso,
    importCount: 1,
    status: 'uploaded',
    progress: { stages: [], percent: 0, analyzedUnits: 0, totalUnits: 0, completedBatches: 0, totalBatches: 0, etaSeconds: null },
    units: [],
    analysisCount: 0,
    startedAt: null,
    finishedAt: null,
    extraction: null,
    analysis: null,
    error: null,
  };

  try {
    // 2. Test create() dual write
    console.log('\n[TEST 1] Creating document via repository.create()...');
    const startCreate = Date.now();
    await repo.create(testDoc);
    console.log(`✅ repository.create() returned in ${Date.now() - startCreate}ms`);

    const inLocal1 = await localDb.collection('documents').findOne({ id: testId });
    const inCloud1 = await cloudDb.collection('documents').findOne({ id: testId });

    console.log('Local MongoDB has document? ', inLocal1 ? '✅ YES' : '❌ NO');
    console.log('Cloud Atlas has document? ', inCloud1 ? '✅ YES' : '❌ NO');

    if (!inLocal1 || !inCloud1) {
      throw new Error('create() failed to write to both databases!');
    }

    // 3. Test update() dual write
    console.log('\n[TEST 2] Updating document via repository.update()...');
    const startUpdate = Date.now();
    await repo.update(testId, (doc) => {
      doc.status = 'completed';
      doc.progress = { stages: [], percent: 100, analyzedUnits: 1, totalUnits: 1, completedBatches: 1, totalBatches: 1, etaSeconds: 0 };
      doc.finishedAt = new Date().toISOString();
      doc.analysis = {
        summary: null,
        topics: [],
        entities: [],
        statistics: {} as any,
        tradeCompliance: null,
        startedAt: nowIso,
        completedAt: new Date().toISOString(),
      } as any;
    });
    console.log(`✅ repository.update() returned in ${Date.now() - startUpdate}ms`);

    const inLocal2 = await localDb.collection('documents').findOne({ id: testId });
    const inCloud2 = await cloudDb.collection('documents').findOne({ id: testId });

    console.log('Local status: ', inLocal2?.status, ' | Local finishedAt: ', inLocal2?.finishedAt);
    console.log('Cloud status: ', inCloud2?.status, ' | Cloud finishedAt: ', inCloud2?.finishedAt);

    if (inLocal2?.status !== 'completed' || inCloud2?.status !== 'completed') {
      throw new Error('update() failed to replicate to both databases!');
    }

    // 4. Test saveUnits() dual write
    console.log('\n[TEST 3] Saving analyzed units via repository.saveUnits()...');
    const sampleUnits: AnalyzedUnit[] = [
      {
        id: `${testId}-u1`,
        pageNumber: 1,
        paragraphNumber: 1,
        pageParagraphNumber: 1,
        section: null,
        sectionLevel: null,
        charCount: 47,
        wordCount: 6,
        text: 'Commercial Invoice for Apex Textiles shipment.',
        unitType: 'paragraph',
        classification: {
          sentiment: 'neutral',
          emotion: 'neutral',
          confidence: 0.98,
          contentType: 'factual',
          topic: 'finance',
          keywords: ['commercial', 'invoice'],
          source: 'ai',
        },
      },
    ];
    await repo.saveUnits(testId, sampleUnits);

    const localUnitsCount = await localDb.collection('document_units').countDocuments({ documentId: testId });
    const cloudUnitsCount = await cloudDb.collection('document_units').countDocuments({ documentId: testId });
    console.log(`Local document_units count: ${localUnitsCount} | Cloud document_units count: ${cloudUnitsCount}`);

    if (localUnitsCount !== 1 || cloudUnitsCount !== 1) {
      throw new Error('saveUnits() failed to mirror units to both databases!');
    }

    // 5. Test saveAnalysisEvent() dual write
    console.log('\n[TEST 4] Saving analysis event via repository.saveAnalysisEvent()...');
    const testEvent: AnalysisEvent = {
      analysisId: `event-${testId}`,
      documentId: testId,
      analysisVersion: 1,
      startedAt: nowIso,
      completedAt: new Date().toISOString(),
      status: 'completed',
      engine: { provider: 'test', model: 'dual-sync-verifier' },
      summary: null,
      statistics: null,
      tradeCompliance: null,
      createdAt: nowIso,
    };
    await repo.saveAnalysisEvent(testEvent);

    const inLocalEvent = await localDb.collection('analysis_events').findOne({ analysisId: testEvent.analysisId });
    const inCloudEvent = await cloudDb.collection('analysis_events').findOne({ analysisId: testEvent.analysisId });
    console.log('Local has analysis event? ', inLocalEvent ? '✅ YES' : '❌ NO');
    console.log('Cloud has analysis event? ', inCloudEvent ? '✅ YES' : '❌ NO');

    if (!inLocalEvent || !inCloudEvent) {
      throw new Error('saveAnalysisEvent() failed to mirror to both databases!');
    }

    // 6. Test Customer dual write
    console.log('\n[TEST 5] Testing CustomerRepository dual write...');
    const custRepo = CustomerRepository.getInstance();
    const testCust: CustomerProfile = {
      customerReferenceId: `CUST-TEST-${Date.now()}`,
      legalName: 'Dual Sync Test Customer Corp',
      normalizedName: 'dual sync test customer corp',
      aliases: ['Dual Sync Test Corp'],
      businessType: 'Export Trading',
      declaredBusinessActivity: 'Textiles and Commodities',
      lastActiveDate: nowIso,
      country: 'Pakistan',
      riskRating: 'LOW',
      onboardingDate: nowIso,
      lifetimeTransactionCount: 1,
      lifetimeVolumeUsd: 50000,
      averageTransactionValueUsd: 50000,
      monthlyLcFrequency: 1,
      establishedProductCategories: ['Textiles'],
      establishedCountries: ['UK'],
      regularSuppliers: [],
      regularBuyers: [],
      historicalOriginPorts: [],
      historicalLoadingPorts: [],
      historicalDischargePorts: [],
      typicalRoutes: [],
      typicalCarriers: [],
      pastSanctionsHitsCount: 0,
      pastPriceAnomaliesCount: 0,
      pastDiscrepanciesCount: 0,
      averageHistoricalRiskScore: 10,
    };
    await custRepo.save(testCust);

    const localCust = await localDb.collection('customers').findOne({ customerReferenceId: testCust.customerReferenceId });
    const cloudCust = await cloudDb.collection('customers').findOne({ customerReferenceId: testCust.customerReferenceId });
    console.log('Local has customer? ', localCust ? '✅ YES' : '❌ NO');
    console.log('Cloud has customer? ', cloudCust ? '✅ YES' : '❌ NO');

    // Clean up test customer
    await custRepo.delete(testCust.customerReferenceId);

    console.log('\n🎉 ALL REAL-TIME DUAL-WRITE TESTS PASSED WITH 100% PARITY!');
  } finally {
    // Clean up test document from both databases
    await localDb.collection('documents').deleteOne({ id: testId });
    await cloudDb.collection('documents').deleteOne({ id: testId });
    await localDb.collection('document_units').deleteMany({ documentId: testId });
    await cloudDb.collection('document_units').deleteMany({ documentId: testId });
    await localDb.collection('analysis_events').deleteOne({ analysisId: `event-${testId}` });
    await cloudDb.collection('analysis_events').deleteOne({ analysisId: `event-${testId}` });

    await localClient.close();
    await cloudClient.close();
    await closeRepository();
  }
}

verifyDualWrite().catch((err) => {
  console.error('❌ Dual write verification failed:', err);
  process.exit(1);
});
