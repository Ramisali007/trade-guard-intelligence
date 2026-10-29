import { ChangeDetectionStrategy, Component, ElementRef, NgZone, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { RecaptchaService } from '../../services/recaptcha.service';
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

          <!-- Institutional Credentials Form -->
          <form class="login-form" (ngSubmit)="onFormSubmit($event)">
            <div class="form-group">
              <label for="login-email" class="form-label">Institutional Email</label>
              <div class="input-wrapper">
                <input
                  id="login-email"
                  type="email"
                  class="form-input"
                  placeholder="name@tradeguard.ai"
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
                  [type]="showPassword() ? 'text' : 'password'"
                  class="form-input form-input-with-toggle"
                  placeholder="••••••••••••"
                  autocomplete="current-password"
                  [(ngModel)]="password"
                  name="password"
                  required
                />
                <button
                  type="button"
                  class="password-toggle"
                  (click)="showPassword.set(!showPassword())"
                  [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
                  [attr.aria-pressed]="showPassword()"
                  [title]="showPassword() ? 'Hide password' : 'Show password'"
                >
                  <app-icon [name]="showPassword() ? 'eye-off' : 'eye'" [size]="18" />
                </button>
              </div>
            </div>

            <p class="form-hint">Your role is assigned to your account by the server.</p>

            @if (captcha.siteKey()) {
              <div class="captcha-row">
                <div #captchaBox class="captcha-box" role="group" aria-label="Security check: confirm that you are not a robot"></div>
              </div>
              @if (captchaMessage()) {
                <p class="captcha-message" role="alert">{{ captchaMessage() }}</p>
              }
            }

            <button type="submit" class="login-submit-btn" [disabled]="auth.signingIn()">
              <span>{{ auth.signingIn() ? 'Signing in…' : 'Authenticate &amp; Open Workbench' }}</span>
              <app-icon name="arrowRight" [size]="16" />
            </button>
          </form>

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
        color: #b91c1c;
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

    .input-wrapper {
      position: relative;
    }

    .form-input-with-toggle {
      padding-right: 48px;
    }

    .password-toggle {
      position: absolute;
      top: 50%;
      right: 6px;
      transform: translateY(-50%);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border: none;
      border-radius: 10px;
      background: transparent;
      color: #94a3b8;
      cursor: pointer;
      transition: color 0.2s ease, background 0.2s ease;

      &:hover {
        color: #e2e8f0;
        background: rgba(255, 255, 255, 0.06);
      }

      &:focus-visible {
        outline: none;
        color: #00d4d4;
        box-shadow: 0 0 0 3px rgba(0, 212, 212, 0.35);
      }
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

    .captcha-row {
      display: flex;
      justify-content: center;
      min-height: 78px;
      margin: 2px 0 14px;
    }

    .captcha-message {
      margin: -6px 0 12px;
      text-align: center;
      font-size: 0.82rem;
      color: #f87171;
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
  readonly captcha = inject(RecaptchaService);
  private readonly zone = inject(NgZone);

  /** The element Google's checkbox is drawn into; it exists only while the dialog is open and the check is on. */
  private readonly captchaBox = viewChild<ElementRef<HTMLElement>>('captchaBox');
  /** The token from a passed check; null until the visitor passes, and again after it is used or expires. */
  private readonly captchaToken = signal<string | null>(null);
  readonly captchaMessage = signal<string | null>(null);

  email = '';
  password = '';
  /** Whether the password is shown as text. It is hidden again whenever the dialog closes. */
  readonly showPassword = signal<boolean>(false);

  constructor() {
    void this.captcha.load();
    effect(() => {
      if (!this.auth.loginModalOpen()) this.showPassword.set(false);
    });
    // Each time the dialog opens its checkbox is a new element: draw the widget into it.
    effect(() => {
      const box = this.captchaBox();
      if (!box || !this.captcha.siteKey()) return;
      untracked(() => {
        this.captchaToken.set(null);
        this.captchaMessage.set(null);
        void this.captcha
          .render(
            box.nativeElement,
            (token) => this.zone.run(() => { this.captchaToken.set(token); this.captchaMessage.set(null); }),
            () => this.zone.run(() => this.captchaToken.set(null)),
          )
          .then((drawn) => {
            if (!drawn) this.zone.run(() => this.captchaMessage.set('The security check could not be loaded. Check your connection and reload the page.'));
          });
      });
    });
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.auth.closeLoginModal();
    }
  }

  async onFormSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.email || !this.password) return;
    const needsCheck = this.captcha.siteKey() !== null;
    if (needsCheck && !this.captchaToken()) {
      this.captchaMessage.set('Please confirm that you are not a robot.');
      return;
    }
    await this.auth.login(this.email, this.password, this.captchaToken() ?? undefined);
    // A token works once: after a refused sign-in the visitor passes the check again.
    if (needsCheck && !this.auth.isLoggedIn()) {
      this.captchaToken.set(null);
      this.captcha.reset();
    }
  }
}
