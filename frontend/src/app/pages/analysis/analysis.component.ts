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
import { DocumentsService } from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import type {
  AnalyzedUnit,
  DocumentDetail,
  UnitPage,
  UnitQuery,
} from '../../models/api.models';
import { formatBytes, formatDuration, formatNumber } from '../../shared/format';
import { Icon } from '../../shared/components/icon';
import { KpiCard } from '../../shared/components/kpi-card';
import { DonutChart } from '../../shared/components/donut-chart';
import { BarChart } from '../../shared/components/bar-chart';
import { TimelineChart } from '../../shared/components/timeline-chart';
import { ReportModal } from '../../shared/components/report-modal';

@Component({
  selector: 'app-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    Icon,
    KpiCard,
    DonutChart,
    BarChart,
    TimelineChart,
    ReportModal,
  ],
  template: `
    <div class="page">
      @if (loadingDoc()) {
        <div class="loading-state card card-pad">
          <div class="loading-icon">
            <div class="spin"><app-icon name="refresh" [size]="24" /></div>
          </div>
          <p class="mt-12 font-medium">Loading document analysis...</p>
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
                <div class="row gap-8 wrap">
                  <h1 class="doc-title">{{ doc()?.filename }}</h1>
                  <span class="chip chip-info uppercase">{{ doc()?.fileType }}</span>
                </div>
                <div class="row gap-12 small muted mt-4 wrap">
                  <span>{{ formatBytes(doc()?.fileSize || 0) }}</span>
                  <span class="sep">·</span>
                  <span>{{ doc()?.extraction?.pageCount || 1 }} Pages</span>
                  <span class="sep">·</span>
                  <span>{{ doc()?.analysis?.statistics?.analyzedUnits || 0 }} Paragraphs</span>
                  <span class="sep">·</span>
                  <span>{{ formatDuration(doc()?.analysis?.timing?.totalMs || 0) }}</span>
                </div>
              </div>
            </div>

            <div class="doc-header-actions row gap-8">
              <button class="btn btn-sm" (click)="showReportModal.set(true)">
                <app-icon name="eye" [size]="14" />
                <span>View Report</span>
              </button>
              <button class="btn btn-sm btn-primary" (click)="downloadTxtReport()">
                <app-icon name="download" [size]="14" />
                <span>Download Report</span>
              </button>
            </div>
          </div>
        </header>

        <!-- AI Executive Summary -->
        @if (doc()?.analysis?.summary; as sum) {
          <section class="summary-card">
            <div class="summary-ambient" aria-hidden="true"></div>
            <div class="summary-inner">
              <div class="summary-top">
                <div class="row gap-10">
                  <div class="summary-icon">
                    <app-icon name="sparkle" [size]="16" />
                  </div>
                  <h2 class="h2">AI Executive Summary</h2>
                </div>
                <div class="row gap-6 wrap">
                  <span class="chip chip-positive">
                    <span class="chip-dot"></span>
                    {{ sum.dominantSentiment }}
                  </span>
                  <span class="chip chip-info">{{ sum.dominantContentType }}</span>
                  <span class="chip">{{ doc()?.analysis?.engine?.model }}</span>
                </div>
              </div>

              <p class="summary-headline mt-16">{{ sum.headline }}</p>
              <p class="summary-narrative mt-8">{{ sum.narrative }}</p>

              @if (sum.highlights && sum.highlights.length > 0) {
                <div class="highlights mt-20">
                  <div class="eyebrow mb-12">Key Insights</div>
                  <div class="highlights-grid">
                    @for (hl of sum.highlights; track hl) {
                      <div class="highlight-item">
                        <div class="highlight-check">
                          <app-icon name="check" [size]="12" />
                        </div>
                        <span>{{ hl }}</span>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          </section>
        }

        <!-- KPI Metrics -->
        @if (doc()?.analysis?.statistics; as stats) {
          <section class="kpi-grid">
            <app-kpi-card
              label="Total Pages"
              [value]="stats.totalPages"
              icon="page"
              hint="Document page count"
            />
            <app-kpi-card
              label="Analyzed Passages"
              [value]="stats.analyzedUnits"
              icon="document"
              hint="Total segmented paragraphs"
            />
            <app-kpi-card
              label="Positive Content"
              [value]="stats.distributions['sentiment']?.['positive'] || 0"
              tone="positive"
              icon="check-circle"
              [share]="stats.analyzedUnits ? (stats.distributions['sentiment']?.['positive'] || 0) / stats.analyzedUnits : 0"
              hint="Optimistic/constructive tone"
            />
            <app-kpi-card
              label="Negative Content"
              [value]="stats.distributions['sentiment']?.['negative'] || 0"
              tone="negative"
              icon="alert"
              [share]="stats.analyzedUnits ? (stats.distributions['sentiment']?.['negative'] || 0) / stats.analyzedUnits : 0"
              hint="Critical/dissatisfied tone"
            />
            <app-kpi-card
              label="Mathematical"
              [value]="stats.distributions['contentType']?.['mathematical'] || 0"
              tone="info"
              icon="cpu"
              hint="Equations & calculations"
            />
            <app-kpi-card
              label="Avg Confidence"
              [value]="stats.averageConfidence"
              kind="percent"
              tone="neutral"
              icon="sparkle"
              hint="AI classification certainty"
            />
          </section>

          <!-- Charts -->
          <section class="charts-grid mt-24">
            <div class="card chart-card">
              <div class="card-head">
                <div class="row gap-8">
                  <app-icon name="chart" [size]="16" />
                  <h3 class="h3">Sentiment Distribution</h3>
                </div>
                <span class="small muted">Positive / Negative / Neutral</span>
              </div>
              <div class="card-body">
                <app-donut-chart
                  dimension="sentiment"
                  [distribution]="stats.distributions['sentiment'] || {}"
                  title="Sentiments"
                />
              </div>
            </div>

            <div class="card chart-card">
              <div class="card-head">
                <div class="row gap-8">
                  <app-icon name="layers" [size]="16" />
                  <h3 class="h3">Emotion Distribution</h3>
                </div>
                <span class="small muted">Happy, Sad, Angry, Excited...</span>
              </div>
              <div class="card-body">
                <app-bar-chart
                  dimension="emotion"
                  [distribution]="stats.distributions['emotion'] || {}"
                />
              </div>
            </div>

            <div class="card chart-card">
              <div class="card-head">
                <div class="row gap-8">
                  <app-icon name="grid" [size]="16" />
                  <h3 class="h3">Content Types</h3>
                </div>
                <span class="small muted">Mathematical, Technical, Narrative...</span>
              </div>
              <div class="card-body">
                <app-bar-chart
                  dimension="contentType"
                  [distribution]="stats.distributions['contentType'] || {}"
                />
              </div>
            </div>

            <div class="card chart-card">
              <div class="card-head">
                <div class="row gap-8">
                  <app-icon name="database" [size]="16" />
                  <h3 class="h3">Topic Classification</h3>
                </div>
                <span class="small muted">Domain & Subject Breakdown</span>
              </div>
              <div class="card-body">
                <app-bar-chart
                  dimension="topic"
                  [distribution]="stats.distributions['topic'] || {}"
                />
              </div>
            </div>
          </section>

          <!-- Timeline -->
          @if (stats.pageTimeline && stats.pageTimeline.length > 0) {
            <section class="card timeline-card mt-24">
              <div class="card-head">
                <div class="row gap-8">
                  <app-icon name="clock" [size]="16" />
                  <h3 class="h3">Document Progression Timeline</h3>
                </div>
                <span class="small muted">Page-by-page sentiment & classification flow</span>
              </div>
              <div class="card-body">
                <app-timeline-chart [timeline]="stats.pageTimeline" />
              </div>
            </section>
          }
        }

        <!-- Paragraph Explorer -->
        <section class="card explorer-card mt-24" id="explorer">
          <div class="card-head">
            <div class="row gap-8">
              <app-icon name="search" [size]="18" />
              <h2 class="h2">Paragraph Explorer</h2>
            </div>
            <span class="small muted tnum">
              {{ units().length }} of {{ totalUnitsCount() }} paragraphs
            </span>
          </div>

          <!-- Filters -->
          <div class="explorer-filters">
            <div class="search filter-search">
              <app-icon name="search" [size]="15" />
              <input
                type="text"
                class="input"
                placeholder="Search paragraphs..."
                [value]="searchQuery()"
                (input)="onSearchInput($event)"
              />
            </div>

            <div class="filter-group">
              <select class="select" (change)="onFilterSentiment($event)">
                <option value="">All Sentiments</option>
                <option value="positive">Positive</option>
                <option value="negative">Negative</option>
                <option value="neutral">Neutral</option>
              </select>
            </div>

            <div class="filter-group">
              <select class="select" (change)="onFilterEmotion($event)">
                <option value="">All Emotions</option>
                <option value="happy">Happy</option>
                <option value="sad">Sad</option>
                <option value="angry">Angry</option>
                <option value="excited">Excited</option>
                <option value="fear">Fear</option>
                <option value="surprise">Surprise</option>
                <option value="neutral">Neutral</option>
              </select>
            </div>

            <div class="filter-group">
              <select class="select" (change)="onFilterContentType($event)">
                <option value="">All Content Types</option>
                <option value="mathematical">Mathematical</option>
                <option value="technical">Technical</option>
                <option value="informational">Informational</option>
                <option value="narrative">Narrative</option>
                <option value="question">Question</option>
                <option value="instruction">Instruction</option>
                <option value="opinion">Opinion</option>
                <option value="complaint">Complaint</option>
                <option value="feedback">Feedback</option>
              </select>
            </div>

            @if (hasActiveFilters()) {
              <button class="btn btn-sm btn-ghost" (click)="resetFilters()">
                <app-icon name="close" [size]="14" />
                <span>Reset</span>
              </button>
            }
          </div>

          <!-- Paragraphs -->
          <div class="card-body explorer-body">
            @if (loadingUnits()) {
              <div class="loading-units">
                <div class="spin"><app-icon name="refresh" [size]="20" /></div>
                <span class="muted small mt-8">Filtering paragraphs...</span>
              </div>
            } @else {
              <div class="paragraphs-list">
                @for (unit of units(); track unit.id) {
                  <article class="paragraph-card">
                    <div class="paragraph-header">
                      <div class="row gap-8 wrap">
                        <span class="paragraph-index eyebrow">P.{{ unit.pageNumber }} · ¶{{ unit.paragraphNumber }}</span>
                        @if (unit.section) {
                          <span class="section-badge truncate">§ {{ unit.section }}</span>
                        }
                        <span class="chip small">{{ unit.unitType }}</span>
                      </div>

                      <div class="paragraph-chips row gap-6 wrap">
                        <span
                          class="chip"
                          [class.chip-positive]="unit.classification.sentiment === 'positive'"
                          [class.chip-negative]="unit.classification.sentiment === 'negative'"
                        >
                          {{ unit.classification.sentiment }}
                        </span>
                        <span class="chip">{{ unit.classification.emotion }}</span>
                        <span class="chip chip-info">{{ unit.classification.contentType }}</span>
                        <span class="chip">{{ unit.classification.topic }}</span>
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
                          {{ expandedParagraphs().has(unit.id) ? 'Show less' : 'Read full paragraph...' }}
                        </button>
                      }
                    </div>

                    <div class="paragraph-footer mt-12">
                      <div class="row gap-8">
                        <span class="eyebrow">Confidence:</span>
                        <div class="confidence-track">
                          <div
                            class="confidence-fill"
                            [style.width.%]="unit.classification.confidence * 100"
                          ></div>
                        </div>
                        <span class="small tnum font-semibold">
                          {{ Math.round(unit.classification.confidence * 100) }}%
                        </span>
                      </div>

                      <button
                        class="btn btn-sm btn-ghost"
                        (click)="copyParagraph(unit.text)"
                        title="Copy paragraph text"
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
                    <p class="font-medium mt-12">No matching paragraphs</p>
                    <p class="small muted mt-4">Try adjusting your search or filter criteria.</p>
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
      padding: 20px 24px;
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

    .back-btn {
      margin-top: 2px;
    }

    .doc-title {
      font-size: 1.4rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--ink);
      background: none;
      -webkit-text-fill-color: var(--ink);
    }

    .sep {
      opacity: 0.3;
    }

    /* ── Summary ── */
    .summary-card {
      position: relative;
      background: var(--raised);
      border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--line));
      border-radius: var(--radius-xl);
      overflow: hidden;
      margin-bottom: 24px;
      box-shadow: var(--shadow-sm);
    }

    .summary-ambient {
      position: absolute;
      inset: 0;
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--accent) 6%, transparent) 0%,
        transparent 50%,
        color-mix(in srgb, #a78bfa 4%, transparent) 100%
      );
      pointer-events: none;
    }

    .summary-inner {
      position: relative;
      padding: 24px 28px;
      z-index: 1;
    }

    .summary-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .summary-icon {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent) 0%, #a78bfa 100%);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: float 4s ease-in-out infinite;
    }

    .summary-headline {
      font-size: 1.08rem;
      font-weight: 600;
      color: var(--ink);
      line-height: 1.45;
    }

    .summary-narrative {
      font-size: 0.95rem;
      line-height: 1.65;
      color: var(--ink-2);
    }

    .highlights-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 8px;
    }

    .highlight-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 0.86rem;
      padding: 8px 12px;
      background: var(--raised);
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
      line-height: 1.45;
    }

    .highlight-check {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--positive-soft);
      color: var(--positive);
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      margin-top: 1px;
    }

    /* ── KPI Grid ── */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
      gap: 16px;
    }

    /* ── Charts ── */
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 18px;
    }

    .chart-card {
      transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
    }

    .chart-card:hover {
      border-color: color-mix(in srgb, var(--accent) 20%, var(--line));
      box-shadow: var(--shadow);
    }

    /* ── Explorer ── */
    .explorer-filters {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 22px;
      border-bottom: 1px solid var(--line);
      background: var(--sunken);
      flex-wrap: wrap;
    }

    .filter-search {
      flex: 1 1 240px;
    }

    .filter-group {
      flex: 0 1 170px;
    }

    .paragraphs-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .paragraph-card {
      padding: 18px 20px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-xs);
      transition:
        border-color var(--dur-fast) var(--ease),
        box-shadow var(--dur-fast) var(--ease),
        transform var(--dur-fast) var(--ease);
    }

    .paragraph-card:hover {
      border-color: color-mix(in srgb, var(--accent) 20%, var(--line));
      box-shadow: var(--shadow-sm);
      transform: translateY(-1px);
    }

    .paragraph-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }

    .paragraph-index {
      font-family: var(--font-mono);
    }

    .section-badge {
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--ink-2);
      max-width: 220px;
      background: var(--sunken);
      padding: 2px 8px;
      border-radius: var(--radius-sm);
    }

    .paragraph-text p {
      font-size: 0.92rem;
      line-height: 1.65;
      color: var(--ink);
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }

    .paragraph-text p.expanded {
      display: block;
      -webkit-line-clamp: unset;
      overflow: visible;
    }

    .btn-expand {
      border: 0;
      background: transparent;
      color: var(--accent);
      padding: 4px 0 0;
      cursor: pointer;
      transition: color var(--dur-fast) var(--ease);
    }

    .btn-expand:hover {
      color: var(--accent-hover);
    }

    .paragraph-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .confidence-track {
      width: 72px;
      height: 6px;
      background: var(--sunken);
      border-radius: 99px;
      overflow: hidden;
    }

    .confidence-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #a78bfa));
      border-radius: 99px;
      transition: width var(--dur-slow) var(--ease-out);
    }

    /* Pagination */
    .pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    /* Loading & empty */
    .loading-state,
    .loading-units,
    .empty-filter {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 56px 20px;
      text-align: center;
    }

    .loading-icon {
      color: var(--accent);
    }

    .empty-filter-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--sunken);
      border: 1px solid var(--line);
      color: var(--ink-3);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Utilities */
    .font-medium { font-weight: 550; }
    .font-semibold { font-weight: 650; }
    .uppercase { text-transform: uppercase; }

    @media (max-width: 720px) {
      .doc-header {
        padding: 16px;
      }
      .doc-title {
        font-size: 1.1rem;
      }
      .doc-header-actions {
        width: 100%;
      }
      .summary-inner {
        padding: 18px 16px;
      }
    }
  `,
})
export class AnalysisComponent implements OnInit {
  protected readonly Math = Math;
  protected readonly formatBytes = formatBytes;
  protected readonly formatDuration = formatDuration;
  protected readonly formatNumber = formatNumber;

