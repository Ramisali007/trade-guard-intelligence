import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { Icon } from './icon';

@Component({
  selector: 'app-login-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon],
  template: `
    @if (auth.loginModalOpen()) {
      <div class="login-backdrop" (click)="onBackdropClick($event)">
        <div class="login-dialog" role="dialog" aria-modal="true" aria-labelledby="login-title">
          <!-- Ambient Glow Orb -->
          <div class="login-ambient-glow" aria-hidden="true"></div>

          <!-- Close Button -->
          <button
            type="button"
            class="login-close-btn"
            (click)="auth.closeLoginModal()"
            aria-label="Close dialog"
            title="Close dialog"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <!-- Brand Header -->
          <div class="login-header">
            <div class="brand-badge-glow">
              <div class="brand-badge">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <polygon points="3,3 21,3 12,21" fill="#00d4d4" opacity="0.95"></polygon>
                  <polygon points="3,3 12,21 3,21" fill="#008080"></polygon>
                </svg>
              </div>
            </div>
            <h2 id="login-title" class="login-title">
              Sign in to <span class="brand-name">TradeGuard</span><span class="tg-ai">®</span>
            </h2>
            <div class="login-security-tag">
              <span class="security-pulse-dot"></span>
              <span class="login-subtitle">Bank-Grade Trade Finance Compliance &amp; TBML Intelligence</span>
            </div>
          </div>

          <!-- Tab Selection (Sleek Glass Switcher) -->
          <div class="login-tabs">
            <button
              type="button"
              class="tab-btn"
              [class.active]="activeTab() === 'demo'"
              (click)="activeTab.set('demo')"
            >
              <app-icon name="sparkle" [size]="14" />
              <span>1-Click Demo Profiles</span>
            </button>
            <button
              type="button"
              class="tab-btn"
              [class.active]="activeTab() === 'credentials'"
              (click)="activeTab.set('credentials')"
            >
              <app-icon name="user" [size]="14" />
              <span>Institutional Sign In</span>
            </button>
          </div>

          <!-- Demo Profiles Tab -->
          @if (activeTab() === 'demo') {
            <div class="demo-profiles-container">
              <div class="demo-hint-row">
                <app-icon name="user-check" [size]="13" />
                <span>Select an authorized compliance persona to launch operational workbench:</span>
              </div>

              <div class="demo-cards">
                <!-- Profile 1 -->
                <button
                  type="button"
                  class="demo-card"
                  (click)="loginDemo('compliance_officer')"
                >
                  <div class="demo-card-avatar avatar-hbl">RA</div>
                  <div class="demo-card-info">
                    <div class="demo-name-row">
                      <span class="demo-name">Ramis Ali</span>
                      <span class="demo-badge primary">Primary</span>
                    </div>
                    <span class="demo-role">Chief Compliance Officer</span>
                    <span class="demo-inst">
                      <span class="inst-dot"></span>
                      Habib Bank Limited · International Trade Operations
                    </span>
                  </div>
                  <div class="demo-arrow">
                    <app-icon name="arrowRight" [size]="15" />
                  </div>
                </button>

                <!-- Profile 2 -->
                <button
                  type="button"
                  class="demo-card"
                  (click)="loginDemo('risk_analyst')"
                >
                  <div class="demo-card-avatar avatar-scb">SK</div>
                  <div class="demo-card-info">
                    <div class="demo-name-row">
                      <span class="demo-name">Sara Khan</span>
                      <span class="demo-badge warning">TBML Lead</span>
                    </div>
                    <span class="demo-role">Senior TBML Risk Analyst</span>
                    <span class="demo-inst">
                      <span class="inst-dot"></span>
                      Standard Chartered Bank · Corporate Banking
                    </span>
                  </div>
                  <div class="demo-arrow">
                    <app-icon name="arrowRight" [size]="15" />
                  </div>
                </button>

                <!-- Profile 3 -->
                <button
                  type="button"
                  class="demo-card"
                  (click)="loginDemo('trade_auditor')"
                >
                  <div class="demo-card-avatar avatar-sbp">TM</div>
                  <div class="demo-card-info">
                    <div class="demo-name-row">
                      <span class="demo-name">Tariq Mehmood</span>
                      <span class="demo-badge success">Regulatory</span>
                    </div>
                    <span class="demo-role">Regulatory Inspection Lead</span>
                    <span class="demo-inst">
                      <span class="inst-dot"></span>
                      State Bank of Pakistan · BPRD Division
                    </span>
                  </div>
                  <div class="demo-arrow">
                    <app-icon name="arrowRight" [size]="15" />
                  </div>
                </button>
              </div>
            </div>
          }

          <!-- Institutional Credentials Form -->
          @if (activeTab() === 'credentials') {
            <form class="login-form" (ngSubmit)="onFormSubmit($event)">
              <div class="form-group">
                <label for="login-email" class="form-label">Institutional Email</label>
                <div class="input-wrapper">
                  <input
                    id="login-email"
                    type="email"
                    class="form-input"
                    placeholder="compliance.officer@bank.com"
                    [(ngModel)]="email"
                    name="email"
                    required
                  />
                </div>
              </div>

              <div class="form-group">
                <label for="login-password" class="form-label">Password / Security Key</label>
                <div class="input-wrapper">
                  <input
                    id="login-password"
                    type="password"
                    class="form-input"
                    placeholder="••••••••••••"
                    [(ngModel)]="password"
                    name="password"
                    required
                  />
                </div>
              </div>

              <div class="form-group">
                <label for="login-role" class="form-label">Compliance Desk Role</label>
                <select
                  id="login-role"
                  class="form-select"
                  [(ngModel)]="selectedRole"
                  name="selectedRole"
                >
                  <option value="Chief Compliance Officer">Chief Compliance Officer</option>
                  <option value="Senior Trade Finance Auditor">Senior Trade Finance Auditor</option>
                  <option value="TBML Investigation Specialist">TBML Investigation Specialist</option>
                  <option value="Operations Desk Manager">Operations Desk Manager</option>
                </select>
              </div>

              <button type="submit" class="login-submit-btn">
                <span>Authenticate &amp; Open Workbench</span>
                <app-icon name="arrowRight" [size]="16" />
              </button>
            </form>
          }

          <!-- Security Badge Footer -->
          <div class="login-footer">
            <div class="security-chip">
              <app-icon name="shield-check" [size]="14" />
              <span>SOC2 Type II · 256-bit TLS · SBP BPRD Compliant</span>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .login-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(3, 7, 24, 0.86);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      z-index: 1200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      animation: backdrop-in 0.22s ease-out both;
    }

    @keyframes backdrop-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .login-dialog {
      position: relative;
      width: 100%;
      max-width: 530px;
      background: linear-gradient(165deg, rgba(12, 22, 54, 0.97) 0%, rgba(5, 11, 32, 0.98) 100%);
      border: 1px solid rgba(0, 212, 212, 0.35);
      border-radius: 26px;
      padding: 32px 36px 28px;
      box-shadow: 0 32px 90px rgba(0, 0, 0, 0.85),
                  0 0 45px rgba(0, 212, 212, 0.2),
                  inset 0 1px 1px rgba(255, 255, 255, 0.15);
      overflow: hidden;
      animation: dialog-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .login-ambient-glow {
      position: absolute;
      top: -70px;
      left: 50%;
      transform: translateX(-50%);
      width: 360px;
      height: 160px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(0, 212, 212, 0.28) 0%, transparent 70%);
      filter: blur(35px);
      pointer-events: none;
      z-index: 1;
    }

    @keyframes dialog-in {
      from {
        opacity: 0;
        transform: scale(0.95) translateY(12px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    .login-close-btn {
      position: absolute;
      top: 20px;
      right: 20px;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.06);
      color: #94a3b8;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 5;
      transition: all 0.2s ease;

      &:hover {
        background: rgba(239, 68, 68, 0.2);
        border-color: rgba(239, 68, 68, 0.45);
        color: #ef4444;
        transform: rotate(90deg);
      }
    }

    .login-header {
      position: relative;
      z-index: 2;
      text-align: center;
      margin-bottom: 24px;
    }

    .brand-badge-glow {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
      border-radius: 18px;
      background: rgba(0, 212, 212, 0.08);
      border: 1px solid rgba(0, 212, 212, 0.25);
      box-shadow: 0 0 20px rgba(0, 212, 212, 0.25);
      margin-bottom: 14px;
    }

    .brand-badge {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      background: linear-gradient(135deg, #060e28 0%, #0d1e48 100%);
      border: 1px solid rgba(0, 212, 212, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .login-title {
      font-size: 1.55rem;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.025em;
      margin: 0 0 6px 0;
      line-height: 1.2;

      .brand-name {
        color: #ffffff;
      }

      .tg-ai {
        color: #00d4d4;
      }
    }

    .login-security-tag {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 0.8rem;
      color: #94a3b8;
      max-width: 44ch;
      margin: 0 auto;
    }

    .security-pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      flex-shrink: 0;
    }

    /* Tabs (High-Tech Floating Switcher) */
    .login-tabs {
      position: relative;
      z-index: 2;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      background: rgba(4, 9, 26, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.09);
      padding: 5px;
      border-radius: 999px;
      margin-bottom: 22px;
      box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.3);
    }

    .tab-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 16px;
      border-radius: 999px;
      border: 1px solid transparent;
      background: transparent;
      color: #94a3b8;
      font-size: 0.84rem;
      font-weight: 650;
      cursor: pointer;
      transition: all 0.22s ease;

      &:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.05);
      }

      &.active {
        background: linear-gradient(135deg, rgba(0, 212, 212, 0.22) 0%, rgba(0, 168, 168, 0.15) 100%);
        color: #00d4d4;
        border-color: rgba(0, 212, 212, 0.45);
        box-shadow: 0 4px 14px rgba(0, 212, 212, 0.25);
        font-weight: 750;
      }
    }

    /* Demo Profiles */
    .demo-profiles-container {
      position: relative;
      z-index: 2;
    }

    .demo-hint-row {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 0.78rem;
      color: #cbd5e1;
      margin-bottom: 14px;
      line-height: 1.4;

      app-icon {
        color: #00d4d4;
        flex-shrink: 0;
      }
    }

    .demo-cards {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 22px;
    }

    .demo-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 18px;
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      cursor: pointer;
      text-align: left;
      transition: all 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
      position: relative;
      overflow: hidden;

      &:hover {
        background: linear-gradient(90deg, rgba(0, 212, 212, 0.1) 0%, rgba(7, 16, 46, 0.85) 100%);
        border-color: rgba(0, 212, 212, 0.45);
        transform: translateY(-2px);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 212, 212, 0.2);

        .demo-arrow {
          transform: translateX(4px);
          color: #00d4d4;
          background: rgba(0, 212, 212, 0.18);
          border-color: rgba(0, 212, 212, 0.4);
        }
      }
    }

    .demo-card-avatar {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.95rem;
      font-weight: 850;
      flex-shrink: 0;
      letter-spacing: -0.02em;
    }

    .avatar-hbl {
      background: linear-gradient(135deg, #00d4d4 0%, #008080 100%);
      color: #050c26;
      border: 1px solid rgba(0, 212, 212, 0.45);
      box-shadow: 0 0 12px rgba(0, 212, 212, 0.35);
    }

    .avatar-scb {
      background: linear-gradient(135deg, #38bdf8 0%, #2563eb 100%);
      color: #ffffff;
      border: 1px solid rgba(56, 189, 248, 0.45);
      box-shadow: 0 0 12px rgba(37, 99, 235, 0.35);
    }

    .avatar-sbp {
      background: linear-gradient(135deg, #34d399 0%, #059669 100%);
      color: #ffffff;
      border: 1px solid rgba(52, 211, 153, 0.45);
      box-shadow: 0 0 12px rgba(5, 150, 105, 0.35);
    }

    .demo-card-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .demo-name-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .demo-name {
      font-size: 0.96rem;
      font-weight: 750;
      color: #ffffff;
      letter-spacing: -0.01em;
    }

    .demo-badge {
      font-size: 0.64rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 2px 8px;
      border-radius: 999px;

      &.primary {
        background: rgba(0, 212, 212, 0.16);
        color: #00d4d4;
        border: 1px solid rgba(0, 212, 212, 0.38);
        box-shadow: 0 0 10px rgba(0, 212, 212, 0.2);
      }
      &.warning {
        background: rgba(245, 158, 11, 0.16);
        color: #fbbf24;
        border: 1px solid rgba(245, 158, 11, 0.38);
        box-shadow: 0 0 10px rgba(245, 158, 11, 0.2);
      }
      &.success {
        background: rgba(16, 185, 129, 0.16);
        color: #34d399;
        border: 1px solid rgba(16, 185, 129, 0.38);
        box-shadow: 0 0 10px rgba(16, 185, 129, 0.2);
      }
    }

    .demo-role {
      font-size: 0.81rem;
      font-weight: 600;
      color: #cbd5e1;
    }

    .demo-inst {
      font-size: 0.72rem;
      color: #94a3b8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .inst-dot {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #00d4d4;
      flex-shrink: 0;
    }

    .demo-arrow {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      transition: all 0.22s ease;
      flex-shrink: 0;
    }

    /* Form Styles */
    .login-form {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-bottom: 22px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .form-label {
      font-size: 0.78rem;
      font-weight: 650;
      color: #cbd5e1;
      letter-spacing: 0.02em;
    }

    .form-input,
    .form-select {
      width: 100%;
      padding: 12px 16px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(4, 9, 26, 0.85);
      color: #ffffff;
      font-size: 0.9rem;
      transition: all 0.2s ease;

      &:focus {
        border-color: #00d4d4;
        outline: none;
        box-shadow: 0 0 0 3px rgba(0, 212, 212, 0.22);
      }
    }

    .login-submit-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      padding: 13px 22px;
      background: linear-gradient(135deg, #00d4d4 0%, #00a8a8 100%);
      color: #050c26;
      border: none;
      border-radius: 999px;
      font-size: 0.95rem;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0, 212, 212, 0.45);
      transition: all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
      margin-top: 6px;

      &:hover {
        background: linear-gradient(135deg, #2ee5b8 0%, #00d4d4 100%);
        transform: translateY(-2px);
        box-shadow: 0 8px 28px rgba(0, 212, 212, 0.6);
      }
    }

    /* Security Chip Footer */
    .login-footer {
      position: relative;
      z-index: 2;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-top: 18px;
      text-align: center;
    }

    .security-chip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 0.72rem;
      font-weight: 600;
      color: #94a3b8;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      letter-spacing: 0.03em;

      app-icon {
        color: #10b981;
      }
    }
  `,
})
export class LoginModalComponent {
  readonly auth = inject(AuthService);

  readonly activeTab = signal<'demo' | 'credentials'>('demo');

  email = 'ramis.ali@tradeguard.ai';
  password = '••••••••••••';
  selectedRole = 'Chief Compliance Officer';

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.auth.closeLoginModal();
    }
  }

  loginDemo(role: 'compliance_officer' | 'risk_analyst' | 'trade_auditor'): void {
    this.auth.loginAsDemo(role);
  }

  onFormSubmit(event: Event): void {
    event.preventDefault();
    if (!this.email) return;
    this.auth.login(this.email, this.password, this.selectedRole);
  }
}
