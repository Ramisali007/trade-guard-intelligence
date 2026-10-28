import './test-env';
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import type { Router } from 'express';
import { createApp } from '../app';
import { ComplianceStore } from '../compliance/db/compliance-store';
import { authenticate, signBankingToken } from '../middleware/auth.middleware';
import { PERMISSIONS, ROLE_DEFINITIONS, ROLE_IDS, hasPermission, permissionsOf, type Permission, type RoleId } from '../authorization/permissions';
import { sectionsFor } from '../authorization/workspaces';
import { apiRouter } from '../routes';
import { authRouter } from '../routes/auth.routes';
import { DEMO_ACCOUNT_KEYS, findDemoAccount, getAccount, initAccountDirectory, type DemoAccountKey } from '../services/account-directory';
import { CustomerRepository } from '../services/customer.repository';
import { initRepository } from '../services/document.repository';
import { initTradeCaseRepository } from '../trade-cases/trade-case.repository';
import { getTradeCaseService } from '../trade-cases/trade-case.service';
import { ACTION_PERMISSIONS } from '../trade-cases/workflow.policy';
import type { Loose } from '../utils/loose-json';

/**
 * Role-based portals and the permission registry, tested from the outside:
 *
 *   R1  registry invariants — the admin has no business authority, maker/checker/issuer are split,
 *       every permission is real and used
 *   R2  default deny — every API route names a permission; the public ones are an explicit list
 *   R3  every demo role against every probe endpoint over HTTP, plus hand-written critical cases
 *   R4  administration — dual control, no self-service, role change and revocation end sessions
 *   R5  workspaces — each portal shows exactly its permitted screens and the cases waiting on it
 *   R6  data scope — customers and RMs see only their customers, by id or by list
 *
 * Synthetic accounts and data only; the stores are in memory (see test-env).
 */

