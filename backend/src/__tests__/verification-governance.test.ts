import './test-env';
import assert from 'node:assert';
import type { AuthenticatedUser } from '../middleware/auth.middleware';
import { findDemoAccount, type DemoAccountKey } from '../services/account-directory';
import { enforcementOf, mandatorySources, unapprovedRuleMode, VerificationGovernance } from '../verification/governance';

/**
 * Who may make a verification rule a bank control, and what the platform does until someone has. The
 * decision is recorded by a person other than the proposer, in a log that notices alteration, and an approval
 * applies to one version of one rule. While a rule is unapproved it is shown as a demonstration or in shadow
 * mode, never as an approved control.
 */

const as = (key: DemoAccountKey): AuthenticatedUser => ({ ...findDemoAccount(key)!, tokenType: 'BEARER' });
const analyst = as('risk_analyst'); // compliance: may propose
const cco = as('compliance_officer'); // policy owner: may approve
const maker = as('trade_maker');
const customer = as('corporate_customer');
const admin = as('system_admin');
const auditor = as('trade_auditor');

const gov = VerificationGovernance.getInstance();
const RULE = 'EXT-HS-CLASS';
const reason = 'Reviewed against the bank policy on classification checks.';

function expectThrows(fn: () => unknown, status: number, label: string): void {
  try {
    fn();
  } catch (error) {
    assert.strictEqual((error as { status?: number }).status, status, `${label}: expected ${status}, got ${(error as { status?: number }).status} (${String(error).slice(0, 80)})`);
    return;
  }
  assert.fail(`${label}: expected a refusal`);
}

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('Verification governance: approval, enforcement mode and exceptions');
  console.log('================================================================\n');
  gov.resetForTesting();

  // ------------------------------------------------------------------ 1. nothing is approved to begin with
  assert.strictEqual(gov.ruleState(RULE).status, 'PENDING_BANK_SIGN_OFF');
  assert.strictEqual(enforcementOf(RULE, gov).mayBlock && enforcementOf(RULE, gov).mode !== 'ENFORCED', true, 'outside production an unapproved rule runs as a labeled demonstration');
  console.log('✔ Scenario 1 Passed: every verification rule starts as pending bank sign-off.\n');

  // ------------------------------------------------------------------ 2. permissions
  for (const [who, name] of [[maker, 'a trade maker'], [customer, 'a customer'], [admin, 'the system administrator'], [auditor, 'an auditor']] as const) {
    expectThrows(() => gov.proposeRule(who, RULE, reason), 403, `${name} proposing`);
    expectThrows(() => gov.decideRule(who, RULE, true, reason), 403, `${name} deciding`);
  }
  expectThrows(() => gov.decideRule(analyst, RULE, true, reason), 403, 'an analyst may propose but not approve');
  expectThrows(() => gov.proposeRule(analyst, RULE, 'too short'), 400, 'a rationale of fewer than ten characters');
  expectThrows(() => gov.proposeRule(analyst, 'NO-SUCH-RULE', reason), 404, 'an unknown rule');
  console.log('✔ Scenario 2 Passed: only compliance proposes, only the policy owner decides; makers, customers, auditors and administrators cannot do either.\n');

  // ------------------------------------------------------------------ 3. dual control and versions
  assert.strictEqual(gov.proposeRule(analyst, RULE, reason).status, 'PROPOSED');
  expectThrows(() => gov.proposeRule(analyst, RULE, reason), 409, 'proposing twice');
  expectThrows(() => gov.revokeRule(cco, RULE, reason), 409, 'revoking what is not approved');
  // The policy owner proposing and then deciding the same thing is the case dual control exists for.
  const solo = new VerificationGovernance();
  solo.proposeRule(cco, 'EXT-HS-VALID', reason);
  expectThrows(() => solo.decideRule(cco, 'EXT-HS-VALID', true, reason), 403, 'deciding what you proposed');
  assert.strictEqual(gov.decideRule(cco, RULE, true, reason).status, 'APPROVED');
  const state = gov.ruleState(RULE);
  assert.ok(state.proposedBy?.id === analyst.id && state.decidedBy?.id === cco.id && state.proposedBy.id !== state.decidedBy.id, 'who proposed and who decided are both recorded');
  assert.strictEqual(gov.ruleState(RULE, '99').status, 'PENDING_BANK_SIGN_OFF', 'an approval applies to one version: another version is unapproved');
  const enforced = enforcementOf(RULE, gov);
  assert.ok(enforced.mode === 'ENFORCED' && enforced.mayBlock && /Approved bank control/.test(enforced.label));
  console.log('✔ Scenario 3 Passed: dual control holds, the decision is bound to the rule version, and an approved rule is enforced as a control.\n');

  // ------------------------------------------------------------------ 4. revoke, reject
  assert.strictEqual(gov.revokeRule(cco, RULE, 'Wording of the rule under review again.').status, 'REVOKED');
  assert.ok(enforcementOf(RULE, gov).mode !== 'ENFORCED', 'a revoked rule is no longer a control');
  gov.proposeRule(analyst, RULE, reason);
  assert.strictEqual(gov.decideRule(cco, RULE, false, 'Needs the legal reviewer to confirm the heading text first.').status, 'REJECTED');
  assert.ok(gov.history(RULE).length === 5, 'every step is kept');
  console.log('✔ Scenario 4 Passed: revocation and rejection take effect and every step stays in the log.\n');

  // ------------------------------------------------------------------ 5. an altered log honours nothing
  gov.proposeRule(analyst, RULE, reason);
  gov.decideRule(cco, RULE, true, reason);
  assert.strictEqual(gov.ruleState(RULE).status, 'APPROVED');
  assert.ok(gov.integrity().valid);
  (gov as unknown as { entries: Array<{ rationale: string }> }).entries[0]!.rationale = 'Edited afterwards.';
  assert.strictEqual(gov.integrity().valid, false, 'the alteration is detected');
  assert.strictEqual(gov.ruleState(RULE).status, 'PENDING_BANK_SIGN_OFF', 'a log that may have been altered approves nothing');
  assert.ok(enforcementOf(RULE, gov).mode !== 'ENFORCED');
  console.log('✔ Scenario 5 Passed: tampering with the governance log is detected and no approval is honoured while it stands.\n');

  // ------------------------------------------------------------------ 6. what an unapproved rule does
  gov.resetForTesting();
  const saved = { mode: process.env['VERIFICATION_UNAPPROVED_RULE_MODE'], env: process.env['NODE_ENV'], sources: process.env['VERIFICATION_MANDATORY_SOURCES'] };
  try {
    delete process.env['VERIFICATION_UNAPPROVED_RULE_MODE'];
    process.env['NODE_ENV'] = 'test';
    assert.strictEqual(unapprovedRuleMode(), 'DEMO_ENFORCE');
    const demo = enforcementOf(RULE, gov);
    assert.ok(demo.mode === 'DEMO_ENFORCED' && demo.mayBlock && /DEMONSTRATION/.test(demo.label) && /not an approved control/.test(demo.label), 'demonstration enforcement says so');
    process.env['NODE_ENV'] = 'production';
    assert.strictEqual(unapprovedRuleMode(), 'SHADOW', 'in production the default is shadow mode');
    const shadow = enforcementOf(RULE, gov);
    assert.ok(shadow.mode === 'SHADOW' && !shadow.mayBlock && /SHADOW MODE/.test(shadow.label), 'shadow mode never blocks');
    process.env['VERIFICATION_UNAPPROVED_RULE_MODE'] = 'DEMO_ENFORCE';
    assert.strictEqual(unapprovedRuleMode(), 'DEMO_ENFORCE', 'an explicit setting wins over the default');
    process.env['VERIFICATION_MANDATORY_SOURCES'] = ' UN-HS-REFERENCE , PAKISTAN-CUSTOMS-TARIFF ';
    assert.deepStrictEqual([...mandatorySources()].sort(), ['PAKISTAN-CUSTOMS-TARIFF', 'UN-HS-REFERENCE']);
    delete process.env['VERIFICATION_MANDATORY_SOURCES'];
    assert.strictEqual(mandatorySources().size, 0, 'no source is mandatory unless the bank says so');
  } finally {
    for (const [key, value] of [['VERIFICATION_UNAPPROVED_RULE_MODE', saved.mode], ['NODE_ENV', saved.env], ['VERIFICATION_MANDATORY_SOURCES', saved.sources]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  console.log('✔ Scenario 6 Passed: unapproved rules run as a labeled demonstration or in shadow mode (the production default); mandatory sources are opt-in.\n');

  console.log('================================================================');
  console.log('ALL VERIFICATION GOVERNANCE SCENARIOS PASSED');
  console.log('================================================================');
}

run().catch((error) => {
  console.error('VERIFICATION GOVERNANCE TEST FAILED:', error);
  process.exit(1);
});
