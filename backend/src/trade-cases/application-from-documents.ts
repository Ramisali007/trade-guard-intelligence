import type { TradeComplianceAnalysis } from '../compliance/types';
import { extractedOrNull, statesQuantity } from './rule-helpers';
import type { LcApplicationData, TradeCase } from './trade-case.types';

/**
 * A request that arrives as documents only carries no typed application. The fields the analysis
 * read from those documents fill the blanks, so the same pre-trade rules (completeness, sanctions
 * screening, jurisdictions, regulatory checks) run on what the documents actually say. Only blank
 * fields are filled, nothing a person entered is overwritten, and a value the documents do not
 * state stays blank, which the completeness rule then reports as missing.
 */

/**
 * Whether the customer sent documents and typed nothing about the deal: the first application
 * version states no amount, beneficiary, goods or proforma invoice number. Decided from the case's
 * own first version, so it holds for every such case, however it was created.
 */
export function isDocumentsOnly(c: Pick<TradeCase, 'applicationVersions'>): boolean {
  const first = c.applicationVersions[0]?.data;
  return !first || (first.amount === null && !first.beneficiary.name && !first.goodsDescription && !first.proformaInvoiceNumber);
}

export type ApplicationFill = Partial<Omit<LcApplicationData, 'applicant' | 'beneficiary'>> & {
  applicant?: Partial<LcApplicationData['applicant']>;
  beneficiary?: Partial<LcApplicationData['beneficiary']>;
};

const positive = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

