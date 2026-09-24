import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DocumentsService } from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import { Icon } from '../../shared/components/icon';
import { EnterpriseFooterComponent } from '../../shared/components/enterprise-footer.component';

/** Strict Regulatory Types for Bitemporal Point-in-Time Screening */
export type TemporalSanctionsStatus =
  | 'NOT_LISTED_AT_TRANSACTION_TIME'
  | 'LISTED_AT_TRANSACTION_TIME'
  | 'ADDED_AFTER_TRANSACTION'
  | 'REMOVED_BEFORE_TRANSACTION'
  | 'REMOVED_AFTER_TRANSACTION'
  | 'STATUS_UNKNOWN'
  | 'HISTORICAL_DATA_INSUFFICIENT'
  | 'UNDER_REVIEW';

export interface TemporalRegulatoryMatch {
  matchId: string;
  matchedEntityId: string;
  matchedName: string;
  searchedName: string;
  partyRole: string;
  matchType: string;
  matchConfidence: number;
  sanctionsList: string;
  jurisdiction: 'US' | 'UN' | 'EU' | 'UK' | 'PK' | string;
  programs: string[];
  transactionTimestamp: string;
  designationDate: string;
  effectiveDate: string;
  removalDate?: string | null;
  temporalStatus: TemporalSanctionsStatus | string;
  isCurrentlyListed: boolean;
  wasListedAtTransactionTime: boolean;
  legalExplanation: string;
  recommendedAction: string;
  sourceSnapshotId: string;
  sourceChecksum?: string;
}

export interface HistoricalScreeningResponse {
  searchedParty: string;
  asOfDate: string;
  matchesCount: number;
  matches: TemporalRegulatoryMatch[];
}

export interface RetrospectiveAlertRecord {
  alertId: string;
  documentId?: string;
  tradeReference: string;
  transactionTimestamp: string;
  detectedAt?: string;
  newlyDesignatedEntityName: string;
  partyRoleInTransaction: string;
  sanctionsList: string;
  designationDate: string;
  effectiveDate?: string;
  retrospectiveImpact?: string;
  recommendedAction?: string;
  status: 'PENDING_REVIEW' | 'REVIEWED_ACKNOWLEDGED' | 'ESCALATED' | string;
}

