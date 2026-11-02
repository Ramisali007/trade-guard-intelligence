import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { PostShipmentService } from '../../services/post-shipment.service';
import { ToastService } from '../../services/toast.service';
import { TradeCasesService } from '../../services/trade-cases.service';
import type { PostShipmentLc, PostShipmentReview, ReviewFinding } from '../../models/post-shipment.models';
import type { TradeCaseView } from '../../models/trade-case.models';
import { PostShipmentApplicationComponent } from './post-shipment-application.component';
import { PostShipmentListComponent } from './post-shipment-list.component';
import { PostShipmentReviewComponent } from './post-shipment-review.component';

/**
 * The three post-shipment screens, with their services replaced. They check what each user is told and offered; the API
 * decides what is allowed, so these specs only make sure the screen never offers what the state does not.
 */

const toast = { success: () => undefined, error: () => undefined };
const text = (fixture: { nativeElement: HTMLElement }): string => (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ');
const buttons = (fixture: { nativeElement: HTMLElement }): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('button'));

const lc = (over: Partial<PostShipmentLc> = {}): PostShipmentLc => ({
  caseId: 'TC-2026-00001', reference: 'TC-2026-00001', status: 'AUTHORIZED_FOR_ISSUANCE', approvedAt: '2026-10-27T10:00:00Z', applicant: 'Kamran Textiles', beneficiary: 'Global Cotton Traders', goodsDescription: 'Raw cotton',
  currency: 'USD', amount: 250000, latestShipmentDate: '2026-12-26', expiryDate: '2027-01-25', requiredDocuments: ['COMMERCIAL_INVOICE'], basis: 'APPROVED_APPLICATION', applications: 0, application: null, canStart: true, ...over,
});

