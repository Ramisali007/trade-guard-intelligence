import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Icon } from '../../shared/components/icon';
import { PostShipmentService } from '../../services/post-shipment.service';
import { isApiError } from '../../services/api.service';
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
          <p class="muted">
            Once the goods are shipped, send the shipping documents for the request the bank approved. Choose a reference to open its post-shipment application.
          </p>
        </div>
        <section class="page-head-kpis" aria-label="Summary">
          <div class="kpi-tile">
            <span class="kpi-tile-label">Approved requests</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="items().length" /></strong>
            <span class="kpi-tile-note">the bank said yes</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Ready to start</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="readyCount()" /></strong>
            <span class="kpi-tile-note">no application yet</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">With the bank</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="inProgressCount()" /></strong>
            <span class="kpi-tile-note">drafts and examinations</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Documents accepted</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="acceptedCount()" /></strong>
            <span class="kpi-tile-note">examination complete</span>
          </div>
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
        <section class="card psl-table-card">
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
                @for (lc of items(); track lc.caseId) {
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
                      <a [routerLink]="['/post-shipment', lc.caseId]" class="btn btn-sm" [class.btn-primary]="lc.canStart || lc.application?.state === 'DRAFT'" [class.btn-ghost]="!(lc.canStart || lc.application?.state === 'DRAFT')">
                        {{ actionLabel(lc) }}
                      </a>
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
      @media (max-width: 640px) { }
    `,
  ],
})
export class PostShipmentListComponent implements OnInit {
  private readonly service = inject(PostShipmentService);

  protected readonly items = signal<PostShipmentLc[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
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