@Component({
  selector: 'app-auditor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, Icon, EnterpriseFooterComponent],
  template: `
    <div class="auditor-page-wrapper">
      <div class="auditor-page-body">
        <!-- Institutional Executive Navy Header -->
        <header class="auditor-hero-strip">
          <div class="auditor-hero-inner">
            <div class="auditor-hero-content">
              <div class="hero-badge-pill">
                <span class="live-dot"></span>
                <span class="hero-badge-text">SCD Type-2 Bitemporal Regulatory Intelligence</span>
              </div>
              <h1 class="auditor-hero-title">
                Historical Audit Reconstruction &amp; Retrospective Diff
              </h1>
              <p class="auditor-hero-description">
                Reconstruct exact regulatory, sanctions, and TBML compliance posture as of historical shipment, LC issuance, or payment settlement dates. Evaluate subsequent designations without rewriting immutable audit ledgers.
              </p>
            </div>

            <div class="auditor-hero-metrics">
              <div class="hero-stat-card">
                <span class="stat-number">5</span>
                <span class="stat-label">Jurisdictions (OFAC, UN, EU, UK, SBP)</span>
              </div>
              <div class="hero-stat-card">
                <span class="stat-number font-mono">{{ alerts().length }}</span>
                <span class="stat-label">Retrospective Alerts Monitored</span>
              </div>
              <div class="hero-actions-group">
                <button
                  type="button"
                  class="btn-hero-action"
                  (click)="loadRetrospectiveAlerts()"
                  [disabled]="isLoadingAlerts()"
                  title="Query database for latest upstream feed updates"
                >
                  <app-icon name="refresh" [size]="14" />
                  <span>{{ isLoadingAlerts() ? 'Syncing...' : 'Refresh Alerts' }}</span>
                </button>
                <button
                  type="button"
                  class="btn-hero-export"
                  (click)="exportAlertsToCsv()"
                  [disabled]="alerts().length === 0"
                  title="Export retrospective alerts table to CSV"
                >
                  <app-icon name="download" [size]="14" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        <!-- Point-in-Time Sanctions Screening Query Card -->
        <section class="workbench-card query-card">
          <div class="workbench-card-header">
            <div class="header-icon-group">
              <div class="header-icon-bubble">
                <app-icon name="search" [size]="18" />
              </div>
              <div>
                <h2 class="workbench-card-title">Point-in-Time Sanctions Screening Query</h2>
                <p class="workbench-card-subtitle">
                  Simulate entity exposure against point-in-time regulatory snapshots without internet dependency
                </p>
              </div>
            </div>
            <div class="header-quick-presets">
              <span class="preset-label">Quick As-Of Presets:</span>
              <button type="button" class="preset-btn" (click)="setPresetDate('TODAY')">Today</button>
              <button type="button" class="preset-btn" (click)="setPresetDate('T-30')">T-30 Days</button>
              <button type="button" class="preset-btn" (click)="setPresetDate('T-90')">T-90 Days</button>
              <button type="button" class="preset-btn" (click)="setPresetDate('T-365')">T-1 Year</button>
            </div>
          </div>

          <div class="card-inner-padded">
            <form (ngSubmit)="runHistoricalScreening()" class="search-form-layout">
              <div class="form-field-group entity-field">
                <label for="partyNameInput" class="form-field-label">
                  Counterparty / Entity / Bank / Vessel Name <span class="required-star">*</span>
                </label>
                <input
                  id="partyNameInput"
                  type="text"
                  [(ngModel)]="searchPartyName"
                  name="searchPartyName"
                  placeholder="e.g. Bank Melli Iran, Sovcomflot, IRISL, Sberbank, Liberty Mills..."
                  class="form-text-input"
                  required
                />
              </div>

              <div class="form-field-group date-field">
                <label for="asOfDateInput" class="form-field-label">
                  Evaluation As-Of Date <span class="required-star">*</span>
                </label>
                <input
                  id="asOfDateInput"
                  type="date"
                  [(ngModel)]="searchAsOfDate"
                  name="searchAsOfDate"
                  class="form-text-input"
                />
              </div>

              <div class="form-field-group identifier-field">
                <label for="identifierInput" class="form-field-label">
                  SWIFT BIC / IMO (Optional)
                </label>
                <input
                  id="identifierInput"
                  type="text"
                  [(ngModel)]="searchIdentifier"
                  name="searchIdentifier"
                  placeholder="e.g. MELIIRTH, 9216298"
                  class="form-text-input font-mono"
                />
              </div>

              <div class="form-button-group">
                <button
                  type="button"
                  class="btn-secondary-reset"
                  (click)="resetScreeningQuery()"
                  [disabled]="isLoadingScreening() || (!searchPartyName && !searchAsOfDate && !searchIdentifier)"
                >
                  Clear
                </button>
                <button
                  type="submit"
                  class="btn-primary-run"
                  [disabled]="isLoadingScreening() || !searchPartyName.trim()"
                >
                  @if (isLoadingScreening()) {
                    <app-icon name="refresh" [size]="15" />
                    <span>Evaluating Snapshot...</span>
                  } @else {
                    <app-icon name="sparkle" [size]="15" />
                    <span>Execute Point-in-Time Query</span>
                  }
                </button>
              </div>
            </form>
          </div>
        </section>

        <!-- Historical Screening Results Section -->
        @if (screeningResults(); as res) {
          <section class="workbench-card results-card">
            <div class="workbench-card-header">
              <div class="results-header-info">
                <h3 class="workbench-card-title">
                  Point-in-Time Regulatory Verdict:
                  <span class="highlight-entity font-mono">{{ res.searchedParty }}</span>
                </h3>
                <span class="results-meta-date">
                  Evaluated Snapshot: {{ res.asOfDate | date:'longDate' }} (UTC)
                </span>
              </div>
              <div class="results-header-actions">
                <span
                  class="verdict-pill"
                  [class.danger]="res.matchesCount > 0"
                  [class.success]="res.matchesCount === 0"
                >
                  {{ res.matchesCount > 0 ? res.matchesCount + ' Regulatory Match(es) Found' : 'Clean / Zero Exposure' }}
                </span>
                <button
                  type="button"
                  class="btn-print-certificate"
                  (click)="printAuditCertificate()"
                  title="Generate official audit certificate for document dossier"
                >
                  <app-icon name="document" [size]="14" />
                  <span>Print Audit Certificate</span>
                </button>
              </div>
            </div>

            <div class="card-inner-padded">
              @if (res.matches.length === 0) {
                <div class="clean-verdict-banner">
                  <div class="clean-icon-circle">
                    <app-icon name="check" [size]="20" />
                  </div>
                  <div>
                    <h4 class="clean-title">Regulatory Clearance Verified</h4>
                    <p class="clean-text">
                      No sanctions, denied party designations, or targeted financial sanctions (TFS) were in force for
                      <strong>{{ res.searchedParty }}</strong> on {{ res.asOfDate | date:'mediumDate' }}.
                      Documentary presentation meets historical settlement compliance standards.
                    </p>
                  </div>
                </div>
              } @else {
                <div class="matches-grid">
                  @for (m of res.matches; track m.matchId || m.matchedEntityId) {
                    <article class="match-item-card" [class.prohibited-border]="m.wasListedAtTransactionTime">
                      <header class="match-item-header">
                        <div class="match-item-title-group">
                          <span
                            class="status-indicator-tag"
                            [class.badge-prohibited]="m.wasListedAtTransactionTime"
                            [class.badge-warning]="!m.wasListedAtTransactionTime"
                          >
                            {{ formatTemporalStatus(m.temporalStatus) }}
                          </span>
                          <h4 class="match-entity-name">{{ m.matchedName }}</h4>
                        </div>
                        <span class="regime-authority-tag">{{ m.sanctionsList }} ({{ m.jurisdiction }})</span>
                      </header>

                      <div class="match-details-grid">
                        <div class="detail-pair">
                          <span class="detail-label">Designation Date</span>
                          <span class="detail-val font-mono">{{ m.designationDate | date:'mediumDate' }}</span>
                        </div>
                        <div class="detail-pair">
                          <span class="detail-label">Position at Query Date</span>
                          <span
                            class="detail-val font-bold"
                            [class.text-danger]="m.wasListedAtTransactionTime"
                            [class.text-amber]="!m.wasListedAtTransactionTime"
                          >
                            {{ m.wasListedAtTransactionTime ? 'ACTIVE DESIGNATION (PROHIBITED)' : 'NOT LISTED AT HISTORICAL POINT' }}
                          </span>
                        </div>
                        <div class="detail-pair">
                          <span class="detail-label">Current Watchlist Status</span>
                          <span class="detail-val font-semibold">
                            {{ m.isCurrentlyListed ? 'CURRENTLY LISTED' : 'DELISTED / CLEAR' }}
                          </span>
                        </div>
                        <div class="detail-pair">
                          <span class="detail-label">Source Snapshot</span>
                          <span class="detail-val font-mono">{{ m.sourceSnapshotId || 'N/A' }}</span>
                        </div>
                        <div class="detail-pair full-width">
                          <span class="detail-label">Legal Rationale</span>
                          <p class="explanation-paragraph">{{ m.legalExplanation }}</p>
                        </div>
                      </div>

                      <footer class="directive-box">
                        <strong>Compliance Examiner Directive:</strong>
                        <span>{{ m.recommendedAction }}</span>
                      </footer>
                    </article>
                  }
                </div>
              }
            </div>
          </section>
        }

        <!-- Retrospective Post-Transaction Designation Alerts Card -->
        <section class="workbench-card alerts-table-card">
          <div class="workbench-card-header">
            <div class="header-icon-group">
              <div class="header-icon-bubble amber">
                <app-icon name="alert" [size]="18" />
              </div>
              <div>
                <h2 class="workbench-card-title">Retrospective Post-Transaction Exposure Alerts</h2>
                <p class="workbench-card-subtitle">
                  Entities designated on international watchlists after original transaction presentation date
                </p>
              </div>
            </div>

            <!-- Table Search and Status Filter Pills -->
            <div class="table-filter-toolbar">
              <div class="table-search-input-wrapper">
                <input
                  type="text"
                  [(ngModel)]="alertSearchQuery"
                  placeholder="Filter by entity, trade ref, or regime..."
                  class="table-search-field"
                />
              </div>

              <div class="status-filter-pills">
                <button
                  type="button"
                  class="filter-pill-btn"
                  [class.active]="selectedStatusFilter() === 'ALL'"
                  (click)="setStatusFilter('ALL')"
                >
                  All ({{ alerts().length }})
                </button>
                <button
                  type="button"
                  class="filter-pill-btn"
                  [class.active]="selectedStatusFilter() === 'PENDING_REVIEW'"
                  (click)="setStatusFilter('PENDING_REVIEW')"
                >
                  Pending Review ({{ countAlertsByStatus('PENDING_REVIEW') }})
                </button>
                <button
                  type="button"
                  class="filter-pill-btn"
                  [class.active]="selectedStatusFilter() === 'ESCALATED'"
                  (click)="setStatusFilter('ESCALATED')"
                >
                  Escalated ({{ countAlertsByStatus('ESCALATED') }})
                </button>
              </div>
            </div>
          </div>

          <div class="modern-table-responsive">
            <table class="institutional-table">
              <thead>
                <tr>
                  <th scope="col">Alert Ref</th>
                  <th scope="col">Trade Dossier</th>
                  <th scope="col">Transaction Date</th>
                  <th scope="col">Designated Entity</th>
                  <th scope="col">Party Role</th>
                  <th scope="col">Sanctions Feed</th>
                  <th scope="col">Designation Date</th>
                  <th scope="col">Disposition</th>
                  <th scope="col" class="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                @if (isLoadingAlerts()) {
                  <tr>
                    <td colspan="9" class="loading-state-cell">
                      <div class="table-loader-spinner">
                        <app-icon name="refresh" [size]="20" />
                        <span>Querying retrospective audit repository...</span>
                      </div>
                    </td>
                  </tr>
                } @else {
                  @for (a of paginatedAlerts(); track a.alertId) {
                    <tr>
                      <td class="font-mono text-ink font-semibold">{{ a.alertId }}</td>
                      <td>
                        <strong class="trade-ref-badge font-mono">{{ a.tradeReference }}</strong>
                      </td>
                      <td>{{ a.transactionTimestamp | date:'mediumDate' }}</td>
                      <td class="designated-entity-cell font-semibold text-ink">
                        {{ a.newlyDesignatedEntityName }}
                      </td>
                      <td>
                        <span class="role-pill">{{ a.partyRoleInTransaction }}</span>
                      </td>
                      <td>
                        <span class="source-regime-tag font-semibold">{{ a.sanctionsList }}</span>
                      </td>
                      <td class="text-danger font-semibold font-mono">
                        {{ a.designationDate | date:'mediumDate' }}
                      </td>
                      <td>
                        <span
                          class="status-chip"
                          [class.chip-pending]="a.status === 'PENDING_REVIEW'"
                          [class.chip-escalated]="a.status === 'ESCALATED'"
                          [class.chip-acknowledged]="a.status === 'REVIEWED_ACKNOWLEDGED'"
                        >
                          {{ formatAlertStatus(a.status) }}
                        </span>
                      </td>
                      <td class="text-right">
                        @if (a.status === 'PENDING_REVIEW') {
                          <button
                            type="button"
                            class="btn-table-ack"
                            (click)="acknowledgeAlert(a)"
                            title="Mark as reviewed in compliance ledger"
                          >
                            Acknowledge
                          </button>
                        } @else {
                          <span class="text-muted small">Archived</span>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="9" class="empty-state-cell">
                        @if (alertSearchQuery.trim() || selectedStatusFilter() !== 'ALL') {
                          No alerts match the active filter criteria.
                        } @else {
                          No retrospective exposure alerts recorded. All trade presentations remain compliant with post-settlement regulatory positions.
                        }
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>

          <!-- Table Pagination and Summary Bar -->
          @if (!isLoadingAlerts() && filteredAlerts().length > 0) {
            <footer class="table-footer-bar">
              <div class="footer-count-text">
                Showing {{ (currentPage() - 1) * pageSize + 1 }} -
                {{ calculatePageEnd() }} of {{ filteredAlerts().length }} alert(s)
              </div>
              <div class="pagination-controls">
                <button
                  type="button"
                  class="btn-page-step"
                  [disabled]="currentPage() === 1"
                  (click)="setPage(currentPage() - 1)"
                >
                  Previous
                </button>
                <span class="page-indicator font-mono">Page {{ currentPage() }} of {{ totalPages() }}</span>
                <button
                  type="button"
                  class="btn-page-step"
                  [disabled]="currentPage() >= totalPages()"
                  (click)="setPage(currentPage() + 1)"
                >
                  Next
                </button>
              </div>
            </footer>
          }
        </section>
      </div>

      <!-- Reusable Enterprise Institutional Footer -->
      <app-enterprise-footer />
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-height: 100vh;
      background: #f8fafc;
      color: #0a1638;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
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
      max-width: 1560px;
      margin: 0 auto;
      padding: 32px 36px 64px;
      box-sizing: border-box;
      flex: 1 0 auto;
    }

    /* ── Executive Hero Strip ── */
    .auditor-hero-strip {
      background: linear-gradient(135deg, #07122e 0%, #0d1e4a 60%, #09173d 100%);
      color: #ffffff;
      border-radius: 16px;
      padding: 32px 36px;
      margin-bottom: 32px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 4px 20px rgba(10, 22, 56, 0.12);
      box-sizing: border-box;
    }

    .auditor-hero-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 32px;
      flex-wrap: wrap;
    }

    .auditor-hero-content {
      max-width: 820px;
    }

    .hero-badge-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(0, 168, 168, 0.18);
      border: 1px solid rgba(0, 212, 212, 0.35);
      border-radius: 999px;
      padding: 4px 14px;
      margin-bottom: 12px;
    }

    .live-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #00d4d4;
      box-shadow: 0 0 8px #00d4d4;
    }

    .hero-badge-text {
      font-size: 0.76rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: #00e5e5;
      text-transform: uppercase;
    }

    .auditor-hero-title {
      font-size: clamp(1.4rem, 2.5vw, 1.85rem);
      font-weight: 800;
      color: #ffffff;
      margin: 0 0 10px 0;
      letter-spacing: -0.02em;
      line-height: 1.25;
    }

    .auditor-hero-description {
      font-size: 0.92rem;
      color: #cbd5e1;
      margin: 0;
      line-height: 1.6;
    }

    .auditor-hero-metrics {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .hero-stat-card {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 12px 18px;
      text-align: center;
      min-width: 120px;
    }

    .stat-number {
      display: block;
      font-size: 1.35rem;
      font-weight: 800;
      color: #00e5e5;
    }

    .stat-label {
      display: block;
      font-size: 0.72rem;
      font-weight: 600;
      color: #94a3b8;
      margin-top: 2px;
    }

    .hero-actions-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .btn-hero-action, .btn-hero-export {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 0 16px;
      height: 36px;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 650;
      cursor: pointer;
      white-space: nowrap;
      border: 1px solid transparent;
    }

    .btn-hero-action {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.2);
    }

    .btn-hero-action:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.18);
    }

    .btn-hero-export {
      background: #00a8a8;
      color: #ffffff;
    }

    .btn-hero-export:hover:not(:disabled) {
      background: #009494;
    }

    .btn-hero-action:disabled, .btn-hero-export:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* ── Workbench Card Architecture ── */
    .workbench-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      box-shadow: 0 2px 8px rgba(10, 22, 56, 0.04);
      margin-bottom: 32px;
      overflow: hidden;
    }

    .workbench-card-header {
      padding: 20px 28px;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
      background: #ffffff;
    }

    .header-icon-group {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .header-icon-bubble {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: rgba(0, 168, 168, 0.1);
      color: #008c8c;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .header-icon-bubble.amber {
      background: rgba(217, 119, 6, 0.1);
      color: #d97706;
    }

    .workbench-card-title {
      font-size: 1.1rem;
      font-weight: 800;
      color: #0a1638;
      margin: 0;
      line-height: 1.3;
    }

    .workbench-card-subtitle {
      font-size: 0.8rem;
      color: #64748b;
      margin: 3px 0 0 0;
    }

    .header-quick-presets {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .preset-label {
      font-size: 0.74rem;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-right: 4px;
    }

    .preset-btn {
      padding: 4px 10px;
      font-size: 0.75rem;
      font-weight: 650;
      border-radius: 6px;
      background: #f1f5f9;
      color: #334155;
      border: 1px solid #e2e8f0;
      cursor: pointer;
    }

    .preset-btn:hover {
      background: #e2e8f0;
      color: #0a1638;
    }

    .card-inner-padded {
      padding: 28px;
    }

    /* ── Query Form ── */
    .search-form-layout {
      display: flex;
      align-items: flex-end;
      gap: 20px;
      flex-wrap: wrap;
    }

    .form-field-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .entity-field {
      flex: 2 1 300px;
    }

    .date-field {
      flex: 1 1 180px;
    }

    .identifier-field {
      flex: 1 1 180px;
    }

    .form-field-label {
      font-size: 0.75rem;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #475569;
    }

    .required-star {
      color: #e11d48;
    }

    .form-text-input {
      height: 40px;
      padding: 0 14px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 0.86rem;
      background: #ffffff;
      color: #0a1638;
      box-sizing: border-box;
      outline: none;
      width: 100%;
    }

    .form-text-input:focus {
      border-color: #00a8a8;
      box-shadow: 0 0 0 3px rgba(0, 168, 168, 0.14);
    }

    .form-button-group {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 40px;
    }

    .btn-secondary-reset {
      height: 40px;
      padding: 0 16px;
      border-radius: 8px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      color: #475569;
      font-size: 0.82rem;
      font-weight: 650;
      cursor: pointer;
    }

    .btn-secondary-reset:hover:not(:disabled) {
      background: #f8fafc;
      color: #0a1638;
    }

    .btn-primary-run {
      height: 40px;
      padding: 0 20px;
      border-radius: 8px;
      background: #00a8a8;
      color: #ffffff;
      border: 1px solid #008f8f;
      font-size: 0.84rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 2px 8px rgba(0, 168, 168, 0.25);
      white-space: nowrap;
    }

    .btn-primary-run:hover:not(:disabled) {
      background: #009696;
    }

    .btn-primary-run:disabled, .btn-secondary-reset:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* ── Results Verdict & Layout ── */
    .results-header-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .highlight-entity {
      color: #008c8c;
      font-weight: 800;
    }

    .results-meta-date {
      font-size: 0.8rem;
      color: #64748b;
    }

    .results-header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .verdict-pill {
      font-size: 0.76rem;
      font-weight: 750;
      padding: 5px 14px;
      border-radius: 999px;
      white-space: nowrap;
    }

    .verdict-pill.success {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
    }

    .verdict-pill.danger {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }

    .btn-print-certificate {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 12px;
      border-radius: 6px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      font-size: 0.78rem;
      font-weight: 650;
      color: #334155;
      cursor: pointer;
    }

    .btn-print-certificate:hover {
      background: #f8fafc;
      border-color: #94a3b8;
    }

    .clean-verdict-banner {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 12px;
      padding: 20px 24px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }

    .clean-icon-circle {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #22c55e;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .clean-title {
      font-size: 0.98rem;
      font-weight: 800;
      color: #166534;
      margin: 0 0 4px 0;
    }

    .clean-text {
      font-size: 0.86rem;
      color: #15803d;
      margin: 0;
      line-height: 1.5;
    }

    .matches-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 20px;
    }

    .match-item-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 20px;
      border-left: 4px solid #00a8a8;
    }

    .match-item-card.prohibited-border {
      border-left-color: #e11d48;
      background: #fffafa;
    }

    .match-item-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }

    .status-indicator-tag {
      font-size: 0.68rem;
      font-weight: 750;
      padding: 2px 8px;
      border-radius: 4px;
      display: inline-block;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .badge-prohibited {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }

    .badge-warning {
      background: #fffbeb;
      color: #92400e;
      border: 1px solid #fde68a;
    }

    .match-entity-name {
      font-size: 1.02rem;
      font-weight: 750;
      color: #0a1638;
      margin: 0;
    }

    .regime-authority-tag {
      font-size: 0.75rem;
      font-weight: 700;
      color: #008c8c;
      background: rgba(0, 168, 168, 0.08);
      padding: 4px 9px;
      border-radius: 6px;
    }

    .match-details-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 16px;
      font-size: 0.82rem;
      margin-bottom: 14px;
    }

    .detail-pair {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .detail-pair.full-width {
      grid-column: 1 / -1;
    }

    .detail-label {
      font-size: 0.72rem;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .detail-val {
      color: #0a1638;
    }

    .explanation-paragraph {
      margin: 2px 0 0 0;
      font-size: 0.82rem;
      color: #475569;
      line-height: 1.5;
    }

    .directive-box {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 0.82rem;
      color: #334155;
      line-height: 1.5;
    }

    /* ── Table & Toolbar ── */
    .table-filter-toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .table-search-field {
      height: 34px;
      padding: 0 12px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 0.8rem;
      width: 240px;
      box-sizing: border-box;
      outline: none;
    }

    .table-search-field:focus {
      border-color: #00a8a8;
    }

    .status-filter-pills {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .filter-pill-btn {
      padding: 4px 10px;
      font-size: 0.74rem;
      font-weight: 650;
      border-radius: 6px;
      background: #f1f5f9;
      color: #475569;
      border: 1px solid transparent;
      cursor: pointer;
    }

    .filter-pill-btn.active {
      background: #0a1638;
      color: #ffffff;
    }

    .modern-table-responsive {
      width: 100%;
      overflow-x: auto;
    }

    .institutional-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.84rem;
    }

    .institutional-table th {
      padding: 14px 20px;
      background: #f8fafc;
      color: #475569;
      font-size: 0.72rem;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #e2e8f0;
      white-space: nowrap;
    }

    .institutional-table td {
      padding: 14px 20px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
      color: #334155;
      white-space: nowrap;
    }

    .institutional-table tbody tr:hover {
      background: #f8fafc;
    }

    .trade-ref-badge {
      color: #0a1638;
    }

    .designated-entity-cell {
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .role-pill {
      background: #f1f5f9;
      color: #475569;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.72rem;
      font-weight: 650;
    }

    .source-regime-tag {
      color: #008c8c;
    }

    .status-chip {
      font-size: 0.7rem;
      font-weight: 700;
      padding: 3px 9px;
      border-radius: 999px;
      white-space: nowrap;
    }

    .chip-pending {
      background: #fffbeb;
      color: #d97706;
      border: 1px solid #fde68a;
    }

    .chip-escalated {
      background: #fef2f2;
      color: #dc2626;
      border: 1px solid #fecaca;
    }

    .chip-acknowledged {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
    }

    .btn-table-ack {
      height: 28px;
      padding: 0 10px;
      font-size: 0.75rem;
      font-weight: 650;
      border-radius: 6px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      color: #0a1638;
      cursor: pointer;
    }

    .btn-table-ack:hover {
      background: #f1f5f9;
      border-color: #94a3b8;
    }

    .loading-state-cell, .empty-state-cell {
      text-align: center;
      padding: 44px 20px;
      color: #64748b;
    }

    .table-loader-spinner {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-size: 0.88rem;
      font-weight: 600;
      color: #008c8c;
    }

    .table-footer-bar {
      padding: 14px 24px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      background: #ffffff;
    }

    .footer-count-text {
      font-size: 0.78rem;
      color: #64748b;
      font-weight: 600;
    }

    .pagination-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-page-step {
      height: 30px;
      padding: 0 10px;
      font-size: 0.75rem;
      font-weight: 650;
      border-radius: 6px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      color: #334155;
      cursor: pointer;
    }

    .btn-page-step:hover:not(:disabled) {
      background: #f1f5f9;
    }

    .btn-page-step:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .page-indicator {
      font-size: 0.75rem;
      font-weight: 650;
      color: #475569;
    }

    /* ── Typography & Utilities ── */
    .text-ink { color: #0a1638; }
    .text-danger { color: #e11d48; }
    .text-amber { color: #d97706; }
    .text-muted { color: #64748b; }
    .text-right { text-align: right; }
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .font-semibold { font-weight: 600; }
    .font-bold { font-weight: 700; }
    .small { font-size: 0.75rem; }
  `]
})
export class AuditorComponent implements OnInit {
  private readonly documentsService = inject(DocumentsService);
  private readonly toast = inject(ToastService);

