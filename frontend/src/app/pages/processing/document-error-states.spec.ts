import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import { DocumentsService } from '../../services/documents.service';
import { ToastService } from '../../services/toast.service';
import { AnalysisComponent } from '../analysis/analysis.component';
import { ProcessingComponent } from './processing.component';

/**
 * AUDIT-002: a document id the API refuses (unknown, malformed, not yours) used to leave the processing page on
 * "Analyzing 0%" for ever and the analysis page blank, with only a toast that disappears. Both now say what happened.
 */

const toast = { success: () => undefined, error: () => undefined, info: () => undefined, warning: () => undefined };
const text = (fixture: { nativeElement: HTMLElement }): string => (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ');
const refused = () => throwError(() => ({ message: 'That document id is not valid.' }));

describe('document pages with an id the API refuses', () => {
  it('the processing page shows that progress cannot be shown, not an endless 0%', () => {
    TestBed.configureTestingModule({
      imports: [ProcessingComponent],
      providers: [provideRouter([]), { provide: ToastService, useValue: toast }, { provide: DocumentsService, useValue: { pollStatus: refused } }],
    });
    const fixture = TestBed.createComponent(ProcessingComponent);
    fixture.componentRef.setInput('id', 'doc-x');
    fixture.detectChanges();
    expect(text(fixture)).toContain("This document's progress cannot be shown");
    expect(text(fixture)).toContain('That document id is not valid.');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('the analysis page shows that the analysis could not be opened, with a way to retry', () => {
    TestBed.configureTestingModule({
      imports: [AnalysisComponent],
      providers: [provideRouter([]), provideHttpClient(), { provide: ToastService, useValue: toast }, { provide: DocumentsService, useValue: { results: refused, getLiveFxQuote: refused } }],
    });
    const fixture = TestBed.createComponent(AnalysisComponent);
    fixture.componentRef.setInput('id', 'doc-x');
    fixture.detectChanges();
    expect(text(fixture)).toContain('This analysis could not be opened.');
    expect(text(fixture)).toContain('That document id is not valid.');
    expect(Array.from(fixture.nativeElement.querySelectorAll('button')).some((b) => (b as HTMLElement).textContent?.includes('Try again'))).toBe(true);
  });
});
