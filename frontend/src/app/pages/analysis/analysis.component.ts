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
  DocumentDetail,
  TradeComplianceAnalysis,
  ComplianceDecision,
  ProductPriceIntelligenceResult,
  ProductRegulatoryIntelligenceResult,
} from '../../models/api.models';

import { formatBytes, formatDuration } from '../../shared/format';
import { Icon } from '../../shared/components/icon';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ReportModal } from '../../shared/components/report-modal';

@Component({
  selector: 'app-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    DatePipe,
    DecimalPipe,
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
                <div class="row gap-12 small muted mt-4 wrap align-center">
                  <span>{{ formatBytes(doc()?.fileSize || 0) }}</span>
                  <span class="sep">·</span>
                  <span>{{ doc()?.extraction?.pageCount || 1 }} Pages</span>
                  @if (tc(); as t) {
                    <span class="sep">·</span>
                    <span class="font-bold text-accent">{{ t.transaction.currency }} {{ t.transaction.totalValue | number:'1.2-2' }}</span>
                    <span class="sep">·</span>
                    <span>{{ t.goods.length }} Commodity Lines</span>
                    <span class="sep">·</span>
                    <span class="font-mono">Customer Ref: {{ t.transaction.customerReference }}</span>
                  }
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

              <!-- Shipment & Maritime Route Intelligence Strip -->
              <div class="card p-12 mt-16 bg-muted-surface border-muted">
                <div class="row between align-center wrap gap-8 mb-8">
                  <div class="row align-center gap-8">
                    <app-icon name="anchor" [size]="16" />
                    <span class="eyebrow font-bold">Maritime Carriage & Voyage Route</span>
                    @if (t.transaction.vesselName) {
                      <span class="chip small font-bold">{{ t.transaction.vesselName }}</span>
                    }
                    @if (t.transaction.vesselImo) {
                      <span class="chip chip-info small font-mono">IMO {{ t.transaction.vesselImo }}</span>
                    }
                  </div>
                  @if (t.maritimeIntelligence; as mi) {
                    <div class="row align-center gap-6">
                      <span class="chip small" [class.chip-positive]="mi.routeRiskLevel === 'LOW'" [class.chip-warning]="mi.routeRiskLevel === 'MEDIUM'" [class.chip-negative]="mi.routeRiskLevel === 'HIGH' || mi.routeRiskLevel === 'CRITICAL'">
                        {{ mi.routeClassification }}
                      </span>
                      <button class="btn btn-sm btn-ghost p-2" (click)="activeTab.set('maritime')">
                        <span>Inspect AIS Route →</span>
                      </button>
                    </div>
                  }
                </div>

                <div class="route-strip">
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
                  @if (t.maritimeIntelligence?.observedRoute?.intermediateCalls && t.maritimeIntelligence!.observedRoute!.intermediateCalls.length > 0) {
                    @for (call of t.maritimeIntelligence!.observedRoute!.intermediateCalls; track call.port.locode) {
                      <div class="route-node">
                        <span class="route-dot" [class.transit-dot]="call.wasDeclared" [class.bg-neg]="!call.wasDeclared"></span>
                        <span class="route-label">{{ call.wasDeclared ? 'Transit Hub' : 'Undeclared Port' }}</span>
                        <span class="route-val">{{ call.port.name }} ({{ call.port.locode }})</span>
                      </div>
                      <div class="route-arrow">→</div>
                    }
                  } @else if (t.transaction.transitCountries && t.transaction.transitCountries.length > 0) {
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
                  <span>TBML & Pricing</span>
                  @if (t.tbml.redFlags.length > 0) {
                    <span class="tab-badge badge-alert">{{ t.tbml.redFlags.length }}</span>
                  }
                </button>

                <button class="tab-btn" [class.active]="activeTab() === 'maritime'" (click)="activeTab.set('maritime')">
                  <app-icon name="anchor" [size]="15" />
                  <span>Maritime Route & AIS</span>
                  @if (t.maritimeIntelligence?.routeDeviationDetected) {
                    <span class="tab-badge badge-warning">!</span>
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

                <button class="tab-btn" [class.active]="activeTab() === 'pricing'" (click)="activeTab.set('pricing')">
                  <app-icon name="scale" [size]="15" />
                  <span>Market Pricing</span>
                  @if (t.pricingIntelligence && hasPriceAnomaly(t.pricingIntelligence)) {
                    <span class="tab-badge badge-warning">!</span>
                  }
                </button>

                <button class="tab-btn" [class.active]="activeTab() === 'regulatory'" (click)="activeTab.set('regulatory')">
                  <app-icon name="file" [size]="15" />
                  <span>Product Regulatory & SBP</span>
                  @if (t.productRegulatoryIntelligence && hasRestrictedGoods(t.productRegulatoryIntelligence)) {
                    <span class="tab-badge badge-warning">!</span>
                  }
                </button>

                <button class="tab-btn" [class.active]="activeTab() === 'customerBehavior'" (click)="activeTab.set('customerBehavior')">
                  <app-icon name="user" [size]="15" />
                  <span>Customer 360 & Behavior</span>
                  @if (t.customerBehavioralAssessment?.alerts && t.customerBehavioralAssessment!.alerts.length > 0) {
                    <span class="tab-badge badge-alert">{{ t.customerBehavioralAssessment!.alerts.length }}</span>
                  }
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

              <!-- Tab 3: TBML -->
              <!-- Tab: Maritime Route Intelligence & Transshipment Detection -->
              @if (activeTab() === 'maritime') {
                <div class="tab-pane">
                  @if (t.maritimeIntelligence; as mi) {
                    <!-- Maritime Header Banner -->
                    <div class="card p-20 mb-20 bg-raised border-muted" style="border-left: 6px solid var(--accent); padding-left: 28px !important; box-shadow: 0 4px 20px -2px rgba(0,0,0,0.05);">
                      <div class="row between align-center wrap gap-16">
                        <div class="col gap-10">
                          <div class="row align-center wrap gap-12">
                            <div style="width: 38px; height: 38px; border-radius: 8px; background: var(--accent-soft); border: 1px solid var(--accent-ring); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                              <app-icon name="anchor" [size]="20" class="text-accent" />
                            </div>
                            <h3 class="h2 font-bold text-ink" style="font-size: 1.35rem; margin: 0; letter-spacing: -0.01em;">{{ mi.vessel?.name || t.transaction.vesselName || 'Commercial Cargo Vessel' }}</h3>
                            @if (mi.vessel?.imo || t.transaction.vesselImo) {
                              <span class="chip chip-info font-bold font-mono" style="padding: 4px 10px; font-size: 0.85rem;">IMO: {{ mi.vessel?.imo || t.transaction.vesselImo }}</span>
                            }
                            @if (mi.vessel?.flag) {
                              <span class="chip font-medium" style="padding: 4px 10px; font-size: 0.85rem;">Flag: {{ mi.vessel?.flag }}</span>
                            }
                          </div>

                          <div class="row wrap gap-16 align-center mt-12 p-12 bg-sunken rounded border-muted text-ink font-medium" style="font-size: 0.92rem;">
                            <span><strong class="muted uppercase" style="font-size: 0.78rem;">Voyage:</strong> {{ t.transaction.voyageNumber || 'Scheduled Liner' }}</span>
                            <span class="muted">•</span>
                            <span><strong class="muted uppercase" style="font-size: 0.78rem;">B/L:</strong> {{ t.transaction.billOfLadingNumber || 'As Presented' }}</span>
                            <span class="muted">•</span>
                            <span><strong class="muted uppercase" style="font-size: 0.78rem;">Container:</strong> {{ t.transaction.containerNumber || 'FCL' }}</span>
                            @if (t.transaction.etd) {
                              <span class="muted">•</span>
                              <span><strong class="muted uppercase" style="font-size: 0.78rem;">ETD:</strong> {{ t.transaction.etd }}</span>
                            }
                            @if (t.transaction.eta) {
                              <span class="muted">•</span>
                              <span><strong class="muted uppercase" style="font-size: 0.78rem;">ETA:</strong> {{ t.transaction.eta }}</span>
                            }
                          </div>
                        </div>

                        <div class="row gap-12 align-center">
                          <span class="chip font-bold" style="padding: 8px 16px; font-size: 0.92rem;" [class.chip-positive]="mi.routeRiskLevel === 'LOW'" [class.chip-warning]="mi.routeRiskLevel === 'MEDIUM'" [class.chip-negative]="mi.routeRiskLevel === 'HIGH' || mi.routeRiskLevel === 'CRITICAL'">
                            {{ mi.routeClassification }}
                          </span>
                          <span class="font-mono font-bold" style="font-size: 1.4rem;">{{ mi.routeRiskScore }}/100</span>
                        </div>
                      </div>
                    </div>

                    <!-- Transshipment Metrics Overview Grid -->
                    <div class="math-grid mb-20" style="gap: 14px; margin-top: 14px;">
                      <div class="card p-14 bg-raised rounded border-muted" style="border-top: 3px solid var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
                        <span class="muted eyebrow font-bold" style="font-size: 0.78rem; letter-spacing: 0.04em; margin-bottom: 4px; display: block;">Intermediate Calls</span>
                        <strong class="font-mono font-bold text-ink" style="font-size: 1.3rem; display: block; line-height: 1.2;">{{ mi.intermediatePortsCount }} Ports</strong>
                      </div>
                      <div class="card p-14 bg-raised rounded border-muted" style="border-top: 3px solid var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
                        <span class="muted eyebrow font-bold" style="font-size: 0.78rem; letter-spacing: 0.04em; margin-bottom: 4px; display: block;">Undeclared Port Calls</span>
                        <strong class="font-mono font-bold" style="font-size: 1.3rem; display: block; line-height: 1.2;" [class.text-negative]="mi.undeclaredIntermediatePortsCount > 0" [class.text-ink]="mi.undeclaredIntermediatePortsCount === 0">{{ mi.undeclaredIntermediatePortsCount }} Ports</strong>
                      </div>
                      <div class="card p-14 bg-raised rounded border-muted" style="border-top: 3px solid var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
                        <span class="muted eyebrow font-bold" style="font-size: 0.78rem; letter-spacing: 0.04em; margin-bottom: 4px; display: block;">Route Deviation</span>
                        <strong style="font-size: 1.2rem; display: block; line-height: 1.2;" [class.text-negative]="mi.routeDeviationDetected" [class.text-positive]="!mi.routeDeviationDetected">
                          {{ mi.routeDeviationDetected ? 'DETECTED' : 'CONFORMANT' }}
                        </strong>
                      </div>
                      <div class="card p-14 bg-raised rounded border-muted" style="border-top: 3px solid var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
                        <span class="muted eyebrow font-bold" style="font-size: 0.78rem; letter-spacing: 0.04em; margin-bottom: 4px; display: block;">Evidence Confidence</span>
                        <strong class="font-mono font-bold text-accent" style="font-size: 1.3rem; display: block; line-height: 1.2;">{{ ((mi.evidenceRecords[0]?.dataConfidence || 0.95) * 100).toFixed(0) }}%</strong>
                      </div>
                    </div>

                    <!-- Reconstructed Port-Call Sequence Table -->
                    @if (mi.observedRoute?.intermediateCalls && mi.observedRoute!.intermediateCalls.length > 0) {
                      <div class="table-responsive mb-20">
                        <table class="compliance-table">
                          <thead>
                            <tr>
                              <th>Port Name</th>
                              <th>UN/LOCODE</th>
                              <th>Jurisdiction</th>
                              <th>Observed Timing</th>
                              <th>Declared in Docs</th>
                              <th>Jurisdiction Risk</th>
                            </tr>
                          </thead>
                          <tbody>
                            @for (call of mi.observedRoute!.intermediateCalls; track call.port.locode) {
                              <tr>
                                <td class="font-bold" style="font-size: 0.98rem;">{{ call.port.name }}</td>
                                <td class="font-mono">{{ call.port.locode }}</td>
                                <td>{{ call.port.country }}</td>
                                <td>{{ call.arrivalTime || call.departureTime || 'Voyage Window' }}</td>
                                <td>
                                  @if (call.wasDeclared) {
                                    <span class="chip chip-positive font-bold">Declared</span>
                                  } @else {
                                    <span class="chip chip-warning font-bold">Undeclared</span>
                                  }
                                </td>
                                <td>
                                  <span class="chip font-bold" [class.chip-positive]="call.jurisdictionRiskLevel === 'CLEAR'" [class.chip-warning]="call.jurisdictionRiskLevel === 'ELEVATED'" [class.chip-negative]="call.jurisdictionRiskLevel === 'SANCTIONED'">
                                    {{ call.jurisdictionRiskLevel }}
                                  </span>
                                </td>
                              </tr>
                            }
                          </tbody>
                        </table>
                      </div>
                    }

                    <!-- Route Findings & Explainability -->
                    @if (mi.routeFindings.length > 0) {
                      <div class="grid gap-14 mb-20">
                        @for (finding of mi.routeFindings; track $index) {
                          <div class="intel-card" [class.intel-card-danger]="mi.routeRiskLevel === 'CRITICAL' || mi.routeRiskLevel === 'HIGH'" [class.intel-card-warning]="mi.routeRiskLevel === 'MEDIUM'" [class.intel-card-success]="mi.routeRiskLevel === 'LOW'">
                            <div class="row between align-center wrap gap-8">
                              <div class="row align-center gap-8">
                                <app-icon name="compass" [size]="18" class="text-accent" />
                                <span class="font-bold text-ink" style="font-size: 1.12rem;">Route Finding #{{ $index + 1 }}</span>
                              </div>
                              <span class="chip font-bold" [class.chip-negative]="mi.routeRiskLevel === 'CRITICAL' || mi.routeRiskLevel === 'HIGH'" [class.chip-warning]="mi.routeRiskLevel === 'MEDIUM'" [class.chip-positive]="mi.routeRiskLevel === 'LOW'">
                                {{ mi.routeRiskLevel }} RISK
                              </span>
                            </div>
                            <div class="intel-callout mt-12">
                              <p class="mb-0">{{ finding }}</p>
                            </div>
                          </div>
                        }
                      </div>
                    }

                    <!-- Mandatory Legal Limitation Notice -->
                    <div class="intel-card intel-card-info mb-12">
                      <div class="row gap-8 align-center">
                        <app-icon name="info" [size]="18" class="text-accent" />
                        <span class="eyebrow font-bold text-ink" style="font-size: 0.86rem;">MARITIME EVIDENCE LIMITATION NOTICE:</span>
                      </div>
                      <div class="intel-callout mt-10">
                        <p class="mb-0">{{ mi.limitationNotice }}</p>
                      </div>
                    </div>
                  } @else {
                    <div class="empty-state-pills p-18">
                      <div class="row gap-10 align-center text-accent">
                        <app-icon name="info" [size]="20" />
                        <span class="font-medium" style="font-size: 1.02rem;">Direct point-to-point carriage declared; historical vessel AIS tracking data unavailable for this document.</span>
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- Tab 3: TBML -->
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

              <!-- Tab 7: Real-Time Market Pricing Intelligence -->
              @if (activeTab() === 'pricing') {
                <div class="tab-pane">
                  <div class="row between align-center wrap gap-12 mb-16">
                    <div class="row gap-8 align-center">
                      <span class="eyebrow font-bold">Authentic Multi-Source Market Pricing Intelligence:</span>
                      <span class="chip chip-info font-mono small">UN Comtrade • S&P Global • FBR Customs Valuation</span>
                    </div>
                  </div>

                  @if (t.pricingIntelligence && t.pricingIntelligence.length > 0) {
                    <div class="table-responsive mb-20">
                      <table class="compliance-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Product Description</th>
                            <th>Declared Unit Price</th>
                            <th>Web Benchmark Corridor</th>
                            <th>Variance</th>
                            <th>Valuation Verdict</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (pi of t.pricingIntelligence; track pi.lineItemId) {
                            <tr>
                              <td class="font-mono">{{ pi.itemNumber }}</td>
                              <td>
                                <div class="font-medium">{{ pi.productDescription }}</div>
                                <div class="small muted font-mono">HS: {{ pi.hsCode || 'N/A' }}</div>
                              </td>
                              <td class="font-mono font-bold">
                                {{ pi.declaredCurrency }} {{ pi.declaredUnitPrice.toLocaleString('en-US', { minimumFractionDigits: 2 }) }} / {{ pi.declaredUnitOfMeasure || 'unit' }}
                              </td>
                              <td class="font-mono small">
                                @if (pi.hasMarketData) {
                                  <div class="font-medium">USD {{ pi.observedMarketLowUsd?.toFixed(2) }} – {{ pi.observedMarketHighUsd?.toFixed(2) }}</div>
                                  <div class="muted">Median: USD {{ pi.observedMarketMedianUsd?.toFixed(2) }}</div>
                                } @else {
                                  <span class="muted">Awaiting Market Data</span>
                                }
                              </td>
                              <td class="font-mono font-bold">
                                @if (pi.priceVariancePercent !== undefined) {
                                  <span [class.text-positive]="pi.classification === 'WITHIN_EXPECTED_RANGE'" [class.text-warning]="pi.classification === 'LOW_PRICE_ANOMALY'" [class.text-negative]="pi.classification === 'HIGH_PRICE_ANOMALY'">
                                    {{ pi.priceVariancePercent > 0 ? '+' : '' }}{{ pi.priceVariancePercent }}%
                                  </span>
                                } @else {
                                  <span>0%</span>
                                }
                              </td>
                              <td>
                                @if (pi.classification === 'HIGH_PRICE_ANOMALY') {
                                  <span class="chip chip-negative font-bold" title="Declared price significantly exceeds market benchmark (Over-invoicing risk)">
                                    OVER PRICED
                                  </span>
                                } @else if (pi.classification === 'LOW_PRICE_ANOMALY') {
                                  <span class="chip chip-warning font-bold" title="Declared price significantly below market benchmark (Under-invoicing risk)">
                                    UNDER PRICED
                                  </span>
                                } @else if (pi.classification === 'WITHIN_EXPECTED_RANGE') {
                                  <span class="chip chip-positive font-bold" title="Declared price is in line with authentic market benchmark">
                                    OK PRICE (FAIR MARKET)
                                  </span>
                                } @else {
                                  <span class="chip font-bold">INSUFFICIENT DATA</span>
                                }
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>

                    <!-- Evidence & Citation Cards -->
                    <div class="eyebrow font-bold text-ink mb-16" style="font-size: 0.9rem; letter-spacing: 0.05em;">AUTHORITATIVE MARKET SOURCES & VERIFICATION CITATIONS:</div>
                    <div class="grid gap-16">
                      @for (pi of t.pricingIntelligence; track pi.lineItemId) {
                        <div class="intel-card" [class.intel-card-warning]="pi.classification === 'LOW_PRICE_ANOMALY'" [class.intel-card-danger]="pi.classification === 'HIGH_PRICE_ANOMALY'" [class.intel-card-success]="pi.classification === 'WITHIN_EXPECTED_RANGE'" [class.intel-card-info]="pi.classification === 'INSUFFICIENT_MARKET_DATA'">
                          <div class="row between align-center wrap gap-12">
                            <div class="row align-center gap-8">
                              <app-icon name="scale" [size]="20" class="text-accent" />
                              <strong class="font-bold text-ink" style="font-size: 1.18rem;">{{ pi.productDescription }}</strong>
                            </div>
                            <div class="row gap-8 align-center">
                              @if (pi.classification === 'HIGH_PRICE_ANOMALY') {
                                <span class="chip chip-negative font-bold" style="padding: 4px 10px; font-size: 0.82rem;">OVER PRICED</span>
                              } @else if (pi.classification === 'LOW_PRICE_ANOMALY') {
                                <span class="chip chip-warning font-bold" style="padding: 4px 10px; font-size: 0.82rem;">UNDER PRICED</span>
                              } @else if (pi.classification === 'WITHIN_EXPECTED_RANGE') {
                                <span class="chip chip-positive font-bold" style="padding: 4px 10px; font-size: 0.82rem;">FAIR MARKET PRICE</span>
                              } @else {
                                <span class="chip chip-info font-bold" style="padding: 4px 10px; font-size: 0.82rem;">INSUFFICIENT DATA</span>
                              }
                              <span class="chip font-mono font-bold" style="font-size: 0.85rem; padding: 4px 10px;">Variance: {{ pi.priceVariancePercent || 0 }}%</span>
                            </div>
                          </div>

                          <div class="intel-callout mt-12">
                            <p class="mb-0">{{ pi.explanation }}</p>
                          </div>

                          @if (pi.evidenceRecords && pi.evidenceRecords.length > 0) {
                            <div class="col gap-10 mt-12">
                              @for (ev of pi.evidenceRecords; track ev.evidenceId) {
                                <div class="p-14 bg-raised rounded border-muted">
                                  <div class="row between align-center wrap gap-8">
                                    <span class="font-bold text-accent" style="font-size: 1.0rem;">{{ ev.publisher }} — {{ ev.sourceTitle }}</span>
                                    <span class="chip font-mono font-bold" style="font-size: 0.82rem;">{{ ev.sourceType }}</span>
                                  </div>
                                  <div class="serif-legal text-ink mt-8 p-12 bg-sunken rounded" style="font-size: 0.98rem; font-style: italic; line-height: 1.65;">"{{ ev.quotedExcerpt }}"</div>
                                  <div class="mt-8">
                                    <a [href]="ev.url" target="_blank" rel="noopener noreferrer" class="text-accent font-mono" style="font-size: 0.9rem;">{{ ev.url }} ↗</a>
                                  </div>
                                </div>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>
                  } @else {
                    <div class="empty-state-pills">
                      <div class="row gap-8 align-center text-positive">
                        <app-icon name="check-circle" [size]="18" />
                        <span class="font-medium">Market pricing evaluation queued.</span>
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- Tab 8: Customer 360 & Historical Client Comparison Analytics -->
              @if (activeTab() === 'customerBehavior') {
                <div class="tab-pane">
                  @if (t.customerBehavioralAssessment; as cb) {
                    <div class="intel-card intel-card-info mb-20">
                      <div class="row between align-center wrap gap-16">
                        <div class="row gap-14 align-center">
                          <div class="cust-circle-avatar" style="width: 48px; height: 48px; font-size: 1.25rem; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; border-radius: 50%;">
                            <app-icon name="user" [size]="24" />
                          </div>
                          <div>
                            <div class="row gap-10 align-center wrap">
                              <h3 class="h2 font-bold text-ink" style="font-size: 1.25rem;">{{ cb.customerProfile.legalName }}</h3>
                              <span class="chip font-mono font-bold chip-info" style="font-size: 0.85rem;">{{ cb.customerProfile.customerReferenceId }}</span>
                              @if (cb.comparisonAnalytics?.isReturningClient) {
                                <span class="chip chip-positive font-bold" style="font-size: 0.82rem;">
                                  RETURNING CLIENT ({{ cb.comparisonAnalytics?.previousTradesCount }} Previous Trades)
                                </span>
                              } @else {
                                <span class="chip chip-info font-bold" style="font-size: 0.82rem;">
                                  FIRST-TIME CLIENT (Baseline Inception)
                                </span>
                              }
                            </div>
                            <p class="small muted mt-4 font-medium" style="font-size: 0.92rem;">
                              {{ cb.customerProfile.declaredBusinessActivity || cb.customerProfile.businessType }} · Country: {{ cb.customerProfile.country }}
                            </p>
                          </div>
                        </div>

                        <div class="row gap-8 align-center">
                          <span class="chip font-bold" style="padding: 6px 14px; font-size: 0.88rem;" [class.chip-positive]="cb.behavioralRiskLevel === 'LOW'" [class.chip-warning]="cb.behavioralRiskLevel === 'MEDIUM'" [class.chip-negative]="cb.behavioralRiskLevel === 'HIGH'">
                            Behavioral Risk: {{ cb.behavioralRiskLevel }} ({{ cb.behavioralRiskScore }}/100)
                          </span>
                        </div>
                      </div>

                      <div class="intel-callout mt-14">
                        <div class="small font-bold text-accent mb-4 uppercase" style="font-size: 0.85rem;">Historical Trade Profile & Comparison Narrative:</div>
                        <p class="mb-0">{{ cb.comparisonAnalytics?.summaryNarrative || cb.behavioralSummary }}</p>
                      </div>
                    </div>

                    <!-- Client Analytics & Baseline Comparison Grid -->
                    <div class="grid grid-3 gap-16 mb-20">
                      <div class="card p-16 bg-raised border-muted" style="border-top: 3px solid var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
                        <span class="eyebrow font-bold text-ink" style="font-size: 0.8rem; letter-spacing: 0.04em; display: block; margin-bottom: 6px;">LIFETIME TRANSACTION HISTORY</span>
                        <div class="h2 font-mono font-bold text-ink" style="font-size: 1.45rem; line-height: 1.2; margin-bottom: 6px;">{{ cb.customerProfile.lifetimeTransactionCount }} Trades</div>
                        <div class="small muted font-medium" style="font-size: 0.86rem;">
                          Cumulative Volume: <strong class="text-ink">USD {{ cb.customerProfile.lifetimeVolumeUsd | number }}</strong>
                        </div>
                      </div>

                      <div class="card p-16 bg-raised border-muted" style="border-top: 3px solid var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
                        <span class="eyebrow font-bold text-ink" style="font-size: 0.8rem; letter-spacing: 0.04em; display: block; margin-bottom: 6px;">HISTORICAL AVERAGE VS CURRENT VALUE</span>
                        <div class="h2 font-mono font-bold text-ink" style="font-size: 1.45rem; line-height: 1.2; margin-bottom: 6px;">
                          USD {{ cb.customerProfile.averageTransactionValueUsd | number }}
                        </div>
                        <div class="small font-mono font-bold" style="font-size: 0.86rem;" [class.text-positive]="(cb.comparisonAnalytics?.currentVsAverageValueVariancePercent || 0) <= 30" [class.text-warning]="(cb.comparisonAnalytics?.currentVsAverageValueVariancePercent || 0) > 30">
                          Current Trade Variance: {{ (cb.comparisonAnalytics?.currentVsAverageValueVariancePercent || 0) > 0 ? '+' : '' }}{{ cb.comparisonAnalytics?.currentVsAverageValueVariancePercent }}%
                        </div>
                      </div>

                      <div class="card p-16 bg-raised border-muted" style="border-top: 3px solid var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
                        <span class="eyebrow font-bold text-ink" style="font-size: 0.8rem; letter-spacing: 0.04em; display: block; margin-bottom: 8px;">CONTINUITY & TRADE ALIGNMENT</span>
                        <div class="col gap-6 mt-4">
                          <div class="row between align-center p-6 px-10 bg-sunken rounded border-muted">
                            <span class="muted font-medium uppercase" style="font-size: 0.76rem;">Commodity</span>
                            <span class="chip font-mono font-bold chip-positive" style="font-size: 0.76rem; padding: 2px 6px;">{{ cb.comparisonAnalytics?.commodityContinuity || 'ESTABLISHED' }}</span>
                          </div>
                          <div class="row between align-center p-6 px-10 bg-sunken rounded border-muted">
                            <span class="muted font-medium uppercase" style="font-size: 0.76rem;">Corridor</span>
                            <span class="chip font-mono font-bold chip-positive" style="font-size: 0.76rem; padding: 2px 6px;">{{ cb.comparisonAnalytics?.corridorContinuity || 'ESTABLISHED' }}</span>
                          </div>
                          <div class="row between align-center p-6 px-10 bg-sunken rounded border-muted">
                            <span class="muted font-medium uppercase" style="font-size: 0.76rem;">Partner</span>
                            <span class="chip font-mono font-bold chip-positive" style="font-size: 0.76rem; padding: 2px 6px;">{{ cb.comparisonAnalytics?.counterpartyContinuity || 'ESTABLISHED' }}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Behavioral Anomaly Alerts -->
                    @if (cb.alerts && cb.alerts.length > 0) {
                      <div class="eyebrow font-bold text-negative mb-12" style="font-size: 0.88rem;">Behavioral Anomaly & Rolling Baseline Divergences ({{ cb.alerts.length }}):</div>
                      <div class="col gap-12 mb-16">
                        @for (alt of cb.alerts; track alt.alertId) {
                          <div class="intel-card intel-card-danger">
                            <div class="row between align-center wrap gap-8">
                              <strong class="text-negative" style="font-size: 1.05rem;">[{{ alt.alertCode }}] {{ alt.metric }}</strong>
                              <span class="chip chip-negative font-bold">{{ alt.severity }} RISK</span>
                            </div>
                            <div class="intel-callout mt-10">
                              <p class="mb-0">{{ alt.explanation }}</p>
                            </div>
                            <div class="row gap-16 mt-10 small font-mono text-ink">
                              <span><strong>Baseline:</strong> {{ alt.baselineValue }}</span>
                              <span><strong>Observed:</strong> {{ alt.observedValue }}</span>
                            </div>
                          </div>
                        }
                      </div>
                    } @else {
                      <div class="empty-state-pills p-18">
                        <div class="row gap-10 align-center text-positive">
                          <app-icon name="check-circle" [size]="20" />
                          <span class="font-medium" style="font-size: 1.02rem;">No behavioral deviations detected. Presentation conforms with historical customer baseline.</span>
                        </div>
                      </div>
                    }
                  } @else {
                    <div class="empty-state-pills">
                      <div class="row gap-8 align-center text-positive">
                        <app-icon name="user" [size]="18" />
                        <span class="font-medium">Customer behavioral golden record evaluation completed.</span>
                      </div>
                    </div>
                  }
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

              <!-- Tab 7: Real-Time Market Pricing Intelligence -->
              @if (activeTab() === 'pricing') {
                <div class="tab-pane">
                  <div class="row gap-12 justify-between wrap align-center mb-16">
                    <div class="row gap-8 align-center">
                      <span class="eyebrow">Price Analysis Model:</span>
                      <span class="chip chip-info font-mono">TG-MARKET-PRICING-V2.1</span>
                      <span class="chip chip-neutral">Incoterm Landed Parity Active</span>
                    </div>
                    <div class="small muted">
                      5-Tier Source Hierarchy (Level 1 Official to Level 5 Web)
                    </div>
                  </div>

                  @if (t.pricingIntelligence && t.pricingIntelligence.length > 0) {
                    <div class="pricing-items-grid">
                      @for (pi of t.pricingIntelligence; track pi.lineItemId) {
                        <div class="pricing-card" [class.pricing-anomaly]="pi.classification === 'HIGH_PRICE_ANOMALY' || pi.classification === 'LOW_PRICE_ANOMALY'">
                          <div class="pricing-card-header">
                            <div class="row gap-8 align-center justify-between">
                              <div class="row gap-8 align-center">
                                <span class="eyebrow font-mono">Item #{{ pi.itemNumber }}</span>
                                <strong class="product-title">{{ pi.productDescription }}</strong>
                                @if (pi.hsCode) {
                                  <span class="chip small">HS {{ pi.hsCode }}</span>
                                }
                              </div>
                              <span class="chip" [class.chip-positive]="pi.classification === 'WITHIN_EXPECTED_RANGE'" [class.chip-warning]="pi.classification === 'LOW_PRICE_ANOMALY'" [class.chip-negative]="pi.classification === 'HIGH_PRICE_ANOMALY'" [class.chip-neutral]="pi.classification === 'INSUFFICIENT_MARKET_DATA'">
                                {{ pi.classification }}
                              </span>
                            </div>
                          </div>

                          <div class="pricing-card-body">
                            <div class="pricing-metrics-row">
                              <div class="pricing-metric-box">
                                <span class="metric-label">Declared Unit Price</span>
                                <span class="metric-val">{{ pi.declaredCurrency }} {{ pi.declaredUnitPrice | number:'1.2-2' }}</span>
                                <span class="metric-sub">{{ pi.declaredQuantity | number }} {{ pi.declaredUnitOfMeasure }} ({{ pi.declaredIncoterm }})</span>
                              </div>
                              <div class="pricing-metric-box">
                                <span class="metric-label">Benchmark Price (CIF Parity)</span>
                                <span class="metric-val">
                                  {{ pi.benchmarkUnitPriceUsd ? ('USD ' + (pi.benchmarkUnitPriceUsd | number:'1.2-2')) : 'N/A' }}
                                </span>
                                <span class="metric-sub">
                                  @if (pi.observedMarketLowUsd && pi.observedMarketHighUsd) {
                                    Range: USD {{ pi.observedMarketLowUsd }} - USD {{ pi.observedMarketHighUsd }}
                                  } @else {

                                    Custom non-standard item
                                  }
                                </span>
                              </div>
                              <div class="pricing-metric-box">
                                <span class="metric-label">Market Price Variance</span>
                                <span class="metric-val font-mono" [class.text-danger]="pi.classification === 'HIGH_PRICE_ANOMALY'" [class.text-warning]="pi.classification === 'LOW_PRICE_ANOMALY'" [class.text-success]="pi.classification === 'WITHIN_EXPECTED_RANGE'">
                                  {{ pi.priceVariancePercent !== undefined ? ((pi.priceVariancePercent > 0 ? '+' : '') + pi.priceVariancePercent + '%') : 'N/A' }}
                                </span>
                                <span class="metric-sub">Confidence: {{ pi.confidence }}</span>
                              </div>
                            </div>

                            <p class="pricing-explanation mt-12 mb-12">{{ pi.explanation }}</p>

                            @if (pi.evidenceRecords && pi.evidenceRecords.length > 0) {
                              <div class="pricing-evidence-box">
                                <div class="eyebrow mb-6">Market Evidence Provenance:</div>
                                @for (ev of pi.evidenceRecords; track ev.evidenceId) {
                                  <div class="evidence-entry">
                                    <div class="row gap-8 align-center justify-between">
                                      <div class="row gap-8 align-center">
                                        <span class="chip small chip-info">{{ ev.sourceAuthorityLevel }}</span>
                                        <strong>{{ ev.sourceTitle }}</strong>
                                        <span class="small muted">({{ ev.publisher }})</span>
                                      </div>
                                      <span class="small muted font-mono">Retrieved: {{ ev.retrievedAt | date:'short' }}</span>
                                    </div>
                                    <blockquote class="evidence-quote mt-6">
                                      "{{ ev.quotedExcerpt }}"
                                    </blockquote>
                                    <div class="row gap-8 align-center justify-between mt-4">
                                      <a [href]="ev.url" target="_blank" rel="noopener noreferrer" class="evidence-link small">
                                        {{ ev.url }}
                                      </a>
                                      <span class="small muted font-mono">SHA-256: {{ ev.contentHashSha256.slice(0, 16) }}...</span>
                                    </div>
                                  </div>
                                }
                              </div>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  } @else {
                    <div class="empty-state-tab">
                      <p class="muted">No market pricing intelligence results available for this document.</p>
                    </div>
                  }
                </div>
              }

              <!-- Tab 8: Product Regulatory & Pakistan Trade Policy -->
              @if (activeTab() === 'regulatory') {
                <div class="tab-pane">
                  <div class="row gap-12 justify-between wrap align-center mb-16">
                    <div class="row gap-8 align-center">
                      <span class="eyebrow">Regulatory Framework:</span>
                      <span class="chip chip-info font-mono">PAKISTAN-IPO-2022 / SBP-FE-MANUAL</span>
                      <span class="chip chip-neutral">Bitemporal Point-in-Time Active</span>
                    </div>
                    <div class="small muted">
                      Statutory S.R.O. Orders & Appendices A/B Evaluation
                    </div>
                  </div>

                  @if (t.productRegulatoryIntelligence && t.productRegulatoryIntelligence.length > 0) {
                    <div class="regulatory-items-list">
                      @for (pri of t.productRegulatoryIntelligence; track pri.lineItemId) {
                        <div class="regulatory-card mb-16">
                          <div class="regulatory-card-header">
                            <div class="row gap-8 align-center justify-between">
                              <div class="row gap-8 align-center">
                                <span class="eyebrow font-mono">Item #{{ pri.itemNumber }}</span>
                                <strong>{{ pri.productDescription }}</strong>
                                <span class="chip small chip-neutral">{{ pri.countryOfOrigin }} &rarr; {{ pri.destinationCountry }}</span>
                              </div>
                              <div class="row gap-6 align-center">
                                <span class="chip" [class.chip-positive]="pri.currentRestrictionStatus === 'PERMITTED'" [class.chip-warning]="pri.currentRestrictionStatus === 'LICENSED' || pri.currentRestrictionStatus === 'RESTRICTED'" [class.chip-negative]="pri.currentRestrictionStatus === 'PROHIBITED'">
                                  {{ pri.currentRestrictionStatus }}
                                </span>
                                <span class="chip small font-mono" [class.chip-info]="pri.temporalStatus === 'ACTIVE_AT_TRANSACTION_DATE'" [class.chip-warning]="pri.temporalStatus === 'ADDED_AFTER_TRANSACTION'">
                                  {{ pri.temporalStatus }}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div class="regulatory-card-body">
                            <p class="regulatory-explanation mt-8 mb-12">{{ pri.regulatoryExplanation }}</p>

                            @if (pri.pakistanAssessment) {
                              <div class="pakistan-policy-box">
                                <div class="row gap-12 wrap mb-8">
                                  <div>
                                    <span class="eyebrow">IPO 2022 Appendix:</span>
                                    <span class="font-bold ml-4">{{ pri.pakistanAssessment.ipoAppendixClassification || 'Free List' }}</span>
                                  </div>
                                  <div>
                                    <span class="eyebrow">Statutory Verdict:</span>
                                    <span class="chip small chip-info ml-4">{{ pri.pakistanAssessment.statutoryVerdict }}</span>
                                  </div>
                                  @if (pri.pakistanAssessment.applicableSro) {
                                    <div>
                                      <span class="eyebrow">Statutory Order:</span>
                                      <span class="font-mono small ml-4">{{ pri.pakistanAssessment.applicableSro }}</span>
                                    </div>
                                  }
                                </div>

                                @if (pri.pakistanAssessment.requiredPermits && pri.pakistanAssessment.requiredPermits.length > 0) {
                                  <div class="permits-row mt-8">
                                    <span class="eyebrow">Mandatory Regulatory Authorizations:</span>
                                    <div class="row gap-6 wrap mt-4">
                                      @for (permit of pri.pakistanAssessment.requiredPermits; track permit) {
                                        <span class="chip chip-warning small">{{ permit }}</span>
                                      }
                                    </div>
                                  </div>
                                }

                                @if (pri.pakistanAssessment.originSpecificRule; as osr) {
                                  <div class="origin-rule-notice mt-8">
                                    <span class="eyebrow">Origin Rule Evaluation ({{ osr.originCountry }}):</span>
                                    <div class="small mt-2">
                                      {{ osr.statutoryBasis }}
                                      @if (osr.isExemptedForThisTransaction) {
                                        <span class="text-success font-bold"> &mdash; Statutorily Exempted under S.R.O. 927(I)/2019</span>
                                      }
                                    </div>
                                  </div>
                                }
                              </div>
                            }

                            @if (pri.governingInstruments && pri.governingInstruments.length > 0) {
                              <div class="governing-instruments mt-12">
                                <div class="eyebrow mb-6">Governing Legal Instruments:</div>
                                @for (inst of pri.governingInstruments; track inst.instrumentId) {
                                  <div class="instrument-pill-entry">
                                    <strong>{{ inst.referenceNumber }}</strong>: {{ inst.title }}
                                    <span class="small muted font-mono ml-4">(Effective: {{ inst.effectiveDate }})</span>
                                  </div>
                                }
                              </div>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  } @else {
                    <div class="empty-state-tab">
                      <p class="muted">No product regulatory intelligence available for this document.</p>
                    </div>
                  }
                </div>
              }

              <!-- Tab 9: Customer 360 & Historical Behavioral Analytics -->
              @if (activeTab() === 'customerBehavior') {
                <div class="tab-pane">
                  @if (t.customerBehavioralAssessment; as cba) {
                    <div class="customer-360-header mb-16">
                      <div class="customer-profile-card">
                        <div class="row gap-12 justify-between wrap align-center">
                          <div class="row gap-10 align-center">
                            <div class="cust-avatar">
                              <app-icon name="user" [size]="20" />
                            </div>
                            <div>
                              <div class="row gap-8 align-center">
                                <h3 class="h3 mb-0">{{ cba.customerProfile.legalName }}</h3>
                                <span class="chip font-mono chip-info">{{ cba.customerProfile.customerReferenceId }}</span>
                                <span class="chip small" [class.chip-positive]="cba.behavioralRiskLevel === 'LOW'" [class.chip-warning]="cba.behavioralRiskLevel === 'MEDIUM'" [class.chip-negative]="cba.behavioralRiskLevel === 'HIGH'">
                                  Risk: {{ cba.behavioralRiskLevel }} ({{ cba.behavioralRiskScore }}/100)
                                </span>
                              </div>
                              <div class="small muted mt-2">
                                <strong>NTN/Tax:</strong> {{ cba.customerProfile.taxVatNumber || 'N/A' }} ·
                                <strong>Country:</strong> {{ cba.customerProfile.country }} ·
                                <strong>Business:</strong> {{ cba.customerProfile.businessType }}
                              </div>
                            </div>
                          </div>
                          <div class="entity-resolution-badge">
                            <span class="eyebrow">Entity Resolution:</span>
                            <span class="chip small chip-neutral font-mono">{{ cba.entityResolution.resolutionMethod }} ({{ (cba.entityResolution.matchConfidence * 100).toFixed(0) }}%)</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Baseline KPIs vs Current Presentation -->
                    <div class="baseline-kpis-grid mb-20">
                      <div class="baseline-kpi-card">
                        <span class="kpi-label">Monthly LC Frequency</span>
                        <div class="kpi-values-row">
                          <div>
                            <span class="kpi-num">{{ cba.baselines.historicalLcFrequencyMean | number:'1.1-1' }}</span>
                            <span class="kpi-desc">Historical Mean (std dev: {{ cba.baselines.historicalLcFrequencyStdDev }})</span>
                          </div>
                        </div>
                      </div>

                      <div class="baseline-kpi-card">
                        <span class="kpi-label">Average Transaction Value</span>
                        <div class="kpi-values-row">
                          <div>
                            <span class="kpi-num">USD {{ cba.baselines.historicalAverageValueUsd | number }}</span>
                            <span class="kpi-desc">Average across {{ cba.customerProfile.lifetimeTransactionCount }} LCs</span>
                          </div>

                        </div>
                      </div>

                      <div class="baseline-kpi-card">
                        <span class="kpi-label">Established Commodity Categories</span>
                        <div class="row gap-4 wrap mt-4">
                          @for (cat of cba.baselines.establishedCategories; track cat) {
                            <span class="chip small chip-neutral">{{ cat }}</span>
                          }
                        </div>
                      </div>

                      <div class="baseline-kpi-card">
                        <span class="kpi-label">Established Trade Corridors</span>
                        <div class="row gap-4 wrap mt-4">
                          @for (co of cba.baselines.establishedCountries; track co) {
                            <span class="chip small chip-neutral">{{ co }}</span>
                          }
                        </div>
                      </div>
                    </div>

                    <!-- Behavioral Alerts -->
                    @if (cba.alerts && cba.alerts.length > 0) {
                      <div class="behavioral-alerts-section mb-20">
                        <div class="eyebrow mb-10 text-danger">Active Behavioral Anomaly Alerts ({{ cba.alerts.length }}):</div>
                        <div class="behavioral-alerts-list">
                          @for (alt of cba.alerts; track alt.alertId) {
                            <div class="behavioral-alert-card" [class.alert-high]="alt.severity === 'HIGH'">
                              <div class="row gap-8 align-center justify-between">
                                <div class="row gap-8 align-center">
                                  <span class="chip small chip-negative">{{ alt.alertCode }}</span>
                                  <strong>{{ alt.metric }}</strong>
                                </div>
                                <span class="chip small" [class.chip-negative]="alt.severity === 'HIGH'" [class.chip-warning]="alt.severity === 'MODERATE'">
                                  {{ alt.severity }}
                                </span>
                              </div>
                              <p class="alert-explanation mt-8 mb-8">{{ alt.explanation }}</p>
                              <div class="alert-comparison-row">
                                <span class="small"><strong>Baseline:</strong> {{ alt.baselineValue }}</span>
                                <span class="small font-bold text-danger"><strong>Observed:</strong> {{ alt.observedValue }}</span>
                                @if (alt.deviationPercent) {
                                  <span class="chip small chip-negative font-mono">+{{ alt.deviationPercent }}% Spike</span>
                                }
                              </div>
                              @if (alt.evidence && alt.evidence.length > 0) {
                                <div class="alert-evidence-list mt-8">
                                  @for (ev of alt.evidence; track ev) {
                                    <div class="small muted">&bull; {{ ev }}</div>
                                  }
                                </div>
                              }
                            </div>
                          }
                        </div>
                      </div>
                    } @else {
                      <div class="empty-alerts-box mb-20">
                        <app-icon name="check-circle" [size]="18" />
                        <span>No behavioral anomalies detected. Transaction is fully consistent with established customer historical trading patterns.</span>
                      </div>
                    }

                    <!-- Recommendations -->
                    @if (cba.analyticalRecommendations && cba.analyticalRecommendations.length > 0) {
                      <div class="behavioral-recommendations-card">
                        <div class="eyebrow mb-8">Analytical Due Diligence Recommendations:</div>
                        @for (rec of cba.analyticalRecommendations; track rec) {
                          <div class="row gap-8 align-center mb-6">
                            <app-icon name="arrowRight" [size]="14" />
                            <span class="small">{{ rec }}</span>
                          </div>
                        }
                      </div>
                    }
                  } @else {
                    <div class="empty-state-tab">
                      <p class="muted">No customer behavioral risk assessment data available for this document.</p>
                    </div>
                  }
                </div>
              }
            </div>
          </section>
        }


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

    /* ── Market Pricing Intelligence Styles ── */
    .pricing-items-grid { display: flex; flex-direction: column; gap: 16px; }

    .pricing-card {
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      overflow: hidden;
    }
    .pricing-card.pricing-anomaly {
      border-color: #f59e0b;
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.12);
    }
    .pricing-card-header {
      padding: 12px 18px;
      background: var(--sunken);
      border-bottom: 1px solid var(--line);
    }
    .pricing-card-body { padding: 16px 18px; }
    .pricing-metrics-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    .pricing-metric-box {
      padding: 12px 14px;
      background: var(--sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .metric-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    .metric-val { font-size: 1.15rem; font-weight: 700; color: var(--ink); }
    .metric-sub { font-size: 0.76rem; color: var(--muted); }
    .pricing-explanation {
      font-size: 0.94rem;
      line-height: 1.62;
      color: var(--ink);
    }
    .pricing-evidence-box {
      margin-top: 14px;
      padding: 12px 16px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
    }
    .evidence-entry {
      padding: 10px 0;
      border-bottom: 1px dashed var(--line);
    }
    .evidence-entry:last-child { border-bottom: none; }
    .evidence-quote {
      margin: 6px 0;
      padding: 8px 14px;
      border-left: 3px solid var(--accent);
      background: var(--sunken);
      font-family: var(--font-serif);
      font-size: 0.95rem;
      line-height: 1.65;
      font-style: italic;
      color: var(--ink);
    }
    .evidence-link {
      color: var(--accent);
      text-decoration: none;
      word-break: break-all;
    }
    .evidence-link:hover { text-decoration: underline; }

    /* ── Product Regulatory & Pakistan Policy Styles ── */
    .regulatory-items-list { display: flex; flex-direction: column; gap: 16px; }
    .regulatory-card {
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      overflow: hidden;
    }
    .regulatory-card-header {
      padding: 12px 18px;
      background: var(--sunken);
      border-bottom: 1px solid var(--line);
    }
    .regulatory-card-body { padding: 16px 18px; }
    .regulatory-explanation {
      font-family: var(--font-serif);
      font-size: 0.95rem;
      line-height: 1.65;
      color: var(--ink);
    }
    .pakistan-policy-box {
      padding: 12px 16px;
      background: var(--sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      margin-top: 8px;
    }
    .origin-rule-notice {
      padding: 8px 12px;
      background: var(--raised);
      border-left: 3px solid #10b981;
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    }
    .instrument-pill-entry {
      padding: 4px 8px;
      font-size: 0.78rem;
      color: var(--muted);
    }

    /* ── Customer 360 & Behavioral Risk Styles ── */
    .customer-profile-card {
      padding: 16px 20px;
      background: var(--sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
    }
    .cust-avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--raised);
      border: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent);
    }
    .baseline-kpis-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
    }
    .baseline-kpi-card {
      padding: 14px 16px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .kpi-label { font-size: 0.75rem; text-transform: uppercase; color: var(--muted); letter-spacing: 0.05em; }
    .kpi-num { font-size: 1.4rem; font-weight: 700; color: var(--ink); display: block; }
    .kpi-desc { font-size: 0.74rem; color: var(--muted); }

    .behavioral-alerts-list { display: flex; flex-direction: column; gap: 12px; }
    .behavioral-alert-card {
      padding: 14px 18px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
    }
    .behavioral-alert-card.alert-high {
      border-left: 4px solid #ef4444;
    }
    .alert-explanation { font-size: 0.88rem; line-height: 1.5; color: var(--ink); }
    .alert-comparison-row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 8px 12px;
      background: var(--sunken);
      border-radius: var(--radius-sm);
    }
    .alert-evidence-list {
      padding-left: 8px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .empty-alerts-box {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 18px;
      background: var(--sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      color: #10b981;
      font-size: 0.88rem;
    }
    .behavioral-recommendations-card {
      padding: 16px 20px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
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

  readonly activeTab = signal<
    | 'sanctions'
    | 'exportControls'
    | 'tbml'
    | 'maritime'
    | 'integrity'
    | 'discrepancies'
    | 'scores'
    | 'pricing'
    | 'regulatory'
    | 'customerBehavior'
  >('sanctions');

  hasPriceAnomaly(items: ProductPriceIntelligenceResult[]): boolean {
    return items.some((i) => i.classification === 'HIGH_PRICE_ANOMALY' || i.classification === 'LOW_PRICE_ANOMALY');
  }

  hasRestrictedGoods(items: ProductRegulatoryIntelligenceResult[]): boolean {
    return items.some((i) => i.currentRestrictionStatus !== 'PERMITTED');
  }


  // Human Override State
  readonly showOverrideBox = signal<boolean>(false);
  readonly pendingAction = signal<string>('');
  readonly pendingNewDecision = signal<ComplianceDecision>('ALLOW');
  overrideOfficerName = 'Senior Compliance Officer';
  overrideReason = '';

  readonly tc = computed<TradeComplianceAnalysis | undefined>(() => {
    return this.doc()?.analysis?.tradeCompliance;
  });

  ngOnInit(): void {
    this.loadDocumentResults();
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
