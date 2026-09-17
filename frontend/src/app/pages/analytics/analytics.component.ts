import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AnalyticsService } from '../../services/analytics.service';
import { Icon } from '../../shared/components/icon';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { Sparkline } from '../../shared/components/sparkline';
import { EnterpriseFooterComponent } from '../../shared/components/enterprise-footer.component';
import type {
  StatusDistributionItem,
  TimeSeriesPoint,
  TimeRangeKey,
} from '../../models/analytics.models';

@Component({
  selector: 'app-analytics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    Icon,
    AnimatedCounter,
    Sparkline,
    EnterpriseFooterComponent,
  ],
  providers: [DatePipe, DecimalPipe],
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss'],
})
export class AnalyticsComponent implements OnInit {
  protected readonly analytics = inject(AnalyticsService);
  private readonly router = inject(Router);

  // Time range selector options
  readonly timeRanges: Array<{ key: TimeRangeKey; label: string }> = [
    { key: 'today', label: 'Today' },
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
    { key: '90d', label: '90D' },
    { key: '180d', label: '180D' },
    { key: '1y', label: '1Y' },
    { key: 'all', label: 'All Time' },
  ];

  // Active chart series toggle
  readonly activeChartSeries = signal<'all' | 'docs' | 'analyses' | 'failures'>('all');

  // Interactive hover states for SVG charts
  readonly hoveredTrendIndex = signal<number | null>(null);
  readonly hoveredDonutIndex = signal<number | null>(null);

  // Active tab for operational deep dives
  readonly activeIntelligenceTab = signal<'geo' | 'customers' | 'pricing' | 'routing' | 'sources'>('geo');

  // Drilldown search input & pagination
  readonly drilldownSearch = signal<string>('');
  readonly drilldownLimit = signal<number>(20);

  // Expose dashboard signals
  readonly dashboard = this.analytics.dashboardData;
  readonly loading = this.analytics.loading;
  readonly error = this.analytics.error;
  readonly lastRefreshedAt = this.analytics.lastRefreshedAt;
  readonly selectedRange = this.analytics.selectedRange;
  readonly autoRefresh = this.analytics.autoRefreshEnabled;
  readonly filters = this.analytics.filters;
  readonly drilldownDocs = this.analytics.drilldownDocs;
  readonly drilldownTotal = this.analytics.drilldownTotal;
  readonly drilldownLoading = this.analytics.drilldownLoading;

  // Computed sparklines for KPI cards
  readonly documentsSparkline = computed<number[]>(() => {
    const trend = this.dashboard()?.documentActivity.volumeTrend || [];
    return trend.length > 0 ? trend.map((p) => p.uniqueDocuments) : [0, 0];
  });

  readonly importsSparkline = computed<number[]>(() => {
    const trend = this.dashboard()?.documentActivity.volumeTrend || [];
    return trend.length > 0 ? trend.map((p) => p.uniqueDocuments + p.duplicateImports) : [0, 0];
  });

  readonly runsSparkline = computed<number[]>(() => {
    const trend = this.dashboard()?.analysisPerformance.throughputOverTime || [];
    return trend.length > 0 ? trend.map((p) => p.analysisRuns) : [0, 0];
  });

  readonly failuresSparkline = computed<number[]>(() => {
    const trend = this.dashboard()?.documentActivity.volumeTrend || [];
    return trend.length > 0 ? trend.map((p) => p.failedAnalyses) : [0, 0];
  });

  readonly latencySparkline = computed<number[]>(() => {
    const trend = this.dashboard()?.analysisPerformance.throughputOverTime || [];
    return trend.length > 0 ? trend.map((p) => p.averageProcessingMs) : [0, 0];
  });

  // Filtered drill-down items based on local search term
  readonly filteredDrilldownDocs = computed(() => {
    const query = this.drilldownSearch().toLowerCase().trim();
    const docs = this.drilldownDocs();
    if (!query) return docs;
    return docs.filter(
      (d) =>
        d.id.toLowerCase().includes(query) ||
        d.filename.toLowerCase().includes(query) ||
        (d.fileType && d.fileType.toLowerCase().includes(query)) ||
        (d.analysis?.tradeCompliance?.decision?.decision &&
          d.analysis.tradeCompliance.decision.decision.toLowerCase().includes(query)) ||
        (d.analysis?.tradeCompliance?.transaction?.originCountry &&
          d.analysis.tradeCompliance.transaction.originCountry.toLowerCase().includes(query)) ||
        (d.analysis?.tradeCompliance?.transaction?.destinationCountry &&
          d.analysis.tradeCompliance.transaction.destinationCountry.toLowerCase().includes(query)),
    );
  });

