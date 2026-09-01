import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DocumentsService } from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import type {
  AnalyzedUnit,
  DocumentDetail,
  UnitPage,
  UnitQuery,
  TradeComplianceAnalysis,
  ComplianceDecision,
} from '../../models/api.models';
import { formatBytes, formatDuration } from '../../shared/format';
import { Icon } from '../../shared/components/icon';
import { DatePipe } from '@angular/common';
import { ReportModal } from '../../shared/components/report-modal';

@Component({
  selector: 'app-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    DatePipe,
    Icon,
    ReportModal,
  ],
  template: `
    <div class="page">
      @if (loadingDoc()) {
        <div class="loading-state card card-pad">
          <div class="loading-icon">
            <div class="spin"><app-icon name="refresh" [size]="24" /></div>
          </div>
          <p class="mt-12 font-medium">Loading compliance & transaction intelligence...</p>
        </div>
      } @else if (doc()) {
        <!-- Document Header -->
        <header class="doc-header">
          <div class="doc-header-inner">
            <div class="doc-header-info">
              <a routerLink="/" class="btn btn-icon btn-ghost back-btn" title="Back to dashboard">
                <app-icon name="chevronLeft" [size]="18" />
              </a>
              <div>
                <div class="row gap-8 wrap align-center">
                  <h1 class="doc-title">{{ doc()?.filename }}</h1>
                  <span class="chip chip-info uppercase">{{ doc()?.fileType }}</span>
                  @if (tc(); as t) {
                    <span class="chip chip-doc-type">
                      <app-icon name="document" [size]="12" />
                      <span>{{ t.documentClassification.type }}</span>
                    </span>
                  }
                </div>
                <div class="row gap-12 small muted mt-4 wrap">
                  <span>{{ formatBytes(doc()?.fileSize || 0) }}</span>
                  <span class="sep">·</span>
                  <span>{{ doc()?.extraction?.pageCount || 1 }} Pages</span>
                  <span class="sep">·</span>
                  <span>{{ doc()?.analysis?.statistics?.analyzedUnits || 0 }} Passages</span>
                  <span class="sep">·</span>
                  <span>Screened in {{ formatDuration(doc()?.analysis?.timing?.totalMs || 0) }}</span>
                </div>
              </div>
            </div>

            <div class="doc-header-actions row gap-8 wrap">
              <button class="btn btn-sm" (click)="showReportModal.set(true)">
                <app-icon name="eye" [size]="14" />
                <span>Compliance Report</span>
              </button>
              <button class="btn btn-sm btn-ghost" (click)="downloadTxtReport()">
                <app-icon name="document" [size]="14" />
                <span>Export (.txt)</span>
              </button>
              <button class="btn btn-sm btn-primary" (click)="downloadPdfReport()">
                <app-icon name="download" [size]="14" />
                <span>Export PDF Report</span>
              </button>
            </div>
          </div>
        </header>

        <!-- Compliance Decision & Executive Risk Score Card -->
        @if (tc(); as t) {
          <section class="compliance-decision-card" [class.decision-allow]="t.decision.decision === 'ALLOW'" [class.decision-review]="t.decision.decision === 'REVIEW'" [class.decision-block]="t.decision.decision === 'BLOCK_ESCALATE'">
            <div class="decision-ambient" aria-hidden="true"></div>
            <div class="decision-inner">
              <div class="decision-header-row">
                <div class="decision-badge-group">
                  <div class="decision-badge" [class.badge-allow]="t.decision.decision === 'ALLOW'" [class.badge-review]="t.decision.decision === 'REVIEW'" [class.badge-block]="t.decision.decision === 'BLOCK_ESCALATE'">
                    <span class="decision-pulse"></span>
                    <app-icon [name]="t.decision.decision === 'ALLOW' ? 'check-circle' : t.decision.decision === 'REVIEW' ? 'alert' : 'shield-alert'" [size]="20" />
                    <span class="decision-title-text">{{ t.decision.decision === 'BLOCK_ESCALATE' ? 'BLOCK / ESCALATE' : t.decision.decision }}</span>
                  </div>
                  <span class="chip font-mono">Confidence: {{ Math.round(t.decision.confidence * 100) }}%</span>
                </div>

                <div class="risk-score-display">
                  <div class="risk-score-label">Overall Risk Score</div>
                  <div class="risk-score-val">
                    <span class="score-num" [class.score-low]="t.riskScores.overall < 20" [class.score-mod]="t.riskScores.overall >= 20 && t.riskScores.overall < 40" [class.score-elev]="t.riskScores.overall >= 40 && t.riskScores.overall < 60" [class.score-high]="t.riskScores.overall >= 60 && t.riskScores.overall < 80" [class.score-crit]="t.riskScores.overall >= 80">{{ t.riskScores.overall }}</span>
                    <span class="score-den">/ 100</span>
                  </div>
                  <span class="chip small" [class.chip-positive]="t.riskScores.overall < 20" [class.chip-warning]="t.riskScores.overall >= 20 && t.riskScores.overall < 60" [class.chip-negative]="t.riskScores.overall >= 60">
                    {{ getRiskSeverityLabel(t.riskScores.overall) }}
                  </span>
                </div>
              </div>

              <!-- Top Decision Reasons -->
              <div class="decision-reasons-box mt-16">
                <div class="reasons-label eyebrow">Primary Compliance Findings:</div>
                <div class="reasons-list mt-8">
                  @for (reason of t.decision.reasons; track reason) {
                    <div class="reason-pill">
                      <app-icon name="alert" [size]="13" />
                      <span>{{ reason }}</span>
                    </div>
                  }
                </div>
              </div>
            </div>
          </section>

          <!-- Point-in-Time Temporal Status & SBP Regulatory Banner -->
          @if (t.temporalScreening; as ts) {
            <section class="card temporal-banner-card mt-16">
              <div class="temporal-header">
                <div class="row gap-8 align-center">
                  <span class="temporal-pulse-tag">POINT-IN-TIME COMPLIANCE POSITION</span>
                  <span class="chip font-mono">Evaluation Date: {{ ts.transactionTimestamp | date:'mediumDate' }}</span>
                </div>
                <a routerLink="/auditor" class="btn btn-sm btn-ghost auditor-link">
                  <app-icon name="sparkle" [size]="14" />
                  <span>Auditor Timeline Diff ↗</span>
                </a>
              </div>

              <div class="temporal-grid mt-12">
                <div class="temporal-col">
                  <span class="temporal-label">Historical Status (at Transaction Date):</span>
                  <div class="temporal-val" [class.danger-val]="ts.wasListedAtTransactionTime">
                    <span class="status-dot" [class.danger]="ts.wasListedAtTransactionTime" [class.success]="!ts.wasListedAtTransactionTime"></span>
                    <span>{{ ts.historicalFindingsSummary }}</span>
                  </div>
                </div>

                <div class="temporal-col">
                  <span class="temporal-label">Current Watchlist Position:</span>
                  <div class="temporal-val">
                    <span class="status-dot" [class.warning]="ts.hasPostTransactionDesignations" [class.success]="!ts.isCurrentlyListed" [class.danger]="ts.wasListedAtTransactionTime"></span>
                    <span>{{ ts.currentFindingsSummary }}</span>
                  </div>
                </div>
              </div>

              <!-- SBP Pakistan Compliance & Jurisdictional Nexus Badges -->
              <div class="regulatory-subgrid mt-16">
                @if (t.sbpCompliance; as sbp) {
                  <div class="sbp-badge-card">
                    <div class="sbp-title">
                      <span class="flag-icon">🇵🇰</span>
                      <strong>State Bank of Pakistan (SBP) Framework</strong>
                    </div>
                    <div class="sbp-details small mt-4">
                      <div><strong>Verdict:</strong> <span class="badge-verdict" [class.ok]="sbp.overallSbpVerdict === 'COMPLIANT'" [class.warn]="sbp.overallSbpVerdict === 'FURTHER_DUE_DILIGENCE'">{{ sbp.overallSbpVerdict }}</span></div>
                      <div class="muted mt-2">{{ sbp.explanation }}</div>
                    </div>
                  </div>
                }

                @if (t.jurisdictionalNexus && t.jurisdictionalNexus.length > 0) {
                  <div class="nexus-badge-card">
                    <div class="nexus-title">
                      <strong>Jurisdictional Nexus Regimes</strong>
                    </div>
                    <div class="nexus-tags mt-4">
                      @for (n of t.jurisdictionalNexus; track n.jurisdiction) {
                        <span class="nexus-chip" [attr.data-app]="n.applicability" [title]="n.reason">
                          [{{ n.jurisdiction }}] {{ n.applicability }}
                        </span>
                      }
                    </div>
                  </div>
                }
              </div>
            </section>
          }

          <!-- Transaction & Counterparty Profile Card -->
          <section class="card txn-profile-card mt-20">
            <div class="card-head">
              <div class="row gap-8 align-center">
                <app-icon name="globe" [size]="18" />
                <h2 class="h2">Trade Transaction & Counterparty Profile</h2>
              </div>
              <span class="chip chip-info font-mono">Ref: {{ t.transaction.transactionId }}</span>
            </div>

            <div class="card-body">
              <div class="parties-grid">
                <!-- Seller / Exporter -->
                <div class="party-card">
                  <div class="party-role-tag">Seller / Exporter</div>
                  <div class="party-name">{{ t.transaction.parties.seller.legalName }}</div>
                  <div class="party-meta small muted mt-4">
                    <div><strong>Country:</strong> {{ t.transaction.parties.seller.country || 'Not Specified' }}</div>
                    @if (t.transaction.parties.seller.bank && t.transaction.parties.seller.bank !== 'Not Found') {
                      <div><strong>Bank:</strong> {{ t.transaction.parties.seller.bank }}</div>
                    }
                    @if (t.transaction.parties.seller.taxVatNumber && t.transaction.parties.seller.taxVatNumber !== 'Not Found') {
                      <div><strong>Tax/VAT:</strong> {{ t.transaction.parties.seller.taxVatNumber }}</div>
                    }
                  </div>
                </div>

                <!-- Buyer / Importer -->
                <div class="party-card">
                  <div class="party-role-tag">Buyer / Importer</div>
                  <div class="party-name">{{ t.transaction.parties.buyer.legalName }}</div>
                  <div class="party-meta small muted mt-4">
                    <div><strong>Country:</strong> {{ t.transaction.parties.buyer.country || 'Not Specified' }}</div>
                    @if (t.transaction.parties.buyer.bank && t.transaction.parties.buyer.bank !== 'Not Found') {
                      <div><strong>Bank:</strong> {{ t.transaction.parties.buyer.bank }}</div>
                    }
                    @if (t.endUseAnalysis.declaredCustomerBusiness && t.endUseAnalysis.declaredCustomerBusiness !== 'Not Found') {
                      <div><strong>Declared Business:</strong> {{ t.endUseAnalysis.declaredCustomerBusiness }}</div>
                    }
                  </div>
                </div>

                <!-- Consignee & End User -->
                <div class="party-card">
                  <div class="party-role-tag">Consignee & End-User</div>
                  <div class="party-name">{{ t.transaction.parties.consignee?.legalName || 'Same as Buyer' }}</div>
                  <div class="party-meta small muted mt-4">
                    <div>
                      <strong>Ultimate End-User:</strong>
                      @if (t.transaction.parties.endUser?.legalName && t.transaction.parties.endUser?.legalName !== 'Not Found') {
                        <span class="font-medium">{{ t.transaction.parties.endUser?.legalName }}</span>
                      } @else {
                        <span class="chip chip-warning small">Not Disclosed / Missing EUC</span>
                      }
                    </div>
                    @if (t.transaction.parties.shipper?.legalName && t.transaction.parties.shipper?.legalName !== 'Not Found') {
                      <div><strong>Shipper:</strong> {{ t.transaction.parties.shipper?.legalName }}</div>
                    }
                  </div>
                </div>

                <!-- Banks & Payment -->
                <div class="party-card">
                  <div class="party-role-tag">Financial & Documentary Credit</div>
                  <div class="party-name">{{ t.transaction.parties.issuingBank?.bank || t.transaction.parties.issuingBank?.legalName || 'Direct Commercial Settlement' }}</div>
                  <div class="party-meta small muted mt-4">
                    @if (t.transaction.parties.issuingBank?.swiftBic && t.transaction.parties.issuingBank?.swiftBic !== 'Not Found') {
                      <div><strong>SWIFT:</strong> {{ t.transaction.parties.issuingBank?.swiftBic }}</div>
                    }
                    <div><strong>Incoterm:</strong> <span class="chip small uppercase font-bold">{{ t.transaction.incoterm }}</span></div>
                    <div><strong>Total Value:</strong> <span class="font-bold text-accent">{{ t.transaction.currency }} {{ t.transaction.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 }) }}</span></div>
                    <div><strong>Payment:</strong> {{ t.transaction.paymentTerms }}</div>
                  </div>
                </div>
              </div>

              <!-- Shipment & Geography Route Strip -->
              <div class="route-strip mt-16">
                <div class="route-node">
                  <span class="route-dot origin-dot"></span>
                  <span class="route-label">Origin</span>
                  <span class="route-val">{{ t.transaction.originCountry }}</span>
                </div>
                <div class="route-arrow">→</div>
                <div class="route-node">
                  <span class="route-dot"></span>
                  <span class="route-label">Port of Loading</span>
                  <span class="route-val">{{ t.transaction.portOfLoading || 'Origin Port' }}</span>
                </div>
                <div class="route-arrow">→</div>
                @if (t.transaction.transitCountries && t.transaction.transitCountries.length > 0) {
                  <div class="route-node">
                    <span class="route-dot transit-dot"></span>
                    <span class="route-label">Transit Hubs</span>
                    <span class="route-val">{{ t.transaction.transitCountries.join(', ') }}</span>
                  </div>
                  <div class="route-arrow">→</div>
                }
                <div class="route-node">
                  <span class="route-dot"></span>
                  <span class="route-label">Port of Discharge</span>
                  <span class="route-val">{{ t.transaction.portOfDischarge || 'Discharge Port' }}</span>
                </div>
                <div class="route-arrow">→</div>
                <div class="route-node">
                  <span class="route-dot dest-dot"></span>
                  <span class="route-label">Destination</span>
                  <span class="route-val">{{ t.transaction.destinationCountry }}</span>
                </div>
              </div>
            </div>
          </section>

          <!-- Goods & Scope-of-Trade Intelligence Matrix -->
          <section class="card goods-card mt-20">
            <div class="card-head">
              <div class="row gap-8 align-center">
                <app-icon name="package" [size]="18" />
                <h2 class="h2">Goods & Scope-of-Trade Intelligence Matrix</h2>
              </div>
              <div class="row gap-8">
                @if (t.scopeValidation.hasOutOfScopeGoods) {
                  <span class="chip chip-negative">
                    <app-icon name="alert" [size]="12" />
                    <span>OUT OF SCOPE GOODS DETECTED</span>
                  </span>
                } @else {
                  <span class="chip chip-positive">
                    <app-icon name="check" [size]="12" />
                    <span>All Goods in Authorized Scope</span>
                  </span>
                }
                <span class="small muted tnum">{{ t.goods.length }} line items</span>
              </div>
            </div>

            <div class="card-body p-0 table-responsive">
              <table class="compliance-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Product Description</th>
                    <th>Category</th>
                    <th>HS Code</th>
                    <th>ECCN</th>
                    <th>Quantity</th>
                    <th>Unit Price</th>
                    <th>Total Line Value</th>
                    <th>Scope Status</th>
                  </tr>
                </thead>
                <tbody>
                  @for (g of t.goods; track g.id) {
                    <tr [class.tr-out-of-scope]="!g.isAuthorizedScope" [class.tr-controlled]="g.isControlledOrDualUse">
                      <td class="font-mono">{{ g.itemNumber }}</td>
                      <td>
                        <div class="good-desc font-medium">{{ g.productDescription }}</div>
                        @if (g.technicalSpecifications && g.technicalSpecifications !== 'Standard commercial specifications') {
                          <div class="small muted">{{ g.technicalSpecifications }}</div>
                        }
                      </td>
                      <td><span class="chip small">{{ g.productCategory || 'General Merchandise' }}</span></td>
                      <td class="font-mono">{{ g.hsCode || 'N/A' }}</td>
                      <td class="font-mono">
                        @if (g.eccn && g.eccn !== 'Not Specified') {
                          <span class="chip chip-warning small">{{ g.eccn }}</span>
                        } @else {
                          <span class="muted small">EAR99</span>
                        }
                      </td>
                      <td class="tnum font-medium">{{ g.quantity.toLocaleString() }} {{ g.unitOfMeasure }}</td>
                      <td class="tnum font-mono">{{ g.currency }} {{ g.unitPrice.toLocaleString() }}</td>
                      <td class="tnum font-mono font-bold">{{ g.currency }} {{ g.totalLineValue.toLocaleString() }}</td>
                      <td>
                        @if (g.isAuthorizedScope) {
                          <span class="chip chip-positive small">
                            <app-icon name="check" [size]="10" />
                            <span>AUTHORIZED</span>
                          </span>
                        } @else {
                          <span class="chip chip-negative small font-bold" [title]="g.scopeAuthorizationNote || 'Out of scope'">
                            <app-icon name="alert" [size]="10" />
                            <span>OUT OF SCOPE</span>
                          </span>
                        }
                        @if (g.isControlledOrDualUse) {
                          <span class="chip chip-warning small mt-4 block">Dual-Use Check</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <!-- Tabbed Compliance Intelligence Modules -->
          <section class="card compliance-tabs-card mt-20">
            <div class="card-head tabs-head">
              <div class="tabs-nav row gap-6 wrap">
                <button class="tab-btn" [class.active]="activeTab() === 'sanctions'" (click)="activeTab.set('sanctions')">
                  <app-icon name="shield" [size]="15" />
                  <span>Sanctions & Watchlists</span>
                  @if (t.sanctions.matches.length > 0 || t.sanctions.jurisdictionRisks.length > 0) {
                    <span class="tab-badge badge-alert">{{ t.sanctions.matches.length + t.sanctions.jurisdictionRisks.length }}</span>
                  }
                </button>

                <button class="tab-btn" [class.active]="activeTab() === 'exportControls'" (click)="activeTab.set('exportControls')">
                  <app-icon name="cpu" [size]="15" />
                  <span>Export Controls & Dual-Use</span>
                  @if (t.exportControls.controlledGoods.length > 0) {
                    <span class="tab-badge badge-warning">{{ t.exportControls.controlledGoods.length }}</span>
                  }
                </button>

                <button class="tab-btn" [class.active]="activeTab() === 'tbml'" (click)="activeTab.set('tbml')">
                  <app-icon name="scale" [size]="15" />
                  <span>TBML & Route Risk</span>
                  @if (t.tbml.redFlags.length > 0) {
                    <span class="tab-badge badge-alert">{{ t.tbml.redFlags.length }}</span>
                  }
                </button>

                <button class="tab-btn" [class.active]="activeTab() === 'integrity'" (click)="activeTab.set('integrity')">
                  <app-icon name="check-circle" [size]="15" />
                  <span>Math & Integrity</span>
                  @if (!t.mathematicalValidation.isMathematicallySound) {
                    <span class="tab-badge badge-alert">!</span>
                  }
                </button>

                <button class="tab-btn" [class.active]="activeTab() === 'discrepancies'" (click)="activeTab.set('discrepancies')">
                  <app-icon name="layers" [size]="15" />
                  <span>Cross-Doc Reconciliation</span>
                  @if (t.discrepancies.length > 0) {
                    <span class="tab-badge badge-alert">{{ t.discrepancies.length }}</span>
                  }
                </button>

                <button class="tab-btn" [class.active]="activeTab() === 'scores'" (click)="activeTab.set('scores')">
                  <app-icon name="chart" [size]="15" />
                  <span>10D Risk Breakdown</span>
                </button>
              </div>
            </div>

            <div class="card-body">
              <!-- Tab 1: Sanctions -->
              @if (activeTab() === 'sanctions') {
                <div class="tab-pane">
                  <div class="row gap-12 justify-between wrap align-center mb-16">
                    <div class="row gap-8 align-center">
                      <span class="eyebrow">Screening Status:</span>
                      <span class="chip" [class.chip-positive]="t.sanctions.status === 'NONE'" [class.chip-warning]="t.sanctions.status === 'POTENTIAL_MATCH' || t.sanctions.status === 'REQUIRES_LICENSE_AUTHORIZATION'" [class.chip-negative]="t.sanctions.status === 'CONFIRMED_MATCH' || t.sanctions.status === 'RESTRICTED_JURISDICTION'">
                        {{ t.sanctions.status }}
                      </span>
                    </div>
                    <div class="small muted">
                      <strong>Dataset:</strong> {{ t.sanctions.datasetVersion }} · <strong>Screened At:</strong> {{ t.sanctions.screeningTimestamp | date:'short' }}
                    </div>
                  </div>

                  @if (t.sanctions.matches.length > 0) {
                    <div class="sanctions-hits-grid">
                      @for (m of t.sanctions.matches; track m.entityOrSubject) {
                        <div class="hit-card">
                          <div class="hit-head">
                            <span class="chip chip-negative uppercase font-bold">{{ m.matchType }} MATCH</span>
                            <span class="font-mono small">Confidence: {{ Math.round(m.matchConfidence * 100) }}%</span>
                          </div>
                          <div class="hit-body mt-8">
                            <div class="hit-title">Screened Subject: <strong>{{ m.entityOrSubject }}</strong> ({{ m.roleOrField }})</div>
                            <div class="hit-matched mt-4">Matched Watchlist: <strong>{{ m.matchedSanctionedName }}</strong></div>
                            <div class="small muted mt-4">List: {{ m.sanctionsList }} | Program: {{ m.sanctionProgram }}</div>
                            <div class="hit-action mt-8">
                              <strong>Recommended Action:</strong> {{ m.recommendedAction }}
                            </div>
                          </div>
                        </div>
                      }
                    </div>
                  } @else {
                    <div class="empty-state-pills">
                      <div class="row gap-8 align-center text-positive">
                        <app-icon name="check-circle" [size]="18" />
                        <span class="font-medium">No confirmed or potential party watchlist hits identified.</span>
                      </div>
                      <p class="small muted mt-4">Screened {{ t.sanctions.screenedEntitiesCount }} counterparties, {{ t.sanctions.screenedCountriesCount }} jurisdictions, and {{ t.sanctions.screenedVesselsCount }} vessels against OFAC SDN, UN Consolidated, EU Financial Sanctions, and UK OFSI/HMT lists.</p>
                    </div>
                  }

                  @if (t.sanctions.jurisdictionRisks.length > 0) {
                    <div class="mt-20">
                      <div class="eyebrow mb-8">Jurisdiction / Geography Restrictions:</div>
                      <div class="jurisdiction-list">
                        @for (j of t.sanctions.jurisdictionRisks; track j.countryName) {
                          <div class="jurisdiction-item">
                            <div class="row gap-8 align-center">
                              <span class="chip chip-negative small uppercase">{{ j.sanctionsStatus }}</span>
                              <strong>{{ j.countryName }}</strong> ({{ j.nodeRole }})
                            </div>
                            <div class="small muted mt-4">{{ j.description }}</div>
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- Tab 2: Export Controls -->
              @if (activeTab() === 'exportControls') {
                <div class="tab-pane">
                  <div class="row gap-12 justify-between wrap align-center mb-16">
                    <div class="row gap-8 align-center">
                      <span class="eyebrow">Export Control Assessment:</span>
                      <span class="chip" [class.chip-positive]="t.exportControls.riskStatus === 'NO_CONTROL_CONCERN_IDENTIFIED'" [class.chip-warning]="t.exportControls.riskStatus === 'CLASSIFICATION_REQUIRED'" [class.chip-negative]="t.exportControls.riskStatus === 'POTENTIALLY_CONTROLLED'">
                        {{ t.exportControls.riskStatus }}
                      </span>
                    </div>
                    <span class="small muted">Score: {{ t.exportControls.riskScore }}/100</span>
                  </div>

                  @if (t.exportControls.controlledGoods.length > 0) {
                    <div class="controlled-goods-grid">
                      @for (cg of t.exportControls.controlledGoods; track cg.itemDescription) {
                        <div class="controlled-good-card">
                          <div class="cg-head row gap-8 align-center justify-between">
                            <strong class="cg-title">{{ cg.itemDescription }}</strong>
                            <span class="chip chip-warning small">{{ cg.category }}</span>
                          </div>
                          <div class="cg-meta small mt-8">
                            <div><strong>ECCN:</strong> {{ cg.eccn }} | <strong>HS:</strong> {{ cg.hsCode }}</div>
                            <div class="mt-4"><strong>Control Reason:</strong> {{ cg.controlReason }}</div>
                            <div class="mt-4"><strong>License Requirement:</strong> {{ cg.licenseRequirement }}</div>
                            <div class="mt-4 text-warning"><strong>Destination Note:</strong> {{ cg.destinationConcern }}</div>
                          </div>
                        </div>
                      }
                    </div>
                  } @else {
                    <div class="empty-state-pills">
                      <div class="row gap-8 align-center text-positive">
                        <app-icon name="check-circle" [size]="18" />
                        <span class="font-medium">No dual-use, military, or export-controlled commodity triggers detected.</span>
                      </div>
                      <p class="small muted mt-4">Commodity descriptions, HS codes, and destination countries do not match restricted control list triggers under BIS CCL or Wassenaar Arrangement.</p>
                    </div>
                  }
                </div>
              }

              <!-- Tab 3: TBML & Route Risk -->
              @if (activeTab() === 'tbml') {
                <div class="tab-pane">
                  <div class="tbml-overview-grid mb-16">
                    <div class="tbml-metric-card">
                      <div class="eyebrow">Price Consistency</div>
                      <div class="small mt-4">{{ t.tbml.priceConsistencyAssessment }}</div>
                    </div>
                    <div class="tbml-metric-card">
                      <div class="eyebrow">Routing Consistency</div>
                      <div class="small mt-4">{{ t.tbml.routingConsistencyAssessment }}</div>
                    </div>
                    <div class="tbml-metric-card">
                      <div class="eyebrow">Documentation Consistency</div>
                      <div class="small mt-4">{{ t.tbml.documentationConsistencyAssessment }}</div>
                    </div>
                  </div>

                  @if (t.tbml.redFlags.length > 0) {
                    <div class="tbml-flags-list mt-16">
                      <div class="eyebrow mb-8">FATF Trade-Based Money Laundering Indicators:</div>
                      @for (rf of t.tbml.redFlags; track rf.title) {
                        <div class="tbml-flag-item">
                          <div class="row gap-8 align-center justify-between">
                            <div class="row gap-8 align-center">
                              <span class="chip chip-negative small uppercase font-bold">{{ rf.severity }}</span>
                              <strong class="rf-title">{{ rf.title }}</strong>
                            </div>
                            <span class="chip chip-info small">{{ rf.category }}</span>
                          </div>
                          <p class="rf-desc mt-6">{{ rf.description }}</p>
                          <div class="rf-evidence mt-4 small muted">
                            <strong>Evidence:</strong> {{ rf.evidence }}
                          </div>
                          @if (rf.fatfReference) {
                            <div class="rf-fatf mt-4 small text-accent">
                              <strong>Regulatory Reference:</strong> {{ rf.fatfReference }}
                            </div>
                          }
                        </div>
                      }
                    </div>
                  } @else {
                    <div class="empty-state-pills">
                      <div class="row gap-8 align-center text-positive">
                        <app-icon name="check-circle" [size]="18" />
                        <span class="font-medium">No material TBML pricing, volume, or circuitous routing red flags identified.</span>
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- Tab 4: Mathematical Validation & Integrity -->
              @if (activeTab() === 'integrity') {
                <div class="tab-pane">
                  <div class="math-overview-box mb-16">
                    <div class="row gap-8 align-center">
                      <span class="eyebrow">Mathematical Integrity Status:</span>
                      <span class="chip" [class.chip-positive]="t.mathematicalValidation.isMathematicallySound" [class.chip-negative]="!t.mathematicalValidation.isMathematicallySound">
                        {{ t.mathematicalValidation.isMathematicallySound ? 'VERIFIED SOUND' : 'ARITHMETIC DISCREPANCY DETECTED' }}
                      </span>
                    </div>

                    <div class="math-grid mt-12">
                      <div class="math-stat">
                        <span class="muted small">Calculated Subtotal</span>
                        <strong class="font-mono">{{ t.mathematicalValidation.currency }} {{ t.mathematicalValidation.calculatedSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2 }) }}</strong>
                      </div>
                      <div class="math-stat">
                        <span class="muted small">Declared Subtotal</span>
                        <strong class="font-mono">{{ t.mathematicalValidation.currency }} {{ t.mathematicalValidation.declaredSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2 }) }}</strong>
                      </div>
                      <div class="math-stat">
                        <span class="muted small">Calculated Total</span>
                        <strong class="font-mono font-bold">{{ t.mathematicalValidation.currency }} {{ t.mathematicalValidation.calculatedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 }) }}</strong>
                      </div>
                      <div class="math-stat">
                        <span class="muted small">Declared Total</span>
                        <strong class="font-mono font-bold">{{ t.mathematicalValidation.currency }} {{ t.mathematicalValidation.declaredTotal.toLocaleString('en-US', { minimumFractionDigits: 2 }) }}</strong>
                      </div>
                    </div>
                  </div>

                  @if (t.mathematicalValidation.discrepancies.length > 0) {
                    <div class="math-discrepancies-list">
                      <div class="eyebrow mb-8">Arithmetic Inconsistencies:</div>
                      @for (md of t.mathematicalValidation.discrepancies; track md.description) {
                        <div class="math-disc-item">
                          <app-icon name="alert" [size]="14" />
                          <span>{{ md.description }}</span>
                        </div>
                      }
                    </div>
                  }
                </div>
              }

              <!-- Tab 5: Cross-Document Reconciliation -->
              @if (activeTab() === 'discrepancies') {
                <div class="tab-pane">
                  @if (t.discrepancies.length > 0) {
                    <div class="discrepancies-table-wrap">
                      <table class="compliance-table">
                        <thead>
                          <tr>
                            <th>Field</th>
                            <th>Document A</th>
                            <th>Document B</th>
                            <th>Severity</th>
                            <th>Explanation</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (d of t.discrepancies; track d.id) {
                            <tr>
                              <td class="font-bold">{{ d.field }}</td>
                              <td>
                                <div class="small muted">{{ d.documentA }}</div>
                                <div class="font-medium">{{ d.valueA }}</div>
                              </td>
                              <td>
                                <div class="small muted">{{ d.documentB }}</div>
                                <div class="font-medium">{{ d.valueB }}</div>
                              </td>
                              <td>
                                <span class="chip small" [class.chip-negative]="d.severity === 'CRITICAL_CONFLICT'" [class.chip-warning]="d.severity === 'MATERIAL_DISCREPANCY'">
                                  {{ d.severity }}
                                </span>
                              </td>
                              <td class="small">{{ d.explanation }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  } @else {
                    <div class="empty-state-pills">
                      <div class="row gap-8 align-center text-positive">
                        <app-icon name="check-circle" [size]="18" />
                        <span class="font-medium">All presented documents reconcile consistently with zero material cross-document discrepancies.</span>
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- Tab 6: 10D Risk Breakdown -->
              @if (activeTab() === 'scores') {
                <div class="tab-pane">
                  <div class="scores-grid">
                    <div class="score-card">
                      <div class="score-card-head">
                        <span>Sanctions Risk</span>
                        <span class="font-mono font-bold">{{ t.riskScores.sanctions }}/100</span>
                      </div>
                      <div class="score-bar-track mt-6"><div class="score-bar-fill" [style.width.%]="t.riskScores.sanctions" [class.bg-neg]="t.riskScores.sanctions >= 60" [class.bg-warn]="t.riskScores.sanctions >= 20 && t.riskScores.sanctions < 60" [class.bg-pos]="t.riskScores.sanctions < 20"></div></div>
                    </div>

                    <div class="score-card">
                      <div class="score-card-head">
                        <span>Export Control & Dual-Use</span>
                        <span class="font-mono font-bold">{{ t.riskScores.exportControl }}/100</span>
                      </div>
                      <div class="score-bar-track mt-6"><div class="score-bar-fill" [style.width.%]="t.riskScores.exportControl" [class.bg-neg]="t.riskScores.exportControl >= 60" [class.bg-warn]="t.riskScores.exportControl >= 20 && t.riskScores.exportControl < 60" [class.bg-pos]="t.riskScores.exportControl < 20"></div></div>
                    </div>

                    <div class="score-card">
                      <div class="score-card-head">
                        <span>Scope & Goods Consistency</span>
                        <span class="font-mono font-bold">{{ t.riskScores.goods }}/100</span>
                      </div>
                      <div class="score-bar-track mt-6"><div class="score-bar-fill" [style.width.%]="t.riskScores.goods" [class.bg-neg]="t.riskScores.goods >= 60" [class.bg-warn]="t.riskScores.goods >= 20 && t.riskScores.goods < 60" [class.bg-pos]="t.riskScores.goods < 20"></div></div>
                    </div>

                    <div class="score-card">
                      <div class="score-card-head">
                        <span>End-Use Consistency</span>
                        <span class="font-mono font-bold">{{ t.riskScores.endUse }}/100</span>
                      </div>
                      <div class="score-bar-track mt-6"><div class="score-bar-fill" [style.width.%]="t.riskScores.endUse" [class.bg-neg]="t.riskScores.endUse >= 60" [class.bg-warn]="t.riskScores.endUse >= 20 && t.riskScores.endUse < 60" [class.bg-pos]="t.riskScores.endUse < 20"></div></div>
                    </div>

                    <div class="score-card">
                      <div class="score-card-head">
                        <span>End-User Transparency</span>
                        <span class="font-mono font-bold">{{ t.riskScores.endUser }}/100</span>
                      </div>
                      <div class="score-bar-track mt-6"><div class="score-bar-fill" [style.width.%]="t.riskScores.endUser" [class.bg-neg]="t.riskScores.endUser >= 60" [class.bg-warn]="t.riskScores.endUser >= 20 && t.riskScores.endUser < 60" [class.bg-pos]="t.riskScores.endUser < 20"></div></div>
                    </div>

                    <div class="score-card">
                      <div class="score-card-head">
                        <span>TBML Financial Crime Risk</span>
                        <span class="font-mono font-bold">{{ t.riskScores.tbml }}/100</span>
                      </div>
                      <div class="score-bar-track mt-6"><div class="score-bar-fill" [style.width.%]="t.riskScores.tbml" [class.bg-neg]="t.riskScores.tbml >= 60" [class.bg-warn]="t.riskScores.tbml >= 20 && t.riskScores.tbml < 60" [class.bg-pos]="t.riskScores.tbml < 20"></div></div>
                    </div>

                    <div class="score-card">
                      <div class="score-card-head">
                        <span>Document Integrity & Math</span>
                        <span class="font-mono font-bold">{{ t.riskScores.documentIntegrity }}/100</span>
                      </div>
                      <div class="score-bar-track mt-6"><div class="score-bar-fill" [style.width.%]="t.riskScores.documentIntegrity" [class.bg-neg]="t.riskScores.documentIntegrity >= 60" [class.bg-warn]="t.riskScores.documentIntegrity >= 20 && t.riskScores.documentIntegrity < 60" [class.bg-pos]="t.riskScores.documentIntegrity < 20"></div></div>
                    </div>

                    <div class="score-card">
                      <div class="score-card-head">
                        <span>Geographic & Routing Risk</span>
                        <span class="font-mono font-bold">{{ t.riskScores.geographic }}/100</span>
                      </div>
                      <div class="score-bar-track mt-6"><div class="score-bar-fill" [style.width.%]="t.riskScores.geographic" [class.bg-neg]="t.riskScores.geographic >= 60" [class.bg-warn]="t.riskScores.geographic >= 20 && t.riskScores.geographic < 60" [class.bg-pos]="t.riskScores.geographic < 20"></div></div>
                    </div>
                  </div>
                </div>
              }
            </div>
          </section>

          <!-- Missing Information & Recommended Compliance Actions Checklist -->
          <section class="card actions-card mt-20">
            <div class="card-head">
              <div class="row gap-8 align-center">
                <app-icon name="user-check" [size]="18" />
                <h2 class="h2">Missing Information & Required Compliance Actions</h2>
              </div>
              <span class="chip chip-info small">{{ t.decision.recommendedActions.length }} Actions</span>
            </div>

            <div class="card-body">
              @if (t.decision.missingInformation.length > 0) {
                <div class="missing-info-section mb-16">
                  <div class="eyebrow text-negative mb-8">Required Documentation / Missing Information:</div>
                  <div class="missing-items-grid">
                    @for (mi of t.decision.missingInformation; track mi) {
                      <div class="missing-item">
                        <app-icon name="alert" [size]="14" />
                        <span>{{ mi }}</span>
                      </div>
                    }
                  </div>
                </div>
              }

              <div class="recommended-actions-section">
                <div class="eyebrow mb-8">Recommended Compliance Officer Steps:</div>
                <div class="actions-list">
                  @for (action of t.decision.recommendedActions; track action) {
                    <div class="action-row">
                      <div class="action-num">{{ $index + 1 }}</div>
                      <span>{{ action }}</span>
                    </div>
                  }
                </div>
              </div>
            </div>
          </section>

          <!-- Human-in-the-Loop Override & Decision Action Bar -->
          <section class="card human-override-card mt-20">
            <div class="card-head">
              <div class="row gap-8 align-center">
                <app-icon name="scale" [size]="18" />
                <h2 class="h2">Human Compliance Officer Override & Audit Actions</h2>
              </div>
              <span class="small muted">Decision Support & Governance</span>
            </div>

            <div class="card-body">
              <div class="override-actions-bar row gap-8 wrap">
                <button class="btn btn-sm" [class.btn-primary]="t.decision.decision !== 'ALLOW'" (click)="openOverrideDialog('APPROVE_WITH_REVIEW', 'ALLOW')">
                  <app-icon name="check" [size]="14" />
                  <span>Approve (With Review)</span>
                </button>
                <button class="btn btn-sm" (click)="openOverrideDialog('REQUEST_ADDITIONAL_DOCS', 'REVIEW')">
                  <app-icon name="document" [size]="14" />
                  <span>Request Additional Documents</span>
                </button>
                <button class="btn btn-sm" (click)="openOverrideDialog('MARK_FALSE_POSITIVE', 'ALLOW')">
                  <app-icon name="shield" [size]="14" />
                  <span>Mark False Positive</span>
                </button>
                <button class="btn btn-sm btn-ghost text-warning" (click)="openOverrideDialog('ESCALATE_TO_COMPLIANCE', 'REVIEW')">
                  <app-icon name="alert" [size]="14" />
                  <span>Escalate to Sanctions Officer</span>
                </button>
                <button class="btn btn-sm btn-ghost text-negative" (click)="openOverrideDialog('REJECT', 'BLOCK_ESCALATE')">
                  <app-icon name="close" [size]="14" />
                  <span>Reject / Block Transaction</span>
                </button>
              </div>

              <!-- Human Override Modal / Inline Box -->
              @if (showOverrideBox()) {
                <div class="override-form mt-16 p-16 card">
                  <div class="eyebrow mb-8">Apply Human Decision Override (Action: {{ pendingAction() }})</div>
                  <div class="row gap-12 wrap mt-8">
                    <div class="form-field flex-1">
                      <label class="small muted mb-4 block">Officer Name</label>
                      <input type="text" class="input" [(ngModel)]="overrideOfficerName" placeholder="e.g. Senior Compliance Officer" />
                    </div>
                    <div class="form-field flex-1">
                      <label class="small muted mb-4 block">Justification / Reason (Mandatory for Audit)</label>
                      <input type="text" class="input" [(ngModel)]="overrideReason" placeholder="Document regulatory basis or customer verification..." />
                    </div>
                  </div>
                  <div class="row gap-8 justify-end mt-12">
                    <button class="btn btn-sm btn-ghost" (click)="showOverrideBox.set(false)">Cancel</button>
                    <button class="btn btn-sm btn-primary" [disabled]="!overrideReason.trim()" (click)="submitHumanOverride()">
                      <span>Confirm & Audit Record</span>
                    </button>
                  </div>
                </div>
              }

              <!-- Audit Trail History -->
              @if (t.auditTrail.humanOverrides && t.auditTrail.humanOverrides.length > 0) {
                <div class="audit-history mt-16">
                  <div class="eyebrow mb-8">Logged Compliance Actions & Overrides:</div>
                  <div class="audit-list">
                    @for (ovr of t.auditTrail.humanOverrides; track ovr.id) {
                      <div class="audit-entry">
                        <div class="row gap-8 align-center justify-between">
                          <strong>{{ ovr.action }}</strong>
                          <span class="small muted">{{ ovr.timestamp | date:'medium' }}</span>
                        </div>
                        <div class="small mt-4">
                          <strong>Officer:</strong> {{ ovr.officerName }} ({{ ovr.officerRole }}) ·
                          <strong>Decision Changed:</strong> {{ ovr.previousDecision }} → <span class="font-bold">{{ ovr.overriddenDecision }}</span>
                        </div>
                        <div class="small muted mt-2"><strong>Reason:</strong> {{ ovr.reason }}</div>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          </section>
        }

        <!-- Citations & Grounded Passage References -->
        @if (citationsList().length > 0) {
          <section class="card citations-card mt-20" id="citations">
            <div class="card-head">
              <div class="row gap-10 align-center">
                <div class="citations-icon-badge">
                  <app-icon name="quote" [size]="17" />
                </div>
                <div>
                  <h2 class="h2">Grounded Document Evidence & Passages</h2>
                  <div class="small muted mt-2">Verbatim excerpts and clauses extracted from this trade document</div>
                </div>
              </div>
              <div class="row gap-8">
                <span class="chip chip-info font-mono">{{ citationsList().length }} Citations</span>
              </div>
            </div>

            <div class="card-body citations-body">
              <div class="citations-grid">
                @for (cite of citationsList(); track $index) {
                  <div class="citation-entry" [id]="'cite-' + ($index + 1)">
                    <div class="citation-entry-head">
                      <div class="row gap-8 align-center">
                        <span class="citation-index-badge">#{{ ($index + 1) < 10 ? '0' + ($index + 1) : ($index + 1) }}</span>
                        <span class="citation-location-text">
                          Page {{ cite.pageNumber }} · ¶{{ cite.paragraphNumber }}
                          @if (cite.section) {
                            <span class="section-pill">§ {{ cite.section }}</span>
                          }
                        </span>
                      </div>
                    </div>

                    <blockquote class="citation-quote-box">
                      "{{ cite.snippet }}"
                    </blockquote>

                    <div class="citation-entry-foot">
                      <span class="small muted">Source: {{ doc()?.filename }}</span>
                      <button class="btn-locate-source" (click)="locateInExplorer(cite)">
                        <app-icon name="search" [size]="12" />
                        <span>Locate in Explorer</span>
                        <app-icon name="arrowRight" [size]="12" />
                      </button>
                    </div>
                  </div>
                }
              </div>
            </div>
          </section>
        }

        <!-- Paragraph Explorer -->
        <section class="card explorer-card mt-20" id="explorer">
          <div class="card-head">
            <div class="row gap-8 align-center">
              <app-icon name="search" [size]="18" />
              <h2 class="h2">Document Passage Explorer</h2>
            </div>
            <span class="small muted tnum">
              {{ units().length }} of {{ totalUnitsCount() }} passages
            </span>
          </div>

          <!-- Filters -->
          <div class="explorer-filters">
            <div class="search filter-search">
              <app-icon name="search" [size]="15" />
              <input
                type="text"
                class="input"
                placeholder="Search extracted terms, commodities, clauses..."
                [value]="searchQuery()"
                (input)="onSearchInput($event)"
              />
            </div>

            @if (hasActiveFilters()) {
              <button class="btn btn-sm btn-ghost" (click)="resetFilters()">
                <app-icon name="close" [size]="14" />
                <span>Reset</span>
              </button>
            }
          </div>

          <!-- Passages List -->
          <div class="card-body explorer-body">
            @if (loadingUnits()) {
              <div class="loading-units">
                <div class="spin"><app-icon name="refresh" [size]="20" /></div>
                <span class="muted small mt-8">Loading passages...</span>
              </div>
            } @else {
              <div class="paragraphs-list">
                @for (unit of units(); track unit.id) {
                  <article class="paragraph-card">
                    <div class="paragraph-header">
                      <div class="row gap-8 wrap align-center">
                        <span class="paragraph-index eyebrow">P.{{ unit.pageNumber }} · ¶{{ unit.paragraphNumber }}</span>
                        @if (unit.section) {
                          <span class="section-badge truncate">§ {{ unit.section }}</span>
                        }
                        <span class="chip small">{{ unit.unitType }}</span>
                      </div>
                    </div>

                    <div class="paragraph-text">
                      <p [class.expanded]="expandedParagraphs().has(unit.id)">
                        {{ unit.text }}
                      </p>
                      @if (unit.text.length > 280) {
                        <button
                          class="btn-expand small font-medium"
                          (click)="toggleExpand(unit.id)"
                        >
                          {{ expandedParagraphs().has(unit.id) ? 'Show less' : 'Read full passage...' }}
                        </button>
                      }
                    </div>

                    <div class="paragraph-footer mt-12">
                      <button
                        class="btn btn-sm btn-ghost"
                        (click)="copyParagraph(unit.text)"
                        title="Copy text"
                      >
                        <app-icon name="layers" [size]="13" />
                        <span>Copy</span>
                      </button>
                    </div>
                  </article>
                }

                @if (units().length === 0) {
                  <div class="empty-filter">
                    <div class="empty-filter-icon">
                      <app-icon name="search" [size]="24" />
                    </div>
                    <p class="font-medium mt-12">No matching passages</p>
                    <p class="small muted mt-4">Try adjusting your search criteria.</p>
                  </div>
                }
              </div>

              <!-- Pagination -->
              @if (totalPages() > 1) {
                <div class="pagination mt-20">
                  <div class="small muted tnum">
                    Page {{ currentPage() }} of {{ totalPages() }}
                  </div>
                  <div class="row gap-6">
                    <button
                      class="btn btn-sm"
                      [disabled]="currentPage() <= 1"
                      (click)="changePage(currentPage() - 1)"
                    >
                      <app-icon name="chevronLeft" [size]="14" />
                      <span>Previous</span>
                    </button>
                    <button
                      class="btn btn-sm"
                      [disabled]="currentPage() >= totalPages()"
                      (click)="changePage(currentPage() + 1)"
                    >
                      <span>Next</span>
                      <app-icon name="chevronRight" [size]="14" />
                    </button>
                  </div>
                </div>
              }
            }
          </div>
        </section>

        <!-- Report Modal -->
        @if (showReportModal()) {
          <app-report-modal
            [documentId]="id()"
            [filename]="doc()?.filename || 'report.txt'"
            [document]="doc()"
            (close)="showReportModal.set(false)"
          />
        }
      }
    </div>
  `,
  styles: `
    /* ── Doc Header ── */
    .doc-header {
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 18px 24px;
      margin-bottom: 20px;
      box-shadow: var(--shadow-sm);
    }
    .doc-header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .doc-header-info {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .back-btn { margin-top: 2px; }
    .doc-title {
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--ink);
    }
    .chip-doc-type {
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      color: var(--accent);
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .sep { opacity: 0.3; }

    /* ── Compliance Decision Card ── */
    .compliance-decision-card {
      position: relative;
      border-radius: var(--radius-xl);
      overflow: hidden;
      margin-bottom: 24px;
      box-shadow: var(--shadow-md);
      transition: all var(--dur) var(--ease);
      border: 2px solid var(--line);
    }
    .decision-allow {
      background: linear-gradient(135deg, color-mix(in srgb, #10b981 10%, var(--raised)) 0%, var(--raised) 100%);
      border-color: #10b981;
    }
    .decision-review {
      background: linear-gradient(135deg, color-mix(in srgb, #f59e0b 12%, var(--raised)) 0%, var(--raised) 100%);
      border-color: #f59e0b;
    }
    .decision-block {
      background: linear-gradient(135deg, color-mix(in srgb, #ef4444 14%, var(--raised)) 0%, var(--raised) 100%);
      border-color: #ef4444;
    }
    .decision-inner {
      padding: 24px 28px;
    }
    .decision-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      flex-wrap: wrap;
    }
    .decision-badge-group {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .decision-badge {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 8px 18px;
      border-radius: 9999px;
      font-size: 1.15rem;
      font-weight: 800;
      letter-spacing: 0.04em;
    }
    .badge-allow { background: #10b981; color: #fff; }
    .badge-review { background: #f59e0b; color: #fff; }
    .badge-block { background: #ef4444; color: #fff; }
    .decision-pulse {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 10px currentColor;
      animation: pulse 2s infinite ease-in-out;
    }
    .risk-score-display {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
    }
    .risk-score-label { font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-2); font-weight: 600; }
    .risk-score-val { display: flex; align-items: baseline; gap: 4px; }
    .score-num { font-size: 2.2rem; font-weight: 900; line-height: 1; font-family: var(--font-mono); }
    .score-den { font-size: 1rem; color: var(--ink-2); font-weight: 600; }
    .score-low { color: #10b981; }
    .score-mod { color: #3b82f6; }
    .score-elev { color: #f59e0b; }
    .score-high { color: #f97316; }
    .score-crit { color: #ef4444; }

    .decision-reasons-box {
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 14px 18px;
    }
    .reasons-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .reason-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.88rem;
      font-weight: 500;
      color: var(--ink);
    }

    /* ── Transaction Profile ── */
    .parties-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
    }
    .party-card {
      background: var(--sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      padding: 14px 16px;
    }
    .party-role-tag {
      font-size: 0.72rem;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: var(--accent);
      margin-bottom: 4px;
    }
    .party-name {
      font-size: 0.98rem;
      font-weight: 700;
      color: var(--ink);
    }
    .party-meta { line-height: 1.5; }
    .text-accent { color: var(--accent); }

    /* ── Route Strip ── */
    .route-strip {
      display: flex;
      align-items: center;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      padding: 12px 18px;
      gap: 12px;
      overflow-x: auto;
    }
    .route-node {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      flex: 1;
      min-width: 110px;
    }
    .route-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      margin-bottom: 4px;
    }
    .origin-dot { background: #10b981; }
    .transit-dot { background: #f59e0b; }
    .dest-dot { background: #6366f1; }
    .route-label { font-size: 0.68rem; text-transform: uppercase; color: var(--ink-2); font-weight: 600; }
    .route-val { font-size: 0.84rem; font-weight: 600; color: var(--ink); }
    .route-arrow { color: var(--ink-2); opacity: 0.4; font-weight: bold; }

    /* ── Goods Table ── */
    .table-responsive { overflow-x: auto; }
    .compliance-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.86rem;
      text-align: left;
    }
    .compliance-table th {
      background: var(--sunken);
      padding: 12px 16px;
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--ink-2);
      border-bottom: 1px solid var(--line);
    }
    .compliance-table td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--line);
      vertical-align: middle;
    }
    .tr-out-of-scope {
      background: color-mix(in srgb, #ef4444 8%, transparent);
    }
    .tr-controlled {
      background: color-mix(in srgb, #f59e0b 6%, transparent);
    }

    /* ── Point-in-Time Temporal Banner ── */
    .temporal-banner-card {
      background: var(--raised);
      border: 1px solid var(--line);
      border-left: 4px solid var(--accent);
      padding: 16px 20px;
    }
    .temporal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .temporal-pulse-tag {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 0.05em;
    }
    .auditor-link {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--accent);
      text-decoration: none;
    }
    .temporal-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 14px;
    }
    .temporal-col {
      display: flex;
      flex-direction: column;
      gap: 4px;
      background: var(--sunken);
      padding: 10px 14px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
    }
    .temporal-label {
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--ink-muted);
      text-transform: uppercase;
    }
    .temporal-val {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--ink);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-top: 4px;
      flex-shrink: 0;
    }
    .status-dot.success { background: #10b981; }
    .status-dot.warning { background: #f59e0b; }
    .status-dot.danger { background: #ef4444; }
    .danger-val { color: #ef4444; font-weight: 600; }

    .regulatory-subgrid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px;
      padding-top: 10px;
      border-top: 1px solid var(--line);
    }
    .sbp-badge-card, .nexus-badge-card {
      background: var(--sunken);
      padding: 10px 14px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
    }
    .sbp-title, .nexus-title {
      font-size: 0.8rem;
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--ink);
    }
    .badge-verdict {
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 700;
      font-size: 0.72rem;
    }
    .badge-verdict.ok { background: #ecfdf5; color: #059669; }
    .badge-verdict.warn { background: #fffbeb; color: #d97706; }
    .nexus-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .nexus-chip {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 4px;
      background: var(--raised);
      border: 1px solid var(--line);
      color: var(--ink-2);
    }
    .nexus-chip[data-app="LEGALLY_APPLICABLE"] {
      border-color: #0284c7;
      color: #0284c7;
      background: color-mix(in srgb, #0284c7 10%, transparent);
    }

    /* ── Tabs ── */
    .tabs-head { padding: 8px 16px; background: var(--sunken); border-bottom: 1px solid var(--line); }
    .tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 14px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      font-size: 0.84rem;
      font-weight: 600;
      color: var(--ink-2);
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }
    .tab-btn:hover { background: var(--raised); color: var(--ink); }
    .tab-btn.active {
      background: var(--raised);
      color: var(--ink);
      border-color: var(--line);
      box-shadow: var(--shadow-xs);
    }
    .tab-badge {
      padding: 1px 6px;
      border-radius: 9999px;
      font-size: 0.7rem;
      font-weight: 700;
    }
    .badge-alert { background: #ef4444; color: #fff; }
    .badge-warning { background: #f59e0b; color: #fff; }

    /* ── Submodules ── */
    .sanctions-hits-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 12px;
    }
    .hit-card {
      background: color-mix(in srgb, #ef4444 6%, var(--raised));
      border: 1px solid #ef4444;
      border-radius: var(--radius-md);
      padding: 14px 16px;
    }
    .hit-head { display: flex; justify-content: space-between; align-items: center; }
    .hit-action { font-size: 0.82rem; color: #b91c1c; background: #fee2e2; padding: 6px 10px; border-radius: var(--radius-sm); }
    .empty-state-pills { padding: 18px 20px; background: color-mix(in srgb, #10b981 6%, var(--raised)); border: 1px solid color-mix(in srgb, #10b981 30%, transparent); border-radius: var(--radius-md); }

    .controlled-goods-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
    .controlled-good-card { background: var(--sunken); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 14px 16px; }

    .tbml-overview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .tbml-metric-card { background: var(--sunken); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 12px 14px; }
    .tbml-flags-list { display: flex; flex-direction: column; gap: 10px; }
    .tbml-flag-item { background: var(--raised); border: 1px solid var(--line); border-left: 3px solid #ef4444; border-radius: var(--radius-md); padding: 12px 16px; }

    .math-overview-box { background: var(--sunken); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 16px 18px; }
    .math-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
    .math-stat { display: flex; flex-direction: column; gap: 2px; }
    .math-discrepancies-list { display: flex; flex-direction: column; gap: 8px; }
    .math-disc-item { display: flex; align-items: center; gap: 8px; color: #ef4444; font-size: 0.86rem; }

    .scores-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
    .score-card { background: var(--sunken); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 12px 14px; }
    .score-card-head { display: flex; justify-content: space-between; font-size: 0.84rem; }
    .score-bar-track { height: 6px; background: var(--line); border-radius: 9999px; overflow: hidden; }
    .score-bar-fill { height: 100%; border-radius: 9999px; }
    .bg-pos { background: #10b981; }
    .bg-warn { background: #f59e0b; }
    .bg-neg { background: #ef4444; }

    /* ── Actions & Missing Info ── */
    .missing-items-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; }
    .missing-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: color-mix(in srgb, #ef4444 8%, var(--raised)); border: 1px solid color-mix(in srgb, #ef4444 30%, transparent); border-radius: var(--radius-sm); font-size: 0.84rem; color: #b91c1c; font-weight: 500; }
    .actions-list { display: flex; flex-direction: column; gap: 8px; }
    .action-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--sunken); border: 1px solid var(--line); border-radius: var(--radius-md); font-size: 0.88rem; font-weight: 500; }
    .action-num { width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 0.76rem; font-weight: 700; flex: none; }

    /* ── Human Override Bar ── */
    .human-override-card { border-top: 3px solid var(--accent); }
    .audit-entry { padding: 10px 14px; background: var(--sunken); border: 1px solid var(--line); border-radius: var(--radius-sm); margin-top: 8px; }

    /* ── Citations & Explorer ── */
    .citations-icon-badge {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .citations-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 12px;
    }
    .citation-entry {
      padding: 14px 16px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .citation-index-badge {
      font-size: 0.72rem;
      font-weight: 700;
      background: var(--accent);
      color: #fff;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
    }
    .citation-quote-box {
      margin: 0;
      font-size: 0.85rem;
      font-style: italic;
      color: var(--ink-2);
      border-left: 2px solid var(--accent);
      padding-left: 10px;
    }
    .btn-locate-source {
      background: none;
      border: none;
      color: var(--accent);
      font-size: 0.78rem;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      padding: 0;
    }

    .explorer-filters {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 18px;
      background: var(--sunken);
      border-bottom: 1px solid var(--line);
    }
    .filter-search { flex: 1; }
    .paragraphs-list { display: flex; flex-direction: column; gap: 10px; }
    .paragraph-card {
      padding: 14px 18px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
    }
    .paragraph-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .paragraph-text p {
      margin: 0;
      font-size: 0.88rem;
      line-height: 1.55;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .paragraph-text p.expanded {
      display: block;
    }
    .btn-expand {
      background: none;
      border: none;
      color: var(--accent);
      cursor: pointer;
      padding: 0;
      margin-top: 4px;
    }
    .pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
  `,
})
export class AnalysisComponent implements OnInit {
  protected readonly Math = Math;
  private readonly docsService = inject(DocumentsService);
  private readonly toast = inject(ToastService);

