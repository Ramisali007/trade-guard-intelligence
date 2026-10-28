import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService, type DemoAccountKey } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { Icon } from './icon';

/**
 * Pre-shipment offers exactly two profiles: the customer, who sends documents, and the bank's trade
 * desk (Trade Operations Maker), who receives them and has them analysed.
 */
const PRE_STAGE_PORTALS: DemoAccountKey[] = ['corporate_customer', 'trade_maker'];

/**
 * Post-shipment offers one profile: an officer who holds every bank-side desk (reviews, approval, issuance,
 * presentations, settlement, amendments, investigations, closure), so no other desk's staff are needed. The other
 * roles still exist in the registry and can sign in through Institutional Sign In.
 */
const POST_STAGE_PORTALS: DemoAccountKey[] = ['post_trade_officer'];

const STAGE_PORTALS: Record<'pre' | 'post', DemoAccountKey[]> = {
  pre: PRE_STAGE_PORTALS,
  post: POST_STAGE_PORTALS,
};

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
              [hidden]="!demoEnabled()"
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

          <!-- Demo Profiles Tab: first the stage, then that stage's portals -->
          @if (activeTab() === 'demo' && demoEnabled()) {
            <div class="demo-profiles-container">
              @if (stage() === null) {
                <div class="demo-hint-row">
                  <app-icon name="layers" [size]="13" />
                  <span>Which stage of the trade do you want to work on?</span>
                </div>
                <div class="stage-cards">
                  <button type="button" class="stage-card" (click)="stage.set('pre')">
                    <span class="stage-title">Pre-shipment / Pre-trade</span>
                    <span class="stage-desc">LC request, document intake, reviews, approval and issuance</span>
                  </button>
                  <button type="button" class="stage-card" (click)="stage.set('post')">
                    <span class="stage-title">Post-shipment / Post-trade</span>
                    <span class="stage-desc">Presented documents, examination, TBML screening, settlement and audit</span>
                  </button>
                </div>
              } @else {
                <div class="stage-head">
                  <button type="button" class="stage-back" (click)="stage.set(null)">
                    <app-icon name="arrowRight" [size]="13" />
                    <span>Back</span>
                  </button>
                  <span class="stage-current">{{ stage() === 'pre' ? 'Pre-shipment / Pre-trade' : 'Post-shipment / Post-trade' }} portals</span>
                </div>
                <div class="desk-grid">
                  @for (a of stageAccounts(); track a.demoKey) {
                    <button type="button" class="desk-btn" (click)="loginDemo(a.demoKey)" [title]="a.institution">
                      <span class="desk-role">{{ auth.roleLabel(a.role) }}</span>
                      <span class="desk-name">{{ a.name }}</span>
                    </button>
                  } @empty {
                    <span class="desk-name">No portals are available for this stage.</span>
                  }
                </div>
              }
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

              <p class="form-hint">Your role is assigned to your account by the server.</p>

              <button type="submit" class="login-submit-btn" [disabled]="auth.signingIn()">
                <span>{{ auth.signingIn() ? 'Signing in…' : 'Authenticate &amp; Open Workbench' }}</span>
                <app-icon name="arrowRight" [size]="16" />
              </button>
            </form>
          }

          @if (auth.loginError()) {
            <div class="login-error" role="alert">{{ auth.loginError() }}</div>
          }

          <!-- Security Footer -->
          <div class="login-footer">
            <div class="security-chip">
              <app-icon name="shield-check" [size]="14" />
              <span>Passwords verified server-side · Signed, expiring session tokens</span>
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
      align-items: flex-start;
      justify-content: center;
      /* Taller than the screen: the backdrop scrolls instead of cropping the top of the dialog. */
      overflow-y: auto;
      overscroll-behavior: contain;
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
      /* margin: auto centres it when it fits and lets it start at the top when it does not. */
      margin: auto;
      flex-shrink: 0;
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

    .desk-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 8px;
      margin-bottom: 22px;
    }

    .desk-btn {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      padding: 9px 12px;
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      color: #ffffff;
      cursor: pointer;
      text-align: left;
      transition: border-color 0.2s ease, background 0.2s ease;

      &:hover,
      &:focus-visible {
        border-color: rgba(0, 212, 212, 0.5);
        background: rgba(0, 168, 168, 0.08);
      }
    }

    .desk-role {
      font-size: 0.8rem;
      font-weight: 700;
      color: #ffffff;
    }

    .desk-name {
      font-size: 0.74rem;
      color: #cbd5e1;
    }

    .stage-cards {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 22px;
    }

    .stage-card {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 16px 18px;
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      color: #ffffff;
      cursor: pointer;
      text-align: left;
      transition: border-color 0.2s ease, background 0.2s ease;

      &:hover,
      &:focus-visible {
        border-color: rgba(0, 212, 212, 0.5);
        background: rgba(0, 168, 168, 0.08);
      }
    }

    .stage-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: #ffffff;
    }

    .stage-desc {
      font-size: 0.78rem;
      color: #cbd5e1;
    }

    .stage-head {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }

    .stage-back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      color: #cbd5e1;
      font-size: 0.76rem;
      cursor: pointer;

      app-icon {
        transform: rotate(180deg);
      }

      &:hover {
        color: #00d4d4;
        border-color: rgba(0, 212, 212, 0.45);
      }
    }

    .stage-current {
      font-size: 0.8rem;
      font-weight: 600;
      color: #cbd5e1;
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

      &:hover:not(:disabled) {
        background: linear-gradient(135deg, #2ee5b8 0%, #00d4d4 100%);
        transform: translateY(-2px);
        box-shadow: 0 8px 28px rgba(0, 212, 212, 0.6);
      }

      &:disabled {
        opacity: 0.65;
        cursor: progress;
      }
    }

    .form-hint {
      margin: 0;
      font-size: 0.78rem;
      color: rgba(226, 232, 240, 0.6);
    }

    .login-error {
      position: relative;
      z-index: 2;
      margin: 0 28px 14px;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid rgba(248, 113, 113, 0.45);
      background: rgba(127, 29, 29, 0.35);
      color: #fecaca;
      font-size: 0.85rem;
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

    @media (max-width: 560px) {
      .login-backdrop {
        padding: 12px;
      }

      .login-dialog {
        padding: 24px 18px 20px;
        border-radius: 20px;
      }

      .desk-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-height: 700px) {
      .login-header {
        margin-bottom: 14px;
      }
    }
  `,
})
export class LoginModalComponent {
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);

  readonly activeTab = signal<'demo' | 'credentials'>('demo');
  /** Whether the server offers one-click demo accounts (off by default in production). */
  readonly demoEnabled = signal<boolean>(true);
  /** Every demo account the server offers. */
  readonly deskAccounts = signal<Array<{ demoKey: DemoAccountKey; name: string; role: string; institution: string }>>([]);
  /** Which stage of the trade the user chose; null until they choose. */
  readonly stage = signal<'pre' | 'post' | null>(null);
  /** The portals of the chosen stage. */
  readonly stageAccounts = computed(() => {
    const stage = this.stage();
    if (!stage) return [];
    // Keep the stage's own order (customer first, then bank).
    const accounts = this.deskAccounts();
    return STAGE_PORTALS[stage]
      .map((key) => accounts.find((a) => a.demoKey === key))
      .filter((a): a is (typeof accounts)[number] => a !== undefined);
  });

  email = '';
  password = '';

  constructor() {
    // Every time the dialog opens, start from the stage question.
    effect(() => {
      if (this.auth.loginModalOpen()) this.stage.set(null);
    });
    this.api.get<{ enabled: boolean; accounts?: Array<{ demoKey: DemoAccountKey; name: string; role: string; institution: string }> }>('/auth/demo-accounts').subscribe({
      next: (res) => {
        this.demoEnabled.set(res.enabled);
        this.deskAccounts.set(res.accounts ?? []);
        if (!res.enabled) this.activeTab.set('credentials');
      },
      error: () => undefined,
    });
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.auth.closeLoginModal();
    }
  }

  loginDemo(account: DemoAccountKey): void {
    // The portal opens for the stage the user chose, so it shows only that stage's screens.
    void this.auth.loginAsDemo(account, this.stage() ?? undefined);
  }

  onFormSubmit(event: Event): void {
    event.preventDefault();
    if (!this.email || !this.password) return;
    void this.auth.login(this.email, this.password);
  }
}
