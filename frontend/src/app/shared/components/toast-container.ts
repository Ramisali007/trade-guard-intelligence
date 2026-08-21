import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService, type Toast } from '../../services/toast.service';
import { Icon } from './icon';

@Component({
  selector: 'app-toast-container',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="toast-stack" aria-live="polite" aria-atomic="true">
      @for (t of toastService.toasts(); track t.id) {
        <div class="toast" [class]="'toast-' + t.kind" role="status">
          <div class="toast-indicator"></div>
          <div class="toast-icon">
            @switch (t.kind) {
              @case ('success') {
                <app-icon name="check-circle" [size]="18" />
              }
              @case ('error') {
                <app-icon name="alert" [size]="18" />
              }
              @default {
                <app-icon name="info" [size]="18" />
              }
            }
          </div>
          <div class="toast-content">
            <div class="toast-title">{{ t.title }}</div>
            @if (t.detail) {
              <div class="toast-detail">{{ t.detail }}</div>
            }
            @if (t.requestId) {
              <div class="toast-req mono">Req: {{ t.requestId }}</div>
            }
          </div>
          <button class="toast-close" (click)="toastService.dismiss(t.id)" aria-label="Dismiss">
            <app-icon name="close" [size]="14" />
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .toast-stack {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 1100;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 420px;
      width: calc(100vw - 32px);
      pointer-events: none;
    }

    .toast {
      pointer-events: auto;
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 18px 14px 16px;
      background: var(--glass-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-xl);
      animation: toast-in 280ms var(--ease-spring);
      overflow: hidden;
      transition:
        transform var(--dur-fast) var(--ease),
        opacity var(--dur-fast) var(--ease),
        box-shadow var(--dur-fast) var(--ease);
    }

    .toast:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-glow);
    }

    .toast-indicator {
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      width: 4px;
      background: var(--toast-accent, var(--line-strong));
    }

    .toast-icon {
      flex: none;
      margin-top: 1px;
      color: var(--toast-accent);
      filter: drop-shadow(0 0 8px color-mix(in srgb, var(--toast-accent) 40%, transparent));
    }

    .toast-success {
      --toast-accent: var(--positive);
      border-color: color-mix(in srgb, var(--positive) 25%, var(--glass-border));
    }

    .toast-error {
      --toast-accent: var(--negative);
      border-color: color-mix(in srgb, var(--negative) 25%, var(--glass-border));
    }

    .toast-info {
      --toast-accent: var(--info);
      border-color: color-mix(in srgb, var(--info) 25%, var(--glass-border));
    }

    .toast-content {
      flex: 1 1 auto;
      min-width: 0;
    }

    .toast-title {
      font-size: 0.88rem;
      font-weight: 650;
      color: var(--ink);
      line-height: 1.35;
      letter-spacing: -0.01em;
    }

    .toast-detail {
      font-size: 0.8rem;
      color: var(--ink-2);
      margin-top: 3px;
      line-height: 1.45;
    }

    .toast-req {
      font-size: 0.7rem;
      color: var(--ink-3);
      margin-top: 4px;
    }

    .toast-close {
      flex: none;
      border: 0;
      background: transparent;
      color: var(--ink-3);
      padding: 4px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition:
        color var(--dur-fast) var(--ease),
        background var(--dur-fast) var(--ease),
        transform var(--dur-fast) var(--ease);
    }

    .toast-close:hover {
      color: var(--ink);
      background: var(--sunken);
      transform: scale(1.1);
    }
  `,
})
export class ToastContainer {
  protected readonly toastService = inject(ToastService);
}
