import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DocumentsService } from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import { Icon } from '../../shared/components/icon';
import { EnterpriseFooterComponent } from '../../shared/components/enterprise-footer.component';

interface TimelineEvent {
  eventId: string;
  timestamp: string;
  stage: string;
  title: string;
  description: string;
  status: string;
}

@Component({
  selector: 'app-auditor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, Icon, EnterpriseFooterComponent],
  template: `
    <div class="auditor-page-wrapper">
      <div class="auditor-page-body">
        <!-- Executive Navy Hero Strip -->
        <section class="workbench-hero-strip">
          <div class="workbench-hero-inner">
            <div class="workbench-hero-left">
              <div class="hero-status-pill">
                <span class="live-pulse-dot"></span>
                <span class="hero-status-text">Bitemporal Point-in-Time Regulatory Engine</span>
              </div>
              <h1 class="workbench-hero-title">
                Historical Audit Reconstruction &amp; Retrospective Diff
              </h1>
              <p class="workbench-hero-desc">
                Reconstruct the exact regulatory, sanctions, and TBML compliance position as of any historical trade date. Track subsequent designations without rewriting audit history.
              </p>
            </div>

            <div class="workbench-hero-actions">
              <button class="btn-hero-secondary" (click)="loadRetrospectiveAlerts()">
                <app-icon name="refresh" [size]="14" />
                <span>Refresh Alerts ({{ alerts().length }})</span>
              </button>
            </div>
          </div>
        </section>

        <!-- Quick Screening & Query Bar Card -->
        <div class="workbench-card search-bar-card">
          <div class="workbench-card-header">
            <div class="header-title-group">
              <div class="header-icon-circle">
                <app-icon name="search" [size]="18" />
              </div>
              <div>
                <h2 class="workbench-card-heading">Point-in-Time Sanctions Screening Query</h2>
                <p class="workbench-card-subheading">Simulate sanctions exposure at historical shipment or LC presentation date</p>
              </div>
            </div>
          </div>

          <div class="p-24">
            <div class="search-form">
              <div class="input-group">
                <label>Counterparty / Entity / Bank Name</label>
                <input
                  type="text"
                  [(ngModel)]="searchPartyName"
                  placeholder="e.g. Bank Melli Iran, Sovcomflot, IRISL, Sberbank..."
                  (keyup.enter)="runHistoricalScreening()"
                  class="auditor-field"
                />
              </div>

              <div class="input-group sm">
                <label>As-Of Evaluation Date</label>
                <input
                  type="date"
                  [(ngModel)]="searchAsOfDate"
                  class="auditor-field"
                />
              </div>

              <div class="input-group sm">
                <label>SWIFT BIC / IMO (Optional)</label>
                <input
                  type="text"
                  [(ngModel)]="searchIdentifier"
                  placeholder="e.g. BSEERUMM"
                  class="auditor-field"
                />
              </div>

              <button class="btn-primary-gradient" (click)="runHistoricalScreening()" [disabled]="isLoadingScreening()">
                <app-icon name="sparkle" [size]="15" *ngIf="!isLoadingScreening()" />
                <span *ngIf="isLoadingScreening()">Screening...</span>
                <span *ngIf="!isLoadingScreening()">Execute Point-in-Time Query</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Historical Screening Results Section -->
        <div *ngIf="screeningResults()" class="workbench-card results-card mt-28">
          <div class="workbench-card-header">
            <div>
              <h3 class="workbench-card-heading">Point-in-Time Results for: <span class="highlight">{{ screeningResults().searchedParty }}</span></h3>
              <span class="meta-note">Evaluated as of: {{ screeningResults().asOfDate | date:'longDate' }} (UTC)</span>
            </div>
            <span class="match-count-pill" [class.danger]="screeningResults().matchesCount > 0">
              {{ screeningResults().matchesCount }} Regulatory Matches Found
            </span>
          </div>

          <div class="p-24">
            <div *ngIf="screeningResults().matches.length === 0" class="empty-state">
              <app-icon name="check" [size]="20" />
              <span>CLEARED: No active sanctions or watchlists matches existed for this entity on the selected evaluation date.</span>
            </div>

            <div *ngIf="screeningResults().matches.length > 0" class="matches-grid">
              <div *ngFor="let m of screeningResults().matches" class="match-card" [class.listed-now]="m.wasListedAtTransactionTime">
                <div class="match-top">
                  <div class="match-name-group">
                    <span class="status-pill" [class.blocked]="m.wasListedAtTransactionTime" [class.added-after]="m.temporalStatus === 'ADDED_AFTER_TRANSACTION'">
                      {{ m.temporalStatus.split('_').join(' ') }}
                    </span>
                    <h4>{{ m.matchedName }}</h4>
                  </div>
                  <span class="regime-tag">{{ m.sanctionsList }} ({{ m.jurisdiction }})</span>
                </div>

                <div class="match-details">
                  <div class="detail-row">
                    <span class="label">Designation Date:</span>
                    <span class="val font-mono">{{ m.designationDate | date:'mediumDate' }}</span>
                  </div>
                  <div class="detail-row">
                    <span class="label">Status at Query Date:</span>
                    <span class="val" [class.active-danger]="m.wasListedAtTransactionTime">
                      {{ m.wasListedAtTransactionTime ? 'ACTIVE DESIGNATION (PROHIBITED)' : 'NOT LISTED AT HISTORICAL POINT' }}
                    </span>
                  </div>
                  <div class="detail-row">
                    <span class="label">Current Status:</span>
                    <span class="val font-semibold">{{ m.isCurrentlyListed ? 'CURRENTLY LISTED' : 'DELISTED / CLEAR' }}</span>
                  </div>
                  <div class="detail-row">
                    <span class="label">Legal Explanation:</span>
                    <span class="val explanation">{{ m.legalExplanation }}</span>
                  </div>
                </div>

                <div class="recommended-box">
                  <strong>Audit Directive:</strong> {{ m.recommendedAction }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Retrospective Monitoring Alerts Section -->
        <div class="workbench-card mt-28">
          <div class="workbench-card-header">
            <div class="header-title-group">
              <div class="header-icon-circle">
                <app-icon name="alert" [size]="18" />
              </div>
              <div>
                <h2 class="workbench-card-heading">Retrospective Post-Transaction Designation Alerts</h2>
                <p class="workbench-card-subheading">Entities added to international sanctions regimes following original transaction settlement date</p>
              </div>
            </div>
            <button class="btn-util-ghost" (click)="loadRetrospectiveAlerts()">
              <app-icon name="refresh" [size]="14" />
              <span>Refresh Alerts</span>
            </button>
          </div>

          <div class="modern-table-container">
            <table class="modern-trade-table">
              <thead>
                <tr>
                  <th>Alert ID</th>
                  <th>Trade Reference</th>
                  <th>Transaction Date</th>
                  <th>Entity Name</th>
                  <th>Role</th>
                  <th>Sanctions Feed</th>
                  <th>Designation Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let a of alerts()">
                  <td class="font-mono text-ink">{{ a.alertId }}</td>
                  <td><strong class="text-ink">{{ a.tradeReference }}</strong></td>
                  <td>{{ a.transactionTimestamp | date:'shortDate' }}</td>
                  <td class="entity-name font-semibold text-ink">{{ a.newlyDesignatedEntityName }}</td>
                  <td><span class="role-badge">{{ a.partyRoleInTransaction }}</span></td>
                  <td><span class="source-tag font-semibold">{{ a.sanctionsList }}</span></td>
                  <td class="danger-text font-semibold">{{ a.designationDate | date:'shortDate' }}</td>
                  <td><span class="alert-status-pill">{{ a.status }}</span></td>
                </tr>
                <tr *ngIf="alerts().length === 0">
                  <td colspan="8" class="empty-cell">No retrospective exposure alerts recorded. All historical presentations currently monitored.</td>
                </tr>
              </tbody>
            </table>
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

    .auditor-page-wrapper {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      width: 100%;
      background: #f8fafc;
    }

    .auditor-page-body {
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

    .workbench-hero-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .btn-hero-secondary {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 0 16px;
      height: 38px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.08);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      font-size: 0.84rem;
      font-weight: 650;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      white-space: nowrap;
    }

    .btn-hero-secondary:hover {
      background: rgba(255, 255, 255, 0.16);
      border-color: rgba(255, 255, 255, 0.35);
      transform: translateY(-1px);
    }

    /* ── Workbench Card Design System ── */
    .workbench-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      box-shadow: 0 2px 8px rgba(10, 22, 56, 0.04);
      overflow: hidden;
    }

    .workbench-card-header {
      padding: 20px 24px;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 14px;
      background: #ffffff;
    }

    .header-title-group {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .header-icon-circle {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: rgba(0, 168, 168, 0.1);
      color: #008c8c;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .workbench-card-heading {
      font-size: 1.12rem;
      font-weight: 800;
      color: #0a1638;
      margin: 0;
    }

    .workbench-card-subheading {
      font-size: 0.8rem;
      color: #64748b;
      margin: 2px 0 0 0;
    }

    .p-24 {
      padding: 24px;
    }

    /* ── Query Form ── */
    .search-form {
      display: flex;
      gap: 1rem;
      align-items: flex-end;
      flex-wrap: wrap;
    }

    .input-group {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      flex: 1 1 220px;
      min-width: min(100%, 180px);
    }

    .input-group.sm {
      flex: 1 1 160px;
      min-width: min(100%, 150px);
    }

    .input-group label {
      font-size: 0.75rem;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #475569;
    }

    .auditor-field {
      padding: 0 12px;
      height: 38px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 0.86rem;
      outline: none;
      font-family: inherit;
      transition: all 0.2s ease;
      background: #ffffff;
      color: #0a1638;
      width: 100%;
      box-sizing: border-box;
    }

    .auditor-field:focus {
      border-color: #00a8a8;
      box-shadow: 0 0 0 3px rgba(0, 168, 168, 0.14);
    }

    .btn-primary-gradient {
      background: linear-gradient(135deg, #00a8a8 0%, #008787 100%);
      color: #ffffff;
      border: 1px solid rgba(0, 168, 168, 0.3);
      padding: 0 18px;
      height: 38px;
      border-radius: 8px;
      font-size: 0.84rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 2px 8px rgba(0, 168, 168, 0.3);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      white-space: nowrap;
    }

    .btn-primary-gradient:hover:not(:disabled) {
      background: linear-gradient(135deg, #00baba 0%, #009999 100%);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 168, 168, 0.4);
    }

    .btn-primary-gradient:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .btn-util-ghost {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 34px;
      padding: 0 14px;
      border-radius: 8px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      font-size: 0.8rem;
      font-weight: 650;
      color: #334155;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
      transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .btn-util-ghost:hover {
      background: #f8fafc;
      border-color: #cbd5e1;
      color: #0a1638;
      transform: translateY(-1px);
    }

    /* ── Results Section ── */
    .highlight {
      color: #008c8c;
    }

    .meta-note {
      font-size: 0.8rem;
      color: #64748b;
    }

    .match-count-pill {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 700;
      white-space: nowrap;
    }

    .match-count-pill.danger {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }

    .empty-state {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 10px;
      padding: 16px 20px;
      color: #166534;
      font-size: 0.88rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .matches-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }

    .match-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 18px 20px;
      border-left: 4px solid #00a8a8;
      transition: all 0.2s ease;
    }

    .match-card.listed-now {
      border-left-color: #e11d48;
      background: #fff5f5;
    }

    .match-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
      gap: 8px;
    }

    .status-pill {
      font-size: 0.68rem;
      font-weight: 750;
      padding: 2px 7px;
      border-radius: 4px;
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #cbd5e1;
      display: inline-block;
      margin-bottom: 4px;
    }

    .status-pill.blocked {
      background: #fef2f2;
      color: #991b1b;
      border-color: #fecaca;
    }

    .match-name-group h4 {
      margin: 0;
      font-size: 1rem;
      font-weight: 750;
      color: #0a1638;
    }

    .regime-tag {
      font-size: 0.75rem;
      font-weight: 700;
      color: #008c8c;
      background: rgba(0, 168, 168, 0.08);
      padding: 3px 8px;
      border-radius: 6px;
    }

    .match-details {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      font-size: 0.82rem;
      margin-bottom: 0.75rem;
    }

    .detail-row {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .detail-row .label {
      color: #64748b;
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .detail-row .val {
      font-weight: 600;
      color: #0a1638;
    }

    .detail-row .val.explanation {
      text-align: right;
      font-weight: normal;
      font-size: 0.78rem;
      color: #475569;
      max-width: 280px;
    }

    .active-danger {
      color: #e11d48 !important;
      font-weight: 700 !important;
    }

    .recommended-box {
      background: #ffffff;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      font-size: 0.82rem;
      color: #334155;
      word-break: break-word;
      margin-top: 10px;
    }

    /* ── Table Container & Styles ── */
    .modern-table-container {
      width: 100%;
      overflow-x: auto;
    }

    .modern-trade-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.85rem;
    }

    .modern-trade-table th {
      padding: 12px 18px;
      background: #f8fafc;
      color: #475569;
      font-size: 0.72rem;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #e2e8f0;
      white-space: nowrap;
    }

    .modern-trade-table td {
      padding: 14px 18px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
      color: #334155;
      white-space: nowrap;
    }

    .modern-trade-table tbody tr {
      transition: background 0.15s ease;
    }

    .modern-trade-table tbody tr:hover {
      background: #fafbfc;
    }

    .role-badge {
      background: #f1f5f9;
      color: #475569;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 0.72rem;
      font-weight: 650;
    }

    .source-tag {
      color: #008c8c;
    }

    .danger-text {
      color: #e11d48;
    }

    .alert-status-pill {
      background: #fffbeb;
      color: #d97706;
      border: 1px solid #fde68a;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.7rem;
      font-weight: 700;
    }

    .empty-cell {
      text-align: center;
      padding: 40px 20px;
      color: #64748b;
    }

    .text-ink { color: #0a1638; }
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .font-semibold { font-weight: 600; }
    .mt-28 { margin-top: 28px; }
  `]
})
export class AuditorComponent implements OnInit {
  private readonly documentsService = inject(DocumentsService);
  private readonly toast = inject(ToastService);

