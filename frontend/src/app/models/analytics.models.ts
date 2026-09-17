export type TimeRangeKey = 'today' | '7d' | '30d' | '90d' | '180d' | '1y' | 'all' | 'custom';

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

export interface AnalyticsFilterParams {
  range: TimeRangeKey;
  from?: string;
  to?: string;
  docType?: string;
  country?: string;
  customer?: string;
  status?: string;
  riskLevel?: string;
}

export interface AnalyticsDrilldownItem {
  id: string;
  filename: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  status: string;
  isDuplicate?: boolean;
  importCount?: number;
  analysisCount?: number;
  analysis?: {
    timing?: { totalMs: number };
    tradeCompliance?: {
      documentClassification?: { type: string; number: string };
      transaction?: { originCountry: string; destinationCountry: string; totalValue: number; currency: string };
      decision?: { decision: string; confidence: number };
      riskScores?: { overall: number };
    };
  };
}
