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
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      padding: 1.5rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    .header-card {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #f8fafc;
      padding: 1.75rem;
      border-radius: 12px;
      border: 1px solid #334155;
    }

    .badge-title {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .auditor-badge {
      background: #0284c7;
      color: #fff;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      letter-spacing: 0.05em;
    }

    .version-badge {
      background: rgba(255,255,255,0.1);
      color: #94a3b8;
      font-size: 0.7rem;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }

    h1 {
      margin: 0 0 0.5rem 0;
      font-size: 1.6rem;
      font-weight: 700;
    }

    .subtitle {
      margin: 0;
      color: #94a3b8;
      font-size: 0.9rem;
      line-height: 1.4;
      max-width: 900px;
    }

    .search-bar-card {
      background: #ffffff;
      padding: 1.25rem;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
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
      font-weight: 600;
      color: #475569;
    }

    .input-group input {
      padding: 0.6rem 0.75rem;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 0.85rem;
      outline: none;
      transition: border-color 0.2s;
    }

    .input-group input:focus {
      border-color: #0284c7;
    }

    .btn-primary {
      background: #0284c7;
      color: #fff;
      border: none;
      padding: 0.65rem 1.25rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      height: 38px;
    }

    .btn-primary:hover {
      background: #0369a1;
    }

    .btn-secondary {
      background: #f1f5f9;
      color: #334155;
      border: 1px solid #cbd5e1;
      padding: 0.45rem 0.85rem;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
    }

    .results-card {
      background: #ffffff;
      padding: 1.5rem;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
    }

    .results-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid #f1f5f9;
    }

    .results-header h3 {
      margin: 0 0 0.25rem 0;
      font-size: 1.1rem;
      color: #0f172a;
    }

    .highlight {
      color: #0284c7;
    }

    .meta-note {
      font-size: 0.8rem;
      color: #64748b;
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

    .matches-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
      gap: 1rem;
    }

    .match-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 1rem;
      border-left: 4px solid #0284c7;
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
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0.2rem 0.45rem;
      border-radius: 4px;
      background: #e2e8f0;
      color: #475569;
      display: inline-block;
      margin-bottom: 0.25rem;
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
      color: #0f172a;
    }

    .regime-tag {
      font-size: 0.7rem;
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
      font-size: 0.8rem;
      margin-bottom: 0.75rem;
    }

    .detail-row {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .detail-row .label {
      color: #64748b;
      font-weight: 500;
    }

    .detail-row .val {
      font-weight: 600;
      color: #1e293b;
    }

    .detail-row .val.explanation {
      text-align: right;
      font-weight: normal;
      font-size: 0.75rem;
      color: #475569;
      max-width: 260px;
    }

    .active-danger {
      color: #dc2626 !important;
      font-weight: 700 !important;
    }

    .recommended-box {
      background: #ffffff;
      padding: 0.6rem;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      font-size: 0.75rem;
      color: #334155;
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
      color: #0f172a;
    }

    .alerts-table-card {
      background: #ffffff;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      overflow-x: auto;
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
      text-align: left;
    }

    .data-table th {
      background: #f8fafc;
      padding: 0.75rem 1rem;
      font-weight: 600;
      color: #475569;
      border-bottom: 1px solid #e2e8f0;
    }

    .data-table td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
    }

    .mono-id {
      font-family: monospace;
      font-size: 0.75rem;
      color: #64748b;
    }

    .role-badge {
      background: #f1f5f9;
      color: #475569;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-size: 0.7rem;
    }

    .source-tag {
      font-weight: 600;
      color: #0284c7;
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
      color: #94a3b8;
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
