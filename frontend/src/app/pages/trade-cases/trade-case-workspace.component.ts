import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { AnimatedCounter } from '../../shared/components/animated-counter';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, type Observable } from 'rxjs';
import { TradeCasesService } from '../../services/trade-cases.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { isApiError } from '../../services/api.service';
import { formatRelative, humanize, isPdfName } from '../../shared/format';
import { scrollToSection } from '../../shared/scroll';
import { guessDocumentType } from '../../shared/document-type';
import { COMPLIANCE_CATEGORIES, DEPARTMENT_PERMISSION, DISPOSITIONS, dispositionLabel as sharedDispositionLabel } from '../../shared/dispositions';
import { Icon } from '../../shared/components/icon';
import { HostPayloadCardComponent } from './host-payload-card.component';
import {
  DEPARTMENTS,
  DEPARTMENT_LABELS,
  LIFECYCLE_STAGES,
  PRE_TRADE_DOCUMENT_TYPES,
  PRESENTATION_DOCUMENT_TYPES,
  STATUS_LABELS,
  type Amendment,
  type ApplicationVersion,
  type CaseDocument,
  type CaseQuery,
  type Department,
  type Finding,
  type LcApplicationData,
  type Presentation,
  type TradeCaseAuditEvent,
  type TradeCaseView,
} from '../../models/trade-case.models';

type Tab = 'overview' | 'application' | 'documents' | 'findings' | 'queries' | 'reviews' | 'lc' | 'audit';

/** Scalar application fields a correction may change, with their input type. */
const EDITABLE_FIELDS: Array<{ path: string; label: string; type: 'text' | 'number' | 'date' }> = [
  { path: 'amount', label: 'Amount', type: 'number' },
  { path: 'currency', label: 'Currency', type: 'text' },
  { path: 'unitPrice', label: 'Unit price', type: 'number' },
  { path: 'quantity', label: 'Quantity', type: 'number' },
  { path: 'unitOfMeasure', label: 'Unit of measure', type: 'text' },
  { path: 'goodsDescription', label: 'Goods description', type: 'text' },
  { path: 'hsCode', label: 'HS code', type: 'text' },
  { path: 'proformaInvoiceNumber', label: 'Proforma invoice number', type: 'text' },
  { path: 'beneficiary.name', label: 'Beneficiary name', type: 'text' },
  { path: 'beneficiary.address', label: 'Beneficiary address', type: 'text' },
  { path: 'beneficiary.country', label: 'Beneficiary country', type: 'text' },
  { path: 'applicant.name', label: 'Applicant name', type: 'text' },
  { path: 'applicant.country', label: 'Applicant country', type: 'text' },
  { path: 'incoterm', label: 'Incoterm', type: 'text' },
  { path: 'namedPlace', label: 'Named place', type: 'text' },
  { path: 'countryOfOrigin', label: 'Country of origin', type: 'text' },
  { path: 'portOfLoading', label: 'Port of loading', type: 'text' },
  { path: 'portOfDischarge', label: 'Port of discharge', type: 'text' },
  { path: 'latestShipmentDate', label: 'Latest shipment date', type: 'date' },
  { path: 'expiryDate', label: 'Expiry date', type: 'date' },
  { path: 'presentationPeriodDays', label: 'Presentation period (days)', type: 'number' },
  { path: 'usanceDays', label: 'Usance days', type: 'number' },
  { path: 'purpose', label: 'Purpose', type: 'text' },
];

const OPEN_AMENDMENT = ['UNDER_REVIEW', 'APPROVAL_PENDING', 'APPROVED', 'ISSUED_AWAITING_BENEFICIARY', 'IN_PROGRESS'];

function getPath(data: LcApplicationData, path: string): unknown {
  return path.split('.').reduce<unknown>((v, p) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[p] : undefined), data);
}

@Component({
  selector: 'app-trade-case-workspace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, DatePipe, DecimalPipe, Icon, AnimatedCounter, HostPayloadCardComponent],
  templateUrl: './trade-case-workspace.component.html',
  styleUrl: './trade-case-workspace.component.scss',
})
export class TradeCaseWorkspaceComponent implements OnInit {
  /** Route parameter (component input binding). */
  readonly id = input.required<string>();

