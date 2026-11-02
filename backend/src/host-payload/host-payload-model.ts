import { createHash } from 'node:crypto';
import { canonical } from '../utils/hash-chain';
import type { ApprovalRecord, CaseDocument, Finding, LcApplicationData, TradeCase } from '../trade-cases/trade-case.types';

/**
 * Everything the host is told about an approved pre-shipment request, as plain data. The PDF is drawn from this and
 * from nothing else, so what the document says can be read, tested and fingerprinted without rendering it.
 */

export interface PayloadDocumentMeta {
  sha256: string | null;
  sizeBytes: number | null;
}

export interface HostPayloadContext {
  payloadId: string;
  version: number;
  generatedAt: string;
  /** The link the host opens; written on the first page. */
  url: string;
  /** Null until the payload is sent to the host. */
  tiReference: string | null;
  generatedBy: string;
  documentMeta: Map<string, PayloadDocumentMeta>;
}

export interface PayloadFinding {
  findingId: string;
  ruleId: string;
  severity: string;
  title: string;
  blocking: boolean;
  status: string;
  resolution: string;
}

export interface HostPayloadModel {
  payloadId: string;
  version: number;
  caseId: string;
  caseStatus: string;
  tiReference: string | null;
  generatedAt: string;
  generatedBy: string;
  url: string;
  transactionType: string;
  customerRef: string;
  createdAt: string;
  submittedAt: string | null;
  decision: { approvalId: string; approvedBy: string; approvedByRole: string; approvedAt: string | null; rationale: string; applicationVersion: number } | null;
  application: LcApplicationData | null;
  applicationVersion: number | null;
  applicationVersionsCount: number;
  amountInPkr: number | null;
  documents: Array<{ type: string; filename: string; version: number; uploadedAt: string; uploadedBy: string; sha256: string | null; sizeBytes: number | null; current: boolean; recognisedAs: string }>;
  documentReviews: Array<{ filename: string; summary: string; missing: number; issues: number }>;
  comparison: { summary: string; issues: number; model: string; at: string } | null;
  scrutiny: { status: string; startedAt: string | null; finishedAt: string | null; documentsRead: number; documentsTotal: number } | null;
  findings: PayloadFinding[];
  findingCounts: { total: number; open: number; blockingOpen: number; resolved: number; dispositioned: number };
  screening: { screenedAt: string; datasetVersion: string; partiesChecked: number; jurisdictionsChecked: number; matches: number; error: string | null } | null;
  externalVerification: Array<{ module: string; state: string; claimsChecked: number; notChecked: string[] }> | null;
  externalVerificationAt: string | null;
  queries: Array<{ queryId: string; to: string; subject: string; raisedAt: string; status: string; replies: number }>;
  creditFacility: { reference: string; limit: number; currency: string; margin: number; source: string; verifiedBy: string; verifiedAt: string } | null;
  timeline: Array<{ at: string; to: string; actor: string; reason: string }>;
  audit: { headSeq: number | null; headHash: string | null };
  /** SHA-256 over the data above (the link and the fingerprint itself left out), so a copy can be shown to be unaltered. */
  contentHash: string;
}

const humanise = (value: string): string =>
  value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())
    .replace(/\blc\b/gi, 'LC')
    .replace(/\bhs\b/gi, 'HS')
    .replace(/\btbml\b/gi, 'TBML');
const actorName = (a: { name: string } | 'SYSTEM'): string => (a === 'SYSTEM' ? 'System' : a.name);

function resolutionOf(f: Finding): string {
  if (f.disposition) return `${humanise(f.disposition.code)} by ${f.disposition.by.name}: ${f.disposition.rationale}`;
  if (f.status === 'RESOLVED') {
    const last = [...f.history].reverse().find((h) => h.event === 'RESOLVED_BY_REVALIDATION');
    return last ? last.detail || 'Resolved: no longer applies' : 'Resolved: no longer applies';
  }
  return f.recommendedAction || '';
}

function latestApproval(c: TradeCase): ApprovalRecord | null {
  return [...c.approvals].reverse().find((a) => a.status === 'APPROVED') ?? null;
}

