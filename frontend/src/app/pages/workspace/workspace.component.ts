import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { Icon } from '../../shared/components/icon';
import { AuthService } from '../../services/auth.service';
import { isApiError } from '../../services/api.service';
import { WorkspaceService, type ActivityRow, type Workspace } from '../../services/workspace.service';
import { APPLICATION_STATE_LABELS } from '../../models/post-shipment.models';
import { STATUS_LABELS, type CaseStatus } from '../../models/trade-case.models';
import { companyName, formatRelative } from '../../shared/format';
import { queueInStage } from '../../shared/stage';
import { scrollToSection } from '../../shared/scroll';

/**
 * The signed-in user's home: their role and the cases waiting on them.
 * Everything here comes from GET /api/workspace — the same permission registry the API enforces.
 */
@Component({
  selector: 'app-workspace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AnimatedCounter, Icon, DecimalPipe],
  template: `
    <div class="page ws-page">
      @if (error()) {
        <div class="card card-pad ws-error" role="alert">
          <strong>Could not load your workspace.</strong> {{ error() }}
          <button type="button" class="btn btn-ghost btn-sm" (click)="load()">Retry</button>
        </div>
      }
      @if (ws(); as w) {
        <header class="page-head">
          <div>
            <h1>Welcome, {{ w.user.name }}</h1>
            <p class="muted">{{ companyName(w.user.institution) }}</p>
          </div>
          <section class="page-head-kpis" aria-label="Summary">
            <button type="button" class="kpi-tile" (click)="go('ws-pending')" title="Show the cases that need your action">
              <span class="kpi-tile-label">Pending work</span>
              <strong class="kpi-tile-value"><app-animated-counter [value]="totalWaiting(w)" /></strong>
              <span class="kpi-tile-note">cases that need your action</span>
            </button>
            <button type="button" class="kpi-tile" (click)="go('ws-pending')" title="Show your queues">
              <span class="kpi-tile-label">Queues</span>
              <strong class="kpi-tile-value"><app-animated-counter [value]="queues(w).length" /></strong>
            </button>
            @if (hasCases(w)) {
              <button type="button" class="kpi-tile" [class.kpi-tile-on]="stageFilter() === 'PRE'" [attr.aria-pressed]="stageFilter() === 'PRE'" (click)="showStage('PRE')" title="Show the pre-shipment cases you worked on">
                <span class="kpi-tile-label">Pre-shipment</span>
                <strong class="kpi-tile-value"><app-animated-counter [value]="stageCount('PRE')" /></strong>
                <span class="kpi-tile-note">cases · show</span>
              </button>
              <button type="button" class="kpi-tile" [class.kpi-tile-on]="stageFilter() === 'POST'" [attr.aria-pressed]="stageFilter() === 'POST'" (click)="showStage('POST')" title="Show the post-shipment cases you worked on">
                <span class="kpi-tile-label">Post-shipment</span>
                <strong class="kpi-tile-value"><app-animated-counter [value]="stageCount('POST')" /></strong>
                <span class="kpi-tile-note">cases · show</span>
              </button>
            }
          </section>
        </header>

        <section id="ws-pending" aria-labelledby="ws-queues-title">
          <h2 id="ws-queues-title" class="ws-h2">Pending work</h2>
          @if (queues(w).length === 0) {
            <div class="card calm-state">
              <span class="calm-state-mark"><app-icon name="check" [size]="30" /></span>
              <strong>{{ hasCases(w) ? 'You are all caught up' : 'No queues for your role' }}</strong>
              <span>{{ hasCases(w) ? 'Nothing needs your action right now. New work appears here as soon as it arrives.' : 'Your role has no trade-case queues.' }}</span>
            </div>
          } @else {
            <div class="grid grid-3">
              @for (q of queues(w); track q.id) {
                <article class="card card-pad ws-queue">
                  <div class="row-between ws-q-head">
                    <h3>{{ q.title }}</h3>
                    <span class="ws-q-count"><app-animated-counter [value]="q.count" [duration]="800" /></span>
                  </div>
                  <p class="muted ws-q-desc">{{ q.description }}</p>
                  <ul class="ws-items">
                    @for (i of q.items; track i.caseId) {
                      <li>
                        @if (i.status === 'DRAFT') {
                          <a [routerLink]="['/trade-cases', i.caseId]">Draft, not sent to the bank</a>
                          <span class="muted"> · {{ i.documents }} document{{ i.documents === 1 ? '' : 's' }}{{ showCustomer(w) ? ' · ' + i.customerRef : '' }} · {{ relative(i.updatedAt) }}</span>
                        } @else {
                          <a [routerLink]="['/trade-cases', i.caseId]">{{ i.caseId }}</a>
                          <span class="muted"> · {{ statusLabel(i.status) }}{{ showCustomer(w) ? ' · ' + i.customerRef : '' }} · {{ relative(i.updatedAt) }}</span>
                        }
                      </li>
                    }
                  </ul>
                  @if (q.count > q.items.length) {
                    <a routerLink="/trade-cases" class="muted ws-more">and {{ q.count - q.items.length }} more</a>
                  }
                </article>
              }
            </div>
          }
        </section>

        @if (hasCases(w)) {
          <section id="ws-mine" aria-labelledby="ws-history-title">
            <div class="row-between ws-hist-head">
              <h2 id="ws-history-title" class="ws-h2">My cases <span class="tab-badge">{{ history().length }}</span></h2>
              <div class="ws-hist-tools">
                <input class="input ws-hist-search" type="search" placeholder="Search case, applicant, beneficiary…" aria-label="Search my cases" (input)="onSearch($event)" />
              </div>
            </div>
            @if (stageFilter() !== 'ALL') {
              <div class="ws-showing" role="status">
                <span>Showing <strong>{{ rows().length }}</strong> {{ stageFilter() === 'PRE' ? 'pre-shipment' : 'post-shipment' }} case{{ rows().length === 1 ? '' : 's' }}.</span>
                <button type="button" class="btn btn-ghost btn-sm" (click)="stageFilter.set('ALL')">Show all cases</button>
              </div>
            }
            @if (historyLoading()) {
              <div class="card card-pad muted">Loading your cases…</div>
            } @else if (rows().length === 0) {
              <div class="card calm-state">
                <span class="calm-state-mark"><app-icon name="document" [size]="28" /></span>
                <strong>{{ history().length === 0 ? 'No cases yet' : 'No case matches' }}</strong>
                <span>{{ history().length === 0 ? 'The cases you work on, before and after shipment, are listed here with what you did on each.' : 'Try another stage or clear the search.' }}</span>
              </div>
            } @else {
              <section class="card">
                <div class="table-wrap">
                  <table class="table ws-table">
                    <thead>
                      <tr>
                        <th>Case</th>
                        <th>Applicant → Beneficiary</th>
                        <th class="num">Amount</th>
                        <th>Stage</th>
                        <th>Status</th>
                        <th>What I did</th>
                        <th>Last activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (r of rows(); track r.caseId) {
                        <tr>
                          <td>
                            <a [routerLink]="link(r)" class="ws-case">{{ r.draft ? 'Draft, not sent to the bank' : r.reference }}</a>
                            @if (r.postShipment) { <div class="muted ws-sub">{{ r.postShipment.reference }}</div> }
                          </td>
                          <td>
                            <div>{{ r.applicant || '—' }}</div>
                            <div class="muted ws-sub">→ {{ r.beneficiary || '—' }}</div>
                          </td>
                          <td class="num">{{ r.amount === null ? '—' : r.currency + ' ' + (r.amount | number: '1.2-2') }}</td>
                          <td><span class="chip" [class.chip-info]="r.stage === 'POST'">{{ r.stage === 'POST' ? 'Post-shipment' : 'Pre-shipment' }}</span></td>
                          <td>{{ r.stage === 'POST' && r.postShipment ? applicationLabel(r.postShipment.state) : statusLabel(r.status) }}</td>
                          <td>{{ r.parts.slice(0, 3).join(', ') }}@if (r.parts.length > 3) { <span class="muted"> +{{ r.parts.length - 3 }} more</span> }</td>
                          <td class="muted">{{ relative(r.lastActionAt) }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }
          </section>
        }
      } @else if (!error()) {
        <div class="ws-skeleton" aria-busy="true" aria-label="Loading your workspace">
          <div class="ws-sk ws-sk-hero"></div>
          <div class="ws-sk-row"><div class="ws-sk ws-sk-card"></div><div class="ws-sk ws-sk-card"></div><div class="ws-sk ws-sk-card"></div></div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .ws-page { display: flex; flex-direction: column; gap: 20px; }
      .ws-error { border-color: var(--negative); color: var(--negative); display: flex; gap: 12px; align-items: center; }
      .ws-h2 { font-size: 1.05rem; margin: 4px 0 12px; font-weight: 750; letter-spacing: -0.01em; }
      .ws-queue { position: relative; overflow: hidden; display: flex; flex-direction: column; }
      .ws-queue::before { content: ''; position: absolute; left: 0; top: 16px; bottom: 16px; width: 4px; border-radius: 0 4px 4px 0; background: linear-gradient(180deg, #00d4d4, #008080); }
      .ws-queue h3 { font-size: 0.98rem; margin: 0; font-weight: 750; }
      .ws-q-head { align-items: flex-start; gap: 12px; }
      .ws-q-count { flex: none; display: grid; place-items: center; min-width: 38px; height: 38px; padding: 0 10px; border-radius: 12px; font-weight: 800; font-size: 1.05rem; color: #ffffff; background: linear-gradient(135deg, #008080 0%, #006b6b 100%); box-shadow: 0 8px 18px -8px rgb(0 128 128 / 70%); }
      .ws-q-desc { font-size: 0.85rem; margin: 6px 0 10px; }
      .ws-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 0.88rem; }
      .ws-items li { padding: 8px 10px; border-radius: 10px; background: var(--sunken); transition: background var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease); }
      .ws-items li:hover { background: var(--accent-soft); transform: translateX(3px); }
      .ws-items a { font-weight: 700; }
      .ws-more { font-size: 0.82rem; display: inline-block; margin-top: 10px; font-weight: 650; }
      .ws-hist-head { gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
      .ws-hist-head .ws-h2 { margin: 0; }
      .ws-hist-tools { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
      .ws-showing { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 10px; font-size: 0.9rem; }
      .ws-hist-search { max-width: 300px; width: 100%; }
      .ws-table .num { text-align: right; white-space: nowrap; }
      .ws-case { font-weight: 700; font-family: var(--font-mono, monospace); }
      .ws-sub { font-size: 0.8rem; }
      .ws-skeleton { display: flex; flex-direction: column; gap: 18px; }
      .ws-sk { border-radius: var(--radius-2xl); background: linear-gradient(100deg, var(--sunken) 30%, color-mix(in srgb, var(--accent-soft) 80%, var(--sunken)) 50%, var(--sunken) 70%); background-size: 220% 100%; animation: shimmer 1.4s ease-in-out infinite; }
      .ws-sk-hero { height: 300px; }
      .ws-sk-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
      .ws-sk-card { height: 132px; border-radius: var(--radius-xl); }
    `,
  ],
})
export class WorkspaceComponent implements OnInit {
  private readonly service = inject(WorkspaceService);
  protected readonly auth = inject(AuthService);
  protected readonly ws = signal<Workspace | null>(null);
  protected readonly error = signal<string | null>(null);

