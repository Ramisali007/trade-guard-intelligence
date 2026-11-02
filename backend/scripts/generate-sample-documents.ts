/**
 * Generates the sample pre-shipment documents of a customer's import LC request, as PDFs, into
 * <repo>/test-pdfs. Everything here is invented: the companies, numbers and bank details do not
 * exist. Run from the backend folder:
 *
 *   npx tsx scripts/generate-sample-documents.ts
 *
 *   A_clean_set/            five documents that agree with one another on every figure and date
 *   B_set_with_mistakes/    two documents with deliberate mistakes, to try the "one message with
 *                           every issue, customer replies with corrected documents" loop
 *   C_corrected_for_B/      the same two documents, corrected: what the customer sends back in that loop
 *   D_post_shipment_clean/  the five shipping documents the customer sends AFTER the request in A_clean_set is
 *                           approved: commercial invoice, bill of lading, packing list, certificate of origin and
 *                           inspection certificate. They agree with A_clean_set and with the credit on every term.
 *   E_post_shipment_with_mistakes/ the same shipment with deliberate mistakes (another HS code and a short quantity on
 *                           the invoice, another discharge port), to try the discrepancy loop.
 *   F_post_shipment_corrected/ the corrected invoice and bill of lading for E.
 *
 * Options: --round=N (fresh numbers), --out=<folder> (default <repo>/test-pdfs),
 *          --ship-date=DD.MM.YYYY (the on-board date; default today, because goods are shipped only after the request is approved; kept inside the credit shipment window).
 */
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

/**
 * `--round=2` writes a fresh set with different document numbers into test-pdfs/round_2, so a second
 * run of the flow is not recognized as the same documents or the same proforma invoice reused.
 */
const round = Math.max(1, Number(/--round=(\d+)/.exec(process.argv.join(' '))?.[1] ?? 1));
const bump = round - 1;
const outArg = /--out=(\S+)/.exec(process.argv.join(' '))?.[1];
const OUT = outArg ? path.resolve(outArg) : path.resolve(__dirname, '../../test-pdfs', round > 1 ? `round_${round}` : '');

// ---------------------------------------------------------------- the deal, stated once
const deal = {
  buyer: { name: 'Kamran Textiles (Pvt) Ltd', address: 'Plot 12, Sector 15, Korangi Industrial Area, Karachi 74900', country: 'Pakistan', ntn: '1234567-8' },
  seller: { name: 'Brasil Cotton Exports Ltda', address: 'Rua Augusta 1500, Sao Paulo, SP 01304-001', country: 'Brazil', cnpj: '12.345.678/0001-90' },
  goods: 'RAW COTTON FIBRE, NOT CARDED OR COMBED, GRADE A',
  hs: '5201.0010',
  quantity: '100,000.00',
  unit: 'KG',
  unitPrice: '2.50',
  total: '250,000.00',
  currency: 'USD',
  incoterm: 'CFR Karachi',
  origin: 'Brazil',
  portOfLoading: 'Santos, Brazil',
  portOfDischarge: 'Karachi, Pakistan',
  piNo: `PI-2026-0${715 + bump}`,
  piDate: '05.10.2026',
  piValidUntil: '30.11.2026',
  poNo: `PO-KTL-2026-0${458 + bump}`,
  poDate: '08.10.2026',
  contractNo: `CTR-KTL-BCE-2026-0${31 + bump}`,
  contractDate: '10.10.2026',
  permitNo: `IP-2026-0${4418 + bump}`,
  lcAppNo: `LCA-2026-${String(92 + bump).padStart(4, '0')}`,
  lcAppDate: '22.10.2026',
  latestShipment: '15.12.2026',
  expiry: '31.01.2027',
  bank: 'National Bank of Pakistan, International Trade Operations, Karachi',
};

