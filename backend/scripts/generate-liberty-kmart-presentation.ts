import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const sampleReportsDir = path.resolve(__dirname, '../../sample_reports');
if (!fs.existsSync(sampleReportsDir)) {
  fs.mkdirSync(sampleReportsDir, { recursive: true });
}

function createPdf(filePath: string, buildFn: (doc: PDFKit.PDFDocument) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 36,
      info: {
        Title: path.basename(filePath),
        Author: 'TradeGuard Document Intelligence System',
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

// ============================================================================
// 1. COMMERCIAL INVOICE (Image 1: Liberty Mills Limited -> Kmart Australia Ltd)
// ============================================================================
async function generateCommercialInvoice() {
  const filePath = path.join(sampleReportsDir, 'Liberty_Mills_Commercial_Invoice_INV-5771.pdf');
  await createPdf(filePath, (doc) => {
    // 1. Company Header
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a').text('LIBERTY MILLS LIMITED', 36, 36, { align: 'center', width: 523 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#475569').text('EXPORT REG NO. 023579', 36, 54, { align: 'center', width: 523 });
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0284c7').text('COMMERCIAL INVOICE', 36, 68, { align: 'center', width: 523 });

    // 2. Invoice Meta & Mill Contacts
    const metaY = 88;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f172a').text('INV # LM-LHT/25-26/5771   •   DATED: 20.02.2026', 36, metaY, { width: 280 });
    
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569');
    doc.text('MILL: A/51-A, S.I.T.E. KARACHI-PAKISTAN\nTEL: (92-21) 2578103-14  |  FAX: (92-21) 2561050\nEmail: asif.yunus@libertymillslimited.com', 300, metaY, { width: 259, align: 'right', lineGap: 1.5 });

    doc.rect(36, 126, 523, 1).fill('#cbd5e1');

    // 3. Parties & Logistics Grid
    const partyY = 132;
    const boxH = 96;
    doc.rect(36, partyY, 255, boxH).fill('#f8fafc').stroke('#cbd5e1');
    doc.rect(298, partyY, 261, boxH).fill('#f8fafc').stroke('#cbd5e1');

    // Left Box
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text('ACCOUNT & RISK OF (BUYER / IMPORTER):', 42, partyY + 7, { width: 243 });
    doc.font('Helvetica').fontSize(7.5).fillColor('#1e293b');
    doc.text('KMART AUSTRALIA LIMITED\n1 MIDDLE ROAD, CHADSTONE, MULGRAVE\nVICTORIA, AUSTRALIA 3148\n\nTERMS: 120 DAYS D/A   •   METHOD: OPEN ACCOUNT\nINCOTERMS: FOB KARACHI BY SEA', 42, partyY + 20, { width: 243, lineGap: 1.5 });

    // Right Box
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text('SHIPMENT, LOGISTICS & BANKING:', 304, partyY + 7, { width: 249 });
    doc.font('Helvetica').fontSize(7.5).fillColor('#1e293b');
    doc.text('CARRIAGE: BY SEA PER SS - V (KARACHI TO FREMANTLE)\nBANK: NATIONAL BANK OF PAKISTAN (NBP)\nBRANCH: CORPORATE BRANCH CHAPAL PLAZA, KARACHI\nPACKAGES: 1,150 CRTNS (QUILT COVER SETS & BED SHEETS)\nNET WT: 2,675.33 KGS   |   GR WT: 8,147.51 KGS', 304, partyY + 20, { width: 249, lineGap: 2 });

    // 4. Goods Table Header
    const tblY = 236;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f172a').text('DESCRIPTION OF MERCHANDISE & PRICING BREAKDOWN', 36, tblY, { width: 523 });

    const tblHeadY = tblY + 14;
    doc.rect(36, tblHeadY, 523, 16).fill('#0f172a');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
    doc.text('Description of Goods / Size', 42, tblHeadY + 4, { width: 175 });
    doc.text('Article / PO #', 222, tblHeadY + 4, { width: 95 });
    doc.text('Cartons', 320, tblHeadY + 4, { width: 42, align: 'center' });
    doc.text('Quantity (Sets)', 366, tblHeadY + 4, { width: 62, align: 'center' });
    doc.text('Unit Price (FOB)', 432, tblHeadY + 4, { width: 62, align: 'right' });
    doc.text('Total (USD)', 498, tblHeadY + 4, { width: 55, align: 'right' });

    let rowY = tblHeadY + 16;
    const items = [
      { desc: 'PLAID FLANNELETTE QB QCS', art: '73680291 / PO-21167387', crtns: 38, qty: 76, unit: '$9.16', total: '$696.16' },
      { desc: 'PLAID FLANNELETTE KB QCS', art: '73680307 / PO-21167387', crtns: 25, qty: 100, unit: '$10.07', total: '$1,007.00' },
      { desc: 'MARLE GREEN F/LETTE SB', art: '73689065 / PO-21167387', crtns: 10, qty: 20, unit: '$7.71', total: '$154.20' },
      { desc: 'MARLE GREEN F/LETTE DB', art: '73689072 / PO-21167387', crtns: 36, qty: 72, unit: '$9.08', total: '$653.76' },
      { desc: 'MARLE GREEN F/LETTE QB', art: '73689089 / PO-21167387', crtns: 92, qty: 368, unit: '$10.18', total: '$3,746.24' },
      { desc: 'MARLE GREEN F/LETTE KB', art: '73689096 / PO-21167387', crtns: 61, qty: 122, unit: '$11.69', total: '$1,426.18' },
      { desc: 'MARLE BLUE F/LETTE SB', art: '73689119 / PO-21167387', crtns: 25, qty: 50, unit: '$7.71', total: '$385.50' },
      { desc: 'MARLE BLUE F/LETTE DB', art: '73689126 / PO-21167387', crtns: 29, qty: 58, unit: '$9.08', total: '$526.64' },
      { desc: 'MARLE BLUE F/LETTE QB', art: '73689133 / PO-21167387', crtns: 56, qty: 224, unit: '$10.18', total: '$2,280.32' },
      { desc: 'MARLE BLUE F/LETTE KB', art: '73689140 / PO-21167387', crtns: 61, qty: 122, unit: '$11.69', total: '$1,426.18' },
      { desc: 'FLORAL F/LETTE SB & DB', art: '73689171 / PO-21167387', crtns: 106, qty: 212, unit: '$8.50', total: '$1,801.66' },
      { desc: 'FLORAL F/LETTE QB & KB', art: '73689201 / PO-21167387', crtns: 120, qty: 396, unit: '$10.55', total: '$4,157.92' },
      { desc: 'GINGHAM GREY F/LETTE (SB/DB/QB/KB)', art: '73689263 / PO-21167387', crtns: 264, qty: 550, unit: '$9.86', total: '$5,426.84' },
      { desc: 'GINGHAM SAGE F/LETTE (SB/DB/QB/KB)', art: '73689300 / PO-21167387', crtns: 227, qty: 696, unit: '$9.67', total: '$6,730.07' },
    ];

    const rowH = 13.5;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.rect(36, rowY, 523, rowH).fill(bg);
      doc.font('Helvetica').fontSize(7.5).fillColor('#1e293b');
      doc.text(it.desc, 42, rowY + 3, { width: 175 });
      doc.text(it.art, 222, rowY + 3, { width: 95 });
      doc.text(String(it.crtns), 320, rowY + 3, { width: 42, align: 'center' });
      doc.text(String(it.qty), 366, rowY + 3, { width: 62, align: 'center' });
      doc.text(it.unit, 432, rowY + 3, { width: 62, align: 'right' });
      doc.text(it.total, 498, rowY + 3, { width: 55, align: 'right' });
      rowY += rowH;
    }

    // Table Total
    doc.rect(36, rowY, 523, 17).fill('#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
    doc.text('TOTAL FOB KARACHI (USD):', 42, rowY + 4, { width: 270 });
    doc.text('1,150 CRTNS', 320, rowY + 4, { width: 42, align: 'center' });
    doc.text('3,066 SETS', 366, rowY + 4, { width: 62, align: 'center' });
    doc.text('USD $30,412.66', 460, rowY + 4, { width: 93, align: 'right' });

    // 5. Bottom Certification & Signatures (Full-width clean layout)
    const bottomY = rowY + 24;
    doc.rect(36, bottomY, 523, 62).fill('#f8fafc').stroke('#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text('AMOUNT IN WORDS: US$ THIRTY THOUSAND FOUR HUNDRED TWELVE DOLLARS AND CENTS SIXTY SIX ONLY', 42, bottomY + 7, { width: 511 });
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text('LIBERTY MILLS LIMITED Karachi hereby declare that all particulars in respect of all above goods are true and correct and we hereby certify that the merchandise is of Pakistan Origin.', 42, bottomY + 20, { width: 511, lineGap: 1.5 });

    // Signatures
    const signY = bottomY + 72;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
    doc.text('Certified by: LIBERTY MILLS LIMITED\n[STAMP & AUTHORIZED SIGNATURE]\nEXPORT MANAGER', 36, signY, { width: 250 });
    doc.text('Accepted on behalf of:\nKMART AUSTRALIA LIMITED\n[IMPORT RECEIVING DESK]', 320, signY, { width: 239, align: 'right' });
  });
}

// ============================================================================
// 2. SALES CONTRACT (Image 2: Liberty Mills Limited <-> Kmart Australia Ltd)
// ============================================================================
async function generateSalesContract() {
  const filePath = path.join(sampleReportsDir, 'Liberty_Mills_Sales_Contract_CTR-050.pdf');
  await createPdf(filePath, (doc) => {
    // 1. Header
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a').text('LIBERTY MILLS LIMITED', 36, 36, { align: 'center', width: 523 });
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text('MILLS: A/51-A, S.I.T.E., KARACHI-75700 (PAKISTAN)  |  PHONES: (92-21) 32578100-16\nWebsite: www.libertymillslimited.com', 36, 54, { align: 'center', width: 523, lineGap: 2 });

    // 2. Banner Box
    const bannerY = 82;
    doc.rect(36, bannerY, 523, 22).fill('#f1f5f9').stroke('#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0f172a').text('SALES CONTRACT & PURCHASE CONFIRMATION', 36, bannerY + 6, { align: 'center', width: 523 });

    // 3. Parties & Contract Info
    const infoY = 112;
    doc.rect(36, infoY, 255, 68).fill('#f8fafc').stroke('#cbd5e1');
    doc.rect(298, infoY, 261, 68).fill('#f8fafc').stroke('#cbd5e1');

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text('BUYER / IMPORTER:', 42, infoY + 6);
    doc.font('Helvetica').fontSize(7.5).fillColor('#1e293b');
    doc.text('M/s KMART AUSTRALIA LTD, AUSTRALIA\n690 SPRINGVALE ROAD, MULGRAVE\nVICTORIA, AUSTRALIA 3170', 42, infoY + 18, { width: 243, lineGap: 2 });

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0284c7').text('CONTRACT REF: LHT-KMART-050/2026', 304, infoY + 6);
    doc.font('Helvetica').fontSize(7.5).fillColor('#1e293b');
    doc.text('DATE: 15.01.2026\nINCOTERMS: F.O.B. KARACHI\nPAYMENT TERMS: 120 DAYS D/A', 304, infoY + 18, { width: 249, lineGap: 2 });

    // 4. Agreement Note
    const noteY = 188;
    doc.font('Helvetica').fontSize(8).fillColor('#334155').text('We confirm having sold to you the goods detailed below, under the terms and conditions agreed in the master supply framework:', 36, noteY, { width: 523 });
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text('Description: 48% COTTON 52% POLYESTER REACTIVE DYED FLAT/FITTED SHEETS & PILLOW CASES; 100% COTTON FLANNEL PRINTED/DYED SHEET SETS.', 36, noteY + 14, { width: 523 });

    // 5. Items Table
    const tblHeadY = 224;
    doc.rect(36, tblHeadY, 523, 16).fill('#0f172a');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
    doc.text('Product Description / Sheet Sets', 42, tblHeadY + 4, { width: 230 });
    doc.text('Contract Quantity', 275, tblHeadY + 4, { width: 90, align: 'right' });
    doc.text('Unit Price (USD)', 370, tblHeadY + 4, { width: 80, align: 'right' });
    doc.text('Total Amount (USD)', 455, tblHeadY + 4, { width: 95, align: 'right' });

    let rowY = tblHeadY + 16;
    const items = [
      { desc: 'SHEET SET SB (Single Bed)', qty: '53,700 PCS', unit: '$7.15', total: '$383,955.20' },
      { desc: 'SHEET SET DB (Double Bed)', qty: '28,873 PCS', unit: '$9.37', total: '$270,543.37' },
      { desc: 'SHEET SET QB (Queen Bed)', qty: '63,352 PCS', unit: '$9.99', total: '$632,887.84' },
      { desc: 'SHEET SET KB (King Bed)', qty: '22,703 PCS', unit: '$10.98', total: '$249,284.08' },
      { desc: 'FITTED SB', qty: '632 PCS', unit: '$3.16', total: '$1,997.12' },
      { desc: 'FITTED DB', qty: '1,532 PCS', unit: '$3.91', total: '$5,990.12' },
      { desc: 'FITTED QB', qty: '2,833 PCS', unit: '$4.27', total: '$12,096.91' },
      { desc: 'FITTED KB', qty: '493 PCS', unit: '$4.68', total: '$2,307.24' },
      { desc: 'EURO PILLOW CASES', qty: '1,826 PCS', unit: '$1.20', total: '$2,191.20' },
      { desc: 'STD PILLOW CASES', qty: '8,277 PCS', unit: '$0.88', total: '$7,283.76' },
    ];

    const rowH = 15;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.rect(36, rowY, 523, rowH).fill(bg);
      doc.font('Helvetica').fontSize(7.5).fillColor('#1e293b');
      doc.text(it.desc, 42, rowY + 4, { width: 230 });
      doc.text(it.qty, 275, rowY + 4, { width: 90, align: 'right' });
      doc.text(it.unit, 370, rowY + 4, { width: 80, align: 'right' });
      doc.text(it.total, 455, rowY + 4, { width: 95, align: 'right' });
      rowY += rowH;
    }

    doc.rect(36, rowY, 523, 18).fill('#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
    doc.text('TOTAL CONTRACT VALUE:', 42, rowY + 5, { width: 230 });
    doc.text('184,221 PCS', 275, rowY + 5, { width: 90, align: 'right' });
    doc.text('US$ 1,568,536.84', 445, rowY + 5, { width: 105, align: 'right' });

    // 6. Contract Terms Details (Full width)
    const termsY = rowY + 22;
    doc.rect(36, termsY, 523, 74).fill('#f8fafc').stroke('#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a').text('Total Contract Value in Words: US$ One Million Five Hundred Sixty Eight Thousand Five Hundred Thirty Six and Cents Eighty Four Only', 42, termsY + 6, { width: 511 });
    doc.font('Helvetica').fontSize(7.5).fillColor('#1e293b');
    doc.text('• Shipment Window: Jan-2026 to July-2026 (Staged Partial Shipments Allowed)\n• Destination: Any AUSTRALIA Port (FOB Karachi Sea Carriage)\n• Term of Payment: 120 DAYS D/A (Open Account under Global Master Supplier Agreement)', 42, termsY + 26, { width: 511, lineGap: 2.5 });

    // Signatures
    const signY = termsY + 84;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
    doc.text('For: LIBERTY MILLS LIMITED\n[Director / Authorized Signatory]', 42, signY, { width: 240 });
    doc.text('For: KMART AUSTRALIA LTD\n[Buyer Authorized Signatory]', 320, signY, { width: 239, align: 'right' });
  });
}

// ============================================================================
// 3. SEA WAYBILL (Image 3: COSCO SHIPPING LINES)
// ============================================================================
async function generateSeaWaybill() {
  const filePath = path.join(sampleReportsDir, 'Cosco_Shipping_Sea_Waybill_COSU6445585470.pdf');
  await createPdf(filePath, (doc) => {
    // 1. Header
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text('COSCO SHIPPING LINES CO., LTD.', 36, 36, { width: 300 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0284c7').text('SEA WAYBILL — NON-NEGOTIABLE', 300, 36, { width: 259, align: 'right' });

    doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text('Non-Negotiable Sea Waybill for Combined Transport or Port to Port Carriage\nBooking No: 6445585470   •   Sea Waybill No: COSU6445585470', 36, 52, { width: 523, lineGap: 1.5 });

    doc.rect(36, 76, 523, 1).fill('#cbd5e1');

    // 2. Multi-Box Layout
    const row1Y = 82;
    doc.rect(36, row1Y, 255, 62).fill('#f8fafc').stroke('#cbd5e1');
    doc.rect(298, row1Y, 261, 62).fill('#f8fafc').stroke('#cbd5e1');

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a').text('1. SHIPPER (Name & Address):', 42, row1Y + 5);
    doc.font('Helvetica').fontSize(7).fillColor('#1e293b');
    doc.text('DAMCO PAKISTAN (PVT) LTD\n19/B SHAHRAH-E-FAISAL SINDHI MUSLIM COOP SOC KARACHI PK\n* ON BEHALF OF: LIBERTY MILLS / BISMILLAH TEXTILES LTD', 42, row1Y + 16, { width: 243, lineGap: 1.5 });

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a').text('SERVICE CONTRACT & CARRIER REF:', 304, row1Y + 5);
    doc.font('Helvetica').fontSize(7).fillColor('#1e293b');
    doc.text('SERVICE CONTRACT NUMBER: GAA24493\nEXPORT REFERENCES: LM-LHT/25-26/5771\nTYPE OF MOVEMENT: FCL / FCL (CY-CY)', 304, row1Y + 16, { width: 249, lineGap: 1.5 });

    const row2Y = 150;
    doc.rect(36, row2Y, 255, 52).fill('#f8fafc').stroke('#cbd5e1');
    doc.rect(298, row2Y, 261, 52).fill('#f8fafc').stroke('#cbd5e1');

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a').text('2. CONSIGNEE:', 42, row2Y + 5);
    doc.font('Helvetica').fontSize(7).fillColor('#1e293b');
    doc.text('KMART AUSTRALIA LIMITED\n1 MIDDLE ROAD, CHADSTONE VIC 3148, AUSTRALIA\nPH: 61 469806792   |   Email: KMARTISCDEST@KMART.COM.AU', 42, row2Y + 16, { width: 243, lineGap: 1.5 });

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a').text('3. NOTIFY PARTY:', 304, row2Y + 5);
    doc.font('Helvetica').fontSize(7).fillColor('#1e293b');
    doc.text('KMART AUSTRALIA LIMITED\n3 SPARTAN ST JANDAKOT WESTERN AUSTRALIA 6164\nCONTACT: BILL MCQUILLAN (TEL: 61 0449 976 701)', 304, row2Y + 16, { width: 249, lineGap: 1.5 });

    const row3Y = 208;
    doc.rect(36, row3Y, 523, 30).fill('#f1f5f9').stroke('#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a');
    doc.text('OCEAN VESSEL & VOYAGE:', 42, row3Y + 5);
    doc.text('PORT OF LOADING:', 170, row3Y + 5);
    doc.text('PORT OF DISCHARGE:', 304, row3Y + 5);
    doc.text('PLACE OF DELIVERY:', 430, row3Y + 5);

    doc.font('Helvetica').fontSize(7.5).fillColor('#1e293b');
    doc.text('XIN HANG ZHOU 211E', 42, row3Y + 16);
    doc.text('KARACHI, PAKISTAN', 170, row3Y + 16);
    doc.text('FREMANTLE, AUSTRALIA', 304, row3Y + 16);
    doc.text('FREMANTLE, AUSTRALIA', 430, row3Y + 16);

    // Cargo Table
    const cargoY = 246;
    doc.rect(36, cargoY, 523, 16).fill('#0f172a');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
    doc.text('Marks & Container No.', 42, cargoY + 4, { width: 110 });
    doc.text('Packages', 158, cargoY + 4, { width: 70 });
    doc.text('Description of Goods / Invoices', 234, cargoY + 4, { width: 175 });
    doc.text('Gross Weight', 415, cargoY + 4, { width: 68, align: 'right' });
    doc.text('Measurement', 490, cargoY + 4, { width: 63, align: 'right' });

    const cBodyY = cargoY + 16;
    const bodyH = 110;
    doc.rect(36, cBodyY, 523, bodyH).fill('#ffffff').stroke('#cbd5e1');
    doc.font('Helvetica').fontSize(7).fillColor('#1e293b');

    doc.text('SIZE / ITEM / CTN# / QTY\nMADE IN PAKISTAN\nPO # 21167273\nPO # 21167274\nPO # 21167298\nKMART AUSTRALIA\nPORT: FREMANTLE\n04 X 40\' HC CONTAINERS', 42, cBodyY + 6, { width: 110, lineGap: 1.5 });
    doc.text('478 CARTONS\n\n(SHIPPER LOAD,\nSTOW & COUNT)', 158, cBodyY + 6, { width: 70, lineGap: 2 });
    doc.text('SAID TO CONTAIN: 100% COTTON PRINTED MINI SET (QUILTED), QUILT COVER SETS & BED LINEN.\n* ON BEHALF OF SHIPPERS: LIBERTY MILLS / BISMILLAH TEXTILES (PVT) LTD.\nINVOICE NO: LM-LHT/25-26/5771 / 202600138\nHS CODES: 9404.9000, 6302.3920, 6302.3130\nFI / GD NO: ABP-EXP-030942-25022026 / GD-2905', 234, cBodyY + 6, { width: 175, lineGap: 1.5 });

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a');
    doc.text('4,366.300 KGS\n(Part Cargo)', 415, cBodyY + 6, { width: 68, align: 'right', lineGap: 2 });
    doc.text('72.4060 CBM', 490, cBodyY + 6, { width: 63, align: 'right' });

    // Footer
    const footY = cBodyY + bodyH + 16;
    doc.rect(36, footY, 523, 44).fill('#f8fafc').stroke('#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a');
    doc.text('DATE LADEN ON BOARD: 20 MAR 2026   •   PLACE OF ISSUE: KARACHI, PAKISTAN', 42, footY + 8, { width: 320 });
    doc.font('Helvetica').fontSize(7).fillColor('#475569').text('Carrier receives goods in external apparent good order and condition for carriage subject to bill of lading standard terms.', 42, footY + 22, { width: 320 });

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a');
    doc.text('SIGNED FOR THE CARRIER:\nCOSCO SHIPPING LINES CO., LTD.\n[CARRIER SEAL & AGENT SIGNATURE]', 370, footY + 8, { width: 183, align: 'right', lineGap: 1.5 });
  });
}

// ============================================================================
// 4. PAKISTAN CUSTOMS GOODS DECLARATION (GD-I, Bill of Export, Image 4)
// ============================================================================
async function generateCustomsGoodsDeclaration() {
  const filePath = path.join(sampleReportsDir, 'Pakistan_Customs_GD_Bill_of_Export_GD2905.pdf');
  await createPdf(filePath, (doc) => {
    // 1. Header
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text('PAKISTAN CUSTOMS / WeBOC SINGLE WINDOW SYSTEM', 36, 36, { align: 'center', width: 523 });
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0284c7').text('GOODS DECLARATION, GD-I [X] BILL OF EXPORT', 36, 52, { align: 'center', width: 523 });

    // 2. System Meta Banner
    const headY = 70;
    doc.rect(36, headY, 523, 18).fill('#f1f5f9').stroke('#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a');
    doc.text('CUSTOM FILE NO: 2905', 42, headY + 5);
    doc.text('MACHINE NO: KPPE-EF-210518-04-03-2026', 170, headY + 5);
    doc.text('CUSTOMS OFFICE: Port Qasim (exports), Karachi', 360, headY + 5);

    // 3. Grid Row 1 (Exporter / Importer)
    const b1Y = headY + 24;
    doc.rect(36, b1Y, 255, 52).fill('#ffffff').stroke('#cbd5e1');
    doc.rect(298, b1Y, 261, 52).fill('#ffffff').stroke('#cbd5e1');

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a').text('EXPORTER / CONSIGNOR:', 42, b1Y + 5);
    doc.font('Helvetica').fontSize(7).fillColor('#1e293b');
    doc.text('M/S LIBERTY MILLS LIMITED\nA/51-A, SITE KARACHI, SINDH PAKISTAN\nNTN / STRN: 0201511103746', 42, b1Y + 16, { width: 243, lineGap: 1.5 });

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a').text('IMPORTER / CONSIGNEE:', 304, b1Y + 5);
    doc.font('Helvetica').fontSize(7).fillColor('#1e293b');
    doc.text('KMART AUSTRALIA LIMITED\n1 MIDDLE ROAD, CHADSTONE, MULGRAVE, VIC AU 3148\nCOUNTRY OF DESTINATION: AUSTRALIA (AU)', 304, b1Y + 16, { width: 249, lineGap: 1.5 });

    // 4. Grid Row 2 (Agent / Bank & FX)
    const b2Y = b1Y + 58;
    doc.rect(36, b2Y, 255, 52).fill('#f8fafc').stroke('#cbd5e1');
    doc.rect(298, b2Y, 261, 52).fill('#f8fafc').stroke('#cbd5e1');

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a').text('CLEARING AGENT / DECLARANT:', 42, b2Y + 5);
    doc.font('Helvetica').fontSize(7).fillColor('#1e293b');
    doc.text('M/S SALMAN INTERNATIONAL\nAL MADINA CENTRE, JAMA CLOTH, KARACHI\nCHAL NO: 2905   |   TEL: 37516307', 42, b2Y + 16, { width: 243, lineGap: 1.5 });

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a').text('BANK & EXCHANGE CONTROL:', 304, b2Y + 5);
    doc.font('Helvetica').fontSize(7).fillColor('#1e293b');
    doc.text('BANK: NBP (NATIONAL BANK OF PAKISTAN)\nFINANCIAL INSTRUMENT: PK16NBPA1862004045423412\nEXCHANGE RATE: USD 1.00 = PKR 279.350000', 304, b2Y + 16, { width: 249, lineGap: 1.5 });

    // 5. Grid Row 3 (Shipment particulars)
    const b3Y = b2Y + 58;
    doc.rect(36, b3Y, 523, 20).fill('#ffffff').stroke('#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a');
    doc.text('BL/AWB/CON: LM-LHT/25-26/5771', 42, b3Y + 5);
    doc.text('PORT OF SHIPMENT: Port Qasim (exports)', 210, b3Y + 5);
    doc.text('PORT OF DISCHARGE: Fremantle (AU)', 390, b3Y + 5);

    // 6. Customs Goods Items Table
    const itHeadY = b3Y + 26;
    doc.rect(36, itHeadY, 523, 16).fill('#0f172a');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
    doc.text('Item # / Description of Goods', 42, itHeadY + 4, { width: 200 });
    doc.text('Pakistan HS Code', 246, itHeadY + 4, { width: 75 });
    doc.text('Quantity (KG)', 325, itHeadY + 4, { width: 65, align: 'right' });
    doc.text('Declared FOB ($)', 395, itHeadY + 4, { width: 75, align: 'right' });
    doc.text('Assessed PKR Value', 475, itHeadY + 4, { width: 80, align: 'right' });

    const it1Y = itHeadY + 16;
    doc.rect(36, it1Y, 523, 26).fill('#ffffff').stroke('#cbd5e1');
    doc.font('Helvetica').fontSize(7).fillColor('#1e293b');
    doc.text('1. 100% COTTON PIGMENT PRINTED QUILT COVER SETS\nCONST: 20x10/40x44 (UNDER EFS SRO 957)', 42, it1Y + 4, { width: 200, lineGap: 1.5 });
    doc.font('Helvetica-Bold').fontSize(7.5).text('6302.3130', 246, it1Y + 4, { width: 75 });
    doc.font('Helvetica').fontSize(7).text('350.6000 KG\n($4.8578/KG)', 325, it1Y + 4, { width: 65, align: 'right', lineGap: 1.5 });
    doc.text('USD $1,703.14', 395, it1Y + 4, { width: 75, align: 'right' });
    doc.text('PKR 475,773.47', 475, it1Y + 4, { width: 80, align: 'right' });

    const it2Y = it1Y + 26;
    doc.rect(36, it2Y, 523, 26).fill('#f8fafc').stroke('#cbd5e1');
    doc.font('Helvetica').fontSize(7).fillColor('#1e293b');
    doc.text('2. 100% COTTON PIGMENT PRINTED SHEET SETS\nCONST: 20x10/40x44 (UNDER EFS SRO 957)', 42, it2Y + 4, { width: 200, lineGap: 1.5 });
    doc.font('Helvetica-Bold').fontSize(7.5).text('6302.3190', 246, it2Y + 4, { width: 75 });
    doc.font('Helvetica').fontSize(7).text('6,895.0600 KG\n($4.1638/KG)', 325, it2Y + 4, { width: 65, align: 'right', lineGap: 1.5 });
    doc.text('USD $28,709.65', 395, it2Y + 4, { width: 75, align: 'right' });
    doc.text('PKR 8,020,040.96', 475, it2Y + 4, { width: 80, align: 'right' });

    // 7. Summary Totals & Statutory Certification
    const totY = it2Y + 26;
    doc.rect(36, totY, 523, 20).fill('#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f172a');
    doc.text('TOTAL DECLARED EXPORT FOB VALUE:', 42, totY + 5);
    doc.text('USD $30,412.66', 395, totY + 5, { width: 75, align: 'right' });
    doc.text('PKR 8,495,814.43', 475, totY + 5, { width: 80, align: 'right' });

    const footY = totY + 28;
    doc.rect(36, footY, 523, 44).fill('#f8fafc').stroke('#cbd5e1');
    doc.font('Helvetica').fontSize(7).fillColor('#475569');
    doc.text('Total Packages: 1,150 CARTONS   •   Gross Weight: 8.14750 MT (8,147.50 KG)   •   Net Weight: 7.24570 MT (7,245.70 KG)\nStatutory Declaration: This is a verified electronic customs document under Section 2 of Customs Act 1969.\nWeBOC Status: Out of Charge Issued   •   Appraising Completed & Cleared.', 42, footY + 7, { width: 511, lineGap: 2.5 });
  });
}

async function run() {
  console.log('Re-generating clean, non-overlapping Pakistan Export Presentation Dossier PDFs...');
  await generateCommercialInvoice();
  console.log('✓ Re-generated Commercial Invoice');
  await generateSalesContract();
  console.log('✓ Re-generated Sales Contract');
  await generateSeaWaybill();
  console.log('✓ Re-generated Sea Waybill');
  await generateCustomsGoodsDeclaration();
  console.log('✓ Re-generated Customs GD-I Bill of Export');
  console.log('\nAll 4 PDFs regenerated with 100% clean geometry!');
}

run().catch(console.error);
