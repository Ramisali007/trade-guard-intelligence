import PDFDocument from 'pdfkit';
import type { DocumentRecord } from '../models/document.model';
import type { TradeComparisonResult } from './comparison.service';

function formatBytes(bytes: number): string {
  if (!bytes || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return String(dateStr);
  }
}

export async function generatePdfReport(document: DocumentRecord): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Page dimensions: A4 is 595.28 x 841.89 points
    const PAGE_MARGIN = 36;
    const PAGE_WIDTH = 595.28;
    const PAGE_HEIGHT = 841.89;
    const USABLE_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2; // 523.28 pt
    const CONTENT_BOTTOM_LIMIT = PAGE_HEIGHT - 55; // Leave space for footer

    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      bufferPages: true,
      info: {
        Title: `Trade Compliance Dossier - ${document.filename}`,
        Author: 'DocuIntel AI Trade Finance Compliance Platform',
        Subject: 'Automated Sanctions, TBML, Dual-Use & Document Integrity Audit Report',
        Keywords: 'Compliance, Sanctions, AML, TBML, Trade Finance, Audit Report',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', (err) => reject(err));

    const tc = document.analysis?.tradeCompliance;

    // Theme Colors
    const NAVY = '#0f172a';
    const SLATE_DARK = '#1e293b';
    const SLATE_MED = '#475569';
    const SLATE_LIGHT = '#64748b';
    const SLATE_MUTED = '#94a3b8';
    const BG_LIGHT = '#f8fafc';
    const BG_MUTED = '#f1f5f9';
    const BORDER_COLOR = '#e2e8f0';
    const ACCENT_BLUE = '#0284c7';

    // Decision Colors
    const decision = tc?.decision.decision || 'REVIEW';
    const decColor = decision === 'ALLOW' ? '#059669' : decision === 'REVIEW' ? '#d97706' : '#dc2626';
    const decBg = decision === 'ALLOW' ? '#ecfdf5' : decision === 'REVIEW' ? '#fffbeb' : '#fef2f2';
    const decBorder = decision === 'ALLOW' ? '#a7f3d0' : decision === 'REVIEW' ? '#fde68a' : '#fecaca';

    // ==========================================
    // Core Layout Helpers
    // ==========================================

    const checkPageBreak = (neededHeight: number) => {
      if (doc.y + neededHeight > CONTENT_BOTTOM_LIMIT) {
        doc.addPage();
        drawRunningHeader();
      }
    };

    const drawRunningHeader = () => {
      const topY = PAGE_MARGIN;
      // Header background banner
      doc.rect(PAGE_MARGIN, topY, USABLE_WIDTH, 24).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
      doc.text('DOCUINTEL AI — TRADE FINANCE COMPLIANCE & SANCTIONS DOSSIER', PAGE_MARGIN + 10, topY + 7);
      doc.font('Helvetica').fontSize(7).fillColor(SLATE_MUTED);
      doc.text('OFFICIAL AUDIT REPORT', PAGE_MARGIN + USABLE_WIDTH - 120, topY + 8, { width: 110, align: 'right' });
      doc.y = topY + 34;
    };

    const sectionTitle = (title: string, subtitle?: string) => {
      checkPageBreak(subtitle ? 42 : 32);
      doc.moveDown(0.5);
      const y = doc.y;
      
      // Header background bar
      doc.rect(PAGE_MARGIN, y, USABLE_WIDTH, 20).fill(BG_MUTED);
      // Accent vertical left bar
      doc.rect(PAGE_MARGIN, y, 4, 20).fill(ACCENT_BLUE);
      
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SLATE_DARK);
      doc.text(title, PAGE_MARGIN + 12, y + 5);

      if (subtitle) {
        doc.font('Helvetica').fontSize(7).fillColor(SLATE_LIGHT);
        doc.text(subtitle, PAGE_MARGIN + 250, y + 6, { width: USABLE_WIDTH - 255, align: 'right' });
      }

      doc.y = y + 26;
    };

    const keyVal = (key: string, val: string | number | undefined | null, isEven = false) => {
      const displayVal = (val === undefined || val === null || String(val).trim() === '') ? 'Not Disclosed / Not Found' : String(val).trim();
      
      const keyWidth = 145;
      const valWidth = USABLE_WIDTH - keyWidth - 20;

      doc.font('Helvetica-Bold').fontSize(8);
      const keyHeight = doc.heightOfString(key, { width: keyWidth });

      doc.font('Helvetica').fontSize(8);
      const valHeight = doc.heightOfString(displayVal, { width: valWidth });

      const rowHeight = Math.max(keyHeight, valHeight) + 6;
      checkPageBreak(rowHeight);

      const y = doc.y;

      // Optional subtle zebra background
      if (isEven) {
        doc.rect(PAGE_MARGIN, y, USABLE_WIDTH, rowHeight).fill(BG_LIGHT);
      }

      // Border line at bottom
      doc.rect(PAGE_MARGIN, y + rowHeight, USABLE_WIDTH, 0.5).fill(BORDER_COLOR);

      doc.font('Helvetica-Bold').fontSize(8).fillColor(SLATE_MED);
      doc.text(key, PAGE_MARGIN + 8, y + 3, { width: keyWidth });

      doc.font('Helvetica').fontSize(8).fillColor(SLATE_DARK);
      doc.text(displayVal, PAGE_MARGIN + keyWidth + 12, y + 3, { width: valWidth, lineGap: 1.5 });

      doc.y = y + rowHeight + 1;
    };

    // ==========================================
    // Page 1: Top Brand Banner & Metadata Box
    // ==========================================
    drawRunningHeader();

    // Document Metadata Card
    const metaCardY = doc.y;
    const badgeWidth = 145;
    const textSectionWidth = USABLE_WIDTH - badgeWidth - 25;

    // Card background
    doc.rect(PAGE_MARGIN, metaCardY, USABLE_WIDTH, 60).fill(BG_LIGHT);
    doc.rect(PAGE_MARGIN, metaCardY, USABLE_WIDTH, 60).lineWidth(0.75).stroke(BORDER_COLOR);

    // Left info
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY);
    const shortName = document.filename.length > 55 ? document.filename.substring(0, 52) + '...' : document.filename;
    doc.text(shortName, PAGE_MARGIN + 12, metaCardY + 10, { width: textSectionWidth });

    doc.font('Helvetica').fontSize(7.5).fillColor(SLATE_MED);
    const metaLine1 = `Format: ${document.fileType.toUpperCase()}   •   Size: ${formatBytes(document.fileSize)}   •   Pages: ${document.extraction?.pageCount || 1}`;
    const metaLine2 = `Screened At: ${formatDate(document.uploadedAt)}   •   Engine: ${document.analysis?.engine.provider || 'DocuIntel AI Core'}`;
    doc.text(metaLine1, PAGE_MARGIN + 12, metaCardY + 26, { width: textSectionWidth });
    doc.text(metaLine2, PAGE_MARGIN + 12, metaCardY + 38, { width: textSectionWidth });

    // Right Decision Badge Box
    const badgeX = PAGE_MARGIN + USABLE_WIDTH - badgeWidth - 10;
    const badgeY = metaCardY + 8;
    const badgeHeight = 44;

    doc.rect(badgeX, badgeY, badgeWidth, badgeHeight).fill(decBg);
    doc.rect(badgeX, badgeY, badgeWidth, badgeHeight).lineWidth(1).stroke(decBorder);

    doc.font('Helvetica-Bold').fontSize(11).fillColor(decColor);
    doc.text(decision, badgeX, badgeY + 8, { width: badgeWidth, align: 'center' });

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(decColor);
    const riskScoreVal = tc?.riskScores.overall ?? 0;
    const riskLabel = riskScoreVal < 25 ? 'LOW RISK' : riskScoreVal < 60 ? 'ELEVATED RISK' : 'HIGH RISK VIOLATION';
    doc.text(`Overall Risk: ${riskScoreVal}/100 • ${riskLabel}`, badgeX, badgeY + 24, { width: badgeWidth, align: 'center' });

    doc.y = metaCardY + 68;

    if (!tc) {
      doc.font('Helvetica').fontSize(9.5).fillColor(SLATE_MED).text('Trade compliance structured analysis is not available for this record.', PAGE_MARGIN + 10, doc.y);
      doc.end();
      return;
    }

    // ==========================================
    // Section A: Executive Summary & Verdict
    // ==========================================
    sectionTitle('A. EXECUTIVE SUMMARY & COMPLIANCE VERDICT');

    const verdictText = decision === 'ALLOW' 
      ? 'ALLOW — Full Compliance Verification Passed. Presentation complies with sanctions, export controls & trade policy.'
      : decision === 'REVIEW'
      ? 'REVIEW — Manual Compliance Officer Verification Required prior to financing or document release.'
      : 'BLOCK / ESCALATE — Critical Compliance Violation or Sanctions Match Detected. Halt transaction immediately.';

    keyVal('Final Decision', verdictText, true);
    keyVal('Confidence Level', `${Math.round(tc.decision.confidence * 100)}% Confidence Rating (AI Engine)`, false);
    
    const reasonsText = tc.decision.reasons && tc.decision.reasons.length > 0
      ? tc.decision.reasons.join('\n• ')
      : 'Standard compliance validation rules satisfied with no severe anomalies.';
    keyVal('Primary Rationale', reasonsText.startsWith('•') ? reasonsText : `• ${reasonsText}`, true);

    if (tc.decision.triggeredRules && tc.decision.triggeredRules.length > 0) {
      keyVal('Triggered Rules', tc.decision.triggeredRules.join('; '), false);
    }

    // ==========================================
    // Section B: Transaction & Counterparties Profile
    // ==========================================
    sectionTitle('B. TRANSACTION & COUNTERPARTIES PROFILE');

    const docTypeDisplay = `${tc.documentClassification.type}${tc.documentClassification.subtype ? ` (${tc.documentClassification.subtype})` : ''}`;
    keyVal('Document Type', docTypeDisplay, true);
    keyVal('Transaction ID / Ref', tc.transaction.transactionId || 'N/A', false);
    
    if (tc.documentClassification.number) {
      keyVal('Document Number', tc.documentClassification.number, true);
    }

    const sellerName = tc.transaction.parties.seller?.legalName || 'Unspecified';
    const sellerCountry = tc.transaction.parties.seller?.country ? ` [${tc.transaction.parties.seller.country}]` : '';
    keyVal('Seller / Exporter', `${sellerName}${sellerCountry}`, false);

    const buyerName = tc.transaction.parties.buyer?.legalName || 'Unspecified';
    const buyerCountry = tc.transaction.parties.buyer?.country ? ` [${tc.transaction.parties.buyer.country}]` : '';
    keyVal('Buyer / Importer', `${buyerName}${buyerCountry}`, true);

    if (tc.transaction.parties.issuingBank?.legalName) {
      const bankCountry = tc.transaction.parties.issuingBank.country ? ` (${tc.transaction.parties.issuingBank.country})` : '';
      keyVal('Issuing Bank', `${tc.transaction.parties.issuingBank.legalName}${bankCountry}`, false);
    }

    if (tc.transaction.parties.advisingBank?.legalName) {
      keyVal('Advising Bank', tc.transaction.parties.advisingBank.legalName, true);
    }

    keyVal('Consignee', tc.transaction.parties.consignee?.legalName || 'Not Disclosed / As per B/L', false);
    keyVal('Ultimate End-User', tc.transaction.parties.endUser?.legalName || 'Not Disclosed', true);

    const origin = tc.transaction.originCountry || 'N/A';
    const dest = tc.transaction.destinationCountry || 'N/A';
    const incoterm = tc.transaction.incoterm || 'CIF';
    keyVal('Route & Logistics', `${origin} ➔ ${dest} (Incoterm: ${incoterm})`, false);

    const formattedTotal = `${tc.transaction.currency || 'USD'} ${(tc.transaction.totalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    keyVal('Total Declared Value', formattedTotal, true);

    if (tc.transaction.paymentTerms) {
      keyVal('Payment Terms', tc.transaction.paymentTerms, false);
    }

    // ==========================================
    // Section C: Sanctions, Watchlist & Export Controls
    // ==========================================
    sectionTitle('C. SANCTIONS, WATCHLIST & EXPORT CONTROLS');

    const sanctionsStatusText = tc.sanctions.status === 'NONE'
      ? 'CLEARED — No Watchlist Hits (OFAC SDN, UN Consolidated, EU, UK OFSI)'
      : `${tc.sanctions.status} (${tc.sanctions.matches.length} Matches Found)`;
    keyVal('Sanctions Status', sanctionsStatusText, true);

    keyVal('Entities Screened', `${tc.sanctions.screenedEntitiesCount || 0} Entities screened against Global Watchlists`, false);

    const exportStatusText = tc.exportControls.riskStatus === 'NO_CONTROL_CONCERN_IDENTIFIED'
      ? 'NO CONTROL CONCERNS IDENTIFIED — Goods within standard civilian scope'
      : tc.exportControls.riskStatus;
    keyVal('Export Controls / ECCN', exportStatusText, true);

    if (tc.exportControls.controlledGoods && tc.exportControls.controlledGoods.length > 0) {
      const cgText = tc.exportControls.controlledGoods.map(g => `• ${g.itemDescription} (Category: ${g.category}, Control: ${g.controlReason})`).join('\n');
      keyVal('Dual-Use / Controlled Items', cgText, false);
    }

    // ==========================================
    // Section D: Trade-Based Money Laundering (TBML) & Red Flags
    // ==========================================
    sectionTitle('D. TBML & FRAUD INDICATORS SCREENING');

    keyVal('TBML Risk Level', `${tc.tbml.riskLevel} (Score: ${tc.tbml.overallTbmlRiskScore || 0}/100)`, true);
    
    if (tc.tbml.priceConsistencyAssessment) {
      keyVal('Pricing Assessment', tc.tbml.priceConsistencyAssessment, false);
    }

    if (tc.tbml.redFlags && tc.tbml.redFlags.length > 0) {
      checkPageBreak(30);
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#9a3412').text('Identified Red Flags & Anomalies:', PAGE_MARGIN + 8, doc.y);
      doc.moveDown(0.3);

      for (const rf of tc.tbml.redFlags) {
        const flagBoxWidth = USABLE_WIDTH - 16;
        const rfTitle = `[${rf.severity}] ${rf.title}`;
        
        doc.font('Helvetica-Bold').fontSize(8);
        const titleH = doc.heightOfString(rfTitle, { width: flagBoxWidth - 16 });

        doc.font('Helvetica').fontSize(7.5);
        const descH = doc.heightOfString(rf.description, { width: flagBoxWidth - 16 });

        const totalCardHeight = titleH + descH + 14;
        checkPageBreak(totalCardHeight + 4);

        const cardY = doc.y;

        // Card background
        doc.rect(PAGE_MARGIN + 8, cardY, flagBoxWidth, totalCardHeight).fill('#fff7ed');
        doc.rect(PAGE_MARGIN + 8, cardY, flagBoxWidth, totalCardHeight).lineWidth(0.5).stroke('#fed7aa');
        // Left accent bar
        doc.rect(PAGE_MARGIN + 8, cardY, 3, totalCardHeight).fill('#ea580c');

        doc.font('Helvetica-Bold').fontSize(8).fillColor('#9a3412');
        doc.text(rfTitle, PAGE_MARGIN + 16, cardY + 5, { width: flagBoxWidth - 16 });

        doc.font('Helvetica').fontSize(7.5).fillColor('#431407');
        doc.text(rf.description, PAGE_MARGIN + 16, cardY + titleH + 7, { width: flagBoxWidth - 16, lineGap: 1.5 });

        doc.y = cardY + totalCardHeight + 5;
      }
    } else {
      keyVal('Red Flags Identified', 'None — Pricing, volume, and routing metrics conform to standard trade patterns.', false);
    }

    // ==========================================
    // Section E: Explainable 9-Factor Risk Matrix
    // ==========================================
    sectionTitle('E. EXPLAINABLE RISK SCORE MATRIX (0–100 SCALE)');

    const rs = tc.riskScores;
    const scoreItems: Array<{ label: string; val: number }> = [
      { label: '1. Sanctions Risk', val: rs.sanctions },
      { label: '2. Export Control Risk', val: rs.exportControl },
      { label: '3. Goods & Dual-Use Scope', val: rs.goods },
      { label: '4. End-Use Consistency', val: rs.endUse },
      { label: '5. End-User Identification', val: rs.endUser },
      { label: '6. TBML / Pricing Anomalies', val: rs.tbml },
      { label: '7. Mathematical & Doc Integrity', val: rs.documentIntegrity },
      { label: '8. Geographic & Route Risk', val: rs.geographic },
    ];

    const colCount = 2;
    const colWidth = (USABLE_WIDTH - 20) / colCount;
    const rowH = 22;
    const totalMatrixHeight = Math.ceil(scoreItems.length / colCount) * rowH + 10;
    
    checkPageBreak(totalMatrixHeight);

    const startMatrixY = doc.y;

    for (let i = 0; i < scoreItems.length; i++) {
      const item = scoreItems[i]!;
      const colIdx = i % colCount;
      const rowIdx = Math.floor(i / colCount);
      const itemX = PAGE_MARGIN + 10 + colIdx * (colWidth + 10);
      const itemY = startMatrixY + rowIdx * rowH;

      const itemColor = item.val < 25 ? '#059669' : item.val < 60 ? '#d97706' : '#dc2626';
      const itemBg = item.val < 25 ? '#ecfdf5' : item.val < 60 ? '#fffbeb' : '#fef2f2';

      // Item mini card
      doc.rect(itemX, itemY, colWidth, rowH - 4).fill(BG_LIGHT);
      doc.rect(itemX, itemY, colWidth, rowH - 4).lineWidth(0.5).stroke(BORDER_COLOR);

      // Label
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(SLATE_DARK);
      doc.text(item.label, itemX + 6, itemY + 4, { width: colWidth - 85 });

      // Mini meter bar
      const barWidth = 35;
      const barX = itemX + colWidth - 75;
      const barY = itemY + 6;
      doc.rect(barX, barY, barWidth, 4).fill('#e2e8f0');
      const fillW = Math.max(1, (item.val / 100) * barWidth);
      doc.rect(barX, barY, fillW, 4).fill(itemColor);

      // Score text
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(itemColor);
      doc.text(`${item.val}/100`, itemX + colWidth - 36, itemY + 4, { width: 30, align: 'right' });
    }

    doc.y = startMatrixY + Math.ceil(scoreItems.length / colCount) * rowH + 6;

    // ==========================================
    // Section F: Commodities & Goods Breakdown
    // ==========================================
    if (tc.goods && tc.goods.length > 0) {
      sectionTitle('F. COMMODITY LINE ITEMS & PRICING BREAKDOWN', `${tc.goods.length} Items Listed`);

      // Table column widths (sum = USABLE_WIDTH = 523.28)
      const colW = {
        num: 24,
        desc: 180,
        hs: 60,
        qty: 65,
        unit: 75,
        total: 85,
        flag: 34,
      };

      const drawTableHeader = (hdrY: number) => {
        doc.rect(PAGE_MARGIN, hdrY, USABLE_WIDTH, 18).fill(SLATE_DARK);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
        
        let currX = PAGE_MARGIN + 6;
        doc.text('#', currX, hdrY + 5, { width: colW.num });
        currX += colW.num;

        doc.text('Product Description', currX, hdrY + 5, { width: colW.desc });
        currX += colW.desc;

        doc.text('HS / ECCN', currX, hdrY + 5, { width: colW.hs });
        currX += colW.hs;

        doc.text('Qty / UOM', currX, hdrY + 5, { width: colW.qty });
        currX += colW.qty;

        doc.text('Unit Price', currX, hdrY + 5, { width: colW.unit });
        currX += colW.unit;

        doc.text('Total Value', currX, hdrY + 5, { width: colW.total, align: 'right' });
        currX += colW.total;

        doc.text('Dual-Use', currX + 4, hdrY + 5, { width: colW.flag });
      };

      checkPageBreak(40);
      drawTableHeader(doc.y);
      doc.y += 19;

      let itemIndex = 0;
      for (const item of tc.goods) {
        itemIndex++;
        
        doc.font('Helvetica').fontSize(7.5);
        const descText = item.productDescription || 'Item Description Not Provided';
        const descHeight = doc.heightOfString(descText, { width: colW.desc });
        const rowHeight = Math.max(16, descHeight + 6);

        if (doc.y + rowHeight > CONTENT_BOTTOM_LIMIT) {
          doc.addPage();
          drawRunningHeader();
          drawTableHeader(doc.y);
          doc.y += 19;
        }

        const rowY = doc.y;

        // Zebra striping
        if (itemIndex % 2 === 0) {
          doc.rect(PAGE_MARGIN, rowY, USABLE_WIDTH, rowHeight).fill(BG_LIGHT);
        }
        doc.rect(PAGE_MARGIN, rowY + rowHeight, USABLE_WIDTH, 0.5).fill(BORDER_COLOR);

        let currX = PAGE_MARGIN + 6;
        doc.font('Helvetica').fontSize(7.5).fillColor(SLATE_MED);
        doc.text(String(item.itemNumber || itemIndex), currX, rowY + 3, { width: colW.num });
        currX += colW.num;

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(SLATE_DARK);
        doc.text(descText, currX, rowY + 3, { width: colW.desc, lineGap: 1 });
        currX += colW.desc;

        doc.font('Helvetica').fontSize(7.5).fillColor(SLATE_MED);
        const hsDisplay = item.hsCode || item.eccn || 'N/A';
        doc.text(hsDisplay, currX, rowY + 3, { width: colW.hs });
        currX += colW.hs;

        doc.text(`${item.quantity} ${item.unitOfMeasure || ''}`, currX, rowY + 3, { width: colW.qty });
        currX += colW.qty;

        doc.text(`${item.currency || ''} ${(item.unitPrice || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, currX, rowY + 3, { width: colW.unit });
        currX += colW.unit;

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(SLATE_DARK);
        doc.text(`${item.currency || ''} ${(item.totalLineValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, currX, rowY + 3, { width: colW.total, align: 'right' });
        currX += colW.total;

        const isDual = item.isControlledOrDualUse;
        doc.font('Helvetica-Bold').fontSize(7).fillColor(isDual ? '#dc2626' : '#059669');
        doc.text(isDual ? 'YES [!]' : 'NO', currX + 4, rowY + 3, { width: colW.flag });

        doc.y = rowY + rowHeight + 1;
      }
    }

    // ==========================================
    // Section G: Recommended Actions & Checklist
    // ==========================================
    sectionTitle('G. RECOMMENDED ACTIONS & COMPLIANCE CHECKLIST');

    if (tc.decision.recommendedActions && tc.decision.recommendedActions.length > 0) {
      for (const act of tc.decision.recommendedActions) {
        doc.font('Helvetica').fontSize(8);
        const actHeight = doc.heightOfString(act, { width: USABLE_WIDTH - 28 });
        const itemH = Math.max(16, actHeight + 4);
        
        checkPageBreak(itemH);
        const actY = doc.y;

        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ACCENT_BLUE);
        doc.text('▶', PAGE_MARGIN + 8, actY + 1);

        doc.font('Helvetica').fontSize(8).fillColor(SLATE_DARK);
        doc.text(act, PAGE_MARGIN + 22, actY + 1, { width: USABLE_WIDTH - 28, lineGap: 1.5 });

        doc.y = actY + itemH + 2;
      }
    } else {
      keyVal('Recommended Actions', '• No special escalations required. Proceed with standard trade finance document processing.', false);
    }

    // ==========================================
    // Section H: Compliance Officer Sign-off & Audit Seal
    // ==========================================
    checkPageBreak(90);
    doc.moveDown(0.5);
    
    const signBoxY = doc.y;
    const signBoxHeight = 78;

    doc.rect(PAGE_MARGIN, signBoxY, USABLE_WIDTH, signBoxHeight).fill(BG_LIGHT);
    doc.rect(PAGE_MARGIN, signBoxY, USABLE_WIDTH, signBoxHeight).lineWidth(0.75).stroke(BORDER_COLOR);

    doc.font('Helvetica-Bold').fontSize(8).fillColor(SLATE_DARK);
    doc.text('COMPLIANCE OFFICER REVIEW & SIGN-OFF ENDORSEMENT', PAGE_MARGIN + 12, signBoxY + 8);

    doc.font('Helvetica').fontSize(7.5).fillColor(SLATE_MED);
    doc.text('I hereby certify that I have reviewed the automated intelligence dossier and verified the entity screenings against applicable trade regulations.', PAGE_MARGIN + 12, signBoxY + 20, { width: USABLE_WIDTH - 24 });

    const sigLineY = signBoxY + 54;
    
    // Officer Name line
    doc.rect(PAGE_MARGIN + 12, sigLineY, 140, 0.5).fill(SLATE_MUTED);
    doc.text('Compliance Officer Name', PAGE_MARGIN + 12, sigLineY + 3);

    // Signature line
    doc.rect(PAGE_MARGIN + 170, sigLineY, 140, 0.5).fill(SLATE_MUTED);
    doc.text('Authorized Signature', PAGE_MARGIN + 170, sigLineY + 3);

    // Date line
    doc.rect(PAGE_MARGIN + 330, sigLineY, 80, 0.5).fill(SLATE_MUTED);
    doc.text('Date', PAGE_MARGIN + 330, sigLineY + 3);

    // Decision Stamp Box
    doc.rect(PAGE_MARGIN + 425, signBoxY + 36, 85, 32).lineWidth(1).stroke(decColor);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(decColor);
    doc.text(decision, PAGE_MARGIN + 425, signBoxY + 44, { width: 85, align: 'center' });
    doc.font('Helvetica').fontSize(6.5).fillColor(decColor);
    doc.text('OFFICIAL VERDICT', PAGE_MARGIN + 425, signBoxY + 56, { width: 85, align: 'center' });

    // ==========================================
    // Page Footers on All Pages (Buffered Page Range)
    // ==========================================
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);

      const footerY = PAGE_HEIGHT - 38;
      // Separator line
      doc.rect(PAGE_MARGIN, footerY, USABLE_WIDTH, 0.5).fill(BORDER_COLOR);

      doc.font('Helvetica').fontSize(6.5).fillColor(SLATE_MUTED);
      
      const footerLeft = `DocuIntel AI Audit Trail • ID: ${tc.transaction.transactionId || document.id.substring(0, 12)}`;
      doc.text(footerLeft, PAGE_MARGIN, footerY + 6, { width: 220, align: 'left' });

      const footerCenter = `Page ${i + 1} of ${range.count}`;
      doc.text(footerCenter, PAGE_MARGIN + 220, footerY + 6, { width: USABLE_WIDTH - 440, align: 'center' });

      const footerRight = 'STRICTLY CONFIDENTIAL — TRADE COMPLIANCE AUDIT';
      doc.text(footerRight, PAGE_MARGIN + USABLE_WIDTH - 220, footerY + 6, { width: 220, align: 'right' });
    }

    doc.end();
  });
}

export async function generateComparisonPdfReport(comparison: TradeComparisonResult): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const PAGE_MARGIN = 36;
    const PAGE_WIDTH = 595.28;
    const PAGE_HEIGHT = 841.89;
    const USABLE_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2; // 523.28 pt
    const CONTENT_BOTTOM_LIMIT = PAGE_HEIGHT - 55;

    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      bufferPages: true,
      info: {
        Title: `Trade Reconciliation & Comparison Dossier - ${comparison.comparisonId}`,
        Author: 'DocuIntel AI Trade Finance Compliance Platform',
        Subject: 'Cross-Document Trade Finance Reconciliation & UCP 600 Examination Report',
        Keywords: 'Reconciliation, Trade Finance, UCP 600, ISBP 745, Discrepancies, Compliance Matrix',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', (err) => reject(err));

    // Theme Colors
    const NAVY = '#0f172a';
    const SLATE_DARK = '#1e293b';
    const SLATE_MED = '#475569';
    const SLATE_LIGHT = '#64748b';
    const SLATE_MUTED = '#94a3b8';
    const BG_LIGHT = '#f8fafc';
    const BG_MUTED = '#f1f5f9';
    const BORDER_COLOR = '#e2e8f0';
    const ACCENT_BLUE = '#0284c7';

    // Verdict Colors
    const verdict = comparison.verdict;
    const isCompliant = verdict === 'COMPLIANT_PRESENTATION';
    const isDiscrepant = verdict === 'DISCREPANT_PRESENTATION_REQUIRES_AMENDMENT';
    const verdictColor = isCompliant ? '#059669' : isDiscrepant ? '#d97706' : '#dc2626';
    const verdictBg = isCompliant ? '#ecfdf5' : isDiscrepant ? '#fffbeb' : '#fef2f2';
    const verdictBorder = isCompliant ? '#a7f3d0' : isDiscrepant ? '#fde68a' : '#fecaca';

    const checkPageBreak = (neededHeight: number) => {
      if (doc.y + neededHeight > CONTENT_BOTTOM_LIMIT) {
        doc.addPage();
        drawRunningHeader();
      }
    };

    const drawRunningHeader = () => {
      const topY = PAGE_MARGIN;
      doc.rect(PAGE_MARGIN, topY, USABLE_WIDTH, 24).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
      doc.text('DOCUINTEL AI — TRADE RECONCILIATION & COMPARISON DOSSIER', PAGE_MARGIN + 10, topY + 7);
      doc.font('Helvetica').fontSize(7).fillColor(SLATE_MUTED);
      doc.text('UCP 600 & ISBP 745 AUDIT', PAGE_MARGIN + USABLE_WIDTH - 140, topY + 8, { width: 130, align: 'right' });
      doc.y = topY + 34;
    };

    const sectionTitle = (title: string, subtitle?: string) => {
      checkPageBreak(subtitle ? 42 : 32);
      doc.moveDown(0.5);
      const y = doc.y;

      doc.rect(PAGE_MARGIN, y, USABLE_WIDTH, 20).fill(BG_MUTED);
      doc.rect(PAGE_MARGIN, y, 4, 20).fill(ACCENT_BLUE);

      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SLATE_DARK);
      doc.text(title, PAGE_MARGIN + 12, y + 5);

      if (subtitle) {
        doc.font('Helvetica').fontSize(7).fillColor(SLATE_LIGHT);
        doc.text(subtitle, PAGE_MARGIN + 220, y + 6, { width: USABLE_WIDTH - 225, align: 'right' });
      }

      doc.y = y + 26;
    };

    // ==========================================
    // Page 1: Brand Banner & Examination Header
    // ==========================================
    drawRunningHeader();

    // Top Header Card
    const headerCardY = doc.y;
    const scoreBadgeWidth = 140;
    const infoSectionWidth = USABLE_WIDTH - scoreBadgeWidth - 25;

    doc.rect(PAGE_MARGIN, headerCardY, USABLE_WIDTH, 68).fill(BG_LIGHT);
    doc.rect(PAGE_MARGIN, headerCardY, USABLE_WIDTH, 68).lineWidth(0.75).stroke(BORDER_COLOR);

    // Left info
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY);
    doc.text('Multi-Document Trade Reconciliation & Consistency Audit', PAGE_MARGIN + 12, headerCardY + 10, { width: infoSectionWidth });

    doc.font('Helvetica').fontSize(7.5).fillColor(SLATE_MED);
    const line1 = `Ref ID: ${comparison.comparisonId}   •   Documents Compared: ${comparison.documentCount} Files`;
    const line2 = `Examination Date: ${formatDate(comparison.timestamp)}   •   Standard: UCP 600 / ISBP 745 Examination Rules`;
    doc.text(line1, PAGE_MARGIN + 12, headerCardY + 28, { width: infoSectionWidth });
    doc.text(line2, PAGE_MARGIN + 12, headerCardY + 42, { width: infoSectionWidth });

    // Right Consistency Score Badge Box
    const scoreBadgeX = PAGE_MARGIN + USABLE_WIDTH - scoreBadgeWidth - 10;
    const scoreBadgeY = headerCardY + 8;
    const scoreBadgeHeight = 52;

    doc.rect(scoreBadgeX, scoreBadgeY, scoreBadgeWidth, scoreBadgeHeight).fill(verdictBg);
    doc.rect(scoreBadgeX, scoreBadgeY, scoreBadgeWidth, scoreBadgeHeight).lineWidth(1).stroke(verdictBorder);

    doc.font('Helvetica-Bold').fontSize(10).fillColor(verdictColor);
    doc.text(comparison.verdictTitle, scoreBadgeX + 4, scoreBadgeY + 6, { width: scoreBadgeWidth - 8, align: 'center' });

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(verdictColor);
    doc.text(`Consistency: ${comparison.overallConsistencyScore}/100`, scoreBadgeX, scoreBadgeY + 34, { width: scoreBadgeWidth, align: 'center' });

    doc.y = headerCardY + 76;

    // Banking Verdict & Summary Callout Card
    checkPageBreak(75);
    const summaryCardY = doc.y;
    doc.rect(PAGE_MARGIN, summaryCardY, USABLE_WIDTH, 64).fill(verdictBg);
    doc.rect(PAGE_MARGIN, summaryCardY, USABLE_WIDTH, 64).lineWidth(1).stroke(verdictBorder);

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(verdictColor);
    doc.text(`BANKING EXAMINATION VERDICT: ${comparison.verdictTitle.toUpperCase()}`, PAGE_MARGIN + 12, summaryCardY + 8);

    doc.font('Helvetica').fontSize(8).fillColor(SLATE_DARK);
    doc.text(comparison.verdictSummary, PAGE_MARGIN + 12, summaryCardY + 22, { width: USABLE_WIDTH - 24, lineGap: 1.5 });

    // Statistics Pill Row
    const statsPillY = summaryCardY + 44;
    const pillW = (USABLE_WIDTH - 36) / 3;

    // Verified Matches Pill
    doc.rect(PAGE_MARGIN + 12, statsPillY, pillW, 14).fill('#ecfdf5');
    doc.rect(PAGE_MARGIN + 12, statsPillY, pillW, 14).lineWidth(0.5).stroke('#a7f3d0');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#059669');
    doc.text(`[✓] ${comparison.verifiedMatchesCount} Verified Matches`, PAGE_MARGIN + 12, statsPillY + 3, { width: pillW, align: 'center' });

    // Discrepancies Pill
    doc.rect(PAGE_MARGIN + 18 + pillW, statsPillY, pillW, 14).fill('#fffbeb');
    doc.rect(PAGE_MARGIN + 18 + pillW, statsPillY, pillW, 14).lineWidth(0.5).stroke('#fde68a');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#d97706');
    doc.text(`[!] ${comparison.materialDiscrepanciesCount} Discrepancies`, PAGE_MARGIN + 18 + pillW, statsPillY + 3, { width: pillW, align: 'center' });

    // Critical Conflicts Pill
    doc.rect(PAGE_MARGIN + 24 + pillW * 2, statsPillY, pillW, 14).fill('#fef2f2');
    doc.rect(PAGE_MARGIN + 24 + pillW * 2, statsPillY, pillW, 14).lineWidth(0.5).stroke('#fecaca');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#dc2626');
    doc.text(`[✗] ${comparison.criticalConflictsCount} Critical Conflicts`, PAGE_MARGIN + 24 + pillW * 2, statsPillY + 3, { width: pillW, align: 'center' });

    doc.y = summaryCardY + 72;

    // ==========================================
    // Section 1: Compared Trade Presentation Documents
    // ==========================================
    sectionTitle('1. COMPARED TRADE PRESENTATION DOCUMENTS', `${comparison.documents.length} PRESENTATION FILES`);

    for (let i = 0; i < comparison.documents.length; i++) {
      const d = comparison.documents[i];
      if (!d) continue;

      const innerWidth = USABLE_WIDTH - 16;
      doc.font('Helvetica').fontSize(7.5);
      const docLine1 = `Ref #: ${d.documentNumber || 'N/A'}  •  Total Value: ${d.currency || 'USD'} ${Number(d.totalValue || 0).toLocaleString()}  •  Incoterm: ${d.incoterm || 'FOB'}`;
      const docLine2 = `Seller: ${d.parties.seller || 'N/A'}   |   Buyer: ${d.parties.buyer || 'N/A'}${d.parties.consignee ? '   |   Consignee: ' + d.parties.consignee : ''}`;

      const l1H = doc.heightOfString(docLine1, { width: innerWidth, lineGap: 1.5 });
      const l2H = doc.heightOfString(docLine2, { width: innerWidth, lineGap: 1.5 });
      const cardHeight = 22 + l1H + 4 + l2H + 8;

      checkPageBreak(cardHeight + 6);
      const cardY = doc.y;
      doc.rect(PAGE_MARGIN, cardY, USABLE_WIDTH, cardHeight).fill(BG_LIGHT);
      doc.rect(PAGE_MARGIN, cardY, USABLE_WIDTH, cardHeight).lineWidth(0.5).stroke(BORDER_COLOR);

      // Doc Index & Filename
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY);
      doc.text(`Doc ${i + 1}: ${d.filename}`, PAGE_MARGIN + 8, cardY + 6, { width: 340 });

      // Doc Type Badge
      doc.rect(PAGE_MARGIN + 360, cardY + 5, USABLE_WIDTH - 368, 14).fill(BG_MUTED);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(ACCENT_BLUE);
      doc.text(d.documentType || 'Trade Presentation', PAGE_MARGIN + 360, cardY + 8, { width: USABLE_WIDTH - 368, align: 'center' });

      // Key details line 1
      const l1Y = cardY + 22;
      doc.font('Helvetica').fontSize(7.5).fillColor(SLATE_MED);
      doc.text(docLine1, PAGE_MARGIN + 8, l1Y, { width: innerWidth, lineGap: 1.5 });

      // Key details line 2
      const l2Y = l1Y + l1H + 4;
      doc.text(docLine2, PAGE_MARGIN + 8, l2Y, { width: innerWidth, lineGap: 1.5 });

      doc.y = cardY + cardHeight + 4;
    }

    // ==========================================
    // Section 2: Discrepancy & Cross-Document Reconciliation Matrix
    // ==========================================
    sectionTitle('2. DISCREPANCY & CROSS-DOCUMENT RECONCILIATION MATRIX', `${comparison.discrepancies.length} AUDIT CHECKPOINTS`);

    if (comparison.discrepancies.length === 0) {
      checkPageBreak(30);
      doc.font('Helvetica').fontSize(8).fillColor(SLATE_MED).text('No documentary discrepancies detected between presented documents.', PAGE_MARGIN + 10, doc.y);
      doc.y += 18;
    } else {
      for (const disc of comparison.discrepancies) {
        const sev = disc.severity;
        const isConflict = sev === 'CRITICAL_CONFLICT';
        const isMaterial = sev === 'MATERIAL_DISCREPANCY';
        const isMatch = sev === 'VERIFIED_MATCH';

        const sevBg = isConflict ? '#fef2f2' : isMaterial ? '#fffbeb' : isMatch ? '#ecfdf5' : '#f0f9ff';
        const sevBorder = isConflict ? '#fecaca' : isMaterial ? '#fde68a' : isMatch ? '#a7f3d0' : '#bae6fd';
        const sevText = isConflict ? '#dc2626' : isMaterial ? '#d97706' : isMatch ? '#059669' : '#0284c7';
        const sevLabel = isConflict ? 'CRITICAL CONFLICT' : isMaterial ? 'MATERIAL DISCREPANCY' : isMatch ? 'VERIFIED MATCH' : 'COMPATIBLE VARIATION';

        // Prepare text lines
        const compLine = `• ${disc.documentA}: "${disc.valueA}"  vs  ${disc.documentB}: "${disc.valueB}"`;
        const auditText = `Audit Note: ${disc.explanation}`;
        const innerWidth = USABLE_WIDTH - 20;

        // Measure heights dynamically to guarantee zero text collision/overlap
        doc.font('Helvetica').fontSize(7.5);
        const compH = doc.heightOfString(compLine, { width: innerWidth, lineGap: 1.5 });

        doc.font('Helvetica-Oblique').fontSize(7.5);
        const explH = doc.heightOfString(auditText, { width: innerWidth, lineGap: 1.5 });

        const topHeaderH = 18;
        const cardHeight = topHeaderH + compH + 6 + explH + 8;

        checkPageBreak(cardHeight + 6);
        const cardY = doc.y;

        doc.rect(PAGE_MARGIN, cardY, USABLE_WIDTH, cardHeight).fill(BG_LIGHT);
        doc.rect(PAGE_MARGIN, cardY, USABLE_WIDTH, cardHeight).lineWidth(0.5).stroke(BORDER_COLOR);

        // Top Row: Field & Category + Severity Badge
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SLATE_DARK);
        doc.text(`${disc.field}  [${disc.category}]`, PAGE_MARGIN + 10, cardY + 5, { width: 330 });

        // Severity Pill
        const pillWidth = 125;
        const pillX = PAGE_MARGIN + USABLE_WIDTH - pillWidth - 8;
        doc.rect(pillX, cardY + 4, pillWidth, 13).fill(sevBg);
        doc.rect(pillX, cardY + 4, pillWidth, 13).lineWidth(0.5).stroke(sevBorder);
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(sevText);
        doc.text(sevLabel, pillX, cardY + 6.5, { width: pillWidth, align: 'center' });

        // Comparison Row (Doc A vs Doc B) - Positioned with safe offset
        const compY = cardY + topHeaderH + 2;
        doc.font('Helvetica').fontSize(7.5).fillColor(SLATE_MED);
        doc.text(compLine, PAGE_MARGIN + 10, compY, { width: innerWidth, lineGap: 1.5 });

        // Banking Audit Explanation - Dynamic offset placed after comparison text
        const auditY = compY + compH + 4;
        doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(SLATE_DARK);
        doc.text(auditText, PAGE_MARGIN + 10, auditY, { width: innerWidth, lineGap: 1.5 });

        doc.y = cardY + cardHeight + 4;
      }
    }

    // ==========================================
    // Section 3: Recommendations & Examination Next Actions
    // ==========================================
    if (comparison.recommendations && comparison.recommendations.length > 0) {
      sectionTitle('3. BANKING EXAMINATION RECOMMENDATIONS & NEXT ACTIONS');

      for (const rec of comparison.recommendations) {
        doc.font('Helvetica').fontSize(7.5);
        const textWidth = USABLE_WIDTH - 145;
        const recH = doc.heightOfString(rec, { width: textWidth, lineGap: 1.5 });
        const cardH = Math.max(22, recH + 10);

        checkPageBreak(cardH + 4);
        const y = doc.y;

        doc.rect(PAGE_MARGIN, y, USABLE_WIDTH, cardH).fill(BG_LIGHT);
        doc.rect(PAGE_MARGIN, y, USABLE_WIDTH, cardH).lineWidth(0.5).stroke(BORDER_COLOR);

        doc.rect(PAGE_MARGIN, y, 3, cardH).fill(verdictColor);

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(verdictColor);
        doc.text('RECOMMENDED ACTION:', PAGE_MARGIN + 8, y + 6);

        doc.font('Helvetica').fontSize(7.5).fillColor(SLATE_DARK);
        doc.text(rec, PAGE_MARGIN + 130, y + 6, { width: textWidth, lineGap: 1.5 });

        doc.y = y + cardH + 4;
      }
    }

    // ==========================================
    // Section 4: Examiner Sign-Off & Official Seal
    // ==========================================
    checkPageBreak(85);
    const signBoxY = doc.y + 6;
    doc.rect(PAGE_MARGIN, signBoxY, USABLE_WIDTH, 75).fill(BG_LIGHT);
    doc.rect(PAGE_MARGIN, signBoxY, USABLE_WIDTH, 75).lineWidth(0.75).stroke(BORDER_COLOR);

    doc.font('Helvetica-Bold').fontSize(8).fillColor(SLATE_DARK);
    doc.text('DOCUMENTARY CREDIT EXAMINER REVIEW & SIGN-OFF ENDORSEMENT', PAGE_MARGIN + 12, signBoxY + 8);

    doc.font('Helvetica').fontSize(7.5).fillColor(SLATE_MED);
    doc.text('I hereby confirm that I have examined the presented documents against international standard banking practice (ISBP 745) and UCP 600 rules.', PAGE_MARGIN + 12, signBoxY + 20, { width: USABLE_WIDTH - 24 });

    const sigLineY = signBoxY + 54;

    // Examiner Name line
    doc.rect(PAGE_MARGIN + 12, sigLineY, 140, 0.5).fill(SLATE_MUTED);
    doc.font('Helvetica').fontSize(7).fillColor(SLATE_MED);
    doc.text('Trade Finance Examiner Name', PAGE_MARGIN + 12, sigLineY + 3);

    // Signature line
    doc.rect(PAGE_MARGIN + 170, sigLineY, 140, 0.5).fill(SLATE_MUTED);
    doc.text('Authorized Signature', PAGE_MARGIN + 170, sigLineY + 3);

    // Date line
    doc.rect(PAGE_MARGIN + 330, sigLineY, 80, 0.5).fill(SLATE_MUTED);
    doc.text('Date', PAGE_MARGIN + 330, sigLineY + 3);

    // Decision Stamp Box
    doc.rect(PAGE_MARGIN + 425, signBoxY + 34, 85, 34).lineWidth(1).stroke(verdictColor);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(verdictColor);
    doc.text(isCompliant ? 'COMPLIANT' : isDiscrepant ? 'DISCREPANT' : 'REJECTED', PAGE_MARGIN + 425, signBoxY + 41, { width: 85, align: 'center' });
    doc.font('Helvetica').fontSize(6).fillColor(verdictColor);
    doc.text('EXAMINATION SEAL', PAGE_MARGIN + 425, signBoxY + 54, { width: 85, align: 'center' });

    // ==========================================
    // Page Footers on All Pages (Buffered Page Range)
    // ==========================================
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);

      const footerY = PAGE_HEIGHT - 38;
      doc.rect(PAGE_MARGIN, footerY, USABLE_WIDTH, 0.5).fill(BORDER_COLOR);

      doc.font('Helvetica').fontSize(6.5).fillColor(SLATE_MUTED);

      const footerLeft = `DocuIntel AI Audit Trail • ID: ${comparison.comparisonId}`;
      doc.text(footerLeft, PAGE_MARGIN, footerY + 6, { width: 220, align: 'left' });

      const footerCenter = `Page ${i + 1} of ${range.count}`;
      doc.text(footerCenter, PAGE_MARGIN + 220, footerY + 6, { width: USABLE_WIDTH - 440, align: 'center' });

      const footerRight = 'STRICTLY CONFIDENTIAL — TRADE RECONCILIATION AUDIT';
      doc.text(footerRight, PAGE_MARGIN + USABLE_WIDTH - 220, footerY + 6, { width: 220, align: 'right' });
    }

    doc.end();
  });
}

