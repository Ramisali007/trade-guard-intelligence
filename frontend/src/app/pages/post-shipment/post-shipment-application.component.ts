import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PostShipmentService } from '../../services/post-shipment.service';
import { TradeCasesService } from '../../services/trade-cases.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { isApiError } from '../../services/api.service';
import { guessPresentationType } from '../../shared/document-type';
import { humanize } from '../../shared/format';
import { APPLICATION_STATE_CHIP, APPLICATION_STATE_LABELS, type ApplicationState } from '../../models/post-shipment.models';
import { PRESENTATION_DOCUMENT_TYPES, type CaseDocument, type CaseQuery, type Finding, type TradeCaseView } from '../../models/trade-case.models';

interface UploadRow {
  file: File;
  type: string;
  error: string | null;
}

/**
 * One post-shipment application, from the client's side: the approved request it belongs to (by its reference), the
 * documents to present, a review before submitting, and then the bank's questions, corrections, discrepancies and
 * decision. Nothing is decided here: the API checks every action against the case, its state and the signed-in role.
 */
@Component({
  selector: 'app-post-shipment-application',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, DatePipe, DecimalPipe],
  template: `
    <div class="page psa-page">
      <a routerLink="/post-shipment" class="muted psa-back">← Post-Shipment</a>

      @if (error()) {
        <div class="card card-pad psa-error" role="alert">{{ error() }} <button type="button" class="btn btn-ghost btn-sm" (click)="load()">Retry</button></div>
      }

      @if (tc(); as c) {
        <header class="psa-head">
          <div>
            <div class="muted psa-kicker">Pre-shipment reference</div>
            <h1 class="psa-ref">{{ c.preShipmentReference || c.caseId }}</h1>
            <p class="muted">
              {{ terms()?.beneficiary?.name || '—' }} · {{ terms()?.goodsDescription || 'goods not described' }}
              @if (terms()?.amount) { · {{ terms()!.currency }} {{ terms()!.amount | number: '1.2-2' }} }
              · ship by {{ terms()?.latestShipmentDate || '—' }} · request {{ c.caseId }}
            </p>
          </div>
          @if (state(); as s) { <span class="chip psa-state" [class]="'chip ' + chip(s)">{{ label(s) }}</span> }
        </header>

        <!-- progress -->
        <ol class="psa-steps" aria-label="Where this application stands">
          @for (step of steps(); track step.label) {
            <li [class.done]="step.done" [class.current]="step.current"><span>{{ step.label }}</span></li>
          }
        </ol>

        @if (!app()) {
          <section class="card card-pad">
            <h2 class="psa-h">Start the post-shipment application</h2>
            <p>The bank approved this request. When the goods have shipped, upload the shipping documents here and send them to the bank. The application stays linked to reference <strong>{{ c.preShipmentReference }}</strong>.</p>
            @if (can('START_POST_SHIPMENT')) {
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="start()">Start the application</button>
            } @else {
              <p class="muted">A post-shipment application cannot be started for this request right now.</p>
            }
          </section>
        }

        @if (app(); as a) {
          <!-- the bank's questions -->
          @for (q of openQueries(); track q.queryId) {
            <section class="card card-pad psa-ask" role="status">
              <h2 class="psa-h">The bank has asked you a question</h2>
              @if (q.subject) { <p><strong>{{ q.subject }}</strong></p> }
              <p class="psa-pre">{{ q.question }}</p>
              <p class="muted psa-small">Add corrected documents below if the bank asked for them, then reply. What you added is sent to the bank with your reply.</p>
              <textarea class="input" rows="3" [(ngModel)]="replyText[q.queryId]" placeholder="Your reply"></textarea>
              <div class="row psa-actions">
                <button type="button" class="btn btn-primary" [disabled]="busy() || !(replyText[q.queryId] || '').trim()" (click)="reply(q)">Send reply{{ awaiting().length ? ' with ' + awaiting().length + ' new document' + (awaiting().length === 1 ? '' : 's') : '' }}</button>
              </div>
            </section>
          }

          <!-- documents to present -->
          <section class="card card-pad">
            <div class="row-between">
              <h2 class="psa-h">Documents ({{ currentDocs().length }})</h2>
              <span class="muted psa-small">Application {{ a.reference }}</span>
            </div>

            @if (requiredTypes().length) {
              <ul class="psa-required" aria-label="Documents the credit calls for">
                @for (t of requiredTypes(); track t) {
                  <li [class.have]="has(t)">{{ has(t) ? '✓' : '○' }} {{ humanize(t.toLowerCase()) }}</li>
                }
              </ul>
            }

            @if (can('ATTACH_PRESENTATION_DOCUMENT')) {
              <div class="psa-upload">
                <label class="btn btn-ghost psa-pick">
                  Choose files
                  <input type="file" multiple accept=".pdf,.doc,.docx" (change)="onFiles($event)" class="psa-file" />
                </label>
                <span class="muted psa-small">PDF, DOC or DOCX. Choose several at once and set the type of each. A file already in this application is refused; one you changed is accepted as a new version.</span>
              </div>
              @if (rows().length) {
                <ul class="psa-rows">
                  @for (r of rows(); track r.file; let i = $index) {
                    <li>
                      <span class="psa-name">{{ r.file.name }}</span>
                      <select class="input" [ngModel]="r.type" (ngModelChange)="setType(i, $event)" [attr.aria-label]="'Type of ' + r.file.name">
                        @for (t of types; track t) { <option [value]="t">{{ humanize(t.toLowerCase()) }}</option> }
                      </select>
                      <button type="button" class="btn btn-ghost btn-sm" (click)="dropRow(i)" [disabled]="busy()" aria-label="Remove this file from the selection" title="Remove this file from the selection">✕</button>
                      @if (r.error) { <div class="psa-rowerr" role="alert">{{ r.error }}</div> }
                    </li>
                  }
                </ul>
                <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="uploadAll()">Upload {{ rows().length }} document{{ rows().length === 1 ? '' : 's' }}</button>
              }
            }

            @if (docs().length === 0) {
              <p class="muted">No documents yet.</p>
            } @else {
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>Type</th><th>File</th><th>Version</th><th>Added</th><th></th></tr></thead>
                  <tbody>
                    @for (d of docs(); track d.linkId) {
                      <tr [class.psa-old]="d.supersededByLinkId">
                        <td>{{ humanize(d.documentType.toLowerCase()) }}</td>
                        <td>
                          {{ d.filename }}
                          @if (d.supersededByLinkId) { <span class="chip">replaced</span> }
                          @if (d.sentToBankAt === null && !d.supersededByLinkId) { <span class="chip chip-warning">not sent to the bank yet</span> }
                        </td>
                        <td>v{{ d.version }}</td>
                        <td>{{ d.uploadedAt | date: 'short' }}</td>
                        <td class="psa-doc-actions">
                          <button type="button" class="btn btn-ghost btn-sm" (click)="download(d)">Original</button>
                          @if (canRemove() && !d.supersededByLinkId) { <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy()" (click)="removeDoc(d)">Remove</button> }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }

            @if (can('SEND_DOCUMENTS') && awaiting().length) {
              <div class="psa-send" role="status">
                <span><strong>{{ awaiting().length }} document{{ awaiting().length === 1 ? '' : 's' }} added since you submitted.</strong> The bank has not received {{ awaiting().length === 1 ? 'it' : 'them' }} yet.</span>
                <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="sendCorrections()">Send to bank</button>
              </div>
            }
          </section>

          <!-- review and submit -->
          @if (a.state === 'DRAFT') {
            <section class="card card-pad">
              <h2 class="psa-h">Review and submit</h2>
              @if (missingRequired().length) {
                <p class="psa-missing" role="alert">Still to add before you can submit: {{ missingNames() }}.</p>
              } @else if (currentDocs().length === 0) {
                <p class="muted">Add at least one document.</p>
              } @else {
                <p>{{ currentDocs().length }} document{{ currentDocs().length === 1 ? '' : 's' }} ready. Once submitted the application goes to the bank's examination and you can no longer change a document yourself; you can send corrections if the bank asks.</p>
              }
              @if (can('SUBMIT_POST_SHIPMENT')) {
                @if (confirming()) {
                  <div class="row psa-actions">
                    <span>Submit to the bank now?</span>
                    <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="submit()">Yes, submit</button>
                    <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="confirming.set(false)">Not yet</button>
                  </div>
                } @else {
                  <button type="button" class="btn btn-primary" [disabled]="busy() || missingRequired().length > 0 || currentDocs().length === 0" (click)="confirming.set(true)">Submit application</button>
                }
              }
            </section>
          }

          <!-- discrepancies the bank found -->
          @if (discrepancies().length) {
            <section class="card card-pad">
              <h2 class="psa-h">Points the bank found</h2>
              <p class="muted psa-small">Correct a document and send it, or, where the point is a discrepancy you accept, say so. The bank decides once every point is settled.</p>
              @for (f of discrepancies(); track f.findingId) {
                <article class="psa-finding">
                  <strong>{{ f.title }}</strong>
                  <p>{{ f.description }}</p>
                  @if (f.applicantWaiver) {
                    <p class="muted psa-small">You {{ f.applicantWaiver.accepted ? 'accepted' : 'did not accept' }} this on {{ f.applicantWaiver.at | date: 'short' }}: {{ f.applicantWaiver.note }}</p>
                  } @else if (f.status === 'OPEN' && f.blocking && can('APPLICANT_WAIVER')) {
                    <div class="row psa-actions">
                      <input class="input" [(ngModel)]="waiverNote[f.findingId]" placeholder="A short note (optional)" [attr.aria-label]="'Note for ' + f.title" />
                      <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy()" (click)="waive(f, true)">I accept this discrepancy</button>
                      <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy()" (click)="waive(f, false)">I do not accept it</button>
                    </div>
                  }
                  @if (f.status !== 'OPEN') { <span class="chip chip-positive">settled</span> }
                </article>
              }
            </section>
          }

          <!-- decision -->
          @if (a.decision; as d) {
            <section class="card card-pad" [class.psa-ok]="d.decision === 'ACCEPTED'" [class.psa-no]="d.decision === 'REFUSED'">
              <h2 class="psa-h">{{ d.decision === 'ACCEPTED' ? 'The bank accepted the documents' : 'The bank refused the documents' }}</h2>
              <p>{{ d.rationale }}</p>
              <p class="muted psa-small">{{ d.at | date: 'medium' }}</p>
              @if (d.decision === 'REFUSED' && can('START_POST_SHIPMENT')) {
                <p>The request is approved still: you can prepare a new application with corrected documents.</p>
                <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="start()">Start a new application</button>
              }
            </section>
          }
        }
      } @else if (!error()) {
        <div class="card card-pad muted">Loading…</div>
      }
    </div>
  `,
  styles: [
    `
      .psa-page { padding-top: 96px; display: flex; flex-direction: column; gap: 16px; }
      .psa-error { border-color: var(--negative); color: var(--negative); display: flex; gap: 12px; align-items: center; }
      .psa-head { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: flex-start; }
      .psa-kicker { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
      .psa-ref { font-family: var(--font-mono, monospace); margin: 2px 0 6px; }
      .psa-h { font-size: 1.05rem; margin: 0 0 8px; }
      .psa-small { font-size: 0.85rem; }
      .psa-pre { white-space: pre-wrap; }
      .psa-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
      .psa-steps li { padding: 8px 10px; border-radius: var(--radius-sm); background: var(--sunken); text-align: center; font-size: 0.88rem; color: var(--ink-muted); }
      .psa-steps li.done { background: var(--positive-bg, #ecfdf5); color: var(--positive, #065f46); }
      .psa-steps li.current { background: var(--info-bg, #eef2ff); color: var(--ink); font-weight: 600; }
      .psa-ask { border-color: var(--warning); }
      .psa-required { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 0.92rem; }
      .psa-required li { color: var(--ink-muted); }
      .psa-required li.have { color: var(--positive, #065f46); }
      .psa-upload { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 8px; }
      .psa-pick { position: relative; overflow: hidden; }
      .psa-file { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
      .psa-rows { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .psa-rows li { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .psa-name { flex: 1 1 220px; word-break: break-all; }
      .psa-rows select { max-width: 240px; }
      .psa-rowerr { flex-basis: 100%; color: var(--negative); font-size: 0.85rem; }
      .psa-old td { opacity: 0.6; }
      .psa-doc-actions { white-space: nowrap; }
      .psa-send { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-top: 12px; padding: 10px 12px; border: 1px solid var(--warning); border-radius: var(--radius-sm); }
      .psa-missing { color: var(--warning); }
      .psa-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
      .psa-finding { border-top: 1px solid var(--line); padding: 10px 0; }
      .psa-ok { border-color: var(--positive); }
      .psa-no { border-color: var(--negative); }
      @media (max-width: 640px) { .psa-page { padding-top: 80px; } .psa-steps { grid-template-columns: repeat(2, 1fr); } }
    `,
  ],
})
export class PostShipmentApplicationComponent implements OnInit {
  /** Route parameter (component input binding): the trade case id of the approved request. */
  readonly id = input.required<string>();