// ---------------------------------------------------------------- the shipment, stated once (post-shipment documents)
const fmt = (d: Date): string => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
const parseDmy = (v: string): Date => new Date(Date.UTC(Number(v.slice(6, 10)), Number(v.slice(3, 5)) - 1, Number(v.slice(0, 2))));
const DAY = 86_400_000;
const shipArg = /--ship-date=(\d{2}\.\d{2}\.\d{4})/.exec(process.argv.join(' '))?.[1];
// On board no earlier than the day after the credit was applied for, and inside its shipment window.
const earliest = parseDmy(deal.lcAppDate).getTime() + DAY;
const latest = parseDmy(deal.latestShipment).getTime();
const shipped = shipArg ? parseDmy(shipArg) : new Date(Math.min(latest, Math.max(earliest, Math.floor(Date.now() / DAY) * DAY)));
const shipment = {
  shipped: fmt(shipped),
  invoiceDate: fmt(new Date(shipped.getTime() - DAY)),
  invoiceNo: `CI-2026-${String(1180 + bump).padStart(4, '0')}`,
  blNo: `MSCU${String(7712000 + bump * 7).padStart(7, '0')}`,
  packingNo: `PL-2026-${String(1180 + bump).padStart(4, '0')}`,
  coNo: `CO-BR-2026-${String(55020 + bump).padStart(5, '0')}`,
  inspNo: `INS-SAN-2026-${String(3340 + bump).padStart(5, '0')}`,
  vessel: 'MV ATLANTIC PIONEER',
  voyage: '0412W',
  container: 'MSKU4455127',
  seal: 'BR771204',
  bales: '500',
  netKg: '100,000.00',
  grossKg: '100,900.00',
};

// ---------------------------------------------------------------- drawing helpers
type Doc = InstanceType<typeof PDFDocument>;

function open(file: string): { doc: Doc; done: Promise<void> } {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: path.basename(file, '.pdf'), Author: 'Sample document (fictional)' } });
  const stream = fs.createWriteStream(file);
  doc.pipe(stream);
  return { doc, done: new Promise((resolve) => stream.on('finish', () => resolve())) };
}

function letterhead(doc: Doc, name: string, lines: string[]): void {
  doc.font('Helvetica-Bold').fontSize(16).text(name.toUpperCase(), { align: 'center' });
  doc.font('Helvetica').fontSize(8.5);
  for (const line of lines) doc.text(line, { align: 'center' });
  doc.moveDown(0.6);
  const y = doc.y;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.8).stroke();
  doc.moveDown(0.8);
}

function title(doc: Doc, text: string): void {
  doc.font('Helvetica-Bold').fontSize(14).text(text, { align: 'center', underline: true });
  doc.moveDown(0.8);
}

/** One "LABEL: value" per line, so the label and its value always read together. */
function fields(doc: Doc, rows: Array<[string, string]>): void {
  doc.fontSize(10);
  for (const [label, value] of rows) {
    doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
    doc.font('Helvetica').text(value);
  }
  doc.moveDown(0.6);
}

function heading(doc: Doc, text: string): void {
  doc.font('Helvetica-Bold').fontSize(11).text(text);
  doc.moveDown(0.2);
}

function paragraph(doc: Doc, text: string): void {
  doc.font('Helvetica').fontSize(10).text(text, { align: 'justify' });
  doc.moveDown(0.5);
}

function signatures(doc: Doc, left: string, right: string): void {
  doc.moveDown(2);
  const y = doc.y;
  doc.font('Helvetica').fontSize(10);
  doc.text('______________________________', 50, y);
  doc.text('______________________________', 320, y);
  doc.text(left, 50, y + 14, { width: 240 });
  doc.text(right, 320, y + 14, { width: 230 });
}

