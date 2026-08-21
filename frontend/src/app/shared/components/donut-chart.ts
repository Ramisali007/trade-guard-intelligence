import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { ThemeService } from '../../services/theme.service';
import { seriesColor } from '../palette';

export interface DonutSlice {
  id: string;
  label: string;
  count: number;
  share: number;
  color: string;
  strokeDasharray: string;
  strokeDashoffset: number;
}

@Component({
  selector: 'app-donut-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="donut-container">
      <div class="donut-chart-wrap">
        <svg class="donut-svg" viewBox="0 0 160 160" aria-hidden="true">
          <!-- Background track -->
          <circle
            cx="80"
            cy="80"
            r="60"
            fill="none"
            stroke="var(--sunken)"
            stroke-width="18"
          />

          <!-- Slices -->
          @for (slice of slices(); track slice.id) {
            <circle
              cx="80"
              cy="80"
              r="60"
              fill="none"
              [attr.stroke]="slice.color"
              stroke-width="18"
              [attr.stroke-dasharray]="slice.strokeDasharray"
              [attr.stroke-dashoffset]="slice.strokeDashoffset"
              stroke-linecap="butt"
              class="donut-segment"
              [class.donut-active]="hovered() === slice.id"
              (mouseenter)="hovered.set(slice.id)"
              (mouseleave)="hovered.set(null)"
            />
          }
        </svg>

        <!-- Center Label -->
        <div class="donut-center">
          <span class="donut-center-val tnum">{{ centerValue() }}</span>
          <span class="donut-center-lbl">{{ centerLabel() }}</span>
        </div>
      </div>

      <!-- Legend -->
      <div class="donut-legend">
        @for (slice of slices(); track slice.id) {
          <div
            class="donut-legend-row"
            [class.active]="hovered() === slice.id"
            (mouseenter)="hovered.set(slice.id)"
            (mouseleave)="hovered.set(null)"
          >
            <div class="donut-legend-dot" [style.background]="slice.color"></div>
            <div class="donut-legend-label">{{ slice.label }}</div>
            <div class="donut-legend-val num tnum">{{ slice.count }}</div>
            <div class="donut-legend-pct muted tnum">({{ Math.round(slice.share * 100) }}%)</div>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .donut-container {
      display: flex;
      align-items: center;
      justify-content: space-around;
      gap: 24px;
      flex-wrap: wrap;
      padding: 8px 0;
    }

    .donut-chart-wrap {
      position: relative;
      width: 155px;
      height: 155px;
      flex: none;
    }

    .donut-svg {
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
    }

    .donut-segment {
      transition:
        stroke-width var(--dur-fast) var(--ease),
        opacity var(--dur-fast) var(--ease),
        filter var(--dur-fast) var(--ease);
      cursor: pointer;
    }

    .donut-segment:hover,
    .donut-segment.donut-active {
      stroke-width: 23;
      opacity: 0.95;
      filter: drop-shadow(0 0 6px currentcolor);
    }

    .donut-center {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      text-align: center;
    }

    .donut-center-val {
      font-size: 1.6rem;
      font-weight: 720;
      line-height: 1.1;
      color: var(--ink);
      transition: transform var(--dur-fast) var(--ease);
    }

    .donut-center-lbl {
      font-size: 0.7rem;
      color: var(--ink-3);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    .donut-legend {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 180px;
      flex: 1 1 180px;
    }

    .donut-legend-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      font-size: 0.85rem;
      cursor: pointer;
      transition:
        background var(--dur-fast) var(--ease),
        transform var(--dur-fast) var(--ease);
    }

    .donut-legend-row:hover,
    .donut-legend-row.active {
      background: var(--sunken);
      transform: translateX(2px);
    }

    .donut-legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex: none;
      box-shadow: 0 0 0 2px color-mix(in srgb, currentcolor 15%, transparent);
    }

    .donut-legend-label {
      flex: 1 1 auto;
      text-transform: capitalize;
      font-weight: 550;
    }

    .donut-legend-val {
      font-weight: 650;
    }

    .donut-legend-pct {
      font-size: 0.78rem;
      min-width: 38px;
      text-align: right;
    }
  `,
})
export class DonutChart {
  protected readonly Math = Math;
  private readonly themeService = inject(ThemeService);

  readonly dimension = input<string>('sentiment');
  readonly distribution = input.required<Record<string, number>>();
  readonly title = input<string>('Total');

  protected readonly hovered = signal<string | null>(null);

  protected readonly slices = computed<DonutSlice[]>(() => {
    const dist = this.distribution() || {};
    const dim = this.dimension();
    const mode = this.themeService.mode();
    const radius = 60;
    const circumference = 2 * Math.PI * radius; // ≈ 376.99

    const entries = Object.entries(dist);
    const total = entries.reduce((acc, [, val]) => acc + (val || 0), 0);

    if (total === 0) return [];

    let accumulatedShare = 0;
    return entries.map(([id, count]) => {
      const share = count / total;
      const arcLength = share * circumference;
      const strokeDasharray = `${arcLength.toFixed(2)} ${(circumference - arcLength).toFixed(2)}`;
      const strokeDashoffset = -(accumulatedShare * circumference);
      accumulatedShare += share;

      return {
        id,
        label: id.replace(/_/g, ' '),
        count,
        share,
        color: seriesColor(dim, id, mode),
        strokeDasharray,
        strokeDashoffset,
      };
    });
  });

  protected readonly centerValue = computed(() => {
    const h = this.hovered();
    if (h) {
      const match = this.slices().find((s) => s.id === h);
      return match ? match.count : 0;
    }
    const dist = this.distribution() || {};
    return Object.values(dist).reduce((acc, v) => acc + (v || 0), 0);
  });

  protected readonly centerLabel = computed(() => {
    const h = this.hovered();
    if (h) {
      const match = this.slices().find((s) => s.id === h);
      return match ? match.label : this.title();
    }
    return this.title();
  });
}
