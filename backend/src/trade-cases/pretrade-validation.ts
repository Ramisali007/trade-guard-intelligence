import type { TradeComplianceAnalysis, SanctionsScreeningResult } from '../compliance/types';
import type { DocumentStatus } from '../models/document.model';
import {
  DAY_MS,
  amountVariants,
  applicationEvidence,
  candidate,
  documentEvidence,
  extractedOrNull,
  formatMoney,
  fromRiskSeverity,
  getField,
  isMissing,
  parseIsoDate,
  sameParty,
  sameText,
  statesQuantity,
  type CandidateFinding,
  type TextUnit,
} from './rule-helpers';
import { HS_REFERENCE_SOURCE_ID } from '../verification/source-catalogue';
import type { VerificationPolicy } from '../verification/governance';
import { RAISES_FINDING, type ClaimVerification, type VerificationRun } from '../verification/verification.types';
import { withoutRuleDuplicates } from './finding-dedupe';
import type { AiIssue, CaseDocument, FindingCategory, LcApplicationData, TradeCase } from './trade-case.types';
import type { WorkflowPolicy } from './workflow.policy';

/**
 * Deterministic pre-trade checks. Everything asynchronous (reading the PI, screening, FX) is done
 * by the caller; this function only judges, so the same inputs always give the same findings.
 */

export interface PiContext {
  documentId: string;
  filename: string;
  status: DocumentStatus;
  errorMessage: string | null;
  extractionSource: TradeCase['validation']['piExtractionSource'];
  extraction: TradeComplianceAnalysis | null;
  units: TextUnit[];
}

export interface PreTradeContext {
  tradeCase: TradeCase;
  application: LcApplicationData;
  applicationVersion: number;
  /** The version first submitted, for the material-change rule; null before submission. */
  submittedApplication: LcApplicationData | null;
  policy: WorkflowPolicy;
  /** Latest proforma invoice on the case, or null when none is attached. */
  pi: PiContext | null;
  /** Other active cases that use the same PI file or PI number. */
  piReuse: Array<{ caseId: string; reason: string }>;
  partyScreening: SanctionsScreeningResult | null;
  /** The latest external verification run (HS classification and so on), or null when none ran. */
  externalVerification?: VerificationRun | null;
  /** Set when the verification itself failed to run; reported as a finding, never as a pass. */
  externalVerificationError?: string | null;
  /** How the approval state of each rule, and the criticality of each source, shape what a finding may do. */
  verificationPolicy?: VerificationPolicy;
  /**
   * The customer sent documents only and none has been analysed yet. What the application lacks is
   * then "not read yet", not "missing", so completeness is held back (and one finding says why).
   */
  holdCompleteness?: boolean;
  now: Date;
}

const FIELD_LABELS: Record<string, string> = {
  'applicant.name': 'Applicant name',
  'applicant.country': 'Applicant country',
  'beneficiary.name': 'Beneficiary name',
  'beneficiary.address': 'Beneficiary address',
  'beneficiary.country': 'Beneficiary country',
  proformaInvoiceNumber: 'Proforma invoice number',
  currency: 'Currency',
  amount: 'LC amount',
  goodsDescription: 'Goods description',
  hsCode: 'HS code',
  quantity: 'Quantity',
  unitOfMeasure: 'Unit of measure',
  unitPrice: 'Unit price',
  incoterm: 'Incoterm',
  namedPlace: 'Incoterm named place',
  countryOfOrigin: 'Country of origin',
  portOfLoading: 'Port of loading',
  portOfDischarge: 'Port of discharge',
  latestShipmentDate: 'Latest shipment date',
  expiryDate: 'Expiry date',
  paymentTerms: 'Payment terms',
  usanceDays: 'Usance period (days)',
  requiredDocuments: 'Documents required under the credit',
};

export function fieldLabel(path: string): string {
  return FIELD_LABELS[path] ?? path;
}

export function evaluatePreTrade(ctx: PreTradeContext): CandidateFinding[] {
  const rules = [
    ...notAnalysedYet(ctx),
    ...requiredFields(ctx),
    ...firmCommitment(ctx),
    ...documentReadiness(ctx),
    ...piComparisons(ctx),
    ...piArithmetic(ctx),
    ...dates(ctx),
    ...validityPeriod(ctx),
    ...termsOfImport(ctx),
    ...screening(ctx),
    ...piEngineFindings(ctx),
    ...externalVerificationFindings(ctx),
  ];
  // A point the AI and a rule both found is listed once, as the rule's finding.
  const ai = withoutRuleDuplicates(aiReviewFindings(ctx), rules);
  return [
    ...rules,
    ...ai,
    ...piReuse(ctx),
    ...materialChange(ctx),
    ...usance(ctx),
    ...creditFacility(ctx),
  ];
}

function notAnalysedYet({ holdCompleteness, tradeCase }: PreTradeContext): CandidateFinding[] {
  if (!holdCompleteness) return [];
  const sent = tradeCase.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId).length;
  return [
    candidate('PT-DOC-EXTRACTION', 'not-analysed', {
      category: 'OPERATIONAL',
      severity: 'MEDIUM',
      blocking: true,
      title: 'Documents not analysed yet',
      description: `${sent === 0 ? 'No document has been sent.' : `${sent} document${sent === 1 ? ' has' : 's have'} been sent but not analysed.`} The customer typed no application, so its details come from the documents; until they are read, nothing can be judged as missing or inconsistent.`,
      expected: 'The trade desk has analysed the customer\'s documents.',
      recommendedAction: 'Choose "Analyze documents with AI"; the checks run on what the documents state.',
    }),
  ];
}

