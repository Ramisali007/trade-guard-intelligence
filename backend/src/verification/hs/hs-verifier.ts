import crypto from 'node:crypto';
import { HS_REFERENCE_SOURCE_ID, HS_REFERENCE_URL } from '../source-catalogue';
import { PCT_SOURCE_ID, type PctLookup } from '../pct/pct-store';

const HS_LINEAGE = 'Nomenclature owned by the World Customs Organization; file distributed by the UN Statistics Division (UN Comtrade).';
import type { ClaimRef, ClaimVerification, ModuleRun, VerificationEvidence } from '../verification.types';
import { lookupHs, searchHeadings, type HsEntry, type HsReference } from './hs-reference';
import { isGenericDescription, sharedWords } from './text-match';

/**
 * Whether the HS code a document declares fits the goods it describes, against the official wording.
 *
 * What is decided deterministically: that the code is well formed, that the heading and subheading
 * exist, and whether the description shares its subject with the official wording. Only when the
 * description shares nothing with it is a second opinion asked for (a model reading the official
 * wording, never the code number), and its answer decides nothing alone: "incompatible" is a
 * classification discrepancy for a person to examine, "compatible" is recorded as consistent with
 * that limit stated, and anything else is routed to review. A mismatch is never described as fraud.
 */

export interface GoodsClaim {
  documentId: string;
  filename: string;
  documentType: string;
  /** 1-based line within the document. */
  line: number;
  description: string | null;
  hsCode: string | null;
  unit: string | null;
  /** Where the code was read: the page and the words around it, and which version of the document and how sure the extraction was. */
  page?: number | null;
  snippet?: string | null;
  documentVersion?: number | null;
  extractionConfidence?: number | null;
}

export interface HsJudgement {
  verdict: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNCLEAR';
  reason: string;
}
export type HsJudge = (input: { description: string; official: Array<{ code: string; text: string }> }) => Promise<HsJudgement>;

export interface HsVerifyContext {
  reference: HsReference;
  judge: HsJudge;
  now: Date;
  /** The transaction milestone the assessment is dated to. */
  transactionDate: string | null;
  /** Looks a Pakistan Customs Tariff line up as it stood on a date. Absent: no tariff dataset is available. */
  pct?: (pctCode: string, asOf: string) => PctLookup;
  /** Second opinions from the previous run, by the question they answered. Reused when the claim, the official wording and the reference are unchanged. */
  reuse?: Map<string, { verdict: HsJudgement['verdict']; reason: string; referenceHash: string; at: string }>;
}

const DIGITS_OK = new Set([4, 6, 8, 10]);

const UNIT_ALIASES: Record<string, string[]> = {
  kg: ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos'],
  g: ['g', 'gram', 'grams'],
  l: ['l', 'lt', 'ltr', 'litre', 'litres', 'liter', 'liters'],
  m: ['m', 'mtr', 'metre', 'metres', 'meter', 'meters'],
  m2: ['m2', 'sqm', 'sq m', 'square metre', 'square metres'],
  m3: ['m3', 'cbm', 'cubic metre', 'cubic metres'],
  u: ['u', 'pcs', 'pc', 'piece', 'pieces', 'unit', 'units', 'each', 'nos', 'no'],
};

function unitMatches(standard: string, declared: string | null): boolean | null {
  if (!declared) return null;
  const want = standard.toLowerCase().trim();
  const have = declared.toLowerCase().replace(/\./g, '').trim();
  const group = UNIT_ALIASES[want];
  if (!group) return null; // a unit this table does not know is not judged
  if (group.includes(have)) return true;
  // The declared unit may belong to another known group (for example PCS against a kg product).
  const other = Object.entries(UNIT_ALIASES).find(([key, aliases]) => key !== want && aliases.includes(have));
  return other ? false : null;
}

