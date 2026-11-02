import type { TradeComplianceAnalysis } from '../compliance/types';
import { parseTradeDate } from '../utils/trade-date';
import {
  DAY_MS,
  amountVariants,
  candidate,
  documentEvidence,
  extractedOrNull,
  formatMoney,
  fromRiskSeverity,
  parseIsoDate,
  sameParty,
  sameText,
  wordOverlap,
  type CandidateFinding,
  type TextUnit,
} from './rule-helpers';
import type { CreditOfRecord, Presentation, PresentationDocumentType } from './trade-case.types';
import type { WorkflowPolicy } from './workflow.policy';

/**
 * Examination of a presentation against the credit as issued (not as applied for).
 *
 * The rules mirror UCP 600 articles, paraphrased; they apply only when the credit is subject to
 * UCP 600 and an examiner confirms each discrepancy against the bank's licensed text. Counted
 * units (pieces, sets, cartons) get no quantity tolerance; other units get 5% (art. 30(b)).
 */

export interface PresentedDocument {
  linkId: string;
  documentId: string;
  documentType: PresentationDocumentType;
  filename: string;
  extraction: TradeComplianceAnalysis | null;
  units: TextUnit[];
}

export interface ExaminationContext {
  /** The issued credit, or the approved pre-shipment application when none is recorded. */
  credit: CreditOfRecord;
  presentation: Presentation;
  documents: PresentedDocument[];
  /** The pre-trade proforma invoice extraction, to measure price drift between approval and shipment. */
  approvedPi: TradeComplianceAnalysis | null;
  policy: WorkflowPolicy;
}

const COUNTED_UNITS = new Set(['PCS', 'PIECES', 'SETS', 'SET', 'UNITS', 'UNIT', 'CARTONS', 'CARTON', 'CTNS', 'PAIRS', 'NOS', 'BOXES']);

