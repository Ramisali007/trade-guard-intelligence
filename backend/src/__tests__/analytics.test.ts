import assert from 'node:assert';
import { initRepository, closeRepository } from '../services/document.repository';
import { analyticsService } from '../services/analytics.service';

async function runAnalyticsTests() {
  console.log('================================================================');
  console.log('STARTING ANALYTICS & SYSTEM HEALTH ENGINE TEST SUITE');
  console.log('================================================================\n');

  await initRepository();

  // Test 1: Fetch dashboard analytics with default 30d range
  console.log('Test 1: Querying default 30-day dashboard analytics...');
  const data30d = await analyticsService.getDashboardAnalytics({ range: '30d', refresh: true });

  assert.ok(data30d, 'Analytics dashboard response should be defined');
  assert.strictEqual(data30d.timeRange.key, '30d', 'Expected timeRange.key to be 30d');
  assert.ok(data30d.kpis, 'KPIs object should be defined');

  // Verify KPI shape
  const { kpis } = data30d;
  assert.ok(typeof kpis.totalUniqueDocuments.current === 'number', 'totalUniqueDocuments should be numeric');
  assert.ok(typeof kpis.totalImports.current === 'number', 'totalImports should be numeric');
  assert.ok(typeof kpis.totalAnalysisRuns.current === 'number', 'totalAnalysisRuns should be numeric');
  assert.ok(typeof kpis.analysisSuccessRate.current === 'number', 'analysisSuccessRate should be numeric');
  assert.ok(typeof kpis.analysisFailureRate.current === 'number', 'analysisFailureRate should be numeric');
  assert.ok(typeof kpis.duplicateDetectionRate.current === 'number', 'duplicateDetectionRate should be numeric');
  assert.ok(typeof kpis.dataFreshnessScore === 'number', 'dataFreshnessScore should be numeric');
  assert.ok(
    ['HEALTHY', 'WARNING', 'DEGRADED', 'CRITICAL'].includes(kpis.systemHealthStatus),
    'systemHealthStatus should be a valid health status',
  );

  console.log(`✔ Test 1 Passed: Retrieved 30d analytics. Total Unique: ${kpis.totalUniqueDocuments.current}, Success Rate: ${kpis.analysisSuccessRate.current}%, Health: ${kpis.systemHealthStatus}\n`);

  // Test 2: Verify Status Distribution sums to 100% (or 0 if empty)
  console.log('Test 2: Verifying document status distribution mathematics...');
  const statusDist = data30d.documentActivity.statusDistribution;
  assert.ok(Array.isArray(statusDist), 'statusDistribution should be an array');
  assert.strictEqual(statusDist.length, 5, 'Expected 5 status categories: completed, processing, queued, uploaded, failed');

  const totalStatusPercent = statusDist.reduce((sum, item) => sum + item.percentage, 0);
  if (data30d.documentActivity.totalTracked > 0) {
    assert.ok(
      Math.abs(totalStatusPercent - 100) < 1.0,
      `Status percentages should sum to approximately 100% (got ${totalStatusPercent})`,
    );
  }
  console.log(`✔ Test 2 Passed: Status distribution valid. Total tracked docs: ${data30d.documentActivity.totalTracked}\n`);

  // Test 3: Time Range Filtering (Today vs 7d vs All)
  console.log('Test 3: Testing flexible date range filtering...');
  const dataToday = await analyticsService.getDashboardAnalytics({ range: 'today', refresh: true });
  const dataAll = await analyticsService.getDashboardAnalytics({ range: 'all', refresh: true });

  assert.strictEqual(dataToday.timeRange.key, 'today');
  assert.strictEqual(dataAll.timeRange.key, 'all');
  assert.ok(
    dataAll.documentActivity.totalTracked >= dataToday.documentActivity.totalTracked,
    'All-time documents count should be >= Today count',
  );
  console.log(`✔ Test 3 Passed: Range filtering functional. Today: ${dataToday.documentActivity.totalTracked}, All: ${dataAll.documentActivity.totalTracked}\n`);

  // Test 4: Compliance & Risk Intelligence Breakdown
  console.log('Test 4: Verifying compliance intelligence and risk tiers...');
  const { complianceIntelligence } = dataAll;
  assert.ok(Array.isArray(complianceIntelligence.riskDistribution), 'riskDistribution should be an array');
  assert.strictEqual(complianceIntelligence.riskDistribution.length, 4, 'Expected 4 risk categories: LOW, MEDIUM, HIGH, CRITICAL');
  assert.ok(typeof complianceIntelligence.findings.totalFindings === 'number', 'totalFindings should be numeric');
  console.log(`✔ Test 4 Passed: Compliance findings total: ${complianceIntelligence.findings.totalFindings}, Top reasons tracked: ${complianceIntelligence.topRiskReasons.length}\n`);

  // Test 5: External Regulatory Feed Freshness
  console.log('Test 5: Verifying data freshness of regulatory feeds...');
  const { dataFreshness } = dataAll;
  assert.ok(Array.isArray(dataFreshness.sources), 'sources should be an array');
  assert.ok(dataFreshness.sources.length >= 7, 'Expected at least 7 authoritative compliance feeds');
  assert.ok(typeof dataFreshness.overallFreshnessPercent === 'number', 'overallFreshnessPercent should be numeric');
  console.log(`✔ Test 5 Passed: ${dataFreshness.sources.length} compliance feeds active. Overall freshness: ${dataFreshness.overallFreshnessPercent}%\n`);

  // Test 6: Drilldown document queries
  console.log('Test 6: Testing operational drill-down query...');
  const drilldownAll = await analyticsService.getDrilldownDocuments({ range: 'all', limit: 10 });
  assert.ok(Array.isArray(drilldownAll.items), 'drilldown items should be an array');
  assert.ok(typeof drilldownAll.total === 'number', 'drilldown total should be numeric');
  console.log(`✔ Test 6 Passed: Drilldown returned ${drilldownAll.items.length} items of ${drilldownAll.total} total.\n`);

  await closeRepository();

  console.log('================================================================');
  console.log('ALL ANALYTICS TEST SUITES PASSED SUCCESSFULLY');
  console.log('================================================================\n');
}

runAnalyticsTests().catch((err) => {
  console.error('Test suite failed with error:', err);
  process.exit(1);
});