describe('PostShipmentListComponent', () => {
  const render = (items: PostShipmentLc[]) => {
    TestBed.configureTestingModule({ imports: [PostShipmentListComponent], providers: [provideRouter([]), { provide: PostShipmentService, useValue: { lcs: () => of({ items }) } }] });
    const fixture = TestBed.createComponent(PostShipmentListComponent);
    fixture.detectChanges();
    return fixture;
  };

  it('lists the approved requests by their reference and offers to start', () => {
    const f = render([lc()]);
    expect(text(f)).toContain('TC-2026-00001');
    expect(text(f)).toContain('Not started');
    expect(text(f)).toContain('Start application');
  });

  it('says what a draft and a refusal mean, and what to do next', () => {
    const f = render([lc({ application: { presentationId: 'PR-01', reference: 'TC-2026-00001/P1', origin: 'CLIENT', state: 'DRAFT', submittedAt: '', receivedAt: '', documentCount: 2, documentTypes: [], examination: null, decision: null, termsBasis: 'APPROVED_APPLICATION' }, canStart: false })]);
    expect(text(f)).toContain('Draft: not submitted');
    expect(text(f)).toContain('Continue');
  });

  it('offers to remove a draft application, and only a draft', () => {
    const app = { presentationId: 'PR-01', reference: 'TC-2026-00001/P1', origin: 'CLIENT', submittedAt: '', receivedAt: '', documentCount: 2, documentTypes: [], examination: null, decision: null, termsBasis: 'APPROVED_APPLICATION' };
    const draftRow = render([lc({ application: { ...app, state: 'DRAFT' } as never, canStart: false })]);
    expect(buttons(draftRow).some((b) => b.textContent?.trim() === 'Remove draft')).toBeTrue();
    TestBed.resetTestingModule();
    const sentRow = render([lc({ application: { ...app, state: 'UNDER_EXAMINATION' } as never, canStart: false })]);
    expect(buttons(sentRow).some((b) => b.textContent?.trim() === 'Remove draft')).toBeFalse();
    TestBed.resetTestingModule();
    const notStarted = render([lc()]);
    expect(buttons(notStarted).some((b) => b.textContent?.trim() === 'Remove draft')).toBeFalse();
  });

  it('removes the draft only after the client confirms, then reloads the list', () => {
    const removed: string[] = [];
    let loads = 0;
    const app = { presentationId: 'PR-01', reference: 'TC-2026-00001/P1', origin: 'CLIENT', state: 'DRAFT', submittedAt: '', receivedAt: '', documentCount: 2, documentTypes: [], examination: null, decision: null, termsBasis: 'APPROVED_APPLICATION' };
    TestBed.configureTestingModule({
      imports: [PostShipmentListComponent],
      providers: [provideRouter([]), { provide: PostShipmentService, useValue: { lcs: () => { loads++; return of({ items: [lc({ application: app as never, canStart: false })] }); }, removeDraft: (id: string) => { removed.push(id); return of({}); } } }],
    });
    const fixture = TestBed.createComponent(PostShipmentListComponent);
    fixture.detectChanges();
    const remove = () => buttons(fixture).find((b) => b.textContent?.trim() === 'Remove draft')!;
    const ask = spyOn(window, 'confirm').and.returnValue(false);
    remove().click();
    expect(removed).toEqual([]);
    ask.and.returnValue(true);
    remove().click();
    expect(removed).toEqual(['TC-2026-00001']);
    expect(loads).toBe(2);
  });

  it('lists what a headline tile counts, and the same tile again lists everything', () => {
    const app = (state: string) => ({ presentationId: 'PR-01', reference: 'x/P1', origin: 'CLIENT', state, submittedAt: '', receivedAt: '', documentCount: 1, documentTypes: [], examination: null, decision: null, termsBasis: 'APPROVED_APPLICATION' }) as never;
    const f = render([
      lc(),
      lc({ caseId: 'TC-2026-00002', reference: 'TC-2026-00002', application: app('DRAFT'), canStart: false }),
      lc({ caseId: 'TC-2026-00003', reference: 'TC-2026-00003', application: app('ACCEPTED'), canStart: false }),
    ]);
    const rows = () => f.nativeElement.querySelectorAll('tbody tr').length;
    const tileButton = (label: string) => buttons(f).find((b) => b.classList.contains('kpi-tile') && b.textContent?.includes(label))!;
    expect(rows()).toBe(3);
    tileButton('Ready to start').click();
    f.detectChanges();
    expect(rows()).toBe(1);
    expect(text(f)).toContain('Showing 1 request ready to start');
    tileButton('Documents accepted').click();
    f.detectChanges();
    expect(rows()).toBe(1);
    expect(text(f)).toContain('TC-2026-00003');
    tileButton('Documents accepted').click();
    f.detectChanges();
    expect(rows()).toBe(3);
  });

  it('explains an empty list rather than showing a blank table', () => {
    const f = render([]);
    expect(text(f)).toContain('No approved requests yet');
    expect(f.nativeElement.querySelector('table')).toBeNull();
  });
});

