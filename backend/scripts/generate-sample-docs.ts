import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

const rootDir = path.resolve(__dirname, '../../');

function createPdfFile(filePath: string, buildFn: (doc: PDFKit.PDFDocument) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: path.basename(filePath),
        Author: 'Global Trade Operations & Compliance Systems',
      },
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    buildFn(doc);
    doc.end();

    stream.on('finish', () => resolve());
    stream.on('error', (err) => reject(err));
  });
}

// --------------------------------------------------------------------------
// 1. VERY SAFE DOCUMENT (ALLOW - Risk Score ~ 5/100)
// --------------------------------------------------------------------------
async function generateVerySafeDoc() {
  const filePath = path.join(rootDir, 'Sample_1_Very_Safe_Document.pdf');
  await createPdfFile(filePath, (doc) => {
    // Header
    doc.rect(40, 40, 515, 30).fill('#0f172a');
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text('COMMERCIAL INVOICE & TRADE PRESENTATION', 50, 49);
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text('ORIGINAL — CLEAN PRESENTATION', 400, 50, { align: 'right', width: 145 });

    doc.y = 85;

    // Document Meta
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text('PRECISION ENGINEERING GMBH', 40, doc.y);
    doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
    doc.text('Industriestrasse 45, 70565 Stuttgart, Germany');
    doc.text('Tax / VAT ID: DE814920194 | Registration: HRB Stuttgart 721904 | Contact: exports@precision-gmbh.de');
    doc.moveDown(0.8);

    // Grid: Invoice Details & Buyer
    const gridY = doc.y;
    doc.rect(40, gridY, 250, 95).fill('#f8fafc');
    doc.rect(40, gridY, 250, 95).lineWidth(0.5).stroke('#cbd5e1');

    doc.rect(305, gridY, 250, 95).fill('#f8fafc');
    doc.rect(305, gridY, 250, 95).lineWidth(0.5).stroke('#cbd5e1');

    // Left Box: Invoice Meta
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f172a').text('DOCUMENT & INVOICE DETAILS', 48, gridY + 8);
    doc.font('Helvetica').fontSize(8).fillColor('#334155');
    doc.text('Invoice Number: INV-2026-DE-8921', 48, gridY + 22);
    doc.text('Date of Issue: 2026-08-25', 48, gridY + 34);
    doc.text('LC Reference: LC-DEUK-2026-004812', 48, gridY + 46);
    doc.text('Incoterm: CIF Felixstowe Port (Incoterms 2020)', 48, gridY + 58);
    doc.text('Payment Terms: 100% at sight under Irrevocable LC', 48, gridY + 70);
    doc.text('Origin Country: Germany (Federal Republic)', 48, gridY + 82);

    // Right Box: Buyer & Banking
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f172a').text('BUYER / IMPORTER & BANKING', 313, gridY + 8);
    doc.font('Helvetica').fontSize(8).fillColor('#334155');
    doc.text('Buyer: British Industrial Machinery Ltd', 313, gridY + 22);
    doc.text('Address: 12 Commercial Way, Trafford Park, Manchester, UK', 313, gridY + 34);
    doc.text('Issuing Bank: Deutsche Bank AG (Frankfurt, Germany)', 313, gridY + 46);
    doc.text('Advising Bank: Barclays Bank PLC (London, UK)', 313, gridY + 58);
    doc.text('Consignee: British Industrial Machinery Ltd (Same as Buyer)', 313, gridY + 70);
    doc.text('Ultimate End-User: British Industrial Machinery Plant #2, UK', 313, gridY + 82);

    doc.y = gridY + 110;

    // Goods Table
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text('LINE ITEM COMMODITY BREAKDOWN', 40, doc.y);
    doc.moveDown(0.3);

    const tblY = doc.y;
    doc.rect(40, tblY, 515, 18).fill('#0f172a');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    doc.text('#', 45, tblY + 5, { width: 20 });
    doc.text('Description of Goods', 70, tblY + 5, { width: 200 });
    doc.text('HS Code', 275, tblY + 5, { width: 65 });
    doc.text('Quantity', 345, tblY + 5, { width: 50 });
    doc.text('Unit Price', 400, tblY + 5, { width: 55 });
    doc.text('Total (EUR)', 460, tblY + 5, { width: 90, align: 'right' });

    let itemY = tblY + 18;

    const items = [
      { num: '1', desc: 'Tungsten Carbide Precision CNC Milling Cutters (Dia 12mm)', hs: '8207.50.00', qty: '500 PCS', unit: 'EUR 120.00', total: '60,000.00' },
      { num: '2', desc: 'High-Speed Steel Heavy Duty Drill Bits (Grade DIN 338)', hs: '8207.50.10', qty: '1,000 PCS', unit: 'EUR 45.00', total: '45,000.00' },
      { num: '3', desc: 'Industrial Rotary Tool Holders & Collet Chuck Sets', hs: '8466.10.20', qty: '150 SETS', unit: 'EUR 290.00', total: '43,500.00' },
    ];

    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (i % 2 === 0) doc.rect(40, itemY, 515, 20).fill('#f8fafc');
      doc.rect(40, itemY + 20, 515, 0.5).fill('#e2e8f0');

      doc.font('Helvetica').fontSize(8).fillColor('#334155');
      doc.text(it.num, 45, itemY + 5, { width: 20 });
      doc.text(it.desc, 70, itemY + 5, { width: 200 });
      doc.text(it.hs, 275, itemY + 5, { width: 65 });
      doc.text(it.qty, 345, itemY + 5, { width: 50 });
      doc.text(it.unit, 400, itemY + 5, { width: 55 });
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text(it.total, 460, itemY + 5, { width: 90, align: 'right' });

      itemY += 21;
    }

    doc.y = itemY + 6;

    // Totals Box
    doc.rect(340, doc.y, 215, 52).fill('#f1f5f9');
    doc.rect(340, doc.y, 215, 52).lineWidth(0.5).stroke('#cbd5e1');

    doc.font('Helvetica').fontSize(8).fillColor('#475569');
    doc.text('Subtotal:', 350, doc.y + 6);
    doc.text('EUR 148,500.00', 440, doc.y + 6, { width: 105, align: 'right' });

    doc.text('Freight & Insurance (CIF):', 350, doc.y + 18);
    doc.text('INCLUDED (EUR 0.00)', 440, doc.y + 18, { width: 105, align: 'right' });

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
    doc.text('Total Invoice Value:', 350, doc.y + 34);
    doc.text('EUR 148,500.00', 440, doc.y + 34, { width: 105, align: 'right' });

    doc.y += 65;

    // Declarations & Certifications
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('COMPLIANCE & ORIGIN CERTIFICATION', 40, doc.y);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(8).fillColor('#475569');
    doc.text('1. We hereby certify that the goods listed above are exclusively of German origin and are designed strictly for standard industrial civilian tooling.', 40, doc.y, { width: 515 });
    doc.moveDown(0.3);
    doc.text('2. These items do not fall under EU Dual-Use Regulation (EU) 2021/821 or Military Control Lists. ECCN: EAR99 / Non-Controlled.', 40, doc.y, { width: 515 });
    doc.moveDown(0.3);
    doc.text('3. Neither the exporter, importer, carrier, nor issuing bank are subject to any UN, EU, UK OFSI, or US OFAC sanctions restrictions.', 40, doc.y, { width: 515 });

    doc.moveDown(1.5);

    // Signatures
    doc.text('Authorized Signatory: __________________________', 40, doc.y);
    doc.text('Company Stamp: Precision Engineering GmbH', 320, doc.y);
    doc.moveDown(0.3);
    doc.text('Dr. Klaus Schneider, Head of International Trade', 40, doc.y);
  });
}

