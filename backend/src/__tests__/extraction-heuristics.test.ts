import './test-env';
import assert from 'node:assert';
import { TradeComplianceExtractor } from '../ai/trade-extractor';
import { TransactionRegistry } from '../compliance/fraud/transaction-registry';

/**
 * Field extraction without a language model, against the layouts of a real export presentation:
 * a sea waybill, the commercial invoice, the sales contract and the customs goods declaration for
 * one shipment. The texts are the line-preserving output of the extractors for the sample files.
 *
 * Besides the fields, the set checks the presentation as a whole: four documents of one shipment
 * all cite the same invoice number, and that is not invoice reuse.
 */

const WAYBILL = `COSCO SHIPPING LINES CO., LTD.
NON-NEGOTIABLE SEA WAYBILL FOR COMBINED TRANSPORT OR PORT TO PORT SHIPMENT
WAYBILL NO: COSU6445585470 BOOKING NO: PK-KHI-044812
SHIPPER / EXPORTER:
LIBERTY MILLS LIMITED
A/51-A, S.I.T.E., KARACHI-75700, PAKISTAN
CONSIGNEE:
KMART AUSTRALIA LIMITED
690 SPRINGVALE ROAD, MULGRAVE, VIC 3170, AUSTRALIA
OCEAN VESSEL & VOYAGE: COSCO ROTTERDAM / 082E PORT OF LOADING: PORT QASIM (EXPORTS),
KARACHI
PORT OF DISCHARGE: FREMANTLE (AU), AUSTRALIA PLACE OF DELIVERY: FREMANTLE CONTAINER TERMINAL
CSLU9184421 1,150 Cartons 100% COTTON PRINTED BEDWEAR & SHEET 8,147.50 KG 68.50 CBM
INVOICE NO: LM-LHT/25-26/5771 (INV-5771)
CONTRACT NO: LHT-KMART-050/2026
SHIPPED ON BOARD DATE: 24.02.2026 AT PORT QASIM, KARACHI`;

const INVOICE = `LIBERTY MILLS LIMITED
MILLS: A/51-A, S.I.T.E., KARACHI-75700, PAKISTAN | PHONES: (92-21) 32578100-16 | FAX: (92-21) 32561030
EXPORT REG NO: 023579 | NTN/STRN: 0201511103746 | Email: export@libertymillslimited.com
COMMERCIAL INVOICE
INVOICE NO: LM-LHT/25-26/5771 (Ref: INV-5771) DATE: 20.02.2026
SALES CONTRACT REF: LHT-KMART-050/2026 (CTR-050) INCOTERMS: F.O.B. Port Qasim, Karachi
PAYMENT TERMS: 120 DAYS D/A CARRIER / B/L: COSCO / B/L COSU6445585470
BUYER / IMPORTER / CONSIGNEE:
M/s KMART AUSTRALIA LTD
690 SPRINGVALE ROAD, MULGRAVE, VICTORIA, AUSTRALIA 3170
COUNTRY OF DESTINATION: AUSTRALIA (AU) | DISCHARGE PORT: FREMANTLE
Item Description HS Code Quantity Unit Price Total FOB (USD)
100% COTTON PIGMENT PRINTED QUILT COVER SETS 6302.3130 350.60 KG $4.8578/KG $1,703.14
Const: 20x10/40x44 (Under EFS SRO 957) - 50 Cartons
100% COTTON PIGMENT PRINTED SHEET SETS 6302.3190 6,895.06 KG $4.1638/KG $28,709.65
Const: 20x10/40x44 (Under EFS SRO 957) - 1,100 Cartons
TOTAL DECLARED EXPORT FOB VALUE: 7,245.66 KG USD $30,412.66
For LIBERTY MILLS LIMITED`;

const CONTRACT = `LIBERTY MILLS LIMITED
MILLS: A/51-A, S.I.T.E., KARACHI-75700 (PAKISTAN) | PHONES: (92-21) 32578100-16
SALES CONTRACT & PURCHASE CONFIRMATION
BUYER / IMPORTER: CONTRACT REF: LHT-KMART-050/2026
M/s KMART AUSTRALIA LTD, AUSTRALIA DATE: 15.01.2026
690 SPRINGVALE ROAD, MULGRAVE INCOTERMS: F.O.B. KARACHI
VICTORIA, AUSTRALIA 3170 PAYMENT TERMS: 120 DAYS D/A
Product Description / Sheet Sets Contract Quantity Unit Price (USD) Total Amount (USD)
SHEET SET SB (Single Bed) 53,700 PCS $7.15 $383,955.20
SHEET SET DB (Double Bed) 28,873 PCS $9.37 $270,543.37
STD PILLOW CASES 8,277 PCS $0.88 $7,283.76
TOTAL CONTRACT VALUE: 184,221 PCS US$ 1,568,536.84
For: LIBERTY MILLS LIMITED For: KMART AUSTRALIA LTD`;

