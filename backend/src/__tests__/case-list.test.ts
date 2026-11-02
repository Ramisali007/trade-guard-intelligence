import './test-env';
import assert from 'node:assert';
import type { AuthenticatedUser } from '../middleware/auth.middleware';
import { ComplianceStore } from '../compliance/db/compliance-store';
import { findDemoAccount, initAccountDirectory, type DemoAccountKey } from '../services/account-directory';
import { CustomerRepository } from '../services/customer.repository';
import { initRepository } from '../services/document.repository';
import { getTradeCaseRepository, initTradeCaseRepository } from '../trade-cases/trade-case.repository';
import { getTradeCaseService } from '../trade-cases/trade-case.service';

/**
 * The case list is read-only and cheap. What it proves: a listed case cannot be changed by the caller (the store is not
 * touched by a reader), a case read by id is a private copy, and the lean `listRow` that every list and queue is built from
 * gives the same status, next steps, findings and queries as the full view for a customer, a maker and a compliance officer.
 * Synthetic accounts and data only; the stores are in memory.
 */

const account = (key: DemoAccountKey): AuthenticatedUser => ({ ...findDemoAccount(key)!, tokenType: 'BEARER' });

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('Case list: read-only, and the same answers as the full view');
  console.log('================================================================\n');
  await initRepository();
  await CustomerRepository.getInstance().init();
  await ComplianceStore.getInstance().init();
  await initTradeCaseRepository();
  await initAccountDirectory();

  const svc = getTradeCaseService();
  const repo = getTradeCaseRepository();
  const customer = account('corporate_customer');
  const application = { applicant: { name: 'Kamran Textiles (Pvt) Ltd', country: 'Pakistan' }, beneficiary: { name: 'Global Cotton Traders Limited', country: 'China' }, currency: 'USD', amount: 100000 };
  const { tradeCase } = await svc.createCase(customer, { clientRequestId: 'LIST-1', application });
  const caseId = tradeCase.caseId;

  // 1 a reader cannot change the store
  const [listed] = (await repo.list({ customerRef: customer.customerRef })).filter((c) => c.caseId === caseId);
  assert.ok(listed, 'the case is listed');
  assert.throws(() => { listed.status = 'REJECTED'; }, TypeError, 'a listed case is frozen');
  assert.throws(() => { listed.applicationVersions[0]!.data.amount = 1; }, TypeError, 'and so is everything inside it');
  assert.throws(() => { listed.findings.push({} as never); }, TypeError, 'including its lists');
  assert.strictEqual((await repo.findById(caseId))!.status, 'DRAFT', 'the stored case is unchanged');
  console.log('✔ C1 Passed: a listed case is read-only all the way down; the store cannot be changed through it.\n');

  // 2 a case read by id is a private copy
  const mine = (await repo.findById(caseId))!;
  mine.status = 'APPROVAL_PENDING';
  mine.applicationVersions[0]!.data.amount = 5;
  const again = (await repo.findById(caseId))!;
  assert.strictEqual(again.status, 'DRAFT');
  assert.strictEqual(again.applicationVersions[0]!.data.amount, 100000);
  assert.strictEqual((await repo.list({})).find((c) => c.caseId === caseId)!.status, 'DRAFT', 'and the list is unchanged too');
  console.log('✔ C2 Passed: a case read by id is a private copy; changing it does not change the store or the list.\n');

  // 3 the lean row agrees with the full view
  const full = (await repo.findById(caseId))!;
  for (const key of ['corporate_customer', 'trade_maker', 'compliance_officer', 'risk_analyst'] as DemoAccountKey[]) {
    const user = account(key);
    const view = svc.toView(user, full) as { status: string; availableActions: string[]; findings: unknown[]; queries: unknown[] };
    const row = svc.listRow(user, full);
    assert.strictEqual(row.status, view.status, `${key}: status`);
    assert.deepStrictEqual(row.availableActions, view.availableActions, `${key}: next steps`);
    assert.strictEqual(row.findings.length, view.findings.length, `${key}: findings`);
    assert.strictEqual(row.queries.length, view.queries.length, `${key}: queries`);
  }
  console.log('✔ C3 Passed: the list row matches the full view (status, next steps, findings, queries) for a customer, a maker and two compliance roles.\n');

  console.log('================================================================');
  console.log('ALL CASE LIST SCENARIOS PASSED');
  console.log('================================================================\n');
  process.exit(0);
}

run().catch((error) => {
  console.error('CASE LIST TEST FAILED:', error);
  process.exit(1);
});
