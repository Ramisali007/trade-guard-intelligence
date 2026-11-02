import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Icon } from '../../shared/components/icon';
import { PostShipmentService } from '../../services/post-shipment.service';
import { isApiError } from '../../services/api.service';
import { scrollToSection } from '../../shared/scroll';
import { ToastService } from '../../services/toast.service';
import { APPLICATION_STATE_CHIP, APPLICATION_STATE_LABELS, type PostShipmentLc } from '../../models/post-shipment.models';

/**
 * The client's Post-Shipment screen: every request the bank has approved, with its reference number. Choosing one opens
 * the post-shipment application for that request, where the shipping documents are uploaded and submitted.
 */
@Component({
  selector: 'app-post-shipment-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, DecimalPipe, Icon, AnimatedCounter],
  template: `
    <div class="page psl-page">
      <header class="page-head">
        <div>
          <h1>Post-Shipment</h1>
        </div>
        <section class="page-head-kpis" aria-label="Summary">
          <button type="button" class="kpi-tile" [class.kpi-tile-on]="kpi() === 'ALL'" [attr.aria-pressed]="kpi() === 'ALL'" (click)="pickKpi('ALL')" title="Show every approved request">
            <span class="kpi-tile-label">Approved requests</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="items().length" /></strong>
            <span class="kpi-tile-note">the bank said yes</span>
          </button>
          <button type="button" class="kpi-tile" [class.kpi-tile-on]="kpi() === 'READY'" [attr.aria-pressed]="kpi() === 'READY'" (click)="pickKpi('READY')" title="Show the requests with no application yet">
            <span class="kpi-tile-label">Ready to start</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="readyCount()" /></strong>
            <span class="kpi-tile-note">no application yet</span>
          </button>
          <button type="button" class="kpi-tile" [class.kpi-tile-on]="kpi() === 'BANK'" [attr.aria-pressed]="kpi() === 'BANK'" (click)="pickKpi('BANK')" title="Show the requests with an application in progress">
            <span class="kpi-tile-label">With the bank</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="inProgressCount()" /></strong>
            <span class="kpi-tile-note">drafts and examinations</span>
          </button>
          <button type="button" class="kpi-tile" [class.kpi-tile-on]="kpi() === 'ACCEPTED'" [attr.aria-pressed]="kpi() === 'ACCEPTED'" (click)="pickKpi('ACCEPTED')" title="Show the requests whose documents were accepted">
            <span class="kpi-tile-label">Documents accepted</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="acceptedCount()" /></strong>
            <span class="kpi-tile-note">examination complete</span>
          </button>
        </section>
      </header>

      @if (error()) {
        <div class="card card-pad psl-error" role="alert">
          <strong>Could not load your approved requests.</strong> {{ error() }}
          <button type="button" class="btn btn-ghost btn-sm" (click)="load()">Retry</button>
        </div>
      }

      @if (loading()) {
        <div class="card card-pad muted">Loading your approved requests…</div>
      } @else if (items().length === 0 && !error()) {
        <div class="card calm-state">
          <span class="calm-state-mark"><app-icon name="document" [size]="28" /></span>
          <strong>No approved requests yet</strong>
          <span>When the bank approves a pre-shipment request it appears here with its reference number, and you can start the post-shipment application.</span>
          <a routerLink="/trade-cases" class="btn btn-sm">Go to your requests</a>
        </div>
      } @else {
        @if (kpi() !== 'ALL') {
          <div class="psl-showing" role="status">
            <span>Showing <strong>{{ visible().length }}</strong> {{ kpiLabel(visible().length) }}.</span>
            <button type="button" class="btn btn-ghost btn-sm" (click)="pickKpi('ALL')">Show every request</button>
          </div>
        }
        <section class="card psl-table-card" id="psl-list">
          <div class="table-wrap">
            <table class="table psl-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Goods</th>
                  <th>Beneficiary</th>
                  <th class="num">Amount</th>
                  <th>Ship by</th>
                  <th>Post-shipment application</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (lc of visible(); track lc.caseId) {
                  <tr>
                    <td>
                      <a [routerLink]="['/post-shipment', lc.caseId]" class="psl-ref" [attr.aria-label]="'Open the post-shipment application for ' + lc.reference">{{ lc.reference }}</a>
                      <div class="muted psl-sub">{{ lc.caseId }} · approved {{ lc.approvedAt | date: 'mediumDate' }}</div>
                    </td>
                    <td>{{ lc.goodsDescription || '—' }}</td>
                    <td>{{ lc.beneficiary || '—' }}</td>
                    <td class="num">{{ lc.amount === null ? '—' : lc.currency + ' ' + (lc.amount | number: '1.2-2') }}</td>
                    <td>{{ lc.latestShipmentDate || '—' }}</td>
                    <td>
                      @if (lc.application; as app) {
                        <span class="chip" [class]="'chip ' + chip(app.state)">{{ label(app.state) }}</span>
                        <div class="muted psl-sub">{{ app.reference }} · {{ app.documentCount }} document{{ app.documentCount === 1 ? '' : 's' }}</div>
                      } @else {
                        <span class="muted">Not started</span>
                      }
                    </td>
                    <td>
                      <div class="psl-actions">
                        <a [routerLink]="['/post-shipment', lc.caseId]" class="btn btn-sm" [class.btn-primary]="lc.canStart || lc.application?.state === 'DRAFT'" [class.btn-ghost]="!(lc.canStart || lc.application?.state === 'DRAFT')">
                          {{ actionLabel(lc) }}
                        </a>
                        @if (lc.application?.state === 'DRAFT') {
                          <button type="button" class="btn btn-sm btn-danger-outline" [disabled]="removing() === lc.caseId" (click)="removeDraft(lc)">Remove draft</button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .psl-error { border-color: var(--negative); color: var(--negative); display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
      .psl-empty { text-align: center; padding: 36px 16px; display: flex; flex-direction: column; gap: 8px; align-items: center; }
      .psl-table .num { text-align: right; white-space: nowrap; }
      .psl-ref { font-weight: 700; font-family: var(--font-mono, monospace); }
      .psl-sub { font-size: 0.8rem; }
      .psl-showing { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 10px; font-size: 0.9rem; }
      .psl-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      @media (max-width: 640px) { }
    `,
  ],
})
export class PostShipmentListComponent implements OnInit {
  private readonly service = inject(PostShipmentService);
  private readonly toast = inject(ToastService);
  protected readonly removing = signal<string | null>(null);

