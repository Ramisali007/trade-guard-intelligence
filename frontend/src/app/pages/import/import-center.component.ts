import { Component, OnInit, signal, computed, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DocumentsService } from '../../services/documents.service';
import { Icon } from '../../shared/components/icon';

@Component({
  selector: 'app-import-center',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, Icon],
  templateUrl: './import-center.component.html',
  styleUrls: ['./import-center.component.scss'],
})
export class ImportCenterComponent implements OnInit {
  private readonly docsService = inject(DocumentsService);

  // Registered Entities state
  protected readonly entities = signal<any[]>([]);
  protected readonly selectedEntityType = signal<string>('countries');
  protected readonly loading = signal<boolean>(false);
  protected readonly actionLoading = signal<boolean>(false);
  protected readonly catalogDropdownOpen = signal<boolean>(false);

  // Master Data Grid state
  protected readonly masterItems = signal<any[]>([]);
  protected readonly totalCount = signal<number>(0);
  protected readonly searchQuery = signal<string>('');
  protected readonly statusFilter = signal<string>('');

  // Current selected entity definition
  protected readonly currentEntityDef = computed(() => {
    return this.entities().find((e) => e.type === this.selectedEntityType()) || null;
  });

  // Modal States
  protected readonly showModal = signal<boolean>(false);
  protected readonly modalMode = signal<'CREATE' | 'EDIT_DETAILS' | 'BULK_IMPORT' | 'VIEW_HISTORY'>('CREATE');
  protected readonly formData = signal<Record<string, any>>({});
  protected readonly formNotes = signal<string>('');
  protected readonly formErrors = signal<string[]>([]);
  protected readonly selectedItemForHistory = signal<any>(null);
  protected readonly itemAuditHistory = signal<any[]>([]);

  // Bulk Import States
  protected readonly bulkMethod = signal<'CSV' | 'JSON' | 'URL'>('CSV');
  protected readonly bulkRawText = signal<string>('');
  protected readonly bulkUrl = signal<string>('');
  protected readonly bulkSourceName = signal<string>('Manual Bulk Ingestion');
  protected readonly isPreviewing = signal<boolean>(false);
  protected readonly bulkPreview = signal<any | null>(null);

  // Import Batches & Audit Logs
  protected readonly recentBatches = signal<any[]>([]);
  protected readonly globalAuditLogs = signal<any[]>([]);
  protected readonly activeTab = signal<'DATA' | 'BATCHES' | 'AUDIT'>('DATA');

  // Notification Toast
  protected readonly toastMessage = signal<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  ngOnInit(): void {
    this.loadEntities();
    this.loadBatches();
  }

  protected loadEntities(): void {
    this.loading.set(true);
    this.docsService.getImportEntities().subscribe({
      next: (res) => {
        this.entities.set(res.entities || []);
        if (res.entities && res.entities.length > 0 && !this.selectedEntityType()) {
          this.selectedEntityType.set(res.entities[0].type);
        }
        this.loadMasterData();
      },
      error: (err) => {
        this.loading.set(false);
        this.showToast('error', `Failed loading master entities: ${err.message || err}`);
      },
    });
  }

  protected selectEntity(type: string): void {
    this.selectedEntityType.set(type);
    this.searchQuery.set('');
    this.statusFilter.set('');
    this.activeTab.set('DATA');
    this.catalogDropdownOpen.set(false);
    this.loadMasterData();
  }

  protected toggleCatalogDropdown(): void {
    this.catalogDropdownOpen.update((v) => !v);
  }

  protected closeCatalogDropdown(): void {
    this.catalogDropdownOpen.set(false);
  }

  protected selectEntityFromDropdown(type: string): void {
    this.selectEntity(type);
  }

