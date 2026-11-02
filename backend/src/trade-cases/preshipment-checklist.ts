import type { PreTradeDocumentType } from './trade-case.types';

/**
 * What a Pakistani authorized dealer looks for before opening an import LC, as plain instructions
 * for the AI review. The sources, and what could not be verified, are in
 * docs/PRESHIPMENT_PROCESS_PAKISTAN.md. Figures marked "confirm" are not asserted as current law:
 * the reviewer is told to raise them as a point to confirm, never as a breach.
 */

export const DOCUMENT_KINDS: Record<PreTradeDocumentType, { label: string; means: string }> = {
  PROFORMA_INVOICE: { label: 'Proforma invoice', means: "The supplier's offer to the importer: seller, buyer, goods with HS code, quantity, unit price, total, incoterm, payment terms, validity. Not yet a bill for shipped goods." },
  PURCHASE_CONTRACT: { label: 'Purchase / sales contract', means: 'A signed agreement between seller and buyer: parties, goods, quantity, price, delivery, payment, inspection, governing law.' },
  PURCHASE_ORDER: { label: 'Purchase order / indent', means: "The importer's order to the supplier: supplier, goods, quantity, price, delivery, payment terms." },
  IMPORT_PERMIT: { label: 'Import permit / registration / NOC', means: 'A government permit, registration or no-objection certificate that allows the importer to import the goods (for example under the Import Policy Order).' },
  LC_APPLICATION_FORM: { label: 'Transaction details form', means: "The importer's application to the bank to open a documentary credit: applicant, beneficiary, amount, expiry, latest shipment, ports, goods, documents required." },
  OTHER_SUPPORTING: { label: 'Other supporting document', means: 'Any other document that supports the request and is not one of the types above.' },
};

/** What each kind of document should state, so the review can say what is present and what is missing. */
export const EXPECTED_CONTENT: Record<PreTradeDocumentType, string[]> = {
  PROFORMA_INVOICE: [
    'Seller name, address and country',
    'Buyer name and address',
    'Proforma invoice number and date, and a validity date',
    'Description of goods, HS code, quantity with unit, unit price, line totals and a total that adds up',
    'Currency',
    'Incoterm with its named place (Pakistan permits CFR or FOB)',
    'Country of origin of the goods',
    'Port of loading and port of discharge',
    'Payment terms (for an LC: type and tenor)',
  ],
  PURCHASE_CONTRACT: [
    'Both parties with addresses and countries',
    'Contract number and date',
    'Goods, HS code, quantity, unit price and total value',
    'Incoterm and named place; ports; latest shipment date',
    'Payment terms and the credit to be opened',
    'Inspection / quality clause',
    'Governing law and dispute resolution',
  ],
  PURCHASE_ORDER: [
    'Supplier name and country; buyer name',
    'Order number and date',
    'Goods, HS code, quantity, unit price and total',
    'Incoterm, delivery date, payment terms',
  ],
  IMPORT_PERMIT: [
    'Issuing authority and permit number',
    'Importer name, NTN or registration number',
    'The goods or HS codes it covers, and any quantity limit',
    'Date of issue and a validity period that covers the shipment',
  ],
  LC_APPLICATION_FORM: [
    'Applicant and beneficiary with addresses and countries',
    'Form of credit (irrevocable), amount, currency, tolerance',
    'Expiry date and place; latest shipment date; presentation period',
    'Port of loading and port of discharge; partial shipment and transshipment',
    'Description of goods, HS code, quantity, unit price',
    'Incoterm and named place',
    'Documents required (invoice, bill of lading, packing list, certificate of origin, inspection, insurance where the terms need it)',
    'Date of the application',
  ],
  OTHER_SUPPORTING: ['The purpose of the document and who issued it', 'A date'],
};

/**
 * The checks that apply to the whole request. Each is phrased as the reviewer should apply it. Only
 * what the documents show may be reported; a check that cannot be made from them is said to be
 * not checkable, never passed.
 */