// ---------------------------------------------------------------- the five documents
async function proformaInvoice(file: string, opts: { withErrors?: boolean } = {}): Promise<void> {
  const { doc, done } = open(file);
  letterhead(doc, deal.seller.name, [`${deal.seller.address}, ${deal.seller.country}`, `CNPJ: ${deal.seller.cnpj} | export@brasilcotton.example | +55 11 5555 0148`]);
  title(doc, 'PROFORMA INVOICE');
  fields(doc, [
    ['INVOICE NO', deal.piNo],
    ['DATE', deal.piDate],
    ['VALID UNTIL', deal.piValidUntil],
  ]);
  heading(doc, 'SELLER (BENEFICIARY)');
  fields(doc, [
    ['SELLER', deal.seller.name],
    ['SELLER ADDRESS', deal.seller.address],
    ['SELLER COUNTRY', deal.seller.country],
  ]);
  heading(doc, 'BUYER (APPLICANT)');
  fields(doc, [
    ['BUYER', deal.buyer.name],
    ['BUYER ADDRESS', deal.buyer.address],
    ['BUYER COUNTRY', deal.buyer.country],
  ]);
  heading(doc, 'SHIPMENT AND TERMS');
  const shipment: Array<[string, string]> = [['INCOTERMS', deal.incoterm]];
  // The mistake: the country of origin is left out.
  if (!opts.withErrors) shipment.push(['COUNTRY OF ORIGIN', deal.origin]);
  shipment.push(['PORT OF LOADING', deal.portOfLoading], ['PORT OF DISCHARGE', deal.portOfDischarge], ['PAYMENT TERMS', 'Irrevocable documentary letter of credit at sight'], ['PARTIAL SHIPMENTS', 'Not allowed']);
  fields(doc, shipment);
  doc.font('Helvetica-Bold').fontSize(9).text('Item Description HS Code Quantity Unit Price Total (USD)');
  doc.font('Helvetica').fontSize(9);
  // The mistake: the line total does not equal quantity x unit price.
  const lineTotal = opts.withErrors ? '205,000.00' : deal.total;
  doc.text(`${deal.goods} ${deal.hs} ${deal.quantity} ${deal.unit} $${deal.unitPrice}/${deal.unit} $${lineTotal}`);
  doc.moveDown(0.8);
  fields(doc, [['TOTAL AMOUNT', `USD $${deal.total}`], ['AMOUNT IN WORDS', 'United States Dollars two hundred fifty thousand only']]);
  heading(doc, "SELLER'S BANK");
  paragraph(doc, 'Banco do Brasil S.A., Sao Paulo Corporate Branch, account details are given on request for the letter of credit.');
  paragraph(doc, `This proforma invoice is valid until ${deal.piValidUntil}. Goods are offered subject to opening of the documentary credit in favor of the seller.`);
  signatures(doc, `For ${deal.seller.name}`, 'Authorized signatory');
  doc.end();
  await done;
}

async function purchaseContract(file: string): Promise<void> {
  const { doc, done } = open(file);
  letterhead(doc, 'Sales and Purchase Contract', [`Contract between ${deal.seller.name} and ${deal.buyer.name}`]);
  fields(doc, [['CONTRACT NO', deal.contractNo], ['DATE', deal.contractDate], ['PLACE OF SIGNING', 'Karachi, Pakistan'], ['PROFORMA INVOICE', `${deal.piNo} dated ${deal.piDate}`], ['PURCHASE ORDER', `${deal.poNo} dated ${deal.poDate}`]]);
  heading(doc, '1. Parties');
  paragraph(doc, `The Seller: ${deal.seller.name}, ${deal.seller.address}, ${deal.seller.country}.`);
  paragraph(doc, `The Buyer: ${deal.buyer.name}, ${deal.buyer.address}, ${deal.buyer.country}. NTN ${deal.buyer.ntn}.`);
  heading(doc, '2. Goods, quantity and price');
  fields(doc, [
    ['GOODS', deal.goods],
    ['HS CODE', deal.hs],
    ['QUANTITY', `${deal.quantity} ${deal.unit}`],
    ['UNIT PRICE', `${deal.currency} ${deal.unitPrice} per ${deal.unit}`],
    ['TOTAL CONTRACT VALUE', `${deal.currency} ${deal.total}`],
    ['COUNTRY OF ORIGIN', deal.origin],
  ]);
  heading(doc, '3. Delivery');
  fields(doc, [['INCOTERMS', deal.incoterm], ['PORT OF LOADING', deal.portOfLoading], ['PORT OF DISCHARGE', deal.portOfDischarge], ['LATEST SHIPMENT DATE', deal.latestShipment], ['PARTIAL SHIPMENTS', 'Not allowed'], ['TRANSSHIPMENT', 'Not allowed']]);
  heading(doc, '4. Payment');
  fields(doc, [['PAYMENT TERMS', 'Irrevocable documentary letter of credit at sight, opened by the Buyer within 7 days of this contract']]);
  heading(doc, '5. Quality and inspection');
  paragraph(doc, 'The goods shall conform to the grade stated above. An independent inspection certificate issued at the port of loading is a condition of payment.');
  heading(doc, '6. Law and disputes');
  paragraph(doc, 'This contract is governed by the law of England and Wales. Disputes are referred to arbitration under the ICC Rules in London.');
  signatures(doc, `For ${deal.seller.name} (Seller)`, `For ${deal.buyer.name} (Buyer)`);
  doc.end();
  await done;
}

