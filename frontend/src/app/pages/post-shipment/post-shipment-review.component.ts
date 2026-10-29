import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PostShipmentService } from '../../services/post-shipment.service';
import { TradeCasesService } from '../../services/trade-cases.service';
import { ToastService } from '../../services/toast.service';
import { isApiError } from '../../services/api.service';
import { humanize } from '../../shared/format';
import { DISPOSITIONS, dispositionLabel } from '../../shared/dispositions';
import {
  APPLICATION_STATE_CHIP,
  APPLICATION_STATE_LABELS,
  FINDING_CLASS_CHIP,
  FINDING_CLASS_LABELS,
  FINDING_CLASS_ORDER,
  type ApplicationState,
  type FindingClass,
  type PostShipmentReview,
  type ReviewDocument,
  type ReviewFinding,
} from '../../models/post-shipment.models';

/**
 * The officer's examination of one post-shipment application: what the client submitted beside what the bank approved,
 * a field-by-field comparison, and the findings by how much they should hold the case. The rules and the comparison are
 * evidence for the officer; the decision to accept, ask for clarification or refuse is theirs and is recorded with a reason.
 */
@Component({
  selector: 'app-post-shipment-review',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, DatePipe, DecimalPipe, AnimatedCounter],
  template: `
    <div class="page psr-page">
      @if (!r()) {
        <a [routerLink]="['/trade-cases', id()]" class="muted psr-back">← Case {{ id() }}</a>
      }

      @if (error()) {
        <div class="card card-pad psr-error" role="alert">{{ error() }}</div>
      }

      @if (r(); as v) {
        <header class="page-head psr-head">
          <a [routerLink]="['/trade-cases', id()]" class="page-head-back">← Case {{ id() }}</a>
          <div>
            <div class="muted psr-kicker">Post-shipment examination · pre-shipment reference</div>
            <h1 class="psr-ref">{{ v.reference }}</h1>
            <p class="muted">
              {{ v.credit.terms.beneficiary }} → {{ v.credit.terms.applicant }} · {{ v.credit.terms.goodsDescription || 'goods not described' }}
              @if (v.credit.terms.amount) { · {{ v.credit.terms.currency }} {{ v.credit.terms.amount | number: '1.2-2' }} }
            </p>
          </div>
          <div class="psr-chips">
            @if (active(); as a) { <span class="chip" [class]="'chip ' + stateChip(a.state)">{{ stateLabel(a.state) }}</span> }
            <span class="chip">{{ humanize(v.status.toLowerCase()) }}</span>
          </div>
          <section class="page-head-kpis" aria-label="Summary">
            <div class="kpi-tile">
              <span class="kpi-tile-label">Documents</span>
              <strong class="kpi-tile-value"><app-animated-counter [value]="currentDocs().length" /></strong>
              <span class="kpi-tile-note">{{ reading() }} still being read</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-tile-label">Blocking discrepancies</span>
              <strong class="kpi-tile-value" [class.is-alert]="v.counts.BLOCKING_DISCREPANCY > 0"><app-animated-counter [value]="v.counts.BLOCKING_DISCREPANCY" /></strong>
              <span class="kpi-tile-note">hold the decision</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-tile-label">Other discrepancies</span>
              <strong class="kpi-tile-value" [class.is-warn]="v.counts.NON_BLOCKING_DISCREPANCY > 0"><app-animated-counter [value]="v.counts.NON_BLOCKING_DISCREPANCY" /></strong>
              <span class="kpi-tile-note">do not block</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-tile-label">Warnings</span>
              <strong class="kpi-tile-value"><app-animated-counter [value]="v.counts.WARNING" /></strong>
              <span class="kpi-tile-note">for your judgement</span>
            </div>
          </section>
        </header>

        <p class="muted psr-basis">
          Examined against
          @if (v.credit.basis === 'ISSUED_CREDIT') { the issued credit <strong>{{ v.credit.reference }}</strong> }
          @else { the <strong>approved pre-shipment application</strong> (version {{ v.credit.applicationVersion }}); no issued credit is recorded }
          . Each rule is pending the bank's sign-off. A difference below is evidence for you to judge, not a finding of wrongdoing.
        </p>

        <section class="card card-pad psr-bar">
          <div class="psr-counts" role="group" aria-label="Open findings by class">
            @for (k of classes; track k) {
              <span class="chip" [class]="'chip ' + classChip(k)">{{ classLabel(k) }}: {{ v.counts[k] }}</span>
            }
          </div>
          <div class="row psr-actions">
            @if (has('EXAMINE_PRESENTATION')) {
              <button type="button" class="btn btn-primary" [disabled]="busy() || reading() > 0" (click)="examine()">{{ active()?.examination ? 'Examine again' : 'Run the examination' }}</button>
            }
            @if (has('EXAMINE_PRESENTATION')) {
              <button type="button" class="btn btn-ghost" [disabled]="busy() || reading() > 0" (click)="aiRead()" title="The model reads the documents against each other and the approved set and quotes what it finds. Advice only: it never blocks the case.">AI-assisted reading</button>
            }
            @if (reading() > 0) { <span class="muted">{{ reading() }} document{{ reading() === 1 ? ' is' : 's are' }} still being read.</span> }
            @if (v.reexaminationDue) { <span class="psr-due" role="status">Documents changed since the last examination.</span> }
          </div>
        </section>

        @if (active()?.aiReview; as ai) {
          <section class="card card-pad psr-ai">
            <h2 class="psr-h">AI-assisted reading</h2>
            <p>{{ ai.summary }}</p>
            <p class="muted psr-small">{{ ai.model }} · {{ ai.at | date: 'medium' }} · {{ ai.raised }} point{{ ai.raised === 1 ? '' : 's' }} kept, {{ ai.leftOut }} left out because the words it quoted are not in the documents. These are advice: each point below marked "AI-assisted reading" is for you to confirm, and none of them holds the case.</p>
          </section>
        }

        <div class="grid grid-2">
          <section class="card card-pad">
            <h2 class="psr-h">Submitted documents</h2>
            @if (currentDocs().length === 0) { <p class="muted">Nothing submitted for the application under examination.</p> }
            <ul class="psr-docs">
              @for (d of currentDocs(); track d.linkId) {
                <li>
                  <strong>{{ humanize(d.documentType.toLowerCase()) }}</strong> v{{ d.version }} · {{ d.filename }}
                  <span class="muted psr-small"> · {{ d.uploadedAt | date: 'short' }} · {{ d.uploadedBy }}</span>
                  @if (d.sentToBankAt === null) { <span class="chip chip-warning">correction not sent yet</span> }
                  @if (d.analysisStatus !== 'completed') { <span class="chip chip-info">{{ d.analysisStatus }}</span> }
                  <button type="button" class="btn btn-ghost btn-sm" (click)="download(d)">Original</button>
                </li>
              }
            </ul>
            @if (olderDocs().length) {
              <details class="psr-small muted">
                <summary>Earlier versions ({{ olderDocs().length }})</summary>
                <ul>@for (d of olderDocs(); track d.linkId) { <li>{{ humanize(d.documentType.toLowerCase()) }} v{{ d.version }} · {{ d.filename }} · {{ d.uploadedAt | date: 'short' }}</li> }</ul>
              </details>
            }
          </section>
          <section class="card card-pad">
            <h2 class="psr-h">Approved pre-shipment documents</h2>
            <ul class="psr-docs">
              @for (d of v.approvedDocuments; track d.filename) { <li><strong>{{ humanize(d.documentType.toLowerCase()) }}</strong> v{{ d.version }} · {{ d.filename }}</li> }
            </ul>
            <p class="muted psr-small">
              Approved {{ v.approvedAt | date: 'medium' }}. The credit calls for: {{ requiredNames() }}. Ship by {{ v.credit.terms.latestShipmentDate || '—' }}, expires {{ v.credit.terms.expiryDate || '—' }}, presentation within {{ v.credit.terms.presentationPeriodDays }} days of shipment.
            </p>
          </section>
        </div>

        <section class="card card-pad">
          <h2 class="psr-h">Field by field: what was approved and what was presented</h2>
          @if (v.comparison.length === 0) {
            <p class="muted">Nothing has been submitted to compare yet.</p>
          } @else {
            <div class="table-wrap">
              <table class="table psr-table">
                <thead><tr><th>Particular</th><th>Approved</th><th>Presented</th><th>Result</th></tr></thead>
                <tbody>
                  @for (row of v.comparison; track row.field) {
                    @if (row.status !== 'NOT_STATED') {
                      <tr [class.psr-diff]="row.status === 'DIFFERENT'">
                        <td>{{ row.label }}</td>
                        <td>@for (a of row.approved; track a.source) { <div><span class="muted psr-small">{{ a.source }}:</span> {{ a.value }}</div> } @empty { <span class="muted">—</span> }</td>
                        <td>@for (p of row.presented; track p.filename) { <div><span class="muted psr-small">{{ humanize(p.documentType.toLowerCase()) }}:</span> {{ p.value }}</div> } @empty { <span class="muted">—</span> }</td>
                        <td>
                          @switch (row.status) {
                            @case ('MATCH') { <span class="chip chip-positive">agree</span> }
                            @case ('DIFFERENT') { <span class="chip chip-negative">differ</span> }
                            @default { <span class="chip">one source</span> }
                          }
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        @for (k of classes; track k) {
          @if (findingsOf(k).length) {
            <section class="card card-pad">
              <h2 class="psr-h">{{ classLabel(k) }} ({{ findingsOf(k).length }})</h2>
              @for (f of findingsOf(k); track f.findingId) {
                <article class="psr-finding" [class.psr-closed]="f.status !== 'OPEN'">
                  <div class="row-between">
                    <div>
                      <span class="psr-fid">{{ f.findingId }}</span>
                      <strong>{{ f.title }}</strong>
                    </div>
                    <span class="chip" [class]="'chip ' + (f.status === 'OPEN' ? classChip(k) : 'chip-positive')">{{ f.status === 'OPEN' ? 'open' : humanize(f.status.toLowerCase()) }}</span>
                  </div>
                  <p>{{ f.description }}</p>
                  @for (e of f.observed; track $index) {
                    <div class="psr-evidence"><span class="muted">{{ e.label }}:</span> {{ e.value }}@if (e.filename) { <span class="muted"> · {{ e.filename }}@if (e.pageNumber) { , page {{ e.pageNumber }} }</span> }@if (e.snippet) { <em class="muted"> "{{ e.snippet }}"</em> }</div>
                  }
                  <p class="psr-small"><strong>Expected:</strong> {{ f.expected }}</p>
                  <p class="psr-small"><strong>Recommended action:</strong> {{ f.recommendedAction }}</p>
                  <p class="muted psr-small">Rule {{ f.ruleId }} v{{ f.ruleVersion }} · {{ origin(f.origin) }}@if (f.confidence !== null) { · confidence {{ f.confidence | number: '1.0-2' }} }</p>
                  @if (f.applicantWaiver) { <p class="psr-small">Applicant {{ f.applicantWaiver.accepted ? 'accepted' : 'did not accept' }} it: {{ f.applicantWaiver.note }}</p> }
                  @if (f.disposition) { <p class="psr-small">Closed by {{ f.disposition.by.name }}: {{ dispositionLabel(f.disposition.code) }}. {{ f.disposition.rationale }}</p> }
                  @if (f.status === 'OPEN' && f.class !== 'INFORMATION') {
                    <div class="row psr-actions">
                      @if (pickable(f); as codes) {
                        <select class="input" [(ngModel)]="disp[f.findingId].code" [attr.aria-label]="'How to close ' + f.title">
                          @for (c of codes; track c) { <option [value]="c">{{ dispositionLabel(c) }}</option> }
                        </select>
                        <input class="input" [(ngModel)]="disp[f.findingId].rationale" placeholder="Reason (required)" [attr.aria-label]="'Reason for ' + f.title" />
                        <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy() || (disp[f.findingId].rationale || '').trim().length < 10" (click)="disposition(f)">Close</button>
                      }
                      <label class="psr-small"><input type="checkbox" [checked]="asked().has(f.findingId)" (change)="toggleAsk(f.findingId)" /> include in the request to the client</label>
                    </div>
                  }
                </article>
              }
            </section>
          }
        }

        <div class="grid grid-2">
          @if (has('REQUEST_CLARIFICATION')) {
            <section class="card card-pad">
              <h2 class="psr-h">Ask the client for clarification or a document</h2>
              <p class="muted psr-small">It reaches the client in their portal with the points ticked above attached. The case stays with you until you decide.</p>
              <textarea class="input" rows="4" [(ngModel)]="ask.question" placeholder="What you need, in plain words (at least 10 characters)"></textarea>
              <div class="row psr-actions"><button type="button" class="btn btn-primary" [disabled]="busy() || ask.question.trim().length < 10" (click)="requestClarification()">Send to the client ({{ asked().size }} point{{ asked().size === 1 ? '' : 's' }})</button></div>
            </section>
          }
          @if (has('ADD_MANUAL_FINDING')) {
            <section class="card card-pad">
              <h2 class="psr-h">Record a finding yourself</h2>
              <input class="input" [(ngModel)]="manual.title" placeholder="Title" />
              <textarea class="input" rows="3" [(ngModel)]="manual.description" placeholder="What you found and where"></textarea>
              <div class="row psr-actions">
                <select class="input" [(ngModel)]="manual.severity" aria-label="Severity"><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="INFO">Information</option></select>
                <label class="psr-small"><input type="checkbox" [(ngModel)]="manual.blocking" /> holds the case until resolved</label>
                <button type="button" class="btn btn-ghost" [disabled]="busy() || manual.title.trim().length < 5 || manual.description.trim().length < 10" (click)="addFinding()">Add finding</button>
              </div>
            </section>
          }
        </div>

        @if (v.queries.length) {
          <section class="card card-pad">
            <h2 class="psr-h">Messages with the client</h2>
            @for (q of v.queries; track q.queryId) {
              <article class="psr-finding">
                <div class="row-between"><strong>{{ q.queryId }} {{ q.subject || '' }}</strong><span class="chip" [class.chip-warning]="q.status === 'OPEN'" [class.chip-info]="q.status === 'ANSWERED'" [class.chip-positive]="q.status === 'RESOLVED'">{{ q.status.toLowerCase() }}</span></div>
                <p class="psr-pre">{{ q.question }}</p>
                @for (resp of q.responses; track resp.at) { <p class="psr-reply"><strong>{{ resp.by.name }}</strong> · {{ resp.at | date: 'short' }}: {{ resp.text }}</p> }
              </article>
            }
          </section>
        }

        @if (has('DECIDE_PRESENTATION')) {
          <section class="card card-pad">
            <h2 class="psr-h">Decision</h2>
            @if (v.counts.BLOCKING_DISCREPANCY > 0) { <p class="psr-warn" role="status">{{ v.counts.BLOCKING_DISCREPANCY }} blocking discrepanc{{ v.counts.BLOCKING_DISCREPANCY === 1 ? 'y is' : 'ies are' }} still open. The documents can be accepted only when the applicant has accepted each one or it has been corrected; they can be refused with a reason.</p> }
            <div class="row psr-actions">
              <select class="input" [(ngModel)]="decision.decision" aria-label="Decision"><option value="ACCEPT">Accept the documents</option><option value="REFUSE">Refuse the documents</option></select>
              <input class="input psr-grow" [(ngModel)]="decision.rationale" placeholder="Reason (required)" aria-label="Reason for the decision" />
              <button type="button" class="btn btn-primary" [disabled]="busy() || decision.rationale.trim().length < 10" (click)="decide()">Record decision</button>
            </div>
          </section>
        }
      } @else if (!error()) {
        <div class="card card-pad muted">Loading the examination…</div>
      }
    </div>
  `,
  styles: [
    `
      .psr-page { display: flex; flex-direction: column; gap: 16px; }
      .psr-error { border-color: var(--negative); color: var(--negative); }
      .psr-head { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: flex-start; }
      .psr-kicker { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
      .psr-ref { font-family: var(--font-mono, monospace); margin: 2px 0 6px; }
      .psr-chips { display: flex; gap: 8px; flex-wrap: wrap; }
      .psr-basis { max-width: 100ch; font-size: 0.92rem; }
      .psr-h { font-size: 1.02rem; margin: 0 0 10px; }
      .psr-small { font-size: 0.85rem; }
      .psr-pre { white-space: pre-wrap; }
      .psr-bar { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: center; }
      .psr-counts { display: flex; flex-wrap: wrap; gap: 8px; }
      .psr-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; }
      .psr-grow { flex: 1 1 260px; }
      .psr-due { color: var(--warning); font-weight: 600; }
      .psr-docs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .psr-table td { vertical-align: top; }
      .psr-diff { background: var(--negative-bg, #fef2f2); }
      .psr-finding { border-top: 1px solid var(--line); padding: 10px 0; }
      .psr-closed { opacity: 0.65; }
      .psr-fid { font-family: var(--font-mono, monospace); margin-right: 6px; font-weight: 600; }
      .psr-evidence { font-size: 0.88rem; margin: 2px 0; }
      .psr-reply { border-left: 3px solid var(--line); padding: 2px 10px; margin: 6px 0; font-size: 0.9rem; }
      .psr-warn { color: var(--warning); }

      /* the examination bar: the controls the officer uses most, as one band */
      .psr-bar { background: linear-gradient(135deg, color-mix(in srgb, #00a8a8 9%, var(--raised)), var(--raised) 70%); border-left: 4px solid #00a8a8; }
      .psr-due { display: inline-flex; align-items: center; padding: 5px 12px; border-radius: 999px; font-size: 0.82rem; color: #92400e; background: var(--warning-soft); border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent); animation: psr-nudge 2.4s ease-in-out infinite; }
      @keyframes psr-nudge { 0%, 100% { transform: none; } 50% { transform: translateY(-2px); } }

      /* documents as tiles */
      .psr-docs li { padding: 10px 14px; border-radius: 12px; background: var(--sunken); border: 1px solid var(--line); border-left: 3px solid #00a8a8; transition: transform 0.25s ease, box-shadow 0.25s ease; }
      .psr-docs li:hover { transform: translateX(3px); box-shadow: 0 10px 20px -16px rgb(0 128 128 / 55%); }

      /* what differs between the approved and the presented */
      .psr-diff td { background: color-mix(in srgb, var(--negative) 7%, var(--raised)); }
      .psr-diff td:first-child { box-shadow: inset 4px 0 0 var(--negative); font-weight: 650; }

      /* findings as cards with an edge in the colour of how serious they are */
      .psr-finding { margin-top: 12px; padding: 14px 16px; border: 1px solid var(--line); border-left: 4px solid var(--warning); border-radius: 14px; background: var(--raised); transition: transform 0.25s ease, box-shadow 0.25s ease; animation: psr-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
      .psr-finding:hover { transform: translateY(-2px); box-shadow: 0 16px 28px -20px rgb(16 40 80 / 40%); }
      .psr-finding:has(.chip-negative) { border-left-color: var(--negative); }
      .psr-finding:has(.chip-positive) { border-left-color: var(--positive); }
      .psr-finding p { margin: 6px 0; }
      @keyframes psr-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      .psr-fid { padding: 2px 8px; border-radius: 8px; color: var(--accent); background: var(--accent-soft); font-size: 0.8rem; }
      .psr-evidence { padding: 6px 10px; border-radius: 10px; background: var(--sunken); }
      .psr-reply { background: var(--accent-soft); border-left-color: #00a8a8; border-radius: 0 10px 10px 0; padding: 8px 12px; }
      .psr-warn { padding: 12px 14px; border-radius: 14px; color: #92400e; background: var(--warning-soft); border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent); }
      .psr-ai { background: linear-gradient(135deg, color-mix(in srgb, #6366f1 8%, var(--raised)), var(--raised) 70%); border-left: 4px solid #6366f1; }
      @media (max-width: 640px) { }
    `,
  ],
})
export class PostShipmentReviewComponent implements OnInit {
  /** Route parameter (component input binding): the trade case id. */
  readonly id = input.required<string>();

