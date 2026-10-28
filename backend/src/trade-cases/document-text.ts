import { detectFileType, extractDocument } from '../document-processing/extractors';
import { normalizeText } from '../document-processing/text-normalizer';
import type { TradeComplianceAnalysis } from '../compliance/types';
import { getDocumentService } from '../services/document.service';
import { extractedOrNull, statesQuantity } from './rule-helpers';

/**
 * The words of a stored document, for the AI steps that read it (recognising it on upload, reviewing
 * it at scrutiny). Read from the stored original, so it works before any analysis has run.
 */
const cache = new Map<string, string>();
const MAX_CACHED = 200;

export async function readDocumentText(documentId: string): Promise<string> {
  const hit = cache.get(documentId);
  if (hit !== undefined) return hit;
  const { buffer, filename } = await getDocumentService().getSourceFile(documentId);
  const extraction = await extractDocument(detectFileType(buffer, filename), buffer, filename);
  const text = normalizeText(extraction.text);
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
  cache.set(documentId, text);
  return text;
}

const line = (label: string, value: unknown): string | null => {
  const shown = extractedOrNull(value);
  return shown ? `${label}: ${shown}` : null;
};

/**
 * A goods line with only the figures the document states. A zero is "not stated", never a value: the
 * review must not be told "quantity 1" or "price 0" for a permit that names neither. (A quantity of
 * exactly 1 with no price and no total is the old placeholder for "not stated", kept in analyses made
 * before it was fixed.)
 */
function goodsLine(g: TradeComplianceAnalysis['goods'][number]): string {
  const parts = [`Goods line: ${g.productDescription}`, `HS ${extractedOrNull(g.hsCode) ?? 'not stated'}`];
  parts.push(statesQuantity(g) ? `quantity ${g.quantity} ${g.unitOfMeasure}` : 'quantity not stated');
  parts.push(g.unitPrice > 0 ? `unit price ${g.unitPrice}` : 'unit price not stated');
  if (g.totalLineValue > 0) parts.push(`total ${g.totalLineValue}`);
  return parts.join(' | ');
}

/**
 * What the trade extraction read in a document, as lines the review can lean on, together with what
 * the sanctions, export-control and money-laundering engines found. The review is told these are
 * engine outputs to weigh, not conclusions.
 */
export function digestFacts(x: TradeComplianceAnalysis | null): string {
  if (!x) return '';
  const t = x.transaction;
  const lines = [
    // The extractor's own label for the kind of document is left out: it can be wrong, and the case already knows the type.
    line('Reference number', x.documentClassification.number),
    line('Date on the document', x.documentClassification.date),
    line('Seller', t.parties.seller?.legalName),
    line('Buyer', t.parties.buyer?.legalName),
    line('Currency', t.currency),
    t.totalValue > 0 ? `Total value: ${t.totalValue}` : null,
    line('Incoterm', t.incoterm),
    line('Payment terms', t.paymentTerms),
    line('Country of origin', t.originCountry),
    line('Port of loading', t.portOfLoading),
    line('Port of discharge', t.portOfDischarge),
    ...x.goods.slice(0, 6).map(goodsLine),
    x.sanctions ? `Sanctions engine: status ${x.sanctions.status}; ${x.sanctions.matches.length} possible match(es)${x.sanctions.matches.length ? ' — ' + x.sanctions.matches.map((m) => `${m.entityOrSubject} ~ ${m.matchedSanctionedName} (${m.sanctionsList})`).join('; ') : ''}` : null,
    x.exportControls ? `Export-control engine: ${x.exportControls.riskStatus}${x.exportControls.controlledGoods.length ? ' — ' + x.exportControls.controlledGoods.map((g) => g.itemDescription).join('; ') : ''}` : null,
    x.tbml?.redFlags?.length ? `Money-laundering engine flags: ${x.tbml.redFlags.map((f) => f.title).join('; ')}` : null,
    x.mathematicalValidation && !x.mathematicalValidation.isMathematicallySound ? `Arithmetic does not reconcile: ${x.mathematicalValidation.discrepancies.map((d) => d.description).join(' ')}` : null,
  ];
  return lines.filter((l): l is string => Boolean(l)).join('\n');
}
