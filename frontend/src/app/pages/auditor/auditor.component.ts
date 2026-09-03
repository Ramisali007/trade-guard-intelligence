import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DocumentsService } from '../../services/documents.service';

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
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="auditor-page">
      <!-- Header Banner -->
      <div class="header-card">
        <div class="header-left">
          <div class="badge-title">
            <span class="auditor-badge">AUDITOR WORKBENCH</span>
            <span class="version-badge">Point-in-Time Regulatory Engine</span>
          </div>
          <h1>Historical Audit Reconstruction & Retrospective Diff</h1>
          <p class="subtitle">
            Reconstruct the exact regulatory, sanctions, and TBML compliance position as of any historical trade date. Track subsequent designations without rewriting audit history.
          </p>
        </div>
      </div>

      <!-- Quick Screening & Query Bar -->
      <div class="search-bar-card">
        <div class="search-form">
          <div class="input-group">
            <label>Counterparty / Entity / Bank Name</label>
            <input
              type="text"
              [(ngModel)]="searchPartyName"
              placeholder="e.g. Bank Melli Iran, Sovcomflot, IRISL, Sberbank..."
              (keyup.enter)="runHistoricalScreening()"
            />
          </div>

          <div class="input-group sm">
            <label>As-Of Evaluation Date</label>
            <input
              type="date"
              [(ngModel)]="searchAsOfDate"
            />
          </div>

          <div class="input-group sm">
            <label>SWIFT BIC / IMO (Optional)</label>
            <input
              type="text"
              [(ngModel)]="searchIdentifier"
              placeholder="e.g. BSEERUMM"
            />
          </div>

          <button class="btn-primary" (click)="runHistoricalScreening()" [disabled]="isLoadingScreening()">
            <span *ngIf="isLoadingScreening()">Screening...</span>
            <span *ngIf="!isLoadingScreening()">Execute Point-in-Time Query</span>
          </button>
        </div>
      </div>

      <!-- Historical Screening Results Section -->
      <div *ngIf="screeningResults()" class="results-card">
        <div class="results-header">
          <div>
            <h3>Point-in-Time Screening Results for: <span class="highlight">{{ screeningResults().searchedParty }}</span></h3>
            <span class="meta-note">Evaluated as of: {{ screeningResults().asOfDate | date:'longDate' }} (UTC)</span>
          </div>
          <span class="match-count-pill" [class.danger]="screeningResults().matchesCount > 0">
            {{ screeningResults().matchesCount }} Regulatory Matches Found
          </span>
        </div>

        <div *ngIf="screeningResults().matches.length === 0" class="empty-state">
          <p>CLEARED: No active sanctions or watchlists matches existed for this entity on the selected evaluation date.</p>
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
                <span class="val">{{ m.designationDate | date:'mediumDate' }}</span>
              </div>
              <div class="detail-row">
                <span class="label">Status at Query Date:</span>
                <span class="val" [class.active-danger]="m.wasListedAtTransactionTime">
                  {{ m.wasListedAtTransactionTime ? 'ACTIVE DESIGNATION (PROHIBITED)' : 'NOT LISTED AT HISTORICAL POINT' }}
                </span>
              </div>
              <div class="detail-row">
                <span class="label">Current Status:</span>
                <span class="val">{{ m.isCurrentlyListed ? 'CURRENTLY LISTED' : 'DELISTED / CLEAR' }}</span>
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

      <!-- Retrospective Monitoring Alerts Section -->
      <div class="section-container">
        <div class="section-title-bar">
          <h2>Retrospective Post-Transaction Designation Alerts</h2>
          <button class="btn-secondary" (click)="loadRetrospectiveAlerts()">Refresh Alerts</button>
        </div>

        <div class="alerts-table-card">
          <table class="data-table">
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
                <td class="mono-id">{{ a.alertId }}</td>
                <td><strong>{{ a.tradeReference }}</strong></td>
                <td>{{ a.transactionTimestamp | date:'shortDate' }}</td>
                <td class="entity-name">{{ a.newlyDesignatedEntityName }}</td>
                <td><span class="role-badge">{{ a.partyRoleInTransaction }}</span></td>
                <td><span class="source-tag">{{ a.sanctionsList }}</span></td>
                <td class="danger-text">{{ a.designationDate | date:'shortDate' }}</td>
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
  `,
  styles: [`
    .auditor-page {
      padding: 24px 32px 64px;
      max-width: 1440px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
      font-family: var(--font);
    }

    .header-card {
      background: #ffffff;
      color: var(--ink);
      padding: 20px 24px;
      border-radius: var(--radius-lg);
      border: 1px solid var(--line);
      box-shadow: var(--shadow-sm);
    }

    .badge-title {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .auditor-badge {
      background: var(--accent);
      color: #fff;
      font-size: 0.72rem;
      font-weight: 750;
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .version-badge {
      background: var(--sunken);
      color: var(--ink-2);
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      border: 1px solid var(--line);
    }

    h1 {
      margin: 0 0 0.5rem 0;
      font-size: 1.45rem;
      font-weight: 700;
      color: var(--ink);
      letter-spacing: -0.02em;
    }

    .subtitle {
      margin: 0;
      color: var(--ink-3);
      font-size: 0.88rem;
      line-height: 1.5;
      max-width: 900px;
    }

    .search-bar-card {
      background: var(--raised);
      padding: 18px 24px;
      border-radius: var(--radius-lg);
      border: 1px solid var(--line);
      box-shadow: var(--shadow-sm);
    }

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
      flex: 1;
      min-width: 250px;
    }

    .input-group.sm {
      flex: 0 0 200px;
      min-width: 180px;
    }

    .input-group label {
      font-size: 0.75rem;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #344054;
    }

    .input-group input {
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      font-size: 0.85rem;
      outline: none;
      font-family: var(--font);
      transition: border-color 0.2s;
      background: var(--raised);
      color: var(--ink);
    }

    .input-group input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-ring);
    }

    .btn-primary {
      background: var(--accent);
      color: #fff;
      border: none;
      padding: 0.65rem 1.25rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      height: 38px;
      font-family: var(--font);
      transition: all var(--dur-fast) var(--ease);
    }

    .btn-primary:hover {
      background: var(--accent-hover);
    }

    .btn-secondary {
      background: var(--sunken);
      color: var(--ink);
      border: 1px solid var(--line);
      padding: 0.45rem 0.85rem;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      font-family: var(--font);
    }

    .results-card {
      background: var(--raised);
      padding: 20px 24px;
      border-radius: var(--radius-lg);
      border: 1px solid var(--line);
      box-shadow: var(--shadow-sm);
    }

    .results-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--line);
    }

    .results-header h3 {
      margin: 0 0 0.25rem 0;
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--ink);
    }

    .highlight {
      color: var(--accent);
    }

    .meta-note {
      font-size: 0.8rem;
      color: var(--ink-3);
    }

    .match-count-pill {
      background: #ecfdf5;
      color: #059669;
      padding: 0.35rem 0.75rem;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 600;
    }

    .match-count-pill.danger {
      background: #fef2f2;
      color: #dc2626;
    }

    .empty-state {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: var(--radius-sm);
      padding: 14px 20px;
      color: #166534;
      font-size: 0.88rem;
      font-weight: 500;
    }

    .matches-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
      gap: 1rem;
    }

    .match-card {
      background: var(--sunken);
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      padding: 16px 20px;
      border-left: 4px solid var(--accent);
      transition: all var(--dur-fast) var(--ease);
    }

    .match-card.listed-now {
      border-left-color: #dc2626;
      background: #fffbfa;
    }

    .match-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.75rem;
    }

    .status-pill {
      font-size: 0.68rem;
      font-weight: 750;
      padding: 0.2rem 0.45rem;
      border-radius: 4px;
      background: #e2e8f0;
      color: #475467;
      display: inline-block;
      margin-bottom: 0.25rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .status-pill.blocked {
      background: #fecaca;
      color: #991b1b;
    }

    .status-pill.added-after {
      background: #fed7aa;
      color: #9a3412;
    }

    .match-name-group h4 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--ink);
    }

    .regime-tag {
      font-size: 0.72rem;
      font-weight: 600;
      background: #e0f2fe;
      color: #0369a1;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
    }

    .match-details {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      font-size: 0.82rem;
      margin-bottom: 0.75rem;
    }

    .detail-row {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .detail-row .label {
      color: #475467;
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .detail-row .val {
      font-weight: 600;
      color: var(--ink);
    }

    .detail-row .val.explanation {
      text-align: right;
      font-weight: normal;
      font-size: 0.78rem;
      color: var(--ink-2);
      max-width: 260px;
    }

    .active-danger {
      color: #dc2626 !important;
      font-weight: 700 !important;
    }

    .recommended-box {
      background: var(--raised);
      padding: 12px 14px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
      font-size: 0.82rem;
      color: var(--ink);
    }

    .section-container {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .section-title-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .section-title-bar h2 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--ink);
    }

    .alerts-table-card {
      background: var(--raised);
      border-radius: var(--radius-lg);
      border: 1px solid var(--line);
      overflow-x: auto;
      box-shadow: var(--shadow-sm);
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
      text-align: left;
    }

    .data-table th {
      background: #f8fafc;
      padding: 0.75rem 1rem;
      font-weight: 750;
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #475467;
      border-bottom: 1px solid var(--line);
    }

    .data-table td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--line);
      color: var(--ink);
    }

    .mono-id {
      font-family: var(--font-mono);
      font-size: 0.78rem;
      color: var(--ink-3);
    }

    .role-badge {
      background: var(--sunken);
      color: var(--ink-2);
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-size: 0.72rem;
      font-weight: 600;
    }

    .source-tag {
      font-weight: 600;
      color: var(--accent);
    }

    .danger-text {
      color: #dc2626;
      font-weight: 600;
    }

    .alert-status-pill {
      background: #fef3c7;
      color: #92400e;
      padding: 0.2rem 0.5rem;
      border-radius: 12px;
      font-size: 0.7rem;
      font-weight: 600;
    }

    .empty-cell {
      text-align: center;
      padding: 2rem;
      color: var(--ink-3);
    }
  `]
})
export class AuditorComponent implements OnInit {
  private readonly documentsService = inject(DocumentsService);

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
    if (!this.searchPartyName) return;
    this.isLoadingScreening.set(true);

    this.documentsService.screenHistorical({
      partyName: this.searchPartyName,
      asOfDate: this.searchAsOfDate ? new Date(this.searchAsOfDate).toISOString() : undefined,
      swiftBic: this.searchIdentifier ? this.searchIdentifier : undefined,
    }).subscribe({
      next: (res) => {
        this.screeningResults.set(res);
        this.isLoadingScreening.set(false);
      },
      error: () => {
        this.isLoadingScreening.set(false);
      }
    });
  }

  loadRetrospectiveAlerts(): void {
    this.documentsService.getRetrospectiveAlerts().subscribe({
      next: (res) => {
        this.alerts.set(res.alerts || []);
      }
    });
  }
}
