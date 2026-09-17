import {
  Component,
  ChangeDetectionStrategy,
  input,
  signal,
  effect,
  ElementRef,
  inject,
  OnInit,
  OnDestroy,
} from '@angular/core';

/**
 * Animated Counter — counts from previous value to target with cubic easing.
 *
 * Usage:
 *   <app-animated-counter [value]="1234" [duration]="1200" />
 *   <app-animated-counter [value]="89.5" [decimals]="1" suffix="%" />
 */
@Component({
  selector: 'app-animated-counter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="counter-value" [class.counting]="isCounting()">
      {{ prefix() }}{{ displayValue() }}{{ suffix() }}
    </span>
  `,
  styles: [`
    :host {
      display: inline-flex;
      font-variant-numeric: tabular-nums;
    }
    .counter-value {
      display: inline-block;
      transition: color 0.3s ease;
    }
    .counting {
      animation: counter-slide 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
  `],
})
export class AnimatedCounter implements OnInit, OnDestroy {
  readonly value = input<number>(0);
  readonly duration = input<number>(1000);
  readonly decimals = input<number>(0);
  readonly prefix = input<string>('');
  readonly suffix = input<string>('');

  protected readonly displayValue = signal<string>('0');
  protected readonly isCounting = signal<boolean>(false);

  private readonly el = inject(ElementRef);
  private animationId = 0;
  private observer: IntersectionObserver | null = null;
  private isIntersecting = false;
  private currentRenderedValue = 0;

  constructor() {
    effect(() => {
      const target = this.value() ?? 0;
      if (this.isIntersecting || typeof IntersectionObserver === 'undefined') {
        this.animate(this.currentRenderedValue, target);
      }
    });
  }

  ngOnInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.isIntersecting = true;
      this.animate(0, this.value() ?? 0);
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          this.isIntersecting = true;
          this.animate(this.currentRenderedValue, this.value() ?? 0);
        }
      },
      { threshold: 0.1 }
    );

    this.observer.observe(this.el.nativeElement);
  }

  private animate(from: number, to: number): void {
    cancelAnimationFrame(this.animationId);

    const dur = this.duration();
    const dec = this.decimals();

    if (isNaN(to) || dur <= 0) {
      const safeVal = isNaN(to) ? 0 : to;
      this.currentRenderedValue = safeVal;
      this.isCounting.set(false);
      this.displayValue.set(
        dec > 0 ? safeVal.toFixed(dec) : Math.round(safeVal).toLocaleString()
      );
      return;
    }

    // If values are identical and already formatted, avoid redundant animation
    if (from === to && this.displayValue() !== '0') {
      return;
    }

    this.isCounting.set(true);
    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / dur, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;
      this.currentRenderedValue = current;

      this.displayValue.set(
        dec > 0
          ? current.toFixed(dec)
          : Math.round(current).toLocaleString()
      );

      if (progress < 1) {
        this.animationId = requestAnimationFrame(tick);
      } else {
        this.isCounting.set(false);
        this.currentRenderedValue = to;
        this.displayValue.set(
          dec > 0
            ? to.toFixed(dec)
            : Math.round(to).toLocaleString()
        );
      }
    };

    this.animationId = requestAnimationFrame(tick);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationId);
    this.observer?.disconnect();
  }
}

