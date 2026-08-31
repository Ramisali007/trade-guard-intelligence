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

@Component({
  selector: 'app-comparison',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <div class="page comparison-page">
      <!-- Header -->
      <header class="doc-header">
        <div class="doc-header-inner">
          <div class="doc-header-info">
            <a routerLink="/" class="btn btn-icon btn-ghost back-btn" title="Back to dashboard">
              <app-icon name="chevronLeft" [size]="18" />
            </a>
            <div>
              <div class="row gap-8 align-center wrap">
                <h1 class="doc-title">Trade Reconciliation & Comparison Workspace</h1>
                <span class="chip chip-info">UCP 600 & ISBP 745</span>
              </div>
              <div class="small muted mt-4">
                Comparing {{ docIds().length }} trade presentation documents for cross-document consistency & discrepancies
              </div>
            </div>
          </div>

          <div class="doc-header-actions row gap-8">
            <button class="btn btn-sm" (click)="window.print()">
              <app-icon name="document" [size]="14" />
              <span>Print Matrix</span>
            </button>
            <a routerLink="/" class="btn btn-sm btn-primary">
              <app-icon name="plus" [size]="14" />
              <span>New Comparison</span>
            </a>
          </div>
        </div>
      </header>

      @if (loading()) {
        <div class="loading-card card card-pad text-center">
          <div class="spin mb-12"><app-icon name="refresh" [size]="28" /></div>
          <h3 class="font-bold">Reconciling Trade Documents...</h3>
          <p class="small muted mt-4">Cross-referencing parties, values, goods descriptions, dates, and ports under banking examination rules.</p>
        </div>
      } @else if (error()) {
        <div class="card card-pad error-card text-center">
          <app-icon name="alert" [size]="32" />
          <h3 class="font-bold text-negative mt-12">Comparison Failed</h3>
          <p class="small muted mt-4">{{ error() }}</p>
          <a routerLink="/" class="btn btn-sm btn-primary mt-16">Return to Dashboard</a>
        </div>
      } @else if (result(); as res) {
        <!-- Presentation Verdict Banner -->
        <section
          class="verdict-banner card"
          [class.verdict-compliant]="res.verdict === 'COMPLIANT_PRESENTATION'"
          [class.verdict-discrepant]="res.verdict === 'DISCREPANT_PRESENTATION_REQUIRES_AMENDMENT'"
          [class.verdict-rejected]="res.verdict === 'CRITICAL_REJECTION_OR_FRAUD_SUSPECT'"
        >
          <div class="verdict-inner">
            <div class="row gap-16 align-center justify-between wrap">
              <div class="row gap-12 align-center">
                <div class="verdict-icon-badge">
                  <app-icon [name]="res.verdict === 'COMPLIANT_PRESENTATION' ? 'check' : 'alert'" [size]="24" />
                </div>
                <div>
                  <div class="eyebrow uppercase opacity-80">Banking Examination Verdict</div>
                  <h2 class="verdict-title">{{ res.verdictTitle }}</h2>
                </div>
              </div>

              <!-- Score Pill -->
              <div class="score-pill">
                <div class="score-pill-label">Consistency Score</div>
                <div class="score-pill-val font-mono">{{ res.overallConsistencyScore }} <span class="score-den">/ 100</span></div>
              </div>
            </div>

            <p class="verdict-summary mt-12">{{ res.verdictSummary }}</p>

            <div class="verdict-stats-row row gap-12 mt-16 wrap">
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
          </div>
        </section>

        <!-- Document Cards Carousel / Grid -->
        <section class="docs-compared-grid mt-20">
          @for (d of res.documents; track d.id) {
            <div class="card doc-compare-card">
              <div class="doc-card-badge">
                <span class="chip small uppercase">{{ d.fileType }}</span>
                <span class="doc-idx font-mono font-bold">Doc {{ $index + 1 }}</span>
              </div>
              <h3 class="doc-card-title truncate" [title]="d.filename">{{ d.filename }}</h3>
              <div class="doc-card-type font-semibold">{{ d.documentType }}</div>

              <div class="doc-card-meta mt-10">
                <div class="row justify-between small muted">
                  <span>Ref #:</span>
                  <span class="font-mono text-ink">{{ d.documentNumber }}</span>
                </div>
                <div class="row justify-between small muted mt-4">
                  <span>Total Value:</span>
                  <span class="font-bold text-ink">{{ d.currency }} {{ d.totalValue.toLocaleString() }}</span>
                </div>
                <div class="row justify-between small muted mt-4">
                  <span>Buyer:</span>
                  <span class="truncate text-ink max-w-140" [title]="d.parties.buyer">{{ d.parties.buyer }}</span>
                </div>
              </div>
            </div>
          }
        </section>

        <!-- Discrepancy & Discrepancies Reconciliation Matrix -->
        <section class="card discrepancies-section mt-24">
          <div class="card-head">
            <div class="row gap-8 align-center">
              <app-icon name="layers" [size]="18" />
              <h2 class="h2">Discrepancy & Cross-Document Reconciliation Matrix</h2>
            </div>
            <span class="chip chip-info font-mono">{{ res.discrepancies.length }} Reconciled Fields</span>
          </div>

          <div class="card-body p-0">
            @if (res.discrepancies.length > 0) {
              <div class="table-wrap">
                <table class="matrix-table">
                  <thead>
                    <tr>
                      <th style="width: 14%">Field & Category</th>
                      <th style="width: 25%">Document A Reference</th>
                      <th style="width: 25%">Document B Reference</th>
                      <th style="width: 14%">Severity Status</th>
                      <th style="width: 22%">Banking Audit Explanation</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (disc of res.discrepancies; track disc.id) {
                      <tr [class.row-conflict]="disc.severity === 'CRITICAL_CONFLICT'" [class.row-material]="disc.severity === 'MATERIAL_DISCREPANCY'" [class.row-match]="disc.severity === 'VERIFIED_MATCH'">
                        <td>
                          <div class="font-bold">{{ disc.field }}</div>
                          <span class="category-tag">{{ disc.category }}</span>
                        </td>
                        <td>
                          <div class="doc-origin-name small muted">{{ disc.documentA }}</div>
                          <div class="value-text font-mono font-medium">{{ disc.valueA }}</div>
                        </td>
                        <td>
                          <div class="doc-origin-name small muted">{{ disc.documentB }}</div>
                          <div class="value-text font-mono font-medium">{{ disc.valueB }}</div>
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
                            <div class="rule-ref small muted mt-4 font-mono">{{ disc.ruleReference }}</div>
                          }
                        </td>
                        <td class="small">{{ disc.explanation }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <div class="p-24 text-center text-muted">
                No discrepancies identified between the compared trade documents.
              </div>
            }
          </div>
        </section>

        <!-- Side-by-Side Comprehensive Field Comparison -->
        <section class="card comparison-table-card mt-24">
          <div class="card-head">
            <div class="row gap-8 align-center">
              <app-icon name="list" [size]="18" />
              <h2 class="h2">Side-by-Side Attribute Comparison</h2>
            </div>
            <span class="small muted">Multi-Document Field Alignment</span>
          </div>

          <div class="card-body p-0">
            <div class="table-wrap">
              <table class="matrix-table align-table">
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
                    <td class="font-bold">Document Number</td>
                    @for (d of res.documents; track d.id) {
                      <td class="font-mono">{{ d.documentNumber }}</td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold">Total Stated Value</td>
                    @for (d of res.documents; track d.id) {
                      <td class="font-mono font-bold">{{ d.currency }} {{ d.totalValue.toLocaleString() }}</td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold">Seller / Beneficiary</td>
                    @for (d of res.documents; track d.id) {
                      <td>{{ d.parties.seller }}</td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold">Buyer / Applicant</td>
                    @for (d of res.documents; track d.id) {
                      <td>{{ d.parties.buyer }}</td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold">Consignee</td>
                    @for (d of res.documents; track d.id) {
                      <td>{{ d.parties.consignee || 'Not Disclosed' }}</td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold">Incoterm</td>
                    @for (d of res.documents; track d.id) {
                      <td><span class="chip small font-mono">{{ d.incoterm || 'CIF' }}</span></td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold">Port of Loading</td>
                    @for (d of res.documents; track d.id) {
                      <td>{{ d.ports.loading || 'Not Stated' }}</td>
                    }
                  </tr>
                  <tr>
                    <td class="font-bold">Port of Discharge</td>
                    @for (d of res.documents; track d.id) {
                      <td>{{ d.ports.discharge || 'Not Stated' }}</td>
                    }
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- Checking Officer Action Checklist -->
        @if (res.recommendations.length > 0) {
          <section class="card actions-card mt-24">
            <div class="card-head">
              <div class="row gap-8 align-center">
                <app-icon name="check" [size]="18" />
                <h2 class="h2">Trade Checking Officer Required Next Steps</h2>
              </div>
            </div>
            <div class="card-body">
              <div class="actions-list">
                @for (rec of res.recommendations; track rec) {
                  <div class="action-item row gap-10 align-center">
                    <span class="action-badge font-mono">{{ $index + 1 }}</span>
                    <span>{{ rec }}</span>
                  </div>
                }
              </div>
            </div>
          </section>
        }
      }
    </div>
  `,
  styles: `
    .comparison-page {
      max-width: 1300px;
      margin: 0 auto;
      padding-bottom: 60px;
    }
    .doc-header { margin-bottom: 24px; }
    .doc-header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .doc-header-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .doc-title {
      font-size: 1.4rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .loading-card, .error-card {
      padding: 60px 20px;
    }

    /* Verdict Banner */
    .verdict-banner {
      border-radius: var(--radius-xl);
      border: 2px solid var(--line);
      overflow: hidden;
      box-shadow: var(--shadow-md);
    }
    .verdict-compliant {
      background: linear-gradient(135deg, color-mix(in srgb, #10b981 12%, var(--raised)) 0%, var(--raised) 100%);
      border-color: #10b981;
    }
    .verdict-discrepant {
      background: linear-gradient(135deg, color-mix(in srgb, #f59e0b 14%, var(--raised)) 0%, var(--raised) 100%);
      border-color: #f59e0b;
    }
    .verdict-rejected {
      background: linear-gradient(135deg, color-mix(in srgb, #ef4444 16%, var(--raised)) 0%, var(--raised) 100%);
      border-color: #ef4444;
    }
    .verdict-inner { padding: 24px 28px; }
    .verdict-icon-badge {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--ink);
      color: var(--raised);
    }
    .verdict-title { font-size: 1.3rem; font-weight: 800; }
    .verdict-summary { font-size: 0.95rem; line-height: 1.55; color: var(--ink-2); max-width: 900px; }

    .score-pill {
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 18px;
      text-align: right;
    }
    .score-pill-label { font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: var(--ink-2); }
    .score-pill-val { font-size: 1.8rem; font-weight: 900; line-height: 1; margin-top: 2px; }
    .score-den { font-size: 0.9rem; color: var(--ink-2); }

    .stat-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 0.82rem;
      font-weight: 600;
    }
    .stat-match { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .stat-material { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
    .stat-conflict { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }

    /* Docs Compared Grid */
    .docs-compared-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .doc-compare-card {
      padding: 18px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
    }
    .doc-card-badge { display: flex; justify-content: space-between; align-items: center; }
    .doc-card-title { font-size: 1rem; font-weight: 700; margin-top: 8px; }
    .doc-card-type { font-size: 0.85rem; color: var(--accent); margin-top: 2px; }
    .max-w-140 { max-width: 140px; display: inline-block; }

    /* Matrix Table */
    .table-wrap { overflow-x: auto; }
    .matrix-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.88rem;
    }
    .matrix-table th {
      padding: 12px 16px;
      background: var(--sunken);
      border-bottom: 2px solid var(--line);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--ink-2);
    }
    .matrix-table td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }
    .category-tag {
      display: inline-block;
      font-size: 0.68rem;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--sunken);
      color: var(--ink-2);
      margin-top: 4px;
      font-weight: 600;
    }
    .severity-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 0.74rem;
      font-weight: 700;
      letter-spacing: 0.03em;
    }
    .sev-match { background: #d1fae5; color: #065f46; }
    .sev-material { background: #fef3c7; color: #92400e; }
    .sev-conflict { background: #fee2e2; color: #991b1b; }

    .actions-list { display: flex; flex-direction: column; gap: 10px; }
    .action-item {
      padding: 12px 16px;
      background: var(--sunken);
      border-radius: var(--radius-md);
      font-size: 0.9rem;
    }
    .action-badge {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--accent);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.76rem;
      font-weight: 700;
      flex-shrink: 0;
    }
  `,
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
