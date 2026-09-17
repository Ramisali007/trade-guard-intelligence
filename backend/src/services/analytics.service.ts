import { getRepository } from './document.repository';
import { getQueue } from './queue.service';
import { getProvider } from '../ai';
import { ComplianceStore } from '../compliance/db/compliance-store';
import { createLogger } from '../utils/logger';
import type { DocumentRecord } from '../models/document.model';

const log = createLogger('analytics-service');

export type TimeRangeKey = 'today' | '7d' | '30d' | '90d' | '180d' | '1y' | 'all' | 'custom';

export interface AnalyticsFilterOptions {
  range?: TimeRangeKey;
  from?: string;
  to?: string;
  docType?: string;
  country?: string;
  customer?: string;
  status?: string;
  riskLevel?: string;
  refresh?: boolean;
}

export interface MetricDelta {
  current: number;
  previous: number;
  deltaPercent: number;
  direction: 'up' | 'down' | 'neutral';
  isPositiveChange: boolean;
}

export interface AnalyticsKpiSummary {
  totalUniqueDocuments: MetricDelta;
  totalImports: MetricDelta;
  totalAnalysisRuns: MetricDelta;
  analysisSuccessRate: MetricDelta;
  analysisFailureRate: MetricDelta;
  duplicateDetectionRate: MetricDelta;
  averageAnalysisTimeMs: MetricDelta;
  activeRiskAlerts: MetricDelta;
  highRiskDocumentsCount: MetricDelta;
  dataFreshnessScore: number;
  systemHealthStatus: 'HEALTHY' | 'WARNING' | 'DEGRADED' | 'CRITICAL';
}

export interface TimeSeriesPoint {
  periodLabel: string;
  timestamp: string;
  uniqueDocuments: number;
  duplicateImports: number;
  analysisRuns: number;
  successfulAnalyses: number;
  failedAnalyses: number;
  averageProcessingMs: number;
}

export interface StatusDistributionItem {
  status: string;
  label: string;
  count: number;
  percentage: number;
  color: string;
}

export interface RiskDistributionItem {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  label: string;
  count: number;
  percentage: number;
  color: string;
}

export interface ComplianceFindingsSummary {
  sanctionsHits: number;
  outOfScopeGoods: number;
  dualUseExportControls: number;
  tbmlRedFlags: number;
  pricingAnomalies: number;
  documentDiscrepancies: number;
  totalFindings: number;
}

export interface CountryExposureItem {
  country: string;
  code?: string;
  documentCount: number;
  totalValueUsd: number;
  averageRiskScore: number;
  isSanctionedOrHighRisk: boolean;
}

export interface TradeCorridorItem {
  corridor: string;
  originCountry: string;
  destinationCountry: string;
  documentCount: number;
  totalValueUsd: number;
  averageRiskScore: number;
}

export interface CustomerActivityItem {
  customerId: string;
  customerName: string;
  documentCount: number;
  totalValueUsd: number;
  averageRiskScore: number;
  activeAlertsCount: number;
  behavioralStatus: string;
}

export interface CommodityItemSummary {
  commodity: string;
  count: number;
  totalValueUsd: number;
  anomalousPriceCount: number;
  averageVariancePercent: number;
}

export interface SourceFreshnessItem {
  sourceId: string;
  sourceName: string;
  provider: string;
  dataCategory: string;
  lastSuccessfulSync: string;
  nextScheduledSyncAt: string;
  syncStatus: string;
  freshnessStatus: 'FRESH' | 'STALE' | 'OFFLINE';
  recordCount: number;
}

export interface OperationalAlertItem {
  id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  message: string;
  timestamp: string;
  source: string;
  actionableLink?: string;
}

export interface AnalyticsDashboardResponse {
  timeRange: {
    key: TimeRangeKey;
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
  };
  generatedAt: string;
  kpis: AnalyticsKpiSummary;
  documentActivity: {
    volumeTrend: TimeSeriesPoint[];
    statusDistribution: StatusDistributionItem[];
    totalTracked: number;
  };
  analysisPerformance: {
    throughputOverTime: TimeSeriesPoint[];
    averageDurationMs: number;
    durationHistogram: Array<{ bucket: string; count: number; percentage: number }>;
    engineHealth: {
      provider: string;
      model: string;
      remote: boolean;
      totalUnitsClassified: number;
      aiUnitsClassified: number;
      heuristicUnitsClassified: number;
      aiPercentage: number;
      averageConfidence: number;
      queueStats: { active: number; pending: number; concurrency: number };
    };
  };
  complianceIntelligence: {
    riskDistribution: RiskDistributionItem[];
    findings: ComplianceFindingsSummary;
    topRiskReasons: Array<{ reason: string; count: number }>;
  };
  geographicAnalytics: {
    topOriginCountries: CountryExposureItem[];
    topDestinationCountries: CountryExposureItem[];
    tradeCorridors: TradeCorridorItem[];
    sanctionedExposure: {
      impactedDocumentsCount: number;
      countries: string[];
    };
  };
  customerBehavior: {
    topCustomers: CustomerActivityItem[];
    totalActiveCustomers: number;
    customersWithAlertsCount: number;
  };
  commodityAndPricing: {
    topCommodities: CommodityItemSummary[];
    totalPriceChecks: number;
    fairPriceCount: number;
    overPricedCount: number;
    underPricedCount: number;
    averageVariancePercent: number;
  };
  routingAnalytics: {
    directShipmentCount: number;
    transshipmentCount: number;
    transshipmentRate: number;
    topPortsOfLoading: Array<{ port: string; count: number }>;
    topPortsOfDischarge: Array<{ port: string; count: number }>;
  };
  dataFreshness: {
    overallFreshnessPercent: number;
    sources: SourceFreshnessItem[];
  };
  operationalAlerts: OperationalAlertItem[];
}