function requiredFields({ application, applicationVersion, policy, holdCompleteness }: PreTradeContext): CandidateFinding[] {
  if (holdCompleteness) return [];
  const required = [...policy.requiredApplicationFields];
  if (application.paymentTerms === 'USANCE') required.push('usanceDays');
  return required
    .filter((path) => isMissing(getField(application, path)))
    .map((path) =>
      candidate('PT-REQ-001', path, {
        title: `${fieldLabel(path)} not provided`,
        description: `The application does not state the ${fieldLabel(path).toLowerCase()}. It is required before the credit can be drafted; it is reported as missing, not inferred.`,
        fields: [path],
        observed: [applicationEvidence(fieldLabel(path), getField(application, path), applicationVersion)],
        expected: `${fieldLabel(path)} is present (bank policy: required application fields).`,
        recommendedAction: `Ask the customer to provide the ${fieldLabel(path).toLowerCase()}.`,
      }),
    );
}

function firmCommitment({ tradeCase }: PreTradeContext): CandidateFinding[] {
  const hasCommitment = tradeCase.documents.some(
    (d) => !d.supersededByLinkId && ['PROFORMA_INVOICE', 'PURCHASE_ORDER', 'PURCHASE_CONTRACT'].includes(d.documentType),
  );
  if (hasCommitment) return [];
  return [
    candidate('PK-FEM13-07-FIRM', 'case', {
      title: 'No proforma invoice or order on file',
      description: 'An LC may be opened only against a firm commitment: a proforma invoice or order issued or accepted by the foreign supplier.',
      fields: ['documents'],
      expected: 'A proforma invoice, purchase order or contract is attached (FE Manual Ch.13 para 7).',
      recommendedAction: 'Ask the customer to upload the supplier\'s proforma invoice.',
    }),
  ];
}

function documentReadiness({ pi }: PreTradeContext): CandidateFinding[] {
  if (!pi) return [];
  const subject = pi.documentId;
  if (pi.status === 'uploaded' || pi.status === 'queued' || pi.status === 'processing') {
    return [
      candidate('PT-DOC-EXTRACTION', `${subject}:pending`, {
        category: 'OPERATIONAL',
        severity: 'MEDIUM',
        blocking: true,
        title: 'Proforma invoice still being analysed',
        description: `"${pi.filename}" has not finished processing, so its fields cannot yet be compared with the application.`,
        expected: 'Document analysis complete.',
        recommendedAction: 'Wait for processing to finish; the case re-checks itself when it does.',
      }),
    ];
  }
  if (pi.status === 'failed' || pi.status === 'cancelled' || !pi.extraction) {
    return [
      candidate('PT-DOC-EXTRACTION', `${subject}:failed`, {
        title: 'Proforma invoice could not be read',
        description: `Processing of "${pi.filename}" did not produce usable fields${pi.errorMessage ? `: ${pi.errorMessage}` : ''}. No field values have been assumed.`,
        expected: 'A readable proforma invoice.',
        recommendedAction: 'Ask for a clearer copy, or verify the fields manually against the original and record that verification.',
      }),
    ];
  }
  if (pi.extractionSource === 'DETERMINISTIC_FALLBACK_AFTER_AI_FAILURE' || pi.extractionSource === 'UNKNOWN_LEGACY_ANALYSIS') {
    const why =
      pi.extractionSource === 'UNKNOWN_LEGACY_ANALYSIS'
        ? 'This analysis predates extraction-source tracking, so it is not known whether a model or the parser read the fields.'
        : 'The AI model did not return fields for this document; the values shown were read by the deterministic parser instead.';
    return [
      candidate('PT-DOC-EXTRACTION', `${subject}:fallback`, {
        category: 'LOW_CONFIDENCE_EXTRACTION',
        severity: 'MEDIUM',
        blocking: true,
        title: 'Proforma invoice fields need manual verification',
        description: `${why} Compare each value with the original before relying on the comparisons.`,
        expected: 'Fields read by the configured model, or verified by a reviewer.',
        confidence: null,
        origin: 'AI_ASSISTED_EXTRACTION',
        recommendedAction: 'Open the original document, check the compared fields, then record "verified manually".',
      }),
    ];
  }
  return [];
}

