import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DocumentsService } from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import type { TradeComparisonResult } from '../../models/api.models';
import { Icon } from '../../shared/components/icon';
import { formatBytes } from '../../shared/format';
import { EnterpriseFooterComponent } from '../../shared/components/enterprise-footer.component';

@Component({
  selector: 'app-comparison',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, EnterpriseFooterComponent],
  template: `
    <div class="comparison-page-wrapper">
      <div class="comparison-page-body">
        <!-- Executive Navy Hero Strip -->
        <section class="workbench-hero-strip">
          <div class="workbench-hero-inner">
            <div class="workbench-hero-left">
              <div class="hero-status-pill">
                <span class="live-pulse-dot"></span>
                <span class="hero-status-text">UCP 600 &amp; ISBP 745 Examination Matrix</span>
              </div>
              <h1 class="workbench-hero-title">
                Trade Reconciliation &amp; Discrepancy Studio
              </h1>
              <p class="workbench-hero-desc">
                Cross-document consistency reconciliation across {{ docIds().length }} trade presentation documents. Automatically extracts description variances, unit-price mismatches, port deviations, and critical sanction conflicts.
              </p>
            </div>

            <div class="workbench-hero-actions">
              <button
                class="btn-hero-primary"
                [disabled]="loading() || exportingPdf() || !result()"
                (click)="downloadPdfReport()"
              >
                @if (exportingPdf()) {
                  <app-icon name="refresh" [size]="14" class="spin" />
                  <span>Exporting PDF...</span>
                } @else {
                  <app-icon name="download" [size]="14" />
                  <span>Export Audit PDF Report</span>
                }
              </button>
              <a routerLink="/dashboard" class="btn-hero-secondary">
                <app-icon name="plus" [size]="14" />
                <span>New Comparison</span>
              </a>
            </div>
          </div>
        </section>

        @if (loading()) {
          <div class="loading-state-card">
            <div class="spin"><app-icon name="refresh" [size]="32" /></div>
            <h3>Reconciling Trade Documents...</h3>
            <p>Cross-referencing parties, values, goods descriptions, dates, and ports under ICC UCP 600 and ISBP 745 rules.</p>
          </div>
        } @else if (error()) {
          <div class="error-state-card">
            <div class="error-icon-circle"><app-icon name="alert" [size]="32" /></div>
            <h3>Reconciliation Could Not Complete</h3>
            <p>{{ error() }}</p>
            <a routerLink="/dashboard" class="btn-hero-primary mt-16">Return to Workbench</a>
          </div>
        } @else if (result(); as res) {
          <!-- Presentation Verdict Banner -->
          <section
            class="verdict-banner-card"
            [class.verdict-compliant]="res.verdict === 'COMPLIANT_PRESENTATION'"
            [class.verdict-discrepant]="res.verdict === 'DISCREPANT_PRESENTATION_REQUIRES_AMENDMENT'"
            [class.verdict-rejected]="res.verdict === 'CRITICAL_REJECTION_OR_FRAUD_SUSPECT'"
          >
            <div class="verdict-content-row">
              <div class="verdict-main-group">
                <div class="verdict-icon-badge">
                  <app-icon [name]="res.verdict === 'COMPLIANT_PRESENTATION' ? 'check' : 'alert'" [size]="24" />
                </div>
                <div>
                  <div class="verdict-eyebrow">Banking Examination Verdict</div>
                  <h2 class="verdict-title">{{ res.verdictTitle }}</h2>
                </div>
              </div>

              <!-- Score Pill -->
              <div class="score-pill">
                <div class="score-pill-label">Consistency Score</div>
                <div class="score-pill-val font-mono">{{ res.overallConsistencyScore }} <span class="score-den">/ 100</span></div>
              </div>
            </div>

            <p class="verdict-summary">{{ res.verdictSummary }}</p>

            <div class="verdict-stats-row">
              <div class="stat-pill stat-match">
                <app-icon name="check" [size]="13" />
                <span>{{ res.verifiedMatchesCount }} Verified Matches</span>
              </div>
              <div class="stat-pill stat-material">
                <app-icon name="alert" [size]="13" />
                <span>{{ res.materialDiscrepanciesCount }} Discrepancies</span>
              </div>
              <div class="stat-pill stat-conflict">
                <app-icon name="close" [size]="13" />
                <span>{{ res.criticalConflictsCount }} Critical Conflicts</span>
              </div>
            </div>
          </section>

          <!-- Document Cards Grid -->
          <section class="docs-compared-section mt-28">
            <div class="section-title-wrap">
              <h2 class="section-heading">Compared Trade Presentation Documents ({{ res.documents.length }})</h2>
              <span class="section-subheading">Active instruments subject to multi-way document consistency checking</span>
            </div>
            <div class="docs-compared-grid">
              @for (d of res.documents; track d.id) {
                <div class="doc-compare-card">
                  <div class="doc-card-badge">
                    <span class="chip-type-tag">{{ d.fileType }}</span>
                    <span class="doc-idx font-mono font-bold">Doc {{ $index + 1 }}</span>
                  </div>
                  <h3 class="doc-card-title truncate" [title]="d.filename">{{ d.filename }}</h3>
                  <div class="doc-card-type">{{ d.documentType }}</div>

                  <div class="doc-card-meta">
                    <div class="meta-row">
                      <span class="meta-lbl">Ref #:</span>
                      <span class="font-mono text-ink font-semibold">{{ d.documentNumber }}</span>
                    </div>
                    <div class="meta-row">
                      <span class="meta-lbl">Stated Value:</span>
                      <span class="font-bold text-ink">{{ d.currency }} {{ d.totalValue.toLocaleString() }}</span>
                    </div>
                    <div class="meta-row">
                      <span class="meta-lbl">Buyer / Applicant:</span>
                      <span class="truncate text-ink font-medium" [title]="d.parties.buyer">{{ d.parties.buyer }}</span>
                    </div>
                  </div>
                </div>
              }
            </div>
          </section>

          <!-- Discrepancy & Reconciliation Matrix Table -->
          <section class="workbench-card mt-28">
            <div class="workbench-card-header">
              <div class="header-title-group">
                <div class="header-icon-circle">
                  <app-icon name="layers" [size]="18" />
                </div>
                <div>
                  <h2 class="workbench-card-heading">Discrepancy &amp; Cross-Document Reconciliation Matrix</h2>
                  <p class="workbench-card-subheading">Detailed field-by-field verification under UCP 600 articles and ISBP 745 international standards</p>
                </div>
              </div>
              <span class="repo-count-badge">{{ res.discrepancies.length }} Reconciled Attributes</span>
            </div>

            <div class="modern-table-container">
              @if (res.discrepancies.length > 0) {
                <table class="modern-trade-table">
                  <thead>
                    <tr>
                      <th style="width: 16%">Field &amp; Category</th>
                      <th style="width: 24%">Document A Reference</th>
                      <th style="width: 24%">Document B Reference</th>
                      <th style="width: 14%">Severity Status</th>
                      <th style="width: 22%">Banking Audit Explanation</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (disc of res.discrepancies; track disc.id) {
                      <tr [class.row-conflict]="disc.severity === 'CRITICAL_CONFLICT'" [class.row-material]="disc.severity === 'MATERIAL_DISCREPANCY'" [class.row-match]="disc.severity === 'VERIFIED_MATCH'">
                        <td>
                          <div class="font-bold text-ink">{{ disc.field }}</div>
                          <span class="category-tag">{{ disc.category }}</span>
                        </td>
                        <td>
                          <div class="doc-origin-name">{{ disc.documentA }}</div>
                          <div class="value-text font-mono font-semibold">{{ disc.valueA }}</div>
                        </td>
                        <td>
                          <div class="doc-origin-name">{{ disc.documentB }}</div>
                          <div class="value-text font-mono font-semibold">{{ disc.valueB }}</div>
                        </td>
                        <td>
                          <span
                            class="severity-badge"
                            [class.sev-conflict]="disc.severity === 'CRITICAL_CONFLICT'"
                            [class.sev-material]="disc.severity === 'MATERIAL_DISCREPANCY'"
                            [class.sev-match]="disc.severity === 'VERIFIED_MATCH'"
                          >
                            {{ disc.severity === 'CRITICAL_CONFLICT' ? 'CRITICAL CONFLICT' : disc.severity === 'MATERIAL_DISCREPANCY' ? 'DISCREPANCY' : 'VERIFIED MATCH' }}
                          </span>
                          @if (disc.ruleReference) {
                            <div class="rule-ref font-mono">{{ disc.ruleReference }}</div>
                          }
                        </td>
                        <td class="explanation-text">{{ disc.explanation }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              } @else {
                <div class="matrix-empty-pad">
                  No discrepancies identified between the compared trade documents.
                </div>
              }
            </div>
          </section>

          <!-- Side-by-Side Comprehensive Field Comparison -->
          <section class="workbench-card mt-28">
            <div class="workbench-card-header">
              <div class="header-title-group">
                <div class="header-icon-circle">
                  <app-icon name="list" [size]="18" />
                </div>
                <div>
                  <h2 class="workbench-card-heading">Side-by-Side Attribute Comparison</h2>
                  <p class="workbench-card-subheading">Harmonized multi-document parameter alignment across all presented trade instruments</p>
                </div>
              </div>
            </div>

            <div class="modern-table-container">
              <table class="modern-trade-table side-by-side-table">
                <thead>
                  <tr>
                    <th style="width: 20%">Attribute / Field</th>
                    @for (d of res.documents; track d.id) {
                      <th>{{ d.documentType }} (Doc {{ $index + 1 }})</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="font-bold text-ink">Document Number</td>
                    @for (d of res.documents; track d.id) {
                      <td class="font-mono font-semibold">{{ d.documentNumber }}</td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold text-ink">Total Stated Value</td>
                    @for (d of res.documents; track d.id) {
                      <td class="font-mono font-bold text-ink">{{ d.currency }} {{ d.totalValue.toLocaleString() }}</td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold text-ink">Seller / Beneficiary</td>
                    @for (d of res.documents; track d.id) {
                      <td>{{ d.parties.seller }}</td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold text-ink">Buyer / Applicant</td>
                    @for (d of res.documents; track d.id) {
                      <td>{{ d.parties.buyer }}</td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold text-ink">Consignee</td>
                    @for (d of res.documents; track d.id) {
                      <td>{{ d.parties.consignee || 'Not Disclosed' }}</td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold text-ink">Incoterm</td>
                    @for (d of res.documents; track d.id) {
                      <td><span class="incoterm-chip font-mono">{{ d.incoterm || 'CIF' }}</span></td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold text-ink">Port of Loading</td>
                    @for (d of res.documents; track d.id) {
                      <td>{{ d.ports.loading || 'Not Stated' }}</td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold text-ink">Port of Discharge</td>
                    @for (d of res.documents; track d.id) {
                      <td>{{ d.ports.discharge || 'Not Stated' }}</td>
                    }
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Checking Officer Action Checklist -->
          @if (res.recommendations.length > 0) {
            <section class="workbench-card mt-28">
              <div class="workbench-card-header">
                <div class="header-title-group">
                  <div class="header-icon-circle">
                    <app-icon name="check" [size]="18" />
                  </div>
                  <div>
                    <h2 class="workbench-card-heading">Trade Checking Officer Required Next Steps</h2>
                    <p class="workbench-card-subheading">Mandatory verification and amendment notices under banking compliance workflow</p>
                  </div>
                </div>
              </div>
              <div class="p-24">
                <div class="actions-list">
                  @for (rec of res.recommendations; track rec) {
                    <div class="action-item">
                      <span class="action-badge font-mono">{{ $index + 1 }}</span>
                      <span class="action-text">{{ rec }}</span>
                    </div>
                  }
                </div>
              </div>
            </section>
          }
        }
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

    .comparison-page-wrapper {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      width: 100%;
      background: #f8fafc;
    }

    .comparison-page-body {
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

    .btn-hero-primary {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 0 18px;
      height: 38px;
      border-radius: 8px;
      background: linear-gradient(135deg, #00a8a8, #008c8c);
      color: #ffffff;
      font-size: 0.84rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
      box-shadow: 0 2px 10px rgba(0, 168, 168, 0.35);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      text-decoration: none;
      box-sizing: border-box;
      white-space: nowrap;
    }

    .btn-hero-primary:hover:not(:disabled) {
      background: linear-gradient(135deg, #00baba, #009999);
      transform: translateY(-1px);
      box-shadow: 0 4px 14px rgba(0, 168, 168, 0.45);
    }

    .btn-hero-primary:disabled {
      opacity: 0.55;
      cursor: not-allowed;
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
      text-decoration: none;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      box-sizing: border-box;
      white-space: nowrap;
    }

    .btn-hero-secondary:hover {
      background: rgba(255, 255, 255, 0.16);
      border-color: rgba(255, 255, 255, 0.35);
      transform: translateY(-1px);
    }

    /* ── Loading / Error State ── */
    .loading-state-card, .error-state-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 60px 24px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      box-shadow: 0 2px 10px rgba(10, 22, 56, 0.04);
    }

    .loading-state-card h3, .error-state-card h3 {
      font-size: 1.2rem;
      font-weight: 750;
      color: #0a1638;
      margin: 14px 0 6px;
    }

    .loading-state-card p, .error-state-card p {
      color: #64748b;
      font-size: 0.9rem;
      max-width: 540px;
      margin: 0;
      line-height: 1.5;
    }

    .error-icon-circle {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #fff1f2;
      color: #e11d48;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* ── Verdict Banner Card ── */
    .verdict-banner-card {
      background: #ffffff;
      border: 2px solid #e2e8f0;
      border-radius: 14px;
      padding: 24px 28px;
      box-shadow: 0 2px 10px rgba(10, 22, 56, 0.04);
      transition: all 0.2s ease;
    }

    .verdict-compliant {
      background: #f0fdf4;
      border-color: #86efac;
    }

    .verdict-discrepant {
      background: #fffbeb;
      border-color: #fde68a;
    }

    .verdict-rejected {
      background: #fff1f2;
      border-color: #fecdd3;
    }

    .verdict-content-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      flex-wrap: wrap;
    }

    .verdict-main-group {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .verdict-icon-badge {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 168, 168, 0.12);
      color: #008c8c;
      flex-shrink: 0;
    }

    .verdict-compliant .verdict-icon-badge {
      background: #dcfce7;
      color: #166534;
    }

    .verdict-discrepant .verdict-icon-badge {
      background: #fef3c7;
      color: #92400e;
    }

    .verdict-rejected .verdict-icon-badge {
      background: #ffe4e6;
      color: #991b1b;
    }

    .verdict-eyebrow {
      font-size: 0.74rem;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #475569;
    }

    .verdict-title {
      font-size: 1.25rem;
      font-weight: 800;
      color: #0a1638;
      margin: 2px 0 0 0;
    }

    .score-pill {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 10px 18px;
      text-align: right;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
    }

    .score-pill-label {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #64748b;
    }

    .score-pill-val {
      font-size: 1.45rem;
      font-weight: 800;
      color: #0a1638;
    }

    .score-den {
      font-size: 0.85rem;
      color: #94a3b8;
      font-weight: 500;
    }

    .verdict-summary {
      font-size: 0.92rem;
      line-height: 1.6;
      color: #334155;
      margin: 16px 0 0 0;
    }

    .verdict-stats-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 18px;
      flex-wrap: wrap;
    }

    .stat-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 700;
    }

    .stat-match {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
    }

    .stat-material {
      background: #fffbeb;
      color: #92400e;
      border: 1px solid #fde68a;
    }

    .stat-conflict {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }

    /* ── Compared Documents Grid ── */
    .section-title-wrap {
      margin-bottom: 14px;
    }

    .section-heading {
      font-size: 1.15rem;
      font-weight: 800;
      color: #0a1638;
      margin: 0;
    }

    .section-subheading {
      font-size: 0.82rem;
      color: #64748b;
    }

    .docs-compared-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }

    .doc-compare-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 18px 20px;
      box-shadow: 0 2px 6px rgba(10, 22, 56, 0.03);
      transition: all 0.2s ease;
    }

    .doc-compare-card:hover {
      border-color: #cbd5e1;
      transform: translateY(-2px);
      box-shadow: 0 6px 14px rgba(10, 22, 56, 0.06);
    }

    .doc-card-badge {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }

    .chip-type-tag {
      font-size: 0.72rem;
      font-weight: 750;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 6px;
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
    }

    .doc-idx {
      font-size: 0.76rem;
      color: #008c8c;
      font-weight: 750;
    }

    .doc-card-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: #0a1638;
      margin: 0 0 4px 0;
    }

    .doc-card-type {
      font-size: 0.8rem;
      font-weight: 600;
      color: #008c8c;
    }

    .doc-card-meta {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid #f1f5f9;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.8rem;
    }

    .meta-lbl {
      color: #64748b;
    }

    /* ── Workbench Card & Table ── */
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

    .repo-count-badge {
      padding: 4px 12px;
      border-radius: 999px;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      font-size: 0.76rem;
      font-weight: 700;
      color: #475569;
    }

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
    }

    .modern-trade-table tbody tr {
      transition: background 0.15s ease;
    }

    .modern-trade-table tbody tr:hover {
      background: #fafbfc;
    }

    .row-conflict {
      background: rgba(244, 63, 94, 0.03);
    }

    .row-material {
      background: rgba(245, 158, 11, 0.03);
    }

    .category-tag {
      display: inline-block;
      font-size: 0.7rem;
      font-weight: 650;
      color: #64748b;
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
      margin-top: 4px;
    }

    .doc-origin-name {
      font-size: 0.76rem;
      color: #64748b;
      margin-bottom: 2px;
    }

    .value-text {
      font-size: 0.84rem;
      color: #0a1638;
    }

    .severity-badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 750;
      letter-spacing: 0.03em;
    }

    .sev-match {
      background: #ecfdf5;
      color: #059669;
      border: 1px solid #a7f3d0;
    }

    .sev-material {
      background: #fffbeb;
      color: #d97706;
      border: 1px solid #fde68a;
    }

    .sev-conflict {
      background: #fff1f2;
      color: #e11d48;
      border: 1px solid #fecdd3;
    }

    .rule-ref {
      font-size: 0.72rem;
      color: #64748b;
      margin-top: 4px;
    }

    .explanation-text {
      font-size: 0.82rem;
      line-height: 1.5;
      color: #334155;
    }

    .incoterm-chip {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      background: #eff6ff;
      color: #1d4ed8;
      font-size: 0.74rem;
      font-weight: 700;
    }

    .matrix-empty-pad {
      padding: 40px 24px;
      text-align: center;
      color: #64748b;
      font-size: 0.9rem;
    }

    /* ── Action Checklist ── */
    .p-24 {
      padding: 24px;
    }

    .actions-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .action-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
    }

    .action-badge {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #00a8a8;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.76rem;
      font-weight: 700;
      flex-shrink: 0;
    }

    .action-text {
      font-size: 0.88rem;
      color: #334155;
      font-weight: 500;
    }

    .truncate {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .font-mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .font-bold {
      font-weight: 700;
    }

    .font-semibold {
      font-weight: 600;
    }

    .font-medium {
      font-weight: 500;
    }

    .text-ink {
      color: #0a1638;
    }

    .mt-16 { margin-top: 16px; }
    .mt-28 { margin-top: 28px; }
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `]
})
export class ComparisonComponent implements OnInit {
  protected readonly window = window;
  protected readonly formatBytes = formatBytes;