function evidenceFor(ref: HsReference, entries: Array<HsEntry | null>): VerificationEvidence[] {
  return entries
    .filter((e): e is HsEntry => e !== null)
    .map((e) => ({
      sourceId: HS_REFERENCE_SOURCE_ID,
      sourceName: 'Harmonized System (WCO) in the UN Comtrade reference data (Combined HS)',
      recordId: e.code,
      excerpt: `${e.code} - ${e.text}${e.unit ? ` (standard unit: ${e.unit})` : ''}`,
      url: HS_REFERENCE_URL,
      retrievedAt: ref.retrievedAt,
      publishedOn: ref.publishedOn,
      effectiveFrom: null,
      contentHash: ref.contentHash,
      datasetVersion: ref.datasetVersion,
      lineage: HS_LINEAGE,
      origin: ref.origin === 'TEST_FIXTURE' ? 'SYNTHETIC_TEST' : 'LIVE_SOURCE',
      stale: ref.stale,
    }));
}

const claimRef = (c: GoodsClaim): ClaimRef => ({
  documentId: c.documentId,
  filename: c.filename,
  documentType: c.documentType,
  field: `hsCode (goods line ${c.line})`,
  extractedValue: `${c.hsCode ?? ''} - ${c.description ?? ''}`.trim(),
  page: c.page ?? null,
  documentVersion: c.documentVersion ?? null,
  normalizedValue: (c.hsCode ?? '').replace(/\D/g, '') || null,
  extractionConfidence: c.extractionConfidence ?? null,
  snippet: c.snippet ?? null,
});

const BASE_LIMITS = [
  'Checked against wording only: the heading and subheading text. WCO Explanatory Notes and Legal Notes, which decide difficult cases, are not available to the platform.',
  'The reference is a combined list across HS editions, so the edition in force on the transaction date is not distinguished.',
];
const NATIONAL_LIMIT =
  'Digits beyond the sixth are national tariff extensions (the Pakistan Customs Tariff has eight digits). No official national tariff source is integrated, so only the first six digits were checked.';

interface Pending {
  claim: GoodsClaim;
  digits: string;
}

type ResultFields = Pick<ClaimVerification, 'status' | 'severity' | 'blocking' | 'humanReviewRequired' | 'customerFixable' | 'ruleId' | 'title' | 'explanation' | 'declared' | 'retrieved' | 'evidence' | 'limitations'>;
type MakeResult = (claim: GoodsClaim, over: ResultFields) => ClaimVerification;

interface NationalCheck {
  /** An approved dataset was consulted for this line. */
  consulted: boolean;
  evidence: VerificationEvidence[];
  /** Replaces the "no national source" limit when the dataset was used. */
  limitation: string | null;
  /** The tariff line's own wording, added to what the description is compared with. */
  wording: string;
  official: Array<{ code: string; text: string }>;
}

/** A tariff dataset older than this is used, but its evidence says it may predate later notifications. */
const PCT_MAX_AGE_DAYS = 120;

function pctEvidence(l: Extract<PctLookup, { outcome: 'FOUND' }>, now: Date): VerificationEvidence {
  const d = l.dataset;
  const line = l.line;
  const age = (now.getTime() - Date.parse(d.publicationDate ?? d.ingestedAt)) / 86_400_000;
  return {
    sourceId: PCT_SOURCE_ID,
    sourceName: `Pakistan Customs Tariff (${d.origin === 'SYNTHETIC_TEST' ? 'SYNTHETIC TEST DATASET' : 'dataset supplied by the bank'}: ${d.version})`,
    recordId: line.pctCode,
    excerpt: `${line.pctCode} - ${line.description}${line.unit ? ` (unit: ${line.unit})` : ''}${line.customsDutyPct !== null ? `; customs duty ${line.customsDutyPct}%` : ''}${line.regulatoryDutyPct !== null ? `; regulatory duty ${line.regulatoryDutyPct}%` : ''}`,
    url: `bank-supplied://${d.datasetId}`,
    retrievedAt: d.ingestedAt,
    publishedOn: d.publicationDate,
    effectiveFrom: line.effectiveFrom,
    contentHash: d.contentHash,
    datasetVersion: d.version,
    lineage: `Published by ${d.publisher} (${d.sourceReference}); supplied by the bank and approved by ${d.decidedBy?.name ?? 'the policy owner'}.`,
    origin: d.origin === 'SYNTHETIC_TEST' ? 'SYNTHETIC_TEST' : 'BANK_SUPPLIED',
    stale: age > PCT_MAX_AGE_DAYS,
  };
}

