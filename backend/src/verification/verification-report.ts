import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { canonical } from '../utils/hash-chain';
import type { ClaimVerification, ExternalSourceEntry, ModuleRun, SourceHealth, VerificationEvidence, VerificationRunSummary } from './verification.types';

/**
 * The evidence-based scrutiny report of a case: what was checked against official sources, what each result rests
 * on, and, as prominently, what was NOT checked. It is built from the case's own stored run, so it can be
 * reproduced, and it keeps apart the things a reader must not confuse: real source evidence, bank-supplied data,
 * a built-in seed and synthetic test data; a source that failed; a check that is incomplete; and a rule that is not
 * an approved control. It says in its first paragraph that it is not a clearance of the transaction.
 */

export interface ReportRuleMode {
  mode: 'ENFORCED' | 'DEMO_ENFORCED' | 'SHADOW';
  label: string;
  approval: string;
}

export interface VerificationReportInput {
  caseId: string;
  status: string;
  generatedAt: string;
  generatedBy: { name: string; role: string };
  ruleSetVersion: string | null;
  lastValidatedAt: string | null;
  run: VerificationRunSummary | null;
  /** When the last attempt to run the verification failed, the reason; the report then says nothing was checked. */
  runError?: string | null;
  rules: Record<string, ReportRuleMode>;
  sources: { catalogue: ExternalSourceEntry[]; health: SourceHealth[] };
  findings: Array<{ findingId: string; ruleId: string; title: string; severity: string; status: string; blocking: boolean }>;
  mandatorySources: string[];
}

type Origin = VerificationEvidence['origin'];
const ORIGIN_LABEL: Record<Origin, string> = {
  LIVE_SOURCE: 'Real source (retrieved from the publisher)',
  BANK_SUPPLIED: 'Bank-supplied dataset (approved by the bank)',
  SEED: 'Built-in seed (not the publisher file)',
  SYNTHETIC_TEST: 'SYNTHETIC TEST DATA (not real evidence)',
};

export interface ReportResultRow {
  subject: string;
  module: string;
  status: string;
  ruleId: string;
  ruleMode: string;
  declared: string;
  retrieved: string | null;
  title: string;
  explanation: string;
  documents: Array<{ filename: string; version: number | null; page: number | null; field: string; extracted: string; normalized: string | null; confidence: number | null }>;
  evidence: Array<{ source: string; record: string; origin: Origin; originLabel: string; retrievedAt: string; datasetVersion: string | null; sha256: string; stale: boolean }>;
  limitations: string[];
  aiSecondOpinion: string | null;
  assessedAt: string;
}

export interface VerificationReportModel {
  title: string;
  caseId: string;
  caseStatus: string;
  generatedAt: string;
  generatedBy: { name: string; role: string };
  ruleSetVersion: string | null;
  lastValidatedAt: string | null;
  runId: string | null;
  runFinishedAt: string | null;
  /** First thing a reader sees: what this report is not. */
  notice: string[];
  coverage: { checked: string[]; notChecked: string[] };
  evidenceMix: Record<Origin, number>;
  containsSyntheticEvidence: boolean;
  modules: Array<{ module: string; state: string; claimsChecked: number; sourcesConsulted: string[]; notChecked: string[] }>;
  results: ReportResultRow[];
  sourceFailures: Array<{ subject: string; module: string; detail: string; mandatory: boolean }>;
  incompleteChecks: string[];
  unapprovedRules: Array<{ ruleId: string; mode: string; label: string; resultsAffected: number }>;
  openFindings: VerificationReportInput['findings'];
  sources: Array<{ sourceId: string; name: string; integration: string; state: string; lastSuccessfulRetrievalAt: string | null; datasetVersion: string | null; mandatory: boolean; gaps: string[] }>;
  /** SHA-256 over everything above, so a copy of the report can be shown to be unaltered. */
  contentHash: string;
}

const MODULE_LABEL: Record<string, string> = { HS_CLASSIFICATION: 'HS classification', PORT_IDENTITY: 'Port identity', VESSEL_IDENTITY: 'Vessel (IMO number)' };

