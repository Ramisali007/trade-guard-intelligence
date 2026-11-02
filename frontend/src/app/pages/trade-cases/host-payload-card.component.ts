import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TradeCasesService } from '../../services/trade-cases.service';
import { ToastService } from '../../services/toast.service';
import { isApiError } from '../../services/api.service';
import { Icon } from '../../shared/components/icon';
import type { HostPayloadView } from '../../models/trade-case.models';

const STATUS: Record<string, { label: string; chip: string }> = {
  GENERATED: { label: 'Ready to send', chip: 'chip-info' },
  SENT_TO_HOST: { label: 'Sent to host', chip: 'chip-positive' },
  DELIVERY_FAILED: { label: 'Send failed', chip: 'chip-negative' },
};

/**
 * The host payload of an approved pre-shipment request: the PDF made at approval, the link the host opens, the TI
 * reference that "Send to host" creates, and what happened to each send. Everything shown is read from the database;
 * the buttons call the API, which checks the permission again.
 */
@Component({
  selector: 'app-host-payload-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, Icon],
  template: `
    <section class="card card-pad hp" aria-labelledby="hp-title">
      <div class="hp-head">
        <div>
          <h2 id="hp-title" class="hp-title"><app-icon name="file" [size]="17" /> Host payload</h2>
          <p class="muted hp-sub">The link below opens a page for the host (the TI officer): this request's references, the client, the payload PDF and every pre-shipment document the client sent, each to view or download.</p>
        </div>
        @if (view(); as v) {
          @if (v.payload; as p) {
            <span class="chip" [class]="'chip ' + status(p.status).chip" role="status">{{ status(p.status).label }}</span>
          }
        }
      </div>

      @if (loading()) {
        <p class="muted" role="status">Loading the payload…</p>
      } @else if (view(); as v) {
        @if (!v.payload) {
          <div class="hp-empty">
            <p>The payload PDF has not been generated for this request yet.</p>
            @if (v.canSend) {
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="generate()"><app-icon name="file" [size]="14" /> {{ busy() ? 'Generating…' : 'Generate the payload PDF' }}</button>
            }
          </div>
        } @else {
          @let p = v.payload;
          <dl class="hp-refs">
            <div><dt>Case reference</dt><dd>{{ caseId() }}</dd></div>
            <div [class.hp-ti]="p.tiReference">
              <dt>TI reference</dt>
              <dd>@if (p.tiReference; as ti) { {{ ti.reference }} } @else { <span class="muted">Created when you send it to the host</span> }</dd>
            </div>
          </dl>

          <div class="hp-link">
            <span class="hp-link-label">Link for the host</span>
            <code class="hp-url" tabindex="0" aria-label="Link to the payload PDF">{{ p.url }}</code>
            <div class="hp-link-actions">
              <button type="button" class="btn btn-ghost btn-sm" (click)="copy(p.url)"><app-icon name="check" [size]="13" /> {{ copied() ? 'Copied' : 'Copy link' }}</button>
              <a class="btn btn-ghost btn-sm" [href]="p.url" target="_blank" rel="noopener noreferrer"><app-icon name="eye" [size]="13" /> Open the host page</a>
              <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy()" (click)="download(p.filename)"><app-icon name="download" [size]="13" /> Download the PDF</button>
            </div>
            @if (!v.delivery.publicAddressConfigured) {
              <p class="hp-note hp-warn" role="note"><app-icon name="alert" [size]="14" /> This link uses the server's own address (localhost), which the host cannot reach. Set <code>PUBLIC_BASE_URL</code> on the server to the address the host uses, then send again.</p>
            }
          </div>

          <p class="muted hp-meta">
            Version {{ p.currentVersion }} · {{ kb(p.sizeBytes) }} · generated {{ p.generatedAt | date: 'medium' }} · SHA-256 <code>{{ p.sha256.slice(0, 16) }}…</code>
            · opened by the host {{ p.opened.count }} time{{ p.opened.count === 1 ? '' : 's' }}@if (p.opened.lastAt) { (last {{ p.opened.lastAt | date: 'medium' }}) }
          </p>

          @if (p.activity.length > 0) {
            <h3 class="hp-h3">What the host opened</h3>
            <ul class="hp-sends hp-activity">
              @for (a of p.activity.slice(0, 8); track a.at + (a.item ?? a.kind)) {
                <li><span class="chip chip-info">{{ kindLabel(a.kind) }}</span><span>{{ a.at | date: 'medium' }}</span><span class="muted">{{ a.item ?? '' }}</span></li>
              }
            </ul>
          }

          @if (v.canSend) {
            <div class="hp-actions">
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="send()">
                <app-icon name="mail" [size]="14" /> {{ busy() ? 'Sending…' : p.lastSentAt || p.tiReference ? 'Send to host again' : 'Send to host' }}
              </button>
              <span class="muted hp-hint">
                @if (v.delivery.endpointConfigured) { The details and the link are posted to the host endpoint. }
                @else { No host endpoint is configured on the server, so nothing is posted: the TI reference is created and the payload with its link is recorded for the host to open. }
              </span>
            </div>
          }

          @if (p.deliveries.length > 0) {
            <h3 class="hp-h3">Sends</h3>
            <ul class="hp-sends">
              @for (d of p.deliveries; track d.at) {
                <li>
                  <span class="chip" [class]="'chip ' + (d.ok ? 'chip-positive' : 'chip-negative')">{{ d.ok ? (d.mode === 'HTTP' ? 'Host accepted' : 'Recorded') : 'Failed' }}</span>
                  <span>{{ d.at | date: 'medium' }} · {{ d.by.name }}</span>
                  <span class="muted">{{ d.message }}</span>
                </li>
              }
            </ul>
          }
        }
      }

      @if (error()) { <p class="hp-note hp-error" role="alert"><app-icon name="alert" [size]="14" /> {{ error() }}</p> }
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .hp { border-top: 3px solid var(--accent); }
      .hp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .hp-title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 1.05rem; }
      .hp-sub { margin: 4px 0 14px; font-size: 0.86rem; }
      .hp-empty { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; border-radius: 10px; background: var(--sunken); }
      .hp-empty p { margin: 0; }
      .hp-refs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 0 0 14px; }
      .hp-refs > div { padding: 10px 14px; border-radius: 10px; background: var(--sunken); border-left: 3px solid var(--line); }
      .hp-refs .hp-ti { background: var(--accent-soft); border-left-color: var(--accent); }
      .hp-refs dt { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
      .hp-refs dd { margin: 4px 0 0; font-weight: 700; font-size: 0.98rem; overflow-wrap: anywhere; }
      .hp-refs .hp-ti dd { color: var(--accent); }
      .hp-link { padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; }
      .hp-link-label { display: block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 6px; }
      .hp-url { display: block; padding: 8px 10px; border-radius: 8px; background: var(--sunken); font-size: 0.8rem; overflow-wrap: anywhere; user-select: all; }
      .hp-link-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .hp-meta { margin: 12px 0 0; font-size: 0.82rem; }
      .hp-meta code { font-size: 0.78rem; }
      .hp-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin-top: 16px; }
      .hp-hint { font-size: 0.82rem; max-width: 62ch; }
      .hp-h3 { margin: 18px 0 8px; font-size: 0.92rem; }
      .hp-sends { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
      .hp-sends li { display: grid; grid-template-columns: auto auto 1fr; gap: 12px; align-items: center; font-size: 0.86rem; padding: 8px 10px; border-radius: 8px; background: var(--sunken); }
      .hp-note { display: flex; gap: 8px; align-items: flex-start; margin: 10px 0 0; font-size: 0.84rem; }
      .hp-warn { color: var(--warning); }
      .hp-error { color: var(--negative); }
      @media (max-width: 760px) {
        .hp-refs { grid-template-columns: 1fr; }
        .hp-sends li { grid-template-columns: 1fr; gap: 4px; }
        .hp-empty { flex-direction: column; align-items: stretch; }
      }
    `,
  ],
})
export class HostPayloadCardComponent implements OnInit {
  readonly caseId = input.required<string>();

