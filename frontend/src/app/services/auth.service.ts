import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ToastService } from './toast.service';

export interface UserSession {
  id: string;
  name: string;
  email: string;
  role: string;
  institution: string;
  avatar: string;
  token: string;
  loggedAt: string;
}

const STORAGE_KEY = 'tradeguard_session';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly isLoggedIn = signal<boolean>(false);
  readonly currentUser = signal<UserSession | null>(null);
  readonly loginModalOpen = signal<boolean>(false);

  constructor() {
    this.restoreSession();
  }

  private restoreSession(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as UserSession;
        if (parsed && parsed.email) {
          this.currentUser.set(parsed);
          this.isLoggedIn.set(true);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  openLoginModal(force = false): void {
    if (!force && this.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
      return;
    }
    this.loginModalOpen.set(true);
  }

  goToWorkbench(): void {
    if (this.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
    } else {
      this.loginModalOpen.set(true);
    }
  }

  closeLoginModal(): void {
    this.loginModalOpen.set(false);
  }


  loginAsDemo(role: 'compliance_officer' | 'risk_analyst' | 'trade_auditor' = 'compliance_officer'): void {
    const profiles: Record<string, UserSession> = {
      compliance_officer: {
        id: 'usr-co-01',
        name: 'Ramis Ali',
        email: 'ramis.ali@tradeguard.ai',
        role: 'Chief Compliance Officer',
        institution: 'Habib Bank Limited · International Trade Ops',
        avatar: 'RA',
        token: 'tg-jwt-token-demo-897321',
        loggedAt: new Date().toISOString(),
      },
      risk_analyst: {
        id: 'usr-ra-02',
        name: 'Sara Khan',
        email: 'sara.khan@tradeguard.ai',
        role: 'Senior TBML Risk Analyst',
        institution: 'Standard Chartered Bank · Middle East & Asia',
        avatar: 'SK',
        token: 'tg-jwt-token-demo-897322',
        loggedAt: new Date().toISOString(),
      },
      trade_auditor: {
        id: 'usr-ta-03',
        name: 'Tariq Mehmood',
        email: 'tariq.mehmood@tradeguard.ai',
        role: 'Regulatory Inspection Lead',
        institution: 'State Bank of Pakistan · BPRD Division',
        avatar: 'TM',
        token: 'tg-jwt-token-demo-897323',
        loggedAt: new Date().toISOString(),
      },
    };

    const session = profiles[role] || profiles['compliance_officer'];
    this.commitLogin(session);
  }

  login(email: string, _password: string, roleName = 'Senior Compliance Officer'): void {
    const cleanEmail = email.trim();
    const initials = cleanEmail
      .split('@')[0]
      .split('.')
      .map((s) => s.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('');

    const session: UserSession = {
      id: 'usr-' + Date.now().toString(36),
      name: cleanEmail.split('@')[0].replace('.', ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
      email: cleanEmail,
      role: roleName,
      institution: 'State Bank of Pakistan Authorized Trade Desk',
      avatar: initials || 'TG',
      token: 'tg-jwt-' + Math.random().toString(36).substring(2),
      loggedAt: new Date().toISOString(),
    };

    this.commitLogin(session);
  }

  private commitLogin(session: UserSession): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Ignored if storage is blocked
    }

    this.currentUser.set(session);
    this.isLoggedIn.set(true);
    this.closeLoginModal();

    this.toast.success(
      'Authenticated Successfully',
      `Welcome back, ${session.name} (${session.role})`
    );

    // Route to authenticated workbench
    this.router.navigate(['/dashboard']);
  }

  logout(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignored
    }

    this.currentUser.set(null);
    this.isLoggedIn.set(false);

    this.toast.info('Signed Out', 'You have been safely disconnected from TradeGuard.');
    this.router.navigate(['/']);
  }

  isChiefComplianceOfficer(): boolean {
    const role = (this.currentUser()?.role || '').toUpperCase();
    return role.includes('CHIEF') || role.includes('DIRECTOR') || role.includes('ADMIN');
  }

  isTbmlRiskAnalyst(): boolean {
    const role = (this.currentUser()?.role || '').toUpperCase();
    return role.includes('ANALYST') || role.includes('TBML') || role.includes('RISK') || this.isChiefComplianceOfficer();
  }

  isTradeAuditor(): boolean {
    const role = (this.currentUser()?.role || '').toUpperCase();
    return role.includes('AUDITOR') || role.includes('INSPECTION') || role.includes('REGULAT') || this.isChiefComplianceOfficer();
  }

  canOverrideDecisions(): boolean {
    return this.isChiefComplianceOfficer() || this.isTbmlRiskAnalyst();
  }

  canDeleteHistory(): boolean {
    return this.isChiefComplianceOfficer();
  }
}
