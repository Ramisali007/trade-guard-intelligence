import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  DocumentsService,
  type UploadEvent,
} from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import type {
  ClientConfig,
  DocumentSummary,
  HealthResponse,
} from '../../models/api.models';
import { formatBytes, formatDuration, formatRelative } from '../../shared/format';
import { Icon } from '../../shared/components/icon';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <div class="page">
      <!-- Hero Section -->
      <section class="hero-section">
        <div class="hero-ambient" aria-hidden="true">
          <div class="hero-glow hero-glow-1"></div>
          <div class="hero-glow hero-glow-2"></div>
        </div>

        <div class="hero-content">
          <div class="hero-badge">
            <span class="hero-badge-dot"></span>
            <span class="eyebrow">Bank-Grade Compliance Intelligence</span>
          </div>

          <h1 class="hero-title">
            Trade Finance Document Compliance,<br>
            <span class="hero-title-accent">Sanctions & Risk Analyzer</span>
          </h1>

          <p class="hero-lede">
            Upload trade finance documents (Invoices, Bills of Lading, Letters of Credit, Packing Lists) to screen sanctions, dual-use goods, TBML red flags, authorized trade scope, and cross-document reconciliation.
          </p>

          <!-- Engine Status -->
          @if (health()) {
            <div class="hero-engine">
              <div class="hero-engine-dot"></div>
              <app-icon name="cpu" [size]="13" />
              <span>{{ health()?.engine?.provider }} · {{ health()?.engine?.model }}</span>
              <span class="hero-engine-sep">|</span>
              <span>Sanctions Dataset: OFAC / UN / EU / UK</span>
            </div>
          }
        </div>
      </section>

      <!-- Upload Zone Section -->
      <section class="card upload-section">
        <div class="card-head">
          <div class="row gap-8">
            <div class="upload-head-icon">
              <app-icon name="upload" [size]="16" />
            </div>
            <h2 class="h2">Upload Trade Documents</h2>
          </div>
          <span class="small muted">PDF, DOC, DOCX · Select single or multiple files (LC, Invoice, BL, Packing List) · Up to 50 MB each</span>
        </div>

        <div class="card-body">
          @if (selectedFiles().length === 0 && !uploading()) {
            <!-- Drop Zone -->
            <div
              class="dropzone"
              [class.drag-over]="isDragging()"
              (dragover)="onDragOver($event)"
              (dragleave)="onDragLeave($event)"
              (drop)="onDrop($event)"
              (click)="fileInput.click()"
              tabindex="0"
              role="button"
              aria-label="Upload document area"
            >
              <input
                #fileInput
                type="file"
                multiple
                class="sr-only"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                (change)="onFileSelected($event)"
              />

              <div class="dropzone-visual">
                <div class="dropzone-icon-ring">
                  <div class="dropzone-icon">
                    <app-icon name="upload" [size]="28" />
                  </div>
                </div>
                <p class="dropzone-title">Drop your trade documents here</p>
                <p class="dropzone-subtitle">Hold <kbd class="kbd-hint">Ctrl</kbd> / <kbd class="kbd-hint">Shift</kbd> to select multiple files, or drag & drop them together</p>
                <div class="row gap-10 mt-12">
                  <button type="button" class="btn btn-sm btn-primary" (click)="$event.stopPropagation(); fileInput.click()">
                    <app-icon name="upload" [size]="14" />
                    <span>Select Multiple Documents</span>
                  </button>
                </div>
              </div>

              <div class="dropzone-formats">
                <span class="format-badge">Multi-Upload Enabled</span>
                <span class="format-badge">PDF</span>
                <span class="format-badge">DOCX</span>
                <span class="format-sep">·</span>
                <span class="format-limit">Up to 10 files · 50 MB each</span>
              </div>
            </div>
          }

          @if (selectedFiles().length > 0 && !uploading()) {
            <!-- Selected Files List / Card -->
            <div class="selected-batch-card">
              <div class="row justify-between align-center mb-12">
                <div class="row gap-8 align-center">
                  <span class="font-bold">{{ selectedFiles().length }} File(s) Selected</span>
                  <span class="chip small font-mono">{{ formatBytes(getTotalSelectedSize()) }}</span>
                </div>
                <div class="row gap-8">
                  <button class="btn btn-sm btn-ghost" (click)="addMoreInput.click()">
                    <app-icon name="upload" [size]="14" />
                    <span>+ Add More Files</span>
                  </button>
                  <button class="btn btn-sm btn-ghost" (click)="cancelSelection()">
                    <app-icon name="close" [size]="14" />
                    <span>Clear All</span>
                  </button>
                  <input
                    #addMoreInput
                    type="file"
                    multiple
                    class="sr-only"
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    (change)="onMoreFilesSelected($event)"
                  />
                </div>
              </div>

              <div class="batch-files-grid">
                @for (file of selectedFiles(); track file.name; let i = $index) {
                  <div class="batch-file-item row gap-10 align-center justify-between">
                    <div class="row gap-8 align-center truncate">
                      <app-icon name="document" [size]="16" class="muted" />
                      <span class="font-medium text-ink truncate">{{ file.name }}</span>
                    </div>
                    <div class="row gap-10 align-center">
                      <span class="small muted font-mono">{{ formatBytes(file.size) }}</span>
                      <button class="btn-icon-xs" (click)="removeSelectedFile(i)" title="Remove file">
                        <app-icon name="close" [size]="12" />
                      </button>
                    </div>
                  </div>
                }
              </div>

              <div class="row justify-end gap-10 mt-16">
                <button class="btn btn-sm" (click)="cancelSelection()">Cancel</button>
                <button class="btn btn-sm btn-primary" (click)="startUploadAndAnalysis()">
                  <app-icon name="sparkle" [size]="14" />
                  <span>Upload & Analyze {{ selectedFiles().length }} Document(s)</span>
                </button>
              </div>
            </div>
          }

          @if (uploading()) {
            <!-- Uploading Progress State -->
            <div class="upload-progress-card">
              <div class="upload-progress-head">
                <div class="row gap-8">
                  <div class="spin"><app-icon name="refresh" [size]="16" /></div>
                  <span class="font-medium">Uploading & Ingesting {{ selectedFiles().length }} Document(s)...</span>
                </div>
                <span class="font-mono tnum font-semibold">{{ uploadPercent() }}%</span>
              </div>

              <div class="progress-bar mt-12">
                <div class="progress-fill" [style.width.%]="uploadPercent()"></div>
              </div>
            </div>
          }

          <!-- Validation Warning -->
          @if (validationError()) {
            <div class="validation-alert mt-16">
              <app-icon name="alert" [size]="16" />
              <span>{{ validationError() }}</span>
            </div>
          }
        </div>
      </section>

      <!-- Documents Table Section -->
      <section class="card documents-section mt-24">
        <div class="card-head">
          <div class="row gap-8 align-center">
            <app-icon name="list" [size]="18" />
            <h2 class="h2">Analyzed Trade Documents</h2>
            @if (documents().length > 0) {
              <span class="chip small font-mono">{{ documents().length }} Documents</span>
            }
          </div>
          <div class="row gap-8">
            @if (selectedForCompare().size >= 2) {
              <button class="btn btn-sm btn-primary" (click)="launchComparison()">
                <app-icon name="scale" [size]="14" />
                <span>Reconcile ({{ selectedForCompare().size }} Selected)</span>
              </button>
            }
            <button class="btn btn-sm btn-ghost" (click)="loadDocuments()" [disabled]="loadingDocs()">
              <app-icon name="refresh" [size]="14" [class.spin]="loadingDocs()" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div class="table-wrap">
          <table class="table table-hover">
            <thead>
              <tr>
                <th style="width: 40px">
                  <input
                    type="checkbox"
                    [checked]="areAllCompletedSelected()"
                    (change)="toggleSelectAllCompleted()"
                    title="Select all completed for comparison"
                  />
                </th>
                <th>Document</th>
                <th>Classification</th>
                <th>Counterparties</th>
                <th>Compliance Decision</th>
                <th>Risk Score</th>
                <th>Status</th>
                <th>Uploaded</th>
                <th class="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (doc of documents(); track doc.id) {
                <tr [class.row-selected]="selectedForCompare().has(doc.id)">
                  <td>
                    <input
                      type="checkbox"
                      [checked]="selectedForCompare().has(doc.id)"
                      [disabled]="doc.status !== 'completed'"
                      (change)="toggleDocForCompare(doc.id)"
                      title="Select for cross-document reconciliation"
                    />
                  </td>
                  <td>
                    <div class="row gap-8 font-medium">
                      <app-icon name="document" [size]="15" class="muted" />
                      <a [routerLink]="doc.status === 'completed' ? ['/analysis', doc.id] : ['/processing', doc.id]">
                        {{ doc.filename }}
                      </a>
                    </div>
                  </td>
                  <td>
                    <span class="chip chip-info small">{{ doc.tradeDocumentType || 'Trade Document' }}</span>
                  </td>
                  <td class="small">
                    @if (doc.buyerName || doc.sellerName) {
                      <div>{{ doc.sellerName || 'Seller' }} → {{ doc.buyerName || 'Buyer' }}</div>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td>
                    @if (doc.tradeDecision) {
                      <span
                        class="chip small font-bold"
                        [class.chip-positive]="doc.tradeDecision === 'ALLOW'"
                        [class.chip-warning]="doc.tradeDecision === 'REVIEW'"
                        [class.chip-negative]="doc.tradeDecision === 'BLOCK_ESCALATE'"
                      >
                        {{ doc.tradeDecision === 'BLOCK_ESCALATE' ? 'BLOCK / ESCALATE' : doc.tradeDecision }}
                      </span>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td>
                    @if (doc.tradeOverallRisk !== null && doc.tradeOverallRisk !== undefined) {
                      <span class="font-mono font-bold" [class.text-positive]="doc.tradeOverallRisk < 20" [class.text-warning]="doc.tradeOverallRisk >= 20 && doc.tradeOverallRisk < 60" [class.text-negative]="doc.tradeOverallRisk >= 60">
                        {{ doc.tradeOverallRisk }}/100
                      </span>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td>
                    <span
                      class="chip"
                      [class.chip-positive]="doc.status === 'completed'"
                      [class.chip-negative]="doc.status === 'failed'"
                      [class.chip-warning]="doc.status === 'processing' || doc.status === 'queued'"
                    >
                      <span class="chip-dot" [class.chip-dot-pulse]="doc.status === 'processing' || doc.status === 'queued'"></span>
                      {{ doc.status }}
                    </span>
                  </td>
                  <td class="muted small">{{ formatRelative(doc.uploadedAt) }}</td>
                  <td class="num">
                    <div class="row gap-6 justify-end">
                      @if (doc.status === 'completed') {
                        <a
                          [routerLink]="['/analysis', doc.id]"
                          class="btn btn-sm btn-primary"
                          title="View analysis dashboard"
                        >
                          <app-icon name="chart" [size]="13" />
                          <span>View</span>
                        </a>
                        <button
                          class="btn btn-sm btn-ghost"
                          (click)="downloadReport(doc.id, doc.filename)"
                          title="Download structured TXT report"
                        >
                          <app-icon name="download" [size]="13" />
                        </button>
                      } @else if (doc.status === 'processing' || doc.status === 'queued') {
                        <a
                          [routerLink]="['/processing', doc.id]"
                          class="btn btn-sm"
                          title="View live processing"
                        >
                          <app-icon name="refresh" [size]="13" class="spin" />
                          <span>Track</span>
                        </a>
                      }
                      <button
                        class="btn btn-sm btn-ghost btn-danger"
                        (click)="deleteDoc(doc.id)"
                        title="Delete document"
                      >
                        <app-icon name="trash" [size]="13" />
                      </button>
                    </div>
                  </td>
                </tr>
              }
              @if (documents().length === 0 && !loadingDocs()) {
                <tr>
                  <td colspan="9">
                    <div class="empty-state">
                      <div class="empty-state-icon">
                        <app-icon name="document" [size]="28" />
                      </div>
                      <p class="font-medium mt-12">No documents analyzed yet</p>
                      <p class="small muted mt-4">
                        Upload your PDF or Word documents above to start the AI compliance and reconciliation pipeline.
                      </p>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- Floating Comparison Action Bar -->
      @if (selectedForCompare().size >= 2) {
        <div class="floating-compare-bar">
          <div class="row gap-12 align-center">
            <span class="badge-dot"></span>
            <span class="font-bold">{{ selectedForCompare().size }} Trade Documents Selected</span>
            <span class="small muted">Ready for UCP 600 Cross-Document Examination</span>
          </div>
          <div class="row gap-8">
            <button class="btn btn-sm btn-ghost" (click)="clearComparisonSelection()">
              Clear
            </button>
            <button class="btn btn-sm btn-primary" (click)="launchComparison()">
              <app-icon name="scale" [size]="14" />
              <span>Launch Reconciliation Matrix</span>
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    /* ── Hero ── */
    .hero-section {
      position: relative;
      padding: 48px 36px 44px;
      border-radius: var(--radius-xl);
      background: var(--raised);
      border: 1px solid var(--line);
      overflow: hidden;
      margin-bottom: 24px;
    }

    .hero-ambient {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
    }

    .hero-glow {
      position: absolute;
      border-radius: 50%;
      filter: blur(80px);
    }

    .hero-glow-1 {
      width: 400px;
      height: 400px;
      top: -120px;
      right: -80px;
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      animation: glow-pulse 6s ease-in-out infinite;
    }

    .hero-glow-2 {
      width: 300px;
      height: 300px;
      bottom: -100px;
      left: -50px;
      background: color-mix(in srgb, #a78bfa 10%, transparent);
      animation: glow-pulse 8s ease-in-out infinite 2s;
    }

    .hero-content {
      position: relative;
      z-index: 1;
      max-width: 640px;
    }

    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 14px;
      background: var(--accent-soft);
      border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
      border-radius: 99px;
      margin-bottom: 20px;
      animation: fade-up var(--dur-slow) var(--ease-out) both;
    }

    .hero-badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      animation: breathing 2.5s ease-in-out infinite;
    }

    .hero-title {
      font-size: clamp(2rem, 1.6rem + 1.8vw, 2.8rem);
      font-weight: 780;
      letter-spacing: -0.04em;
      line-height: 1.1;
      color: var(--ink);
      margin-bottom: 16px;
      background: none;
      -webkit-text-fill-color: inherit;
    }

    .hero-title-accent {
      background: linear-gradient(135deg, var(--accent) 0%, #a78bfa 60%, #ec4899 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero-lede {
      font-size: 1.05rem;
      line-height: 1.65;
      color: var(--ink-2);
      margin-bottom: 20px;
      max-width: 56ch;
    }

    .hero-engine {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: var(--sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      font-size: 0.76rem;
      color: var(--ink-2);
    }

    .hero-engine-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--positive);
      animation: breathing 2s ease-in-out infinite;
    }

    .hero-engine-sep {
      opacity: 0.3;
    }

    /* ── Upload Section ── */
    .upload-section {
      margin-bottom: 24px;
    }

    .upload-head-icon {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-sm);
      background: var(--accent-soft);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .dropzone {
      position: relative;
      padding: 48px 24px;
      border: 2px dashed var(--line);
      border-radius: var(--radius-lg);
      text-align: center;
      cursor: pointer;
      transition: all var(--dur-normal) var(--ease);
      background: var(--sunken);
    }

    .dropzone:hover,
    .dropzone.drag-over {
      border-color: var(--accent);
      background: var(--accent-soft);
    }

    .dropzone-visual {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .dropzone-icon-ring {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: var(--raised);
      border: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent);
      margin-bottom: 8px;
      transition: transform var(--dur-fast) var(--ease);
    }

    .dropzone:hover .dropzone-icon-ring {
      transform: translateY(-2px);
    }

    .dropzone-title {
      font-size: 1.05rem;
      font-weight: 600;
      color: var(--ink);
    }

    .dropzone-subtitle {
      font-size: 0.85rem;
      color: var(--ink-3);
    }

    .dropzone-formats {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 16px;
      font-size: 0.76rem;
      color: var(--ink-3);
    }

    .format-badge {
      padding: 2px 8px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-xs);
      font-weight: 600;
      font-size: 0.72rem;
      color: var(--ink-2);
    }

    .format-sep {
      opacity: 0.4;
    }

    /* ── Progress Card ── */
    .upload-progress-card {
      padding: 24px;
      background: var(--sunken);
      border-radius: var(--radius-lg);
      border: 1px solid var(--line);
    }

    .upload-progress-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .progress-bar {
      height: 8px;
      background: var(--line);
      border-radius: 99px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 99px;
      transition: width 0.2s ease;
    }

    .validation-alert {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: var(--radius);
      background: var(--negative-soft);
      border: 1px solid color-mix(in srgb, var(--negative) 25%, transparent);
      color: var(--negative);
      font-size: 0.85rem;
      animation: scale-in var(--dur-fast) var(--ease) both;
    }

    /* ── Empty State ── */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 56px 20px;
      text-align: center;
    }

    .empty-state-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--sunken);
      border: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--ink-3);
      animation: float 4s ease-in-out infinite;
    }

    /* ── Batch Upload Card & Items ── */
    .selected-batch-card {
      padding: 20px;
      background: var(--sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
    }
    .batch-files-grid {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 220px;
      overflow-y: auto;
    }
    .batch-file-item {
      padding: 8px 14px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
    }

    /* ── Floating Compare Bar ── */
    .floating-compare-bar {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--raised);
      border: 2px solid var(--accent);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
      border-radius: 9999px;
      padding: 10px 24px;
      display: flex;
      align-items: center;
      gap: 20px;
      z-index: 100;
      animation: fade-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      animation: breathing 2s infinite;
    }
    .kbd-hint {
      padding: 2px 6px;
      font-size: 0.72rem;
      font-family: inherit;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: 4px;
      color: var(--ink);
    }
    .btn-icon-xs {
      background: none;
      border: none;
      color: var(--ink-3);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }
    .btn-icon-xs:hover {
      color: var(--negative);
      background: var(--negative-soft);
    }

    /* ── Utilities ── */
    .font-medium { font-weight: 550; }
    .font-semibold { font-weight: 650; }
    .justify-end { justify-content: flex-end; }
    .uppercase { text-transform: uppercase; }

    @media (max-width: 720px) {
      .hero-section {
        padding: 32px 20px;
      }
      .hero-title {
        font-size: 1.6rem;
      }
      .floating-compare-bar {
        flex-direction: column;
        border-radius: var(--radius-lg);
        width: 90%;
        bottom: 12px;
      }
    }
  `,
})
export class DashboardComponent implements OnInit {
  protected readonly formatBytes = formatBytes;
  protected readonly formatDuration = formatDuration;
  protected readonly formatRelative = formatRelative;

  private readonly docsService = inject(DocumentsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly health = signal<HealthResponse | null>(null);
  protected readonly clientConfig = signal<ClientConfig | null>(null);
  protected readonly documents = signal<DocumentSummary[]>([]);
  protected readonly loadingDocs = signal(false);

  protected readonly selectedFiles = signal<File[]>([]);
  protected readonly selectedForCompare = signal<Set<string>>(new Set());
  protected readonly isDragging = signal(false);
  protected readonly uploading = signal(false);
  protected readonly uploadPercent = signal(0);
  protected readonly validationError = signal<string | null>(null);

  ngOnInit(): void {
    this.loadHealth();
    this.loadDocuments();
  }

  loadHealth(): void {
    this.docsService.health().subscribe({
      next: (h) => this.health.set(h),
      error: () => { },
    });
  }

  loadDocuments(): void {
    this.loadingDocs.set(true);
    this.docsService.list(50, 0).subscribe({
      next: (res) => {
        this.documents.set(res.items);
        this.loadingDocs.set(false);
      },
      error: () => {
        this.loadingDocs.set(false);
      },
    });
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFiles(files);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFiles(input.files);
    }
    input.value = '';
  }

  onMoreFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const combined = [...this.selectedFiles(), ...Array.from(input.files)];
      this.handleFiles(combined);
    }
    input.value = '';
  }

  removeSelectedFile(index: number): void {
    const updated = this.selectedFiles().filter((_, i) => i !== index);
    this.selectedFiles.set(updated);
    if (updated.length === 0) {
      this.validationError.set(null);
    }
  }

  private handleFiles(fileList: FileList | File[]): void {
    this.validationError.set(null);
    const valid: File[] = [];
    const maxBytes = 50 * 1024 * 1024;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (file.size > maxBytes) {
        this.validationError.set(`"${file.name}" is too large. Maximum supported size is 50 MB.`);
        return;
      }
      if (file.size === 0) {
        this.validationError.set(`"${file.name}" is empty (0 bytes).`);
        return;
      }
      const ext = this.getFileExtension(file.name).toLowerCase();
      if (!['pdf', 'doc', 'docx'].includes(ext)) {
        this.validationError.set(`"${file.name}" has an unsupported format. Please upload PDF, DOC, or DOCX.`);
        return;
      }
      valid.push(file);
    }

    if (valid.length > 10) {
      this.validationError.set('You can upload at most 10 documents at a time.');
      return;
    }

    this.selectedFiles.set(valid);
  }

  getTotalSelectedSize(): number {
    return this.selectedFiles().reduce((acc, f) => acc + f.size, 0);
  }

  cancelSelection(): void {
    this.selectedFiles.set([]);
    this.validationError.set(null);
  }

  clearComparisonSelection(): void {
    this.selectedForCompare.set(new Set());
  }

  getFileExtension(filename?: string): string {
    if (!filename) return '';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()! : '';
  }

  startUploadAndAnalysis(): void {
    const files = this.selectedFiles();
    if (files.length === 0) return;

    this.uploading.set(true);
    this.uploadPercent.set(0);
    this.validationError.set(null);

    if (files.length === 1) {
      const file = files[0];
      this.docsService.upload(file, true).subscribe({
        next: (event: UploadEvent) => {
          if (event.kind === 'progress') {
            this.uploadPercent.set(event.percent ?? 50);
          } else if (event.kind === 'complete') {
            this.uploading.set(false);
            this.toast.success(
              'Document uploaded successfully',
              `${file.name} is now queued for AI analysis.`
            );
            this.router.navigate(['/processing', event.response.id]);
          }
        },
        error: (err: any) => {
          this.uploading.set(false);
          const msg = err.message || 'Failed to upload document.';
          this.validationError.set(msg);
          this.toast.error('Upload failed', msg);
        },
      });
    } else {
      // Batch upload
      this.docsService.uploadBatch(files, true).subscribe({
        next: (event) => {
          if (event.kind === 'progress') {
            this.uploadPercent.set(event.percent ?? 50);
          } else if (event.kind === 'complete') {
            this.uploading.set(false);
            this.selectedFiles.set([]);
            this.toast.success(
              'Batch Upload Complete',
              `${event.response.count} trade documents queued for analysis.`
            );
            this.loadDocuments();
          }
        },
        error: (err: any) => {
          this.uploading.set(false);
          const msg = err.message || 'Batch upload failed.';
          this.validationError.set(msg);
          this.toast.error('Batch Upload Failed', msg);
        },
      });
    }
  }

  // ── Multi-Doc Comparison Selection ──
  toggleDocForCompare(id: string): void {
    const set = new Set(this.selectedForCompare());
    if (set.has(id)) {
      set.delete(id);
    } else {
      set.add(id);
    }
    this.selectedForCompare.set(set);
  }

  areAllCompletedSelected(): boolean {
    const completed = this.documents().filter((d) => d.status === 'completed');
    if (completed.length === 0) return false;
    return completed.every((d) => this.selectedForCompare().has(d.id));
  }

  toggleSelectAllCompleted(): void {
    const completed = this.documents().filter((d) => d.status === 'completed');
    if (this.areAllCompletedSelected()) {
      this.selectedForCompare.set(new Set());
    } else {
      const set = new Set<string>();
      for (const d of completed) {
        set.add(d.id);
      }
      this.selectedForCompare.set(set);
    }
  }

  launchComparison(): void {
    const ids = Array.from(this.selectedForCompare());
    if (ids.length < 2) {
      this.toast.error('Selection needed', 'Please select at least 2 completed documents to compare.');
      return;
    }
    this.router.navigate(['/compare'], { queryParams: { ids: ids.join(',') } });
  }

  downloadReport(id: string, filename: string): void {
    const reportName = filename.replace(/\.[^/.]+$/, '') + '-analysis.txt';
    this.docsService.downloadReport(id, reportName).subscribe({
      next: (name) => this.toast.success('Report downloaded', name),
      error: () => this.toast.error('Download failed', 'Could not download text report.'),
    });
  }

  deleteDoc(id: string): void {
    if (!confirm('Are you sure you want to delete this document and its analysis?')) return;

    this.docsService.remove(id).subscribe({
      next: () => {
        this.toast.success('Document deleted');
        this.loadDocuments();
      },
      error: () => {
        this.toast.error('Delete failed', 'Could not remove document.');
      },
    });
  }
}