export function evaluatePresentation(ctx: ExaminationContext): CandidateFinding[] {
  const { credit, presentation, documents } = ctx;
  const terms = credit.terms;
  const pid = presentation.presentationId;
  const findings: CandidateFinding[] = [];
  const post = { stage: 'POST_TRADE' as const, presentationId: pid };

  // Stipulated documents.
  const presentedTypes = new Set(documents.map((d) => d.documentType));
  for (const required of terms.requiredDocuments) {
    if (presentedTypes.has(required)) continue;
    findings.push(
      candidate('EXM-REQUIRED-DOCS', `${pid}:${required}`, {
        ...post,
        title: `${required.replace(/_/g, ' ').toLowerCase()} not presented`,
        description: `The credit (${credit.reference}) calls for a ${required.replace(/_/g, ' ').toLowerCase()}; none is in this presentation.`,
        fields: ['requiredDocuments'],
        expected: 'Every document stipulated in the credit is presented (UCP 600 art. 14, paraphrased).',
        recommendedAction: 'Treat as a discrepancy: seek the applicant\'s waiver or refuse.',
      }),
    );
  }

  // Unreadable documents cannot be examined automatically.
  for (const doc of documents) {
    if (doc.extraction) continue;
    findings.push(
      candidate('EXM-REQUIRED-DOCS', `${pid}:${doc.linkId}:unreadable`, {
        ...post,
        category: 'DOCUMENT_QUALITY',
        title: `${doc.filename} could not be examined automatically`,
        description: 'Its fields were not extracted. Nothing about it has been assumed compliant.',
        expected: 'A readable document, or manual examination recorded.',
        recommendedAction: 'Examine the original manually and record the result.',
      }),
    );
  }

  const invoice = documents.find((d) => d.documentType === 'COMMERCIAL_INVOICE' && d.extraction);
  if (invoice?.extraction) findings.push(...examineInvoice(ctx, invoice, post));

  const transport = documents.find((d) => d.documentType === 'BILL_OF_LADING' && d.extraction);
  if (transport?.extraction) findings.push(...examineTransport(ctx, transport, post));

  // Presented after expiry.
  const expiry = parseIsoDate(terms.expiryDate);
  const received = new Date(presentation.receivedAt);
  if (expiry && received.getTime() > expiry.getTime() + DAY_MS - 1) {
    findings.push(
      candidate('EXM-PRESENTATION-PERIOD', `${pid}:expiry`, {
        ...post,
        title: 'Presented after the credit expired',
        description: `Received ${presentation.receivedAt.slice(0, 10)}; the credit expired ${terms.expiryDate}.`,
        expected: 'Presentation on or before expiry (UCP 600 art. 6(d), paraphrased).',
        recommendedAction: 'Refuse, or seek the applicant\'s waiver.',
      }),
    );
  }

  // The existing engines' own alerts on what was presented.
  for (const doc of documents) {
    const x = doc.extraction;
    if (!x) continue;
    const base = { source: 'DOCUMENT' as const, documentId: doc.documentId, filename: doc.filename };
    for (const flag of x.tbml?.redFlags ?? []) {
      const severity = fromRiskSeverity(flag.severity);
      if (severity !== 'HIGH' && severity !== 'CRITICAL') continue;
      findings.push(
        candidate('TBML-POST-ENGINE', `${pid}:${doc.linkId}:${flag.category}:${flag.title}`, {
          ...post,
          origin: 'TBML_ENGINE',
          severity,
          title: flag.title,
          description: `${flag.description} (on ${doc.filename}). An indicator, not a conclusion.`,
          observed: [{ ...base, label: flag.category, value: flag.evidence }],
          expected: 'Indicator reviewed and dispositioned by compliance.',
          recommendedAction: 'Compliance to review; open an investigation if warranted.',
        }),
      );
    }
    for (const alert of x.fraudAnalysis?.alerts ?? []) {
      if (alert.severity !== 'HIGH' && alert.severity !== 'CRITICAL') continue;
      findings.push(
        candidate('TBML-POST-ENGINE', `${pid}:${doc.linkId}:fraud:${alert.code}`, {
          ...post,
          origin: 'FRAUD_ENGINE',
          severity: alert.severity,
          title: alert.title,
          description: `${alert.summary} (on ${doc.filename}).`,
          observed: alert.evidence.slice(0, 3).map((e) => ({ ...base, label: e.field, value: String(e.currentValue) })),
          expected: 'Indicator reviewed and dispositioned by compliance.',
          recommendedAction: alert.recommendedAction,
        }),
      );
    }
    for (const m of x.sanctions?.matches ?? []) {
      findings.push(
        candidate('CMP-SANCTIONS-PARTY', `${pid}:${doc.linkId}:${m.roleOrField}:${m.matchedSanctionedName}`, {
          ...post,
          origin: 'SANCTIONS_ENGINE',
          confidence: m.matchConfidence,
          title: `Possible sanctions match on ${doc.filename}: ${m.entityOrSubject}`,
          description: `Resembles "${m.matchedSanctionedName}" on ${m.sanctionsList}. Evidence for review, not proof.`,
          observed: [{ ...base, label: `${m.sanctionsList} ${m.matchType}`, value: m.matchedSanctionedName }],
          expected: 'No unresolved sanctions match on presented documents.',
          recommendedAction: 'Compliance to disposition before any payment.',
        }),
      );
    }
  }

  // One finding per key, even when two rules reach the same subject.
  const seen = new Set<string>();
  return findings.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true)));
}

