import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiService } from './api.service';
import type { CaseDocument, TradeCaseView } from '../models/trade-case.models';
import type { PostShipmentLc, PostShipmentReview } from '../models/post-shipment.models';

/**
 * Calls for the post-shipment application. The client prepares and submits it; the officer examines it. Every call is
 * re-checked by the API against the signed-in user's role, the case's owner and its state: nothing here decides.
 */
@Injectable({ providedIn: 'root' })
export class PostShipmentService {
  private readonly api = inject(ApiService);

  /** The signed-in customer's approved requests, each with its pre-shipment reference and any application. */
  lcs(): Observable<{ items: PostShipmentLc[] }> {
    return this.api.get('/trade-cases/post-shipment/lcs');
  }

  /** Start the post-shipment application for an approved request, or pick up the draft already started. */
  start(caseId: string): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/post-shipment`, {});
  }

  attach(caseId: string, file: File, documentType: string): Observable<{ tradeCase: TradeCaseView; document: CaseDocument }> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('documentType', documentType);
    return this.api.upload(`/trade-cases/${caseId}/post-shipment/documents`, form);
  }

  remove(caseId: string, linkId: string): Observable<TradeCaseView> {
    return this.api.delete(`/trade-cases/${caseId}/post-shipment/documents/${linkId}`);
  }

  submit(caseId: string): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/post-shipment/submit`, {});
  }

  /** Remove the whole draft application and its documents. One the bank has received cannot be removed. */
  removeDraft(caseId: string): Observable<TradeCaseView> {
    return this.api.delete(`/trade-cases/${caseId}/post-shipment`);
  }

  /** The officer's examination screen. */
  review(caseId: string): Observable<PostShipmentReview> {
    return this.api.get(`/trade-cases/${caseId}/post-shipment/review`);
  }

  examine(caseId: string): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/presentations/examine`, {});
  }

  /** The AI-assisted reading of the presented documents: advice with quoted evidence, never a decision. */
  aiReview(caseId: string): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/post-shipment/ai-review`, {});
  }

  decide(caseId: string, decision: 'ACCEPT' | 'REFUSE', rationale: string): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/presentations/decision`, { decision, rationale });
  }

  requestClarification(caseId: string, body: { subject?: string; question: string; findingIds: string[] }): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/post-shipment/clarification`, body);
  }

  addFinding(caseId: string, body: { title: string; description: string; severity: string; blocking: boolean; recommendedAction?: string; documentLinkId?: string }): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/post-shipment/findings`, body);
  }

  disposition(caseId: string, findingId: string, code: string, rationale: string): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/findings/${findingId}/disposition`, { code, rationale });
  }

  waive(caseId: string, findingId: string, accept: boolean, note: string): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/findings/${findingId}/applicant-waiver`, { accept, note });
  }

  respond(caseId: string, queryId: string, text: string, documentLinkIds: string[]): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/queries/${queryId}/respond`, { text, documentLinkIds });
  }

  sendCorrections(caseId: string): Observable<TradeCaseView> {
    return this.api.post(`/trade-cases/${caseId}/documents/send`, {});
  }
}
