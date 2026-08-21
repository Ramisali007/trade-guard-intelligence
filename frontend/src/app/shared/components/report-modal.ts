import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DocumentsService } from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import type { DocumentDetail } from '../../models/api.models';
import { Icon } from './icon';

@Component({
  selector: 'app-report-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="modal-card" (click)="$event.stopPropagation()">
        <div class="modal-head">
          <div class="row gap-8">
            <div class="modal-icon">
              <app-icon name="document" [size]="16" />
            </div>
            <h2 class="h2">Generated .txt Analysis Report</h2>
          </div>
          <div class="row gap-8">
            <button class="btn btn-sm" (click)="copyToClipboard()" [disabled]="!content()">
              <app-icon [name]="copied() ? 'check' : 'layers'" [size]="14" />
              <span>{{ copied() ? 'Copied' : 'Copy Text' }}</span>
            </button>
            <button class="btn btn-sm btn-primary" (click)="download()" [disabled]="!content()">
              <app-icon name="download" [size]="14" />
              <span>Download .txt</span>
            </button>
            <button class="btn btn-icon btn-ghost" (click)="close.emit()" aria-label="Close">
              <app-icon name="close" [size]="16" />
            </button>
          </div>
        </div>

        <div class="modal-body">
          @if (loading() && !content()) {
            <div class="modal-loading">
              <div class="spin"><app-icon name="refresh" [size]="24" /></div>
              <span class="muted mt-8">Loading analysis report...</span>
            </div>
          } @else if (error() && !content()) {
            <div class="modal-error">
              <app-icon name="alert" [size]="24" />
              <p class="mt-8">{{ error() }}</p>
              <button class="btn btn-sm mt-12" (click)="loadReport()">
                <app-icon name="refresh" [size]="14" />
                <span>Retry</span>
              </button>
            </div>
          } @else {
            <pre class="report-code mono">{{ content() }}</pre>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }

    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2000;
      background: var(--overlay);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      animation: fade-in 180ms ease;
    }

    .modal-card {
      background: var(--glass-bg);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-xl), 0 0 40px rgba(0, 0, 0, 0.35);
      width: 100%;
      max-width: 960px;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: modal-in 240ms var(--ease-out);
      position: relative;
      z-index: 2001;
    }

    .modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 22px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--surface) 85%, transparent);
      flex: none;
    }

    .modal-icon {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-sm);
      background: var(--accent-soft);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-body {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 18px 22px;
      background: var(--sunken);
    }

    .report-code {
      margin: 0;
      padding: 18px 22px;
      background: var(--raised);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      font-size: 0.82rem;
      line-height: 1.6;
      color: var(--ink);
      white-space: pre-wrap;
      word-break: break-word;
      user-select: text;
    }

    .modal-loading,
    .modal-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      text-align: center;
    }

    .modal-error {
      color: var(--negative);
    }
  `,
})
export class ReportModal implements OnInit {
  private readonly docsService = inject(DocumentsService);
  private readonly toast = inject(ToastService);

  readonly documentId = input.required<string>();
  readonly filename = input<string>('analysis-report.txt');
  readonly document = input<DocumentDetail | null>(null);

  readonly close = output<void>();

  protected readonly content = signal<string>('');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly copied = signal(false);

  ngOnInit(): void {
    // Generate fallback content immediately if document detail is already available
    const d = this.document();
    if (d && d.analysis) {
      this.content.set(this.buildClientReport(d));
    }
    this.loadReport();
  }

  loadReport(): void {
    const id = this.documentId();
    if (!id) return;

    this.loading.set(true);
    this.error.set(null);

    this.docsService.reportText(id).subscribe({
      next: (text) => {
        if (text && text.trim().length > 0) {
          this.content.set(text);
        }
        this.loading.set(false);
      },
      error: (err: unknown) => {
        // If client fallback report is already set, keep it without showing error
        if (!this.content()) {
          this.error.set('Failed to load the generated text report.');
        }
        this.loading.set(false);
      },
    });
  }

  private buildClientReport(doc: DocumentDetail): string {
    const border = '='.repeat(78);
    const divider = '-'.repeat(78);
    const stats = doc.analysis?.statistics;
    const summary = doc.analysis?.summary;

    const lines: string[] = [
      border,
      'DOCUMENT ANALYSIS REPORT',
      'DocuIntel AI — Enterprise Document Intelligence Platform',
      border,
      '',
      `Document Name      : ${doc.filename}`,
      `Document Type      : ${doc.fileType.toUpperCase()}`,
      `Total Pages        : ${doc.extraction?.pageCount || 1}`,
      `Analyzed Passages  : ${stats?.analyzedUnits || 0}`,
      `Average Confidence : ${Math.round((stats?.averageConfidence || 0) * 100)}%`,
      `Processing Engine  : ${doc.analysis?.engine?.provider || 'heuristic'} (${doc.analysis?.engine?.model || 'local-lexicon-v1'})`,
      '',
      divider,
      'EXECUTIVE SUMMARY',
      divider,
      `Headline: ${summary?.headline || 'Analysis Completed'}`,
      '',
      `Narrative:`,
      `${summary?.narrative || 'Document analyzed across multiple semantic dimensions.'}`,
      '',
      `Dominant Sentiment : ${summary?.dominantSentiment || 'neutral'}`,
      `Dominant Emotion   : ${summary?.dominantEmotion || 'neutral'}`,
      `Dominant Type      : ${summary?.dominantContentType || 'informational'}`,
      '',
      divider,
      'SENTIMENT BREAKDOWN',
      divider,
    ];

    if (stats?.distributions?.['sentiment']) {
      for (const [k, v] of Object.entries(stats.distributions['sentiment'])) {
        lines.push(`${k.toUpperCase().padEnd(16)}: ${v}`);
      }
    }

    lines.push('');
    lines.push(divider);
    lines.push('EMOTION BREAKDOWN');
    lines.push(divider);

    if (stats?.distributions?.['emotion']) {
      for (const [k, v] of Object.entries(stats.distributions['emotion'])) {
        lines.push(`${k.toUpperCase().padEnd(16)}: ${v}`);
      }
    }

    lines.push('');
    lines.push(divider);
    lines.push('CONTENT TYPE BREAKDOWN');
    lines.push(divider);

    if (stats?.distributions?.['contentType']) {
      for (const [k, v] of Object.entries(stats.distributions['contentType'])) {
        lines.push(`${k.toUpperCase().padEnd(16)}: ${v}`);
      }
    }

    lines.push('');
    lines.push(border);
    lines.push('END OF REPORT');
    lines.push(border);

    return lines.join('\n');
  }

  protected copyToClipboard(): void {
    const text = this.content();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.copied.set(true);
      this.toast.success('Report copied to clipboard');
      setTimeout(() => this.copied.set(false), 2500);
    });
  }

  protected download(): void {
    const id = this.documentId();
    const name = this.filename().replace(/\.[^/.]+$/, '') + '-analysis.txt';
    this.docsService.downloadReport(id, name).subscribe({
      next: (downloadedAs) => {
        this.toast.success('Report downloaded', downloadedAs);
      },
      error: () => {
        this.toast.error('Download failed', 'Could not download the text report.');
      },
    });
  }
}
