import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, isApiError } from './api.service';
import { ToastService } from './toast.service';
import { linkInStage, stageForRole, type TradeStage } from '../shared/stage';

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
  /** The sign-in before this one, from the server; null the first time this account signs in. */
  lastLoginAt?: string | null;
  /** The stage of the portal, from the role. Absent for roles outside the three portals (every screen the role allows). */
  stage?: TradeStage;
}

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

  /** The stage this session works in (from the role), or null for every screen the role allows. */
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

  /** `recaptchaToken` is the "I'm not a robot" token, sent when the server asks for one; the server checks it with Google. */
  async login(email: string, password: string, recaptchaToken?: string): Promise<void> {
    await this.signIn(() =>
      firstValueFrom(this.api.post<LoginResponse>('/auth/login', { email: email.trim(), password, ...(recaptchaToken ? { recaptchaToken } : {}) })),
    );
  }

  private async signIn(request: () => Promise<LoginResponse>): Promise<void> {
    if (this.signingIn()) return;
    this.signingIn.set(true);
    this.loginError.set(null);
    try {
      const response = await request();
      // The portal a person works in follows from their role: the client and the pre-shipment officer work pre-shipment, the post-shipment officer post-shipment.
      const stage = stageForRole(response.user.role);
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
    const wanted = this.pendingReturnUrl(session.stage);
    if (!wanted) {
      void this.router.navigate([this.homeRoute()]);
      return;
    }
    // Go where the visitor was heading; if this role may not open it, the guard sends them to the access-denied
    // page, which is no place to start: fall back to their workspace instead.
    void this.router.navigateByUrl(wanted).then(() => {
      if (this.router.url.startsWith('/access-denied')) void this.router.navigate([this.homeRoute()]);
    });
  }

  /**
   * The page a visitor asked for before being asked to sign in: the route guard records it as `?returnUrl=`.
   * Only an in-app path is honoured (never another site), and only one this session's stage shows.
   */
  private pendingReturnUrl(stage?: TradeStage): string | null {
    const raw = this.router.parseUrl(this.router.url).queryParams['returnUrl'];
    if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
    const firstSegment = raw.split(/[?#]/)[0]!.split('/')[1] ?? '';
    if (!firstSegment) return null;
    return linkInStage('/' + firstSegment, stage) ? raw : null;
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
