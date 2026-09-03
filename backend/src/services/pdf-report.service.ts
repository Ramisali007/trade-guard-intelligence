import PDFDocument from 'pdfkit';
import type { DocumentRecord } from '../models/document.model';
import type { TradeComparisonResult } from './comparison.service';
import {
  buildComplianceReportModel,
  type ComplianceReportModel,
  type ReportFindingItem,
} from './report.dto';

// ============================================================================
// Page Budget Metrics & Geometric Constants (A4 Standard)
// ============================================================================
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 36;
const MARGIN_RIGHT = 36;
const MARGIN_TOP = 36;
const MARGIN_BOTTOM = 42;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // 523.28 pt
const HEADER_HEIGHT = 22;
const FOOTER_HEIGHT = 34;
const CONTENT_START_Y = MARGIN_TOP + HEADER_HEIGHT + 8; // 66 pt
const CONTENT_BOTTOM_Y = PAGE_HEIGHT - MARGIN_BOTTOM - FOOTER_HEIGHT; // 763.89 pt

// Color Palette
const NAVY = '#0f172a';
const SLATE_DARK = '#1e293b';
const SLATE_MED = '#475569';
const SLATE_LIGHT = '#64748b';
const SLATE_MUTED = '#94a3b8';
const BG_LIGHT = '#f8fafc';
const BG_MUTED = '#f1f5f9';
const BORDER_COLOR = '#e2e8f0';
const ACCENT_BLUE = '#0284c7';
const ACCENT_TEAL = '#0f766e';

const GREEN_DARK = '#065f46';
const GREEN_BG = '#ecfdf5';
const GREEN_BORDER = '#a7f3d0';

const AMBER_DARK = '#92400e';
const AMBER_BG = '#fffbeb';
const AMBER_BORDER = '#fde68a';

const RED_DARK = '#991b1b';
const RED_BG = '#fef2f2';
const RED_BORDER = '#fecaca';