const svc = getTradeCaseService();
const account = (key: DemoAccountKey) => findDemoAccount(key)!;

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('Role-based access, portals and administration');
  console.log('================================================================\n');

  await initRepository();
  await CustomerRepository.getInstance().init();
  await ComplianceStore.getInstance().init();
  await initTradeCaseRepository();
  await initAccountDirectory();

  // ------------------------------------------------------------------ R1 registry invariants
  const all = Object.keys(PERMISSIONS) as Permission[];
  const granted = new Set<Permission>();
  for (const role of ROLE_IDS) {
    for (const p of ROLE_DEFINITIONS[role].permissions) {
      assert.ok(all.includes(p), `${role} grants unknown permission ${p}`);
      granted.add(p);
    }
  }
  const orphans = all.filter((p) => !granted.has(p));
  assert.deepStrictEqual(orphans, [], 'every permission is held by some role');
  for (const perms of Object.values(ACTION_PERMISSIONS)) for (const p of perms) assert.ok(all.includes(p), `action needs unknown permission ${p}`);

  const admin = permissionsOf('PLATFORM_ADMIN');
  const businessPrefixes = ['tradecase.', 'documents.', 'compliance.', 'analytics.', 'customers360.', 'masterdata.', 'chat.', 'audit.'];
  assert.deepStrictEqual([...admin].filter((p) => businessPrefixes.some((x) => p.startsWith(x))), [], 'the administrator holds no business permission');
  assert.strictEqual(ROLE_DEFINITIONS.PLATFORM_ADMIN.dataScope, 'NONE');
  // The all-desks officer is one person by design (a deliberate choice, flagged in the registry); the desks' split does not apply to it.
  const consolidated = ROLE_IDS.filter((r) => ROLE_DEFINITIONS[r].consolidated);
  assert.deepStrictEqual(consolidated, ['POST_TRADE_OFFICER'], 'exactly one role is consolidated');
  const officer = permissionsOf('POST_TRADE_OFFICER');
  assert.ok(!ROLE_DEFINITIONS.POST_TRADE_OFFICER.assignable && ROLE_DEFINITIONS.POST_TRADE_OFFICER.dataScope === 'INSTITUTION', 'the all-desks role is a demonstration profile, not assignable through administration');
  assert.ok(!(officer.has('tradecase.view.own') || officer.has('tradecase.create') || [...officer].some((x) => x.startsWith('admin.') && x !== 'admin.rbac.view') || officer.has('system.health.view')), 'it holds nothing of the customer, the relationship manager or the administrator');
  for (const role of ['TRADE_MAKER', 'TRADE_CHECKER', 'COMPLIANCE_REVIEWER', 'CHIEF_COMPLIANCE_OFFICER', 'TBML_RISK_ANALYST', 'OPERATIONS_DESK', 'CREDIT_REVIEWER', 'SENIOR_APPROVER', 'LC_ISSUER', 'SETTLEMENT_OFFICER'] as const) {
    for (const x of permissionsOf(role)) assert.ok(officer.has(x), `the all-desks officer holds what ${role} holds (${x})`);
  }
  assert.ok(officer.has('tradecase.review.rm'), 'and the relationship review');
  for (const role of ROLE_IDS) {
    if (ROLE_DEFINITIONS[role].consolidated) continue;
    const p = permissionsOf(role);
    assert.ok(!(p.has('tradecase.approval.request') && p.has('tradecase.approval.decide')), `${role}: one role cannot both request and decide approval`);
    assert.ok(!(p.has('tradecase.approval.decide') && p.has('tradecase.issuance.record')), `${role}: approver and issuer are different roles`);
    assert.ok(!(p.has('tradecase.amendment.submit') && p.has('tradecase.amendment.approve')), `${role}: amendment maker and approver are different roles`);
    if (role !== 'PLATFORM_ADMIN') assert.ok(![...p].some((x) => x.startsWith('admin.') && x !== 'admin.rbac.view'), `${role} holds no identity-administration permission`);
  }
  const cco = permissionsOf('CHIEF_COMPLIANCE_OFFICER');
  assert.ok(!cco.has('tradecase.approval.decide') && !cco.has('tradecase.issuance.record') && !cco.has('tradecase.credit.record'), 'the CCO has no approval, issuance or credit authority');
  const customer = permissionsOf('CORPORATE_CUSTOMER');
  assert.ok(![...customer].some((p) => ['tradecase.findings.internal.view', 'tradecase.credit.view', 'tradecase.investigation.view', 'tradecase.audit.view', 'tradecase.rules.view'].includes(p)), 'customers hold no internal view');
  assert.ok(!ROLE_DEFINITIONS.INTEGRATION_GATEWAY.assignable && ![...permissionsOf('INTEGRATION_GATEWAY')].some((p) => p.startsWith('tradecase.')), 'the API key principal is narrow and not assignable to people');
  const auditor = permissionsOf('TRADE_AUDITOR');
  // An export is a read that leaves an audit entry (the evidence report); it changes nothing else.
  const writes = [...auditor].filter((p) => !/(\.view|\.read|\.download|\.export|overview|view\.all)$/.test(p) && !p.endsWith('.view.all'));
  assert.deepStrictEqual(writes, [], 'the auditor holds read permissions only');
  assert.strictEqual(permissionsOf('SUPER_ADMIN').size, 0, 'an unknown role has no permissions');
  assert.strictEqual(permissionsOf(null).size, 0);
  console.log(`✔ R1 Passed: ${ROLE_IDS.length} roles, ${all.length} permissions; administrator has no business authority; maker/checker/issuer split.\n`);

  // ------------------------------------------------------------------ R2 default deny
  type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: { requiredPermissions?: unknown } }> }; handle: unknown; name?: string; regexp?: RegExp };
  const unguarded: string[] = [];
  const routes: string[] = [];
  const walk = (router: Router, label: string, publicRoutes: string[]) => {
    for (const layer of (router as unknown as { stack: Layer[] }).stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          const id = `${method.toUpperCase()} ${label}${layer.route.path}`;
          routes.push(id);
          const guarded = layer.route.stack.some((l) => Array.isArray(l.handle.requiredPermissions));
          if (!guarded && !publicRoutes.includes(`${method.toUpperCase()} ${layer.route.path}`)) unguarded.push(id);
        }
      } else if (layer.name === 'router' && layer.handle !== authRouter) {
        const mount = layer.regexp?.source.replace(/^\^\\\//, '/').replace(/\\\/\?\(\?=\\\/\|\$\)$/i, '').replace(/\\\//g, '/') ?? '?';
        walk(layer.handle as Router, mount, []);
      }
    }
  };
  walk(apiRouter, '', ['GET /health', 'GET /config', 'GET /taxonomy']);
  walk(authRouter, '/auth', ['POST /login', 'GET /demo-accounts', 'POST /demo-login']);
  assert.deepStrictEqual(unguarded, [], 'every non-public route names a permission');
  const stack = (apiRouter as unknown as { stack: Layer[] }).stack;
  const authAt = stack.findIndex((l) => l.handle === authenticate);
  const authRouterAt = stack.findIndex((l) => l.handle === authRouter);
  assert.ok(authAt > 0, 'authenticate is mounted on the API router');
  stack.forEach((l, i) => {
    if (l.name === 'router' && l.handle !== authRouter) assert.ok(i > authAt, 'every business router is mounted after authenticate');
  });
  assert.ok(authRouterAt < authAt, 'sign-in sits before authenticate');
  console.log(`✔ R2 Passed: ${routes.length} routes inspected; all non-public routes carry a permission guard; authenticate precedes every business router.\n`);

  // ------------------------------------------------------------------ R3 HTTP matrix
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const tokenFor = (key: DemoAccountKey) => signBankingToken(account(key), 1);
  const call = async (path: string, token?: string, init: RequestInit = {}) => {
    const res = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, Loose> | null };
  };

  try {
    // A case for each customer so scoped reads have something to find.
    const own = (await svc.createCase({ ...account('corporate_customer'), tokenType: 'BEARER' }, { clientRequestId: 'RBAC-1', application: { amount: 1000, currency: 'USD' } })).tradeCase.caseId;
    const other = (await svc.createCase({ ...account('corporate_customer_2'), tokenType: 'BEARER' }, { clientRequestId: 'RBAC-2', application: { amount: 2000, currency: 'USD' } })).tradeCase.caseId;

    const probes: Array<{ path: string; anyOf: Permission[] }> = [
      { path: '/documents', anyOf: ['documents.read'] },
      { path: '/documents/compliance/sources', anyOf: ['compliance.sources.read'] },
      { path: '/documents/compliance/dual-db-status', anyOf: ['system.storage.status'] },
      { path: '/sanctions/lists', anyOf: ['compliance.sources.read'] },
      { path: '/customers', anyOf: ['customers360.read'] },
      { path: '/analytics', anyOf: ['analytics.read'] },
      { path: '/import/batches', anyOf: ['masterdata.read'] },
      { path: '/trade-cases', anyOf: ['tradecase.view.own', 'tradecase.view.assigned', 'tradecase.view.all'] },
      { path: '/trade-cases/rules', anyOf: ['tradecase.rules.view'] },
      { path: '/trade-cases/audit-overview', anyOf: ['audit.overview'] },
      { path: '/admin/users', anyOf: ['admin.users.view'] },
      { path: '/admin/rbac', anyOf: ['admin.rbac.view'] },
      { path: '/admin/system-health', anyOf: ['system.health.view'] },
      { path: '/workspace', anyOf: [] },
      { path: '/auth/me', anyOf: [] },
    ];
    const mismatches: string[] = [];
    let checks = 0;
    for (const key of DEMO_ACCOUNT_KEYS) {
      const role = account(key).role as RoleId;
      const token = tokenFor(key);
      for (const probe of probes) {
        const expected = probe.anyOf.length === 0 || probe.anyOf.some((p) => hasPermission({ role }, p)) ? 200 : 403;
        const { status } = await call(probe.path, token);
        checks++;
        if (status !== expected) mismatches.push(`${key} (${role}) GET ${probe.path}: expected ${expected}, got ${status}`);
      }
    }
    assert.deepStrictEqual(mismatches, [], 'HTTP outcome matches the registry for every role');

    // Independent, hand-written expectations: these do not consult the registry.
    const critical: Array<[DemoAccountKey, string, string, number]> = [
      ['system_admin', 'GET', '/documents', 403],
      ['system_admin', 'GET', '/trade-cases', 403],
      ['system_admin', 'GET', `/trade-cases/${own}`, 403],
      ['system_admin', 'GET', '/customers', 403],
      ['system_admin', 'GET', '/admin/users', 200],
      ['security_admin', 'GET', '/admin/users', 200],
      ['compliance_officer', 'GET', '/admin/users', 403],
      ['compliance_officer', 'GET', `/trade-cases/${own}`, 200],
      ['corporate_customer', 'GET', '/documents', 403],
      ['corporate_customer', 'GET', '/admin/rbac', 403],
      ['corporate_customer', 'GET', `/trade-cases/${own}`, 200],
      ['corporate_customer', 'GET', `/trade-cases/${other}`, 404],
      ['corporate_customer', 'GET', `/trade-cases/${own}/audit`, 403],
      ['corporate_customer_2', 'GET', `/trade-cases/${own}`, 404],
      ['relationship_manager', 'GET', `/trade-cases/${own}`, 200],
      ['relationship_manager', 'GET', `/trade-cases/${other}`, 404],
      ['relationship_manager', 'GET', '/documents', 403],
      ['trade_auditor', 'GET', '/trade-cases/audit-overview', 200],
      ['trade_auditor', 'GET', `/trade-cases/${own}/audit`, 200],
      ['trade_auditor', 'POST', '/trade-cases', 403],
      ['trade_auditor', 'POST', '/documents/delete-history', 403],
      ['trade_maker', 'GET', '/trade-cases/audit-overview', 403],
      ['trade_maker', 'POST', '/documents/delete-history', 403],
      ['settlement_officer', 'GET', '/documents', 403],
      ['lc_issuer', 'GET', '/analytics', 403],
      ['credit_reviewer', 'GET', '/sanctions/lists', 403],
    ];
    for (const [key, method, path, expected] of critical) {
      const { status } = await call(path, tokenFor(key), { method, ...(method === 'POST' ? { body: '{}' } : {}) });
      checks++;
      assert.strictEqual(status, expected, `${key} ${method} ${path}`);
    }
    // Direct-API bypass of workflow steps by roles that lack them.
    const bypass: Array<[DemoAccountKey, string]> = [
      ['corporate_customer', `/trade-cases/${own}/approval/decision`],
      ['corporate_customer', `/trade-cases/${own}/issuance`],
      ['corporate_customer', `/trade-cases/${own}/reviews/COMPLIANCE`],
      ['relationship_manager', `/trade-cases/${own}/reviews/COMPLIANCE`],
      ['trade_maker', `/trade-cases/${own}/approval/decision`],
      ['compliance_officer', `/trade-cases/${own}/issuance`],
      ['trade_auditor', `/trade-cases/${own}/reviews/TRADE_OPS`],
      ['system_admin', `/trade-cases/${own}/approval/decision`],
    ];
    for (const [key, path] of bypass) {
      const { status } = await call(path, tokenFor(key), { method: 'POST', body: JSON.stringify({ decision: 'APPROVE', rationale: 'Direct API call bypass attempt' }) });
      checks++;
      assert.strictEqual(status, 403, `${key} POST ${path} must be refused`);
    }
    assert.strictEqual((await call('/trade-cases', 'not-a-token')).status, 401, 'garbage token');
    assert.strictEqual((await call('/admin/users')).status, 401, 'no token');
    assert.strictEqual((await call('/no-such-route', tokenFor('trade_maker'))).status, 404, 'unknown route for a signed-in user');
    assert.strictEqual((await call('/no-such-route')).status, 401, 'unknown route reveals nothing to an anonymous caller');
    console.log(`✔ R3 Passed: ${checks} role × endpoint checks over HTTP; critical denials and direct-API bypasses refused.\n`);

    // ------------------------------------------------------------------ R4 administration
    const sysAdmin = tokenFor('system_admin');
    const secAdmin = tokenFor('security_admin');
    const created = await call('/admin/users', sysAdmin, { method: 'POST', body: JSON.stringify({ email: 'new.officer@tradeguard.ai', name: 'New Officer', institution: 'Trade Operations' }) });
    assert.strictEqual(created.status, 201);
    const newId = created.body!['account']['id'] as string;
    const tempPassword = created.body!['temporaryPassword'] as string;
    assert.strictEqual(created.body!['account']['role'], null, 'a new account starts with no role');
    const login = (password: string) => call('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email: 'new.officer@tradeguard.ai', password }) });
    assert.strictEqual((await login(tempPassword)).status, 401, 'an account without a role cannot sign in');
    assert.strictEqual((await call('/admin/users', tokenFor('compliance_officer'), { method: 'POST', body: JSON.stringify({ email: 'x@tradeguard.ai', name: 'X Y' }) })).status, 403, 'business roles cannot create accounts');

    const ask = (token: string, body: Record<string, unknown>) => call('/admin/access-requests', token, { method: 'POST', body: JSON.stringify(body) });
    const decide = (token: string, id: string, approve: boolean) => call(`/admin/access-requests/${id}/decision`, token, { method: 'POST', body: JSON.stringify({ approve, rationale: 'Verified against the HR joiner ticket.' }) });
    assert.strictEqual((await ask(sysAdmin, { targetUserId: newId, role: 'INTEGRATION_GATEWAY', reason: 'Give the new officer API rights' })).status, 400, 'machine role not assignable');
    assert.strictEqual((await ask(sysAdmin, { targetUserId: newId, role: 'SUPER_ADMIN', reason: 'Give the new officer every right' })).status, 400, 'unknown role refused');
    assert.strictEqual((await ask(sysAdmin, { targetUserId: account('system_admin').id, role: 'CHIEF_COMPLIANCE_OFFICER', reason: 'Promote myself to compliance' })).status, 403, 'no change to one\'s own access');
    assert.strictEqual((await ask(sysAdmin, { targetUserId: account('trade_maker').id, role: 'SENIOR_APPROVER', reason: 'Configured accounts change in configuration' })).status, 400, 'demo/config accounts are not changed through the API');
    const req1 = await ask(sysAdmin, { targetUserId: newId, role: 'TRADE_MAKER', reason: 'Joiner: Import LC desk, ticket HR-2041' });
    assert.strictEqual(req1.status, 201);
    const req1Id = req1.body!['request']['requestId'] as string;
    assert.strictEqual((await decide(sysAdmin, req1Id, true)).status, 403, 'dual control: the requester cannot approve');
    assert.strictEqual((await decide(tokenFor('compliance_officer'), req1Id, true)).status, 403, 'a business role cannot approve access');
    assert.strictEqual((await decide(secAdmin, req1Id, true)).status, 200, 'a second administrator approves');
    assert.strictEqual((await decide(secAdmin, req1Id, true)).status, 409, 'a decided request cannot be decided again');

    let session = await login(tempPassword);
    assert.strictEqual(session.status, 200);
    let newToken = session.body!['token'] as string;
    assert.strictEqual(session.body!['user']['role'], 'TRADE_MAKER');
    assert.ok((session.body!['user']['permissions'] as string[]).includes('tradecase.approval.request'), 'the session carries the permission list for the portal');
    assert.strictEqual((await call('/trade-cases', newToken)).status, 200);
    assert.strictEqual((await call('/admin/access-requests', newToken, { method: 'POST', body: JSON.stringify({ targetUserId: newId, role: 'SENIOR_APPROVER', reason: 'Escalate my own rights please' }) })).status, 403, 'a maker cannot request access changes');

    // Role change: the old token stops working at once.
    const req2 = await ask(sysAdmin, { targetUserId: newId, role: 'TRADE_CHECKER', reason: 'Moved to the checker desk, ticket HR-2077' });
    await decide(secAdmin, req2.body!['request']['requestId'] as string, true);
    const afterChange = await call('/trade-cases', newToken);
    assert.strictEqual(afterChange.status, 401, 'old session refused after a role change');
    assert.strictEqual(afterChange.body?.['error']?.['code'] ?? afterChange.body?.['code'], 'SESSION_REVOKED');
    session = await login(tempPassword);
    newToken = session.body!['token'] as string;
    assert.strictEqual(session.body!['user']['role'], 'TRADE_CHECKER');

    // Revocation and disabling.
    assert.strictEqual((await call(`/admin/users/${newId}/revoke-sessions`, secAdmin, { method: 'POST', body: JSON.stringify({ reason: 'Laptop reported lost by the officer' }) })).status, 200);
    assert.strictEqual((await call('/trade-cases', newToken)).status, 401, 'revoked session refused');
    newToken = (await login(tempPassword)).body!['token'] as string;
    assert.strictEqual((await call(`/admin/users/${account('system_admin').id}/status`, sysAdmin, { method: 'POST', body: JSON.stringify({ status: 'DISABLED', reason: 'Disabling my own account' }) })).status, 403, 'no change to one\'s own status');
    assert.strictEqual((await call(`/admin/users/${newId}/status`, secAdmin, { method: 'POST', body: JSON.stringify({ status: 'DISABLED', reason: 'Leaver: last day was yesterday' }) })).status, 200);
    assert.strictEqual((await call('/trade-cases', newToken)).status, 401, 'disabled account refused');
    assert.strictEqual((await login(tempPassword)).status, 401, 'disabled account cannot sign in');

    const audit = await call('/admin/identity-audit', secAdmin);
    assert.strictEqual(audit.body!['chain']['valid'], true, 'identity log chain verifies');
    const actions = (audit.body!['events'] as Array<{ action: string }>).map((e) => e.action);
    for (const a of ['ACCOUNT_CREATED', 'ACCESS_CHANGE_REQUESTED', 'ACCESS_CHANGE_APPROVED', 'SESSIONS_REVOKED', 'ACCOUNT_DISABLED']) assert.ok(actions.includes(a), `identity log records ${a}`);
    assert.ok(!JSON.stringify(audit.body).includes(tempPassword), 'the identity log never contains a password');
    const health = await call('/admin/system-health', sysAdmin);
    assert.ok(health.body!['accessDenials']['total'] > 0, 'denied attempts are counted for the administrator');
    assert.ok(getAccount(newId)!.sessionVersion >= 4, 'each access change bumped the session version');
    console.log('✔ R4 Passed: dual-controlled role changes, no self-service, role change / revocation / disabling end sessions immediately; identity log chained.\n');

    // ------------------------------------------------------------------ R5 workspaces
    await svc.submit({ ...account('corporate_customer'), tokenType: 'BEARER' }, own);
    const portal = async (key: DemoAccountKey) => (await call('/workspace', tokenFor(key))).body!;
    for (const key of DEMO_ACCOUNT_KEYS) {
      const body = await portal(key);
      const role = account(key).role;
      assert.deepStrictEqual(body['sections'].map((s: { id: string }) => s.id), sectionsFor({ role }).map((s) => s.id), `${key} sections`);
      assert.deepStrictEqual(body['permissions'], [...permissionsOf(role)].sort(), `${key} permissions`);
    }
    const ids = async (key: DemoAccountKey) => (await portal(key))['sections'].map((s: { id: string }) => s.id) as string[];
    assert.deepStrictEqual(await ids('system_admin'), ['workspace', 'admin'], 'the administrator portal is administration only');
    assert.ok(!(await ids('corporate_customer')).some((s) => ['documents', 'analytics', 'customers', 'sources', 'import', 'audit', 'admin'].includes(s)), 'customer portal has no bank screens');
    assert.ok((await ids('trade_auditor')).includes('audit') && !(await ids('trade_auditor')).includes('new-case'), 'auditor portal reads, never files');
    const queueIds = async (key: DemoAccountKey) => ((await portal(key))['queues'] as Array<{ id: string; items: Array<{ caseId: string }> }>);
    const checkerQueues = await queueIds('trade_checker');
    assert.ok(checkerQueues.find((q) => q.id === 'review-trade-ops')?.items.some((i) => i.caseId === own), 'the submitted case waits in the checker\'s Trade Ops queue');
    const rmQueues = await queueIds('relationship_manager');
    assert.ok(rmQueues.find((q) => q.id === 'review-rm')?.items.some((i) => i.caseId === own), 'and in the RM review queue of its assigned RM');
    assert.ok(!(await queueIds('corporate_customer_2')).some((q) => q.items.some((i) => i.caseId === own)), 'never in another customer\'s portal');
    assert.ok(!(await queueIds('trade_auditor')).length, 'the auditor has no work queues');
    assert.ok(!(await queueIds('system_admin')).length, 'the administrator has no case queues');
    console.log('✔ R5 Passed: every portal lists exactly its permitted screens; queues follow the actions the server would accept.\n');

    // ------------------------------------------------------------------ R6 data scope
    const list = async (key: DemoAccountKey) => ((await call('/trade-cases', tokenFor(key))).body!['items'] as Array<{ caseId: string; customerRef: string }>);
    assert.deepStrictEqual((await list('corporate_customer')).map((c) => c.customerRef).filter((r) => r !== 'TG-CORP-1001'), [], 'customer list holds only its own cases');
    assert.deepStrictEqual((await list('corporate_customer_2')).map((c) => c.caseId), [other]);
    assert.ok((await list('relationship_manager')).every((c) => c.customerRef === 'TG-CORP-1001'), 'RM list holds only assigned customers');
    assert.ok((await list('trade_maker')).some((c) => c.caseId === other), 'institution-scoped staff see all customers');
    const rmCreate = await call('/trade-cases', tokenFor('relationship_manager'), { method: 'POST', body: JSON.stringify({ customerRef: 'TG-CORP-2002', application: {} }) });
    assert.strictEqual(rmCreate.status, 403, 'an RM cannot file for an unassigned customer');
    const spoof = await call('/trade-cases', tokenFor('corporate_customer'), { method: 'POST', body: JSON.stringify({ customerRef: 'TG-CORP-2002', clientRequestId: 'RBAC-SPOOF', application: {} }) });
    assert.strictEqual(spoof.body!['customerRef'], 'TG-CORP-1001', 'a customer cannot file under another customer\'s reference');
    console.log('✔ R6 Passed: own-customer and assigned-customer scopes hold for reads, lists and creation.\n');
  } finally {
    server.close();
  }

  console.log('================================================================');
  console.log('ALL RBAC AND PORTAL SCENARIOS PASSED');
  console.log('================================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('RBAC TEST FAILED:', err);
  process.exit(1);
});