  // SVG Volume Trend Chart Geometry Calculations
  readonly trendChartGeometry = computed(() => {
    const points = this.dashboard()?.documentActivity.volumeTrend || [];
    const width = 800;
    const height = 240;
    const padX = 45;
    const padTop = 25;
    const padBottom = 35;
    const usableW = width - padX - 25;
    const usableH = height - padTop - padBottom;

    if (points.length === 0) {
      return {
        width,
        height,
        points: [],
        docsLine: '',
        docsArea: '',
        runsLine: '',
        failuresLine: '',
        maxVal: 10,
        gridY: [
          { val: 10, y: padTop },
          { val: 5, y: padTop + usableH / 2 },
          { val: 0, y: padTop + usableH },
        ],
      };
    }

    const maxVal = Math.max(
      5,
      ...points.map((p) =>
        Math.max(p.uniqueDocuments, p.duplicateImports + p.uniqueDocuments, p.analysisRuns, p.failedAnalyses),
      ),
    );

    const xStep = points.length > 1 ? usableW / (points.length - 1) : usableW;

    const coords = points.map((p, i) => {
      const x = padX + i * xStep;
      const yDocs = padTop + usableH - (p.uniqueDocuments / maxVal) * usableH;
      const yRuns = padTop + usableH - (p.analysisRuns / maxVal) * usableH;
      const yFail = padTop + usableH - (p.failedAnalyses / maxVal) * usableH;
      return { x, yDocs, yRuns, yFail, point: p };
    });

    // Build docs SVG path
    let docsLine = coords.reduce((acc, c, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)},${c.yDocs.toFixed(1)}`, '');
    const docsArea = coords.length > 0
      ? `${docsLine} L ${coords[coords.length - 1].x.toFixed(1)},${(padTop + usableH).toFixed(1)} L ${coords[0].x.toFixed(1)},${(padTop + usableH).toFixed(1)} Z`
      : '';

    // Build runs line
    let runsLine = coords.reduce((acc, c, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)},${c.yRuns.toFixed(1)}`, '');

    // Build failures line
    let failuresLine = coords.reduce((acc, c, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)},${c.yFail.toFixed(1)}`, '');

    const gridY = [
      { val: maxVal, y: padTop },
      { val: Math.round(maxVal * 0.5), y: padTop + usableH * 0.5 },
      { val: 0, y: padTop + usableH },
    ];

    return { width, height, points: coords, docsLine, docsArea, runsLine, failuresLine, maxVal, gridY };
  });

  // SVG Donut Chart Geometry Calculations
  readonly donutChartGeometry = computed(() => {
    const rawSlices = this.dashboard()?.documentActivity.statusDistribution || [];
    const r = 78;
    const circ = 2 * Math.PI * r;

    let accumPercent = 0;
    const slices = rawSlices.map((s, idx) => {
      const strokeDasharray = `${((s.percentage / 100) * circ).toFixed(2)} ${circ.toFixed(2)}`;
      const strokeDashoffset = (-((accumPercent / 100) * circ)).toFixed(2);
      accumPercent += s.percentage;
      return {
        ...s,
        index: idx,
        strokeDasharray,
        strokeDashoffset,
      };
    });

    return { r, circ, slices };
  });

  ngOnInit(): void {
    this.analytics.refreshDashboard();
  }

  onSelectRange(range: TimeRangeKey): void {
    this.analytics.setTimeRange(range);
  }

  onFilterChange(key: 'docType' | 'riskLevel' | 'status' | 'country', value: string): void {
    this.analytics.setFilter(key, value);
  }

  clearFilters(): void {
    this.drilldownSearch.set('');
    this.analytics.clearFilters();
  }

  refreshNow(): void {
    this.analytics.refreshDashboard();
  }

  toggleAutoRefresh(): void {
    this.analytics.toggleAutoRefresh();
  }

  exportJson(): void {
    this.analytics.exportJsonReport();
  }

  exportCsv(): void {
    this.analytics.exportDrilldownCsv();
  }

  inspectDocument(id: string): void {
    this.router.navigate(['/analysis', id]);
  }

  filterByRiskTier(riskLevel: string): void {
    this.analytics.setFilter('riskLevel', riskLevel);
  }

  filterByStatus(status: string): void {
    this.analytics.setFilter('status', status);
  }

  setHoveredTrend(index: number | null): void {
    this.hoveredTrendIndex.set(index);
  }

  setHoveredDonut(index: number | null): void {
    this.hoveredDonutIndex.set(index);
  }

  formatMs(ms: number | undefined): string {
    if (!ms && ms !== 0) return '0ms';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
}
