import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { Icon } from '../../shared/components/icon';
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
  imports: [RouterLink, FormsModule, DatePipe, DecimalPipe, AnimatedCounter, Icon],
  template: `
    <div class="page psa-page">
      @if (!tc()) {
        <a routerLink="/post-shipment" class="muted psa-back">← Post-Shipment</a>
      }

      @if (error()) {
        <div class="card card-pad psa-error" role="alert">{{ error() }} <button type="button" class="btn btn-ghost btn-sm" (click)="load()">Retry</button></div>
      }

      @if (tc(); as c) {
        <header class="page-head psa-head">
          <a routerLink="/post-shipment" class="page-head-back">← Post-Shipment</a>
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
          <section class="page-head-kpis" aria-label="Summary">
            <div class="kpi-tile">
              <span class="kpi-tile-label">Documents sent</span>
              <strong class="kpi-tile-value"><app-animated-counter [value]="currentDocs().length" /></strong>
              <span class="kpi-tile-note">{{ awaiting().length }} not sent yet</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-tile-label">Required, still missing</span>
              <strong class="kpi-tile-value" [class.is-warn]="missingRequired().length > 0"><app-animated-counter [value]="missingRequired().length" /></strong>
              <span class="kpi-tile-note">of {{ requiredTypes().length }} required</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-tile-label">Questions from the bank</span>
              <strong class="kpi-tile-value" [class.is-warn]="openQueries().length > 0"><app-animated-counter [value]="openQueries().length" /></strong>
              <span class="kpi-tile-note">waiting for your reply</span>
            </div>
            <div class="kpi-tile">
              <span class="kpi-tile-label">Discrepancies</span>
              <strong class="kpi-tile-value" [class.is-alert]="discrepancies().length > 0"><app-animated-counter [value]="discrepancies().length" /></strong>
              <span class="kpi-tile-note">found in examination</span>
            </div>
          </section>
        </header>

        <!-- progress -->
        <ol class="card psa-steps" aria-label="Where this application stands">
          @for (step of steps(); track step.label; let i = $index) {
            <li [class.done]="step.done" [class.current]="step.current" [attr.aria-current]="step.current ? 'step' : null">
              <span class="psa-dot">{{ step.done ? '✓' : i + 1 }}</span>
              <span class="psa-step-label">{{ step.label }}</span>
            </li>
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
            <div class="row-between psa-card-head">
              <h2 class="psa-h">Documents ({{ currentDocs().length }})</h2>
              <span class="psa-ref-chip">Application {{ a.reference }}</span>
            </div>

            @if (requiredTypes().length) {
              <p class="psa-req-title">
                <span>The credit calls for</span>
                <strong>{{ requiredTypes().length - missingRequired().length }} of {{ requiredTypes().length }} added</strong>
              </p>
              <ul class="psa-required" aria-label="Documents the credit calls for">
                @for (t of requiredTypes(); track t) {
                  <li [class.have]="has(t)">
                    <span class="psa-tick">{{ has(t) ? '✓' : '' }}</span>
                    <span>{{ humanize(t.toLowerCase()) }}</span>
                    <small>{{ has(t) ? 'added' : 'needed' }}</small>
                  </li>
                }
              </ul>
            }

            @if (can('ATTACH_PRESENTATION_DOCUMENT')) {
              <label
                class="psa-drop"
                [class.drag]="dragging()"
                (dragenter)="dragging.set(true)"
                (dragover)="dragging.set(true)"
                (dragleave)="dragging.set(false)"
                (drop)="dragging.set(false)"
              >
                <span class="psa-drop-icon"><app-icon name="upload" [size]="26" /></span>
                <strong>Choose files or drop them here</strong>
                <span class="psa-drop-sub">PDF, DOC or DOCX. Choose several at once and set the type of each. A file already in this application is refused; one you changed is accepted as a new version.</span>
                <input type="file" multiple accept=".pdf,.doc,.docx" (change)="onFiles($event)" class="psa-file" aria-label="Choose the shipping documents" />
              </label>
              @if (rows().length) {
                <ul class="psa-rows">
                  @for (r of rows(); track r.file; let i = $index) {
                    <li>
                      <span class="psa-file-icon"><app-icon name="document" [size]="16" /></span>
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
              <div class="psa-empty">
                <span class="psa-empty-mark"><app-icon name="file" [size]="22" /></span>
                <strong>No documents yet</strong>
                <span>Add the shipping documents above. Each one appears here with its type and version.</span>
              </div>
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
              @if (requiredTypes().length) {
                <div class="psa-meter" role="progressbar" aria-label="Required documents added" [attr.aria-valuenow]="requiredTypes().length - missingRequired().length" aria-valuemin="0" [attr.aria-valuemax]="requiredTypes().length">
                  <span [style.width.%]="((requiredTypes().length - missingRequired().length) / requiredTypes().length) * 100"></span>
                </div>
              }
              @if (missingRequired().length) {
                <p class="psa-missing" role="alert"><app-icon name="alert" [size]="18" /><span>Still to add before you can submit: {{ missingNames() }}.</span></p>
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
      .psa-page { display: flex; flex-direction: column; gap: 16px; }
      .psa-error { border-color: var(--negative); color: var(--negative); display: flex; gap: 12px; align-items: center; }
      .psa-head { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: flex-start; }
      .psa-kicker { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
      .psa-ref { font-family: var(--font-mono, monospace); margin: 2px 0 6px; }
      .psa-h { font-size: 1.05rem; margin: 0 0 8px; }
      .psa-small { font-size: 0.85rem; }
      .psa-pre { white-space: pre-wrap; }
      .psa-ask { border-color: var(--warning); }
      .psa-rows { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .psa-rows li { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .psa-name { flex: 1 1 220px; word-break: break-all; }
      .psa-rows select { max-width: 240px; }
      .psa-rowerr { flex-basis: 100%; color: var(--negative); font-size: 0.85rem; }
      .psa-old td { opacity: 0.6; }
      .psa-doc-actions { white-space: nowrap; }
      .psa-card-head { margin-bottom: 14px; }
      .psa-ref-chip { font-size: 0.8rem; font-weight: 650; font-family: var(--font-mono, monospace); padding: 5px 12px; border-radius: 999px; color: var(--accent); background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent); }

      /* the four stages as a connected stepper */
      .psa-steps { list-style: none; margin: 0; padding: 22px 12px 18px; display: grid; grid-template-columns: repeat(4, 1fr); }
      .psa-steps li { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; color: var(--ink-muted); font-size: 0.9rem; }
      .psa-steps li + li::before { content: ''; position: absolute; top: 17px; right: 50%; width: 100%; height: 3px; border-radius: 3px; background: var(--line); z-index: 0; }
      .psa-steps li.done + li::before, .psa-steps li.current::before { background: linear-gradient(90deg, #00a8a8, #008080); }
      .psa-dot { position: relative; z-index: 1; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; font-weight: 800; font-size: 0.9rem; background: var(--raised); border: 2px solid var(--line-strong); color: var(--ink-muted); transition: all 0.3s ease; }
      .psa-steps li.done .psa-dot { background: linear-gradient(135deg, #00a8a8, #007373); border-color: transparent; color: #fff; box-shadow: 0 10px 18px -8px rgb(0 128 128 / 70%); }
      .psa-steps li.done { color: var(--accent); font-weight: 650; }
      .psa-steps li.current .psa-dot { border-color: #00a8a8; color: #006b6b; box-shadow: 0 0 0 5px rgb(0 168 168 / 16%); animation: psa-pulse 2.2s ease-out infinite; }
      .psa-steps li.current { color: var(--ink); font-weight: 750; }
      @keyframes psa-pulse { 0% { box-shadow: 0 0 0 0 rgb(0 168 168 / 40%); } 70% { box-shadow: 0 0 0 11px rgb(0 168 168 / 0%); } 100% { box-shadow: 0 0 0 0 rgb(0 168 168 / 0%); } }

      /* what the credit calls for, as a checklist of tiles */
      .psa-req-title { display: flex; justify-content: space-between; gap: 12px; margin: 0 0 10px; font-size: 0.85rem; color: var(--ink-3); }
      .psa-req-title strong { color: var(--ink); }
      .psa-required { list-style: none; margin: 0 0 18px; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
      .psa-required li { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-radius: 14px; background: var(--sunken); border: 1px solid var(--line); font-size: 0.9rem; font-weight: 600; color: var(--ink-3); transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease; }
      .psa-required li small { margin-left: auto; white-space: nowrap; font-size: 0.7rem; font-weight: 750; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-muted); }
      .psa-tick { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; border: 2px dashed var(--line-strong); font-size: 0.75rem; font-weight: 800; color: #fff; }
      .psa-required li.have { background: linear-gradient(135deg, color-mix(in srgb, #00a8a8 12%, var(--raised)), var(--raised)); border-color: color-mix(in srgb, #00a8a8 38%, var(--line)); color: var(--ink); }
      .psa-required li.have small { color: var(--accent); }
      .psa-required li.have .psa-tick { border: 0; background: linear-gradient(135deg, #00a8a8, #007373); }
      .psa-required li:hover { transform: translateY(-2px); box-shadow: 0 12px 22px -16px rgb(0 128 128 / 50%); }

      /* the drop zone */
      .psa-drop { position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 30px 20px; margin-bottom: 14px; text-align: center; border: 2px dashed color-mix(in srgb, #00a8a8 45%, var(--line-strong)); border-radius: 18px; background: linear-gradient(180deg, color-mix(in srgb, #00a8a8 5%, var(--raised)), var(--raised)); cursor: pointer; transition: transform 0.3s ease, border-color 0.3s ease, background 0.3s ease, box-shadow 0.3s ease; }
      .psa-drop:hover, .psa-drop.drag { border-color: #00a8a8; transform: translateY(-2px); box-shadow: 0 0 0 5px rgb(0 168 168 / 10%), 0 18px 34px -22px rgb(0 128 128 / 60%); background: linear-gradient(180deg, color-mix(in srgb, #00a8a8 11%, var(--raised)), var(--raised)); }
      .psa-drop-icon { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; color: #fff; background: linear-gradient(135deg, #00c2c2, #007373); box-shadow: 0 14px 26px -12px rgb(0 128 128 / 75%); animation: psa-float 3.4s ease-in-out infinite; }
      @keyframes psa-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
      .psa-drop-sub { max-width: 640px; font-size: 0.84rem; color: var(--ink-3); }
      .psa-file { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

      /* files chosen but not uploaded yet */
      .psa-rows li { padding: 8px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--sunken); }
      .psa-file-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; color: var(--accent); background: var(--accent-soft); flex: none; }

      .psa-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 26px 16px; text-align: center; color: var(--ink-3); border-radius: 14px; background: var(--sunken); }
      .psa-empty-mark { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 50%; color: var(--accent); background: var(--accent-soft); }
      .psa-empty strong { color: var(--ink); }

      /* review and submit */
      .psa-meter { height: 10px; border-radius: 999px; background: var(--sunken); border: 1px solid var(--line); overflow: hidden; margin: 4px 0 14px; }
      .psa-meter span { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #00a8a8, #00d4d4); transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
      .psa-missing { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: 14px; color: #92400e; background: var(--warning-soft); border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent); }
      .psa-missing app-icon { flex: none; margin-top: 1px; }
      .psa-send { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-top: 12px; padding: 10px 12px; border: 1px solid color-mix(in srgb, #00a8a8 40%, var(--line)); border-radius: 14px; background: linear-gradient(135deg, color-mix(in srgb, #00a8a8 10%, var(--raised)), var(--raised) 80%); }
      .psa-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
      .psa-finding { margin-top: 12px; padding: 14px 16px; border: 1px solid var(--line); border-left: 4px solid var(--warning); border-radius: 14px; background: var(--raised); }
      .psa-finding p { margin: 6px 0; }
      .psa-ask { background: linear-gradient(135deg, color-mix(in srgb, var(--warning) 10%, var(--raised)), var(--raised) 70%); border-left: 4px solid var(--warning); }
      .psa-ok { background: linear-gradient(135deg, color-mix(in srgb, var(--positive) 10%, var(--raised)), var(--raised) 70%); }
      .psa-no { background: linear-gradient(135deg, color-mix(in srgb, var(--negative) 8%, var(--raised)), var(--raised) 70%); }
      .psa-ok { border-color: var(--positive); border-left-width: 4px; }
      @media (max-width: 640px) { .psa-steps { grid-template-columns: repeat(2, 1fr); row-gap: 18px; } .psa-steps li:nth-child(3)::before { display: none; } }
      .psa-no { border-color: var(--negative); border-left-width: 4px; }
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
  protected readonly dragging = signal(false);
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
