import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { DocumentsService } from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import type {
  DocumentDetail,
  TradeComplianceAnalysis,
  ComplianceDecision,
  ProductPriceIntelligenceResult,
  ProductRegulatoryIntelligenceResult,
  FxRateQuote,
} from '../../models/api.models';

import { formatBytes, formatDuration } from '../../shared/format';
import { Icon } from '../../shared/components/icon';
import { ReportModal } from '../../shared/components/report-modal';
import { ArcGauge } from '../../shared/components/arc-gauge';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { Sparkline } from '../../shared/components/sparkline';
import { ScrollRevealDirective } from '../../shared/directives/scroll-reveal.directive';

@Component({
  selector: 'app-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    DatePipe,
    DecimalPipe,
    Icon,
    ReportModal,
    ArcGauge,
    AnimatedCounter,
    Sparkline,
    ScrollRevealDirective,
  ],
  templateUrl: './analysis.component.html',
  styleUrls: ['./analysis.component.scss'],
})
export class AnalysisComponent implements OnInit {
  protected readonly Math = Math;
  protected readonly formatBytes = formatBytes;
  protected readonly formatDuration = formatDuration;

  private readonly docsService = inject(DocumentsService);
  private readonly toast = inject(ToastService);

  readonly id = input.required<string>();

  readonly doc = signal<DocumentDetail | null>(null);
  readonly loadingDoc = signal<boolean>(true);
  readonly showReportModal = signal<boolean>(false);

  readonly activeTab = signal<
    | 'sanctions'
    | 'exportControls'
    | 'tbml'
    | 'maritime'
    | 'integrity'
    | 'discrepancies'
    | 'scores'
    | 'pricing'
    | 'regulatory'
    | 'customerBehavior'
  >('sanctions');

  // Human Override State
  readonly showOverrideBox = signal<boolean>(false);
  readonly pendingAction = signal<string>('');
  readonly pendingNewDecision = signal<ComplianceDecision>('ALLOW');
  overrideOfficerName = 'Senior Compliance Officer';
  overrideReason = '';

  readonly tc = computed<TradeComplianceAnalysis | undefined>(() => {
    return this.doc()?.analysis?.tradeCompliance;
  });

  readonly anomaliesCount = computed<number>(() => {
    const list = this.tc()?.pricingIntelligence || [];
    return list.filter(
      (i) => i.classification === 'HIGH_PRICE_ANOMALY' || i.classification === 'LOW_PRICE_ANOMALY'
    ).length;
  });

  readonly liveFxQuote = signal<FxRateQuote | null>(null);
  readonly loadingFx = signal<boolean>(false);

  hasPriceAnomaly(items: ProductPriceIntelligenceResult[]): boolean {
    return items.some(
      (i) => i.classification === 'HIGH_PRICE_ANOMALY' || i.classification === 'LOW_PRICE_ANOMALY'
    );
  }

  hasRestrictedGoods(items: ProductRegulatoryIntelligenceResult[]): boolean {
    return items.some((i) => i.currentRestrictionStatus !== 'PERMITTED');
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

  getPillarColor(score: number): string {
    if (score >= 60) return '#ef4444';
    if (score >= 20) return '#f59e0b';
    return '#10b981';
  }

  ngOnInit(): void {
    this.loadDocumentResults();
  }

  loadDocumentResults(): void {
    this.loadingDoc.set(true);
    this.docsService.results(this.id()).subscribe({
      next: (detail) => {
        this.doc.set(detail);
        this.loadingDoc.set(false);
        this.fetchLiveFxQuote();
      },
      error: (err: any) => {
        this.loadingDoc.set(false);
        this.toast.error('Failed to load analysis', err.message);
      },
    });
  }

  fetchLiveFxQuote(): void {
    const txn = this.tc()?.transaction;
    const val = txn?.totalValue ?? 0;
    const curr = txn?.currency || 'USD';
    this.loadingFx.set(true);
    this.docsService.getLiveFxQuote(val, curr, 'PKR').subscribe({
      next: (quote) => {
        this.liveFxQuote.set(quote);
        this.loadingFx.set(false);
      },
      error: () => {
        this.loadingFx.set(false);
      },
    });
  }

  downloadPdfReport(): void {
    const d = this.doc();
    if (!d) return;
    const name = d.filename.replace(/\.[^/.]+$/, '') + '-compliance-report.pdf';
    this.docsService.downloadPdfReport(d.id, name).subscribe({
      next: (downloadedAs) => {
        this.toast.success('PDF Report downloaded', downloadedAs);
      },
      error: () => {
        this.toast.error('Download failed', 'Could not download PDF report.');
      },
    });
  }

  downloadTxtReport(): void {
    const d = this.doc();
    if (!d) return;
    const name = d.filename.replace(/\.[^/.]+$/, '') + '-trade-compliance-report.txt';
    this.docsService.downloadReport(d.id, name).subscribe({
      next: (downloadedAs) => {
        this.toast.success('Compliance Report downloaded', downloadedAs);
      },
      error: () => {
        this.toast.error('Download failed', 'Could not download text report.');
      },
    });
  }

  openOverrideDialog(action: string, newDecision: ComplianceDecision): void {
    this.pendingAction.set(action);
    this.pendingNewDecision.set(newDecision);
    this.overrideReason = '';
    this.showOverrideBox.set(true);
  }

  submitHumanOverride(): void {
    if (!this.overrideReason.trim()) return;

    this.docsService
      .overrideDecision(this.id(), {
        action: this.pendingAction(),
        officerName: this.overrideOfficerName || 'Compliance Officer',
        officerRole: 'Senior Trade Compliance Officer',
        newDecision: this.pendingNewDecision(),
        reason: this.overrideReason,
      })
      .subscribe({
        next: (updatedDoc) => {
          this.doc.set(updatedDoc);
          this.showOverrideBox.set(false);
          this.toast.success(
            'Compliance Decision Overridden & Audited',
            `New Decision: ${this.pendingNewDecision()}`
          );
        },
        error: (err: any) => {
          this.toast.error('Override failed', err.message);
        },
      });
  }

  getRiskSeverityLabel(score: number): string {
    if (score >= 80) return 'CRITICAL';
    if (score >= 60) return 'HIGH';
    if (score >= 40) return 'ELEVATED';
    if (score >= 20) return 'MODERATE';
    return 'LOW';
  }

  getPricingSparklineData(pi: ProductPriceIntelligenceResult): number[] {
    const low = pi.observedMarketLowUsd ?? 0;
    const med = pi.observedMarketMedianUsd ?? (low > 0 ? low * 1.15 : 100);
    const high = pi.observedMarketHighUsd ?? (med * 1.25);
    const declared = pi.declaredUnitPrice ?? med;
    return [low, (low + med) / 2, med, declared, high];
  }
}