/**
 * The Pakistan Customs Tariff line a claim names, as it stood on the transaction date. The international six digits
 * matching is not proof the eight-digit line, its duty or the import's eligibility is right, so each outcome here
 * is a separate result, and what the dataset cannot show is stated with it.
 */
function nationalCheck(claim: GoodsClaim, code8: string, ctx: HsVerifyContext, results: ClaimVerification[], make: MakeResult, declared: string): NationalCheck {
  const none: NationalCheck = { consulted: false, evidence: [], limitation: null, wording: '', official: [] };
  if (!ctx.pct) return none;
  const asOf = ctx.transactionDate ?? ctx.now.toISOString();
  const found = ctx.pct(code8, asOf);
  if (!found.available) return { ...none, limitation: `${NATIONAL_LIMIT} (${found.reason})` };
  const d = found.dataset;
  const scope = `dataset "${d.version}" (${d.origin === 'SYNTHETIC_TEST' ? 'SYNTHETIC TEST DATA' : `supplied by the bank, published ${d.publicationDate ?? 'date not stated'}`}), assessed as at ${asOf.slice(0, 10)}`;

  if (found.outcome !== 'FOUND') {
    const extract = d.scope === 'EXTRACT';
    const notInForce = found.outcome === 'NOT_IN_FORCE';
    results.push(
      make(claim, {
        status: extract ? 'HUMAN_REVIEW_REQUIRED' : 'DISCREPANCY',
        severity: extract ? 'MEDIUM' : notInForce ? 'MEDIUM' : 'HIGH',
        blocking: !extract,
        humanReviewRequired: true,
        customerFixable: !extract,
        ruleId: 'EXT-PCT-VALID',
        title: notInForce ? `Tariff line ${code8} was not in force on the transaction date` : `Tariff line ${code8} is not in the approved Pakistan Customs Tariff dataset`,
        explanation: notInForce
          ? `The approved dataset has a line ${code8}, but none in force on ${asOf.slice(0, 10)} (${scope}). The line may have been introduced or withdrawn since; a trade officer should confirm against the tariff and notifications of that date.`
          : extract
            ? `The line ${code8} is not in the ${scope}, which the bank supplied as an EXTRACT of the tariff, so its absence does not show the line does not exist. A trade officer should check it against the full tariff.`
            : `The line ${code8} is not in the ${scope}, which the bank supplied as the full tariff. The code may be mistyped, may belong to a different edition, or the dataset may be incomplete; a trade officer should confirm. This is not a finding of wrongdoing.`,
        declared,
        retrieved: null,
        evidence: [],
        limitations: [`Checked against ${scope}. The tariff changes by notification, so a result is only as current as that dataset.`],
      }),
    );
    return { consulted: true, evidence: [], limitation: null, wording: '', official: [] };
  }

  const line = found.line;
  const evidence = pctEvidence(found, ctx.now);
  const headingKnown = ctx.reference.entries.has(line.hs6);
  const limitation = `Tariff line checked against ${scope}. Duty rates and conditions are as that dataset records them; the tariff changes by notification and a matching code is not proof that the duty or the import's eligibility is right.${evidence.stale ? ` The dataset is older than ${PCT_MAX_AGE_DAYS} days and may predate later notifications.` : ''}${headingKnown ? '' : ` The line's six-digit heading ${line.hs6} is not in the international reference.`}${line.notes ? ` Tariff note: ${line.notes}` : ''}`;
  if (line.restrictions) {
    results.push(
      make(claim, {
        status: 'POTENTIALLY_RESTRICTED',
        severity: 'MEDIUM',
        blocking: false,
        humanReviewRequired: true,
        customerFixable: false,
        ruleId: 'EXT-PCT-RESTRICTION',
        title: `Tariff line ${code8} carries a recorded condition`,
        explanation: `The approved tariff dataset records this condition for the line: "${line.restrictions}". Whether it applies to this import, and whether the required permit exists, is for a trade officer to determine. The note is the dataset's wording, not a legal determination, and the documents were not searched for the permit.`,
        declared,
        retrieved: `${line.pctCode} - ${line.description}`,
        evidence: [evidence],
        limitations: [limitation],
      }),
    );
  }
  return { consulted: true, evidence: [evidence], limitation, wording: line.description, official: [{ code: line.pctCode, text: line.description }] };
}