/**
 * Layout-aware PDF page-budget engine that prevents any content collision.
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
    this.doc.rect(MARGIN_LEFT, topY, USABLE_WIDTH, HEADER_HEIGHT).fill(NAVY);

    this.doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    this.doc.text(this.titleHeader, MARGIN_LEFT + 10, topY + 6, {
      width: USABLE_WIDTH - 150,
      lineBreak: false,
    });

    this.doc.font('Helvetica').fontSize(7).fillColor(SLATE_MUTED);
    this.doc.text(this.subHeader, MARGIN_LEFT + USABLE_WIDTH - 135, topY + 7, {
      width: 125,
      align: 'right',
      lineBreak: false,
    });

    this.doc.y = CONTENT_START_Y;
  }

  addSectionHeader(title: string, subtitle?: string): void {
    const headerHeight = 22;
    this.ensureSpace(headerHeight + 10);

    const y = this.doc.y + 4;
    this.doc.rect(MARGIN_LEFT, y, USABLE_WIDTH, headerHeight).fill(BG_MUTED);
    this.doc.rect(MARGIN_LEFT, y, 4, headerHeight).fill(ACCENT_BLUE);

    this.doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SLATE_DARK);
    this.doc.text(title, MARGIN_LEFT + 12, y + 6, { lineBreak: false });

    if (subtitle) {
      this.doc.font('Helvetica').fontSize(7).fillColor(SLATE_LIGHT);
      this.doc.text(subtitle, MARGIN_LEFT + 260, y + 7, {
        width: USABLE_WIDTH - 270,
        align: 'right',
        lineBreak: false,
      });
    }

    this.doc.y = y + headerHeight + 6;
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

    this.doc.font('Helvetica-Bold').fontSize(8);
    const keyH = this.doc.heightOfString(key, { width: keyWidth });

    this.doc.font('Helvetica').fontSize(8);
    const valH = this.doc.heightOfString(displayVal, { width: valWidth, lineGap: 1.5 });

    const rowHeight = Math.max(keyH, valH) + 6;
    this.ensureSpace(rowHeight);

    const y = this.doc.y;

    if (isEven) {
      this.doc.rect(MARGIN_LEFT, y, USABLE_WIDTH, rowHeight).fill(BG_LIGHT);
    }
    this.doc.rect(MARGIN_LEFT, y + rowHeight, USABLE_WIDTH, 0.5).fill(BORDER_COLOR);

    this.doc.font('Helvetica-Bold').fontSize(8).fillColor(SLATE_MED);
    this.doc.text(key, MARGIN_LEFT + 8, y + 3, { width: keyWidth });

    this.doc
      .font(highlight ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(8)
      .fillColor(highlight ? RED_DARK : SLATE_DARK);
    this.doc.text(displayVal, MARGIN_LEFT + keyWidth + 12, y + 3, {
      width: valWidth,
      lineGap: 1.5,
    });

    this.doc.y = y + rowHeight + 1;
  }

  addTable(
    columns: Array<{ header: string; width: number; align?: 'left' | 'right' | 'center' }>,
    rows: Array<Array<string | number>>,
  ): void {
    const headerH = 18;

    const renderHeader = (hdrY: number) => {
      this.doc.rect(MARGIN_LEFT, hdrY, USABLE_WIDTH, headerH).fill(SLATE_DARK);
      this.doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');

      let curX = MARGIN_LEFT + 6;
      for (const col of columns) {
        this.doc.text(col.header, curX, hdrY + 5, {
          width: col.width - 8,
          align: col.align || 'left',
          lineBreak: false,
        });
        curX += col.width;
      }
    };

    this.ensureSpace(headerH + 25);
    renderHeader(this.doc.y);
    this.doc.y += headerH;

    let rowIndex = 0;
    for (const row of rows) {
      rowIndex++;

      // Measure max cell height for dynamic row budgeting
      let maxCellH = 14;
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c]!;
        const cellText = String(row[c] ?? '');
        this.doc.font('Helvetica').fontSize(7.5);
        const cellH = this.doc.heightOfString(cellText, { width: col.width - 8, lineGap: 1 });
        if (cellH > maxCellH) maxCellH = cellH;
      }

      const rowHeight = maxCellH + 6;

      // Page break check with table header repetition
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
        this.doc.font('Helvetica').fontSize(7.5).fillColor(SLATE_DARK);
        this.doc.text(cellText, curX, rowY + 3, {
          width: col.width - 8,
          align: col.align || 'left',
          lineGap: 1,
        });
        curX += col.width;
      }

      this.doc.y = rowY + rowHeight + 1;
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

    const cardW = USABLE_WIDTH - 12;
    const innerW = cardW - 20;

    this.doc.font('Helvetica-Bold').fontSize(8);
    const titleH = this.doc.heightOfString(title, { width: innerW });

    this.doc.font('Helvetica').fontSize(7.5);
    const descH = this.doc.heightOfString(description, { width: innerW, lineGap: 1.5 });

    let metaH = 0;
    if (metaNote) {
      this.doc.font('Helvetica-Oblique').fontSize(7);
      metaH = this.doc.heightOfString(metaNote, { width: innerW, lineGap: 1.2 }) + 4;
    }

    const cardH = titleH + descH + metaH + 14;
    this.ensureSpace(cardH + 4);

    const cardY = this.doc.y + 2;

    this.doc.rect(MARGIN_LEFT + 6, cardY, cardW, cardH).fill(bg);
    this.doc.rect(MARGIN_LEFT + 6, cardY, cardW, cardH).lineWidth(0.5).stroke(border);
    this.doc.rect(MARGIN_LEFT + 6, cardY, 3.5, cardH).fill(accent);

    this.doc.font('Helvetica-Bold').fontSize(8).fillColor(accent);
    this.doc.text(title, MARGIN_LEFT + 14, cardY + 5, { width: innerW });

    this.doc.font('Helvetica').fontSize(7.5).fillColor(textCol);
    this.doc.text(description, MARGIN_LEFT + 14, cardY + titleH + 6, {
      width: innerW,
      lineGap: 1.5,
    });

    if (metaNote) {
      this.doc.font('Helvetica-Oblique').fontSize(7).fillColor(SLATE_MED);
      this.doc.text(metaNote, MARGIN_LEFT + 14, cardY + titleH + descH + 8, {
        width: innerW,
        lineGap: 1.2,
      });
    }

    this.doc.y = cardY + cardH + 4;
  }

  drawAllFooters(auditId: string, footerLabel: string): void {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);

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
    }
  }
}

/**
 * Generates the authoritative TradeGuard Trade Compliance Dossier PDF.
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
        Author: 'TradeGuard Intelligence Compliance Engine',
        Subject: 'Automated Sanctions, TBML, Dual-Use, Maritime Route & Document Audit Report',
        Keywords: 'Compliance, Sanctions, AML, TBML, Maritime Route Intelligence, Trade Finance',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', (err) => reject(err));

    const engine = new PageBudgetEngine(
      doc,
      'TRADEGUARD INTELLIGENCE — TRADE COMPLIANCE & SANCTIONS DOSSIER',
      'OFFICIAL AUDIT REPORT',
    );

    // ==========================================
    // Page 1: Metadata Box & Decision Badge
    // ==========================================
    const metaCardY = engine.currentY;
    const badgeWidth = 145;
    const textSectionWidth = USABLE_WIDTH - badgeWidth - 25;

    doc.rect(MARGIN_LEFT, metaCardY, USABLE_WIDTH, 62).fill(BG_LIGHT);
    doc.rect(MARGIN_LEFT, metaCardY, USABLE_WIDTH, 62).lineWidth(0.75).stroke(BORDER_COLOR);

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY);
    const shortName =
      model.filename.length > 52 ? model.filename.substring(0, 49) + '...' : model.filename;
    doc.text(shortName, MARGIN_LEFT + 12, metaCardY + 9, { width: textSectionWidth, lineBreak: false });

    doc.font('Helvetica').fontSize(7.5).fillColor(SLATE_MED);
    const metaLine1 = `Format: ${model.fileType}   •   Size: ${model.fileSizeFormatted}   •   Ref ID: ${model.transactionProfile.transactionReference}`;
    const metaLine2 = `Screened: ${model.screenedAtFormatted}   •   Engine: ${model.engineProvider}`;
    doc.text(metaLine1, MARGIN_LEFT + 12, metaCardY + 25, { width: textSectionWidth, lineBreak: false });
    doc.text(metaLine2, MARGIN_LEFT + 12, metaCardY + 39, { width: textSectionWidth, lineBreak: false });

    // Right Decision Badge Box
    const badgeX = MARGIN_LEFT + USABLE_WIDTH - badgeWidth - 10;
    const badgeY = metaCardY + 8;
    const badgeHeight = 46;

    const dec = model.executiveDecision.verdict;
    const decBg = dec === 'ALLOW' ? GREEN_BG : dec === 'REVIEW' ? AMBER_BG : RED_BG;
    const decBorder = dec === 'ALLOW' ? GREEN_BORDER : dec === 'REVIEW' ? AMBER_BORDER : RED_BORDER;
    const decColor = dec === 'ALLOW' ? GREEN_DARK : dec === 'REVIEW' ? AMBER_DARK : RED_DARK;

    doc.rect(badgeX, badgeY, badgeWidth, badgeHeight).fill(decBg);
    doc.rect(badgeX, badgeY, badgeWidth, badgeHeight).lineWidth(1).stroke(decBorder);

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(decColor);
    doc.text(dec === 'BLOCK_ESCALATE' ? 'BLOCK / ESCALATE' : dec, badgeX, badgeY + 8, {
      width: badgeWidth,
      align: 'center',
      lineBreak: false,
    });

    doc.font('Helvetica-Bold').fontSize(7).fillColor(decColor);
    doc.text(
      `Risk Score: ${model.executiveDecision.overallRiskScore}/100 • ${model.executiveDecision.riskSeverityLabel}`,
      badgeX,
      badgeY + 25,
      { width: badgeWidth, align: 'center', lineBreak: false },
    );

    engine.currentY = metaCardY + 70;

    // ==========================================
    // Section A: Executive Summary & Verdict
    // ==========================================
    engine.addSectionHeader('A. EXECUTIVE SUMMARY & COMPLIANCE VERDICT');
    engine.addKeyValueRow('Final Verdict', `${model.executiveDecision.verdictTitle}: ${model.executiveDecision.verdictText}`, dec !== 'ALLOW', true);
    engine.addKeyValueRow('Confidence Level', `${model.executiveDecision.confidencePercent}% Confidence Rating (Deterministic Engine)`, false, false);
    engine.addKeyValueRow('Primary Rationale', model.executiveDecision.primaryRationale.map((r) => `• ${r}`).join('\n'), false, true);

    if (model.executiveDecision.triggeredRules.length > 0) {
      engine.addKeyValueRow('Triggered Rules', model.executiveDecision.triggeredRules.join('; '), false, false);
    }

    // ==========================================
    // Section B: Transaction & Counterparties
    // ==========================================
    engine.addSectionHeader('B. TRANSACTION & COUNTERPARTIES PROFILE');
    engine.addKeyValueRow('Document Type', model.transactionProfile.documentType, false, true);
    engine.addKeyValueRow('Document / Transaction Ref', `${model.transactionProfile.documentNumber} (Txn: ${model.transactionProfile.transactionReference})`, false, false);
    engine.addKeyValueRow('Seller / Exporter', `${model.transactionProfile.sellerName} [${model.transactionProfile.sellerCountry}]`, false, true);
    engine.addKeyValueRow('Buyer / Importer', `${model.transactionProfile.buyerName} [${model.transactionProfile.buyerCountry}]`, false, false);

    if (model.transactionProfile.issuingBank) {
      engine.addKeyValueRow('Issuing Bank', model.transactionProfile.issuingBank, false, true);
    }
    if (model.transactionProfile.advisingBank) {
      engine.addKeyValueRow('Advising Bank', model.transactionProfile.advisingBank, false, false);
    }

    engine.addKeyValueRow('Consignee / End-User', `Consignee: ${model.transactionProfile.consignee || 'As per B/L'} | End-User: ${model.transactionProfile.endUser || 'Not Disclosed'}`, false, true);
    engine.addKeyValueRow('Shipment Route', `${model.transactionProfile.originCountry} (${model.transactionProfile.portOfLoading}) -> ${model.transactionProfile.destinationCountry} (${model.transactionProfile.portOfDischarge})`, false, false);
    engine.addKeyValueRow('Total Declared Value', `${model.transactionProfile.totalValueFormatted} (Incoterm: ${model.transactionProfile.incoterm})`, false, true);
    engine.addKeyValueRow('Payment Terms', model.transactionProfile.paymentTerms, false, false);

    // ==========================================
    // Section C: Sanctions & Point-in-Time Watchlist Intelligence
    // ==========================================
    engine.addSectionHeader('C. POINT-IN-TIME SANCTIONS & WATCHLIST SCREENING');
    engine.addKeyValueRow('Watchlist Verdict', model.sanctionsSummary.status, model.sanctionsSummary.wasListedAtTransactionTime, true);
    engine.addKeyValueRow('Point-in-Time Statement', model.sanctionsSummary.pointInTimeStatement, false, false);
    engine.addKeyValueRow('Historical Watchlist Status', model.sanctionsSummary.historicalFindingsSummary, model.sanctionsSummary.wasListedAtTransactionTime, true);
    engine.addKeyValueRow('Current Watchlist Status', model.sanctionsSummary.currentFindingsSummary, model.sanctionsSummary.isCurrentlyListed && !model.sanctionsSummary.wasListedAtTransactionTime, false);
    engine.addKeyValueRow('Beneficial Ownership (50% Rule)', model.sanctionsSummary.beneficialOwnershipVerdict, false, true);

    if (model.sanctionsSummary.postTransactionAddendums.length > 0) {
      for (const pta of model.sanctionsSummary.postTransactionAddendums) {
        engine.addAlertCard(
          `STATUS-CHANGE ADDENDUM: Entity "${pta.entityName}"`,
          `Party was subsequently added to ${pta.sanctionsList} on ${pta.designationDate} under program [${pta.programs.join(', ')}]. Under bitemporal compliance principles, this does not alter the historical clearance of this transaction as screened against the regulatory lists then in force.`,
          'MEDIUM',
          'Audit Note: Flagged for forward-settlement exposure monitoring.',
        );
      }
    }

    // ==========================================
    // Section D: Maritime Route Intelligence & Transshipment Detection
    // ==========================================
    engine.addSectionHeader('D. MARITIME ROUTE INTELLIGENCE & TRANSSHIPMENT DETECTION');
    const route = model.routeIntelligence;

    engine.addKeyValueRow('Declared Route', route.declaredRouteSummary, false, true);
    engine.addKeyValueRow('Observed Vessel Calls', route.observedRouteSummary, route.routeDeviationDetected, false);
    engine.addKeyValueRow('Vessel Identification', route.vesselIdentifier, false, true);
    engine.addKeyValueRow('Intermediate Ports Observed', `${route.intermediatePortsCount} Total Calls (${route.undeclaredIntermediatePortsCount} Undeclared in Trade Documents)`, route.undeclaredIntermediatePortsCount > 0, false);
    engine.addKeyValueRow('Route Classification', `${route.routeClassification} • Risk: ${route.routeRiskLevel} (Score: ${route.routeRiskScore}/100)`, route.routeRiskScore >= 50, true);
    engine.addKeyValueRow('Evidence Source', route.evidenceSummary, false, false);

    for (const finding of route.routeFindings) {
      engine.addAlertCard(
        `ROUTE FINDING: [${route.routeClassification}]`,
        finding,
        route.routeRiskLevel === 'CRITICAL' ? 'CRITICAL' : route.routeRiskLevel === 'HIGH' ? 'HIGH' : route.routeRiskLevel === 'MEDIUM' ? 'MEDIUM' : 'LOW',
        route.limitationNotice,
      );
    }

    if (route.observedCallsTimeline.length > 0) {
      engine.addTable(
        [
          { header: 'Port Name', width: 140 },
          { header: 'UN/LOCODE', width: 75 },
          { header: 'Jurisdiction', width: 95 },
          { header: 'Observed Time (UTC)', width: 120 },
          { header: 'Declared', width: 60, align: 'center' },
        ],
        route.observedCallsTimeline.map((c) => [
          c.portName,
          c.locode,
          c.country,
          c.timestamp,
          c.isDeclared ? 'YES' : 'NO [!]',
        ]),
      );
    }

    // ==========================================
    // Section E: Market Pricing Intelligence & Benchmarks
    // ==========================================
    if (model.pricingIntelligence.items.length > 0) {
      engine.addSectionHeader('E. REAL-TIME MARKET PRICING & COMMODITY BENCHMARKS');
      engine.addTable(
        [
          { header: '#', width: 24 },
          { header: 'Commodity Description', width: 155 },
          { header: 'HS Code', width: 60 },
          { header: 'Declared Price', width: 85 },
          { header: 'Market Benchmark', width: 110 },
          { header: 'Variance', width: 55, align: 'right' },
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

    // ==========================================
    // Section F: Customer 360 & Behavioral Risk Profile
    // ==========================================
    if (model.customerBehavior) {
      const cb = model.customerBehavior;
      engine.addSectionHeader('F. CUSTOMER 360 & BEHAVIORAL BASELINE ANALYSIS');
      engine.addKeyValueRow('Customer Golden Record', `${cb.customerReferenceId} (${cb.legalName})`, false, true);
      engine.addKeyValueRow('Declared Line of Business', cb.declaredBusiness, false, false);
      engine.addKeyValueRow('Historical LC Baseline', `Average: ${cb.historicalLcFrequencyMean} | Lifetime Volume: ${cb.lifetimeVolumeFormatted}`, false, true);

      if (cb.alerts.length > 0) {
        for (const alt of cb.alerts) {
          engine.addAlertCard(
            `BEHAVIORAL ANOMALY: [${alt.alertCode}] ${alt.metric}`,
            alt.explanation,
            alt.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
            `Observed: ${alt.observedValue} vs Historical Baseline: ${alt.baselineValue}`,
          );
        }
      } else {
        engine.addKeyValueRow('Behavioral Baseline Verdict', 'Transaction pattern fully conforms with customer historical volume and routing baselines.', false, false);
      }
    }

    // ==========================================
    // Section G: Prioritized Critical Findings
    // ==========================================
    if (model.criticalFindings.length > 0) {
      engine.addSectionHeader('G. PRIORITIZED COMPLIANCE FINDINGS & EVIDENCE');
      for (const ef of model.criticalFindings.slice(0, 6)) {
        engine.addAlertCard(
          `[${ef.severity}] ${ef.title} (${ef.category})`,
          ef.finding,
          ef.severity,
          `Action: ${ef.recommendedAction} • Authority: ${ef.regulatoryReference}`,
        );
      }
    }

    // ==========================================
    // Section H: 9-Factor Explainable Risk Score Matrix
    // ==========================================
    engine.addSectionHeader('H. EXPLAINABLE 9-FACTOR RISK SCORE MATRIX');

    const colCount = 2;
    const colW = (USABLE_WIDTH - 16) / colCount;
    const rowH = 20;
    const scoreItems = model.riskScores;
    const totalMatrixH = Math.ceil(scoreItems.length / colCount) * rowH + 6;

    engine.ensureSpace(totalMatrixH);
    const startMatrixY = doc.y;

    for (let i = 0; i < scoreItems.length; i++) {
      const item = scoreItems[i]!;
      const colIdx = i % colCount;
      const rowIdx = Math.floor(i / colCount);
      const itemX = MARGIN_LEFT + colIdx * (colW + 12);
      const itemY = startMatrixY + rowIdx * rowH;

      const itemColor = item.score < 25 ? GREEN_DARK : item.score < 60 ? AMBER_DARK : RED_DARK;
      doc.rect(itemX, itemY, colW, rowH - 3).fill(BG_LIGHT);
      doc.rect(itemX, itemY, colW, rowH - 3).lineWidth(0.5).stroke(BORDER_COLOR);

      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(SLATE_DARK);
      doc.text(item.label, itemX + 6, itemY + 4, { width: colW - 75, lineBreak: false });

      const barW = 35;
      const barX = itemX + colW - 70;
      doc.rect(barX, itemY + 5, barW, 4).fill('#e2e8f0');
      doc.rect(barX, itemY + 5, Math.max(1, (item.score / 100) * barW), 4).fill(itemColor);

      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(itemColor);
      doc.text(`${item.score}/100`, itemX + colW - 32, itemY + 4, { width: 28, align: 'right', lineBreak: false });
    }

    doc.y = startMatrixY + Math.ceil(scoreItems.length / colCount) * rowH + 8;

    // ==========================================
    // Section I: Cryptographic Seal & Compliance Sign-Off
    // ==========================================
    engine.addSectionHeader('I. CRYPTOGRAPHIC PROVENANCE & COMPLIANCE ENDORSEMENT');
    const ep = model.evidenceDigest;
    engine.addKeyValueRow('Evidence Package ID', ep.packageId, false, true);
    engine.addKeyValueRow('Document SHA-256 Digest', ep.documentSha256, false, false);
    engine.addKeyValueRow('Integrity Hash Chain', ep.transactionHashSha256, false, true);
    engine.addKeyValueRow('Verification Seal Digest', ep.verificationDigestSha256, false, false);

    // Examiner Sign-off Endorsement Box
    const signBoxH = 75;
    engine.ensureSpace(signBoxH + 20);

    const signY = doc.y + 6;
    doc.rect(MARGIN_LEFT, signY, USABLE_WIDTH, signBoxH).fill(BG_LIGHT);
    doc.rect(MARGIN_LEFT, signY, USABLE_WIDTH, signBoxH).lineWidth(0.75).stroke(BORDER_COLOR);

    doc.font('Helvetica-Bold').fontSize(8).fillColor(SLATE_DARK);
    doc.text('COMPLIANCE OFFICER REVIEW & SIGN-OFF ENDORSEMENT', MARGIN_LEFT + 12, signY + 8);

    doc.font('Helvetica').fontSize(7.5).fillColor(SLATE_MED);
    doc.text(
      'I hereby certify that I have reviewed this automated point-in-time compliance dossier and verified the entity screenings and maritime observations against applicable banking trade policies.',
      MARGIN_LEFT + 12,
      signY + 20,
      { width: USABLE_WIDTH - 24, lineGap: 1.2 },
    );

    const sigLineY = signY + 54;
    doc.rect(MARGIN_LEFT + 12, sigLineY, 135, 0.5).fill(SLATE_MUTED);
    doc.font('Helvetica').fontSize(7).fillColor(SLATE_MED);
    doc.text('Compliance Officer Name', MARGIN_LEFT + 12, sigLineY + 3);

    doc.rect(MARGIN_LEFT + 165, sigLineY, 135, 0.5).fill(SLATE_MUTED);
    doc.text('Authorized Signature', MARGIN_LEFT + 165, sigLineY + 3);

    doc.rect(MARGIN_LEFT + 320, sigLineY, 75, 0.5).fill(SLATE_MUTED);
    doc.text('Date', MARGIN_LEFT + 320, sigLineY + 3);

    // Official Verdict Stamp
    doc.rect(MARGIN_LEFT + 415, signY + 30, 95, 36).lineWidth(1).stroke(decColor);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(decColor);
    doc.text(dec === 'BLOCK_ESCALATE' ? 'BLOCK' : dec, MARGIN_LEFT + 415, signY + 37, {
      width: 95,
      align: 'center',
      lineBreak: false,
    });
    doc.font('Helvetica').fontSize(6.5).fillColor(decColor);
    doc.text('OFFICIAL VERDICT', MARGIN_LEFT + 415, signY + 51, { width: 95, align: 'center', lineBreak: false });

    // Draw all footers across buffered pages
    engine.drawAllFooters(model.transactionProfile.transactionReference, 'STRICTLY CONFIDENTIAL — COMPLIANCE AUDIT');

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

    doc.rect(MARGIN_LEFT, headerCardY, USABLE_WIDTH, 64).fill(BG_LIGHT);
    doc.rect(MARGIN_LEFT, headerCardY, USABLE_WIDTH, 64).lineWidth(0.75).stroke(BORDER_COLOR);

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY);
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

    doc.rect(scoreBadgeX, scoreBadgeY, scoreBadgeWidth, scoreBadgeHeight).fill(verdictBg);
    doc.rect(scoreBadgeX, scoreBadgeY, scoreBadgeWidth, scoreBadgeHeight).lineWidth(1).stroke(verdictBorder);

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
