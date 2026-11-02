import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TradeCasesService } from './trade-cases.service';

/** Clicking a document's name: a PDF opens in a tab of its own, any other file is downloaded to the device. */
describe('TradeCasesService: opening a document', () => {
  let service: TradeCasesService;
  let http: HttpTestingController;
  const file = (type: string) => new Blob(['%PDF-1.4 test'], { type });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(TradeCasesService);
    http = TestBed.inject(HttpTestingController);
  });

  it('opens a PDF in a new tab, opened at once and filled when the file arrives', () => {
    const tab = { opener: {} as unknown, closed: false, close: jasmine.createSpy('close'), document: { title: '', body: { textContent: '' } }, location: { href: '' } };
    const open = spyOn(window, 'open').and.returnValue(tab as unknown as Window);
    service.openDocument('TC-2026-00002', 'DL-001', 'PI-2026-0730.PDF').subscribe();
    expect(open).toHaveBeenCalledOnceWith('', '_blank');
    expect(tab.document.title).toBe('PI-2026-0730.PDF');
    expect(tab.opener).toBeNull();
    http.expectOne('/api/trade-cases/TC-2026-00002/documents/DL-001/file').flush(file('application/octet-stream'));
    expect(tab.location.href.startsWith('blob:')).toBeTrue();
  });

  it('closes the new tab and reports it when the file cannot be fetched', () => {
    const tab = { opener: {} as unknown, closed: false, close: jasmine.createSpy('close'), document: { title: '', body: { textContent: '' } }, location: { href: '' } };
    spyOn(window, 'open').and.returnValue(tab as unknown as Window);
    let failed = false;
    service.openDocument('TC-2026-00002', 'DL-001', 'contract.pdf').subscribe({ error: () => (failed = true) });
    http.expectOne('/api/trade-cases/TC-2026-00002/documents/DL-001/file').error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });
    expect(failed).toBeTrue();
    expect(tab.close).toHaveBeenCalled();
  });

  it('downloads a file that is not a PDF and opens no tab for it', () => {
    const open = spyOn(window, 'open');
    const click = spyOn(HTMLAnchorElement.prototype, 'click').and.stub();
    service.openDocument('TC-2026-00002', 'DL-002', 'LC-form.docx').subscribe();
    expect(open).not.toHaveBeenCalled();
    http.expectOne('/api/trade-cases/TC-2026-00002/documents/DL-002/file').flush(file('application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('falls back to a download when the browser blocks the new tab', () => {
    spyOn(window, 'open').and.returnValue(null);
    const click = spyOn(HTMLAnchorElement.prototype, 'click').and.stub();
    service.openDocument('TC-2026-00002', 'DL-001', 'pi.pdf').subscribe();
    http.expectOne('/api/trade-cases/TC-2026-00002/documents/DL-001/file').flush(file('application/pdf'));
    expect(click).toHaveBeenCalledTimes(1);
  });
});