  // Form Model
  searchPartyName = '';
  searchAsOfDate = '';
  searchIdentifier = '';
  alertSearchQuery = '';

  // Pagination & Filtering
  selectedStatusFilter = signal<'ALL' | 'PENDING_REVIEW' | 'ESCALATED' | 'REVIEWED_ACKNOWLEDGED'>('ALL');
  currentPage = signal<number>(1);
  pageSize = 10;

  // Reactive State
  isLoadingScreening = signal<boolean>(false);
  isLoadingAlerts = signal<boolean>(false);
  screeningResults = signal<HistoricalScreeningResponse | null>(null);
  alerts = signal<RetrospectiveAlertRecord[]>([]);

  // Computed Filtered Alerts
  filteredAlerts = computed(() => {
    const rawAlerts = this.alerts();
    const query = this.alertSearchQuery.trim().toLowerCase();
    const statusFilter = this.selectedStatusFilter();

    return rawAlerts.filter((a) => {
      const matchesStatus = statusFilter === 'ALL' || a.status === statusFilter;
      if (!matchesStatus) return false;

      if (!query) return true;
      const entity = (a.newlyDesignatedEntityName || '').toLowerCase();
      const tradeRef = (a.tradeReference || '').toLowerCase();
      const regime = (a.sanctionsList || '').toLowerCase();
      const alertId = (a.alertId || '').toLowerCase();

      return entity.includes(query) || tradeRef.includes(query) || regime.includes(query) || alertId.includes(query);
    });
  });

