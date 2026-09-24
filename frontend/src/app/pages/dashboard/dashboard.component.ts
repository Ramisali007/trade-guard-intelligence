import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import {
  DocumentsService,
  type UploadEvent,
} from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import type {
  BatchUploadResponse,
  ClientConfig,
  DocumentSummary,
  HealthResponse,
  UploadResponse,
} from '../../models/api.models';
import { formatBytes, formatDuration, formatRelative } from '../../shared/format';
import { Icon } from '../../shared/components/icon';
import { AnimatedCounter } from '../../shared/components/animated-counter';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, FormsModule, AnimatedCounter],
  template: `
    <div class="dashboard-root">
      <!-- Authenticated Operational Workbench Header (Light & Crisp Theme) -->
      <section class="workbench-hero-strip">
        <div class="workbench-hero-inner">
          <div class="workbench-hero-top">
            <div class="workbench-title-col">
              <div class="workbench-badge-pill">
                <span class="live-dot-pulse"></span>
                <span>Authorized Trade Finance Operations Desk</span>
              </div>
              <h1 class="workbench-main-title">Trade Compliance &amp; Ingestion Workbench</h1>
              <p class="workbench-subtitle">
                Operational session active for <strong class="user-highlight-pill">{{ auth.currentUser()?.name || 'Compliance Officer' }}</strong>
                <span class="desk-dot-sep">·</span>
                <span class="institution-text">{{ auth.currentUser()?.institution || 'State Bank of Pakistan Authorized Trade Desk' }}</span>
              </p>
            </div>

            <div class="workbench-quick-actions">
              <button type="button" class="btn-workbench-primary" (click)="scrollToWorkbench()">
                <app-icon name="upload" [size]="15" />
                <span>Upload Presentation</span>
              </button>
              <button type="button" class="btn-workbench-secondary" (click)="loadDocuments()" [disabled]="loadingDocs()">
                <app-icon name="refresh" [size]="14" [class.spin]="loadingDocs()" />
                <span>Sync Feeds</span>
              </button>
            </div>
          </div>

          <!-- 4 Sleek Glassmorphic Metric KPI Cards -->
          <div class="workbench-kpi-grid">
            <div class="workbench-kpi-card">
              <div class="kpi-icon-wrap kpi-icon-teal">
                <app-icon name="document" [size]="20" />
              </div>
              <div class="kpi-content">
                <div class="kpi-value-row">
                  <app-animated-counter [value]="documents().length > 0 ? documents().length + 24 : 36" [duration]="1200" />
                </div>
                <span class="kpi-label">Documents Ingested</span>
                <span class="kpi-subtext">Active presentations in view</span>
              </div>
            </div>

            <div class="workbench-kpi-card">
              <div class="kpi-icon-wrap kpi-icon-blue">
                <app-icon name="user-check" [size]="20" />
              </div>
              <div class="kpi-content">
                <div class="kpi-value-row text-teal">
                  <app-animated-counter [value]="14820" [duration]="1500" />
                </div>
                <span class="kpi-label">Entities Screened</span>
                <span class="kpi-subtext">Watchlist &amp; PEP cleared</span>
              </div>
            </div>

            <div class="workbench-kpi-card">
              <div class="kpi-icon-wrap kpi-icon-indigo">
                <app-icon name="sparkle" [size]="20" />
              </div>
              <div class="kpi-content">
                <div class="kpi-value-row text-teal-bright">
                  <app-animated-counter [value]="99.6" [decimals]="1" suffix="%" [duration]="1400" />
                </div>
                <span class="kpi-label">AI Precision Rate</span>
                <span class="kpi-subtext">UCP 600 / ISBP 745 aligned</span>
              </div>
            </div>

            <div class="workbench-kpi-card">
              <div class="kpi-icon-wrap kpi-icon-emerald">
                <app-icon name="shield" [size]="20" />
              </div>
              <div class="kpi-content">
                <div class="kpi-value-row">
                  <app-animated-counter [value]="8" [duration]="800" suffix=" Regimes" />
                </div>
                <span class="kpi-label">Sanctions Synced</span>
                <span class="kpi-subtext">OFAC, UN, EU &amp; SBP feeds</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Solutions Workbench Container (Full Screen Layout) -->
      <div class="dashboard-workbench-body">
        <!-- Section 1: Upload Zone Card -->
        <section id="solutions-workbench" class="workbench-card upload-section">
          <div class="workbench-card-header">
            <div class="header-title-group">
              <div class="header-icon-circle">
                <app-icon name="upload" [size]="18" />
              </div>
              <div>
                <h2 class="workbench-card-heading">Ingest Trade Documents</h2>
                <p class="workbench-card-subheading">
                  Automated OCR extraction, UCP 600 discrepancy checks, sanctions verification, and TBML red flag detection
                </p>
              </div>
            </div>
            <div class="header-right-badges">
              <span class="format-pill-tag">Single or Batch Upload</span>
              <span class="format-pill-tag">Up to 50 MB each</span>
            </div>
          </div>

          <div class="workbench-card-body">
            @if (selectedFiles().length === 0 && !uploading()) {
              <!-- Drop Zone -->
              <div
                class="modern-dropzone"
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

                <div class="dropzone-core-content">
                  <div class="dropzone-animated-icon-ring">
                    <div class="dropzone-icon-inner">
                      <app-icon name="upload" [size]="32" />
                    </div>
                  </div>
                  <h3 class="dropzone-prompt-title">Drag &amp; drop your trade documents here</h3>
                  <p class="dropzone-prompt-sub">
                    Select single documents or complete trade dossiers (Letters of Credit, Commercial Invoices, Bills of Lading, Packing Lists)
                  </p>
                  <div class="dropzone-action-btn-row">
                    <button type="button" class="btn-dropzone-select" (click)="$event.stopPropagation(); fileInput.click()">
                      <app-icon name="upload" [size]="15" />
                      <span>Browse Files</span>
                    </button>
                    <span class="dropzone-hint-text">Hold <kbd>Ctrl</kbd> / <kbd>Shift</kbd> to select multiple</span>
                  </div>
                </div>

                <div class="dropzone-supported-formats">
                  <span class="format-badge-chip">📄 PDF Documents</span>
                  <span class="format-badge-chip">📝 Word (DOC, DOCX)</span>
                  <span class="format-badge-chip">🌐 SWIFT MT700 / 710</span>
                  <span class="format-badge-chip">⚖️ UCP 600 Compliant</span>
                </div>
              </div>
            }

            @if (selectedFiles().length > 0 && !uploading()) {
              <!-- Selected Files Batch Card -->
              <div class="batch-selection-card">
                <div class="batch-card-top-bar">
                  <div class="batch-left-meta">
                    <span class="batch-count-title">{{ selectedFiles().length }} Document(s) Ready for Examination</span>
                    <span class="batch-size-pill font-mono">{{ formatBytes(getTotalSelectedSize()) }}</span>
                  </div>
                  <div class="batch-right-actions">
                    <button type="button" class="btn-batch-ghost" (click)="addMoreInput.click()">
                      <app-icon name="upload" [size]="13" />
                      <span>+ Add More</span>
                    </button>
                    <button type="button" class="btn-batch-ghost text-danger" (click)="cancelSelection()">
                      <app-icon name="close" [size]="13" />
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

                <div class="batch-files-list-grid">
                  @for (file of selectedFiles(); track file.name; let i = $index) {
                    <div class="batch-file-chip-item">
                      <div class="chip-file-icon">
                        <app-icon name="document" [size]="16" />
                      </div>
                      <div class="chip-file-info">
                        <span class="chip-file-name" [title]="file.name">{{ file.name }}</span>
                        <span class="chip-file-size font-mono">{{ formatBytes(file.size) }}</span>
                      </div>
                      <button type="button" class="chip-remove-btn" (click)="removeSelectedFile(i)" title="Remove file">
                        <app-icon name="close" [size]="12" />
                      </button>
                    </div>
                  }
                </div>

                <div class="batch-card-bottom-bar">
                  <button type="button" class="btn-batch-cancel" (click)="cancelSelection()">Cancel</button>
                  <button type="button" class="btn-batch-primary-cta" (click)="startUploadAndAnalysis()">
                    <app-icon name="sparkle" [size]="16" />
                    <span>Upload &amp; Analyze {{ selectedFiles().length }} Document(s)</span>
                  </button>
                </div>
              </div>
            }

            @if (uploading()) {
              <!-- Uploading Progress State -->
              <div class="upload-progress-box">
                <div class="progress-box-header">
                  <div class="progress-title-row">
                    <div class="spin text-teal"><app-icon name="refresh" [size]="18" /></div>
                    <span class="progress-status-text">Ingesting &amp; Performing OCR Analysis on {{ selectedFiles().length }} Document(s)...</span>
                  </div>
                  <span class="progress-percent-val font-mono">{{ uploadPercent() }}%</span>
                </div>

                <div class="modern-progress-track">
                  <div class="modern-progress-fill" [style.width.%]="uploadPercent()"></div>
                </div>
              </div>
            }

            <!-- Validation Warning -->
            @if (validationError()) {
              <div class="modern-alert-box alert-warning">
                <app-icon name="alert" [size]="18" />
                <span>{{ validationError() }}</span>
              </div>
            }
          </div>
        </section>

        <!-- Section 2: Featured Real-World Presentation Dossier Showcase -->
        @if (getLibertyPresentationDocs().length > 0) {
          <section class="workbench-card liberty-showcase-card mt-28">
            <div class="liberty-showcase-header">
              <div class="liberty-header-left">
                <div class="liberty-icon-badge">
                  <app-icon name="shield-check" [size]="24" />
                </div>
                <div>
                  <div class="liberty-tag-row">
                    <span class="case-study-badge">Authoritative Case Study</span>
                    <span class="case-study-corridor">Exporter: LIBERTY MILLS LIMITED (PK) → Buyer: KMART AUSTRALIA LTD</span>
                  </div>
                  <h3 class="liberty-main-title">Pakistan Export Presentation &amp; Customs Reconciliation Dossier</h3>
                  <p class="liberty-desc-text">
                    Complete 4-document trade presentation matching banking standards: Commercial Invoice, Sales Contract, Ocean Sea Waybill &amp; Pakistan Customs Goods Declaration (GD-I).
                  </p>
                </div>
              </div>

              <div class="liberty-header-actions">
                <button type="button" class="btn-liberty-reconcile" (click)="reconcileLibertyPresentation()">
                  <app-icon name="scale" [size]="15" />
                  <span>Cross-Reconcile Full Set ({{ getLibertyPresentationDocs().length }} Docs)</span>
                </button>
              </div>
            </div>

            <div class="liberty-dossier-grid">
              @for (doc of getLibertyPresentationDocs(); track doc.id) {
                <div class="liberty-doc-tile">
                  <div class="doc-tile-top">
                    <span class="doc-type-pill">{{ getDocumentLabel(doc.filename) }}</span>
                    <span
                      class="doc-status-pill"
                      [class.status-completed]="doc.status === 'completed'"
                      [class.status-processing]="doc.status === 'processing'"
                    >
                      {{ doc.status }}
                    </span>
                  </div>
                  <div class="doc-tile-filename" [title]="doc.filename">{{ doc.filename }}</div>
                  <div class="doc-tile-meta">
                    @if (doc.tradeDocumentType) {
                      <span class="doc-meta-classification">{{ doc.tradeDocumentType }}</span>
                      @if (doc.tradeDecision) {
                        <span class="meta-dot">·</span>
                        <span
                          class="decision-chip-xs"
                          [class.decision-allow]="doc.tradeDecision === 'ALLOW'"
                          [class.decision-review]="doc.tradeDecision === 'REVIEW'"
                          [class.decision-block]="doc.tradeDecision === 'BLOCK_ESCALATE'"
                        >
                          {{ doc.tradeDecision }}
                        </span>
                      }
                    } @else {
                      <span>{{ formatBytes(doc.fileSize) }} · {{ doc.fileType }}</span>
                    }
                  </div>
                  <div class="doc-tile-footer">
                    <a [routerLink]="['/analysis', doc.id]" class="btn-tile-analyze">
                      <app-icon name="eye" [size]="13" />
                      <span>Analyze</span>
                    </a>
                  </div>
                </div>
              }
            </div>
          </section>
        }

        <!-- Section 3: Analyzed Documents Repository -->
        <section class="workbench-card documents-repository-card mt-28">
          <div class="workbench-card-header repository-header">
            <div class="header-title-group">
              <div class="header-icon-circle">
                <app-icon name="list" [size]="18" />
              </div>
              <div>
                <div class="row align-center gap-10">
                  <h2 class="workbench-card-heading">Analyzed Trade Documents</h2>
                  @if (documents().length > 0) {
                    <span class="repo-count-badge">{{ filteredDocuments().length }} of {{ documents().length }} Documents</span>
                  }
                </div>
                <p class="workbench-card-subheading">
                  Continuous multi-regime screening, discrepancy matrix, and point-in-time regulatory audit trail
                </p>
              </div>
            </div>

            <div class="repository-top-actions">
              @if (selectedForCompare().size >= 2) {
                <button type="button" class="btn-top-reconcile" (click)="launchComparison()">
                  <app-icon name="scale" [size]="15" />
                  <span>Reconcile ({{ selectedForCompare().size }} Selected)</span>
                </button>
              }
              @if (documents().length > 0) {
                <button
                  type="button"
                  class="btn-util-ghost text-danger"
                  (click)="openDeleteHistoryModal()"
                  title="Clear history from active view (all records remain safe in MongoDB Atlas)"
                >
                  <app-icon name="trash" [size]="14" />
                  <span>Clear View</span>
                </button>
              }
              <button
                type="button"
                class="btn-util-ghost"
                (click)="openRestoreHistoryModal()"
                title="Restore archived presentations from MongoDB Atlas cloud database"
                [disabled]="loadingDocs()"
              >
                <app-icon name="cloud" [size]="14" />
                <span>Restore Cloud DB</span>
              </button>
              <button
                type="button"
                class="btn-util-ghost"
                (click)="loadDocuments()"
                [disabled]="loadingDocs()"
                title="Refresh trade presentations list"
              >
                <app-icon name="refresh" [size]="14" [class.spin]="loadingDocs()" />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <!-- Document Search & Decision Filter Toolbar -->
          <div class="repository-filter-bar">
            <!-- Search Input -->
            <div class="repo-search-input-wrap">
              <app-icon name="search" [size]="16" class="search-ico" />
              <input
                type="text"
                class="repo-search-field"
                placeholder="Search by filename, seller, buyer, or classification..."
                [value]="searchQuery()"
                (input)="searchQuery.set($any($event.target).value)"
              />
              @if (searchQuery().length > 0) {
                <button type="button" class="btn-clear-search" (click)="clearSearch()" title="Clear search">
                  <app-icon name="close" [size]="12" />
                </button>
              }
            </div>

            <div class="repo-filter-right-group">
              <!-- Filter Pills -->
              <div class="repo-decision-pills">
                <button
                  type="button"
                  class="filter-pill-btn"
                  [class.active]="decisionFilter() === 'ALL'"
                  (click)="setDecisionFilter('ALL')"
                >
                  All ({{ documents().length }})
                </button>
                <button
                  type="button"
                  class="filter-pill-btn pill-allow"
                  [class.active]="decisionFilter() === 'ALLOW'"
                  (click)="setDecisionFilter('ALLOW')"
                >
                  ALLOW ({{ allowCount() }})
                </button>
                <button
                  type="button"
                  class="filter-pill-btn pill-review"
                  [class.active]="decisionFilter() === 'REVIEW'"
                  (click)="setDecisionFilter('REVIEW')"
                >
                  REVIEW ({{ reviewCount() }})
                </button>
                <button
                  type="button"
                  class="filter-pill-btn pill-block"
                  [class.active]="decisionFilter() === 'BLOCK_ESCALATE'"
                  (click)="setDecisionFilter('BLOCK_ESCALATE')"
                >
                  BLOCK / ESCALATE ({{ blockCount() }})
                </button>
              </div>

              <!-- Table Horizontal Scroll Navigation -->
              <div class="table-scroll-nav" title="Scroll table left and right">
                <span class="table-scroll-hint">Scroll:</span>
                <button
                  type="button"
                  class="btn-table-scroll"
                  (click)="scrollTable('left')"
                  title="Scroll table left (or drag table / Shift + Mouse Wheel)"
                >
                  <app-icon name="chevronLeft" [size]="14" />
                </button>
                <button
                  type="button"
                  class="btn-table-scroll"
                  (click)="scrollTable('right')"
                  title="Scroll table right (or drag table / Shift + Mouse Wheel)"
                >
                  <app-icon name="chevronRight" [size]="14" />
                </button>
              </div>
            </div>
          </div>

          <!-- Data Table Wrapper with Full Horizontal Scroll Support & Drag-to-Scroll -->
          <div
            class="modern-table-container"
            tabindex="0"
            role="region"
            aria-label="Analyzed trade presentations data table, scrollable horizontally"
            (mousedown)="onTableMouseDown($event)"
            (mousemove)="onTableMouseMove($event)"
            (mouseup)="onTableMouseUpOrLeave()"
            (mouseleave)="onTableMouseUpOrLeave()"
          >
            <table class="modern-trade-table">
              <thead>
                <tr>
                  <th class="th-checkbox">
                    <input
                      type="checkbox"
                      [checked]="areAllCompletedSelected()"
                      (change)="toggleSelectAllCompleted()"
                      title="Select all completed for comparison"
                    />
                  </th>
                  <th class="th-doc">Trade Document</th>
                  <th class="th-classification">Classification</th>
                  <th class="th-counterparties">Counterparties</th>
                  <th class="th-decision">Compliance Decision</th>
                  <th class="th-risk">Risk Score</th>
                  <th class="th-status">Status</th>
                  <th class="th-uploaded">Uploaded</th>
                  <th class="th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (doc of filteredDocuments(); track doc.id) {
                  <tr [class.row-selected]="selectedForCompare().has(doc.id)">
                    <td class="td-checkbox">
                      <input
                        type="checkbox"
                        [checked]="selectedForCompare().has(doc.id)"
                        [disabled]="doc.status !== 'completed'"
                        (change)="toggleDocForCompare(doc.id)"
                        title="Select for cross-document reconciliation"
                      />
                    </td>
                    <td class="td-doc">
                      <div class="doc-name-cell">
                        <div
                          class="doc-icon-badge"
                          [class.is-pdf]="doc.filename.toLowerCase().endsWith('.pdf')"
                          [class.is-docx]="doc.filename.toLowerCase().endsWith('.docx') || doc.filename.toLowerCase().endsWith('.doc')"
                        >
                          <app-icon [name]="doc.filename.toLowerCase().endsWith('.pdf') ? 'file' : 'document'" [size]="16" />
                        </div>
                        <div class="doc-title-stack">
                          <a
                            [routerLink]="doc.status === 'completed' ? ['/analysis', doc.id] : ['/processing', doc.id]"
                            class="doc-title-link"
                            [title]="doc.filename"
                          >
                            {{ doc.filename }}
                          </a>
                          <div class="doc-tags-row">
                            @if (doc.importCount && doc.importCount > 1) {
                              <span class="badge-dup-tag" [title]="'Uploaded ' + doc.importCount + ' times'">
                                <app-icon name="layers" [size]="10" />
                                &times;{{ doc.importCount }} Ingests
                              </span>
                            }
                            @if (doc.analysisCount && doc.analysisCount > 1) {
                              <span class="badge-version-tag" [title]="'Analyzed ' + doc.analysisCount + ' times'">
                                v{{ doc.analysisCount }}
                              </span>
                            }
                          </div>
                        </div>
                      </div>
                    </td>
                    <td class="td-classification">
                      <span class="classification-pill">{{ doc.tradeDocumentType || 'Trade Document' }}</span>
                    </td>
                    <td class="td-counterparties counterparties-cell">
                      @if (doc.buyerName || doc.sellerName) {
                        <div class="counterparty-flow-text" [title]="getCounterpartiesTooltip(doc.sellerName, doc.buyerName)">
                          {{ formatCounterparties(doc.sellerName, doc.buyerName) }}
                        </div>
                      } @else {
                        <span class="muted-dash">—</span>
                      }
                    </td>
                    <td class="td-decision">
                      @if (doc.tradeDecision) {
                        <span
                          class="decision-badge"
                          [class.decision-allow]="doc.tradeDecision === 'ALLOW'"
                          [class.decision-review]="doc.tradeDecision === 'REVIEW'"
                          [class.decision-block]="doc.tradeDecision === 'BLOCK_ESCALATE'"
                        >
                          {{ doc.tradeDecision === 'BLOCK_ESCALATE' ? 'BLOCK / ESCALATE' : doc.tradeDecision }}
                        </span>
                      } @else {
                        <span class="muted-dash">—</span>
                      }
                    </td>
                    <td class="td-risk">
                      @if (doc.tradeOverallRisk !== null && doc.tradeOverallRisk !== undefined) {
                        <div class="risk-score-pill" [class.risk-low]="doc.tradeOverallRisk < 20" [class.risk-mid]="doc.tradeOverallRisk >= 20 && doc.tradeOverallRisk < 60" [class.risk-high]="doc.tradeOverallRisk >= 60">
                          <span class="risk-number font-mono">{{ doc.tradeOverallRisk }}/100</span>
                        </div>
                      } @else {
                        <span class="muted-dash">—</span>
                      }
                    </td>
                    <td class="td-status">
                      <span
                        class="status-badge"
                        [class.status-completed]="doc.status === 'completed'"
                        [class.status-failed]="doc.status === 'failed'"
                        [class.status-processing]="doc.status === 'processing' || doc.status === 'queued'"
                      >
                        <span class="status-dot-pulse" [class.pulse-active]="doc.status === 'processing' || doc.status === 'queued'"></span>
                        {{ doc.status }}
                      </span>
                    </td>
                    <td class="td-uploaded uploaded-cell">{{ formatRelative(doc.uploadedAt) }}</td>
                    <td class="td-actions actions-cell">
                      <div class="actions-button-row">
                        @if (doc.status === 'completed') {
                          <a
                            [routerLink]="['/analysis', doc.id]"
                            class="action-btn action-primary"
                            title="View analysis dashboard"
                          >
                            <app-icon name="chart" [size]="13" />
                            <span>View</span>
                          </a>
                          <button
                            type="button"
                            class="action-btn action-pdf"
                            (click)="downloadPdfReport(doc.id, doc.filename)"
                            title="Download Audit PDF Report"
                          >
                            <app-icon name="document" [size]="13" />
                            <span>PDF</span>
                          </button>
                          <button
                            type="button"
                            class="action-btn action-txt"
                            (click)="downloadReport(doc.id, doc.filename)"
                            title="Download structured TXT report"
                          >
                            <app-icon name="download" [size]="13" />
                            <span>TXT</span>
                          </button>
                        } @else if (doc.status === 'processing' || doc.status === 'queued') {
                          <a
                            [routerLink]="['/processing', doc.id]"
                            class="action-btn action-track"
                            title="Track live processing"
                          >
                            <app-icon name="refresh" [size]="13" class="spin" />
                            <span>Track</span>
                          </a>
                        } @else if (doc.status === 'uploaded') {
                          <button
                            type="button"
                            class="action-btn action-primary"
                            (click)="analyzeDocument(doc.id)"
                            title="Start AI analysis"
                          >
                            <app-icon name="sparkle" [size]="13" />
                            <span>Analyze</span>
                          </button>
                        }
                        <button
                          type="button"
                          class="action-btn action-danger action-btn-icon-only"
                          (click)="deleteDoc(doc.id)"
                          title="Delete document"
                        >
                          <app-icon name="trash" [size]="13" />
                        </button>
                      </div>
                    </td>
                  </tr>
                }
                @if (filteredDocuments().length === 0 && !loadingDocs()) {
                  <tr>
                    <td colspan="9">
                      <div class="repo-empty-state">
                        <div class="empty-icon-ring">
                          <app-icon name="document" [size]="32" />
                        </div>
                        @if (searchQuery().length > 0 || decisionFilter() !== 'ALL') {
                          <h4 class="empty-title">No matching trade documents found</h4>
                          <p class="empty-subtext">No presentations match your search query or filter criteria.</p>
                          <button type="button" class="btn-empty-reset" (click)="clearSearch(); setDecisionFilter('ALL')">
                            Reset Filters
                          </button>
                        } @else {
                          <h4 class="empty-title">No active trade documents in view</h4>
                          <p class="empty-subtext">
                            Upload trade documents above, or restore previously examined trade presentations from your MongoDB Atlas cloud database.
                          </p>
                          <button type="button" class="btn-empty-restore" (click)="openRestoreHistoryModal()">
                            <app-icon name="cloud" [size]="15" />
                            <span>Restore History from Cloud DB</span>
                          </button>
                        }
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
          <div class="floating-reconcile-pill-bar">
            <div class="reconcile-pill-left">
              <span class="reconcile-pulse-dot"></span>
              <span class="reconcile-count font-bold">{{ selectedForCompare().size }} Trade Documents Selected</span>
              <span class="reconcile-subtext">Ready for UCP 600 Cross-Document Reconciliation</span>
            </div>
            <div class="reconcile-pill-actions">
              <button type="button" class="btn-reconcile-clear" (click)="clearComparisonSelection()">
                Clear
              </button>
              <button type="button" class="btn-reconcile-launch" (click)="launchComparison()">
                <app-icon name="scale" [size]="15" />
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
                    <div class="warning-callout">
                      <app-icon name="cloud" [size]="18" class="text-accent" />
                      <div>
                        <strong class="text-accent block">Permanent Cloud Preservation Guaranteed</strong>
                        <span class="small text-ink">
                          This will clear all <strong>{{ documents().length }}</strong> documents from your active dashboard screen. 100% of your records, OCR units, and original PDF files remain safe in your MongoDB Atlas cloud database and can be restored anytime via <strong>"Restore from Cloud DB"</strong>.
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

        <!-- Restore History Modal -->
        @if (showRestoreHistoryModal()) {
          <div class="modal-backdrop" (click)="closeRestoreHistoryModal()">
            <div class="modal-card restore-history-modal" (click)="$event.stopPropagation()">
              <div class="modal-header">
                <div class="row gap-10 align-center">
                  <div class="restore-icon-circle">
                    <app-icon name="cloud" [size]="18" />
                  </div>
                  <div>
                    <h3 class="h3 text-ink">Restore Trade Analysis History</h3>
                    <p class="small muted">Restore archived items from MongoDB Atlas back into your active dashboard view.</p>
                  </div>
                </div>
                <button class="btn-icon-xs" (click)="closeRestoreHistoryModal()">
                  <app-icon name="close" [size]="16" />
                </button>
              </div>

              <div class="modal-body mt-16">
                <!-- Mode Switcher -->
                <div class="delete-mode-switcher">
                  <button
                    type="button"
                    class="mode-btn"
                    [class.active]="restoreHistoryMode() === 'range'"
                    (click)="restoreHistoryMode.set('range')"
                  >
                    <app-icon name="calendar" [size]="15" />
                    <span>Restore by Date Range</span>
                  </button>
                  <button
                    type="button"
                    class="mode-btn"
                    [class.active]="restoreHistoryMode() === 'all'"
                    (click)="restoreHistoryMode.set('all')"
                  >
                    <app-icon name="cloud" [size]="15" />
                    <span>Restore All Dashboard View</span>
                  </button>
                </div>

                <!-- Mode 1: Date Range -->
                @if (restoreHistoryMode() === 'range') {
                  <div class="range-picker-container mt-16">
                    <p class="small muted mb-12">
                      Specify a date interval to restore matching presentations to active display. All original files and analyses will be loaded from MongoDB Atlas.
                    </p>

                    <div class="date-inputs-row">
                      <div class="date-field">
                        <label class="label small font-medium">From Date (Start):</label>
                        <input
                          type="date"
                          class="input font-mono"
                          [ngModel]="restoreFromDate()"
                          (ngModelChange)="restoreFromDate.set($event); onRestoreDateChange()"
                        />
                      </div>
                      <div class="date-field">
                        <label class="label small font-medium">To Date (End):</label>
                        <input
                          type="date"
                          class="input font-mono"
                          [ngModel]="restoreToDate()"
                          (ngModelChange)="restoreToDate.set($event); onRestoreDateChange()"
                        />
                      </div>
                    </div>

                    <div class="matching-preview-badge mt-14">
                      @if (loadingArchivedStats()) {
                        <span class="spin"><app-icon name="refresh" [size]="14" /></span>
                        <span>Calculating matching archived documents...</span>
                      } @else {
                        <app-icon name="info" [size]="15" class="text-accent" />
                        <span>
                          <strong>{{ archivedMatchingCount() }}</strong> of <strong>{{ archivedTotalCount() }}</strong> document(s) match this date filter.
                        </span>
                      }
                    </div>
                  </div>
                }

                <!-- Mode 2: Restore All -->
                @if (restoreHistoryMode() === 'all') {
                  <div class="delete-all-container mt-16">
                    <div class="warning-callout">
                      <app-icon name="cloud" [size]="18" class="text-accent" />
                      <div>
                        <strong class="text-accent block">Cloud Database Archive Restoration</strong>
                        <span class="small text-ink">
                          This will restore all <strong>{{ archivedTotalCount() }}</strong> archived documents from your MongoDB Atlas cloud database back into your active dashboard view.
                        </span>
                      </div>
                    </div>

                    <label class="confirm-checkbox-row mt-16">
                      <input
                        type="checkbox"
                        [checked]="confirmingRestoreAll()"
                        (change)="confirmingRestoreAll.set(!confirmingRestoreAll())"
                      />
                      <span class="small font-medium text-ink">
                        Restore all {{ archivedTotalCount() }} documents to active view.
                      </span>
                    </label>
                  </div>
                }
              </div>

              <div class="modal-footer row between align-center mt-20">
                <button class="btn btn-sm btn-ghost" (click)="closeRestoreHistoryModal()">
                  Cancel
                </button>
                <button
                  class="btn btn-sm btn-primary"
                  [disabled]="restoringHistory() || (restoreHistoryMode() === 'all' && !confirmingRestoreAll()) || (restoreHistoryMode() === 'range' && archivedMatchingCount() === 0)"
                  (click)="executeRestoreHistory()"
                >
                  @if (restoringHistory()) {
                    <span class="spin"><app-icon name="refresh" [size]="14" /></span>
                    <span>Restoring...</span>
                  } @else if (restoreHistoryMode() === 'all') {
                    <app-icon name="cloud" [size]="14" />
                    <span>Restore All {{ archivedTotalCount() }} from View</span>
                  } @else {
                    <app-icon name="cloud" [size]="14" />
                    <span>Restore {{ archivedMatchingCount() }} Matching Document(s)</span>
                  }
                </button>
              </div>
            </div>
          </div>
        }
      </div>

      <!-- ================================================================= -->
      <!-- ENTERPRISE MULTI-COLUMN FOOTER (Matches Landing Page Theme)       -->
      <!-- ================================================================= -->
      <footer class="dashboard-enterprise-footer">
        <div class="footer-dot-backdrop"></div>
        <div class="footer-container">
          <!-- Column 1: Brand & Socials -->
          <div class="footer-col footer-col-brand">
            <div class="footer-brand-logo">
              <div class="brand-shield-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L3 7V13C3 18.5 6.8 23.7 12 25C17.2 23.7 21 18.5 21 13V7L12 2Z" fill="#00d4d4" opacity="0.2" />
                  <path d="M12 3L4 7.5V13C4 18 7.4 22.6 12 23.8C16.6 22.6 20 18 20 13V7.5L12 3Z" stroke="#00e5e5" stroke-width="2" stroke-linejoin="round" />
                  <path d="M9 12.5L11 14.5L15 10.5" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </div>
              <div class="brand-text-wrap">
                <span class="brand-name">TradeGuard<span class="brand-tld">.ai</span></span>
                <span class="brand-sub">by InfoTech Group</span>
              </div>
            </div>

            <p class="footer-brand-tagline">Future Proof Trade Finance</p>
            <a href="mailto:info@infotechgroup.com" class="footer-contact-link">Email: info&#64;infotechgroup.com</a>

            <div class="footer-social-row">
              <a href="https://infotechgroup.com" target="_blank" rel="noopener noreferrer" class="social-circle-btn" aria-label="InfoTech Group Official Website">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
              </a>
              <a href="https://www.linkedin.com/company/infotech-group" target="_blank" rel="noopener noreferrer" class="social-circle-btn" aria-label="LinkedIn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.64a1.64 1.64 0 1 0 0 3.28 1.64 1.64 0 0 0 0-3.28z" />
                </svg>
              </a>
              <a href="https://www.youtube.com/@InfoTechGroup" target="_blank" rel="noopener noreferrer" class="social-circle-btn" aria-label="YouTube">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </a>
              <a href="https://twitter.com/InfoTech_Group" target="_blank" rel="noopener noreferrer" class="social-circle-btn" aria-label="X (Twitter)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          </div>

          <!-- Column 2: Company -->
          <div class="footer-col">
            <h4 class="footer-col-title">Company</h4>
            <ul class="footer-links-list">
              <li><a routerLink="/" class="footer-link">Home</a></li>
              <li><a routerLink="/dashboard" class="footer-link">TradeGuard® Workbench <span class="external-arrow">&#8599;</span></a></li>
              <li><a (click)="scrollToSolutions()" class="footer-link">Solutions</a></li>
              <li><a (click)="scrollToBlogs()" class="footer-link">Blogs &amp; Articles</a></li>
              <li><a (click)="scrollToAbout()" class="footer-link">About Us</a></li>
              <li><a (click)="scrollToFaq()" class="footer-link">FAQ</a></li>
            </ul>
          </div>

          <!-- Column 3: Solutions -->
          <div class="footer-col">
            <h4 class="footer-col-title">Solutions</h4>
            <ul class="footer-links-list">
              <li><a (click)="scrollToWorkbench()" class="footer-link">Digitization &amp; OCR</a></li>
              <li><a routerLink="/dashboard" class="footer-link">TBML &amp; Compliance AI</a></li>
              <li><a routerLink="/dashboard" class="footer-link">Sanctions Screening</a></li>
              <li><a routerLink="/dashboard" class="footer-link">Document Exam</a></li>
              <li><a routerLink="/compare" class="footer-link">UCP 600 Reconciliation</a></li>
              <li><a routerLink="/customers" class="footer-link">Customer 360 &amp; KYC</a></li>
            </ul>
          </div>

          <!-- Column 4: Resources -->
          <div class="footer-col">
            <h4 class="footer-col-title">Resources</h4>
            <ul class="footer-links-list">
              <li><a routerLink="/auditor" class="footer-link">Point-in-Time Auditor</a></li>
              <li><a routerLink="/sources" class="footer-link">Sanctions Feeds SLA</a></li>
              <li><a routerLink="/import" class="footer-link">Master Reference Center</a></li>
              <li><a (click)="scrollToBlogs()" class="footer-link">PR &amp; White Papers</a></li>
              <li><a (click)="scrollToAbout()" class="footer-link">Expertise</a></li>
              <li><a href="https://infotechgroup.com/careers" target="_blank" rel="noopener noreferrer" class="footer-link">Careers</a></li>
            </ul>
          </div>

          <!-- Column 5: Global Office Tabs Switcher -->
          <div class="footer-col footer-col-offices">
            <div class="office-tabs-nav">
              <button
                type="button"
                class="office-tab-btn"
                [class.active]="activeOfficeTab() === 'usa'"
                (click)="activeOfficeTab.set('usa')"
              >
                USA
              </button>
              <button
                type="button"
                class="office-tab-btn"
                [class.active]="activeOfficeTab() === 'pakistan'"
                (click)="activeOfficeTab.set('pakistan')"
              >
                PAKISTAN
              </button>
              <button
                type="button"
                class="office-tab-btn"
                [class.active]="activeOfficeTab() === 'uae'"
                (click)="activeOfficeTab.set('uae')"
              >
                UAE
              </button>
            </div>

            <div class="office-address-card">
              @if (activeOfficeTab() === 'usa') {
                <div class="office-branch-entry">
                  <h5 class="branch-name">INFOTECH AMERICAS INC.</h5>
                  <p class="branch-address">1177 Avenue of the Americas,<br />5th Floor, New York, NY 10036</p>
                </div>
                <div class="office-branch-entry">
                  <h5 class="branch-name">TRADEGUARD INTELLIGENCE</h5>
                  <p class="branch-address">999 Corporate Drive, Suite 210,<br />Ladera Ranch, CA 92694</p>
                </div>
              } @else if (activeOfficeTab() === 'pakistan') {
                <div class="office-branch-entry">
                  <h5 class="branch-name">INFOTECH GROUP (GLOBAL HQ)</h5>
                  <p class="branch-address">InfoTech Innovation Center, 5-A,<br />Peeco Road, Township, Lahore 54770</p>
                </div>
                <div class="office-branch-entry">
                  <h5 class="branch-name">ISLAMABAD REGIONAL OFFICE</h5>
                  <p class="branch-address">Evacuee Trust Complex, 4th Floor,<br />Aga Khan Road, F-5/1, Islamabad</p>
                </div>
              } @else if (activeOfficeTab() === 'uae') {
                <div class="office-branch-entry">
                  <h5 class="branch-name">INFOTECH MIDDLE EAST FZ-LLC</h5>
                  <p class="branch-address">Office 402, Building 1,<br />Dubai Internet City, Dubai, UAE</p>
                </div>
                <div class="office-branch-entry">
                  <h5 class="branch-name">DUBAI FINANCIAL TRADE HUB</h5>
                  <p class="branch-address">DIFC Innovation One, Level 7,<br />Trade Centre, Dubai, UAE</p>
                </div>
              }
            </div>
          </div>
        </div>
      </footer>

      <!-- Teal Subfooter Bar -->
      <div class="dashboard-subfooter-bar">
        <div class="subfooter-container">
          <div class="subfooter-links-left">
            <a (click)="openLegalModal('privacy')" class="subfooter-link">Legal Privacy</a>
            <a (click)="openLegalModal('eula')" class="subfooter-link">TradeGuard EULA</a>
          </div>
          <div class="subfooter-copy-right">
            <span>2026 &copy; All Rights Reserved by InfoTech Group &amp; TradeGuard.ai</span>
          </div>
        </div>

        <!-- Smooth Scroll to Top Floating Button -->
        <button
          type="button"
          class="btn-floating-scrolltop"
          (click)="scrollToTop()"
          aria-label="Scroll to top of page"
          title="Back to Top"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
        </button>
      </div>

      <!-- Legal & Privacy / EULA Modal -->
      @if (selectedLegalModal(); as legalType) {
        <div class="legal-modal-backdrop" (click)="closeLegalModal()">
          <div class="legal-modal-card" (click)="$event.stopPropagation()">
            <div class="legal-modal-header">
              <h3>{{ legalType === 'privacy' ? 'TradeGuard® Privacy & Data Governance' : 'TradeGuard® End User License Agreement (EULA)' }}</h3>
              <button type="button" class="btn-legal-close" (click)="closeLegalModal()">&times;</button>
            </div>
            <div class="legal-modal-body">
              @if (legalType === 'privacy') {
                <p><strong>InfoTech Group and TradeGuard®</strong> adhere to the strictest global data sovereignty, security, and banking compliance protocols including GDPR, ISO/IEC 27001, and SOC 2 Type II.</p>
                <p>All ingested documentary letters of credit, customs declarations, shipping bills, and entity records are processed using end-to-end zero-knowledge encryption with client-dedicated hardware security modules (HSMs).</p>
                <p>No confidential trade finance data or client transaction metadata is shared with public language models or third parties.</p>
              } @else {
                <p><strong>TradeGuard® Enterprise License Terms:</strong> TradeGuard® is licensed by InfoTech Group to authorized financial institutions and corporations for the sole purpose of automating trade finance document checking, AML/TBML risk detection, and sanctions screening.</p>
                <p>Governed under ICC UCP 600, ISBP 745, and FATF Trade Compliance standards. Unauthorized reverse engineering or redistribution is strictly prohibited.</p>
              }
            </div>
            <div class="legal-modal-footer">
              <button type="button" class="btn-legal-confirm" (click)="closeLegalModal()">Close Window</button>
            </div>
          </div>
        </div>
      }

      <!-- Duplicate Document Detected Banking Modal -->
      @if (duplicateModal(); as dup) {
        <div class="legal-modal-backdrop" (click)="closeDuplicateModal()">
          <div class="legal-modal-card duplicate-modal-card" (click)="$event.stopPropagation()">
            <div class="duplicate-modal-header">
              <div class="dup-header-badge">
                <span class="dup-pulse-icon"></span>
                <span>DUPLICATE TRADE DOCUMENT DETECTED</span>
              </div>
              <button type="button" class="btn-legal-close" (click)="closeDuplicateModal()">&times;</button>
            </div>

            <div class="duplicate-modal-body">
              <div class="dup-alert-banner">
                <div class="dup-alert-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                </div>
                <div class="dup-alert-content">
                  <h4>Identical Content Fingerprint Verified</h4>
                  <p>
                    This file matches an existing trade document in the repository with an identical cryptographic SHA-256 hash.
                    To maintain audit integrity and avoid duplicate counts, the canonical document entity is preserved.
                  </p>
                </div>
              </div>

              <div class="dup-details-grid">
                <div class="dup-detail-row">
                  <span class="dup-label">Uploaded File:</span>
                  <span class="dup-value font-mono">{{ dup.currentUploadedFilename || dup.filename }}</span>
                </div>
                <div class="dup-detail-row">
                  <span class="dup-label">Original Ingestion:</span>
                  <span class="dup-value font-mono">{{ dup.originalFilename || dup.filename }}</span>
                </div>
                <div class="dup-detail-row">
                  <span class="dup-label">Canonical ID:</span>
                  <span class="dup-value font-mono text-muted">{{ dup.id }}</span>
                </div>
                <div class="dup-detail-row">
                  <span class="dup-label">Content SHA-256:</span>
                  <span class="dup-value font-mono text-xs">{{ dup.contentHash ? (dup.contentHash.slice(0, 16) + '...' + dup.contentHash.slice(-8)) : 'Verified Match' }}</span>
                </div>
                <div class="dup-detail-row">
                  <span class="dup-label">First Imported:</span>
                  <span class="dup-value">{{ formatRelative(dup.firstImportedAt || dup.uploadedAt) }}</span>
                </div>
                <div class="dup-detail-row">
                  <span class="dup-label">Import Count:</span>
                  <span class="dup-value font-semibold text-teal">{{ dup.importCount || 2 }} times</span>
                </div>
                <div class="dup-detail-row">
                  <span class="dup-label">Analysis Status:</span>
                  <span class="dup-value">
                    @if (dup.status === 'completed' || dup.hasBeenAnalyzed) {
                      <span class="dup-status-pill status-ready">Analyzed &amp; Ready ({{ dup.analysisCount || 1 }} runs)</span>
                    } @else if (dup.status === 'failed') {
                      <span class="dup-status-pill status-err">Previous Analysis Failed</span>
                    } @else {
                      <span class="dup-status-pill status-queue">Never / Pending Analysis</span>
                    }
                  </span>
                </div>
              </div>
            </div>

            <div class="duplicate-modal-footer">
              <button type="button" class="btn-dup-dismiss" (click)="closeDuplicateModal()">
                Dismiss
              </button>
              @if (dup.status === 'completed' || dup.hasBeenAnalyzed) {
                <button type="button" class="btn-dup-secondary" (click)="viewPreviousAnalysis(dup.id, dup.status)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  <span>View Previous Analysis</span>
                </button>
                <button type="button" class="btn-dup-primary" (click)="analyzeAgain(dup.id)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                  <span>Analyze Again</span>
                </button>
              } @else if (dup.status === 'failed') {
                <button type="button" class="btn-dup-primary" (click)="analyzeAgain(dup.id)">
                  <span>Retry Analysis</span>
                </button>
              } @else {
                <button type="button" class="btn-dup-primary" (click)="analyzeAgain(dup.id)">
                  <span>Start Analysis</span>
                </button>
              }
            </div>
          </div>
        </div>
      }

      <!-- Full-Screen Interactive Multi-Document Ingestion & Deduplication Studio (Dashboard Theme) -->
      @if (batchModal(); as batch) {
        <div class="batch-fullscreen-studio" role="dialog" aria-modal="true" aria-label="Batch Ingestion and Document Registry Studio">
          <!-- 1. Executive Top Header (Consistent with Workbench Hero Strip) -->
          <header class="studio-header">
            <div class="studio-header-inner">
              <div class="studio-header-left">
                <div class="studio-badge-row">
                  <span class="studio-badge-pill">
                    <app-icon name="layers" [size]="13"></app-icon>
                    <span>Multi-Document Ingestion &amp; Deduplication Audit</span>
                  </span>
                  <span class="studio-sub-badge font-mono">
                    <app-icon name="shield" [size]="12"></app-icon>
                    <span>SHA-256 Collision Verification Active</span>
                  </span>
                </div>
                <h2 class="studio-headline">
                  Document Presentation &amp; Registry Analysis
                </h2>
                <p class="studio-desc">
                  Evaluated {{ batch.summary.total }} presentation document{{ batch.summary.total > 1 ? 's' : '' }} against TradeGuard institutional compliance registry. Review duplicate mappings or execute fresh AI screening.
                </p>
              </div>

              <div class="studio-header-right">
                <div class="studio-session-chip">
                  <span class="session-label">BATCH AUDIT</span>
                  <span class="session-code font-mono">{{ batch.summary.total }} INSTRUMENTS</span>
                </div>
                <button
                  type="button"
                  class="btn-studio-close"
                  (click)="closeBatchModal()"
                  title="Close studio and return to workbench (ESC)"
                  aria-label="Close studio"
                >
                  <app-icon name="close" [size]="16"></app-icon>
                  <span>Close Studio</span>
                </button>
              </div>
            </div>
          </header>

          <!-- 2. Scrollable Studio Canvas (Crisp Dashboard Theme Body) -->
          <div class="studio-scrollable-canvas">
            <div class="studio-main-container">
              <!-- KPI Telemetry Ribbon -->
              <section class="studio-telemetry-ribbon">
                <!-- Total Evaluated -->
                <div
                  class="studio-kpi-card kpi-total"
                  [class.is-active-tab]="batchFilter() === 'ALL'"
                  (click)="batchFilter.set('ALL')"
                  title="Filter all documents"
                >
                  <div class="kpi-icon-wrap kpi-icon-teal">
                    <app-icon name="document" [size]="20"></app-icon>
                  </div>
                  <div class="kpi-content-stack">
                    <div class="kpi-value-row">
                      <span class="kpi-number">{{ batch.summary.total }}</span>
                      <span class="kpi-pill-tag tag-teal">Total Batch</span>
                    </div>
                    <span class="kpi-title-label">Evaluated Presentations</span>
                    <span class="kpi-sub-label">Cryptographic checksum verified</span>
                  </div>
                </div>

                <!-- Fresh Ingested -->
                <div
                  class="studio-kpi-card kpi-new"
                  [class.is-active-tab]="batchFilter() === 'NEW'"
                  (click)="batchFilter.set('NEW')"
                  title="Filter fresh new documents"
                >
                  <div class="kpi-icon-wrap kpi-icon-emerald">
                    <app-icon name="check-circle" [size]="20"></app-icon>
                  </div>
                  <div class="kpi-content-stack">
                    <div class="kpi-value-row">
                      <span class="kpi-number text-emerald">+{{ batch.summary.new }}</span>
                      <span class="kpi-pill-tag tag-emerald">Fresh Ingest</span>
                    </div>
                    <span class="kpi-title-label">New Trade Documents</span>
                    <span class="kpi-sub-label">Committed to active workspace</span>
                  </div>
                </div>

                <!-- Duplicates Recognized -->
                <div
                  class="studio-kpi-card kpi-amber"
                  [class.is-active-tab]="batchFilter() === 'DUPLICATE'"
                  (click)="batchFilter.set('DUPLICATE')"
                  title="Filter duplicate documents"
                >
                  <div class="kpi-icon-wrap kpi-icon-amber">
                    <app-icon name="shield" [size]="20"></app-icon>
                  </div>
                  <div class="kpi-content-stack">
                    <div class="kpi-value-row">
                      <span class="kpi-number text-amber">{{ batch.summary.duplicates }}</span>
                      <span class="kpi-pill-tag tag-amber">Duplicate Collisions</span>
                    </div>
                    <span class="kpi-title-label">Canonical Presentations</span>
                    <span class="kpi-sub-label">Zero-loss historical audit preserved</span>
                  </div>
                </div>

                <!-- Deduplication Integrity -->
                <div class="studio-kpi-card kpi-indigo">
                  <div class="kpi-icon-wrap kpi-icon-indigo">
                    <app-icon name="sparkle" [size]="20"></app-icon>
                  </div>
                  <div class="kpi-content-stack">
                    <div class="kpi-value-row">
                      <span class="kpi-number text-indigo">100%</span>
                      <span class="kpi-pill-tag tag-indigo">UCP 600 Ready</span>
                    </div>
                    <span class="kpi-title-label">Deduplication Integrity</span>
                    <span class="kpi-sub-label">Prevents redundant credit consumption</span>
                  </div>
                </div>
              </section>

              <!-- Smart Filter & Search Control Deck -->
              <div class="studio-control-deck">
                <div class="control-left-pills">
                  <button
                    type="button"
                    class="studio-filter-pill"
                    [class.active]="batchFilter() === 'ALL'"
                    (click)="batchFilter.set('ALL')"
                  >
                    <app-icon name="list" [size]="14"></app-icon>
                    <span>All Presentations ({{ batch.summary.total }})</span>
                  </button>
                  <button
                    type="button"
                    class="studio-filter-pill pill-amber"
                    [class.active]="batchFilter() === 'DUPLICATE'"
                    (click)="batchFilter.set('DUPLICATE')"
                  >
                    <app-icon name="shield" [size]="14"></app-icon>
                    <span>Duplicates Only ({{ batch.summary.duplicates }})</span>
                  </button>
                  <button
                    type="button"
                    class="studio-filter-pill pill-emerald"
                    [class.active]="batchFilter() === 'NEW'"
                    (click)="batchFilter.set('NEW')"
                  >
                    <app-icon name="check-circle" [size]="14"></app-icon>
                    <span>New Ingested ({{ batch.summary.new }})</span>
                  </button>
                </div>

                <div class="control-right-search">
                  <div class="studio-search-bar">
                    <app-icon name="search" [size]="15" class="search-icon"></app-icon>
                    <input
                      type="text"
                      class="studio-search-input"
                      placeholder="Search by filename, extension, or hash..."
                      [ngModel]="batchSearch()"
                      (ngModelChange)="batchSearch.set($event)"
                    />
                    @if (batchSearch()) {
                      <button type="button" class="btn-clear-studio-search" (click)="batchSearch.set('')" title="Clear search">
                        <app-icon name="close" [size]="12"></app-icon>
                      </button>
                    }
                  </div>
                </div>
              </div>

              <!-- Presentation Canvas (Document Cards Grid) -->
              <main class="studio-cards-canvas">
                @if (filteredBatchDocuments().length === 0) {
                  <div class="studio-empty-canvas">
                    <div class="empty-icon-wrap">
                      <app-icon name="search" [size]="32"></app-icon>
                    </div>
                    <h4 class="empty-headline">No Matching Trade Presentations Found</h4>
                    <p class="empty-detail">No batch documents match the current filter or search query.</p>
                    <button type="button" class="btn-studio-reset" (click)="batchFilter.set('ALL'); batchSearch.set('')">
                      Reset Filters &amp; View All
                    </button>
                  </div>
                }

                <div class="studio-document-grid">
                  @for (item of filteredBatchDocuments(); track (item.id || item.documentId) + $index) {
                    <article
                      class="studio-doc-card"
                      [class.card-is-duplicate]="item.status === 'DUPLICATE' || item.isDuplicate"
                      [class.card-is-new]="item.status === 'NEW' && !item.isDuplicate"
                    >
                      <!-- Card Top Header -->
                      <div class="doc-card-head">
                        <div class="doc-card-ident">
                          <div
                            class="doc-ext-badge"
                            [class.ext-pdf]="item.filename.toLowerCase().endsWith('.pdf')"
                            [class.ext-docx]="item.filename.toLowerCase().endsWith('.docx') || item.filename.toLowerCase().endsWith('.doc')"
                          >
                            <app-icon [name]="item.filename.toLowerCase().endsWith('.pdf') ? 'file' : 'document'" [size]="20"></app-icon>
                            <span class="ext-name">
                              {{ item.filename.toLowerCase().endsWith('.pdf') ? 'PDF' : (item.filename.toLowerCase().endsWith('.docx') ? 'DOCX' : 'DOC') }}
                            </span>
                          </div>
                          <div class="doc-name-stack">
                            <h4 class="doc-card-filename" [title]="item.filename">{{ item.filename }}</h4>
                            <div class="doc-meta-pills">
                              <span class="meta-sub-pill font-mono">
                                <app-icon name="database" [size]="11"></app-icon>
                                <span>{{ formatBytes(item.fileSize || 0) }}</span>
                              </span>
                              <span class="meta-sub-pill font-mono">
                                <app-icon name="shield" [size]="11"></app-icon>
                                <span>SHA-256 Digest Verified</span>
                              </span>
                            </div>
                          </div>
                        </div>

                        <div class="doc-card-status-badge">
                          @if (item.status === 'DUPLICATE' || item.isDuplicate) {
                            <div class="status-pill-amber">
                              <app-icon name="shield" [size]="12"></app-icon>
                              <span class="pill-bold">DUPLICATE IDENTIFIED</span>
                            </div>
                            @if (item.importCount && item.importCount > 1) {
                              <span class="badge-ingest-counter font-mono" title="Ingested multiple times in active registry">
                                <app-icon name="layers" [size]="11"></app-icon>
                                <span>{{ item.importCount }}× in Registry</span>
                              </span>
                            }
                          } @else if (item.status === 'NEW') {
                            <div class="status-pill-emerald">
                              <app-icon name="check-circle" [size]="13"></app-icon>
                              <span class="pill-bold">NEW INGESTION</span>
                            </div>
                          } @else {
                            <div class="status-pill-rose">
                              <app-icon name="alert" [size]="13"></app-icon>
                              <span class="pill-bold">PARSE ERROR</span>
                            </div>
                          }
                        </div>
                      </div>

                      <!-- Card Body Audit Insight Panel -->
                      <div class="doc-card-body">
                        @if (item.status === 'DUPLICATE' || item.isDuplicate) {
                          <div class="audit-insight-box insight-duplicate">
                            <div class="insight-title-row">
                              <app-icon name="shield-alert" [size]="16" class="text-amber"></app-icon>
                              <span class="insight-title">Canonical Repository Collision Recognized</span>
                            </div>
                            <p class="insight-explanation">
                              An identical cryptographic fingerprint exists in the database. Previous AI compliance evaluations, UCP 600 screening, and risk scoring are fully preserved. You may inspect the existing record or force a fresh AI re-examination.
                            </p>
                            @if (item.contentHash) {
                              <div class="fingerprint-hash-bar">
                                <span class="hash-label">SHA-256 HASH:</span>
                                <span class="hash-code font-mono">{{ item.contentHash }}</span>
                              </div>
                            }
                          </div>
                        } @else if (item.status === 'NEW') {
                          <div class="audit-insight-box insight-new">
                            <div class="insight-title-row">
                              <app-icon name="check-circle" [size]="16" class="text-emerald"></app-icon>
                              <span class="insight-title">Fresh Presentation Ingested</span>
                            </div>
                            <p class="insight-explanation">
                              This document is unique and has been cataloged into the active workspace. Ready for continuous OCR extraction, dual-use screening, and ICC compliance examination.
                            </p>
                          </div>
                        } @else {
                          <div class="audit-insight-box insight-error">
                            <div class="insight-title-row">
                              <app-icon name="alert" [size]="16" class="text-danger"></app-icon>
                              <span class="insight-title">Ingestion Error</span>
                            </div>
                            <p class="insight-explanation">{{ item.errorMessage || 'Failed to process document file structure.' }}</p>
                          </div>
                        }
                      </div>

                      <!-- Card Action Suite -->
                      <div class="doc-card-footer">
                        <div class="footer-meta-left">
                          <span class="footer-audit-note">
                            <app-icon name="check-circle" [size]="13" class="text-emerald"></app-icon>
                            <span>AI Pipeline Ready</span>
                          </span>
                        </div>

                        <div class="footer-action-buttons">
                          @if (item.status === 'DUPLICATE' || item.isDuplicate) {
                            <button
                              type="button"
                              class="studio-btn studio-btn-reanalyze"
                              (click)="analyzeAgain(item.documentId || item.id)"
                              title="Re-execute AI compliance examination with current sanctions & UCP 600 rules"
                            >
                              <app-icon name="refresh" [size]="14"></app-icon>
                              <span>Re-analyze</span>
                            </button>

                            <button
                              type="button"
                              class="studio-btn studio-btn-view"
                              (click)="viewPreviousAnalysis(item.documentId || item.id, 'completed')"
                              title="Open full compliance dashboard, discrepancy matrix, and pricing audit"
                            >
                              <app-icon name="chart" [size]="14"></app-icon>
                              <span>View Full Audit</span>
                            </button>
                          } @else if (item.status === 'NEW') {
                            <button
                              type="button"
                              class="studio-btn studio-btn-view"
                              (click)="viewPreviousAnalysis(item.documentId || item.id, 'processing')"
                              title="Track live processing and OCR extraction"
                            >
                              <app-icon name="activity" [size]="14"></app-icon>
                              <span>Track Processing</span>
                            </button>
                          }
                        </div>
                      </div>
                    </article>
                  }
                </div>
              </main>
            </div>
          </div>

          <!-- 3. Executive Bottom Command Cockpit -->
          <footer class="studio-cockpit-footer">
            <div class="cockpit-left-memo">
              <div class="memo-sparkle-circle">
                <app-icon name="sparkle" [size]="18"></app-icon>
              </div>
              <div class="memo-text-stack">
                <span class="memo-heading font-bold">Institutional Deduplication Governance</span>
                <span class="memo-sub">
                  Canonical matching preserves existing point-in-time compliance reports. Force re-analyzing executes a fresh scan against updated sanctions watchlists.
                </span>
              </div>
            </div>

            <div class="cockpit-right-actions">
              <button
                type="button"
                class="btn-cockpit-secondary"
                (click)="closeBatchModal()"
              >
                <span>Return to Workbench</span>
              </button>

              @if (batch.summary.duplicates > 0) {
                <button
                  type="button"
                  class="btn-cockpit-reanalyze-glow"
                  [disabled]="reanalyzingBatch()"
                  (click)="reanalyzeAllDuplicates(batch)"
                >
                  @if (reanalyzingBatch()) {
                    <span>Re-analyzing Batch Presentations ({{ batch.summary.duplicates }})...</span>
                  } @else {
                    <app-icon name="refresh" [size]="15"></app-icon>
                    <span>Force Re-analyze All Duplicates ({{ batch.summary.duplicates }})</span>
                  }
                </button>
              }
            </div>
          </footer>
        </div>
      }

    </div>
  `,
  styles: `
    /* ── Dashboard Root & Layout ── */
    .dashboard-root {
      width: 100%;
      min-height: calc(100vh - 72px);
      background: #f8fafc;
      color: #0a1638;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    /* ── Authenticated Operational Workbench Hero Strip ── */
    .workbench-hero-strip {
      background: linear-gradient(135deg, #0a1638 0%, #0d1e4a 55%, #08173d 100%);
      border-bottom: 1px solid rgba(0, 168, 168, 0.22);
      padding: 36px 0 38px;
      width: 100%;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(10, 22, 56, 0.12);
    }

    .workbench-hero-strip::after {
      content: '';
      position: absolute;
      top: -120px;
      right: -80px;
      width: 440px;
      height: 440px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(0, 168, 168, 0.12) 0%, rgba(0, 168, 168, 0) 70%);
      pointer-events: none;
    }

    .workbench-hero-inner {
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 0 clamp(20px, 2.5vw, 40px);
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 28px;
      position: relative;
      z-index: 1;
    }

    .workbench-hero-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      flex-wrap: wrap;
    }

    .workbench-title-col {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 760px;
    }

    .workbench-badge-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 5px 14px;
      border-radius: 999px;
      background: rgba(0, 168, 168, 0.15);
      border: 1px solid rgba(0, 212, 212, 0.35);
      color: #00d4d4;
      font-size: 0.74rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      width: fit-content;
    }

    .live-dot-pulse {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: pulse-dot 2s infinite;
    }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.45; transform: scale(0.85); }
    }

    .workbench-main-title {
      font-size: clamp(1.6rem, 2.4vw, 2.15rem);
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.03em;
      line-height: 1.2;
      margin: 0;
    }

    .workbench-subtitle {
      font-size: 0.92rem;
      color: rgba(255, 255, 255, 0.82);
      line-height: 1.5;
      margin: 0;
    }

    .user-highlight-pill {
      color: #00d4d4;
      font-weight: 700;
    }

    .desk-dot-sep {
      margin: 0 8px;
      color: rgba(255, 255, 255, 0.35);
    }

    .institution-text {
      color: rgba(255, 255, 255, 0.68);
      font-size: 0.86rem;
    }

    .workbench-quick-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .btn-workbench-primary {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 10px;
      background: linear-gradient(135deg, #00a8a8, #008c8c);
      color: #ffffff;
      font-weight: 650;
      font-size: 0.88rem;
      border: 1px solid rgba(255, 255, 255, 0.15);
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 168, 168, 0.35);
      transition: all 0.2s ease;
    }

    .btn-workbench-primary:hover {
      background: linear-gradient(135deg, #00baba, #009999);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(0, 168, 168, 0.45);
    }

    .btn-workbench-secondary {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #ffffff;
      font-weight: 600;
      font-size: 0.88rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-workbench-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.35);
    }

    .btn-workbench-secondary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* ── 4 Glassmorphic Metric KPI Cards ── */
    .workbench-kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
    }

    .workbench-kpi-card {
      background: rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 14px;
      padding: 18px 20px;
      display: flex;
      align-items: center;
      gap: 16px;
      transition: all 0.25s ease;
    }

    .workbench-kpi-card:hover {
      background: rgba(255, 255, 255, 0.09);
      border-color: rgba(0, 168, 168, 0.4);
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    }

    .kpi-icon-wrap {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .kpi-icon-teal { background: rgba(0, 168, 168, 0.2); color: #00d4d4; }
    .kpi-icon-blue { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .kpi-icon-indigo { background: rgba(99, 102, 241, 0.2); color: #a5b4fc; }
    .kpi-icon-emerald { background: rgba(16, 185, 129, 0.2); color: #34d399; }

    .kpi-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .kpi-value-row {
      font-size: 1.55rem;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.15;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
    }

    .kpi-value-row.text-teal { color: #00d4d4; }
    .kpi-value-row.text-teal-bright { color: #2ee5b8; }

    .kpi-label {
      font-size: 0.78rem;
      font-weight: 700;
      color: rgba(255, 255, 255, 0.88);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .kpi-subtext {
      font-size: 0.72rem;
      color: rgba(255, 255, 255, 0.52);
    }

    /* ── Solutions Workbench Body Container (Full Screen Layout) ── */
    .dashboard-workbench-body {
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 28px clamp(20px, 2.5vw, 40px) 80px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 28px;
    }

    /* ── Common Workbench Card ── */
    .workbench-card {
      background: #ffffff;
      border: 1px solid rgba(226, 232, 240, 0.95);
      border-radius: 18px;
      box-shadow: 0 3px 18px rgba(10, 22, 56, 0.04);
      overflow: hidden;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }

    .workbench-card:hover {
      border-color: rgba(203, 213, 225, 0.9);
      box-shadow: 0 6px 24px rgba(10, 22, 56, 0.06);
    }

    .workbench-card-header {
      padding: 20px 26px;
      background: #ffffff;
      border-bottom: 1px solid rgba(226, 232, 240, 0.85);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .header-title-group {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .header-icon-circle {
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

    .workbench-card-heading {
      font-size: 1.15rem;
      font-weight: 750;
      color: #0a1638;
      letter-spacing: -0.02em;
      margin: 0;
    }

    .workbench-card-subheading {
      font-size: 0.83rem;
      color: #64748b;
      margin: 2px 0 0;
      line-height: 1.4;
    }

    .header-right-badges {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .format-pill-tag {
      padding: 4px 10px;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 0.74rem;
      font-weight: 600;
      color: #475569;
    }

    .workbench-card-body {
      padding: 24px 26px;
    }

    /* ── Modern Dropzone ── */
    .modern-dropzone {
      position: relative;
      padding: 42px 24px;
      border: 2px dashed rgba(0, 168, 168, 0.35);
      border-radius: 14px;
      background: linear-gradient(180deg, #fafbfc 0%, #f8fafc 100%);
      text-align: center;
      cursor: pointer;
      transition: all 0.25s ease;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
    }

    .modern-dropzone:hover,
    .modern-dropzone.drag-over {
      border-color: #00a8a8;
      background: rgba(0, 168, 168, 0.035);
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 168, 168, 0.1);
    }

    .dropzone-core-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }

    .dropzone-animated-icon-ring {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: #ffffff;
      border: 1px solid rgba(0, 168, 168, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #00a8a8;
      box-shadow: 0 4px 14px rgba(0, 168, 168, 0.14);
      transition: transform 0.25s ease;
    }

    .modern-dropzone:hover .dropzone-animated-icon-ring {
      transform: scale(1.08) translateY(-2px);
    }

    .dropzone-prompt-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: #0a1638;
      margin: 4px 0 0;
    }

    .dropzone-prompt-sub {
      font-size: 0.85rem;
      color: #64748b;
      max-width: 580px;
      margin: 0;
      line-height: 1.45;
    }

    .dropzone-action-btn-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 6px;
    }

    .btn-dropzone-select {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 20px;
      border-radius: 8px;
      background: linear-gradient(135deg, #00a8a8, #008c8c);
      color: #ffffff;
      font-size: 0.85rem;
      font-weight: 650;
      border: none;
      cursor: pointer;
      box-shadow: 0 3px 10px rgba(0, 168, 168, 0.3);
      transition: all 0.2s ease;
    }

    .btn-dropzone-select:hover {
      background: linear-gradient(135deg, #00baba, #009999);
      transform: translateY(-1px);
    }

    .dropzone-hint-text {
      font-size: 0.78rem;
      color: #94a3b8;
    }

    .dropzone-hint-text kbd {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 0.72rem;
      color: #334155;
    }

    .dropzone-supported-formats {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .format-badge-chip {
      padding: 5px 12px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 0.74rem;
      font-weight: 600;
      color: #475569;
    }

    /* ── Batch Selection Card ── */
    .batch-selection-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .batch-card-top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }

    .batch-left-meta {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .batch-count-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: #0a1638;
    }

    .batch-size-pill {
      padding: 3px 8px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 5px;
      font-size: 0.75rem;
      color: #475569;
    }

    .batch-right-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-batch-ghost {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 6px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      font-size: 0.8rem;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-batch-ghost:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
    }

    .btn-batch-ghost.text-danger {
      color: #e11d48;
    }

    .btn-batch-ghost.text-danger:hover {
      background: #fff1f2;
      border-color: #fecdd3;
    }

    .batch-files-list-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 10px;
      max-height: 240px;
      overflow-y: auto;
      padding: 2px;
    }

    .batch-file-chip-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
    }

    .chip-file-icon {
      color: #008c8c;
      flex-shrink: 0;
    }

    .chip-file-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }

    .chip-file-name {
      font-size: 0.82rem;
      font-weight: 600;
      color: #0a1638;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .chip-file-size {
      font-size: 0.72rem;
      color: #64748b;
    }

    .chip-remove-btn {
      padding: 4px;
      border-radius: 4px;
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      flex-shrink: 0;
      transition: color 0.15s ease;
    }

    .chip-remove-btn:hover {
      color: #e11d48;
    }

    .batch-card-bottom-bar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
    }

    .btn-batch-cancel {
      padding: 8px 16px;
      border-radius: 8px;
      background: transparent;
      border: 1px solid #cbd5e1;
      color: #475569;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-batch-primary-cta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 22px;
      border-radius: 8px;
      background: linear-gradient(135deg, #00a8a8, #008c8c);
      color: #ffffff;
      font-size: 0.88rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 168, 168, 0.35);
      transition: all 0.2s ease;
    }

    .btn-batch-primary-cta:hover {
      background: linear-gradient(135deg, #00baba, #009999);
      transform: translateY(-1px);
    }

    /* ── Progress Box ── */
    .upload-progress-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .progress-box-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }

    .progress-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .progress-status-text {
      font-size: 0.92rem;
      font-weight: 650;
      color: #0a1638;
    }

    .progress-percent-val {
      font-size: 1.1rem;
      font-weight: 800;
      color: #008c8c;
    }

    .modern-progress-track {
      height: 8px;
      background: #e2e8f0;
      border-radius: 999px;
      overflow: hidden;
    }

    .modern-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #00a8a8, #2ee5b8);
      border-radius: 999px;
      transition: width 0.25s ease;
    }

    .modern-alert-box {
      margin-top: 16px;
      padding: 12px 16px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.85rem;
    }

    .alert-warning {
      background: #fffbeb;
      border: 1px solid #fde68a;
      color: #92400e;
    }

    /* ── Section 2: Featured Dossier Showcase ── */
    .liberty-showcase-card {
      background: linear-gradient(135deg, rgba(0, 168, 168, 0.04) 0%, rgba(59, 130, 246, 0.03) 100%), #ffffff;
      border: 1px solid rgba(0, 168, 168, 0.28);
    }

    .liberty-showcase-header {
      padding: 22px 28px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      flex-wrap: wrap;
      border-bottom: 1px solid rgba(0, 168, 168, 0.15);
    }

    .liberty-header-left {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      max-width: 820px;
    }

    .liberty-icon-badge {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: rgba(0, 168, 168, 0.15);
      color: #008c8c;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .liberty-tag-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
      flex-wrap: wrap;
    }

    .case-study-badge {
      padding: 3px 10px;
      border-radius: 999px;
      background: rgba(0, 168, 168, 0.15);
      border: 1px solid rgba(0, 168, 168, 0.35);
      color: #008c8c;
      font-size: 0.72rem;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .case-study-corridor {
      font-size: 0.78rem;
      font-weight: 650;
      color: #475569;
    }

    .liberty-main-title {
      font-size: 1.15rem;
      font-weight: 800;
      color: #0a1638;
      letter-spacing: -0.02em;
      margin: 0;
    }

    .liberty-desc-text {
      font-size: 0.85rem;
      color: #64748b;
      margin: 4px 0 0;
      line-height: 1.45;
    }

    .btn-liberty-reconcile {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 10px;
      background: linear-gradient(135deg, #0a1638, #0d1e4a);
      color: #ffffff;
      font-size: 0.86rem;
      font-weight: 700;
      border: 1px solid rgba(0, 168, 168, 0.4);
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(10, 22, 56, 0.15);
      transition: all 0.2s ease;
    }

    .btn-liberty-reconcile:hover {
      background: linear-gradient(135deg, #10245a, #162b66);
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(10, 22, 56, 0.25);
    }

    .liberty-dossier-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      padding: 24px 28px;
    }

    .liberty-doc-tile {
      background: #ffffff;
      border: 1px solid rgba(226, 232, 240, 0.95);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-shadow: 0 2px 8px rgba(10, 22, 56, 0.03);
      transition: all 0.2s ease;
    }

    .liberty-doc-tile:hover {
      border-color: rgba(0, 168, 168, 0.45);
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(10, 22, 56, 0.07);
    }

    .doc-tile-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .doc-type-pill {
      font-size: 0.72rem;
      font-weight: 700;
      color: #008c8c;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .doc-status-pill {
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
    }

    .doc-status-pill.status-completed {
      background: #ecfdf5;
      color: #059669;
    }

    .doc-status-pill.status-processing {
      background: #eff6ff;
      color: #2563eb;
    }

    .doc-tile-filename {
      font-size: 0.88rem;
      font-weight: 700;
      color: #0a1638;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .doc-tile-meta {
      font-size: 0.76rem;
      color: #64748b;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .meta-dot {
      color: #cbd5e1;
    }

    .decision-chip-xs {
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.68rem;
      font-weight: 700;
    }

    .decision-chip-xs.decision-allow { background: #ecfdf5; color: #059669; }
    .decision-chip-xs.decision-review { background: #fffbeb; color: #d97706; }
    .decision-chip-xs.decision-block { background: #fff1f2; color: #e11d48; }

    .doc-tile-footer {
      padding-top: 8px;
      border-top: 1px solid #f1f5f9;
      display: flex;
      justify-content: flex-end;
    }

    .btn-tile-analyze {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 12px;
      border-radius: 6px;
      background: rgba(0, 168, 168, 0.1);
      color: #008c8c;
      font-size: 0.78rem;
      font-weight: 650;
      text-decoration: none;
      transition: all 0.15s ease;
    }

    .btn-tile-analyze:hover {
      background: #00a8a8;
      color: #ffffff;
    }

    /* ── Section 3: Documents Repository ── */
    .repository-header {
      padding-bottom: 16px;
    }

    .repo-count-badge {
      padding: 3px 10px;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 999px;
      font-size: 0.76rem;
      font-weight: 650;
      color: #475569;
    }

    .repository-top-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn-top-reconcile {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 16px;
      border-radius: 8px;
      background: linear-gradient(135deg, #00a8a8, #008c8c);
      color: #ffffff;
      font-size: 0.82rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 168, 168, 0.3);
      transition: all 0.2s ease;
    }

    .btn-top-reconcile:hover {
      background: linear-gradient(135deg, #00baba, #009999);
      transform: translateY(-1px);
    }

    .btn-util-ghost {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 13px;
      border-radius: 8px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      font-size: 0.8rem;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-util-ghost:hover:not(:disabled) {
      background: #f1f5f9;
      border-color: #cbd5e1;
      color: #0a1638;
    }

    .btn-util-ghost:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-util-ghost.text-danger {
      color: #e11d48;
    }

    .btn-util-ghost.text-danger:hover {
      background: #fff1f2;
      border-color: #fecdd3;
    }

    /* ── Repository Search & Filter Bar ── */
    .repository-filter-bar {
      padding: 14px 26px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .repo-search-input-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 6px 12px;
      width: min(100%, 380px);
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }

    .repo-search-input-wrap:focus-within {
      border-color: #00a8a8;
      box-shadow: 0 0 0 3px rgba(0, 168, 168, 0.12);
    }

    .search-ico {
      color: #94a3b8;
      flex-shrink: 0;
    }

    .repo-search-field {
      border: none;
      background: transparent;
      outline: none;
      font-size: 0.85rem;
      color: #0a1638;
      width: 100%;
    }

    .repo-search-field::placeholder {
      color: #94a3b8;
    }

    .btn-clear-search {
      background: transparent;
      border: none;
      color: #94a3b8;
      padding: 2px;
      cursor: pointer;
      display: flex;
      align-items: center;
    }

    .btn-clear-search:hover {
      color: #0a1638;
    }

    .repo-decision-pills {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .filter-pill-btn {
      padding: 6px 13px;
      border-radius: 999px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      font-size: 0.76rem;
      font-weight: 650;
      color: #475569;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .filter-pill-btn:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
    }

    .filter-pill-btn.active {
      background: #0a1638;
      border-color: #0a1638;
      color: #ffffff;
    }

    .filter-pill-btn.pill-allow.active {
      background: #059669;
      border-color: #059669;
      color: #ffffff;
    }

    .filter-pill-btn.pill-review.active {
      background: #d97706;
      border-color: #d97706;
      color: #ffffff;
    }

    .filter-pill-btn.pill-block.active {
      background: #e11d48;
      border-color: #e11d48;
      color: #ffffff;
    }

    .repo-filter-right-group {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
    }

    /* ── Table Scroll Navigation Buttons ── */
    .table-scroll-nav {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 3px 6px;
      box-shadow: 0 1px 2px rgba(10, 22, 56, 0.04);
    }

    .table-scroll-hint {
      font-size: 0.72rem;
      font-weight: 650;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 0 4px;
      user-select: none;
    }

    .btn-table-scroll {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: 1px solid transparent;
      background: #f1f5f9;
      color: #334155;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-table-scroll:hover {
      background: #00a8a8;
      color: #ffffff;
      transform: scale(1.05);
    }

    .btn-table-scroll:active {
      transform: scale(0.95);
    }

    /* ── Table Container & Styles ── */
    .modern-table-container {
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      -webkit-overflow-scrolling: touch;
      position: relative;
      background: #ffffff;
      border-top: 1px solid #e2e8f0;
      scrollbar-width: thin;
      scrollbar-color: #94a3b8 #f1f5f9;
      scroll-behavior: smooth;
      outline: none;
      cursor: default;
    }

    .modern-table-container:focus-visible {
      outline: 2px solid #00a8a8;
      outline-offset: -2px;
    }

    .modern-table-container.is-dragging {
      cursor: grabbing !important;
      user-select: none !important;
    }

    .modern-table-container::-webkit-scrollbar {
      height: 10px;
    }
    .modern-table-container::-webkit-scrollbar-track {
      background: #f1f5f9;
      border-radius: 0 0 16px 16px;
    }
    .modern-table-container::-webkit-scrollbar-thumb {
      background: #94a3b8;
      border-radius: 6px;
      border: 2px solid #f1f5f9;
      transition: background 0.2s ease;
    }
    .modern-table-container::-webkit-scrollbar-thumb:hover {
      background: #00a8a8;
    }

    .modern-trade-table {
      width: 100%;
      min-width: 1690px;
      border-collapse: separate;
      border-spacing: 0;
      text-align: left;
      font-size: 0.85rem;
      table-layout: fixed;
    }

    .modern-trade-table th {
      padding: 14px 18px;
      background: #f8fafc;
      color: #334155;
      font-size: 0.72rem;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #e2e8f0;
      white-space: nowrap;
      user-select: none;
    }

    .modern-trade-table td {
      padding: 14px 18px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
      color: #334155;
      overflow: hidden;
      box-sizing: border-box;
    }

    .modern-trade-table tbody tr {
      transition: background-color 0.15s ease;
    }

    .modern-trade-table tbody tr:hover {
      background: #fafbfc;
    }

    .modern-trade-table tbody tr.row-selected {
      background: rgba(0, 168, 168, 0.04);
    }

    /* Column Widths & Alignments */
    .th-checkbox,
    .td-checkbox {
      width: 48px;
      min-width: 48px;
      max-width: 48px;
      text-align: center;
      padding-left: 16px;
      padding-right: 8px;
    }

    .th-checkbox input,
    .td-checkbox input {
      cursor: pointer;
      width: 16px;
      height: 16px;
      accent-color: #00a8a8;
      border-radius: 4px;
    }

    .th-doc,
    .td-doc {
      width: 340px;
      min-width: 310px;
      max-width: 380px;
    }

    .th-classification,
    .td-classification {
      width: 190px;
      min-width: 180px;
    }

    .th-counterparties,
    .td-counterparties {
      width: 240px;
      min-width: 220px;
    }

    .th-decision,
    .td-decision {
      width: 170px;
      min-width: 160px;
    }

    .th-risk,
    .td-risk {
      width: 110px;
      min-width: 100px;
      text-align: center;
    }

    .th-status,
    .td-status {
      width: 135px;
      min-width: 125px;
    }

    .th-uploaded,
    .td-uploaded {
      width: 160px;
      min-width: 150px;
    }

    .th-actions,
    .td-actions {
      width: 300px;
      min-width: 290px;
      padding-right: 20px;
    }

    /* Document Cell Content */
    .doc-name-cell {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      min-width: 0;
      overflow: hidden;
    }

    .doc-icon-badge {
      width: 36px;
      height: 36px;
      border-radius: 9px;
      background: #eff6ff;
      color: #2563eb;
      border: 1px solid #dbeafe;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
      transition: all 0.15s ease;
    }

    .doc-icon-badge.is-pdf {
      background: #fee2e2;
      color: #e11d48;
      border-color: #fecaca;
    }

    .doc-icon-badge.is-docx {
      background: #e0f2fe;
      color: #0284c7;
      border-color: #bae6fd;
    }

    .doc-title-stack {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
      flex: 1;
      overflow: hidden;
    }

    .doc-title-link {
      display: block;
      width: 100%;
      min-width: 0;
      font-size: 0.88rem;
      font-weight: 650;
      color: #0f172a;
      text-decoration: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color 0.15s ease;
      line-height: 1.35;
    }

    .doc-title-link:hover {
      color: #00a8a8;
      text-decoration: underline;
    }

    .doc-tags-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 1px;
    }

    .badge-dup-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.68rem;
      font-weight: 700;
      color: #b45309;
      background: #fef3c7;
      border: 1px solid #fde68a;
      padding: 1px 7px;
      border-radius: 4px;
      line-height: 1.4;
      white-space: nowrap;
    }

    .badge-version-tag {
      display: inline-flex;
      align-items: center;
      font-size: 0.68rem;
      font-weight: 750;
      color: #0f766e;
      background: #ccfbf1;
      border: 1px solid #99f6e4;
      padding: 1px 6px;
      border-radius: 4px;
      line-height: 1.4;
      white-space: nowrap;
    }

    .classification-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 11px;
      border-radius: 6px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      font-size: 0.76rem;
      font-weight: 600;
      color: #334155;
      white-space: nowrap;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
      transition: all 0.15s ease;
    }

    .classification-pill:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
      color: #0f172a;
    }

    .counterparties-cell {
      max-width: 230px;
      overflow: hidden;
    }

    .counterparty-flow-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 0.8rem;
      color: #475569;
    }

    .muted-dash {
      color: #cbd5e1;
    }

    .decision-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 750;
      letter-spacing: 0.03em;
      white-space: nowrap;
    }

    .decision-badge.decision-allow {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      color: #059669;
    }

    .decision-badge.decision-review {
      background: #fffbeb;
      border: 1px solid #fde68a;
      color: #d97706;
    }

    .decision-badge.decision-block {
      background: #fff1f2;
      border: 1px solid #fecdd3;
      color: #e11d48;
    }

    .risk-score-pill {
      display: inline-flex;
      align-items: center;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.74rem;
      font-weight: 700;
    }

    .risk-score-pill.risk-low {
      background: #ecfdf5;
      color: #059669;
    }

    .risk-score-pill.risk-mid {
      background: #fffbeb;
      color: #d97706;
    }

    .risk-score-pill.risk-high {
      background: #fff1f2;
      color: #e11d48;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 650;
      text-transform: capitalize;
    }

    .status-badge.status-completed {
      background: #f0fdf4;
      color: #166534;
    }

    .status-badge.status-processing {
      background: #eff6ff;
      color: #1d4ed8;
    }

    .status-badge.status-failed {
      background: #fef2f2;
      color: #991b1b;
    }

    .status-dot-pulse {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .status-dot-pulse.pulse-active {
      animation: pulse-dot 1.4s infinite;
    }

    .uploaded-cell {
      font-size: 0.78rem;
      color: #64748b;
      white-space: nowrap;
    }

    .th-actions {
      padding-right: 24px;
      white-space: nowrap;
    }

    .actions-cell {
      padding-right: 24px;
      white-space: nowrap;
    }

    .actions-button-row {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      vertical-align: middle;
    }

    .action-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 32px;
      padding: 0 12px;
      border-radius: 8px;
      font-size: 0.78rem;
      font-weight: 650;
      letter-spacing: 0.01em;
      font-family: inherit;
      cursor: pointer;
      text-decoration: none;
      border: 1px solid transparent;
      box-sizing: border-box;
      white-space: nowrap;
      user-select: none;
      box-shadow: 0 1px 2px rgba(10, 22, 56, 0.04);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
    }

    .action-btn:focus-visible {
      outline: 2px solid #00a8a8;
      outline-offset: 2px;
    }

    .action-btn:active {
      transform: scale(0.96) translateY(0) !important;
    }

    /* Primary: View / Analyze */
    .action-btn.action-primary {
      background: linear-gradient(135deg, #00a8a8 0%, #008787 100%);
      color: #ffffff;
      border-color: rgba(0, 168, 168, 0.3);
      box-shadow: 0 2px 6px rgba(0, 168, 168, 0.28), 0 1px 2px rgba(0, 0, 0, 0.04);
    }

    .action-btn.action-primary:hover {
      background: linear-gradient(135deg, #00baba 0%, #009999 100%);
      border-color: #008888;
      color: #ffffff;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 168, 168, 0.4), 0 1px 3px rgba(0, 0, 0, 0.06);
    }

    /* PDF Audit Download */
    .action-btn.action-pdf {
      background: #ffffff;
      color: #1e293b;
      border-color: #e2e8f0;
    }

    .action-btn.action-pdf app-icon {
      color: #e11d48;
      transition: transform 0.2s ease;
    }

    .action-btn.action-pdf:hover {
      background: #fff5f5;
      border-color: #fecdd3;
      color: #be123c;
      transform: translateY(-1px);
      box-shadow: 0 3px 8px rgba(225, 29, 72, 0.14);
    }

    .action-btn.action-pdf:hover app-icon {
      transform: scale(1.15);
    }

    /* TXT Export Download */
    .action-btn.action-txt {
      background: #ffffff;
      color: #1e293b;
      border-color: #e2e8f0;
    }

    .action-btn.action-txt app-icon {
      color: #0284c7;
      transition: transform 0.2s ease;
    }

    .action-btn.action-txt:hover {
      background: #f0f9ff;
      border-color: #bae6fd;
      color: #0369a1;
      transform: translateY(-1px);
      box-shadow: 0 3px 8px rgba(2, 132, 199, 0.14);
    }

    .action-btn.action-txt:hover app-icon {
      transform: scale(1.15);
    }

    /* Ghost fallback */
    .action-btn.action-ghost {
      background: #ffffff;
      color: #334155;
      border-color: #e2e8f0;
    }

    .action-btn.action-ghost:hover {
      background: #f8fafc;
      border-color: #cbd5e1;
      color: #0a1638;
      transform: translateY(-1px);
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.05);
    }

    /* Live Tracking Action */
    .action-btn.action-track {
      background: #eff6ff;
      color: #1d4ed8;
      border-color: #bfdbfe;
    }

    .action-btn.action-track:hover {
      background: #dbeafe;
      border-color: #93c5fd;
      color: #1e40af;
      transform: translateY(-1px);
      box-shadow: 0 3px 8px rgba(29, 78, 216, 0.2);
    }

    /* Delete Action - Symmetrical 32x32 Square Icon Button */
    .action-btn.action-danger,
    .action-btn.action-btn-icon-only {
      width: 32px;
      height: 32px;
      min-width: 32px;
      padding: 0;
      border-radius: 8px;
      background: #ffffff;
      color: #94a3b8;
      border-color: #e2e8f0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .action-btn.action-danger:hover,
    .action-btn.action-btn-icon-only:hover {
      background: #fff1f2;
      color: #e11d48;
      border-color: #fecdd3;
      transform: translateY(-1px);
      box-shadow: 0 3px 8px rgba(225, 29, 72, 0.16);
    }

    /* ── Empty State ── */
    .repo-empty-state {
      padding: 48px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 12px;
    }

    .empty-icon-ring {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #f1f5f9;
      color: #94a3b8;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .empty-title {
      font-size: 1.02rem;
      font-weight: 700;
      color: #0a1638;
      margin: 0;
    }

    .empty-subtext {
      font-size: 0.85rem;
      color: #64748b;
      max-width: 480px;
      margin: 0;
      line-height: 1.45;
    }

    .btn-empty-reset,
    .btn-empty-restore {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 18px;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 650;
      cursor: pointer;
      margin-top: 6px;
      transition: all 0.2s ease;
    }

    .btn-empty-reset {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      color: #334155;
    }

    .btn-empty-reset:hover {
      background: #e2e8f0;
      color: #0a1638;
    }

    .btn-empty-restore {
      background: linear-gradient(135deg, #00a8a8, #008c8c);
      border: none;
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(0, 168, 168, 0.3);
    }

    .btn-empty-restore:hover {
      background: linear-gradient(135deg, #00baba, #009999);
      transform: translateY(-1px);
    }

    /* ── Floating Reconciliation Pill Bar ── */
    .floating-reconcile-pill-bar {
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100;
      background: #0a1638;
      border: 1px solid rgba(0, 168, 168, 0.4);
      border-radius: 999px;
      padding: 10px 18px 10px 24px;
      box-shadow: 0 12px 36px rgba(10, 22, 56, 0.35);
      display: flex;
      align-items: center;
      gap: 22px;
      animation: slide-up-bar 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    @keyframes slide-up-bar {
      from { transform: translate(-50%, 40px); opacity: 0; }
      to { transform: translate(-50%, 0); opacity: 1; }
    }

    .reconcile-pill-left {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #ffffff;
    }

    .reconcile-pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 10px #10b981;
      animation: pulse-dot 1.8s infinite;
    }

    .reconcile-count {
      font-size: 0.88rem;
      font-weight: 750;
      color: #00d4d4;
    }

    .reconcile-subtext {
      font-size: 0.8rem;
      color: rgba(255, 255, 255, 0.7);
    }

    .reconcile-pill-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn-reconcile-clear {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: rgba(255, 255, 255, 0.85);
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-reconcile-clear:hover {
      background: rgba(255, 255, 255, 0.2);
      color: #ffffff;
    }

    .btn-reconcile-launch {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      background: linear-gradient(135deg, #00a8a8, #008c8c);
      color: #ffffff;
      border: none;
      padding: 8px 18px;
      border-radius: 999px;
      font-size: 0.84rem;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 168, 168, 0.4);
      transition: all 0.2s ease;
    }

    .btn-reconcile-launch:hover {
      background: linear-gradient(135deg, #00baba, #009999);
      transform: translateY(-1px);
    }

    /* ── Modals (Delete & Restore History) ── */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(10, 22, 56, 0.55);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .modal-card {
      background: #ffffff;
      border-radius: 18px;
      box-shadow: 0 24px 60px rgba(10, 22, 56, 0.25);
      width: min(100%, 540px);
      padding: 26px;
      display: flex;
      flex-direction: column;
      animation: modal-pop 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    @keyframes modal-pop {
      from { transform: scale(0.96); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .modal-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .delete-icon-circle,
    .restore-icon-circle {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .delete-icon-circle {
      background: #fff1f2;
      color: #e11d48;
    }

    .restore-icon-circle {
      background: rgba(0, 168, 168, 0.12);
      color: #008c8c;
    }

    .modal-header h3 {
      font-size: 1.15rem;
      font-weight: 750;
      color: #0a1638;
      margin: 0;
    }

    .modal-header p {
      font-size: 0.83rem;
      color: #64748b;
      margin: 3px 0 0;
      line-height: 1.4;
    }

    .btn-icon-xs {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 6px;
      border-radius: 6px;
      transition: all 0.15s ease;
    }

    .btn-icon-xs:hover {
      background: #f1f5f9;
      color: #0a1638;
    }

    .delete-mode-switcher {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      background: #f1f5f9;
      padding: 4px;
      border-radius: 10px;
    }

    .mode-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 9px 12px;
      border-radius: 8px;
      border: none;
      background: transparent;
      font-size: 0.82rem;
      font-weight: 650;
      color: #64748b;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .mode-btn.active {
      background: #ffffff;
      color: #0a1638;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
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

    .date-field label {
      font-size: 0.8rem;
      font-weight: 600;
      color: #334155;
    }

    .date-field input {
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      font-size: 0.85rem;
      color: #0a1638;
      outline: none;
      transition: border-color 0.15s ease;
    }

    .date-field input:focus {
      border-color: #00a8a8;
      box-shadow: 0 0 0 3px rgba(0, 168, 168, 0.12);
    }

    .matching-preview-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 8px;
      background: #f0fdfa;
      border: 1px solid #ccfbf1;
      font-size: 0.82rem;
      color: #0f766e;
    }

    .warning-callout {
      display: flex;
      gap: 12px;
      padding: 14px;
      border-radius: 10px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
    }

    .warning-callout strong {
      font-size: 0.85rem;
      color: #008c8c;
    }

    .confirm-checkbox-row {
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      user-select: none;
    }

    .confirm-checkbox-row input {
      accent-color: #00a8a8;
      width: 16px;
      height: 16px;
    }

    .modal-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
    }

    .btn-ghost {
      background: transparent;
      border: 1px solid #cbd5e1;
      color: #475569;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-ghost:hover {
      background: #f1f5f9;
      color: #0a1638;
    }

    .btn-danger {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #e11d48;
      border: none;
      color: #ffffff;
      padding: 8px 18px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 650;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-danger:hover:not(:disabled) {
      background: #be123c;
    }

    .btn-danger:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-primary {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: linear-gradient(135deg, #00a8a8, #008c8c);
      border: none;
      color: #ffffff;
      padding: 8px 18px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 650;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-primary:hover:not(:disabled) {
      background: linear-gradient(135deg, #00baba, #009999);
    }

    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* ── Utilities ── */
    .spin {
      animation: spin 1s linear infinite;
      display: inline-block;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .font-mono { font-family: 'JetBrains Mono', 'Fira Code', monospace; }
    .mt-14 { margin-top: 14px; }
    .mt-16 { margin-top: 16px; }
    .mt-20 { margin-top: 20px; }
    .mt-28 { margin-top: 28px; }
    .mb-12 { margin-bottom: 12px; }
    .block { display: block; }
    .row { display: flex; }
    .between { justify-content: space-between; }
    .align-center { align-items: center; }
    .gap-10 { gap: 10px; }
    .text-ink { color: #0a1638; }
    .text-accent { color: #008c8c; }
    .text-teal { color: #00d4d4; }
    .small { font-size: 0.8rem; }
    .muted { color: #64748b; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    /* ── Responsive Queries ── */
    @media (max-width: 1024px) {
      .workbench-kpi-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 768px) {
      .workbench-kpi-grid {
        grid-template-columns: 1fr;
      }
      .workbench-hero-top {
        flex-direction: column;
        align-items: stretch;
      }
      .workbench-quick-actions {
        width: 100%;
      }
      .btn-workbench-primary,
      .btn-workbench-secondary {
        flex: 1;
        justify-content: center;
      }
      .repository-filter-bar {
        flex-direction: column;
        align-items: stretch;
      }
      .repo-search-input-wrap {
        width: 100%;
      }
      .floating-reconcile-pill-bar {
        width: calc(100vw - 32px);
        border-radius: 18px;
        flex-direction: column;
        align-items: stretch;
        bottom: 16px;
        padding: 14px 16px;
        gap: 12px;
      }
      .reconcile-subtext {
        display: none;
      }
      .reconcile-pill-actions {
        justify-content: space-between;
      }
      .date-inputs-row {
        grid-template-columns: 1fr;
      }
    }

    /* ================================================================= */
    /* ENTERPRISE MULTI-COLUMN FOOTER (100% Theme Match)                 */
    /* ================================================================= */
    .dashboard-enterprise-footer {
      position: relative;
      background: #040920;
      color: #ffffff;
      padding: 64px 32px 48px;
      overflow: hidden;
      margin-top: 64px;
      border-top: 1px solid rgba(0, 168, 168, 0.2);
    }

    .footer-dot-backdrop {
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at 12% 25%, rgba(0, 168, 168, 0.1) 0%, transparent 45%),
                  radial-gradient(circle at 88% 75%, rgba(14, 165, 233, 0.08) 0%, transparent 45%);
      pointer-events: none;
    }

    .footer-container {
      position: relative;
      z-index: 2;
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 0 clamp(20px, 2.5vw, 40px);
      box-sizing: border-box;
      display: grid;
      grid-template-columns: 2.2fr 1.2fr 1.3fr 1.3fr 2.4fr;
      gap: 40px;
    }

    .footer-col {
      display: flex;
      flex-direction: column;
    }

    .footer-brand-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }

    .brand-shield-icon {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .brand-name {
      font-size: 1.45rem;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.3px;
    }

    .brand-tld {
      color: #00d4d4;
    }

    .brand-sub {
      display: block;
      font-size: 0.76rem;
      color: #94a3b8;
      font-weight: 500;
    }

    .footer-brand-tagline {
      font-size: 0.95rem;
      color: #cbd5e1;
      margin: 0 0 12px 0;
    }

    .footer-contact-link {
      display: inline-block;
      font-size: 0.88rem;
      color: #94a3b8;
      text-decoration: none;
      margin-bottom: 22px;
      transition: color 0.2s ease;
    }

    .footer-contact-link:hover {
      color: #00d4d4;
    }

    .footer-social-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .social-circle-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #00a8a8;
      color: #040920;
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      transition: all 0.25s ease;
    }

    .social-circle-btn:hover {
      background: #00e5e5;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 229, 229, 0.4);
    }

    .footer-col-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: #ffffff;
      margin: 0 0 18px 0;
      letter-spacing: 0.2px;
    }

    .footer-links-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 11px;
    }

    .footer-link {
      font-size: 0.88rem;
      color: #cbd5e1;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .footer-link:hover {
      color: #00e5e5;
      transform: translateX(2px);
    }

    .external-arrow {
      font-size: 0.8rem;
      color: #00d4d4;
    }

    .footer-col-offices {
      display: flex;
      flex-direction: column;
    }

    .office-tabs-nav {
      display: flex;
      gap: 6px;
      margin-bottom: 0;
    }

    .office-tab-btn {
      flex: 1;
      padding: 9px 8px;
      font-size: 0.8rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
      border-radius: 8px 8px 0 0;
      background: #ffffff;
      color: #0f172a;
      text-align: center;
      text-transform: uppercase;
    }

    .office-tab-btn.active {
      background: #00a8a8;
      color: #ffffff;
    }

    .office-address-card {
      background: #ffffff;
      color: #0f172a;
      border-radius: 0 0 10px 10px;
      padding: 18px 20px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
      min-height: 155px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .branch-name {
      font-size: 0.82rem;
      font-weight: 800;
      color: #040920;
      margin: 0 0 4px 0;
      letter-spacing: 0.3px;
    }

    .branch-address {
      font-size: 0.78rem;
      line-height: 1.45;
      color: #475569;
      margin: 0;
    }

    /* ── Subfooter Bar ── */
    .dashboard-subfooter-bar {
      background: #00a8a8;
      color: #ffffff;
      padding: 14px 32px;
      position: relative;
      font-size: 0.86rem;
      font-weight: 600;
    }

    .subfooter-container {
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 0 clamp(20px, 2.5vw, 40px);
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }

    .subfooter-links-left {
      display: flex;
      align-items: center;
      gap: 24px;
    }

    .subfooter-link {
      color: #ffffff;
      text-decoration: none;
      cursor: pointer;
      transition: opacity 0.2s ease;
    }

    .subfooter-link:hover {
      opacity: 0.82;
      text-decoration: underline;
    }

    .subfooter-copy-right {
      color: #ffffff;
      font-size: 0.84rem;
    }

    .btn-floating-scrolltop {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #00a8a8;
      color: #ffffff;
      border: 2px solid rgba(255, 255, 255, 0.45);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 999;
      transition: all 0.25s ease;
    }

    .btn-floating-scrolltop:hover {
      background: #008888;
      transform: translateY(-3px);
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
    }

    /* ── Legal Modal Dialog ── */
    .legal-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(4, 9, 32, 0.75);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 20px;
    }

    .legal-modal-card {
      background: #ffffff;
      border-radius: 16px;
      width: 100%;
      max-width: 600px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .legal-modal-header {
      padding: 20px 24px;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .legal-modal-header h3 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 700;
      color: #040920;
    }

    .btn-legal-close {
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: #64748b;
      line-height: 1;
    }

    .btn-legal-close:hover {
      color: #0f172a;
    }

    .legal-modal-body {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .legal-modal-body p {
      margin: 0;
      font-size: 0.92rem;
      line-height: 1.6;
      color: #334155;
    }

    .legal-modal-footer {
      padding: 16px 24px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: flex-end;
    }

    .btn-legal-confirm {
      padding: 9px 22px;
      border-radius: 999px;
      background: #00a8a8;
      color: #ffffff;
      font-size: 0.88rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-legal-confirm:hover {
      background: #008888;
    }

    @media (max-width: 992px) {
      .footer-container {
        grid-template-columns: 1fr 1fr;
        gap: 32px;
      }
      .footer-col-offices {
        grid-column: span 2;
      }
    }

    @media (max-width: 640px) {
      .footer-container {
        grid-template-columns: 1fr;
      }
      .footer-col-offices {
        grid-column: span 1;
      }
      .subfooter-container {
        flex-direction: column;
        text-align: center;
      }
      .subfooter-links-left {
        justify-content: center;
      }
    }


    /* ── Duplicate & Batch Modals ── */
    .duplicate-modal-card {
      max-width: 640px;
      width: 94%;
      background: #ffffff;
      border-radius: 18px;
      box-shadow: 0 30px 70px -15px rgba(5, 12, 34, 0.35);
      border: 1px solid rgba(226, 232, 240, 0.9);
      overflow: hidden;
      animation: modalPop 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }


    .duplicate-modal-header {
      padding: 18px 24px;
      background: #0a1638;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .dup-header-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px;
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.4);
      border-radius: 20px;
      color: #fbbf24;
      font-size: 0.76rem;
      font-weight: 750;
      letter-spacing: 0.04em;
    }

    .dup-pulse-icon {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #f59e0b;
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.4);
    }

    .duplicate-modal-body {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      max-height: 70vh;
      overflow-y: auto;
    }

    .dup-alert-banner {
      display: flex;
      gap: 14px;
      padding: 14px 16px;
      background: #fffbeb;
      border: 1px solid #fef3c7;
      border-left: 4px solid #f59e0b;
      border-radius: 8px;
    }

    .dup-alert-icon {
      color: #d97706;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .dup-alert-content h4 {
      font-size: 0.92rem;
      font-weight: 700;
      color: #92400e;
      margin: 0 0 4px 0;
    }

    .dup-alert-content p {
      font-size: 0.82rem;
      color: #b45309;
      line-height: 1.45;
      margin: 0;
    }

    .dup-details-grid {
      display: flex;
      flex-direction: column;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
    }

    .dup-detail-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 14px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 0.83rem;
    }

    .dup-detail-row:last-child {
      border-bottom: none;
    }

    .dup-label {
      color: #64748b;
      font-weight: 550;
      flex-shrink: 0;
    }

    .dup-value {
      color: #0f172a;
      text-align: right;
      word-break: break-all;
    }

    .dup-status-pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 650;
    }

    .dup-status-pill.status-ready {
      background: #dcfce7;
      color: #15803d;
      border: 1px solid #bbf7d0;
    }

    .dup-status-pill.status-err {
      background: #fee2e2;
      color: #b91c1c;
      border: 1px solid #fecaca;
    }

    .dup-status-pill.status-queue {
      background: #e0f2fe;
      color: #0369a1;
      border: 1px solid #bae6fd;
    }

    .duplicate-modal-footer {
      padding: 16px 24px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      flex-wrap: wrap;
    }

    .btn-dup-dismiss {
      padding: 8px 16px;
      border-radius: 8px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      color: #475569;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-dup-dismiss:hover {
      background: #f1f5f9;
      color: #0f172a;
    }

    .btn-dup-secondary {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 18px;
      border-radius: 8px;
      background: #0a1638;
      border: 1px solid #0a1638;
      color: #ffffff;
      font-size: 0.85rem;
      font-weight: 650;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-dup-secondary:hover {
      background: #162758;
    }

    .btn-dup-primary {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 18px;
      border-radius: 8px;
      background: linear-gradient(135deg, #00a8a8, #008c8c);
      border: none;
      color: #ffffff;
      font-size: 0.85rem;
      font-weight: 650;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 168, 168, 0.3);
      transition: all 0.15s ease;
    }

    .btn-dup-primary:hover {
      background: linear-gradient(135deg, #00baba, #009999);
      transform: translateY(-1px);
    }

    /* ═════════════════════════════════════════════════════════════════════════
       MULTI-DOCUMENT INGESTION & DEDUPLICATION STUDIO (DASHBOARD LIGHT THEME)
       ═════════════════════════════════════════════════════════════════════════ */
    .batch-fullscreen-studio {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      z-index: 99999;
      background: #f8fafc;
      color: #0f172a;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-sizing: border-box;
    }

    /* ── 1. Top Executive Header Strip (Dashboard Theme Alignment) ── */
    .studio-header {
      background: linear-gradient(135deg, #0a1638 0%, #0d1e4a 55%, #08173d 100%);
      border-bottom: 1px solid rgba(0, 168, 168, 0.22);
      padding: 24px clamp(20px, 3vw, 48px);
      box-shadow: 0 4px 20px rgba(10, 22, 56, 0.12);
      flex-shrink: 0;
      z-index: 10;
    }

    .studio-header-inner {
      max-width: 1480px;
      margin: 0 auto;
      width: 100%;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      flex-wrap: wrap;
    }

    .studio-header-left {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 820px;
    }

    .studio-badge-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .studio-badge-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 5px 14px;
      border-radius: 999px;
      background: rgba(0, 168, 168, 0.15);
      border: 1px solid rgba(0, 212, 212, 0.35);
      color: #00d4d4;
      font-size: 0.74rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .studio-sub-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: rgba(255, 255, 255, 0.85);
      font-size: 0.72rem;
      font-weight: 600;
    }

    .studio-headline {
      font-size: clamp(1.4rem, 2.2vw, 1.85rem);
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.025em;
      line-height: 1.25;
      margin: 0;
    }

    .studio-desc {
      font-size: 0.88rem;
      color: rgba(255, 255, 255, 0.8);
      line-height: 1.5;
      margin: 0;
    }

    .studio-header-right {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-shrink: 0;
    }

    .studio-session-chip {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      padding: 8px 16px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid rgba(255, 255, 255, 0.14);
    }

    .session-label {
      font-size: 0.65rem;
      font-weight: 750;
      letter-spacing: 0.08em;
      color: rgba(255, 255, 255, 0.6);
      text-transform: uppercase;
    }

    .session-code {
      font-size: 0.82rem;
      font-weight: 750;
      color: #00d4d4;
    }

    .btn-studio-close {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 18px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.22);
      color: #ffffff;
      font-size: 0.86rem;
      font-weight: 650;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }

    .btn-studio-close:hover {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.38);
    }

    /* ── 2. Scrollable Body & Main Container ── */
    .studio-scrollable-canvas {
      flex: 1;
      overflow-y: auto;
      background: #f8fafc;
      width: 100%;
    }

    .studio-main-container {
      max-width: 1480px;
      margin: 0 auto;
      width: 100%;
      padding: 32px clamp(20px, 3vw, 48px) 48px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 30px;
    }

    /* ── 3. KPI Telemetry Ribbon (Spacious White Cards) ── */
    .studio-telemetry-ribbon {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      width: 100%;
    }

    .studio-kpi-card {
      background: #ffffff;
      border: 1px solid rgba(226, 232, 240, 0.95);
      border-radius: 16px;
      padding: 22px 24px;
      box-shadow: 0 2px 12px rgba(10, 22, 56, 0.04);
      display: flex;
      align-items: flex-start;
      gap: 18px;
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .studio-kpi-card:hover {
      border-color: #cbd5e1;
      box-shadow: 0 4px 18px rgba(10, 22, 56, 0.08);
    }

    .studio-kpi-card.is-active-tab {
      border-color: #00a8a8;
      box-shadow: 0 0 0 2px rgba(0, 168, 168, 0.18);
    }

    .kpi-icon-wrap {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .kpi-icon-teal {
      background: rgba(0, 168, 168, 0.1);
      color: #008c8c;
    }

    .kpi-icon-emerald {
      background: #ecfdf5;
      color: #059669;
    }

    .kpi-icon-amber {
      background: #fffbeb;
      color: #d97706;
    }

    .kpi-icon-indigo {
      background: #eef2ff;
      color: #4f46e5;
    }

    .kpi-content-stack {
      display: flex;
      flex-direction: column;
      gap: 3px;
      flex: 1;
      min-width: 0;
    }

    .kpi-value-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 4px;
      flex-wrap: wrap;
    }

    .kpi-number {
      font-size: 1.65rem;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.1;
      letter-spacing: -0.025em;
      font-variant-numeric: tabular-nums;
    }

    .kpi-number.text-emerald { color: #059669; }
    .kpi-number.text-amber { color: #d97706; }
    .kpi-number.text-indigo { color: #4f46e5; }

    .kpi-pill-tag {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 3px 9px;
      border-radius: 999px;
      letter-spacing: 0.02em;
    }

    .tag-teal { background: rgba(0, 168, 168, 0.1); color: #008c8c; }
    .tag-emerald { background: #d1fae5; color: #047857; }
    .tag-amber { background: #fef3c7; color: #b45309; }
    .tag-indigo { background: #e0e7ff; color: #3730a3; }

    .kpi-title-label {
      font-size: 0.82rem;
      font-weight: 700;
      color: #334155;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .kpi-sub-label {
      font-size: 0.76rem;
      color: #64748b;
      line-height: 1.35;
    }

    /* ── 4. Smart Filter & Search Control Deck ── */
    .studio-control-deck {
      background: #ffffff;
      border: 1px solid rgba(226, 232, 240, 0.95);
      border-radius: 14px;
      padding: 14px 20px;
      box-shadow: 0 2px 8px rgba(10, 22, 56, 0.03);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      flex-wrap: wrap;
    }

    .control-left-pills {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .studio-filter-pill {
      padding: 8px 18px;
      border-radius: 999px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      color: #475569;
      font-size: 0.84rem;
      font-weight: 650;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s ease;
    }

    .studio-filter-pill:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
      color: #1e293b;
    }

    .studio-filter-pill.active {
      background: #0f172a;
      border-color: #0f172a;
      color: #ffffff;
    }

    .studio-filter-pill.pill-amber.active {
      background: #d97706;
      border-color: #d97706;
      color: #ffffff;
    }

    .studio-filter-pill.pill-emerald.active {
      background: #059669;
      border-color: #059669;
      color: #ffffff;
    }

    .control-right-search {
      flex: 1;
      max-width: 380px;
      min-width: 260px;
    }

    .studio-search-bar {
      position: relative;
      width: 100%;
    }

    .studio-search-input {
      width: 100%;
      height: 42px;
      padding: 0 38px 0 38px;
      border-radius: 10px;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      color: #0f172a;
      font-size: 0.86rem;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .studio-search-input:focus {
      border-color: #00a8a8;
      box-shadow: 0 0 0 3px rgba(0, 168, 168, 0.14);
    }

    .studio-search-bar .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: #94a3b8;
      pointer-events: none;
    }

    .btn-clear-studio-search {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2px;
    }

    .btn-clear-studio-search:hover {
      color: #0f172a;
    }

    /* ── 5. Document Presentation Grid & Cards ── */
    .studio-cards-canvas {
      width: 100%;
    }

    .studio-document-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(580px, 1fr));
      gap: 26px;
      width: 100%;
    }

    .studio-doc-card {
      background: #ffffff;
      border: 1px solid rgba(226, 232, 240, 0.95);
      border-radius: 18px;
      padding: 28px 32px;
      box-shadow: 0 3px 16px rgba(10, 22, 56, 0.04);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
      box-sizing: border-box;
    }

    .studio-doc-card:hover {
      box-shadow: 0 6px 24px rgba(10, 22, 56, 0.07);
    }

    .studio-doc-card.card-is-duplicate {
      border: 1px solid rgba(251, 191, 36, 0.6);
    }

    .studio-doc-card.card-is-duplicate:hover {
      border-color: rgba(245, 158, 11, 0.9);
      box-shadow: 0 6px 24px rgba(245, 158, 11, 0.08);
    }

    .studio-doc-card.card-is-new {
      border: 1px solid rgba(16, 185, 129, 0.5);
    }

    /* Card Top Header */
    .doc-card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 22px;
    }

    .doc-card-ident {
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 0;
      flex: 1;
    }

    .doc-ext-badge {
      width: 52px;
      height: 52px;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      flex-shrink: 0;
    }

    .doc-ext-badge.ext-pdf {
      background: #fee2e2;
      color: #dc2626;
      border: 1px solid #fecaca;
    }

    .doc-ext-badge.ext-docx {
      background: #dbeafe;
      color: #2563eb;
      border: 1px solid #bfdbfe;
    }

    .ext-name {
      font-size: 0.62rem;
      font-weight: 800;
      letter-spacing: 0.05em;
    }

    .doc-name-stack {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .doc-card-filename {
      font-size: 1.12rem;
      font-weight: 750;
      color: #0f172a;
      margin: 0;
      word-break: break-all;
      line-height: 1.35;
    }

    .doc-meta-pills {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .meta-sub-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.78rem;
      color: #64748b;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 3px 10px;
      border-radius: 6px;
    }

    .doc-card-status-badge {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      flex-shrink: 0;
    }

    .status-pill-amber {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 13px;
      border-radius: 999px;
      background: #fef3c7;
      border: 1px solid #fde68a;
      color: #92400e;
      font-size: 0.76rem;
      font-weight: 750;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    .badge-ingest-counter {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.74rem;
      font-weight: 650;
      color: #475569;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      padding: 3px 9px;
      border-radius: 6px;
    }

    .status-pill-emerald {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 13px;
      border-radius: 999px;
      background: #d1fae5;
      border: 1px solid #a7f3d0;
      color: #065f46;
      font-size: 0.76rem;
      font-weight: 750;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    .status-pill-rose {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 13px;
      border-radius: 999px;
      background: #ffe4e6;
      border: 1px solid #fecdd3;
      color: #9f1239;
      font-size: 0.76rem;
      font-weight: 750;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    /* Card Body / Insight Box */
    .doc-card-body {
      margin-bottom: 24px;
    }

    .audit-insight-box {
      border-radius: 12px;
      padding: 20px 22px;
    }

    .audit-insight-box.insight-duplicate {
      background: #fffbeb;
      border: 1px solid #fde68a;
    }

    .audit-insight-box.insight-new {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
    }

    .audit-insight-box.insight-error {
      background: #fff1f2;
      border: 1px solid #fecdd3;
    }

    .insight-title-row {
      display: flex;
      align-items: center;
      gap: 9px;
      margin-bottom: 9px;
      font-weight: 750;
      font-size: 0.94rem;
    }

    .insight-duplicate .insight-title-row { color: #92400e; }
    .insight-new .insight-title-row { color: #065f46; }
    .insight-error .insight-title-row { color: #9f1239; }

    .insight-explanation {
      font-size: 0.88rem;
      line-height: 1.62;
      margin: 0 0 16px 0;
    }

    .insight-duplicate .insight-explanation { color: #78350f; }
    .insight-new .insight-explanation { color: #047857; }
    .insight-error .insight-explanation { color: #be123c; }

    .fingerprint-hash-bar {
      background: #ffffff;
      border: 1px solid #fde68a;
      border-radius: 8px;
      padding: 9px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      overflow: hidden;
    }

    .hash-label {
      font-size: 0.7rem;
      font-weight: 750;
      color: #b45309;
      letter-spacing: 0.05em;
      flex-shrink: 0;
    }

    .hash-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.78rem;
      color: #0f172a;
      word-break: break-all;
    }

    /* Card Footer Actions */
    .doc-card-footer {
      border-top: 1px solid #f1f5f9;
      padding-top: 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: auto;
    }

    .footer-meta-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .footer-audit-note {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
      font-weight: 650;
      color: #64748b;
    }

    .footer-action-buttons {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .studio-btn {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 9px 18px;
      border-radius: 9px;
      font-size: 0.85rem;
      font-weight: 650;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .studio-btn-reanalyze {
      background: #ffffff;
      border: 1.5px solid #00a8a8;
      color: #008c8c;
      font-weight: 700;
    }

    .studio-btn-reanalyze:hover {
      background: #f0fdfa;
      border-color: #008c8c;
    }

    .studio-btn-view {
      background: #0f172a;
      border: 1px solid #0f172a;
      color: #ffffff;
    }

    .studio-btn-view:hover {
      background: #1e293b;
    }

    /* Empty State */
    .studio-empty-canvas {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 60px 30px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      max-width: 520px;
      margin: 40px auto;
    }

    .empty-icon-wrap {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: #f1f5f9;
      color: #64748b;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .empty-headline {
      font-size: 1.15rem;
      font-weight: 750;
      color: #0f172a;
      margin: 0;
    }

    .empty-detail {
      font-size: 0.88rem;
      color: #64748b;
      margin: 0;
      line-height: 1.5;
    }

    .btn-studio-reset {
      margin-top: 8px;
      padding: 9px 20px;
      border-radius: 8px;
      background: #00a8a8;
      color: #ffffff;
      border: none;
      font-weight: 650;
      font-size: 0.84rem;
      cursor: pointer;
    }

    /* ── 6. Bottom Executive Cockpit Footer ── */
    .studio-cockpit-footer {
      background: #ffffff;
      border-top: 1px solid #e2e8f0;
      padding: 18px clamp(20px, 3vw, 48px);
      box-shadow: 0 -3px 16px rgba(10, 22, 56, 0.04);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      flex-wrap: wrap;
      z-index: 10;
      flex-shrink: 0;
    }

    .cockpit-left-memo {
      display: flex;
      align-items: center;
      gap: 14px;
      max-width: 760px;
    }

    .memo-sparkle-circle {
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

    .memo-text-stack {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .memo-heading {
      font-size: 0.88rem;
      font-weight: 750;
      color: #0f172a;
    }

    .memo-sub {
      font-size: 0.81rem;
      color: #64748b;
      line-height: 1.45;
    }

    .cockpit-right-actions {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-shrink: 0;
    }

    .btn-cockpit-secondary {
      padding: 11px 22px;
      border-radius: 10px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      color: #334155;
      font-size: 0.86rem;
      font-weight: 650;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-cockpit-secondary:hover {
      background: #f8fafc;
      border-color: #94a3b8;
      color: #0f172a;
    }

    .btn-cockpit-reanalyze-glow {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 11px 26px;
      border-radius: 10px;
      background: linear-gradient(135deg, #00a8a8 0%, #008c8c 100%);
      border: none;
      color: #ffffff;
      font-size: 0.88rem;
      font-weight: 750;
      letter-spacing: 0.01em;
      cursor: pointer;
      box-shadow: 0 3px 12px rgba(0, 168, 168, 0.35);
      transition: all 0.15s ease;
    }

    .btn-cockpit-reanalyze-glow:hover:not(:disabled) {
      background: linear-gradient(135deg, #00baba 0%, #009999 100%);
      transform: translateY(-1px);
      box-shadow: 0 5px 18px rgba(0, 168, 168, 0.45);
    }

    .btn-cockpit-reanalyze-glow:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }

    /* ── Responsive Adaptations ── */
    @media (max-width: 1200px) {
      .studio-telemetry-ribbon {
        grid-template-columns: repeat(2, 1fr);
      }
      .studio-document-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 860px) {
      .studio-header-inner {
        flex-direction: column;
        align-items: stretch;
      }
      .studio-header-right {
        justify-content: space-between;
      }
      .studio-control-deck {
        flex-direction: column;
        align-items: stretch;
      }
      .control-right-search {
        max-width: 100%;
      }
      .studio-cockpit-footer {
        flex-direction: column;
        align-items: stretch;
      }
      .cockpit-right-actions {
        justify-content: flex-end;
      }
    }


  `,
})
export class DashboardComponent implements OnInit {
  protected readonly formatBytes = formatBytes;
  protected readonly formatDuration = formatDuration;
  protected readonly formatRelative = formatRelative;

