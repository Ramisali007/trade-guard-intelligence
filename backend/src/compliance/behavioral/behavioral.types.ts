/**
 * Customer & Counterparty Behavioral Analytics & Golden Record Types
 */

export type BehavioralAlertCode =
  | 'LC_FREQUENCY_SPIKE'
  | 'TRANSACTION_VALUE_SPIKE'
  | 'PRODUCT_PROFILE_CHANGE'
  | 'NEW_HIGH_RISK_JURISDICTION_EXPOSURE'
  | 'NEW_COUNTERPARTY_ALERT'
  | 'ROUTING_PROFILE_CHANGE'
  | 'PRICE_BEHAVIOR_ANOMALY'
  | 'BUSINESS_SCOPE_DEVIATION';

export type BehavioralSeverity = 'HIGH' | 'MODERATE' | 'LOW' | 'INFORMATIONAL';

export interface BehavioralAlert {
  alertId: string;
  customerReferenceId: string;
  transactionId: string;
  alertCode: BehavioralAlertCode;
  severity: BehavioralSeverity;
  metric: string;
  baselineValue: number | string;
  observedValue: number | string;
  deviationPercent?: number;
  explanation: string;
  evidence: string[];
  detectedAt: string;
  requiresEnhancedReview: boolean;
}

export interface RollingWindowMetrics {
  windowDays: number;
  transactionCount: number;
  totalVolumeUsd: number;
  averageTransactionValueUsd: number;
  medianTransactionValueUsd: number;
  monthlyLcFrequency: number;
  monthlyFrequencyStdDev: number;
  activeCounterpartiesCount: number;
  topTradedCategories: Array<{ category: string; count: number; percentage: number }>;
  topTradingCountries: Array<{ country: string; count: number; percentage: number }>;
}

export interface CustomerBehavioralBaseline {
  customerReferenceId: string;
  calculatedAt: string;
  window30d: RollingWindowMetrics;
  window90d: RollingWindowMetrics;
  window180d: RollingWindowMetrics;
  window365d: RollingWindowMetrics;
  historicalLcFrequencyMean: number;
  historicalLcFrequencyStdDev: number;
  historicalAverageValueUsd: number;
  establishedCategories: string[];
  establishedCountries: string[];
  establishedSuppliers: string[];
  establishedBuyers: string[];
  establishedRoutingHubs: string[];
  typicalRoutes?: string[];
  commonTransshipmentHubs?: string[];
}

export interface CustomerProfile {
  customerReferenceId: string;
  legalName: string;
  normalizedName: string;
  aliases: string[];
  registrationNumber?: string;
  taxVatNumber?: string;
  country: string;
  address?: string;
  businessType: string;
  declaredBusinessActivity: string;
  riskRating: 'LOW' | 'MEDIUM' | 'HIGH' | 'SPECIAL_ATTENTION';
  onboardingDate: string;
  lastActiveDate: string;

  // Aggregate Lifetime Stats
  lifetimeTransactionCount: number;
  lifetimeVolumeUsd: number;
  averageTransactionValueUsd: number;
  monthlyLcFrequency: number;

  // Established Profiles
  establishedProductCategories: string[];
  establishedCountries: string[];
  regularSuppliers: string[];
  regularBuyers: string[];

  // Historical Maritime Route Baselines
  historicalOriginPorts?: string[];
  historicalLoadingPorts?: string[];
  historicalDischargePorts?: string[];
  historicalIntermediatePorts?: string[];
  commonTransshipmentHubs?: string[];
  typicalRoutes?: string[];
  typicalCarriers?: string[];
  typicalVessels?: string[];

  // Historical Risk Track Record
  pastSanctionsHitsCount: number;
  pastPriceAnomaliesCount: number;
  pastDiscrepanciesCount: number;
  averageHistoricalRiskScore: number;

  // Deduplication tracking to prevent multiple counts on re-analysis
  processedDocumentIds?: string[];
  processedTransactionIds?: string[];
}

export interface EntityResolutionResult {
  customerReferenceId: string;
  matchedName: string;
  searchedName: string;
  resolutionMethod: 'EXACT_TAX_ID' | 'EXACT_NORMALIZED_NAME' | 'FUZZY_ALIAS_MATCH' | 'NEW_PROFILE_CREATED';
  matchConfidence: number;        // 0 - 1.0
  isNewCustomer: boolean;
  requiresManualVerification: boolean;
  details: string;
}

export interface ClientComparisonAnalytics {
  isReturningClient: boolean;
  clientStatus: 'RETURNING_CLIENT' | 'FIRST_TIME_CLIENT';
  clientRole: 'EXPORTER_SELLER' | 'IMPORTER_BUYER' | 'TRADING_PARTNER';
  previousTradesCount: number;
  totalHistoricalVolumeUsd: number;
  historicalAverageValueUsd: number;
  currentVsAverageValueVariancePercent: number;
  commodityContinuity: 'ESTABLISHED_COMMODITY' | 'NEW_COMMODITY_LINE';
  corridorContinuity: 'ESTABLISHED_CORRIDOR' | 'NEW_DESTINATION_MARKET';
  counterpartyContinuity: 'ESTABLISHED_PARTNER' | 'NEW_TRADING_COUNTERPARTY';
  historicalRiskRating: string;
  summaryNarrative: string;
}

export interface CustomerBehavioralAssessment {
  customerProfile: CustomerProfile;
  entityResolution: EntityResolutionResult;
  baselines: CustomerBehavioralBaseline;
  alerts: BehavioralAlert[];
  behavioralRiskScore: number;     // 0 - 100
  behavioralRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  behavioralSummary: string;
  analyticalRecommendations: string[];
  comparisonAnalytics?: ClientComparisonAnalytics;
}