  /** The cases this user worked on, with what they did (the server reads it from the audit trail). */
  protected readonly history = signal<ActivityRow[]>([]);
  protected readonly historyLoading = signal(true);
  protected readonly stageFilter = signal<'ALL' | 'PRE' | 'POST'>('ALL');
  private readonly term = signal('');
  protected readonly rows = computed(() => {
    const stage = this.stageFilter();
    const term = this.term().trim().toLowerCase();
    return this.history().filter(
      (r) => (stage === 'ALL' || r.stage === stage) && (!term || [r.reference, r.applicant, r.beneficiary, r.customerRef, r.parts.join(' ')].some((v) => v.toLowerCase().includes(term))),
    );
  });

  ngOnInit(): void {
    this.load();
    this.service.history().subscribe({
      next: (r) => {
        this.history.set(r.items);
        this.historyLoading.set(false);
      },
      error: () => this.historyLoading.set(false),
    });
    // Keep the cached permission list in step with the server (a role may have changed).
    void this.auth.refreshProfile();
  }

  load(): void {
    this.error.set(null);
    this.service.workspace(this.auth.stage()).subscribe({
      next: (w) => this.ws.set(w),
      error: (e: unknown) => this.error.set(isApiError(e) ? e.message : 'The workspace is unavailable.'),
    });
  }

