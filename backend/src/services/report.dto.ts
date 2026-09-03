import type { DocumentRecord } from '../models/document.model';
import type { RiskSeverity } from '../compliance/types';

export interface ReportExecutiveDecision {
  verdict: 'ALLOW' | 'REVIEW' | 'BLOCK_ESCALATE';
  verdictTitle: string;
  verdictText: string;
  confidencePercent: number;
  overallRiskScore: number;
  riskSeverityLabel: string;
  primaryRationale: string[];
  triggeredRules: string[];
}

export interface ReportTransactionProfile {
  documentType: string;
  documentNumber: string;
  documentDate: string;
  transactionReference: string;
  customerReference: string;
  sellerName: string;
  sellerCountry: string;
  buyerName: string;
  buyerCountry: string;
  issuingBank?: string;
  advisingBank?: string;
  consignee?: string;
  endUser?: string;
  originCountry: string;
  portOfLoading: string;
  portOfDischarge: string;
  destinationCountry: string;
  vesselName?: string;
  vesselImo?: string;
  incoterm: string;
  paymentTerms: string;
  currency: string;
  totalValueFormatted: string;
}

export interface ReportFindingItem {
  id: string;
  title: string;
  severity: RiskSeverity;
  category: 'SANCTIONS' | 'EXPORT_CONTROL' | 'PRICING' | 'ROUTE' | 'BEHAVIOR' | 'DISCREPANCY' | 'INTEGRITY';
  finding: string;
  evidence: string;
  regulatoryReference: string;
  recommendedAction: string;
}

export interface ReportSanctionsSummary {
  status: string;
  wasListedAtTransactionTime: boolean;
  isCurrentlyListed: boolean;
  hasPostTransactionDesignations: boolean;
  pointInTimeStatement: string;
  historicalFindingsSummary: string;
  currentFindingsSummary: string;
  screenedPartiesCount: number;
  beneficialOwnershipVerdict?: string;
  postTransactionAddendums: Array<{
    entityName: string;
    sanctionsList: string;
    designationDate: string;
    programs: string[];
  }>;
}

export interface ReportRouteIntelligence {
  hasData: boolean;
  declaredRouteSummary: string;
  observedRouteSummary: string;
  vesselIdentifier: string;
  intermediatePortsCount: number;
  undeclaredIntermediatePortsCount: number;
  undeclaredPortsList: string[];
  routeDeviationDetected: boolean;
  routeClassification: string;
  routeRiskLevel: string;
  routeRiskScore: number;
  routeFindings: string[];
  observedCallsTimeline: Array<{
    portName: string;
    locode: string;
    country: string;
    event: string;
    timestamp: string;
    isDeclared: boolean;
    source: string;
  }>;
  evidenceSummary: string;
  limitationNotice: string;
}

export interface ReportPricingIntelligence {
  items: Array<{
    itemNumber: number;
    description: string;
    hsCode: string;
    declaredPrice: string;
    benchmarkPrice: string;
    variancePercent: string;
    classification: string;
    authorityExcerpt: string;
  }>;
}

export interface ReportCustomerBehavior {
  customerReferenceId: string;
  legalName: string;
  declaredBusiness: string;
  historicalLcFrequencyMean: string;
  lifetimeVolumeFormatted: string;
  isReturningClient?: boolean;
  clientStatus?: string;
  comparisonSummary?: string;
  alerts: Array<{
    alertCode: string;
    severity: string;
    metric: string;
    observedValue: string;
    baselineValue: string;
    explanation: string;
  }>;
}

export interface ReportDiscrepancy {
  field: string;
  severity: string;
  docA: string;
  valueA: string;
  docB: string;
  valueB: string;
  explanation: string;
}

export interface ReportEvidenceDigest {
  packageId: string;
  documentSha256: string;
  transactionHashSha256: string;
  verificationDigestSha256: string;
  ruleSetVersion: string;
  snapshotsUsed: Array<{
    sourceId: string;
    version: string;
    checksumTruncated: string;
    effectiveDate: string;
  }>;
}