  searchPartyName = '';
  searchAsOfDate = '';
  searchIdentifier = '';

  isLoadingScreening = signal<boolean>(false);
  screeningResults = signal<any | null>(null);
  alerts = signal<any[]>([]);

  ngOnInit(): void {
    this.loadRetrospectiveAlerts();
  }

  runHistoricalScreening(): void {
    if (!this.searchPartyName.trim()) {
      this.toast.info('Missing Counterparty', 'Please specify an entity, vessel, or bank name to screen.');
      return;
    }
    this.isLoadingScreening.set(true);

    this.documentsService.screenHistorical({
      partyName: this.searchPartyName.trim(),
      asOfDate: this.searchAsOfDate ? new Date(this.searchAsOfDate).toISOString() : undefined,
      swiftBic: this.searchIdentifier ? this.searchIdentifier.trim() : undefined,
    }).subscribe({
      next: (res) => {
        this.screeningResults.set(res);
        this.isLoadingScreening.set(false);
        if (res.matchesCount > 0) {
          this.toast.error('Watchlist Hits Identified', `${res.matchesCount} historical regulatory match(es) detected for ${res.searchedParty}.`);
        } else {
          this.toast.success('Clean Screening', `No active regulatory listings found for ${res.searchedParty} as of the requested date.`);
        }
      },
      error: () => {
        this.isLoadingScreening.set(false);
        this.toast.error('Screening Query Failed', 'Could not complete retrospective screening query. Please check parameters and retry.');
      }
    });
  }

  loadRetrospectiveAlerts(): void {
    this.documentsService.getRetrospectiveAlerts().subscribe({
      next: (res) => {
        this.alerts.set(res.alerts || []);
      },
      error: () => {
        this.toast.error('Retrospective Alerts Unavailable', 'Could not retrieve latest retrospective designation alerts.');
      }
    });
  }
}
