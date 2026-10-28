import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { isApiError } from '../../services/api.service';
import { WorkspaceService, type Workspace } from '../../services/workspace.service';
import { STATUS_LABELS, type CaseStatus } from '../../models/trade-case.models';
import { formatRelative } from '../../shared/format';
import { queueInStage, screenInStage } from '../../shared/stage';

/**
 * The signed-in user's home: their role, the screens it opens and the cases waiting on them.
 * Everything here comes from GET /api/workspace — the same permission registry the API enforces.
 */
@Component({
  selector: 'app-workspace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
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
            <h1>{{ w.user.name }}</h1>
            <p class="muted">{{ w.role.displayName }} · {{ w.user.institution }}</p>
            <p class="ws-role-desc">{{ w.role.description }}</p>
          </div>
        </header>

        <section aria-labelledby="ws-queues-title">
          <h2 id="ws-queues-title" class="ws-h2">Waiting on you</h2>
          @if (queues(w).length === 0) {
            <div class="card card-pad muted">
              {{ hasCases(w) ? 'Nothing needs your action right now.' : 'Your role has no trade-case queues.' }}
            </div>
          } @else {
            <div class="grid grid-3">
              @for (q of queues(w); track q.id) {
                <article class="card card-pad ws-queue">
                  <div class="row-between">
                    <h3>{{ q.title }}</h3>
                    <span class="chip chip-info">{{ q.count }}</span>
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

        <section aria-labelledby="ws-sections-title">
          <h2 id="ws-sections-title" class="ws-h2">Your screens</h2>
          <div class="grid grid-4">
            @for (s of screens(w); track s.id) {
              <a class="card card-pad card-hover ws-section" [routerLink]="s.route">
                <strong>{{ s.title }}</strong>
                <span class="muted">{{ s.description }}</span>
              </a>
            }
          </div>
        </section>
      } @else if (!error()) {
        <div class="card card-pad muted">Loading your workspace…</div>
      }
    </div>
  `,
  styles: [
    `
      .ws-page { padding-top: 96px; display: flex; flex-direction: column; gap: 20px; }
      .ws-error { border-color: var(--negative); color: var(--negative); display: flex; gap: 12px; align-items: center; }
      .ws-role-desc { max-width: 70ch; margin-top: 6px; }
      .ws-h2 { font-size: 1.05rem; margin: 0 0 10px; }
      .ws-queue h3 { font-size: 0.98rem; margin: 0; }
      .ws-q-desc { font-size: 0.85rem; margin: 4px 0 8px; }
      .ws-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 0.88rem; }
      .ws-more { font-size: 0.82rem; display: inline-block; margin-top: 6px; }
      .ws-section { display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: inherit; }
      .ws-section span { font-size: 0.85rem; }
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

  protected screens(w: Workspace) {
    return w.sections.filter((s) => s.id !== 'workspace' && screenInStage(s.id, this.auth.stage()));
  }

  protected queues(w: Workspace) {
    return w.queues.filter((q) => queueInStage(q.id, this.auth.stage()));
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
