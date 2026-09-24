import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { DocumentsService } from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import type { DocumentDetail, FxRateQuote } from '../../models/api.models';
import { formatBytes } from '../format';
import { Icon } from './icon';
import { AnimatedCounter } from './animated-counter';

interface StructuredCitation {
  index: number;
  pageNumber: number;
  paragraphNumber: number;
  section: string | null;
  snippet: string;
  contentType?: string;
  topic?: string;
}

@Component({
  selector: 'app-report-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, DecimalPipe, DatePipe, AnimatedCounter],
  templateUrl: './report-modal.html',
  styleUrls: ['./report-modal.scss'],
})
export class ReportModal implements OnInit {
  private readonly docsService = inject(DocumentsService);
  private readonly toast = inject(ToastService);

  readonly documentId = input.required<string>();
  readonly filename = input<string>('analysis-report.txt');
  readonly document = input<DocumentDetail | null>(null);
  readonly close = output<void>();

  protected readonly Math = Math;
  protected readonly formatBytes = formatBytes;
  protected readonly activeTab = signal<'structured' | 'raw'>('structured');
  protected readonly content = signal<string>('');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected readonly modalCitations = computed<StructuredCitation[]>(() => {
    const d = this.document();
    const list = (d as any)?.units || [];
    const citations: StructuredCitation[] = [];

    let idx = 1;
    for (const u of list) {
      if (u.text && u.text.trim().length > 30) {
        citations.push({
          index: idx++,
          pageNumber: u.pageNumber,
          paragraphNumber: u.paragraphNumber,
          section: u.section,
          snippet: u.text.length > 250 ? u.text.slice(0, 247) + '...' : u.text,
          contentType: u.classification?.contentType,
          topic: u.classification?.topic,
        });
      }
      if (citations.length >= 20) break;
    }
    return citations;
  });

  readonly liveFxQuote = signal<FxRateQuote | null>(null);

  getRiskSeverityLabel(score: number): string {
    if (score >= 70) return 'CRITICAL RISK';
    if (score >= 40) return 'ELEVATED';
    if (score >= 20) return 'MODERATE';
    return 'LOW RISK (CLEAR)';
  }

  getPillarColor(score: number): string {
    if (score >= 60) return '#ef4444';
    if (score >= 20) return '#f59e0b';
    return '#10b981';
  }

  hasItemDetails(g: any): boolean {
    if (!g) return false;
    const parts = [g.brand, g.model, g.sku].filter(
      (v) => v && typeof v === 'string' && v.trim() !== '' && v.trim() !== 'Not Found'
    );
    return parts.length > 0;
  }

  getItemDetails(g: any): string {
    if (!g) return '';
    const parts: string[] = [];
    if (g.brand && g.brand !== 'Not Found') parts.push(`Brand: ${g.brand}`);
    if (g.model && g.model !== 'Not Found') parts.push(`Model: ${g.model}`);
    if (g.sku && g.sku !== 'Not Found') parts.push(`SKU: ${g.sku}`);
    return parts.join(' · ');
  }

  ngOnInit(): void {
    const d = this.document();
    if (d && d.analysis) {
      this.content.set(this.buildClientReport(d));
    }
    this.loadReport();
    this.fetchLiveFxQuote();
  }

  fetchLiveFxQuote(): void {
    const d = this.document();
    const txn = d?.analysis?.tradeCompliance?.transaction;
    const val = txn?.totalValue ?? 0;
    const curr = txn?.currency || 'USD';
    this.docsService.getLiveFxQuote(val, curr, 'PKR').subscribe({
      next: (quote) => {
        this.liveFxQuote.set(quote);
      },
      error: () => {},
    });
  }

  loadReport(): void {
    const id = this.documentId();
    if (!id) return;

    this.loading.set(true);
    this.error.set(null);

    this.docsService.reportText(id).subscribe({
      next: (text) => {
        if (text && text.trim().length > 0) {
          this.content.set(text);
        }
        this.loading.set(false);
      },
      error: () => {
        if (!this.content()) {
          this.error.set('Failed to load the generated text report.');
        }
        this.loading.set(false);
      },
    });
  }