  private readonly route = inject(ActivatedRoute);
  private readonly docsService = inject(DocumentsService);
  private readonly toast = inject(ToastService);

  readonly docIds = signal<string[]>([]);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);
  readonly result = signal<TradeComparisonResult | null>(null);
  readonly exportingPdf = signal<boolean>(false);

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      const idsParam = params['ids'];
      if (!idsParam) {
        this.error.set('No document IDs provided for comparison.');
        this.loading.set(false);
        return;
      }

      const ids = idsParam.split(',').map((id: string) => id.trim()).filter(Boolean);
      if (ids.length < 2) {
        this.error.set('Please select at least 2 documents to compare.');
        this.loading.set(false);
        return;
      }

      this.docIds.set(ids);
      this.runComparison(ids);
    });
  }

  downloadPdfReport(): void {
    const ids = this.docIds();
    if (ids.length < 2) return;

    this.exportingPdf.set(true);
    this.toast.info('Generating PDF Report', 'Building publication-quality comparison matrix dossier...');

    this.docsService.downloadComparisonPdfReport(ids, 'Trade_Reconciliation_Matrix_Report.pdf').subscribe({
      next: (filename) => {
        this.exportingPdf.set(false);
        this.toast.success('PDF Export Complete', `Downloaded ${filename}`);
      },
      error: (err) => {
        this.exportingPdf.set(false);
        this.toast.error('PDF Export Failed', err.message || 'Could not generate comparison PDF.');
      },
    });
  }

  private runComparison(ids: string[]): void {
    this.loading.set(true);
    this.error.set(null);

    this.docsService.compareDocuments(ids).subscribe({
      next: (res) => {
        this.result.set(res);
        this.loading.set(false);
        this.toast.success('Documents Reconciled', `${res.documents.length} documents compared`);
      },
      error: (err) => {
        this.error.set(err.message || 'Failed to compare the selected documents.');
        this.loading.set(false);
        this.toast.error('Reconciliation Failed', err.message);
      },
    });
  }
}