/** A date as written on a document (31.01.2027, 31/01/2027, 2027-01-31, 31 January 2027) as YYYY-MM-DD. */
function isoDate(value: unknown): string | null {
  const text = extractedOrNull(value)?.trim();
  if (!text) return null;
  // Day first, as trade documents in Pakistan write it; a day or month out of range is not a date.
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  if (dmy) {
    const [day, month, year] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? parsed.toISOString().slice(0, 10) : null;
  }
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/**
 * What one analyzed document states, in application terms. Anything it does not state is left out.
 * The credit's own terms (expiry, latest shipment, partial shipment, documents required) are taken only
 * from the transaction details form: the "validity" on a proforma invoice is the supplier's offer, not the credit.
 */
export function fieldsFromAnalysis(x: TradeComplianceAnalysis, documentType?: string): ApplicationFill {
  const t = x.transaction;
  const fill: ApplicationFill = {};

  const buyer = x.transaction.parties.buyer;
  const seller = x.transaction.parties.seller;
  const applicant: ApplicationFill['applicant'] = {};
  const beneficiary: ApplicationFill['beneficiary'] = {};
  const buyerName = extractedOrNull(buyer?.legalName);
  const sellerName = extractedOrNull(seller?.legalName);
  if (buyerName) applicant.name = buyerName;
  if (extractedOrNull(buyer?.address)) applicant.address = extractedOrNull(buyer?.address)!;
  if (extractedOrNull(buyer?.country)) applicant.country = extractedOrNull(buyer?.country)!;
  if (sellerName) beneficiary.name = sellerName;
  if (extractedOrNull(seller?.address)) beneficiary.address = extractedOrNull(seller?.address)!;
  if (extractedOrNull(seller?.country)) beneficiary.country = extractedOrNull(seller?.country)!;
  if (Object.keys(applicant).length) fill.applicant = applicant;
  if (Object.keys(beneficiary).length) fill.beneficiary = beneficiary;

  const piNumber = extractedOrNull(x.documentClassification.number) ?? extractedOrNull(t.proformaInvoiceNumber);
  if (piNumber) fill.proformaInvoiceNumber = piNumber;
  const currency = extractedOrNull(t.currency);
  if (currency && /^[A-Za-z]{3}$/.test(currency)) fill.currency = currency.toUpperCase();
  const total = positive(t.totalValue);
  if (total !== null) fill.amount = total;
  // "CFR Karachi" states the term and its named place together.
  const incoterm = /^([A-Za-z]{3})\b[\s,:-]*(.*)$/.exec(extractedOrNull(t.incoterm) ?? '');
  if (incoterm) {
    fill.incoterm = incoterm[1]!.toUpperCase();
    if (incoterm[2]!.trim()) fill.namedPlace = incoterm[2]!.trim();
  }
  if (extractedOrNull(t.originCountry)) fill.countryOfOrigin = extractedOrNull(t.originCountry)!;
  if (extractedOrNull(t.portOfLoading)) fill.portOfLoading = extractedOrNull(t.portOfLoading)!;
  if (extractedOrNull(t.portOfDischarge)) fill.portOfDischarge = extractedOrNull(t.portOfDischarge)!;

  const terms = (extractedOrNull(t.paymentTerms) ?? '').toLowerCase();
  if (/sight|advance|cash/.test(terms)) fill.paymentTerms = 'SIGHT';
  else if (/usance|days|deferred|\bnet\b/.test(terms)) {
    fill.paymentTerms = 'USANCE';
    const days = /(\d{1,3})\s*days?/.exec(terms);
    if (days) fill.usanceDays = Number(days[1]);
  }

  const lines = x.goods.filter(statesQuantity);
  const described = x.goods.map((g) => extractedOrNull(g.productDescription)).filter((d): d is string => d !== null);
  if (described.length) fill.goodsDescription = described.slice(0, 3).join('; ').slice(0, 500);
  const hs = x.goods.map((g) => extractedOrNull(g.hsCode)).find((h): h is string => h !== null);
  if (hs) fill.hsCode = hs;
  if (lines.length) {
    fill.quantity = lines.reduce((sum, g) => sum + g.quantity, 0);
    const units = [...new Set(lines.map((g) => extractedOrNull(g.unitOfMeasure)).filter((u): u is string => u !== null))];
    if (units.length === 1) fill.unitOfMeasure = units[0]!;
    const prices = [...new Set(lines.map((g) => positive(g.unitPrice)).filter((p): p is number => p !== null))];
    if (prices.length === 1) fill.unitPrice = prices[0]!;
  }

  // A transaction details form (or a draft credit) states the credit's own dates and conditions.
  const lc = documentType === 'LC_APPLICATION_FORM' ? x.letterOfCredit : undefined;
  if (lc) {
    const expiry = isoDate(lc.expiryDate);
    if (expiry) fill.expiryDate = expiry;
    const shipment = isoDate(lc.latestShipmentDate);
    if (shipment) fill.latestShipmentDate = shipment;
    if (lc.partialShipmentAllowed !== undefined) fill.partialShipments = lc.partialShipmentAllowed ? 'ALLOWED' : 'NOT_ALLOWED';
    if (lc.transshipmentAllowed !== undefined) fill.transshipment = lc.transshipmentAllowed ? 'ALLOWED' : 'NOT_ALLOWED';
    // "Full set of clean on board bills of lading..." and the like, as the document types the bank examines.
    const wanted = new Set<LcApplicationData['requiredDocuments'][number]>();
    for (const line of lc.requiredDocuments ?? []) {
      const t = line.toLowerCase();
      if (/invoice/.test(t)) wanted.add('COMMERCIAL_INVOICE');
      if (/bills? of lading|\bb\/l\b|transport document|airway/.test(t)) wanted.add('BILL_OF_LADING');
      if (/packing/.test(t)) wanted.add('PACKING_LIST');
      if (/insurance/.test(t)) wanted.add('INSURANCE_DOCUMENT');
      if (/origin/.test(t)) wanted.add('CERTIFICATE_OF_ORIGIN');
      if (/inspection|quality|phytosanitary/.test(t)) wanted.add('INSPECTION_CERTIFICATE');
    }
    if (wanted.size > 0) fill.requiredDocuments = [...wanted];
  }
  return fill;
}

const isBlank = (value: unknown): boolean => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

/**
 * The fields of `fill` that are still blank on `current`. Defaults that are not a person's entry
 * (tolerance 0, presentation period 21) are never touched.
 */
export function blanksToFill(current: LcApplicationData, fill: ApplicationFill): ApplicationFill {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fill)) {
    if (key === 'applicant' || key === 'beneficiary') {
      const party = current[key];
      const picked = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => isBlank((party as unknown as Record<string, unknown>)[k])));
      if (Object.keys(picked).length) out[key] = picked;
    } else if (isBlank((current as unknown as Record<string, unknown>)[key])) {
      out[key] = value;
    }
  }
  return out as ApplicationFill;
}
