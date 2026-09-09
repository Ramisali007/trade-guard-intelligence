/**
 * Enterprise Import Center & 4-Tier Resolution Engine Automated Test Suite
 * Scenarios 1 to 8 Verification
 */

import { entityRegistry, sanitizeCsvCell, generateEntityId } from './entity-registry.js';
import { complianceStore } from '../db/compliance-store.js';
import { dataResolutionService } from './data-resolution.service.js';
import { importBatchService } from './import-batch.service.js';

async function runImportTestSuite() {
  console.log('========================================================================');
  console.log('🚀 ENTERPRISE IMPORT CENTER & 4-TIER RESOLUTION ENGINE TEST SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Registry Definition & Deterministic IDs
  // ---------------------------------------------------------------------------
  console.log('--- SCENARIO 1: Entity Registry & Deterministic Business Keys ---');
  const allConfigs = entityRegistry.getAllConfigs();
  assert(allConfigs.length >= 10, `Entity registry exposes ${allConfigs.length} entities (Expected >= 10)`);

  const countryId = generateEntityId('countries', { countryCode: 'PK' });
  assert(countryId === 'PK', `Deterministic Country ID generated: ${countryId}`);

  const portId = generateEntityId('ports', { locode: 'SGSIN' });
  assert(portId === 'SGSIN', `Deterministic Port ID generated: ${portId}`);

  const bankId = generateEntityId('banks', { swiftBic: 'SCBLPKKA' });
  assert(bankId === 'SCBLPKKA', `Deterministic Bank ID generated: ${bankId}`);

  // ---------------------------------------------------------------------------
  // SCENARIO 2: CSV Formula Injection Defense
  // ---------------------------------------------------------------------------
  console.log('\n--- SCENARIO 2: CSV Formula Injection Defense ---');
  const maliciousFormula1 = '=cmd|"/C calc"!A0';
  const maliciousFormula2 = '+SUM(1,2)';
  const maliciousFormula3 = '-2+3';
  const maliciousFormula4 = '@dangerous';
  const benignValue = 'Ordinary Textile Inc';

  assert(sanitizeCsvCell(maliciousFormula1) === `\'${maliciousFormula1}`, 'Escaped formula starting with =');
  assert(sanitizeCsvCell(maliciousFormula2) === `\'${maliciousFormula2}`, 'Escaped formula starting with +');
  assert(sanitizeCsvCell(maliciousFormula3) === `\'${maliciousFormula3}`, 'Escaped formula starting with -');
  assert(sanitizeCsvCell(maliciousFormula4) === `\'${maliciousFormula4}`, 'Escaped formula starting with @');
  assert(sanitizeCsvCell(benignValue) === benignValue, 'Preserved benign value untouched');

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Deterministic Deduplication & Bulk Validation Preview
  // ---------------------------------------------------------------------------
  const testIso = 'Z' + (Date.now() % 10);
  const previewData = [
    { countryCode: testIso, countryName: `Test Country ${testIso}`, riskLevel: 'LOW', isSanctioned: false },
    { countryCode: testIso, countryName: `Test Country IntraDup`, riskLevel: 'LOW', isSanctioned: false }, // intra-batch duplicate
    { countryCode: 'SG', countryName: 'Singapore', riskLevel: 'LOW', isSanctioned: false, notes: `Advisory update ${Date.now()}` } // update
  ];

  const previewResult = await importBatchService.previewBulkImport('countries', previewData);

  assert(previewResult.validRecords === 2, `Validation preview unique valid count: ${previewResult.validRecords} (out of 3 rows)`);
  assert(previewResult.duplicatesCount === 1, `Duplicate detection recognized 1 intra-batch collision`);
  assert(previewResult.previewRows.length === 3, `Extracted 3 candidate rows in preview`);

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Bulk Commit & Batch Tracking
  // ---------------------------------------------------------------------------
  console.log('\n--- SCENARIO 4: Bulk Commit & Batch ID Generation ---');
  const commitResult = await importBatchService.commitBulkBatch('countries', previewData, {
    entityType: 'countries',
    ingestionMethod: 'JSON',
    importedBy: 'test-admin@tradeguard.internal'
  });

  assert(commitResult.batchId.startsWith('IMP-'), `Batch ID correctly generated: ${commitResult.batchId}`);
  assert(commitResult.totalRecords === 3, `Total records processed: ${commitResult.totalRecords}`);
  assert(commitResult.createdCount + commitResult.updatedCount >= 1, `Records created/updated: ${commitResult.createdCount + commitResult.updatedCount}`);

  // Verify audit log creation
  const auditLogs = await complianceStore.getAuditLogs(30);
  const matchedBatchLogs = auditLogs.filter(log => log.batchId === commitResult.batchId);
  assert(matchedBatchLogs.length >= 1, `Audit log entries created for batch ${commitResult.batchId} (Count: ${matchedBatchLogs.length})`);

  // ---------------------------------------------------------------------------
  // SCENARIO 5: 4-Tier Resolution Engine (Priority 1 -> Priority 2 DB Fallback)
  // ---------------------------------------------------------------------------
  console.log('\n--- SCENARIO 5: 4-Tier Resolution Engine (Fresh -> DB Fallback) ---');

  // 1. Resolve Country
  const resolvedCountry = await dataResolutionService.resolveCountry('SG');
  assert(resolvedCountry.found === true, 'Resolved Singapore country record');
  assert(
    resolvedCountry.provenance.status === 'DATABASE_FALLBACK' || resolvedCountry.provenance.status === 'FRESH',
    `Country provenance is verified: ${resolvedCountry.provenance.status}`
  );

  // 2. Resolve Crude Oil Brent benchmark price
  const resolvedBrent = await dataResolutionService.resolvePrice('CRUDE OIL BRENT', undefined, 'USD');
  assert(resolvedBrent.found === true, 'Resolved Brent crude benchmark');
  assert(
    resolvedBrent.data?.benchmarkUnitPriceUsd !== null && (resolvedBrent.data?.benchmarkUnitPriceUsd || 0) > 0,
    `Brent price: $${resolvedBrent.data?.benchmarkUnitPriceUsd}`
  );
  assert(
    resolvedBrent.provenance.status === 'DATABASE_FALLBACK' || resolvedBrent.provenance.status === 'FRESH',
    `Price provenance: ${resolvedBrent.provenance.status}`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Point-in-Time Historical Resolution & Sanctions
  // ---------------------------------------------------------------------------
  console.log('\n--- SCENARIO 6: Point-in-Time Resolution & Sanction Checks ---');

  // Seed a specific sanction test entity
  const sanctionTestId = 'SAN-OFAC-ALPHA';
  await complianceStore.saveEntities([{
    canonicalId: sanctionTestId,
    sourceId: 'OFAC_SDN',
    entityType: 'ORGANIZATION',
    primaryName: 'ALPHA RESTRICTED CORP',
    normalizedName: 'alpha restricted corp',
    aliases: ['ALPHA RESTRICTED'],
    normalizedAliases: ['alpha restricted'],
    country: 'IR',
    programs: ['OFAC-SDN'],
    identifiers: {},
    validFrom: '2024-01-01',
    validTo: null,
    observedAt: new Date().toISOString(),
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    isCurrent: true,
    version: 1,
    contentHash: 'hash-test-alpha'
  } as any]);

  // Evaluate as-of 2023 (before effective date)
  const pitBefore = await dataResolutionService.resolveSanctionStatus('ALPHA RESTRICTED CORP', '2023-06-01');
  assert(
    pitBefore.data?.isListed === false || pitBefore.provenance.isHistorical === true,
    'Point-in-time check before effective date evaluates as non-listed or flagged historical'
  );

  // Evaluate as-of current (after effective date)
  const pitAfter = await dataResolutionService.resolveSanctionStatus('ALPHA RESTRICTED CORP');
  assert(pitAfter.data?.isListed === true, 'Current sanction check confirms active SDN designation');

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Zero Hallucination for Unknown Entities (Priority 4)
  // ---------------------------------------------------------------------------
  console.log('\n--- SCENARIO 7: Zero Hallucination on Non-Existent Entities ---');
  const unknownCommodity = 'XYZ_FICTIONAL_SUPER_PARTICLE_99999';
  const resolvedUnknown = await dataResolutionService.resolvePrice(unknownCommodity);

  assert(resolvedUnknown.found === false, 'Unknown commodity correctly reports found = false');
  assert(resolvedUnknown.data === null, 'Unknown commodity does NOT hallucinate price data (null)');
  assert(resolvedUnknown.provenance.status === 'UNKNOWN', `Provenance tagged correctly: ${resolvedUnknown.provenance.status}`);

  // ---------------------------------------------------------------------------
  // SCENARIO 8: Cache Invalidation on Master Data Update
  // ---------------------------------------------------------------------------
  console.log('\n--- SCENARIO 8: In-Memory Cache Invalidation on Update ---');

  // Upsert updated price for Wheat
  const newWheatPrice = 385.50;
  await importBatchService.commitSingleRecord(
    'prices',
    {
      productKey: 'wheat',
      benchmarkUnitPriceUsd: newWheatPrice,
      unitOfMeasure: 'MT',
      incotermBasis: 'FOB',
      category: 'Agricultural',
      confidenceLevel: 'HIGH',
      effectiveFrom: new Date().toISOString().split('T')[0],
      sourceId: 'MANUAL_OVERRIDE'
    },
    {
      actor: 'compliance_officer@tradeguard.internal'
    }
  );

  // Resolve Wheat immediately
  const resolvedWheat = await dataResolutionService.resolvePrice('wheat');
  assert(resolvedWheat.found === true, 'Resolved updated wheat benchmark');
  assert(
    Math.abs((resolvedWheat.data?.benchmarkUnitPriceUsd || 0) - newWheatPrice) < 0.01,
    `Cache invalidated and reflected new price: $${resolvedWheat.data?.benchmarkUnitPriceUsd}`
  );

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runImportTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
