import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { API_BASE, ApiService } from './api.service';
import type {
  CaseDocument,
  ComposedMail,
  Department,
  LcApplicationData,
  ScrutinyReport,
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

  /** Bank staff: start the AI scrutiny, one document at a time, of the documents not yet scrutinised. */
  analyzeDocuments(caseId: string): Observable<{ started: number; alreadyDone: number; running: boolean; tradeCase: TradeCaseView }> {
    return this.api.post(`/trade-cases/${caseId}/documents/analyze`, {});
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