async function purchaseOrder(file: string): Promise<void> {
  const { doc, done } = open(file);
  letterhead(doc, deal.buyer.name, [`${deal.buyer.address}, ${deal.buyer.country}`, `NTN: ${deal.buyer.ntn} | imports@kamrantextiles.example | +92 21 5555 0123`]);
  title(doc, 'PURCHASE ORDER');
  fields(doc, [['PURCHASE ORDER NO', deal.poNo], ['DATE', deal.poDate], ['PROFORMA INVOICE', `${deal.piNo} dated ${deal.piDate}`]]);
  heading(doc, 'SUPPLIER');
  fields(doc, [['SUPPLIER', deal.seller.name], ['SUPPLIER ADDRESS', deal.seller.address], ['SUPPLIER COUNTRY', deal.seller.country]]);
  heading(doc, 'ORDER');
  fields(doc, [
    ['GOODS', deal.goods],
    ['HS CODE', deal.hs],
    ['QUANTITY', `${deal.quantity} ${deal.unit}`],
    ['UNIT PRICE', `${deal.currency} ${deal.unitPrice} per ${deal.unit}`],
    ['TOTAL ORDER VALUE', `${deal.currency} ${deal.total}`],
    ['INCOTERMS', deal.incoterm],
    ['COUNTRY OF ORIGIN', deal.origin],
    ['PORT OF LOADING', deal.portOfLoading],
    ['PORT OF DISCHARGE', deal.portOfDischarge],
    ['LATEST SHIPMENT DATE', deal.latestShipment],
    ['PAYMENT TERMS', 'Irrevocable documentary letter of credit at sight'],
  ]);
  paragraph(doc, `This order is placed against proforma invoice ${deal.piNo} dated ${deal.piDate}. Shipment must be made in one lot.`);
  paragraph(doc, `Accepted by ${deal.seller.name} on 09.10.2026 by return confirmation reference CONF-0458.`);
  signatures(doc, `Procurement Manager, ${deal.buyer.name}`, 'Supplier acceptance');
  doc.end();
  await done;
}

async function importPermit(file: string): Promise<void> {
  const { doc, done } = open(file);
  letterhead(doc, 'Trade Facilitation Office, Karachi', ['Import registration and permit (fictional document for testing)']);
  title(doc, 'IMPORT PERMIT');
  fields(doc, [['PERMIT NO', deal.permitNo], ['DATE OF ISSUE', '05.01.2026'], ['VALID FROM', '01.01.2026'], ['VALID UNTIL', '31.12.2026']]);
  heading(doc, 'IMPORTER');
  fields(doc, [['IMPORTER', deal.buyer.name], ['ADDRESS', deal.buyer.address], ['COUNTRY', deal.buyer.country], ['NTN', deal.buyer.ntn]]);
  heading(doc, 'AUTHORISATION');
  paragraph(doc, `The importer named above is registered and permitted to import raw cotton, not carded or combed (HS ${deal.hs.slice(0, 4)}), for use in its own spinning unit. Goods under this permit are freely importable under the current import policy order and need no further license.`);
  fields(doc, [['PERMITTED GOODS', 'Raw cotton, HS 5201'], ['ANNUAL QUANTITY LIMIT', 'None']]);
  signatures(doc, 'Registering officer', 'Official seal');
  doc.end();
  await done;
}

