import type {
  ComplianceDecision,
  ComplianceDecisionResult,
  EvidenceFinding,
  RiskScores,
  SanctionsScreeningResult,
  ScopeValidationResult,
  ExportControlsResult,
  TBMLAnalysisResult,
  MathematicalValidationResult,
  DocumentIntegrityResult,
  DocumentDiscrepancy,
  RouteAnalysisResult,
  EndUseAnalysisResult,
} from './types';
import type {
  JurisdictionalNexusAssessment,
  OwnershipComplianceResult,
  SBPComplianceAssessment,
} from './temporal/temporal.types';
import type { TemporalScreeningResult } from './sanctions/temporal-sanctions.service';

export class RiskScoringEngine {
  readonly riskModelVersion = 'RISK-9FACTOR-TEMPORAL-V3.2';

  calculateScoresAndDecision(params: {
    sanctions: SanctionsScreeningResult;
    temporal?: TemporalScreeningResult;
    ownership?: OwnershipComplianceResult;
    sbpCompliance?: SBPComplianceAssessment;
    jurisdictionalNexus?: JurisdictionalNexusAssessment[];
    scopeValidation: ScopeValidationResult;
    exportControls: ExportControlsResult;
    endUse: EndUseAnalysisResult;
    tbml: TBMLAnalysisResult;
    mathValidation: MathematicalValidationResult;
    documentIntegrity: DocumentIntegrityResult;
    discrepancies: DocumentDiscrepancy[];
    route: RouteAnalysisResult;
    hasMissingEndUser?: boolean;
  }): { riskScores: RiskScores; decision: ComplianceDecisionResult } {
    const reasons: string[] = [];
    const triggeredRules: string[] = [];
    const evidenceFindings: EvidenceFinding[] = [];
    const missingInformation: string[] = [];
    const recommendedActions: string[] = [];

    // 1. Sanctions Risk (0-100) — Temporal Point-in-Time Evaluation
    let sanctionsScore = params.sanctions.overallSanctionsRiskScore;

    if (params.temporal) {
      if (params.temporal.wasListedAtTransactionTime) {
        sanctionsScore = 100;
        triggeredRules.push('RULE_SANCTIONS_ACTIVE_AT_TRANSACTION_DATE');
        const activeHit = params.temporal.temporalMatches.find((m) => m.wasListedAtTransactionTime);
        reasons.push(`Direct active sanctions designation at transaction date (${activeHit?.sanctionsList || 'OFAC'}).`);

        for (const m of params.temporal.temporalMatches.filter((m) => m.wasListedAtTransactionTime)) {
          evidenceFindings.push({
            id: `EV-SANC-${evidenceFindings.length + 1}`,
            finding: `Active Sanctioned Party: ${m.matchedName}`,
            severity: 'CRITICAL',
            evidence: `Party "${m.searchedName}" was designated on ${new Date(m.designationDate).toLocaleDateString()} under ${m.sanctionsList} (Program: ${m.programs.join(', ')}). Active at transaction timestamp.`,
            sourceDocument: 'Transaction Counterparties / Watchlist Dataset',
            reason: m.legalExplanation,
            confidence: m.matchConfidence,
            recommendedAction: m.recommendedAction,
          });
        }
      } else if (params.temporal.hasPostTransactionDesignations) {
        // Entity added AFTER transaction date -> Must NOT produce retroactive BLOCK!
        sanctionsScore = Math.max(35, params.sanctions.overallSanctionsRiskScore > 90 ? 45 : params.sanctions.overallSanctionsRiskScore);
        triggeredRules.push('RULE_SANCTIONS_ADDED_POST_TRANSACTION');
        const postHit = params.temporal.temporalMatches.find((m) => m.temporalStatus === 'ADDED_AFTER_TRANSACTION');
        reasons.push(`Subject was designated on ${new Date(postHit?.designationDate || '').toLocaleDateString()}, AFTER the transaction date. Retrospective monitoring active.`);

        for (const m of params.temporal.temporalMatches.filter((m) => m.temporalStatus === 'ADDED_AFTER_TRANSACTION')) {
          evidenceFindings.push({
            id: `EV-POST-SANC-${evidenceFindings.length + 1}`,
            finding: `Post-Transaction Designation: ${m.matchedName}`,
            severity: 'HIGH',
            evidence: `Party "${m.searchedName}" designated on ${new Date(m.designationDate).toLocaleDateString()} under ${m.sanctionsList}. Non-retroactive at transaction point.`,
            sourceDocument: 'Temporal Watchlist Registry',
            reason: m.legalExplanation,
            confidence: m.matchConfidence,
            recommendedAction: m.recommendedAction,
          });
        }
      } else if (params.sanctions.status === 'CONFIRMED_MATCH') {
        sanctionsScore = 100;
        triggeredRules.push('RULE_SANCTIONS_CONFIRMED_MATCH');
        reasons.push(`Direct confirmed hit on sanctioned entity list (${params.sanctions.matches[0]?.sanctionsList}).`);
      }
    } else if (params.sanctions.status === 'CONFIRMED_MATCH') {
      sanctionsScore = 100;
      triggeredRules.push('RULE_SANCTIONS_CONFIRMED_MATCH');
      reasons.push(`Direct confirmed hit on sanctioned entity list (${params.sanctions.matches[0]?.sanctionsList}).`);
    }

    if (params.sanctions.status === 'RESTRICTED_JURISDICTION') {
      triggeredRules.push('RULE_SANCTIONS_RESTRICTED_JURISDICTION');
      const jRisk = params.sanctions.jurisdictionRisks[0];
      reasons.push(`Transaction touches comprehensively sanctioned jurisdiction (${jRisk?.countryName}).`);
      evidenceFindings.push({
        id: `EV-JUR-${evidenceFindings.length + 1}`,
        finding: `Sanctioned Jurisdiction: ${jRisk?.countryName}`,
        severity: 'CRITICAL',
        evidence: `${jRisk?.nodeRole}: ${jRisk?.countryName} - ${jRisk?.description}`,
        sourceDocument: 'Geography / Route',
        reason: 'Trade embargo or comprehensive financial restriction in force.',
        confidence: 0.98,
        recommendedAction: 'Hold transaction. Validate OFAC/governmental specific license authorization.',
      });
    }

    // 2. Beneficial Ownership & Control Rules (OFAC 50% Rule / EU & UK Control Rules)
    if (params.ownership && params.ownership.isBlockedUnderOfac50PercentRule) {
      triggeredRules.push('RULE_OFAC_50_PERCENT_OWNERSHIP_RULE');
      sanctionsScore = Math.max(sanctionsScore, 95);
      reasons.push(`Entity is 50%+ owned (${params.ownership.aggregateBlockedOwnershipPercentage}%) by blocked parties (${params.ownership.blockingOwners.map((b) => b.ownerName).join(', ')}).`);
      evidenceFindings.push({
        id: `EV-OWN-${evidenceFindings.length + 1}`,
        finding: `Blocked Beneficial Ownership (${params.ownership.aggregateBlockedOwnershipPercentage}%)`,
        severity: 'CRITICAL',
        evidence: params.ownership.explanation,
        sourceDocument: 'Corporate Ownership Registry & Watchlists',
        reason: 'OFAC 50 Percent Rule and EU/UK ownership and control regulations.',
        confidence: 0.96,
        recommendedAction: 'Block transaction under beneficial ownership statutory provisions.',
      });
    }

    // 3. State Bank of Pakistan (SBP) Framework Checks
    if (params.sbpCompliance) {
      if (params.sbpCompliance.overallSbpVerdict === 'REJECT') {
        triggeredRules.push('RULE_SBP_TFS_DIRECTIVE_PROHIBITION');
        sanctionsScore = 100;
        reasons.push('Prohibited under State Bank of Pakistan Targeted Financial Sanctions directive.');
      } else if (params.sbpCompliance.overallSbpVerdict === 'FURTHER_DUE_DILIGENCE') {
        triggeredRules.push('RULE_SBP_TBML_ENHANCED_DUE_DILIGENCE');
        reasons.push('State Bank of Pakistan TBML / FE Manual compliance requires Authorized Dealer enhanced due diligence.');
      }
    }

    // 4. Scope & Goods Risk (0-100)
    let goodsScore = 10;
    if (params.scopeValidation.hasOutOfScopeGoods) {
      triggeredRules.push('RULE_OUT_OF_SCOPE_GOODS');
      goodsScore += 50;
      reasons.push(`${params.scopeValidation.outOfScopeGoods.length} line item(s) fall outside authorized transaction scope.`);
      for (const oos of params.scopeValidation.outOfScopeGoods) {
        evidenceFindings.push({
          id: `EV-SCOPE-${evidenceFindings.length + 1}`,
          finding: `Out-of-Scope Commodity: ${oos.productDescription}`,
          severity: 'HIGH',
          evidence: `Item ${oos.itemNumber}: "${oos.productDescription}" (${oos.quantity} ${oos.unitOfMeasure}) does not match authorized scope "${params.scopeValidation.declaredAuthorizedScope}".`,
          sourceDocument: 'Commercial Invoice / Scope Profile',
          reason: 'Commodity falls materially outside the authorized transaction scope / customer business profile.',
          confidence: 0.92,
          recommendedAction: 'Obtain updated purchase order, customer explanation, and verify commodity licensing.',
        });
      }
    }

    // 5. Export Control Risk (0-100)
    const exportControlScore = params.exportControls.riskScore;
    if (params.exportControls.controlledGoods.length > 0) {
      triggeredRules.push('RULE_DUAL_USE_EXPORT_CONTROL');
      reasons.push(`Identified ${params.exportControls.controlledGoods.length} potentially controlled / dual-use commodities.`);
      for (const cg of params.exportControls.controlledGoods) {
        evidenceFindings.push({
          id: `EV-EXP-${evidenceFindings.length + 1}`,
          finding: `Dual-Use / Controlled Good: ${cg.itemDescription}`,
          severity: cg.riskSeverity,
          evidence: `Product category: ${cg.category}. Reason: ${cg.controlReason}. ECCN: ${cg.eccn}.`,
          sourceDocument: 'Goods & Commodity Schedule',
          reason: cg.controlReason,
          confidence: 0.88,
          recommendedAction: cg.licenseRequirement,
        });
      }
    }

    // 6. End-Use & End-User Risk (0-100)
    let endUseScore = 15;
    let endUserScore = 15;
    if (params.endUse.redFlags.length > 0 || !params.endUse.isIndustryConsistent) {
      triggeredRules.push('RULE_END_USE_MISMATCH');
      endUseScore = 75;
      reasons.push('Stated end-use or customer industry appears inconsistent with ordered commodities.');
      evidenceFindings.push({
        id: `EV-ENDUSE-${evidenceFindings.length + 1}`,
        finding: 'End-Use / Customer Industry Mismatch',
        severity: 'HIGH',
        evidence: params.endUse.explanation,
        sourceDocument: 'Customer Profile & Goods Declaration',
        reason: 'BIS Red Flag: Transaction involves products inconsistent with buyer normal business.',
        confidence: 0.90,
        recommendedAction: 'Request End-User Certificate (EUC) and documented explanation of intended application.',
      });
    }

    if (params.hasMissingEndUser) {
      triggeredRules.push('RULE_END_USER_NOT_DISCLOSED');
      endUserScore = 65;
      missingInformation.push('Ultimate End-User Identity & Verified Physical Facility Address');
      recommendedActions.push('Obtain certified End-User Certificate (EUC) and verify ultimate consignee entity.');
    }

    // 7. TBML Risk (0-100)
    const tbmlScore = params.tbml.overallTbmlRiskScore;
    if (params.tbml.redFlags.length > 0) {
      triggeredRules.push('RULE_TBML_RED_FLAGS_TRIGGERED');
      for (const rf of params.tbml.redFlags) {
        reasons.push(`TBML indicator: ${rf.title}`);
        evidenceFindings.push({
          id: `EV-TBML-${evidenceFindings.length + 1}`,
          finding: rf.title,
          severity: rf.severity,
          evidence: `${rf.description} | Evidence: ${rf.evidence}`,
          sourceDocument: 'Transaction Invoicing & Logistics',
          reason: rf.fatfReference || 'FATF / SBP Trade-Based Money Laundering Indicator.',
          confidence: 0.86,
          recommendedAction: 'Conduct enhanced price and volumetric due diligence.',
        });
      }
    }

    // 8. Document Integrity & Mathematical Risk (0-100)
    const docIntegrityScore = params.documentIntegrity.riskScore;
    if (!params.mathValidation.isMathematicallySound) {
      triggeredRules.push('RULE_MATHEMATICAL_DISCREPANCY');
      reasons.push(`Identified ${params.mathValidation.discrepancies.length} arithmetic calculation errors in invoice totals.`);
      for (const md of params.mathValidation.discrepancies) {
        evidenceFindings.push({
          id: `EV-MATH-${evidenceFindings.length + 1}`,
          finding: 'Mathematical Calculation Discrepancy',
          severity: md.severity,
          evidence: md.description,
          sourceDocument: 'Commercial Invoice Pricing Grid',
          reason: 'Declared arithmetic fails automated verification (Quantity × Unit Price ≠ Total or Subtotal Sum Mismatch).',
          confidence: 0.99,
          recommendedAction: 'Request revised commercial invoice with rectified mathematical calculations.',
        });
      }
    }

    // 9. Cross-Document Discrepancies Risk
    let anomalyScore = 10;
    if (params.discrepancies.length > 0) {
      triggeredRules.push('RULE_CROSS_DOCUMENT_DISCREPANCIES');
      anomalyScore += params.discrepancies.length * 20;
      for (const d of params.discrepancies) {
        reasons.push(`Discrepancy: ${d.documentA} vs ${d.documentB} on ${d.field}`);
        evidenceFindings.push({
          id: `EV-DISC-${evidenceFindings.length + 1}`,
          finding: `Document Conflict: ${d.field}`,
          severity: d.severity === 'CRITICAL_CONFLICT' ? 'CRITICAL' : 'HIGH',
          evidence: `${d.documentA} (${d.valueA}) vs ${d.documentB} (${d.valueB}). ${d.explanation}`,
          sourceDocument: `${d.documentA} / ${d.documentB}`,
          reason: 'Inconsistent documentation between commercial, transport, or origin certificates.',
          confidence: 0.96,
          recommendedAction: 'Require documentary reconciliation from issuing carrier / beneficiary.',
        });
      }
    }

    // 10. Geographic & Route Risk
    const geoScore = params.route.overallRouteRiskScore;

    goodsScore = Math.min(100, goodsScore);
    endUseScore = Math.min(100, endUseScore);
    endUserScore = Math.min(100, endUserScore);
    anomalyScore = Math.min(100, anomalyScore);

    // 9-Factor Weighted Matrix Calculation
    let overallRisk = Math.round(
      sanctionsScore * 0.30 +
      exportControlScore * 0.15 +
      goodsScore * 0.15 +
      tbmlScore * 0.15 +
      endUseScore * 0.08 +
      endUserScore * 0.07 +
      docIntegrityScore * 0.04 +
      anomalyScore * 0.04 +
      geoScore * 0.02,
    );

    // Hard floors for critical findings
    if (sanctionsScore >= 90) overallRisk = Math.max(overallRisk, 95);
    if (params.scopeValidation.hasOutOfScopeGoods && params.discrepancies.length > 0) overallRisk = Math.max(overallRisk, 68);
    if (tbmlScore >= 70) overallRisk = Math.max(overallRisk, 72);

    overallRisk = Math.min(100, Math.max(0, overallRisk));

    const riskScores: RiskScores = {
      sanctions: sanctionsScore,
      exportControl: exportControlScore,
      endUse: endUseScore,
      endUser: endUserScore,
      goods: goodsScore,
      tbml: tbmlScore,
      documentIntegrity: docIntegrityScore,
      geographic: geoScore,
      transactionAnomaly: anomalyScore,
      overall: overallRisk,
    };

    // Determine Final Compliance Decision
    let decision: ComplianceDecision = 'ALLOW';
    let decisionConfidence = 0.95;

    const isDirectlySanctionedAtTransactionTime = params.temporal ? params.temporal.wasListedAtTransactionTime : sanctionsScore >= 90;

    if (overallRisk >= 80 || isDirectlySanctionedAtTransactionTime) {
      decision = 'BLOCK_ESCALATE';
      decisionConfidence = 0.98;
      recommendedActions.push('Escalate immediately to Sanctions Compliance Officer.');
      recommendedActions.push('Freeze / block processing pending regulatory clearance.');
    } else if (overallRisk >= 35 || reasons.length > 0 || missingInformation.length > 0 || params.temporal?.hasPostTransactionDesignations) {
      decision = 'REVIEW';
      decisionConfidence = 0.92;
      recommendedActions.push('Conduct enhanced compliance review before releasing transaction.');
      if (params.temporal?.hasPostTransactionDesignations) {
        recommendedActions.push('Verify post-transaction designation status and ensure no outstanding forward settlement commitments.');
      }
      if (params.scopeValidation.hasOutOfScopeGoods) {
        recommendedActions.push('Verify customer authorization for out-of-scope line items.');
      }
      if (params.discrepancies.length > 0) {
        recommendedActions.push('Request formal reconciliation of conflicting transport and origin documents.');
      }
    } else {
      decision = 'ALLOW';
      decisionConfidence = 0.96;
      reasons.push('No material compliance concern or active sanctions match identified from available documentation.');
      recommendedActions.push('Proceed with standard trade finance document processing and archiving.');
    }

    return {
      riskScores,
      decision: {
        decision,
        confidence: decisionConfidence,
        reasons: reasons.slice(0, 6),
        triggeredRules,
        evidenceFindings,
        missingInformation,
        recommendedActions,
      },
    };
  }
}

