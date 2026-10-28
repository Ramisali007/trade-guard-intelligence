import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiService } from './api.service';
import type { PctDatasetView, SourceHealthView, VerificationOverview, VerificationRuleView } from '../models/verification.models';

/** Calls for verification governance. The API decides who may propose or approve; nothing here does. */
@Injectable({ providedIn: 'root' })
export class VerificationService {
  private readonly api = inject(ApiService);

  overview(): Observable<VerificationOverview> {
    return this.api.get('/verification/overview');
  }

  propose(ruleId: string, rationale: string): Observable<{ rules: VerificationRuleView[] }> {
    return this.api.post(`/verification/rules/${ruleId}/propose`, { rationale });
  }

  decide(ruleId: string, approve: boolean, rationale: string): Observable<{ rules: VerificationRuleView[] }> {
    return this.api.post(`/verification/rules/${ruleId}/decision`, { approve, rationale });
  }

  revoke(ruleId: string, rationale: string): Observable<{ rules: VerificationRuleView[] }> {
    return this.api.post(`/verification/rules/${ruleId}/revoke`, { rationale });
  }

  datasets(): Observable<{ datasets: PctDatasetView[]; health: SourceHealthView }> {
    return this.api.get('/verification/reference/pct');
  }

  submitDataset(form: FormData): Observable<{ dataset: PctDatasetView }> {
    return this.api.upload('/verification/reference/pct', form);
  }

  decideDataset(datasetId: string, approve: boolean, rationale: string): Observable<{ dataset: PctDatasetView }> {
    return this.api.post(`/verification/reference/pct/${datasetId}/decision`, { approve, rationale });
  }

  retireDataset(datasetId: string, rationale: string): Observable<{ dataset: PctDatasetView }> {
    return this.api.post(`/verification/reference/pct/${datasetId}/retire`, { rationale });
  }
}
