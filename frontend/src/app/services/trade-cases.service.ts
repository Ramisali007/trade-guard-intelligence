import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { API_BASE, ApiService } from './api.service';
import { isPdfName } from '../shared/format';
import type {
  CaseDocument,
  ComposedMail,
  Department,
  LcApplicationData,
  ScrutinyReport,
  HostPayloadView,
  TradeCaseAuditEvent,
  TradeCaseDashboard,
  TradeCaseListItem,
  TradeCaseView,
} from '../models/trade-case.models';

/** Calls for the import LC lifecycle. Every action is re-checked by the API; nothing here decides. */
@Injectable({ providedIn: 'root' })
export class TradeCasesService {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);

  /** `stage`: the demo portal the user signed in for; post-shipment lists only approved requests and what follows. */
  list(status?: string, stage?: string | null): Observable<{ items: TradeCaseListItem[]; total: number }> {
    return this.api.get('/trade-cases', { ...(status ? { status } : {}), ...(stage ? { stage } : {}) });
  }

  /** The customer sends the documents they added after the request went to the bank. */
  sendDocuments(caseId: string): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/documents/send`, {});
  }

  /** Hide this user's approved cases from their own list and counts. Nothing is deleted. */
  /** Show again what this user cleared, for a period (ISO times; both optional, none means all). */
  recoverHistory(range: { from?: string; to?: string }): Observable<{ recovered: string[]; stillCleared: number }> {
    return this.api.post('/trade-cases/recover-history', range);
  }

  clearHistory(): Observable<{ cleared: string[]; stillShown: number }> {
    return this.api.post('/trade-cases/clear-history', {});
  }

  dashboard(stage?: string | null): Observable<TradeCaseDashboard> {
    return this.api.get('/trade-cases/dashboard', stage ? { stage } : undefined);
  }

  get(caseId: string): Observable<TradeCaseView> {
    return this.api.get(`/trade-cases/${caseId}`);
  }

  /** The pre-shipment scrutiny report: rules, missing information, screening and findings. Bank staff only. */
  scrutiny(caseId: string): Observable<ScrutinyReport> {
    return this.api.get(`/trade-cases/${caseId}/scrutiny`);
  }

  audit(caseId: string): Observable<{ events: TradeCaseAuditEvent[]; chain: { valid: boolean; brokenAtSeq: number | null } }> {
    return this.api.get(`/trade-cases/${caseId}/audit`);
  }

  create(body: { clientRequestId: string; customerRef?: string; application: Partial<LcApplicationData> }): Observable<TradeCaseView> {
    return this.api.post('/trade-cases', body);
  }

  updateApplication(caseId: string, changes: Partial<LcApplicationData>, reason: string): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/application`, { changes, reason });
  }

  /** The trade desk's one-step approval, once its scrutiny leaves nothing blocking. */
  approvePreShipment(caseId: string, rationale: string): Observable<TradeCaseView> {
    return this.action(caseId, 'approval/preshipment', { rationale });
  }

  /** A draft message to the customer listing the issues they can act on; the desk edits and sends it. */
  composeMail(caseId: string, findingIds?: string[]): Observable<ComposedMail> {
    return this.api.post(`/trade-cases/${caseId}/queries/compose`, findingIds ? { findingIds } : {});
  }

  /** Send the message: one query to the customer, about every listed finding. */
  sendMail(caseId: string, mail: { subject: string; body: string; findingIds: string[] }): Observable<TradeCaseView> {
    return this.action(caseId, 'queries', { department: 'TRADE_OPS', assignee: 'CUSTOMER', subject: mail.subject, question: mail.body, findingIds: mail.findingIds, requiresCorrection: true });
  }

  /** Add a document. With "AUTO" the AI reads it and says what it is; the result carries what it decided. */
  attachDocument(caseId: string, file: File, documentType = 'AUTO'): Observable<{ tradeCase: TradeCaseView; document: CaseDocument }> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('documentType', documentType);
    return this.api.upload(`/trade-cases/${caseId}/documents`, form);
  }

  /** Take a pre-trade document off the case (one attached by mistake). The case keeps the audit record. */
  removeDocument(caseId: string, linkId: string): Observable<TradeCaseView> {
    return this.api.delete(`/trade-cases/${caseId}/documents/${linkId}`);
  }

  /** Change the type of a document the AI took for something else. */
  retypeDocument(caseId: string, linkId: string, documentType: string): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/documents/${linkId}/type`, { documentType });
  }

  /** Bank staff: start the AI scrutiny, one document at a time, of the documents not yet scrutinized. */
  analyzeDocuments(caseId: string): Observable<{ started: number; alreadyDone: number; running: boolean; tradeCase: TradeCaseView }> {
    return this.api.post(`/trade-cases/${caseId}/documents/analyze`, {});
  }

  /**
   * What clicking a document's name does: a PDF opens in a new tab, any other file is downloaded to the device.
   * The tab is opened at once, inside the click (a browser refuses a tab opened later, once the file has arrived),
   * and the file is put into it when it comes. If the browser blocks the tab, the PDF is downloaded instead.
   */
  openDocument(caseId: string, linkId: string, filename: string): Observable<void> {
    if (!isPdfName(filename)) return this.downloadDocument(caseId, linkId, filename);
    const tab = window.open('', '_blank');
    if (tab) {
      tab.opener = null;
      tab.document.title = filename;
      tab.document.body.textContent = `Opening ${filename}…`;
    }
    return this.http.get(`${API_BASE}/trade-cases/${caseId}/documents/${linkId}/file`, { responseType: 'blob' }).pipe(
      map((blob) => {
        // Whatever the server called it, the browser must be told it is a PDF to show it rather than save it.
        const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        if (tab && !tab.closed) {
          tab.location.href = url;
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }),
      catchError((err: unknown) => {
        tab?.close();
        return throwError(() => err);
      }),
    );
  }

  downloadDocument(caseId: string, linkId: string, filename: string): Observable<void> {
    return this.http.get(`${API_BASE}/trade-cases/${caseId}/documents/${linkId}/file`, { responseType: 'blob' }).pipe(
      map((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }),
    );
  }

  /** The evidence report of a case (checks against official sources) as a PDF; the download is an audited event. */
  downloadVerificationReport(caseId: string): Observable<string> {
    const filename = `${caseId}-evidence-report.pdf`;
    return this.http.get(`${API_BASE}/trade-cases/${caseId}/verification-report`, { responseType: 'blob' }).pipe(
      map((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return filename;
      }),
    );
  }

  /** The payload handed to the host after the approval: status, link, TI reference, delivery record. */
  hostPayload(caseId: string): Observable<HostPayloadView> {
    return this.api.get(`/trade-cases/${caseId}/host-payload`);
  }

  /** Makes the payload when the approval did not (it failed, or the request was approved before payloads existed). */
  generateHostPayload(caseId: string): Observable<HostPayloadView> {
    return this.api.post(`/trade-cases/${caseId}/host-payload`, {});
  }

  /** Creates the TI reference (once), issues the PDF that carries it and hands the link to the host. */
  sendToHost(caseId: string): Observable<HostPayloadView> {
    return this.api.post(`/trade-cases/${caseId}/host-payload/send`, {});
  }

  /** The stored payload PDF as the signed-in officer; the download is an audited event. */
  downloadHostPayload(caseId: string, filename: string): Observable<string> {
    return this.http.get(`${API_BASE}/trade-cases/${caseId}/host-payload/pdf`, { responseType: 'blob' }).pipe(
      map((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return filename;
      }),
    );
  }

  /** A draft that was never sent to the bank is removed: it leaves every list (the record and its audit trail stay). */
  removeDraft(caseId: string): Observable<TradeCaseView> {
    return this.action(caseId, 'withdraw', { rationale: 'Draft removed before it was sent to the bank' });
  }

  action(caseId: string, path: string, body: Record<string, unknown> = {}): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/${path}`, body);
  }

  review(caseId: string, department: Department, body: Record<string, unknown>): Observable<TradeCaseView> {
    return this.action(caseId, `reviews/${department}`, body);
  }

  recordPresentation(caseId: string, files: Array<{ file: File; type: string }>): Observable<TradeCaseView> {
    const form = new FormData();
    for (const { file } of files) form.append('files', file, file.name);
    form.append('documentTypes', JSON.stringify(files.map((f) => f.type)));
    return this.api.upload(`/trade-cases/${caseId}/presentations`, form);
  }
}
