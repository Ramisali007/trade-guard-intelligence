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
            <span class="eyebrow">AI-Powered Document Intelligence</span>
          </div>

          <h1 class="hero-title">
            Transform Documents into<br>
            <span class="hero-title-accent">Structured Intelligence</span>
          </h1>

          <p class="hero-lede">
            Upload a PDF or Word document and let AI extract, segment, understand and
            classify every meaningful section with paragraph-level precision.
          </p>

          <!-- Engine Status -->
          @if (health()) {
            <div class="hero-engine">
              <div class="hero-engine-dot"></div>
              <app-icon name="cpu" [size]="13" />
              <span>{{ health()?.engine?.provider }} · {{ health()?.engine?.model }}</span>
              <span class="hero-engine-sep">|</span>
              <span>{{ health()?.storage?.driver }}</span>
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
            <h2 class="h2">Upload Document</h2>
          </div>
          <span class="small muted">PDF, DOC, DOCX · Up to 50 MB</span>
        </div>

        <div class="card-body">
          @if (!selectedFile() && !uploading()) {
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

                <div class="dropzone-text">
                  <div class="dropzone-title">
                    <strong>Choose a file</strong> or drag & drop it here
                  </div>
                  <div class="small muted mt-8">
                    Documents with hundreds of pages are automatically chunked & processed in parallel.
                  </div>
                </div>

                <div class="dropzone-formats">
                  <span class="format-chip"><app-icon name="page" [size]="11" /> PDF</span>
                  <span class="format-chip"><app-icon name="document" [size]="11" /> DOC</span>
                  <span class="format-chip"><app-icon name="document" [size]="11" /> DOCX</span>
                </div>
              </div>
            </div>
          }

          <!-- Selected File Preview -->
          @if (selectedFile() && !uploading()) {
            <div class="file-preview">
              <div class="file-preview-icon">
                <app-icon name="document" [size]="24" />
              </div>
              <div class="file-preview-details">
                <div class="file-preview-name">{{ selectedFile()?.name }}</div>
                <div class="row gap-8 mt-4 small muted">
                  <span class="chip chip-info">{{ getFileExtension(selectedFile()?.name) }}</span>
                  <span>{{ formatBytes(selectedFile()?.size || 0) }}</span>
                </div>
              </div>
              <div class="file-preview-actions">
                <button
                  class="btn btn-ghost btn-danger btn-sm"
                  (click)="clearSelectedFile()"
                  title="Remove selected file"
                >
                  <app-icon name="trash" [size]="14" />
                  <span>Remove</span>
                </button>
                <button
                  class="btn btn-primary btn-lg"
                  (click)="startUploadAndAnalysis()"
                >
                  <app-icon name="sparkle" [size]="16" />
                  <span>Analyze Document</span>
                </button>
              </div>
            </div>
          }

          <!-- Upload Progress -->
          @if (uploading()) {
            <div class="upload-progress">
              <div class="upload-progress-top">
                <div class="row gap-8">
                  <div class="upload-spinner">
                    <div class="spin"><app-icon name="refresh" [size]="16" /></div>
                  </div>
                  <span class="font-medium">Uploading {{ selectedFile()?.name }}</span>
                </div>
                <span class="upload-pct tnum">{{ uploadPercent() }}%</span>
              </div>
              <div class="meter meter-active upload-meter">
                <span [style.width.%]="uploadPercent()"></span>
              </div>
              <div class="small muted mt-8">
                Transferring document to secure analysis worker...
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

      <!-- Recent Documents Section -->
      <section class="card history-section">
        <div class="card-head">
          <div class="row gap-8">
            <app-icon name="list" [size]="18" />
            <h2 class="h2">Analyzed Documents</h2>
          </div>
          <button class="btn btn-sm btn-ghost" (click)="loadDocuments()" [disabled]="loadingDocs()">
            <app-icon name="refresh" [size]="14" [class.spin]="loadingDocs()" />
            <span>Refresh</span>
          </button>
        </div>

        <div class="table-wrap">
          <table class="table table-hover">
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Size</th>
                <th>Pages</th>
                <th>Passages</th>
                <th>Dominant Tone</th>
                <th>Status</th>
                <th>Uploaded</th>
                <th class="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (doc of documents(); track doc.id) {
                <tr>
                  <td>
                    <div class="row gap-8 font-medium">
                      <app-icon name="document" [size]="15" class="muted" />
                      <a [routerLink]="doc.status === 'completed' ? ['/analysis', doc.id] : ['/processing', doc.id]">
                        {{ doc.filename }}
                      </a>
                    </div>
                  </td>
                  <td>
                    <span class="chip chip-info uppercase">{{ doc.fileType }}</span>
                  </td>
                  <td class="muted tnum">{{ formatBytes(doc.fileSize) }}</td>
                  <td class="tnum">{{ doc.pageCount !== null ? doc.pageCount : '—' }}</td>
                  <td class="tnum">{{ doc.analyzedUnits !== null ? doc.analyzedUnits : '—' }}</td>
                  <td>
                    @if (doc.dominantSentiment) {
                      <span
                        class="chip"
                        [class.chip-positive]="doc.dominantSentiment === 'positive'"
                        [class.chip-negative]="doc.dominantSentiment === 'negative'"
                      >
                        {{ doc.dominantSentiment }}
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
                        Upload your first PDF or Word document above to start the AI analysis pipeline.
                      </p>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
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

    /* ── Dropzone ── */
    .dropzone {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 2px dashed var(--line-strong);
      border-radius: var(--radius-lg);
      background: var(--sunken);
      cursor: pointer;
      overflow: hidden;
      transition:
        border-color var(--dur) var(--ease),
        background var(--dur) var(--ease),
        transform var(--dur) var(--ease),
        box-shadow var(--dur) var(--ease);
    }

    .dropzone:hover,
    .dropzone.drag-over {
      border-color: var(--accent);
      background: var(--accent-soft);
      transform: scale(1.005);
      box-shadow: inset 0 0 0 1px var(--accent-ring), var(--glow-accent);
    }

    .dropzone.drag-over {
      transform: scale(1.01);
    }

    .dropzone-visual {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 40px 24px;
      gap: 16px;
    }

    .dropzone-icon-ring {
      position: relative;
    }

    .dropzone-icon-ring::before {
      content: '';
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      border: 2px dashed color-mix(in srgb, var(--accent) 20%, transparent);
      animation: spin 12s linear infinite;
    }

    .dropzone-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--raised);
      box-shadow: var(--shadow), var(--glow-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent);
      transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
    }

    .dropzone:hover .dropzone-icon {
      transform: translateY(-2px);
      box-shadow: var(--shadow-lg), var(--glow-accent);
    }

    .dropzone-title {
      font-size: 1rem;
      color: var(--ink);
    }

    .dropzone-formats {
      display: flex;
      gap: 8px;
    }

    .format-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border-radius: var(--radius-sm);
      background: var(--raised);
      border: 1px solid var(--line);
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--ink-2);
      letter-spacing: 0.03em;
    }

    /* ── File Preview ── */
    .file-preview {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 18px 22px;
      background: var(--sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      flex-wrap: wrap;
      animation: scale-in var(--dur) var(--ease-out) both;
    }

    .file-preview-icon {
      width: 48px;
      height: 48px;
      border-radius: var(--radius);
      background: var(--accent-soft);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
    }

    .file-preview-details {
      flex: 1 1 auto;
      min-width: 200px;
    }

    .file-preview-name {
      font-weight: 650;
      color: var(--ink);
      font-size: 0.95rem;
    }

    .file-preview-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    /* ── Upload Progress ── */
    .upload-progress {
      padding: 22px;
      background: var(--sunken);
      border-radius: var(--radius-lg);
      border: 1px solid var(--line);
      animation: scale-in var(--dur) var(--ease-out) both;
    }

    .upload-progress-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .upload-spinner {
      color: var(--accent);
    }

    .upload-pct {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--accent);
    }

    .upload-meter {
      height: 8px;
    }

    /* ── Validation ── */
    .validation-alert {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: var(--radius);
      background: var(--negative-soft);
      border: 1px solid color-mix(in srgb, var(--negative) 25%, transparent);
      color: var(--negative);
      font-size: 0.85rem;
      animation: scale-in var(--dur-fast) var(--ease) both;
    }

    /* ── History Section ── */
    .history-section {
      overflow: hidden;
    }

    .chip-dot-pulse {
      animation: breathing 1.5s ease-in-out infinite;
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
      .file-preview-actions {
        flex-wrap: wrap;
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

  protected readonly selectedFile = signal<File | null>(null);
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
      error: () => {},
    });
  }

  loadDocuments(): void {
    this.loadingDocs.set(true);
    this.docsService.list(50, 0).subscribe({
      next: (res) => {
        this.documents.set(res.items);
        this.loadingDocs.set(false);
      },
      error: (err) => {
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
      this.handleFile(files[0]);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
    input.value = '';
  }

  private handleFile(file: File): void {
    this.validationError.set(null);

    // Validate size (e.g. 50MB)
    const maxBytes = 50 * 1024 * 1024;
    if (file.size > maxBytes) {
      this.validationError.set(
        `File is too large (${formatBytes(file.size)}). Maximum supported size is 50 MB.`
      );
      return;
    }

    if (file.size === 0) {
      this.validationError.set('The selected document is empty (0 bytes).');
      return;
    }

    // Validate extension
    const ext = this.getFileExtension(file.name).toLowerCase();
    if (!['pdf', 'doc', 'docx'].includes(ext)) {
      this.validationError.set(
        'Unsupported file format. Please upload a PDF, DOC, or DOCX document.'
      );
      return;
    }

    this.selectedFile.set(file);
  }

  clearSelectedFile(): void {
    this.selectedFile.set(null);
    this.validationError.set(null);
  }

  getFileExtension(filename?: string): string {
    if (!filename) return '';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()! : '';
  }

  startUploadAndAnalysis(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.uploading.set(true);
    this.uploadPercent.set(0);
    this.validationError.set(null);

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
          // Navigate to processing screen
          this.router.navigate(['/processing', event.response.id]);
        }
      },
      error: (err: any) => {
        this.uploading.set(false);
        const msg = err.message || 'Failed to upload document.';
        this.validationError.set(msg);
        this.toast.error('Upload failed', msg, err.requestId);
      },
    });
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