export function buildVerificationReportModel(input: VerificationReportInput): VerificationReportModel {
  const run = input.run;
  const results: ClaimVerification[] = run?.results ?? [];
  const mandatory = new Set(input.mandatorySources);

  const evidenceMix: Record<Origin, number> = { LIVE_SOURCE: 0, BANK_SUPPLIED: 0, SEED: 0, SYNTHETIC_TEST: 0 };
  for (const r of results) for (const e of r.evidence) evidenceMix[e.origin]++;

  const rows: ReportResultRow[] = results.map((r) => ({
    subject: r.subject,
    module: MODULE_LABEL[r.module] ?? r.module,
    status: r.status,
    ruleId: r.ruleId,
    ruleMode: input.rules[r.ruleId]?.label ?? 'Unknown',
    declared: r.declared,
    retrieved: r.retrieved,
    title: r.title,
    explanation: r.explanation,
    documents: r.claims.map((c) => ({ filename: c.filename, version: c.documentVersion ?? null, page: c.page, field: c.field, extracted: c.extractedValue, normalized: c.normalizedValue ?? null, confidence: c.extractionConfidence ?? null })),
    evidence: r.evidence.map((e) => ({ source: e.sourceName, record: e.recordId, origin: e.origin, originLabel: ORIGIN_LABEL[e.origin], retrievedAt: e.retrievedAt, datasetVersion: e.datasetVersion, sha256: e.contentHash, stale: e.stale })),
    limitations: r.limitations,
    aiSecondOpinion: r.secondOpinion ? `${r.secondOpinion.verdict}: ${r.secondOpinion.reason}` : null,
    assessedAt: r.assessedAt,
  }));

  const modules: ModuleRun[] = run?.modules ?? [];
  const checked = modules.filter((m) => m.state === 'COMPLETE' || m.state === 'PARTIAL').map((m) => MODULE_LABEL[m.module] ?? m.module);
  // What the platform has no integration for is listed from the catalogue, so a reader cannot take the report for more than it is.
  const notIntegrated = input.sources.catalogue.filter((s) => s.integration === 'NOT_INTEGRATED').map((s) => `${s.name} (${s.subjects.join(', ') || s.category.toLowerCase()})`);
  const notChecked = [...(run ? [] : [input.runError ? `Nothing was checked: the verification could not run (${input.runError}).` : 'No verification run is stored for this case.']), ...notIntegrated.map((n) => `Not integrated: ${n}`)];

  const sourceFailures = results
    .filter((r) => r.status === 'SOURCE_UNAVAILABLE' || r.status === 'HISTORICAL_STATUS_UNAVAILABLE')
    .map((r) => ({ subject: r.subject, module: MODULE_LABEL[r.module] ?? r.module, detail: r.explanation, mandatory: r.evidence.some((e) => mandatory.has(e.sourceId)) || r.claims.length > 0 && modules.some((m) => m.module === r.module && m.sourcesConsulted.some((s) => mandatory.has(s))) }));
  for (const m of modules) {
    if (m.state === 'SOURCE_UNAVAILABLE' && !sourceFailures.some((f) => f.module === (MODULE_LABEL[m.module] ?? m.module))) {
      sourceFailures.push({ subject: m.module, module: MODULE_LABEL[m.module] ?? m.module, detail: m.notChecked.join(' ') || 'The source could not be read.', mandatory: m.sourcesConsulted.some((s) => mandatory.has(s)) });
    }
  }
  const incompleteChecks = modules.filter((m) => m.state !== 'COMPLETE').flatMap((m) => [`${MODULE_LABEL[m.module] ?? m.module}: ${m.state.replace(/_/g, ' ').toLowerCase()}`, ...m.notChecked]);

  const unapprovedRules = Object.entries(input.rules)
    .filter(([, v]) => v.mode !== 'ENFORCED')
    .map(([ruleId, v]) => ({ ruleId, mode: v.mode, label: v.label, resultsAffected: results.filter((r) => r.ruleId === ruleId).length }))
    .filter((r) => r.resultsAffected > 0 || run === null);

  const healthById = new Map(input.sources.health.map((h) => [h.sourceId, h]));
  const sources = input.sources.catalogue.map((s) => {
    const h = healthById.get(s.sourceId);
    return { sourceId: s.sourceId, name: s.name, integration: s.integration, state: h?.state ?? (s.integration === 'NOT_INTEGRATED' ? 'NOT_INTEGRATED' : 'NOT_LOADED'), lastSuccessfulRetrievalAt: h?.lastSuccessfulRetrievalAt ?? null, datasetVersion: h?.datasetVersion ?? null, mandatory: mandatory.has(s.sourceId), gaps: s.gaps };
  });

  const containsSyntheticEvidence = evidenceMix.SYNTHETIC_TEST > 0;
  const notice = [
    'This report records what the platform compared with official sources and what it could not. It is not a clearance of the transaction and not a determination that anything is permitted or prohibited.',
    'A check that found nothing wrong is not a check that proved something right: only results marked VERIFIED rest on a matching record in an authoritative source.',
    ...(containsSyntheticEvidence ? ['THIS REPORT CONTAINS SYNTHETIC TEST DATA. Results resting on it are not real evidence.'] : []),
    ...(Object.values(input.rules).some((r) => r.mode !== 'ENFORCED') ? ['Some rules used here are not approved bank controls (see "Rules that are not approved controls"). Their results are demonstration or advisory only.'] : []),
  ];

  const body = {
    title: 'Evidence-based scrutiny report: checks against official sources',
    caseId: input.caseId,
    caseStatus: input.status,
    generatedAt: input.generatedAt,
    generatedBy: input.generatedBy,
    ruleSetVersion: input.ruleSetVersion,
    lastValidatedAt: input.lastValidatedAt,
    runId: run?.runId ?? null,
    runFinishedAt: run?.finishedAt ?? null,
    notice,
    coverage: { checked, notChecked },
    evidenceMix,
    containsSyntheticEvidence,
    modules: modules.map((m) => ({ module: MODULE_LABEL[m.module] ?? m.module, state: m.state, claimsChecked: m.claimsChecked, sourcesConsulted: m.sourcesConsulted, notChecked: m.notChecked })),
    results: rows,
    sourceFailures,
    incompleteChecks,
    unapprovedRules,
    openFindings: input.findings,
    sources,
  };
  // The generation time is part of the content, so two exports of the same stored run differ only by it and by the hash.
  const contentHash = createHash('sha256').update(canonical(body)).digest('hex');
  return { ...body, contentHash };
}

