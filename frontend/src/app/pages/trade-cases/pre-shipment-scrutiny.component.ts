import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TradeCasesService } from '../../services/trade-cases.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { isApiError } from '../../services/api.service';
import { humanize } from '../../shared/format';
import { Icon } from '../../shared/components/icon';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { COMPLIANCE_CATEGORIES, DEPARTMENT_PERMISSION, DISPOSITIONS, dispositionLabel } from '../../shared/dispositions';
import { STATUS_LABELS, type ClaimVerification, type ComposedMail, type ExternalVerificationView, type Finding, type ScrutinyReport, type ScrutinyRule, type ScrutinyRuleStatus } from '../../models/trade-case.models';

const RULE_STATUS: Record<ScrutinyRuleStatus, { label: string; chip: string }> = {
  FLAGGED: { label: 'Flagged', chip: 'chip-negative' },
  REVIEWED: { label: 'Raised and reviewed', chip: 'chip-warning' },
  PASSED: { label: 'Passed', chip: 'chip-positive' },
  NOT_CHECKED: { label: 'Not checked', chip: 'chip-warning' },
  NOT_APPLICABLE: { label: 'Not applicable', chip: 'chip-info' },
  MANUAL: { label: 'Reviewer checkpoint', chip: 'chip-info' },
};

const CLEAR_JURISDICTION = new Set(['CLEAR']);

/**
 * The pre-shipment scrutiny of one case, on a page of its own. It shows what the AI read in the
 * customer's documents, what is missing, every pre-trade rule with its outcome, what the sanctions
 * and jurisdiction screening covered, and the findings. It has nothing from the post-shipment side:
 * no vessel tracking, no presentation checks.
 */
