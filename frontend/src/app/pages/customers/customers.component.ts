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

@Component({
  selector: 'app-customers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon, DecimalPipe],
  template: `

    <div class="page">
      <header class="page-header">
        <div>
          <h1 class="h1">Customer 360 & Entity Intelligence</h1>
          <p class="muted mt-4">
            Authoritative golden records, rolling behavioral baselines, and historical trade anomaly profiles.
          </p>
        </div>
        <div class="row gap-8 align-center">
          <span class="chip chip-info font-mono">{{ customers().length }} Golden Records</span>
        </div>
      </header>

      <!-- Search & Filter Bar -->
      <div class="card search-card mb-20">
        <div class="search-inner">
          <app-icon name="search" [size]="18" />
          <input
            type="text"
            class="input customer-search-input"
            placeholder="Search by legal name, NTN/Tax ID, Registration number, or Reference ID (e.g. TG-CUST-100241)..."
            [ngModel]="searchTerm()"
            (ngModelChange)="onSearchChange($event)"
          />
          @if (searchTerm()) {
            <button class="btn btn-sm btn-ghost" (click)="clearSearch()">
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
            <div class="card loading-card">
              <div class="spin"><app-icon name="refresh" [size]="24" /></div>
              <span class="muted mt-8">Loading Customer 360 golden records...</span>
            </div>
          } @else if (customers().length === 0) {
            <div class="card empty-card">
              <app-icon name="user" [size]="32" />
              <p class="font-bold mt-12">No customer records found</p>
              <p class="small muted mt-4">Try adjusting your search query.</p>
            </div>
          } @else {
            @for (cust of customers(); track cust.customerReferenceId) {
              <div
                class="card customer-summary-card"
                [class.selected]="selectedCustomer()?.customerReferenceId === cust.customerReferenceId"
                (click)="selectCustomer(cust)"
              >
                <div class="row gap-10 align-center justify-between">
                  <div class="row gap-8 align-center">
                    <div class="cust-circle-avatar">
                      <app-icon name="user" [size]="16" />
                    </div>
                    <div>
                      <strong class="cust-legal-name">{{ cust.legalName }}</strong>
                      <span class="chip font-mono small ml-6">{{ cust.customerReferenceId }}</span>
                    </div>
                  </div>
                  <span
                    class="chip small"
                    [class.chip-positive]="cust.riskRating === 'LOW'"
                    [class.chip-warning]="cust.riskRating === 'MEDIUM'"
                    [class.chip-negative]="cust.riskRating === 'HIGH'"
                  >
                    Risk: {{ cust.riskRating }}
                  </span>
                </div>

                <div class="row gap-12 wrap mt-10 small muted">
                  <span><strong>Country:</strong> {{ cust.country }}</span>
                  <span><strong>NTN:</strong> {{ cust.taxVatNumber || 'N/A' }}</span>
                  <span><strong>LCs:</strong> {{ cust.lifetimeTransactionCount }}</span>
                  <span><strong>Avg Value:</strong> USD {{ cust.averageTransactionValueUsd | number }}</span>
                </div>

                <div class="row gap-4 wrap mt-8">
                  @for (cat of cust.establishedProductCategories.slice(0, 3); track cat) {
                    <span class="chip small chip-neutral">{{ cat }}</span>
                  }
                  @if (cust.establishedProductCategories.length > 3) {
                    <span class="chip small chip-neutral">+{{ cust.establishedProductCategories.length - 3 }} more</span>
                  }
                </div>
              </div>
            }
          }
        </div>

        <!-- Selected Customer Detailed Dossier -->
        <div class="customer-dossier-panel">
          @if (selectedCustomer(); as sel) {
            <div class="card dossier-card">
              <div class="card-head">
                <div class="row gap-10 align-center justify-between">
                  <div class="row gap-8 align-center">
                    <div class="avatar-large">
                      <app-icon name="user" [size]="22" />
                    </div>
                    <div>
                      <h2 class="h2 mb-0">{{ sel.legalName }}</h2>
                      <span class="font-mono small muted">Reference: {{ sel.customerReferenceId }}</span>
                    </div>
                  </div>
                  <span
                    class="chip"
                    [class.chip-positive]="sel.riskRating === 'LOW'"
                    [class.chip-warning]="sel.riskRating === 'MEDIUM'"
                    [class.chip-negative]="sel.riskRating === 'HIGH'"
                  >
                    Risk: {{ sel.riskRating }} (Avg Risk: {{ sel.averageHistoricalRiskScore }}/100)
                  </span>
                </div>
              </div>

              <div class="card-body">
                <!-- Registration & Profile Info -->
                <div class="info-section mb-16">
                  <span class="eyebrow mb-6">Entity Profile & Registration</span>
                  <div class="info-grid">
                    <div class="info-item">
                      <span class="info-label">Normalized Legal Name</span>
                      <span class="info-val font-mono">{{ sel.normalizedName }}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">Tax / NTN Number</span>
                      <span class="info-val font-mono">{{ sel.taxVatNumber || 'Not Registered' }}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">Registration / Incorporate</span>
                      <span class="info-val font-mono">{{ sel.registrationNumber || 'N/A' }}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">Jurisdiction & Domicile</span>
                      <span class="info-val">{{ sel.country }}</span>
                    </div>
                    <div class="info-item full-width">
                      <span class="info-label">Registered Physical Address</span>
                      <span class="info-val">{{ sel.address || 'Address on file' }}</span>
                    </div>
                    <div class="info-item full-width">
                      <span class="info-label">Declared Business Activity</span>
                      <span class="info-val">{{ sel.declaredBusinessActivity }}</span>
                    </div>
                  </div>
                </div>

                <!-- Historical Trading Metrics -->
                <div class="info-section mb-16">
                  <span class="eyebrow mb-8">Historical Behavioral Baselines</span>
                  <div class="metrics-grid">
                    <div class="metric-card">
                      <span class="metric-lbl">Monthly LC Frequency</span>
                      <span class="metric-val">{{ sel.monthlyLcFrequency | number:'1.1-1' }} LCs/mo</span>
                      <span class="metric-sub">Rolling 365-day baseline</span>
                    </div>
                    <div class="metric-card">
                      <span class="metric-lbl">Average LC Value</span>
                      <span class="metric-val">USD {{ sel.averageTransactionValueUsd | number }}</span>
                      <span class="metric-sub">Mean transaction size</span>
                    </div>
                    <div class="metric-card">
                      <span class="metric-lbl">Lifetime Volume</span>
                      <span class="metric-val">USD {{ sel.lifetimeVolumeUsd | number }}</span>
                      <span class="metric-sub">{{ sel.lifetimeTransactionCount }} historical trades</span>
                    </div>
                    <div class="metric-card">
                      <span class="metric-lbl">Past Red Flags</span>
                      <span class="metric-val">{{ sel.pastPriceAnomaliesCount }} Price · {{ sel.pastDiscrepanciesCount }} Disc.</span>
                      <span class="metric-sub">0 Sanctions hits</span>
                    </div>
                  </div>
                </div>

                <!-- Established Product Lines -->
                <div class="info-section mb-16">
                  <span class="eyebrow mb-6">Established Product Profile</span>
                  <div class="row gap-6 wrap">
                    @for (cat of sel.establishedProductCategories; track cat) {
                      <span class="chip chip-info">{{ cat }}</span>
                    }
                  </div>
                </div>

                <!-- Known Corridors & Counterparties -->
                <div class="info-section mb-16">
                  <span class="eyebrow mb-6">Regular Trading Corridors</span>
                  <div class="row gap-6 wrap">
                    @for (country of sel.establishedCountries; track country) {
                      <span class="chip chip-neutral">{{ country }}</span>
                    }
                  </div>
                </div>

                <!-- Known Counterparties -->
                <div class="info-section">
                  <span class="eyebrow mb-6">Regular Buyers & Suppliers</span>
                  <div class="row gap-12 wrap">
                    <div>
                      <span class="small font-bold">Approved Suppliers:</span>
                      <div class="small muted mt-2">
                        @for (sup of sel.regularSuppliers; track sup) {
                          <div>&bull; {{ sup }}</div>
                        }
                      </div>
                    </div>
                    <div>
                      <span class="small font-bold">Approved Buyers:</span>
                      <div class="small muted mt-2">
                        @for (byr of sel.regularBuyers; track byr) {
                          <div>&bull; {{ byr }}</div>
                        }
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          } @else {
            <div class="card empty-dossier-card">
              <app-icon name="user" [size]="40" />
              <p class="font-bold mt-12">Select a Customer Record</p>
              <p class="small muted mt-4">
                Click on any profile from the left directory to inspect its rolling baseline and historical behavioral metrics.
              </p>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .search-card {
      padding: 12px 18px;
    }
    .search-inner {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .customer-search-input {
      flex: 1;
      border: none;
      background: transparent;
      outline: none;
      font-size: 0.95rem;
      color: var(--ink);
    }
    .customers-layout {
      display: grid;
      grid-template-columns: 420px 1fr;
      gap: 20px;
      align-items: start;
    }
    @media (max-width: 960px) {
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
      padding: 16px 20px;
      cursor: pointer;
      transition: all 0.15s ease;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--raised);
    }
    .customer-summary-card:hover {
      border-color: var(--line-strong);
      transform: translateY(-1px);
    }
    .customer-summary-card.selected {
      border-color: var(--accent);
      background: var(--raised);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .cust-circle-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--sunken);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent);
    }
    .cust-legal-name {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--ink);
    }
    .avatar-large {
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: var(--sunken);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent);
    }
    .info-section {
      padding-bottom: 16px;
      border-bottom: 1px solid var(--line);
    }
    .info-section:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .info-item.full-width {
      grid-column: span 2;
    }
    .info-label {
      font-size: 0.75rem;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #344054;
      display: block;
      margin-bottom: 4px;
    }
    .info-val {
      font-size: 0.88rem;
      font-weight: 500;
      color: var(--ink);
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }
    .metric-card {
      padding: 16px 20px;
      background: var(--sunken);
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      display: flex;
      flex-direction: column;
      gap: 4px;
      transition: all var(--dur-fast) var(--ease);
    }
    .metric-card:hover {
      background: #ebeef2;
      border-color: var(--line);
    }
    .metric-lbl {
      font-size: 0.75rem;
      font-weight: 750;
      color: #344054;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .metric-val {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--ink);
    }
    .metric-sub {
      font-size: 0.75rem;
      color: var(--ink-3);
    }
    .empty-dossier-card {
      padding: 60px 20px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--ink-3);
    }
    .loading-card, .empty-card {
      padding: 40px 20px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
  `,
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
}