function examineInvoice(ctx: ExaminationContext, invoice: PresentedDocument, post: { stage: 'POST_TRADE'; presentationId: string }): CandidateFinding[] {
  const terms = ctx.credit.terms;
  const x = invoice.extraction!;
  const pid = post.presentationId;
  const doc = { documentId: invoice.documentId, filename: invoice.filename, units: invoice.units };
  const findings: CandidateFinding[] = [];

  const total = x.transaction.totalValue > 0 ? x.transaction.totalValue : null;
  const currency = extractedOrNull(x.transaction.currency);
  const ceiling = (terms.amount ?? 0) * (1 + terms.amountTolerancePercent / 100);
  if (total === null) {
    findings.push(
      candidate('EXM-INV-AMOUNT', `${pid}:unreadable`, {
        ...post,
        category: 'LOW_CONFIDENCE_EXTRACTION',
        severity: 'MEDIUM',
        blocking: true,
        title: 'Invoice amount could not be read',
        description: `No total was extracted from ${invoice.filename}; the amount has not been checked against the credit.`,
        expected: 'Invoice total legible.',
        origin: 'AI_ASSISTED_EXTRACTION',
        recommendedAction: 'Check the amount manually and record the verification.',
      }),
    );
  } else if (total > ceiling + 0.005) {
    findings.push(
      candidate('EXM-INV-AMOUNT', pid, {
        ...post,
        title: 'Invoice exceeds the approved amount',
        description: `Invoice ${formatMoney(currency ?? terms.currency, total)}; credit allows ${formatMoney(terms.currency, ceiling)}${terms.amountTolerancePercent ? ` (incl. ${terms.amountTolerancePercent}% tolerance)` : ''}.`,
        fields: ['amount'],
        observed: [documentEvidence('Invoice total', formatMoney(currency ?? terms.currency, total), doc, amountVariants(total))],
        expected: 'Invoice amount within the credit (UCP 600 art. 18(b), 30(a), paraphrased).',
        recommendedAction: 'Seek the applicant\'s waiver, or refuse.',
      }),
    );
  }
  if (currency && currency.toUpperCase() !== terms.currency.toUpperCase()) {
    findings.push(
      candidate('EXM-INV-CURRENCY', pid, {
        ...post,
        title: 'Invoice currency differs from the credit',
        description: `Invoice in ${currency}; credit in ${terms.currency}.`,
        fields: ['currency'],
        observed: [documentEvidence('Invoice currency', currency, doc)],
        expected: 'Invoice in the currency of the credit (UCP 600 art. 18(a)(iii), paraphrased).',
        recommendedAction: 'Seek the applicant\'s waiver, or refuse.',
      }),
    );
  }

  const seller = extractedOrNull(x.transaction.parties.seller?.legalName);
  if (!seller || !sameParty(seller, terms.beneficiary.name)) {
    findings.push(
      candidate('EXM-INV-BENEFICIARY', pid, {
        ...post,
        severity: seller ? 'HIGH' : 'MEDIUM',
        title: seller ? 'Invoice not issued by the beneficiary' : 'Invoice issuer could not be read',
        description: seller ? `Issued by "${seller}"; the beneficiary is "${terms.beneficiary.name}".` : 'No issuer was extracted; the beneficiary has not been confirmed.',
        fields: ['beneficiary.name'],
        observed: seller ? [documentEvidence('Invoice issuer', seller, doc)] : [],
        expected: 'Invoice issued by the beneficiary (UCP 600 art. 18(a)(i), paraphrased).',
        recommendedAction: seller ? 'Seek the applicant\'s waiver, or refuse.' : 'Confirm the issuer manually.',
      }),
    );
  }
  const buyer = extractedOrNull(x.transaction.parties.buyer?.legalName);
  if (buyer && !sameParty(buyer, terms.applicant.name)) {
    findings.push(
      candidate('EXM-INV-APPLICANT', pid, {
        ...post,
        severity: 'MEDIUM',
        blocking: true,
        title: 'Invoice not made out to the applicant',
        description: `Made out to "${buyer}"; the applicant is "${terms.applicant.name}".`,
        fields: ['applicant.name'],
        observed: [documentEvidence('Invoice buyer', buyer, doc)],
        expected: 'Invoice made out in the name of the applicant (UCP 600 art. 18(a)(ii), paraphrased).',
        recommendedAction: 'Seek the applicant\'s waiver, or refuse.',
      }),
    );
  }

  const description = x.goods.map((g) => g.productDescription).join(' ');
  if (terms.goodsDescription && description) {
    const overlap = wordOverlap(terms.goodsDescription, description);
    if (overlap < 0.5) {
      findings.push(
        candidate('EXM-INV-GOODS', pid, {
          ...post,
          severity: 'MEDIUM',
          blocking: true,
          confidence: Math.round(overlap * 100) / 100,
          title: 'Goods description may not correspond with the credit',
          description: `Only ${Math.round(overlap * 100)}% of the credit's description words appear on the invoice. A word comparison cannot judge correspondence; an examiner must.`,
          fields: ['goodsDescription'],
          observed: [documentEvidence('Invoice goods', description.slice(0, 160), doc)],
          expected: 'Invoice goods description corresponds with the credit (UCP 600 art. 18(c), paraphrased).',
          recommendedAction: 'Examiner to compare descriptions and confirm or raise a discrepancy.',
        }),
      );
    }
  }

  const quantity = x.goods.reduce((sum, g) => sum + (g.quantity > 0 ? g.quantity : 0), 0);
  if (terms.quantity && quantity > 0) {
    const counted = COUNTED_UNITS.has(terms.unitOfMeasure.toUpperCase());
    const allowed = counted ? 0 : terms.quantity * 0.05;
    if (Math.abs(quantity - terms.quantity) > allowed + 1e-9) {
      findings.push(
        candidate('EXM-QUANTITY', pid, {
          ...post,
          severity: 'MEDIUM',
          blocking: true,
          title: 'Invoiced quantity outside the credit\'s tolerance',
          description: `Invoiced ${quantity} ${terms.unitOfMeasure}; credit ${terms.quantity} ${terms.unitOfMeasure}${counted ? ' (counted units: no tolerance)' : ' (±5%)'}.`,
          fields: ['quantity'],
          observed: [documentEvidence('Invoiced quantity', String(quantity), doc)],
          expected: 'Quantity within tolerance (UCP 600 art. 30(b), paraphrased).',
          recommendedAction: 'Seek the applicant\'s waiver, or refuse.',
        }),
      );
    }
  }

  // Price drift from the proforma that was approved: links pre-trade evidence to post-trade.
  const approvedPrices = (ctx.approvedPi?.goods ?? []).map((g) => g.unitPrice).filter((p) => p > 0);
  const invoicedPrices = x.goods.map((g) => g.unitPrice).filter((p) => p > 0);
  const reference = approvedPrices.length === 1 ? approvedPrices[0]! : terms.unitPrice;
  if (reference && invoicedPrices.length === 1) {
    const drift = ((invoicedPrices[0]! - reference) / reference) * 100;
    if (Math.abs(drift) > ctx.policy.tolerances.postTradePriceDriftPercent) {
      findings.push(
        candidate('TBML-POST-PRICE-DRIFT', pid, {
          ...post,
          title: `Invoiced unit price ${drift > 0 ? 'above' : 'below'} the approved proforma by ${Math.abs(drift).toFixed(1)}%`,
          description: `Approved at ${reference}; invoiced at ${invoicedPrices[0]}. Over- or under-invoicing between approval and shipment is a TBML indicator, not a conclusion.`,
          fields: ['unitPrice'],
          observed: [
            { source: 'CASE_HISTORY', label: 'Approved unit price', value: String(reference), applicationVersion: ctx.credit.applicationVersion },
            documentEvidence('Invoiced unit price', String(invoicedPrices[0]), doc),
          ],
          expected: `Within ${ctx.policy.tolerances.postTradePriceDriftPercent}% of the approved price, or explained.`,
          recommendedAction: 'Compliance to review against the approved pricing evidence.',
        }),
      );
    }
  }
  return findings;
}

