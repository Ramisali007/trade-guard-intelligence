import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, timer } from 'rxjs';
import { catchError, filter, map, switchMap, takeWhile, throwError } from 'rxjs';
import { API_BASE, ApiService, toApiError } from './api.service';
import type {
  AnalysisEvent,
  BatchUploadResponse,
  ClientConfig,
  DocumentDetail,
  DocumentListResponse,
  HealthResponse,
  ImportEvent,
  Progress,
  StatusResponse,
  TradeComparisonResult,
  UnitPage,
  UnitQuery,
  UploadResponse,
  FxRateQuote,
  ComplianceSourceRecord,
  ComplianceSyncBatch,
  ComplianceSyncRunRecord,
  ComplianceHealthSummary,
  SnapshotChangeEvent,
  DocumentTimelineEvent,
  DocumentEvidencePackage,
  ImportEntitySummary,
  MasterDataChange,
  ImportBatchRecord,
  ImportAuditRecord,
  HistoricalScreeningResult,
} from '../models/api.models';

/** Progress of the browser→server file transfer. Distinct from the server-side analysis. */
export interface UploadProgress {
  kind: 'progress';
  /** 0–100 of bytes sent, or null when the browser cannot report a total. */
  percent: number | null;
  loaded: number;
  total: number | null;
}

export interface UploadComplete {
  kind: 'complete';
  response: UploadResponse;
}

export type UploadEvent = UploadProgress | UploadComplete;

/** Statuses that will never change again, so polling can stop. */
const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

/**
 * Every call the application makes against `/api/documents`, plus the two ancillary endpoints
 * the client needs at start-up.
 *
 * Two things here are worth more than the method list. `upload()` reports the real byte progress
 * of the transfer, because a 40 MB file over a slow link is a genuine wait that deserves a real
 * bar rather than a spinner. And `pollStatus()` reads the server's own progress figure on a
 * fixed cadence and stops the moment the document reaches a terminal state — the percentage the
 * processing screen shows is always a number the backend computed from finished work, never one
 * this service interpolated to look busy.
 */