@Component({
  selector: 'app-pre-shipment-scrutiny',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, DecimalPipe, Icon, AnimatedCounter],
  template: `
    <div class="page psc-page">
      @if (!report()) {
        <a [routerLink]="['/trade-cases', id()]" class="muted psc-back">← Back to the case</a>
      }

      @if (error()) {
        <div class="card card-pad psc-error" role="alert">{{ error() }}</div>
      } @else if (!report()) {
        <div class="card card-pad muted">Loading the scrutiny report…</div>
      }

      @if (report(); as r) {
        <header class="page-head psc-head">
          <a [routerLink]="['/trade-cases', r.caseId]" class="page-head-back">← Back to the case</a>
          <div>
            <h1>Pre-shipment scrutiny <span class="muted psc-case">{{ r.caseId }}</span></h1>
            <p class="muted">
              {{ statusLabels[r.status] }} · customer {{ r.customerRef }} · rule set {{ r.ruleSetVersion }}
              @if (r.lastValidatedAt) { · checked {{ r.lastValidatedAt | date: 'medium' }} }
            </p>
          </div>
          <div class="row psc-actions">
            @if (auth.can('tradecase.revalidate')) {
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="analyze()"><app-icon name="sparkle" [size]="14" /> {{ r.run?.status === 'RUNNING' ? 'AI scrutiny running…' : 'Run the AI scrutiny' }}</button>
              <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="recheck()"><app-icon name="refresh" [size]="14" /> Re-run checks</button>
            }
            <a [routerLink]="['/trade-cases', r.caseId]" class="btn btn-ghost">Open the case</a>
          </div>
          <section class="page-head-kpis" aria-label="Summary">
            <div class="kpi-tile"><span class="kpi-tile-label">Documents</span><strong class="kpi-tile-value"><app-animated-counter [value]="r.counts.documents" /></strong></div>
            <div class="kpi-tile"><span class="kpi-tile-label">Rules checked</span><strong class="kpi-tile-value"><app-animated-counter [value]="r.counts.rulesChecked" /> <small>of {{ r.counts.rulesTotal }}</small></strong></div>
            <div class="kpi-tile"><span class="kpi-tile-label">Open findings</span><strong class="kpi-tile-value" [class.is-alert]="r.counts.openFindings > 0"><app-animated-counter [value]="r.counts.openFindings" /></strong><span class="kpi-tile-note">{{ r.counts.blocking }} blocking</span></div>
            <div class="kpi-tile"><span class="kpi-tile-label">Missing information</span><strong class="kpi-tile-value" [class.is-warn]="r.counts.missing > 0"><app-animated-counter [value]="r.counts.missing" /></strong></div>
          </section>
        </header>

        @if (r.run; as run) {
          <section class="card card-pad psc-run" [class.psc-run-active]="run.status === 'RUNNING'" role="status" aria-live="polite">
            <div class="row-between">
              <h2 class="psc-h">
                @switch (run.status) {
                  @case ('RUNNING') { <span class="psc-spin" aria-hidden="true"></span> The AI is scrutinising the documents, one at a time }
                  @case ('DONE') { <app-icon name="check" [size]="16" /> The AI scrutiny is complete }
                  @default { <app-icon name="alert" [size]="16" /> The AI scrutiny did not finish }
                }
              </h2>
              <span class="muted psc-small">started {{ run.startedAt | date: 'shortTime' }}@if (run.finishedAt) { · finished {{ run.finishedAt | date: 'shortTime' }} }</span>
            </div>
            <ol class="psc-steps">
              @for (st of run.steps; track st.documentId; let i = $index) {
                <li [class]="'psc-step psc-step-' + st.status.toLowerCase()">
                  <span class="psc-step-n">{{ i + 1 }}</span>
                  <span class="psc-step-name">{{ humanize(st.documentType.toLowerCase()) }} <span class="muted">· {{ st.filename }}</span></span>
                  <span class="psc-step-state">
                    @switch (st.status) {
                      @case ('PENDING') { Waiting }
                      @case ('READING') { Reading the document… }
                      @case ('REVIEWING') { Checking it against the rules… }
                      @case ('DONE') { Done }
                      @case ('FAILED') { Failed }
                    }
                  </span>
                  @if (st.error) { <span class="psc-step-error">{{ st.error }}</span> }
                </li>
              }
              <li [class]="'psc-step psc-step-' + (run.caseReview === 'DONE' ? 'done' : run.caseReview === 'FAILED' ? 'failed' : run.caseReview === 'RUNNING' ? 'reviewing' : 'pending')">
                <span class="psc-step-n">★</span>
                <span class="psc-step-name">The documents compared with each other</span>
                <span class="psc-step-state">
                  @switch (run.caseReview) {
                    @case ('PENDING') { Waiting }
                    @case ('RUNNING') { Comparing… }
                    @case ('DONE') { Done }
                    @case ('FAILED') { Failed }
                    @case ('SKIPPED') { Not run: a document failed }
                  }
                </span>
              </li>
            </ol>
            @if (run.error) { <p class="psc-neg psc-small">{{ run.error }}</p> }
            @if (run.status === 'FAILED') {
              <p class="muted psc-small">Nothing was guessed in place of the AI. Run the scrutiny again; documents already done are kept.</p>
            }
          </section>
        } @else if (currentDocuments().length > 0) {
          <div class="card card-pad psc-banner" role="status">
            <app-icon name="info" [size]="16" /> The documents have not been scrutinised yet. Choose <strong>Run the AI scrutiny</strong>: the AI reads each document in turn, checks it against the import-LC rules and sanctions, and compares them.
          </div>
        }

        <!-- Approval -->
        @if (r.approval.approved; as ap) {
          <section class="card card-pad psc-approved" role="status">
            <h2 class="psc-h"><app-icon name="check" [size]="16" /> Approved</h2>
            <p>Approved by {{ ap.by }}@if (ap.at) { on {{ ap.at | date: 'medium' }} }. {{ ap.rationale }}</p>
          </section>
        } @else if (r.approval.canApprove) {
          <section class="card card-pad">
            <h2 class="psc-h">Approve the request</h2>
            @if (r.approval.blockers.length > 0) {
              <p class="muted psc-small">It cannot be approved yet:</p>
              <ul class="psc-list">
                @for (b of r.approval.blockers; track b) {
                  <li>@if (blockerFinding(b); as fid) { <a href="javascript:void(0)" (click)="goToFinding(fid)">{{ b }}</a> <span class="muted psc-small">(resolve it below)</span> } @else { {{ b }} }</li>
                }
              </ul>
            } @else {
              <p class="muted psc-small">Nothing blocks the request. Approving is one step by the trade desk; it is recorded in the audit trail.</p>
            }
            <textarea class="input" rows="2" [value]="rationale()" (input)="rationale.set($any($event.target).value)" placeholder="Why it is approved (required)" aria-label="Reason for the approval"></textarea>
            <div class="row psc-actions">
              <button type="button" class="btn btn-primary" [disabled]="busy() || r.approval.blockers.length > 0 || rationale().trim().length < 3" (click)="approve()"><app-icon name="check" [size]="14" /> Approve the request</button>
            </div>
          </section>
        }

        <!-- Message to the customer -->
        @if (auth.can('tradecase.query.raise')) {
          <section class="card card-pad psc-mail">
            <div class="row-between psc-mail-head">
              <div>
                <h2 class="psc-h">Message to the customer</h2>
                <p class="muted psc-small">Send every issue the customer can act on in one message. They read it, correct the documents and reply with the corrected ones.</p>
              </div>
              @if (!mail()) {
                <button type="button" class="btn btn-primary" [disabled]="busy() || r.counts.openFindings === 0" (click)="openComposer()"><app-icon name="mail" [size]="14" /> Write the message</button>
              }
            </div>

            @if (mail(); as m) {
              @if (m.available.length === 0) {
                <p class="muted">There is nothing the customer can act on right now.{{ m.withheld > 0 ? ' ' + m.withheld + ' open finding' + (m.withheld === 1 ? ' is' : 's are') + ' for the bank only.' : '' }}</p>
                <button type="button" class="btn btn-ghost btn-sm" (click)="closeComposer()">Close</button>
              } @else {
                <fieldset class="psc-issues">
                  <legend>Issues to include ({{ selected().size }} of {{ m.available.length }})</legend>
                  @for (a of m.available; track a.findingId) {
                    <label class="psc-issue">
                      <input type="checkbox" [checked]="selected().has(a.findingId)" (change)="toggleIssue(a.findingId)" [disabled]="busy()" />
                      <span class="chip" [class]="'chip ' + (a.severity === 'CRITICAL' || a.severity === 'HIGH' ? 'chip-negative' : a.severity === 'MEDIUM' ? 'chip-warning' : 'chip-info')">{{ a.severity }}</span>
                      {{ a.title }}
                      @if (a.alreadyAsked) { <span class="chip chip-info" title="Already in a message still waiting for the customer">already asked</span> }
                    </label>
                  }
                </fieldset>
                @if (m.drafted === 'AI') {
                  <p class="psc-small psc-pos"><app-icon name="sparkle" [size]="13" /> Written by the AI ({{ m.model }}). Read it and edit it before sending.</p>
                } @else if (m.drafted === 'TEMPLATE') {
                  <p class="psc-small psc-warn">The AI could not write this message ({{ m.aiError }}). This is a plain template; you can edit it or try again.</p>
                }
                @if (m.withheld > 0) {
                  <p class="muted psc-small">{{ m.withheld }} open finding{{ m.withheld === 1 ? '' : 's' }} (compliance, credit or internal checks) {{ m.withheld === 1 ? 'is' : 'are' }} not in the message: they stay with the bank.</p>
                }
                <div class="psc-letter">
                  <div class="psc-letter-row"><span>To</span><strong>{{ r.customerRef }}</strong></div>
                  <label class="psc-letter-row"><span>Subject</span><input class="input" [value]="subject()" (input)="subject.set($any($event.target).value)" /></label>
                  <textarea class="input psc-body" rows="16" [value]="body()" (input)="body.set($any($event.target).value)" aria-label="Message"></textarea>
                </div>
                <p class="muted psc-small">Changing the list above writes the message again; edit the text after choosing the issues.</p>
                <div class="row psc-actions">
                  <button type="button" class="btn btn-primary" [disabled]="busy() || selected().size === 0 || !subject().trim() || body().trim().length < 10" (click)="sendMail()"><app-icon name="mail" [size]="14" /> Send to the customer</button>
                  <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="closeComposer()">Cancel</button>
                </div>
              }
            }

            @if (r.mails.length > 0) {
              <h3 class="psc-h3">Sent</h3>
              <ul class="psc-sent">
                @for (x of r.mails; track x.queryId) {
                  <li>
                    <div class="row-between">
                      <strong>{{ x.subject || x.queryId }}</strong>
                      <span class="chip" [class.chip-warning]="x.status === 'OPEN'" [class.chip-info]="x.status === 'ANSWERED'" [class.chip-positive]="x.status === 'RESOLVED'">{{ x.status === 'OPEN' ? 'Waiting for the customer' : x.status === 'ANSWERED' ? 'Customer replied' : 'Resolved' }}</span>
                    </div>
                    <p class="muted psc-small">{{ x.raisedBy }} · {{ x.raisedAt | date: 'medium' }} · {{ x.findingIds.length }} issue{{ x.findingIds.length === 1 ? '' : 's' }}</p>
                    @for (rep of x.replies; track $index) {
                      <div class="psc-reply"><strong>{{ rep.by }}</strong> <span class="muted">{{ rep.at | date: 'short' }}</span>: {{ rep.text }}
                        @if (rep.documents.length > 0) { <div class="psc-small">Corrected documents: {{ rep.documents.join(', ') }}. Analyze the documents again to check them.</div> }
                      </div>
                    }
                    @if (x.status === 'ANSWERED' && auth.can('tradecase.query.resolve')) {
                      <div class="row psc-actions psc-qresolve">
                        <input class="input" [value]="queryWhy(x.queryId)" (input)="queryReasons.set(x.queryId, $any($event.target).value)" placeholder="Why the message is resolved (required)" aria-label="Why the message is resolved" />
                        <button type="button" class="btn btn-primary btn-sm" [disabled]="busy() || queryWhy(x.queryId).trim().length < 3" (click)="resolveMail(x.queryId)">Resolve the message</button>
                      </div>
                    }
                  </li>
                }
              </ul>
            }
          </section>
        }

        <!-- Documents, each with what the AI found in it -->
        <section class="card card-pad">
          <h2 class="psc-h">Documents</h2>
          @if (r.documents.length === 0) {
            <p class="muted">The customer has not sent any documents.</p>
          }
          @for (d of currentDocuments(); track d.linkId) {
            <article class="psc-doc">
              <div class="row-between psc-doc-head">
                <div>
                  <strong>{{ humanize(d.documentType.toLowerCase()) }}</strong>
                  <span class="chip">v{{ d.version }}</span>
                  @if (d.typeSource === 'AI') { <span class="chip chip-positive" [title]="d.detection?.reason ?? ''">recognised by the AI · {{ ((d.detection?.confidence ?? 0) * 100) | number: '1.0-0' }}%</span> }
                  @else if (d.typeSource === 'CUSTOMER') { <span class="chip chip-info">type chosen by the customer</span> }
                  @else { <span class="chip chip-warning">type not recognised</span> }
                  @if (!d.review) { <span class="chip chip-warning">new: not scrutinised yet</span> }
                  @if (d.detection?.type === 'SHIPPING_DOCUMENT') { <span class="chip chip-negative">looks like a shipping document</span> }
                </div>
                <span class="muted psc-small">{{ d.filename }} · {{ d.uploadedAt | date: 'short' }}</span>
              </div>
              @if (d.step; as st) {
                <p class="psc-small" [class.psc-neg]="st.status === 'FAILED'">Scrutiny: {{ st.status === 'DONE' ? 'done' : st.status === 'FAILED' ? 'failed — ' + st.error : st.status === 'READING' ? 'reading…' : st.status === 'REVIEWING' ? 'checking…' : 'waiting' }}</p>
              }
              @if (d.review; as rv) {
                <p>{{ rv.summary }}</p>
                <div class="grid grid-2 psc-pm">
                  <div>
                    <h3 class="psc-h3">Available in this document</h3>
                    @if (rv.present.length === 0) { <p class="muted psc-small">Nothing listed.</p> }
                    <ul class="psc-list psc-ok">@for (x of rv.present; track $index) { <li>{{ x }}</li> }</ul>
                  </div>
                  <div>
                    <h3 class="psc-h3">Missing from this document</h3>
                    @if (rv.missing.length === 0) { <p class="muted psc-small">Nothing missing.</p> }
                    <ul class="psc-list psc-miss">@for (x of rv.missing; track $index) { <li>{{ x }}</li> }</ul>
                  </div>
                </div>
                @if (rv.issues.length > 0) {
                  <h3 class="psc-h3">Issues the AI found</h3>
                  <ul class="psc-issuelist">
                    @for (i of rv.issues; track $index) {
                      <li>
                        <span class="chip" [class]="'chip ' + (i.severity === 'CRITICAL' || i.severity === 'HIGH' ? 'chip-negative' : i.severity === 'MEDIUM' ? 'chip-warning' : 'chip-info')">{{ i.severity }}</span>
                        <span class="chip">{{ humanize(i.category.toLowerCase()) }}</span>
                        <strong>{{ i.title }}</strong>
                        <div class="psc-small">{{ i.description }}</div>
                        @if (i.evidence) { <div class="psc-small psc-quote">“{{ i.evidence }}”</div> }
                        @if (i.regulation) { <div class="psc-small muted">Basis: {{ i.regulation }}</div> }
                        @if (i.customerAction) { <div class="psc-small"><strong>Customer to:</strong> {{ i.customerAction }}</div> }
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="muted psc-small">The AI found no issue in this document.</p>
                }
                @if (rv.withheld > 0) { <p class="muted psc-small">{{ rv.withheld }} bank-only point{{ rv.withheld === 1 ? '' : 's' }} not shown to you.</p> }
                @if (rv.notCheckable.length > 0) {
                  <p class="muted psc-small">Could not be checked from this document: {{ rv.notCheckable.join('; ') }}</p>
                }
                @if (rv.discarded?.length) {
                  <details class="psc-small muted psc-left-out">
                    <summary>{{ rv.discarded!.length }} point{{ rv.discarded!.length === 1 ? '' : 's' }} the AI raised {{ rv.discarded!.length === 1 ? 'was' : 'were' }} left out: the words quoted are not in the document</summary>
                    <ul>@for (x of rv.discarded!; track $index) { <li><strong>{{ x.title }}</strong>: {{ x.reason }}</li> }</ul>
                  </details>
                }
                <p class="muted psc-small">Reviewed by {{ rv.model }} · {{ rv.at | date: 'medium' }}</p>
              } @else if (d.detectionError) {
                <p class="psc-warn psc-small">{{ d.detectionError }}</p>
              }
            </article>
          }

          @if (olderDocuments().length > 0) {
            <details class="psc-older">
              <summary>Earlier versions the customer replaced ({{ olderDocuments().length }}): ignored by the scrutiny</summary>
              <ul class="psc-list">
                @for (d of olderDocuments(); track d.linkId) {
                  <li class="psc-old">{{ humanize(d.documentType.toLowerCase()) }} v{{ d.version }} · {{ d.filename }} · {{ d.uploadedAt | date: 'short' }}</li>
                }
              </ul>
            </details>
          }
        </section>

        <!-- The documents against each other -->
        @if (r.comparison; as cmp) {
          <section class="card card-pad">
            <h2 class="psc-h">The documents compared with each other</h2>
            @if (!cmp.current) {
              <p class="psc-warn psc-small">The documents have changed since this comparison. Run the scrutiny again to compare the current ones.</p>
            }
            <p>{{ cmp.summary }}</p>
            @if (cmp.issues.length === 0) {
              <p class="muted psc-small">The AI found no difference between the documents.</p>
            } @else {
              <ul class="psc-issuelist">
                @for (i of cmp.issues; track $index) {
                  <li>
                    <span class="chip" [class]="'chip ' + (i.severity === 'CRITICAL' || i.severity === 'HIGH' ? 'chip-negative' : i.severity === 'MEDIUM' ? 'chip-warning' : 'chip-info')">{{ i.severity }}</span>
                    <span class="chip">{{ humanize(i.category.toLowerCase()) }}</span>
                    <strong>{{ i.title }}</strong>
                    <div class="psc-small">{{ i.description }}</div>
                    @if (i.documentsInvolved.length > 0) { <div class="psc-small muted">Documents: {{ i.documentsInvolved.join(', ') }}</div> }
                    @if (i.customerAction) { <div class="psc-small"><strong>Customer to:</strong> {{ i.customerAction }}</div> }
                  </li>
                }
              </ul>
            }
            @if (cmp.withheld > 0) { <p class="muted psc-small">{{ cmp.withheld }} bank-only point{{ cmp.withheld === 1 ? '' : 's' }} not shown to you.</p> }
            @if (cmp.notCheckable.length > 0) { <p class="muted psc-small">Could not be checked from the documents: {{ cmp.notCheckable.join('; ') }}</p> }
            @if (cmp.discarded?.length) {
              <details class="psc-small muted psc-left-out">
                <summary>{{ cmp.discarded!.length }} difference{{ cmp.discarded!.length === 1 ? '' : 's' }} the AI raised {{ cmp.discarded!.length === 1 ? 'was' : 'were' }} left out: the words quoted are not in the documents</summary>
                <ul>@for (x of cmp.discarded!; track $index) { <li><strong>{{ x.title }}</strong>: {{ x.reason }}</li> }</ul>
              </details>
            }
            <p class="muted psc-small">Compared by {{ cmp.model }} · {{ cmp.at | date: 'medium' }}</p>
          </section>
        }

        <!-- What the AI read -->
        <section class="card card-pad">
          <h2 class="psc-h">What the AI read in the proforma invoice</h2>
          @if (!r.extracted) {
            <p class="muted">Nothing yet: the proforma invoice has not been analysed.</p>
          } @else {
            <p class="muted psc-small">From “{{ r.extracted.filename }}”. Values are read by the analysis and must be checked against the original where the findings below say so.</p>
            <dl class="psc-dl">
              <div><dt>Invoice number</dt><dd>{{ r.extracted.number || '—' }}</dd></div>
              <div><dt>Invoice date</dt><dd>{{ r.extracted.date || '—' }}</dd></div>
              <div><dt>Supplier (beneficiary)</dt><dd>{{ party(r.extracted.seller) }}</dd></div>
              <div><dt>Buyer (applicant)</dt><dd>{{ party(r.extracted.buyer) }}</dd></div>
              <div><dt>Amount</dt><dd>{{ r.extracted.totalValue ? (r.extracted.currency || '') + ' ' + (r.extracted.totalValue | number: '1.2-2') : '—' }}</dd></div>
              <div><dt>Payment terms</dt><dd>{{ r.extracted.paymentTerms || '—' }}</dd></div>
              <div><dt>Incoterm</dt><dd>{{ r.extracted.incoterm || '—' }}</dd></div>
              <div><dt>Country of origin</dt><dd>{{ r.extracted.originCountry || '—' }}</dd></div>
              <div><dt>Port of loading</dt><dd>{{ r.extracted.portOfLoading || '—' }}</dd></div>
              <div><dt>Port of discharge</dt><dd>{{ r.extracted.portOfDischarge || '—' }}</dd></div>
              <div><dt>Arithmetic</dt><dd>
                @if (r.extracted.arithmetic.sound) { <span class="chip chip-positive">Adds up</span> } @else { <span class="chip chip-negative">Does not reconcile</span> {{ r.extracted.arithmetic.notes.join(' ') }} }
              </dd></div>
            </dl>
            @if (r.extracted.goods.length > 0) {
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>Goods</th><th>HS code</th><th>Quantity</th><th>Unit price</th><th>Line total</th><th>Origin</th></tr></thead>
                  <tbody>
                    @for (g of r.extracted.goods; track $index) {
                      <tr>
                        <td>{{ g.description }}</td>
                        <td>{{ g.hsCode || '—' }}</td>
                        <td>{{ g.quantity | number: '1.0-4' }} {{ g.unit }}</td>
                        <td>{{ g.unitPrice | number: '1.2-4' }}</td>
                        <td>{{ g.total | number: '1.2-2' }}</td>
                        <td>{{ g.origin || '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        </section>

        <!-- Missing -->
        <section class="card card-pad">
          <h2 class="psc-h">What is missing</h2>
          @if (r.missing.length === 0) {
            <p class="muted">Every field the bank requires is stated.</p>
          } @else {
            <p class="muted psc-small">Not stated in the documents and not on the application. Nothing here is guessed. Ask the customer through a query on the case.</p>
            <ul class="psc-chips">
              @for (m of r.missing; track m.path) { <li class="chip chip-warning">{{ m.label }}</li> }
            </ul>
          }
        </section>

        <!-- Checks against official sources -->
        @if (r.externalVerification; as ev) {
          <section class="card card-pad" id="external-verification">
            <div class="row-between">
              <h2 class="psc-h">Checks against official sources</h2>
              @if (ev.lastRun) {
                <div class="row psc-evfilter" role="group" aria-label="Which results to show">
                  @if (auth.can('tradecase.verification.export')) {
                    <button type="button" class="btn btn-sm btn-ghost" [disabled]="reporting()" (click)="downloadEvidenceReport()" title="A PDF of what was checked, against which sources, and what was not checked. The download is recorded in the case audit log.">{{ reporting() ? 'Preparing…' : 'Download evidence report' }}</button>
                  }
                  <button type="button" class="btn btn-sm" [class.btn-primary]="!evShowAll()" [class.btn-ghost]="evShowAll()" (click)="evShowAll.set(false)">Needs attention ({{ evAttention(ev) }})</button>
                  <button type="button" class="btn btn-sm" [class.btn-primary]="evShowAll()" [class.btn-ghost]="!evShowAll()" (click)="evShowAll.set(true)">All checked ({{ ev.lastRun.results.length }})</button>
                </div>
              }
            </div>
            <p class="muted psc-small">The goods and codes declared in the documents are compared with an official reference. A result is evidence for a trade officer, not a legal ruling; “consistent” means the evidence available does not contradict the claim, not that it is proven.</p>

            @if (!ev.lastRun) {
              <p class="muted">The checks have not run yet. They run when the documents have been read.</p>
            } @else {
              @for (m of ev.lastRun.modules; track m.module) {
                <p class="psc-small">
                  <strong>{{ evModule(m.module) }}</strong>
                  <span class="chip" [class.chip-positive]="m.state === 'COMPLETE'" [class.chip-warning]="m.state === 'PARTIAL' || m.state === 'NOT_RUN'" [class.chip-negative]="m.state === 'SOURCE_UNAVAILABLE'">{{ humanize(m.state.toLowerCase()) }}</span>
                  {{ m.claimsChecked }} claim{{ m.claimsChecked === 1 ? '' : 's' }} checked · run {{ ev.lastRun.finishedAt | date: 'medium' }}
                </p>
                @if (m.notChecked.length > 0) {
                  <ul class="psc-small muted psc-notchecked">@for (n of m.notChecked; track $index) { <li>Not checked: {{ n }}</li> }</ul>
                }
              }

              <ul class="psc-evlist">
                @for (v of evResults(ev); track v.subject + v.ruleId) {
                  <li class="psc-evitem" [class.psc-evbad]="v.blocking">
                    <div class="row psc-evhead">
                      <span class="chip" [class]="evChip(v.status)">{{ evLabel(v.status) }}</span>
                      @if (ev.rules?.[v.ruleId]; as rs) { <span class="chip" [class.chip-positive]="rs.mode === 'ENFORCED'" [class.chip-warning]="rs.mode !== 'ENFORCED'" [title]="rs.label">{{ rs.mode === 'ENFORCED' ? 'approved control' : rs.mode === 'SHADOW' ? 'shadow: advisory' : 'demonstration' }}</span> }
                      @if (v.blocking && (ev.rules?.[v.ruleId]?.mayBlock ?? true)) { <span class="chip chip-negative">blocks approval</span> }
                      @if (v.humanReviewRequired) { <span class="chip chip-warning">officer review</span> }
                      <strong>{{ v.title }}</strong>
                    </div>
                    <p class="psc-small">{{ v.explanation }}</p>
                    <dl class="psc-evdl psc-small">
                      @if (v.claims[0]; as c) { <dt>Document</dt><dd>{{ c.filename }}</dd> }
                      <dt>Declared</dt><dd>{{ v.declared }}</dd>
                      @if (v.retrieved) { <dt>Official record</dt><dd>{{ v.retrieved }}</dd> }
                      <dt>Rule</dt><dd>{{ v.ruleId }}</dd>
                      @if (v.transactionDate) { <dt>Dated to</dt><dd>{{ v.transactionDate | date: 'mediumDate' }} (assessed {{ v.assessedAt | date: 'medium' }})</dd> }
                    </dl>
                    <details class="psc-small psc-evrecords" [open]="!evClean(v.status)">
                    <summary class="muted">Source records consulted ({{ v.evidence.length }})</summary>
                    @for (e of v.evidence; track e.recordId) {
                      <div class="psc-small psc-evsource">
                        <strong>{{ e.sourceName }} · {{ e.recordId }}</strong>: {{ e.excerpt }}
                        <div class="muted">Retrieved {{ e.retrievedAt | date: 'medium' }} · file sha256 {{ e.contentHash.slice(0, 12) }}@if (e.stale) { · <span class="psc-neg">STALE: older than its freshness limit</span> }</div>
                      </div>
                    }
                    </details>
                    @if (v.limitations.length > 0) {
                      <details class="psc-small muted"><summary>What this does not establish ({{ v.limitations.length }})</summary><ul>@for (l of v.limitations; track $index) { <li>{{ l }}</li> }</ul></details>
                    }
                  </li>
                } @empty {
                  <li class="muted psc-small">Nothing needs attention. Switch to “All checked” to see what was found consistent.</li>
                }
              </ul>
            }

            <details class="psc-small psc-sources">
              <summary>Sources: what is connected and what is not ({{ ev.sources.catalogue.length }})</summary>
              <table class="table">
                <thead><tr><th>Source</th><th>Status</th><th>Licence / terms</th><th>Does not cover</th></tr></thead>
                <tbody>
                  @for (s of ev.sources.catalogue; track s.sourceId) {
                    <tr>
                      <td><strong>{{ s.name }}</strong><div class="muted">{{ s.publisher }} · {{ s.jurisdiction }} · owner: {{ s.owner }}</div></td>
                      <td>
                        <span class="chip" [class.chip-positive]="s.integration === 'OPERATIONAL'" [class.chip-info]="s.integration === 'EXISTING_ENGINE'" [class.chip-negative]="s.integration === 'NOT_INTEGRATED'">{{ s.integration === 'OPERATIONAL' ? 'connected' : s.integration === 'EXISTING_ENGINE' ? 'in use (screening engine)' : 'not integrated' }}</span>
                        @if (evHealth(ev, s.sourceId); as h) { <div class="muted">{{ humanize(h.state.toLowerCase()) }}@if (h.lastSuccessfulRetrievalAt) { · {{ h.lastSuccessfulRetrievalAt | date: 'mediumDate' }} }@if (h.recordCount) { · {{ h.recordCount }} records }</div> }
                      </td>
                      <td>{{ s.licence }}</td>
                      <td>@if (s.gaps.length === 0) { <span class="muted">-</span> } @else { <ul>@for (g of s.gaps; track $index) { <li>{{ g }}</li> }</ul> }</td>
                    </tr>
                  }
                </tbody>
              </table>
            </details>
          </section>
        }

        <!-- Screening -->
        <section class="card card-pad">
          <h2 class="psc-h">Sanctions and jurisdiction screening</h2>
          @if (!r.screening.application && !r.screening.document) {
            <p class="muted">Screening has not run: no party names are on file yet. It runs once the documents are analysed.</p>
          }
          @if (r.screening.application; as s) {
            <h3 class="psc-h3">Parties screened</h3>
            @if (s.error) {
              <p class="psc-neg">Screening could not run: {{ s.error }}. The parties are NOT treated as clear.</p>
            } @else {
              <p class="muted psc-small">Against the sanctions lists held in dataset {{ s.datasetVersion || 'n/a' }} · {{ s.screenedAt | date: 'medium' }} ·
                @if (s.matchCount === 0) { <span class="psc-pos">no match found</span> } @else { <span class="psc-neg">{{ s.matchCount }} possible match{{ s.matchCount === 1 ? '' : 'es' }}</span> }
              </p>
            }
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Role</th><th>Name</th><th>Country</th></tr></thead>
                <tbody>@for (p of s.parties; track p.role) { <tr><td>{{ p.role }}</td><td>{{ p.name }}</td><td>{{ p.country || '—' }}</td></tr> }</tbody>
              </table>
            </div>
          }
          @if (r.screening.document; as d) {
            <h3 class="psc-h3">Countries and route on the document</h3>
            <p class="muted psc-small">{{ d.screenedEntities }} name{{ d.screenedEntities === 1 ? '' : 's' }} and {{ d.screenedCountries }} countr{{ d.screenedCountries === 1 ? 'y' : 'ies' }} checked · dataset {{ d.datasetVersion || 'n/a' }}</p>
            @if (d.jurisdictions.length === 0) {
              <p class="muted">No country could be read from the document, so no jurisdiction was checked.</p>
            } @else {
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>Where</th><th>Country</th><th>Status</th></tr></thead>
                  <tbody>
                    @for (j of d.jurisdictions; track $index) {
                      <tr>
                        <td>{{ humanize(j.role.toLowerCase()) }}</td>
                        <td>{{ j.country }}</td>
                        <td>
                          <span class="chip" [class]="'chip ' + (isClear(j.status) ? 'chip-positive' : j.status === 'UNKNOWN' ? 'chip-info' : 'chip-negative')">{{ humanize(j.status.toLowerCase()) }}</span>
                          @if (!isClear(j.status) && j.description) { <div class="psc-small muted">{{ j.description }}</div> }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
            @if (d.matches.length > 0) {
              <h3 class="psc-h3">Possible sanctions matches</h3>
              <ul class="psc-list">
                @for (m of d.matches; track $index) {
                  <li><strong>{{ m.subject }}</strong> ({{ humanize(m.role.toLowerCase()) }}) resembles <strong>{{ m.matched }}</strong> on {{ humanize(m.list.toLowerCase()) }}{{ m.program ? ' (' + m.program + ')' : '' }}, {{ humanize(m.type.toLowerCase()) }}, {{ m.confidence * 100 | number: '1.0-0' }}% — evidence for review, not proof.</li>
                }
              </ul>
            }
            @if (d.unscreenedNames.length > 0) {
              <p class="psc-warn">Not screened (nothing comparable on the document): {{ d.unscreenedNames.join(', ') }}</p>
            }
          }
        </section>

        <!-- Regulatory and risk read of the document -->
        @if (r.analysis; as a) {
          <section class="card card-pad">
            <h2 class="psc-h">Regulatory and risk read of the documents</h2>
            @if (a.sbp) {
              <p><strong>SBP framework:</strong> <span class="chip" [class]="'chip ' + (a.sbp.verdict === 'COMPLIANT' ? 'chip-positive' : 'chip-negative')">{{ humanize(a.sbp.verdict.toLowerCase()) }}</span> {{ a.sbp.explanation }}</p>
              @if (a.sbp.circulars.length > 0) {
                <ul class="psc-list">
                  @for (c of a.sbp.circulars; track c.ref) { <li><strong>{{ c.ref }}</strong> {{ c.title }}: {{ c.requirement }} <span class="chip" [class]="'chip ' + (c.status === 'COMPLIANT' ? 'chip-positive' : 'chip-warning')">{{ humanize(c.status.toLowerCase()) }}</span></li> }
                </ul>
              }
            }
            <p><strong>Export controls:</strong> {{ a.exportControls.status ? humanize(a.exportControls.status.toLowerCase()) : 'not assessed' }}</p>
            @if (a.exportControls.goods.length > 0) {
              <ul class="psc-list">
                @for (g of a.exportControls.goods; track $index) { <li><strong>{{ g.item }}</strong> — {{ g.category }}: {{ g.reason }}. {{ g.licence }}</li> }
              </ul>
            }
            <p><strong>Trade-based money laundering:</strong> {{ a.tbml.level ? humanize(a.tbml.level.toLowerCase()) + ' risk' : 'not assessed' }}{{ a.tbml.score !== null ? ' (score ' + a.tbml.score + ')' : '' }}</p>
            @if (a.tbml.redFlags.length > 0) {
              <ul class="psc-list">
                @for (f of a.tbml.redFlags; track $index) { <li><span class="chip" [class]="'chip ' + (f.severity === 'HIGH' || f.severity === 'CRITICAL' ? 'chip-negative' : 'chip-warning')">{{ f.severity }}</span> <strong>{{ f.title }}</strong>: {{ f.description }} <span class="muted">Evidence: {{ f.evidence }}</span></li> }
              </ul>
            } @else {
              <p class="muted psc-small">No red flag was raised on the document.</p>
            }
          </section>
        }

        <!-- Rules -->
        <section class="card card-pad">
          <h2 class="psc-h">Rule checks</h2>
          <p class="muted psc-small">Every pre-trade rule, with its outcome on this case. A rule that could not run says why; none is reported as passed unless it ran.</p>
          @for (g of ruleGroups(); track g.name) {
            <h3 class="psc-h3">{{ g.name }}</h3>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Rule</th><th>Outcome</th><th>Source</th></tr></thead>
                <tbody>
                  @for (rule of g.rules; track rule.ruleId) {
                    <tr>
                      <td><strong>{{ rule.name }}</strong><div class="psc-small muted">{{ rule.ruleId }}</div></td>
                      <td>
                        <span class="chip" [class]="'chip ' + ruleChip(rule)">{{ ruleLabel(rule) }}</span>
                        @if (rule.reason) { <div class="psc-small muted">{{ rule.reason }}</div> }
                      </td>
                      <td class="psc-small">{{ rule.source }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <!-- Findings -->
        <section>
          <div class="row-between"><h2 class="psc-h">Findings ({{ r.findings.length }})</h2>
            <a [routerLink]="['/trade-cases', r.caseId]" class="btn btn-ghost btn-sm">Record dispositions on the case</a></div>
          @if (r.findings.length === 0) {
            <div class="card card-pad muted">{{ r.counts.rulesChecked === 0 ? 'No rule has run yet.' : 'No finding was raised.' }}</div>
          }
          @for (f of r.findings; track f.findingId) {
            <article class="card card-pad psc-finding" [id]="'finding-' + f.findingId" [class.psc-blocking]="f.blocking && f.status === 'OPEN'">
              <div class="row-between">
                <div>
                  <span class="psc-fid">{{ f.findingId }}</span>
                  <span class="chip" [class]="'chip ' + severityChip(f)">{{ f.severity }}</span>
                  <span class="chip">{{ humanize(f.category.toLowerCase()) }}</span>
                  @if (f.blocking) { <span class="chip chip-negative">blocking</span> }
                  <span class="chip chip-info">{{ f.ruleId }}</span>
                </div>
                <span class="chip" [class.chip-positive]="f.status !== 'OPEN'">{{ f.status === 'OPEN' ? 'Open' : f.status === 'RESOLVED' ? 'Resolved' : 'Dispositioned' }}</span>
              </div>
              <h3 class="psc-ftitle">{{ f.title }}</h3>
              <p>{{ f.description }}</p>
              @if (f.observed.length > 0) {
                <ul class="psc-evidence">
                  @for (e of f.observed; track $index) {
                    <li><span class="chip">{{ e.source === 'DOCUMENT' ? (e.filename ?? 'Document') : humanize(e.source.toLowerCase()) }}</span> <strong>{{ e.label }}:</strong> {{ e.value }}@if (e.pageNumber) { <span class="muted"> (page {{ e.pageNumber }})</span> }</li>
                  }
                </ul>
              }
              <p class="psc-small"><strong>Expected:</strong> {{ f.expected }}</p>
              <p class="psc-small"><strong>Next step:</strong> {{ f.recommendedAction }}</p>
              @if (f.disposition) {
                <p class="psc-small"><strong>{{ dispositionLabel(f.disposition.code) }}</strong> by {{ f.disposition.by.name }}: {{ f.disposition.rationale }}</p>
                @if (f.disposition.code === 'CONFIRMED_ESCALATED') {
                  <p class="psc-small psc-neg">This finding was escalated, so it still blocks the approval. If it was a mistake or has been looked at again, resolve it below.</p>
                }
              }
              @if (canResolve(f)) {
                <div class="row psc-resolve">
                  <select class="input" aria-label="How this finding was resolved" [value]="resolveCode(f)" (change)="resolveCodes.set(f.findingId, $any($event.target).value)">
                    @for (o of dispositionOptions(f); track o) { <option [value]="o" [selected]="o === resolveCode(f)">{{ dispositionLabel(o) }}</option> }
                  </select>
                  <input class="input" [value]="resolveWhy(f)" (input)="resolveReasons.set(f.findingId, $any($event.target).value)" placeholder="Why (required, at least 10 characters)" />
                  <button type="button" class="btn btn-primary btn-sm" [disabled]="busy() || resolveWhy(f).trim().length < 10" (click)="resolve(f)">{{ resolveCode(f) === 'CONFIRMED_ESCALATED' ? 'Escalate' : 'Resolve' }}</button>
                  <span class="muted psc-small psc-resolve-hint">Resolving takes it off the blocking list. Escalating keeps it blocking.</span>
                </div>
              }
            </article>
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      .psc-page { max-width: none; display: flex; flex-direction: column; gap: 16px; padding-bottom: 56px; }
      .psc-back { font-size: 0.85rem; }
      .psc-head { gap: 12px; flex-wrap: wrap; align-items: flex-start; }
      .psc-head h1 { margin: 0; }
      .psc-case { font-size: 0.6em; font-weight: 500; }
      .psc-actions { gap: 8px; flex-wrap: wrap; }
      .psc-banner { display: flex; gap: 10px; align-items: center; border-color: var(--accent, #00b3b3); }
      .psc-error { border-color: var(--negative); color: var(--negative); }
      .psc-tiles .card { display: flex; flex-direction: column; gap: 4px; }
      .psc-big { font-size: 1.6rem; }
      .psc-big small { font-size: 0.8rem; font-weight: 400; color: var(--ink-3); }
      .psc-bad { border-color: var(--negative); }
      .psc-h { font-size: 1.05rem; margin: 0 0 8px; }
      .psc-h3 { font-size: 0.92rem; margin: 14px 0 6px; }
      .psc-small { font-size: 0.82rem; }
      .psc-neg { color: var(--negative); }
      .psc-pos { color: var(--positive, #1f9d63); }
      .psc-warn { color: var(--warning, #b7791f); font-size: 0.88rem; }
      .psc-old { opacity: 0.6; }
      .psc-dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px 20px; margin: 10px 0; }
      .psc-dl div { display: flex; flex-direction: column; }
      .psc-dl dt { font-size: 0.78rem; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.04em; }
      .psc-dl dd { margin: 2px 0 0; }
      .psc-chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
      .psc-list { margin: 6px 0 12px; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; font-size: 0.9rem; }
      .psc-run { border-color: var(--line); }
      .psc-run-active { border-color: var(--accent, #00b3b3); }
      .psc-spin { display: inline-block; width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--accent, #00b3b3); animation: psc-rot 0.8s linear infinite; margin-right: 6px; vertical-align: -2px; }
      @keyframes psc-rot { to { transform: rotate(360deg); } }
      .psc-steps { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .psc-step { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; font-size: 0.9rem; }
      .psc-step-n { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 0.75rem; background: var(--sunken, #eee); }
      .psc-step-done .psc-step-n { background: color-mix(in srgb, var(--positive, #1f9d63) 25%, transparent); }
      .psc-step-failed .psc-step-n { background: color-mix(in srgb, var(--negative, #c0392b) 25%, transparent); }
      .psc-step-reading .psc-step-n, .psc-step-reviewing .psc-step-n { background: color-mix(in srgb, var(--accent, #00b3b3) 30%, transparent); }
      .psc-step-state { color: var(--ink-3); font-size: 0.82rem; }
      .psc-step-error { grid-column: 2 / -1; color: var(--negative); font-size: 0.82rem; }
      .psc-doc { border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; margin-bottom: 12px; }
      .psc-doc-head { gap: 8px; flex-wrap: wrap; align-items: flex-start; }
      .psc-pm { gap: 12px; }
      .psc-ok li::marker { color: var(--positive, #1f9d63); }
      .psc-miss li::marker { color: var(--negative, #c0392b); }
      .psc-issuelist { list-style: none; margin: 6px 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .psc-issuelist li { border-left: 3px solid var(--line); padding: 2px 10px; }
      .psc-quote { font-style: italic; }
      .psc-older { margin-top: 8px; font-size: 0.88rem; }
      .psc-resolve { gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
      .psc-resolve .input { min-width: 0; }
      .psc-resolve-hint { flex: 1 1 100%; }
      .psc-approved { border-color: var(--positive, #1f9d63); }
      .psc-mail-head { gap: 12px; flex-wrap: wrap; align-items: flex-start; }
      .psc-issues { border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
      .psc-issue { display: flex; gap: 8px; align-items: center; font-size: 0.9rem; }
      .psc-letter { border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
      .psc-letter-row { display: grid; grid-template-columns: 70px 1fr; gap: 8px; align-items: center; }
      .psc-letter-row span { color: var(--ink-3); font-size: 0.85rem; }
      .psc-body { font-family: inherit; line-height: 1.5; resize: vertical; }
      .psc-sent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
      .psc-left-out { margin-top: 8px; }
      .psc-left-out ul { margin: 6px 0 0 18px; padding: 0; }
      .psc-qresolve { margin-top: 8px; align-items: center; }
      .psc-qresolve .input { flex: 1 1 260px; }
      .psc-evlist { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .psc-evitem { border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 12px; }
      .psc-evbad { border-color: var(--negative); }
      .psc-evhead { gap: 8px; flex-wrap: wrap; align-items: center; }
      .psc-evdl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 6px 0; }
      .psc-evdl dt { color: var(--ink-3); }
      .psc-evdl dd { margin: 0; }
      .psc-evsource { border-left: 3px solid var(--line); padding: 2px 10px; margin-top: 6px; }
      .psc-notchecked { margin: 2px 0 8px 18px; padding: 0; }
      .psc-evfilter { gap: 6px; }
      .psc-evrecords { margin-top: 4px; }
      .psc-sources { margin-top: 14px; }
      .psc-sources td ul { margin: 0 0 0 16px; padding: 0; }
      .psc-reply { border-left: 3px solid var(--line); padding: 4px 10px; margin-top: 6px; font-size: 0.9rem; }
      .psc-finding { margin-bottom: 10px; }
      .psc-blocking { border-left: 3px solid var(--negative); }
      .psc-fid { font-weight: 600; margin-right: 6px; }
      .psc-ftitle { font-size: 1rem; margin: 8px 0 4px; }
      .psc-evidence { list-style: none; margin: 6px 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 0.88rem; }
      @media (max-width: 640px) { }
    `,
  ],
})
export class PreShipmentScrutinyComponent implements OnInit {
  /** Route parameter (component input binding). */
  readonly id = input.required<string>();

