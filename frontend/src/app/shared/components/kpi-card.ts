import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Icon } from './icon';
import { formatDuration, formatNumber } from '../format';

export type KpiKind = 'number' | 'duration' | 'percent';
export type KpiTone = 'neutral' | 'positive' | 'negative' | 'info' | 'warning';

/**
 * A single headline statistic.
 *
 * The number counts up from zero on first paint, which is the one animation on this screen that
 * earns its place: it draws the eye to the figures in the order they matter and takes 700 ms to
 * do it. It counts the *real* value the backend returned — there is no placeholder figure and no
 * easing past the true number — and under `prefers-reduced-motion` it simply appears.
 */
@Component({
  selector: 'app-kpi-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="kpi" [class]="'tone-' + tone()">
      <div class="kpi-top">
        <span class="eyebrow">{{ label() }}</span>
        @if (icon()) {
          <span class="kpi-icon"><app-icon [name]="icon()!" [size]="15" /></span>
        }
      </div>

      <div class="kpi-value tnum">
        {{ shown() }}<span class="kpi-suffix">{{ suffix() }}</span>
      </div>

      @if (hint()) {
        <div class="kpi-hint small muted">{{ hint() }}</div>
      }

      @if (share() !== null) {
        <div class="meter kpi-meter" [attr.aria-hidden]="true">
          <span [style.width.%]="mounted() ? share()! * 100 : 0"></span>
        </div>
      }
    </div>
  `,
  styles: `
    .kpi {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 18px 20px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
      overflow: hidden;
      transition:
        transform var(--dur) var(--ease),
        box-shadow var(--dur) var(--ease),
        border-color var(--dur) var(--ease);
    }

    .kpi:hover {
      transform: translateY(-3px);
      box-shadow: var(--shadow);
      border-color: color-mix(in srgb, var(--kpi-accent) 30%, var(--line));
    }

    /* Accent left edge with gradient */
    .kpi::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: linear-gradient(180deg, var(--kpi-accent, var(--line-strong)), color-mix(in srgb, var(--kpi-accent, var(--line-strong)) 50%, transparent));
    }

    .tone-neutral {
      --kpi-accent: var(--line-strong);
    }
    .tone-positive {
      --kpi-accent: var(--positive);
    }
    .tone-negative {
      --kpi-accent: var(--negative);
    }
    .tone-info {
      --kpi-accent: var(--info);
    }
    .tone-warning {
      --kpi-accent: var(--warning);
    }

    .kpi-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .kpi-icon {
      color: var(--kpi-accent);
      opacity: 0.8;
      transition: transform var(--dur) var(--ease);
    }

    .kpi:hover .kpi-icon {
      transform: scale(1.12);
    }

    .kpi-value {
      font-size: 1.75rem;
      font-weight: 720;
      letter-spacing: -0.03em;
      line-height: 1.15;
      animation: count-enter var(--dur-slow) var(--ease-out) both;
    }

    .kpi-suffix {
      font-size: 0.9rem;
      font-weight: 550;
      color: var(--ink-3);
      margin-left: 2px;
    }

    .kpi-hint {
      line-height: 1.4;
    }

    .kpi-meter {
      margin-top: 6px;
      height: 4px;
    }

    .kpi-meter > span {
      background: linear-gradient(90deg, var(--kpi-accent), color-mix(in srgb, var(--kpi-accent) 60%, transparent));
      transition: width 900ms var(--ease);
    }

    @media (max-width: 720px) {
      .kpi-value {
        font-size: 1.45rem;
      }
    }
  `,
})
export class KpiCard {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly kind = input<KpiKind>('number');
  readonly tone = input<KpiTone>('neutral');
  readonly hint = input<string | null>(null);
  readonly suffix = input('');
  readonly icon = input<string | null>(null);
  /** 0–1. Draws a proportion bar under the number, for "x of the document" style figures. */
  readonly share = input<number | null>(null);

  protected readonly mounted = signal(false);
  private readonly current = signal(0);

  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;
  private frame: number | null = null;

  protected readonly shown = computed(() => this.format(this.current()));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());

    // Re-runs whenever the value changes, so a live figure animates to its new position
    // rather than jumping.
    effect(() => {
      const target = this.value();
      this.animate(Number.isFinite(target) ? target : 0);
    });

    // One frame after mount, release the proportion bars from zero width.
    requestAnimationFrame(() => this.mounted.set(true));
  }

  private animate(target: number): void {
    this.cancel();

    if (prefersReducedMotion() || !isVisible(this.host.nativeElement)) {
      this.current.set(target);
      return;
    }

    const from = this.current();
    const start = performance.now();
    const duration = 700;

    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      // Ease-out cubic: fast enough to feel responsive, slow enough at the end to read.
      const eased = 1 - Math.pow(1 - t, 3);
      this.current.set(from + (target - from) * eased);
      if (t < 1) {
        this.frame = requestAnimationFrame(step);
      } else {
        this.frame = null;
        // Land exactly on the real value; never leave an eased approximation on screen.
        this.current.set(target);
      }
    };

    this.frame = requestAnimationFrame(step);
  }

  private cancel(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private format(value: number): string {
    switch (this.kind()) {
      case 'duration':
        return formatDuration(value);
      case 'percent':
        return `${Math.round(value * 100)}%`;
      default:
        return formatNumber(Math.round(value));
    }
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function isVisible(element: HTMLElement): boolean {
  return element.offsetParent !== null || element.getClientRects().length > 0;
}