function piComparisons({ pi, application: app, applicationVersion, policy }: PreTradeContext): CandidateFinding[] {
  if (!pi?.extraction) return [];
  const x = pi.extraction;
  const doc = { documentId: pi.documentId, filename: pi.filename, units: pi.units };
  const findings: CandidateFinding[] = [];
  const unverifiable = (ruleId: string, field: string, blocking: boolean) =>
    candidate(ruleId, `${field}:unverifiable`, {
      category: 'LOW_CONFIDENCE_EXTRACTION',
      severity: blocking ? 'MEDIUM' : 'LOW',
      blocking,
      title: `${fieldLabel(field)} could not be read from the proforma invoice`,
      description: `The application states ${applicationEvidence('', getField(app, field), applicationVersion).value}, but no value was extracted from "${pi.filename}". The two have not been compared.`,
      fields: [field],
      observed: [applicationEvidence(fieldLabel(field), getField(app, field), applicationVersion)],
      expected: 'The value is legible on the proforma invoice so it can be compared.',
      origin: 'AI_ASSISTED_EXTRACTION',
      recommendedAction: 'Check the value on the original document and record a manual verification.',
    });
  const mismatch = (ruleId: string, field: string, piValue: string, appValue: string, extra: Partial<CandidateFinding> = {}, variants?: string[]) =>
    candidate(ruleId, field, {
      title: `${fieldLabel(field)} differs between the application and the proforma invoice`,
      description: `Application: ${appValue}. Proforma invoice: ${piValue}.`,
      fields: [field],
      observed: [applicationEvidence(fieldLabel(field), appValue, applicationVersion), documentEvidence(fieldLabel(field), piValue, doc, variants ?? [piValue])],
      expected: `${fieldLabel(field)} on the application equals the proforma invoice.`,
      recommendedAction: 'Query the customer: correct the application, or provide a revised proforma invoice or a documented reason.',
      ...extra,
    });

  // Amount and currency.
  const piTotal = x.transaction.totalValue > 0 ? x.transaction.totalValue : null;
  const piCurrency = extractedOrNull(x.transaction.currency);
  if (app.amount !== null) {
    if (piTotal === null) findings.push(unverifiable('PT-CMP-AMOUNT', 'amount', true));
    else if (Math.abs(piTotal - app.amount) > policy.tolerances.amountAbsolute) {
      const currency = piCurrency ?? app.currency;
      findings.push(
        mismatch('PT-CMP-AMOUNT', 'amount', formatMoney(currency, piTotal), formatMoney(app.currency, app.amount), {
          description: `Application amount ${formatMoney(app.currency, app.amount)}; proforma invoice total ${formatMoney(currency, piTotal)}. Difference ${formatMoney(currency, Math.abs(piTotal - app.amount))}.`,
          severity: 'HIGH',
        }, amountVariants(piTotal)),
      );
    }
  }
  if (app.currency && piCurrency && piCurrency.toUpperCase() !== app.currency.toUpperCase()) {
    findings.push(mismatch('PT-CMP-CURRENCY', 'currency', piCurrency, app.currency));
  }

  // Parties: the PI is issued by the beneficiary to the applicant.
  const seller = extractedOrNull(x.transaction.parties.seller?.legalName);
  const buyer = extractedOrNull(x.transaction.parties.buyer?.legalName);
  if (app.beneficiary.name) {
    if (!seller) findings.push(unverifiable('PT-CMP-BENEFICIARY', 'beneficiary.name', true));
    else if (!sameParty(seller, app.beneficiary.name)) findings.push(mismatch('PT-CMP-BENEFICIARY', 'beneficiary.name', seller, app.beneficiary.name));
  }
  if (app.applicant.name) {
    if (!buyer) findings.push(unverifiable('PT-CMP-APPLICANT', 'applicant.name', false));
    else if (!sameParty(buyer, app.applicant.name)) findings.push(mismatch('PT-CMP-APPLICANT', 'applicant.name', buyer, app.applicant.name, { severity: 'MEDIUM', blocking: true }));
  }

  // Terms.
  const piIncoterm = extractedOrNull(x.transaction.incoterm);
  // The term is its three-letter code; "CFR Karachi" on the invoice is the same term as "CFR" with its named place.
  const piIncotermCode = /^[A-Za-z]{3}\b/.exec(piIncoterm ?? '')?.[0] ?? piIncoterm;
  if (app.incoterm && piIncoterm && piIncotermCode && piIncotermCode.toUpperCase() !== app.incoterm.trim().slice(0, 3).toUpperCase()) {
    findings.push(mismatch('PT-CMP-INCOTERM', 'incoterm', piIncoterm, app.incoterm, { severity: 'MEDIUM', blocking: true }));
  }
  const piOrigin = extractedOrNull(x.transaction.originCountry);
  if (app.countryOfOrigin && piOrigin && !sameText(piOrigin, app.countryOfOrigin)) {
    findings.push(mismatch('PT-CMP-ORIGIN', 'countryOfOrigin', piOrigin, app.countryOfOrigin, { severity: 'MEDIUM', blocking: true }));
  }
  const piNumber = extractedOrNull(x.documentClassification.number);
  if (app.proformaInvoiceNumber && piNumber && !sameText(piNumber, app.proformaInvoiceNumber)) {
    findings.push(mismatch('PT-CMP-PINUMBER', 'proformaInvoiceNumber', piNumber, app.proformaInvoiceNumber, { severity: 'MEDIUM', blocking: true }));
  }

  // Goods: compared only when the PI's lines can be summarised as one quantity and one price.
  const lines = x.goods.filter(statesQuantity);
  if (app.quantity !== null && lines.length > 0) {
    const piQty = lines.reduce((sum, g) => sum + g.quantity, 0);
    const allowed = (app.quantity * policy.tolerances.quantityPercent) / 100;
    if (Math.abs(piQty - app.quantity) > Math.max(allowed, 1e-9)) {
      findings.push(mismatch('PT-CMP-QUANTITY', 'quantity', `${piQty} ${lines[0]?.unitOfMeasure ?? ''}`.trim(), `${app.quantity} ${app.unitOfMeasure}`.trim()));
    }
  }
  const prices = [...new Set(lines.map((g) => g.unitPrice).filter((p) => p > 0))];
  if (app.unitPrice !== null && prices.length === 1) {
    const piPrice = prices[0]!;
    const drift = (Math.abs(piPrice - app.unitPrice) / piPrice) * 100;
    if (drift > policy.tolerances.unitPricePercent) {
      findings.push(mismatch('PT-CMP-UNITPRICE', 'unitPrice', String(piPrice), String(app.unitPrice), {}, [String(piPrice), piPrice.toFixed(2)]));
    }
  }
  return findings;
}

