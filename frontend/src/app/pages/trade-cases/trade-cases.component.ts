import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { TradeCasesService } from '../../services/trade-cases.service';
import { AuthService } from '../../services/auth.service';
import { isApiError } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { formatRelative } from '../../shared/format';
import { Icon } from '../../shared/components/icon';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import {
  DEPARTMENTS,
  DEPARTMENT_LABELS,
  STATUS_LABELS,
  type CaseStatus,
  type TradeCaseDashboard,
  type TradeCaseListItem,
} from '../../models/trade-case.models';

/** A headline box that was clicked: the list then shows the cases that box counts. */
type Kpi = 'CASES' | 'CUSTOMER' | 'BLOCKED' | 'ALERTS';

type Filter = 'ALL' | 'MINE' | 'REVIEW' | 'CUSTOMER' | 'APPROVAL' | 'POST' | 'DONE' | 'CLEARED';

const FILTER_STATUSES: Record<Exclude<Filter, 'ALL' | 'MINE' | 'CLEARED'>, CaseStatus[]> = {
  REVIEW: ['DRAFT', 'UNDER_REVIEW'],
  CUSTOMER: ['PENDING_CUSTOMER_CLARIFICATION'],
  APPROVAL: ['APPROVAL_PENDING', 'AUTHORIZED_FOR_ISSUANCE'],
  POST: ['LC_ISSUED', 'DOCUMENT_EXAMINATION', 'DISCREPANCY_RESOLUTION', 'AWAITING_SETTLEMENT', 'SETTLED_MONITORING', 'UNDER_INVESTIGATION'],
  DONE: ['CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'],
};