  protected readonly items = signal<PostShipmentLc[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly kpi = signal<'ALL' | 'READY' | 'BANK' | 'ACCEPTED'>('ALL');
  /** What the chosen headline tile counts. */
  protected readonly visible = computed(() => {
    switch (this.kpi()) {
      case 'READY': return this.items().filter((i) => i.canStart && !i.application);
      case 'BANK': return this.items().filter((i) => i.application && i.application.state !== 'ACCEPTED' && i.application.state !== 'REFUSED');
      case 'ACCEPTED': return this.items().filter((i) => i.application?.state === 'ACCEPTED');
      default: return this.items();
    }
  });
  protected readonly readyCount = computed(() => this.items().filter((i) => i.canStart && !i.application).length);
  protected readonly inProgressCount = computed(() => this.items().filter((i) => i.application && i.application.state !== 'ACCEPTED' && i.application.state !== 'REFUSED').length);
  protected readonly acceptedCount = computed(() => this.items().filter((i) => i.application?.state === 'ACCEPTED').length);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.lcs().subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(isApiError(err) ? err.message : 'The service did not respond.');
        this.loading.set(false);
      },
    });
  }

  /** Remove a draft application the bank has not received, with its documents. */
  protected removeDraft(lc: PostShipmentLc): void {
    const n = lc.application?.documentCount ?? 0;
    if (!confirm(`Remove the draft post-shipment application? It has not been sent to the bank. ${n === 0 ? '' : `Its ${n} document${n === 1 ? ' is' : 's are'} removed with it.`}`.trim())) return;
    this.removing.set(lc.caseId);
    this.service.removeDraft(lc.caseId).subscribe({
      next: () => {
        this.removing.set(null);
        this.toast.success('Draft removed');
        this.load();
      },
      error: (err: unknown) => {
        this.removing.set(null);
        this.toast.error('Could not remove the draft', isApiError(err) ? err.message : 'Please try again.');
      },
    });
  }

  /** A headline tile: list what it counts (the same tile again lists everything). */
  protected pickKpi(kpi: 'ALL' | 'READY' | 'BANK' | 'ACCEPTED'): void {
    this.kpi.set(this.kpi() === kpi ? 'ALL' : kpi);
    scrollToSection('psl-list');
  }

  protected kpiLabel(n: number): string {
    const requests = n === 1 ? 'request' : 'requests';
    return { ALL: 'every approved request', READY: `${requests} ready to start`, BANK: `${requests} with an application in progress`, ACCEPTED: `${requests} whose documents were accepted` }[this.kpi()];
  }

  protected label(state: keyof typeof APPLICATION_STATE_LABELS): string {
    return APPLICATION_STATE_LABELS[state];
  }

  protected chip(state: keyof typeof APPLICATION_STATE_CHIP): string {
    return APPLICATION_STATE_CHIP[state];
  }

  protected actionLabel(lc: PostShipmentLc): string {
    const state = lc.application?.state;
    if (!state || state === 'REFUSED' || state === 'ACCEPTED') return lc.canStart ? 'Start application' : 'View';
    return state === 'DRAFT' ? 'Continue' : 'View';
  }
}
