import type { TradeComplianceAnalysis } from '../compliance/types';
import { parseTradeDate } from '../utils/trade-date';
import {
  DAY_MS,
  amountVariants,
  candidate,
  documentEvidence,
  extractedOrNull,
  formatMoney,
  parseIsoDate,
  sameParty,
  sameText,
  statesQuantity,
  wordOverlap,
  type CandidateFinding,
  type TextUnit,
} from './rule-helpers';
import type { CreditOfRecord, Evidence, Finding, Presentation } from './trade-case.types';
import type { WorkflowPolicy } from './workflow.policy';

/**
 * What a post-shipment application is checked against beyond the credit: the pre-shipment set the bank APPROVED,
 * and the presented documents against one another. Everything here is evidence-based and deterministic: a
 * difference is reported with the two values and where each was read, and a difference with a legitimate
 * explanation (a quantity within tolerance, a heading-level HS refinement, a general description on a transport
 * document, a different shipper the credit does not forbid) is not raised as a violation.
 *
 * Nothing here decides anything. Each finding is a candidate for an officer, classed (see `classifyFinding`) by how
 * much it should hold the case, and every rule is pending the bank's sign-off like all others in the registry.
 */

export interface ApprovedDocument {
  documentType: string;
  filename: string;
  documentId: string;
  version: number;
  extraction: TradeComplianceAnalysis | null;
  units: TextUnit[];
}

export interface VerifiedDocument {
  linkId: string;
  documentId: string;
  documentType: string;
  filename: string;
  extraction: TradeComplianceAnalysis | null;
  units: TextUnit[];
}

export interface CrossVerificationContext {
  credit: CreditOfRecord;
  presentation: Pick<Presentation, 'presentationId' | 'receivedAt'>;
  documents: VerifiedDocument[];
  /** The documents that stood approved at the pre-shipment decision (current versions). */
  approvedDocuments: ApprovedDocument[];
  /** When the pre-shipment request was approved, if known. */
  approvedAt: string | null;
  policy: WorkflowPolicy;
}

// ------------------------------------------------------------------------------------------ facts

/** The values a document states, normalised once so every rule reads the same thing. */
export interface Facts {
  seller: string | null;
  buyer: string | null;
  shipper: string | null;
  consignee: string | null;
  notify: string | null;
  goods: string;
  hsCodes: string[];
  quantity: number | null;
  unit: string | null;
  netWeightKg: number | null;
  grossWeightKg: number | null;
  unitPrice: number | null;
  total: number | null;
  currency: string | null;
  incoterm: string | null;
  origin: string | null;
  destination: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  shipmentDate: string | null;
  documentDate: string | null;
  invoiceNumber: string | null;
  blNumber: string | null;
  container: string | null;
  vessel: string | null;
  lineSum: number | null;
}

const WEIGHT_UNITS: Array<[RegExp, number]> = [
  [/\b(mt|tonne|tonnes|ton|tons|metric ton)\b/i, 1000],
  [/\b(kg|kgs|kilogram|kilograms|kilo|kilos)\b/i, 1],
  [/\b(lb|lbs|pound|pounds)\b/i, 0.45359237],
  [/\b(g|gm|gram|grams)\b/i, 0.001],
];

/** A weight such as "100,000.00 KG" or "1.2 MT" in kilograms; null when it has no unit or no number (never a guess). */
export function weightInKg(raw: string | undefined | null): number | null {
  const text = extractedOrNull(raw);
  if (!text) return null;
  const number = /(\d[\d,]*(?:\.\d+)?)/.exec(text);
  if (!number) return null;
  const value = Number(number[1]!.replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  for (const [pattern, factor] of WEIGHT_UNITS) if (pattern.test(text)) return Math.round(value * factor * 1000) / 1000;
  return null;
}

const digits = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '');

export function factsOf(x: TradeComplianceAnalysis | null): Facts | null {
  if (!x) return null;
  const t = x.transaction;
  const p = t.parties;
  const lines = x.goods ?? [];
  const stated = lines.filter((g) => statesQuantity(g));
  const quantity = stated.length ? stated.reduce((n, g) => n + g.quantity, 0) : null;
  const sumWeights = (pick: (g: (typeof lines)[number]) => string | undefined): number | null => {
    const values = lines.map((g) => weightInKg(pick(g)));
    return values.some((v) => v !== null) ? values.reduce<number>((n, v) => n + (v ?? 0), 0) : null;
  };
  const prices = lines.map((g) => g.unitPrice).filter((v) => v > 0);
  const lineTotals = lines.map((g) => g.totalLineValue).filter((v) => v > 0);
  const issued = extractedOrNull(t.invoiceDate);
  return {
    seller: extractedOrNull(p.seller?.legalName),
    buyer: extractedOrNull(p.buyer?.legalName),
    shipper: extractedOrNull(p.shipper?.legalName),
    consignee: extractedOrNull(p.consignee?.legalName),
    notify: extractedOrNull(p.notifyParty?.legalName),
    goods: lines.map((g) => g.productDescription).filter(Boolean).join(' '),
    hsCodes: [...new Set(lines.map((g) => digits(g.hsCode)).filter((d) => d.length >= 4))],
    quantity,
    unit: extractedOrNull(lines.find((g) => g.unitOfMeasure)?.unitOfMeasure) ?? null,
    netWeightKg: sumWeights((g) => g.netWeight),
    grossWeightKg: sumWeights((g) => g.grossWeight),
    unitPrice: prices.length === 1 ? prices[0]! : null,
    total: t.totalValue > 0 ? t.totalValue : null,
    currency: extractedOrNull(t.currency),
    incoterm: extractedOrNull(t.incoterm),
    origin: extractedOrNull(t.originCountry),
    destination: extractedOrNull(t.destinationCountry),
    portOfLoading: extractedOrNull(t.portOfLoading),
    portOfDischarge: extractedOrNull(t.portOfDischarge),
    shipmentDate: extractedOrNull(t.shipmentDate) ? parseTradeDate(t.shipmentDate!) : null,
    documentDate: issued ? parseTradeDate(issued) : null,
    invoiceNumber: extractedOrNull(t.invoiceNumber),
    blNumber: extractedOrNull(t.billOfLadingNumber),
    container: extractedOrNull(t.containerNumber),
    vessel: extractedOrNull(t.vesselName),
    lineSum: lineTotals.length ? lineTotals.reduce((n, v) => n + v, 0) : null,
  };
}