  readonly id = input.required<string>();

  private readonly docsService = inject(DocumentsService);
  private readonly toast = inject(ToastService);

  protected readonly doc = signal<DocumentDetail | null>(null);
  protected readonly loadingDoc = signal(true);

  protected readonly units = signal<AnalyzedUnit[]>([]);
  protected readonly totalUnitsCount = signal(0);
  protected readonly totalPages = signal(1);
  protected readonly currentPage = signal(1);
  protected readonly loadingUnits = signal(false);

  // Filters
  protected readonly searchQuery = signal('');
  protected readonly filterSentiment = signal('');
  protected readonly filterEmotion = signal('');
  protected readonly filterContentType = signal('');

  protected readonly expandedParagraphs = signal<Set<string>>(new Set());
  protected readonly showReportModal = signal(false);

  protected readonly hasActiveFilters = computed(() => {
    return (
      this.searchQuery().trim().length > 0 ||
      this.filterSentiment().length > 0 ||
      this.filterEmotion().length > 0 ||
      this.filterContentType().length > 0
    );
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
    if (this.filterSentiment()) {
      query.sentiment = [this.filterSentiment()];
    }
    if (this.filterEmotion()) {
      query.emotion = [this.filterEmotion()];
    }
    if (this.filterContentType()) {
      query.contentType = [this.filterContentType()];
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

  onFilterSentiment(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.filterSentiment.set(val);
    this.currentPage.set(1);
    this.loadUnits();
  }

  onFilterEmotion(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.filterEmotion.set(val);
    this.currentPage.set(1);
    this.loadUnits();
  }

  onFilterContentType(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.filterContentType.set(val);
    this.currentPage.set(1);
    this.loadUnits();
  }

  resetFilters(): void {
    this.searchQuery.set('');
    this.filterSentiment.set('');
    this.filterEmotion.set('');
    this.filterContentType.set('');
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

  copyParagraph(text: string): void {
    navigator.clipboard.writeText(text).then(() => {
      this.toast.success('Paragraph text copied');
    });
  }

  downloadTxtReport(): void {
    const d = this.doc();
    if (!d) return;
    const name = d.filename.replace(/\.[^/.]+$/, '') + '-analysis.txt';
    this.docsService.downloadReport(d.id, name).subscribe({
      next: (downloadedAs) => {
        this.toast.success('Report downloaded', downloadedAs);
      },
      error: () => {
        this.toast.error('Download failed', 'Could not download text report.');
      },
    });
  }
}