  readonly id = input.required<string>();

  readonly doc = signal<DocumentDetail | null>(null);
  readonly loadingDoc = signal<boolean>(true);
  readonly showReportModal = signal<boolean>(false);

  readonly activeTab = signal<'sanctions' | 'exportControls' | 'tbml' | 'integrity' | 'discrepancies' | 'scores'>('sanctions');

  readonly units = signal<AnalyzedUnit[]>([]);
  readonly totalUnitsCount = signal<number>(0);
  readonly totalPages = signal<number>(1);
  readonly currentPage = signal<number>(1);
  readonly loadingUnits = signal<boolean>(false);

  readonly searchQuery = signal<string>('');
  readonly expandedParagraphs = signal<Set<string>>(new Set());

  // Human Override State
  readonly showOverrideBox = signal<boolean>(false);
  readonly pendingAction = signal<string>('');
  readonly pendingNewDecision = signal<ComplianceDecision>('ALLOW');
  overrideOfficerName = 'Senior Compliance Officer';
  overrideReason = '';

  readonly tc = computed<TradeComplianceAnalysis | undefined>(() => {
    return this.doc()?.analysis?.tradeCompliance;
  });

  readonly citationsList = computed(() => {
    const list = this.units();
    const result: Array<{
      unitId: string;
      pageNumber: number;
      paragraphNumber: number;
      section: string | null;
      snippet: string;
    }> = [];

    for (const u of list) {
      if (u.text.length > 40) {
        result.push({
          unitId: u.id,
          pageNumber: u.pageNumber,
          paragraphNumber: u.paragraphNumber,
          section: u.section,
          snippet: u.text.length > 240 ? u.text.slice(0, 237) + '...' : u.text,
        });
      }
      if (result.length >= 6) break;
    }
    return result;
  });

