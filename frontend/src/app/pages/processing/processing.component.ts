import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DocumentsService } from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import type { StatusResponse, Stage } from '../../models/api.models';
import { Icon } from '../../shared/components/icon';

@Component({
  selector: 'app-processing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <div class="page processing-page">
      <div class="processing-card">
        <!-- Ambient glow -->
        <div class="processing-ambient" aria-hidden="true">
          <div class="processing-glow"></div>
        </div>

        <!-- Top Status -->
        <div class="processing-head">
          <div class="row gap-12">
            <div class="processing-icon-wrap">
              <div class="processing-icon-ring"></div>
              <div class="processing-icon">
                <app-icon name="sparkle" [size]="22" />
              </div>
            </div>
            <div>
              <h1 class="h2">Analyzing Your Document</h1>
              <p class="small muted mt-4">
                Extracting structure, segmenting content, and running multi-dimensional AI classification...
              </p>
            </div>
          </div>
          <div class="processing-pct tnum">
            {{ status()?.progress?.percent ?? 0 }}<span class="processing-pct-symbol">%</span>
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="meter meter-active processing-meter">
          <span [style.width.%]="status()?.progress?.percent ?? 0"></span>
        </div>

        <!-- Live Metrics -->
        <div class="metrics-grid">
          <div class="metric-card">
            <span class="eyebrow">Analyzed Paragraphs</span>
            <span class="metric-val tnum">
              {{ status()?.progress?.analyzedUnits ?? 0 }}
              <span class="metric-total">/ {{ status()?.progress?.totalUnits ?? 0 }}</span>
            </span>
          </div>

          <div class="metric-card">
            <span class="eyebrow">Batches Completed</span>
            <span class="metric-val tnum">
              {{ status()?.progress?.completedBatches ?? 0 }}
              <span class="metric-total">/ {{ status()?.progress?.totalBatches ?? 0 }}</span>
            </span>
          </div>

          <div class="metric-card">
            <span class="eyebrow">Estimated Remaining</span>
            <span class="metric-val tnum">
              @if (status()?.progress?.etaSeconds !== null && (status()?.progress?.etaSeconds || 0) > 0) {
                ~{{ status()?.progress?.etaSeconds }}s
              } @else {
                <span class="metric-calc">calculating...</span>
              }
            </span>
          </div>

          @if (status()?.extraction?.pageCount) {
            <div class="metric-card">
              <span class="eyebrow">Total Pages</span>
              <span class="metric-val tnum">{{ status()?.extraction?.pageCount }}</span>
            </div>
          }
        </div>

        <!-- Pipeline Stages -->
        <div class="stages-container">
          <div class="eyebrow mb-12">Processing Pipeline</div>
          <div class="stages-timeline">
            @for (stage of stages(); track stage.id; let i = $index; let last = $last) {
              <div class="stage-item" [class]="'stage-' + stage.state">
                <!-- Connector line -->
                @if (!last) {
                  <div class="stage-connector" [class.stage-connector-done]="stage.state === 'done'"></div>
                }

                <!-- Icon -->
                <div class="stage-icon-wrap">
                  @switch (stage.state) {
                    @case ('done') {
                      <div class="stage-icon-done">
                        <app-icon name="check" [size]="14" />
                      </div>
                    }
                    @case ('active') {
                      <div class="stage-icon-active">
                        <div class="stage-icon-active-ring"></div>
                        <div class="spin"><app-icon name="refresh" [size]="14" /></div>
                      </div>
                    }
                    @case ('failed') {
                      <div class="stage-icon-failed">
                        <app-icon name="alert" [size]="14" />
                      </div>
                    }
                    @default {
                      <div class="stage-icon-pending"></div>
                    }
                  }
                </div>

                <!-- Content -->
                <div class="stage-body">
                  <div class="stage-label">{{ stage.label }}</div>
                  @if (stage.detail) {
                    <div class="stage-detail small muted">{{ stage.detail }}</div>
                  }
                </div>

                <!-- Status badge -->
                <span class="chip stage-badge" [class]="getStageChipClass(stage.state)">
                  {{ stage.state }}
                </span>
              </div>
            }
          </div>
        </div>

        <!-- Failure Alert -->
        @if (status()?.status === 'failed') {
          <div class="failure-card mt-20">
            <div class="row gap-8">
              <div class="failure-icon">
                <app-icon name="alert" [size]="18" />
              </div>
              <div>
                <div class="font-semibold">Analysis Failed</div>
                <p class="small mt-4 muted">{{ status()?.error?.message || 'Document processing could not be completed.' }}</p>
              </div>
            </div>
            <div class="row gap-12 mt-16">
              <button class="btn btn-primary btn-sm" (click)="retry()">
                <app-icon name="refresh" [size]="14" />
                <span>Retry Analysis</span>
              </button>
              <a routerLink="/" class="btn btn-ghost btn-sm">
                <span>Back to Dashboard</span>
              </a>
            </div>
          </div>
        }

        <!-- Return Action -->
        <div class="processing-foot">
          <a routerLink="/" class="btn btn-ghost btn-sm">
            <app-icon name="chevronLeft" [size]="14" />
            <span>Return to Dashboard</span>
          </a>
        </div>
      </div>
    </div>
  `,
  styles: `
    .processing-page {
      display: flex;
      justify-content: center;
      padding-top: 40px;
    }

    .processing-card {
      position: relative;
      width: 100%;
      max-width: 800px;
      padding: 28px 32px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    /* Ambient */
    .processing-ambient {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
    }

    .processing-glow {
      position: absolute;
      width: 500px;
      height: 500px;
      top: -200px;
      right: -100px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--accent) 10%, transparent);
      filter: blur(100px);
      animation: glow-pulse 6s ease-in-out infinite;
    }

    /* Header */
    .processing-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      position: relative;
      z-index: 1;
    }

    .processing-icon-wrap {
      position: relative;
      width: 44px;
      height: 44px;
      flex: none;
    }

    .processing-icon-ring {
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      border: 2px solid color-mix(in srgb, var(--accent) 20%, transparent);
      animation: orbital 3s linear infinite;
    }

    .processing-icon-ring::before {
      content: '';
      position: absolute;
      top: -3px;
      left: 50%;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 8px var(--accent);
    }

    .processing-icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--accent-soft);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .processing-pct {
      font-size: 2.2rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      background: linear-gradient(135deg, var(--accent) 0%, #a78bfa 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      line-height: 1;
    }

    .processing-pct-symbol {
      font-size: 1rem;
      font-weight: 600;
    }

    .processing-meter {
      height: 8px;
      margin: 24px 0;
      position: relative;
      z-index: 1;
    }

    /* Metrics */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
      position: relative;
      z-index: 1;
    }

    .metric-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 14px 16px;
      background: var(--sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius);
    }

    .metric-val {
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--ink);
    }

    .metric-total {
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--ink-3);
    }

    .metric-calc {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--ink-3);
      font-style: italic;
    }

    /* Stages */
    .stages-container {
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 20px 24px;
      background: var(--raised);
      position: relative;
      z-index: 1;
    }

    .stages-timeline {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .stage-item {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 10px 14px;
      border-radius: var(--radius-sm);
      position: relative;
      transition: background var(--dur-fast) var(--ease);
    }

    .stage-item.stage-active {
      background: var(--accent-soft);
    }

    /* Connector */
    .stage-connector {
      position: absolute;
      left: 30px;
      top: 42px;
      width: 2px;
      height: calc(100% - 10px);
      background: var(--line);
      z-index: 0;
    }

    .stage-connector-done {
      background: var(--positive);
    }

    /* Stage icons */
    .stage-icon-wrap {
      flex: none;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      z-index: 1;
    }

    .stage-icon-done {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--positive);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: scale-in var(--dur) var(--ease-spring);
    }

    .stage-icon-active {
      position: relative;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent);
    }

    .stage-icon-active-ring {
      position: absolute;
      inset: -2px;
      border-radius: 50%;
      border: 2px solid var(--accent-ring);
      animation: pulse-ring 2s ease-in-out infinite;
    }

    .stage-icon-failed {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--negative-soft);
      color: var(--negative);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .stage-icon-pending {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--line-strong);
      margin: 0 8px;
    }

    .stage-body {
      flex: 1 1 auto;
      min-width: 0;
    }

    .stage-label {
      font-size: 0.9rem;
      font-weight: 570;
      color: var(--ink);
    }

    .stage-badge {
      flex: none;
      font-size: 0.7rem;
      text-transform: capitalize;
    }

    /* Failure */
    .failure-card {
      padding: 20px;
      border-radius: var(--radius-lg);
      background: var(--negative-soft);
      border: 1px solid color-mix(in srgb, var(--negative) 25%, transparent);
      color: var(--ink);
      animation: scale-in var(--dur) var(--ease-out) both;
      position: relative;
      z-index: 1;
    }

    .failure-icon {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--negative) 15%, transparent);
      color: var(--negative);
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
    }

    /* Footer */
    .processing-foot {
      margin-top: 24px;
      display: flex;
      justify-content: flex-end;
      position: relative;
      z-index: 1;
    }

    .mb-12 { margin-bottom: 12px; }
    .mt-20 { margin-top: 20px; }
    .font-semibold { font-weight: 650; }

    @media (max-width: 720px) {
      .processing-card {
        padding: 20px;
      }
      .processing-pct {
        font-size: 1.6rem;
      }
    }
  `,
})
export class ProcessingComponent implements OnInit {
  readonly id = input.required<string>();

  private readonly docsService = inject(DocumentsService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly status = signal<StatusResponse | null>(null);
  protected readonly stages = signal<Stage[]>([]);

  ngOnInit(): void {
    this.startPolling();
  }

  private startPolling(): void {
    const docId = this.id();
    const sub = this.docsService.pollStatus(docId, 800).subscribe({
      next: (res) => {
        this.status.set(res);
        if (res.progress?.stages) {
          this.stages.set(res.progress.stages);
        }

        if (res.status === 'completed') {
          this.toast.success('Document analysis completed!');
          setTimeout(() => {
            this.router.navigate(['/analysis', docId]);
          }, 600);
        }
      },
      error: (err: any) => {
        this.toast.error('Processing error', err.message || 'Could not poll status');
      },
    });

    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  protected getStageChipClass(state: string): string {
    switch (state) {
      case 'done':
        return 'chip-positive';
      case 'active':
        return 'chip-info';
      case 'failed':
        return 'chip-negative';
      default:
        return '';
    }
  }

  protected retry(): void {
    this.docsService.analyze(this.id()).subscribe({
      next: () => {
        this.toast.info('Analysis restarted');
        this.startPolling();
      },
      error: (err: any) => {
        this.toast.error('Retry failed', err.message);
      },
    });
  }
}