  protected readonly auth = inject(AuthService);
  private readonly service = inject(TradeCasesService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly statusLabels = STATUS_LABELS;
  protected readonly humanize = (s: string) => humanize(s);
  protected readonly report = signal<ScrutinyReport | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly reporting = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** The documents the scrutiny looks at: the current version of each. A document the customer replaced is ignored. */
  protected readonly currentDocuments = computed(() => (this.report()?.documents ?? []).filter((d) => d.active));
  protected readonly olderDocuments = computed(() => (this.report()?.documents ?? []).filter((d) => !d.active));

  protected readonly ruleGroups = computed(() => {
    const groups = new Map<string, ScrutinyRule[]>();
    for (const rule of this.report()?.rules ?? []) groups.set(rule.group, [...(groups.get(rule.group) ?? []), rule]);
    return [...groups.entries()].map(([name, rules]) => ({ name, rules }));
  });

  protected downloadEvidenceReport(): void {
    this.reporting.set(true);
    this.service.downloadVerificationReport(this.id()).subscribe({
      next: (name) => {
        this.reporting.set(false);
        this.toast.success('Evidence report downloaded', name);
      },
      error: () => {
        this.reporting.set(false);
        this.toast.error('The evidence report could not be downloaded', 'You may not have permission, or the case could not be read.');
      },
    });
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.stopPolling());
    this.load();
  }