// ----------------------------------------------------------------------------------------------- PDF

const W = 595.28;
const M = 40;
const INNER = W - 2 * M;
const COLOR = { ink: '#0f172a', muted: '#64748b', line: '#e2e8f0', warn: '#92400e', warnBg: '#fffbeb', bad: '#991b1b', badBg: '#fef2f2', ok: '#065f46', head: '#1e293b' };

const STATUS_COLOR = (s: string): string =>
  s === 'VERIFIED' || s === 'CONSISTENT' ? COLOR.ok : s === 'DISCREPANCY' || s === 'POTENTIALLY_RESTRICTED' || s === 'POTENTIAL_SANCTIONS_MATCH' ? COLOR.bad : COLOR.warn;

export function renderVerificationReportPdf(model: VerificationReportModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: `${model.title} - ${model.caseId}`, Author: 'TradeGuard', Subject: 'Verification against official sources', Keywords: `content-sha256:${model.contentHash}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const room = (h: number) => {
      if (doc.y + h > 800) doc.addPage();
    };
    const h1 = (text: string) => {
      room(60);
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).fillColor(COLOR.head).text(text, M, doc.y, { width: INNER });
      doc.moveTo(M, doc.y + 2).lineTo(W - M, doc.y + 2).strokeColor(COLOR.line).stroke();
      doc.moveDown(0.5);
    };
    const para = (text: string, opts: { color?: string; bold?: boolean; size?: number; indent?: number } = {}) => {
      room(30);
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size ?? 9).fillColor(opts.color ?? COLOR.ink).text(text, M + (opts.indent ?? 0), doc.y, { width: INNER - (opts.indent ?? 0) });
    };
    const bullet = (text: string, color?: string) => para(`•  ${text}`, { indent: 8, ...(color ? { color } : {}) });
    const box = (lines: string[], fg: string, bg: string) => {
      const text = lines.join('\n');
      doc.font('Helvetica').fontSize(9);
      const h = doc.heightOfString(text, { width: INNER - 16 }) + 14;
      room(h + 6);
      const y = doc.y;
      doc.roundedRect(M, y, INNER, h, 4).fillColor(bg).fill();
      doc.fillColor(fg).text(text, M + 8, y + 7, { width: INNER - 16 });
      doc.y = y + h + 6;
    };

    doc.font('Helvetica-Bold').fontSize(16).fillColor(COLOR.ink).text(model.title, M, M, { width: INNER });
    doc.moveDown(0.3);
    para(`Case ${model.caseId} · status ${model.caseStatus.replace(/_/g, ' ').toLowerCase()} · generated ${model.generatedAt} by ${model.generatedBy.name} (${model.generatedBy.role.replace(/_/g, ' ').toLowerCase()})`, { color: COLOR.muted });
    para(`Rule set ${model.ruleSetVersion ?? 'unknown'} · last validated ${model.lastValidatedAt ?? 'never'} · verification run ${model.runId ?? 'none'}${model.runFinishedAt ? ` finished ${model.runFinishedAt}` : ''}`, { color: COLOR.muted });
    doc.moveDown(0.6);
    box(model.notice, model.containsSyntheticEvidence ? COLOR.bad : COLOR.warn, model.containsSyntheticEvidence ? COLOR.badBg : COLOR.warnBg);

    h1('What was and was not checked');
    para('Checked against a source:', { bold: true });
    if (model.coverage.checked.length === 0) bullet('Nothing.', COLOR.bad);
    for (const c of model.coverage.checked) bullet(c);
    doc.moveDown(0.3);
    para('Not checked:', { bold: true });
    for (const n of model.coverage.notChecked) bullet(n, COLOR.warn);

    h1('Evidence by origin');
    for (const [origin, count] of Object.entries(model.evidenceMix)) bullet(`${ORIGIN_LABEL[origin as Origin]}: ${count} record${count === 1 ? '' : 's'}`, origin === 'SYNTHETIC_TEST' && count > 0 ? COLOR.bad : undefined);

    if (model.sourceFailures.length) {
      h1('Source failures');
      for (const f of model.sourceFailures) bullet(`${f.module} (${f.subject})${f.mandatory ? ' — MANDATORY SOURCE: holds final progression' : ''}: ${f.detail}`, COLOR.bad);
    }
    if (model.incompleteChecks.length) {
      h1('Incomplete checks');
      for (const i of model.incompleteChecks) bullet(i, COLOR.warn);
    }
    if (model.unapprovedRules.length) {
      h1('Rules that are not approved controls');
      for (const r of model.unapprovedRules) bullet(`${r.ruleId} — ${r.label}${r.resultsAffected ? ` (${r.resultsAffected} result${r.resultsAffected === 1 ? '' : 's'} on this case)` : ''}`, COLOR.warn);
    }

    h1(`Results (${model.results.length})`);
    if (model.results.length === 0) para('No results are stored for this case.', { color: COLOR.muted });
    for (const r of model.results) {
      room(120);
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(STATUS_COLOR(r.status)).text(`${r.status.replace(/_/g, ' ')}`, M, doc.y, { continued: true }).fillColor(COLOR.ink).text(`  ${r.title}`);
      para(`${r.module} · rule ${r.ruleId} · ${r.ruleMode}`, { color: COLOR.muted, size: 8 });
      para(`Declared: ${r.declared}${r.retrieved ? `   |   Source says: ${r.retrieved}` : ''}`);
      para(r.explanation, { size: 8.5 });
      for (const d of r.documents) para(`Read from ${d.filename}${d.version ? ` v${d.version}` : ''}${d.page ? `, page ${d.page}` : ''}: ${d.field} = "${d.extracted}"${d.normalized ? ` (normalised ${d.normalized})` : ''}${d.confidence !== null ? `, extraction confidence ${Math.round(d.confidence * 100)}%` : ''}`, { size: 8, color: COLOR.muted, indent: 8 });
      for (const e of r.evidence) para(`Evidence: ${e.source}, record ${e.record} — ${e.originLabel}; retrieved ${e.retrievedAt}${e.datasetVersion ? `; version ${e.datasetVersion}` : ''}; sha256 ${e.sha256.slice(0, 16)}…${e.stale ? ' — STALE' : ''}`, { size: 8, color: e.origin === 'SYNTHETIC_TEST' ? COLOR.bad : COLOR.muted, indent: 8 });
      if (r.aiSecondOpinion) para(`AI second opinion (advisory): ${r.aiSecondOpinion}`, { size: 8, color: COLOR.muted, indent: 8 });
      for (const l of r.limitations) para(`Limit: ${l}`, { size: 8, color: COLOR.warn, indent: 8 });
    }

    if (model.openFindings.length) {
      h1('Open findings from these checks');
      for (const f of model.openFindings) bullet(`${f.findingId} [${f.severity}${f.blocking ? ', blocking' : ''}] ${f.title} (${f.ruleId}, ${f.status.toLowerCase()})`);
    }

    h1('Sources and their state');
    for (const s of model.sources) bullet(`${s.name}: ${s.integration.replace(/_/g, ' ').toLowerCase()}, ${s.state.replace(/_/g, ' ').toLowerCase()}${s.lastSuccessfulRetrievalAt ? `, last retrieved ${s.lastSuccessfulRetrievalAt}` : ''}${s.datasetVersion ? `, version ${s.datasetVersion}` : ''}${s.mandatory ? ' — mandatory' : ''}${s.gaps.length ? `. Does not cover: ${s.gaps.join('; ')}` : ''}`, s.integration === 'NOT_INTEGRATED' ? COLOR.warn : undefined);

    h1('Integrity');
    para(`Content SHA-256: ${model.contentHash}`, { size: 8 });
    para('The hash covers the report content above. A copy with a different hash was altered after export.', { size: 8, color: COLOR.muted });

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(pages.start + i);
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(COLOR.muted).text(`${model.caseId} · evidence report · page ${i + 1} of ${pages.count} · sha256 ${model.contentHash.slice(0, 16)}…`, M, 815, { width: INNER, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
