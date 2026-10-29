import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TradeCasesService } from '../../services/trade-cases.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { isApiError } from '../../services/api.service';
import { humanize } from '../../shared/format';
import { Icon } from '../../shared/components/icon';
import { PRE_TRADE_DOCUMENT_TYPES, type CaseDocument, type LcApplicationData } from '../../models/trade-case.models';

/** What the AI read, in the order a customer checks it. quantity and amount are joined with their unit and currency. */
const READ_FIELDS: Array<{ path: string; label: string }> = [
  { path: 'beneficiary.name', label: 'Seller (beneficiary)' },
  { path: 'beneficiary.country', label: 'Seller country' },
  { path: 'beneficiary.address', label: 'Seller address' },
  { path: 'proformaInvoiceNumber', label: 'Proforma invoice number' },
  { path: 'amount', label: 'Amount' },
  { path: 'goodsDescription', label: 'Goods' },
  { path: 'hsCode', label: 'HS code' },
  { path: 'quantity', label: 'Quantity' },
  { path: 'unitPrice', label: 'Unit price' },
  { path: 'incoterm', label: 'Incoterm' },
  { path: 'countryOfOrigin', label: 'Country of origin' },
  { path: 'portOfLoading', label: 'Port of loading' },
  { path: 'portOfDischarge', label: 'Port of discharge' },
  { path: 'paymentTerms', label: 'Payment terms' },
  { path: 'latestShipmentDate', label: 'Latest shipment date' },
  { path: 'expiryDate', label: 'Expiry date' },
];

type UploadState = 'uploading' | 'ready' | 'failed';

interface QueuedFile {
  id: number;
  file: File;
  state: UploadState;
  error: string | null;
  /** What the case now holds for this file, including what the AI decided it is. */
  document: CaseDocument | null;
  changing: boolean;
}

/** The server accepts a handful of uploads a minute; stay well inside it. */
const MAX_FILES = 15;

/**
 * A new import LC request. The customer types nothing about the deal. Each document is saved on the
 * request the moment it is added, and the AI reads it there and then and says what it is (proforma
 * invoice, contract, permit...). The customer checks that, corrects it if the AI was wrong, and
 * sends the request to the bank, which gets a reference number. Everything is saved as it goes, so
 * a request left half-way is a draft the customer can find again.
 */