/** Runs the HS checks over every goods claim and returns each outcome, clean ones included. */
export async function verifyHsClaims(claims: GoodsClaim[], ctx: HsVerifyContext): Promise<{ results: ClaimVerification[]; module: ModuleRun }> {
  const assessedAt = ctx.now.toISOString();
  const results: ClaimVerification[] = [];
  const notChecked: string[] = [];
  const judged = new Map<string, Promise<{ judgement: HsJudgement; failed: boolean; at: string }>>();
  let pctConsulted = false;
  let opinionsAsked = 0;
  let opinionsReused = 0;
  let pctMissing = 0;
  let national8 = 0;
  const withCode: Pending[] = [];
  let withoutCode = 0;

  const base = (claim: GoodsClaim, over: Pick<ClaimVerification, 'status' | 'severity' | 'blocking' | 'humanReviewRequired' | 'customerFixable' | 'ruleId' | 'title' | 'explanation' | 'declared' | 'retrieved' | 'evidence' | 'limitations'>): ClaimVerification => ({
    subject: `${claim.documentType}:${claim.line}`,
    module: 'HS_CLASSIFICATION',
    claims: [claimRef(claim)],
    assessedAt,
    transactionDate: ctx.transactionDate,
    ...over,
  });

  for (const claim of claims) {
    const digits = (claim.hsCode ?? '').replace(/\D/g, '');
    if (!digits) {
      // A missing code is reported by the completeness rule; there is nothing here to verify.
      withoutCode += 1;
      continue;
    }
    const declared = `HS ${claim.hsCode} - "${claim.description ?? 'no description'}"`;

    if (!DIGITS_OK.has(digits.length)) {
      results.push(
        base(claim, {
          status: 'DISCREPANCY',
          severity: 'MEDIUM',
          blocking: true,
          humanReviewRequired: false,
          customerFixable: true,
          ruleId: 'EXT-HS-VALID',
          title: `HS code ${claim.hsCode} is not in a valid format`,
          explanation: `An HS code has 4, 6, 8 or 10 digits; "${claim.hsCode}" has ${digits.length}. The customer should confirm the code from the supplier's tariff classification.`,
          declared,
          retrieved: null,
          evidence: [],
          limitations: [],
        }),
      );
      continue;
    }

    const found = lookupHs(ctx.reference, digits);
    if (!found.heading) {
      results.push(
        base(claim, {
          status: 'DISCREPANCY',
          severity: 'HIGH',
          blocking: true,
          humanReviewRequired: true,
          customerFixable: true,
          ruleId: 'EXT-HS-VALID',
          title: `HS code ${claim.hsCode} does not exist in the Harmonized System`,
          explanation: `Heading ${digits.slice(0, 4)} is not in the official HS reference${found.chapter ? ` (chapter ${found.chapter.code}: ${found.chapter.text})` : ' and chapter ' + digits.slice(0, 2) + ' is not either'}. The code is mistyped, invented or from a different scheme. A suspected misdeclaration is for a person to establish, not a conclusion of this check.`,
          declared,
          retrieved: null,
          evidence: evidenceFor(ctx.reference, [found.chapter]),
          limitations: BASE_LIMITS,
        }),
      );
      continue;
    }
    if (digits.length >= 6 && !found.subheading) {
      results.push(
        base(claim, {
          status: 'DISCREPANCY',
          severity: 'MEDIUM',
          blocking: false,
          humanReviewRequired: true,
          customerFixable: false,
          ruleId: 'EXT-HS-VALID',
          title: `HS subheading ${digits.slice(0, 6)} is not in the official reference`,
          explanation: `Heading ${found.heading.code} exists ("${found.heading.text}") but ${digits.slice(0, 6)} is not one of its 6-digit subheadings in the reference. It may be a typing error, or from an HS edition the reference does not list.`,
          declared,
          retrieved: `${found.heading.code} - ${found.heading.text}`,
          evidence: evidenceFor(ctx.reference, [found.chapter, found.heading]),
          limitations: BASE_LIMITS,
        }),
      );
      continue;
    }
    withCode.push({ claim, digits });
  }

  for (const { claim, digits } of withCode) {
    const found = lookupHs(ctx.reference, digits);
    const official = found.subheading ?? found.heading!;
    const declared = `HS ${claim.hsCode} - "${claim.description ?? 'no description'}"`;
    const retrieved = `${official.code} - ${official.text}`;
    // The national tariff line, where the claim goes to eight digits and the bank has supplied an approved dataset.
    const national = digits.length >= 8 ? nationalCheck(claim, digits.slice(0, 8), ctx, results, base, declared) : null;
    if (national?.consulted) pctConsulted = true;
    if (digits.length >= 8) national8 += 1;
    if (digits.length >= 8 && !national?.consulted) pctMissing += 1;
    const evidence = [...evidenceFor(ctx.reference, [found.chapter, found.heading, found.subheading]), ...(national?.evidence ?? [])];
    const limitations = [...BASE_LIMITS, ...(digits.length > 6 ? [national?.limitation ?? NATIONAL_LIMIT] : [])];
    const unitNote = official.unit && claim.unit && unitMatches(official.unit, claim.unit) === false ? [`The HS standard unit for this heading is "${official.unit}"; the document quantifies in "${claim.unit}".`] : [];

    if (isGenericDescription(claim.description)) {
      results.push(
        base(claim, {
          status: 'INSUFFICIENT_EVIDENCE',
          severity: 'MEDIUM',
          blocking: false,
          humanReviewRequired: true,
          customerFixable: true,
          ruleId: 'EXT-HS-CLASS',
          title: `Goods description too general to check HS ${claim.hsCode}`,
          explanation: `The description ("${claim.description ?? 'none'}") does not say what the goods are, so the code cannot be compared with the official wording (${retrieved}). Ask for the product name, material and use.`,
          declared,
          retrieved,
          evidence,
          limitations: [...limitations, ...unitNote],
        }),
      );
      continue;
    }

    const wording = [found.chapter?.text ?? '', found.heading?.text ?? '', found.subheading?.text ?? '', national?.wording ?? ''].join(' ; ');
    const shared = sharedWords(claim.description!, wording);
    if (shared.length > 0) {
      results.push(
        base(claim, {
          status: 'CONSISTENT',
          severity: 'INFO',
          blocking: false,
          humanReviewRequired: false,
          customerFixable: false,
          ruleId: 'EXT-HS-CLASS',
          title: `HS ${claim.hsCode} is consistent with the goods described`,
          explanation: `The description and the official wording share "${shared.join('", "')}". This shows the code is in the right area of the nomenclature. It does not confirm that this subheading is the correct classification of the product.`,
          declared,
          retrieved,
          evidence,
          limitations: [...limitations, ...unitNote],
        }),
      );
      continue;
    }

    // Nothing in common with the official wording: look for where the goods would belong, and ask for a second opinion.
    const leads = searchHeadings(ctx.reference, claim.description!, 3);
    const leadText = leads.length ? ` Headings whose wording matches the description: ${leads.map((l) => `${l.code} (${l.text})`).join('; ')}.` : '';
    const officialWording = [...[found.chapter, found.heading, found.subheading].filter((e): e is HsEntry => e !== null).map((e) => ({ code: e.code, text: e.text })), ...(national?.official ?? [])];
    // The opinion is keyed by the description and the exact official wording it was given, so it is reused only for the same question.
    const judgeKey = `${claim.description!.toLowerCase().replace(/\s+/g, ' ')}|${crypto.createHash('sha256').update(JSON.stringify(officialWording)).digest('hex').slice(0, 16)}`;
    let pending = judged.get(judgeKey);
    if (!pending) {
      const earlier = ctx.reuse?.get(judgeKey);
      if (earlier && earlier.referenceHash === ctx.reference.contentHash) {
        opinionsReused += 1;
        pending = Promise.resolve({ judgement: { verdict: earlier.verdict, reason: earlier.reason }, failed: false, at: earlier.at });
      } else {
        opinionsAsked += 1;
        pending = ctx
          .judge({ description: claim.description!, official: officialWording })
          .then((judgement) => ({ judgement, failed: false, at: ctx.now.toISOString() }))
          .catch((error: unknown) => ({ judgement: { verdict: 'UNCLEAR', reason: `The AI check could not run (${error instanceof Error ? error.message.slice(0, 120) : 'unavailable'}).` } as HsJudgement, failed: true, at: ctx.now.toISOString() }));
      }
      judged.set(judgeKey, pending);
    }
    const outcome = await pending;
    const second = outcome.judgement;
    const resultsBefore = results.length;

    if (second.verdict === 'INCOMPATIBLE') {
      results.push(
        base(claim, {
          status: 'DISCREPANCY',
          severity: 'HIGH',
          blocking: true,
          humanReviewRequired: true,
          customerFixable: true,
          ruleId: 'EXT-HS-CLASS',
          title: `HS ${claim.hsCode} does not match the goods described`,
          explanation: `The goods are described as "${claim.description}", but the official wording for ${official.code} is "${official.text}". They share no subject. ${second.reason}${leadText} This is a classification discrepancy or possible misdeclaration for a trade officer to examine, not a finding of wrongdoing.`,
          declared,
          retrieved,
          evidence: [...evidence, ...evidenceFor(ctx.reference, leads.map((l) => ctx.reference.entries.get(l.code) ?? null))],
          limitations: [...limitations, 'The mismatch was identified by comparing wording, with an AI reading of the official text as a second opinion; the AI opinion is not proof.', ...unitNote],
        }),
      );
    } else if (second.verdict === 'COMPATIBLE') {
      results.push(
        base(claim, {
          status: 'CONSISTENT',
          severity: 'INFO',
          blocking: false,
          humanReviewRequired: false,
          customerFixable: false,
          ruleId: 'EXT-HS-CLASS',
          title: `HS ${claim.hsCode} may fit the goods described`,
          explanation: `The description shares no word with the official wording (${retrieved}), but an AI reading of that wording judged them compatible: ${second.reason}`,
          declared,
          retrieved,
          evidence,
          limitations: [...limitations, 'Compatibility rests on an AI reading of the official wording, which is not proof.', ...unitNote],
        }),
      );
    } else {
      results.push(
        base(claim, {
          status: 'HUMAN_REVIEW_REQUIRED',
          severity: 'MEDIUM',
          blocking: false,
          humanReviewRequired: true,
          customerFixable: false,
          ruleId: 'EXT-HS-CLASS',
          title: `HS ${claim.hsCode} could not be matched to the goods described`,
          explanation: `The goods are described as "${claim.description}"; the official wording for ${official.code} is "${official.text}". They share no wording and the second check could not decide: ${second.reason}${leadText}`,
          declared,
          retrieved,
          evidence,
          limitations: [...limitations, ...unitNote],
        }),
      );
    }
    // An opinion that was given (not an outage) is kept on the result, so an unchanged claim is not asked about again.
    const produced = results[results.length - 1];
    if (!outcome.failed && results.length > resultsBefore && produced) produced.secondOpinion = { key: judgeKey, verdict: second.verdict, reason: second.reason, referenceHash: ctx.reference.contentHash, at: outcome.at };
  }

  // The same code declared differently across documents of one request.
  results.push(...crossDocument(claims, ctx, assessedAt));

  if (withoutCode > 0) notChecked.push(`${withoutCode} goods line${withoutCode === 1 ? '' : 's'} state no HS code (reported by the completeness rule, nothing to verify).`);
  if (pctConsulted) notChecked.push('Duties, permits and import eligibility: only what the approved tariff dataset records is shown, and a matching code is not proof that a duty rate or an import is right. Confirm against the current tariff and notifications.');
  if (national8 === 0) notChecked.push('National tariff lines: no document states an 8-digit tariff code, so the Pakistan Customs Tariff was not consulted and only the international six digits were checked.');
  else if (pctMissing > 0) notChecked.push('National tariff lines (digits beyond the sixth), duties and import restrictions: no approved Pakistan Customs Tariff dataset covers this assessment, so only the international six digits were checked.');
  return {
    results,
    module: {
      module: 'HS_CLASSIFICATION',
      state: claims.length === 0 ? 'NOT_RUN' : 'COMPLETE',
      claimsChecked: withCode.length + results.filter((r) => r.ruleId === 'EXT-HS-VALID').length,
      sourcesConsulted: pctConsulted ? [HS_REFERENCE_SOURCE_ID, PCT_SOURCE_ID] : [HS_REFERENCE_SOURCE_ID],
      aiSecondOpinions: { asked: opinionsAsked, reused: opinionsReused },
      notChecked,
    },
  };
}