describe('PostShipmentApplicationComponent', () => {
  const view = (over: Partial<TradeCaseView> = {}, actions: string[] = []): TradeCaseView =>
    ({
      caseId: 'TC-2026-00001',
      preShipmentReference: 'TC-2026-00001',
      status: 'AUTHORIZED_FOR_ISSUANCE',
      applicationVersions: [{ version: 1, data: { beneficiary: { name: 'Global Cotton Traders' }, goodsDescription: 'Raw cotton', amount: 250000, currency: 'USD', latestShipmentDate: '2026-12-26', requiredDocuments: ['COMMERCIAL_INVOICE', 'BILL_OF_LADING'] } }],
      presentations: [],
      documents: [],
      queries: [],
      findings: [],
      issuedLc: null,
      availableActions: actions,
      ...over,
    }) as unknown as TradeCaseView;

  const draft = { presentationId: 'PR-01', reference: 'TC-2026-00001/P1', state: 'DRAFT', applicationStatus: 'DRAFT', documentLinkIds: [], receivedAt: '', examination: null, decision: null };
  const doc = (linkId: string, documentType: string, extra: Record<string, unknown> = {}) => ({ linkId, documentId: linkId, documentType, stage: 'POST_TRADE', presentationId: 'PR-01', version: 1, filename: `${linkId}.pdf`, uploadedAt: '2026-10-27T10:00:00Z', supersededByLinkId: null, ...extra });

  const render = (c: TradeCaseView) => {
    TestBed.configureTestingModule({
      imports: [PostShipmentApplicationComponent],
      providers: [
        provideRouter([]),
        { provide: TradeCasesService, useValue: { get: () => of(c), downloadDocument: () => of(undefined) } },
        { provide: PostShipmentService, useValue: {} },
        { provide: AuthService, useValue: { can: () => true } },
        { provide: ToastService, useValue: toast },
      ],
    });
    const fixture = TestBed.createComponent(PostShipmentApplicationComponent);
    fixture.componentRef.setInput('id', 'TC-2026-00001');
    fixture.detectChanges();
    return fixture;
  };

  it('shows the reference and offers to start when nothing has been started', () => {
    const f = render(view({}, ['START_POST_SHIPMENT']));
    expect(text(f)).toContain('TC-2026-00001');
    expect(text(f)).toContain('Start the application');
  });

  it('does not let the client submit until the documents the credit calls for are there, and says which are missing', () => {
    const c = view({ presentations: [draft as never], documents: [doc('CI', 'COMMERCIAL_INVOICE') as never] }, ['ATTACH_PRESENTATION_DOCUMENT', 'SUBMIT_POST_SHIPMENT', 'REMOVE_PRESENTATION_DOCUMENT']);
    const f = render(c);
    expect(text(f)).toContain('Still to add before you can submit: Bill of lading');
    const submit = buttons(f).find((b) => b.textContent?.trim() === 'Submit application');
    expect(submit?.disabled).toBeTrue();
  });

  it('enables submitting once every required document is present, and asks before sending', () => {
    const c = view({ presentations: [draft as never], documents: [doc('CI', 'COMMERCIAL_INVOICE') as never, doc('BL', 'BILL_OF_LADING') as never] }, ['SUBMIT_POST_SHIPMENT']);
    const f = render(c);
    const submit = buttons(f).find((b) => b.textContent?.trim() === 'Submit application');
    expect(submit?.disabled).toBeFalse();
    submit!.click();
    f.detectChanges();
    expect(text(f)).toContain('Submit to the bank now?');
  });

  it('offers to remove a draft application, asks first, and never offers it once the bank has the application', () => {
    const c = view({ presentations: [draft as never], documents: [doc('CI', 'COMMERCIAL_INVOICE') as never] }, ['SUBMIT_POST_SHIPMENT', 'REMOVE_POST_SHIPMENT_DRAFT']);
    const f = render(c);
    const remove = buttons(f).find((b) => b.textContent?.trim() === 'Remove draft');
    expect(remove).toBeDefined();
    remove!.click();
    f.detectChanges();
    expect(text(f)).toContain('Nothing has been sent to the bank');
    expect(buttons(f).some((b) => b.textContent?.trim() === 'Yes, remove')).toBeTrue();
    TestBed.resetTestingModule();
    const sent = render(view({ status: 'DOCUMENT_EXAMINATION', presentations: [{ ...draft, state: 'UNDER_EXAMINATION', applicationStatus: 'SUBMITTED' } as never], documents: [doc('CI', 'COMMERCIAL_INVOICE') as never] }, []));
    expect(buttons(sent).some((b) => b.textContent?.trim() === 'Remove draft')).toBeFalse();
  });

  it('shows a correction as waiting to be sent, with a button to send it', () => {
    const submitted = { ...draft, state: 'CLARIFICATION_REQUESTED', applicationStatus: 'SUBMITTED' };
    const c = view({ status: 'DISCREPANCY_RESOLUTION', presentations: [submitted as never], documents: [doc('CI', 'COMMERCIAL_INVOICE', { sentToBankAt: null }) as never] }, ['SEND_DOCUMENTS', 'ATTACH_PRESENTATION_DOCUMENT']);
    const f = render(c);
    expect(text(f)).toContain('not sent to the bank yet');
    expect(buttons(f).some((b) => b.textContent?.trim() === 'Send to bank')).toBeTrue();
  });

  it('shows the bank\'s question with a reply box, and the decision once there is one', () => {
    const q = { queryId: 'Q-001', assignee: 'CUSTOMER', status: 'OPEN', subject: 'Please confirm', question: 'Please correct the HS code.', responses: [] };
    const asked = render(view({ status: 'DISCREPANCY_RESOLUTION', presentations: [{ ...draft, state: 'CLARIFICATION_REQUESTED', applicationStatus: 'SUBMITTED' } as never], queries: [q as never] }));
    expect(text(asked)).toContain('The bank has asked you a question');
    expect(text(asked)).toContain('Please correct the HS code.');
    TestBed.resetTestingModule();
    const decided = render(view({ presentations: [{ ...draft, state: 'REFUSED', applicationStatus: 'SUBMITTED', decision: { decision: 'REFUSED', by: { name: 'Officer' }, at: '2026-10-27T11:00:00Z', rationale: 'Port differs from the credit.' } } as never] }, ['START_POST_SHIPMENT']));
    expect(text(decided)).toContain('The bank refused the documents');
    expect(text(decided)).toContain('Port differs from the credit.');
    expect(text(decided)).toContain('Start a new application');
  });
});

