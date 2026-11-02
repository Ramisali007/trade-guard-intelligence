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
import { AnimatedCounter } from '../../shared/components/animated-counter';

@Component({
  selector: 'app-processing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, AnimatedCounter],
  template: `
    <div class="page processing-page">
      <header class="page-head">
        <div>
          <h1>Analyzing Your Document</h1>
          @if (status()?.extraction?.pageCount) {
            <div class="page-head-meta"><span>Total pages: <strong>{{ status()?.extraction?.pageCount }}</strong></span></div>
          }
        </div>
        <div class="page-head-actions">
          <a routerLink="/dashboard" class="btn">
            <app-icon name="chevronLeft" [size]="14" />
            <span>Return to Dashboard</span>
          </a>
        </div>
        <section class="page-head-kpis" aria-label="Progress">
          <div class="kpi-tile">
            <span class="kpi-tile-label">Progress</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="status()?.progress?.percent ?? 0" suffix="%" /></strong>
            <span class="kpi-tile-note">of the analysis</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Paragraphs analyzed</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="status()?.progress?.analyzedUnits ?? 0" /></strong>
            <span class="kpi-tile-note">of {{ status()?.progress?.totalUnits ?? 0 }}</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Batches completed</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="status()?.progress?.completedBatches ?? 0" /></strong>
            <span class="kpi-tile-note">of {{ status()?.progress?.totalBatches ?? 0 }}</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Estimated remaining</span>
            <strong class="kpi-tile-value is-text">{{ (status()?.progress?.etaSeconds ?? 0) > 0 ? '~' + status()?.progress?.etaSeconds + ' s' : 'calculating…' }}</strong>
            <span class="kpi-tile-note">updates as it runs</span>
          </div>
        </section>
      </header>

      <div class="processing-card">
        <!-- Ambient glow -->
        <div class="processing-ambient" aria-hidden="true">
          <div class="processing-glow"></div>
        </div>

        <!-- Progress Bar -->
        <div class="meter meter-active processing-meter">
          <span [style.width.%]="status()?.progress?.percent ?? 0"></span>
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

        <!-- The status could not be read at all (unknown or malformed id, no access, outage) -->
        @if (pollError(); as message) {
          <div class="failure-card mt-20" role="alert">
            <div class="row gap-8">
              <div class="failure-icon"><app-icon name="alert" [size]="18" /></div>
              <div>
                <div class="font-semibold">This document's progress cannot be shown</div>
                <p class="small mt-4 muted">{{ message }}</p>
              </div>
            </div>
            <div class="row gap-12 mt-16">
              <a routerLink="/dashboard" class="btn btn-ghost btn-sm"><span>Back to Dashboard</span></a>
            </div>
          </div>
        }

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
              <a routerLink="/dashboard" class="btn btn-ghost btn-sm">
                <span>Back to Dashboard</span>
              </a>
            </div>
          </div>
        }

        <!-- Return Action -->
      </div>
    </div>
  `,
  styles: `
    .processing-page {
      display: flex;
      flex-direction: column;
      padding: var(--page-top) var(--page-gutter) 64px;
    }

    .processing-card {
      --pc-pad: clamp(18px, 3vw, 32px);
      position: relative;
      width: 100%;
      max-width: none;
      padding: var(--pc-pad);
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

    .processing-meter {
      height: 10px;
      margin: clamp(16px, 3vw, 24px) 0;
      position: relative;
      z-index: 1;
      border-radius: 99px;
      background: var(--sunken);
      overflow: hidden;
      border: 1px solid var(--line);
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.08);
    }

    .processing-meter span {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, var(--accent) 0%, #818cf8 35%, #c084fc 65%, var(--accent) 100%);
      background-size: 250% 100%;
      animation: gradient-shift 2.5s ease-in-out infinite;
      box-shadow: 0 0 16px var(--accent-ring);
      border-radius: 99px;
      transition: width 0.4s var(--ease-out);
    }

    /* Metrics */
    /* Stages */
    .stages-container {
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: clamp(14px, 3vw, 20px) clamp(14px, 3vw, 24px);
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
      gap: clamp(8px, 2vw, 14px);
      padding: clamp(8px, 1.5vw, 10px) clamp(8px, 2vw, 14px);
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
      font-size: clamp(0.82rem, 2.5vw, 0.9rem);
      font-weight: 570;
      color: var(--ink);
      word-break: break-word;
    }

    .stage-detail {
      word-break: break-word;
      font-size: clamp(0.72rem, 2vw, 0.78rem);
    }

    .stage-badge {
      flex: none;
      font-size: 0.7rem;
      text-transform: capitalize;
    }

    /* Failure */
    .failure-card {
      padding: clamp(14px, 3vw, 20px);
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
    .mb-12 { margin-bottom: 12px; }
    .mt-20 { margin-top: 20px; }
    .font-semibold { font-weight: 650; }

    @media (max-width: 480px) {
      .failure-card .row.gap-12 {
        flex-direction: column;
        align-items: stretch;
      }
      .failure-card .btn {
        width: 100%;
        justify-content: center;
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
  protected readonly pollError = signal<string | null>(null);
  private initiatedAnalysis = false;

  ngOnInit(): void {
    this.startPolling();
  }

  private startPolling(): void {
    const docId = this.id();
    const sub = this.docsService.pollStatus(docId, 800).subscribe({
      next: (res) => {
        this.pollError.set(null);
        this.status.set(res);
        if (res.progress?.stages) {
          this.stages.set(res.progress.stages);
        }

        // If document was uploaded without autoStart, immediately kick off analysis
        if (res.status === 'uploaded' && !this.initiatedAnalysis) {
          this.initiatedAnalysis = true;
          this.docsService.analyze(docId).subscribe({
            error: (err) => {
              this.toast.error('Could not initiate analysis', err.message || 'Error triggering pipeline');
            },
          });
        }

        if (res.status === 'completed') {
          this.toast.success('Document analysis completed!');
          setTimeout(() => {
            this.router.navigate(['/analysis', docId]);
          }, 600);
        }
      },
      error: (err) => {
        this.pollError.set(err?.message || 'The status of this document could not be read.');
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
      error: (err) => {
        this.toast.error('Retry failed', err.message);
      },
    });
  }
}
