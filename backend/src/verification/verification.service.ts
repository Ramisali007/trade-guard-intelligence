import crypto from 'node:crypto';
import { extractedOrNull } from '../trade-cases/rule-helpers';
import { HS_REFERENCE_SOURCE_ID } from './source-catalogue';
import { getHsReference, type HsReferenceState } from './hs/hs-reference';
import { verifyHsClaims, type GoodsClaim, type HsJudge } from './hs/hs-verifier';
import { getPortIndex, PORT_SOURCE_ID, type PortIndexState } from './maritime/port-index';
import { verifyPortClaims, type PortClaim } from './maritime/port-verifier';
import { NOT_CONFIGURED_VESSEL_PROVIDER, verifyVesselClaims, type VesselClaim, type VesselIntelligenceProvider } from './maritime/vessel';
import { PctStore, type PctLookup } from './pct/pct-store';
import type { ClaimVerification, VerificationModule, VerificationRun } from './verification.types';

/**
 * Runs external verification over a case's documents. It reads only what the existing pipeline has
 * already extracted, sends nothing about the customer anywhere (the HS check matches locally against
 * a downloaded public reference; only a goods description and official heading wording go to the AI
 * second opinion), and returns every outcome, clean ones included, together with what it could not check.
 *
 * Each module runs on its own: one that cannot run says so and does not hide, or take down, the others.
 */

export interface VerifiableGoodsLine {
  productDescription?: unknown;
  hsCode?: unknown;
  unitOfMeasure?: unknown;
}

/** What a document states about the shipment, as the extraction read it. */
export interface VerifiableRoute {
  portOfLoading?: unknown;
  portOfDischarge?: unknown;
  vesselName?: unknown;
  vesselImo?: unknown;
  transshipmentDetails?: unknown;
}

export interface VerifiableDocument {
  documentId: string;
  filename: string;
  documentType: string;
  /** The version of the document on the case. */
  version?: number;
  /** How sure the extraction was, for the document as a whole. */
  extractionConfidence?: number | null;
  /** The document's text by page, used to say where a value was read. */
  units?: Array<{ pageNumber: number; text: string }>;
  goods: VerifiableGoodsLine[];
  route?: VerifiableRoute;
}

/** The page and the words around a value, when the document's text holds it. */
export function locateValue(units: Array<{ pageNumber: number; text: string }> | undefined, value: string): { page: number; snippet: string } | null {
  const wanted = value.replace(/[^0-9A-Za-z]/g, '').toLowerCase();
  if (!units || wanted.length < 4) return null;
  for (const unit of units) {
    // Compared with punctuation ignored, so 5201.0010 and 52010010 are the same place.
    const plain = unit.text.replace(/[^0-9A-Za-z]/g, '').toLowerCase();
    if (!plain.includes(wanted)) continue;
    const at = unit.text.toLowerCase().indexOf(value.toLowerCase());
    const start = Math.max(0, (at >= 0 ? at : 0) - 60);
    return { page: unit.pageNumber, snippet: unit.text.slice(start, start + 180).replace(/\s+/g, ' ').trim() };
  }
  return null;
}

export interface VerificationInput {
  documents: VerifiableDocument[];
  /** A typed application's goods and code; absent when the application was read from the documents. */
  application?: { description: string; hsCode: string; unit: string; portOfLoading?: string; portOfDischarge?: string } | null;
  /** The milestone the assessment is dated to; null when unknown. */
  transactionDate: string | null;
  now?: Date;
  /** The previous run on this case: unchanged claims reuse its AI second opinions instead of asking the model again. */
  previous?: { results: ClaimVerification[] } | null;
  /** Injected by tests. */
  reference?: HsReferenceState;
  judge?: HsJudge;
  /** Looks up a national tariff line as at a date; absent, the approved tariff dataset is used. */
  pct?: (pctCode: string, asOf: string) => PctLookup;
  ports?: PortIndexState;
  vessels?: VesselIntelligenceProvider;
}

const MAX_LINES_PER_DOCUMENT = 25;
const stated = (value: unknown): string | null => extractedOrNull(value);