function piArithmetic({ pi }: PreTradeContext): CandidateFinding[] {
  const math = pi?.extraction?.mathematicalValidation;
  if (!pi || !math || math.isMathematicallySound) return [];
  return [
    candidate('PT-PI-ARITHMETIC', pi.documentId, {
      title: 'Proforma invoice arithmetic does not reconcile',
      description: math.discrepancies.map((d) => d.description).join(' '),
      // Figures that do not add up are not a note: the credit would be opened on a number the supplier's own invoice contradicts.
      blocking: true,
      fields: ['amount'],
      observed: math.discrepancies.map((d) => ({ source: 'DOCUMENT' as const, label: 'Arithmetic', value: d.description, documentId: pi.documentId, filename: pi.filename })),
      expected: 'Quantity × unit price equals each line total, and the lines sum to the total.',
      recommendedAction: 'Ask the customer for a corrected proforma invoice.',
    }),
  ];
}

function dates({ application: app, applicationVersion, now }: PreTradeContext): CandidateFinding[] {
  const findings: CandidateFinding[] = [];
  const ship = parseIsoDate(app.latestShipmentDate);
  const expiry = parseIsoDate(app.expiryDate);
  if (expiry && expiry.getTime() < now.getTime()) {
    findings.push(
      candidate('PT-DATE-ORDER', 'expiry-past', {
        title: 'Expiry date is in the past',
        description: `The requested expiry ${app.expiryDate} has already passed.`,
        fields: ['expiryDate'],
        observed: [applicationEvidence('Expiry date', app.expiryDate, applicationVersion)],
        expected: 'Expiry date after today.',
        recommendedAction: 'Ask the customer for a workable expiry date.',
      }),
    );
  }
  if (ship && expiry) {
    const lastPresentation = new Date(ship.getTime() + app.presentationPeriodDays * DAY_MS);
    if (ship.getTime() > expiry.getTime()) {
      findings.push(
        candidate('PT-DATE-ORDER', 'shipment-after-expiry', {
          title: 'Latest shipment date falls after expiry',
          description: `Latest shipment ${app.latestShipmentDate} is after expiry ${app.expiryDate}.`,
          fields: ['latestShipmentDate', 'expiryDate'],
          observed: [applicationEvidence('Latest shipment date', app.latestShipmentDate, applicationVersion), applicationEvidence('Expiry date', app.expiryDate, applicationVersion)],
          expected: 'Shipment on or before expiry.',
          recommendedAction: 'Ask the customer to correct the dates.',
        }),
      );
    } else if (lastPresentation.getTime() > expiry.getTime()) {
      findings.push(
        candidate('PT-DATE-ORDER', 'presentation-window', {
          severity: 'MEDIUM',
          blocking: true,
          title: 'Presentation period runs past expiry',
          description: `Shipping on ${app.latestShipmentDate} leaves ${app.presentationPeriodDays} days for presentation, ending ${lastPresentation.toISOString().slice(0, 10)} — after expiry ${app.expiryDate}. Documents shipped late in the window could not be presented in time.`,
          fields: ['latestShipmentDate', 'expiryDate', 'presentationPeriodDays'],
          observed: [applicationEvidence('Latest shipment date', app.latestShipmentDate, applicationVersion), applicationEvidence('Expiry date', app.expiryDate, applicationVersion)],
          expected: 'Latest shipment + presentation period on or before expiry (UCP 600 art. 14(c), paraphrased).',
          recommendedAction: 'Ask the customer to bring shipment forward or extend expiry.',
        }),
      );
    }
  }
  return findings;
}

function validityPeriod({ application: app, applicationVersion, policy, now }: PreTradeContext): CandidateFinding[] {
  const expiry = parseIsoDate(app.expiryDate);
  if (!expiry) return [];
  const limit = new Date(now);
  limit.setUTCMonth(limit.getUTCMonth() + policy.thresholds.maxValidityMonths);
  if (expiry.getTime() <= limit.getTime()) return [];
  return [
    candidate('PK-FEM13-09-VALIDITY', 'expiry', {
      title: `Validity exceeds ${policy.thresholds.maxValidityMonths} months`,
      description: `Expiry ${app.expiryDate} is more than ${policy.thresholds.maxValidityMonths} months away. Absent an import-policy instruction, LCs are opened for up to 12 months (24 for specially manufactured machinery).`,
      fields: ['expiryDate'],
      observed: [applicationEvidence('Expiry date', app.expiryDate, applicationVersion)],
      expected: `Validity within ${policy.thresholds.maxValidityMonths} months, or a documented exemption (FE Manual Ch.13 para 9(ii); currency of text unverified).`,
      recommendedAction: 'Shorten the validity, or record the applicable exemption.',
    }),
  ];
}

function termsOfImport({ application: app, applicationVersion }: PreTradeContext): CandidateFinding[] {
  if (!app.incoterm || ['FOB', 'CFR'].includes(app.incoterm.toUpperCase())) return [];
  return [
    candidate('PK-FEM13-05-TERMS', 'incoterm', {
      blocking: false,
      title: `Incoterm ${app.incoterm} — confirm permissibility`,
      description: 'The archived FE Manual text lists FOB and CFR as the terms of import. Later instructions may permit others; a reviewer should confirm.',
      fields: ['incoterm'],
      observed: [applicationEvidence('Incoterm', app.incoterm, applicationVersion)],
      expected: 'Terms of import permitted by the current FE Manual (Ch.13 para 5, archived text).',
      recommendedAction: 'Confirm against the current manual; record the outcome.',
    }),
  ];
}

