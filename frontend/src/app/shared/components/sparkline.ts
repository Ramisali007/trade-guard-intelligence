import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';

/**
 * Sparkline — lightweight inline SVG trend visualization.
 *
 * Usage:
 *   <app-sparkline [data]="[10, 20, 15, 30, 25, 40]" />
 *   <app-sparkline [data]="priceHistory" color="var(--positive)" [showArea]="true" />
 */
@Component({
  selector: 'app-sparkline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      class="sparkline-svg"
      [attr.width]="width()"
      [attr.height]="height()"
      [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
      preserveAspectRatio="none"
    >
      @if (showArea()) {
        <path
          [attr.d]="areaPath()"
          [attr.fill]="'url(#sparkline-gradient-' + uid + ')'"
          opacity="0.3"
        />
        <defs>
          <linearGradient [attr.id]="'sparkline-gradient-' + uid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" [attr.stop-color]="color()" stop-opacity="0.4" />
            <stop offset="100%" [attr.stop-color]="color()" stop-opacity="0" />
          </linearGradient>
        </defs>
      }
      <path
        class="sparkline-line"
        [attr.d]="linePath()"
        fill="none"
        [attr.stroke]="color()"
        [attr.stroke-width]="strokeWidth()"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      @if (showDot()) {
        <circle
          class="sparkline-dot"
          [attr.cx]="lastPoint().x"
          [attr.cy]="lastPoint().y"
          [attr.r]="strokeWidth() + 1"
          [attr.fill]="color()"
        />
      }
    </svg>
  `,
  styles: [`
    :host {
      display: inline-flex;
      align-items: center;
      vertical-align: middle;
    }
    .sparkline-svg {
      overflow: visible;
    }
    .sparkline-line {
      vector-effect: non-scaling-stroke;
    }
    .sparkline-dot {
      animation: status-pulse 2s ease-in-out infinite;
      --pulse-color: currentColor;
    }
  `],
})
export class Sparkline {
  readonly data = input<number[]>([]);
  readonly width = input<number>(80);
  readonly height = input<number>(24);
  readonly color = input<string>('var(--accent)');
  readonly strokeWidth = input<number>(1.5);
  readonly showArea = input<boolean>(true);
  readonly showDot = input<boolean>(true);

  readonly uid = Math.random().toString(36).slice(2, 8);

  protected readonly points = computed(() => {
    const d = this.data();
    if (!d || d.length < 2) return [];

    const w = this.width();
    const h = this.height();
    const padding = 3;
    const min = Math.min(...d);
    const max = Math.max(...d);
    const range = max - min || 1;

    return d.map((val, i) => ({
      x: padding + (i / (d.length - 1)) * (w - padding * 2),
      y: padding + (1 - (val - min) / range) * (h - padding * 2),
    }));
  });

  protected readonly linePath = computed(() => {
    const pts = this.points();
    if (pts.length < 2) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  });

  protected readonly areaPath = computed(() => {
    const pts = this.points();
    const h = this.height();
    if (pts.length < 2) return '';
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return `${line} L${pts[pts.length - 1].x.toFixed(1)},${h} L${pts[0].x.toFixed(1)},${h} Z`;
  });

  protected readonly lastPoint = computed(() => {
    const pts = this.points();
    return pts.length > 0 ? pts[pts.length - 1] : { x: 0, y: 0 };
  });
}