async function lcApplication(file: string, opts: { withErrors?: boolean } = {}): Promise<void> {
  const { doc, done } = open(file);
  letterhead(doc, deal.buyer.name, [`${deal.buyer.address}, ${deal.buyer.country}`]);
  title(doc, 'APPLICATION FOR AN IRREVOCABLE DOCUMENTARY CREDIT');
  fields(doc, [['APPLICATION NO', deal.lcAppNo], ['DATE', deal.lcAppDate], ['TO', deal.bank]]);
  heading(doc, 'PARTIES');
  fields(doc, [
    ['APPLICANT', deal.buyer.name],
    ['APPLICANT ADDRESS', deal.buyer.address],
    ['APPLICANT COUNTRY', deal.buyer.country],
    ['BENEFICIARY', deal.seller.name],
    ['BENEFICIARY ADDRESS', deal.seller.address],
    ['BENEFICIARY COUNTRY', deal.seller.country],
  ]);
  heading(doc, 'CREDIT');
  const credit: Array<[string, string]> = [
    ['FORM OF CREDIT', 'Irrevocable'],
    ['AMOUNT', `${deal.currency} ${deal.total}`],
    ['TOLERANCE', '0 percent'],
    ['PAYMENT TERMS', 'At sight'],
  ];
  // The mistake: neither the expiry date nor the latest shipment date is stated.
  if (!opts.withErrors) credit.push(['EXPIRY DATE', deal.expiry], ['PLACE OF EXPIRY', 'Karachi, Pakistan'], ['LATEST SHIPMENT DATE', deal.latestShipment]);
  credit.push(['PRESENTATION PERIOD', '21 days after the date of shipment']);
  fields(doc, credit);
  heading(doc, 'SHIPMENT');
  fields(doc, [
    ['INCOTERMS', deal.incoterm],
    ['PORT OF LOADING', deal.portOfLoading],
    ['PORT OF DISCHARGE', deal.portOfDischarge],
    ['PARTIAL SHIPMENTS', 'Not allowed'],
    ['TRANSSHIPMENT', 'Not allowed'],
  ]);
  heading(doc, 'GOODS');
  fields(doc, [
    ['DESCRIPTION', deal.goods],
    ['HS CODE', deal.hs],
    ['QUANTITY', `${deal.quantity} ${deal.unit}`],
    ['UNIT PRICE', `${deal.currency} ${deal.unitPrice} per ${deal.unit}`],
    ['PROFORMA INVOICE', `${deal.piNo} dated ${deal.piDate}`],
    ['PURCHASE ORDER', `${deal.poNo} dated ${deal.poDate}`],
    ['IMPORT PERMIT', deal.permitNo],
  ]);
  heading(doc, 'DOCUMENTS REQUIRED');
  doc.font('Helvetica').fontSize(10);
  [
    'Signed commercial invoice in 3 originals',
    'Full set of clean on board bill of lading, made out to order and blank endorsed, marked freight prepaid',
    'Packing list',
    'Certificate of origin',
    'Inspection certificate issued by an independent inspector at the port of loading',
  ].forEach((line, i) => doc.text(`${i + 1}. ${line}`));
  doc.moveDown(0.8);
  paragraph(doc, "We request you to open the credit on the terms above and authorize you to debit our account for the credit amount, charges and commission. We confirm that the goods may be freely imported under the current import policy order and that the import permit above is valid.");
  signatures(doc, `For ${deal.buyer.name}`, 'Authorized signatory');
  doc.end();
  await done;
}

