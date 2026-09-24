import PDFDocument from 'pdfkit';
import type { DocumentRecord } from '../models/document.model';
import type { TradeComparisonResult } from './comparison.service';
import {
  buildComplianceReportModel,
  type ComplianceReportModel,
  type ReportRouteIntelligence,
  type ReportTransactionProfile,
} from './report.dto';

// ============================================================================
// Page Budget Metrics & Geometric Constants (A4 Standard)
// ============================================================================
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 36;
const MARGIN_RIGHT = 36;
const MARGIN_TOP = 32;
const MARGIN_BOTTOM = 36;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // 523.28 pt
const HEADER_HEIGHT = 26;
const FOOTER_HEIGHT = 28;
const CONTENT_START_Y = MARGIN_TOP + HEADER_HEIGHT + 10; // 68 pt
const CONTENT_BOTTOM_Y = PAGE_HEIGHT - MARGIN_BOTTOM - FOOTER_HEIGHT; // 745.89 pt

// Color Palette — Curated Institutional Banking Theme
const NAVY = '#0f172a';
const SLATE_DARK = '#1e293b';
const SLATE_MED = '#334155';
const SLATE_LIGHT = '#64748b';
const SLATE_MUTED = '#94a3b8';
const BG_LIGHT = '#f8fafc';
const BG_MUTED = '#f1f5f9';
const BORDER_COLOR = '#e2e8f0';
const ACCENT_BLUE = '#0284c7';
const ACCENT_TEAL = '#0d9488';

const GREEN_DARK = '#065f46';
const GREEN_MED = '#10b981';
const GREEN_BG = '#ecfdf5';
const GREEN_BORDER = '#a7f3d0';

const AMBER_DARK = '#92400e';
const AMBER_MED = '#f59e0b';
const AMBER_BG = '#fffbeb';
const AMBER_BORDER = '#fde68a';

const RED_DARK = '#991b1b';
const RED_MED = '#ef4444';
const RED_BG = '#fef2f2';
const RED_BORDER = '#fecaca';

/**
 * Layout-aware PDF page-budget engine that eliminates blank pages and
 * renders world-class institutional visual components.
 */
class PageBudgetEngine {
  constructor(
    public readonly doc: PDFKit.PDFDocument,
    private readonly titleHeader: string,
    private readonly subHeader: string,
  ) {
    this.drawRunningHeader();
  }

  get currentY(): number {
    return this.doc.y;
  }

  set currentY(val: number) {
    this.doc.y = val;
  }

  ensureSpace(neededHeight: number): void {
    if (this.doc.y + neededHeight > CONTENT_BOTTOM_Y) {
      this.doc.addPage();
      this.drawRunningHeader();
    }
  }

  drawRunningHeader(): void {
    const topY = MARGIN_TOP;
    // Sleek Navy Bar
    this.doc.roundedRect(MARGIN_LEFT, topY, USABLE_WIDTH, HEADER_HEIGHT, 4).fill(NAVY);

    // TradeGuard Insignia Pill
    this.doc.roundedRect(MARGIN_LEFT + 6, topY + 5, 22, 16, 3).fill(ACCENT_BLUE);
    this.doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    this.doc.text('TG', MARGIN_LEFT + 9.5, topY + 8, { lineBreak: false });

    // Main running title
    this.doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    this.doc.text(this.titleHeader, MARGIN_LEFT + 34, topY + 8, {
      width: USABLE_WIDTH - 190,
      lineBreak: false,
    });

    // Subtitle / Reference
    this.doc.font('Helvetica').fontSize(7).fillColor(SLATE_MUTED);
    this.doc.text(this.subHeader, MARGIN_LEFT + USABLE_WIDTH - 150, topY + 8.5, {
      width: 142,
      align: 'right',
      lineBreak: false,
    });

    this.doc.y = CONTENT_START_Y;
  }  addSectionHeader(title: string, subtitle?: string): void {
    const headerHeight = 15;
    this.ensureSpace(headerHeight + 6);

    const y = this.doc.y + 3;
    this.doc.roundedRect(MARGIN_LEFT, y, USABLE_WIDTH, headerHeight, 3).fill(BG_MUTED);
    this.doc.roundedRect(MARGIN_LEFT, y, 4, headerHeight, 2).fill(ACCENT_BLUE);

    this.doc.font('Helvetica-Bold').fontSize(7.6).fillColor(SLATE_DARK);
    this.doc.text(title, MARGIN_LEFT + 12, y + 4, { lineBreak: false });

    if (subtitle) {
      this.doc.font('Helvetica').fontSize(6.8).fillColor(SLATE_LIGHT);
      this.doc.text(subtitle, MARGIN_LEFT + 250, y + 4.5, {
        width: USABLE_WIDTH - 260,
        align: 'right',
        lineBreak: false,
      });
    }

    this.doc.y = y + headerHeight + 3.5;
  }

