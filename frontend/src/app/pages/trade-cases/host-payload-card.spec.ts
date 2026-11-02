import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { TradeCasesService } from '../../services/trade-cases.service';
import { ToastService } from '../../services/toast.service';
import type { HostPayloadView } from '../../models/trade-case.models';
import { HostPayloadCardComponent } from './host-payload-card.component';

const actor = { id: 'u1', name: 'Bilal Ahmed', role: 'TRADE_MAKER' } as const;

const payload = (over: Partial<NonNullable<HostPayloadView['payload']>> = {}): NonNullable<HostPayloadView['payload']> => ({
  payloadId: 'TC-2026-00007',
  status: 'GENERATED',
  generatedAt: '2026-10-29T08:00:00.000Z',
  generatedBy: actor,
  currentVersion: 1,
  versions: [{ version: 1, generatedAt: '2026-10-29T08:00:00.000Z', sha256: 'a'.repeat(64), sizeBytes: 13_900, filename: 'TC-2026-00007-host-payload.pdf', includesTiReference: false }],
  tiReference: null,
  deliveries: [],
  lastSentAt: null,
  url: 'https://bank.example.pk/api/host-payloads/TC-2026-00007/tok/TC-2026-00007-host-payload.pdf',
  filename: 'TC-2026-00007-host-payload.pdf',
  sha256: 'a'.repeat(64),
  sizeBytes: 13_900,
  opened: { count: 0, lastAt: null },
  activity: [],
  ...over,
});

const view = (over: Partial<HostPayloadView> = {}): HostPayloadView => ({
  approved: true,
  canSend: true,
  delivery: { endpointConfigured: false, publicAddressConfigured: true },
  payload: payload(),
  ...over,
});

