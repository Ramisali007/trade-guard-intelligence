import crypto from 'node:crypto';
import type { AuditTrailRecord, ComplianceDecision, HumanOverrideRecord, RiskScores } from './types';

export class AuditService {
  createInitialAuditRecord(params: {
    documentId: string;
    rawBuffer: Buffer;
    aiModel: string;
    sanctionsDatasetVersion: string;
    extractedFieldsCount: number;
    rulesTriggered: string[];
    riskScores: RiskScores;
    initialDecision: ComplianceDecision;
  }): AuditTrailRecord {
    const documentHash = crypto.createHash('sha256').update(params.rawBuffer).digest('hex');
    const now = new Date().toISOString();

    return {
      uploadTimestamp: now,
      documentHash,
      documentId: params.documentId,
      analyzerVersion: 'TradeCompliance-v3.0.0',
      aiModel: params.aiModel,
      promptVersion: 'TRADE-FIN-COMPLIANCE-PROMPT-2026.08',
      sanctionsDatasetVersion: params.sanctionsDatasetVersion,
      screeningTimestamp: now,
      extractedFieldsCount: params.extractedFieldsCount,
      rulesTriggered: params.rulesTriggered,
      riskScores: params.riskScores,
      initialDecision: params.initialDecision,
      humanOverrides: [],
    };
  }

  applyHumanOverride(
    audit: AuditTrailRecord,
    currentDecision: ComplianceDecision,
    override: {
      action: HumanOverrideRecord['action'];
      officerName: string;
      officerRole?: string;
      newDecision: ComplianceDecision;
      reason: string;
      notes?: string;
    },
  ): { updatedAudit: AuditTrailRecord; newDecision: ComplianceDecision } {
    const record: HumanOverrideRecord = {
      id: `OVR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      action: override.action,
      officerName: override.officerName || 'Compliance Officer',
      officerRole: override.officerRole || 'Senior Trade Compliance Officer',
      timestamp: new Date().toISOString(),
      previousDecision: currentDecision,
      overriddenDecision: override.newDecision,
      reason: override.reason,
      notes: override.notes || '',
    };

    const updatedAudit: AuditTrailRecord = {
      ...audit,
      humanOverrides: [...(audit.humanOverrides || []), record],
    };

    return { updatedAudit, newDecision: override.newDecision };
  }
}