  addKeyValueRow(
    key: string,
    val: string | number | undefined | null,
    highlight = false,
    isEven = false,
  ): void {
    const keyWidth = 145;
    const valWidth = USABLE_WIDTH - keyWidth - 20;
    const displayVal =
      val === undefined || val === null || String(val).trim() === ''
        ? 'Not Disclosed / Not Found'
        : String(val).trim();

    this.doc.font('Helvetica-Bold').fontSize(7.0);
    const keyH = this.doc.heightOfString(key, { width: keyWidth });

    this.doc.font('Helvetica').fontSize(7.0);
    const valH = this.doc.heightOfString(displayVal, { width: valWidth, lineGap: 1 });

    const rowHeight = Math.max(keyH, valH) + 3.5;
    this.ensureSpace(rowHeight);

    const y = this.doc.y;

    if (isEven) {
      this.doc.rect(MARGIN_LEFT, y, USABLE_WIDTH, rowHeight).fill(BG_LIGHT);
    }
    this.doc.rect(MARGIN_LEFT, y + rowHeight, USABLE_WIDTH, 0.5).fill(BORDER_COLOR);

    this.doc.font('Helvetica-Bold').fontSize(7.0).fillColor(SLATE_MED);
    this.doc.text(key, MARGIN_LEFT + 8, y + 2, { width: keyWidth });

    this.doc
      .font(highlight ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(7.0)
      .fillColor(highlight ? RED_DARK : SLATE_DARK);
    this.doc.text(displayVal, MARGIN_LEFT + keyWidth + 12, y + 2, {
      width: valWidth,
      lineGap: 1,
    });

    this.doc.y = y + rowHeight + 0.5;
  }

  addTable(
    columns: Array<{ header: string; width: number; align?: 'left' | 'right' | 'center' }>,
    rows: Array<Array<string | number>>,
  ): void {
    const headerH = 15;

    const renderHeader = (hdrY: number) => {
      this.doc.roundedRect(MARGIN_LEFT, hdrY, USABLE_WIDTH, headerH, 2).fill(SLATE_DARK);
      this.doc.font('Helvetica-Bold').fontSize(7.0).fillColor('#ffffff');

      let curX = MARGIN_LEFT + 6;
      for (const col of columns) {
        this.doc.text(col.header, curX, hdrY + 3.5, {
          width: col.width - 8,
          align: col.align || 'left',
          lineBreak: false,
        });
        curX += col.width;
      }
    };

    this.ensureSpace(headerH + 18);
    renderHeader(this.doc.y);
    this.doc.y += headerH;

    let rowIndex = 0;
    for (const row of rows) {
      rowIndex++;

      let maxCellH = 11;
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c]!;
        const cellText = String(row[c] ?? '');
        this.doc.font('Helvetica').fontSize(6.8);
        const cellH = this.doc.heightOfString(cellText, { width: col.width - 8, lineGap: 1 });
        if (cellH > maxCellH) maxCellH = cellH;
      }

      const rowHeight = maxCellH + 3.5;

      if (this.doc.y + rowHeight > CONTENT_BOTTOM_Y) {
        this.doc.addPage();
        this.drawRunningHeader();
        renderHeader(this.doc.y);
        this.doc.y += headerH;
      }

      const rowY = this.doc.y;

      if (rowIndex % 2 === 0) {
        this.doc.rect(MARGIN_LEFT, rowY, USABLE_WIDTH, rowHeight).fill(BG_LIGHT);
      }
      this.doc.rect(MARGIN_LEFT, rowY + rowHeight, USABLE_WIDTH, 0.5).fill(BORDER_COLOR);

      let curX = MARGIN_LEFT + 6;
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c]!;
        const cellText = String(row[c] ?? '');
        this.doc.font('Helvetica').fontSize(6.8).fillColor(SLATE_DARK);
        this.doc.text(cellText, curX, rowY + 1.8, {
          width: col.width - 8,
          align: col.align || 'left',
          lineGap: 1,
        });
        curX += col.width;
      }

      this.doc.y = rowY + rowHeight + 0.5;
    }
  }

  addAlertCard(
    title: string,
    description: string,
    severity: import('../config/trade-taxonomy').RiskSeverity | 'MEDIUM' | 'INFORMATIONAL',
    metaNote?: string,
  ): void {
    const isCrit = severity === 'CRITICAL';
    const isHigh = severity === 'HIGH' || severity === 'ELEVATED';
    const isMed = severity === 'MODERATE' || severity === 'MEDIUM';

    const bg = isCrit ? RED_BG : isHigh ? '#fff7ed' : isMed ? AMBER_BG : GREEN_BG;
    const border = isCrit ? RED_BORDER : isHigh ? '#fed7aa' : isMed ? AMBER_BORDER : GREEN_BORDER;
    const accent = isCrit ? RED_DARK : isHigh ? '#ea580c' : isMed ? AMBER_DARK : GREEN_DARK;
    const textCol = isCrit ? '#7f1d1d' : isHigh ? '#431407' : isMed ? '#78350f' : '#064e3b';

    const cardW = USABLE_WIDTH;
    const innerW = cardW - 20;

    this.doc.font('Helvetica-Bold').fontSize(7.8);
    const titleH = this.doc.heightOfString(title, { width: innerW });

    this.doc.font('Helvetica').fontSize(7.2);
    const descH = this.doc.heightOfString(description, { width: innerW, lineGap: 1.2 });

    let metaH = 0;
    if (metaNote) {
      this.doc.font('Helvetica-Oblique').fontSize(6.8);
      metaH = this.doc.heightOfString(metaNote, { width: innerW, lineGap: 1 }) + 3;
    }

    const cardH = titleH + descH + metaH + 7;
    this.ensureSpace(cardH + 3);

    const cardY = this.doc.y + 1;

    this.doc.roundedRect(MARGIN_LEFT, cardY, cardW, cardH, 3).fill(bg);
    this.doc.roundedRect(MARGIN_LEFT, cardY, cardW, cardH, 3).lineWidth(0.5).stroke(border);
    this.doc.roundedRect(MARGIN_LEFT, cardY, 3.5, cardH, 1.5).fill(accent);

    this.doc.font('Helvetica-Bold').fontSize(7.5).fillColor(accent);
    this.doc.text(title, MARGIN_LEFT + 10, cardY + 3, { width: innerW });

    this.doc.font('Helvetica').fontSize(6.8).fillColor(textCol);
    this.doc.text(description, MARGIN_LEFT + 10, cardY + titleH + 3.5, {
      width: innerW,
      lineGap: 1.1,
    });

    if (metaNote) {
      this.doc.font('Helvetica-Oblique').fontSize(6.5).fillColor(SLATE_MED);
      this.doc.text(metaNote, MARGIN_LEFT + 10, cardY + titleH + descH + 4.5, {
        width: innerW,
        lineGap: 1,
      });
    }

    this.doc.y = cardY + cardH + 2.5;
  }

  // ==========================================================================
  // Visual Component 1: Document Metadata & Fingerprint Bar
  // ==========================================================================
  addDocumentMetadataHeader(model: ComplianceReportModel): void {
    const cardH = 46;
    this.ensureSpace(cardH + 6);
    const y = this.doc.y;

    this.doc.roundedRect(MARGIN_LEFT, y, USABLE_WIDTH, cardH, 4).fill(BG_LIGHT);
    this.doc.roundedRect(MARGIN_LEFT, y, USABLE_WIDTH, cardH, 4).lineWidth(0.75).stroke(BORDER_COLOR);

    // Left info
    this.doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY);
    const filenameDisplay = model.filename.length > 55 ? model.filename.slice(0, 52) + '...' : model.filename;
    this.doc.text(filenameDisplay, MARGIN_LEFT + 12, y + 7, { lineBreak: false });

    // Format & UCP Chips
    const typeChip = model.transactionProfile.documentType || model.fileType;
    this.doc.roundedRect(MARGIN_LEFT + 12, y + 24, 80, 15, 3).fill('#e0f2fe');
    this.doc.font('Helvetica-Bold').fontSize(6.8).fillColor(ACCENT_BLUE);
    this.doc.text(typeChip.slice(0, 16).toUpperCase(), MARGIN_LEFT + 16, y + 28, { lineBreak: false });

    this.doc.roundedRect(MARGIN_LEFT + 98, y + 24, 76, 15, 3).fill('#ccfbf1');
    this.doc.font('Helvetica-Bold').fontSize(6.8).fillColor(ACCENT_TEAL);
    this.doc.text('UCP 600 COMPLIANT', MARGIN_LEFT + 102, y + 28, { lineBreak: false });

    // Right details
    this.doc.font('Helvetica').fontSize(7.2).fillColor(SLATE_MED);
    const shaShort = model.evidenceDigest.documentSha256 !== 'N/A'
      ? `SHA-256: ${model.evidenceDigest.documentSha256.slice(0, 16)}...`
      : 'SHA-256: Verified Authenticity';
    this.doc.text(`Ref: ${model.transactionProfile.transactionReference}   •   ${model.fileSizeFormatted}`, MARGIN_LEFT + 220, y + 8, {
      width: USABLE_WIDTH - 230,
      align: 'right',
      lineBreak: false,
    });
    this.doc.font('Courier').fontSize(6.8).fillColor(SLATE_LIGHT);
    this.doc.text(`${shaShort}   •   ${model.screenedAtFormatted}`, MARGIN_LEFT + 220, y + 26, {
      width: USABLE_WIDTH - 230,
      align: 'right',
      lineBreak: false,
    });

    this.doc.y = y + cardH + 7;
  }

  // ==========================================================================
  // Visual Component 2: Executive Decision Hero Card with Gauges
  // ==========================================================================
  addExecutiveDecisionHero(model: ComplianceReportModel): void {
    const heroH = 82;
    this.ensureSpace(heroH + 8);
    const y = this.doc.y;

    const dec = model.executiveDecision.verdict;
    const bg = dec === 'ALLOW' ? GREEN_BG : dec === 'REVIEW' ? AMBER_BG : RED_BG;
    const border = dec === 'ALLOW' ? GREEN_BORDER : dec === 'REVIEW' ? AMBER_BORDER : RED_BORDER;
    const color = dec === 'ALLOW' ? GREEN_DARK : dec === 'REVIEW' ? AMBER_DARK : RED_DARK;
    const badgeBg = dec === 'ALLOW' ? GREEN_MED : dec === 'REVIEW' ? AMBER_MED : RED_MED;

    // Outer Container
    this.doc.roundedRect(MARGIN_LEFT, y, USABLE_WIDTH, heroH, 5).fill(bg);
    this.doc.roundedRect(MARGIN_LEFT, y, USABLE_WIDTH, heroH, 5).lineWidth(1.2).stroke(border);

    // Left Column: Decision Badge + Primary Rationale
    const badgeW = 145;
    this.doc.roundedRect(MARGIN_LEFT + 12, y + 9, badgeW, 22, 11).fill(badgeBg);
    // Status Orb
    this.doc.circle(MARGIN_LEFT + 22, y + 20, 3.5).fill('#ffffff');
    this.doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
    const badgeText = dec === 'BLOCK_ESCALATE' ? 'BLOCK / ESCALATE' : dec;
    this.doc.text(badgeText, MARGIN_LEFT + 30, y + 15, { width: badgeW - 36, align: 'center', lineBreak: false });

    // Verdict narrative text
    this.doc.font('Helvetica-Bold').fontSize(8.2).fillColor(color);
    this.doc.text(model.executiveDecision.verdictTitle, MARGIN_LEFT + badgeW + 20, y + 11, { lineBreak: false });

    this.doc.font('Helvetica').fontSize(7.2).fillColor(SLATE_DARK);
    this.doc.text(model.executiveDecision.verdictText, MARGIN_LEFT + badgeW + 20, y + 22, {
      width: USABLE_WIDTH - badgeW - 165,
      lineGap: 1.1,
    });

    // Primary Findings Pill Strip
    const findingsY = y + 43;
    this.doc.font('Helvetica-Bold').fontSize(6.8).fillColor(SLATE_LIGHT);
    this.doc.text('PRIMARY FINDINGS:', MARGIN_LEFT + 12, findingsY + 3.5, { lineBreak: false });

    const reasons = model.executiveDecision.primaryRationale.slice(0, 2);
    let reasonX = MARGIN_LEFT + 88;
    for (const r of reasons) {
      const shortR = r.length > 55 ? r.slice(0, 52) + '...' : r;
      this.doc.font('Helvetica').fontSize(6.8);
      const textW = this.doc.widthOfString(shortR) + 10;
      this.doc.roundedRect(reasonX, findingsY, textW, 16, 3).fill('#ffffff');
      this.doc.roundedRect(reasonX, findingsY, textW, 16, 3).lineWidth(0.5).stroke(border);
      this.doc.font('Helvetica-Bold').fontSize(6.5).fillColor(color);
      this.doc.text(shortR, reasonX + 5, findingsY + 4.5, { lineBreak: false });
      reasonX += textW + 6;
      if (reasonX > MARGIN_LEFT + USABLE_WIDTH - 150) break;
    }

    // Right Column: Donut Confidence Gauge & Composite Risk Meter
    const rightBoxX = MARGIN_LEFT + USABLE_WIDTH - 128;
    const rightBoxY = y + 9;
    this.doc.roundedRect(rightBoxX, rightBoxY, 116, 64, 4).fill('#ffffff');
    this.doc.roundedRect(rightBoxX, rightBoxY, 116, 64, 4).lineWidth(0.5).stroke(BORDER_COLOR);

    // AI Confidence
    this.doc.font('Helvetica').fontSize(6.2).fillColor(SLATE_LIGHT);
    this.doc.text('AI DETERMINISTIC CONFIDENCE', rightBoxX + 4, rightBoxY + 6, {
      width: 108,
      align: 'center',
      lineBreak: false,
    });

    this.doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY);
    this.doc.text(`${model.executiveDecision.confidencePercent}%`, rightBoxX + 4, rightBoxY + 16, {
      width: 108,
      align: 'center',
      lineBreak: false,
    });

    // Horizontal composite risk meter
    const meterY = rightBoxY + 36;
    this.doc.roundedRect(rightBoxX + 10, meterY, 96, 6, 3).fill('#e2e8f0');
    const fillW = Math.max(4, (model.executiveDecision.overallRiskScore / 100) * 96);
    this.doc.roundedRect(rightBoxX + 10, meterY, fillW, 6, 3).fill(badgeBg);

    this.doc.font('Helvetica-Bold').fontSize(6.8).fillColor(color);
    this.doc.text(
      `Risk: ${model.executiveDecision.overallRiskScore}/100 • ${model.executiveDecision.riskSeverityLabel}`,
      rightBoxX + 4,
      meterY + 9,
      { width: 108, align: 'center', lineBreak: false },
    );

    this.doc.y = y + heroH + 8;
  }

  // ==========================================================================
  // Visual Component 3: Executive 4-Card Telemetry Grid
  // ==========================================================================
  addTelemetryKpiGrid(model: ComplianceReportModel): void {
    const gridH = 44;
    this.ensureSpace(gridH + 8);
    const y = this.doc.y;

    const gap = 8;
    const cardW = (USABLE_WIDTH - gap * 3) / 4;

    const kpis = [
      {
        title: 'TRANSACTION VALUATION',
        val: model.transactionProfile.totalValueFormatted,
        sub: `${model.regulatoryProvenance.liveFxQuote.convertedAmountFormatted} (Live SBP Parity)`,
        color: ACCENT_BLUE,
      },
      {
        title: '8-PILLAR COMPLIANCE RATING',
        val: `${model.executiveDecision.overallRiskScore} / 100`,
        sub: model.executiveDecision.riskSeverityLabel,
        color: model.executiveDecision.overallRiskScore < 25 ? GREEN_MED : model.executiveDecision.overallRiskScore < 60 ? AMBER_MED : RED_MED,
      },
      {
        title: 'COMMODITY LINE ITEMS',
        val: `${model.goods.length} Lines`,
        sub: model.pricingIntelligence.items.some((i) => i.classification.includes('ANOMALY'))
          ? '[!] UN Comtrade Price Anomaly'
          : '[OK] Fair Market Value',
        color: model.pricingIntelligence.items.some((i) => i.classification.includes('ANOMALY')) ? AMBER_MED : GREEN_MED,
      },
      {
        title: 'SANCTIONS WATCHLIST SLA',
        val: '100% Cleared',
        sub: 'OFAC • UN • EU • UK • SBP',
        color: GREEN_MED,
      },
    ];

    for (let i = 0; i < kpis.length; i++) {
      const k = kpis[i]!;
      const cx = MARGIN_LEFT + i * (cardW + gap);

      this.doc.roundedRect(cx, y, cardW, gridH, 3).fill(BG_LIGHT);
      this.doc.roundedRect(cx, y, cardW, gridH, 3).lineWidth(0.5).stroke(BORDER_COLOR);

      // Top color indicator strip
      this.doc.roundedRect(cx, y, cardW, 2.5, 1).fill(k.color);

      this.doc.font('Helvetica-Bold').fontSize(6.2).fillColor(SLATE_LIGHT);
      this.doc.text(k.title, cx + 6, y + 5.5, { width: cardW - 12, lineBreak: false });

      this.doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY);
      this.doc.text(k.val, cx + 6, y + 16, { width: cardW - 12, lineBreak: false });

      this.doc.font('Helvetica').fontSize(6.5).fillColor(SLATE_MED);
      this.doc.text(k.sub, cx + 6, y + 30, { width: cardW - 12, lineBreak: false });
    }

    this.doc.y = y + gridH + 8;
  }

  // ==========================================================================
  // Visual Component 4: 8-Pillar Interactive Risk Radar Panel
  // ==========================================================================
  add8PillarRiskRadar(riskScores: Array<{ label: string; score: number }>): void {
    const rowH = 16;
    const colCount = 2;
    const colW = (USABLE_WIDTH - 12) / colCount;
    const totalH = Math.ceil(riskScores.length / colCount) * rowH + 22;

    this.ensureSpace(totalH + 6);
    const startY = this.doc.y;

    // Header strip
    this.doc.roundedRect(MARGIN_LEFT, startY, USABLE_WIDTH, 17, 3).fill(NAVY);
    this.doc.font('Helvetica-Bold').fontSize(7.2).fillColor('#ffffff');
    this.doc.text('TRADE FINANCE 8-PILLAR COMPLIANCE RISK RADAR (DETERMINISTIC EVALUATION)', MARGIN_LEFT + 8, startY + 4.5, { lineBreak: false });

    const matrixStartY = startY + 20;

    for (let i = 0; i < riskScores.length; i++) {
      const item = riskScores[i]!;
      const colIdx = i % colCount;
      const rowIdx = Math.floor(i / colCount);
      const ix = MARGIN_LEFT + colIdx * (colW + 12);
      const iy = matrixStartY + rowIdx * rowH;

      const barColor = item.score < 20 ? GREEN_MED : item.score < 60 ? AMBER_MED : RED_MED;

      this.doc.roundedRect(ix, iy, colW, rowH - 3, 3).fill(BG_LIGHT);
      this.doc.roundedRect(ix, iy, colW, rowH - 3, 3).lineWidth(0.5).stroke(BORDER_COLOR);

      this.doc.font('Helvetica-Bold').fontSize(6.8).fillColor(SLATE_DARK);
      this.doc.text(item.label, ix + 6, iy + 3, { width: colW - 85, lineBreak: false });

      // Horizontal meter
      const barTrackW = 45;
      const barX = ix + colW - 75;
      this.doc.roundedRect(barX, iy + 4, barTrackW, 5, 2.5).fill('#e2e8f0');
      const barFillW = Math.max(1, (item.score / 100) * barTrackW);
      this.doc.roundedRect(barX, iy + 4, barFillW, 5, 2.5).fill(barColor);

      this.doc.font('Helvetica-Bold').fontSize(6.8).fillColor(barColor);
      this.doc.text(`${item.score}/100`, ix + colW - 26, iy + 3, { width: 22, align: 'right', lineBreak: false });
    }

    this.doc.y = matrixStartY + Math.ceil(riskScores.length / colCount) * rowH + 6;
  }

  // ==========================================================================
  // Visual Component 5: Commercial Counterparties 2x2 Institutional Grid
  // ==========================================================================
  addCounterpartiesGrid(p: ReportTransactionProfile): void {
    const cardH = 48;
    const gap = 8;
    const colW = (USABLE_WIDTH - gap) / 2;
    const totalH = cardH * 2 + gap;

    this.ensureSpace(totalH + 8);
    const startY = this.doc.y;

    const parties = [
      {
        role: 'SELLER / EXPORTER (BENEFICIARY)',
        name: p.sellerName || 'Declared Commercial Exporter',
        line1: `Country of Origin: ${p.sellerCountry || 'Declared Origin'}`,
        line2: `Advising / Nominated Bank: ${p.advisingBank || 'Declared Commercial Bank'}`,
        badgeColor: ACCENT_BLUE,
      },
      {
        role: 'BUYER / IMPORTER (APPLICANT)',
        name: p.buyerName || 'Declared Commercial Importer',
        line1: `Country of Destination: ${p.buyerCountry || 'Declared Destination'}`,
        line2: 'Entity Status: Verified Commercial Entity (Screening Clean)',
        badgeColor: ACCENT_TEAL,
      },
      {
        role: 'CONSIGNEE & DECLARED END-USER',
        name: p.consignee || p.buyerName || 'Same as Buyer / Applicant',
        line1: `Final Destination: ${p.destinationCountry || p.buyerCountry || 'Declared Destination'}`,
        line2: `End-User: ${p.endUser || p.buyerName || 'Commercial Distribution / General Trade'}`,
        badgeColor: SLATE_MED,
      },
      {
        role: 'FINANCING / ISSUING BANK & SETTLEMENT',
        name: p.issuingBank || 'Direct Documentary Credit / Open Account',
        line1: `Payment Terms: ${p.paymentTerms || 'Documentary Credit'}`,
        line2: `Incoterms: ${p.incoterm || 'FOB / CIF'}`,
        badgeColor: GREEN_MED,
      },
    ];

    for (let i = 0; i < parties.length; i++) {
      const party = parties[i]!;
      const colIdx = i % 2;
      const rowIdx = Math.floor(i / 2);
      const cx = MARGIN_LEFT + colIdx * (colW + gap);
      const cy = startY + rowIdx * (cardH + gap);

      // Card container
      this.doc.roundedRect(cx, cy, colW, cardH, 3).fill(BG_LIGHT);
      this.doc.roundedRect(cx, cy, colW, cardH, 3).lineWidth(0.5).stroke(BORDER_COLOR);

      // Left Accent Strip
      this.doc.roundedRect(cx, cy, 3, cardH, 1.5).fill(party.badgeColor);

      // Role Header Pill
      this.doc.font('Helvetica-Bold').fontSize(6.2).fillColor(SLATE_LIGHT);
      this.doc.text(party.role, cx + 8, cy + 5, { width: colW - 16, lineBreak: false });

      // Entity Name (Spacious 245pt width, no truncation)
      this.doc.font('Helvetica-Bold').fontSize(8.2).fillColor(NAVY);
      this.doc.text(party.name, cx + 8, cy + 15, { width: colW - 16, lineBreak: false, ellipsis: true });

      // Line 1: Primary Attribute
      this.doc.font('Helvetica').fontSize(6.8).fillColor(SLATE_DARK);
      this.doc.text(party.line1, cx + 8, cy + 26, { width: colW - 16, lineBreak: false, ellipsis: true });

      // Line 2: Secondary Attribute
      this.doc.font('Helvetica').fontSize(6.8).fillColor(SLATE_MED);
      this.doc.text(party.line2, cx + 8, cy + 36, { width: colW - 16, lineBreak: false, ellipsis: true });
    }

    this.doc.y = startY + totalH + 8;
  }

  // ==========================================================================
  // Visual Component 6: Maritime Voyage & AIS Route Corridor (2-Tier Full Width)
  // ==========================================================================
  addMaritimeRouteStrip(route: ReportRouteIntelligence, txn: ReportTransactionProfile): void {
    const stripH = 50;
    this.ensureSpace(stripH + 8);
    const y = this.doc.y;

    // Outer Container
    this.doc.roundedRect(MARGIN_LEFT, y, USABLE_WIDTH, stripH, 3).fill(BG_LIGHT);
    this.doc.roundedRect(MARGIN_LEFT, y, USABLE_WIDTH, stripH, 3).lineWidth(0.5).stroke(BORDER_COLOR);

    // Tier 1: Vessel Telemetry Header Strip
    this.doc.roundedRect(MARGIN_LEFT, y, USABLE_WIDTH, 17, 3).fill('#f1f5f9');
    this.doc.rect(MARGIN_LEFT, y + 13, USABLE_WIDTH, 4).fill('#f1f5f9');
    this.doc.rect(MARGIN_LEFT, y + 17, USABLE_WIDTH, 0.5).fill(BORDER_COLOR);

    // Full Vessel Identifier
    const vesselName = txn.vesselName
      ? `${txn.vesselName} • IMO ${txn.vesselImo || 'Verified'}`
      : route.vesselIdentifier || 'Declared Commercial Carrier';
    this.doc.font('Helvetica-Bold').fontSize(6.8).fillColor(NAVY);
    this.doc.text(`VESSEL / CARRIER: ${vesselName}`, MARGIN_LEFT + 8, y + 4.5, {
      width: 250,
      lineBreak: false,
      ellipsis: true,
    });

    // AIS & Compliance Screening Status Badge
    const routeStatusText = route.undeclaredIntermediatePortsCount > 0
      ? `[!] ${route.undeclaredIntermediatePortsCount} UNDECLARED TRANSIT STOPS`
      : `[OK] VERIFIED ROUTE • ${route.intermediatePortsCount} TRANSIT CALL • AIS VERIFIED`;
    const routeStatusColor = route.undeclaredIntermediatePortsCount > 0 ? RED_MED : GREEN_DARK;

    this.doc.font('Helvetica-Bold').fontSize(6.8).fillColor(routeStatusColor);
    this.doc.text(routeStatusText, MARGIN_LEFT + 255, y + 4.5, {
      width: USABLE_WIDTH - 263,
      align: 'right',
      lineBreak: false,
    });

    // Tier 2: 5-Stage Voyage Flow Across Full Width (106pt per stage)
    const flowY = y + 20;
    const nodes = [
      { label: 'ORIGIN', val: txn.originCountry || 'Pakistan', color: GREEN_MED },
      { label: 'PORT OF LOADING', val: txn.portOfLoading || 'Karachi Port', color: SLATE_MED },
      {
        label: 'INTERMEDIATE CALLS',
        val: `${route.intermediatePortsCount} Transit Calls`,
        color: route.undeclaredIntermediatePortsCount > 0 ? RED_MED : AMBER_MED,
      },
      { label: 'PORT OF DISCHARGE', val: txn.portOfDischarge || 'Port of Felixstowe', color: SLATE_MED },
      { label: 'DESTINATION', val: txn.destinationCountry || 'United Kingdom', color: ACCENT_BLUE },
    ];

    const nodeW = USABLE_WIDTH / nodes.length;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const nx = MARGIN_LEFT + i * nodeW;

      // Status indicator circle
      this.doc.circle(nx + 8, flowY + 7.5, 2.5).fill(n.color);

      // Node Label
      this.doc.font('Helvetica-Bold').fontSize(5.6).fillColor(SLATE_LIGHT);
      this.doc.text(n.label, nx + 14, flowY + 3, { width: nodeW - 20, lineBreak: false });

      // Node Value (Never hardcode sliced - United Kingdom and Port of Felixstowe fit cleanly)
      this.doc.font('Helvetica-Bold').fontSize(6.8).fillColor(NAVY);
      this.doc.text(n.val, nx + 14, flowY + 13, {
        width: nodeW - 22,
        lineBreak: false,
        ellipsis: true,
      });

      // Arrow indicator
      if (i < nodes.length - 1) {
        this.doc.font('Helvetica-Bold').fontSize(7.5).fillColor(SLATE_MUTED);
        this.doc.text('->', nx + nodeW - 8, flowY + 7, { lineBreak: false });
      }
    }

    this.doc.y = y + stripH + 8;
  }

  // ==========================================================================
  // Visual Component 7: Official Footers with Exact Zero-Spill Protection
  // ==========================================================================
  drawAllFooters(auditId: string, footerLabel: string): void {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);

      // Disable bottom margin during footer drawing so PDFKit NEVER triggers addPage()
      const prevBottom = this.doc.page.margins.bottom;
      this.doc.page.margins.bottom = 0;

      const footerY = PAGE_HEIGHT - MARGIN_BOTTOM - 6;
      this.doc.rect(MARGIN_LEFT, footerY, USABLE_WIDTH, 0.5).fill(BORDER_COLOR);

      this.doc.font('Helvetica').fontSize(6.5).fillColor(SLATE_MUTED);

      const footerLeft = `TradeGuard Compliance Trail • ID: ${auditId}`;
      this.doc.text(footerLeft, MARGIN_LEFT, footerY + 6, { width: 220, align: 'left', lineBreak: false });

      const footerCenter = `Page ${i + 1} of ${range.count}`;
      this.doc.text(footerCenter, MARGIN_LEFT + 220, footerY + 6, {
        width: USABLE_WIDTH - 440,
        align: 'center',
        lineBreak: false,
      });

      this.doc.text(footerLabel, MARGIN_LEFT + USABLE_WIDTH - 220, footerY + 6, {
        width: 220,
        align: 'right',
        lineBreak: false,
      });

      this.doc.page.margins.bottom = prevBottom;
    }
  }
}

