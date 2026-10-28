import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
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
  imports: [RouterLink, DatePipe],
  template: `
    <div class="page ae-page">
      <header class="page-head">
        <div>
          <h1>Audit explorer</h1>
          <p class="muted">Each case's audit log is hash-chained and anchored on the case record; alteration, deletion, reordering and truncation are reported here.</p>
        </div>
      </header>
      @if (error()) {
        <div class="card card-pad ae-bad" role="alert">{{ error() }}</div>
      }
      <section class="grid grid-3">
        <div class="card card-pad"><span class="muted">Cases verified</span><strong class="ae-kpi">{{ rows().length }}</strong></div>
        <div class="card card-pad"><span class="muted">Chains intact</span><strong class="ae-kpi">{{ intact() }}</strong></div>
        <div class="card card-pad"><span class="muted">Chains broken</span><strong class="ae-kpi" [class.ae-bad]="broken() > 0">{{ broken() }}</strong></div>
      </section>
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
      .ae-page { padding-top: 96px; display: flex; flex-direction: column; gap: 16px; }
      .ae-kpi { display: block; font-size: 1.6rem; margin-top: 4px; }
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