// --------------------------------------------------------------------------
// 2. MODERATE RISK DOCUMENT (REVIEW - Risk Score ~ 50/100)
// --------------------------------------------------------------------------
async function generateModerateRiskDoc() {
  const filePath = path.join(rootDir, 'Sample_2_Moderate_Risk_Document.pdf');
  await createPdfFile(filePath, (doc) => {
    // Header
    doc.rect(40, 40, 515, 30).fill('#d97706');
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text('IRREVOCABLE COMMERCIAL TRADE PRESENTATION', 50, 49);
    doc.font('Helvetica').fontSize(8).fillColor('#fffbeb').text('STATUS: ENHANCED DUE DILIGENCE REQUIRED', 350, 50, { align: 'right', width: 195 });

    doc.y = 85;

    // Document Meta
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text('GLOBAL ELECTRONICS EXPORTS FZE', 40, doc.y);
    doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
    doc.text('Jebel Ali Free Zone (JAFZA) Authority, Plot 89-B, Dubai, United Arab Emirates');
    doc.text('Trade License: DXB-FZ-88301 | Contact: logistics@global-elect-fze.ae');
    doc.moveDown(0.8);

    // Grid
    const gridY = doc.y;
    doc.rect(40, gridY, 250, 108).fill('#fffbeb');
    doc.rect(40, gridY, 250, 108).lineWidth(0.5).stroke('#fde68a');

    doc.rect(305, gridY, 250, 108).fill('#fffbeb');
    doc.rect(305, gridY, 250, 108).lineWidth(0.5).stroke('#fde68a');

    // Left Box: Invoice Meta
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#92400e').text('TRANSACTION IDENTIFIERS & ROUTE', 48, gridY + 8);
    doc.font('Helvetica').fontSize(8).fillColor('#334155');
    doc.text('Invoice Ref: EXP-2026-FZE-7712', 48, gridY + 22);
    doc.text('Date of Issue: 2026-08-28', 48, gridY + 34);
    doc.text('LC Number: LC-DXB-AZ-99014', 48, gridY + 46);
    doc.text('Port of Loading: Jebel Ali Port, UAE', 48, gridY + 58);
    doc.text('Transshipment Port: Bandar Abbas Free Zone (Transit Hub)', 48, gridY + 70);
    doc.text('Port of Discharge: Baku Port, Azerbaijan', 48, gridY + 82);
    doc.text('Incoterm: CIP Baku (Incoterms 2020)', 48, gridY + 94);

    // Right Box: Counterparties & TBML Alerts
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#92400e').text('PARTIES & CONFLICTING CONSIGNMENT', 313, gridY + 8);
    doc.font('Helvetica').fontSize(8).fillColor('#334155');
    doc.text('Buyer: Caspian Distribution Trading LLC (Baku, Azerbaijan)', 313, gridY + 22);
    doc.text('Consignee: Orient Hub Freight Forwarding LLC (Third-Party)', 313, gridY + 34);
    doc.text('Issuing Bank: International Bank of Azerbaijan (Baku)', 313, gridY + 46);
    doc.text('Advising Bank: Emirates NBD Bank PJSC (Dubai, UAE)', 313, gridY + 58);
    doc.text('Ultimate End-User: Unspecified / "To Order of Consignee"', 313, gridY + 70);
    doc.text('End-Use Stated: Regional Wholesale Telecommunications', 313, gridY + 82);
    doc.text('Special Clause: Partial shipments & transit storage allowed', 313, gridY + 94);

    doc.y = gridY + 120;

    // Goods Table
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text('COMMODITY & DUAL-USE SCOPE LISTING', 40, doc.y);
    doc.moveDown(0.3);

    const tblY = doc.y;
    doc.rect(40, tblY, 515, 18).fill('#451a03');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    doc.text('#', 45, tblY + 5, { width: 20 });
    doc.text('Description of Equipment', 70, tblY + 5, { width: 190 });
    doc.text('HS / ECCN', 265, tblY + 5, { width: 75 });
    doc.text('Quantity', 345, tblY + 5, { width: 50 });
    doc.text('Unit Price', 400, tblY + 5, { width: 55 });
    doc.text('Total (USD)', 460, tblY + 5, { width: 90, align: 'right' });

    let itemY = tblY + 18;

    const items = [
      { num: '1', desc: 'Gigabit Enterprise Layer-3 Switching Routers (5A002 Category)', hs: '8517.62.00 / 5A002', qty: '80 UNITS', unit: 'USD 4,200.00', total: '336,000.00' },
      { num: '2', desc: 'High-Gain Microwave Signal Transceiver Modules (Dual-Band)', hs: '8517.69.90 / EAR99', qty: '120 UNITS', unit: 'USD 1,850.00', total: '222,000.00' },
      { num: '3', desc: 'Fiber Optic High Density Distribution Panels & SFP Transceivers', hs: '8544.70.00', qty: '300 SETS', unit: 'USD 310.00', total: '93,000.00' },
    ];

    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (i % 2 === 0) doc.rect(40, itemY, 515, 20).fill('#fffbeb');
      doc.rect(40, itemY + 20, 515, 0.5).fill('#fed7aa');

      doc.font('Helvetica').fontSize(7.5).fillColor('#334155');
      doc.text(it.num, 45, itemY + 5, { width: 20 });
      doc.text(it.desc, 70, itemY + 5, { width: 190 });
      doc.text(it.hs, 265, itemY + 5, { width: 75 });
      doc.text(it.qty, 345, itemY + 5, { width: 50 });
      doc.text(it.unit, 400, itemY + 5, { width: 55 });
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a').text(it.total, 460, itemY + 5, { width: 90, align: 'right' });

      itemY += 21;
    }

    doc.y = itemY + 6;

    // Totals Box
    doc.rect(340, doc.y, 215, 52).fill('#fef3c7');
    doc.rect(340, doc.y, 215, 52).lineWidth(0.5).stroke('#fde68a');

    doc.font('Helvetica').fontSize(8).fillColor('#78350f');
    doc.text('Total Commodities Value:', 350, doc.y + 6);
    doc.text('USD 651,000.00', 440, doc.y + 6, { width: 105, align: 'right' });

    doc.text('Handling & Transit Security:', 350, doc.y + 18);
    doc.text('USD 14,000.00', 440, doc.y + 18, { width: 105, align: 'right' });

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#451a03');
    doc.text('Total Presentation Value:', 350, doc.y + 34);
    doc.text('USD 665,000.00', 440, doc.y + 34, { width: 105, align: 'right' });

    doc.y += 65;

    // Red Flags Note
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#b45309').text('COMPLIANCE DISCREPANCY & RED FLAG NOTICES', 40, doc.y);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(8).fillColor('#78350f');
    doc.text('• NOTICE 1 (Consignee Disconnection): Consignee Orient Hub is a third-party intermediary forwarding agent located in a Free Trade Zone rather than the verified corporate buyer.', 40, doc.y, { width: 515 });
    doc.moveDown(0.3);
    doc.text('• NOTICE 2 (Dual-Use / License Requirement): Item #1 Layer-3 Routers fall under ECCN 5A002 encryption controls; export license or verified license exception declaration must be provided prior to bank release.', 40, doc.y, { width: 515 });
    doc.moveDown(0.3);
    doc.text('• NOTICE 3 (End-User Identification): Ultimate End-User Certificate (EUC) is currently pending submission by buyer.', 40, doc.y, { width: 515 });

    doc.moveDown(1.5);
    doc.text('Prepared by: Farooq Al-Mansoor, Senior Trade Officer | Global Electronics FZE', 40, doc.y);
  });
}

