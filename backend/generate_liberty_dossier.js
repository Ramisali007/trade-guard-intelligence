const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const sampleReportsDir = path.resolve(__dirname, '../sample_reports');

// Ensure sample_reports directory exists
if (!fs.existsSync(sampleReportsDir)) {
  fs.mkdirSync(sampleReportsDir, { recursive: true });
}

// Guarantee Pakistan Customs GD exists with full name
const gdSource = path.join(sampleReportsDir, 'pakistan.pdf');
const gdTarget = path.join(sampleReportsDir, 'Pakistan_Customs_GD_Bill_of_Export_GD2905.pdf');
if (fs.existsSync(gdSource) && !fs.existsSync(gdTarget)) {
  fs.copyFileSync(gdSource, gdTarget);
  console.log('✔ Copied pakistan.pdf -> Pakistan_Customs_GD_Bill_of_Export_GD2905.pdf');
}

// 1. Generate Commercial Invoice PDF
function generateCommercialInvoice() {
  const targetPath = path.join(sampleReportsDir, 'Liberty_Mills_Commercial_Invoice_INV-5771.pdf');
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const stream = fs.createWriteStream(targetPath);
  doc.pipe(stream);

  doc.fontSize(16).font('Helvetica-Bold').text('LIBERTY MILLS LIMITED', { align: 'center' });
  doc.fontSize(8).font('Helvetica').text('MILLS: A/51-A, S.I.T.E., KARACHI-75700, PAKISTAN | PHONES: (92-21) 32578100-16 | FAX: (92-21) 32561030', { align: 'center' });
  doc.text('EXPORT REG NO: 023579 | NTN/STRN: 0201511103746 | Email: export@libertymillslimited.com', { align: 'center' });
  doc.moveDown(0.8);

  doc.fontSize(13).font('Helvetica-Bold').text('COMMERCIAL INVOICE', { align: 'center', underline: true });
  doc.moveDown(0.8);

  // Metadata Grid
  doc.fontSize(9).font('Helvetica-Bold').text('INVOICE NO: ', 40, doc.y, { continued: true });
  doc.font('Helvetica').text('LM-LHT/25-26/5771  (Ref: INV-5771)        ', { continued: true });
  doc.font('Helvetica-Bold').text('DATE: ', { continued: true });
  doc.font('Helvetica').text('20.02.2026');

  doc.font('Helvetica-Bold').text('SALES CONTRACT REF: ', { continued: true });
  doc.font('Helvetica').text('LHT-KMART-050/2026 (CTR-050)          ', { continued: true });
  doc.font('Helvetica-Bold').text('INCOTERMS: ', { continued: true });
  doc.font('Helvetica').text('F.O.B. Port Qasim, Karachi');

  doc.font('Helvetica-Bold').text('PAYMENT TERMS: ', { continued: true });
  doc.font('Helvetica').text('120 DAYS D/A                               ', { continued: true });
  doc.font('Helvetica-Bold').text('CARRIER / B/L: ', { continued: true });
  doc.font('Helvetica').text('COSCO / B/L COSU6445585470');

  doc.font('Helvetica-Bold').text('FINANCIAL INSTRUMENT: ', { continued: true });
  doc.font('Helvetica').text('PK16NBPA1862004045423412 (National Bank of Pakistan)');
  doc.moveDown(0.8);

  // Buyer Info
  doc.font('Helvetica-Bold').text('BUYER / IMPORTER / CONSIGNEE:');
  doc.font('Helvetica').text('M/s KMART AUSTRALIA LTD\n690 SPRINGVALE ROAD, MULGRAVE, VICTORIA, AUSTRALIA 3170\nCOUNTRY OF DESTINATION: AUSTRALIA (AU) | DISCHARGE PORT: FREMANTLE');
  doc.moveDown(1);

  // Items Table Header
  const tableTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5);
  doc.text('Item Description', 40, tableTop);
  doc.text('HS Code', 260, tableTop);
  doc.text('Quantity', 330, tableTop);
  doc.text('Unit Price', 410, tableTop);
  doc.text('Total FOB (USD)', 480, tableTop, { align: 'right' });

  doc.moveTo(40, tableTop + 14).lineTo(555, tableTop + 14).stroke('#cbd5e1');

  // Item 1
  let y = tableTop + 20;
  doc.font('Helvetica').fontSize(8);
  doc.text('100% COTTON PIGMENT PRINTED QUILT COVER SETS\nConst: 20x10/40x44 (Under EFS SRO 957) - 50 Cartons', 40, y, { width: 215 });
  doc.text('6302.3130', 260, y);
  doc.text('350.60 KG', 330, y);
  doc.text('$4.8578/KG', 410, y);
  doc.text('$1,703.14', 480, y, { align: 'right' });

  // Item 2
  y += 32;
  doc.text('100% COTTON PIGMENT PRINTED SHEET SETS\nConst: 20x10/40x44 (Under EFS SRO 957) - 1,100 Cartons', 40, y, { width: 215 });
  doc.text('6302.3190', 260, y);
  doc.text('6,895.06 KG', 330, y);
  doc.text('$4.1638/KG', 410, y);
  doc.text('$28,709.65', 480, y, { align: 'right' });

  y += 36;
  doc.moveTo(40, y).lineTo(555, y).stroke('#0a1638');
  y += 6;
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('TOTAL DECLARED EXPORT FOB VALUE:', 40, y);
  doc.text('7,245.66 KG', 330, y);
  doc.text('USD $30,412.66', 480, y, { align: 'right' });

  y += 20;
  doc.font('Helvetica').fontSize(8.5);
  doc.text('Amount in Words: US Dollars Thirty Thousand Four Hundred Twelve and Cents Sixty Six Only.');
  doc.text('Total Cartons: 1,150 Cartons  |  Gross Weight: 8,147.50 KG (8.1475 MT)  |  Net Weight: 7,245.66 KG');
  doc.moveDown(1.2);

  doc.fontSize(8).font('Helvetica-Oblique').text(
    'Declaration: We certify that this invoice shows the actual price of the goods described, that no other invoice has been or will be issued, and that all particulars are true and correct matching Pakistan Customs GD-I (File: 2905).',
    { align: 'justify' }
  );

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('For LIBERTY MILLS LIMITED', 40, doc.y);
  doc.moveDown(1.5);
  doc.text('____________________________________');
  doc.font('Helvetica').fontSize(8).text('Authorized Signatory / Export Directorate');

  doc.end();
  return new Promise((resolve) => stream.on('finish', () => {
    console.log('✔ Generated: ' + targetPath);
    resolve();
  }));
}

