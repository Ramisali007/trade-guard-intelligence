
/**
 * Client-side mirrors of the backend's API payloads.
 */

export type DocumentFileType = 'pdf' | 'doc' | 'docx';

export type DocumentStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StageId =
  | 'upload'
  | 'extract'
  | 'structure'
  | 'chunk'
  | 'analyze'
  | 'aggregate'
  | 'report';

export type StageState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface Stage {
  id: StageId;
  label: string;
  state: StageState;
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface Progress {
  stages: Stage[];
  percent: number;
  analyzedUnits: number;
  totalUnits: number;
  completedBatches: number;
  totalBatches: number;
  etaSeconds: number | null;
}

export interface ClassificationResult {
  sentiment: string;
  emotion: string;
  contentType: string;
  topic: string;
  confidence: number;
  keywords: string[];
  source: 'ai' | 'heuristic';
}

export interface AnalyzedUnit {
  id: string;
  pageNumber: number;
  section: string | null;
  sectionLevel: number | null;
  paragraphNumber: number;
  pageParagraphNumber: number;
  unitType: string;
  text: string;
  charCount: number;
  wordCount: number;
  classification: ClassificationResult;
}

export interface PageTimelineEntry {
  pageNumber: number;
  units: number;
  sentiment: Record<string, number>;
  netSentiment: number;
  dominantSentiment: string;
  dominantEmotion: string;
  dominantContentType: string;
}

export interface SectionBreakdownEntry {
  section: string;
  units: number;
  dominantSentiment: string;
  dominantContentType: string;
  netSentiment: number;
}

export interface Statistics {
  totalPages: number;
  totalUnits: number;
  analyzedUnits: number;
  skippedShortUnits: number;
  skippedOverCapUnits: number;
  totalWords: number;
  totalCharacters: number;
  aiClassifiedUnits: number;
  heuristicClassifiedUnits: number;
  averageConfidence: number;
  distributions: Record<string, Record<string, number>>;
  unitTypeDistribution: Record<string, number>;
  pageTimeline: PageTimelineEntry[];
  topKeywords: Array<{ term: string; count: number }>;
  sectionBreakdown: SectionBreakdownEntry[];
}

export interface AnalysisSummary {
  headline: string;
  narrative: string;
  dominantSentiment: string;
  dominantEmotion: string;
  dominantContentType: string;
  dominantTopic: string;
  source: 'ai' | 'derived';
  highlights: string[];
}

export interface AnalysisTiming {
  extractionMs: number;
  segmentationMs: number;
  analysisMs: number;
  aggregationMs: number;
  totalMs: number;
}

export interface AnalysisEngineInfo {
  provider: string;
  model: string;
  batchCount: number;
  aiRequests: number;
  aiRetries: number;
  aiFailures: number;
  degraded: boolean;
  notes: string[];
}

// -------------------------------------------------------------
// Trade Finance Document Compliance & Risk Intelligence Models
// -------------------------------------------------------------

export type ComplianceDecision = 'ALLOW' | 'REVIEW' | 'BLOCK_ESCALATE';
export type RiskSeverity = 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH' | 'CRITICAL';

export interface DocumentClassificationInfo {
  type: string;
  subtype: string;
  number: string;
  date: string;
  issuingParty: string;
  issuingCountry: string;
  transactionReference: string;
  relatedLcNumber: string;
  relatedPoNumber: string;
  relatedContractNumber: string;
  confidence: number;
}

export interface TradeParty {
  role: string;
  legalName: string;
  tradingName?: string;
  address?: string;
  country?: string;
  registrationNumber?: string;
  taxVatNumber?: string;
  website?: string;
  contactDetails?: string;
  bank?: string;
  bankCountry?: string;
  ibanOrAccountNumber?: string;
  swiftBic?: string;
}

export interface TradeParties {
  seller: TradeParty;
  buyer: TradeParty;
  applicant?: TradeParty;
  beneficiary?: TradeParty;
  issuingBank?: TradeParty;
  advisingBank?: TradeParty;
  confirmingBank?: TradeParty;
  nominatedBank?: TradeParty;
  remittingBank?: TradeParty;
  intermediaryBank?: TradeParty;
  shipper?: TradeParty;
  consignee?: TradeParty;
  notifyParty?: TradeParty;
  intermediateConsignee?: TradeParty;
  ultimateConsignee?: TradeParty;
  endUser?: TradeParty;
  freightForwarder?: TradeParty;
  carrier?: TradeParty;
  shippingAgent?: TradeParty;
  insuranceCompany?: TradeParty;
  inspectionCompany?: TradeParty;
  customsBroker?: TradeParty;
  manufacturer?: TradeParty;
  supplier?: TradeParty;
  otherIntermediaries?: TradeParty[];
}

export interface CommodityLineItem {
  id: string;
  itemNumber: number;
  productDescription: string;
  manufacturer?: string;
  brand?: string;
  model?: string;
  partNumber?: string;
  sku?: string;
  productCategory?: string;
  quantity: number;
  unitOfMeasure: string;
  unitPrice: number;
  totalLineValue: number;
  currency: string;
  countryOfOrigin?: string;
  hsCode?: string;
  eccn?: string;
  technicalSpecifications?: string;
  serialNumbers?: string[];
  batchNumbers?: string[];
  netWeight?: string;
  grossWeight?: string;
  packaging?: string;
  intendedUse?: string;
  statedEndUse?: string;
  isAuthorizedScope: boolean;
  scopeAuthorizationNote?: string;
  isControlledOrDualUse: boolean;
  controlClassification?: string;
  riskSeverity: RiskSeverity;
}

export interface ScopeValidationResult {
  declaredAuthorizedScope: string;
  authorizedGoods: CommodityLineItem[];
  outOfScopeGoods: CommodityLineItem[];
  hasOutOfScopeGoods: boolean;
  mismatchDetails: string[];
}

export interface EndUseAnalysisResult {
  statedEndUse: string;
  declaredCustomerBusiness: string;
  isIndustryConsistent: boolean;
  makesCommercialSense: boolean;
  explanation: string;
  redFlags: string[];
  riskSeverity: RiskSeverity;
}

export interface SanctionsMatch {
  entityOrSubject: string;
  roleOrField: string;
  matchedSanctionedName: string;
  sanctionsList: string;
  sanctionProgram?: string;
  matchType: string;
  matchConfidence: number;
  matchedIdentifiers: string[];
  countryAssociated?: string;
  sourceDatasetVersion: string;
  screeningTimestamp: string;
  recommendedAction: string;
}

export interface JurisdictionRiskCheck {
  nodeRole: string;
  countryName: string;
  countryCode?: string;
  sanctionsStatus: string;
  riskScore: number;
  description: string;
}

export interface SanctionsScreeningResult {
  status: string;
  overallSanctionsRiskScore: number;
  matches: SanctionsMatch[];
  jurisdictionRisks: JurisdictionRiskCheck[];
  screenedEntitiesCount: number;
  screenedCountriesCount: number;
  screenedVesselsCount: number;
  datasetVersion: string;
  screeningTimestamp: string;
}

export interface ExportControlsResult {
  riskStatus: string;
  riskScore: number;
  controlledGoods: Array<{
    itemDescription: string;
    hsCode?: string;
    eccn?: string;
    category: string;
    controlReason: string;
    licenseRequirement: string;
    destinationConcern: string;
    riskSeverity: RiskSeverity;
  }>;
  licenseConcerns: string[];
}

export interface TBMLRedFlag {
  category: string;
  severity: RiskSeverity;
  title: string;
  description: string;
  evidence: string;
  sourceCitation?: string;
  fatfReference?: string;
}

export interface TBMLAnalysisResult {
  overallTbmlRiskScore: number;
  riskLevel: RiskSeverity;
  priceConsistencyAssessment: string;
  quantityConsistencyAssessment: string;
  routingConsistencyAssessment: string;
  documentationConsistencyAssessment: string;
  redFlags: TBMLRedFlag[];
}

export interface DocumentDiscrepancy {
  id: string;
  documentA: string;
  documentB: string;
  field: string;
  valueA: string;
  valueB: string;
  severity: 'MATCH' | 'MINOR_DIFFERENCE' | 'MATERIAL_DISCREPANCY' | 'CRITICAL_CONFLICT' | 'MISSING_INFORMATION';
  explanation: string;
  sourcePages?: { docA?: number; docB?: number };
}

export interface MathematicalValidationResult {
  isMathematicallySound: boolean;
  calculatedSubtotal: number;
  declaredSubtotal: number;
  calculatedTotal: number;
  declaredTotal: number;
  currency: string;
  discrepancies: Array<{
    lineNumber?: number;
    description: string;
    expectedValue: number | string;
    actualValue: number | string;
    difference: number | string;
    severity: RiskSeverity;
  }>;
  integrityNotes: string[];
}

export interface DocumentIntegrityResult {
  riskScore: number;
  riskLevel: RiskSeverity;
  issues: Array<{
    type: string;
    description: string;
    evidence: string;
    severity: RiskSeverity;
  }>;
}

export interface RouteNode {
  nodeType: string;
  locationName: string;
  country: string;
  riskScore: number;
  sanctionsConcern: boolean;
  notes?: string;
}

export interface RouteAnalysisResult {
  nodes: RouteNode[];
  hasUnusualTransshipment: boolean;
  hasCircularRouting: boolean;
  overallRouteRiskScore: number;
  routeSummary: string;
}

export interface RiskScores {
  sanctions: number;
  exportControl: number;
  endUse: number;
  endUser: number;
  goods: number;
  tbml: number;
  documentIntegrity: number;
  geographic: number;
  transactionAnomaly: number;
  overall: number;
}

export interface EvidenceFinding {
  id: string;
  finding: string;
  severity: RiskSeverity;
  evidence: string;
  sourceDocument: string;
  pageNumber?: number;
  paragraphNumber?: number;
  extractedValue?: string;
  expectedValue?: string;
  reason: string;
  confidence: number;
  recommendedAction: string;
}

export interface ComplianceDecisionResult {
  decision: ComplianceDecision;
  confidence: number;
  reasons: string[];
  triggeredRules: string[];
  evidenceFindings: EvidenceFinding[];
  missingInformation: string[];
  recommendedActions: string[];
}

export interface HumanOverrideRecord {
  id: string;
  action: string;
  officerName: string;
  officerRole: string;
  timestamp: string;
  previousDecision: ComplianceDecision;
  overriddenDecision: ComplianceDecision;
  reason: string;
  notes: string;
}

export interface AuditTrailRecord {
  uploadTimestamp: string;
  documentHash: string;
  documentId: string;
  analyzerVersion: string;
  aiModel: string;
  promptVersion: string;
  sanctionsDatasetVersion: string;
  screeningTimestamp: string;
  extractedFieldsCount: number;
  rulesTriggered: string[];
  riskScores: RiskScores;
  initialDecision: ComplianceDecision;
  humanOverrides: HumanOverrideRecord[];
}

export interface TradeComplianceAnalysis {
  documentClassification: DocumentClassificationInfo;
  transaction: {
    transactionId: string;
    invoiceNumber: string;
    invoiceDate: string;
    proformaInvoiceNumber: string;
    purchaseOrderNumber: string;
    salesContractNumber: string;
    letterOfCreditNumber: string;
    amendmentNumber: string;
    customerReference: string;
    shipmentReference: string;
    bookingReference: string;
    customsReference: string;
    insuranceReference: string;
    parties: TradeParties;
    originCountry: string;
    destinationCountry: string;
    transitCountries: string[];
    portOfLoading?: string;
    portOfDischarge?: string;
    currency: string;
    totalValue: number;
    subtotal: number;
    freightCharges: number;
    insuranceCharges: number;
    paymentTerms: string;
    incoterm: string;
  };
  goods: CommodityLineItem[];
  scopeValidation: ScopeValidationResult;
  endUseAnalysis: EndUseAnalysisResult;
  sanctions: SanctionsScreeningResult;
  exportControls: ExportControlsResult;
  evasionIndicators: any[];
  tbml: TBMLAnalysisResult;
  discrepancies: DocumentDiscrepancy[];
  mathematicalValidation: MathematicalValidationResult;
  documentIntegrity: DocumentIntegrityResult;
  letterOfCredit?: any;
  routeAnalysis: RouteAnalysisResult;
  riskScores: RiskScores;
  decision: ComplianceDecisionResult;
  auditTrail: AuditTrailRecord;
}

export interface Analysis {
  summary: AnalysisSummary;
  statistics: Statistics;
  timing: AnalysisTiming;
  engine: AnalysisEngineInfo;
  completedAt: string;
  tradeCompliance?: TradeComplianceAnalysis;
}

export interface ExtractionInfo {
  pageCount: number;
  pagesEstimated: boolean;
  characterCount: number;
  wordCount: number;
  hasDetectedHeadings: boolean;
  extractor: string;
  warnings: string[];
}

export interface DocumentErrorInfo {
  code: string;
  message: string;
  at: string;
}

/** `GET /api/documents/:id` and `GET /api/documents/:id/results`. */
export interface DocumentDetail {
  id: string;
  filename: string;
  fileType: DocumentFileType;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: DocumentStatus;
  progress: Progress;
  extraction: ExtractionInfo | null;
  analysis: Analysis | null;
  error: DocumentErrorInfo | null;
}

/** `GET /api/documents`. */
export interface DocumentSummary {
  id: string;
  filename: string;
  fileType: DocumentFileType;
  fileSize: number;
  uploadedAt: string;
  finishedAt: string | null;
  status: DocumentStatus;
  percent: number;
  pageCount: number | null;
  analyzedUnits: number | null;
  dominantSentiment: string | null;
  processingMs: number | null;
  tradeDocumentType?: string | null;
  tradeDecision?: string | null;
  tradeOverallRisk?: number | null;
  buyerName?: string | null;
  sellerName?: string | null;
}

export interface DocumentListResponse {
  items: DocumentSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface UploadResponse {
  id: string;
  filename: string;
  fileType: DocumentFileType;
  fileSize: number;
  uploadedAt: string;
  status: DocumentStatus;
  progress: Progress;
  analysisStarted: boolean;
}

export interface StatusResponse {
  id: string;
  status: DocumentStatus;
  progress: Progress;
  queuePosition: number | null;
  error: DocumentErrorInfo | null;
  extraction: ExtractionInfo | null;
  finishedAt: string | null;
}

export interface UnitPage {
  items: AnalyzedUnit[];
  total: number;
  page: number;
  pageSize: number;
  unfilteredTotal: number;
  totalPages: number;
}

export interface UnitQuery {
  page?: number;
  pageSize?: number;
  sentiment?: string[];
  emotion?: string[];
  contentType?: string[];
  topic?: string[];
  unitType?: string[];
  documentPage?: number;
  section?: string;
  search?: string;
  minConfidence?: number;
  source?: 'ai' | 'heuristic';
}

export interface TaxonomyValue {
  id: string;
  label: string;
  description: string;
  tone: 'positive' | 'negative' | 'neutral' | 'informational';
}

export interface TaxonomyDimension {
  id: string;
  label: string;
  description: string;
  fallback: string;
  required: boolean;
  values: TaxonomyValue[];
}

export interface Taxonomy {
  dimensions: TaxonomyDimension[];
  unitTypes: Array<{ id: string; label: string }>;
}

export interface ClientConfig {
  upload: {
    maxFileSizeBytes: number;
    maxFileSizeMb: number;
    allowedExtensions: string[];
    retentionMinutes: number;
  };
  processing: {
    unitsPerBatch: number;
    maxUnits: number;
    minUnitChars: number;
    summaryEnabled: boolean;
  };
  results: {
    defaultPageSize: number;
    maxPageSize: number;
  };
  engine: {
    provider: string;
    model: string;
    remote: boolean;
  };
}

export interface HealthResponse {
  status: string;
  uptimeSeconds: number;
  environment: string;
  storage: { driver: string; requestedDriver: string };
  engine: { provider: string; model: string; remote: boolean; supportsSummary: boolean };
  queue: { active: number; pending: number; concurrency: number };
  timestamp: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId?: string;
  retryable?: boolean;
  details?: unknown;
}

export interface BatchUploadResponse {
  count: number;
  documents: UploadResponse[];
}

export interface ComparedDocumentProfile {
  id: string;
  filename: string;
  fileType: string;
  documentType: string;
  documentNumber: string;
  documentDate: string;
  role: string;
  totalValue: number;
  currency: string;
  parties: {
    seller: string;
    buyer: string;
    consignee?: string;
    issuingBank?: string;
    advisingBank?: string;
  };
  goods: Array<{
    description: string;
    quantity: number;
    uom: string;
    unitPrice: number;
    total: number;
    hsCode?: string;
  }>;
  ports: {
    loading?: string;
    discharge?: string;
  };
  dates: {
    issue?: string;
    shipment?: string;
    expiry?: string;
  };
  incoterm?: string;
}

export type ComparisonSeverity = 'VERIFIED_MATCH' | 'COMPATIBLE_VARIATION' | 'MATERIAL_DISCREPANCY' | 'CRITICAL_CONFLICT';

export interface ComparisonDiscrepancy {
  id: string;
  category: 'PARTIES' | 'AMOUNT_FINANCIALS' | 'GOODS_DESCRIPTION' | 'QUANTITY_WEIGHT' | 'DATES_CHRONOLOGY' | 'PORTS_ROUTING' | 'INCOTERMS';
  documentA: string;
  documentB: string;
  field: string;
  valueA: string;
  valueB: string;
  severity: ComparisonSeverity;
  explanation: string;
  ruleReference?: string;
}

export interface TradeComparisonResult {
  comparisonId: string;
  timestamp: string;
  documentCount: number;
  documents: ComparedDocumentProfile[];
  overallConsistencyScore: number; // 0 - 100
  verdict: 'COMPLIANT_PRESENTATION' | 'DISCREPANT_PRESENTATION_REQUIRES_AMENDMENT' | 'CRITICAL_REJECTION_OR_FRAUD_SUSPECT';
  verdictTitle: string;
  verdictSummary: string;
  discrepancies: ComparisonDiscrepancy[];
  verifiedMatchesCount: number;
  materialDiscrepanciesCount: number;
  criticalConflictsCount: number;
  recommendations: string[];
}