function screening({ partyScreening }: PreTradeContext): CandidateFinding[] {
  if (!partyScreening) return [];
  const findings: CandidateFinding[] = partyScreening.matches.map((m) =>
    candidate('CMP-SANCTIONS-PARTY', `${m.roleOrField}:${m.matchedSanctionedName}`, {
      origin: 'SANCTIONS_ENGINE',
      confidence: m.matchConfidence,
      title: `Possible sanctions match: ${m.entityOrSubject}`,
      description: `"${m.entityOrSubject}" (${m.roleOrField}) resembles "${m.matchedSanctionedName}" on ${m.sanctionsList}${m.sanctionProgram ? ` (${m.sanctionProgram})` : ''}, match type ${m.matchType}. A name match is evidence for review, not proof the party is sanctioned.`,
      fields: [m.roleOrField],
      observed: [
        {
          source: 'SCREENING',
          label: `${m.sanctionsList} ${m.matchType} ${Math.round(m.matchConfidence * 100)}%`,
          value: `${m.matchedSanctionedName}${m.matchedIdentifiers.length ? ` — ${m.matchedIdentifiers.join(', ')}` : ''}`,
          snippet: `Dataset ${m.sourceDatasetVersion}, screened ${m.screeningTimestamp}`,
        },
      ],
      expected: 'No unresolved match against applicable sanctions lists.',
      recommendedAction: m.recommendedAction || 'Compliance to compare identifiers and disposition the match.',
    }),
  );
  for (const risk of partyScreening.jurisdictionRisks) {
    if (risk.sanctionsStatus === 'CLEAR' || risk.sanctionsStatus === 'UNKNOWN') continue;
    findings.push(
      candidate('CMP-JURISDICTION', `${risk.nodeRole}:${risk.countryName}`, {
        origin: 'SANCTIONS_ENGINE',
        severity: risk.sanctionsStatus === 'COMPREHENSIVE_SANCTIONED' || risk.sanctionsStatus === 'FATF_BLACK_LIST' ? 'CRITICAL' : 'HIGH',
        title: `${risk.countryName}: ${risk.sanctionsStatus.replace(/_/g, ' ').toLowerCase()}`,
        description: `${risk.nodeRole.replace(/_/g, ' ').toLowerCase()} — ${risk.description}`,
        fields: [risk.nodeRole],
        observed: [{ source: 'SCREENING', label: risk.nodeRole, value: `${risk.countryName} (${risk.sanctionsStatus})`, snippet: `Dataset ${partyScreening.datasetVersion}` }],
        expected: 'No unreviewed exposure to sanctioned or high-risk jurisdictions.',
        recommendedAction: 'Compliance review under the bank\'s jurisdiction-risk policy.',
      }),
    );
  }
  return findings;
}


/** What each outcome means for the people reading the case: customer-fixable points become queries, the rest stay with the desk. */
function externalCategory(r: ClaimVerification): FindingCategory {
  if (r.status === 'SOURCE_UNAVAILABLE') return 'OPERATIONAL';
  if (r.status === 'INSUFFICIENT_EVIDENCE') return 'MISSING_INFORMATION';
  // A condition recorded on a tariff line is for the bank's own examination: never shown or mailed to the customer.
  if (r.status === 'POTENTIALLY_RESTRICTED') return 'REGULATORY_CONCERN';
  return 'DATA_INCONSISTENCY';
}

/**
 * Results of the external verification run that need a person. Clean results (VERIFIED, CONSISTENT) are not
 * findings: they are kept on the run so the screen can show what was checked, and are never presented as proof.
 * Each finding carries the source record, its retrieval time, the file hash and whether it is stale, so the
 * reasoning can be reproduced.
 */