interface CacheEntry {
  data: AnalyticsDashboardResponse;
  expiresAt: number;
}

export class AnalyticsService {
  private static instance: AnalyticsService;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 15_000; // 15 seconds

  public static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService();
    }
    return AnalyticsService.instance;
  }

  /**
   * Aggregate complete analytics for dashboard display.
   */
  public async getDashboardAnalytics(options: AnalyticsFilterOptions = {}): Promise<AnalyticsDashboardResponse> {
    const rangeKey = options.range || '30d';
    const cacheKey = JSON.stringify({ ...options, refresh: false });

    if (!options.refresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        log.debug('Serving analytics dashboard from in-memory cache', { rangeKey });
        return cached.data;
      }
    }

    log.info('Aggregating analytics across canonical database...', { rangeKey, filters: options });

    // 1. Compute time boundaries
    const { fromDate, toDate, prevFromDate, prevToDate } = this.calculateDateWindows(rangeKey, options.from, options.to);

    // 2. Fetch raw documents from repository (all non-archived documents, units omitted for high performance)
    const repository = getRepository();
    const allDocs = await repository.getAllDocumentsForAnalytics();

    // 3. Filter documents for the current window and previous window
    const currentDocs = this.filterDocuments(allDocs, fromDate, toDate, options);
    const previousDocs = this.filterDocuments(allDocs, prevFromDate, prevToDate, options);

    // 4. Fetch external compliance sources
    const complianceStore = ComplianceStore.getInstance();
    await complianceStore.init();
    const rawSources = await complianceStore.getSources().catch(() => []);

    // 5. Compute KPIs with comparative period-over-period deltas
    const kpis = this.calculateKpis(currentDocs, previousDocs, rawSources);

    // 6. Compute Document Activity & Volume Trend
    const volumeTrend = this.generateVolumeTrend(currentDocs, fromDate, toDate, rangeKey);
    const statusDistribution = this.computeStatusDistribution(currentDocs);

    // 7. Compute Analysis Performance & Engine Health
    const performance = this.computeAnalysisPerformance(currentDocs, volumeTrend);

    // 8. Compute Compliance & Risk Intelligence
    const complianceIntelligence = this.computeComplianceIntelligence(currentDocs);

    // 9. Geographic & Sanctions Exposure
    const geographicAnalytics = this.computeGeographicAnalytics(currentDocs);

    // 10. Customer Behavior
    const customerBehavior = this.computeCustomerBehavior(currentDocs);

    // 11. Commodity & Pricing
    const commodityAndPricing = this.computeCommodityAndPricing(currentDocs);

    // 12. Routing & Transshipment
    const routingAnalytics = this.computeRoutingAnalytics(currentDocs);

    // 13. Data Freshness
    const dataFreshness = this.computeDataFreshness(rawSources);

    // 14. Operational Alerts
    const operationalAlerts = this.generateOperationalAlerts(currentDocs, kpis, rawSources);

    const response: AnalyticsDashboardResponse = {
      timeRange: {
        key: rangeKey,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        previousFrom: prevFromDate.toISOString(),
        previousTo: prevToDate.toISOString(),
      },
      generatedAt: new Date().toISOString(),
      kpis,
      documentActivity: {
        volumeTrend,
        statusDistribution,
        totalTracked: currentDocs.length,
      },
      analysisPerformance: performance,
      complianceIntelligence,
      geographicAnalytics,
      customerBehavior,
      commodityAndPricing,
      routingAnalytics,
      dataFreshness,
      operationalAlerts,
    };

    // Cache the aggregated response
    this.cache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    return response;
  }

  /**
   * Filtered document drilldown records for interactive table clicks.
   */
  public async getDrilldownDocuments(
    options: AnalyticsFilterOptions & { limit?: number; offset?: number },
  ): Promise<{ items: DocumentRecord[]; total: number }> {
    const repository = getRepository();
    const allDocs = await repository.getAllDocumentsForAnalytics();
    const { fromDate, toDate } = this.calculateDateWindows(options.range || 'all', options.from, options.to);
    const filtered = this.filterDocuments(allDocs, fromDate, toDate, options);

    const limit = options.limit || 50;
    const offset = options.offset || 0;

    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Internal Calculation Helpers
  // ---------------------------------------------------------------------------------------------

  private calculateDateWindows(rangeKey: TimeRangeKey, customFrom?: string, customTo?: string) {
    const now = new Date();
    let toDate = new Date(now);
    let fromDate: Date;

    if (rangeKey === 'custom' && customFrom) {
      fromDate = new Date(customFrom);
      if (customTo) toDate = new Date(customTo);
    } else {
      switch (rangeKey) {
        case 'today':
          fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
          break;
        case '7d':
          fromDate = new Date(now.getTime() - 7 * 86_400_000);
          break;
        case '30d':
          fromDate = new Date(now.getTime() - 30 * 86_400_000);
          break;
        case '90d':
          fromDate = new Date(now.getTime() - 90 * 86_400_000);
          break;
        case '180d':
          fromDate = new Date(now.getTime() - 180 * 86_400_000);
          break;
        case '1y':
          fromDate = new Date(now.getTime() - 365 * 86_400_000);
          break;
        case 'all':
        default:
          fromDate = new Date(0); // Epoch
          break;
      }
    }

    const durationMs = toDate.getTime() - fromDate.getTime();
    const prevToDate = new Date(fromDate.getTime());
    const prevFromDate = new Date(fromDate.getTime() - durationMs);

    return { fromDate, toDate, prevFromDate, prevToDate };
  }

  private filterDocuments(
    docs: DocumentRecord[],
    fromDate: Date,
    toDate: Date,
    filters: AnalyticsFilterOptions,
  ): DocumentRecord[] {
    const fromTime = fromDate.getTime();
    const toTime = toDate.getTime();

    return docs.filter((d) => {
      // 1. Time boundary check (uploadedAt)
      const uploadedTime = new Date(d.uploadedAt || d.createdAt || 0).getTime();
      if (uploadedTime < fromTime || uploadedTime > toTime) return false;

      // 2. Document Status filter
      if (filters.status && filters.status !== 'all' && d.status !== filters.status) {
        return false;
      }

      // 3. Document Type filter
      if (filters.docType && filters.docType !== 'all') {
        const type = d.analysis?.tradeCompliance?.documentClassification?.type || d.fileType;
        if (type?.toLowerCase() !== filters.docType.toLowerCase()) return false;
      }

      // 4. Country filter
      if (filters.country && filters.country !== 'all') {
        const origin = d.analysis?.tradeCompliance?.transaction?.originCountry;
        const destination = d.analysis?.tradeCompliance?.transaction?.destinationCountry;
        const matchesCountry =
          origin?.toLowerCase() === filters.country.toLowerCase() ||
          destination?.toLowerCase() === filters.country.toLowerCase();
        if (!matchesCountry) return false;
      }

      // 5. Customer filter
      if (filters.customer && filters.customer !== 'all') {
        const cust = d.customerId || d.analysis?.tradeCompliance?.customerBehavioralAssessment?.customerProfile?.customerReferenceId;
        if (cust !== filters.customer) return false;
      }

      // 6. Risk Level filter
      if (filters.riskLevel && filters.riskLevel !== 'all') {
        const score = d.analysis?.tradeCompliance?.riskScores?.overall ?? 0;
        const level = this.getRiskCategory(score).toLowerCase();
        if (level !== filters.riskLevel.toLowerCase()) return false;
      }

      return true;
    });
  }

  private calculateKpis(
    currentDocs: DocumentRecord[],
    previousDocs: DocumentRecord[],
    sources: any[],
  ): AnalyticsKpiSummary {
    // Unique documents: not marked as duplicate
    const curUnique = currentDocs.filter((d) => !d.isDuplicate).length;
    const prevUnique = previousDocs.filter((d) => !d.isDuplicate).length;

    // Total imports: sum of importCount or length
    const curImports = currentDocs.reduce((sum, d) => sum + (d.importCount || 1), 0);
    const prevImports = previousDocs.reduce((sum, d) => sum + (d.importCount || 1), 0);

    // Total analysis runs: sum of analysisCount or completed analyses
    const curAnalyses = currentDocs.reduce((sum, d) => sum + (d.analysisCount || (d.status === 'completed' ? 1 : 0)), 0);
    const prevAnalyses = previousDocs.reduce((sum, d) => sum + (d.analysisCount || (d.status === 'completed' ? 1 : 0)), 0);

    // Success vs Failure counts
    const curCompleted = currentDocs.filter((d) => d.status === 'completed').length;
    const curFailed = currentDocs.filter((d) => d.status === 'failed').length;
    const prevCompleted = previousDocs.filter((d) => d.status === 'completed').length;
    const prevFailed = previousDocs.filter((d) => d.status === 'failed').length;

    const curTerminal = curCompleted + curFailed;
    const prevTerminal = prevCompleted + prevFailed;

    const curSuccessRate = curTerminal > 0 ? (curCompleted / curTerminal) * 100 : 100;
    const prevSuccessRate = prevTerminal > 0 ? (prevCompleted / prevTerminal) * 100 : 100;

    const curFailureRate = curTerminal > 0 ? (curFailed / curTerminal) * 100 : 0;
    const prevFailureRate = prevTerminal > 0 ? (prevFailed / prevTerminal) * 100 : 0;

    // Duplicate detection rate
    const curDupes = currentDocs.filter((d) => d.isDuplicate || (d.importCount && d.importCount > 1)).length;
    const prevDupes = previousDocs.filter((d) => d.isDuplicate || (d.importCount && d.importCount > 1)).length;

    const curDupeRate = curImports > 0 ? (curDupes / curImports) * 100 : 0;
    const prevDupeRate = prevImports > 0 ? (prevDupes / prevImports) * 100 : 0;

    // Average processing time
    const curProcessingTimes = currentDocs
      .map((d) => d.analysis?.timing?.totalMs)
      .filter((t): t is number => typeof t === 'number' && t > 0);
    const prevProcessingTimes = previousDocs
      .map((d) => d.analysis?.timing?.totalMs)
      .filter((t): t is number => typeof t === 'number' && t > 0);

    const curAvgTime = curProcessingTimes.length > 0 ? curProcessingTimes.reduce((a, b) => a + b, 0) / curProcessingTimes.length : 0;
    const prevAvgTime = prevProcessingTimes.length > 0 ? prevProcessingTimes.reduce((a, b) => a + b, 0) / prevProcessingTimes.length : 0;

    // High risk documents: riskScores.overall >= 70 or decision === BLOCK_ESCALATE
    const curHighRisk = currentDocs.filter((d) => {
      const tc = d.analysis?.tradeCompliance;
      return (tc?.riskScores?.overall ?? 0) >= 70 || tc?.decision?.decision === 'BLOCK_ESCALATE';
    }).length;
    const prevHighRisk = previousDocs.filter((d) => {
      const tc = d.analysis?.tradeCompliance;
      return (tc?.riskScores?.overall ?? 0) >= 70 || tc?.decision?.decision === 'BLOCK_ESCALATE';
    }).length;

    // Active risk alerts: sum of alerts across trade compliance & customers
    const curAlerts = currentDocs.reduce((sum, d) => {
      const tc = d.analysis?.tradeCompliance;
      const count = (tc?.tbml?.redFlags?.length || 0) + (tc?.customerBehavioralAssessment?.alerts?.length || 0) + (tc?.discrepancies?.length || 0);
      return sum + count;
    }, 0);
    const prevAlerts = previousDocs.reduce((sum, d) => {
      const tc = d.analysis?.tradeCompliance;
      const count = (tc?.tbml?.redFlags?.length || 0) + (tc?.customerBehavioralAssessment?.alerts?.length || 0) + (tc?.discrepancies?.length || 0);
      return sum + count;
    }, 0);

    // Data Freshness Score across regulatory feeds
    const freshCount = sources.filter((s) => s.freshnessStatus === 'FRESH').length;
    const dataFreshnessScore = sources.length > 0 ? Math.round((freshCount / sources.length) * 100) : 100;

    // System Health Status derivation
    let systemHealthStatus: 'HEALTHY' | 'WARNING' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';
    if (curFailureRate > 25 || dataFreshnessScore < 60) {
      systemHealthStatus = 'CRITICAL';
    } else if (curFailureRate > 10 || dataFreshnessScore < 85) {
      systemHealthStatus = 'DEGRADED';
    } else if (curFailureRate > 5 || dataFreshnessScore < 100) {
      systemHealthStatus = 'WARNING';
    }

    return {
      totalUniqueDocuments: this.buildMetricDelta(curUnique, prevUnique, true),
      totalImports: this.buildMetricDelta(curImports, prevImports, true),
      totalAnalysisRuns: this.buildMetricDelta(curAnalyses, prevAnalyses, true),
      analysisSuccessRate: this.buildMetricDelta(Number(curSuccessRate.toFixed(1)), Number(prevSuccessRate.toFixed(1)), true),
      analysisFailureRate: this.buildMetricDelta(Number(curFailureRate.toFixed(1)), Number(prevFailureRate.toFixed(1)), false),
      duplicateDetectionRate: this.buildMetricDelta(Number(curDupeRate.toFixed(1)), Number(prevDupeRate.toFixed(1)), false),
      averageAnalysisTimeMs: this.buildMetricDelta(Math.round(curAvgTime), Math.round(prevAvgTime), false),
      activeRiskAlerts: this.buildMetricDelta(curAlerts, prevAlerts, false),
      highRiskDocumentsCount: this.buildMetricDelta(curHighRisk, prevHighRisk, false),
      dataFreshnessScore,
      systemHealthStatus,
    };
  }

  private buildMetricDelta(current: number, previous: number, higherIsBetter: boolean): MetricDelta {
    let deltaPercent = 0;
    if (previous > 0) {
      deltaPercent = Number((((current - previous) / previous) * 100).toFixed(1));
    } else if (current > 0) {
      deltaPercent = 100;
    }

    let direction: 'up' | 'down' | 'neutral' = 'neutral';
    if (current > previous) direction = 'up';
    else if (current < previous) direction = 'down';

    const isPositiveChange = higherIsBetter ? current >= previous : current <= previous;

    return { current, previous, deltaPercent, direction, isPositiveChange };
  }

  private generateVolumeTrend(
    docs: DocumentRecord[],
    fromDate: Date,
    toDate: Date,
    rangeKey: TimeRangeKey,
  ): TimeSeriesPoint[] {
    const isToday = rangeKey === 'today';
    const isShort = rangeKey === '7d' || rangeKey === '30d';
    const bucketCount = isToday ? 24 : isShort ? 14 : 12;

    const fromTime = fromDate.getTime();
    const toTime = toDate.getTime();
    const intervalMs = Math.max(3600_000, (toTime - fromTime) / bucketCount);

    const points: TimeSeriesPoint[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = new Date(fromTime + i * intervalMs);
      const bucketEnd = new Date(fromTime + (i + 1) * intervalMs);

      const bucketDocs = docs.filter((d) => {
        const t = new Date(d.uploadedAt || d.createdAt || 0).getTime();
        return t >= bucketStart.getTime() && t < bucketEnd.getTime();
      });

      const uniqueDocuments = bucketDocs.filter((d) => !d.isDuplicate).length;
      const duplicateImports = bucketDocs.filter((d) => d.isDuplicate || (d.importCount && d.importCount > 1)).length;
      const successfulAnalyses = bucketDocs.filter((d) => d.status === 'completed').length;
      const failedAnalyses = bucketDocs.filter((d) => d.status === 'failed').length;
      const analysisRuns = successfulAnalyses + failedAnalyses;

      const durations = bucketDocs
        .map((d) => d.analysis?.timing?.totalMs)
        .filter((t): t is number => typeof t === 'number' && t > 0);
      const averageProcessingMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

      let periodLabel = bucketStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      if (isToday) {
        periodLabel = `${bucketStart.getHours()}:00`;
      }

      points.push({
        periodLabel,
        timestamp: bucketStart.toISOString(),
        uniqueDocuments,
        duplicateImports,
        analysisRuns,
        successfulAnalyses,
        failedAnalyses,
        averageProcessingMs,
      });
    }

    return points;
  }

  private computeStatusDistribution(docs: DocumentRecord[]): StatusDistributionItem[] {
    const counts: Record<string, number> = {
      completed: 0,
      processing: 0,
      queued: 0,
      uploaded: 0,
      failed: 0,
    };

    for (const d of docs) {
      if (counts[d.status] !== undefined) {
        counts[d.status] = (counts[d.status] || 0) + 1;
      } else {
        counts.uploaded = (counts.uploaded || 0) + 1;
      }
    }

    const total = docs.length || 1;
    const completedCount = counts.completed || 0;
    const processingCount = counts.processing || 0;
    const queuedCount = counts.queued || 0;
    const uploadedCount = counts.uploaded || 0;
    const failedCount = counts.failed || 0;

    return [
      { status: 'completed', label: 'Analyzed & Completed', count: completedCount, percentage: Number(((completedCount / total) * 100).toFixed(1)), color: '#10b981' },
      { status: 'processing', label: 'In Progress (Active AI)', count: processingCount, percentage: Number(((processingCount / total) * 100).toFixed(1)), color: '#00d4d4' },
      { status: 'queued', label: 'Queued in Buffer', count: queuedCount, percentage: Number(((queuedCount / total) * 100).toFixed(1)), color: '#38bdf8' },
      { status: 'uploaded', label: 'Pending Analysis', count: uploadedCount, percentage: Number(((uploadedCount / total) * 100).toFixed(1)), color: '#f59e0b' },
      { status: 'failed', label: 'Analysis Errors / Retries', count: failedCount, percentage: Number(((failedCount / total) * 100).toFixed(1)), color: '#ef4444' },
    ];
  }

  private computeAnalysisPerformance(docs: DocumentRecord[], volumeTrend: TimeSeriesPoint[]) {
    const completedDocs = docs.filter((d) => d.status === 'completed' && d.analysis);
    const durations = completedDocs
      .map((d) => d.analysis?.timing?.totalMs)
      .filter((t): t is number => typeof t === 'number' && t > 0);

    const averageDurationMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

    // Duration Histogram
    const buckets = [
      { bucket: '< 5s', count: 0 },
      { bucket: '5–15s', count: 0 },
      { bucket: '15–30s', count: 0 },
      { bucket: '30–60s', count: 0 },
      { bucket: '> 60s', count: 0 },
    ];

    for (const ms of durations) {
      const s = ms / 1000;
      if (s < 5) buckets[0]!.count++;
      else if (s < 15) buckets[1]!.count++;
      else if (s < 30) buckets[2]!.count++;
      else if (s < 60) buckets[3]!.count++;
      else buckets[4]!.count++;
    }

    const totalDur = durations.length || 1;
    const durationHistogram = buckets.map((b) => ({
      ...b,
      percentage: Number(((b.count / totalDur) * 100).toFixed(1)),
    }));

    // AI Engine Stats
    const provider = getProvider();
    const queue = getQueue();

    let totalAiUnits = 0;
    let totalHeuristicUnits = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (const d of completedDocs) {
      const stats = d.analysis?.statistics;
      if (stats) {
        totalAiUnits += stats.aiClassifiedUnits || 0;
        totalHeuristicUnits += stats.heuristicClassifiedUnits || 0;
        if (stats.averageConfidence) {
          confidenceSum += stats.averageConfidence;
          confidenceCount++;
        }
      }
    }

    const totalUnits = totalAiUnits + totalHeuristicUnits || 1;
    const aiPercentage = Number(((totalAiUnits / totalUnits) * 100).toFixed(1));
    const averageConfidence = confidenceCount > 0 ? Number((confidenceSum / confidenceCount).toFixed(2)) : 0.95;

    return {
      throughputOverTime: volumeTrend,
      averageDurationMs,
      durationHistogram,
      engineHealth: {
        provider: provider.id,
        model: provider.model,
        remote: !provider.isLocal,
        totalUnitsClassified: totalAiUnits + totalHeuristicUnits,
        aiUnitsClassified: totalAiUnits,
        heuristicUnitsClassified: totalHeuristicUnits,
        aiPercentage,
        averageConfidence,
        queueStats: queue.stats(),
      },
    };
  }

  private computeComplianceIntelligence(docs: DocumentRecord[]) {
    const completedDocs = docs.filter((d) => d.status === 'completed' && d.analysis?.tradeCompliance);

    // 4-tier risk distribution
    const riskCounts = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    const reasonsMap = new Map<string, number>();

    let sanctionsHits = 0;
    let outOfScopeGoods = 0;
    let dualUseExportControls = 0;
    let tbmlRedFlags = 0;
    let pricingAnomalies = 0;
    let documentDiscrepancies = 0;

    for (const d of completedDocs) {
      const tc = d.analysis!.tradeCompliance!;
      const score = tc.riskScores?.overall ?? 0;
      const cat = this.getRiskCategory(score);
      riskCounts[cat]++;

      if (tc.sanctions?.matches?.length) sanctionsHits += tc.sanctions.matches.length;
      if (tc.scopeValidation?.hasOutOfScopeGoods) outOfScopeGoods++;
      if (
        tc.exportControls?.riskStatus &&
        tc.exportControls.riskStatus !== 'NO_CONTROL_CONCERN_IDENTIFIED' &&
        tc.exportControls.riskStatus !== 'INSUFFICIENT_INFORMATION'
      ) {
        dualUseExportControls += tc.exportControls.controlledGoods?.length || 1;
      }
      if (tc.tbml?.redFlags?.length) tbmlRedFlags += tc.tbml.redFlags.length;
      if (tc.pricingIntelligence?.some((p) => p.classification === 'HIGH_PRICE_ANOMALY' || p.classification === 'LOW_PRICE_ANOMALY')) {
        pricingAnomalies++;
      }
      if (tc.discrepancies?.length) documentDiscrepancies += tc.discrepancies.length;

      // Track top reasons
      for (const r of tc.decision?.reasons || []) {
        reasonsMap.set(r, (reasonsMap.get(r) || 0) + 1);
      }
    }

    const total = completedDocs.length || 1;
    const riskDistribution: RiskDistributionItem[] = [
      { riskLevel: 'LOW', label: 'Low Risk (Score 0–34)', count: riskCounts.LOW, percentage: Number(((riskCounts.LOW / total) * 100).toFixed(1)), color: '#10b981' },
      { riskLevel: 'MEDIUM', label: 'Medium Risk (Score 35–69)', count: riskCounts.MEDIUM, percentage: Number(((riskCounts.MEDIUM / total) * 100).toFixed(1)), color: '#f59e0b' },
      { riskLevel: 'HIGH', label: 'High Risk (Score 70–84)', count: riskCounts.HIGH, percentage: Number(((riskCounts.HIGH / total) * 100).toFixed(1)), color: '#f97316' },
      { riskLevel: 'CRITICAL', label: 'Critical Risk (Score 85–100)', count: riskCounts.CRITICAL, percentage: Number(((riskCounts.CRITICAL / total) * 100).toFixed(1)), color: '#ef4444' },
    ];

    const topRiskReasons = Array.from(reasonsMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const totalFindings = sanctionsHits + outOfScopeGoods + dualUseExportControls + tbmlRedFlags + pricingAnomalies + documentDiscrepancies;

    return {
      riskDistribution,
      findings: {
        sanctionsHits,
        outOfScopeGoods,
        dualUseExportControls,
        tbmlRedFlags,
        pricingAnomalies,
        documentDiscrepancies,
        totalFindings,
      },
      topRiskReasons,
    };
  }

  private computeGeographicAnalytics(docs: DocumentRecord[]) {
    const originMap = new Map<string, { count: number; value: number; riskSum: number }>();
    const destMap = new Map<string, { count: number; value: number; riskSum: number }>();
    const corridorMap = new Map<string, { count: number; value: number; riskSum: number; origin: string; dest: string }>();
    const sanctionedCountriesSet = new Set<string>();
    let sanctionedDocsCount = 0;

    for (const d of docs) {
      const tc = d.analysis?.tradeCompliance;
      if (!tc) continue;

      const origin = tc.transaction.originCountry || 'Unknown';
      const dest = tc.transaction.destinationCountry || 'Unknown';
      const val = tc.transaction.totalValue || 0;
      const risk = tc.riskScores?.overall || 0;

      // Origin
      const o = originMap.get(origin) || { count: 0, value: 0, riskSum: 0 };
      originMap.set(origin, { count: o.count + 1, value: o.value + val, riskSum: o.riskSum + risk });

      // Destination
      const dst = destMap.get(dest) || { count: 0, value: 0, riskSum: 0 };
      destMap.set(dest, { count: dst.count + 1, value: dst.value + val, riskSum: dst.riskSum + risk });

      // Corridor
      const corridorKey = `${origin} → ${dest}`;
      const c = corridorMap.get(corridorKey) || { count: 0, value: 0, riskSum: 0, origin, dest };
      corridorMap.set(corridorKey, { count: c.count + 1, value: c.value + val, riskSum: c.riskSum + risk, origin, dest });

      // Sanctioned exposure
      if (tc.sanctions?.jurisdictionRisks?.length || tc.sanctions?.matches?.length) {
        sanctionedDocsCount++;
        if (origin) sanctionedCountriesSet.add(origin);
        if (dest) sanctionedCountriesSet.add(dest);
      }
    }

    const mapToExposure = (map: Map<string, { count: number; value: number; riskSum: number }>): CountryExposureItem[] =>
      Array.from(map.entries())
        .filter(([c]) => c !== 'Unknown' && c !== 'Not Found')
        .map(([country, stats]) => ({
          country,
          documentCount: stats.count,
          totalValueUsd: Math.round(stats.value),
          averageRiskScore: Math.round(stats.riskSum / (stats.count || 1)),
          isSanctionedOrHighRisk: sanctionedCountriesSet.has(country),
        }))
        .sort((a, b) => b.documentCount - a.documentCount)
        .slice(0, 8);

    const tradeCorridors: TradeCorridorItem[] = Array.from(corridorMap.entries())
      .filter(([k]) => !k.includes('Unknown') && !k.includes('Not Found'))
      .map(([corridor, stats]) => ({
        corridor,
        originCountry: stats.origin,
        destinationCountry: stats.dest,
        documentCount: stats.count,
        totalValueUsd: Math.round(stats.value),
        averageRiskScore: Math.round(stats.riskSum / (stats.count || 1)),
      }))
      .sort((a, b) => b.documentCount - a.documentCount)
      .slice(0, 8);

    return {
      topOriginCountries: mapToExposure(originMap),
      topDestinationCountries: mapToExposure(destMap),
      tradeCorridors,
      sanctionedExposure: {
        impactedDocumentsCount: sanctionedDocsCount,
        countries: Array.from(sanctionedCountriesSet),
      },
    };
  }

  private computeCustomerBehavior(docs: DocumentRecord[]) {
    const custMap = new Map<string, { name: string; count: number; value: number; riskSum: number; alerts: number; status: string }>();

    for (const d of docs) {
      const tc = d.analysis?.tradeCompliance;
      const custId = d.customerId || tc?.customerBehavioralAssessment?.customerProfile?.customerReferenceId || 'TG-CUST-DEFAULT';
      const custName = tc?.transaction?.parties?.buyer?.legalName || tc?.transaction?.parties?.applicant?.legalName || tc?.customerBehavioralAssessment?.customerProfile?.legalName || custId;
      const val = tc?.transaction?.totalValue || 0;
      const risk = tc?.customerBehavioralAssessment?.behavioralRiskScore || tc?.riskScores?.overall || 15;
      const alerts = tc?.customerBehavioralAssessment?.alerts?.length || 0;
      const status = tc?.customerBehavioralAssessment?.behavioralRiskLevel || 'LOW';

      const existing = custMap.get(custId) || { name: custName, count: 0, value: 0, riskSum: 0, alerts: 0, status };
      custMap.set(custId, {
        name: existing.name !== custId ? existing.name : custName,
        count: existing.count + 1,
        value: existing.value + val,
        riskSum: existing.riskSum + risk,
        alerts: existing.alerts + alerts,
        status: status === 'HIGH' ? status : existing.status,
      });
    }

    const topCustomers: CustomerActivityItem[] = Array.from(custMap.entries())
      .map(([customerId, c]) => ({
        customerId,
        customerName: c.name,
        documentCount: c.count,
        totalValueUsd: Math.round(c.value),
        averageRiskScore: Math.round(c.riskSum / (c.count || 1)),
        activeAlertsCount: c.alerts,
        behavioralStatus: c.status,
      }))
      .sort((a, b) => b.documentCount - a.documentCount)
      .slice(0, 8);

    const customersWithAlertsCount = topCustomers.filter((c) => c.activeAlertsCount > 0).length;

    return {
      topCustomers,
      totalActiveCustomers: custMap.size,
      customersWithAlertsCount,
    };
  }

  private computeCommodityAndPricing(docs: DocumentRecord[]) {
    const commMap = new Map<string, { count: number; value: number; varianceSum: number; anomalous: number }>();
    let totalPriceChecks = 0;
    let fairPriceCount = 0;
    let overPricedCount = 0;
    let underPricedCount = 0;
    let totalVarianceSum = 0;

    for (const d of docs) {
      const tc = d.analysis?.tradeCompliance;
      if (!tc) continue;

      for (const p of tc.pricingIntelligence || []) {
        totalPriceChecks++;
        const v = p.priceVariancePercent || 0;
        totalVarianceSum += Math.abs(v);
        if (p.classification === 'HIGH_PRICE_ANOMALY') overPricedCount++;
        else if (p.classification === 'LOW_PRICE_ANOMALY') underPricedCount++;
        else fairPriceCount++;
      }

      for (const item of tc.goods || []) {
        const desc = (item.productDescription || item.productCategory || 'General Commodity').trim();
        const existing = commMap.get(desc) || { count: 0, value: 0, varianceSum: 0, anomalous: 0 };
        const isAnom = item.riskSeverity === 'HIGH' || item.riskSeverity === 'CRITICAL';
        commMap.set(desc, {
          count: existing.count + 1,
          value: existing.value + (item.totalLineValue || 0),
          varianceSum: existing.varianceSum,
          anomalous: existing.anomalous + (isAnom ? 1 : 0),
        });
      }
    }

    const topCommodities: CommodityItemSummary[] = Array.from(commMap.entries())
      .filter(([name]) => name.length > 2 && name !== 'Not Found')
      .map(([commodity, stats]) => ({
        commodity,
        count: stats.count,
        totalValueUsd: Math.round(stats.value),
        anomalousPriceCount: stats.anomalous,
        averageVariancePercent: Number((stats.varianceSum / (stats.count || 1)).toFixed(1)),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const averageVariancePercent = totalPriceChecks > 0 ? Number((totalVarianceSum / totalPriceChecks).toFixed(1)) : 0;

    return {
      topCommodities,
      totalPriceChecks,
      fairPriceCount,
      overPricedCount,
      underPricedCount,
      averageVariancePercent,
    };
  }

  private computeRoutingAnalytics(docs: DocumentRecord[]) {
    let directShipmentCount = 0;
    let transshipmentCount = 0;
    const polMap = new Map<string, number>();
    const podMap = new Map<string, number>();

    for (const d of docs) {
      const tc = d.analysis?.tradeCompliance;
      if (!tc) continue;

      const hasTransshipment =
        tc.routeAnalysis?.hasUnusualTransshipment ||
        (tc.transaction.transitCountries && tc.transaction.transitCountries.length > 0);

      if (hasTransshipment) {
        transshipmentCount++;
      } else {
        directShipmentCount++;
      }

      const pol = tc.transaction.portOfLoading;
      const pod = tc.transaction.portOfDischarge;

      if (pol && pol !== 'Not Found') {
        polMap.set(pol, (polMap.get(pol) || 0) + 1);
      }
      if (pod && pod !== 'Not Found') {
        podMap.set(pod, (podMap.get(pod) || 0) + 1);
      }
    }

    const totalShipments = directShipmentCount + transshipmentCount || 1;
    const transshipmentRate = Number(((transshipmentCount / totalShipments) * 100).toFixed(1));

    const toSortedArray = (map: Map<string, number>) =>
      Array.from(map.entries())
        .map(([port, count]) => ({ port, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

    return {
      directShipmentCount,
      transshipmentCount,
      transshipmentRate,
      topPortsOfLoading: toSortedArray(polMap),
      topPortsOfDischarge: toSortedArray(podMap),
    };
  }

  private computeDataFreshness(sources: any[]) {
    const formatted: SourceFreshnessItem[] = sources.map((s) => ({
      sourceId: s.sourceId,
      sourceName: s.sourceName,
      provider: s.provider,
      dataCategory: s.dataCategory,
      lastSuccessfulSync: s.lastSuccessfulSync || s.lastAttemptedSync || new Date().toISOString(),
      nextScheduledSyncAt: s.nextScheduledSyncAt || new Date().toISOString(),
      syncStatus: s.syncStatus || 'SUCCESS',
      freshnessStatus: s.freshnessStatus || 'FRESH',
      recordCount: s.recordCount || 0,
    }));

    const freshCount = formatted.filter((s) => s.freshnessStatus === 'FRESH').length;
    const overallFreshnessPercent = formatted.length > 0 ? Math.round((freshCount / formatted.length) * 100) : 100;

    return {
      overallFreshnessPercent,
      sources: formatted,
    };
  }

  private generateOperationalAlerts(
    docs: DocumentRecord[],
    kpis: AnalyticsKpiSummary,
    sources: any[],
  ): OperationalAlertItem[] {
    const alerts: OperationalAlertItem[] = [];

    // 1. Failure rate alert
    if (kpis.analysisFailureRate.current > 15) {
      alerts.push({
        id: 'ALERT-FAIL-SURGE',
        severity: 'CRITICAL',
        title: 'High Analysis Failure Rate Detected',
        message: `Pipeline analysis failure rate reached ${kpis.analysisFailureRate.current}% (threshold: 15%). Immediate queue and OCR inspection recommended.`,
        timestamp: new Date().toISOString(),
        source: 'Analysis Ingestion Queue',
        actionableLink: '/dashboard',
      });
    }

    // 2. Stale regulatory feeds
    const stale = sources.filter((s) => s.freshnessStatus === 'STALE');
    if (stale.length > 0) {
      alerts.push({
        id: 'ALERT-FEEDS-STALE',
        severity: 'WARNING',
        title: 'Regulatory Intelligence Feeds Require Synchronization',
        message: `${stale.length} regulatory source(s) [${stale.map((s) => s.sourceId).join(', ')}] are overdue for scheduled synchronization.`,
        timestamp: new Date().toISOString(),
        source: 'SLA Engine',
        actionableLink: '/sources',
      });
    }

    // 3. High risk document cluster
    if (kpis.highRiskDocumentsCount.current > 0) {
      alerts.push({
        id: 'ALERT-HIGH-RISK-CLUSTER',
        severity: 'WARNING',
        title: `${kpis.highRiskDocumentsCount.current} High-Risk Presentations Pending Review`,
        message: `Document presentations with sanctions, dual-use, or severe TBML pricing discrepancies require authorized compliance officer review.`,
        timestamp: new Date().toISOString(),
        source: 'Trade Compliance Engine',
        actionableLink: '/auditor',
      });
    }

    // 4. Duplicate upload velocity alert
    if (kpis.duplicateDetectionRate.current > 20) {
      alerts.push({
        id: 'ALERT-DUPLICATE-SPIKE',
        severity: 'INFO',
        title: 'Elevated Duplicate Import Activity',
        message: `Duplicate document detection rate is currently at ${kpis.duplicateDetectionRate.current}%. Hash-based deduplication is active and conserving AI resources.`,
        timestamp: new Date().toISOString(),
        source: 'Deduplication Pipeline',
      });
    }

    return alerts;
  }

  private getRiskCategory(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (score >= 85) return 'CRITICAL';
    if (score >= 70) return 'HIGH';
    if (score >= 35) return 'MEDIUM';
    return 'LOW';
  }
}

export const analyticsService = AnalyticsService.getInstance();