function examineTransport(ctx: ExaminationContext, transport: PresentedDocument, post: { stage: 'POST_TRADE'; presentationId: string }): CandidateFinding[] {
  const terms = ctx.credit.terms;
  const x = transport.extraction!;
  const pid = post.presentationId;
  const doc = { documentId: transport.documentId, filename: transport.filename, units: transport.units };
  const findings: CandidateFinding[] = [];

  for (const [field, label, lcValue, docValue] of [
    ['portOfLoading', 'Port of loading', terms.portOfLoading, extractedOrNull(x.transaction.portOfLoading)],
    ['portOfDischarge', 'Port of discharge', terms.portOfDischarge, extractedOrNull(x.transaction.portOfDischarge)],
  ] as const) {
    if (!lcValue) continue;
    if (!docValue || !sameText(docValue, lcValue)) {
      findings.push(
        candidate('EXM-TD-PORTS', `${pid}:${field}`, {
          ...post,
          severity: docValue ? 'HIGH' : 'MEDIUM',
          title: docValue ? `${label} differs from the credit` : `${label} could not be read from the transport document`,
          description: docValue ? `Transport document: ${docValue}; credit: ${lcValue}.` : `No ${label.toLowerCase()} was extracted from ${transport.filename}.`,
          fields: [field],
          observed: docValue ? [documentEvidence(label, docValue, doc)] : [],
          expected: `${label} as stated in the credit (UCP 600 art. 20(a)(iii), paraphrased).`,
          recommendedAction: docValue ? 'Seek the applicant\'s waiver, or refuse.' : 'Check the original and record the result.',
        }),
      );
    }
  }

  const shippedRaw = extractedOrNull(x.transaction.shipmentDate);
  const shippedIso = shippedRaw ? parseTradeDate(shippedRaw) : null;
  const latest = parseIsoDate(terms.latestShipmentDate);
  if (!shippedIso) {
    findings.push(
      candidate('EXM-TD-SHIPDATE', `${pid}:unreadable`, {
        ...post,
        category: 'LOW_CONFIDENCE_EXTRACTION',
        severity: 'MEDIUM',
        blocking: true,
        title: 'Shipment date could not be read',
        description: `No on-board date was extracted from ${transport.filename}; late shipment and the presentation period have not been checked.`,
        expected: 'On-board date legible.',
        origin: 'AI_ASSISTED_EXTRACTION',
        recommendedAction: 'Read the on-board notation manually and record the verification.',
      }),
    );
    return findings;
  }
  const shipped = new Date(shippedIso);
  if (latest && shipped.getTime() > latest.getTime() + DAY_MS - 1) {
    findings.push(
      candidate('EXM-TD-SHIPDATE', pid, {
        ...post,
        title: 'Shipped after the latest shipment date',
        description: `Shipped ${shippedIso.slice(0, 10)}; the credit requires shipment by ${terms.latestShipmentDate}.`,
        fields: ['latestShipmentDate'],
        observed: [documentEvidence('Shipment date', shippedRaw!, doc)],
        expected: 'Shipment on or before the latest shipment date.',
        recommendedAction: 'Seek the applicant\'s waiver, or refuse.',
      }),
    );
  }
  const received = new Date(ctx.presentation.receivedAt);
  const deadline = shipped.getTime() + terms.presentationPeriodDays * DAY_MS;
  if (received.getTime() > deadline + DAY_MS - 1) {
    findings.push(
      candidate('EXM-PRESENTATION-PERIOD', `${pid}:period`, {
        ...post,
        title: `Presented more than ${terms.presentationPeriodDays} days after shipment`,
        description: `Shipped ${shippedIso.slice(0, 10)}, received ${ctx.presentation.receivedAt.slice(0, 10)}.`,
        fields: ['presentationPeriodDays'],
        observed: [documentEvidence('Shipment date', shippedRaw!, doc)],
        expected: `Presentation within ${terms.presentationPeriodDays} days of shipment (UCP 600 art. 14(c), paraphrased).`,
        recommendedAction: 'Seek the applicant\'s waiver, or refuse.',
      }),
    );
  }
  return findings;
}