  protected getEntityIcon(type: string | undefined): string {
    if (!type) return 'database';
    switch (type) {
      case 'countries': return 'globe';
      case 'sanctions': return 'shield-alert';
      case 'commodity_prices': return 'chart';
      case 'products': return 'package';
      case 'ports': return 'anchor';
      case 'shipping_routes': return 'compass';
      case 'companies': return 'user';
      case 'banks': return 'bank';
      case 'currencies': return 'scale';
      case 'regulations': return 'shield-check';
      case 'vessels': return 'anchor';
      default: return 'database';
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.catalog-dropdown-container')) {
      this.catalogDropdownOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscapePress(): void {
    this.catalogDropdownOpen.set(false);
  }

  protected loadMasterData(): void {
    const type = this.selectedEntityType();
    if (!type) return;

    this.loading.set(true);
    this.docsService
      .getMasterEntities(type, {
        limit: 100,
        offset: 0,
        search: this.searchQuery(),
        status: this.statusFilter(),
      })
      .subscribe({
        next: (res) => {
          this.masterItems.set(res.items || []);
          this.totalCount.set(res.total || 0);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.showToast('error', `Failed loading ${type}: ${err.message || err}`);
        },
      });
  }

  protected onSearchChange(): void {
    this.loadMasterData();
  }

  protected onFilterChange(): void {
    this.loadMasterData();
  }

  // --- Modal Openers ---

  protected openCreateModal(): void {
    this.modalMode.set('CREATE');
    this.formData.set({});
    this.formNotes.set('');
    this.formErrors.set([]);
    this.showModal.set(true);
  }

  protected openEditDetailsModal(item: any): void {
    this.modalMode.set('EDIT_DETAILS');
    this.formData.set({ ...item });
    this.formNotes.set('');
    this.formErrors.set([]);
    this.showModal.set(true);
  }

  protected openBulkImportModal(): void {
    this.modalMode.set('BULK_IMPORT');
    this.bulkMethod.set('CSV');
    this.bulkRawText.set('');
    this.bulkUrl.set('');
    this.bulkPreview.set(null);
    this.formErrors.set([]);
    this.showModal.set(true);
  }

  protected openHistoryModal(item: any): void {
    this.modalMode.set('VIEW_HISTORY');
    this.selectedItemForHistory.set(item);
    const id = item.canonicalId || item.countryCode || item.productKey || item.hsCode || item.locode || item.routeId || item.swiftBic || item.currencyCode || item.regulationReference || item.imo;
    
    this.actionLoading.set(true);
    this.docsService.getMasterEntityDetails(this.selectedEntityType(), id).subscribe({
      next: (res) => {
        this.itemAuditHistory.set(res.auditHistory || []);
        this.actionLoading.set(false);
        this.showModal.set(true);
      },
      error: () => {
        this.actionLoading.set(false);
        this.itemAuditHistory.set([]);
        this.showModal.set(true);
      },
    });
  }

  protected closeModal(): void {
    this.showModal.set(false);
    this.bulkPreview.set(null);
  }

  // --- Save Single Record (Create or Patch Details) ---

  protected saveSingleRecord(): void {
    const type = this.selectedEntityType();
    const data = this.formData();
    const isPatch = this.modalMode() === 'EDIT_DETAILS';
    const notes = this.formNotes();

    this.actionLoading.set(true);
    this.formErrors.set([]);

    this.docsService.saveMasterEntity(type, data, isPatch, notes).subscribe({
      next: (res) => {
        this.actionLoading.set(false);
        this.closeModal();
        this.showToast('success', `Record successfully ${res.action === 'CREATE' ? 'created' : 'updated'} (Batch: ${res.batchId})`);
        this.loadMasterData();
        this.loadBatches();
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.formErrors.set([err.message || 'Validation and saving failed']);
      },
    });
  }

  // --- Bulk Import: Preview and Commit ---

  protected generateBulkPreview(): void {
    const type = this.selectedEntityType();
    const raw = this.bulkRawText().trim();
    if (!raw) {
      this.formErrors.set(['Please paste or enter data content to preview']);
      return;
    }

    this.isPreviewing.set(true);
    this.formErrors.set([]);

    this.docsService.previewBulkImport(type, { rawContent: raw }).subscribe({
      next: (preview) => {
        this.bulkPreview.set(preview);
        this.isPreviewing.set(false);
      },
      error: (err) => {
        this.isPreviewing.set(false);
        this.formErrors.set([err.message || 'Failed generating import preview']);
      },
    });
  }

  protected fetchAndPreviewUrl(): void {
    const url = this.bulkUrl().trim();
    if (!url) {
      this.formErrors.set(['Please specify a valid HTTPS source URL']);
      return;
    }

    this.isPreviewing.set(true);
    this.formErrors.set([]);

    this.docsService.fetchUrlSource(url).subscribe({
      next: (res) => {
        this.bulkRawText.set(res.content);
        this.generateBulkPreview();
      },
      error: (err) => {
        this.isPreviewing.set(false);
        this.formErrors.set([`SSRF / Network Error: ${err.message || err}`]);
      },
    });
  }

  protected commitBulkPreview(): void {
    const preview = this.bulkPreview();
    if (!preview || !preview.previewRows) return;

    const type = this.selectedEntityType();
    const validRecords = preview.previewRows
      .filter((r: any) => r.action !== 'INVALID')
      .map((r: any) => r.incomingData);

    if (validRecords.length === 0) {
      this.formErrors.set(['No valid records to commit']);
      return;
    }

    this.actionLoading.set(true);
    this.docsService
      .commitBulkImport(type, {
        records: validRecords,
        ingestionMethod: this.bulkMethod(),
        sourceName: this.bulkSourceName() || 'Bulk Ingestion Portal',
        notes: `Imported ${validRecords.length} records into ${type}`,
      })
      .subscribe({
        next: (batch) => {
          this.actionLoading.set(false);
          this.closeModal();
          this.showToast(
            'success',
            `Bulk Ingestion Batch ${batch.batchId} completed! Created: ${batch.createdCount}, Updated: ${batch.updatedCount}, Duplicates: ${batch.duplicateCount}`,
          );
          this.loadMasterData();
          this.loadBatches();
        },
        error: (err) => {
          this.actionLoading.set(false);
          this.formErrors.set([err.message || 'Failed committing bulk batch']);
        },
      });
  }

  // --- Trigger Live Scraper ---

  protected triggerScraper(): void {
    const type = this.selectedEntityType();
    this.actionLoading.set(true);

    this.docsService.triggerEntityScraper(type).subscribe({
      next: (res) => {
        this.actionLoading.set(false);
        this.showToast('success', `External scraper synchronized successfully for ${type}! Fetched: ${res.syncRun?.recordsFetched || 0} records.`);
        this.loadMasterData();
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.showToast('error', `Live scraper error: ${err.message || err}`);
      },
    });
  }

  // --- Load Batches & Audit Logs ---

  protected loadBatches(): void {
    this.docsService.getImportBatches(30).subscribe({
      next: (res) => this.recentBatches.set(res.batches || []),
      error: () => {},
    });
  }

  protected loadAuditLogs(): void {
    this.loading.set(true);
    this.docsService.getImportAuditLogs(100).subscribe({
      next: (res) => {
        this.globalAuditLogs.set(res.logs || []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected switchViewTab(tab: 'DATA' | 'BATCHES' | 'AUDIT'): void {
    this.activeTab.set(tab);
    if (tab === 'BATCHES') this.loadBatches();
    if (tab === 'AUDIT') this.loadAuditLogs();
  }

  // --- Helpers ---

  protected showToast(type: 'success' | 'error' | 'info', text: string): void {
    this.toastMessage.set({ type, text });
    setTimeout(() => {
      if (this.toastMessage()?.text === text) {
        this.toastMessage.set(null);
      }
    }, 5500);
  }

  protected getKeys(obj: any): string[] {
    return obj ? Object.keys(obj) : [];
  }

  protected getDisplayFields(): any[] {
    const def = this.currentEntityDef();
    return def ? def.fields.slice(0, 5) : [];
  }

  protected getBulkPlaceholder(): string {
    return this.bulkMethod() === 'CSV'
      ? 'countryCode,countryName,isSanctioned,riskLevel\nPK,Pakistan,false,LOW\nIR,Iran,true,CRITICAL'
      : '[\n  {\n    "countryCode": "PK",\n    "countryName": "Pakistan",\n    "isSanctioned": false\n  }\n]';
  }
}