  /** A headline tile leads to what it counts. */
  protected go(...ids: string[]): void {
    scrollToSection(...ids);
  }

  /** The pre- or post-shipment tile: list that stage's cases below (the same tile again shows them all). */
  protected showStage(stage: 'PRE' | 'POST'): void {
    this.stageFilter.set(this.stageFilter() === stage ? 'ALL' : stage);
    scrollToSection('ws-mine');
  }

  protected stageCount(id: 'ALL' | 'PRE' | 'POST'): number {
    return id === 'ALL' ? this.history().length : this.history().filter((r) => r.stage === id).length;
  }

  protected onSearch(event: Event): void {
    this.term.set((event.target as HTMLInputElement).value);
  }

  /** Where a case opens: the client's post-shipment application, the officer's post-shipment examination, or the case page. */
  protected link(r: ActivityRow): string[] {
    if (r.stage === 'POST') {
      if (this.auth.can('tradecase.postshipment.apply')) return ['/post-shipment', r.caseId];
      if (this.auth.can('tradecase.findings.internal.view')) return ['/trade-cases', r.caseId, 'post-shipment'];
    }
    return ['/trade-cases', r.caseId];
  }

  protected applicationLabel(state: string): string {
    return (APPLICATION_STATE_LABELS as Record<string, string>)[state] ?? state;
  }

  /** Only the company is shown, never the role or desk after the "·". */
  protected companyName(institution: string): string {
    return companyName(institution) || institution;
  }

  protected queues(w: Workspace) {
    return w.queues.filter((q) => queueInStage(q.id, this.auth.stage()));
  }

  protected totalWaiting(w: Workspace): number {
    // Each case once, even when it waits in more than one queue.
    return new Set(this.queues(w).flatMap((q) => q.caseIds)).size;
  }

  protected hasCases(w: Workspace): boolean {
    return w.permissions.some((p) => p.startsWith('tradecase.view.'));
  }

  protected showCustomer(w: Workspace): boolean {
    return w.role.dataScope !== 'OWN_CUSTOMER';
  }

  protected statusLabel(status: string): string {
    return STATUS_LABELS[status as CaseStatus] ?? status;
  }

  protected relative(at: string): string {
    return formatRelative(at);
  }
}