  private buildClientReport(doc: DocumentDetail): string {
    const border = '='.repeat(78);
    const divider = '-'.repeat(78);
    const tc = doc.analysis?.tradeCompliance;

    if (tc) {
      const p = tc.transaction.parties;
      const lines: string[] = [
        border,
        'TRADE FINANCE COMPLIANCE & RISK INTELLIGENCE REPORT',
        'TradeGuard Intelligence — Bank-Grade Regulatory Screening Platform',
        border,
        '',
        `Document Name       : ${doc.filename}`,
        `Document Type       : ${tc.documentClassification.type}`,
        `Document Number     : ${tc.documentClassification.number}`,
        `Document Date       : ${tc.documentClassification.date}`,
        `Total Pages         : ${doc.extraction?.pageCount || 1}`,
        `Compliance Decision : [ ${tc.decision.decision} ] (Confidence: ${Math.round(tc.decision.confidence * 100)}%)`,
        `Overall Risk Score  : ${tc.riskScores.overall} / 100`,
        `Screening Timestamp : ${tc.sanctions.screeningTimestamp || new Date().toISOString()}`,
        '',
        divider,
        'EXECUTIVE SUMMARY',
        divider,
        `Compliance Decision : ${tc.decision.decision}`,
        'Decision Reasons:',
        ...tc.decision.reasons.map((r) => `  * ${r}`),
        '',
        divider,
        'COMMERCIAL COUNTERPARTIES',
        divider,
        `Seller / Exporter   : ${p.seller?.legalName} (${p.seller?.country || 'N/A'})`,
        `Buyer / Importer    : ${p.buyer?.legalName} (${p.buyer?.country || 'N/A'})`,
        `Origin Country      : ${tc.transaction.originCountry}`,
        `Destination Country : ${tc.transaction.destinationCountry}`,
        `Transaction Value   : ${tc.transaction.currency} ${tc.transaction.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        `Incoterm / Terms    : ${tc.transaction.incoterm || 'FOB'} · ${tc.transaction.paymentTerms || 'N/A'}`,
        '',
        divider,
        'REGULATORY RISK BREAKDOWN',
        divider,
        `Sanctions Risk      : ${tc.riskScores.sanctions} / 100`,
        `Export Controls     : ${tc.riskScores.exportControl} / 100`,
        `TBML Price Risk     : ${tc.riskScores.tbml} / 100`,
        `Document Integrity  : ${tc.riskScores.documentIntegrity} / 100`,
        '',
        divider,
        `DISCREPANCY FINDINGS (${tc.discrepancies.length})`,
        divider,
        ...(tc.discrepancies.length > 0
          ? tc.discrepancies.map((d) => `  * [${d.severity}] ${d.field}: ${d.explanation}`)
          : ['  * No commercial discrepancies detected.']),
        '',
        border,
        'END OF REPORT — CONFIDENTIAL BANKING WORKFLOW',
        border,
      ];
      return lines.join('\n');
    }

    // Fallback for non-trade raw text
    const summary = doc.analysis?.summary;

    const lines: string[] = [
      border,
      'DOCUMENT ANALYSIS REPORT',
      'TradeGuard Intelligence Platform',
      border,
      '',
      `Document Name      : ${doc.filename}`,
      `Document Type      : ${doc.fileType.toUpperCase()}`,
      `Total Pages        : ${doc.extraction?.pageCount || 1}`,
      `Processing Engine  : ${doc.analysis?.engine?.provider || 'heuristic'}`,
      '',
      divider,
      'EXECUTIVE SUMMARY',
      divider,
      `Headline: ${summary?.headline || 'Analysis Completed'}`,
      `${summary?.narrative || 'Document analyzed across semantic compliance dimensions.'}`,
      '',
      border,
      'END OF REPORT',
      border,
    ];
    return lines.join('\n');
  }

  protected copyCurrentContent(): void {
    const text = this.content();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.copied.set(true);
      this.toast.success('Report copied to clipboard');
      setTimeout(() => this.copied.set(false), 2500);
    });
  }

  protected copySnippet(snippet: string): void {
    navigator.clipboard.writeText(snippet).then(() => {
      this.toast.success('Citation excerpt copied');
    });
  }

  protected downloadPdf(): void {
    const id = this.documentId();
    const name = this.filename().replace(/\.[^/.]+$/, '') + '-compliance-report.pdf';
    this.docsService.downloadPdfReport(id, name).subscribe({
      next: (downloadedAs) => {
        this.toast.success('PDF Report downloaded', downloadedAs);
      },
      error: () => {
        this.toast.error('Download failed', 'Could not download the PDF report.');
      },
    });
  }

  protected download(): void {
    const id = this.documentId();
    const name = this.filename().replace(/\.[^/.]+$/, '') + '-analysis.txt';
    this.docsService.downloadReport(id, name).subscribe({
      next: (downloadedAs) => {
        this.toast.success('Report downloaded', downloadedAs);
      },
      error: () => {
        this.toast.error('Download failed', 'Could not download the text report.');
      },
    });
  }
}