function externalVerificationFindings({ externalVerification, externalVerificationError, verificationPolicy }: PreTradeContext): CandidateFinding[] {
  const policy = verificationPolicy;
  const out: CandidateFinding[] = [];

  // The verification itself could not run. Never a clean result: a visible finding, blocking only when the
  // source it needs is mandatory for a rule that is a control.
  if (externalVerificationError) {
    const control = policy?.enforcement('EXT-VERIFY-SOURCE');
    const holds = Boolean(policy && control?.mayBlock && policy.sourceMandatory(HS_REFERENCE_SOURCE_ID));
    out.push(
      candidate('EXT-VERIFY-SOURCE', 'verification-failed', {
        origin: 'EXTERNAL_VERIFICATION',
        category: 'OPERATIONAL',
        severity: holds ? 'HIGH' : 'MEDIUM',
        blocking: holds,
        customerFixable: false,
        title: 'External verification could not run',
        description: `The checks against official sources failed (${externalVerificationError}). The HS codes and other external claims have NOT been verified; this is not a clean result.${holds ? ' The source is mandatory for a bank control, so the approval is held until the check has run or an authorised exception is recorded.' : ''}${control ? ` [${control.label}]` : ''}`,
        expected: 'External verification completed.',
        recommendedAction: 'Re-run validation, or verify the codes against the tariff and record it.',
      }),
    );
  }
  if (!externalVerification) return out;

  for (const r of externalVerification.results.filter((x) => RAISES_FINDING.has(x.status))) {
    const control = policy?.enforcement(r.ruleId);
    let blocking = control ? r.blocking && control.mayBlock : r.blocking;
    let severity = r.severity;
    let note = '';
    // A missing mandatory source holds the approval, but only where the control that depends on it is in force.
    if (r.status === 'SOURCE_UNAVAILABLE' && policy && control?.mayBlock && policy.sourceMandatory(HS_REFERENCE_SOURCE_ID)) {
      blocking = true;
      severity = 'HIGH';
      note = ' The source is mandatory for a bank control, so the approval is held until the check has run or an authorised exception is recorded.';
    }
    out.push(
      candidate(r.ruleId, r.subject, {
        origin: 'EXTERNAL_VERIFICATION',
        customerFixable: r.customerFixable,
        category: externalCategory(r),
        severity,
        blocking,
        title: r.title,
        description: `${r.explanation}${note}${control ? ` [${control.label}]` : ''}`,
        fields: r.module === 'PORT_IDENTITY' ? ['portOfLoading', 'portOfDischarge'] : r.module === 'VESSEL_IDENTITY' ? [] : ['hsCode'],
        observed: [
          ...r.claims.map((c) => ({ source: 'DOCUMENT' as const, label: c.field, value: c.extractedValue || c.field, documentId: c.documentId === 'application' ? undefined : c.documentId, filename: c.filename, ...(c.page ? { pageNumber: c.page } : {}), ...(c.snippet ? { snippet: c.snippet } : {}) })),
          ...r.evidence.map((e) => ({
            source: 'EXTERNAL_SOURCE' as const,
            label: `${e.sourceName} · ${e.recordId}`,
            value: e.excerpt,
            snippet: `Retrieved ${e.retrievedAt} · ${e.origin === 'SYNTHETIC_TEST' ? 'SYNTHETIC TEST DATA · ' : ''}${e.datasetVersion ? `version ${e.datasetVersion} · ` : ''}file sha256 ${e.contentHash.slice(0, 12)}${e.stale ? ' · STALE, older than its freshness limit' : ''}`,
          })),
          ...(control ? [{ source: 'POLICY' as const, label: 'Rule status', value: `${r.ruleId} v${control.version}: ${control.label}` }] : []),
        ],
        expected: r.retrieved ? `The declared value agrees with the source: ${r.retrieved}` : 'The claim can be checked against an authoritative source.',
        recommendedAction:
          r.status === 'SOURCE_UNAVAILABLE'
            ? 'Re-run validation once the source is available, or verify the codes against the tariff and record it.'
            : r.status === 'INSUFFICIENT_EVIDENCE'
              ? 'Ask the customer for the product name, material and use, then re-run.'
              : 'A trade officer examines the classification against the tariff; the customer may be asked to confirm the code and send product specifications.',
      }),
    );
  }
  return out;
}