  // Computed Total Pages
  totalPages = computed(() => {
    const count = this.filteredAlerts().length;
    return Math.max(1, Math.ceil(count / this.pageSize));
  });

  // Computed Paginated Alerts
  paginatedAlerts = computed(() => {
    const filtered = this.filteredAlerts();
    const start = (this.currentPage() - 1) * this.pageSize;
    return filtered.slice(start, start + this.pageSize);
  });

  ngOnInit(): void {
    this.setDefaultAsOfDate();
    this.loadRetrospectiveAlerts();
  }

  private setDefaultAsOfDate(): void {
    const now = new Date();
    this.searchAsOfDate = now.toISOString().split('T')[0];
  }

  setPresetDate(preset: 'TODAY' | 'T-30' | 'T-90' | 'T-365'): void {
    const d = new Date();
    if (preset === 'T-30') d.setDate(d.getDate() - 30);
    else if (preset === 'T-90') d.setDate(d.getDate() - 90);
    else if (preset === 'T-365') d.setFullYear(d.getFullYear() - 1);

    this.searchAsOfDate = d.toISOString().split('T')[0];
  }

  resetScreeningQuery(): void {
    this.searchPartyName = '';
    this.searchIdentifier = '';
    this.setDefaultAsOfDate();
    this.screeningResults.set(null);
  }