export function buildHostPayloadModel(c: TradeCase, ctx: HostPayloadContext): HostPayloadModel {
  const approval = latestApproval(c);
  const version = approval ? c.applicationVersions.find((v) => v.version === approval.applicationVersion) ?? null : null;
  const current = (d: CaseDocument) => !d.supersededByLinkId;
  const preTrade = c.documents.filter((d) => d.stage === 'PRE_TRADE');
  const findings = c.findings.filter((f) => f.stage === 'PRE_TRADE');
  const open = findings.filter((f) => f.status === 'OPEN');
  const run = c.scrutinyRun ?? null;
  const verification = c.validation.externalVerification ?? null;
  const screening = c.validation.screening ?? null;

  const body = {
    payloadId: ctx.payloadId,
    version: ctx.version,
    caseId: c.caseId,
    caseStatus: c.status,
    tiReference: ctx.tiReference,
    generatedAt: ctx.generatedAt,
    generatedBy: ctx.generatedBy,
    transactionType: c.transactionType,
    customerRef: c.customerRef,
    createdAt: c.createdAt,
    submittedAt: c.submittedAt,
    decision: approval
      ? {
          approvalId: approval.approvalId,
          approvedBy: approval.decidedBy?.name ?? '',
          approvedByRole: approval.decidedBy ? humanise(approval.decidedBy.role) : '',
          approvedAt: approval.decidedAt,
          rationale: approval.rationale ?? '',
          applicationVersion: approval.applicationVersion,
        }
      : null,
    application: version?.data ?? null,
    applicationVersion: version?.version ?? null,
    applicationVersionsCount: c.applicationVersions.length,
    amountInPkr: c.validation.amountInPkr,
    documents: preTrade.map((d) => {
      const meta = ctx.documentMeta.get(d.documentId);
      return {
        type: humanise(d.documentType),
        filename: d.filename,
        version: d.version,
        uploadedAt: d.uploadedAt,
        uploadedBy: d.uploadedBy.name,
        sha256: meta?.sha256 ?? null,
        sizeBytes: meta?.sizeBytes ?? null,
        current: current(d),
        recognisedAs: d.detection ? `${humanise(d.detection.type)} (${Math.round(d.detection.confidence * 100)}%)` : d.typeSource === 'CUSTOMER' ? 'Chosen by the customer' : 'Not recognized',
      };
    }),
    documentReviews: Object.values(c.aiReviews ?? {}).map((r) => ({ filename: r.filename, summary: r.summary, missing: r.missing.length, issues: r.issues.length })),
    comparison: c.caseReview ? { summary: c.caseReview.summary, issues: c.caseReview.issues.length, model: c.caseReview.model, at: c.caseReview.at } : null,
    scrutiny: run
      ? { status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, documentsRead: run.steps.filter((s) => s.status === 'DONE').length, documentsTotal: run.steps.length }
      : null,
    findings: findings.map((f) => ({ findingId: f.findingId, ruleId: f.ruleId, severity: f.severity, title: f.title, blocking: f.blocking, status: f.status, resolution: resolutionOf(f) })),
    findingCounts: {
      total: findings.length,
      open: open.length,
      blockingOpen: open.filter((f) => f.blocking).length,
      resolved: findings.filter((f) => f.status === 'RESOLVED').length,
      dispositioned: findings.filter((f) => f.status === 'DISPOSITIONED').length,
    },
    screening: screening
      ? { screenedAt: screening.screenedAt, datasetVersion: screening.datasetVersion, partiesChecked: screening.parties.length, jurisdictionsChecked: screening.jurisdictions.length, matches: screening.matchCount, error: screening.error }
      : null,
    externalVerification: verification ? verification.modules.map((m) => ({ module: humanise(m.module), state: humanise(m.state), claimsChecked: m.claimsChecked, notChecked: m.notChecked })) : null,
    externalVerificationAt: verification?.finishedAt ?? null,
    queries: c.queries.map((q) => ({ queryId: q.queryId, to: q.assignee === 'CUSTOMER' ? 'Customer' : humanise(q.assignee), subject: q.subject ?? q.question.slice(0, 90), raisedAt: q.raisedAt, status: humanise(q.status), replies: q.responses.length })),
    creditFacility: c.creditFacility
      ? {
          reference: c.creditFacility.facilityReference,
          limit: c.creditFacility.availableLimit,
          currency: c.creditFacility.currency,
          margin: c.creditFacility.marginPercent,
          source: c.creditFacility.verificationSource === 'MANUAL_OFFICER_VERIFIED' ? 'Verified by an officer' : 'Sandbox data (not a real limit)',
          verifiedBy: c.creditFacility.verifiedBy.name,
          verifiedAt: c.creditFacility.verifiedAt,
        }
      : null,
    timeline: c.statusHistory.map((s) => ({ at: s.at, to: humanise(s.to), actor: actorName(s.actor), reason: s.reason })),
    audit: { headSeq: c.auditHead?.seq ?? null, headHash: c.auditHead?.hash ?? null },
  };
  // The fingerprint covers the facts; the link and the fingerprint itself are not part of them.
  const contentHash = createHash('sha256').update(canonical(body)).digest('hex');
  return { ...body, url: ctx.url, contentHash };
}

/** What the page the host opens shows: the case's references, the client and credit, and the client's pre-shipment documents. */
export interface HostPortalData {
  caseId: string;
  customerRef: string;
  tiReference: string | null;
  status: string;
  approvedAt: string | null;
  approvedBy: string | null;
  applicant: string;
  beneficiary: string;
  currency: string;
  amount: number | null;
  goods: string;
  hsCode: string;
  documents: Array<{
    linkId: string;
    type: string;
    filename: string;
    version: number;
    uploadedAt: string;
    uploadedBy: string;
    current: boolean;
    sizeBytes: number | null;
    sha256: string | null;
    mimeType: string;
  }>;
}