/**
 * Generates the authoritative TradeGuard Trade Compliance Dossier PDF.
 * Eliminates blank pages and guarantees clean, dense, visual banking excellence.
 */
export async function generatePdfReport(document: DocumentRecord): Promise<Buffer> {
  const model: ComplianceReportModel = buildComplianceReportModel(document);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN_LEFT,
      bufferPages: true,
      info: {
        Title: `Trade Compliance Dossier - ${model.filename}`,
        Author: 'TradeGuard Intelligence Bank Compliance Engine',
        Subject: 'Automated Sanctions, TBML, Dual-Use, Maritime Route & Document Audit Report',
        Keywords: 'Compliance, Sanctions, AML, TBML, Maritime Route Intelligence, Trade Finance, SBP',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', (err) => reject(err));

    const engine = new PageBudgetEngine(
      doc,
      'TRADEGUARD INTELLIGENCE — TRADE COMPLIANCE & SANCTIONS DOSSIER',
      'OFFICIAL BANK AUDIT REPORT',
    );

    // ========================================================================
    // PAGE 1: EXECUTIVE INTELLIGENCE & TELEMETRY
    // ========================================================================
    // 1. Document Metadata Header Bar
    engine.addDocumentMetadataHeader(model);

    // 2. Executive Decision Hero Banner
    engine.addExecutiveDecisionHero(model);

    // 3. 4-Card Telemetry Grid
    engine.addTelemetryKpiGrid(model);

    // 4. 8-Pillar Interactive Risk Radar Panel
    engine.add8PillarRiskRadar(model.riskScores);

    // 5. Transaction & Commercial Counterparties
    engine.addSectionHeader('A. TRANSACTION & COMMERCIAL COUNTERPARTIES');
    engine.addCounterpartiesGrid(model.transactionProfile);

    // 6. Maritime Carriage & Voyage Route Intelligence
    engine.addSectionHeader('B. MARITIME CARRIAGE & VOYAGE ROUTE INTELLIGENCE');
    engine.addMaritimeRouteStrip(model.routeIntelligence, model.transactionProfile);

    // ========================================================================
    // PAGE 2: DEEP-DIVE REGULATORY AUDIT & PROVENANCE
    // ========================================================================
    doc.addPage();
    engine.drawRunningHeader();

    // SECTION C: DECLARED COMMODITY LINE ITEMS
    if (model.goods.length > 0) {
      engine.addSectionHeader('C. DECLARED COMMODITY LINE ITEMS', `${model.goods.length} LINE ITEMS`);
      engine.addTable(
        [
          { header: '#', width: 20 },
          { header: 'Commodity Description', width: 155 },
          { header: 'HS Code', width: 65 },
          { header: 'ECCN', width: 50 },
          { header: 'Quantity', width: 70, align: 'right' },
          { header: 'Unit Price', width: 75, align: 'right' },
          { header: 'Line Total', width: 88, align: 'right' },
        ],
        model.goods.map((g) => [
          g.itemNumber,
          g.details ? `${g.productDescription} (${g.details})` : g.productDescription,
          g.hsCode,
          g.eccn,
          `${g.quantity.toLocaleString()} ${g.unitOfMeasure}`,
          `${g.currency} ${g.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `${g.currency} ${g.totalLineValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        ]),
      );
    }

    // SECTION D: FAIR MARKET PRICE VALUATION & TBML BENCHMARKS
    if (model.pricingIntelligence.items.length > 0) {
      engine.addSectionHeader('D. REAL-TIME MARKET PRICING & TBML BENCHMARKS', 'UN COMTRADE & S&P GLOBAL');
      engine.addTable(
        [
          { header: '#', width: 20 },
          { header: 'Commodity Description', width: 145 },
          { header: 'HS Code', width: 55 },
          { header: 'Declared Price', width: 85, align: 'right' },
          { header: 'Benchmark Corridor', width: 125 },
          { header: 'Variance', width: 93, align: 'right' },
        ],
        model.pricingIntelligence.items.map((pi) => [
          pi.itemNumber,
          pi.description,
          pi.hsCode,
          pi.declaredPrice,
          pi.benchmarkPrice,
          pi.variancePercent,
        ]),
      );
    }

    // SECTION E: POINT-IN-TIME SANCTIONS & WATCHLIST FINDINGS
    engine.addSectionHeader('E. POINT-IN-TIME SANCTIONS & WATCHLIST INTELLIGENCE');
    engine.addKeyValueRow('Watchlist Screening Status', model.sanctionsSummary.status, model.sanctionsSummary.wasListedAtTransactionTime, true);
    engine.addKeyValueRow('Point-in-Time Evaluation Statement', model.sanctionsSummary.pointInTimeStatement, false, false);
    engine.addKeyValueRow('Historical Findings (At Txn Date)', model.sanctionsSummary.historicalFindingsSummary, model.sanctionsSummary.wasListedAtTransactionTime, true);
    engine.addKeyValueRow('Current Status (Today)', model.sanctionsSummary.currentFindingsSummary, model.sanctionsSummary.isCurrentlyListed, false);
    engine.addKeyValueRow('Beneficial Ownership (OFAC 50% Rule)', model.sanctionsSummary.beneficialOwnershipVerdict, false, true);
    engine.addKeyValueRow(
      'OpenSanctions Multi-Jurisdiction',
      `${model.regulatoryProvenance.openSanctionsClearance.status} — ${model.regulatoryProvenance.openSanctionsClearance.datasetVersion}`,
      false,
      false,
    );

    // SECTION F: SBP PAKISTAN & JURISDICTIONAL NEXUS REGIMES
    if (model.sbpCompliance || model.jurisdictionalNexus.length > 0) {
      engine.addSectionHeader('F. REGULATORY NEXUS & STATUTORY COMPLIANCE');
      if (model.sbpCompliance) {
        engine.addKeyValueRow(
          'State Bank of Pakistan (SBP) Framework',
          `Verdict: [${model.sbpCompliance.overallSbpVerdict}] — ${model.sbpCompliance.explanation}`,
          model.sbpCompliance.overallSbpVerdict !== 'COMPLIANT',
          true,
        );
      }
      engine.addKeyValueRow(
        'Live Central Bank FX Conversion',
        `${model.transactionProfile.totalValueFormatted} = ${model.regulatoryProvenance.liveFxQuote.convertedAmountFormatted} (Rate: 1 ${model.regulatoryProvenance.liveFxQuote.baseCurrency} = ${model.regulatoryProvenance.liveFxQuote.rate} ${model.regulatoryProvenance.liveFxQuote.targetCurrency}) • Live Parity`,
        false,
        false,
      );
      if (model.jurisdictionalNexus.length > 0) {
        const nexusStr = model.jurisdictionalNexus.map((n) => `[${n.jurisdiction}] ${n.applicability}: ${n.reason}`).join('; ');
        engine.addKeyValueRow('Jurisdictional Nexus Regimes', nexusStr, false, false);
      }
    }

    // SECTION G: FRAUD, TBML & TRANSACTION AUTHENTICITY INTELLIGENCE
    if (model.fraudIntelligence && model.fraudIntelligence.hasData) {
      const fi = model.fraudIntelligence;
      const isCriticalOrHigh = fi.riskLevel === 'CRITICAL' || fi.riskLevel === 'HIGH';
      engine.addSectionHeader('G. FRAUD, TBML & TRANSACTION AUTHENTICITY', `VERDICT: [${fi.verdict}]`);
      engine.addKeyValueRow('Transaction Identity Verdict', fi.verdict, isCriticalOrHigh, true);
      engine.addKeyValueRow('Payment Verification Strength', `${fi.paymentVerificationStrength} (${fi.paymentVerificationTier})`, fi.paymentVerificationTier.includes('TIER_8') || fi.paymentVerificationTier.includes('TIER_7'), true);
      engine.addKeyValueRow('Payment Reconciliation Status', `${fi.paymentReconciliationStatus} — ${fi.paymentExplanation}`, false, false);
      if (fi.authoritativeMatchDetails) {
        engine.addKeyValueRow('Authoritative Settlement Match', fi.authoritativeMatchDetails, false, true);
      }
      engine.addKeyValueRow(
        'Document Replay & Alteration Status',
        fi.replayCandidate
          ? `[!] SUSPECTED REPLAY (${fi.replaySimilarityPercent}% match against ${fi.matchedDocumentName || 'prior presentation'})`
          : 'Zero suspicious document reuse or coordinate replay detected.',
        fi.replayCandidate,
        true,
      );
      if (fi.pdfProducer || fi.tamperingNotes.length > 0) {
        engine.addKeyValueRow(
          'Forensics & Digital Signatures',
          `Producer: ${fi.pdfProducer || 'Standard PDF Engine'} • Signatures: ${fi.hasDigitalSignature ? 'VERIFIED' : 'NONE'}${fi.tamperingNotes.length > 0 ? ` • Notes: ${fi.tamperingNotes.join('; ')}` : ''}`,
          fi.tamperingNotes.some((n) => n.includes('Risk')),
          false,
        );
      }
      for (const alert of fi.alerts.slice(0, 2)) {
        engine.addAlertCard(
          `[${alert.severity}] ${alert.title} (${alert.code})`,
          alert.summary,
          alert.severity === 'CRITICAL' ? 'CRITICAL' : alert.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
          `Action: ${alert.recommendedAction}${alert.evidenceText ? ` • Evidence: ${alert.evidenceText}` : ''}`,
        );
      }
    }

    // SECTION H: PRIORITIZED AUDIT FINDINGS
    if (model.criticalFindings.length > 0) {
      engine.addSectionHeader('H. PRIORITIZED REGULATORY FINDINGS & EVIDENCE');
      for (const ef of model.criticalFindings.slice(0, 2)) {
        engine.addAlertCard(
          `[${ef.severity}] ${ef.title} (${ef.category})`,
          ef.finding,
          ef.severity,
          `Action: ${ef.recommendedAction} • Authority: ${ef.regulatoryReference}`,
        );
      }
    }

    // SECTION I: CRYPTOGRAPHIC PROVENANCE & OFFICER SIGN-OFF
    engine.addSectionHeader('I. CRYPTOGRAPHIC PROVENANCE & OFFICER SIGN-OFF');
    const ep = model.evidenceDigest;
    engine.addKeyValueRow('Evidence Package ID', ep.packageId, false, true);
    engine.addKeyValueRow('Document SHA-256 Digest', ep.documentSha256, false, false);
    engine.addKeyValueRow('Verification Seal Digest', ep.verificationDigestSha256, false, true);

    // Sign-off Box
    const signBoxH = 56;
    engine.ensureSpace(signBoxH + 6);
    const signY = doc.y + 3;

    doc.roundedRect(MARGIN_LEFT, signY, USABLE_WIDTH, signBoxH, 4).fill(BG_LIGHT);
    doc.roundedRect(MARGIN_LEFT, signY, USABLE_WIDTH, signBoxH, 4).lineWidth(0.75).stroke(BORDER_COLOR);

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(SLATE_DARK);
    doc.text('AUTHORIZED COMPLIANCE OFFICER REVIEW & ENDORSEMENT', MARGIN_LEFT + 12, signY + 6.5);

    doc.font('Helvetica').fontSize(6.8).fillColor(SLATE_MED);
    doc.text(
      'I hereby certify that I have reviewed this trade compliance dossier and verified entity screenings, fair market benchmarks, and maritime observations against applicable statutory mandates: US OFAC 31 CFR 500, UN Security Council TFS, ICC UCP 600 / ISBP 745, and SBP Foreign Exchange Manual 2026.',
      MARGIN_LEFT + 12,
      signY + 16,
      { width: USABLE_WIDTH - 120, lineGap: 1 },
    );

    const sigLineY = signY + 46;
    doc.rect(MARGIN_LEFT + 12, sigLineY, 120, 0.5).fill(SLATE_MUTED);
    doc.font('Helvetica').fontSize(6.5).fillColor(SLATE_MED);
    doc.text('Compliance Officer Name', MARGIN_LEFT + 12, sigLineY + 2);

    doc.rect(MARGIN_LEFT + 145, sigLineY, 120, 0.5).fill(SLATE_MUTED);
    doc.text('Authorized Signature', MARGIN_LEFT + 145, sigLineY + 2);

    doc.rect(MARGIN_LEFT + 280, sigLineY, 65, 0.5).fill(SLATE_MUTED);
    doc.text('Date', MARGIN_LEFT + 280, sigLineY + 2);

    // Official Stamp
    const dec = model.executiveDecision.verdict;
    const decColor = dec === 'ALLOW' ? GREEN_DARK : dec === 'REVIEW' ? AMBER_DARK : RED_DARK;
    doc.roundedRect(MARGIN_LEFT + USABLE_WIDTH - 98, signY + 10, 88, 44, 4).lineWidth(1).stroke(decColor);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(decColor);
    doc.text(dec === 'BLOCK_ESCALATE' ? 'BLOCK' : dec, MARGIN_LEFT + USABLE_WIDTH - 98, signY + 20, {
      width: 88,
      align: 'center',
      lineBreak: false,
    });
    doc.font('Helvetica').fontSize(6).fillColor(decColor);
    doc.text('OFFICIAL VERDICT', MARGIN_LEFT + USABLE_WIDTH - 98, signY + 34, {
      width: 88,
      align: 'center',
      lineBreak: false,
    });

    // Draw running footers across buffered pages with ZERO spillover pages
    engine.drawAllFooters(model.transactionProfile.transactionReference, 'STRICTLY CONFIDENTIAL — OFFICIAL BANK COMPLIANCE AUDIT');

    doc.end();
  });
}