/** The card shows what the API says and asks it to act; it decides nothing itself. */
describe('HostPayloadCardComponent', () => {
  let fixture: ComponentFixture<HostPayloadCardComponent>;
  let current: HostPayloadView;
  let calls: string[];
  let sendResult: () => Observable<HostPayloadView>;

  const service = {
    hostPayload: () => of(current),
    generateHostPayload: () => {
      calls.push('generate');
      current = view();
      return of(current);
    },
    sendToHost: () => {
      calls.push('send');
      return sendResult();
    },
    downloadHostPayload: (_id: string, filename: string) => {
      calls.push('download:' + filename);
      return of(filename);
    },
  };
  const toasts: string[] = [];
  const toast = { success: (t: string) => toasts.push(t), info: (t: string) => toasts.push(t), error: (t: string) => toasts.push(t) };

  const text = () => (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
  const button = (label: string) => [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((b) => b.textContent!.includes(label)) as HTMLButtonElement | undefined;

  const create = async (v: HostPayloadView) => {
    current = v;
    fixture = TestBed.createComponent(HostPayloadCardComponent);
    fixture.componentRef.setInput('caseId', 'TC-2026-00007');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    calls = [];
    toasts.length = 0;
    sendResult = () => of(current);
    TestBed.configureTestingModule({ providers: [{ provide: TradeCasesService, useValue: service }, { provide: ToastService, useValue: toast }] });
  });

  it('shows the references, the link and that the TI reference is not made yet', async () => {
    await create(view());
    expect(text()).toContain('Case reference');
    expect(text()).toContain('TC-2026-00007');
    // One number for the case, the link and the file; the TI reference is the only other one.
    expect(text()).not.toContain('PSR-');
    expect(text()).not.toContain('HP-');
    expect(text()).toContain('Created when you send it to the host');
    expect(text()).toContain('Ready to send');
    expect(text()).toContain('https://bank.example.pk/api/host-payloads/TC-2026-00007/tok/TC-2026-00007-host-payload.pdf');
    expect((fixture.nativeElement as HTMLElement).querySelector('a[href^="https://bank.example.pk"]')?.getAttribute('rel')).toContain('noopener');
    expect(button('Send to host')).toBeTruthy();
  });

  it('says plainly that nothing is posted when no host endpoint is configured', async () => {
    await create(view());
    expect(text()).toContain('nothing is posted');
    await create(view({ delivery: { endpointConfigured: true, publicAddressConfigured: true } }));
    expect(text()).toContain('posted to the host endpoint');
    expect(text()).not.toContain('nothing is posted');
  });

  it('warns that a localhost link cannot be reached by the host', async () => {
    await create(view({ delivery: { endpointConfigured: false, publicAddressConfigured: false } }));
    expect(text()).toContain('PUBLIC_BASE_URL');
    await create(view());
    expect(text()).not.toContain('PUBLIC_BASE_URL');
  });

  it('sends on request and then shows the TI reference, the sent status and the delivery', async () => {
    await create(view());
    sendResult = () => {
      current = view({
        payload: payload({
          status: 'SENT_TO_HOST',
          currentVersion: 2,
          tiReference: { reference: 'TI-2026-000012', createdAt: '2026-10-29T09:00:00.000Z', createdBy: actor },
          lastSentAt: '2026-10-29T09:00:01.000Z',
          deliveries: [{ at: '2026-10-29T09:00:01.000Z', by: actor, mode: 'RECORDED_ONLY', ok: true, httpStatus: null, message: 'Nothing was posted.' }],
        }),
      });
      return of(current);
    };
    button('Send to host')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(calls).toEqual(['send']);
    expect(text()).toContain('TI-2026-000012');
    expect(text()).toContain('Sent to host');
    expect(text()).toContain('Recorded');
    expect(text()).toContain('Nothing was posted.');
    expect(button('Send to host again')).toBeTruthy();
    expect(toasts).toContain('Sent to host');
  });

  it('reports a failed send and keeps the reference visible', async () => {
    await create(view());
    sendResult = () => {
      current = view({
        payload: payload({
          status: 'DELIVERY_FAILED',
          tiReference: { reference: 'TI-2026-000013', createdAt: '2026-10-29T09:00:00.000Z', createdBy: actor },
          deliveries: [{ at: '2026-10-29T09:00:01.000Z', by: actor, mode: 'HTTP', ok: false, httpStatus: 503, message: 'The host did not accept the payload (HTTP 503).' }],
        }),
      });
      return of(current);
    };
    button('Send to host')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('Send failed');
    expect(text()).toContain('TI-2026-000013');
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain('HTTP 503');
    expect(toasts).not.toContain('Sent to host');
  });

  it('shows the API refusal when sending is not allowed', async () => {
    await create(view());
    sendResult = () => throwError(() => ({ error: { error: { code: 'FORBIDDEN', message: 'You do not have permission to send.' } }, status: 403 }));
    button('Send to host')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('Send to host');
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).toBeTruthy();
  });

  it('offers to generate a missing payload, and only to someone who may', async () => {
    await create(view({ payload: null, canSend: false }));
    expect(text()).toContain('has not been generated');
    expect(button('Generate')).toBeUndefined();
    await create(view({ payload: null, canSend: true }));
    button('Generate the payload PDF')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(calls).toEqual(['generate']);
    expect(text()).toContain('TC-2026-00007');
  });

  it('hides the send button from someone who may only read, and downloads through the signed-in call', async () => {
    await create(view({ canSend: false }));
    expect(button('Send to host')).toBeUndefined();
    button('Download')!.click();
    expect(calls).toEqual(['download:TC-2026-00007-host-payload.pdf']);
  });

  it('says what the host opened: the page, the payload and which document', async () => {
    await create(view({ payload: payload({ opened: { count: 3, lastAt: '2026-10-29T10:00:00.000Z' }, activity: [{ at: '2026-10-29T10:00:00.000Z', kind: 'DOCUMENT', item: '01_Proforma_Invoice_PI-2026-0731.pdf' }, { at: '2026-10-29T09:59:00.000Z', kind: 'PAGE', item: null }] }) }));
    expect(text()).toContain('What the host opened');
    expect(text()).toContain('Opened a document');
    expect(text()).toContain('01_Proforma_Invoice_PI-2026-0731.pdf');
    expect(text()).toContain('Opened the page');
    expect(text()).toContain('Open the host page');
  });

  it('shows how often the host opened the link', async () => {
    await create(view({ payload: payload({ opened: { count: 3, lastAt: '2026-10-29T10:00:00.000Z' } }) }));
    expect(text()).toContain('opened by the host 3 times');
  });
});