  private readonly service = inject(PostShipmentService);
  private readonly cases = inject(TradeCasesService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly types = PRESENTATION_DOCUMENT_TYPES;
  protected readonly humanize = humanize;
  protected readonly tc = signal<TradeCaseView | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirming = signal(false);
  protected readonly rows = signal<UploadRow[]>([]);
  protected readonly replyText: Record<string, string> = {};
  protected readonly waiverNote: Record<string, string> = {};

  /** The approved terms the application is made against. */
  protected readonly terms = computed(() => {
    const c = this.tc();
    return c ? c.issuedLc?.effectiveTerms ?? c.applicationVersions[c.applicationVersions.length - 1]?.data ?? null : null;
  });

  /** The application in progress, or the latest one. */
  protected readonly app = computed(() => {
    const list = this.tc()?.presentations ?? [];
    return list[list.length - 1] ?? null;
  });

  protected readonly state = computed<ApplicationState | null>(() => (this.app()?.state as ApplicationState | undefined) ?? null);

  protected readonly docs = computed<CaseDocument[]>(() => {
    const a = this.app();
    return a ? (this.tc()?.documents ?? []).filter((d) => d.presentationId === a.presentationId) : [];
  });
  protected readonly currentDocs = computed(() => this.docs().filter((d) => !d.supersededByLinkId));
  protected readonly awaiting = computed(() => this.currentDocs().filter((d) => d.sentToBankAt === null));
  protected readonly openQueries = computed<CaseQuery[]>(() => (this.tc()?.queries ?? []).filter((q) => q.assignee === 'CUSTOMER' && q.status === 'OPEN'));
  protected readonly requiredTypes = computed(() => (this.terms()?.requiredDocuments ?? []).filter((t) => (PRESENTATION_DOCUMENT_TYPES as readonly string[]).includes(t)));
  protected readonly missingRequired = computed(() => this.requiredTypes().filter((t) => !this.has(t)));
  protected readonly discrepancies = computed<Finding[]>(() => {
    const a = this.app();
    return a ? (this.tc()?.findings ?? []).filter((f) => f.presentationId === a.presentationId && f.category === 'DOCUMENTARY_DISCREPANCY') : [];
  });

  protected readonly steps = computed(() => {
    const s = this.state();
    // How many steps are behind the client: approval only, then preparing, then the bank has it, then decided.
    const done = s === null || s === 'DRAFT' ? 1 : s === 'ACCEPTED' || s === 'REFUSED' ? 4 : 2;
    return ['Approved', 'Prepare documents', 'Bank examination', 'Decision'].map((label, i) => ({ label, done: i < done, current: i === done && done < 4 }));
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set(null);
    this.cases.get(this.id()).subscribe({
      next: (c) => this.tc.set(c),
      error: (err: unknown) => this.error.set(isApiError(err) ? err.message : 'The request could not be loaded.'),
    });
  }

  protected can(action: string): boolean {
    return (this.tc()?.availableActions ?? []).includes(action);
  }
  protected canRemove(): boolean {
    return this.can('REMOVE_PRESENTATION_DOCUMENT') && this.state() === 'DRAFT';
  }
  protected has(type: string): boolean {
    return this.currentDocs().some((d) => d.documentType === type);
  }
  protected missingNames(): string {
    return this.missingRequired().map((t) => humanize(t.toLowerCase())).join(', ');
  }
  protected label(s: ApplicationState): string {
    return APPLICATION_STATE_LABELS[s];
  }
  protected chip(s: ApplicationState): string {
    return APPLICATION_STATE_CHIP[s];
  }

  /** Run one action: show the result, or the server's own words if it refused. */
  private run(call: Promise<TradeCaseView>, done: string, after?: () => void): void {
    this.busy.set(true);
    this.error.set(null);
    call
      .then((c) => {
        this.tc.set(c);
        this.busy.set(false);
        this.toast.success(done);
        after?.();
      })
      .catch((err: unknown) => {
        this.busy.set(false);
        this.error.set(isApiError(err) ? err.message : 'That did not work. Please try again.');
      });
  }

  start(): void {
    this.run(firstValueFrom(this.service.start(this.id())), 'Application started');
  }

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []).map((file) => ({ file, type: guessPresentationType(file.name), error: null }));
    this.rows.set([...this.rows(), ...picked]);
    input.value = '';
  }
  setType(i: number, type: string): void {
    this.rows.set(this.rows().map((r, k) => (k === i ? { ...r, type } : r)));
  }
  dropRow(i: number): void {
    this.rows.set(this.rows().filter((_, k) => k !== i));
  }