  readonly auth = inject(AuthService);
  private readonly service = inject(TradeCasesService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly statusLabels = STATUS_LABELS;
  protected readonly departments = DEPARTMENTS;
  protected readonly departmentLabels = DEPARTMENT_LABELS;
  /** A pre-shipment session follows the request only as far as approval; the later stages belong to the post-shipment portals. */
  protected readonly stages = this.auth.stage() === 'pre'
    ? [
        { label: 'Request', statuses: ['DRAFT'] },
        { label: 'Scrutiny', statuses: ['UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION', 'APPROVAL_PENDING'] },
        { label: 'Approved', statuses: ['AUTHORIZED_FOR_ISSUANCE'] },
      ]
    : LIFECYCLE_STAGES;
  /** The last stage of a pre-shipment rail is the end of that journey, so it reads as done. */
  protected readonly railEndsHere = this.auth.stage() === 'pre';
  protected readonly preTradeTypes = PRE_TRADE_DOCUMENT_TYPES;
  protected readonly presentationTypes = PRESENTATION_DOCUMENT_TYPES;
  protected readonly editableFields = EDITABLE_FIELDS;
  protected readonly humanize = humanize;
  protected readonly isPdf = isPdfName;

  readonly tradeCase = signal<TradeCaseView | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly tab = signal<Tab>('overview');
  readonly actionError = signal<{ message: string; items: string[] } | null>(null);
  readonly audit = signal<{ events: TradeCaseAuditEvent[]; chain: { valid: boolean; brokenAtSeq: number | null } } | null>(null);
  readonly findingFilter = signal<'OPEN' | 'ALL'>('OPEN');
  readonly selectedVersion = signal<number | null>(null);

  // Form state (plain fields bound with ngModel).
  /** AUTO: the AI reads the document and says what it is. */
  docType = 'AUTO';
  docDragging = false;
  docFile: File | null = null;
  reviewForm: Record<string, { rationale: string; checklist: Record<string, boolean>; question: string }> = {};
  queryForm = { department: '' as Department | '', assignee: 'CUSTOMER', question: '', findingIds: [] as string[], requiresCorrection: true };
  responseForm: Record<string, { text: string; corrections: Array<{ path: string; value: string }> }> = {};
  resolveForm: Record<string, string> = {};
  dispositionForm: Record<string, { code: string; rationale: string }> = {};
  waiverForm: Record<string, string> = {};
  editForm = { corrections: [{ path: 'amount', value: '' }] as Array<{ path: string; value: string }>, reason: '' };
  creditForm = { facilityReference: '', availableLimit: null as number | null, currency: 'USD', marginPercent: 0, verificationSource: 'MANUAL_OFFICER_VERIFIED', note: '' };
  approvalNote = '';
  approvalRationale = '';
  rejectRationale = '';
  withdrawRationale = '';
  issuanceForm = { financialInstrumentNumber: '', financialInstrumentExpiry: '' };
  presentationRows: Array<{ type: string; file: File | null }> = [
    { type: 'COMMERCIAL_INVOICE', file: null },
    { type: 'BILL_OF_LADING', file: null },
    { type: 'PACKING_LIST', file: null },
  ];
  presentationDecision = { decision: 'ACCEPT', rationale: '' };
  settlementForm = { mode: 'SANDBOX', amount: null as number | null, valueDate: new Date().toISOString().slice(0, 10), reference: '', note: '' };
  investigationForm = { reason: '', outcome: 'NO_FURTHER_ACTION', rationale: '' };
  closeRationale = '';

  readonly application = computed<LcApplicationData | null>(() => {
    const c = this.tradeCase();
    return c ? c.applicationVersions[c.applicationVersions.length - 1]!.data : null;
  });

  readonly shownVersion = computed<ApplicationVersion | null>(() => {
    const c = this.tradeCase();
    if (!c) return null;
    const v = this.selectedVersion() ?? c.currentApplicationVersion;
    return c.applicationVersions.find((x) => x.version === v) ?? null;
  });

  readonly previousVersion = computed<ApplicationVersion | null>(() => {
    const c = this.tradeCase();
    const shown = this.shownVersion();
    return c && shown ? c.applicationVersions.find((x) => x.version === shown.version - 1) ?? null : null;
  });

  readonly visibleFindings = computed(() => {
    const c = this.tradeCase();
    if (!c) return [] as Finding[];
    const list = this.findingFilter() === 'OPEN' ? c.findings.filter((f) => f.status === 'OPEN' || f.disposition?.code === 'CONFIRMED_ESCALATED') : c.findings;
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 } as const;
    return [...list].sort((a, b) => Number(b.blocking) - Number(a.blocking) || rank[a.severity] - rank[b.severity]);
  });