// --------------------------------------------------------------------------
// 3. HIGH RISK / SANCTIONED DOCUMENT (BLOCK / ESCALATE - Risk Score ~ 98/100)
// --------------------------------------------------------------------------
async function generateHighRiskDoc() {
  const filePath = path.join(rootDir, 'Sample_3_High_Risk_Sanctioned_Document.pdf');
  await createPdfFile(filePath, (doc) => {
    // Header
    doc.rect(40, 40, 515, 30).fill('#991b1b');
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text('OCEAN BILL OF LADING & COMMERCIAL INVOICE', 50, 49);
    doc.font('Helvetica').fontSize(8).fillColor('#fecaca').text('WARNING: HIGH SANCTIONS & OFAC RISK', 350, 50, { align: 'right', width: 195 });

    doc.y = 85;

    // Document Meta
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#7f1d1d').text('SOVCOMFLOT LOGISTICS & MARITIME CORP', 40, doc.y);
    doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
    doc.text('Naberezhnaya Reki Moyki 39, St. Petersburg / Moscow, Russian Federation');
    doc.text('State Development Corp VEB / Vnesheconombank Associated Entity | IMO Company: 5129910');
    doc.moveDown(0.8);

    // Grid
    const gridY = doc.y;
    doc.rect(40, gridY, 250, 110).fill('#fef2f2');
    doc.rect(40, gridY, 250, 110).lineWidth(0.5).stroke('#fca5a5');

    doc.rect(305, gridY, 250, 110).fill('#fef2f2');
    doc.rect(305, gridY, 250, 110).lineWidth(0.5).stroke('#fca5a5');

    // Left Box: Shipment Meta
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#991b1b').text('SANCTIONED VESSEL & ROUTING', 48, gridY + 8);
    doc.font('Helvetica').fontSize(8).fillColor('#334155');
    doc.text('Bill of Lading No: BL-SCF-RU-992014', 48, gridY + 22);
    doc.text('Carrier Vessel: Islamic Republic of Iran Shipping Lines (IRISL)', 48, gridY + 34);
    doc.text('Vessel Flag / IMO: MV IRISL TOUS / IMO 9226956', 48, gridY + 46);
    doc.text('Port of Loading: Novorossiysk Commercial Sea Port, Russia', 48, gridY + 58);
    doc.text('Port of Discharge: Bandar Abbas Port, Iran', 48, gridY + 70);
    doc.text('Destination Country: Islamic Republic of Iran (Sanctioned)', 48, gridY + 82);
    doc.text('Incoterms: FOB Novorossiysk Port', 48, gridY + 94);

    // Right Box: Sanctioned Parties & Banks
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#991b1b').text('SANCTIONED COUNTERPARTIES & BANKS', 313, gridY + 8);
    doc.font('Helvetica').fontSize(8).fillColor('#334155');
    doc.text('Shipper / Seller: Sovcomflot / Vnesheconombank (Russia)', 313, gridY + 22);
    doc.text('Buyer: Al-Manar Petrochemicals & Heavy Industries (Tehran, Iran)', 313, gridY + 34);
    doc.text('Consignee: Shahid Hemmat Industrial Group (Tehran, Iran)', 313, gridY + 46);
    doc.text('Issuing Bank: Bank Melli Iran (SWIFT: MELIIRTH, Tehran)', 313, gridY + 58);
    doc.text('Intermediary Bank: Vnesheconombank / VEB.RF (Moscow)', 313, gridY + 70);
    doc.text('Ultimate End-User: Ministry of Defense Proliferation Entity', 313, gridY + 82);
    doc.text('Payment: USD 2,450,000 via Non-Standard Offshore Channel', 313, gridY + 94);

    doc.y = gridY + 120;

    // Goods Table
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#991b1b').text('MILITARY & CONTROLLED DUAL-USE ITEMS', 40, doc.y);
    doc.moveDown(0.3);

    const tblY = doc.y;
    doc.rect(40, tblY, 515, 18).fill('#7f1d1d');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    doc.text('#', 45, tblY + 5, { width: 20 });
    doc.text('Description of Material / Equipment', 70, tblY + 5, { width: 190 });
    doc.text('HS / ECCN', 265, tblY + 5, { width: 75 });
    doc.text('Quantity', 345, tblY + 5, { width: 50 });
    doc.text('Unit Price', 400, tblY + 5, { width: 55 });
    doc.text('Total (USD)', 460, tblY + 5, { width: 90, align: 'right' });

    let itemY = tblY + 18;

    const items = [
      { num: '1', desc: 'Inertial Navigation Systems & High-Precision Ring Laser Gyroscopes', hs: '9014.20.00 / 7A003', qty: '10 UNITS', unit: 'USD 125,000.00', total: '1,250,000.00' },
      { num: '2', desc: 'Aerospace-Grade High-Strength Titanium Alloy Seamless Tubes', hs: '8108.90.70 / 1C002', qty: '4,000 KG', unit: 'USD 225.00', total: '900,000.00' },
      { num: '3', desc: 'Military Radar Frequency Synthesizers & Micro-Electronics Assemblies', hs: '8526.10.00 / 3A001', qty: '50 SETS', unit: 'USD 6,000.00', total: '300,000.00' },
    ];

    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (i % 2 === 0) doc.rect(40, itemY, 515, 20).fill('#fef2f2');
      doc.rect(40, itemY + 20, 515, 0.5).fill('#fca5a5');

      doc.font('Helvetica').fontSize(7.5).fillColor('#334155');
      doc.text(it.num, 45, itemY + 5, { width: 20 });
      doc.text(it.desc, 70, itemY + 5, { width: 190 });
      doc.text(it.hs, 265, itemY + 5, { width: 75 });
      doc.text(it.qty, 345, itemY + 5, { width: 50 });
      doc.text(it.unit, 400, itemY + 5, { width: 55 });
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#7f1d1d').text(it.total, 460, itemY + 5, { width: 90, align: 'right' });

      itemY += 21;
    }

    doc.y = itemY + 6;

    // Totals Box
    doc.rect(340, doc.y, 215, 42).fill('#fee2e2');
    doc.rect(340, doc.y, 215, 42).lineWidth(0.5).stroke('#f87171');

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#991b1b');
    doc.text('Total Declared Value:', 350, doc.y + 14);
    doc.text('USD 2,450,000.00', 440, doc.y + 14, { width: 105, align: 'right' });

    doc.y += 55;

    // Sanctions Violations Warnings
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#991b1b').text('CRITICAL REGULATORY VIOLATIONS IDENTIFIED', 40, doc.y);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(8).fillColor('#7f1d1d');
    doc.text('• CRITICAL 1 (OFAC SDN Match): Shipper Sovcomflot, Intermediary Vnesheconombank, and Issuing Bank Melli Iran are designated on the US Treasury OFAC SDN List & EU Sanctions List.', 40, doc.y, { width: 515 });
    doc.moveDown(0.3);
    doc.text('• CRITICAL 2 (Comprehensive Sanctions): Destination Iran is subject to comprehensive US/EU trade embargoes.', 40, doc.y, { width: 515 });
    doc.moveDown(0.3);
    doc.text('• CRITICAL 3 (Military Proliferation): Inertial navigation gyros (ECCN 7A003) and titanium tubes (1C002) are controlled under Missile Technology Control Regime (MTCR) Annex.', 40, doc.y, { width: 515 });

    doc.moveDown(1.5);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#991b1b');
    doc.text('MANDATORY COMPLIANCE DIRECTIVE: HALT ALL PAYMENTS AND REPORT TO OFAC / FINANCIAL INTELLIGENCE UNIT (FIU).', 40, doc.y, { width: 515 });
  });
}

async function main() {
  console.log('Generating 3 test trade compliance documents in PDF format...');
  await generateVerySafeDoc();
  console.log('Created: Sample_1_Very_Safe_Document.pdf');
  await generateModerateRiskDoc();
  console.log('Created: Sample_2_Moderate_Risk_Document.pdf');
  await generateHighRiskDoc();
  console.log('Created: Sample_3_High_Risk_Sanctioned_Document.pdf');
  console.log('All 3 documents successfully generated in the root directory!');
}

main().catch((err) => {
  console.error('Error generating sample docs:', err);
  process.exit(1);
});
