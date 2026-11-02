import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { VerificationService } from '../../services/verification.service';
import type { VerificationOverview, VerificationRuleView } from '../../models/verification.models';
import { VerificationGovernanceComponent } from './verification-governance.component';

/**
 * The screen only reflects what the API will allow. These specs check what a reader is told about an unapproved rule
 * and that the approval buttons follow the signed-in user's permissions and the dual-control rule (nobody decides what
 * they proposed). The API enforces both; the screen must never suggest otherwise.
 */

const rule = (over: Partial<VerificationRuleView> = {}): VerificationRuleView => ({
  rule: {
    ruleId: 'EXT-HS-CLASS',
    version: '1',
    name: 'The HS code fits the goods',
    description: 'Compares the goods with the official wording.',
    jurisdiction: 'INTERNATIONAL',
    sourceId: 'UN-HS-REFERENCE',
    sourceReference: 'HS chapter, heading',
    interpretationStatus: 'SOURCE_CURRENCY_UNVERIFIED',
    defaultSeverity: 'HIGH',
    workflowAction: 'Query the customer.',
    tests: [],
    applicability: { basis: 'REFERENCE_DATA_CHECK', appliesTo: 'Any document that states an HS code.', doesNotEstablish: 'Whether the goods are restricted or prohibited in Pakistan.' },
  },
  approval: { ruleId: 'EXT-HS-CLASS', version: '1', status: 'PROPOSED', proposedBy: { id: 'u-analyst', name: 'Risk Analyst', role: 'RISK_ANALYST' }, proposedAt: '2026-10-26T09:00:00Z', decidedBy: null, decidedAt: null, rationale: '' },
  enforcement: { ruleId: 'EXT-HS-CLASS', version: '1', approval: 'PROPOSED', mode: 'DEMO_ENFORCED', mayBlock: true, label: 'DEMONSTRATION: rule awaiting the policy owner; enforced for demonstration, not an approved control' },
  history: [],
  ...over,
});

const overview = (rules: VerificationRuleView[]): VerificationOverview => ({
  ruleSetVersion: 'rs-1',
  policy: { unapprovedRuleMode: 'DEMO_ENFORCE', mandatorySources: [], note: 'Unapproved rules run as a labeled demonstration.' },
  governanceIntegrity: { valid: true, problem: null, entries: 1 },
  rules,
  sources: { catalogue: [], health: [] },
});

function render(opts: { permissions: string[]; userId: string; rules: VerificationRuleView[] }): HTMLElement {
  TestBed.configureTestingModule({
    imports: [VerificationGovernanceComponent],
    providers: [
      provideRouter([]),
      { provide: VerificationService, useValue: { overview: () => of(overview(opts.rules)), datasets: () => of({ datasets: [], health: {} }) } },
      { provide: AuthService, useValue: { can: (p: string) => opts.permissions.includes(p), currentUser: () => ({ id: opts.userId }) } },
      { provide: ToastService, useValue: { success: () => undefined, error: () => undefined } },
    ],
  });
  const fixture = TestBed.createComponent(VerificationGovernanceComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const buttons = (el: HTMLElement): string[] => Array.from(el.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());

describe('VerificationGovernanceComponent', () => {
  it('says plainly that an unapproved rule is a demonstration, not a control', () => {
    const el = render({ permissions: [], userId: 'u-viewer', rules: [rule()] });
    expect(el.textContent).toContain('demonstration mode');
    expect(el.textContent).toContain('DEMONSTRATION: rule awaiting the policy owner');
    expect(el.textContent).toContain('Proposed');
  });

  it('shows what kind of rule it is and what a finding under it does not establish', () => {
    const el = render({ permissions: [], userId: 'u-viewer', rules: [rule()] });
    expect(el.textContent).toContain('Reference data check');
    expect(el.textContent).toContain('Whether the goods are restricted or prohibited in Pakistan.');
  });

  it('offers no action to someone without the permission', () => {
    const el = render({ permissions: [], userId: 'u-viewer', rules: [rule()] });
    expect(buttons(el).some((b) => /Approve|Propose|Reject|Revoke/.test(b))).toBeFalse();
  });

  it('offers approval to the policy owner, but not to the person who proposed the rule', () => {
    const owner = render({ permissions: ['verification.rules.approve'], userId: 'u-cco', rules: [rule()] });
    expect(buttons(owner).some((b) => /Approve as a bank control/.test(b))).toBeTrue();
    TestBed.resetTestingModule();
    const proposer = render({ permissions: ['verification.rules.approve'], userId: 'u-analyst', rules: [rule()] });
    expect(buttons(proposer).some((b) => /Approve as a bank control/.test(b))).toBeFalse();
    expect(proposer.textContent).toContain('A different person must decide it');
  });

  it('lets an analyst propose a rule nobody has proposed', () => {
    const pending = rule({ approval: { ruleId: 'EXT-HS-CLASS', version: '1', status: 'PENDING_BANK_SIGN_OFF', proposedBy: null, proposedAt: null, decidedBy: null, decidedAt: null, rationale: '' } });
    const el = render({ permissions: ['verification.rules.propose'], userId: 'u-analyst', rules: [pending] });
    expect(buttons(el).some((b) => /Propose for approval/.test(b))).toBeTrue();
  });
});