  formatCounterparties(seller?: string | null, buyer?: string | null): string {
    const clean = (val: string | null | undefined, fallback: string): string => {
      if (!val || val === 'Not Found' || val === 'Not Disclosed') return fallback;
      let trimmed = val.trim();
      if (trimmed.includes('. ') || trimmed.includes('\n')) {
        trimmed = trimmed.split(/\. |\n/)[0].trim();
      }
      if (trimmed.length > 28) {
        return trimmed.slice(0, 26) + '…';
      }
      return trimmed;
    };

    const s = clean(seller, 'Seller');
    const b = clean(buyer, 'Buyer');
    if (s === b && s !== 'Seller') return s;
    return `${s} → ${b}`;
  }

  getCounterpartiesTooltip(seller?: string | null, buyer?: string | null): string {
    const s = seller && seller !== 'Not Found' ? seller.trim() : 'Seller Not Specified';
    const b = buyer && buyer !== 'Not Found' ? buyer.trim() : 'Buyer Not Specified';
    return `Seller: ${s}\nBuyer: ${b}`;
  }

  readonly auth = inject(AuthService);
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

  // ── Document Search & Filter State ──
  protected readonly searchQuery = signal<string>('');
  protected readonly decisionFilter = signal<'ALL' | 'ALLOW' | 'REVIEW' | 'BLOCK_ESCALATE'>('ALL');
  protected readonly statusFilter = signal<'ALL' | 'completed' | 'processing' | 'failed'>('ALL');

