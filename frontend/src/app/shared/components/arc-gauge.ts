import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
  signal,
  effect,
  ElementRef,
  inject,
  OnDestroy,
} from '@angular/core';

/**
 * Arc Gauge — animated SVG arc for risk scores, percentages, health indicators.
 *
 * Usage:
 *   <app-arc-gauge [value]="72" [max]="100" label="Risk Score" size="140" />
 *   <app-arc-gauge [value]="8" [max]="9" label="Sources Healthy" variant="positive" />
 */
@Component({
  selector: 'app-arc-gauge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="arc-gauge-wrap" [style.width.px]="size()" [style.height.px]="size()">
      <svg [attr.viewBox]="'0 0 ' + size() + ' ' + size()" class="arc-svg">
        <!-- Background track -->
        <circle
          class="arc-track"
          [attr.cx]="center()"
          [attr.cy]="center()"
          [attr.r]="radius()"
          fill="none"
          [attr.stroke-width]="strokeWidth()"
        />
        <!-- Animated fill arc -->
        <circle
          class="arc-fill"
          [class]="'arc-fill-' + resolvedVariant()"
          [attr.cx]="center()"
          [attr.cy]="center()"
          [attr.r]="radius()"
          fill="none"
          [attr.stroke-width]="strokeWidth()"
          [attr.stroke-dasharray]="circumference()"
          [attr.stroke-dashoffset]="currentOffset()"
          stroke-linecap="round"
          [style.transition]="'stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1)'"
        />
      </svg>
      <div class="arc-center-content">
        <span class="arc-value" [class]="'arc-value-' + resolvedVariant()">
          {{ animatedValue() }}
        </span>
        @if (label()) {
          <span class="arc-label">{{ label() }}</span>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: inline-flex;
    }
    .arc-gauge-wrap {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .arc-svg {
      transform: rotate(-90deg);
      position: absolute;
      inset: 0;
    }
    .arc-track {
      stroke: var(--line);
      opacity: 0.5;
    }
    .arc-fill {
      filter: drop-shadow(0 0 6px var(--accent-ring));
      transition: stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .arc-fill-default { stroke: var(--accent); filter: drop-shadow(0 0 6px var(--accent-ring)); }
    .arc-fill-positive { stroke: var(--positive); filter: drop-shadow(0 0 6px rgba(16, 185, 129, 0.3)); }
    .arc-fill-warning { stroke: var(--warning); filter: drop-shadow(0 0 6px rgba(217, 119, 6, 0.3)); }
    .arc-fill-negative { stroke: var(--negative); filter: drop-shadow(0 0 6px rgba(239, 68, 68, 0.3)); }
    .arc-fill-gold { stroke: var(--gold); filter: drop-shadow(0 0 6px var(--gold-glow)); }

    .arc-center-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      z-index: 1;
    }
    .arc-value {
      font-size: 1.6rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }
    .arc-value-default { color: var(--accent); }
    .arc-value-positive { color: var(--positive); }
    .arc-value-warning { color: var(--warning); }
    .arc-value-negative { color: var(--negative); }
    .arc-value-gold { color: var(--gold); }

    .arc-label {
      font-size: 0.6rem;
      font-weight: 650;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--ink-3);
      text-align: center;
      max-width: 80%;
      line-height: 1.2;
    }
  `],
})
export class ArcGauge implements OnDestroy {
  readonly value = input<number>(0);
  readonly max = input<number>(100);
  readonly size = input<number>(120);
  readonly label = input<string>('');
  readonly variant = input<'default' | 'positive' | 'warning' | 'negative' | 'gold' | 'auto'>('auto');
  readonly strokeWidth = input<number>(8);

  private readonly el = inject(ElementRef);
  private observer: IntersectionObserver | null = null;
  private hasRevealed = false;
  private animationId = 0;

  protected readonly center = computed(() => this.size() / 2);
  protected readonly radius = computed(() => (this.size() - this.strokeWidth() * 2) / 2);
  protected readonly circumference = computed(() => 2 * Math.PI * this.radius());

  // The offset to display (starts fully hidden, animates to target)
  protected readonly currentOffset = signal<number>(999);
  protected readonly animatedValue = signal<string>('0');

  protected readonly resolvedVariant = computed(() => {
    const v = this.variant();
    if (v !== 'auto') return v;
    const pct = (this.value() / this.max()) * 100;
    if (pct < 25) return 'positive';
    if (pct < 50) return 'default';
    if (pct < 75) return 'warning';
    return 'negative';
  });

  constructor() {
    // Initialize offset to full circumference (hidden)
    effect(() => {
      const circ = this.circumference();
      if (!this.hasRevealed) {
        this.currentOffset.set(circ);
      }
    });

    // Watch for value changes and trigger animation
    effect(() => {
      const val = this.value();
      const max = this.max();
      this.setupObserver(val, max);
    });
  }

  private setupObserver(val: number, max: number): void {
    if (this.observer) this.observer.disconnect();

    if (typeof IntersectionObserver === 'undefined') {
      this.reveal(val, max);
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !this.hasRevealed) {
          this.hasRevealed = true;
          this.reveal(val, max);
        }
      },
      { threshold: 0.2 }
    );

    this.observer.observe(this.el.nativeElement);
  }

  private reveal(val: number, max: number): void {
    const circ = this.circumference();
    const ratio = Math.min(val / max, 1);
    const targetOffset = circ * (1 - ratio);

    // Animate the offset
    requestAnimationFrame(() => {
      this.currentOffset.set(targetOffset);
    });

    // Count up the value
    cancelAnimationFrame(this.animationId);
    const start = performance.now();
    const dur = 1200;

    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / dur, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(eased * val);
      this.animatedValue.set(current.toString());

      if (progress < 1) {
        this.animationId = requestAnimationFrame(tick);
      } else {
        this.animatedValue.set(val.toString());
      }
    };

    this.animationId = requestAnimationFrame(tick);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationId);
    this.observer?.disconnect();
  }
}