  readonly openFindingsCount = computed(() => this.tradeCase()?.findings.filter((f) => f.status === 'OPEN').length ?? 0);
  readonly openQueriesCount = computed(() => this.tradeCase()?.queries.filter((q) => q.status !== 'RESOLVED').length ?? 0);
  readonly stageIndex = computed(() => {
    const status = this.tradeCase()?.status;
    return this.stages.findIndex((s) => s.statuses.includes(status!));
  });
  readonly activePresentation = computed<Presentation | null>(() => {
    const p = this.tradeCase()?.presentations ?? [];
    return p.length ? p[p.length - 1]! : null;
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.service.get(this.id()).subscribe({
      next: (c) => {
        this.adopt(c);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loadError.set(isApiError(err) ? err.message : 'The case could not be loaded.');
        this.loading.set(false);
      },
    });
  }

  private adopt(c: TradeCaseView): void {
    this.tradeCase.set(c);
    for (const d of DEPARTMENTS) {
      this.reviewForm[d] ??= { rationale: '', checklist: {}, question: '' };
      const reviewChecklist = c.reviews[d]?.checklist ?? {};
      for (const item of c.checklists[d] ?? []) {
        if (reviewChecklist[item.itemId]?.checked) this.reviewForm[d]!.checklist[item.itemId] = true;
      }
    }
    for (const q of c.queries) this.responseForm[q.queryId] ??= { text: '', corrections: [] };
    for (const f of c.findings) this.dispositionForm[f.findingId] ??= { code: DISPOSITIONS[f.category]?.[0] ?? '', rationale: '' };
    if (!this.issuanceForm.financialInstrumentExpiry && c.applicationVersions.length) {
      this.issuanceForm.financialInstrumentExpiry = c.applicationVersions[c.applicationVersions.length - 1]!.data.expiryDate ?? '';
    }
    if (this.settlementForm.amount === null && c.issuedLc) this.settlementForm.amount = c.issuedLc.terms.amount;
    if (this.tab() === 'audit') this.loadAudit();
  }

  can(action: string): boolean {
    return this.tradeCase()?.availableActions.includes(action) ?? false;
  }

  canReview(dept: Department): boolean {
    return this.can(`REVIEW_${dept}`);
  }

  canDisposition(f: Finding): boolean {
    // An escalated finding is still blocking and can be closed after a second look.
    const escalated = f.status === 'DISPOSITIONED' && f.disposition?.code === 'CONFIRMED_ESCALATED';
    if ((f.status !== 'OPEN' && !escalated) || f.category === 'DOCUMENTARY_DISCREPANCY') return false;
    const compliance = COMPLIANCE_CATEGORIES.includes(f.category);
    if (!this.can(compliance ? 'DISPOSITION_COMPLIANCE_FINDING' : 'DISPOSITION_FINDING')) return false;
    // A compliance-class finding is cleared by whoever holds the compliance disposition permission (the API
    // checks the same); any other finding by the department that owns it.
    return compliance || this.auth.can(DEPARTMENT_PERMISSION[f.ownerDepartment]);
  }

  canWaive(f: Finding): boolean {
    return f.category === 'DOCUMENTARY_DISCREPANCY' && f.status === 'OPEN' && !f.applicantWaiver && this.can('APPLICANT_WAIVER');
  }

  canRespond(q: CaseQuery): boolean {
    if (q.status !== 'OPEN' || !this.can('RESPOND_QUERY')) return false;
    return q.assignee === 'CUSTOMER' ? this.auth.can('tradecase.query.respond.customer') : this.auth.can(DEPARTMENT_PERMISSION[q.assignee]);
  }

  canResolve(q: CaseQuery): boolean {
    return q.status === 'ANSWERED' && this.can('RESOLVE_QUERY') && this.auth.can(DEPARTMENT_PERMISSION[q.department]);
  }

  /**
   * The desk a query is raised from. An institutional sign-in chooses it; a demo portal has no separate desks, so the
   * query goes out from Trade Operations (or the first desk the user holds) to the customer.
   */
  queryDepartment(): Department | '' {
    if (!this.auth.stage()) return this.queryForm.department;
    const mine = this.myDepartments();
    return mine.includes('TRADE_OPS') ? 'TRADE_OPS' : mine[0] ?? '';
  }

  myDepartments(): Department[] {
    return DEPARTMENTS.filter((d) => this.auth.can(DEPARTMENT_PERMISSION[d]));
  }

  /** Server-side blockers, minus checklist items ticked here but not yet sent. */
  pendingBlockers(d: Department): string[] {
    const c = this.tradeCase();
    if (!c) return [];
    const ticked = new Set((c.checklists[d] ?? []).filter((i) => this.reviewForm[d]?.checklist[i.itemId]).map((i) => `Checklist item not confirmed: ${i.label}`));
    return (c.reviewBlockers[d] ?? []).filter((b) => !ticked.has(b));
  }

  dispositionLabel(code: string): string {
    return sharedDispositionLabel(code);
  }

  dispositionOptions(f: Finding): string[] {
    return DISPOSITIONS[f.category] ?? [];
  }

  /** A headline tile: open the tab it counts and bring it into view. */
  openTab(tab: Tab): void {
    this.setTab(tab);
    scrollToSection('tcw-tabs');
  }

  setTab(tab: Tab): void {
    this.tab.set(tab);
    this.actionError.set(null);
    if (tab === 'audit' && !this.audit()) this.loadAudit();
  }

  loadAudit(): void {
    if (this.auth.isCustomer()) return;
    this.service.audit(this.id()).subscribe({ next: (a) => this.audit.set(a), error: () => this.audit.set(null) });
  }

  /** Every action goes through here: one busy flag, the server's message on failure, a fresh case on success. */
  private run(request: Observable<TradeCaseView | { tradeCase: TradeCaseView }>, success: string, after?: () => void, detail?: string): void {
    this.busy.set(true);
    this.actionError.set(null);
    request.subscribe({
      next: (res) => {
        const c = 'tradeCase' in res ? res.tradeCase : res;
        this.adopt(c);
        this.busy.set(false);
        this.toast.success(success, detail ?? `${c.caseId} — ${STATUS_LABELS[c.status]}`);
        after?.();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        if (isApiError(err)) {
          const details = (err.details ?? {}) as Record<string, unknown>;
          const items = [details['blockers'], details['findings'], details['openFindings'], details['problems']].flatMap((v) => (Array.isArray(v) ? v.map(String) : []));
          this.actionError.set({ message: err.message, items });
        } else {
          this.actionError.set({ message: 'The request failed.', items: [] });
        }
      },
    });
  }

  // ---------------------------------------------------------------- actions

  submit(): void {
    this.run(this.service.action(this.id(), 'submit'), 'Submitted for review');
  }

  withdraw(): void {
    this.run(this.service.action(this.id(), 'withdraw', { rationale: this.withdrawRationale }), 'Request withdrawn');
  }

  /** A draft that was never sent: remove it and go back to the list. (A request already sent is withdrawn, with a reason, further down.) */
  removeDraft(): void {
    if (!confirm('Remove this draft? It has not been sent to the bank. Its documents are removed with it.')) return;
    this.run(this.service.removeDraft(this.id()), 'Draft removed', () => void this.router.navigate(['/trade-cases']), 'Nothing was sent to the bank.');
  }

  revalidate(): void {
    this.run(this.service.action(this.id(), 'revalidate'), 'Re-scan done');
  }

  onDocFile(event: Event): void {
    this.docFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  /** Take back a file chosen by mistake, before it is uploaded. */
  clearDocFile(input: HTMLInputElement): void {
    this.docFile = null;
    input.value = '';
  }

  /** The documents the customer added after sending the request and has not sent to the bank yet. */
  awaitingSend(): CaseDocument[] {
    return (this.tradeCase()?.documents ?? []).filter((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId && d.sentToBankAt === null);
  }

  awaitingSendNames(): string {
    return this.awaitingSend().map((d) => d.filename).join(', ');
  }

  sendDocuments(): void {
    const n = this.awaitingSend().length;
    this.run(this.service.sendDocuments(this.id()), `Sent to the bank: ${n} document${n === 1 ? '' : 's'}`);
  }

  attach(): void {
    if (!this.docFile) return;
    const afterSending = this.auth.isCustomer() && this.tradeCase()?.status !== 'DRAFT';
    this.run(this.service.attachDocument(this.id(), this.docFile, this.docType), afterSending ? 'Document added: press “Send to bank” so the bank receives it' : 'Document attached — analysis started', () => {
      this.docFile = null;
      for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('input.tcw-file'))) el.value = '';
      // Analysis runs in the background; the case re-validates itself when it finishes.
      setTimeout(() => this.reload(), 6000);
    });
  }

  /** The document whose Remove was clicked once; a second click confirms. */
  readonly removing = signal<string | null>(null);

  /** The customer or desk says what a document is, when the AI took it for something else. */
  retype(linkId: string, type: string): void {
    this.run(this.service.retypeDocument(this.id(), linkId, type), 'Document type changed');
  }

  removeDocument(linkId: string, filename: string): void {
    if (this.removing() !== linkId) {
      this.removing.set(linkId);
      return;
    }
    this.removing.set(null);
    this.run(this.service.removeDocument(this.id(), linkId), `Removed ${filename}`);
  }

  analyzeDocuments(): void {
    this.busy.set(true);
    this.actionError.set(null);
    this.service.analyzeDocuments(this.id()).subscribe({
      next: (res) => {
        this.adopt(res.tradeCase);
        this.busy.set(false);
        if (res.started > 0) {
          this.toast.success('AI scrutiny started', `${res.started} document${res.started === 1 ? '' : 's'} will be read one at a time; the scrutiny page shows each result as it is done.`);
          // The pre-shipment scrutiny is its own page; it refreshes itself while the AI reads.
          void this.router.navigate(['/trade-cases', this.id(), 'scrutiny']);
        } else {
          this.toast.success(res.running ? 'Scrutiny already running' : 'Nothing new to scrutinize', res.running ? 'The AI is already working through the documents.' : 'Every current document has been scrutinized.');
          void this.router.navigate(['/trade-cases', this.id(), 'scrutiny']);
        }
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.actionError.set({ message: isApiError(err) ? err.message : 'The analysis could not be started.', items: [] });
      },
    });
  }

  /** A document's name was clicked: a PDF opens in a new tab, anything else downloads. */
  open(linkId: string, filename: string): void {
    this.service.openDocument(this.id(), linkId, filename).subscribe({ error: () => this.toast.error('The document could not be opened', filename) });
  }

  private corrections(rows: Array<{ path: string; value: string }>): Partial<LcApplicationData> {
    const changes: Record<string, unknown> = {};
    for (const row of rows) {
      if (!row.path || row.value === '') continue;
      const field = EDITABLE_FIELDS.find((f) => f.path === row.path)!;
      const value = field.type === 'number' ? Number(row.value) : row.value;
      const [head, tail] = row.path.split('.');
      if (tail) changes[head!] = { ...((changes[head!] as object) ?? {}), [tail]: value };
      else changes[head!] = value;
    }
    return changes as Partial<LcApplicationData>;
  }

  saveEdit(): void {
    this.run(this.service.updateApplication(this.id(), this.corrections(this.editForm.corrections), this.editForm.reason), 'New application version saved', () => {
      this.editForm = { corrections: [{ path: 'amount', value: '' }], reason: '' };
      this.selectedVersion.set(null);
    });
  }

  decide(dept: Department, decision: 'APPROVE' | 'RETURN' | 'HOLD' | 'RECOMMEND_REJECT'): void {
    const form = this.reviewForm[dept]!;
    const checklist = Object.entries(form.checklist).filter(([, v]) => v).map(([k]) => k);
    const body: Record<string, unknown> = { decision, rationale: form.rationale, checklist };
    if (decision === 'RETURN') body['query'] = { question: form.question, findingIds: this.openFindingIdsFor(dept), requiresCorrection: true };
    this.run(this.service.review(this.id(), dept, body), `${DEPARTMENT_LABELS[dept]}: ${humanize(decision.toLowerCase())}`, () => {
      this.reviewForm[dept] = { ...form, rationale: '', question: '' };
    });
  }

  openFindingIdsFor(dept: Department): string[] {
    return (this.tradeCase()?.findings ?? []).filter((f) => f.status === 'OPEN' && f.ownerDepartment === dept).map((f) => f.findingId);
  }

  raiseQuery(): void {
    this.run(this.service.action(this.id(), 'queries', { ...this.queryForm, department: this.queryDepartment(), ...(this.auth.stage() ? { assignee: 'CUSTOMER' } : {}) }), 'Query raised', () => {
      this.queryForm = { department: '', assignee: 'CUSTOMER', question: '', findingIds: [], requiresCorrection: true };
    });
  }

  queryAbout(f: Finding): void {
    const dept = this.myDepartments().includes(f.ownerDepartment) ? f.ownerDepartment : this.myDepartments()[0] ?? '';
    this.queryForm = { department: dept, assignee: 'CUSTOMER', question: `${f.title}. ${f.recommendedAction}`, findingIds: [f.findingId], requiresCorrection: true };
    this.setTab('queries');
  }

  toggleQueryFinding(id: string): void {
    const set = new Set(this.queryForm.findingIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.queryForm.findingIds = [...set];
  }

  /** Corrected documents a customer is about to send with an answer, per query. */
  replyFiles: Record<string, Array<{ file: File; type: string }>> = {};
  /** Documents already uploaded for an answer that has not been sent yet (a retry does not upload them twice). */
  private readonly replyLinks: Record<string, string[]> = {};

  onReplyFiles(queryId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []).filter((f) => /\.(pdf|docx?)$/i.test(f.name));
    this.replyFiles[queryId] = [...(this.replyFiles[queryId] ?? []), ...picked.map((file) => ({ file, type: guessDocumentType(file.name) }))];
    input.value = '';
  }

  removeReplyFile(queryId: string, index: number): void {
    this.replyFiles[queryId] = (this.replyFiles[queryId] ?? []).filter((_, i) => i !== index);
  }

  /** The corrected documents chosen for one query's answer. */
  filesFor(queryId: string): Array<{ file: File; type: string }> {
    return this.replyFiles[queryId] ?? [];
  }

  async respond(q: CaseQuery): Promise<void> {
    const form = this.responseForm[q.queryId]!;
    const changes = this.corrections(form.corrections);
    this.busy.set(true);
    this.actionError.set(null);
    // Corrected documents go up first; the answer then names them.
    const links = (this.replyLinks[q.queryId] ??= []);
    for (const item of [...(this.replyFiles[q.queryId] ?? [])]) {
      try {
        const res = await firstValueFrom(this.service.attachDocument(this.id(), item.file, item.type));
        links.push(res.document.linkId);
        this.replyFiles[q.queryId] = (this.replyFiles[q.queryId] ?? []).filter((x) => x !== item);
      } catch (err) {
        this.busy.set(false);
        this.actionError.set({ message: `${item.file.name} could not be sent: ${isApiError(err) ? err.message : 'the upload failed'}`, items: [] });
        return;
      }
    }
    const body: Record<string, unknown> = { text: form.text, documentLinkIds: [...links] };
    if (Object.keys(changes).length > 0) {
      body['applicationChanges'] = changes;
      body['reason'] = `Correction in response to ${q.queryId}`;
    }
    this.run(this.service.action(this.id(), `queries/${q.queryId}/respond`, body), 'Reply sent to the bank', () => {
      this.responseForm[q.queryId] = { text: '', corrections: [] };
      this.replyFiles[q.queryId] = [];
      delete this.replyLinks[q.queryId];
    });
  }

  /** Whether the customer typed nothing about the deal: then there is no application for them to correct. */
  readonly documentsOnly = computed(() => {
    const first = this.tradeCase()?.applicationVersions[0]?.data;
    return !first || (first.amount === null && !first.beneficiary.name && !first.goodsDescription && !first.proformaInvoiceNumber);
  });

  /** Messages from the bank still waiting for this customer. */
  readonly waitingMessages = computed(() => (this.tradeCase()?.queries ?? []).filter((q) => q.assignee === 'CUSTOMER' && q.status === 'OPEN'));

  resolve(q: CaseQuery, decision: 'RESOLVE' | 'REOPEN'): void {
    this.run(this.service.action(this.id(), `queries/${q.queryId}/resolve`, { decision, rationale: this.resolveForm[q.queryId] ?? '' }), decision === 'RESOLVE' ? 'Query resolved' : 'Reply sent');
  }

  disposition(f: Finding): void {
    this.run(this.service.action(this.id(), `findings/${f.findingId}/disposition`, { ...this.dispositionForm[f.findingId] }), `${f.findingId} dispositioned`);
  }

  waive(f: Finding, accept: boolean): void {
    this.run(this.service.action(this.id(), `findings/${f.findingId}/applicant-waiver`, { accept, note: this.waiverForm[f.findingId] || (accept ? 'Discrepancy waived by the applicant.' : 'Not waived.') }), accept ? 'Waiver recorded' : 'Refusal to waive recorded');
  }

  recordCredit(): void {
    this.run(this.service.action(this.id(), 'credit-facility', { ...this.creditForm }), 'Facility recorded');
  }

  requestApproval(): void {
    this.run(this.service.action(this.id(), 'approval/request', { note: this.approvalNote }), 'Sent for authorization');
  }

  decideApproval(decision: 'APPROVE' | 'RETURN'): void {
    this.run(this.service.action(this.id(), 'approval/decision', { decision, rationale: this.approvalRationale }), decision === 'APPROVE' ? 'Authorized for issuance' : 'Returned to review');
  }

  reject(): void {
    this.run(this.service.action(this.id(), 'reject', { rationale: this.rejectRationale }), 'Case rejected');
  }

  issue(): void {
    this.run(this.service.action(this.id(), 'issuance', { ...this.issuanceForm }), 'LC issuance recorded (sandbox)');
  }

  // ------------------------------------------------------------ amendments

  /** The amendment in progress, if any (one at a time). */
  openAmendment(c: TradeCaseView) {
    return (c.amendments ?? []).find((a) => OPEN_AMENDMENT.includes(a.status)) ?? null;
  }

  /** Departments whose amendment review this user can decide now. */
  amendmentReviewsForMe(): Department[] {
    return DEPARTMENTS.filter((d) => this.can(`REVIEW_AMENDMENT_${d}`));
  }

  reviewEntries(reviews: NonNullable<Amendment['reviews']>) {
    return Object.entries(reviews) as Array<[Department, NonNullable<Amendment['reviews']>[Department]]>;
  }

  amendmentFindings(c: TradeCaseView, amendmentId: string): Finding[] {
    return c.findings.filter((f) => f.amendmentId === amendmentId);
  }

  amendmentForm = { amount: '', expiryDate: '', latestShipmentDate: '', quantity: '', reason: '' };
  amendmentDecision = { rationale: '' };
  amendmentFiExpiry = '';
  amendmentResponseNote = '';

  requestAmendment(): void {
    const f = this.amendmentForm;
    const changes: Record<string, unknown> = {};
    if (f.amount.trim()) changes['amount'] = Number(f.amount);
    if (f.quantity.trim()) changes['quantity'] = Number(f.quantity);
    if (f.expiryDate) changes['expiryDate'] = f.expiryDate;
    if (f.latestShipmentDate) changes['latestShipmentDate'] = f.latestShipmentDate;
    this.run(this.service.action(this.id(), 'amendments', { changes, reason: f.reason }), 'Amendment requested', () => {
      this.amendmentForm = { amount: '', expiryDate: '', latestShipmentDate: '', quantity: '', reason: '' };
    });
  }

  reviewAmendment(department: Department, decision: 'APPROVE' | 'REJECT'): void {
    this.run(this.service.action(this.id(), `amendments/reviews/${department}`, { decision, rationale: this.amendmentDecision.rationale }), `Amendment review: ${decision.toLowerCase()}`, () => (this.amendmentDecision.rationale = ''));
  }

  submitAmendment(): void {
    this.run(this.service.action(this.id(), 'amendments/submit', { note: this.amendmentDecision.rationale || 'Reviews complete.' }), 'Amendment sent for approval', () => (this.amendmentDecision.rationale = ''));
  }

  decideAmendment(decision: 'APPROVE' | 'REJECT'): void {
    this.run(this.service.action(this.id(), 'amendments/decision', { decision, rationale: this.amendmentDecision.rationale }), `Amendment ${decision === 'APPROVE' ? 'approved' : 'rejected'}`, () => (this.amendmentDecision.rationale = ''));
  }

  issueAmendment(): void {
    this.run(this.service.action(this.id(), 'amendments/issuance', { financialInstrumentExpiry: this.amendmentFiExpiry }), 'Amendment issued (sandbox)');
  }

  recordAmendmentResponse(accepted: boolean): void {
    this.run(this.service.action(this.id(), 'amendments/beneficiary-response', { accepted, note: this.amendmentResponseNote }), accepted ? 'Amendment effective' : 'Amendment refused by the beneficiary', () => (this.amendmentResponseNote = ''));
  }

  onPresentationFile(index: number, event: Event): void {
    this.presentationRows[index]!.file = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  addPresentationRow(): void {
    this.presentationRows.push({ type: 'CERTIFICATE_OF_ORIGIN', file: null });
  }

  recordPresentation(): void {
    const files = this.presentationRows.filter((r) => r.file).map((r) => ({ file: r.file!, type: r.type }));
    if (files.length === 0) return;
    this.run(this.service.recordPresentation(this.id(), files), 'Presentation received — analyzing documents', () => {
      this.presentationRows = this.presentationRows.map((r) => ({ ...r, file: null }));
    });
  }

  examine(): void {
    this.run(this.service.action(this.id(), 'presentations/examine'), 'Presentation examined');
  }

  decidePresentation(): void {
    this.run(this.service.action(this.id(), 'presentations/decision', { ...this.presentationDecision }), 'Presentation decided');
  }

  settle(): void {
    const c = this.tradeCase()!;
    this.run(this.service.action(this.id(), 'settlement', { ...this.settlementForm, currency: c.issuedLc?.terms.currency }), 'Settlement recorded');
  }

  openInvestigation(): void {
    this.run(this.service.action(this.id(), 'investigations', { reason: this.investigationForm.reason }), 'Investigation opened');
  }

  closeInvestigation(): void {
    this.run(this.service.action(this.id(), 'investigations/close', { outcome: this.investigationForm.outcome, rationale: this.investigationForm.rationale }), 'Investigation closed');
  }

  closeCase(): void {
    this.run(this.service.action(this.id(), 'close', { rationale: this.closeRationale }), 'Case closed');
  }

  // ---------------------------------------------------------------- display helpers

  /**
   * True while the documents the customer sent have not been read into the application yet: no version has been
   * filled from them, though documents are on the request. The blanks then fill in by themselves.
   */
  readonly readingDocuments = computed(() => {
    const c = this.tradeCase();
    if (!c || !['DRAFT', 'UNDER_REVIEW', 'PENDING_CUSTOMER_CLARIFICATION'].includes(c.status)) return false;
    const hasDocuments = c.documents.some((d) => d.stage === 'PRE_TRADE' && !d.supersededByLinkId);
    return hasDocuments && !c.applicationVersions.some((v) => v.createdBy === 'SYSTEM');
  });

  /** What the table shows: the value, or "being read" for a blank while the documents are still being read. */
  shown(data: LcApplicationData | null | undefined, path: string): string {
    const v = this.value(data, path);
    return v === '— missing —' && this.readingDocuments() ? 'Reading your documents…' : v;
  }

  value(data: LcApplicationData | null | undefined, path: string): string {
    if (!data) return '—';
    const v = getPath(data, path);
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return '— missing —';
    return Array.isArray(v) ? v.map((x) => humanize(String(x).toLowerCase())).join(', ') : String(v);
  }

  changed(path: string): boolean {
    return this.shownVersion()?.changedFields.includes(path) ?? false;
  }

  docName(linkId: string): string {
    return this.tradeCase()?.documents.find((d) => d.linkId === linkId)?.filename ?? linkId;
  }

  relative(iso: string | null | undefined): string {
    return formatRelative(iso);
  }

  actorName(actor: { name: string } | 'SYSTEM'): string {
    return actor === 'SYSTEM' ? 'System' : actor.name;
  }

  severityClass(f: Finding): string {
    return f.severity === 'CRITICAL' || f.severity === 'HIGH' ? 'chip-negative' : f.severity === 'MEDIUM' ? 'chip-warning' : 'chip-info';
  }

  reviewClass(status: string): string {
    if (status === 'APPROVED') return 'chip-positive';
    if (status === 'ON_HOLD' || status === 'REJECT_RECOMMENDED') return 'chip-negative';
    if (status === 'RETURNED' || status === 'RE_REVIEW_REQUIRED') return 'chip-warning';
    return 'chip-info';
  }

  extractionLabel(source: string): string {
    switch (source) {
      case 'AI_MODEL':
        return 'Read by the configured AI model';
      case 'DETERMINISTIC_PARSER':
        return 'Read by the deterministic parser (no AI model configured)';
      case 'DETERMINISTIC_FALLBACK_AFTER_AI_FAILURE':
        return 'AI model failed — fields parsed by the fallback; verify manually';
      case 'UNKNOWN_LEGACY_ANALYSIS':
        return 'Older analysis — source of fields unknown; verify manually';
      default:
        return 'No proforma invoice analyzed yet';
    }
  }
}