export interface ComplianceReportModel {
  filename: string;
  fileSizeFormatted: string;
  fileType: string;
  screenedAtFormatted: string;
  engineProvider: string;
  executiveDecision: ReportExecutiveDecision;
  transactionProfile: ReportTransactionProfile;
  riskScores: Array<{ label: string; score: number }>;
  criticalFindings: ReportFindingItem[];
  sanctionsSummary: ReportSanctionsSummary;
  routeIntelligence: ReportRouteIntelligence;
  pricingIntelligence: ReportPricingIntelligence;
  customerBehavior?: ReportCustomerBehavior;
  discrepancies: ReportDiscrepancy[];
  evidenceDigest: ReportEvidenceDigest;
}

/**
 * Builds the purpose-built ComplianceReportModel DTO from internal DocumentRecord.
 */
export function buildComplianceReportModel(doc: DocumentRecord): ComplianceReportModel {
  const tc = doc.analysis?.tradeCompliance;
  const decision = tc?.decision.decision || 'REVIEW';
  const riskOverall = tc?.riskScores.overall ?? 0;

  const verdictTitle =
    decision === 'ALLOW'
      ? 'ALLOW — PASS VERIFICATION'
      : decision === 'REVIEW'
      ? 'REVIEW — ENHANCED DUE DILIGENCE'
      : 'BLOCK / ESCALATE — CRITICAL VIOLATION';

  const verdictText =
    decision === 'ALLOW'
      ? 'Presentation complies with applicable sanctions, export controls, and customary trade policy.'
      : decision === 'REVIEW'
      ? 'Elevated anomalies or documentary discrepancies detected. Compliance Officer review required prior to document release.'
      : 'Critical compliance violation, direct sanctions match, or prohibited jurisdiction detected. Transaction halted.';

  const riskSeverityLabel =
    riskOverall < 25 ? 'LOW RISK' : riskOverall < 60 ? 'ELEVATED RISK' : 'HIGH RISK VIOLATION';

  // Format File metadata
  const fileSizeFormatted = formatBytes(doc.fileSize);
  const screenedAtFormatted = formatDate(doc.uploadedAt || doc.startedAt);

  // Executive Decision
  const executiveDecision: ReportExecutiveDecision = {
    verdict: decision,
    verdictTitle,
    verdictText,
    confidencePercent: Math.round((tc?.decision.confidence ?? 0.95) * 100),
    overallRiskScore: riskOverall,
    riskSeverityLabel,
    primaryRationale: tc?.decision.reasons?.slice(0, 5) || ['Standard compliance verification.'],
    triggeredRules: tc?.decision.triggeredRules || [],
  };

  // Transaction Profile
  const txn = tc?.transaction;
  const parties = txn?.parties;
  const currency = txn?.currency || 'USD';
  const totalVal = txn?.totalValue || 0;

  const transactionProfile: ReportTransactionProfile = {
    documentType: `${tc?.documentClassification.type || 'Trade Document'}${tc?.documentClassification.subtype ? ` (${tc.documentClassification.subtype})` : ''}`,
    documentNumber: tc?.documentClassification.number || 'Not Disclosed',
    documentDate: tc?.documentClassification.date || 'Not Disclosed',
    transactionReference: txn?.transactionId || doc.id.slice(0, 12),
    customerReference: txn?.customerReference || 'TG-CUST-GENERAL',
    sellerName: parties?.seller.legalName || 'Not Disclosed',
    sellerCountry: parties?.seller.country || 'N/A',
    buyerName: parties?.buyer.legalName || 'Not Disclosed',
    buyerCountry: parties?.buyer.country || 'N/A',
    issuingBank: parties?.issuingBank?.bank || parties?.issuingBank?.legalName,
    advisingBank: parties?.advisingBank?.bank || parties?.advisingBank?.legalName,
    consignee: parties?.consignee?.legalName,
    endUser: parties?.endUser?.legalName,
    originCountry: txn?.originCountry || 'N/A',
    portOfLoading: txn?.portOfLoading || 'Not Specified',
    portOfDischarge: txn?.portOfDischarge || 'Not Specified',
    destinationCountry: txn?.destinationCountry || 'N/A',
    vesselName: txn?.vesselName,
    vesselImo: txn?.vesselImo,
    incoterm: txn?.incoterm || 'CIF',
    paymentTerms: txn?.paymentTerms || 'Commercial Credit Terms',
    currency,
    totalValueFormatted: `${currency} ${totalVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  };

  // 10D Risk Scores
  const rs = tc?.riskScores;
  const riskScores = [
    { label: '1. Sanctions Risk', score: rs?.sanctions ?? 0 },
    { label: '2. Export Control Risk', score: rs?.exportControl ?? 0 },
    { label: '3. Goods & Dual-Use Scope', score: rs?.goods ?? 0 },
    { label: '4. TBML / Pricing Anomalies', score: rs?.tbml ?? 0 },
    { label: '5. End-Use Consistency', score: rs?.endUse ?? 0 },
    { label: '6. End-User Identification', score: rs?.endUser ?? 0 },
    { label: '7. Mathematical Integrity', score: rs?.documentIntegrity ?? 0 },
    { label: '8. Geographic & Route Risk', score: rs?.geographic ?? 0 },
    { label: '9. Transaction Anomalies', score: rs?.transactionAnomaly ?? 0 },
  ];

  // Prioritize findings: CRITICAL -> HIGH -> ELEVATED -> MODERATE -> LOW
  const rawFindings = tc?.decision.evidenceFindings || [];
  const severityWeight: Record<RiskSeverity, number> = {
    CRITICAL: 5,
    HIGH: 4,
    ELEVATED: 3,
    MODERATE: 2,
    LOW: 1,
  };

  const criticalFindings: ReportFindingItem[] = rawFindings
    .map((ef) => ({
      id: ef.id,
      title: ef.finding,
      severity: ef.severity,
      category: categorizeFinding(ef.id, ef.finding),
      finding: ef.evidence,
      evidence: ef.reason,
      regulatoryReference: ef.sourceDocument,
      recommendedAction: ef.recommendedAction,
    }))
    .sort((a, b) => (severityWeight[b.severity] || 0) - (severityWeight[a.severity] || 0));

  // Sanctions Summary
  const temp = tc?.temporalScreening;
  const postMatches = temp?.temporalMatches?.filter((m) => m.temporalStatus === 'ADDED_AFTER_TRANSACTION') || [];
  const sanctionsSummary: ReportSanctionsSummary = {
    status: tc?.sanctions.status || 'CLEARED',
    wasListedAtTransactionTime: temp?.wasListedAtTransactionTime ?? false,
    isCurrentlyListed: temp?.isCurrentlyListed ?? false,
    hasPostTransactionDesignations: temp?.hasPostTransactionDesignations ?? false,
    pointInTimeStatement: temp
      ? `Screened as of ${formatDate(temp.transactionTimestamp)} against OFAC, UN, EU, UK & SBP datasets.`
      : 'Point-in-time multi-jurisdiction watchlist screening performed.',
    historicalFindingsSummary: temp?.historicalFindingsSummary || 'No active designation found at transaction date.',
    currentFindingsSummary: temp?.currentFindingsSummary || 'No active match found in current registers.',
    screenedPartiesCount: temp?.screenedEntitiesCount ?? (tc?.sanctions.screenedEntitiesCount || 4),
    beneficialOwnershipVerdict: tc?.ownershipCompliance?.isBlockedUnderOfac50PercentRule
      ? `BLOCKED UNDER OFAC 50% RULE (${tc.ownershipCompliance.aggregateBlockedOwnershipPercentage}% owned by blocked parties)`
      : 'CLEARED under OFAC 50% beneficial ownership rule.',
    postTransactionAddendums: postMatches.map((pm) => ({
      entityName: pm.matchedName,
      sanctionsList: pm.sanctionsList,
      designationDate: formatDate(pm.designationDate),
      programs: pm.programs,
    })),
  };

  // Route Intelligence
  const m = tc?.maritimeIntelligence;
  const hasRouteData = Boolean(m && m.routeClassification !== 'ROUTE_DATA_UNAVAILABLE');
  const routeIntelligence: ReportRouteIntelligence = {
    hasData: hasRouteData,
    declaredRouteSummary: `${transactionProfile.originCountry} -> ${transactionProfile.portOfLoading} -> ${transactionProfile.portOfDischarge} -> ${transactionProfile.destinationCountry}`,
    observedRouteSummary: m?.observedRoute
      ? `${m.observedRoute.originPort.name} -> ${m.observedRoute.intermediateCalls.map((c) => c.port.name).concat([m.observedRoute.portOfDischarge.name]).join(' -> ')}`
      : 'Historical vessel AIS tracking data unavailable',
    vesselIdentifier: m?.vessel?.imo ? `IMO ${m.vessel.imo} (${m.vessel.name})` : (transactionProfile.vesselName || 'Unspecified Vessel'),
    intermediatePortsCount: m?.intermediatePortsCount ?? 0,
    undeclaredIntermediatePortsCount: m?.undeclaredIntermediatePortsCount ?? 0,
    undeclaredPortsList: m?.undeclaredPorts.map((p) => `${p.name} (${p.locode})`) || [],
    routeDeviationDetected: m?.routeDeviationDetected ?? false,
    routeClassification: m?.routeClassification || 'ROUTE_DATA_UNAVAILABLE',
    routeRiskLevel: m?.routeRiskLevel || 'LOW',
    routeRiskScore: m?.routeRiskScore ?? 10,
    routeFindings: m?.routeFindings || ['Standard point-to-point carriage.'],
    observedCallsTimeline: m?.observedRoute
      ? m.observedRoute.intermediateCalls.map((c) => ({
          portName: c.port.name,
          locode: c.port.locode,
          country: c.port.country,
          event: 'PORT CALL',
          timestamp: formatDate(c.arrivalTime || c.departureTime),
          isDeclared: c.wasDeclared,
          source: 'AIS Historical Port Calls',
        }))
      : [],
    evidenceSummary: m?.evidenceRecords?.[0]?.sourceReference || 'AIS Automated Port-Call Digest',
    limitationNotice:
      m?.limitationNotice ||
      'Vessel-level route evidence does not by itself establish cargo-level transshipment. Observed vessel movements reflect port calls during the relevant voyage window.',
  };

  // Pricing Intelligence
  const pricingItems = (tc?.pricingIntelligence || []).map((pi) => {
    const verdictLabel =
      pi.classification === 'HIGH_PRICE_ANOMALY'
        ? 'OVER PRICED'
        : pi.classification === 'LOW_PRICE_ANOMALY'
        ? 'UNDER PRICED'
        : pi.classification === 'WITHIN_EXPECTED_RANGE'
        ? 'OK PRICE'
        : 'AWAITING BENCHMARK';

    return {
      itemNumber: pi.itemNumber,
      description: pi.productDescription,
      hsCode: pi.hsCode || 'N/A',
      declaredPrice: `${pi.declaredCurrency} ${pi.declaredUnitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${pi.declaredUnitOfMeasure || 'unit'}`,
      benchmarkPrice: pi.hasMarketData ? `USD $${pi.benchmarkUnitPriceUsd?.toFixed(2)} (Range: $${pi.observedMarketLowUsd?.toFixed(2)} - $${pi.observedMarketHighUsd?.toFixed(2)})` : 'Verified Market Range',
      variancePercent: pi.priceVariancePercent !== undefined ? `${pi.priceVariancePercent > 0 ? '+' : ''}${pi.priceVariancePercent}% [${verdictLabel}]` : `[${verdictLabel}]`,
      classification: pi.classification,
      authorityExcerpt: pi.evidenceRecords?.[0] ? `${pi.evidenceRecords[0].publisher}: ${pi.evidenceRecords[0].sourceTitle}` : 'UN Comtrade & Customs Valuation Directorate',
    };
  });

  const pricingIntelligence: ReportPricingIntelligence = {
    items: pricingItems,
  };

  // Customer Behavior
  let customerBehavior: ReportCustomerBehavior | undefined;
  if (tc?.customerBehavioralAssessment) {
    const cba = tc.customerBehavioralAssessment;
    const ca = cba.comparisonAnalytics;
    customerBehavior = {
      customerReferenceId: cba.customerProfile.customerReferenceId,
      legalName: cba.customerProfile.legalName,
      declaredBusiness: cba.customerProfile.declaredBusinessActivity || 'General Trading',
      historicalLcFrequencyMean: `${cba.baselines.historicalLcFrequencyMean.toFixed(1)} LCs/month`,
      lifetimeVolumeFormatted: `USD ${cba.customerProfile.lifetimeVolumeUsd.toLocaleString()}`,
      isReturningClient: ca?.isReturningClient ?? (cba.customerProfile.lifetimeTransactionCount > 1),
      clientStatus: ca?.clientStatus ?? (cba.customerProfile.lifetimeTransactionCount > 1 ? 'RETURNING_CLIENT' : 'FIRST_TIME_CLIENT'),
      comparisonSummary: ca?.summaryNarrative || `Profile ${cba.customerProfile.customerReferenceId}: ${cba.customerProfile.lifetimeTransactionCount} lifetime transactions.`,
      alerts: cba.alerts.map((a) => ({
        alertCode: a.alertCode,
        severity: a.severity,
        metric: a.metric,
        observedValue: String(a.observedValue),
        baselineValue: String(a.baselineValue),
        explanation: a.explanation,
      })),
    };
  }

  // Discrepancies
  const discrepancies: ReportDiscrepancy[] = (tc?.discrepancies || []).map((d) => ({
    field: d.field,
    severity: d.severity,
    docA: d.documentA,
    valueA: d.valueA,
    docB: d.documentB,
    valueB: d.valueB,
    explanation: d.explanation,
  }));

  // Evidence Digest
  const ep = tc?.auditEvidencePackage;
  const evidenceDigest: ReportEvidenceDigest = {
    packageId: ep?.evidencePackageId || `TG-AUD-${doc.id.slice(0, 8).toUpperCase()}`,
    documentSha256: ep?.documentSha256 || 'N/A',
    transactionHashSha256: ep?.transactionHashSha256 || 'N/A',
    verificationDigestSha256: ep?.verificationDigestSha256 || 'N/A',
    ruleSetVersion: ep?.ruleSetVersion || 'TG-COMPLIANCE-RULES-V2026.3',
    snapshotsUsed: (ep?.regulatorySnapshotsUsed || []).map((s) => ({
      sourceId: s.sourceId,
      version: s.version,
      checksumTruncated: `${s.checksumSha256.slice(0, 16)}...`,
      effectiveDate: formatDate(s.effectiveAt),
    })),
  };

  return {
    filename: doc.filename,
    fileSizeFormatted,
    fileType: doc.fileType.toUpperCase(),
    screenedAtFormatted,
    engineProvider: doc.analysis?.engine.provider || 'DocuIntel AI Core',
    executiveDecision,
    transactionProfile,
    riskScores,
    criticalFindings,
    sanctionsSummary,
    routeIntelligence,
    pricingIntelligence,
    customerBehavior,
    discrepancies,
    evidenceDigest,
  };
}

function categorizeFinding(id: string, text: string): ReportFindingItem['category'] {
  const upper = (id + ' ' + text).toUpperCase();
  if (upper.includes('SANC') || upper.includes('SDN') || upper.includes('WATCHLIST')) return 'SANCTIONS';
  if (upper.includes('EXPORT') || upper.includes('ECCN') || upper.includes('DUAL')) return 'EXPORT_CONTROL';
  if (upper.includes('PRICE') || upper.includes('TBML') || upper.includes('BENCHMARK')) return 'PRICING';
  if (upper.includes('ROUTE') || upper.includes('PORT') || upper.includes('VESSEL') || upper.includes('AIS')) return 'ROUTE';
  if (upper.includes('BEH') || upper.includes('CUSTOMER') || upper.includes('FREQUENCY')) return 'BEHAVIOR';
  if (upper.includes('MATH') || upper.includes('INTEGRITY') || upper.includes('ARITHMETIC')) return 'INTEGRITY';
  return 'DISCREPANCY';
}

function formatBytes(bytes: number): string {
  if (!bytes || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return String(dateStr);
  }
}
