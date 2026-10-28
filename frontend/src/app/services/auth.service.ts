import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, isApiError } from './api.service';
import { ToastService } from './toast.service';
import type { TradeStage } from '../shared/stage';

export interface UserSession {
  id: string;
  name: string;
  email: string;
  /** Canonical role from the server, e.g. CHIEF_COMPLIANCE_OFFICER. */
  role: string;
  institution: string;
  /** Set for corporate-customer logins: the customer whose trade cases they see. */
  customerRef?: string;
  /** Relationship managers: the customers assigned to them. */
  assignedCustomerRefs?: string[];
  /** From the server's permission registry; the API enforces the same list on every call. */
  permissions?: string[];
  roleDisplayName?: string;
  /** OWN_CUSTOMER | ASSIGNED_CUSTOMERS | INSTITUTION | NONE */
  dataScope?: string;
  avatar: string;
  token: string;
  loggedAt: string;
  /** The stage chosen on the demo sign-in; absent for an institutional sign-in (every screen the role allows). */
  stage?: TradeStage;
}

export type DemoAccountKey =
  | 'compliance_officer'
  | 'risk_analyst'
  | 'trade_auditor'
  | 'corporate_customer'
  | 'corporate_customer_2'
  | 'relationship_manager'
  | 'trade_maker'
  | 'trade_checker'
  | 'credit_reviewer'
  | 'senior_approver'
  | 'lc_issuer'
  | 'settlement_officer'
  | 'post_trade_officer'
  | 'operations_desk'
  | 'compliance_reviewer'
  | 'system_admin'
  | 'security_admin';

interface LoginResponse {
  success: boolean;
  token: string;
  user: Omit<UserSession, 'token' | 'loggedAt'>;
}

const STORAGE_KEY = 'tradeguard_session';

/** A workstation left unattended must not stay signed in: banking screens lock after this long idle. */
const IDLE_LIMIT_MS = 15 * 60_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

const ROLE_LABELS: Record<string, string> = {
  CHIEF_COMPLIANCE_OFFICER: 'Chief Compliance Officer',
  TBML_RISK_ANALYST: 'TBML Risk Analyst',
  TRADE_AUDITOR: 'Trade Auditor',
  OPERATIONS_DESK: 'Operations Desk',
  CORPORATE_CUSTOMER: 'Corporate Customer',
  RELATIONSHIP_MANAGER: 'Relationship Manager',
  TRADE_MAKER: 'Trade Operations (Maker)',
  TRADE_CHECKER: 'Trade Operations (Checker)',
  CREDIT_REVIEWER: 'Credit Reviewer',
  COMPLIANCE_REVIEWER: 'Compliance Reviewer',
  SENIOR_APPROVER: 'Senior Approver',
  LC_ISSUER: 'LC Issuance Officer',
  SETTLEMENT_OFFICER: 'Settlement Officer',
  POST_TRADE_OFFICER: 'Trade Operations Officer (all desks)',
  PLATFORM_ADMIN: 'System Administrator',
};

/**
 * Session state for the workbench.
 *
 * Sign-in always goes through the API: the server checks the password (or the demo-account
 * switch) and returns a signed token whose role it decided. The browser only stores that token and
 * shows the profile; permission checks here are for hiding buttons, the API enforces them.
 */