describe('PostShipmentReviewComponent', () => {
  const finding = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({
    findingId: 'F-0001', ruleId: 'EXM-XD-HS', ruleVersion: '1', title: 'Invoice HS code differs from the approved code', description: 'Invoice 84081000; approved 52010010.', severity: 'HIGH', blocking: true, status: 'OPEN',
    class: 'BLOCKING_DISCREPANCY', classLabel: 'Blocking discrepancy', category: 'DOCUMENTARY_DISCREPANCY', origin: 'DETERMINISTIC_RULE', observed: [{ source: 'DOCUMENT', label: 'Invoice HS code', value: '84081000', filename: 'ci.pdf', pageNumber: 1 }],
    expected: 'The approved code.', recommendedAction: 'Ask the customer.', confidence: null, disposition: null, applicantWaiver: null, presentationId: 'PR-01', ...over,
  });
  const review = (over: Partial<PostShipmentReview> = {}): PostShipmentReview => ({
    caseId: 'TC-2026-00001', reference: 'TC-2026-00001', status: 'DISCREPANCY_RESOLUTION', customerRef: 'TG-CORP-1001',
    credit: { reference: 'TC-2026-00001', basis: 'APPROVED_APPLICATION', applicationVersion: 1, terms: { applicant: 'Kamran', beneficiary: 'Global', currency: 'USD', amount: 250000, goodsDescription: 'Raw cotton', hsCode: '5201.0010', quantity: 100000, unitOfMeasure: 'KG', incoterm: 'CFR', portOfLoading: 'Shanghai', portOfDischarge: 'Karachi', latestShipmentDate: '2026-12-26', expiryDate: '2027-01-25', presentationPeriodDays: 21, requiredDocuments: ['COMMERCIAL_INVOICE'] } },
    approvedAt: '2026-10-27T10:00:00Z', approvedDocuments: [{ documentType: 'PROFORMA_INVOICE', filename: 'pi.pdf', version: 1 }],
    applications: [{ presentationId: 'PR-01', reference: 'TC-2026-00001/P1', origin: 'CLIENT', state: 'DISCREPANCIES', submittedAt: '', receivedAt: '', documentCount: 1, documentTypes: [], examination: { result: 'DISCREPANT', examinedAt: '' }, decision: null, termsBasis: 'APPROVED_APPLICATION', documentLinkIds: [], aiReview: null }],
    activePresentationId: 'PR-01', documents: [], comparison: [{ field: 'hsCode', label: 'HS code', approved: [{ source: 'Credit', value: '5201.0010' }], presented: [{ documentType: 'COMMERCIAL_INVOICE', filename: 'ci.pdf', value: '84081000' }], status: 'DIFFERENT' }],
    findings: [finding()], counts: { BLOCKING_DISCREPANCY: 1, NON_BLOCKING_DISCREPANCY: 0, WARNING: 0, INFORMATION: 0 }, queries: [], reexaminationDue: false, requiredDocuments: ['COMMERCIAL_INVOICE'], actions: [], ...over,
  });

  const render = (r: PostShipmentReview) => {
    TestBed.configureTestingModule({
      imports: [PostShipmentReviewComponent],
      providers: [provideRouter([]), { provide: PostShipmentService, useValue: { review: () => of(r) } }, { provide: TradeCasesService, useValue: { downloadDocument: () => of(undefined) } }, { provide: ToastService, useValue: toast }],
    });
    const fixture = TestBed.createComponent(PostShipmentReviewComponent);
    fixture.componentRef.setInput('id', 'TC-2026-00001');
    fixture.detectChanges();
    return fixture;
  };

  it('puts the reference, the basis and the findings by class in front of the officer', () => {
    const f = render(review());
    expect(text(f)).toContain('TC-2026-00001');
    expect(text(f)).toContain('approved pre-shipment application');
    expect(text(f)).toContain('Blocking discrepancies (1)');
    expect(text(f)).toContain('Invoice HS code differs from the approved code');
    expect(text(f)).toMatch(/ci\.pdf\s*,\s*page 1/);
  });

  it('shows the field comparison with what differs marked', () => {
    const f = render(review());
    expect(text(f)).toContain('84081000');
    expect(f.nativeElement.querySelector('.psr-diff')).not.toBeNull();
  });

  it('offers the examination, the request and the decision only to someone who may act', () => {
    const reader = render(review({ actions: [] }));
    expect(text(reader)).not.toContain('Run the examination');
    expect(text(reader)).not.toContain('Record decision');
    TestBed.resetTestingModule();
    const officer = render(review({ actions: ['EXAMINE_PRESENTATION', 'DECIDE_PRESENTATION', 'REQUEST_CLARIFICATION', 'ADD_MANUAL_FINDING'] }));
    expect(text(officer)).toContain('Examine again');
    expect(text(officer)).toContain('Ask the client for clarification');
    expect(text(officer)).toContain('Record decision');
    expect(text(officer)).toContain('1 blocking discrepancy is still open');
  });

  it('gives no controls to close a piece of information, and none to close a blocking discrepancy by hand', () => {
    const info = finding({ findingId: 'F-0002', ruleId: 'EXM-XD-BASIS', title: 'Examined against the approved application', severity: 'INFO', blocking: false, class: 'INFORMATION' });
    const f = render(review({ findings: [finding(), info], counts: { BLOCKING_DISCREPANCY: 1, NON_BLOCKING_DISCREPANCY: 0, WARNING: 0, INFORMATION: 1 } }));
    expect(buttons(f).filter((b) => b.textContent?.trim() === 'Close').length).toBe(0);
  });

  it('labels what the AI read and says it never holds the case', () => {
    const ai = finding({ findingId: 'F-0003', ruleId: 'AI-POST-XDOC', title: 'Named place differs from the discharge port', severity: 'MEDIUM', blocking: false, class: 'NON_BLOCKING_DISCREPANCY', origin: 'AI_ASSISTED_EXTRACTION' });
    const base = review();
    const f = render(review({ findings: [ai], applications: [{ ...base.applications[0]!, aiReview: { summary: 'Mostly consistent.', at: '2026-10-27T11:00:00Z', model: 'gemini', raised: 1, leftOut: 1 } }] }));
    expect(text(f)).toContain('AI-assisted reading');
    expect(text(f)).toContain('none of them holds the case');
    expect(text(f)).toContain('1 left out because the words it quoted are not in the documents');
  });
});
