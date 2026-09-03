import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  imports: [RouterLink, Icon, FormsModule],
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

      <!-- Featured Real-World Presentation Dossier Showcase -->
      @if (getLibertyPresentationDocs().length > 0) {
        <section class="card liberty-showcase-section mt-24">
          <div class="liberty-showcase-inner">
            <div class="row between align-center wrap gap-12">
              <div class="row gap-12 align-center">
                <div class="liberty-badge-icon">
                  <app-icon name="shield-check" [size]="22" />
                </div>
                <div>
                  <div class="row gap-8 align-center wrap">
                    <span class="chip small chip-info font-bold uppercase">Featured Case Study</span>
                    <span class="small font-mono text-accent">Exporter: LIBERTY MILLS LIMITED (PK) → Buyer: KMART AUSTRALIA LTD</span>
                  </div>
                  <h3 class="h3 mt-4">Pakistan Export Presentation & Customs Reconciliation Dossier</h3>
                  <p class="small muted mt-2">Complete 4-document trade presentation matching authoritative banking examination standards: Commercial Invoice, Sales Contract, Ocean Sea Waybill & Pakistan Customs Goods Declaration (GD-I).</p>
                </div>
              </div>

              <div class="row gap-8 align-center">
                <button class="btn btn-sm btn-primary" (click)="reconcileLibertyPresentation()">
                  <app-icon name="scale" [size]="14" />
                  <span>Cross-Reconcile Full Set (4 Docs)</span>
                </button>
              </div>
            </div>

            <div class="liberty-docs-grid mt-16">
              @for (doc of getLibertyPresentationDocs(); track doc.id) {
                <div class="liberty-doc-card">
                  <div class="row between align-center">
                    <span class="chip small font-mono uppercase">{{ getDocumentLabel(doc.filename) }}</span>
                    <span class="chip small" [class.chip-positive]="doc.status === 'completed'" [class.chip-warning]="doc.status === 'processing'">
                      {{ doc.status }}
                    </span>
                  </div>
                  <div class="font-bold text-ink mt-8 truncate" [title]="doc.filename">{{ doc.filename }}</div>
                  <div class="small muted mt-4">
                    @if (doc.tradeDocumentType) {
                      <span class="text-accent font-bold">{{ doc.tradeDocumentType }}</span>
                      @if (doc.tradeDecision) {
                        <span class="sep">·</span>
                        <span class="chip small" [class.chip-positive]="doc.tradeDecision === 'ALLOW'" [class.chip-warning]="doc.tradeDecision === 'REVIEW'" [class.chip-negative]="doc.tradeDecision === 'BLOCK_ESCALATE'">
                          {{ doc.tradeDecision }}
                        </span>
                      }
                    } @else {
                      <span>{{ formatBytes(doc.fileSize) }} · {{ doc.fileType }}</span>
                    }
                  </div>
                  <div class="row gap-8 mt-12">
                    <a [routerLink]="['/analysis', doc.id]" class="btn btn-xs btn-primary">
                      <app-icon name="eye" [size]="12" />
                      <span>Analyze</span>
                    </a>
                  </div>
                </div>
              }
            </div>
          </div>
        </section>
      }

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
          <div class="row gap-8 align-center">
            @if (selectedForCompare().size >= 2) {
              <button class="btn btn-sm btn-primary" (click)="launchComparison()">
                <app-icon name="scale" [size]="14" />
                <span>Reconcile ({{ selectedForCompare().size }} Selected)</span>
              </button>
            }
            @if (documents().length > 0) {
              <button class="btn btn-sm btn-danger-outline" (click)="openDeleteHistoryModal()" title="Clear history from active view (all records and raw files remain safe in MongoDB Atlas)">
                <app-icon name="trash" [size]="14" />
                <span>Clear History</span>
              </button>
            }
            <button class="btn btn-sm btn-ghost" (click)="restoreAllHistory()" title="Restore archived history from MongoDB Atlas cloud database" [disabled]="loadingDocs()">
              <app-icon name="cloud" [size]="14" />
              <span>Restore from Cloud</span>
            </button>
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
                      <p class="font-medium mt-12">No active trade documents in view</p>
                      <p class="small muted mt-4">
                        Upload your PDF or Word documents above, or restore previously archived trade presentations from your MongoDB Atlas cloud database.
                      </p>
                      <div class="row gap-10 mt-14 justify-center">
                        <button type="button" class="btn btn-sm btn-primary" (click)="restoreAllHistory()">
                          <app-icon name="cloud" [size]="14" />
                          <span>Restore History from Cloud DB</span>
                        </button>
                      </div>
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

      <!-- Delete History Modal -->
      @if (showDeleteHistoryModal()) {
        <div class="modal-backdrop" (click)="closeDeleteHistoryModal()">
          <div class="modal-card delete-history-modal" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <div class="row gap-10 align-center">
                <div class="delete-icon-circle">
                  <app-icon name="trash" [size]="18" />
                </div>
                <div>
                  <h3 class="h3 text-ink">Clear Trade Analysis History</h3>
                  <p class="small muted">Clear items from your active dashboard view while preserving all data safely in MongoDB Atlas.</p>
                </div>
              </div>
              <button class="btn-icon-xs" (click)="closeDeleteHistoryModal()">
                <app-icon name="close" [size]="16" />
              </button>
            </div>

            <div class="modal-body mt-16">
              <!-- Mode Switcher -->
              <div class="delete-mode-switcher">
                <button
                  type="button"
                  class="mode-btn"
                  [class.active]="deleteHistoryMode() === 'range'"
                  (click)="deleteHistoryMode.set('range')"
                >
                  <app-icon name="calendar" [size]="15" />
                  <span>Clear by Date Range</span>
                </button>
                <button
                  type="button"
                  class="mode-btn"
                  [class.active]="deleteHistoryMode() === 'all'"
                  (click)="deleteHistoryMode.set('all')"
                >
                  <app-icon name="trash" [size]="15" />
                  <span>Clear All Dashboard View</span>
                </button>
              </div>

              <!-- Mode 1: Date Range -->
              @if (deleteHistoryMode() === 'range') {
                <div class="range-picker-container mt-16">
                  <p class="small muted mb-12">
                    Specify a date interval to remove matching presentations from active display. All original files and analyses remain preserved in MongoDB Atlas.
                  </p>

                  <div class="date-inputs-row">
                    <div class="date-field">
                      <label class="label small font-medium">From Date (Start):</label>
                      <input
                        type="date"
                        class="input font-mono"
                        [ngModel]="deleteFromDate()"
                        (ngModelChange)="deleteFromDate.set($event)"
                      />
                    </div>
                    <div class="date-field">
                      <label class="label small font-medium">To Date (End):</label>
                      <input
                        type="date"
                        class="input font-mono"
                        [ngModel]="deleteToDate()"
                        (ngModelChange)="deleteToDate.set($event)"
                      />
                    </div>
                  </div>

                  <div class="matching-preview-badge mt-14">
                    <app-icon name="info" [size]="15" class="text-accent" />
                    <span><strong>{{ getFilteredHistoryCount() }}</strong> of <strong>{{ documents().length }}</strong> document(s) match this date filter.</span>
                  </div>
                </div>
              }

              <!-- Mode 2: Delete All -->
              @if (deleteHistoryMode() === 'all') {
                <div class="delete-all-container mt-16">
                  <div class="warning-callout" style="background: rgba(14, 165, 233, 0.08); border-color: rgba(14, 165, 233, 0.25);">
                    <app-icon name="cloud" [size]="18" class="text-accent" />
                    <div>
                      <strong class="text-accent block">Permanent Cloud Preservation Guaranteed</strong>
                      <span class="small text-ink">
                        This will clear all <strong>{{ documents().length }}</strong> documents from your active dashboard screen. 100% of your records, OCR units, and original PDF files remain safe in your MongoDB Atlas cloud database and can be restored anytime via <strong>"Restore from Cloud"</strong>.
                      </span>
                    </div>
                  </div>

                  <label class="confirm-checkbox-row mt-16">
                    <input
                      type="checkbox"
                      [checked]="confirmDeleteAllChecked()"
                      (change)="confirmDeleteAllChecked.set(!confirmDeleteAllChecked())"
                    />
                    <span class="small font-medium text-ink">
                      Clear these documents from active view (preserved in cloud database).
                    </span>
                  </label>
                </div>
              }
            </div>

            <div class="modal-footer row between align-center mt-20">
              <button class="btn btn-sm btn-ghost" (click)="closeDeleteHistoryModal()">
                Cancel
              </button>
              <button
                class="btn btn-sm btn-danger"
                [disabled]="deletingHistory() || (deleteHistoryMode() === 'all' && !confirmDeleteAllChecked()) || (deleteHistoryMode() === 'range' && getFilteredHistoryCount() === 0)"
                (click)="executeDeleteHistory()"
              >
                @if (deletingHistory()) {
                  <span class="spin"><app-icon name="refresh" [size]="14" /></span>
                  <span>Clearing...</span>
                } @else if (deleteHistoryMode() === 'all') {
                  <app-icon name="trash" [size]="14" />
                  <span>Clear All {{ documents().length }} from View</span>
                } @else {
                  <app-icon name="trash" [size]="14" />
                  <span>Delete {{ getFilteredHistoryCount() }} Matching Document(s)</span>
                }
              </button>
            </div>
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

    /* ── Liberty Showcase Section ── */
    .liberty-showcase-section {
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.06), rgba(99, 102, 241, 0.04));
      border: 1px solid rgba(14, 165, 233, 0.25);
      border-radius: var(--radius-lg);
      padding: 20px;
    }
    .liberty-showcase-inner {
      width: 100%;
    }
    .liberty-badge-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: var(--accent-soft);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .liberty-docs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 12px;
    }
    .liberty-doc-card {
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      padding: 14px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: all 0.2s ease;
    }
    .liberty-doc-card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
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

    /* ── Delete History Modal & Styles ── */
    .btn-danger-outline {
      background: transparent;
      border: 1px solid color-mix(in srgb, var(--negative) 40%, transparent);
      color: var(--negative);
      transition: all 0.15s ease;
    }
    .btn-danger-outline:hover {
      background: var(--negative-soft);
      border-color: var(--negative);
    }
    .btn-danger {
      background: var(--negative);
      color: #fff;
      border: 1px solid var(--negative);
      font-weight: 600;
    }
    .btn-danger:hover:not(:disabled) {
      filter: brightness(1.1);
    }
    .btn-danger:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 16px;
      animation: fade-in 0.2s ease-out both;
    }

    .delete-history-modal {
      width: 100%;
      max-width: 520px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 24px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
      animation: scale-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .delete-icon-circle {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--negative-soft);
      color: var(--negative);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .delete-mode-switcher {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      background: var(--sunken);
      padding: 4px;
      border-radius: var(--radius);
      border: 1px solid var(--line);
    }

    .mode-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 8px 12px;
      border: none;
      background: transparent;
      color: var(--ink-2);
      font-size: 0.82rem;
      font-weight: 550;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .mode-btn.active {
      background: var(--raised);
      color: var(--ink);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
    }

    .date-inputs-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .date-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .matching-preview-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      background: var(--accent-soft);
      color: var(--ink);
      font-size: 0.82rem;
    }

    .warning-callout {
      display: flex;
      gap: 10px;
      padding: 12px;
      border-radius: var(--radius-sm);
      background: var(--negative-soft);
      border: 1px solid color-mix(in srgb, var(--negative) 30%, transparent);
    }

    .confirm-checkbox-row {
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      user-select: none;
    }

    /* ── Table Gutter & Overflow Fix ── */
    .table-wrap {
      overflow-x: auto;
      padding: 0 2px;
    }
    .table th, .table td {
      padding: 12px 14px;
    }
    .table th:first-child, .table td:first-child {
      padding-left: 18px;
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
      .date-inputs-row {
        grid-template-columns: 1fr;
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

  // ── Delete History Signals ──
  protected readonly showDeleteHistoryModal = signal(false);
  protected readonly deleteHistoryMode = signal<'range' | 'all'>('range');
  protected readonly deleteFromDate = signal<string>('');
  protected readonly deleteToDate = signal<string>('');
  protected readonly confirmDeleteAllChecked = signal(false);
  protected readonly deletingHistory = signal(false);

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

  // ── Liberty Mills Real Presentation Helpers ──
  getLibertyPresentationDocs(): DocumentSummary[] {
    const keywords = ['liberty', 'cosco', 'pakistan_customs', 'inv-5771', 'ctr-050', 'cosu6445585470', 'gd2905'];
    return this.documents().filter((d) => keywords.some((k) => d.filename.toLowerCase().includes(k)));
  }

  getDocumentLabel(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.includes('invoice') || lower.includes('inv-5771')) return 'Commercial Invoice (1.jpg)';
    if (lower.includes('contract') || lower.includes('ctr-050')) return 'Sales Contract (2.jpg)';
    if (lower.includes('waybill') || lower.includes('cosu')) return 'Sea Waybill (3.jpg)';
    if (lower.includes('customs') || lower.includes('gd2905')) return 'Goods Declaration GD-I (4.jpg)';
    return 'Trade Document';
  }

  reconcileLibertyPresentation(): void {
    const docs = this.getLibertyPresentationDocs();
    if (docs.length < 2) {
      this.toast.error('Presentation files needed', 'At least 2 presentation documents must be available.');
      return;
    }
    const ids = docs.map((d) => d.id).join(',');
    this.router.navigate(['/compare'], { queryParams: { ids } });
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

  // ── Delete History Modal Handlers ──
  openDeleteHistoryModal(): void {
    this.showDeleteHistoryModal.set(true);
    this.confirmDeleteAllChecked.set(false);
  }

  closeDeleteHistoryModal(): void {
    this.showDeleteHistoryModal.set(false);
    this.confirmDeleteAllChecked.set(false);
  }

  getFilteredHistoryCount(): number {
    const from = this.deleteFromDate();
    const to = this.deleteToDate();
    if (!from && !to) {
      return this.documents().length;
    }
    const fromTime = from ? new Date(from).getTime() : -Infinity;
    const toTime = to ? new Date(to).setHours(23, 59, 59, 999) : Infinity;

    return this.documents().filter((d) => {
      const upTime = new Date(d.uploadedAt).getTime();
      return upTime >= fromTime && upTime <= toTime;
    }).length;
  }

  executeDeleteHistory(): void {
    const mode = this.deleteHistoryMode();
    this.deletingHistory.set(true);

    const payload =
      mode === 'all'
        ? { all: true }
        : {
            all: false,
            fromDate: this.deleteFromDate() || undefined,
            toDate: this.deleteToDate() || undefined,
          };

    this.docsService.deleteHistory(payload).subscribe({
      next: (res) => {
        this.deletingHistory.set(false);
        this.closeDeleteHistoryModal();
        this.toast.success(
          'History Deleted',
          `Successfully removed ${res.deletedCount} trade presentation document(s).`
        );
        this.selectedForCompare.set(new Set());
        this.loadDocuments();
      },
      error: (err) => {
        this.deletingHistory.set(false);
        this.toast.error(
          'Deletion Failed',
          err.message || 'Could not delete documents.'
        );
      },
    });
  }

  restoreAllHistory(): void {
    this.loadingDocs.set(true);
    this.docsService.restoreHistory({ all: true }).subscribe({
      next: (res) => {
        this.loadingDocs.set(false);
        this.toast.success(
          'History Restored',
          `Restored ${res.restoredCount} document(s) from MongoDB Atlas cloud database.`
        );
        this.loadDocuments();
      },
      error: (err) => {
        this.loadingDocs.set(false);
        this.toast.error(
          'Restore Failed',
          err.message || 'Could not restore documents from database.'
        );
      },
    });
  }
}