/** A quantity in a form that can be compared: weights in kilograms, anything else in its own unit; null when the unit is unknown. */
export function comparableQuantity(quantity: number | null, unit: string | null): { value: number; kind: string } | null {
  if (!quantity || !unit) return null;
  const weight = weightInKg(`${quantity} ${unit}`);
  if (weight !== null) return { value: weight, kind: 'WEIGHT' };
  const key = unit.toUpperCase().replace(/[^A-Z]/g, '').replace(/S$/, '');
  return key ? { value: quantity, kind: key === 'PIECE' ? 'PC' : key } : null;
}

const COUNTED_UNITS = new Set(['PCS', 'PIECES', 'SETS', 'SET', 'UNITS', 'UNIT', 'CARTONS', 'CARTON', 'CTNS', 'PAIRS', 'NOS', 'BOXES']);
const countryKey = (s: string | null): string => (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
const sameCountry = (a: string | null, b: string | null): boolean => {
  const ka = countryKey(a);
  const kb = countryKey(b);
  return Boolean(ka && kb && (ka === kb || ka.includes(kb) || kb.includes(ka)));
};
const TO_ORDER = /\b(to\s+order|to\s+the\s+order|order\s+of)\b/i;

// ------------------------------------------------------------------------------------------ the checks

const typeLabel = (t: string): string => t.replace(/_/g, ' ').toLowerCase();

export function crossVerifyPresentation(ctx: CrossVerificationContext): CandidateFinding[] {
  const pid = ctx.presentation.presentationId;
  const post = { stage: 'POST_TRADE' as const, presentationId: pid };
  const terms = ctx.credit.terms;
  const findings: CandidateFinding[] = [];

  const docs = ctx.documents.map((d) => ({ ...d, facts: factsOf(d.extraction) })).filter((d): d is typeof d & { facts: Facts } => d.facts !== null);
  const of = (type: string) => docs.filter((d) => d.documentType === type);
  const invoice = of('COMMERCIAL_INVOICE')[0];
  const transport = of('BILL_OF_LADING')[0];
  const packing = of('PACKING_LIST')[0];
  const origin = of('CERTIFICATE_OF_ORIGIN')[0];
  const insurance = of('INSURANCE_DOCUMENT')[0];

  const approvedPiDoc = ctx.approvedDocuments.find((d) => d.documentType === 'PROFORMA_INVOICE' && d.extraction);
  const approvedPi = factsOf(approvedPiDoc?.extraction ?? null);
  const evidenceOf = (label: string, value: string, d: { documentId: string; filename: string; units: TextUnit[] }, variants?: string[]): Evidence => documentEvidence(label, value, d, variants ?? [value]);
  const approvedEvidence = (label: string, value: string): Evidence => ({ source: 'CASE_HISTORY', label: `Approved: ${label}`, value, applicationVersion: ctx.credit.applicationVersion });
  const approvedDocEvidence = (label: string, value: string): Evidence | null => (approvedPiDoc ? documentEvidence(`Approved proforma: ${label}`, value, approvedPiDoc, [value]) : null);
  const evidence = (...items: Array<Evidence | null>): Evidence[] => items.filter((e): e is Evidence => e !== null);

  // The basis the examination ran on: stated once, so nobody reads a result as more than it is.
  findings.push(
    candidate('EXM-XD-BASIS', `${pid}:basis`, {
      ...post,
      category: 'OPERATIONAL',
      severity: 'INFO',
      blocking: false,
      title: ctx.credit.basis === 'ISSUED_CREDIT' ? `Examined against the issued credit ${ctx.credit.reference}` : `Examined against the approved pre-shipment application (${ctx.credit.reference})`,
      description:
        ctx.credit.basis === 'ISSUED_CREDIT'
          ? `The terms in force on the issued credit were used (application version ${ctx.credit.applicationVersion}).`
          : `No issued credit is recorded for this request, so the approved pre-shipment application (version ${ctx.credit.applicationVersion}) was used as the terms of record. ${ctx.approvedDocuments.length} approved pre-shipment document${ctx.approvedDocuments.length === 1 ? ' was' : 's were'} compared.`,
      expected: 'The bank confirms the terms of record before relying on the examination.',
      recommendedAction: 'None: for the examiner\'s information.',
    }),
  );

  // -------------------------------------------------------------------- goods and HS code
  if (invoice) {
    const f = invoice.facts;
    const doc = invoice;
    const approvedHs = approvedPi?.hsCodes ?? (terms.hsCode ? [digits(terms.hsCode)].filter((d) => d.length >= 4) : []);
    if (f.hsCodes.length && approvedHs.length) {
      const matches = f.hsCodes.every((h) => approvedHs.some((a) => h.slice(0, 6) === a.slice(0, 6)));
      if (!matches) {
        const sameHeading = f.hsCodes.every((h) => approvedHs.some((a) => h.slice(0, 4) === a.slice(0, 4)));
        findings.push(
          candidate('EXM-XD-HS', `${pid}:invoice-vs-approved`, {
            ...post,
            category: 'DOCUMENTARY_DISCREPANCY',
            severity: sameHeading ? 'MEDIUM' : 'HIGH',
            blocking: !sameHeading,
            title: sameHeading ? 'Invoice HS code refines or differs from the approved code within the same heading' : 'Invoice HS code differs from the approved code',
            description: `Invoice: ${f.hsCodes.join(', ')}; approved: ${approvedHs.join(', ')}. ${sameHeading ? 'Same heading, different subheading: a refinement can be legitimate, so it is for the examiner to confirm.' : 'A different heading is a different class of goods; the classification must be explained before the documents are accepted.'}`,
            fields: ['hsCode'],
            observed: evidence(evidenceOf('Invoice HS code', f.hsCodes.join(', '), doc), approvedEvidence('HS code', approvedHs.join(', ')), approvedDocEvidence('HS code', approvedHs[0]!)),
            expected: 'The HS code on the invoice is the one that was approved, or the difference is explained (classification and duty depend on it).',
            recommendedAction: sameHeading ? 'Confirm the refinement with the customer or customs classification.' : 'Ask the customer to explain or correct the classification; compliance to review.',
            customerFixable: true,
          }),
        );
      }
    }
    for (const other of [packing, origin, transport].filter((d): d is NonNullable<typeof d> => Boolean(d))) {
      if (!other.facts.hsCodes.length || !f.hsCodes.length) continue;
      const agree = other.facts.hsCodes.every((h) => f.hsCodes.some((i) => i.slice(0, 6) === h.slice(0, 6)));
      if (!agree) {
        findings.push(
          candidate('EXM-XD-HS', `${pid}:${other.linkId}`, {
            ...post,
            category: 'DOCUMENTARY_DISCREPANCY',
            severity: 'MEDIUM',
            blocking: true,
            title: `HS code on the ${typeLabel(other.documentType)} differs from the invoice`,
            description: `${other.filename}: ${other.facts.hsCodes.join(', ')}; invoice: ${f.hsCodes.join(', ')}. Data in the documents must not conflict (UCP 600 art. 14(d), paraphrased).`,
            fields: ['hsCode'],
            observed: [evidenceOf('Invoice HS code', f.hsCodes.join(', '), invoice), evidenceOf(`${typeLabel(other.documentType)} HS code`, other.facts.hsCodes.join(', '), other)],
            expected: 'The same HS code on every document that states one.',
            recommendedAction: 'Ask the customer which is correct and for the corrected document.',
            customerFixable: true,
          }),
        );
      }
    }

    // Goods description: a transport document may describe goods generally (art. 14(e)); a commercial description that
    // shares almost nothing with the approved one is the case worth an examiner's time.
    const approvedGoods = approvedPi?.goods || terms.goodsDescription || '';
    if (approvedGoods && f.goods) {
      const overlap = wordOverlap(approvedGoods, f.goods);
      if (overlap < 0.4) {
        findings.push(
          candidate('EXM-XD-GOODS', `${pid}:invoice-vs-approved`, {
            ...post,
            category: 'DOCUMENTARY_DISCREPANCY',
            severity: 'MEDIUM',
            blocking: false,
            confidence: Math.round(overlap * 100) / 100,
            title: 'Invoice goods description shares little with the approved goods',
            description: `${Math.round(overlap * 100)}% of the words agree. A word comparison cannot judge whether the goods are the same; an examiner must read both.`,
            fields: ['goodsDescription'],
            observed: evidence(evidenceOf('Invoice goods', f.goods.slice(0, 160), doc), approvedEvidence('Goods', approvedGoods.slice(0, 160))),
            expected: 'The invoiced goods are the approved goods, described consistently.',
            recommendedAction: 'Examiner to compare the descriptions and confirm or raise a discrepancy.',
            customerFixable: true,
          }),
        );
      }
    }
    for (const other of [packing, transport, origin].filter((d): d is NonNullable<typeof d> => Boolean(d))) {
      if (!other.facts.goods || !f.goods) continue;
      const overlap = wordOverlap(f.goods, other.facts.goods);
      if (overlap < 0.3) {
        findings.push(
          candidate('EXM-XD-GOODS', `${pid}:${other.linkId}`, {
            ...post,
            category: 'DOCUMENTARY_DISCREPANCY',
            severity: 'LOW',
            blocking: false,
            confidence: Math.round(overlap * 100) / 100,
            title: `Goods on the ${typeLabel(other.documentType)} may not correspond with the invoice`,
            description: `${Math.round(overlap * 100)}% of the words agree. A transport document may describe the goods in general terms, so this is a warning for the examiner, not a discrepancy.`,
            fields: ['goodsDescription'],
            observed: [evidenceOf('Invoice goods', f.goods.slice(0, 140), invoice), evidenceOf(`${typeLabel(other.documentType)} goods`, other.facts.goods.slice(0, 140), other)],
            expected: 'Goods described consistently, or in general terms on a transport document (UCP 600 art. 14(e), paraphrased).',
            recommendedAction: 'Examiner to compare.',
          }),
        );
      }
    }
  }

  // -------------------------------------------------------------------- quantities and weights across documents
  if (invoice?.facts.quantity) {
    const counted = COUNTED_UNITS.has((invoice.facts.unit ?? '').toUpperCase());
    for (const other of [packing, transport].filter((d): d is NonNullable<typeof d> => Boolean(d))) {
      const a = comparableQuantity(invoice.facts.quantity, invoice.facts.unit);
      const b = comparableQuantity(other.facts.quantity, other.facts.unit);
      // Bales against kilograms, or an unknown unit, cannot be compared: nothing is raised on a comparison that means nothing.
      if (!a || !b || a.kind !== b.kind) continue;
      const q = other.facts.quantity!;
      const base = invoice.facts.quantity;
      const allowed = counted ? 0 : a.value * 0.05;
      if (Math.abs(b.value - a.value) > allowed + 1e-9) {
        findings.push(
          candidate('EXM-XD-QUANTITY', `${pid}:${other.linkId}:quantity`, {
            ...post,
            category: 'DOCUMENTARY_DISCREPANCY',
            severity: 'MEDIUM',
            blocking: true,
            title: `Quantity on the ${typeLabel(other.documentType)} differs from the invoice`,
            description: `${other.filename}: ${q}${other.facts.unit ? ` ${other.facts.unit}` : ''}; invoice: ${base}${invoice.facts.unit ? ` ${invoice.facts.unit}` : ''}${counted ? ' (counted units: no tolerance)' : ' (±5%)'}.`,
            fields: ['quantity'],
            observed: [evidenceOf('Invoiced quantity', String(base), invoice), evidenceOf(`${typeLabel(other.documentType)} quantity`, String(q), other)],
            expected: 'The same quantity on every document, within tolerance (UCP 600 art. 14(d), 30(b), paraphrased).',
            recommendedAction: 'Ask the customer which is correct and for the corrected document.',
            customerFixable: true,
          }),
        );
      }
    }
  }
  if (packing && transport) {
    for (const [label, a, b] of [
      ['Gross weight', packing.facts.grossWeightKg, transport.facts.grossWeightKg],
      ['Net weight', packing.facts.netWeightKg, transport.facts.netWeightKg],
    ] as const) {
      if (!a || !b) continue;
      if (Math.abs(a - b) / Math.max(a, b) > 0.02) {
        findings.push(
          candidate('EXM-XD-QUANTITY', `${pid}:weight:${label}`, {
            ...post,
            category: 'DOCUMENTARY_DISCREPANCY',
            severity: 'MEDIUM',
            blocking: false,
            title: `${label} differs between the packing list and the bill of lading`,
            description: `Packing list ${a} kg; bill of lading ${b} kg (a difference of more than 2%). Weighing differences exist, so this is for the examiner to judge.`,
            fields: ['weight'],
            observed: [evidenceOf(`Packing list ${label.toLowerCase()}`, `${a} kg`, packing), evidenceOf(`Bill of lading ${label.toLowerCase()}`, `${b} kg`, transport)],
            expected: 'Weights that agree within a weighing tolerance.',
            recommendedAction: 'Examiner to confirm; ask the customer if unexplained.',
            customerFixable: true,
          }),
        );
      }
    }
  }

  // -------------------------------------------------------------------- parties
  if (invoice && approvedPi?.seller && invoice.facts.seller && !sameParty(invoice.facts.seller, approvedPi.seller)) {
    findings.push(
      candidate('EXM-XD-PARTIES', `${pid}:seller-vs-approved`, {
        ...post,
        category: 'REGULATORY_CONCERN',
        severity: 'HIGH',
        blocking: true,
        title: 'Invoice seller differs from the seller on the approved proforma',
        description: `Invoice: "${invoice.facts.seller}"; approved proforma: "${approvedPi.seller}". A change of seller between approval and shipment is a trade-compliance and TBML question.`,
        fields: ['seller'],
        observed: evidence(evidenceOf('Invoice seller', invoice.facts.seller, invoice), approvedDocEvidence('Seller', approvedPi.seller)),
        expected: 'The seller that was approved, or a documented change.',
        recommendedAction: 'Ask the customer to explain; compliance to review the new party.',
      }),
    );
  }
  if (invoice && packing?.facts.seller && invoice.facts.seller && !sameParty(packing.facts.seller, invoice.facts.seller)) {
    findings.push(
      candidate('EXM-XD-PARTIES', `${pid}:packing-seller`, {
        ...post,
        category: 'DOCUMENTARY_DISCREPANCY',
        severity: 'MEDIUM',
        blocking: false,
        title: 'Seller on the packing list differs from the invoice',
        description: `Packing list: "${packing.facts.seller}"; invoice: "${invoice.facts.seller}".`,
        fields: ['seller'],
        observed: [evidenceOf('Invoice seller', invoice.facts.seller, invoice), evidenceOf('Packing list seller', packing.facts.seller, packing)],
        expected: 'The same seller on the invoice and the packing list.',
        recommendedAction: 'Ask the customer to confirm or correct.',
        customerFixable: true,
      }),
    );
  }
  if (transport) {
    const shipper = transport.facts.shipper ?? transport.facts.seller;
    if (shipper && !sameParty(shipper, terms.beneficiary.name)) {
      findings.push(
        candidate('EXM-XD-PARTIES', `${pid}:shipper`, {
          ...post,
          category: 'REGULATORY_CONCERN',
          severity: 'MEDIUM',
          blocking: false,
          title: 'Shipper on the bill of lading is not the beneficiary',
          description: `Shipper "${shipper}"; beneficiary "${terms.beneficiary.name}". A third-party shipper is acceptable unless the credit says otherwise (UCP 600 art. 14(k), paraphrased); the examiner confirms the credit allows it.`,
          fields: ['shipper'],
          observed: [evidenceOf('Shipper', shipper, transport)],
          expected: 'The shipper is the beneficiary, or the credit allows another shipper.',
          recommendedAction: 'Examiner to check the credit terms.',
        }),
      );
    }
    const consignee = transport.facts.consignee;
    if (consignee && !TO_ORDER.test(consignee) && !sameParty(consignee, terms.applicant.name) && !/\bbank\b/i.test(consignee)) {
      findings.push(
        candidate('EXM-XD-PARTIES', `${pid}:consignee`, {
          ...post,
          category: 'REGULATORY_CONCERN',
          severity: 'MEDIUM',
          blocking: false,
          title: 'Consignee on the bill of lading is neither the applicant nor to order',
          description: `Consignee "${consignee}"; applicant "${terms.applicant.name}". Goods consigned to a third party need explaining: it can be a legitimate arrangement and it can be a diversion risk.`,
          fields: ['consignee'],
          observed: [evidenceOf('Consignee', consignee, transport)],
          expected: 'Consigned to the applicant, to order, or to a party the credit names.',
          recommendedAction: 'Compliance and trade operations to review the consignee.',
        }),
      );
    }
  }
  if (origin?.facts.seller && !sameParty(origin.facts.seller, terms.beneficiary.name)) {
    findings.push(
      candidate('EXM-XD-PARTIES', `${pid}:origin-exporter`, {
        ...post,
        category: 'DOCUMENTARY_DISCREPANCY',
        severity: 'LOW',
        blocking: false,
        title: 'Exporter on the certificate of origin is not the beneficiary',
        description: `Certificate: "${origin.facts.seller}"; beneficiary: "${terms.beneficiary.name}".`,
        fields: ['exporter'],
        observed: [evidenceOf('Exporter', origin.facts.seller, origin)],
        expected: 'The exporter named is the beneficiary, or the difference is explained.',
        recommendedAction: 'Examiner to compare.',
      }),
    );
  }

  // -------------------------------------------------------------------- value, against the approved proforma
  if (invoice && approvedPi?.total && invoice.facts.total) {
    const total = invoice.facts.total;
    const approvedTotal = approvedPi.total;
    const qtyRatio = invoice.facts.quantity && approvedPi.quantity ? invoice.facts.quantity / approvedPi.quantity : null;
    const valueRatio = total / approvedTotal;
    const explainedByQuantity = qtyRatio !== null && Math.abs(valueRatio - qtyRatio) / qtyRatio <= 0.05;
    const tolerance = Math.max(ctx.policy.tolerances.amountAbsolute, approvedTotal * 0.01);
    if (Math.abs(total - approvedTotal) > tolerance && !explainedByQuantity) {
      findings.push(
        candidate('EXM-XD-VALUE', `${pid}:value`, {
          ...post,
          category: 'DOCUMENTARY_DISCREPANCY',
          severity: 'MEDIUM',
          blocking: false,
          title: `Invoice total differs from the approved proforma by ${Math.abs(((total - approvedTotal) / approvedTotal) * 100).toFixed(1)}%`,
          description: `Invoice ${formatMoney(invoice.facts.currency ?? terms.currency, total)}; approved proforma ${formatMoney(approvedPi.currency ?? terms.currency, approvedTotal)}${qtyRatio !== null ? `; the quantity ratio is ${qtyRatio.toFixed(3)} and the value ratio ${valueRatio.toFixed(3)}, so the difference is not explained by the quantity` : '; the quantity could not be compared'}. A change of value between approval and shipment may be legitimate; it needs an explanation.`,
          fields: ['totalValue'],
          observed: evidence(evidenceOf('Invoice total', formatMoney(invoice.facts.currency ?? terms.currency, total), invoice, amountVariants(total)), approvedDocEvidence('Total', formatMoney(approvedPi.currency ?? terms.currency, approvedTotal))),
          expected: 'The invoice value follows the approved proforma, or the change is explained (quantity, price revision, freight).',
          recommendedAction: 'Ask the customer to explain the change; compliance to review if unexplained.',
          customerFixable: true,
        }),
      );
    }
    if (invoice.facts.currency && approvedPi.currency && invoice.facts.currency.toUpperCase() !== approvedPi.currency.toUpperCase()) {
      findings.push(
        candidate('EXM-XD-VALUE', `${pid}:currency`, {
          ...post,
          category: 'DOCUMENTARY_DISCREPANCY',
          severity: 'MEDIUM',
          blocking: false,
          title: 'Invoice currency differs from the approved proforma',
          description: `Invoice in ${invoice.facts.currency}; approved proforma in ${approvedPi.currency}.`,
          fields: ['currency'],
          observed: evidence(evidenceOf('Invoice currency', invoice.facts.currency, invoice), approvedDocEvidence('Currency', approvedPi.currency)),
          expected: 'The approved currency, or an explained change.',
          recommendedAction: 'Ask the customer to explain.',
          customerFixable: true,
        }),
      );
    }
  }
  if (invoice?.facts.total && invoice.facts.lineSum && Math.abs(invoice.facts.total - invoice.facts.lineSum) > Math.max(ctx.policy.tolerances.amountAbsolute, invoice.facts.total * 0.001)) {
    findings.push(
      candidate('EXM-XD-VALUE', `${pid}:arithmetic`, {
        ...post,
        category: 'DOCUMENTARY_DISCREPANCY',
        severity: 'MEDIUM',
        blocking: false,
        title: 'Invoice total does not equal the sum of its lines',
        description: `Lines add up to ${formatMoney(invoice.facts.currency ?? terms.currency, invoice.facts.lineSum)}; the total is ${formatMoney(invoice.facts.currency ?? terms.currency, invoice.facts.total)}. Freight, insurance or discount lines may explain it; the examiner confirms.`,
        fields: ['totalValue'],
        observed: [evidenceOf('Invoice total', formatMoney(invoice.facts.currency ?? terms.currency, invoice.facts.total), invoice, amountVariants(invoice.facts.total))],
        expected: 'A total that follows from the lines, or charges that explain the difference.',
        recommendedAction: 'Examiner to check the arithmetic against the original.',
        customerFixable: true,
      }),
    );
  }

  // -------------------------------------------------------------------- origin, destination, ports
  const approvedOrigin = approvedPi?.origin ?? extractedOrNull(terms.countryOfOrigin);
  for (const doc of [invoice, origin].filter((d): d is NonNullable<typeof d> => Boolean(d))) {
    if (doc.facts.origin && approvedOrigin && !sameCountry(doc.facts.origin, approvedOrigin)) {
      findings.push(
        candidate('EXM-XD-ROUTE', `${pid}:${doc.linkId}:origin`, {
          ...post,
          category: 'REGULATORY_CONCERN',
          severity: 'HIGH',
          blocking: true,
          title: `Country of origin on the ${typeLabel(doc.documentType)} differs from the approved origin`,
          description: `${doc.filename}: ${doc.facts.origin}; approved: ${approvedOrigin}. A change of origin changes the sanctions, tariff and import-policy position.`,
          fields: ['countryOfOrigin'],
          observed: evidence(evidenceOf('Country of origin', doc.facts.origin, doc), approvedEvidence('Country of origin', approvedOrigin)),
          expected: 'The approved country of origin.',
          recommendedAction: 'Ask the customer to explain; compliance to review the origin.',
        }),
      );
    }
  }
  if (invoice?.facts.origin && origin?.facts.origin && !sameCountry(invoice.facts.origin, origin.facts.origin)) {
    findings.push(
      candidate('EXM-XD-ROUTE', `${pid}:origin-vs-invoice`, {
        ...post,
        category: 'DOCUMENTARY_DISCREPANCY',
        severity: 'HIGH',
        blocking: true,
        title: 'Origin on the certificate differs from the invoice',
        description: `Certificate: ${origin.facts.origin}; invoice: ${invoice.facts.origin}.`,
        fields: ['countryOfOrigin'],
        observed: [evidenceOf('Invoice origin', invoice.facts.origin, invoice), evidenceOf('Certificate origin', origin.facts.origin, origin)],
        expected: 'The same origin on both documents.',
        recommendedAction: 'Ask the customer for the corrected document.',
        customerFixable: true,
      }),
    );
  }
  if (transport) {
    for (const [label, tdValue, otherDoc, otherValue] of [
      ['Port of loading', transport.facts.portOfLoading, packing, packing?.facts.portOfLoading ?? null],
      ['Port of discharge', transport.facts.portOfDischarge, packing, packing?.facts.portOfDischarge ?? null],
      ['Port of loading', transport.facts.portOfLoading, invoice, invoice?.facts.portOfLoading ?? null],
      ['Port of discharge', transport.facts.portOfDischarge, invoice, invoice?.facts.portOfDischarge ?? null],
    ] as const) {
      if (!tdValue || !otherValue || !otherDoc || sameText(tdValue, otherValue)) continue;
      findings.push(
        candidate('EXM-XD-ROUTE', `${pid}:${label}:${otherDoc.linkId}`, {
          ...post,
          category: 'DOCUMENTARY_DISCREPANCY',
          severity: 'MEDIUM',
          blocking: true,
          title: `${label} on the bill of lading differs from the ${typeLabel(otherDoc.documentType)}`,
          description: `Bill of lading: ${tdValue}; ${typeLabel(otherDoc.documentType)}: ${otherValue}.`,
          fields: [label === 'Port of loading' ? 'portOfLoading' : 'portOfDischarge'],
          observed: [evidenceOf(label, tdValue, transport), evidenceOf(`${typeLabel(otherDoc.documentType)} ${label.toLowerCase()}`, otherValue, otherDoc)],
          expected: 'The same port on every document that states one.',
          recommendedAction: 'Ask the customer for the corrected document.',
          customerFixable: true,
        }),
      );
    }
    const approvedDestination = extractedOrNull(terms.applicant.country);
    const dischargeCountry = /,\s*([A-Za-z .]+)$/.exec(transport.facts.portOfDischarge ?? '')?.[1] ?? null;
    if (dischargeCountry && approvedDestination && !sameCountry(dischargeCountry, approvedDestination)) {
      findings.push(
        candidate('EXM-XD-ROUTE', `${pid}:destination`, {
          ...post,
          category: 'REGULATORY_CONCERN',
          severity: 'MEDIUM',
          blocking: false,
          title: 'Port of discharge is in a country other than the applicant\'s',
          description: `Discharge "${transport.facts.portOfDischarge}"; the applicant is in ${approvedDestination}. Discharge in a third country is a diversion or re-export indicator, and may be legitimate transhipment.`,
          fields: ['portOfDischarge'],
          observed: [evidenceOf('Port of discharge', transport.facts.portOfDischarge!, transport)],
          expected: 'Discharge in the destination country, or a documented transhipment.',
          recommendedAction: 'Compliance and trade operations to review the routing.',
        }),
      );
    }
  }

  // -------------------------------------------------------------------- references between documents
  if (invoice?.facts.invoiceNumber) {
    for (const other of [packing, origin, insurance].filter((d): d is NonNullable<typeof d> => Boolean(d))) {
      const ref = other.facts.invoiceNumber;
      if (ref && !sameText(ref, invoice.facts.invoiceNumber)) {
        findings.push(
          candidate('EXM-XD-REFERENCE', `${pid}:${other.linkId}:invoice-ref`, {
            ...post,
            category: 'DOCUMENTARY_DISCREPANCY',
            severity: 'MEDIUM',
            blocking: true,
            title: `The ${typeLabel(other.documentType)} refers to a different invoice number`,
            description: `${other.filename}: invoice ${ref}; the presented invoice is ${invoice.facts.invoiceNumber}.`,
            fields: ['invoiceNumber'],
            observed: [evidenceOf('Invoice number', invoice.facts.invoiceNumber, invoice), evidenceOf(`${typeLabel(other.documentType)} invoice reference`, ref, other)],
            expected: 'Documents refer to the invoice that is presented.',
            recommendedAction: 'Ask the customer for the corrected document, or the missing invoice.',
            customerFixable: true,
          }),
        );
      }
    }
  }

  // -------------------------------------------------------------------- insurance (CIF / CIP)
  const incoterm = (invoice?.facts.incoterm ?? terms.incoterm ?? '').toString().toUpperCase();
  if (insurance && invoice?.facts.total && /^(CIF|CIP)/.test(incoterm)) {
    const insured = insurance.facts.total;
    if (insured && insured < invoice.facts.total * 1.1 - 0.005) {
      findings.push(
        candidate('EXM-XD-INSURANCE', `${pid}:cover`, {
          ...post,
          category: 'DOCUMENTARY_DISCREPANCY',
          severity: 'MEDIUM',
          blocking: false,
          title: 'Insured amount is below 110% of the invoice value',
          description: `Insured ${formatMoney(insurance.facts.currency ?? terms.currency, insured)}; 110% of the invoice is ${formatMoney(invoice.facts.currency ?? terms.currency, invoice.facts.total * 1.1)} (${incoterm} sale). The examiner confirms what the credit requires.`,
          fields: ['insuredAmount'],
          observed: [evidenceOf('Insured amount', formatMoney(insurance.facts.currency ?? terms.currency, insured), insurance, amountVariants(insured)), evidenceOf('Invoice total', formatMoney(invoice.facts.currency ?? terms.currency, invoice.facts.total), invoice, amountVariants(invoice.facts.total))],
          expected: 'Cover of at least 110% of the value (UCP 600 art. 28(f)(ii), paraphrased), unless the credit says otherwise.',
          recommendedAction: 'Examiner to check the credit and the policy.',
          customerFixable: true,
        }),
      );
    }
  }

  // -------------------------------------------------------------------- dates
  const approvedAt = parseIsoDate(ctx.approvedAt);
  const received = parseIsoDate(ctx.presentation.receivedAt);
  if (transport?.facts.shipmentDate && approvedAt && new Date(transport.facts.shipmentDate).getTime() < approvedAt.getTime() - DAY_MS) {
    findings.push(
      candidate('EXM-XD-DATES', `${pid}:shipped-before-approval`, {
        ...post,
        category: 'REGULATORY_CONCERN',
        severity: 'MEDIUM',
        blocking: false,
        title: 'Shipped before the request was approved',
        description: `On board ${transport.facts.shipmentDate.slice(0, 10)}; approved ${approvedAt.toISOString().slice(0, 10)}. Shipment before authorisation can be legitimate for an advance shipment and is also a back-dating indicator.`,
        fields: ['shipmentDate'],
        observed: [evidenceOf('Shipment date', transport.facts.shipmentDate.slice(0, 10), transport, [transport.facts.shipmentDate.slice(0, 10)])],
        expected: 'Shipment after approval, or an explanation.',
        recommendedAction: 'Ask the customer to explain; compliance to note.',
      }),
    );
  }
  if (invoice?.facts.documentDate && transport?.facts.shipmentDate && new Date(invoice.facts.documentDate).getTime() > new Date(transport.facts.shipmentDate).getTime() + 30 * DAY_MS) {
    findings.push(
      candidate('EXM-XD-DATES', `${pid}:invoice-late`, {
        ...post,
        category: 'DOCUMENTARY_DISCREPANCY',
        severity: 'LOW',
        blocking: false,
        title: 'Invoice is dated long after shipment',
        description: `Invoice ${invoice.facts.documentDate.slice(0, 10)}; on board ${transport.facts.shipmentDate.slice(0, 10)}.`,
        fields: ['invoiceDate'],
        observed: [evidenceOf('Invoice date', invoice.facts.documentDate.slice(0, 10), invoice, [invoice.facts.documentDate.slice(0, 10)])],
        expected: 'An invoice dated around shipment.',
        recommendedAction: 'Examiner to confirm.',
      }),
    );
  }
  for (const doc of docs) {
    const dated = doc.facts.documentDate;
    if (dated && received && new Date(dated).getTime() > received.getTime() + DAY_MS) {
      findings.push(
        candidate('EXM-XD-DATES', `${pid}:${doc.linkId}:future`, {
          ...post,
          category: 'DOCUMENTARY_DISCREPANCY',
          severity: 'MEDIUM',
          blocking: false,
          title: `${doc.filename} is dated after it was presented`,
          description: `Dated ${dated.slice(0, 10)}; presented ${received.toISOString().slice(0, 10)}.`,
          fields: ['documentDate'],
          observed: [evidenceOf('Document date', dated.slice(0, 10), doc, [dated.slice(0, 10)])],
          expected: 'A document dated on or before its presentation.',
          recommendedAction: 'Ask the customer to check the date.',
          customerFixable: true,
        }),
      );
    }
  }

  // -------------------------------------------------------------------- completeness of what was presented
  // A particular counts as missing only when the reader did not find it AND the document's own text carries no label for
  // it: a limit of the reader is not a gap in the document, and nothing is flagged on the reader's failure alone.
  const labelled: Record<string, Array<[string, (f: Facts) => unknown, RegExp]>> = {
    COMMERCIAL_INVOICE: [
      ['invoice number', (f) => f.invoiceNumber, /invoice\s*(no|number|#)/i],
      ['invoice date', (f) => f.documentDate, /\bdate\b/i],
      ['total', (f) => f.total, /\btotal\b/i],
    ],
    BILL_OF_LADING: [
      ['bill of lading number', (f) => f.blNumber, /(b\/?l|bill of lading)\s*(no|number|#)/i],
      ['on-board date', (f) => f.shipmentDate, /on\s*board|shipped/i],
      ['port of loading', (f) => f.portOfLoading, /port of loading|loading port/i],
      ['port of discharge', (f) => f.portOfDischarge, /port of discharge|discharge port/i],
    ],
    PACKING_LIST: [['quantity or packages', (f) => f.quantity ?? f.grossWeightKg ?? f.netWeightKg, /packages|bales|cartons|pallets|net weight|gross weight|quantity|pcs|pieces/i]],
  };
  for (const doc of docs) {
    const text = doc.units.map((u) => u.text).join('\n');
    const missing = (labelled[doc.documentType] ?? []).filter(([, get, label]) => (get(doc.facts) === null || get(doc.facts) === undefined) && !label.test(text)).map(([name]) => name);
    if (missing.length) {
      findings.push(
        candidate('EXM-XD-COMPLETE', `${pid}:${doc.linkId}:complete`, {
          ...post,
          category: 'DOCUMENT_QUALITY',
          severity: 'LOW',
          blocking: false,
          title: `${doc.filename} appears to be missing ${missing.join(', ')}`,
          description: `Neither the reader nor the text of this ${typeLabel(doc.documentType)} shows ${missing.join(', ')}. It may be in a form the reader cannot extract (a stamp, a scan): nothing has been assumed.`,
          fields: ['documentCompleteness'],
          observed: [],
          expected: 'The particulars a document of this kind carries.',
          recommendedAction: 'Examiner to check the original; ask the customer for a complete copy if the particulars are missing.',
          customerFixable: true,
        }),
      );
    }
  }
  return dedupe(findings);
}

function dedupe(findings: CandidateFinding[]): CandidateFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true)));
}

// ------------------------------------------------------------------------------------------ classes

export type FindingClass = 'BLOCKING_DISCREPANCY' | 'NON_BLOCKING_DISCREPANCY' | 'WARNING' | 'INFORMATION';

export const FINDING_CLASS_LABELS: Record<FindingClass, string> = {
  BLOCKING_DISCREPANCY: 'Blocking discrepancy',
  NON_BLOCKING_DISCREPANCY: 'Non-blocking discrepancy',
  WARNING: 'Warning',
  INFORMATION: 'Information',
};

const DISCREPANCY_CATEGORIES = new Set(['DOCUMENTARY_DISCREPANCY', 'DATA_INCONSISTENCY', 'MISSING_INFORMATION', 'LC_TERM_ISSUE']);

/**
 * How much a finding should hold the case. Derived, never stored, so it follows the finding's severity and blocking
 * flag if either changes: a blocking finding holds the case; a documentary discrepancy that does not block is
 * recorded for the decision; everything else that is not merely informative is a warning for the examiner.
 */
export function classifyFinding(f: Pick<Finding, 'blocking' | 'severity' | 'category'>): FindingClass {
  if (f.severity === 'INFO') return 'INFORMATION';
  if (f.blocking) return 'BLOCKING_DISCREPANCY';
  if (DISCREPANCY_CATEGORIES.has(f.category)) return 'NON_BLOCKING_DISCREPANCY';
  return 'WARNING';
}

// ------------------------------------------------------------------------------------------ comparison table

export type ComparisonStatus = 'MATCH' | 'DIFFERENT' | 'SINGLE_SOURCE' | 'NOT_STATED';

export interface ComparisonRow {
  field: string;
  label: string;
  /** What the approved set says: the credit's terms and the approved proforma invoice. */
  approved: Array<{ source: string; value: string }>;
  /** What each presented document says. */
  presented: Array<{ documentType: string; filename: string; value: string }>;
  status: ComparisonStatus;
}

const numberIn = (s: string): number | null => {
  const m = /(\d[\d,]*(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]!.replace(/,/g, '')) : null;
};
const within = (a: string, b: string, tolerance: number): boolean => {
  const x = numberIn(a);
  const y = numberIn(b);
  if (x === null || y === null) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return Math.abs(x - y) <= Math.max(x, y) * tolerance + 1e-9;
};
const unitOf = (s: string): string => s.replace(/[\d,.\s]+/, '').trim();
/** Two quantities such as "100000 KG" and "100 MT": compared in kilograms when both are weights, in the unit when it is the same, otherwise not at all. */
const sameUnitWithin = (a: string, b: string, tolerance: number): boolean | null => {
  const qa = comparableQuantity(numberIn(a), unitOf(a) || null);
  const qb = comparableQuantity(numberIn(b), unitOf(b) || null);
  if (!qa || !qb || qa.kind !== qb.kind) return null;
  return Math.abs(qa.value - qb.value) <= Math.max(qa.value, qb.value) * tolerance + 1e-9;
};
const hsAgree = (a: string, b: string): boolean => {
  const sa = a.split(/[,\s]+/).map(digits).filter((d) => d.length >= 4);
  const sb = b.split(/[,\s]+/).map(digits).filter((d) => d.length >= 4);
  if (!sa.length || !sb.length) return true;
  return sa.every((x) => sb.some((y) => x.slice(0, 6) === y.slice(0, 6))) && sb.every((y) => sa.some((x) => x.slice(0, 6) === y.slice(0, 6)));
};

/**
 * The field-by-field view the officer reads first: the same particular as the approved set states it and as each
 * presented document states it, with whether they agree. It reads the same extracted values the rules read, applies
 * the same notion of "the same" (a party, a port, a quantity within tolerance), and never decides: a difference here
 * is a prompt to look, and the rules above say which differences are discrepancies.
 */
export function buildComparison(ctx: { credit: CreditOfRecord; approvedDocuments: ApprovedDocument[]; documents: VerifiedDocument[] }): ComparisonRow[] {
  const terms = ctx.credit.terms;
  const pi = factsOf(ctx.approvedDocuments.find((d) => d.documentType === 'PROFORMA_INVOICE' && d.extraction)?.extraction ?? null);
  const presented = ctx.documents.map((d) => ({ doc: d, facts: factsOf(d.extraction) })).filter((p): p is { doc: VerifiedDocument; facts: Facts } => p.facts !== null);
  const money = (currency: string | null, n: number | null | undefined) => (n && n > 0 ? formatMoney(currency ?? terms.currency, n) : null);
  const qty = (n: number | null | undefined, unit: string | null | undefined) => (n && n > 0 ? `${n}${unit ? ` ${unit}` : ''}` : null);
  const defs: Array<{
    field: string;
    label: string;
    approved: Array<[string, string | null | undefined]>;
    pick: (f: Facts, type: string) => string | null;
    /** true / false, or null when the two cannot be compared (different units, say). */
    equal: (a: string, b: string) => boolean | null;
  }> = [
    { field: 'seller', label: 'Seller / beneficiary', approved: [['Credit beneficiary', terms.beneficiary.name], ['Approved proforma seller', pi?.seller]], pick: (f, t) => (t === 'BILL_OF_LADING' ? f.shipper ?? f.seller : f.seller), equal: sameParty },
    { field: 'buyer', label: 'Buyer / applicant', approved: [['Credit applicant', terms.applicant.name], ['Approved proforma buyer', pi?.buyer]], pick: (f, t) => (t === 'BILL_OF_LADING' ? f.consignee : f.buyer), equal: (a, b) => sameParty(a, b) || TO_ORDER.test(a) || TO_ORDER.test(b) },
    { field: 'goods', label: 'Goods description', approved: [['Credit', terms.goodsDescription], ['Approved proforma', pi?.goods]], pick: (f) => (f.goods ? f.goods.slice(0, 120) : null), equal: (a, b) => wordOverlap(a, b) >= 0.4 },
    { field: 'hsCode', label: 'HS code', approved: [['Credit', terms.hsCode], ['Approved proforma', pi?.hsCodes.join(', ')]], pick: (f) => (f.hsCodes.length ? f.hsCodes.join(', ') : null), equal: hsAgree },
    { field: 'quantity', label: 'Quantity', approved: [['Credit', qty(terms.quantity, terms.unitOfMeasure)], ['Approved proforma', qty(pi?.quantity, pi?.unit)]], pick: (f) => qty(f.quantity, f.unit), equal: (a, b) => sameUnitWithin(a, b, COUNTED_UNITS.has((terms.unitOfMeasure ?? '').toUpperCase()) ? 0 : 0.05) },
    { field: 'grossWeight', label: 'Gross weight (kg)', approved: [], pick: (f) => (f.grossWeightKg ? String(f.grossWeightKg) : null), equal: (a, b) => within(a, b, 0.02) },
    { field: 'netWeight', label: 'Net weight (kg)', approved: [], pick: (f) => (f.netWeightKg ? String(f.netWeightKg) : null), equal: (a, b) => within(a, b, 0.02) },
    { field: 'unitPrice', label: 'Unit price', approved: [['Credit', terms.unitPrice ? String(terms.unitPrice) : null], ['Approved proforma', pi?.unitPrice ? String(pi.unitPrice) : null]], pick: (f) => (f.unitPrice ? String(f.unitPrice) : null), equal: (a, b) => within(a, b, 0.01) },
    { field: 'total', label: 'Total value', approved: [['Credit amount', money(terms.currency, terms.amount)], ['Approved proforma', money(pi?.currency ?? null, pi?.total)]], pick: (f, t) => (t === 'COMMERCIAL_INVOICE' ? money(f.currency, f.total) : null), equal: (a, b) => within(a, b, 0.01) },
    { field: 'currency', label: 'Currency', approved: [['Credit', terms.currency], ['Approved proforma', pi?.currency]], pick: (f, t) => (t === 'COMMERCIAL_INVOICE' ? f.currency : null), equal: (a, b) => a.toUpperCase() === b.toUpperCase() },
    { field: 'incoterm', label: 'Incoterm', approved: [['Credit', terms.incoterm ? String(terms.incoterm) : null], ['Approved proforma', pi?.incoterm]], pick: (f, t) => (t === 'COMMERCIAL_INVOICE' ? f.incoterm : null), equal: (a, b) => a.toUpperCase().slice(0, 3) === b.toUpperCase().slice(0, 3) },
    { field: 'origin', label: 'Country of origin', approved: [['Credit', terms.countryOfOrigin], ['Approved proforma', pi?.origin]], pick: (f) => f.origin, equal: sameCountry },
    { field: 'portOfLoading', label: 'Port of loading', approved: [['Credit', terms.portOfLoading], ['Approved proforma', pi?.portOfLoading]], pick: (f) => f.portOfLoading, equal: sameText },
    { field: 'portOfDischarge', label: 'Port of discharge', approved: [['Credit', terms.portOfDischarge], ['Approved proforma', pi?.portOfDischarge]], pick: (f) => f.portOfDischarge, equal: sameText },
    { field: 'invoiceNumber', label: 'Invoice number', approved: [], pick: (f, t) => (t === 'BILL_OF_LADING' ? null : f.invoiceNumber), equal: sameText },
    { field: 'blNumber', label: 'Bill of lading number', approved: [], pick: (f, t) => (t === 'BILL_OF_LADING' ? f.blNumber : null), equal: sameText },
    { field: 'vessel', label: 'Vessel', approved: [], pick: (f) => f.vessel, equal: sameText },
    { field: 'container', label: 'Container', approved: [], pick: (f) => f.container, equal: sameText },
  ];

  const rows: ComparisonRow[] = defs.map((d) => {
    const approved = d.approved.filter((a): a is [string, string] => Boolean(a[1])).map(([source, value]) => ({ source, value }));
    const seen = presented
      .map(({ doc, facts }) => ({ documentType: doc.documentType, filename: doc.filename, value: d.pick(facts, doc.documentType) }))
      .filter((p): p is { documentType: string; filename: string; value: string } => Boolean(p.value));
    const values = [...approved.map((a) => a.value), ...seen.map((s) => s.value)];
    let status: ComparisonStatus = 'NOT_STATED';
    if (values.length === 1) status = 'SINGLE_SOURCE';
    else if (values.length > 1) {
      const verdicts: Array<boolean | null> = [];
      values.forEach((a, i) => values.forEach((b, j) => { if (i < j) verdicts.push(d.equal(a, b)); }));
      status = verdicts.includes(false) ? 'DIFFERENT' : verdicts.includes(true) ? 'MATCH' : 'SINGLE_SOURCE';
    }
    return { field: d.field, label: d.label, approved, presented: seen, status };
  });

  // The shipment date is compared with the credit's latest date, not with another document.
  const shipped = presented.find((p) => p.doc.documentType === 'BILL_OF_LADING' && p.facts.shipmentDate);
  const latest = parseIsoDate(terms.latestShipmentDate);
  rows.push({
    field: 'shipmentDate',
    label: 'Shipment (on-board) date',
    approved: terms.latestShipmentDate ? [{ source: 'Credit: latest shipment date', value: terms.latestShipmentDate }] : [],
    presented: shipped ? [{ documentType: shipped.doc.documentType, filename: shipped.doc.filename, value: shipped.facts.shipmentDate!.slice(0, 10) }] : [],
    status: !shipped ? 'NOT_STATED' : !latest ? 'SINGLE_SOURCE' : new Date(shipped.facts.shipmentDate!).getTime() > latest.getTime() + DAY_MS - 1 ? 'DIFFERENT' : 'MATCH',
  });
  return rows;
}
