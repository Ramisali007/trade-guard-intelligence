import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { ThemeService } from '../../services/theme.service';
import { seriesColor } from '../palette';

export interface BarItem {
  id: string;
  label: string;
  count: number;
  share: number;
  color: string;
}

@Component({
  selector: 'app-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar-chart-stack">
      @for (item of items(); track item.id; let i = $index) {
        <div class="bar-item" [style.animation-delay.ms]="i * 80">
          <div class="bar-item-meta">
            <span class="bar-item-label">{{ item.label }}</span>
            <div class="bar-item-values">
              <span class="bar-item-count tnum">{{ item.count }}</span>
              <span class="bar-item-pct muted tnum">({{ Math.round(item.share * 100) }}%)</span>
            </div>
          </div>
          <div class="bar-track">
            <div
              class="bar-fill"
              [style.width.%]="item.share * 100"
              [style.background]="item.color"
            ></div>
          </div>
        </div>
      }
      @if (items().length === 0) {
        <div class="bar-empty muted small">No data available</div>
      }
    </div>
  `,
  styles: `
    .bar-chart-stack {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 4px 0;
    }

    .bar-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
      animation: slide-up-stagger var(--dur-slow) var(--ease-out) both;
    }

    .bar-item-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 0.84rem;
    }

    .bar-item-label {
      font-weight: 570;
      text-transform: capitalize;
      color: var(--ink);
    }

    .bar-item-values {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .bar-item-count {
      font-weight: 650;
      color: var(--ink);
    }

    .bar-item-pct {
      font-size: 0.78rem;
    }

    .bar-track {
      height: 8px;
      background: var(--sunken);
      border-radius: 99px;
      overflow: hidden;
      position: relative;
    }

    .bar-fill {
      height: 100%;
      border-radius: 99px;
      transition: width 900ms var(--ease-out);
      position: relative;
    }

    /* Subtle shimmer on hover */
    .bar-item:hover .bar-fill::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.2) 50%,
        transparent 100%
      );
      animation: meter-shimmer 1.5s;
    }

    .bar-empty {
      text-align: center;
      padding: 16px;
    }
  `,
})
export class BarChart {
  protected readonly Math = Math;
  private readonly themeService = inject(ThemeService);

  readonly dimension = input<string>('emotion');
  readonly distribution = input.required<Record<string, number>>();
  readonly maxItems = input<number>(10);

  protected readonly items = computed<BarItem[]>(() => {
    const dist = this.distribution() || {};
    const dim = this.dimension();
    const mode = this.themeService.mode();
    const max = this.maxItems();

    const entries = Object.entries(dist).filter(([, count]) => count > 0);
    const total = entries.reduce((acc, [, count]) => acc + count, 0);

    if (total === 0) return [];

    return entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([id, count]) => ({
        id,
        label: id.replace(/_/g, ' '),
        count,
        share: count / total,
        color: seriesColor(dim, id, mode),
      }));
  });
}