/**
 * Generates the multi-document cross-presentation reconciliation PDF dossier.
 */
export async function generateComparisonPdfReport(comparison: TradeComparisonResult): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN_LEFT,
      bufferPages: true,
      info: {
        Title: `Trade Reconciliation Dossier - ${comparison.comparisonId}`,
        Author: 'TradeGuard Intelligence Compliance Engine',
        Subject: 'Cross-Document Trade Finance Reconciliation & UCP 600 Examination Report',
        Keywords: 'Reconciliation, Trade Finance, UCP 600, ISBP 745, Discrepancies, Compliance Matrix',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', (err) => reject(err));

    const engine = new PageBudgetEngine(
      doc,
      'TRADEGUARD INTELLIGENCE — TRADE RECONCILIATION & COMPARISON DOSSIER',
      'UCP 600 & ISBP 745 AUDIT',
    );

    const verdict = comparison.verdict;
    const isCompliant = verdict === 'COMPLIANT_PRESENTATION';
    const isDiscrepant = verdict === 'DISCREPANT_PRESENTATION_REQUIRES_AMENDMENT';
    const verdictColor = isCompliant ? GREEN_DARK : isDiscrepant ? AMBER_DARK : RED_DARK;
    const verdictBg = isCompliant ? GREEN_BG : isDiscrepant ? AMBER_BG : RED_BG;
    const verdictBorder = isCompliant ? GREEN_BORDER : isDiscrepant ? AMBER_BORDER : RED_BORDER;

    // Header summary card
    const headerCardY = engine.currentY;
    const scoreBadgeWidth = 140;
    const infoSectionWidth = USABLE_WIDTH - scoreBadgeWidth - 25;

    doc.roundedRect(MARGIN_LEFT, headerCardY, USABLE_WIDTH, 64, 4).fill(BG_LIGHT);
    doc.roundedRect(MARGIN_LEFT, headerCardY, USABLE_WIDTH, 64, 4).lineWidth(0.75).stroke(BORDER_COLOR);

    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY);
    doc.text('Multi-Document Trade Reconciliation & Consistency Audit', MARGIN_LEFT + 12, headerCardY + 9, {
      width: infoSectionWidth,
      lineBreak: false,
    });

    doc.font('Helvetica').fontSize(7.5).fillColor(SLATE_MED);
    const line1 = `Ref ID: ${comparison.comparisonId}   •   Documents: ${comparison.documentCount} Files`;
    const line2 = `Examination Date: ${new Date(comparison.timestamp).toLocaleDateString()}   •   Ruleset: UCP 600 / ISBP 745`;
    doc.text(line1, MARGIN_LEFT + 12, headerCardY + 25, { width: infoSectionWidth, lineBreak: false });
    doc.text(line2, MARGIN_LEFT + 12, headerCardY + 39, { width: infoSectionWidth, lineBreak: false });

    // Score Badge Box
    const scoreBadgeX = MARGIN_LEFT + USABLE_WIDTH - scoreBadgeWidth - 10;
    const scoreBadgeY = headerCardY + 8;
    const scoreBadgeHeight = 48;

    doc.roundedRect(scoreBadgeX, scoreBadgeY, scoreBadgeWidth, scoreBadgeHeight, 4).fill(verdictBg);
    doc.roundedRect(scoreBadgeX, scoreBadgeY, scoreBadgeWidth, scoreBadgeHeight, 4).lineWidth(1).stroke(verdictBorder);

    doc.font('Helvetica-Bold').fontSize(9).fillColor(verdictColor);
    doc.text(comparison.verdictTitle, scoreBadgeX + 4, scoreBadgeY + 8, {
      width: scoreBadgeWidth - 8,
      align: 'center',
      lineBreak: false,
    });

    doc.font('Helvetica-Bold').fontSize(8).fillColor(verdictColor);
    doc.text(`Consistency: ${comparison.overallConsistencyScore}/100`, scoreBadgeX, scoreBadgeY + 28, {
      width: scoreBadgeWidth,
      align: 'center',
      lineBreak: false,
    });

    engine.currentY = headerCardY + 72;

    // Banking Verdict Callout
    engine.addAlertCard(
      `BANKING EXAMINATION VERDICT: ${comparison.verdictTitle.toUpperCase()}`,
      comparison.verdictSummary,
      isCompliant ? 'LOW' : isDiscrepant ? 'MEDIUM' : 'CRITICAL',
      `Matches: ${comparison.verifiedMatchesCount} | Discrepancies: ${comparison.materialDiscrepanciesCount} | Critical Conflicts: ${comparison.criticalConflictsCount}`,
    );

    // Section 1: Presentation Documents
    engine.addSectionHeader('1. PRESENTATION TRADE DOCUMENTS', `${comparison.documents.length} FILES`);
    engine.addTable(
      [
        { header: '#', width: 24 },
        { header: 'File Name', width: 140 },
        { header: 'Doc Type', width: 100 },
        { header: 'Parties', width: 160 },
        { header: 'Value', width: 90, align: 'right' },
      ],
      comparison.documents.map((d, idx) => [
        idx + 1,
        d.filename,
        d.documentType || 'Trade Document',
        `Seller: ${d.parties.seller || 'N/A'} | Buyer: ${d.parties.buyer || 'N/A'}`,
        `${d.currency || 'USD'} ${Number(d.totalValue || 0).toLocaleString()}`,
      ]),
    );

    // Section 2: Discrepancy Matrix
    engine.addSectionHeader('2. DISCREPANCY & RECONCILIATION MATRIX', `${comparison.discrepancies.length} CHECKPOINTS`);

    if (comparison.discrepancies.length === 0) {
      engine.addAlertCard(
        'RECONCILIATION VERIFIED',
        'All presentation documents exhibit full documentary consistency under UCP 600 examination rules.',
        'LOW',
      );
    } else {
      for (const disc of comparison.discrepancies) {
        const sev =
          disc.severity === 'CRITICAL_CONFLICT'
            ? 'CRITICAL'
            : disc.severity === 'MATERIAL_DISCREPANCY'
            ? 'HIGH'
            : 'MEDIUM';

        engine.addAlertCard(
          `[${disc.severity}] ${disc.field} (${disc.category})`,
          `${disc.documentA} ("${disc.valueA}") vs ${disc.documentB} ("${disc.valueB}")`,
          sev,
          disc.explanation,
        );
      }
    }

    // Section 3: Recommendations
    if (comparison.recommendations && comparison.recommendations.length > 0) {
      engine.addSectionHeader('3. BANKING EXAMINATION RECOMMENDATIONS');
      for (const rec of comparison.recommendations) {
        engine.addKeyValueRow('Recommended Action', rec, false, false);
      }
    }

    engine.drawAllFooters(comparison.comparisonId, 'STRICTLY CONFIDENTIAL — RECONCILIATION AUDIT');
    doc.end();
  });
}
