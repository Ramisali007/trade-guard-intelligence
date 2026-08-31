import type { DocumentRecord } from '../models/document.model';

const WIDTH = 82;
const MAJOR_RULE = '='.repeat(WIDTH);
const MINOR_RULE = '-'.repeat(WIDTH);

export function generateTextReport(document: DocumentRecord): string {
  const analysis = document.analysis;
  const tc = analysis?.tradeCompliance;
  const lines: string[] = [];

  lines.push(MAJOR_RULE);
  lines.push(centre('TRADE FINANCE DOCUMENT COMPLIANCE & RISK INTELLIGENCE REPORT'));
  lines.push(centre('CONFIDENTIAL & PRIVILEGED — BANKING COMPLIANCE SYSTEM'));
  lines.push(MAJOR_RULE);
  lines.push('');

  // ---------------------------------------------------------------- Document Meta
  lines.push(field('File Name', document.filename));
  lines.push(field('File Type', document.fileType.toUpperCase()));
  lines.push(field('File Size', formatBytes(document.fileSize)));
  lines.push(field('Document Hash', tc?.auditTrail.documentHash ? tc.auditTrail.documentHash.slice(0, 32) + '...' : 'Not Available'));
  lines.push(field('Screening Date', tc?.sanctions.screeningTimestamp || new Date().toISOString()));
  lines.push(field('Analyzer Version', 'TradeCompliance-v3.0.0 (Banking Ruleset)'));
  lines.push(field('Sanctions Dataset', tc?.sanctions.datasetVersion || 'OFAC / UN / EU / UK Consolidated'));
  lines.push('');

  if (!tc) {
    lines.push(MINOR_RULE);
    lines.push('STATUS: PENDING / FAILED');
    lines.push(MINOR_RULE);
    lines.push(`Document status: ${document.status}.`);
    if (document.error) lines.push(`Reason: ${document.error.message}`);
    lines.push('');
    lines.push(MAJOR_RULE);
    lines.push(centre('END OF REPORT'));
    lines.push(MAJOR_RULE);
    return lines.join('\n');
  }

  // ================================================================= A. Executive Summary
  lines.push(MAJOR_RULE);
  lines.push('A. EXECUTIVE SUMMARY');
  lines.push(MAJOR_RULE);
  lines.push('');
  lines.push(field('Document Type', tc.documentClassification.type));
  lines.push(field('Document Number', tc.documentClassification.number));
  lines.push(field('Document Date', tc.documentClassification.date));
  lines.push(field('Classification Confidence', `${Math.round(tc.documentClassification.confidence * 100)}%`));
  lines.push(field('Overall Risk Score', `${tc.riskScores.overall} / 100 (${getRiskLabel(tc.riskScores.overall)})`));
  lines.push(field('Compliance Decision', `[ ${tc.decision.decision} ]`));
  lines.push(field('Decision Confidence', `${Math.round(tc.decision.confidence * 100)}%`));
  lines.push('');
  lines.push('Key Decision Reasons:');
  for (const reason of tc.decision.reasons) {
    lines.push(`  * ${reason}`);
  }
  lines.push('');

  // ================================================================= B. Transaction Overview
  lines.push(MAJOR_RULE);
  lines.push('B. TRANSACTION OVERVIEW');
  lines.push(MAJOR_RULE);
  lines.push('');
  const txn = tc.transaction;
  const p = txn.parties;
  lines.push(field('Transaction Reference', txn.transactionId));
  lines.push(field('Seller / Exporter', `${p.seller.legalName} (${p.seller.country})`));
  lines.push(field('Buyer / Importer', `${p.buyer.legalName} (${p.buyer.country})`));
  if (p.applicant?.legalName !== 'Not Found') lines.push(field('Applicant', `${p.applicant?.legalName} (${p.applicant?.country})`));
  if (p.beneficiary?.legalName !== 'Not Found') lines.push(field('Beneficiary', `${p.beneficiary?.legalName} (${p.beneficiary?.country})`));
  if (p.issuingBank?.legalName !== 'Not Found') lines.push(field('Issuing Bank', `${p.issuingBank?.bank || p.issuingBank?.legalName} (SWIFT: ${p.issuingBank?.swiftBic || 'N/A'})`));
  if (p.advisingBank?.legalName !== 'Not Found') lines.push(field('Advising Bank', `${p.advisingBank?.bank || p.advisingBank?.legalName} (SWIFT: ${p.advisingBank?.swiftBic || 'N/A'})`));
  lines.push(field('Shipper', p.shipper?.legalName || p.seller.legalName));
  lines.push(field('Consignee', `${p.consignee?.legalName} (${p.consignee?.country || 'N/A'})`));
  lines.push(field('Ultimate End User', `${p.endUser?.legalName} (${p.endUser?.country || 'N/A'})`));
  lines.push(field('Origin Country', txn.originCountry));
  lines.push(field('Port of Loading', txn.portOfLoading || 'Not Specified'));
  lines.push(field('Port of Discharge', txn.portOfDischarge || 'Not Specified'));
  lines.push(field('Final Destination', txn.destinationCountry));
  lines.push(field('Incoterm', txn.incoterm));
  lines.push(field('Payment Terms', txn.paymentTerms));
  lines.push(field('Total Transaction Value', `${txn.currency} ${txn.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`));
  lines.push('');

  // ================================================================= C. Goods & Commodities Summary
  lines.push(MAJOR_RULE);
  lines.push('C. GOODS & COMMODITY INTELLIGENCE');
  lines.push(MAJOR_RULE);
  lines.push('');
  lines.push(padRight('#', 4) + padRight('Product Description', 34) + padRight('HS Code', 12) + padRight('Qty / UOM', 12) + padRight('Unit Price', 10) + 'Line Total');
  lines.push(MINOR_RULE);
  for (const g of tc.goods) {
    const desc = g.productDescription.length > 32 ? g.productDescription.slice(0, 29) + '...' : g.productDescription;
    const qtyUom = `${g.quantity} ${g.unitOfMeasure}`;
    const unitP = `${g.currency} ${g.unitPrice}`;
    const totalL = `${g.currency} ${g.totalLineValue.toLocaleString('en-US')}`;
    lines.push(padRight(String(g.itemNumber), 4) + padRight(desc, 34) + padRight(g.hsCode || 'N/A', 12) + padRight(qtyUom, 12) + padRight(unitP, 10) + totalL);
    if (!g.isAuthorizedScope) {
      lines.push(`     [!] SCOPE ALERT: ${g.scopeAuthorizationNote}`);
    }
    if (g.isControlledOrDualUse) {
      lines.push(`     [!] CONTROL ALERT: Dual-use / ${g.controlClassification}`);
    }
  }
  lines.push('');

  // ================================================================= D. Sanctions Screening
  lines.push(MAJOR_RULE);
  lines.push('D. SANCTIONS & RESTRICTED ENTITY SCREENING');
  lines.push(MAJOR_RULE);
  lines.push('');
  lines.push(field('Screening Status', tc.sanctions.status));
  lines.push(field('Sanctions Risk Score', `${tc.sanctions.overallSanctionsRiskScore} / 100`));
  lines.push(field('Entities Screened', String(tc.sanctions.screenedEntitiesCount)));
  lines.push(field('Jurisdictions Screened', String(tc.sanctions.screenedCountriesCount)));
  lines.push(field('Vessels Screened', String(tc.sanctions.screenedVesselsCount)));
  lines.push('');
  if (tc.sanctions.matches.length > 0) {
    lines.push('SANCTIONS MATCHES IDENTIFIED:');
    for (const m of tc.sanctions.matches) {
      lines.push(`  * [${m.matchType}] Entity: "${m.entityOrSubject}" (Role: ${m.roleOrField})`);
      lines.push(`    Matched: ${m.matchedSanctionedName} on ${m.sanctionsList} (Program: ${m.sanctionProgram})`);
      lines.push(`    Confidence: ${Math.round(m.matchConfidence * 100)}% | Identifiers: ${m.matchedIdentifiers.join(', ')}`);
      lines.push(`    Action: ${m.recommendedAction}`);
    }
  } else {
    lines.push('No confirmed or potential party watchlist hits identified.');
  }

  if (tc.sanctions.jurisdictionRisks.length > 0) {
    lines.push('');
    lines.push('JURISDICTION / GEOGRAPHIC RESTRICTIONS:');
    for (const j of tc.sanctions.jurisdictionRisks) {
      lines.push(`  * ${j.nodeRole}: ${j.countryName} (${j.sanctionsStatus}) - Risk: ${j.riskScore}/100`);
      lines.push(`    Details: ${j.description}`);
    }
  }
  lines.push('');

  // ================================================================= E. Export Controls & Dual-Use
  lines.push(MAJOR_RULE);
  lines.push('E. EXPORT-CONTROL & DUAL-USE GOODS SCREENING');
  lines.push(MAJOR_RULE);
  lines.push('');
  lines.push(field('Export Control Status', tc.exportControls.riskStatus));
  lines.push(field('Export Control Score', `${tc.exportControls.riskScore} / 100`));
  if (tc.exportControls.controlledGoods.length > 0) {
    lines.push('');
    lines.push('POTENTIALLY CONTROLLED COMMODITIES:');
    for (const cg of tc.exportControls.controlledGoods) {
      lines.push(`  * Item: "${cg.itemDescription}" | Category: ${cg.category}`);
      lines.push(`    ECCN: ${cg.eccn} | HS Code: ${cg.hsCode}`);
      lines.push(`    Reason: ${cg.controlReason}`);
      lines.push(`    Requirement: ${cg.licenseRequirement}`);
    }
  } else {
    lines.push('No dual-use, military, or export-controlled commodity triggers detected.');
  }
  lines.push('');

  // ================================================================= F. TBML Analysis
  lines.push(MAJOR_RULE);
  lines.push('F. TRADE-BASED MONEY LAUNDERING (TBML) RED FLAGS');
  lines.push(MAJOR_RULE);
  lines.push('');
  lines.push(field('TBML Risk Level', `${tc.tbml.riskLevel} (${tc.tbml.overallTbmlRiskScore} / 100)`));
  lines.push(field('Price Consistency', tc.tbml.priceConsistencyAssessment));
  lines.push(field('Routing Consistency', tc.tbml.routingConsistencyAssessment));
  if (tc.tbml.redFlags.length > 0) {
    lines.push('');
    lines.push('IDENTIFIED TBML RED FLAGS:');
    for (const rf of tc.tbml.redFlags) {
      lines.push(`  * [${rf.severity}] ${rf.title}`);
      lines.push(`    Description: ${rf.description}`);
      lines.push(`    Evidence: ${rf.evidence}`);
      if (rf.fatfReference) lines.push(`    Reference: ${rf.fatfReference}`);
    }
  } else {
    lines.push('No material TBML pricing, quantity, or circuitous routing red flags identified.');
  }
  lines.push('');

  // ================================================================= G. Document Discrepancies
  lines.push(MAJOR_RULE);
  lines.push('G. CROSS-DOCUMENT RECONCILIATION & DISCREPANCIES');
  lines.push(MAJOR_RULE);
  lines.push('');
  if (tc.discrepancies.length > 0) {
    lines.push('DOCUMENT CONFLICTS & DISCREPANCIES DETECTED:');
    for (const d of tc.discrepancies) {
      lines.push(`  * [${d.severity}] ${d.field}: ${d.documentA} vs ${d.documentB}`);
      lines.push(`    Value A: "${d.valueA}" | Value B: "${d.valueB}"`);
      lines.push(`    Explanation: ${d.explanation}`);
    }
  } else {
    lines.push('All shared fields across presented trade documentation reconcile consistently.');
  }
  lines.push('');

  // ================================================================= H. End-Use & End-User Analysis
  lines.push(MAJOR_RULE);
  lines.push('H. END-USE / END-USER CONSISTENCY ANALYSIS');
  lines.push(MAJOR_RULE);
  lines.push('');
  lines.push(field('Stated End-Use', tc.endUseAnalysis.statedEndUse));
  lines.push(field('Declared Customer Business', tc.endUseAnalysis.declaredCustomerBusiness));
  lines.push(field('Industry Consistency', tc.endUseAnalysis.isIndustryConsistent ? 'Consistent' : 'INCONSISTENT / MISMATCH'));
  lines.push(field('Assessment', tc.endUseAnalysis.explanation));
  lines.push('');

  // ================================================================= I. Document Integrity & Math
  lines.push(MAJOR_RULE);
  lines.push('I. DOCUMENT INTEGRITY & ARITHMETIC VALIDATION');
  lines.push(MAJOR_RULE);
  lines.push('');
  lines.push(field('Mathematical Validity', tc.mathematicalValidation.isMathematicallySound ? 'VERIFIED SOUND' : 'ARITHMETIC DISCREPANCY DETECTED'));
  lines.push(field('Calculated Subtotal', `${tc.mathematicalValidation.currency} ${tc.mathematicalValidation.calculatedSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`));
  lines.push(field('Calculated Grand Total', `${tc.mathematicalValidation.currency} ${tc.mathematicalValidation.calculatedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`));
  if (tc.mathematicalValidation.discrepancies.length > 0) {
    lines.push('Calculation Errors:');
    for (const md of tc.mathematicalValidation.discrepancies) {
      lines.push(`  * ${md.description} (Expected: ${md.expectedValue}, Found: ${md.actualValue})`);
    }
  }
  lines.push('');

  // ================================================================= J. Risk Scores Breakdown
  lines.push(MAJOR_RULE);
  lines.push('J. EXPLAINABLE RISK SCORE MODEL (0–100)');
  lines.push(MAJOR_RULE);
  lines.push('');
  const r = tc.riskScores;
  lines.push(field('Sanctions Risk Score', `${r.sanctions} / 100`));
  lines.push(field('Export-Control Risk Score', `${r.exportControl} / 100`));
  lines.push(field('Scope & Goods Risk Score', `${r.goods} / 100`));
  lines.push(field('End-Use Risk Score', `${r.endUse} / 100`));
  lines.push(field('End-User Risk Score', `${r.endUser} / 100`));
  lines.push(field('TBML Risk Score', `${r.tbml} / 100`));
  lines.push(field('Document Integrity Risk Score', `${r.documentIntegrity} / 100`));
  lines.push(field('Geographic Risk Score', `${r.geographic} / 100`));
  lines.push(field('Transaction Anomaly Score', `${r.transactionAnomaly} / 100`));
  lines.push(MINOR_RULE);
  lines.push(field('OVERALL WEIGHTED RISK SCORE', `${r.overall} / 100 [${getRiskLabel(r.overall)}]`));
  lines.push('');

  // ================================================================= K. Decision & Recommendation
  lines.push(MAJOR_RULE);
  lines.push('K. FINAL COMPLIANCE DECISION & REQUIRED ACTIONS');
  lines.push(MAJOR_RULE);
  lines.push('');
  lines.push(field('PRIMARY DECISION', `[ ${tc.decision.decision} ]`));
  lines.push(field('Decision Confidence', `${Math.round(tc.decision.confidence * 100)}%`));
  lines.push('');
  lines.push('Triggered Compliance Rules:');
  for (const rule of tc.decision.triggeredRules) {
    lines.push(`  * ${rule}`);
  }
  lines.push('');
  lines.push('Missing Information / Unresolved Requirements:');
  for (const mi of tc.decision.missingInformation) {
    lines.push(`  [?] ${mi}`);
  }
  lines.push('');
  lines.push('Recommended Compliance Officer Actions:');
  for (const action of tc.decision.recommendedActions) {
    lines.push(`  [>] ${action}`);
  }
  lines.push('');

  // ================================================================= Human Overrides
  if (tc.auditTrail.humanOverrides && tc.auditTrail.humanOverrides.length > 0) {
    lines.push(MAJOR_RULE);
    lines.push('HUMAN-IN-THE-LOOP AUDIT TRAIL / OVERRIDES');
    lines.push(MAJOR_RULE);
    lines.push('');
    for (const ovr of tc.auditTrail.humanOverrides) {
      lines.push(`* Action: ${ovr.action} by ${ovr.officerName} (${ovr.officerRole}) at ${ovr.timestamp}`);
      lines.push(`  Decision Changed: ${ovr.previousDecision} -> ${ovr.overriddenDecision}`);
      lines.push(`  Reason: ${ovr.reason}`);
      if (ovr.notes) lines.push(`  Notes: ${ovr.notes}`);
      lines.push('');
    }
  }

  lines.push(MAJOR_RULE);
  lines.push(centre('END OF COMPLIANCE REPORT'));
  lines.push(MAJOR_RULE);

  return lines.join('\n');
}

function getRiskLabel(score: number): string {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'ELEVATED';
  if (score >= 20) return 'MODERATE';
  return 'LOW';
}

function field(label: string, value: string): string {
  return `${label.padEnd(28)}: ${value}`;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function centre(text: string): string {
  if (text.length >= WIDTH) return text;
  const pad = Math.floor((WIDTH - text.length) / 2);
  return ' '.repeat(pad) + text;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function reportFilename(doc: { filename: string }): string {
  const base = doc.filename.replace(/\.[^.]+$/, '');
  return `${base}-trade-compliance-report.txt`;
}