// ---------------------------------------------------------------- the five shipping documents
async function commercialInvoice(file: string, opts: { withErrors?: boolean; corrects?: boolean } = {}): Promise<void> {
  const { doc, done } = open(file);
  letterhead(doc, deal.seller.name, [`${deal.seller.address}, ${deal.seller.country}`, `CNPJ: ${deal.seller.cnpj} | export@brasilcotton.example | +55 11 5555 0148`]);
  title(doc, 'COMMERCIAL INVOICE');
  fields(doc, [
    // A corrected invoice is a new document: it carries its own number and names the one it replaces.
    ['INVOICE NO', opts.corrects ? `${shipment.invoiceNo}-R1` : shipment.invoiceNo],
    ...(opts.corrects ? ([['REPLACES INVOICE', `${shipment.invoiceNo} (cancelled)`]] as Array<[string, string]>) : []),
    ['DATE', shipment.invoiceDate],
    ['PROFORMA INVOICE', `${deal.piNo} dated ${deal.piDate}`],
    ['PURCHASE ORDER', `${deal.poNo} dated ${deal.poDate}`],
    ['CONTRACT NO', deal.contractNo],
    ['IMPORT PERMIT', deal.permitNo],
    ['LC APPLICATION', deal.lcAppNo],
  ]);
  heading(doc, 'SELLER (BENEFICIARY)');
  fields(doc, [['SELLER', deal.seller.name], ['SELLER ADDRESS', deal.seller.address], ['SELLER COUNTRY', deal.seller.country]]);
  heading(doc, 'BUYER (APPLICANT)');
  fields(doc, [['BUYER', deal.buyer.name], ['BUYER ADDRESS', deal.buyer.address], ['BUYER COUNTRY', deal.buyer.country]]);
  heading(doc, 'SHIPMENT AND TERMS');
  fields(doc, [
    ['INCOTERMS', deal.incoterm],
    ['COUNTRY OF ORIGIN', deal.origin],
    ['PORT OF LOADING', deal.portOfLoading],
    ['PORT OF DISCHARGE', opts.withErrors ? 'Port Qasim, Pakistan' : deal.portOfDischarge],
    ['VESSEL', `${shipment.vessel} V.${shipment.voyage}`],
    ['B/L NO', shipment.blNo],
    ['PAYMENT TERMS', 'Irrevocable documentary letter of credit at sight'],
  ]);
  doc.font('Helvetica-Bold').fontSize(9).text('Item Description HS Code Quantity Unit Price Total (USD)');
  doc.font('Helvetica').fontSize(9);
  // The mistakes: another HS code, and a quantity and total below what the credit allows.
  const hs = opts.withErrors ? '8408.1000' : deal.hs;
  const qty = opts.withErrors ? '90,000.00' : deal.quantity;
  const total = opts.withErrors ? '225,000.00' : deal.total;
  doc.text(`${deal.goods} ${hs} ${qty} ${deal.unit} $${deal.unitPrice}/${deal.unit} $${total}`);
  doc.moveDown(0.8);
  fields(doc, [['TOTAL AMOUNT', `USD $${total}`], ['AMOUNT IN WORDS', opts.withErrors ? 'United States Dollars two hundred twenty five thousand only' : 'United States Dollars two hundred fifty thousand only']]);
  paragraph(doc, `Goods supplied under proforma invoice ${deal.piNo} and sales contract ${deal.contractNo}. We certify that this invoice is true and correct.`);
  signatures(doc, `For ${deal.seller.name}`, 'Authorized signatory');
  doc.end();
  await done;
}

async function billOfLading(file: string, opts: { withErrors?: boolean } = {}): Promise<void> {
  const { doc, done } = open(file);
  letterhead(doc, 'Atlantic Container Line (fictional carrier)', ['Port of Santos agency, Av. Conselheiro Rodrigues Alves 100, Santos, Brazil']);
  title(doc, 'OCEAN BILL OF LADING');
  fields(doc, [
    ['B/L NO', shipment.blNo],
    ['BOOKING NO', `BKG-${shipment.blNo.slice(-6)}`],
    ['SHIPPED ON BOARD DATE', shipment.shipped],
    ['DATE OF ISSUE', shipment.shipped],
    ['PLACE OF ISSUE', 'Santos, Brazil'],
  ]);
  heading(doc, 'PARTIES');
  fields(doc, [
    ['SHIPPER', deal.seller.name],
    ['SHIPPER ADDRESS', `${deal.seller.address}, ${deal.seller.country}`],
    ['CONSIGNEE', 'TO ORDER'],
    ['NOTIFY PARTY', deal.buyer.name],
    ['NOTIFY ADDRESS', `${deal.buyer.address}, ${deal.buyer.country}`],
  ]);
  heading(doc, 'VOYAGE');
  fields(doc, [
    ['VESSEL', `${shipment.vessel} V.${shipment.voyage}`],
    ['PORT OF LOADING', deal.portOfLoading],
    ['PORT OF DISCHARGE', opts.withErrors ? 'Port Qasim, Pakistan' : deal.portOfDischarge],
    ['PLACE OF DELIVERY', deal.portOfDischarge],
    ['TRANSSHIPMENT', 'None'],
    ['FREIGHT', 'FREIGHT PREPAID'],
  ]);
  heading(doc, 'CARGO');
  fields(doc, [
    ['CONTAINER NO', `${shipment.container} (1 x 40' HC)  SEAL NO: ${shipment.seal}`],
    ['DESCRIPTION OF GOODS', `${shipment.bales} BALES ${deal.goods}`],
    ['HS CODE', deal.hs],
    ['GROSS WEIGHT', `${shipment.grossKg} ${deal.unit}`],
    ['NET WEIGHT', `${shipment.netKg} ${deal.unit}`],
    ['MARKS', `KTL / ${deal.poNo}`],
  ]);
  paragraph(doc, 'SHIPPED ON BOARD in apparent good order and condition. CLEAN ON BOARD. Number of original bills of lading: THREE (3). Made out to order and blank endorsed.');
  signatures(doc, 'For the carrier (as agent)', `Master of ${shipment.vessel}`);
  doc.end();
  await done;
}