/** Lifts what the existing post-trade engines already found on the PI into case findings. */
function piEngineFindings({ pi, tradeCase }: PreTradeContext): CandidateFinding[] {
  const x = pi?.extraction;
  if (!pi || !x) return [];
  const caseDocumentIds = new Set(tradeCase.documents.map((d) => d.documentId));
  const findings: CandidateFinding[] = [];
  const evidenceBase = { source: 'DOCUMENT' as const, documentId: pi.documentId, filename: pi.filename };

  for (const m of x.sanctions?.matches ?? []) {
    findings.push(
      candidate('CMP-SANCTIONS-PARTY', `pi:${m.roleOrField}:${m.matchedSanctionedName}`, {
        origin: 'SANCTIONS_ENGINE',
        confidence: m.matchConfidence,
        title: `Possible sanctions match on the proforma invoice: ${m.entityOrSubject}`,
        description: `Named on "${pi.filename}" as ${m.roleOrField}; resembles "${m.matchedSanctionedName}" on ${m.sanctionsList}. Evidence for review, not proof.`,
        fields: [m.roleOrField],
        observed: [{ ...evidenceBase, label: `${m.sanctionsList} ${m.matchType}`, value: m.matchedSanctionedName }],
        expected: 'No unresolved match against applicable sanctions lists.',
        recommendedAction: 'Compliance to compare identifiers and disposition the match.',
      }),
    );
  }
  for (const flag of x.tbml?.redFlags ?? []) {
    const severity = fromRiskSeverity(flag.severity);
    findings.push(
      candidate('TBML-PI-INDICATOR', `${flag.category}:${flag.title}`, {
        origin: 'TBML_ENGINE',
        severity,
        blocking: severity === 'HIGH' || severity === 'CRITICAL',
        title: flag.title,
        description: `${flag.description} This is an indicator for review, not a finding of wrongdoing.`,
        observed: [{ ...evidenceBase, label: flag.category, value: flag.evidence }],
        expected: 'Indicator reviewed and dispositioned by compliance.',
        recommendedAction: 'Compliance to review the evidence and disposition.',
      }),
    );
  }
  for (const goods of x.exportControls?.controlledGoods ?? []) {
    const severity = fromRiskSeverity(goods.riskSeverity);
    findings.push(
      candidate('CMP-EXPORT-CONTROL', goods.itemDescription, {
        origin: 'TBML_ENGINE',
        severity,
        blocking: severity === 'HIGH' || severity === 'CRITICAL',
        title: `Possibly controlled goods: ${goods.itemDescription}`,
        description: `${goods.category}: ${goods.controlReason}. ${goods.licenseRequirement}`,
        fields: ['goodsDescription', 'hsCode'],
        observed: [{ ...evidenceBase, label: goods.hsCode ? `HS ${goods.hsCode}` : 'Goods', value: goods.itemDescription }],
        expected: 'Classification and any licence confirmed.',
        recommendedAction: 'Compliance confirms classification, licence and end use.',
      }),
    );
  }
  for (const alert of x.fraudAnalysis?.alerts ?? []) {
    if (alert.severity !== 'HIGH' && alert.severity !== 'CRITICAL') continue;
    // A replay or reuse alert whose only matches are other documents of this same request is not a
    // replay of an earlier financing: the proforma invoice agrees with its own purchase order, or a
    // corrected invoice differs from the one it replaces. Matches on documents outside the case still raise it.
    const matched = alert.evidence.map((e) => e.matchedDocumentId).filter((id): id is string => Boolean(id));
    if (matched.length > 0 && matched.every((id) => id !== pi.documentId && caseDocumentIds.has(id))) continue;
    findings.push(
      candidate('TBML-PI-INDICATOR', `fraud:${alert.code}`, {
        origin: 'FRAUD_ENGINE',
        severity: alert.severity,
        title: alert.title,
        description: `${alert.summary} Raised by the document-replay engine; an indicator, not a conclusion.`,
        observed: alert.evidence.slice(0, 3).map((e) => ({ ...evidenceBase, label: e.field, value: `${e.currentValue}${e.historicalValue ? ` (previously ${e.historicalValue})` : ''}` })),
        expected: 'Indicator reviewed and dispositioned by compliance.',
        recommendedAction: alert.recommendedAction,
      }),
    );
  }
  return findings;
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/**
 * An AI issue as the case records it. The AI's "regulatory concern" is, by the instructions it was
 * given, something the customer can fix or supply (a permit, an unacceptable term), so it is filed as
 * an LC-term issue the customer can be asked about; sanctions, jurisdiction, dual-use and money-laundering
 * concerns come as compliance alerts and stay with the bank.
 */
function aiCategory(issue: AiIssue): FindingCategory {
  return issue.category === 'REGULATORY_CONCERN' ? 'LC_TERM_ISSUE' : issue.category;
}

function aiFinding(ruleId: 'AI-DOC-REVIEW' | 'AI-CASE-REVIEW', subject: string, issue: AiIssue, docs: CaseDocument[], model: string): CandidateFinding {
  const category = aiCategory(issue);
  const bankOnly = category === 'COMPLIANCE_ALERT';
  return candidate(ruleId, subject, {
    category,
    severity: issue.severity,
    // Said by a model: it is reported, and the desk decides; only a serious one stops the request.
    blocking: issue.severity === 'CRITICAL' || issue.severity === 'HIGH',
    title: issue.title || 'Point found by the AI review',
    description: `${issue.description}${model ? ` (AI review by ${model})` : ''}`,
    fields: issue.fields ?? [],
    observed: [
      ...docs.map((d) => {
        // Each document shows its own verified words; an issue without quotes shows its evidence or the file name.
        const own = (issue.quotes ?? []).filter((q) => q.file === d.filename).map((q) => `"${q.text}"`).join('; ');
        const shown = own || (issue.quotes?.length ? '' : issue.evidence);
        return { source: 'DOCUMENT' as const, label: shown ? 'Quoted from the document' : 'Document', value: shown || d.filename, documentId: d.documentId, filename: d.filename };
      }),
      ...(issue.regulation ? [{ source: 'POLICY' as const, label: 'Basis', value: issue.regulation }] : []),
    ],
    expected: issue.regulation || (category === 'DATA_INCONSISTENCY' ? 'The documents state the same value.' : 'The documents are complete, consistent and meet the import-LC checks.'),
    origin: 'AI_ASSISTED_EXTRACTION',
    recommendedAction: bankOnly ? 'Compliance to examine the point and record a disposition.' : issue.customerAction || 'The trade desk to confirm the point with the customer.',
  });
}

/**
 * What the AI found in each current document, and between them. Only the current documents count: a
 * document a new upload replaced is ignored, and so is a case review of an earlier set of documents.
 */
function aiReviewFindings({ tradeCase }: PreTradeContext): CandidateFinding[] {
  const active = tradeCase.documents.filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId);
  const out: CandidateFinding[] = [];
  for (const doc of active) {
    const review = tradeCase.aiReviews?.[doc.documentId];
    if (!review) continue;
    review.issues.forEach((issue, i) => out.push(aiFinding('AI-DOC-REVIEW', `${doc.documentType}:${slug(issue.code || issue.title) || String(i)}`, issue, [doc], review.model)));
  }
  const review = tradeCase.caseReview;
  const current = new Set(active.map((d) => d.documentId));
  if (review && review.documentIds.length === current.size && review.documentIds.every((id) => current.has(id))) {
    review.issues.forEach((issue, i) => {
      const involved = active.filter((d) => issue.documentsInvolved.some((name) => name && (d.filename.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(d.filename.toLowerCase()))));
      out.push(aiFinding('AI-CASE-REVIEW', `case:${slug(issue.code || issue.title) || String(i)}`, issue, involved, review.model));
    });
  }
  return out;
}

function piReuse({ piReuse: reuse }: PreTradeContext): CandidateFinding[] {
  return reuse.map((r) =>
    candidate('TBML-PI-REUSE', r.caseId, {
      title: `Proforma invoice also used on case ${r.caseId}`,
      description: `${r.reason}. The same commercial commitment financed twice is a known TBML and double-financing typology; it can also be an innocent re-application.`,
      observed: [{ source: 'CASE_HISTORY', label: 'Other case', value: r.caseId }],
      expected: 'One proforma invoice supports one financing request, or the relationship is explained.',
      recommendedAction: 'Compliance to compare both cases and disposition.',
    }),
  );
}

