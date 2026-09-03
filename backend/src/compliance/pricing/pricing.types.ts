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
}