@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);
  private readonly zone = inject(NgZone);
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivity = Date.now();
  private readonly onActivity = (): void => {
    this.lastActivity = Date.now();
  };

  readonly isLoggedIn = signal<boolean>(false);
  readonly currentUser = signal<UserSession | null>(null);
  readonly loginModalOpen = signal<boolean>(false);
  readonly signingIn = signal<boolean>(false);
  readonly loginError = signal<string | null>(null);

  constructor() {
    this.restoreSession();
    if (this.isLoggedIn()) {
      void this.refreshProfile();
      this.startIdleWatch();
    }
  }

  /** Sign the user out after `IDLE_LIMIT_MS` without a click, key press, scroll or touch. */
  private startIdleWatch(): void {
    this.stopIdleWatch();
    this.lastActivity = Date.now();
    // Outside Angular's zone: activity listeners must not trigger change detection on every event.
    this.zone.runOutsideAngular(() => {
      for (const name of ACTIVITY_EVENTS) window.addEventListener(name, this.onActivity, { passive: true });
      const check = (): void => {
        const idleFor = Date.now() - this.lastActivity;
        if (idleFor >= IDLE_LIMIT_MS) {
          this.zone.run(() => {
            this.toast.warning('Signed out', 'You were signed out after 15 minutes without activity.');
            this.logout(true);
            this.openLoginModal(true);
          });
          return;
        }
        this.idleTimer = setTimeout(check, Math.max(5_000, IDLE_LIMIT_MS - idleFor));
      };
      this.idleTimer = setTimeout(check, IDLE_LIMIT_MS);
    });
  }

  private stopIdleWatch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, this.onActivity);
  }

  /**
   * Re-read role and permissions from the server. A role change, revocation or disabled account
   * shows up here as a 401, and the API client then signs the browser out.
   */
  async refreshProfile(): Promise<void> {
    try {
      const me = await firstValueFrom(this.api.get<{ user: Partial<UserSession> }>('/auth/me'));
      const current = this.currentUser();
      if (!current || !me?.user) return;
      const next: UserSession = {
        ...current,
        role: me.user.role ?? current.role,
        permissions: me.user.permissions ?? [],
        roleDisplayName: me.user.roleDisplayName,
        dataScope: me.user.dataScope,
        customerRef: me.user.customerRef,
        assignedCustomerRefs: me.user.assignedCustomerRefs,
      };
      this.currentUser.set(next);
      this.persist(next);
    } catch {
      // A 401 is handled by the API interceptor; anything else leaves the cached profile in place.
    }
  }

  /** The stage this session was opened for (demo sign-in), or null for every screen the role allows. */
  stage(): TradeStage | null {
    return this.currentUser()?.stage ?? null;
  }

  /** Whether the signed-in user holds this permission. Hides UI only; the API is the control. */
  can(permission: string): boolean {
    return this.currentUser()?.permissions?.includes(permission) ?? false;
  }

  canAny(...permissions: string[]): boolean {
    return permissions.some((p) => this.can(p));
  }

  private persist(session: UserSession): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Ignored if storage is blocked; the session lasts for this tab.
    }
  }

  private restoreSession(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as UserSession;
      // Sessions saved by older builds carried client-made tokens the API no longer accepts.
      if (!parsed?.email || !parsed.token || parsed.token.startsWith('tg-') || this.isTokenExpired(parsed.token)) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      this.currentUser.set(parsed);
      this.isLoggedIn.set(true);
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Storage unavailable.
      }
    }
  }

  isTokenExpired(token?: string): boolean {
    const rawToken = token || this.currentUser()?.token;
    if (!rawToken) return true;
    try {
      const parts = rawToken.split('.');
      if (parts.length !== 3) return true;
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64)) as { exp?: number };
      return typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000);
    } catch {
      return true;
    }
  }

  roleLabel(role?: string): string {
    if (!role && this.currentUser()?.roleDisplayName) return this.currentUser()!.roleDisplayName!;
    const key = role ?? this.currentUser()?.role ?? '';
    return ROLE_LABELS[key] ?? key.replace(/_/g, ' ');
  }

  /** Every signed-in user lands on their own workspace: their queues and the screens their role allows. */
  homeRoute(): string {
    return '/workspace';
  }

  /** The customer projection: own cases only, no internal findings. */
  isCustomer(): boolean {
    const user = this.currentUser();
    return user?.dataScope ? user.dataScope === 'OWN_CUSTOMER' : user?.role === 'CORPORATE_CUSTOMER';
  }

  openLoginModal(force = false): void {
    if (!force && this.isLoggedIn()) {
      this.router.navigate([this.homeRoute()]);
      return;
    }
    this.loginError.set(null);
    this.loginModalOpen.set(true);
  }

  goToWorkbench(): void {
    if (this.isLoggedIn()) {
      this.router.navigate([this.homeRoute()]);
    } else {
      this.openLoginModal();
    }
  }

  closeLoginModal(): void {
    this.loginModalOpen.set(false);
  }

  /** One-click sign-in as a demo officer (only available when the server enables demo login). */
  async loginAsDemo(account: DemoAccountKey = 'compliance_officer', stage?: TradeStage): Promise<void> {
    await this.signIn(() => firstValueFrom(this.api.post<LoginResponse>('/auth/demo-login', { account })), stage);
  }

  async login(email: string, password: string): Promise<void> {
    await this.signIn(() =>
      firstValueFrom(this.api.post<LoginResponse>('/auth/login', { email: email.trim(), password })),
    );
  }

  private async signIn(request: () => Promise<LoginResponse>, stage?: TradeStage): Promise<void> {
    if (this.signingIn()) return;
    this.signingIn.set(true);
    this.loginError.set(null);
    try {
      const response = await request();
      this.commitLogin({ ...response.user, token: response.token, loggedAt: new Date().toISOString(), ...(stage ? { stage } : {}) });
    } catch (error) {
      this.loginError.set(
        isApiError(error) ? error.message : 'Sign-in failed. Check that the TradeGuard API is running and try again.',
      );
    } finally {
      this.signingIn.set(false);
    }
  }

  private commitLogin(session: UserSession): void {
    this.persist(session);

    this.currentUser.set(session);
    this.isLoggedIn.set(true);
    this.startIdleWatch();
    this.closeLoginModal();
    this.toast.success('Signed in', `Welcome, ${session.name} (${this.roleLabel(session.role)})`);
    this.router.navigate([this.homeRoute()]);
  }

  /** Clear the session. `silent` skips the toast and navigation (used when the API rejects a token). */
  logout(silent = false): void {
    // Tell the server first (subscribing attaches the token), so the token is dead everywhere and not
    // only forgotten by this browser. A failure here changes nothing for the user.
    if (this.currentUser()?.token) this.api.post('/auth/logout').subscribe({ error: () => undefined });
    this.stopIdleWatch();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignored
    }

    this.currentUser.set(null);
    this.isLoggedIn.set(false);

    if (!silent) {
      this.toast.info('Signed Out', 'You have been safely disconnected from TradeGuard.');
      this.router.navigate(['/']);
    }
  }

  /** Document-level override of a compliance decision (documents.override). */
  canOverrideDecisions(): boolean {
    return this.can('documents.override');
  }

  /** Archiving / restoring document history (documents.delete). */
  canDeleteHistory(): boolean {
    return this.can('documents.delete');
  }

  /** Feed sync and master-data writes. */
  canManageSources(): boolean {
    return this.canAny('compliance.sources.sync', 'masterdata.write');
  }
}
