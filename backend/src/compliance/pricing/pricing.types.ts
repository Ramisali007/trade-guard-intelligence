/**
 * Real-Time Market Pricing Intelligence Types
 */

export type SourceAuthorityLevel =
  | 'LEVEL_1_OFFICIAL_REGULATOR'     // Customs, Central Banks, FBR, US ITC, UN Comtrade
  | 'LEVEL_2_INTERGOVERNMENTAL'      // World Bank, WTO, IMF, FAO
  | 'LEVEL_3_COMMODITY_EXCHANGE'     // LME, CBOT, Platts, ICIS, Cotlook
  | 'LEVEL_4_VERIFIED_B2B_INDEX'     // Verified B2B wholesale trade directories, Panjiva
  | 'LEVEL_5_GENERAL_COMMERCIAL';    // Open web listings (lower confidence)

export type PriceClassification =
  | 'LOW_PRICE_ANOMALY'
  | 'WITHIN_EXPECTED_RANGE'
  | 'HIGH_PRICE_ANOMALY'
  | 'INSUFFICIENT_MARKET_DATA';

export interface WebEvidenceRecord {
  evidenceId: string;
  url: string;
  sourceTitle: string;
  publisher: string;
  retrievedAt: string;
  sourceAuthorityLevel: SourceAuthorityLevel;
  sourceType: 'CUSTOMS_TARIFF' | 'COMMODITY_EXCHANGE' | 'B2B_WHOLESALE' | 'TRADE_PORTAL' | 'PUBLIC_WEB';
  country?: string;
  observedPrice: number;
  observedCurrency: string;
  observedUnit: string;
  observedIncoterm?: string;
  observedDate?: string;
  quotedExcerpt: string;
  confidenceScore: number;
  contentHashSha256: string;
  researchQuery: string;
}

export interface MarketPriceBenchmark {
  benchmarkId: string;
  productKey: string;
  category: string;
  hsCodePrefix?: string;
  benchmarkUnitPrice: number;
  observedLowPrice: number;
  observedMedianPrice: number;
  observedHighPrice: number;
  currency: string;
  unitOfMeasure: string;
  incotermBasis: 'CIF' | 'FOB' | 'CFR' | 'EXW';
  destinationMarket?: string;
  sampleCount: number;
  confidenceLevel: 'VERY_HIGH' | 'HIGH' | 'MODERATE' | 'LOW' | 'INSUFFICIENT';
  asOfDate: string;
  evidence: WebEvidenceRecord[];
  /** Where the figure comes from, when the provider knows; otherwise it is worked out from the evidence. */
  origin?: BenchmarkOrigin;
}

export type BenchmarkOrigin = 'LIVE_SOURCE' | 'LOCAL_DATABASE' | 'BUILT_IN_REFERENCE' | 'BANK_SUPPLIED' | 'SYNTHETIC_TEST' | 'UNSPECIFIED';

/** How far the benchmark is a like-for-like comparison with the declared price. */
export type ComparabilityGrade = 'COMPARABLE' | 'PROXY' | 'WEAK';

export interface ComparabilityFactor {
  factor: 'PRODUCT' | 'SPECIFICATION' | 'UNIT' | 'CURRENCY' | 'INCOTERM' | 'DESTINATION' | 'ORIGIN' | 'FRESHNESS' | 'SAMPLE';
  status: 'MATCH' | 'ADJUSTED' | 'PARTIAL' | 'MISMATCH' | 'UNKNOWN';
  detail: string;
}

/** Everything the verdict rests on, kept with the result so it can be reproduced and challenged. */
export interface PriceAssessment {
  policy: {
    basis: 'GLOBAL_DEFAULT_UNAPPROVED' | 'APPROVED_CATEGORY';
    policyId: string;
    highPct: number;
    lowPct: number;
    methodology: string | null;
    approvedBy: string | null;
    approvedOn: string | null;
    note: string;
  };
  comparability: { grade: ComparabilityGrade; factors: ComparabilityFactor[] };
  inputs: {
    declaredUnitPrice: number;
    declaredCurrency: string;
    declaredUnit: string;
    declaredIncoterm: string;
    usdPerDeclaredUnit: number;
    fxBasis: string;
    incotermAdjustmentPercent: number;
    comparedUnit: string;
    comparedUsdPerUnit: number;
  };
  benchmark: {
    id: string;
    category: string;
    hsCodePrefix: string | null;
    origin: BenchmarkOrigin;
    confidence: MarketPriceBenchmark['confidenceLevel'];
    sampleCount: number;
    asOfDate: string;
    ageDays: number | null;
    incotermBasis: string;
    unit: string;
    sources: string[];
  } | null;
  /** True only for an approved category threshold applied to a comparable-enough benchmark from a real, non-bundled source. */
  approvedControl: boolean;
  limitations: string[];
  assessedAt: string;
}

export interface ProductPriceIntelligenceResult {
  lineItemId: string;
  itemNumber: number;
  productDescription: string;
  hsCode?: string;
  declaredQuantity: number;
  declaredUnitOfMeasure: string;
  declaredUnitPrice: number;
  declaredCurrency: string;
  declaredIncoterm: string;
  destination: string;

  // Normalized Unit Values
  normalizedUnitPriceUsd: number;
  normalizedIncotermBasis: 'CIF' | 'FOB';

  // Benchmark Comparison
  hasMarketData: boolean;
  benchmarkUnitPriceUsd?: number;
  observedMarketLowUsd?: number;
  observedMarketMedianUsd?: number;
  observedMarketHighUsd?: number;
  priceVariancePercent?: number;

  // Anomaly Classification & Explainable Reasons
  classification: PriceClassification;
  confidence: 'HIGH' | 'MODERATE' | 'LOW' | 'NONE';
  explanation: string;
  evidenceRecords: WebEvidenceRecord[];
  limitations: string[];
  /** The inputs, policy and comparability behind the classification. */
  assessment?: PriceAssessment;
}