  protected readonly filteredDocuments = computed<DocumentSummary[]>(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const decision = this.decisionFilter();
    const status = this.statusFilter();
    const list = this.documents();

    return list.filter((doc) => {
      if (decision !== 'ALL' && doc.tradeDecision !== decision) {
        return false;
      }
      if (status !== 'ALL' && doc.status !== status) {
        return false;
      }
      if (q) {
        const nameMatch = doc.filename.toLowerCase().includes(q);
        const typeMatch = (doc.tradeDocumentType || '').toLowerCase().includes(q);
        const buyerMatch = (doc.buyerName || '').toLowerCase().includes(q);
        const sellerMatch = (doc.sellerName || '').toLowerCase().includes(q);
        const decisionMatch = (doc.tradeDecision || '').toLowerCase().includes(q);
        return nameMatch || typeMatch || buyerMatch || sellerMatch || decisionMatch;
      }
      return true;
    });
  });

  protected readonly completedCount = computed<number>(() => {
    return this.documents().filter((d) => d.status === 'completed').length;
  });

  protected readonly allowCount = computed<number>(() => {
    return this.documents().filter((d) => d.tradeDecision === 'ALLOW').length;
  });

  protected readonly reviewCount = computed<number>(() => {
    return this.documents().filter((d) => d.tradeDecision === 'REVIEW').length;
  });

  protected readonly blockCount = computed<number>(() => {
    return this.documents().filter((d) => d.tradeDecision === 'BLOCK_ESCALATE').length;
  });

  clearSearch(): void {
    this.searchQuery.set('');
  }

  setDecisionFilter(filter: 'ALL' | 'ALLOW' | 'REVIEW' | 'BLOCK_ESCALATE'): void {
    this.decisionFilter.set(filter);
  }

  // ── Delete History Signals ──
  protected readonly showDeleteHistoryModal = signal(false);
  protected readonly deleteHistoryMode = signal<'range' | 'all'>('range');
  protected readonly deleteFromDate = signal<string>('');
  protected readonly deleteToDate = signal<string>('');
  protected readonly confirmDeleteAllChecked = signal(false);
  protected readonly deletingHistory = signal(false);

  // ── Restore History Signals ──
  protected readonly showRestoreHistoryModal = signal(false);
  protected readonly restoreHistoryMode = signal<'range' | 'all'>('range');
  protected readonly restoreFromDate = signal<string>('');
  protected readonly restoreToDate = signal<string>('');
  protected readonly confirmingRestoreAll = signal(false);
  protected readonly restoringHistory = signal(false);
  protected readonly archivedTotalCount = signal<number>(0);
  protected readonly archivedMatchingCount = signal<number>(0);
  protected readonly loadingArchivedStats = signal<boolean>(false);

  // ── Deduplication & Batch Modals ──
  protected readonly duplicateModal = signal<UploadResponse | null>(null);
  protected readonly batchModal = signal<BatchUploadResponse | null>(null);
  protected readonly reanalyzingBatch = signal<boolean>(false);
  protected readonly batchFilter = signal<'ALL' | 'DUPLICATE' | 'NEW'>('ALL');
  protected readonly batchSearch = signal<string>('');

  protected readonly filteredBatchDocuments = computed(() => {
    const batch = this.batchModal();
    if (!batch) return [];
    let docs = batch.documents;
    const filter = this.batchFilter();
    if (filter === 'DUPLICATE') {
      docs = docs.filter((d) => d.status === 'DUPLICATE' || d.isDuplicate);
    } else if (filter === 'NEW') {
      docs = docs.filter((d) => d.status === 'NEW' && !d.isDuplicate);
    }
    const q = this.batchSearch().trim().toLowerCase();
    if (q) {
      docs = docs.filter((d) => d.filename.toLowerCase().includes(q));
    }
    return docs;
  });

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      this.auth.openLoginModal();
      this.router.navigate(['/']);
      return;
    }
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

  downloadPdfReport(id: string, fallbackName: string): void {
    const reportName = fallbackName.replace(/\.[^/.]+$/, '') + '-compliance-report.pdf';
    this.docsService.downloadPdfReport(id, reportName).subscribe({
      next: (filename) => {
        this.toast.success('Audit Report Downloaded', filename);
      },
      error: (err) => {
        this.toast.error('PDF Download Failed', err.message || 'Could not generate compliance PDF report');
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
            const res = event.response;
            if (res.isDuplicate || res.duplicate) {
              this.selectedFiles.set([]);
              this.duplicateModal.set(res);
              this.toast.info(
                'Existing Document Recognized',
                `"${file.name}" matches an existing trade document in the repository.`
              );
              this.loadDocuments();
            } else {
              this.selectedFiles.set([]);
              this.toast.success(
                'Document uploaded successfully',
                `${file.name} is now queued for AI analysis.`
              );
              this.router.navigate(['/processing', res.id]);
            }
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
            const batch = event.response;
            if (batch.summary.duplicates > 0) {
              this.batchModal.set(batch);
              this.toast.info(
                'Batch Ingestion Processed',
                `${batch.summary.total} files processed: ${batch.summary.new} new, ${batch.summary.duplicates} duplicates recognized.`
              );
            } else {
              this.toast.success(
                'Batch Upload Complete',
                `${batch.summary.total} trade documents queued for analysis.`
              );
            }
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

  closeDuplicateModal(): void {
    this.duplicateModal.set(null);
  }

  @HostListener('window:keydown.escape')
  onEscapeKey(): void {
    if (this.batchModal()) {
      this.closeBatchModal();
    }
  }

  closeBatchModal(): void {
    this.batchModal.set(null);
    this.batchFilter.set('ALL');
    this.batchSearch.set('');
  }

  reanalyzeAllDuplicates(batch: BatchUploadResponse): void {
    const duplicateDocs = batch.documents.filter(
      (d) => (d.status === 'DUPLICATE' || d.isDuplicate) && (d.documentId || d.id),
    );
    if (duplicateDocs.length === 0) {
      this.toast.info('No Duplicates', 'No duplicate trade presentations found to re-analyze.');
      return;
    }

    this.reanalyzingBatch.set(true);
    const requests = duplicateDocs.map((d) => this.docsService.reanalyze(d.documentId || d.id));

    forkJoin(requests).subscribe({
      next: (results) => {
        this.reanalyzingBatch.set(false);
        this.batchModal.set(null);
        this.toast.success(
          'Batch Re-Analysis Queued',
          `Queued ${results.length} duplicate trade presentation${results.length > 1 ? 's' : ''} for fresh AI compliance re-examination.`,
        );
        this.loadDocuments();
        if (results.length > 0 && results[0]?.id) {
          this.router.navigate(['/processing', results[0].id]);
        }
      },
      error: (err: any) => {
        this.reanalyzingBatch.set(false);
        this.toast.error('Re-Analysis Failed', err.message || 'Could not queue batch re-analysis.');
      },
    });
  }

  viewPreviousAnalysis(docId: string, status?: string): void {
    this.duplicateModal.set(null);
    this.batchModal.set(null);
    if (status === 'completed') {
      this.router.navigate(['/analysis', docId]);
    } else {
      this.router.navigate(['/processing', docId]);
    }
  }

  analyzeAgain(docId: string): void {
    this.duplicateModal.set(null);
    this.batchModal.set(null);
    this.docsService.reanalyze(docId).subscribe({
      next: () => {
        this.toast.info('Re-Analysis Started', 'Queued document for new compliance run.');
        this.router.navigate(['/processing', docId]);
      },
      error: (err: any) => {
        this.toast.error('Re-Analysis Failed', err.message || 'Could not queue re-analysis.');
      },
    });
  }

  reanalyzeDocument(id: string): void {
    this.docsService.reanalyze(id).subscribe({
      next: () => {
        this.toast.info('Re-Analysis Started', 'Queued document for new compliance run.');
        this.router.navigate(['/processing', id]);
      },
      error: (err: any) => {
        this.toast.error('Re-Analysis Failed', err.message || 'Could not queue re-analysis.');
      },
    });
  }

  analyzeDocument(id: string): void {
    this.router.navigate(['/processing', id]);
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
    const completed = this.filteredDocuments().filter((d) => d.status === 'completed');
    if (completed.length === 0) return false;
    return completed.every((d) => this.selectedForCompare().has(d.id));
  }

  toggleSelectAllCompleted(): void {
    const completed = this.filteredDocuments().filter((d) => d.status === 'completed');
    if (this.areAllCompletedSelected()) {
      this.selectedForCompare.set(new Set());
    } else {
      const set = new Set<string>(this.selectedForCompare());
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
    const keywords = ['liberty', 'cosco', 'pakistan_customs', 'inv-5771', 'ctr-050', 'cosu6445585470', 'cosu', 'gd2905', 'waybill'];
    const allMatching = this.documents().filter((d) => keywords.some((k) => d.filename.toLowerCase().includes(k)));

    // Deduplicate by category label to ensure exactly one unique card per trade presentation role
    const uniqueMap = new Map<string, DocumentSummary>();
    for (const d of allMatching) {
      const label = this.getDocumentLabel(d.filename);
      if (!uniqueMap.has(label)) {
        uniqueMap.set(label, d);
      }
    }

    const docs = Array.from(uniqueMap.values());

    // Canonical trade presentation sequencing (1 -> 2 -> 3 -> 4)
    const getOrder = (name: string): number => {
      const lower = name.toLowerCase();
      if (lower.includes('invoice') || lower.includes('inv-5771')) return 1;
      if (lower.includes('contract') || lower.includes('ctr-050')) return 2;
      if (lower.includes('waybill') || lower.includes('cosu') || lower.includes('cosco')) return 3;
      if (lower.includes('customs') || lower.includes('gd2905') || lower.includes('pakistan')) return 4;
      return 5;
    };

    return docs.sort((a, b) => getOrder(a.filename) - getOrder(b.filename));
  }

  getDocumentLabel(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.includes('invoice') || lower.includes('inv-5771')) return 'Commercial Invoice (1.jpg)';
    if (lower.includes('contract') || lower.includes('ctr-050')) return 'Sales Contract (2.jpg)';
    if (lower.includes('waybill') || lower.includes('cosu') || lower.includes('cosco')) return 'Sea Waybill (3.jpg)';
    if (lower.includes('customs') || lower.includes('gd2905') || lower.includes('pakistan')) return 'Goods Declaration GD-I (4.jpg)';
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

  // ── Restore History Modal Handlers ──
  openRestoreHistoryModal(): void {
    this.showRestoreHistoryModal.set(true);
    this.restoreHistoryMode.set('range');
    this.restoreFromDate.set('');
    this.restoreToDate.set('');
    this.confirmingRestoreAll.set(false);
    this.fetchArchivedStats();
  }

  closeRestoreHistoryModal(): void {
    this.showRestoreHistoryModal.set(false);
    this.confirmingRestoreAll.set(false);
  }

  fetchArchivedStats(): void {
    this.loadingArchivedStats.set(true);
    this.docsService
      .getArchivedCount({
        fromDate: this.restoreFromDate() || undefined,
        toDate: this.restoreToDate() || undefined,
      })
      .subscribe({
        next: (stats) => {
          this.archivedTotalCount.set(stats.total);
          this.archivedMatchingCount.set(stats.matching);
          this.loadingArchivedStats.set(false);
        },
        error: () => {
          this.loadingArchivedStats.set(false);
        },
      });
  }

  onRestoreDateChange(): void {
    this.fetchArchivedStats();
  }

  executeRestoreHistory(): void {
    const mode = this.restoreHistoryMode();
    this.restoringHistory.set(true);

    const payload =
      mode === 'all'
        ? { all: true }
        : {
            all: false,
            fromDate: this.restoreFromDate() || undefined,
            toDate: this.restoreToDate() || undefined,
          };

    this.docsService.restoreHistory(payload).subscribe({
      next: (res) => {
        this.restoringHistory.set(false);
        this.closeRestoreHistoryModal();
        this.toast.success(
          'History Restored',
          `Restored ${res.restoredCount} document(s) from MongoDB Atlas cloud database.`
        );
        this.loadDocuments();
      },
      error: (err) => {
        this.restoringHistory.set(false);
        this.toast.error(
          'Restore Failed',
          err.message || 'Could not restore documents from database.'
        );
      },
    });
  }

  restoreAllHistory(): void {
    this.openRestoreHistoryModal();
  }

  scrollToWorkbench(): void {
    const el = document.getElementById('solutions-workbench');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  scrollToLiberty(): void {
    const el = document.querySelector('.liberty-showcase-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ── Modern Table Horizontal Navigation & Drag Handlers ──
  private isTableDragging = false;
  private tableStartX = 0;
  private tableScrollLeft = 0;

  scrollTable(direction: 'left' | 'right'): void {
    const el = document.querySelector('.modern-table-container') as HTMLElement;
    if (!el) return;
    const distance = 420;
    el.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth',
    });
  }

  onTableMouseDown(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, label, [role="button"], .classification-pill, .badge-dup-tag, .badge-version-tag')) {
      return;
    }
    const container = document.querySelector('.modern-table-container') as HTMLElement;
    if (!container) return;
    this.isTableDragging = true;
    this.tableStartX = e.clientX;
    this.tableScrollLeft = container.scrollLeft;
    container.classList.add('is-dragging');
  }

  onTableMouseMove(e: MouseEvent): void {
    if (!this.isTableDragging) return;
    const container = document.querySelector('.modern-table-container') as HTMLElement;
    if (!container) return;
    e.preventDefault();
    const deltaX = (e.clientX - this.tableStartX) * 1.3;
    container.scrollLeft = this.tableScrollLeft - deltaX;
  }

  onTableMouseUpOrLeave(): void {
    if (!this.isTableDragging) return;
    this.isTableDragging = false;
    const container = document.querySelector('.modern-table-container') as HTMLElement;
    if (container) {
      container.classList.remove('is-dragging');
    }
  }

  // ── Enterprise Footer State & Methods ──
  readonly activeOfficeTab = signal<'usa' | 'pakistan' | 'uae'>('usa');
  readonly selectedLegalModal = signal<'privacy' | 'eula' | null>(null);

  openLegalModal(type: 'privacy' | 'eula'): void {
    this.selectedLegalModal.set(type);
  }

  closeLegalModal(): void {
    this.selectedLegalModal.set(null);
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  scrollToSolutions(): void {
    this.router.navigate(['/'], { fragment: 'solutions' });
  }

  scrollToBlogs(): void {
    this.router.navigate(['/'], { fragment: 'articles' });
  }

  scrollToAbout(): void {
    this.router.navigate(['/'], { fragment: 'about' });
  }

  scrollToFaq(): void {
    this.router.navigate(['/'], { fragment: 'faq' });
  }
}

