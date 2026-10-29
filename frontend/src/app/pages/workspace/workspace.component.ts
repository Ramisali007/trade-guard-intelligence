import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { Icon } from '../../shared/components/icon';
import { AuthService } from '../../services/auth.service';
import { isApiError } from '../../services/api.service';
import { WorkspaceService, type Workspace } from '../../services/workspace.service';
import { STATUS_LABELS, type CaseStatus } from '../../models/trade-case.models';
import { formatRelative } from '../../shared/format';
import { queueInStage } from '../../shared/stage';

/**
 * The signed-in user's home: their role and the cases waiting on them.
 * Everything here comes from GET /api/workspace — the same permission registry the API enforces.
 */
@Component({
  selector: 'app-workspace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AnimatedCounter, Icon],
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
            <h1>{{ greeting() }}, {{ w.user.name }}</h1>
            <p class="muted">{{ w.role.displayName }} · {{ w.user.institution }}</p>
          </div>
          <section class="page-head-kpis" aria-label="Summary">
            <div class="kpi-tile">
              <span class="kpi-tile-label">Waiting on you</span>
              <strong class="kpi-tile-value"><app-animated-counter [value]="totalWaiting(w)" /></strong>
              <span class="kpi-tile-note">cases that need your action</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-tile-label">Queues</span>
              <strong class="kpi-tile-value"><app-animated-counter [value]="queues(w).length" /></strong>
              <span class="kpi-tile-note">the lists you work from</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-tile-label">Largest queue</span>
              <strong class="kpi-tile-value"><app-animated-counter [value]="largestQueue(w)?.count ?? 0" /></strong>
              <span class="kpi-tile-note">{{ largestQueue(w)?.title ?? 'none' }}</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-tile-label">Your portal</span>
              <strong class="kpi-tile-value is-text">{{ auth.stage() === 'post' ? 'Post-shipment' : 'Pre-shipment' }}</strong>
              <span class="kpi-tile-note">{{ w.role.displayName }}</span>
            </div>
          </section>
        </header>

        <section aria-labelledby="ws-queues-title">
          <h2 id="ws-queues-title" class="ws-h2">Waiting on you</h2>
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
                        <a [routerLink]="['/trade-cases', i.caseId]">{{ i.caseId }}</a>
                        <span class="muted"> · {{ statusLabel(i.status) }}{{ showCustomer(w) ? ' · ' + i.customerRef : '' }} · {{ relative(i.updatedAt) }}</span>
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

  ngOnInit(): void {
    this.load();
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


  protected queues(w: Workspace) {
    return w.queues.filter((q) => queueInStage(q.id, this.auth.stage()));
  }

  protected greeting(): string {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  }

  protected largestQueue(w: Workspace) {
    return this.queues(w).reduce<ReturnType<WorkspaceComponent['queues']>[number] | null>((best, q) => (best === null || q.count > best.count ? q : best), null);
  }

  protected totalWaiting(w: Workspace): number {
    return this.queues(w).reduce((sum, q) => sum + q.count, 0);
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
