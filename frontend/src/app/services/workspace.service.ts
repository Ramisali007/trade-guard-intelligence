import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface WorkspaceSection {
  id: string;
  title: string;
  route: string;
  description: string;
}

export interface WorkspaceQueue {
  id: string;
  title: string;
  description: string;
  count: number;
  items: Array<{ caseId: string; status: string; customerRef: string; updatedAt: string }>;
}

export interface Workspace {
  user: { id: string; name: string; email: string; institution: string; customerRef: string | null };
  role: { id: string; displayName: string; description: string; dataScope: string };
  permissions: string[];
  sections: WorkspaceSection[];
  queues: WorkspaceQueue[];
}

export interface AccountSummary {
  id: string;
  email: string;
  name: string;
  institution: string;
  role: string | null;
  roleDisplayName: string | null;
  customerRef: string | null;
  assignedCustomerRefs: string[];
  source: 'DEMO' | 'CONFIG' | 'MANAGED';
  status: 'ACTIVE' | 'DISABLED';
  sessionVersion: number;
  createdAt: string;
}

export interface AccessRequest {
  requestId: string;
  targetUserId: string;
  change: { role?: string | null; assignedCustomerRefs?: string[]; customerRef?: string | null };
  reason: string;
  requestedBy: { id: string; name: string };
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  rationale: string;
}

export interface RbacMatrix {
  permissions: Record<string, string>;
  roles: Array<{ id: string; displayName: string; description: string; dataScope: string; assignable: boolean; permissions: string[] }>;
}

export interface ChainVerdict {
  valid: boolean;
  brokenAtSeq: number | null;
  problem: string | null;
}

/** The signed-in user's portal, administration and the audit explorer. The API decides every one. */
@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  private readonly api = inject(ApiService);

  workspace(stage?: string | null): Observable<Workspace> {
    return this.api.get('/workspace', stage ? { stage } : undefined);
  }

  users(): Observable<{ users: AccountSummary[] }> {
    return this.api.get('/admin/users');
  }

  createUser(body: { email: string; name: string; institution: string }): Observable<{ account: AccountSummary; temporaryPassword: string }> {
    return this.api.post('/admin/users', body);
  }

  setStatus(userId: string, status: 'ACTIVE' | 'DISABLED', reason: string): Observable<{ account: AccountSummary }> {
    return this.api.post(`/admin/users/${encodeURIComponent(userId)}/status`, { status, reason });
  }

  revokeSessions(userId: string, reason: string): Observable<{ account: AccountSummary }> {
    return this.api.post(`/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, { reason });
  }

  accessRequests(): Observable<{ requests: AccessRequest[] }> {
    return this.api.get('/admin/access-requests');
  }

  requestAccess(body: { targetUserId: string; role?: string | null; assignedCustomerRefs?: string[]; customerRef?: string | null; reason: string }): Observable<{ request: AccessRequest }> {
    return this.api.post('/admin/access-requests', body);
  }

  decideAccess(requestId: string, approve: boolean, rationale: string): Observable<{ request: AccessRequest }> {
    return this.api.post(`/admin/access-requests/${requestId}/decision`, { approve, rationale });
  }

  rbac(): Observable<RbacMatrix> {
    return this.api.get('/admin/rbac');
  }

  systemHealth(): Observable<Record<string, any>> {
    return this.api.get('/admin/system-health');
  }

  identityAudit(): Observable<{ events: Array<{ seq: number; at: string; actor: { id: string; name: string }; action: string; targetUserId: string | null; detail: Record<string, unknown> }>; chain: ChainVerdict }> {
    return this.api.get('/admin/identity-audit');
  }

  auditOverview(): Observable<{ cases: Array<{ caseId: string; status: string; customerRef: string; events: number; chain: ChainVerdict; updatedAt: string }> }> {
    return this.api.get('/trade-cases/audit-overview');
  }
}