@Component({
  selector: 'app-new-trade-case',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, AnimatedCounter],
  template: `
    <div class="page ntc-page">
      @if (reference(); as ref) {
        <a routerLink="/trade-cases" class="muted ntc-back">← Trade cases</a>
        <section class="card card-pad ntc-done" aria-live="polite">
          <div class="ntc-done-icon"><app-icon name="check" [size]="26" /></div>
          <h1>Sent to the bank</h1>
          <p class="muted">Quote this reference number to the bank. Your documents are with the bank's trade desk, who will review them.</p>
          <div class="ntc-ref" role="group" aria-label="Reference number">
            <span class="ntc-ref-label">Reference number</span>
            <strong class="ntc-ref-value">{{ ref }}</strong>
            <button type="button" class="btn btn-ghost btn-sm" (click)="copyReference(ref)"><app-icon name="page" [size]="13" /> Copy</button>
          </div>
          <p class="muted ntc-small">{{ readyCount() }} document{{ readyCount() === 1 ? '' : 's' }} sent. You can follow the progress, and add or replace documents, from the case page.</p>
          <div class="row ntc-actions">
            <a [routerLink]="['/trade-cases', ref]" class="btn btn-primary">Open the case</a>
            <a routerLink="/trade-cases" class="btn btn-ghost">Back to trade cases</a>
          </div>
        </section>
      } @else {
        <header class="page-head">
          <a routerLink="/trade-cases" class="page-head-back">← Trade cases</a>
          <div>
            <h1>New import LC request</h1>
            <p class="muted">Add your documents — you do not need to type any details. Our AI reads each one, tells you what it is and shows you what it found. Check it, then decide whether to send it to the bank.</p>
          </div>
          <section class="page-head-kpis" aria-label="Summary">
            <div class="kpi-tile">
              <span class="kpi-tile-label">Documents added</span>
              <strong class="kpi-tile-value"><app-animated-counter [value]="files().length" /></strong>
              <span class="kpi-tile-note">up to {{ maxFiles }} files</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-tile-label">Read by the AI</span>
              <strong class="kpi-tile-value"><app-animated-counter [value]="uploadedCount()" /></strong>
              <span class="kpi-tile-note">identified and ready</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-tile-label">Proforma invoice</span>
              <strong class="kpi-tile-value is-text" [class.is-warn]="!hasProforma()">{{ hasProforma() ? 'Added' : 'Not added yet' }}</strong>
              <span class="kpi-tile-note">the document the bank starts from</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-tile-label">Ready to send</span>
              <strong class="kpi-tile-value is-text">{{ canSend() ? 'Yes' : 'Not yet' }}</strong>
              <span class="kpi-tile-note">add at least one document</span>
            </div>
          </section>
        </header>

        <div class="ntc-layout">
        <div class="stack">
          @if (!auth.isCustomer()) {
            <section class="card card-pad">
              <h2 class="ntc-h">Customer</h2>
              <label class="field">
                <span>Customer reference</span>
                <input class="input" name="customerRef" [(ngModel)]="customerRef" [disabled]="caseId() !== null" placeholder="e.g. TG-CORP-1001" />
                <small class="muted">You are filing on the customer's behalf; the case is visible to that customer.</small>
              </label>
            </section>
          }

          <section class="card card-pad">
            <h2 class="ntc-h">Documents</h2>
            <label
              class="ntc-drop"
              [class.ntc-drop-over]="dragging()"
              [class.ntc-drop-off]="!canAdd()"
              (dragover)="onDragOver($event)"
              (dragleave)="dragging.set(false)"
              (drop)="onDrop($event)"
            >
              <app-icon name="upload" [size]="22" />
              <strong>Choose documents or drop them here</strong>
              <span class="muted ntc-small">Proforma invoice, purchase contract or order, import permit, LC application form — PDF, DOC or DOCX, up to {{ maxFiles }} files.</span>
              <input type="file" multiple accept=".pdf,.doc,.docx" (change)="onPick($event)" [disabled]="!canAdd()" />
            </label>

            @if (files().length > 0) {
              <ul class="ntc-files">
                @for (f of files(); track f.id) {
                  <li class="ntc-file" [class.ntc-file-failed]="f.state === 'failed'">
                    <div class="ntc-file-main">
                      <span class="ntc-file-name" [title]="f.file.name">{{ f.file.name }}</span>
                      <span class="muted ntc-small">{{ sizeLabel(f.file.size) }}</span>
                    </div>

                    @switch (f.state) {
                      @case ('uploading') {
                        <span class="ntc-reading"><span class="ntc-spin" aria-hidden="true"></span> The AI is reading this document…</span>
                      }
                      @case ('failed') {
                        <span class="ntc-file-error">{{ f.error }}</span>
                      }
                      @case ('ready') {
                        @if (f.document; as d) {
                          <div class="ntc-detect">
                            @if (d.typeSource === 'AI') {
                              <span class="chip chip-positive" title="{{ d.detection?.reason }}">Recognised by the AI · {{ confidence(d) }}</span>
                            } @else if (d.typeSource === 'CUSTOMER') {
                              <span class="chip chip-info">Chosen by you</span>
                            } @else {
                              <span class="chip chip-warning">Not recognised</span>
                            }
                            <select class="input ntc-type" [ngModel]="d.documentType" (ngModelChange)="retype(f, $event)" [disabled]="busy() || f.changing" aria-label="Document type">
                              @for (t of types; track t) { <option [value]="t">{{ label(t) }}</option> }
                            </select>
                          </div>
                          @if (d.detection?.type === 'SHIPPING_DOCUMENT') {
                            <p class="ntc-warn">This looks like a shipping document ({{ d.detection?.title }}). Those are sent after the LC is issued, not with the application. Remove it, or change its type if the AI is wrong.</p>
                          } @else if (d.typeSource === 'UNDETECTED') {
                            <p class="ntc-warn">{{ d.detectionError || 'The AI could not tell what this document is.' }} Please choose its type.</p>
                          } @else if (d.detection?.title) {
                            <p class="muted ntc-small">The document calls itself “{{ d.detection?.title }}”.</p>
                          }
                        }
                      }
                    }
                    <button type="button" class="btn btn-ghost btn-sm" (click)="remove(f)" [disabled]="busy() || f.changing || f.state === 'uploading'" [attr.aria-label]="'Remove ' + f.file.name">Remove</button>
                  </li>
                }
              </ul>
            }

            @if (files().length > 0 && uploadedCount() > 0 && !hasProforma()) {
              <p class="muted ntc-small ntc-hint">No proforma invoice has been recognised yet. You can still send the request; the bank will ask for it.</p>
            }
          </section>

          @if (files().length > 0) {
            <section class="card card-pad ntc-read" aria-live="polite" aria-label="What the AI read from your documents">
              <div class="row-between ntc-read-head">
                <h2 class="ntc-h">What the AI read from your documents</h2>
                @if (reading()) {
                  <span class="ntc-read-state"><span class="ntc-spin" aria-hidden="true"></span> Reading@if (progress(); as p) { {{ p.read }} of {{ p.total }} documents }…</span>
                } @else if (read()) {
                  <span class="chip chip-positive">Read from your documents</span>
                }
              </div>
              <p class="muted ntc-small">Check this before you send. Nothing goes to the bank until you press “Send to the bank”. If something is wrong, remove that document and add the corrected one.</p>
              @if (read(); as r) {
                <dl class="ntc-read-grid">
                  @for (f of readFields; track f.path) {
                    <div class="ntc-read-item" [class.ntc-read-miss]="!readValue(r, f.path)">
                      <dt>{{ f.label }}</dt>
                      <dd>{{ readValue(r, f.path) || 'Not found in your documents' }}</dd>
                    </div>
                  }
                </dl>
                @if (readDocuments(r); as needed) {
                  <p class="muted ntc-small ntc-read-foot">The credit calls for: {{ needed }}.</p>
                }
              } @else if (reading()) {
                <p class="muted ntc-small">This can take a minute or two for each document. You can wait here, or leave and come back: the draft is saved.</p>
                <div class="ntc-read-skeleton" aria-hidden="true">
                  @for (n of [1, 2, 3, 4, 5, 6]; track n) { <span></span> }
                </div>
              } @else {
                <p class="muted ntc-small">
                  @if ((progress()?.failed ?? 0) > 0) { The AI could not read {{ progress()?.failed }} of these documents. }
                  @else { The AI did not find application details in these documents. }
                  You can still send them: the bank reads them too.
                </p>
              }
            </section>
          }

          @if (error()) { <div class="card card-pad ntc-error" role="alert">{{ error() }}</div> }

          <div class="row ntc-actions">
            <button type="button" class="btn btn-primary" [disabled]="!canSend()" (click)="send()">
              {{ busy() ? 'Sending to the bank…' : 'Send to the bank' }}
            </button>
            <a routerLink="/trade-cases" class="btn btn-ghost">Cancel</a>
          </div>
          @if (caseId(); as id) {
            <p class="muted ntc-small">Saved as draft {{ id }}. If you leave now, you can find it in your trade cases and continue.</p>
          }
        </div>
        <aside class="card card-pad ntc-help" aria-label="How it works">
          <h2 class="ntc-h">How it works</h2>
          <ol class="ntc-help-steps">
            <li><strong>Add your documents</strong><span>The proforma invoice, the purchase contract or order, the import permit and the LC application form.</span></li>
            <li><strong>Our AI reads them</strong><span>It tells you what each document is and shows you the details it found. You never type any details.</span></li>
            <li><strong>Check, then send</strong><span>Nothing reaches the bank until you press Send. Then its trade desk reviews the documents against the rules.</span></li>
            <li><strong>Follow the progress</strong><span>If something needs fixing you get one message with everything, and you reply with the corrected documents.</span></li>
          </ol>
        </aside>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .ntc-page { max-width: none; }
      .ntc-layout { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 20px; align-items: start; }
      .ntc-help { position: sticky; top: 92px; }
      .ntc-help-steps { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 16px; counter-reset: help; }
      .ntc-help-steps li { position: relative; display: flex; flex-direction: column; gap: 2px; padding-left: 44px; counter-increment: help; }
      .ntc-help-steps li::before { content: counter(help); position: absolute; left: 0; top: 0; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; font-weight: 800; font-size: 0.85rem; color: #ffffff; background: linear-gradient(135deg, #00a3a3, #006b6b); box-shadow: 0 8px 16px -8px rgb(0 128 128 / 70%); }
      .ntc-help-steps li:not(:last-child)::after { content: ''; position: absolute; left: 14px; top: 34px; bottom: -14px; width: 2px; background: color-mix(in srgb, var(--accent) 28%, var(--line)); }
      .ntc-help-steps strong { font-size: 0.95rem; }
      .ntc-help-steps span { font-size: 0.86rem; color: var(--ink-3); line-height: 1.5; }
      @media (max-width: 1100px) { .ntc-layout { grid-template-columns: 1fr; } .ntc-help { position: static; } }
      .ntc-read { background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 7%, var(--raised)), var(--raised) 65%); border-left: 4px solid var(--accent); }
      .ntc-read-head { gap: 12px; margin-bottom: 4px; }
      .ntc-read-head .ntc-h { margin: 0; }
      .ntc-read-state { display: inline-flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 650; color: var(--accent); }
      .ntc-read-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; margin: 14px 0 0; }
      .ntc-read-item { margin: 0; padding: 10px 14px; border-radius: 14px; background: var(--raised); border: 1px solid var(--line); animation: ntc-pop 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; transition: transform 0.25s ease, box-shadow 0.25s ease; }
      .ntc-read-item:hover { transform: translateY(-2px); box-shadow: 0 12px 22px -16px rgb(0 128 128 / 50%); }
      .ntc-read-item dt { font-size: 0.7rem; font-weight: 750; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
      .ntc-read-item dd { margin: 2px 0 0; font-weight: 650; overflow-wrap: anywhere; }
      .ntc-read-miss { background: var(--sunken); }
      .ntc-read-miss dd { font-weight: 500; font-style: italic; color: var(--ink-muted); }
      .ntc-read-foot { margin: 12px 0 0; }
      .ntc-read-skeleton { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; margin-top: 14px; }
      .ntc-read-skeleton span { height: 58px; border-radius: 14px; background: linear-gradient(90deg, var(--sunken) 25%, color-mix(in srgb, var(--accent) 10%, var(--sunken)) 50%, var(--sunken) 75%); background-size: 200% 100%; animation: ntc-shimmer 1.4s linear infinite; }
      @keyframes ntc-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
      @keyframes ntc-pop { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      .ntc-back { display: inline-block; margin-bottom: 8px; font-size: 0.85rem; }
      .ntc-h { font-size: 1rem; margin: 0 0 12px; }
      .ntc-small { font-size: 0.82rem; }
      .ntc-hint { margin: 10px 0 0; }
      .ntc-drop { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; padding: 34px 16px; border: 2px dashed color-mix(in srgb, var(--accent) 38%, var(--line)); border-radius: var(--radius-xl); cursor: pointer; position: relative; background: linear-gradient(180deg, color-mix(in srgb, var(--accent-soft) 60%, transparent), transparent); transition: transform var(--dur) var(--ease), border-color var(--dur) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
      .ntc-drop app-icon { color: var(--accent); animation: soft-float 4s ease-in-out infinite; }
      .ntc-drop:hover, .ntc-drop-over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 9%, transparent); transform: translateY(-2px); box-shadow: 0 16px 30px -18px rgb(0 128 128 / 45%); }
      .ntc-drop-over { transform: scale(1.01); }
      .ntc-drop-off { opacity: 0.55; cursor: not-allowed; }
      .ntc-drop input[type='file'] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
      .ntc-files { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .ntc-file { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr) auto; gap: 10px 14px; align-items: center; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius); }
      .ntc-file-failed { border-color: var(--negative); }
      .ntc-file-main { display: flex; flex-direction: column; min-width: 0; }
      .ntc-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
      .ntc-file-error { color: var(--negative); font-size: 0.85rem; }
      .ntc-detect { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .ntc-type { min-width: 0; max-width: 240px; }
      .ntc-warn { grid-column: 1 / -1; margin: 0; font-size: 0.85rem; color: var(--warning, #b7791f); }
      .ntc-reading { display: inline-flex; gap: 8px; align-items: center; font-size: 0.88rem; }
      .ntc-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--accent, #00b3b3); animation: ntc-rot 0.8s linear infinite; }
      @keyframes ntc-rot { to { transform: rotate(360deg); } }
      .ntc-error { border-color: var(--negative); color: var(--negative); }
      .ntc-actions { gap: 10px; margin-bottom: 48px; }
      .ntc-done { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; padding-top: 32px; }
      .ntc-done h1 { margin: 0; }
      .ntc-done-icon { width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--positive, #1f9d63) 16%, transparent); color: var(--positive, #1f9d63); }
      .ntc-ref { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: center; padding: 14px 20px; border: 1px solid var(--line); border-radius: var(--radius); }
      .ntc-ref-label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted, #6b7280); }
      .ntc-ref-value { font-size: 1.6rem; letter-spacing: 0.04em; }
      @media (max-width: 640px) {
        
        .ntc-file { grid-template-columns: 1fr; }
      }
    `,
  ],
})
export class NewTradeCaseComponent {
  readonly auth = inject(AuthService);
  private readonly service = inject(TradeCasesService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly types = PRE_TRADE_DOCUMENT_TYPES;
  protected readonly maxFiles = MAX_FILES;
  /** One id per request: a double-click or a retried request returns the same draft, not a second one. */
  private readonly clientRequestId = crypto.randomUUID();
  private nextFileId = 1;
  /** Creating the draft happens once, however many files arrive at the same time. */
  private creating: Promise<string> | null = null;
  /** Files are read one after another: the server limits uploads per minute and the AI reads each one. */
  private queue: Promise<void> = Promise.resolve();

  customerRef = '';
  readonly files = signal<QueuedFile[]>([]);
  readonly dragging = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  /** Set as soon as the first document is added: the request exists, as a draft, from then on. */
  readonly caseId = signal<string | null>(null);

  /** What the AI has read into the application so far, and whether it is still reading. */
  readonly read = signal<LcApplicationData | null>(null);
  readonly reading = signal(false);
  /** How many of the documents the AI has read so far. */
  readonly progress = signal<{ total: number; read: number; failed: number } | null>(null);
  protected readonly readFields = READ_FIELDS;
  private watchToken = 0;
  private readonly destroyRef = inject(DestroyRef);
  /** The reference number shown to the customer once the request has been sent. */
  readonly reference = signal<string | null>(null);

  readonly uploadedCount = computed(() => this.files().filter((f) => f.state === 'ready').length);
  readonly readyCount = this.uploadedCount;
  readonly uploading = computed(() => this.files().some((f) => f.state === 'uploading' || f.changing));
  readonly hasProforma = computed(() => this.files().some((f) => f.document?.documentType === 'PROFORMA_INVOICE'));
  readonly canAdd = computed(() => !this.busy() && (this.auth.isCustomer() || this.caseId() !== null || this.customerRef.trim().length > 0));
  readonly canSend = computed(() => !this.busy() && !this.uploading() && this.uploadedCount() > 0);

  label(type: string): string {
    return humanize(type.toLowerCase());
  }

  sizeLabel(bytes: number): string {
    return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  confidence(d: CaseDocument): string {
    return `${Math.round((d.detection?.confidence ?? 0) * 100)}% sure`;
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.add(Array.from(input.files ?? []));
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (this.canAdd()) this.add(Array.from(event.dataTransfer?.files ?? []));
  }

  private add(picked: File[]): void {
    const allowed = picked.filter((f) => /\.(pdf|docx?)$/i.test(f.name));
    const rejected = picked.length - allowed.length;
    const room = MAX_FILES - this.files().length;
    const accepted = allowed.slice(0, Math.max(0, room));
    if (rejected > 0) this.error.set(`${rejected} file${rejected === 1 ? ' was' : 's were'} skipped: only PDF, DOC and DOCX documents can be sent.`);
    else if (allowed.length > accepted.length) this.error.set(`At most ${MAX_FILES} documents can be sent in one request.`);
    else this.error.set(null);
    for (const file of accepted) {
      const item: QueuedFile = { id: this.nextFileId++, file, state: 'uploading', error: null, document: null, changing: false };
      this.files.update((list) => [...list, item]);
      this.queue = this.queue.then(() => this.upload(item.id));
    }
  }

  private patch(id: number, change: Partial<QueuedFile>): void {
    this.files.update((list) => list.map((f) => (f.id === id ? { ...f, ...change } : f)));
  }

  /** The draft request, created the first time it is needed. */
  private ensureCase(): Promise<string> {
    const existing = this.caseId();
    if (existing) return Promise.resolve(existing);
    this.creating ??= firstValueFrom(
      this.service.create({
        clientRequestId: this.clientRequestId,
        // Only who is asking, which the login already knows; nothing about the deal is typed.
        application: this.auth.isCustomer() ? { applicant: { name: this.auth.currentUser()?.name ?? '', address: '', country: 'Pakistan' } } : {},
        ...(this.auth.isCustomer() ? {} : { customerRef: this.customerRef.trim() }),
      }),
    ).then((created) => {
      this.caseId.set(created.caseId);
      return created.caseId;
    });
    return this.creating.catch((err: unknown) => {
      this.creating = null;
      throw err;
    });
  }

  /** The value as the customer reads it: the amount with its currency, the quantity with its unit; blank when not found. */
  protected readValue(r: LcApplicationData, path: string): string {
    const raw = path.split('.').reduce<unknown>((v, p) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[p] : undefined), r);
    if (raw === null || raw === undefined || raw === '') return '';
    const num = (n: unknown): string => Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 });
    if (path === 'amount') return `${r.currency ? r.currency + ' ' : ''}${num(raw)}`;
    if (path === 'quantity') return `${num(raw)}${r.unitOfMeasure ? ' ' + r.unitOfMeasure : ''}`;
    if (path === 'incoterm') return `${String(raw)}${r.namedPlace ? ' ' + r.namedPlace : ''}`;
    if (typeof raw === 'number') return num(raw);
    if (path === 'paymentTerms') return humanize(String(raw).toLowerCase());
    return String(raw);
  }

  protected readDocuments(r: LcApplicationData): string {
    return (r.requiredDocuments ?? []).map((t) => humanize(String(t).toLowerCase())).join(', ');
  }

  /**
   * Looks at the draft until the AI has finished reading, so the details show here as they appear. A document is read
   * a few seconds after it is added; each one that finishes adds to the application, so it keeps looking until nothing
   * new has appeared for a while.
   */
  private async watchReading(): Promise<void> {
    const caseId = this.caseId();
    if (!caseId) return;
    const token = ++this.watchToken;
    this.destroyRef.onDestroy(() => (this.watchToken = -1));
    this.reading.set(true);
    const started = Date.now();
    let settledLooks = 0;
    // The model takes a minute or more per document, so this waits for as long as it is working, not for a fixed time.
    while (token === this.watchToken && Date.now() - started < 15 * 60_000) {
      try {
        const view = await firstValueFrom(this.service.get(caseId));
        if (token !== this.watchToken) return;
        const filled = [...view.applicationVersions].reverse().find((v) => v.createdBy === 'SYSTEM');
        if (filled) this.read.set(filled.data);
        const p = view.readingProgress ?? null;
        this.progress.set(p);
        // Every document is read (or could not be): look twice more for the application to catch up, then stop.
        settledLooks = p && p.total > 0 && p.read + p.failed >= p.total ? settledLooks + 1 : 0;
        if (settledLooks >= 3) break;
      } catch {
        // a missed look is not an error: try again
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (token === this.watchToken) this.reading.set(false);
  }

  /** Save one document on the draft and let the AI read it; the answer says what the AI decided it is. */
  private async upload(id: number): Promise<void> {
    const item = this.files().find((f) => f.id === id);
    if (!item) return;
    try {
      const caseId = await this.ensureCase();
      const res = await firstValueFrom(this.service.attachDocument(caseId, item.file, 'AUTO'));
      this.patch(id, { state: 'ready', document: res.document, error: null });
      void this.watchReading();
    } catch (err) {
      this.patch(id, { state: 'failed', error: isApiError(err) ? err.message : 'This document could not be sent.' });
    }
  }

  /** The customer says what the document is, when the AI was wrong or could not tell. */
  retype(f: QueuedFile, type: string): void {
    const caseId = this.caseId();
    const current = f.document;
    if (!caseId || !current || current.documentType === type) return;
    this.patch(f.id, { changing: true });
    this.service.retypeDocument(caseId, current.linkId, type).subscribe({
      next: (view) => {
        const link = view.documents.find((d) => d.documentId === current.documentId && !d.supersededByLinkId && d.stage === 'PRE_TRADE');
        this.patch(f.id, { changing: false, document: link ?? current });
      },
      error: (err: unknown) => {
        this.patch(f.id, { changing: false });
        this.error.set(isApiError(err) ? err.message : 'The type could not be changed.');
      },
    });
  }

  remove(f: QueuedFile): void {
    const caseId = this.caseId();
    if (f.document && caseId) {
      this.patch(f.id, { changing: true });
      this.service.removeDocument(caseId, f.document.linkId).subscribe({
        next: () => {
          this.files.update((list) => list.filter((x) => x.id !== f.id));
          if (this.files().length === 0) this.read.set(null);
        },
        error: (err: unknown) => {
          this.patch(f.id, { changing: false });
          this.error.set(isApiError(err) ? err.message : 'The document could not be removed.');
        },
      });
    } else {
      this.files.update((list) => list.filter((x) => x.id !== f.id));
    }
  }

  /** Send the request to the bank: it is submitted, and the reference number is shown. */
  async send(): Promise<void> {
    const caseId = this.caseId();
    if (!caseId || !this.canSend()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      if (this.auth.can('tradecase.submit')) {
        await firstValueFrom(this.service.action(caseId, 'submit'));
        this.reference.set(caseId);
      } else {
        // Bank staff who may attach but not submit leave the case as a draft for the customer or RM.
        this.toast.success('Documents saved', `${caseId}: it stays a draft until the customer or relationship manager submits it.`);
        void this.router.navigate(['/trade-cases', caseId]);
      }
    } catch (err) {
      this.error.set(isApiError(err) ? err.message : 'The request could not be sent.');
    } finally {
      this.busy.set(false);
    }
  }

  copyReference(ref: string): void {
    void navigator.clipboard?.writeText(ref).then(
      () => this.toast.success('Copied', ref),
      () => this.toast.error('Could not copy', 'Select the number and copy it manually.'),
    );
  }
}