/** The queue of import LC cases, with the counts that tell a desk where work is waiting. */
@Component({
  selector: 'app-trade-cases',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, DecimalPipe, Icon, AnimatedCounter],
  template: `
    <div class="page tc-page">
      <header class="page-head row-between">
        <div>
          <h1>Trade Cases</h1>
          <p class="muted">
            Import letters of credit from request to closure — {{ auth.isCustomer() ? 'your requests and their status' : 'every desk\\'s queue in one place' }}.
          </p>
        </div>
        @if (canCreate()) {
          <a routerLink="/trade-cases/new" class="btn btn-primary"><app-icon name="plus" [size]="15" /> New import request</a>
        }
        @if (dashboard(); as d) {
            <section class="page-head-kpis" aria-label="Queue summary">
              <button type="button" class="kpi-tile" [class.kpi-tile-on]="kpi() === 'CASES'" [attr.aria-pressed]="kpi() === 'CASES'" (click)="pickKpi('CASES')" title="Show every case">
                <span class="kpi-tile-label">Cases</span>
                <strong class="kpi-tile-value"><app-animated-counter [value]="d.totalCases" /></strong>
                <span class="kpi-tile-note">show all</span>
              </button>
              <button type="button" class="kpi-tile" [class.kpi-tile-on]="kpi() === 'CUSTOMER'" [attr.aria-pressed]="kpi() === 'CUSTOMER'" (click)="pickKpi('CUSTOMER')" title="Show the cases with a question waiting for the customer">
                <span class="kpi-tile-label">Waiting on the customer</span>
                <strong class="kpi-tile-value"><app-animated-counter [value]="d.openCustomerQueries" /></strong>
                <span class="kpi-tile-note">open queries · show cases</span>
              </button>
              <button type="button" class="kpi-tile" [class.kpi-tile-on]="kpi() === 'BLOCKED'" [attr.aria-pressed]="kpi() === 'BLOCKED'" (click)="pickKpi('BLOCKED')" title="Show the cases held by a blocking finding">
                <span class="kpi-tile-label">Blocked by findings</span>
                <strong class="kpi-tile-value" [class.is-warn]="d.casesBlockedByFindings > 0"><app-animated-counter [value]="d.casesBlockedByFindings" /></strong>
                <span class="kpi-tile-note">show cases</span>
              </button>
              @if (d.openComplianceAlerts !== undefined) {
                <button type="button" class="kpi-tile" [class.kpi-tile-on]="kpi() === 'ALERTS'" [attr.aria-pressed]="kpi() === 'ALERTS'" (click)="pickKpi('ALERTS')" title="Show the cases with an open compliance or TBML alert">
                  <span class="kpi-tile-label">Open compliance / TBML alerts</span>
                  <strong class="kpi-tile-value" [class.is-alert]="d.openComplianceAlerts > 0"><app-animated-counter [value]="d.openComplianceAlerts" /></strong>
                  <span class="kpi-tile-note">show cases</span>
                </button>
              } @else {
                <div class="kpi-tile">
                  <span class="kpi-tile-label">Median submission → authorisation</span>
                  <strong class="kpi-tile-value">
                    @if (d.medianHoursSubmissionToAuthorisation === null) { — } @else { <app-animated-counter [value]="d.medianHoursSubmissionToAuthorisation" [decimals]="1" suffix=" h" /> }
                  </strong>
                </div>
              }
            </section>
        }
      </header>

      @if (error()) {
        <div class="card card-pad tc-error" role="alert">
          <strong>Could not load trade cases.</strong> {{ error() }}
          <button type="button" class="btn btn-ghost btn-sm" (click)="load()">Retry</button>
        </div>
      }

      @if (dashboard(); as d) {
        <!-- There are no separate desks in either demo portal (one trade desk before issuance, one all-desks officer after), so the per-department review counts are only for an institutional sign-in. -->
        @if (!auth.stage() && d.pendingReviewsByDepartment; as pending) {
          <section class="card card-pad tc-desks" aria-label="Pending reviews by department">
            <span class="kpi-tile-label">Reviews outstanding</span>
            <div class="tc-desk-row">
              @for (dept of departments; track dept) {
                <span class="chip" [class.chip-warning]="pending[dept] > 0">{{ departmentLabels[dept] }} · {{ pending[dept] }}</span>
              }
              <span class="kpi-tile-note">
                Median submission → authorisation:
                {{ d.medianHoursSubmissionToAuthorisation === null ? 'no authorised cases yet' : (d.medianHoursSubmissionToAuthorisation | number: '1.0-1') + ' h' }}
              </span>
            </div>
          </section>
        }
      }

      <section class="card tc-table-card" id="tc-list">
        @if (kpi() !== 'CASES') {
          <div class="tc-showing" role="status">
            <span>Showing <strong>{{ visible().length }}</strong> {{ kpiLabel(visible().length) }}.</span>
            <button type="button" class="btn btn-ghost btn-sm" (click)="pickKpi('CASES')">Show all cases</button>
          </div>
        }
        <div class="card-head tc-toolbar">
          <div class="tc-filters" role="tablist" aria-label="Filter cases">
            @for (f of filters; track f.id) {
              @if (tabShown(f.id)) {
                <button type="button" class="tab-btn" role="tab" [attr.aria-selected]="filter() === f.id" [class.active]="filter() === f.id" (click)="pickTab(f.id)">
                  {{ f.label }} <span class="tab-badge">{{ count(f.id) }}</span>
                </button>
              }
            }
          </div>
          @if (canClear()) {
            <div class="tc-clear">
              @if (confirmingClear()) {
                <span class="tc-clear-note">Hide {{ clearable() }} approved case{{ clearable() === 1 ? '' : 's' }} from your list? They stay stored, with their documents and audit trail, under “Cleared history”.</span>
                <button type="button" class="btn btn-primary btn-sm" [disabled]="clearing()" (click)="clearHistory()">{{ clearing() ? 'Clearing…' : 'Yes, clear' }}</button>
                <button type="button" class="btn btn-ghost btn-sm" [disabled]="clearing()" (click)="confirmingClear.set(false)">Cancel</button>
              } @else {
                <button type="button" class="btn btn-ghost btn-sm" [disabled]="clearable() === 0" (click)="confirmingClear.set(true)" title="Hides the approved cases from your list. Nothing is deleted.">Clear history ({{ clearable() }})</button>
              }
            </div>
          }
          <input class="input tc-search" type="search" placeholder="Search case, applicant, beneficiary, LC…" [ngModel]="search()" (ngModelChange)="search.set($event)" aria-label="Search cases" />
        </div>

        @if (loading()) {
          <div class="card-body muted">Loading cases…</div>
        } @else if (visible().length === 0) {
          <div class="calm-state">
            <span class="calm-state-mark"><app-icon name="document" [size]="28" /></span>
            <strong>{{ items().length === 0 ? 'No trade cases yet' : 'No case matches this filter' }}</strong>
            <span>{{ items().length === 0 ? (canCreate() ? 'Start with a new import request and it will appear here.' : 'Cases appear here as soon as they exist.') : 'Try another tab or clear the search.' }}</span>
          </div>
        } @else {
          <div class="table-wrap">
            <table class="table tc-table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Applicant → Beneficiary</th>
                  <th class="num">Amount</th>
                  <th>Status</th>
                  <th class="num">Blocking</th>
                  <th class="num">Queries</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                @for (c of visible(); track c.caseId) {
                  <tr>
                    <td>
                      <a [routerLink]="['/trade-cases', c.caseId]" class="tc-case-link">{{ c.caseId }}</a>
                      @if (c.availableActions.length > 0) { <span class="chip chip-info tc-mine">your action</span> }
                      @if (c.lcNumber) { <div class="muted tc-sub">{{ c.lcNumber }}</div> }
                    </td>
                    <td>
                      <div>{{ c.applicant || '—' }}</div>
                      <div class="muted tc-sub">→ {{ c.beneficiary || '—' }}</div>
                    </td>
                    <td class="num">{{ c.amount === null ? '—' : c.currency + ' ' + (c.amount | number: '1.2-2') }}</td>
                    <td><span class="chip" [class]="'chip ' + statusClass(c.status)">{{ statusLabels[c.status] }}</span></td>
                    <td class="num" [class.tc-warn]="c.blockingFindings > 0">{{ c.blockingFindings }}</td>
                    <td class="num">{{ c.openQueries }}</td>
                    <td class="muted">{{ relative(c.updatedAt) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>
  `,
  styles: [
    `
      .tc-error { border-color: var(--negative); color: var(--negative); display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
      .tc-kpis { margin-bottom: 16px; }
      #tc-list { scroll-margin-top: 90px; }
      .tc-showing { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 16px; font-size: 0.88rem; }
      .tc-desks { margin-bottom: 16px; }
      .tc-desk-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
      .tc-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
      .tc-filters { display: flex; flex-wrap: wrap; gap: 4px; }
      .tc-clear { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .tc-clear-note { font-size: 0.85rem; max-width: 46ch; }
      .tc-search { max-width: 320px; width: 100%; }
      .tc-table .num { text-align: right; white-space: nowrap; }
      .tc-case-link { font-weight: 600; font-family: var(--font-mono, monospace); }
      .tc-sub { font-size: 0.8rem; }
      .tc-mine { margin-left: 6px; font-size: 0.7rem; }
      .tc-warn { color: var(--warning); font-weight: 600; }
      .tc-empty { text-align: center; padding: 40px 16px; color: var(--ink-muted); }
      @media (max-width: 640px) {
        
        .tc-search { max-width: none; }
      }
    `,
  ],
})
export class TradeCasesComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly service = inject(TradeCasesService);
  private readonly toast = inject(ToastService);

  protected readonly statusLabels = STATUS_LABELS;
  protected readonly departments = DEPARTMENTS;
  protected readonly departmentLabels = DEPARTMENT_LABELS;
  protected readonly filters: Array<{ id: Filter; label: string }> = [
    { id: 'MINE', label: 'Needs my action' },
    { id: 'ALL', label: 'All' },
    { id: 'REVIEW', label: 'Draft & review' },
    { id: 'CUSTOMER', label: 'Awaiting customer' },
    { id: 'APPROVAL', label: 'Approval' },
    { id: 'POST', label: 'Post-trade' },
    { id: 'DONE', label: 'Finished' },
    { id: 'CLEARED', label: 'Cleared history' },
  ];

  readonly items = signal<TradeCaseListItem[]>([]);
  readonly dashboard = signal<TradeCaseDashboard | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filter = signal<Filter>('MINE');
  readonly search = signal('');
  protected readonly kpi = signal<Kpi>('CASES');
  protected readonly confirmingClear = signal(false);
  protected readonly clearing = signal(false);

  /** Whoever holds the create permission (the customer and the relationship manager); the trade desk only scrutinises. */
  readonly canCreate = computed(() => this.auth.can('tradecase.create'));

  readonly visible = computed(() => {
    const term = this.search().trim().toLowerCase();
    return this.items().filter((c) => this.matches(c, this.filter()) && this.matchesKpi(c) && (!term || [c.caseId, c.applicant, c.beneficiary, c.lcNumber ?? '', c.goodsDescription].some((v) => v.toLowerCase().includes(term))));
  });

  /** Whoever may clear their own history (the trade maker). */
  protected readonly canClear = computed(() => this.auth.can('tradecase.history.clear') && this.auth.stage() !== 'post');
  /** Approved cases still in the list: what "Clear history" would hide. */
  protected readonly clearable = computed(() => this.items().filter((c) => c.status === 'AUTHORIZED_FOR_ISSUANCE' && !c.cleared).length);

  ngOnInit(): void {
    this.load();
  }

  /** A headline box: show the cases it counts, across every tab. */
  protected pickKpi(kpi: Kpi): void {
    this.kpi.set(kpi);
    this.filter.set('ALL');
    this.search.set('');
    this.error.set(null);
    // Bring the list into view: the numbers are at the top, the cases below them.
    setTimeout(() => document.getElementById('tc-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  protected pickTab(filter: Filter): void {
    this.kpi.set('CASES');
    this.filter.set(filter);
  }

  protected kpiLabel(n: number): string {
    const cases = n === 1 ? 'case' : 'cases';
    return { CASES: 'every case', CUSTOMER: `${cases} waiting on the customer`, BLOCKED: `${cases} blocked by findings`, ALERTS: `${cases} with open compliance / TBML alerts` }[this.kpi()];
  }

  private matchesKpi(c: TradeCaseListItem): boolean {
    switch (this.kpi()) {
      case 'CUSTOMER': return c.openCustomerQueries > 0;
      case 'BLOCKED': return c.blocked;
      case 'ALERTS': return c.complianceAlerts > 0;
      default: return true;
    }
  }

  protected clearHistory(): void {
    this.clearing.set(true);
    this.service.clearHistory().subscribe({
      next: (r) => {
        this.clearing.set(false);
        this.confirmingClear.set(false);
        this.toast.success('History cleared', `${r.cleared.length} approved case${r.cleared.length === 1 ? '' : 's'} hidden from your list. They are still stored; see “Cleared history”.`);
        this.load();
      },
      error: (err: unknown) => {
        this.clearing.set(false);
        this.toast.error('History could not be cleared', isApiError(err) ? err.message : 'Please try again.');
      },
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    forkJoin({ list: this.service.list(undefined, this.auth.stage()), dashboard: this.service.dashboard(this.auth.stage()) }).subscribe({
      next: ({ list, dashboard }) => {
        this.items.set(list.items);
        this.dashboard.set(dashboard);
        // Nothing waiting on this user: show everything rather than an empty first view.
        if (this.filter() === 'MINE' && !list.items.some((c) => c.availableActions.length > 0)) this.filter.set('ALL');
        if (this.filter() === 'CLEARED' && !list.items.some((c) => c.cleared)) this.filter.set('ALL');
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(isApiError(err) ? err.message : 'The trade case service did not respond.');
        this.loading.set(false);
      },
    });
  }

  /** The tabs that mean something here: the cleared tab only once something is cleared, and no review or customer tabs after approval, and no post-trade or finished tabs before it. */
  protected tabShown(id: Filter): boolean {
    if (id === 'CLEARED') return this.auth.stage() !== 'post' && this.count('CLEARED') > 0;
    if (this.auth.stage() === 'post') return id !== 'REVIEW' && id !== 'CUSTOMER';
    // Pre-shipment ends at approval: nothing there is "post-trade" or "finished".
    if (this.auth.stage() === 'pre') return id !== 'POST' && id !== 'DONE';
    return true;
  }

  count(filter: Filter): number {
    return this.items().filter((c) => this.matches(c, filter)).length;
  }

  private matches(c: TradeCaseListItem, filter: Filter): boolean {
    if (filter === 'CLEARED') return c.cleared;
    // Everywhere else, what this user cleared stays out of the list and the counts.
    if (c.cleared) return false;
    if (filter === 'ALL') return true;
    if (filter === 'MINE') return c.availableActions.length > 0;
    return FILTER_STATUSES[filter].includes(c.status);
  }

  statusClass(status: CaseStatus): string {
    if (['REJECTED', 'CANCELLED', 'UNDER_INVESTIGATION'].includes(status)) return 'chip-negative';
    if (['PENDING_CUSTOMER_CLARIFICATION', 'DISCREPANCY_RESOLUTION', 'APPROVAL_PENDING'].includes(status)) return 'chip-warning';
    if (['CLOSED', 'SETTLED_MONITORING', 'AUTHORIZED_FOR_ISSUANCE', 'LC_ISSUED'].includes(status)) return 'chip-positive';
    return 'chip-info';
  }

  relative(iso: string): string {
    return formatRelative(iso);
  }
}