function goodsClaims(input: VerificationInput): GoodsClaim[] {
  const claims: GoodsClaim[] = [];
  for (const doc of input.documents) {
    doc.goods.slice(0, MAX_LINES_PER_DOCUMENT).forEach((g, index) => {
      const code = stated(g.hsCode);
      const where = code ? locateValue(doc.units, code) : null;
      claims.push({
        page: where?.page ?? null,
        snippet: where?.snippet ?? null,
        documentVersion: doc.version ?? null,
        extractionConfidence: doc.extractionConfidence ?? null,
        documentId: doc.documentId,
        filename: doc.filename,
        documentType: doc.documentType,
        line: index + 1,
        description: stated(g.productDescription),
        hsCode: code,
        unit: stated(g.unitOfMeasure),
      });
    });
  }
  const app = input.application;
  if (app && (app.hsCode.trim() || app.description.trim())) {
    claims.push({ documentId: 'application', filename: 'Transaction details (typed)', documentType: 'APPLICATION', line: 1, description: app.description || null, hsCode: app.hsCode || null, unit: app.unit || null });
  }
  return claims;
}

function portClaims(input: VerificationInput): PortClaim[] {
  const claims: PortClaim[] = [];
  for (const doc of input.documents) {
    for (const field of ['portOfLoading', 'portOfDischarge'] as const) {
      const value = stated(doc.route?.[field]);
      if (!value) continue;
      const where = locateValue(doc.units, value);
      claims.push({ documentId: doc.documentId, filename: doc.filename, documentType: doc.documentType, documentVersion: doc.version ?? null, extractionConfidence: doc.extractionConfidence ?? null, page: where?.page ?? null, snippet: where?.snippet ?? null, field, value });
    }
  }
  const app = input.application;
  for (const field of ['portOfLoading', 'portOfDischarge'] as const) {
    const value = app?.[field]?.trim();
    if (value) claims.push({ documentId: 'application', filename: 'Transaction details (typed)', documentType: 'APPLICATION', field, value });
  }
  return claims;
}

function vesselClaims(input: VerificationInput): VesselClaim[] {
  const claims: VesselClaim[] = [];
  for (const doc of input.documents) {
    const name = stated(doc.route?.vesselName);
    const imo = stated(doc.route?.vesselImo);
    if (!name && !imo) continue;
    const where = imo ? locateValue(doc.units, imo) : name ? locateValue(doc.units, name) : null;
    claims.push({ documentId: doc.documentId, filename: doc.filename, documentType: doc.documentType, documentVersion: doc.version ?? null, extractionConfidence: doc.extractionConfidence ?? null, page: where?.page ?? null, snippet: where?.snippet ?? null, name, imo });
  }
  return claims;
}

/** A module that could not run at all: one visible result, never silence. */
function unavailableResult(module: VerificationModule, sourceId: string, title: string, explanation: string, declared: string, sample: { documentId: string; filename: string; documentType: string }, now: Date, transactionDate: string | null): ClaimVerification {
  return {
    subject: `source:${sourceId}`,
    module,
    status: 'SOURCE_UNAVAILABLE',
    severity: 'MEDIUM',
    blocking: false,
    humanReviewRequired: true,
    customerFixable: false,
    ruleId: 'EXT-VERIFY-SOURCE',
    title,
    explanation,
    declared,
    retrieved: null,
    claims: [{ ...sample, field: module, extractedValue: declared, page: null }],
    evidence: [],
    limitations: [],
    assessedAt: now.toISOString(),
    transactionDate,
  };
}