/** One distinct code per document, compared where both documents give a single code. */
function crossDocument(claims: GoodsClaim[], ctx: HsVerifyContext, assessedAt: string): ClaimVerification[] {
  const byDocument = new Map<string, { claim: GoodsClaim; codes: Set<string> }>();
  for (const c of claims) {
    const digits = (c.hsCode ?? '').replace(/\D/g, '');
    if (digits.length < 4) continue;
    const entry = byDocument.get(c.documentId) ?? { claim: c, codes: new Set<string>() };
    entry.codes.add(digits);
    byDocument.set(c.documentId, entry);
  }
  const single = [...byDocument.values()].filter((d) => d.codes.size === 1);
  const out: ClaimVerification[] = [];
  for (let i = 0; i < single.length; i += 1) {
    for (let j = i + 1; j < single.length; j += 1) {
      const a = single[i]!;
      const b = single[j]!;
      const [codeA] = [...a.codes];
      const [codeB] = [...b.codes];
      const common = Math.min(6, codeA!.length, codeB!.length);
      if (codeA!.slice(0, common) === codeB!.slice(0, common)) continue;
      out.push({
        subject: `crossdoc:${[a.claim.documentType, b.claim.documentType].sort().join('+')}`,
        module: 'HS_CLASSIFICATION',
        status: 'DISCREPANCY',
        severity: 'MEDIUM',
        blocking: true,
        humanReviewRequired: false,
        customerFixable: true,
        ruleId: 'EXT-HS-CROSSDOC',
        title: `HS code differs between documents: ${codeA} and ${codeB}`,
        explanation: `${a.claim.filename} declares HS ${codeA} and ${b.claim.filename} declares HS ${codeB}. A single deal normally carries one classification; the customer should confirm which is right. Different codes can be legitimate for different goods lines.`,
        declared: `${a.claim.filename}: HS ${codeA}; ${b.claim.filename}: HS ${codeB}`,
        retrieved: null,
        claims: [claimRef(a.claim), claimRef(b.claim)],
        evidence: evidenceFor(ctx.reference, [ctx.reference.entries.get(codeA!.slice(0, 4)) ?? null, ctx.reference.entries.get(codeB!.slice(0, 4)) ?? null]),
        limitations: ['Only documents that each declare a single code are compared.'],
        assessedAt,
        transactionDate: ctx.transactionDate,
      });
    }
  }
  return out;
}
