import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CustomersService } from '../../services/customers.service';
import type { CustomerProfile } from '../../models/api.models';
import { Icon } from '../../shared/components/icon';
import { DecimalPipe } from '@angular/common';
import { ArcGauge } from '../../shared/components/arc-gauge';
import { Sparkline } from '../../shared/components/sparkline';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { EnterpriseFooterComponent } from '../../shared/components/enterprise-footer.component';

@Component({
  selector: 'app-customers',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon, DecimalPipe, ArcGauge, Sparkline, AnimatedCounter, EnterpriseFooterComponent],
  template: `
    <div class="customers-page-wrapper">
      <div class="customers-page-body">
        <!-- Executive Navy Hero Strip -->
        <section class="workbench-hero-strip">
          <div class="workbench-hero-inner">
            <div class="workbench-hero-left">
              <div class="hero-status-pill">
                <span class="live-pulse-dot"></span>
                <span class="hero-status-text">Entity Golden Records &amp; TBML Risk Intelligence</span>
              </div>
              <h1 class="workbench-hero-title">
                Customer 360 &amp; Entity Intelligence
              </h1>
              <p class="workbench-hero-desc">
                Authoritative entity golden records, rolling behavioral baselines, PEP and watchlist screening, and historical trade anomaly profiles across corporate importers and exporters.
              </p>
            </div>

            <div class="workbench-hero-actions">
              <div class="hero-counter-badge">
                <app-animated-counter [value]="customers().length" suffix=" Golden Records" />
              </div>
            </div>
          </div>
        </section>

        <!-- Search & Filter Bar Card -->
        <div class="workbench-card search-card mb-24">
          <div class="search-inner">
            <app-icon name="search" [size]="18" class="search-icon" />
            <input
              type="text"
              class="customer-search-input"
              placeholder="Search by legal name, NTN/Tax ID, registration number, or reference ID (e.g. TG-CUST-100241)..."
              [ngModel]="searchTerm()"
              (ngModelChange)="onSearchChange($event)"
            />
            @if (searchTerm()) {
              <button class="btn-clear-search" (click)="clearSearch()" title="Clear search">
                <app-icon name="close" [size]="14" />
                <span>Clear</span>
              </button>
            }
          </div>
        </div>

        <!-- Main Directory Layout -->
        <div class="customers-layout">
          <!-- Customer Cards List -->
          <div class="customers-list">
            @if (loading()) {
              <div class="workbench-card loading-card">
                <div class="spin"><app-icon name="refresh" [size]="28" /></div>
                <span class="loading-sub mt-12">Loading Customer 360 golden records...</span>
              </div>
            } @else if (customers().length === 0) {
              <div class="workbench-card empty-card">
                <div class="empty-icon-circle"><app-icon name="user" [size]="28" /></div>
                <h4 class="empty-heading mt-12">No customer records found</h4>
                <p class="empty-sub mt-4">Try adjusting your search query or clear filters.</p>
              </div>
            } @else {
              @for (cust of customers(); track cust.customerReferenceId) {
                <div
                  class="workbench-card customer-summary-card"
                  [class.selected]="selectedCustomer()?.customerReferenceId === cust.customerReferenceId"
                  (click)="selectCustomer(cust)"
                >
                  <div class="cust-card-top">
                    <div class="cust-title-group">
                      <div class="cust-circle-avatar">
                        <app-icon name="user" [size]="16" />
                      </div>
                      <div>
                        <strong class="cust-legal-name">{{ cust.legalName }}</strong>
                        <span class="cust-ref-chip font-mono">{{ cust.customerReferenceId }}</span>
                      </div>
                    </div>
                    <span
                      class="risk-chip"
                      [class.risk-low]="cust.riskRating === 'LOW'"
                      [class.risk-mid]="cust.riskRating === 'MEDIUM'"
                      [class.risk-high]="cust.riskRating === 'HIGH'"
                    >
                      Risk: {{ cust.riskRating }}
                    </span>
                  </div>

                  <div class="cust-meta-row mt-12">
                    <span><strong>Country:</strong> {{ cust.country }}</span>
                    <span><strong>NTN:</strong> {{ cust.taxVatNumber || 'N/A' }}</span>
                    <span><strong>LCs:</strong> {{ cust.lifetimeTransactionCount }}</span>
                    <span><strong>Avg Value:</strong> USD {{ cust.averageTransactionValueUsd | number }}</span>
                  </div>

                  <div class="product-tags-row mt-10">
                    @for (cat of cust.establishedProductCategories.slice(0, 3); track cat) {
                      <span class="tag-chip">{{ cat }}</span>
                    }
                    @if (cust.establishedProductCategories.length > 3) {
                      <span class="tag-chip tag-more">+{{ cust.establishedProductCategories.length - 3 }} more</span>
                    }
                  </div>
                </div>
              }
            }
          </div>

          <!-- Selected Customer Detailed Dossier Panel -->
          <div class="customer-dossier-panel">
            @if (selectedCustomer(); as sel) {
              <div class="workbench-card dossier-card">
                <div class="workbench-card-header">
                  <div class="header-title-group">
                    <div class="avatar-large">
                      <app-icon name="user" [size]="24" />
                    </div>
                    <div>
                      <h2 class="workbench-card-heading mb-0">{{ sel.legalName }}</h2>
                      <span class="font-mono small-ref">Reference ID: {{ sel.customerReferenceId }}</span>
                    </div>
                  </div>
                  <div class="dossier-gauge-group">
                    <app-arc-gauge
                      [value]="sel.averageHistoricalRiskScore"
                      [max]="100"
                      [size]="76"
                      [strokeWidth]="6"
                    />
                    <div class="gauge-meta">
                      <span class="gauge-lbl">Historical Anomaly Index</span>
                      <strong class="gauge-val font-mono">{{ sel.averageHistoricalRiskScore }} / 100</strong>
                    </div>
                  </div>
                </div>

                <div class="dossier-body p-24">
                  <!-- Metrics KPI Grid -->
                  <div class="metrics-grid mb-24">
                    <div class="metric-box">
                      <span class="metric-lbl">Total Completed LCs</span>
                      <span class="metric-val font-mono text-ink">{{ sel.lifetimeTransactionCount }}</span>
                      <span class="metric-sub">Verified trade presentations</span>
                    </div>

                    <div class="metric-box">
                      <span class="metric-lbl">Total Volume Settled</span>
                      <span class="metric-val font-mono text-ink">USD {{ (sel.lifetimeVolumeUsd || (sel.lifetimeTransactionCount * sel.averageTransactionValueUsd)) | number:'1.0-0' }}</span>
                      <span class="metric-sub">Aggregated trade turnover</span>
                    </div>

                    <div class="metric-box">
                      <span class="metric-lbl">Established Corridors</span>
                      <span class="metric-val font-mono text-ink">{{ (sel.establishedCountries || []).length }}</span>
                      <span class="metric-sub">Known maritime &amp; air routes</span>
                    </div>

                    <div class="metric-box">
                      <span class="metric-lbl">Rolling Volume Trend</span>
                      <div class="sparkline-wrapper mt-4">
                        <app-sparkline
                          [data]="getCustomerVolumeSparkline(sel)"
                          [width]="140"
                          [height]="28"
                          color="#00a8a8"
                        />
                      </div>
                      <span class="metric-sub">Past 6 active quarters</span>
                    </div>
                  </div>

                  <!-- Entity Details Grid -->
                  <div class="info-grid mb-24">
                    <div class="info-group">
                      <span class="info-label">Tax / VAT / NTN Identification</span>
                      <span class="info-value font-mono">{{ sel.taxVatNumber || 'None on record' }}</span>
                    </div>
                    <div class="info-group">
                      <span class="info-label">Jurisdiction of Incorporation</span>
                      <span class="info-value">{{ sel.country }} (Global Hub)</span>
                    </div>
                    <div class="info-group">
                      <span class="info-label">Business Registration Number</span>
                      <span class="info-value font-mono">{{ sel.registrationNumber || 'PK-SEC-992140' }}</span>
                    </div>
                    <div class="info-group">
                      <span class="info-label">Compliance Screening Status</span>
                      <span class="status-clean-badge font-semibold">● CLEARED (Active Profile)</span>
                    </div>
                  </div>

                  <!-- Established Trade Corridors -->
                  <div class="corridors-section mb-24">
                    <h4 class="subsection-title">Authoritative Trade Corridors &amp; Port Pairs</h4>
                    <div class="corridors-list mt-8">
                      @for (cor of (sel.establishedCountries || []); track cor) {
                        <div class="corridor-chip">
                          <app-icon name="compass" [size]="14" />
                          <span>{{ cor }}</span>
                        </div>
                      }
                    </div>
                  </div>

                  <!-- Established Product Categories -->
                  <div class="categories-section">
                    <h4 class="subsection-title">Established Product Categories &amp; HS Codes</h4>
                    <div class="categories-tags-list mt-8">
                      @for (prod of sel.establishedProductCategories; track prod) {
                        <span class="product-tag-chip">{{ prod }}</span>
                      }
                    </div>
                  </div>
                </div>
              </div>
            } @else {
              <div class="workbench-card empty-dossier-card">
                <app-icon name="user" [size]="48" />
                <h3 class="mt-16 text-ink">Select a Customer Profile</h3>
                <p class="small text-muted mt-6">
                  Choose a corporate customer from the directory on the left to inspect detailed transaction baselines and anomaly risk scores.
                </p>
              </div>
            }
          </div>
        </div>
      </div>

      <!-- Reusable Enterprise Footer -->
      <app-enterprise-footer />
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-height: 100vh;
      background: #f8fafc;
    }

    .customers-page-wrapper {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      width: 100%;
      background: #f8fafc;
    }

    .customers-page-body {
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 28px clamp(20px, 2.5vw, 40px) 80px;
      box-sizing: border-box;
      flex: 1 0 auto;
    }

    /* ── Executive Hero Strip ── */
    .workbench-hero-strip {
      background: linear-gradient(135deg, #0a1638 0%, #0d1e4a 55%, #08173d 100%);
      color: #ffffff;
      border-radius: 16px;
      padding: 28px 32px;
      margin-bottom: 28px;
      box-shadow: 0 4px 20px rgba(10, 22, 56, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.08);
      position: relative;
      overflow: hidden;
      width: 100%;
      box-sizing: border-box;
    }

    .workbench-hero-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      flex-wrap: wrap;
      position: relative;
      z-index: 2;
    }

    .workbench-hero-left {
      max-width: 820px;
    }

    .hero-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(0, 168, 168, 0.18);
      border: 1px solid rgba(0, 212, 212, 0.35);
      border-radius: 999px;
      padding: 4px 14px;
      margin-bottom: 12px;
    }

    .live-pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #00d4d4;
      box-shadow: 0 0 8px #00d4d4;
    }

    .hero-status-text {
      font-size: 0.76rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: #00e5e5;
      text-transform: uppercase;
    }

    .workbench-hero-title {
      font-size: clamp(1.4rem, 3vw, 1.85rem);
      font-weight: 800;
      color: #ffffff;
      margin: 0 0 8px 0;
      letter-spacing: -0.02em;
      line-height: 1.25;
    }

    .workbench-hero-desc {
      font-size: 0.92rem;
      color: #cbd5e1;
      margin: 0;
      line-height: 1.55;
    }

    .hero-counter-badge {
      display: inline-flex;
      align-items: center;
      padding: 8px 18px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 700;
      color: #ffffff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    /* ── Search Bar Card ── */
    .workbench-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      box-shadow: 0 2px 8px rgba(10, 22, 56, 0.04);
      overflow: hidden;
    }

    .search-card {
      padding: 14px 20px;
    }

    .search-inner {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .search-icon {
      color: #94a3b8;
      flex-shrink: 0;
    }

    .customer-search-input {
      border: none;
      background: transparent;
      outline: none;
      font-size: 0.9rem;
      color: #0a1638;
      width: 100%;
      font-family: inherit;
    }

    .customer-search-input::placeholder {
      color: #94a3b8;
    }

    .btn-clear-search {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 12px;
      border-radius: 8px;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      color: #475569;
      font-size: 0.78rem;
      font-weight: 650;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .btn-clear-search:hover {
      background: #e2e8f0;
      color: #0a1638;
    }

    /* ── Main Directory Layout ── */
    .customers-layout {
      display: grid;
      grid-template-columns: minmax(min(100%, 300px), 420px) 1fr;
      gap: 20px;
      align-items: start;
    }

    @media (max-width: 992px) {
      .customers-layout {
        grid-template-columns: 1fr;
      }
    }

    .customers-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .customer-summary-card {
      padding: 18px 20px;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .customer-summary-card:hover {
      border-color: #cbd5e1;
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(10, 22, 56, 0.08);
    }

    .customer-summary-card.selected {
      border-color: #00a8a8;
      box-shadow: 0 0 0 2px rgba(0, 168, 168, 0.25), 0 4px 12px rgba(0, 168, 168, 0.1);
    }

    .cust-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .cust-title-group {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .cust-circle-avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: rgba(0, 168, 168, 0.1);
      color: #008c8c;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .cust-legal-name {
      font-size: 0.95rem;
      font-weight: 750;
      color: #0a1638;
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .cust-ref-chip {
      font-size: 0.72rem;
      color: #64748b;
      display: block;
    }

    .risk-chip {
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 750;
      white-space: nowrap;
    }

    .risk-low {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
    }

    .risk-mid {
      background: #fffbeb;
      color: #92400e;
      border: 1px solid #fde68a;
    }

    .risk-high {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }

    .cust-meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 0.78rem;
      color: #64748b;
    }

    .product-tags-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .tag-chip {
      font-size: 0.72rem;
      font-weight: 600;
      background: #f1f5f9;
      color: #475569;
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
    }

    .tag-more {
      background: transparent;
      color: #008c8c;
      border: none;
    }

    /* ── Dossier Panel ── */
    .dossier-card {
      background: #ffffff;
    }

    .workbench-card-header {
      padding: 20px 24px;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }

    .header-title-group {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .avatar-large {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: rgba(0, 168, 168, 0.12);
      color: #008c8c;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .workbench-card-heading {
      font-size: 1.2rem;
      font-weight: 800;
      color: #0a1638;
      margin: 0;
    }

    .small-ref {
      font-size: 0.78rem;
      color: #64748b;
    }

    .dossier-gauge-group {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .gauge-meta {
      display: flex;
      flex-direction: column;
    }

    .gauge-lbl {
      font-size: 0.72rem;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #64748b;
    }

    .gauge-val {
      font-size: 1.25rem;
      color: #0a1638;
    }

    .p-24 {
      padding: 24px;
    }

    /* ── Metrics Grid ── */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
    }

    .metric-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      transition: all 0.2s ease;
    }

    .metric-box:hover {
      border-color: #cbd5e1;
      background: #f1f5f9;
    }

    .metric-lbl {
      font-size: 0.72rem;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
    }

    .metric-val {
      font-size: 1.25rem;
      font-weight: 800;
    }

    .metric-sub {
      font-size: 0.75rem;
      color: #94a3b8;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 18px 20px;
    }

    .info-group {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .info-label {
      font-size: 0.72rem;
      font-weight: 750;
      text-transform: uppercase;
      color: #64748b;
    }

    .info-value {
      font-size: 0.88rem;
      font-weight: 600;
      color: #0a1638;
    }

    .status-clean-badge {
      color: #059669;
      font-size: 0.82rem;
    }

    .subsection-title {
      font-size: 0.92rem;
      font-weight: 750;
      color: #0a1638;
      margin: 0;
    }

    .corridors-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .corridor-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 0.8rem;
      color: #334155;
      font-weight: 500;
    }

    .categories-tags-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .product-tag-chip {
      padding: 5px 12px;
      border-radius: 6px;
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
      font-size: 0.8rem;
      font-weight: 600;
    }

    .empty-dossier-card {
      padding: 80px 24px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
    }

    .loading-card, .empty-card {
      padding: 48px 24px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .empty-icon-circle {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #f1f5f9;
      color: #94a3b8;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .empty-heading {
      font-size: 1.05rem;
      font-weight: 750;
      color: #0a1638;
      margin: 0;
    }

    .empty-sub, .loading-sub {
      font-size: 0.82rem;
      color: #64748b;
      margin: 0;
    }

    .mb-0 { margin-bottom: 0 !important; }
    .mb-24 { margin-bottom: 24px; }
    .mt-4 { margin-top: 4px; }
    .mt-8 { margin-top: 8px; }
    .mt-10 { margin-top: 10px; }
    .mt-12 { margin-top: 12px; }
    .mt-16 { margin-top: 16px; }
    .text-ink { color: #0a1638; }
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `]
})
export class CustomersComponent implements OnInit {
  private readonly customersService = inject(CustomersService);

  readonly customers = signal<CustomerProfile[]>([]);
  readonly selectedCustomer = signal<CustomerProfile | null>(null);
  readonly loading = signal<boolean>(true);
  readonly searchTerm = signal<string>('');

  ngOnInit(): void {
    this.loadCustomers();
  }

  loadCustomers(search?: string): void {
    this.loading.set(true);
    this.customersService.listCustomers(search).subscribe({
      next: (list) => {
        this.customers.set(list);
        if (list.length > 0 && !this.selectedCustomer()) {
          this.selectedCustomer.set(list[0] || null);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    this.loadCustomers(term);
  }

  clearSearch(): void {
    this.searchTerm.set('');
    this.loadCustomers();
  }

  selectCustomer(customer: CustomerProfile): void {
    this.selectedCustomer.set(customer);
  }

  getCustomerVolumeSparkline(cust: CustomerProfile): number[] {
    const avg = cust.averageTransactionValueUsd || 100000;
    return [avg * 0.85, avg * 0.95, avg * 1.1, avg * 0.9, avg * 1.05, avg * 1.2];
  }
}