export const CASE_LEVEL_CHECKS: string[] = [
  'The documents agree with each other: the same buyer and seller, the same goods, HS code, quantity, unit price, total, incoterm, ports, payment terms and references across the proforma invoice, contract, purchase order and transaction details form. Report every difference with both values.',
  'The request rests on a firm commitment: a proforma invoice, purchase order or contract from the foreign supplier (FE Manual Ch.13 para 7).',
  'Terms of import: Pakistan permits imports on CFR (C&F) or FOB terms; insurance of imports must be taken with a company operating in Pakistan, in rupees (FE Manual Ch.13 para 5 and Ch.15). CFR and FOB are fine and need no remark, and the insurance rule is no issue under them unless a document says the goods are insured abroad or in a foreign currency. CIF, CIP, DDP and similar terms must be raised as a point to confirm with the State Bank rules.',
  'LC validity: an LC is normally opened for up to 12 months (24 for specially manufactured machinery) (FE Manual Ch.13 para 9). The latest shipment date must not be after expiry, and the presentation period after shipment must fit before expiry.',
  'Goods are importable under the Import Policy Order 2022 (S.R.O. 545(I)/2022): not on the banned list (Appendix-A); if restricted (Appendix-B) the required permission or condition must be on file. If the goods look banned or restricted and no permit is attached, raise it. If unsure which Appendix applies, say it must be confirmed.',
  'Sanctions and proscribed parties: look at every named person, company, bank, vessel and country. Pakistani banks must not serve persons designated under UN Security Council resolutions (UN (Security Council) Act 1948) or proscribed under the Anti-Terrorism Act 1997, nor their associates. Report any name or country that resembles a sanctioned or proscribed party or a comprehensively sanctioned jurisdiction as a possible match for compliance, never as a conclusion.',
  'High-risk jurisdictions: country of origin, ports, transit and the counterparties\' countries against FATF high-risk or monitored lists and sanctions programs.',
  'Dual-use and strategic goods: if the goods could be controlled (chemicals and precursors, high-strength fibres, electronics, machine tools, explosives or arms components, nuclear or missile related items, night vision, drones), say so and ask for end-use information. Pakistan\'s national control lists (S.R.O. 1977(I)/2025) cover exports; for imports it is a due-diligence flag.',
  'Trade-based money laundering: unit price far from the normal market price for the goods (over- or under-invoicing), quantities or goods that do not fit the importer\'s business, vague goods descriptions, unusual routing or transshipment, a new or unrelated supplier, round-number or inconsistent totals, a proforma invoice number reused elsewhere, payment terms that do not fit the goods (SBP framework, EPD CL 08 of 2025).',
  'Importer standing: NTN and registration shown where a document carries them; flag if an import permit or registration number is absent where the goods need one.',
  'Dates: a proforma invoice still valid at the date of the transaction details form, a permit not expired and covering the shipment, a transaction details form not dated before the documents it relies on, a shipment date not before the order. The order in which the proforma invoice, purchase order and contract were issued is NOT an issue: the supplier\'s proforma invoice may come before or after the order.',
  'Quality: every document readable, complete (no missing pages), not marked draft, void or specimen, not obviously altered or in conflict with itself. You read text only: never report a missing signature, stamp or seal unless the text itself says the document is unsigned or a draft.',
];

/** The instruction block that gives the model its role and its limits. */
export const REVIEWER_ROLE = `You are a senior trade-finance documentary examiner at a Pakistani authorized dealer bank, scrutinizing documents a customer has sent to open an import letter of credit (the pre-shipment stage; no goods have shipped).
Rules you always follow:
- Report only what the document text shows. Never invent a value, a party, a regulation or a quotation. If something cannot be judged from the text, say it cannot be checked.
- A name, country or goods match to a sanctions, proscribed or controlled list is evidence for compliance to examine, never a conclusion.
- Do not mention a statute or circular number unless it is given to you in the checks. If you are unsure whether a rule applies, phrase it as a point to confirm.
- Be specific: name the field, quote the exact words from the document in "evidence", say what the customer has to send or correct in "customerAction".
- Do not repeat the same issue twice, and do not raise it again in another document.
- The "facts" you are given may say that an engine found something (arithmetic that does not reconcile, a sanctions or export-control result, a money-laundering flag). Weigh those, but do not report as an issue what the facts already state as found by an engine.
- An issue is something wrong, contradictory, or missing in a way that matters, which the customer must fix or the bank must decide. Reminders, normal terms, observations that need no action, and checks you could not make go in "notCheckable", never in "issues". If a document is fine, return no issues for it.`;

export function checklistFor(type: PreTradeDocumentType): string {
  return EXPECTED_CONTENT[type].map((line, i) => `${i + 1}. ${line}`).join('\n');
}

export function caseChecklist(): string {
  return CASE_LEVEL_CHECKS.map((line, i) => `${i + 1}. ${line}`).join('\n');
}
