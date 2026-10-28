import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TradeCasesService } from '../../services/trade-cases.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { isApiError } from '../../services/api.service';
import { humanize } from '../../shared/format';
import { Icon } from '../../shared/components/icon';
import { PRE_TRADE_DOCUMENT_TYPES, type CaseDocument } from '../../models/trade-case.models';

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
  imports: [FormsModule, RouterLink, Icon],
  template: `
    <div class="page ntc-page">
      <a routerLink="/trade-cases" class="muted ntc-back">← Trade cases</a>

      @if (reference(); as ref) {
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
          <div>
            <h1>New import LC request</h1>
            <p class="muted">Add your documents — you do not need to type any details. Our AI reads each one and tells you what it is. When they are all there, send them to the bank.</p>
          </div>
        </header>

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
      }
    </div>
  `,
  styles: [
    `
      .ntc-page { padding-top: 96px; max-width: 900px; }
      .ntc-back { display: inline-block; margin-bottom: 8px; font-size: 0.85rem; }
      .ntc-h { font-size: 1rem; margin: 0 0 12px; }
      .ntc-small { font-size: 0.82rem; }
      .ntc-hint { margin: 10px 0 0; }
      .ntc-drop { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; padding: 28px 16px; border: 2px dashed var(--line); border-radius: var(--radius); cursor: pointer; position: relative; }
      .ntc-drop:hover, .ntc-drop-over { border-color: var(--accent, #00b3b3); background: color-mix(in srgb, var(--accent, #00b3b3) 6%, transparent); }
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
        .ntc-page { padding-top: 80px; }
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

  /** Save one document on the draft and let the AI read it; the answer says what the AI decided it is. */
  private async upload(id: number): Promise<void> {
    const item = this.files().find((f) => f.id === id);
    if (!item) return;
    try {
      const caseId = await this.ensureCase();
      const res = await firstValueFrom(this.service.attachDocument(caseId, item.file, 'AUTO'));
      this.patch(id, { state: 'ready', document: res.document, error: null });
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
        next: () => this.files.update((list) => list.filter((x) => x.id !== f.id)),
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