  private readonly service = inject(PostShipmentService);
  private readonly cases = inject(TradeCasesService);
  private readonly toast = inject(ToastService);

  protected readonly humanize = humanize;
  protected readonly dispositionLabel = dispositionLabel;
  protected readonly classes = FINDING_CLASS_ORDER;
  protected readonly r = signal<PostShipmentReview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly asked = signal<Set<string>>(new Set());
  protected readonly disp: Record<string, { code: string; rationale: string }> = {};
  protected ask = { question: '' };
  protected manual = { title: '', description: '', severity: 'MEDIUM', blocking: false };
  protected decision = { decision: 'ACCEPT' as 'ACCEPT' | 'REFUSE', rationale: '' };

  protected readonly active = computed(() => {
    const v = this.r();
    return v?.applications.find((a) => a.presentationId === v.activePresentationId) ?? null;
  });
  protected readonly currentDocs = computed<ReviewDocument[]>(() => (this.r()?.documents ?? []).filter((d) => d.presentationId === this.r()?.activePresentationId && !d.superseded));
  protected readonly olderDocs = computed<ReviewDocument[]>(() => (this.r()?.documents ?? []).filter((d) => d.presentationId === this.r()?.activePresentationId && d.superseded));
  protected readonly reading = computed(() => this.currentDocs().filter((d) => ['uploaded', 'queued', 'processing'].includes(d.analysisStatus)).length);

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.service.review(this.id()).subscribe({
      next: (v) => {
        this.r.set(v);
        for (const f of v.findings) this.disp[f.findingId] ??= { code: this.pickable(f)?.[0] ?? '', rationale: '' };
        this.error.set(null);
      },
      error: (err: unknown) => this.error.set(isApiError(err) ? err.message : 'The examination could not be loaded.'),
    });
  }

  protected has(action: string): boolean {
    return (this.r()?.actions ?? []).includes(action);
  }
  protected stateLabel(s: string): string {
    return APPLICATION_STATE_LABELS[s as ApplicationState] ?? s;
  }
  protected stateChip(s: string): string {
    return APPLICATION_STATE_CHIP[s as ApplicationState] ?? '';
  }
  protected classLabel(k: FindingClass): string {
    return FINDING_CLASS_LABELS[k];
  }
  protected classChip(k: FindingClass): string {
    return FINDING_CLASS_CHIP[k];
  }
  protected findingsOf(k: FindingClass): ReviewFinding[] {
    return (this.r()?.findings ?? []).filter((f) => f.class === k);
  }
  protected requiredNames(): string {
    return (this.r()?.requiredDocuments ?? []).map((t) => humanize(t.toLowerCase())).join(', ') || 'no stipulated documents';
  }
  protected origin(o: string): string {
    return o === 'REVIEWER' ? 'recorded by an officer' : o === 'AI_ASSISTED_EXTRACTION' ? 'AI-assisted reading' : o === 'DETERMINISTIC_RULE' ? 'rule' : humanize(o.toLowerCase());
  }

  /** How an officer may close this finding: the codes the server accepts. A blocking documentary discrepancy is closed by the applicant's waiver and the decision, not here. */
  protected pickable(f: ReviewFinding): string[] | null {
    if (f.category === 'DOCUMENTARY_DISCREPANCY') return f.blocking ? null : ['VERIFIED_MANUALLY'];
    const codes = DISPOSITIONS[f.category] ?? [];
    return codes.length ? codes : null;
  }

  protected toggleAsk(findingId: string): void {
    const next = new Set(this.asked());
    if (next.has(findingId)) next.delete(findingId);
    else next.add(findingId);
    this.asked.set(next);
  }

  private async run(call: Promise<unknown>, done: string, after?: () => void): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await call;
      this.toast.success(done);
      after?.();
      this.reload();
    } catch (err) {
      this.error.set(isApiError(err) ? err.message : 'That did not work. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  aiRead(): void {
    void this.run(firstValueFrom(this.service.aiReview(this.id())), 'AI-assisted reading complete');
  }
  examine(): void {
    void this.run(firstValueFrom(this.service.examine(this.id())), 'Examination complete');
  }
  disposition(f: ReviewFinding): void {
    const d = this.disp[f.findingId]!;
    void this.run(firstValueFrom(this.service.disposition(this.id(), f.findingId, d.code, d.rationale.trim())), `${f.findingId} closed`);
  }
  requestClarification(): void {
    void this.run(firstValueFrom(this.service.requestClarification(this.id(), { question: this.ask.question.trim(), findingIds: [...this.asked()] })), 'Sent to the client', () => {
      this.ask.question = '';
      this.asked.set(new Set());
    });
  }
  addFinding(): void {
    void this.run(firstValueFrom(this.service.addFinding(this.id(), { ...this.manual, title: this.manual.title.trim(), description: this.manual.description.trim() })), 'Finding recorded', () => {
      this.manual = { title: '', description: '', severity: 'MEDIUM', blocking: false };
    });
  }
  decide(): void {
    void this.run(firstValueFrom(this.service.decide(this.id(), this.decision.decision, this.decision.rationale.trim())), this.decision.decision === 'ACCEPT' ? 'Documents accepted' : 'Documents refused', () => (this.decision.rationale = ''));
  }
  download(d: ReviewDocument): void {
    this.cases.downloadDocument(this.id(), d.linkId, d.filename).subscribe({ error: () => this.toast.error('Download failed', d.filename) });
  }
}