@Injectable({ providedIn: 'root' })
export class DocumentsService {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);

  // ------------------------------------------------------------------ ancillary
  health(): Observable<HealthResponse> {
    return this.api.get<HealthResponse>('/health');
  }

  /** Engine, storage and queue detail; requires a signed-in user. */
  healthDetails(): Observable<HealthResponse> {
    return this.api.get<HealthResponse>('/health/details');
  }

  clientConfig(): Observable<ClientConfig> {
    return this.api.get<ClientConfig>('/config');
  }

  // ------------------------------------------------------------------ documents
  list(limit = 20, offset = 0): Observable<DocumentListResponse> {
    return this.api.get<DocumentListResponse>('/documents', { limit, offset });
  }

  detail(id: string): Observable<DocumentDetail> {
    return this.api.get<DocumentDetail>(`/documents/${id}`);
  }

  results(id: string): Observable<DocumentDetail> {
    return this.api.get<DocumentDetail>(`/documents/${id}/results`);
  }

  status(id: string): Observable<StatusResponse> {
    return this.api.get<StatusResponse>(`/documents/${id}/status`);
  }

  units(id: string, query: UnitQuery): Observable<UnitPage> {
    return this.api.get<UnitPage>(`/documents/${id}/units`, query as Record<string, unknown>);
  }

  analyze(id: string): Observable<{ id: string; status: string; queuePosition: number }> {
    return this.api.post<{ id: string; status: string; queuePosition: number }>(
      `/documents/${id}/analyze`,
    );
  }

  reanalyze(id: string): Observable<{ id: string; status: string; progress: Progress; analysisCount: number; queuePosition: number }> {
    return this.api.post<{ id: string; status: string; progress: Progress; analysisCount: number; queuePosition: number }>(
      `/documents/${id}/reanalyze`,
    );
  }

  analysisHistory(id: string): Observable<{ documentId: string; totalRuns: number; history: AnalysisEvent[] }> {
    return this.api.get<{ documentId: string; totalRuns: number; history: AnalysisEvent[] }>(
      `/documents/${id}/analysis-history`,
    );
  }

  importHistory(id: string): Observable<{ documentId: string; totalImports: number; history: ImportEvent[] }> {
    return this.api.get<{ documentId: string; totalImports: number; history: ImportEvent[] }>(
      `/documents/${id}/import-history`,
    );
  }

  remove(id: string): Observable<void> {
    return this.api.delete<void>(`/documents/${id}`);
  }

  deleteHistory(options: {
    all?: boolean;
    fromDate?: string;
    toDate?: string;
  }): Observable<{ deletedCount: number; remainingCount: number }> {
    return this.api.post<{ deletedCount: number; remainingCount: number }>(
      '/documents/delete-history',
      options,
    );
  }

  restoreHistory(options?: {
    all?: boolean;
    ids?: string[];
    fromDate?: string;
    toDate?: string;
  }): Observable<{ restoredCount: number; remainingCount: number }> {
    return this.api.post<{ restoredCount: number; remainingCount: number }>(
      '/documents/restore-history',
      options || { all: true },
    );
  }

  getArchivedCount(options?: {
    fromDate?: string;
    toDate?: string;
  }): Observable<{ total: number; matching: number }> {
    return this.api.get<{ total: number; matching: number }>('/documents/archived-count', options);
  }

  overrideDecision(
    id: string,
    payload: {
      action: string;
      newDecision: string;
      reason: string;
      notes?: string;
    },
  ): Observable<DocumentDetail> {
    return this.api.post<DocumentDetail>(`/documents/${id}/override`, payload);
  }

  /** Upload one file, streaming transfer progress and finishing with the created document. */
  upload(file: File, autoStart = true): Observable<UploadEvent> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('autoStart', String(autoStart));

    return this.http
      .post<UploadResponse>(`${API_BASE}/documents/upload`, form, {
        reportProgress: true,
        observe: 'events',
      })
      .pipe(
        map((event): UploadEvent | null => {
          if (event.type === HttpEventType.UploadProgress) {
            const total = event.total ?? null;
            return {
              kind: 'progress',
              loaded: event.loaded,
              total,
              percent: total ? Math.min(100, Math.round((event.loaded / total) * 100)) : null,
            };
          }
          if (event.type === HttpEventType.Response && event.body) {
            return { kind: 'complete', response: event.body };
          }
          return null;
        }),
        filter((event): event is UploadEvent => event !== null),
        catchError((error: unknown) => throwError(() => toApiError(error))),
      );
  }

  /** Upload multiple files simultaneously in batch. */
  uploadBatch(files: File[], autoStart = true): Observable<{ kind: 'progress'; percent: number | null; loaded: number; total: number | null } | { kind: 'complete'; response: BatchUploadResponse }> {
    const form = new FormData();
    for (const f of files) {
      form.append('files', f, f.name);
    }
    form.append('autoStart', String(autoStart));

    return this.http
      .post<BatchUploadResponse>(`${API_BASE}/documents/upload-batch`, form, {
        reportProgress: true,
        observe: 'events',
      })
      .pipe(
        map((event) => {
          if (event.type === HttpEventType.UploadProgress) {
            const total = event.total ?? null;
            return {
              kind: 'progress' as const,
              loaded: event.loaded,
              total,
              percent: total ? Math.min(100, Math.round((event.loaded / total) * 100)) : null,
            };
          }
          if (event.type === HttpEventType.Response && event.body) {
            return { kind: 'complete' as const, response: event.body };
          }
          return null;
        }),
        filter((event): event is { kind: 'progress'; percent: number | null; loaded: number; total: number | null } | { kind: 'complete'; response: BatchUploadResponse } => event !== null),
        catchError((error: unknown) => throwError(() => toApiError(error))),
      );
  }

  /** Run cross-document reconciliation and comparison across 2+ documents */
  compareDocuments(documentIds: string[]): Observable<TradeComparisonResult> {
    return this.api.post<TradeComparisonResult>('/documents/compare', { documentIds });
  }

  /**
   * Fetch the cross-document reconciliation PDF report and trigger browser download.
   */
  downloadComparisonPdfReport(
    documentIds: string[],
    fallbackName = 'Trade_Reconciliation_Matrix_Report.pdf',
  ): Observable<string> {
    return this.http
      .post(`${API_BASE}/documents/compare/pdf`, { documentIds }, { responseType: 'blob', observe: 'response' })
      .pipe(
        map((response) => {
          const blob = response.body ?? new Blob([], { type: 'application/pdf' });
          const filename =
            parseFilename(response.headers.get('Content-Disposition')) ?? fallbackName;
          saveBlobFile(filename, blob);
          return filename;
        }),
        catchError((error: unknown) => throwError(() => toApiError(error))),
      );
  }

  /**
   * Poll a document's status until it settles.
   *
   * Emits immediately, then on every tick, and completes on the terminal value so the caller
   * needs no stop condition of its own. `takeWhile(..., true)` is what lets the final state
   * through before completing.
   */
  pollStatus(id: string, intervalMs = 900): Observable<StatusResponse> {
    return timer(0, intervalMs).pipe(
      switchMap(() => this.status(id)),
      takeWhile((status) => !isTerminal(status.status), true),
    );
  }

  /**
   * Fetch the `.pdf` report and hand the browser a download.
   */
  downloadPdfReport(id: string, fallbackName: string): Observable<string> {
    return this.http
      .get(`${API_BASE}/documents/${id}/report/pdf`, { responseType: 'blob', observe: 'response' })
      .pipe(
        map((response) => {
          const blob = response.body ?? new Blob([], { type: 'application/pdf' });
          const filename =
            parseFilename(response.headers.get('Content-Disposition')) ?? fallbackName;
          saveBlobFile(filename, blob);
          return filename;
        }),
        catchError((error: unknown) => throwError(() => toApiError(error))),
      );
  }

  /**
   * Fetch the `.txt` report and hand the browser a download.
   *
   * The report is requested through the app rather than by pointing the browser at the URL, so
   * a failure arrives as a message the UI can show instead of replacing the page with an error
   * document. The filename comes from the server's `Content-Disposition`, which it exposes to
   * the browser for exactly this purpose.
   */
  downloadReport(id: string, fallbackName: string): Observable<string> {
    return this.http
      .get(`${API_BASE}/documents/${id}/report`, { responseType: 'text', observe: 'response' })
      .pipe(
        map((response) => {
          const content = response.body ?? '';
          const filename =
            parseFilename(response.headers.get('Content-Disposition')) ?? fallbackName;
          saveTextFile(filename, content);
          return filename;
        }),
        catchError((error: unknown) => throwError(() => toApiError(error))),
      );
  }

  /** The report text without saving it, for the in-page preview. */
  reportText(id: string): Observable<string> {
    return this.http
      .get(`${API_BASE}/documents/${id}/report`, { responseType: 'text' })
      .pipe(catchError((error: unknown) => throwError(() => toApiError(error))));
  }

  /**
   * Fetch the original uploaded trade presentation source file binary and hand the browser a download.
   */
  downloadSourceFile(id: string, fallbackName: string): Observable<string> {
    return this.http
      .get(`${API_BASE}/documents/${id}/file`, { responseType: 'blob', observe: 'response' })
      .pipe(
        map((response) => {
          const blob = response.body ?? new Blob([], { type: 'application/octet-stream' });
          const filename =
            parseFilename(response.headers.get('Content-Disposition')) ?? fallbackName;
          saveBlobFile(filename, blob);
          return filename;
        }),
        catchError((error: unknown) => throwError(() => toApiError(error))),
      );
  }

  /** Retrieve registered regulatory sources and current health status */
  getComplianceSources(): Observable<{
    sources: ComplianceSourceRecord[];
    totalSources: number;
    recentSyncRuns?: ComplianceSyncRunRecord[];
    health?: ComplianceHealthSummary;
    changeEventsCount: number;
    changeEvents: SnapshotChangeEvent[];
  }> {
    return this.api.get<{
      sources: ComplianceSourceRecord[];
      totalSources: number;
      recentSyncRuns?: ComplianceSyncRunRecord[];
      health?: ComplianceHealthSummary;
      changeEventsCount: number;
      changeEvents: SnapshotChangeEvent[];
    }>('/documents/compliance/sources');
  }

  /** Manually trigger synchronization for a specific compliance source */
  syncSource(sourceId: string): Observable<{ success: boolean; run: ComplianceSyncRunRecord }> {
    return this.api.post<{ success: boolean; run: ComplianceSyncRunRecord }>(`/documents/compliance/sources/${sourceId}/sync`, {});
  }

  /** Start synchronization of all compliance sources; the server answers at once and the outcome is read with `syncAllStatus`. */
  syncAllSources(): Observable<{ started: boolean; batch: ComplianceSyncBatch }> {
    return this.api.post<{ started: boolean; batch: ComplianceSyncBatch }>('/documents/compliance/sources/sync-all', {});
  }

  /** The current or most recent "sync all" run, or null when none has run since the server started. */
  syncAllStatus(): Observable<{ batch: ComplianceSyncBatch | null }> {
    return this.api.get<{ batch: ComplianceSyncBatch | null }>('/documents/compliance/sources/sync-all/status');
  }

  /** Retrieve global compliance data health summary */
  getComplianceHealth(): Observable<ComplianceHealthSummary> {
    return this.api.get<ComplianceHealthSummary>('/documents/compliance/health');
  }

  /** Retrieve chronological audit events and retrospective diff timeline */
  getTimeline(id: string): Observable<{ documentId: string; filename: string; timelineEvents: DocumentTimelineEvent[] }> {
    return this.api.get<{ documentId: string; filename: string; timelineEvents: DocumentTimelineEvent[] }>(`/documents/${id}/timeline`);
  }

  /** Retrieve cryptographic audit evidence package with SHA-256 hashes */
  getEvidence(id: string): Observable<DocumentEvidencePackage> {
    return this.api.get<DocumentEvidencePackage>(`/documents/${id}/evidence`);
  }

  /** Retrieve retrospective post-transaction designation exposure alerts */
  getRetrospectiveAlerts(): Observable<{ alerts: Record<string, unknown>[]; totalAlerts: number }> {
    return this.api.get<{ alerts: Record<string, unknown>[]; totalAlerts: number }>('/documents/compliance/retrospective-alerts');
  }

  /** Point-in-Time historical re-screening */
  screenHistorical(body: { partyName: string; role?: string; asOfDate?: string; jurisdictions?: string[]; swiftBic?: string; imoNumber?: string }): Observable<HistoricalScreeningResult> {
    return this.api.post<HistoricalScreeningResult>('/documents/compliance/screen/historical', body);
  }

  // ---------------------------------------------------------------------------------------------
  // Enterprise Import Center & Master Data APIs
  // ---------------------------------------------------------------------------------------------

  /** Fetch all registered master data entities and metadata */
  getImportEntities(): Observable<{ entities: ImportEntitySummary[] }> {
    return this.api.get<{ entities: ImportEntitySummary[] }>('/import/entities');
  }

  /** Query and paginate records of a specific entity */
  getMasterEntities(
    entity: string,
    query: { limit?: number; offset?: number; search?: string; status?: string } = {},
  ): Observable<{ entityType: string; items: Record<string, unknown>[]; total: number; limit: number; offset: number }> {
    const params: Record<string, string | number> = {};
    if (query.limit) params['limit'] = query.limit;
    if (query.offset) params['offset'] = query.offset;
    if (query.search) params['search'] = query.search;
    if (query.status) params['status'] = query.status;
    return this.api.get<{ entityType: string; items: Record<string, unknown>[]; total: number; limit: number; offset: number }>(
      `/import/${entity}`,
      params,
    );
  }

  /** Retrieve entity details and its audit history */
  getMasterEntityDetails(entity: string, id: string): Observable<{ entityType: string; record: Record<string, unknown>; auditHistory: ImportAuditRecord[] }> {
    return this.api.get<{ entityType: string; record: Record<string, unknown>; auditHistory: ImportAuditRecord[] }>(`/import/${entity}/${id}`);
  }

  /** Create new entity or patch details of existing entity */
  saveMasterEntity(
    entity: string,
    data: Record<string, unknown>,
    isPatchDetails = false,
    notes?: string,
  ): Observable<{ success: boolean; status: string; changeRequest: MasterDataChange }> {
    return this.api.post<{ success: boolean; status: string; changeRequest: MasterDataChange }>(`/import/${entity}`, {
      data,
      isPatchDetails,
      notes,
    });
  }

  /** Preview bulk CSV or JSON import payload before committing */
  previewBulkImport(
    entity: string,
    payload: { rawContent?: string; records?: Record<string, unknown>[] },
  ): Observable<{
    entityType: string;
    totalDetected: number;
    validRecords: number;
    updatesCount: number;
    newCount: number;
    duplicatesCount: number;
    invalidCount: number;
    errors: Array<{ row: number; message: string }>;
    previewRows: Record<string, unknown>[];
  }> {
    return this.api.post<{
      entityType: string;
      totalDetected: number;
      validRecords: number;
      updatesCount: number;
      newCount: number;
      duplicatesCount: number;
      invalidCount: number;
      errors: Array<{ row: number; message: string }>;
      previewRows: Record<string, unknown>[];
    }>(`/import/${entity}/preview`, payload);
  }

  /** Commit previewed bulk batch */
  commitBulkImport(
    entity: string,
    payload: { records: Record<string, unknown>[]; ingestionMethod?: string; sourceName?: string; notes?: string },
  ): Observable<{ success: boolean; status: string; changeRequest: MasterDataChange }> {
    return this.api.post<{ success: boolean; status: string; changeRequest: MasterDataChange }>(`/import/${entity}/bulk`, payload);
  }

  /** Reference-data changes awaiting (or past) the second person's decision. */
  getMasterDataChanges(status?: string): Observable<{ changes: MasterDataChange[] }> {
    return this.api.get<{ changes: MasterDataChange[] }>('/import/changes', status ? { status } : undefined);
  }

  decideMasterDataChange(changeId: string, approve: boolean, rationale: string): Observable<{ changeRequest: MasterDataChange }> {
    return this.api.post<{ changeRequest: MasterDataChange }>(`/import/changes/${changeId}/decision`, { approve, rationale });
  }

  /** Trigger live scraper synchronization for an entity */
  triggerEntityScraper(entity: string): Observable<{ success: boolean; entityType: string; syncRun: ComplianceSyncRunRecord }> {
    return this.api.post<{ success: boolean; entityType: string; syncRun: ComplianceSyncRunRecord }>(`/import/${entity}/scrape`, {});
  }

  /** Fetch content from a trusted URL */
  fetchUrlSource(url: string): Observable<{ url: string; content: string }> {
    return this.api.post<{ url: string; content: string }>('/import/fetch-url', { url });
  }

  /** Get historical import batches */
  getImportBatches(limit = 50): Observable<{ batches: ImportBatchRecord[] }> {
    return this.api.get<{ batches: ImportBatchRecord[] }>('/import/batches', { limit });
  }

  /** Get audit log records */
  getImportAuditLogs(limit = 100, entityType?: string, recordId?: string): Observable<{ logs: ImportAuditRecord[] }> {
    const params: Record<string, string | number> = { limit };
    if (entityType) params['entityType'] = entityType;
    if (recordId) params['recordId'] = recordId;
    return this.api.get<{ logs: ImportAuditRecord[] }>('/import/audit', params);
  }

  /** Get real-time central bank foreign exchange conversion quote */
  getLiveFxQuote(amount: number, fromCurrency = 'USD', toCurrency = 'PKR'): Observable<FxRateQuote> {
    return this.api.get<FxRateQuote>('/documents/compliance/fx-quote', {
      amount,
      from: fromCurrency,
      to: toCurrency,
    });
  }

  /** Get all real-time central bank foreign exchange parity rates */
  getLiveFxRates(): Observable<{ success: boolean; base: string; asOf: string; rates: Record<string, number> }> {
    return this.api.get<{ success: boolean; base: string; asOf: string; rates: Record<string, number> }>(
      '/documents/compliance/fx-rates'
    );
  }
}

/** Read `filename*=UTF-8''…` in preference to the ASCII fallback the server also sends. */
function parseFilename(header: string | null): string | null {
  if (!header) return null;

  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Fall through to the plain parameter.
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}

function saveBlobFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  saveBlobFile(filename, blob);
}