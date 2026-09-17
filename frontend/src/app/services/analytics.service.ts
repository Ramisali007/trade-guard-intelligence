import { Injectable, inject, signal, effect } from '@angular/core';
import { Observable, Subscription, interval, of } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import type {
  AnalyticsDashboardResponse,
  AnalyticsDrilldownItem,
  AnalyticsFilterParams,
  TimeRangeKey,
} from '../models/analytics.models';

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly api = inject(ApiService);

  // Core state signals
  readonly selectedRange = signal<TimeRangeKey>('30d');
  readonly customFrom = signal<string | null>(null);
  readonly customTo = signal<string | null>(null);
  readonly filters = signal<Partial<AnalyticsFilterParams>>({});

  readonly dashboardData = signal<AnalyticsDashboardResponse | null>(null);
  readonly drilldownDocs = signal<AnalyticsDrilldownItem[]>([]);
  readonly drilldownTotal = signal<number>(0);
  readonly loading = signal<boolean>(false);
  readonly drilldownLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly lastRefreshedAt = signal<Date | null>(null);

  // Auto-refresh timer state
  readonly autoRefreshEnabled = signal<boolean>(false);
  readonly autoRefreshIntervalSec = signal<number>(30);
  private timerSub: Subscription | null = null;

  constructor() {
    // React to auto-refresh toggles
    effect(() => {
      const enabled = this.autoRefreshEnabled();
      const intervalSec = this.autoRefreshIntervalSec();
      if (this.timerSub) {
        this.timerSub.unsubscribe();
        this.timerSub = null;
      }
      if (enabled && intervalSec > 0) {
        this.timerSub = interval(intervalSec * 1000).subscribe(() => {
          if (!this.loading()) {
            this.refreshDashboard();
          }
        });
      }
    });
  }

  /**
   * Fetch full analytics dashboard payload from backend.
   */
  getDashboard(params?: Partial<AnalyticsFilterParams>): Observable<AnalyticsDashboardResponse> {
    const queryParams: Record<string, unknown> = {
      range: params?.range || this.selectedRange(),
      ...(params?.from ? { from: params.from } : {}),
      ...(params?.to ? { to: params.to } : {}),
      ...(params?.docType ? { docType: params.docType } : {}),
      ...(params?.country ? { country: params.country } : {}),
      ...(params?.customer ? { customer: params.customer } : {}),
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.riskLevel ? { riskLevel: params.riskLevel } : {}),
    };

    return this.api.get<AnalyticsDashboardResponse>('/analytics', queryParams);
  }

  /**
   * Fetch drill-down documents matching current active filters.
   */
  getDrilldown(params?: Partial<AnalyticsFilterParams> & { limit?: number; offset?: number }): Observable<{ total: number; documents: AnalyticsDrilldownItem[] }> {
    const queryParams: Record<string, unknown> = {
      range: params?.range || this.selectedRange(),
      limit: params?.limit ?? 50,
      offset: params?.offset ?? 0,
      ...(params?.from ? { from: params.from } : {}),
      ...(params?.to ? { to: params.to } : {}),
      ...(params?.docType ? { docType: params.docType } : {}),
      ...(params?.country ? { country: params.country } : {}),
      ...(params?.customer ? { customer: params.customer } : {}),
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.riskLevel ? { riskLevel: params.riskLevel } : {}),
    };

    return this.api.get<{ total: number; documents: AnalyticsDrilldownItem[] }>('/analytics/drilldown', queryParams);
  }

  /**
   * Refreshes the dashboard data with current selected range and filters.
   */
  refreshDashboard(): void {
    this.loading.set(true);
    this.error.set(null);

    const activeRange = this.selectedRange();
    const activeFilters = this.filters();
    const from = this.customFrom();
    const to = this.customTo();

    const params: Partial<AnalyticsFilterParams> = {
      range: activeRange,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...activeFilters,
    };

    this.getDashboard(params)
      .pipe(
        tap((data) => {
          this.dashboardData.set(data);
          this.lastRefreshedAt.set(new Date());
        }),
        catchError((err: Error) => {
          this.error.set(err.message || 'Failed to fetch analytics metrics.');
          return of(null);
        }),
        finalize(() => {
          this.loading.set(false);
          // Also refresh drilldown documents
          this.refreshDrilldown();
        }),
      )
      .subscribe();
  }

  /**
   * Refreshes the drilldown documents matching the active filters.
   */
  refreshDrilldown(limit = 50, offset = 0): void {
    this.drilldownLoading.set(true);
    const activeRange = this.selectedRange();
    const activeFilters = this.filters();
    const from = this.customFrom();
    const to = this.customTo();

    const params = {
      range: activeRange,
      limit,
      offset,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...activeFilters,
    };

    this.getDrilldown(params)
      .pipe(
        tap((res) => {
          this.drilldownDocs.set(res.documents || (res as unknown as { items: AnalyticsDrilldownItem[] }).items || []);
          this.drilldownTotal.set(res.total || 0);
        }),
        catchError(() => {
          this.drilldownDocs.set([]);
          this.drilldownTotal.set(0);
          return of(null);
        }),
        finalize(() => {
          this.drilldownLoading.set(false);
        }),
      )
      .subscribe();
  }

  /**
   * Set time range and trigger refresh.
   */
  setTimeRange(range: TimeRangeKey, from?: string, to?: string): void {
    this.selectedRange.set(range);
    if (from) this.customFrom.set(from);
    if (to) this.customTo.set(to);
    this.refreshDashboard();
  }

  /**
   * Update a filter parameter and trigger refresh.
   */
  setFilter(key: keyof AnalyticsFilterParams, value?: string): void {
    const current = { ...this.filters() };
    if (!value || value === 'ALL') {
      delete current[key];
    } else {
      (current as Record<string, unknown>)[key] = value;
    }
    this.filters.set(current);
    this.refreshDashboard();
  }

  /**
   * Reset all filters to default.
   */
  clearFilters(): void {
    this.filters.set({});
    this.refreshDashboard();
  }

  /**
   * Toggle auto-refresh timer.
   */
  toggleAutoRefresh(): void {
    this.autoRefreshEnabled.update((val) => !val);
  }

  /**
   * Export summary report as JSON.
   */
  exportJsonReport(): void {
    const data = this.dashboardData();
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tradeguard-analytics-${this.selectedRange()}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Export drill-down documents as CSV.
   */
  exportDrilldownCsv(): void {
    const docs = this.drilldownDocs();
    if (!docs.length) return;

    const headers = ['Document ID', 'Filename', 'File Type', 'Uploaded At', 'Status', 'Risk Score', 'Decision', 'Origin', 'Destination', 'Processing Ms'];
    const rows = docs.map((d) => [
      `"${d.id}"`,
      `"${d.filename.replace(/"/g, '""')}"`,
      `"${d.fileType || ''}"`,
      `"${d.uploadedAt}"`,
      `"${d.status}"`,
      d.analysis?.tradeCompliance?.riskScores?.overall ?? 'N/A',
      `"${d.analysis?.tradeCompliance?.decision?.decision || 'N/A'}"`,
      `"${d.analysis?.tradeCompliance?.transaction?.originCountry || 'N/A'}"`,
      `"${d.analysis?.tradeCompliance?.transaction?.destinationCountry || 'N/A'}"`,
      d.analysis?.timing?.totalMs ?? 'N/A',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tradeguard-analytics-drilldown-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
