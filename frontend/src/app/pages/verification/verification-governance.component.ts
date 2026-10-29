import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable } from 'rxjs';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { VerificationService } from '../../services/verification.service';
import { ToastService } from '../../services/toast.service';
import { isApiError } from '../../services/api.service';
import { humanize } from '../../shared/format';
import type { PctDatasetView, RuleApprovalStatus, SourceHealthView, VerificationOverview, VerificationRuleView } from '../../models/verification.models';

/**
 * Which verification rules are bank controls, and the state of every external source.
 *
 * It shows what the platform does with a rule nobody has approved (a labelled demonstration or shadow mode),
 * who proposed and who decided each rule, and lets an authorised person act. The buttons only reflect what
 * the signed-in user may do: the API decides, and refuses the proposer deciding their own proposal.
 */
@Component({
  selector: 'app-verification-governance',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, AnimatedCounter],
  template: `
    <div class="page vg-page">
      <header class="page-head">
        <a routerLink="/workspace" class="page-head-back">← My workspace</a>
        <div>
          <h1>Verification controls</h1>
          <p class="muted">Which checks against official sources are approved bank controls, who decided it, and what each source can and cannot tell us.</p>
        </div>
        <section class="page-head-kpis" aria-label="Summary">
          <div class="kpi-tile">
            <span class="kpi-tile-label">Rules</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="data()?.rules?.length ?? 0" /></strong>
            <span class="kpi-tile-note">in rule set v{{ data()?.ruleSetVersion ?? "—" }}</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Approved bank controls</span>
            <strong class="kpi-tile-value"><app-animated-counter [value]="approvedCount()" /></strong>
            <span class="kpi-tile-note">decided by the bank</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Awaiting a decision</span>
            <strong class="kpi-tile-value" [class.is-warn]="awaitingCount() > 0"><app-animated-counter [value]="awaitingCount()" /></strong>
            <span class="kpi-tile-note">proposed or pending sign-off</span>
          </div>
          <div class="kpi-tile">
            <span class="kpi-tile-label">Decision log</span>
            <strong class="kpi-tile-value is-text" [class.is-alert]="data() && !data()!.governanceIntegrity.valid">{{ data() ? (data()!.governanceIntegrity.valid ? 'Intact' : 'Check failed') : '—' }}</strong>
            <span class="kpi-tile-note">{{ data()?.governanceIntegrity?.entries ?? 0 }} entries</span>
          </div>
        </section>
      </header>

      @if (error()) { <div class="card card-pad vg-error" role="alert">{{ error() }}</div> }

      @if (data(); as d) {
        <section class="card card-pad">
          <h2 class="vg-h">Current behaviour</h2>
          <p>
            A rule that the policy owner has not approved runs in
            <strong>{{ d.policy.unapprovedRuleMode === 'SHADOW' ? 'shadow mode' : 'demonstration mode' }}</strong>:
            @if (d.policy.unapprovedRuleMode === 'SHADOW') { its findings are shown and labelled advisory, and never hold a case. }
            @else { its findings can hold a case, and every one says it is a demonstration and not an approved control. }
          </p>
          <p class="muted vg-small">{{ d.policy.note }}</p>
          <p class="vg-small">
            Sources whose absence holds an approval (once their rule is approved):
            @if (d.policy.mandatorySources.length === 0) { <strong>none</strong>: an unavailable source is a visible warning and the check stays marked incomplete. }
            @else { <strong>{{ d.policy.mandatorySources.join(', ') }}</strong> }
          </p>
          <p class="vg-small">
            Decision log:
            @if (d.governanceIntegrity.valid) { <span class="chip chip-positive">intact</span> {{ d.governanceIntegrity.entries }} entr{{ d.governanceIntegrity.entries === 1 ? 'y' : 'ies' }} }
            @else { <span class="chip chip-negative">integrity check failed</span> No approval is honoured while this stands. {{ d.governanceIntegrity.problem }} }
          </p>
        </section>

        <h2 class="vg-h vg-section">Rules</h2>
        @for (r of d.rules; track r.rule.ruleId) {
          <article class="card card-pad vg-rule">
            <div class="row-between vg-rulehead">
              <div>
                <strong class="vg-id">{{ r.rule.ruleId }}</strong> <span class="muted">v{{ r.rule.version }}</span>
                <h3 class="vg-name">{{ r.rule.name }}</h3>
              </div>
              <span class="chip" [class]="statusChip(r.approval.status)">{{ statusLabel(r.approval.status) }}</span>
            </div>
            <p class="vg-small">{{ r.rule.description }}</p>
            <dl class="vg-dl vg-small">
              <dt>Source</dt><dd>{{ r.rule.sourceId }} · {{ r.rule.sourceReference }}</dd>
              <dt>Interpretation</dt><dd>{{ humanize(r.rule.interpretationStatus.toLowerCase()) }}</dd>
              @if (r.rule.applicability; as a) {
                <dt>Kind of rule</dt><dd>{{ humanize(a.basis.toLowerCase()) }}</dd>
                <dt>Applies to</dt><dd>{{ a.appliesTo }}</dd>
                <dt>Does not establish</dt><dd>{{ a.doesNotEstablish }}</dd>
              }
              <dt>Behaviour now</dt><dd [class.vg-warn]="r.enforcement.mode !== 'ENFORCED'">{{ r.enforcement.label }}</dd>
              @if (r.approval.proposedBy) { <dt>Proposed</dt><dd>{{ r.approval.proposedBy.name }} ({{ r.approval.proposedBy.role }}) · {{ r.approval.proposedAt | date: 'medium' }}</dd> }
              @if (r.approval.decidedBy) { <dt>Decided</dt><dd>{{ r.approval.decidedBy.name }} ({{ r.approval.decidedBy.role }}) · {{ r.approval.decidedAt | date: 'medium' }}</dd> }
              @if (r.approval.rationale) { <dt>Reason</dt><dd>{{ r.approval.rationale }}</dd> }
            </dl>

            @if (canAct(r); as action) {
              <div class="vg-actions">
                <input class="input" [value]="reason(r.rule.ruleId)" (input)="reasons.set(r.rule.ruleId, $any($event.target).value)" placeholder="Reason (at least 10 characters)" [attr.aria-label]="'Reason for ' + r.rule.ruleId" />
                @switch (action) {
                  @case ('PROPOSE') { <button type="button" class="btn btn-primary btn-sm" [disabled]="busy() || reason(r.rule.ruleId).trim().length < 10" (click)="propose(r)">Propose for approval</button> }
                  @case ('DECIDE') {
                    <button type="button" class="btn btn-primary btn-sm" [disabled]="busy() || reason(r.rule.ruleId).trim().length < 10" (click)="decide(r, true)">Approve as a bank control</button>
                    <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy() || reason(r.rule.ruleId).trim().length < 10" (click)="decide(r, false)">Reject</button>
                  }
                  @case ('REVOKE') { <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy() || reason(r.rule.ruleId).trim().length < 10" (click)="revoke(r)">Revoke approval</button> }
                }
              </div>
            } @else if (r.approval.status === 'PROPOSED' && r.approval.proposedBy?.id === myId()) {
              <p class="muted vg-small">You proposed this. A different person must decide it.</p>
            }

            @if (r.history.length > 0) {
              <details class="vg-small muted">
                <summary>History ({{ r.history.length }})</summary>
                <ul>@for (h of r.history; track h.seq) { <li>{{ h.at | date: 'medium' }} · {{ humanize(h.event.toLowerCase()) }} · {{ h.by.name }}: {{ h.rationale }}</li> }</ul>
              </details>
            }
          </article>
        }

        <h2 class="vg-h vg-section">Pakistan Customs Tariff datasets</h2>
        <section class="card card-pad">
          <p class="vg-small">
            The platform does not fetch the tariff. The bank supplies a controlled copy as a CSV
            (<code>pct_code, hs6, description, unit, customs_duty_pct, regulatory_duty_pct, notes, restrictions, effective_from, effective_to</code>),
            and a different person approves it before any check relies on it. Until one is approved, tariff lines are not verified and every
            result says so.
          </p>
          @for (ds of datasets(); track ds.datasetId) {
            <div class="vg-dataset">
              <div class="row-between vg-rulehead">
                <div>
                  <strong>{{ ds.version }}</strong> <span class="muted vg-small">{{ ds.datasetId }}</span>
                  <div class="muted vg-small">{{ ds.publisher }} · {{ ds.sourceReference }} · published {{ ds.publicationDate ?? 'date not stated' }} · {{ ds.scope === 'FULL_TARIFF' ? 'full tariff' : 'EXTRACT (absence proves nothing)' }}</div>
                </div>
                <span class="chip" [class]="datasetChip(ds.status)">{{ humanize(ds.status.toLowerCase()) }}</span>
              </div>
              <p class="vg-small muted">
                {{ ds.lineCount }} lines · covers {{ ds.coverageFrom }} to {{ ds.coverageTo ?? 'open-ended' }} · sha256 {{ ds.contentHash.slice(0, 12) }} ·
                submitted by {{ ds.ingestedBy.name }} {{ ds.ingestedAt | date: 'medium' }}
                @if (ds.decidedBy) { · decided by {{ ds.decidedBy.name }}: {{ ds.rationale }} }
              </p>
              @if (datasetAction(ds); as action) {
                <div class="vg-actions">
                  <input class="input" [value]="reason('ds:' + ds.datasetId)" (input)="reasons.set('ds:' + ds.datasetId, $any($event.target).value)" placeholder="Reason (at least 10 characters)" [attr.aria-label]="'Reason for ' + ds.datasetId" />
                  @if (action === 'DECIDE') {
                    <button type="button" class="btn btn-primary btn-sm" [disabled]="busy() || reason('ds:' + ds.datasetId).trim().length < 10" (click)="decideDataset(ds, true)">Approve this dataset</button>
                    <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy() || reason('ds:' + ds.datasetId).trim().length < 10" (click)="decideDataset(ds, false)">Reject</button>
                  } @else {
                    <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy() || reason('ds:' + ds.datasetId).trim().length < 10" (click)="retireDataset(ds)">Retire (kept for reproducibility)</button>
                  }
                </div>
              } @else if (ds.status === 'SUBMITTED' && ds.ingestedBy.id === myId()) {
                <p class="muted vg-small">You submitted this. A different person must decide it.</p>
              }
            </div>
          } @empty {
            <p class="muted">No dataset has been supplied. Nothing is checked at the national tariff line.</p>
          }

          @if (auth.can('verification.reference.submit')) {
            <details class="vg-small vg-submit">
              <summary>Submit a tariff file for approval</summary>
              <div class="vg-form">
                <label>CSV file <input type="file" accept=".csv,text/csv" (change)="pickFile($event)" /></label>
                <label>Edition / version <input class="input" [value]="form.version" (input)="form.version = $any($event.target).value" placeholder="e.g. Finance Act 2026, as notified to 15 Oct 2026" /></label>
                <label>Publisher <input class="input" [value]="form.publisher" (input)="form.publisher = $any($event.target).value" placeholder="Federal Board of Revenue / Pakistan Customs" /></label>
                <label>Source reference <input class="input" [value]="form.sourceReference" (input)="form.sourceReference = $any($event.target).value" placeholder="Publication, notification number or internal export" /></label>
                <label>Publication date <input class="input" type="date" [value]="form.publicationDate" (input)="form.publicationDate = $any($event.target).value" /></label>
                <label>This file is
                  <select class="input" [value]="form.scope" (change)="form.scope = $any($event.target).value">
                    <option value="">Choose…</option><option value="FULL_TARIFF">the full tariff</option><option value="EXTRACT">an extract (absence of a line proves nothing)</option>
                  </select>
                </label>
                <label>Permission to use this copy <textarea class="input" rows="2" [value]="form.licenceNote" (input)="form.licenceNote = $any($event.target).value" placeholder="Who at the bank confirmed the bank may use this copy for this purpose, and on what basis"></textarea></label>
                <label class="vg-check"><input type="checkbox" [checked]="form.confirmed" (change)="form.confirmed = $any($event.target).checked" /> The bank may use this copy of the tariff for this purpose.</label>
                <button type="button" class="btn btn-primary btn-sm" [disabled]="busy() || !form.file" (click)="submitDataset()">Submit for approval</button>
              </div>
            </details>
          }
        </section>

        <h2 class="vg-h vg-section">Sources</h2>
        <section class="card card-pad">
          <table class="table">
            <thead><tr><th>Source</th><th>State</th><th>Data</th><th>Licence and gaps</th></tr></thead>
            <tbody>
              @for (s of d.sources.catalogue; track s.sourceId) {
                <tr>
                  <td>
                    <strong>{{ s.name }}</strong>
                    <div class="muted vg-small">{{ s.publisher }} · {{ s.jurisdiction }} · owner: {{ s.owner }}</div>
                    @if (s.lineage) { <div class="muted vg-small">{{ s.lineage }}</div> }
                  </td>
                  <td>
                    <span class="chip" [class]="healthChip(health(s.sourceId))">{{ healthLabel(s, health(s.sourceId)) }}</span>
                    @if (health(s.sourceId)?.lastError; as e) { <div class="vg-neg vg-small">{{ e }}</div> }
                  </td>
                  <td class="vg-small">
                    @if (health(s.sourceId); as h) {
                      @if (h.lastSuccessfulRetrievalAt) { retrieved {{ h.lastSuccessfulRetrievalAt | date: 'medium' }}<br /> }
                      @if (h.publishedOn) { published {{ h.publishedOn | date: 'mediumDate' }}<br /> }
                      @if (h.datasetVersion) { version {{ h.datasetVersion }}<br /> }
                      @if (h.recordCount) { {{ h.recordCount }} records<br /> }
                      @if (h.origin) { origin: {{ humanize(h.origin.toLowerCase()) }} }
                    }
                  </td>
                  <td class="vg-small">{{ s.licence }}
                    @if (s.gaps.length > 0) { <ul>@for (g of s.gaps; track $index) { <li>{{ g }}</li> }</ul> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      } @else if (!error()) {
        <p class="muted">Loading…</p>
      }
    </div>
  `,
  styles: [
    `
      .vg-page { max-width: none; }
      .vg-back { display: inline-block; margin-bottom: 8px; font-size: 0.85rem; }
      .vg-h { font-size: 1.05rem; margin: 0 0 8px; }
      .vg-section { margin-top: 22px; }
      .vg-small { font-size: 0.85rem; }
      .vg-error { border-color: var(--negative); color: var(--negative); }
      .vg-rule { margin-bottom: 14px; }
      .vg-rulehead { align-items: flex-start; gap: 12px; }
      .vg-id { font-family: var(--font-mono, monospace); }
      .vg-name { margin: 2px 0 0; font-size: 1rem; }
      .vg-dl { display: grid; grid-template-columns: max-content 1fr; gap: 3px 14px; margin: 8px 0; }
      .vg-dl dt { color: var(--ink-3); }
      .vg-dl dd { margin: 0; }
      .vg-warn { color: color-mix(in srgb, var(--warning) 68%, var(--ink)); }
      .vg-neg { color: color-mix(in srgb, var(--negative) 72%, var(--ink)); }
      .vg-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
      .vg-actions .input { flex: 1 1 320px; }
      .vg-rule ul { margin: 6px 0 0 18px; padding: 0; }
      .vg-dataset { border-top: 1px solid var(--line); padding: 10px 0; }
      .vg-submit { margin-top: 14px; }
      .vg-form { display: grid; gap: 10px; margin-top: 10px; max-width: 640px; }
      .vg-form label { display: grid; gap: 4px; font-weight: 500; }
      .vg-check { display: flex !important; gap: 8px; align-items: center; font-weight: 400 !important; }
      td ul { margin: 4px 0 0 16px; padding: 0; }
    `,
  ],
})
export class VerificationGovernanceComponent implements OnInit {
  private readonly service = inject(VerificationService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = signal<VerificationOverview | null>(null);
  protected readonly datasets = signal<PctDatasetView[]>([]);
  protected readonly approvedCount = computed(() => this.data()?.rules.filter((r) => r.approval.status === 'APPROVED').length ?? 0);
  protected readonly awaitingCount = computed(() => this.data()?.rules.filter((r) => r.approval.status === 'PROPOSED' || r.approval.status === 'PENDING_BANK_SIGN_OFF').length ?? 0);
  protected readonly form: { file: File | null; version: string; publisher: string; sourceReference: string; publicationDate: string; scope: string; licenceNote: string; confirmed: boolean } = {
    file: null,
    version: '',
    publisher: '',
    sourceReference: '',
    publicationDate: '',
    scope: '',
    licenceNote: '',
    confirmed: false,
  };
  protected readonly auth = inject(AuthService);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly reasons = new Map<string, string>();
  protected readonly humanize = humanize;

  protected myId(): string {
    return this.auth.currentUser()?.id ?? '';
  }

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.service
      .overview()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => {
          this.data.set(d);
          this.loadDatasets();
        },
        error: (err: unknown) => this.error.set(isApiError(err) ? err.message : 'The verification controls could not be loaded.'),
      });
  }

  private loadDatasets(): void {
    this.service
      .datasets()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (r) => this.datasets.set(r.datasets), error: () => this.datasets.set([]) });
  }

  protected datasetChip(status: string): string {
    return status === 'APPROVED' ? 'chip chip-positive' : status === 'REJECTED' || status === 'RETIRED' ? 'chip chip-negative' : 'chip chip-warning';
  }

  /** What this user may do to this dataset now (the API repeats the check, and refuses approving your own submission). */
  protected datasetAction(ds: PctDatasetView): 'DECIDE' | 'RETIRE' | null {
    if (ds.status === 'SUBMITTED' && this.auth.can('verification.reference.approve') && ds.ingestedBy.id !== this.myId()) return 'DECIDE';
    if (ds.status === 'APPROVED' && this.auth.can('verification.reference.approve')) return 'RETIRE';
    return null;
  }

  protected pickFile(event: Event): void {
    this.form.file = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  protected submitDataset(): void {
    const f = this.form;
    const body = new FormData();
    if (f.file) body.append('file', f.file, f.file.name);
    for (const [key, value] of Object.entries({ version: f.version, publisher: f.publisher, sourceReference: f.sourceReference, publicationDate: f.publicationDate, scope: f.scope, licenceNote: f.licenceNote, licenceConfirmed: String(f.confirmed) })) body.append(key, value);
    this.act(this.service.submitDataset(body), '', 'Submitted for approval');
  }

  protected decideDataset(ds: PctDatasetView, approve: boolean): void {
    this.act(this.service.decideDataset(ds.datasetId, approve, this.reason('ds:' + ds.datasetId).trim()), 'ds:' + ds.datasetId, approve ? 'Dataset approved' : 'Dataset rejected');
  }

  protected retireDataset(ds: PctDatasetView): void {
    this.act(this.service.retireDataset(ds.datasetId, this.reason('ds:' + ds.datasetId).trim()), 'ds:' + ds.datasetId, 'Dataset retired');
  }

  protected reason(ruleId: string): string {
    return this.reasons.get(ruleId) ?? '';
  }

  /** What this user may do to this rule now (the API repeats the check). */
  protected canAct(r: VerificationRuleView): 'PROPOSE' | 'DECIDE' | 'REVOKE' | null {
    const s = r.approval.status;
    if ((s === 'PENDING_BANK_SIGN_OFF' || s === 'REJECTED' || s === 'REVOKED') && this.auth.can('verification.rules.propose')) return 'PROPOSE';
    if (s === 'PROPOSED' && this.auth.can('verification.rules.approve') && r.approval.proposedBy?.id !== this.myId()) return 'DECIDE';
    if (s === 'APPROVED' && this.auth.can('verification.rules.approve')) return 'REVOKE';
    return null;
  }

  protected statusLabel(status: RuleApprovalStatus): string {
    return { PENDING_BANK_SIGN_OFF: 'Pending bank approval', PROPOSED: 'Proposed, awaiting the policy owner', APPROVED: 'Approved bank control', REJECTED: 'Rejected', REVOKED: 'Approval revoked' }[status];
  }

  protected statusChip(status: RuleApprovalStatus): string {
    return status === 'APPROVED' ? 'chip chip-positive' : status === 'REJECTED' || status === 'REVOKED' ? 'chip chip-negative' : 'chip chip-warning';
  }

  protected health(sourceId: string): SourceHealthView | null {
    return this.data()?.sources.health.find((h) => h.sourceId === sourceId) ?? null;
  }

  protected healthLabel(source: { integration: string }, h: SourceHealthView | null): string {
    if (source.integration === 'NOT_INTEGRATED' || h?.state === 'NOT_INTEGRATED') return 'Not integrated';
    if (!h) return 'No status';
    return { CURRENT: 'Current', STALE: 'Stale', UNAVAILABLE: 'Unavailable', NOT_LOADED: 'Not loaded yet', NOT_INTEGRATED: 'Not integrated' }[h.state];
  }

  protected healthChip(h: SourceHealthView | null): string {
    if (!h || h.state === 'NOT_INTEGRATED') return 'chip';
    return h.state === 'CURRENT' ? 'chip chip-positive' : h.state === 'STALE' || h.state === 'NOT_LOADED' ? 'chip chip-warning' : 'chip chip-negative';
  }

  private act(request: Observable<unknown>, ruleId: string, done: string): void {
    this.busy.set(true);
    this.error.set(null);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        this.reasons.delete(ruleId);
        this.toast.success(done, ruleId);
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(isApiError(err) ? err.message : 'The change could not be recorded.');
      },
    });
  }

  protected propose(r: VerificationRuleView): void {
    this.act(this.service.propose(r.rule.ruleId, this.reason(r.rule.ruleId).trim()), r.rule.ruleId, 'Proposed for approval');
  }

  protected decide(r: VerificationRuleView, approve: boolean): void {
    this.act(this.service.decide(r.rule.ruleId, approve, this.reason(r.rule.ruleId).trim()), r.rule.ruleId, approve ? 'Approved as a bank control' : 'Rejected');
  }

  protected revoke(r: VerificationRuleView): void {
    this.act(this.service.revoke(r.rule.ruleId, this.reason(r.rule.ruleId).trim()), r.rule.ruleId, 'Approval revoked');
  }
}
