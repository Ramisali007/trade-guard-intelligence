import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { isApiError } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { WorkspaceService, type AccessRequest, type AccountSummary, type ChainVerdict, type RbacMatrix } from '../../services/workspace.service';

type Tab = 'users' | 'requests' | 'matrix' | 'health' | 'log';

/**
 * Identity and platform administration. Technical authority only: no trade case, document or
 * finding is reachable from here, a role change is a request that a second administrator approves,
 * and nobody can change their own access. Each tab appears only with its permission.
 */
@Component({
  selector: 'app-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="page adm-page">
      <header class="page-head">
        <div>
          <h1>Administration</h1>
          <p class="muted">Accounts, dual-controlled access changes, the permission matrix and platform health. Administrators hold no business authority.</p>
        </div>
      </header>

      <div class="adm-tabs" role="tablist" aria-label="Administration">
        @for (t of tabs(); track t.id) {
          <button type="button" class="tab-btn" role="tab" [class.active]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="open(t.id)">{{ t.label }}</button>
        }
      </div>

      @if (error()) {
        <div class="card card-pad adm-error" role="alert">{{ error() }}</div>
      }

      @switch (tab()) {
        @case ('users') {
          @if (auth.can('admin.users.manage')) {
            <form class="card card-pad adm-form" (ngSubmit)="createUser()">
              <h2>New account</h2>
              <p class="muted">Starts with no role and cannot sign in until an access request for it is approved by a second administrator.</p>
              <div class="adm-fields">
                <label>Email <input class="input" name="email" type="email" required [(ngModel)]="newEmail" /></label>
                <label>Name <input class="input" name="name" required [(ngModel)]="newName" /></label>
                <label>Institution / desk <input class="input" name="institution" [(ngModel)]="newInstitution" /></label>
              </div>
              <button class="btn btn-primary" type="submit" [disabled]="busy()">Create account</button>
              @if (tempPassword()) {
                <p class="adm-temp" role="status">Temporary password (shown once — deliver out of band): <code>{{ tempPassword() }}</code></p>
              }
            </form>
          }
          <div class="card table-wrap">
            <table class="table">
              <thead><tr><th>Account</th><th>Role</th><th>Scope</th><th>Source</th><th>Status</th><th></th></tr></thead>
              <tbody>
                @for (u of users(); track u.id) {
                  <tr>
                    <td><strong>{{ u.name }}</strong><div class="muted adm-sub">{{ u.email }}</div></td>
                    <td>{{ u.roleDisplayName ?? 'No role' }}</td>
                    <td class="muted">{{ u.customerRef ?? (u.assignedCustomerRefs.join(', ') || '—') }}</td>
                    <td><span class="chip">{{ u.source }}</span></td>
                    <td><span class="chip" [class.chip-warning]="u.status === 'DISABLED'">{{ u.status }}</span></td>
                    <td class="adm-actions">
                      @if (auth.can('admin.users.manage') && u.id !== auth.currentUser()?.id) {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="toggleStatus(u)">{{ u.status === 'ACTIVE' ? 'Disable' : 'Enable' }}</button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="revoke(u)">End sessions</button>
                      }
                      @if (auth.can('admin.access.request') && u.source === 'MANAGED' && u.id !== auth.currentUser()?.id) {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="target.set(u)">Request access change</button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (target(); as t) {
            <form class="card card-pad adm-form" (ngSubmit)="requestChange(t)">
              <h2>Access change for {{ t.name }}</h2>
              <div class="adm-fields">
                <label>Role
                  <select class="input" name="role" [(ngModel)]="reqRole">
                    <option value="">(no change)</option>
                    @for (r of assignableRoles(); track r.id) { <option [value]="r.id">{{ r.displayName }}</option> }
                  </select>
                </label>
                <label>Customer reference (customers) <input class="input" name="customerRef" [(ngModel)]="reqCustomerRef" placeholder="TG-CORP-…" /></label>
                <label>Assigned customers (RMs, comma-separated) <input class="input" name="assigned" [(ngModel)]="reqAssigned" /></label>
                <label class="adm-wide">Reason (ticket, approval reference) <input class="input" name="reason" required minlength="10" [(ngModel)]="reqReason" /></label>
              </div>
              <div class="row gap-8">
                <button class="btn btn-primary" type="submit" [disabled]="busy()">Submit for approval</button>
                <button class="btn btn-ghost" type="button" (click)="target.set(null)">Cancel</button>
              </div>
            </form>
          }
        }
        @case ('requests') {
          <div class="card table-wrap">
            <table class="table">
              <thead><tr><th>Request</th><th>Account</th><th>Change</th><th>Requested by</th><th>Status</th><th></th></tr></thead>
              <tbody>
                @for (r of requests(); track r.requestId) {
                  <tr>
                    <td>{{ r.requestId }}<div class="muted adm-sub">{{ r.requestedAt | date: 'medium' }}</div></td>
                    <td>{{ userName(r.targetUserId) }}</td>
                    <td>{{ describe(r) }}<div class="muted adm-sub">{{ r.reason }}</div></td>
                    <td>{{ r.requestedBy.name }}</td>
                    <td><span class="chip">{{ r.status }}</span>@if (r.decidedBy) { <div class="muted adm-sub">{{ r.decidedBy.name }}: {{ r.rationale }}</div> }</td>
                    <td class="adm-actions">
                      @if (r.status === 'PENDING' && auth.can('admin.access.approve')) {
                        @if (r.requestedBy.id === auth.currentUser()?.id) {
                          <span class="muted adm-sub">Needs a second administrator</span>
                        } @else {
                          <button type="button" class="btn btn-primary btn-sm" (click)="decide(r, true)">Approve</button>
                          <button type="button" class="btn btn-ghost btn-sm" (click)="decide(r, false)">Reject</button>
                        }
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="6" class="muted">No access requests.</td></tr>
                }
              </tbody>
            </table>
          </div>
        }
        @case ('matrix') {
          @if (matrix(); as m) {
            <div class="card table-wrap adm-matrix">
              <table class="table">
                <thead>
                  <tr>
                    <th>Permission</th>
                    @for (r of m.roles; track r.id) { <th class="adm-role" [title]="r.description">{{ r.displayName }}</th> }
                  </tr>
                </thead>
                <tbody>
                  @for (p of permissionIds(m); track p) {
                    <tr>
                      <td><code>{{ p }}</code><div class="muted adm-sub">{{ m.permissions[p] }}</div></td>
                      @for (r of m.roles; track r.id) {
                        <td class="adm-cell" [class.adm-yes]="r.permissions.includes(p)">{{ r.permissions.includes(p) ? '●' : '' }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
        @case ('health') {
          @if (health(); as h) {
            <div class="grid grid-3">
              <div class="card card-pad"><span class="muted">Storage</span><strong class="adm-kpi">{{ h['storage']?.driver }}</strong><span class="muted adm-sub">requested {{ h['storage']?.requestedDriver }}</span></div>
              <div class="card card-pad"><span class="muted">AI engine</span><strong class="adm-kpi">{{ h['engine']?.provider }}</strong><span class="muted adm-sub">{{ h['engine']?.model }}</span></div>
              <div class="card card-pad"><span class="muted">Identity log</span><strong class="adm-kpi" [class.adm-bad]="!h['identityChain']?.valid">{{ h['identityChain']?.valid ? 'Verified' : 'BROKEN' }}</strong></div>
              <div class="card card-pad"><span class="muted">Denied requests (since start)</span><strong class="adm-kpi">{{ h['accessDenials']?.total }}</strong></div>
              <div class="card card-pad"><span class="muted">Demo sign-in</span><strong class="adm-kpi">{{ h['demoLoginEnabled'] ? 'ENABLED' : 'off' }}</strong></div>
              <div class="card card-pad"><span class="muted">Environment</span><strong class="adm-kpi">{{ h['environment'] }}</strong></div>
            </div>
            @if (h['accessDenials']?.byRoute?.length) {
              <div class="card table-wrap">
                <table class="table">
                  <thead><tr><th>Most-denied routes</th><th class="num">Count</th></tr></thead>
                  <tbody>
                    @for (d of h['accessDenials'].byRoute; track d.route) { <tr><td><code>{{ d.route }}</code></td><td class="num">{{ d.count }}</td></tr> }
                  </tbody>
                </table>
              </div>
            }
          }
        }
        @case ('log') {
          @if (log(); as l) {
            <div class="card card-pad" [class.adm-bad]="!l.chain.valid">Identity log chain: {{ l.chain.valid ? 'verified' : 'BROKEN at entry ' + l.chain.brokenAtSeq + ' — ' + l.chain.problem }}</div>
            <div class="card table-wrap">
              <table class="table">
                <thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Account</th></tr></thead>
                <tbody>
                  @for (e of l.events; track e.seq) {
                    <tr><td>{{ e.seq }}</td><td>{{ e.at | date: 'medium' }}</td><td>{{ e.actor.name }}</td><td>{{ e.action }}</td><td>{{ e.targetUserId ? userName(e.targetUserId) : '—' }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      .adm-page { padding-top: 96px; display: flex; flex-direction: column; gap: 16px; }
      .adm-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
      .adm-error { border-color: var(--negative); color: var(--negative); }
      .adm-form { display: flex; flex-direction: column; gap: 10px; }
      .adm-form h2 { font-size: 1rem; margin: 0; }
      .adm-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 10px; }
      .adm-fields label { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; }
      .adm-wide { grid-column: 1 / -1; }
      .adm-temp code { user-select: all; }
      .adm-sub { font-size: 0.78rem; }
      .adm-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
      .adm-matrix { overflow-x: auto; }
      .adm-role { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 0.75rem; white-space: nowrap; }
      .adm-cell { text-align: center; color: var(--positive); }
      .adm-kpi { display: block; font-size: 1.3rem; margin-top: 4px; }
      .adm-bad { color: var(--negative); }
    `,
  ],
})
export class AdminComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly service = inject(WorkspaceService);
  private readonly toast = inject(ToastService);

  protected readonly tab = signal<Tab>('users');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly users = signal<AccountSummary[]>([]);
  protected readonly requests = signal<AccessRequest[]>([]);
  protected readonly matrix = signal<RbacMatrix | null>(null);
  protected readonly health = signal<Record<string, any> | null>(null);
  protected readonly log = signal<{ events: Array<{ seq: number; at: string; actor: { id: string; name: string }; action: string; targetUserId: string | null }>; chain: ChainVerdict } | null>(null);
  protected readonly target = signal<AccountSummary | null>(null);
  protected readonly tempPassword = signal<string | null>(null);

  protected newEmail = '';
  protected newName = '';
  protected newInstitution = '';
  protected reqRole = '';
  protected reqCustomerRef = '';
  protected reqAssigned = '';
  protected reqReason = '';

  protected readonly tabs = computed(() => {
    const all: Array<{ id: Tab; label: string; perm: string }> = [
      { id: 'users', label: 'Accounts', perm: 'admin.users.view' },
      { id: 'requests', label: 'Access requests', perm: 'admin.users.view' },
      { id: 'matrix', label: 'Permission matrix', perm: 'admin.rbac.view' },
      { id: 'health', label: 'Platform health', perm: 'system.health.view' },
      { id: 'log', label: 'Identity log', perm: 'admin.users.view' },
    ];
    return all.filter((t) => this.auth.can(t.perm));
  });

  protected readonly assignableRoles = computed(() => this.matrix()?.roles.filter((r) => r.assignable) ?? []);

  ngOnInit(): void {
    const first = this.tabs()[0];
    if (first) this.open(first.id);
    if (this.auth.can('admin.rbac.view')) this.service.rbac().subscribe({ next: (m) => this.matrix.set(m), error: () => undefined });
  }

  protected open(tab: Tab): void {
    this.tab.set(tab);
    this.error.set(null);
    const fail = (e: unknown) => this.error.set(isApiError(e) ? e.message : 'Request failed.');
    if (tab === 'users' || tab === 'requests' || tab === 'log') this.service.users().subscribe({ next: (r) => this.users.set(r.users), error: fail });
    if (tab === 'requests') this.service.accessRequests().subscribe({ next: (r) => this.requests.set(r.requests), error: fail });
    if (tab === 'health') this.service.systemHealth().subscribe({ next: (h) => this.health.set(h), error: fail });
    if (tab === 'log') this.service.identityAudit().subscribe({ next: (l) => this.log.set(l), error: fail });
  }

  protected permissionIds(m: RbacMatrix): string[] {
    return Object.keys(m.permissions);
  }

  protected userName(id: string): string {
    return this.users().find((u) => u.id === id)?.name ?? id;
  }

  protected describe(r: AccessRequest): string {
    const parts: string[] = [];
    if (r.change.role !== undefined) parts.push(`role → ${r.change.role ?? 'none'}`);
    if (r.change.customerRef !== undefined) parts.push(`customer → ${r.change.customerRef ?? 'none'}`);
    if (r.change.assignedCustomerRefs) parts.push(`assigned → ${r.change.assignedCustomerRefs.join(', ') || 'none'}`);
    return parts.join('; ');
  }

  private run<T>(call: () => import('rxjs').Observable<T>, done: (value: T) => void): void {
    this.busy.set(true);
    this.error.set(null);
    call().subscribe({
      next: (v) => {
        this.busy.set(false);
        done(v);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.error.set(isApiError(e) ? e.message : 'Request failed.');
      },
    });
  }

  protected createUser(): void {
    this.run(
      () => this.service.createUser({ email: this.newEmail, name: this.newName, institution: this.newInstitution }),
      (r) => {
        this.tempPassword.set(r.temporaryPassword);
        this.newEmail = this.newName = this.newInstitution = '';
        this.open('users');
      },
    );
  }

  protected requestChange(t: AccountSummary): void {
    const body: Parameters<WorkspaceService['requestAccess']>[0] = { targetUserId: t.id, reason: this.reqReason };
    if (this.reqRole) body.role = this.reqRole;
    if (this.reqCustomerRef.trim()) body.customerRef = this.reqCustomerRef.trim();
    if (this.reqAssigned.trim()) body.assignedCustomerRefs = this.reqAssigned.split(',').map((s) => s.trim()).filter(Boolean);
    this.run(
      () => this.service.requestAccess(body),
      () => {
        this.toast.success('Access request submitted', 'A second administrator must approve it.');
        this.target.set(null);
        this.reqRole = this.reqCustomerRef = this.reqAssigned = this.reqReason = '';
      },
    );
  }

  protected decide(r: AccessRequest, approve: boolean): void {
    const rationale = prompt(approve ? 'Approval rationale (at least 10 characters)' : 'Reason for rejecting (at least 10 characters)');
    if (!rationale) return;
    this.run(() => this.service.decideAccess(r.requestId, approve, rationale), () => this.open('requests'));
  }

  protected toggleStatus(u: AccountSummary): void {
    const reason = prompt(`Reason to ${u.status === 'ACTIVE' ? 'disable' : 'enable'} ${u.email} (at least 10 characters)`);
    if (!reason) return;
    this.run(() => this.service.setStatus(u.id, u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE', reason), () => this.open('users'));
  }

  protected revoke(u: AccountSummary): void {
    const reason = prompt(`Reason to end all sessions of ${u.email} (at least 10 characters)`);
    if (!reason) return;
    this.run(() => this.service.revokeSessions(u.id, reason), () => this.toast.success('Sessions ended', `${u.email} must sign in again.`));
  }
}