function materialChange({ application: app, submittedApplication: first, applicationVersion, policy }: PreTradeContext): CandidateFinding[] {
  if (!first) return [];
  const findings: CandidateFinding[] = [];
  if (first.beneficiary.name && app.beneficiary.name && !sameParty(first.beneficiary.name, app.beneficiary.name)) {
    findings.push(
      candidate('TBML-MATERIAL-CHANGE', 'beneficiary', {
        severity: 'HIGH',
        title: 'Beneficiary changed after submission',
        description: `First submitted for "${first.beneficiary.name}"; now "${app.beneficiary.name}".`,
        fields: ['beneficiary.name'],
        observed: [applicationEvidence('Beneficiary (current)', app.beneficiary.name, applicationVersion)],
        expected: 'Beneficiary unchanged, or the change explained and re-screened.',
        recommendedAction: 'Compliance re-assessment of the new counterparty.',
      }),
    );
  }
  if (first.amount && app.amount) {
    const change = (Math.abs(app.amount - first.amount) / first.amount) * 100;
    if (change > policy.thresholds.materialAmountChangePercent) {
      findings.push(
        candidate('TBML-MATERIAL-CHANGE', 'amount', {
          title: `Amount changed by ${change.toFixed(1)}% after submission`,
          description: `First submitted at ${formatMoney(first.currency, first.amount)}; now ${formatMoney(app.currency, app.amount)}.`,
          fields: ['amount'],
          observed: [applicationEvidence('Amount (current)', app.amount, applicationVersion)],
          expected: `Change within ${policy.thresholds.materialAmountChangePercent}%, or re-assessed.`,
          recommendedAction: 'Compliance re-assessment of pricing and purpose.',
        }),
      );
    }
  }
  return findings;
}

function usance({ application: app, applicationVersion, policy }: PreTradeContext): CandidateFinding[] {
  if (app.paymentTerms !== 'USANCE' || app.usanceDays === null || app.usanceDays <= policy.thresholds.maxUsanceDaysWithoutReview) return [];
  return [
    candidate('TBML-USANCE', 'usanceDays', {
      blocking: false,
      title: `Usance of ${app.usanceDays} days`,
      description: `Deferred payment beyond ${policy.thresholds.maxUsanceDaysWithoutReview} days is routed for review under bank policy.`,
      fields: ['usanceDays'],
      observed: [applicationEvidence('Usance days', app.usanceDays, applicationVersion)],
      expected: `Usance up to ${policy.thresholds.maxUsanceDaysWithoutReview} days, or reviewed.`,
      recommendedAction: 'Compliance to note the rationale for the extended tenor.',
    }),
  ];
}

function creditFacility({ tradeCase, application: app }: PreTradeContext): CandidateFinding[] {
  const facility = tradeCase.creditFacility;
  if (!facility || app.amount === null) return [];
  if (facility.currency.toUpperCase() !== app.currency.toUpperCase()) {
    return [
      candidate('CRD-FACILITY', 'currency', {
        title: 'Facility currency differs from the LC currency',
        description: `Facility ${facility.facilityReference} is in ${facility.currency}; the LC is in ${app.currency}. Sufficiency cannot be checked without an approved conversion.`,
        observed: [{ source: 'APPLICATION', label: 'Facility', value: `${facility.currency} ${facility.availableLimit}` }],
        expected: 'Facility and LC in the same currency, or a recorded conversion.',
        recommendedAction: 'Credit to record the facility in the LC currency.',
      }),
    ];
  }
  const required = app.amount * (1 + app.amountTolerancePercent / 100);
  if (facility.availableLimit >= required) return [];
  return [
    candidate('CRD-FACILITY', 'limit', {
      title: 'Available facility does not cover the LC',
      description: `${formatMoney(app.currency, required)} needed (including tolerance); ${formatMoney(facility.currency, facility.availableLimit)} available on ${facility.facilityReference} (${facility.verificationSource === 'SANDBOX_DEMO_DATA' ? 'sandbox demo figure' : 'officer-verified'}).`,
      observed: [{ source: 'APPLICATION', label: 'Available limit', value: formatMoney(facility.currency, facility.availableLimit) }],
      expected: 'Available limit ≥ LC amount plus tolerance.',
      recommendedAction: 'Credit to arrange a limit or decline.',
    }),
  ];
}

export interface AmendmentContext {
  tradeCase: TradeCase;
  amendmentId: string;
  /** The terms if the amendment takes effect. */
  proposed: LcApplicationData;
  /** The terms in force now; material change is measured from them. */
  current: LcApplicationData;
  policy: WorkflowPolicy;
  partyScreening: SanctionsScreeningResult | null;
  now: Date;
}

/**
 * An amendment re-runs the rules a change to issued terms can break — completeness, dates and
 * validity, terms of import, screening of any new party, material change, usance and credit cover —
 * against the proposed terms. Its findings carry the amendment's id and never touch the original
 * pre-trade findings.
 */
export function evaluateAmendment(ctx: AmendmentContext): CandidateFinding[] {
  const pre: PreTradeContext = {
    tradeCase: ctx.tradeCase,
    application: ctx.proposed,
    applicationVersion: ctx.tradeCase.currentApplicationVersion,
    submittedApplication: ctx.current,
    policy: ctx.policy,
    pi: null,
    piReuse: [],
    partyScreening: ctx.partyScreening,
    now: ctx.now,
  };
  return [
    ...requiredFields(pre),
    ...dates(pre),
    ...validityPeriod(pre),
    ...termsOfImport(pre),
    ...screening(pre),
    ...materialChange(pre),
    ...usance(pre),
    ...creditFacility(pre),
  ].map((f) => ({ ...f, key: `${ctx.amendmentId}:${f.key}`, stage: 'AMENDMENT' as const, amendmentId: ctx.amendmentId }));
}