// 2. Generate Sea Waybill PDF
function generateSeaWaybill() {
  const targetPath = path.join(sampleReportsDir, 'COSCO_Sea_Waybill_COSU6445585470.pdf');
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const stream = fs.createWriteStream(targetPath);
  doc.pipe(stream);

  doc.fontSize(15).font('Helvetica-Bold').text('COSCO SHIPPING LINES CO., LTD.', { align: 'center' });
  doc.fontSize(8.5).font('Helvetica').text('NON-NEGOTIABLE SEA WAYBILL FOR COMBINED TRANSPORT OR PORT TO PORT SHIPMENT', { align: 'center' });
  doc.moveDown(0.8);

  doc.fontSize(9).font('Helvetica-Bold').text('WAYBILL NO: ', 40, doc.y, { continued: true });
  doc.font('Helvetica').text('COSU6445585470                                 ', { continued: true });
  doc.font('Helvetica-Bold').text('BOOKING NO: ', { continued: true });
  doc.font('Helvetica').text('PK-KHI-044812');

  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').text('SHIPPER / EXPORTER:');
  doc.font('Helvetica').text('LIBERTY MILLS LIMITED\nA/51-A, S.I.T.E., KARACHI-75700, PAKISTAN\nTEL: (92-21) 32578100-16 | NTN: 0201511103746');
  doc.moveDown(0.6);

  doc.font('Helvetica-Bold').text('CONSIGNEE:');
  doc.font('Helvetica').text('KMART AUSTRALIA LIMITED\n690 SPRINGVALE ROAD, MULGRAVE, VIC 3170, AUSTRALIA');
  doc.moveDown(0.6);

  doc.font('Helvetica-Bold').text('NOTIFY PARTY:');
  doc.font('Helvetica').text('KMART AUSTRALIA LIMITED (CENTRAL LOGISTICS & CUSTOMS CLEARING DESK)');
  doc.moveDown(0.8);

  // Transit Details Grid
  doc.font('Helvetica-Bold').text('OCEAN VESSEL & VOYAGE: ', 40, doc.y, { continued: true });
  doc.font('Helvetica').text('COSCO ROTTERDAM / 082E              ', { continued: true });
  doc.font('Helvetica-Bold').text('PORT OF LOADING: ', { continued: true });
  doc.font('Helvetica').text('PORT QASIM (EXPORTS), KARACHI');

  doc.font('Helvetica-Bold').text('PORT OF DISCHARGE: ', { continued: true });
  doc.font('Helvetica').text('FREMANTLE (AU), AUSTRALIA            ', { continued: true });
  doc.font('Helvetica-Bold').text('PLACE OF DELIVERY: ', { continued: true });
  doc.font('Helvetica').text('FREMANTLE CONTAINER TERMINAL');
  doc.moveDown(1);

  // Cargo Table
  const cargoTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5);
  doc.text('Container & Seal No.', 40, cargoTop);
  doc.text('Packages', 170, cargoTop);
  doc.text('Description of Goods', 250, cargoTop);
  doc.text('Gross Weight', 440, cargoTop);
  doc.text('Measurement', 500, cargoTop, { align: 'right' });

  doc.moveTo(40, cargoTop + 14).lineTo(555, cargoTop + 14).stroke('#cbd5e1');

  let y = cargoTop + 22;
  doc.font('Helvetica').fontSize(8);
  doc.text('CSLU9184421\nSeal: COS-PK09281\n40\' High Cube (HC)', 40, y);
  doc.text('1,150 Cartons', 170, y);
  doc.text(
    '100% COTTON PRINTED BEDWEAR & SHEET SETS\n' +
    'EXPORT UNDER SBP EFS SRO 957\n' +
    'INVOICE NO: LM-LHT/25-26/5771 (INV-5771)\n' +
    'GD-I MACHINE NO: KPPE-EF-210518-04-03-2026 (GD2905)\n' +
    'CONTRACT NO: LHT-KMART-050/2026',
    250, y, { width: 180 }
  );
  doc.text('8,147.50 KG\n(7,245.66 KG Net)', 440, y);
  doc.text('68.50 CBM', 500, y, { align: 'right' });

  y += 75;
  doc.moveTo(40, y).lineTo(555, y).stroke('#0a1638');
  y += 6;
  doc.font('Helvetica-Bold').fontSize(8.5);
  doc.text('TOTAL: 1 CONTAINER (40\' HC) | 1,150 CARTONS | GROSS: 8,147.50 KG | MEASUREMENT: 68.50 CBM', 40, y);

  doc.moveDown(1.5);
  doc.font('Helvetica').fontSize(8);
  doc.text('FREIGHT & CHARGES: FREIGHT COLLECT / PAYABLE AT DESTINATION (FREMANTLE, AU)');
  doc.text('SHIPPED ON BOARD DATE: 24.02.2026 AT PORT QASIM, KARACHI');
  doc.text('CARRIER AGENT: COSCO SHIPPING LINES (PAKISTAN) PVT LTD, 19/B SHAHRAH-E-FAISAL, KARACHI');

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(8.5);
  doc.text('SIGNED FOR THE CARRIER COSCO SHIPPING LINES CO., LTD.', 40, doc.y);
  doc.moveDown(1.2);
  doc.text('____________________________________');
  doc.font('Helvetica').fontSize(7.5).text('As Carrier / Authorized Agent: COSCO SHIPPING PAKISTAN');

  doc.end();
  return new Promise((resolve) => stream.on('finish', () => {
    console.log('✔ Generated: ' + targetPath);
    resolve();
  }));
}

(async () => {
  await generateCommercialInvoice();
  await generateSeaWaybill();
  console.log('Done generating Liberty Mills dossier PDFs!');
})();