async function runHs(input: VerificationInput, run: VerificationRun, now: Date): Promise<void> {
  const claims = goodsClaims(input);
  const hasCodes = claims.some((c) => (c.hsCode ?? '').replace(/\D/g, '').length > 0);
  if (!hasCodes) {
    run.modules.push({ module: 'HS_CLASSIFICATION', state: 'NOT_RUN', claimsChecked: 0, sourcesConsulted: [], notChecked: ['No document states an HS code yet, so there is nothing to verify (a missing code is reported by the completeness rule).'] });
    return;
  }

  const reference = input.reference ?? (await getHsReference());
  if (!reference.available) {
    const sample = claims.find((c) => (c.hsCode ?? '').trim()) ?? claims[0]!;
    run.results.push(
      unavailableResult(
        'HS_CLASSIFICATION',
        HS_REFERENCE_SOURCE_ID,
        'HS codes could not be verified: the official reference is unavailable',
        `The official HS reference could not be loaded (${reference.error}). The HS codes on this request have NOT been verified. This is not a clean result: a trade officer should check the codes against the tariff before approval, or re-scan when the source is back.`,
        `${claims.filter((c) => c.hsCode).length} HS code(s) declared`,
        sample,
        now,
        input.transactionDate,
      ),
    );
    run.modules.push({ module: 'HS_CLASSIFICATION', state: 'SOURCE_UNAVAILABLE', claimsChecked: 0, sourcesConsulted: [], notChecked: ['Every HS code: the official reference could not be loaded.'] });
    return;
  }

  const judge: HsJudge =
    input.judge ??
    (async (arg) => {
      // Imported here so the AI service is not loaded by code that only reads the catalog.
      const { judgeHsCompatibility } = await import('../trade-cases/preshipment-ai.service');
      return judgeHsCompatibility(arg);
    });
  const reuse = new Map<string, NonNullable<ClaimVerification['secondOpinion']>>();
  const maxAgeMs = 30 * 86_400_000;
  for (const r of input.previous?.results ?? []) {
    const o = r.secondOpinion;
    if (o && now.getTime() - Date.parse(o.at) < maxAgeMs) reuse.set(o.key, o);
  }
  const { results, module } = await verifyHsClaims(claims, { reuse, reference, judge, now, transactionDate: input.transactionDate, pct: input.pct ?? ((code, asOf) => PctStore.getInstance().lookup(code, asOf)) });
  if (reference.stale) {
    module.state = module.state === 'COMPLETE' ? 'PARTIAL' : module.state;
    module.notChecked.unshift(`The HS reference was last retrieved ${reference.retrievedAt} and could not be refreshed; results are not presented as current.`);
  }
  run.results.push(...results);
  run.modules.push(module);
}

async function runPorts(input: VerificationInput, run: VerificationRun, now: Date): Promise<void> {
  const claims = portClaims(input);
  if (claims.length === 0) {
    run.modules.push({ module: 'PORT_IDENTITY', state: 'NOT_RUN', claimsChecked: 0, sourcesConsulted: [], notChecked: ['No document names a port of loading or discharge yet.'] });
    return;
  }
  const index = input.ports ?? (await getPortIndex());
  if (!index.available) {
    run.results.push(unavailableResult('PORT_IDENTITY', PORT_SOURCE_ID, 'Ports could not be identified: the UN/LOCODE list is not available', `${index.reason} The ports named on this request have NOT been identified; this is not a clean result.`, `${claims.length} port(s) named`, claims[0]!, now, input.transactionDate));
    run.modules.push({ module: 'PORT_IDENTITY', state: 'SOURCE_UNAVAILABLE', claimsChecked: 0, sourcesConsulted: [], notChecked: ['Every port: the UN/LOCODE list is not loaded in full.'] });
    return;
  }
  const { results, module } = verifyPortClaims(claims, index, { now, transactionDate: input.transactionDate });
  run.results.push(...results);
  run.modules.push(module);
}

async function runVessels(input: VerificationInput, run: VerificationRun, now: Date): Promise<void> {
  const claims = vesselClaims(input);
  if (claims.length === 0) {
    run.modules.push({ module: 'VESSEL_IDENTITY', state: 'NOT_RUN', claimsChecked: 0, sourcesConsulted: [], notChecked: ['No document names a vessel yet (shipping documents are presented after issuance).'] });
    return;
  }
  const { results, module } = await verifyVesselClaims(claims, input.vessels ?? NOT_CONFIGURED_VESSEL_PROVIDER, { now, transactionDate: input.transactionDate });
  run.results.push(...results);
  run.modules.push(module);
}

export async function runExternalVerification(input: VerificationInput): Promise<VerificationRun> {
  const startedAt = new Date();
  const now = input.now ?? startedAt;
  const run: VerificationRun = { runId: `VR-${crypto.randomBytes(5).toString('hex')}`, startedAt: startedAt.toISOString(), finishedAt: startedAt.toISOString(), modules: [], results: [] };
  for (const step of [runHs, runPorts, runVessels]) {
    try {
      await step(input, run, now);
    } catch (error) {
      // One module failing must not hide the others, and must not read as a pass.
      run.results.push(
        unavailableResult(
          step === runHs ? 'HS_CLASSIFICATION' : step === runPorts ? 'PORT_IDENTITY' : 'VESSEL_IDENTITY',
          'verification',
          'A verification step failed to run',
          `The step failed (${error instanceof Error ? error.message.slice(0, 120) : 'error'}). What it covers has NOT been verified; this is not a clean result.`,
          'verification step',
          { documentId: 'case', filename: 'case', documentType: 'CASE' },
          now,
          input.transactionDate,
        ),
      );
    }
  }
  run.finishedAt = new Date().toISOString();
  return run;
}
