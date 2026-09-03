import type { ComplianceDecision, IncotermCode, RiskSeverity, TradeDocumentTypeId } from '../config/trade-taxonomy';
export type { ComplianceDecision, IncotermCode, RiskSeverity, TradeDocumentTypeId };

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

export type SanctionsRiskStatus =
  | 'NONE'
  | 'POTENTIAL_MATCH'
  | 'CONFIRMED_MATCH'
  | 'RESTRICTED_JURISDICTION'
  | 'RESTRICTED_PARTY'
  | 'RESTRICTED_VESSEL'
  | 'RESTRICTED_BANK'
  | 'REQUIRES_LICENSE_AUTHORIZATION'
  | 'UNKNOWN_INSUFFICIENT_DATA';

export interface SanctionsMatch {
  entityOrSubject: string;
  roleOrField: string;
  matchedSanctionedName: string;
  sanctionsList: 'OFAC_SDN' | 'UN_CONSOLIDATED' | 'EU_SANCTIONS' | 'UK_OFSI' | 'INTERNAL_WATCHLIST' | 'OTHER';
  sanctionProgram?: string;
  matchType: 'EXACT' | 'FUZZY_NAME' | 'ALIAS' | 'VESSEL_IMO' | 'JURISDICTION' | 'SWIFT_CODE';
  matchConfidence: number;
  matchedIdentifiers: string[];
  countryAssociated?: string;
  sourceDatasetVersion: string;
  screeningTimestamp: string;
  recommendedAction: string;
}

export interface JurisdictionRiskCheck {
  nodeRole: 'ORIGIN' | 'PORT_OF_LOADING' | 'TRANSIT_COUNTRY' | 'TRANSSHIPMENT_PORT' | 'PORT_OF_DISCHARGE' | 'FINAL_DESTINATION' | 'COUNTERPARTY_COUNTRY';
  countryName: string;
  countryCode?: string;
  sanctionsStatus: 'COMPREHENSIVE_SANCTIONED' | 'SECTORAL_SANCTIONS' | 'EXPORT_CONTROL_RESTRICTED' | 'FATF_HIGH_RISK' | 'FATF_BLACK_LIST' | 'FATF_GREY_LIST' | 'CLEAR' | 'UNKNOWN';
  riskScore: number;
  description: string;
}

export interface SanctionsScreeningResult {
  status: SanctionsRiskStatus;
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
  riskStatus: 'POTENTIALLY_CONTROLLED' | 'CLASSIFICATION_REQUIRED' | 'POTENTIAL_LICENSE_REQUIRED' | 'KNOWN_RESTRICTED_CATEGORY' | 'NO_CONTROL_CONCERN_IDENTIFIED' | 'INSUFFICIENT_INFORMATION';
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

export interface EvasionIndicator {
  type: string;
  indicator: string;
  severity: RiskSeverity;
  evidence: string;
  sourcePage?: number;
  sourceSection?: string;
  explanation: string;
}

export interface TBMLRedFlag {
  category: 'PRICING_ANOMALY' | 'QUANTITY_VOLUME_MISMATCH' | 'ROUTING_TRANSSHIPMENT' | 'DOCUMENTARY_CONTRADICTION' | 'CUSTOMER_PRODUCT_MISMATCH' | 'PAYMENT_ROUTING';
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

export interface LetterOfCreditProfile {
  lcNumber?: string;
  issuingBank?: string;
  applicant?: string;
  beneficiary?: string;
  amount?: number;
  currency?: string;
  issueDate?: string;
  expiryDate?: string;
  latestShipmentDate?: string;
  availableWith?: string;
  paymentTerms?: string;
  tenor?: string;
  incoterm?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  partialShipmentAllowed?: boolean;
  transshipmentAllowed?: boolean;
  requiredDocuments?: string[];
  specialConditions?: string[];
  discrepanciesAgainstLC?: string[];
}

export interface RouteNode {
  nodeType: 'ORIGIN' | 'PORT_OF_LOADING' | 'TRANSIT_PORT' | 'PORT_OF_DISCHARGE' | 'FINAL_DESTINATION' | 'END_USER_LOCATION';
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
  sanctions: number;        // 0-100
  exportControl: number;    // 0-100
  endUse: number;           // 0-100
  endUser: number;          // 0-100
  goods: number;            // 0-100
  tbml: number;             // 0-100
  documentIntegrity: number;// 0-100
  geographic: number;       // 0-100
  transactionAnomaly: number;// 0-100
  overall: number;          // 0-100
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
  confidence: number; // 0-1
  reasons: string[];
  triggeredRules: string[];
  evidenceFindings: EvidenceFinding[];
  missingInformation: string[];
  recommendedActions: string[];
}

export interface HumanOverrideRecord {
  id: string;
  action: 'ESCALATE_TO_COMPLIANCE' | 'REQUEST_ADDITIONAL_DOCS' | 'MARK_FALSE_POSITIVE' | 'APPROVE_WITH_REVIEW' | 'REJECT' | 'ADD_INVESTIGATION_NOTE';
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

import type {
  AuditEvidencePackage,
  EnterpriseDecisionState,
  JurisdictionalNexusAssessment,
  OwnershipComplianceResult,
  RetrospectiveAlert,
} from './temporal/temporal.types';
import type { TemporalScreeningResult } from './sanctions/temporal-sanctions.service';
import type { ProductPriceIntelligenceResult } from './pricing/pricing.types';
import type { ProductRegulatoryIntelligenceResult } from './regulatory/regulatory.types';
import type { CustomerBehavioralAssessment } from './behavioral/behavioral.types';
import type { RouteComparisonResult } from './maritime/maritime.types';

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
    vesselName?: string;
    vesselImo?: string;
    vesselMmsi?: string;
    voyageNumber?: string;
    billOfLadingNumber?: string;
    containerNumber?: string;
    etd?: string;
    eta?: string;
    shipmentDate?: string;
    transshipmentDetails?: string;
    currency: string;
    totalValue: number;
    subtotal: number;
    freightCharges: number;
    insuranceCharges: number;
    paymentTerms: string;
    incoterm: IncotermCode | string;
    transactionTimestamp?: string;
  };
  goods: CommodityLineItem[];
  scopeValidation: ScopeValidationResult;
  endUseAnalysis: EndUseAnalysisResult;
  sanctions: SanctionsScreeningResult;
  temporalScreening: TemporalScreeningResult;
  jurisdictionalNexus: JurisdictionalNexusAssessment[];
  sbpCompliance: import('./temporal/temporal.types').SBPComplianceAssessment;
  ownershipCompliance: OwnershipComplianceResult;
  retrospectiveAlerts: RetrospectiveAlert[];
  auditEvidencePackage: AuditEvidencePackage;
  exportControls: ExportControlsResult;
  evasionIndicators: EvasionIndicator[];
  tbml: TBMLAnalysisResult;
  discrepancies: DocumentDiscrepancy[];
  mathematicalValidation: MathematicalValidationResult;
  documentIntegrity: DocumentIntegrityResult;
  letterOfCredit?: LetterOfCreditProfile;
  routeAnalysis: RouteAnalysisResult;
  maritimeIntelligence?: RouteComparisonResult;
  riskScores: RiskScores;
  decision: ComplianceDecisionResult;
  auditTrail: AuditTrailRecord;

  // Real-Time Market Pricing, Product Regulatory & Customer Behavioral Intelligence
  pricingIntelligence?: ProductPriceIntelligenceResult[];
  productRegulatoryIntelligence?: ProductRegulatoryIntelligenceResult[];
  customerBehavioralAssessment?: CustomerBehavioralAssessment;
}