async function packingList(file: string): Promise<void> {
  const { doc, done } = open(file);
  letterhead(doc, deal.seller.name, [`${deal.seller.address}, ${deal.seller.country}`]);
  title(doc, 'PACKING LIST');
  fields(doc, [['PACKING LIST NO', shipment.packingNo], ['DATE', shipment.invoiceDate], ['INVOICE NO', shipment.invoiceNo], ['B/L NO', shipment.blNo]]);
  fields(doc, [
    ['SELLER', deal.seller.name],
    ['BUYER', deal.buyer.name],
    ['PORT OF LOADING', deal.portOfLoading],
    ['PORT OF DISCHARGE', deal.portOfDischarge],
    ['VESSEL', `${shipment.vessel} V.${shipment.voyage}`],
    ['CONTAINER NO', `${shipment.container}  SEAL NO: ${shipment.seal}`],
  ]);
  doc.font('Helvetica-Bold').fontSize(9).text('Marks Packages Description Net Weight Gross Weight');
  doc.font('Helvetica').fontSize(9);
  doc.text(`KTL / ${deal.poNo} ${shipment.bales} BALES ${deal.goods} ${shipment.netKg} ${deal.unit} ${shipment.grossKg} ${deal.unit}`);
  doc.moveDown(0.8);
  fields(doc, [
    ['TOTAL PACKAGES', `${shipment.bales} BALES`],
    ['TOTAL QUANTITY', `${deal.quantity} ${deal.unit}`],
    ['TOTAL NET WEIGHT', `${shipment.netKg} ${deal.unit}`],
    ['TOTAL GROSS WEIGHT', `${shipment.grossKg} ${deal.unit}`],
    ['COUNTRY OF ORIGIN', deal.origin],
  ]);
  signatures(doc, `For ${deal.seller.name}`, 'Authorized signatory');
  doc.end();
  await done;
}

async function certificateOfOrigin(file: string): Promise<void> {
  const { doc, done } = open(file);
  letterhead(doc, 'Federation of Industries of the State of Sao Paulo (fictional)', ['Certificate of origin issuing office, Sao Paulo, Brazil']);
  title(doc, 'CERTIFICATE OF ORIGIN');
  fields(doc, [
    ['CERTIFICATE NO', shipment.coNo],
    ['DATE OF ISSUE', shipment.invoiceDate],
    ['EXPORTER', deal.seller.name],
    ['EXPORTER ADDRESS', `${deal.seller.address}, ${deal.seller.country}`],
    ['CONSIGNEE', deal.buyer.name],
    ['CONSIGNEE ADDRESS', `${deal.buyer.address}, ${deal.buyer.country}`],
  ]);
  fields(doc, [
    ['PORT OF LOADING', deal.portOfLoading],
    ['PORT OF DISCHARGE', deal.portOfDischarge],
    ['VESSEL', `${shipment.vessel} V.${shipment.voyage}`],
    ['INVOICE NO', shipment.invoiceNo],
    ['DESCRIPTION OF GOODS', deal.goods],
    ['HS CODE', deal.hs],
    ['QUANTITY', `${deal.quantity} ${deal.unit}`],
    ['COUNTRY OF ORIGIN', deal.origin],
  ]);
  paragraph(doc, `The undersigned certifies that the goods described above originate in ${deal.origin}.`);
  signatures(doc, 'Issuing officer', 'Official seal');
  doc.end();
  await done;
}