  readonly hasActiveFilters = computed(() => {
    return Boolean(this.searchQuery().trim());
  });

  ngOnInit(): void {
    this.loadDocumentResults();
    this.loadUnits();
  }

  loadDocumentResults(): void {
    this.loadingDoc.set(true);
    this.docsService.results(this.id()).subscribe({
      next: (detail) => {
        this.doc.set(detail);
        this.loadingDoc.set(false);
      },
      error: (err: any) => {
        this.loadingDoc.set(false);
        this.toast.error('Failed to load analysis', err.message);
      },
    });
  }

  loadUnits(): void {
    this.loadingUnits.set(true);
    const query: UnitQuery = {
      page: this.currentPage(),
      pageSize: 20,
    };

    if (this.searchQuery().trim()) {
      query.search = this.searchQuery().trim();
    }

    this.docsService.units(this.id(), query).subscribe({
      next: (page: UnitPage) => {
        this.units.set(page.items);
        this.totalUnitsCount.set(page.unfilteredTotal);
        this.totalPages.set(page.totalPages);
        this.loadingUnits.set(false);
      },
      error: (err: any) => {
        this.loadingUnits.set(false);
        this.toast.error('Could not load passages', err.message);
      },
    });
  }

  onSearchInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.searchQuery.set(val);
    this.currentPage.set(1);
    this.loadUnits();
  }

  resetFilters(): void {
    this.searchQuery.set('');
    this.currentPage.set(1);
    this.loadUnits();
  }

  changePage(page: number): void {
    this.currentPage.set(page);
    this.loadUnits();
    document.getElementById('explorer')?.scrollIntoView({ behavior: 'smooth' });
  }

  toggleExpand(id: string): void {
    const set = new Set(this.expandedParagraphs());
    if (set.has(id)) {
      set.delete(id);
    } else {
      set.add(id);
    }
    this.expandedParagraphs.set(set);
  }

  locateInExplorer(cite: { unitId: string; pageNumber: number; paragraphNumber: number }): void {
    const set = new Set(this.expandedParagraphs());
    set.add(cite.unitId);
    this.expandedParagraphs.set(set);

    const explorerEl = document.getElementById('explorer');
    if (explorerEl) {
      explorerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    this.toast.info(`Inspecting Citation: Page ${cite.pageNumber} · Paragraph ${cite.paragraphNumber}`);
  }

  copyParagraph(text: string): void {
    navigator.clipboard.writeText(text).then(() => {
      this.toast.success('Passage text copied');
    });
  }

  downloadPdfReport(): void {
    const d = this.doc();
    if (!d) return;
    const name = d.filename.replace(/\.[^/.]+$/, '') + '-compliance-report.pdf';
    this.docsService.downloadPdfReport(d.id, name).subscribe({
      next: (downloadedAs) => {
        this.toast.success('PDF Report downloaded', downloadedAs);
      },
      error: () => {
        this.toast.error('Download failed', 'Could not download PDF report.');
      },
    });
  }

  downloadTxtReport(): void {
    const d = this.doc();
    if (!d) return;
    const name = d.filename.replace(/\.[^/.]+$/, '') + '-trade-compliance-report.txt';
    this.docsService.downloadReport(d.id, name).subscribe({
      next: (downloadedAs) => {
        this.toast.success('Compliance Report downloaded', downloadedAs);
      },
      error: () => {
        this.toast.error('Download failed', 'Could not download text report.');
      },
    });
  }

  openOverrideDialog(action: string, newDecision: ComplianceDecision): void {
    this.pendingAction.set(action);
    this.pendingNewDecision.set(newDecision);
    this.overrideReason = '';
    this.showOverrideBox.set(true);
  }

  submitHumanOverride(): void {
    if (!this.overrideReason.trim()) return;

    this.docsService.overrideDecision(this.id(), {
      action: this.pendingAction(),
      officerName: this.overrideOfficerName || 'Compliance Officer',
      officerRole: 'Senior Trade Compliance Officer',
      newDecision: this.pendingNewDecision(),
      reason: this.overrideReason,
    }).subscribe({
      next: (updatedDoc) => {
        this.doc.set(updatedDoc);
        this.showOverrideBox.set(false);
        this.toast.success('Compliance Decision Overridden & Audited', `New Decision: ${this.pendingNewDecision()}`);
      },
      error: (err: any) => {
        this.toast.error('Override failed', err.message);
      },
    });
  }

  getRiskSeverityLabel(score: number): string {
    if (score >= 80) return 'CRITICAL';
    if (score >= 60) return 'HIGH';
    if (score >= 40) return 'ELEVATED';
    if (score >= 20) return 'MODERATE';
    return 'LOW';
  }

  protected readonly formatBytes = formatBytes;
  protected readonly formatDuration = formatDuration;
}