  /** One file at a time, so a refusal (the same file twice, a wrong state) names the file it is about and the rest still go. */
  async uploadAll(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    let latest: TradeCaseView | null = null;
    let sent = 0;
    for (const row of [...this.rows()]) {
      try {
        const res = await firstValueFrom(this.service.attach(this.id(), row.file, row.type));
        latest = res.tradeCase;
        sent++;
        this.rows.set(this.rows().filter((r) => r !== row));
      } catch (err) {
        this.rows.set(this.rows().map((r) => (r === row ? { ...r, error: isApiError(err) ? err.message : 'The upload failed.' } : r)));
      }
    }
    if (latest) this.tc.set(latest);
    this.busy.set(false);
    if (sent) this.toast.success(`${sent} document${sent === 1 ? '' : 's'} added`, this.state() === 'DRAFT' ? undefined : 'Send them to the bank when you are ready.');
  }

  removeDoc(d: CaseDocument): void {
    this.run(firstValueFrom(this.service.remove(this.id(), d.linkId)), `${d.filename} removed`);
  }

  submit(): void {
    this.run(firstValueFrom(this.service.submit(this.id())), 'Submitted to the bank', () => this.confirming.set(false));
  }

  sendCorrections(): void {
    this.run(firstValueFrom(this.service.sendCorrections(this.id())), 'Sent to the bank');
  }

  reply(q: CaseQuery): void {
    const links = this.awaiting().map((d) => d.linkId);
    this.run(firstValueFrom(this.service.respond(this.id(), q.queryId, (this.replyText[q.queryId] ?? '').trim(), links)), 'Reply sent to the bank', () => delete this.replyText[q.queryId]);
  }

  waive(f: Finding, accept: boolean): void {
    this.run(firstValueFrom(this.service.waive(this.id(), f.findingId, accept, this.waiverNote[f.findingId]?.trim() || (accept ? 'Discrepancy accepted by the applicant.' : 'Not accepted.'))), accept ? 'Recorded: you accept this discrepancy' : 'Recorded: you do not accept it');
  }

  download(d: CaseDocument): void {
    this.cases.downloadDocument(this.id(), d.linkId, d.filename).subscribe({ error: () => this.toast.error('Download failed', d.filename) });
  }
}
