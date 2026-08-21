import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import type { PageTimelineEntry } from '../../models/api.models';
import { ThemeService } from '../../services/theme.service';
import { seriesColor } from '../palette';

@Component({
  selector: 'app-timeline-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="timeline-container">
      <div class="timeline-bars">
        @for (entry of entries(); track entry.pageNumber; let i = $index) {
          <div class="timeline-col" [style.animation-delay.ms]="i * 60">
            <div class="timeline-col-meta">
              <span class="timeline-page-num eyebrow">P.{{ entry.pageNumber }}</span>
            </div>
            
            <div class="timeline-track" [attr.title]="'Page ' + entry.pageNumber + ': ' + entry.dominantSentiment + ', ' + entry.dominantContentType">
              <!-- Net Sentiment Indicator -->
              <div
                class="timeline-block"
                [style.background]="getSentimentColor(entry.dominantSentiment)"
                [style.height.%]="getBarHeight(entry.units)"
              >
                <div class="timeline-units tnum">{{ entry.units }}</div>
              </div>
            </div>

            <div class="timeline-badge-wrap">
              <span
                class="timeline-dominant-chip"
                [style.border-color]="getSentimentColor(entry.dominantSentiment)"
              >
                {{ entry.dominantSentiment }}
              </span>
            </div>
          </div>
        }
      </div>

      @if (entries().length === 0) {
        <div class="timeline-empty muted small">No page timeline data available</div>
      }
    </div>
  `,
  styles: `
    .timeline-container {
      overflow-x: auto;
      padding: 12px 4px;
    }

    .timeline-bars {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      min-width: max-content;
      height: 200px;
      padding-bottom: 28px;
      border-bottom: 1px solid var(--line);
    }

    .timeline-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      height: 100%;
      min-width: 48px;
      animation: slide-up-stagger var(--dur-slow) var(--ease-out) both;
    }

    .timeline-col-meta {
      flex: none;
    }

    .timeline-page-num {
      font-size: 0.7rem;
      font-weight: 650;
      color: var(--ink-3);
    }

    .timeline-track {
      flex: 1 1 auto;
      width: 34px;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      background: var(--sunken);
      border-radius: var(--radius-sm);
      overflow: hidden;
      cursor: pointer;
      transition:
        background var(--dur-fast) var(--ease),
        box-shadow var(--dur-fast) var(--ease);
    }

    .timeline-track:hover {
      background: color-mix(in srgb, var(--accent) 10%, var(--sunken));
      box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 12%, transparent);
    }

    .timeline-block {
      width: 100%;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: height 700ms var(--ease-out), transform var(--dur-fast) var(--ease);
    }

    .timeline-block:hover {
      transform: scaleY(1.04);
    }

    .timeline-units {
      font-size: 0.72rem;
      font-weight: 700;
      color: #fff;
      text-shadow: 0 1px 3px rgba(0,0,0,0.45);
    }

    .timeline-badge-wrap {
      flex: none;
    }

    .timeline-dominant-chip {
      font-size: 0.66rem;
      font-weight: 600;
      text-transform: capitalize;
      padding: 2px 7px;
      border-radius: 99px;
      border: 1.5px solid;
      background: var(--raised);
      color: var(--ink-2);
      white-space: nowrap;
    }

    .timeline-empty {
      text-align: center;
      padding: 24px;
    }
  `,
})
export class TimelineChart {
  private readonly themeService = inject(ThemeService);

  readonly timeline = input.required<PageTimelineEntry[]>();

  protected readonly entries = computed(() => this.timeline() || []);

  private readonly maxUnits = computed(() => {
    const list = this.entries();
    if (list.length === 0) return 1;
    return Math.max(...list.map((e) => e.units), 1);
  });

  protected getBarHeight(units: number): number {
    const max = this.maxUnits();
    return Math.max(18, Math.min(100, Math.round((units / max) * 100)));
  }

  protected getSentimentColor(sentiment: string): string {
    const mode = this.themeService.mode();
    return seriesColor('sentiment', sentiment || 'neutral', mode);
  }
}
