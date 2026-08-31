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

export class RiskScoringEngine {
  calculateScoresAndDecision(params: {
    sanctions: SanctionsScreeningResult;
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

    // 1. Sanctions Risk (0-100)
    const sanctionsScore = params.sanctions.overallSanctionsRiskScore;
    if (params.sanctions.status === 'CONFIRMED_MATCH') {
      triggeredRules.push('RULE_SANCTIONS_CONFIRMED_MATCH');
      reasons.push(`Direct confirmed hit on sanctioned entity list (${params.sanctions.matches[0]?.sanctionsList}).`);
      for (const m of params.sanctions.matches) {
        evidenceFindings.push({
          id: `EV-SANC-${evidenceFindings.length + 1}`,
          finding: `Sanctioned Party Match: ${m.matchedSanctionedName}`,
          severity: 'CRITICAL',
          evidence: `Entity "${m.entityOrSubject}" matched ${m.matchedSanctionedName} on ${m.sanctionsList} (Program: ${m.sanctionProgram}).`,
          sourceDocument: 'Transaction Parties',
          reason: 'Prohibited party under international sanctions legislation.',
          confidence: m.matchConfidence,
          recommendedAction: m.recommendedAction,
        });
      }
    } else if (params.sanctions.status === 'RESTRICTED_JURISDICTION') {
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
    } else if (params.sanctions.status === 'POTENTIAL_MATCH') {
      triggeredRules.push('RULE_SANCTIONS_POTENTIAL_MATCH');
      reasons.push('Potential name match identified on sanctions watchlist requiring human verification.');
    }

    // 2. Scope & Goods Risk (0-100)
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

    // 3. Export Control Risk (0-100)
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

    // 4. End-Use & End-User Risk (0-100)
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

    // 5. TBML Risk (0-100)
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
          reason: rf.fatfReference || 'FATF Trade-Based Money Laundering Indicator.',
          confidence: 0.86,
          recommendedAction: 'Conduct enhanced price and volumetric due diligence.',
        });
      }
    }

    // 6. Document Integrity & Mathematical Risk (0-100)
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

    // 7. Cross-Document Discrepancies Risk
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

    // 8. Geographic & Route Risk
    const geoScore = params.route.overallRouteRiskScore;

    // Aggregate Weighted Overall Risk Score (0-100)
    goodsScore = Math.min(100, goodsScore);
    endUseScore = Math.min(100, endUseScore);
    endUserScore = Math.min(100, endUserScore);
    anomalyScore = Math.min(100, anomalyScore);

    // Weights: Sanctions 30%, Export Controls 15%, Scope/Goods 15%, TBML 15%, End-Use 10%, Integrity 5%, Discrepancies 5%, Geo 5%
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

    if (overallRisk >= 80 || sanctionsScore >= 90) {
      decision = 'BLOCK_ESCALATE';
      decisionConfidence = 0.98;
      recommendedActions.push('Escalate immediately to Sanctions Compliance Officer.');
      recommendedActions.push('Freeze / block processing pending regulatory clearance.');
    } else if (overallRisk >= 35 || reasons.length > 0 || missingInformation.length > 0) {
      decision = 'REVIEW';
      decisionConfidence = 0.92;
      recommendedActions.push('Conduct enhanced compliance review before releasing transaction.');
      if (params.scopeValidation.hasOutOfScopeGoods) {
        recommendedActions.push('Verify customer authorization for out-of-scope line items.');
      }
      if (params.discrepancies.length > 0) {
        recommendedActions.push('Request formal reconciliation of conflicting transport and origin documents.');
      }
    } else {
      decision = 'ALLOW';
      decisionConfidence = 0.96;
      reasons.push('No material compliance concern or sanctions match identified from available documentation.');
      recommendedActions.push('Proceed with standard trade finance document processing and archiving.');
    }

    if (missingInformation.length === 0 && decision === 'REVIEW') {
      missingInformation.push('Confirmation of physical shipment arrival / customs clearance record');
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