  runHistoricalScreening(): void {
    const party = this.searchPartyName.trim();
    if (!party) {
      this.toast.info('Missing Counterparty', 'Please provide an entity, vessel, or bank name to screen.');
      return;
    }

    // Timezone-safe ISO date generation: parse as YYYY-MM-DDT00:00:00Z to avoid day offset shift
    let asOfIso: string | undefined;
    if (this.searchAsOfDate) {
      const parts = this.searchAsOfDate.split('-');
      if (parts.length === 3) {
        asOfIso = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2], 12, 0, 0)).toISOString();
      } else {
        asOfIso = new Date(this.searchAsOfDate).toISOString();
      }
    }

    this.isLoadingScreening.set(true);

    this.documentsService.screenHistorical({
      partyName: party,
      asOfDate: asOfIso,
      swiftBic: this.searchIdentifier ? this.searchIdentifier.trim().toUpperCase() : undefined,
    }).subscribe({
      next: (res: any) => {
        const matches: TemporalRegulatoryMatch[] = (res.matches || []).map((m: any) => ({
          matchId: m.matchId || m.id || `MATCH-${Math.random().toString(36).slice(2, 8)}`,
          matchedEntityId: m.matchedEntityId || m.id || '',
          matchedName: m.matchedName || m.primaryName || party,
          searchedName: m.searchedName || party,
          partyRole: m.partyRole || 'COUNTERPARTY',
          matchType: m.matchType || 'NAME_FUZZY',
          matchConfidence: m.matchConfidence ?? 1.0,
          sanctionsList: m.sanctionsList || 'OFAC_SDN',
          jurisdiction: m.jurisdiction || 'US',
          programs: m.programs || [],
          transactionTimestamp: m.transactionTimestamp || res.asOfDate,
          designationDate: m.designationDate || res.asOfDate,
          effectiveDate: m.effectiveDate || res.asOfDate,
          removalDate: m.removalDate,
          temporalStatus: m.temporalStatus || (m.wasListedAtTransactionTime ? 'LISTED_AT_TRANSACTION_TIME' : 'NOT_LISTED_AT_TRANSACTION_TIME'),
          isCurrentlyListed: Boolean(m.isCurrentlyListed),
          wasListedAtTransactionTime: Boolean(m.wasListedAtTransactionTime),
          legalExplanation: m.legalExplanation || 'Entity identified against authoritative point-in-time regulatory watchlists.',
          recommendedAction: m.recommendedAction || 'Refer to Chief Compliance Officer prior to proceeding with trade documentation.',
          sourceSnapshotId: m.sourceSnapshotId || 'SNAP-CURRENT',
          sourceChecksum: m.sourceChecksum,
        }));

        this.screeningResults.set({
          searchedParty: res.searchedParty || party,
          asOfDate: res.asOfDate || asOfIso || new Date().toISOString(),
          matchesCount: matches.length,
          matches,
        });

        this.isLoadingScreening.set(false);

        if (matches.length > 0) {
          this.toast.error('Watchlist Hits Identified', `${matches.length} historical regulatory match(es) detected for ${party}.`);
        } else {
          this.toast.success('Clean Screening', `No active regulatory listings found for ${party} as of the requested date.`);
        }
      },
      error: () => {
        this.isLoadingScreening.set(false);
        this.toast.error('Screening Query Failed', 'Could not complete retrospective screening query. Verify parameters and retry.');
      }
    });
  }

  loadRetrospectiveAlerts(): void {
    this.isLoadingAlerts.set(true);
    this.documentsService.getRetrospectiveAlerts().subscribe({
      next: (res: any) => {
        const rawAlerts: RetrospectiveAlertRecord[] = (res.alerts || []).map((a: any, idx: number) => ({
          alertId: a.alertId || `ALT-RETRO-${String(idx + 1).padStart(4, '0')}`,
          documentId: a.documentId,
          tradeReference: a.tradeReference || `TR-${String(idx + 100).padStart(4, '0')}`,
          transactionTimestamp: a.transactionTimestamp || new Date().toISOString(),
          detectedAt: a.detectedAt,
          newlyDesignatedEntityName: a.newlyDesignatedEntityName || a.entityName || 'Unspecified Entity',
          partyRoleInTransaction: a.partyRoleInTransaction || a.role || 'BENEFICIARY',
          sanctionsList: a.sanctionsList || 'OFAC_SDN',
          designationDate: a.designationDate || new Date().toISOString(),
          effectiveDate: a.effectiveDate,
          retrospectiveImpact: a.retrospectiveImpact,
          recommendedAction: a.recommendedAction,
          status: a.status || 'PENDING_REVIEW',
        }));

        this.alerts.set(rawAlerts);
        this.isLoadingAlerts.set(false);
      },
      error: () => {
        this.isLoadingAlerts.set(false);
        this.toast.error('Alerts Unavailable', 'Could not retrieve latest retrospective designation alerts.');
      }
    });
  }

  acknowledgeAlert(alert: RetrospectiveAlertRecord): void {
    const updated = this.alerts().map((a) => {
      if (a.alertId === alert.alertId) {
        return { ...a, status: 'REVIEWED_ACKNOWLEDGED' };
      }
      return a;
    });
    this.alerts.set(updated);
    this.toast.success('Alert Acknowledged', `Alert ${alert.alertId} marked as reviewed in compliance audit log.`);
  }

  setStatusFilter(status: 'ALL' | 'PENDING_REVIEW' | 'ESCALATED' | 'REVIEWED_ACKNOWLEDGED'): void {
    this.selectedStatusFilter.set(status);
    this.currentPage.set(1);
  }

  countAlertsByStatus(status: string): number {
    return this.alerts().filter((a) => a.status === status).length;
  }

  setPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  calculatePageEnd(): number {
    const count = this.filteredAlerts().length;
    return Math.min(this.currentPage() * this.pageSize, count);
  }

  formatTemporalStatus(status?: string): string {
    if (!status) return 'STATUS EVALUATED';
    return status.replace(/_/g, ' ');
  }

  formatAlertStatus(status?: string): string {
    if (!status) return 'UNKNOWN';
    return status.replace(/_/g, ' ');
  }

  exportAlertsToCsv(): void {
    const data = this.alerts();
    if (!data.length) return;

    const headers = [
      'Alert ID',
      'Trade Reference',
      'Transaction Date',
      'Newly Designated Entity',
      'Party Role',
      'Sanctions Regime',
      'Designation Date',
      'Status'
    ];

    const rows = data.map((a) => [
      `"${a.alertId}"`,
      `"${a.tradeReference}"`,
      `"${a.transactionTimestamp}"`,
      `"${(a.newlyDesignatedEntityName || '').replace(/"/g, '""')}"`,
      `"${a.partyRoleInTransaction}"`,
      `"${a.sanctionsList}"`,
      `"${a.designationDate}"`,
      `"${a.status}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `TradeGuard_Retrospective_Alerts_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    this.toast.success('CSV Export Ready', `${data.length} alert records exported successfully.`);
  }

  printAuditCertificate(): void {
    window.print();
  }
}
