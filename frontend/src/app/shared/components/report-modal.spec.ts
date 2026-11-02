import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DocumentsService } from '../../services/documents.service';
import { ReportModal } from './report-modal';

/** The way every modal closes: a click on the dim area or Escape closes it; a click inside the dialog does not. */
describe('ReportModal closing', () => {
  let fixture: ComponentFixture<ReportModal>;
  let closed: number;

  beforeEach(async () => {
    const docs = {
      reportText: () => of(''),
      getLiveFxQuote: () => of(null),
    };
    await TestBed.configureTestingModule({
      imports: [ReportModal],
      providers: [{ provide: DocumentsService, useValue: docs }],
    }).compileComponents();
    fixture = TestBed.createComponent(ReportModal);
    fixture.componentRef.setInput('documentId', 'doc-1');
    closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    fixture.detectChanges();
  });

  const backdrop = (): HTMLElement => fixture.nativeElement.querySelector('.modal-backdrop');
  const dialog = (): HTMLElement => fixture.nativeElement.querySelector('[role="dialog"]');

  it('is a dialog behind a backdrop that is not itself a control', () => {
    expect(backdrop().getAttribute('role')).toBe('presentation');
    expect(dialog().getAttribute('aria-modal')).toBe('true');
  });

  it('closes when the dim area is clicked', () => {
    backdrop().click();
    expect(closed).toBe(1);
  });

  it('does not close when something inside the dialog is clicked', () => {
    dialog().click();
    dialog().querySelector('h2, h3, header')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(closed).toBe(0);
  });

  it('closes on Escape pressed anywhere inside it', () => {
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(1);
  });

  it('ignores other keys', () => {
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(closed).toBe(0);
  });
});