const GOODS_DECLARATION = `PAKISTAN CUSTOMS / WeBOC SINGLE WINDOW SYSTEM
GOODS DECLARATION, GD-I [X] BILL OF EXPORT
CUSTOM FILE NO: 2905 MACHINE NO: KPPE-EF-210518-04-03-2026 CUSTOMS OFFICE: Port Qasim (exports), Karachi
EXPORTER / CONSIGNOR: IMPORTER / CONSIGNEE:
M/S LIBERTY MILLS LIMITED KMART AUSTRALIA LIMITED
BL/AWB/CON: LM-LHT/25-26/5771 PORT OF SHIPMENT: Port Qasim (exports) PORT OF DISCHARGE: Fremantle (AU)
1. 100% COTTON PIGMENT PRINTED QUILT COVER SETS 6302.3130 350.6000 KG USD $1,703.14 PKR 475,773.47
CONST: 20x10/40x44 (UNDER EFS SRO 957) ($4.8578/KG)
2. 100% COTTON PIGMENT PRINTED SHEET SETS 6302.3190 6,895.0600 KG USD $28,709.65 PKR 8,020,040.96
CONST: 20x10/40x44 (UNDER EFS SRO 957) ($4.1638/KG)
TOTAL DECLARED EXPORT FOB VALUE: USD $30,412.66 PKR 8,495,814.43`;