async function inspectionCertificate(file: string): Promise<void> {
  const { doc, done } = open(file);
  letterhead(doc, 'Santos Independent Inspection Services (fictional)', ['Inspection and quality control, Port of Santos, Brazil']);
  title(doc, 'CERTIFICATE OF QUALITY AND QUANTITY');
  fields(doc, [
    ['CERTIFICATE NO', shipment.inspNo],
    ['DATE OF INSPECTION', shipment.invoiceDate],
    ['PLACE OF INSPECTION', 'Port of Santos, Brazil'],
    ['EXPORTER', deal.seller.name],
    ['CONSIGNEE', deal.buyer.name],
    ['INVOICE NO', shipment.invoiceNo],
    ['B/L NO', shipment.blNo],
  ]);
  fields(doc, [
    ['DESCRIPTION OF GOODS', deal.goods],
    ['QUANTITY INSPECTED', `${deal.quantity} ${deal.unit}`],
    ['PORT OF LOADING', deal.portOfLoading],
    ['CONTAINER NO', shipment.container],
    ['COUNTRY OF ORIGIN', deal.origin],
  ]);
  paragraph(doc, 'We certify that the goods were inspected at the port of loading before shipment, that their quality conforms to the grade stated in the sales contract, and that the quantity loaded is as stated above.');
  signatures(doc, 'Chief inspector', 'Official seal');
  doc.end();
  await done;
}

async function main(): Promise<void> {
  const a = path.join(OUT, 'A_clean_set');
  const b = path.join(OUT, 'B_set_with_mistakes');
  const corrected = path.join(OUT, 'C_corrected_for_B');
  await proformaInvoice(path.join(a, `01_Proforma_Invoice_${deal.piNo}.pdf`));
  await purchaseContract(path.join(a, `02_Purchase_Contract_${deal.contractNo}.pdf`));
  await purchaseOrder(path.join(a, `03_Purchase_Order_${deal.poNo}.pdf`));
  await importPermit(path.join(a, `04_Import_Permit_${deal.permitNo}.pdf`));
  await lcApplication(path.join(a, `05_LC_Application_Form_${deal.lcAppNo}.pdf`));
  await proformaInvoice(path.join(b, `01_Proforma_Invoice_${deal.piNo}_with_mistakes.pdf`), { withErrors: true });
  await lcApplication(path.join(b, `05_LC_Application_Form_${deal.lcAppNo}_with_mistakes.pdf`), { withErrors: true });
  await proformaInvoice(path.join(corrected, `01_Proforma_Invoice_${deal.piNo}_corrected.pdf`));
  await lcApplication(path.join(corrected, `05_LC_Application_Form_${deal.lcAppNo}_corrected.pdf`));
  const d = path.join(OUT, 'D_post_shipment_clean');
  const e = path.join(OUT, 'E_post_shipment_with_mistakes');
  const f = path.join(OUT, 'F_post_shipment_corrected');
  await commercialInvoice(path.join(d, `01_Commercial_Invoice_${shipment.invoiceNo}.pdf`));
  await billOfLading(path.join(d, `02_Bill_of_Lading_${shipment.blNo}.pdf`));
  await packingList(path.join(d, `03_Packing_List_${shipment.packingNo}.pdf`));
  await certificateOfOrigin(path.join(d, `04_Certificate_of_Origin_${shipment.coNo}.pdf`));
  await inspectionCertificate(path.join(d, `05_Inspection_Certificate_${shipment.inspNo}.pdf`));
  await commercialInvoice(path.join(e, `01_Commercial_Invoice_${shipment.invoiceNo}_with_mistakes.pdf`), { withErrors: true });
  await billOfLading(path.join(e, `02_Bill_of_Lading_${shipment.blNo}_with_mistakes.pdf`), { withErrors: true });
  await commercialInvoice(path.join(f, `01_Commercial_Invoice_${shipment.invoiceNo}_corrected.pdf`), { corrects: true });
  await billOfLading(path.join(f, `02_Bill_of_Lading_${shipment.blNo}_corrected.pdf`));
  console.log(`Sample documents written to ${OUT}`);
}

void main();