  private readonly service = inject(TradeCasesService);
  private readonly toast = inject(ToastService);

  protected readonly view = signal<HostPayloadView | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected readonly hasPayload = computed(() => Boolean(this.view()?.payload));

  protected status(s: string): { label: string; chip: string } {
    return STATUS[s] ?? { label: s, chip: 'chip-info' };
  }

  protected kindLabel(kind: string): string {
    return kind === 'PAGE' ? 'Opened the page' : kind === 'DOCUMENT' ? 'Opened a document' : 'Opened the payload PDF';
  }

  protected kb(n: number): string {
    return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  }

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.service.hostPayload(this.caseId()).subscribe({
      next: (v) => {
        this.view.set(v);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(isApiError(err) ? err.message : 'The host payload could not be loaded.');
      },
    });
  }

  private fail(err: unknown, fallback: string): void {
    this.busy.set(false);
    this.error.set(isApiError(err) ? err.message : fallback);
  }

  protected generate(): void {
    this.busy.set(true);
    this.error.set(null);
    this.service.generateHostPayload(this.caseId()).subscribe({
      next: (v) => {
        this.busy.set(false);
        this.view.set(v);
        this.toast.success('Payload generated', 'The payload PDF is ready to send to the host.');
      },
      error: (err: unknown) => this.fail(err, 'The payload could not be generated.'),
    });
  }

  protected send(): void {
    this.busy.set(true);
    this.error.set(null);
    this.service.sendToHost(this.caseId()).subscribe({
      next: (v) => {
        this.busy.set(false);
        this.view.set(v);
        const p = v.payload;
        const last = p?.deliveries[p.deliveries.length - 1];
        if (last && !last.ok) this.error.set(`${last.message}${p?.tiReference ? ` TI reference ${p.tiReference.reference} is kept.` : ''}`);
        else this.toast.success('Sent to host', p?.tiReference ? `TI reference ${p.tiReference.reference}. ${last?.mode === 'RECORDED_ONLY' ? 'Recorded for the host to open (nothing was posted).' : ''}` : '');
      },
      error: (err: unknown) => this.fail(err, 'The payload could not be sent.'),
    });
  }

  protected download(filename: string): void {
    this.busy.set(true);
    this.error.set(null);
    this.service.downloadHostPayload(this.caseId(), filename).subscribe({
      next: () => this.busy.set(false),
      error: (err: unknown) => this.fail(err, 'The PDF could not be downloaded.'),
    });
  }

  protected copy(url: string): void {
    const done = () => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, () => this.toast.info('Copy the link by hand', 'The browser did not allow copying. Select the link and copy it.'));
    } else {
      this.toast.info('Copy the link by hand', 'Select the link and copy it.');
    }
  }
}
