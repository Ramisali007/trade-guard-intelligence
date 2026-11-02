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
import { RouteAccess } from '../../services/route-access';
import {
  DocumentsService,
  type UploadEvent,
} from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import type {
  BatchUploadResponse,
  ClientConfig,
  ComplianceHealthSummary,
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
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
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
  protected readonly routeAccess = inject(RouteAccess);
  private readonly docsService = inject(DocumentsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly health = signal<HealthResponse | null>(null);
  protected readonly clientConfig = signal<ClientConfig | null>(null);
  protected readonly documents = signal<DocumentSummary[]>([]);
  /** Times an identical file was uploaded again and recognized instead of being analyzed again. */
  protected readonly duplicatesPrevented = computed<number>(() =>
    this.documents().reduce((sum, d) => sum + Math.max(0, (d.importCount ?? 1) - 1), 0),
  );
  protected readonly totalDocumentsCount = signal<number>(0);
  protected readonly complianceHealthSummary = signal<ComplianceHealthSummary | null>(null);
  protected readonly flaggedCount = computed(
    () => this.documents().filter((d) => d.tradeDecision === 'REVIEW' || d.tradeDecision === 'BLOCK_ESCALATE').length,
  );
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
    this.loadComplianceHealth();
    this.loadDocuments();
  }

  loadHealth(): void {
    this.docsService.healthDetails().subscribe({
      next: (h) => this.health.set(h),
      error: () => { },
    });
  }

  loadComplianceHealth(): void {
    this.docsService.getComplianceHealth().subscribe({
      next: (summary) => this.complianceHealthSummary.set(summary),
      error: () => { },
    });
  }

  loadDocuments(): void {
    this.loadingDocs.set(true);
    this.docsService.list(50, 0).subscribe({
      next: (res) => {
        this.documents.set(res.items);
        this.totalDocumentsCount.set(res.total);
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
        error: (err) => {
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
        error: (err) => {
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
      error: (err) => {
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
      error: (err) => {
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
      error: (err) => {
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
}