async function analyse(id: number, filename: string, text: string) {
  return new TradeComplianceExtractor().processTradeDocument({
    documentId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    filename,
    rawText: text,
    rawBuffer: Buffer.from(text),
    aiModel: 'heuristic',
  });
}

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('Heuristic extraction against a real export presentation');
  console.log('================================================================\n');
  TransactionRegistry.getInstance().resetForTesting();

  // ------------------------------------------------------------------ 1. sea waybill
  const waybill = await analyse(1, 'COSCO_Sea_Waybill.pdf', WAYBILL);
  assert.strictEqual(waybill.documentClassification.type, 'Bill of Lading', 'a waybill that quotes an invoice number is still a transport document');
  assert.strictEqual(waybill.documentClassification.number, 'COSU6445585470');
  assert.strictEqual(waybill.transaction.parties.seller?.legalName, 'LIBERTY MILLS LIMITED');
  assert.strictEqual(waybill.transaction.portOfLoading, 'PORT QASIM (EXPORTS)', 'port label needs a colon; parentheses survive');
  assert.strictEqual(waybill.transaction.portOfDischarge, 'FREMANTLE (AU)');
  assert.strictEqual(waybill.transaction.shipmentDate, '24.02.2026', 'the on-board date, not the word after the label');
  console.log('✔ Scenario 1 Passed: Sea waybill typed by its title; waybill number, shipper and ports read.');

  // ------------------------------------------------------------------ 2. commercial invoice
  const invoice = await analyse(2, 'Liberty_Mills_Commercial_Invoice.pdf', INVOICE);
  const tx = invoice.transaction;
  assert.strictEqual(invoice.documentClassification.type, 'Commercial Invoice');
  assert.strictEqual(invoice.documentClassification.number, 'LM-LHT/25-26/5771', 'invoice number keeps its slashes');
  assert.strictEqual(tx.parties.seller?.legalName, 'LIBERTY MILLS LIMITED', 'issuer read from the signature block');
  assert.strictEqual(tx.parties.buyer?.legalName, 'M/s KMART AUSTRALIA LTD');
  assert.strictEqual(tx.totalValue, 30412.66, 'total is the money on the total line, not the weight before it');
  assert.strictEqual(tx.incoterm, 'FOB', 'dotted F.O.B. is FOB');
  assert.strictEqual(tx.portOfLoading, 'Port Qasim', 'named place after F.O.B. is the loading port');
  assert.strictEqual(tx.paymentTerms, '120 DAYS D/A', 'payment terms stop at the next label');
  assert.strictEqual(invoice.goods.length, 2, 'two table rows; the construction spec "20x10/40x44" is not a line');
  const [quilt, sheets] = invoice.goods;
  assert.strictEqual(quilt?.hsCode, '6302.3130');
  assert.strictEqual(quilt?.quantity, 350.6);
  assert.strictEqual(quilt?.unitOfMeasure, 'KG');
  assert.strictEqual(quilt?.unitPrice, 4.8578);
  assert.strictEqual(quilt?.totalLineValue, 1703.14);
  assert.strictEqual(sheets?.totalLineValue, 28709.65);
  assert.ok(invoice.mathematicalValidation.isMathematicallySound, 'a $0.13 rounding gap on $30k is within tolerance');
  console.log('✔ Scenario 2 Passed: Invoice number, issuer, totals, Incoterm, ports, terms and table rows read.');

  // ------------------------------------------------------------------ 3. the set is one shipment
  const alertCodes = (invoice.fraudAnalysis?.alerts ?? []).map((a) => a.code);
  assert.ok(!alertCodes.includes('MULTIPLE_INVOICE_FINANCING'), `waybill citing the invoice is not multiple invoicing (${alertCodes.join(', ')})`);
  assert.ok(!alertCodes.includes('CROSS_CUSTOMER_CONFLICT'), `same exporter on both documents (${alertCodes.join(', ')})`);
  assert.notStrictEqual(invoice.decision.decision, 'BLOCK_ESCALATE', `clean invoice is not blocked (rules: ${invoice.decision.triggeredRules.join(', ')})`);
  console.log('✔ Scenario 3 Passed: Supporting documents citing the invoice do not read as invoice reuse.');

  // ------------------------------------------------------------------ 4. sales contract
  const contract = await analyse(3, 'Liberty_Mills_Sales_Contract.pdf', CONTRACT);
  assert.strictEqual(contract.documentClassification.type, 'Sales Contract');
  assert.strictEqual(contract.documentClassification.number, 'LHT-KMART-050/2026');
  assert.strictEqual(contract.transaction.parties.seller?.legalName, 'LIBERTY MILLS LIMITED');
  assert.strictEqual(contract.transaction.parties.buyer?.legalName, 'M/s KMART AUSTRALIA LTD, AUSTRALIA', 'the label after BUYER: is skipped; the next column is dropped');
  assert.strictEqual(contract.transaction.totalValue, 1568536.84, 'US$ total after a PCS count');
  assert.strictEqual(contract.goods.length, 3);
  assert.strictEqual(contract.goods[0]?.unitPrice, 7.15);
  assert.strictEqual(contract.goods[0]?.totalLineValue, 383955.2);
  // The excerpt keeps 3 of the contract's 10 rows, so only the per-line checks are meaningful here.
  const lineErrors = contract.mathematicalValidation.discrepancies.filter((d) => d.lineNumber !== undefined);
  assert.deepStrictEqual(lineErrors, [], 'unit prices printed rounded to cents are not arithmetic errors');
  console.log('✔ Scenario 4 Passed: Contract typed by title; two-column labels and US$ totals read.');

  // ------------------------------------------------------------------ 5. customs goods declaration
  const gd = await analyse(4, 'Pakistan_Customs_GD.pdf', GOODS_DECLARATION);
  assert.strictEqual(gd.documentClassification.type, 'Customs Goods Declaration');
  assert.strictEqual(gd.documentClassification.number, 'KPPE-EF-210518-04-03-2026');
  assert.strictEqual(gd.transaction.parties.seller?.legalName, 'M/S LIBERTY MILLS LIMITED', 'left column of a two-column name line');
  assert.strictEqual(gd.transaction.parties.buyer?.legalName, 'KMART AUSTRALIA LIMITED', 'right column of a two-column name line');
  assert.strictEqual(gd.transaction.portOfLoading, 'Port Qasim (exports)');
  assert.strictEqual(gd.transaction.totalValue, 30412.66);
  assert.deepStrictEqual(gd.goods.map((g) => g.totalLineValue), [1703.14, 28709.65], 'USD line values, not the PKR assessment beside them');
  assert.strictEqual(gd.goods[0]?.unitPrice, 4.8578, 'rate printed on the following line');
  console.log('✔ Scenario 5 Passed: GD typed by title; two-column parties and USD values read.');

  console.log('\n================================================================');
  console.log('ALL EXTRACTION HEURISTIC SCENARIOS PASSED');
  console.log('================================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('EXTRACTION HEURISTICS TEST FAILED:', err);
  process.exit(1);
});