  private load(): void {
    this.service.scrutiny(this.id()).subscribe({
      next: (r) => {
        this.report.set(r);
        this.error.set(null);
        // While the AI is reading documents, look again until it has finished.
        this.stopPolling();
        if (r.pendingAnalysis > 0 || r.run?.status === 'RUNNING') this.timer = setTimeout(() => this.load(), 3000);
      },
      error: (err: unknown) => {
        this.error.set(isApiError(err) ? err.message : 'The scrutiny report could not be loaded.');
        this.stopPolling();
      },
    });
  }

  private stopPolling(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ---------------------------------------------------------------- message to the customer

  protected readonly mail = signal<ComposedMail | null>(null);
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly subject = signal('');
  protected readonly body = signal('');

  protected openComposer(): void {
    this.busy.set(true);
    this.service.composeMail(this.id()).subscribe({
      next: (m) => {
        // Issues already in a message still waiting for the customer are not asked twice.
        const fresh = m.available.filter((a) => !a.alreadyAsked).map((a) => a.findingId);
        this.selected.set(new Set(fresh));
        if (fresh.length === m.issues.length) {
          this.applyDraft(m);
          this.busy.set(false);
        } else {
          this.recompose();
        }
        this.mail.set(m);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(isApiError(err) ? err.message : 'The message could not be drafted.');
      },
    });
  }

  protected toggleIssue(findingId: string): void {
    const next = new Set(this.selected());
    if (next.has(findingId)) next.delete(findingId);
    else next.add(findingId);
    this.selected.set(next);
    this.recompose();
  }

  private recompose(): void {
    this.busy.set(true);
    this.service.composeMail(this.id(), [...this.selected()]).subscribe({
      next: (m) => {
        this.applyDraft(m);
        this.busy.set(false);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(isApiError(err) ? err.message : 'The message could not be drafted.');
      },
    });
  }

  private applyDraft(m: ComposedMail): void {
    this.subject.set(m.subject);
    this.body.set(m.body);
  }

  protected closeComposer(): void {
    this.mail.set(null);
  }

  protected sendMail(): void {
    this.busy.set(true);
    this.service.sendMail(this.id(), { subject: this.subject().trim(), body: this.body().trim(), findingIds: [...this.selected()] }).subscribe({
      next: () => {
        this.busy.set(false);
        this.mail.set(null);
        this.toast.success('Message sent', `${this.id()}: the customer will see it on the case and can reply with corrected documents.`);
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(isApiError(err) ? err.message : 'The message could not be sent.');
      },
    });
  }

  // ---------------------------------------------------------------- resolving a finding here
  protected readonly resolveCodes = new Map<string, string>();
  protected readonly resolveReasons = new Map<string, string>();

  protected dispositionLabel(code: string): string {
    return dispositionLabel(code);
  }

  protected dispositionOptions(f: Finding): string[] {
    return DISPOSITIONS[f.category] ?? [];
  }

  protected resolveCode(f: Finding): string {
    return this.resolveCodes.get(f.findingId) ?? this.dispositionOptions(f)[0] ?? '';
  }

  protected resolveWhy(f: Finding): string {
    return this.resolveReasons.get(f.findingId) ?? '';
  }

  /** Whether this user may close the finding from here: the same rule the API applies. */
  protected canResolve(f: Finding): boolean {
    const v = this.report()?.viewer;
    const escalated = f.status === 'DISPOSITIONED' && f.disposition?.code === 'CONFIRMED_ESCALATED';
    if (!v || (f.status !== 'OPEN' && !escalated) || this.dispositionOptions(f).length === 0) return false;
    if (COMPLIANCE_CATEGORIES.includes(f.category)) return v.canDispositionCompliance;
    return v.canDisposition && this.auth.can(DEPARTMENT_PERMISSION[f.ownerDepartment]);
  }

  protected resolve(f: Finding): void {
    this.busy.set(true);
    this.error.set(null);
    this.service.action(this.id(), `findings/${f.findingId}/disposition`, { code: this.resolveCode(f), rationale: this.resolveWhy(f).trim() }).subscribe({
      next: () => {
        this.busy.set(false);
        this.resolveReasons.delete(f.findingId);
        this.toast.success(this.resolveCode(f) === 'CONFIRMED_ESCALATED' ? 'Escalated' : 'Resolved', `${f.findingId}`);
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(isApiError(err) ? err.message : 'The finding could not be closed.');
      },
    });
  }

  // ---- checks against official sources
  protected readonly evShowAll = signal(false);

  private static readonly CLEAN: ReadonlyArray<string> = ['VERIFIED', 'CONSISTENT', 'NOT_APPLICABLE'];

  protected evAttention(ev: ExternalVerificationView): number {
    return (ev.lastRun?.results ?? []).filter((v) => !PreShipmentScrutinyComponent.CLEAN.includes(v.status)).length;
  }

  protected evResults(ev: ExternalVerificationView): ClaimVerification[] {
    const all = ev.lastRun?.results ?? [];
    return this.evShowAll() ? all : all.filter((v) => !PreShipmentScrutinyComponent.CLEAN.includes(v.status));
  }

  protected evClean(status: string): boolean {
    return PreShipmentScrutinyComponent.CLEAN.includes(status);
  }

  protected evModule(module: string): string {
    return module === 'HS_CLASSIFICATION' ? 'HS classification' : humanize(module.toLowerCase());
  }

  protected evLabel(status: string): string {
    const labels: Record<string, string> = {
      VERIFIED: 'Verified against source',
      CONSISTENT: 'Consistent with source',
      DISCREPANCY: 'Discrepancy',
      POTENTIALLY_RESTRICTED: 'Potentially restricted',
      POTENTIAL_SANCTIONS_MATCH: 'Possible sanctions match',
      POTENTIAL_PRICING_ANOMALY: 'Possible pricing anomaly',
      INSUFFICIENT_EVIDENCE: 'Not enough evidence',
      SOURCE_UNAVAILABLE: 'Source unavailable: not checked',
      HISTORICAL_STATUS_UNAVAILABLE: 'Historical status unavailable',
      HUMAN_REVIEW_REQUIRED: 'Officer review required',
      NOT_APPLICABLE: 'Not applicable',
    };
    return labels[status] ?? status;
  }

  protected evChip(status: string): string {
    if (status === 'VERIFIED' || status === 'CONSISTENT') return 'chip chip-positive';
    if (status === 'DISCREPANCY' || status === 'POTENTIAL_SANCTIONS_MATCH' || status === 'POTENTIALLY_RESTRICTED') return 'chip chip-negative';
    if (status === 'NOT_APPLICABLE') return 'chip';
    return 'chip chip-warning';
  }

  protected evHealth(ev: ExternalVerificationView, sourceId: string) {
    return ev.sources.health.find((h) => h.sourceId === sourceId) ?? null;
  }

  protected readonly queryReasons = new Map<string, string>();

  protected queryWhy(queryId: string): string {
    return this.queryReasons.get(queryId) ?? '';
  }

  /** Closes a message the customer has answered, once the corrected documents have been checked. */
  protected resolveMail(queryId: string): void {
    this.busy.set(true);
    this.error.set(null);
    this.service.action(this.id(), `queries/${queryId}/resolve`, { decision: 'RESOLVE', rationale: this.queryWhy(queryId).trim() }).subscribe({
      next: () => {
        this.busy.set(false);
        this.queryReasons.delete(queryId);
        this.toast.success('Message resolved', queryId);
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(isApiError(err) ? err.message : 'The message could not be resolved.');
      },
    });
  }

  /** The finding an approval blocker is about ("F-0009 Proforma invoice ..."), if it is about one. */
  protected blockerFinding(blocker: string): string | null {
    return /^(F-\d{4})\b/.exec(blocker)?.[1] ?? null;
  }

  protected goToFinding(findingId: string): void {
    document.getElementById(`finding-${findingId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  protected readonly rationale = signal('');

  protected approve(): void {
    this.busy.set(true);
    this.error.set(null);
    this.service.approvePreShipment(this.id(), this.rationale().trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.rationale.set('');
        this.toast.success('Request approved', `${this.id()}: the customer sees it as approved.`);
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        if (isApiError(err)) {
          const blockers = (err.details as { blockers?: unknown } | undefined)?.blockers;
          this.error.set(Array.isArray(blockers) && blockers.length > 0 ? `${err.message} ${blockers.map(String).join('; ')}` : err.message);
        } else {
          this.error.set('The request could not be approved.');
        }
      },
    });
  }

  protected analyze(): void {
    this.busy.set(true);
    this.service.analyzeDocuments(this.id()).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.toast.success(res.started > 0 ? 'AI analysis started' : 'Nothing new to analyse', res.started > 0 ? `${res.started} document${res.started === 1 ? '' : 's'} queued.` : 'Every document is already analysed or in progress.');
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(isApiError(err) ? err.message : 'The analysis could not be started.');
      },
    });
  }

  protected recheck(): void {
    this.busy.set(true);
    this.service.action(this.id(), 'revalidate').subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success('Checks re-run', this.id());
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(isApiError(err) ? err.message : 'The checks could not be re-run.');
      },
    });
  }

  protected party(p: { legalName?: string; address?: string; country?: string } | null): string {
    if (!p) return '—';
    const parts = [p.legalName, p.address, p.country].filter((x): x is string => Boolean(x) && !/^(not found|not specified|n\/a|unknown)/i.test(x as string));
    return parts.length ? parts.join(', ') : '—';
  }

  protected isClear(status: string): boolean {
    return CLEAR_JURISDICTION.has(status);
  }

  protected analysisLabel(status: string): string {
    return status === 'completed' ? 'Analysed' : status === 'failed' ? 'Failed' : status === 'processing' || status === 'queued' ? 'Being analysed' : status === 'uploaded' ? 'Waiting for the desk' : humanize(status);
  }

  protected analysisChip(status: string): string {
    return status === 'completed' ? 'chip-positive' : status === 'failed' ? 'chip-negative' : status === 'processing' || status === 'queued' ? 'chip-info' : 'chip-warning';
  }

  protected sourceLabel(source: string): string {
    return source === 'AI_MODEL' ? 'AI model' : source === 'DETERMINISTIC_PARSER' ? 'Built-in parser' : source === 'DETERMINISTIC_FALLBACK_AFTER_AI_FAILURE' ? 'Parser (AI model unavailable)' : 'Earlier analysis';
  }

  protected ruleLabel(rule: ScrutinyRule): string {
    return rule.status === 'FLAGGED' ? `Flagged (${rule.openFindings} open)` : RULE_STATUS[rule.status].label;
  }

  protected ruleChip(rule: ScrutinyRule): string {
    return RULE_STATUS[rule.status].chip;
  }

  protected severityChip(f: Finding): string {
    return f.severity === 'CRITICAL' || f.severity === 'HIGH' ? 'chip-negative' : f.severity === 'MEDIUM' ? 'chip-warning' : 'chip-info';
  }
}
