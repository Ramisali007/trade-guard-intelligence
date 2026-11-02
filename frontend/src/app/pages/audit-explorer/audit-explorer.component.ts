import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { isApiError } from '../../services/api.service';
import { TradeCasesService } from '../../services/trade-cases.service';
import { WorkspaceService, type ChainVerdict } from '../../services/workspace.service';
import { STATUS_LABELS, type CaseStatus, type TradeCaseAuditEvent } from '../../models/trade-case.models';

interface Row {
  caseId: string;
  status: string;
  customerRef: string;
  events: number;
  chain: ChainVerdict;
  updatedAt: string;
}

/**
 * The auditor's starting point: every case in scope with its hash-chain verdict, re-verified by the
 * server on each load against the anchor stored on the case, and the full event log of any case.
 */
@Component({
  selector: 'app-audit-explorer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, AnimatedCounter],
  template: `
    <div class="page ae-page">
      <header class="page-head">
        <div>
          <h1>Audit explorer</h1>
        </div>
        <section class="page-head-kpis" aria-label="Summary">
          <div class="kpi-tile">
            <span class="kpi-tile-label">Cases verified</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="rows().length" /></strong>
            <span class="kpi-tile-note">audit logs checked</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Chains intact</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="intact()" /></strong>
            <span class="kpi-tile-note">no alteration found</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Chains broken</span>
            <strong class="kpi-tile-value" [class.is-alert]="broken() > 0"><app-animated-counter [value]="broken()" /></strong>
            <span class="kpi-tile-note">{{ broken() > 0 ? 'needs investigation' : 'none' }}</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Events recorded</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="totalEvents()" /></strong>
            <span class="kpi-tile-note">across every log</span>
          </div>
        </section>
      </header>
      @if (error()) {
        <div class="card card-pad ae-bad" role="alert">{{ error() }}</div>
      }
      <div class="card table-wrap">
        <table class="table">
          <thead><tr><th>Case</th><th>Status</th><th>Customer</th><th class="num">Events</th><th>Chain</th><th></th></tr></thead>
          <tbody>
            @for (r of rows(); track r.caseId) {
              <tr>
                <td><a [routerLink]="['/trade-cases', r.caseId]">{{ r.caseId }}</a></td>
                <td>{{ label(r.status) }}</td>
                <td class="muted">{{ r.customerRef }}</td>
                <td class="num">{{ r.events }}</td>
                <td [class.ae-bad]="!r.chain.valid">{{ r.chain.valid ? 'Verified' : 'Broken at ' + r.chain.brokenAtSeq + ': ' + r.chain.problem }}</td>
                <td><button type="button" class="btn btn-ghost btn-sm" (click)="openLog(r.caseId)">View log</button></td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="muted">{{ loading() ? 'Verifying…' : 'No cases in scope.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (selected(); as s) {
        <section class="card table-wrap" aria-label="Audit log">
          <div class="card-head row-between">
            <strong>{{ s.caseId }} — {{ s.events.length }} events</strong>
            <span [class.ae-bad]="!s.chain.valid">{{ s.chain.valid ? 'Chain verified' : 'Chain broken' }}</span>
          </div>
          <table class="table">
            <thead><tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Status</th><th>Hash</th></tr></thead>
            <tbody>
              @for (e of s.events; track e.seq) {
                <tr>
                  <td>{{ e.seq }}</td>
                  <td>{{ e.at | date: 'medium' }}</td>
                  <td>{{ e.actor.name }}<div class="muted ae-sub">{{ e.actor.role }}</div></td>
                  <td>{{ e.action }}</td>
                  <td class="muted">{{ e.fromStatus ?? '—' }} → {{ e.toStatus ?? '—' }}</td>
                  <td><code class="ae-sub">{{ e.hash.slice(0, 12) }}…</code></td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .ae-page { display: flex; flex-direction: column; gap: 16px; }
      .ae-bad { color: var(--negative); }
      .ae-sub { font-size: 0.78rem; }
    `,
  ],
})
export class AuditExplorerComponent implements OnInit {
  private readonly workspace = inject(WorkspaceService);
  private readonly cases = inject(TradeCasesService);
  protected readonly rows = signal<Row[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly selected = signal<{ caseId: string; events: TradeCaseAuditEvent[]; chain: { valid: boolean; brokenAtSeq: number | null } } | null>(null);
  protected readonly intact = computed(() => this.rows().filter((r) => r.chain.valid).length);
  protected readonly broken = computed(() => this.rows().filter((r) => !r.chain.valid).length);
  protected readonly totalEvents = computed(() => this.rows().reduce((sum, r) => sum + r.events, 0));

  ngOnInit(): void {
    this.workspace.auditOverview().subscribe({
      next: (r) => {
        this.rows.set(r.cases);
        this.loading.set(false);
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.error.set(isApiError(e) ? e.message : 'The audit overview is unavailable.');
      },
    });
  }

  protected openLog(caseId: string): void {
    this.cases.audit(caseId).subscribe({
      next: (r) => this.selected.set({ caseId, ...r }),
      error: (e: unknown) => this.error.set(isApiError(e) ? e.message : 'The audit log is unavailable.'),
    });
  }

  protected label(status: string): string {
    return STATUS_LABELS[status as CaseStatus] ?? status;
  }
}
