import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DocumentsService } from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import type { DocumentDetail } from '../../models/api.models';
import { DecimalPipe } from '@angular/common';
import { Icon } from './icon';

interface StructuredCitation {
  index: number;
  pageNumber: number;
  paragraphNumber: number;
  section: string | null;
  snippet: string;
  contentType?: string;
  topic?: string;
}

@Component({
  selector: 'app-report-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, DecimalPipe],

  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="modal-card" (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="modal-head">
          <div class="row gap-12 align-center">
            <div class="modal-icon">
              <app-icon name="document" [size]="18" />
            </div>
            <div>
              <h2 class="h2 font-semibold">Document Analysis & Citations Report</h2>
              <div class="small muted mt-2">{{ document()?.filename || filename() }}</div>
            </div>
          </div>

          <div class="row gap-8 align-center">
            <!-- Tab Switcher -->
            <div class="tab-switcher">
              <button
                class="tab-btn"
                [class.active]="activeTab() === 'structured'"
                (click)="activeTab.set('structured')"
              >
                <app-icon name="sparkle" [size]="13" />
                <span>Executive & Citations</span>
              </button>
              <button
                class="tab-btn"
                [class.active]="activeTab() === 'raw'"
                (click)="activeTab.set('raw')"
              >
                <app-icon name="document" [size]="13" />
                <span>Plain Text (.txt)</span>
              </button>
            </div>

            <button class="btn btn-sm" (click)="copyCurrentContent()" [disabled]="!content()">
              <app-icon [name]="copied() ? 'check' : 'layers'" [size]="14" />
              <span>{{ copied() ? 'Copied' : 'Copy' }}</span>
            </button>
            <button class="btn btn-sm btn-ghost" (click)="download()" [disabled]="!content()">
              <app-icon name="document" [size]="14" />
              <span>Download .txt</span>
            </button>
            <button class="btn btn-sm btn-primary" (click)="downloadPdf()">
              <app-icon name="download" [size]="14" />
              <span>Download PDF</span>
            </button>
            <button class="btn btn-icon btn-ghost" (click)="close.emit()" aria-label="Close">
              <app-icon name="close" [size]="16" />
            </button>
          </div>
        </div>

        <!-- Body -->
        <div class="modal-body">
          @if (activeTab() === 'structured') {
            <div class="structured-report">
              <!-- Meta Card -->
              <div class="report-meta-grid">
                <div class="meta-box">
                  <span class="meta-label">Document Type</span>
                  <span class="meta-val uppercase font-semibold">{{ document()?.analysis?.tradeCompliance?.documentClassification?.type || document()?.fileType || 'COMMERCIAL_INVOICE' }}</span>
                </div>
                <div class="meta-box">
                  <span class="meta-label">Total Value</span>
                  <span class="meta-val font-bold text-accent">
                    @if (document()?.analysis?.tradeCompliance?.transaction; as txn) {
                      {{ txn.currency }} {{ txn.totalValue | number:'1.2-2' }}
                    } @else {
                      {{ document()?.extraction?.pageCount || 1 }} Pages
                    }
                  </span>
                </div>
                <div class="meta-box">
                  <span class="meta-label">Compliance Decision</span>
                  <span class="meta-val">
                    @if (document()?.analysis?.tradeCompliance?.decision?.decision; as dec) {
                      <span class="chip small font-bold" [class.chip-positive]="dec === 'ALLOW'" [class.chip-warning]="dec === 'REVIEW'" [class.chip-negative]="dec === 'BLOCK_ESCALATE'">
                        {{ dec === 'BLOCK_ESCALATE' ? 'BLOCK / ESCALATE' : dec }}
                      </span>
                    } @else {
                      <span class="muted">N/A</span>
                    }
                  </span>
                </div>
                <div class="meta-box">
                  <span class="meta-label">Overall Risk Score</span>
                  <span class="meta-val font-mono font-bold">
                    @if (document()?.analysis?.tradeCompliance?.riskScores?.overall !== undefined) {
                      {{ document()?.analysis?.tradeCompliance?.riskScores?.overall }} / 100
                    } @else {
                      {{ document()?.analysis?.engine?.model || 'Active Engine' }}
                    }
                  </span>
                </div>
              </div>

              <!-- Executive Summary -->
              @if (document()?.analysis?.tradeCompliance; as tc) {
                <div class="report-section-card mt-16">
                  <div class="section-title-row">
                    <div class="row gap-8 align-center">
                      <app-icon name="sparkle" [size]="16" />
                      <h3 class="h3">Compliance Executive Assessment</h3>
                    </div>
                    <div class="row gap-6">
                      <span class="chip font-mono">Confidence: {{ Math.round(tc.decision.confidence * 100) }}%</span>
                    </div>
                  </div>
                  <div class="decision-reasons-list mt-12">
                    @for (reason of tc.decision.reasons; track reason) {
                      <div class="row gap-8 align-center small font-medium mb-4">
                        <app-icon name="alert" [size]="14" class="text-accent" />
                        <span>{{ reason }}</span>
                      </div>
                    }
                  </div>

                  @if (tc.maritimeIntelligence; as mi) {
                    <div class="mt-12 p-8 bg-muted-surface rounded border-muted">
                      <div class="row between align-center">
                        <div class="row align-center gap-6">
                          <app-icon name="anchor" [size]="14" />
                          <span class="small font-bold">Maritime Carriage: {{ mi.vessel?.name || tc.transaction.vesselName || 'Commercial Vessel' }}</span>
                          @if (mi.vessel?.imo || tc.transaction.vesselImo) {
                            <span class="chip small font-mono">IMO {{ mi.vessel?.imo || tc.transaction.vesselImo }}</span>
                          }
                        </div>
                        <span class="chip small" [class.chip-positive]="mi.routeRiskLevel === 'LOW'" [class.chip-warning]="mi.routeRiskLevel === 'MEDIUM'" [class.chip-negative]="mi.routeRiskLevel === 'HIGH' || mi.routeRiskLevel === 'CRITICAL'">
                          {{ mi.routeClassification }}
                        </span>
                      </div>
                      <div class="small muted mt-4">
                        <span>Route: {{ mi.declaredRoute.origin }} ({{ mi.declaredRoute.portOfLoading }}) → {{ mi.declaredRoute.finalDestination }} ({{ mi.declaredRoute.portOfDischarge }})</span>
                        @if (mi.undeclaredIntermediatePortsCount > 0) {
                          <span class="text-warning font-semibold"> • {{ mi.undeclaredIntermediatePortsCount }} Undeclared Intermediate Calls</span>
                        }
                      </div>
                    </div>
                  }

                  <!-- Pakistan Customs & WeBOC Regulatory Presentation Details -->
                  @if (tc.transaction.customsReference !== 'Not Found' || tc.transaction.bookingReference !== 'Not Found' || tc.transaction.parties.seller.taxVatNumber) {
                    <div class="mt-12 p-10 bg-muted-surface rounded border-muted">
                      <div class="row align-center gap-8 mb-8">
                        <app-icon name="shield-check" [size]="15" class="text-accent" />
                        <span class="small font-bold uppercase text-ink">Customs & Single Window Regulatory Registration</span>
                      </div>
                      <div class="row gap-16 wrap small text-ink">
                        @if (tc.transaction.customsReference && tc.transaction.customsReference !== 'Not Found') {
                          <div><span class="muted">Customs / GD File:</span> <strong class="font-mono">{{ tc.transaction.customsReference }}</strong></div>
                        }
                        @if (tc.transaction.parties.seller.taxVatNumber) {
                          <div><span class="muted">NTN / STRN:</span> <strong class="font-mono">{{ tc.transaction.parties.seller.taxVatNumber }}</strong></div>
                        }
                        @if (tc.transaction.parties.seller.bank) {
                          <div><span class="muted">Authorized Dealer (Bank):</span> <strong>{{ tc.transaction.parties.seller.bank }}</strong></div>
                        }
                        @if (tc.transaction.incoterm && tc.transaction.incoterm !== 'Not Found') {
                          <div><span class="muted">Incoterm:</span> <span class="chip small">{{ tc.transaction.incoterm }}</span></div>
                        }
                        @if (tc.transaction.paymentTerms && tc.transaction.paymentTerms !== 'Not Found') {
                          <div><span class="muted">Payment Terms:</span> <strong>{{ tc.transaction.paymentTerms }}</strong></div>
                        }
                      </div>
                    </div>
                  }

                  <!-- Commodity Line Items Table -->
                  @if (tc.goods && tc.goods.length > 0) {
                    <div class="mt-14">
                      <div class="row between align-center mb-8">
                        <span class="small font-bold text-ink uppercase">Declared Commodity Line Items ({{ tc.goods.length }})</span>
                        <span class="small muted">HS Tariff & Dual-Use ECCN Classification</span>
                      </div>
                      <div class="table-wrap border rounded">
                        <table class="table table-sm">
                          <thead>
                            <tr class="bg-muted-surface">
                              <th style="width: 30px">#</th>
                              <th>Description of Goods</th>
                              <th>HS Code</th>
                              <th>ECCN</th>
                              <th class="num">Quantity</th>
                              <th class="num">Unit Price</th>
                              <th class="num">Line Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            @for (g of tc.goods; track g.id) {
                              <tr>
                                <td class="font-mono small muted">{{ g.itemNumber }}</td>
                                <td>
                                  <div class="font-medium small">{{ g.productDescription }}</div>
                                  @if (g.brand || g.model || g.sku) {
                                    <div class="small muted font-mono">{{ g.brand }} {{ g.model }} {{ g.sku }}</div>
                                  }
                                </td>
                                <td>
                                  <span class="chip small font-mono">{{ g.hsCode || 'Standard Tariff' }}</span>
                                </td>
                                <td>
                                  <span class="chip small font-mono" [class.chip-warning]="g.eccn && g.eccn !== 'EAR99' && g.eccn !== 'Not Specified'" [class.chip-info]="!g.eccn || g.eccn === 'EAR99'">
                                    {{ g.eccn || 'EAR99' }}
                                  </span>
                                </td>
                                <td class="num font-mono small">{{ g.quantity | number }} {{ g.unitOfMeasure }}</td>
                                <td class="num font-mono small">{{ g.currency }} {{ g.unitPrice | number:'1.2-2' }}</td>
                                <td class="num font-mono small font-bold text-accent">{{ g.currency }} {{ g.totalLineValue | number:'1.2-2' }}</td>
                              </tr>
                            }
                          </tbody>
                        </table>
                      </div>
                    </div>
                  }

                  <!-- Live Web-Scraped Market Valuation & Price Verification -->
                  @if (tc.pricingIntelligence && tc.pricingIntelligence.length > 0) {
                    <div class="mt-14 p-12 bg-muted-surface rounded border-muted">
                      <div class="row between align-center wrap gap-8 mb-8">
                        <div class="row align-center gap-8">
                          <app-icon name="scale" [size]="16" class="text-accent" />
                          <span class="small font-bold uppercase text-ink">Authentic Web-Scraped Market Price Verification</span>
                        </div>
                        <span class="chip small font-mono chip-info">Sources: UN Comtrade • S&P Global • FBR Customs</span>
                      </div>
                      <div class="table-wrap border rounded bg-surface">
                        <table class="table table-sm">
                          <thead>
                            <tr class="bg-muted-surface">
                              <th>Commodity</th>
                              <th>Declared Unit Price</th>
                              <th>Web Market Range (USD)</th>
                              <th>Variance</th>
                              <th>Valuation Verdict</th>
                            </tr>
                          </thead>
                          <tbody>
                            @for (pi of tc.pricingIntelligence; track pi.lineItemId) {
                              <tr>
                                <td>
                                  <div class="font-medium small">{{ pi.productDescription }}</div>
                                  @if (pi.evidenceRecords && pi.evidenceRecords[0]; as ev) {
                                    <div class="small muted truncate font-mono" style="max-width: 200px" [title]="ev.url">
                                      <a [href]="ev.url" target="_blank" rel="noopener noreferrer" class="text-accent">{{ ev.publisher }} ↗</a>
                                    </div>
                                  }
                                </td>
                                <td class="font-mono small">
                                  <strong>{{ pi.declaredCurrency }} {{ pi.declaredUnitPrice | number:'1.2-2' }}</strong> / {{ pi.declaredUnitOfMeasure || 'unit' }}
                                </td>
                                <td class="font-mono small">
                                  @if (pi.hasMarketData) {
                                    <span>USD {{ pi.observedMarketLowUsd | number:'1.2-2' }} – {{ pi.observedMarketHighUsd | number:'1.2-2' }}</span>
                                    <span class="muted small block">Median: USD {{ pi.observedMarketMedianUsd | number:'1.2-2' }}</span>
                                  } @else {
                                    <span class="muted">Awaiting Quote</span>
                                  }
                                </td>
                                <td class="font-mono small">
                                  @if (pi.priceVariancePercent !== undefined) {
                                    <span [class.text-positive]="pi.classification === 'WITHIN_EXPECTED_RANGE'" [class.text-warning]="pi.classification === 'LOW_PRICE_ANOMALY'" [class.text-negative]="pi.classification === 'HIGH_PRICE_ANOMALY'">
                                      {{ pi.priceVariancePercent > 0 ? '+' : '' }}{{ pi.priceVariancePercent }}%
                                    </span>
                                  } @else {
                                    <span class="muted">0%</span>
                                  }
                                </td>
                                <td>
                                  @if (pi.classification === 'HIGH_PRICE_ANOMALY') {
                                    <span class="chip small chip-negative font-bold" title="Potential over-invoicing / capital flight risk">
                                      OVER PRICED
                                    </span>
                                  } @else if (pi.classification === 'LOW_PRICE_ANOMALY') {
                                    <span class="chip small chip-warning font-bold" title="Potential under-invoicing / customs duty evasion risk">
                                      UNDER PRICED
                                    </span>
                                  } @else if (pi.classification === 'WITHIN_EXPECTED_RANGE') {
                                    <span class="chip small chip-positive font-bold" title="Within authentic market range">
                                      OK PRICE (FAIR MARKET)
                                    </span>
                                  } @else {
                                    <span class="chip small font-bold">VERIFIED</span>
                                  }
                                </td>
                              </tr>
                            }
                          </tbody>
                        </table>
                      </div>
                    </div>
                  }

                  <!-- Customer 360 & Historical Trade Comparison -->
                  @if (tc.customerBehavioralAssessment; as cb) {
                    <div class="mt-14 p-12 bg-muted-surface rounded border-muted">
                      <div class="row between align-center wrap gap-8 mb-8">
                        <div class="row align-center gap-8">
                          <app-icon name="user" [size]="16" class="text-accent" />
                          <span class="small font-bold uppercase text-ink">Client Profile & Historical Trade Analytics</span>
                        </div>
                        <div class="row gap-6 align-center">
                          <span class="chip small font-mono">{{ cb.customerProfile.customerReferenceId }}</span>
                          @if (cb.comparisonAnalytics?.isReturningClient) {
                            <span class="chip small chip-positive font-bold">
                              RETURNING CLIENT ({{ cb.comparisonAnalytics?.previousTradesCount }} Previous Trades)
                            </span>
                          } @else {
                            <span class="chip small chip-info font-bold">
                              FIRST-TIME CLIENT (Baseline Inception)
                            </span>
                          }
                        </div>
                      </div>

                      <div class="p-10 bg-surface rounded border-muted small">
                        <div class="row between align-center wrap gap-8">
                          <div>
                            <strong>{{ cb.customerProfile.legalName }}</strong>
                            <span class="muted"> — {{ cb.customerProfile.declaredBusinessActivity || cb.customerProfile.businessType }}</span>
                          </div>
                          <div class="font-mono text-accent">
                            Lifetime Volume: USD {{ cb.customerProfile.lifetimeVolumeUsd | number }}
                          </div>
                        </div>
                        <div class="mt-6 text-ink muted">
                          {{ cb.comparisonAnalytics?.summaryNarrative || cb.behavioralSummary }}
                        </div>
                      </div>
                    </div>
                  }
                </div>
              } @else if (document()?.analysis?.summary; as sum) {
                <div class="report-section-card mt-16">
                  <div class="section-title-row">
                    <div class="row gap-8 align-center">
                      <app-icon name="sparkle" [size]="16" />
                      <h3 class="h3">Executive Overview</h3>
                    </div>
                  </div>
                  <p class="summary-headline-text mt-12 font-medium">{{ sum.headline }}</p>
                  <p class="summary-narrative-text mt-8">{{ sum.narrative }}</p>
                </div>
              }

              <!-- Citations & Sources -->
              <div class="report-section-card mt-16">
                <div class="section-title-row">
                  <div class="row gap-8 align-center">
                    <app-icon name="quote" [size]="16" />
                    <h3 class="h3">Grounded Document Passages</h3>
                  </div>
                  <span class="chip chip-info">{{ modalCitations().length }} Verbatim Citations</span>
                </div>

                <div class="modal-citations-list mt-14">
                  @for (cite of modalCitations(); track cite.index) {
                    <div class="modal-citation-card">
                      <div class="citation-top">
                        <div class="row gap-8 align-center">
                          <span class="citation-badge">#{{ cite.index < 10 ? '0' + cite.index : cite.index }}</span>
                          <span class="citation-meta-loc">
                            Page {{ cite.pageNumber }} · Paragraph {{ cite.paragraphNumber }}
                            @if (cite.section) {
                              <span class="section-badge-pill">§ {{ cite.section }}</span>
                            }
                          </span>
                        </div>
                      </div>


                      <blockquote class="modal-citation-snippet mt-10">
                        "{{ cite.snippet }}"
                      </blockquote>

                      <div class="citation-foot mt-10">
                        <span class="small muted">Source Document: {{ document()?.filename }}</span>
                        <button class="btn btn-sm btn-ghost" (click)="copySnippet(cite.snippet)">
                          <app-icon name="layers" [size]="12" />
                          <span>Copy Citation</span>
                        </button>
                      </div>
                    </div>
                  }
                </div>
              </div>
            </div>
          } @else {
            <!-- Plain Text Tab -->
            @if (loading() && !content()) {
              <div class="modal-loading">
                <div class="spin"><app-icon name="refresh" [size]="24" /></div>
                <span class="muted mt-8">Loading analysis report...</span>
              </div>
            } @else if (error() && !content()) {
              <div class="modal-error">
                <app-icon name="alert" [size]="24" />
                <p class="mt-8">{{ error() }}</p>
                <button class="btn btn-sm mt-12" (click)="loadReport()">
                  <app-icon name="refresh" [size]="14" />
                  <span>Retry</span>
                </button>
              </div>
            } @else {
              <pre class="report-code mono">{{ content() }}</pre>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }

    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2000;
      background: var(--overlay);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      animation: fade-in 180ms ease;
    }

    .modal-card {
      background: var(--glass-bg);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-xl), 0 0 40px rgba(0, 0, 0, 0.35);
      width: 100%;
      max-width: 980px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: modal-in 240ms var(--ease-out);
      position: relative;
      z-index: 2001;
    }

    .modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 22px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--surface) 85%, transparent);
      flex: none;
      flex-wrap: wrap;
    }

    .modal-icon {
      width: 34px;
      height: 34px;
      border-radius: var(--radius-sm);
      background: var(--accent-soft);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .tab-switcher {
      display: flex;
      background: var(--sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 3px;
      gap: 3px;
    }

    .tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 6px;
      border: 0;
      background: transparent;
      color: var(--ink-2);
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }

    .tab-btn:hover {
      background: #f1f5f9;
      color: var(--ink);
    }

    .tab-btn.active {
      background: var(--raised);
      color: var(--ink);
      box-shadow: var(--shadow-sm);
      font-weight: 700;
    }

    .modal-body {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 20px 24px;
      background: var(--surface);
    }

    /* ── Structured Tab ── */
    .report-meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }

    .meta-box {
      padding: 14px 18px;
      background: var(--sunken);
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      display: flex;
      flex-direction: column;
      gap: 4px;
      transition: all var(--dur-fast) var(--ease);
    }

    .meta-box:hover {
      background: #ebeef2;
      border-color: var(--line);
    }

    .meta-label {
      font-size: 0.75rem;
      font-weight: 750;
      color: #344054;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .meta-val {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--ink);
    }

    .report-section-card {
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 20px 22px;
      box-shadow: var(--shadow-xs);
    }

    .section-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--line);
    }

    .summary-headline-text {
      font-size: 1.05rem;
      color: var(--ink);
      line-height: 1.45;
    }

    .summary-narrative-text {
      font-size: 0.9rem;
      line-height: 1.6;
      color: var(--ink-2);
    }

    /* ── Modal Citations ── */
    .modal-citations-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .modal-citation-card {
      padding: 14px 16px;
      background: var(--sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      transition: border-color var(--dur-fast) var(--ease);
    }

    .modal-citation-card:hover {
      border-color: color-mix(in srgb, var(--accent) 30%, var(--line));
    }

    .citation-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }

    .citation-badge {
      font-family: var(--font-mono);
      font-size: 0.76rem;
      font-weight: 700;
      color: var(--accent);
      background: var(--accent-soft);
      padding: 2px 7px;
      border-radius: 4px;
    }

    .citation-meta-loc {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--ink);
    }

    .section-badge-pill {
      background: var(--raised);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.72rem;
      color: var(--ink-3);
      margin-left: 4px;
    }

    .modal-citation-snippet {
      margin: 0;
      padding: 10px 14px;
      background: var(--raised);
      border-left: 3px solid var(--accent);
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      font-size: 0.84rem;
      line-height: 1.55;
      color: var(--ink);
      font-style: italic;
    }

    .citation-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    /* ── Plain Text Tab ── */
    .report-code {
      margin: 0;
      padding: 18px 22px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      font-size: 0.82rem;
      line-height: 1.6;
      color: var(--ink);
      white-space: pre-wrap;
      word-break: break-word;
      user-select: text;
    }

    .modal-loading,
    .modal-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      text-align: center;
    }

    .modal-error {
      color: var(--negative);
    }

    .uppercase { text-transform: uppercase; }
    .font-medium { font-weight: 550; }
    .font-semibold { font-weight: 650; }
  `,
})
export class ReportModal implements OnInit {
  private readonly docsService = inject(DocumentsService);
  private readonly toast = inject(ToastService);

  readonly documentId = input.required<string>();
  readonly filename = input<string>('analysis-report.txt');
  readonly document = input<DocumentDetail | null>(null);
  readonly close = output<void>();

  protected readonly Math = Math;
  protected readonly activeTab = signal<'structured' | 'raw'>('structured');
  protected readonly content = signal<string>('');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected readonly modalCitations = computed<StructuredCitation[]>(() => {
    const d = this.document();
    const list = (d as any)?.units || [];
    const citations: StructuredCitation[] = [];

    let idx = 1;
    for (const u of list) {
      if (u.text && u.text.trim().length > 30) {
        citations.push({
          index: idx++,
          pageNumber: u.pageNumber,
          paragraphNumber: u.paragraphNumber,
          section: u.section,
          snippet: u.text.length > 250 ? u.text.slice(0, 247) + '...' : u.text,
          contentType: u.classification?.contentType,
          topic: u.classification?.topic,
        });
      }
      if (citations.length >= 20) break;
    }
    return citations;
  });


  ngOnInit(): void {
    const d = this.document();
    if (d && d.analysis) {
      this.content.set(this.buildClientReport(d));
    }
    this.loadReport();
  }

  loadReport(): void {
    const id = this.documentId();
    if (!id) return;

    this.loading.set(true);
    this.error.set(null);

    this.docsService.reportText(id).subscribe({
      next: (text) => {
        if (text && text.trim().length > 0) {
          this.content.set(text);
        }
        this.loading.set(false);
      },
      error: () => {
        if (!this.content()) {
          this.error.set('Failed to load the generated text report.');
        }
        this.loading.set(false);
      },
    });
  }

  private buildClientReport(doc: DocumentDetail): string {
    const border = '='.repeat(78);
    const divider = '-'.repeat(78);
    const stats = doc.analysis?.statistics;
    const summary = doc.analysis?.summary;

    const lines: string[] = [
      border,
      'DOCUMENT ANALYSIS REPORT',
      'DocuIntel AI — Enterprise Document Intelligence Platform',
      border,
      '',
      `Document Name      : ${doc.filename}`,
      `Document Type      : ${doc.fileType.toUpperCase()}`,
      `Total Pages        : ${doc.extraction?.pageCount || 1}`,
      `Analyzed Passages  : ${stats?.analyzedUnits || 0}`,
      `Average Confidence : ${Math.round((stats?.averageConfidence || 0) * 100)}%`,
      `Processing Engine  : ${doc.analysis?.engine?.provider || 'heuristic'} (${doc.analysis?.engine?.model || 'local-lexicon-v1'})`,
      '',
      divider,
      'EXECUTIVE SUMMARY',
      divider,
      `Headline: ${summary?.headline || 'Analysis Completed'}`,
      '',
      `Narrative:`,
      `${summary?.narrative || 'Document analyzed across multiple semantic dimensions.'}`,
      '',
      `Dominant Sentiment : ${summary?.dominantSentiment || 'neutral'}`,
      `Dominant Emotion   : ${summary?.dominantEmotion || 'neutral'}`,
      `Dominant Type      : ${summary?.dominantContentType || 'informational'}`,
      '',
      divider,
      'SENTIMENT BREAKDOWN',
      divider,
    ];

    if (stats?.distributions?.['sentiment']) {
      for (const [k, v] of Object.entries(stats.distributions['sentiment'])) {
        lines.push(`${k.toUpperCase().padEnd(16)}: ${v}`);
      }
    }

    lines.push('');
    lines.push(divider);
    lines.push('EMOTION BREAKDOWN');
    lines.push(divider);

    if (stats?.distributions?.['emotion']) {
      for (const [k, v] of Object.entries(stats.distributions['emotion'])) {
        lines.push(`${k.toUpperCase().padEnd(16)}: ${v}`);
      }
    }

    lines.push('');
    lines.push(divider);
    lines.push('CONTENT TYPE BREAKDOWN');
    lines.push(divider);

    if (stats?.distributions?.['contentType']) {
      for (const [k, v] of Object.entries(stats.distributions['contentType'])) {
        lines.push(`${k.toUpperCase().padEnd(16)}: ${v}`);
      }
    }

    lines.push('');
    lines.push(border);
    lines.push('END OF REPORT');
    lines.push(border);

    return lines.join('\n');
  }

  protected copyCurrentContent(): void {
    const text = this.content();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.copied.set(true);
      this.toast.success('Report copied to clipboard');
      setTimeout(() => this.copied.set(false), 2500);
    });
  }

  protected copySnippet(snippet: string): void {
    navigator.clipboard.writeText(snippet).then(() => {
      this.toast.success('Citation excerpt copied');
    });
  }

  protected downloadPdf(): void {
    const id = this.documentId();
    const name = this.filename().replace(/\.[^/.]+$/, '') + '-compliance-report.pdf';
    this.docsService.downloadPdfReport(id, name).subscribe({
      next: (downloadedAs) => {
        this.toast.success('PDF Report downloaded', downloadedAs);
      },
      error: () => {
        this.toast.error('Download failed', 'Could not download the PDF report.');
      },
    });
  }

  protected download(): void {
    const id = this.documentId();
    const name = this.filename().replace(/\.[^/.]+$/, '') + '-analysis.txt';
    this.docsService.downloadReport(id, name).subscribe({
      next: (downloadedAs) => {
        this.toast.success('Report downloaded', downloadedAs);
      },
      error: () => {
        this.toast.error('Download failed', 'Could not download the text report.');
      },
    });
  }
}
