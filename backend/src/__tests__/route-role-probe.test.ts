import './test-env';
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import type { Router } from 'express';
import { createApp } from '../app';
import { apiRouter } from '../routes';
import { authRouter } from '../routes/auth.routes';
import { ComplianceStore } from '../compliance/db/compliance-store';
import { signBankingToken } from '../middleware/auth.middleware';
import { permissionsOf } from '../authorization/permissions';
import { DEMO_ACCOUNT_KEYS, findDemoAccount, initAccountDirectory, type DemoAccountKey } from '../services/account-directory';
import { CustomerRepository } from '../services/customer.repository';
import { initRepository } from '../services/document.repository';
import { initTradeCaseRepository } from '../trade-cases/trade-case.repository';

/**
 * Dynamic route x role probe. rbac-portals.test.ts proves statically that every route names a permission; this suite
 * calls every registered route over HTTP and checks what actually comes back:
 *   - an anonymous caller is refused (401) everywhere except the declared public routes;
 *   - a signed-in role that lacks every permission a route names is refused (403) before any handler runs;
 *   - no route answers 5xx to a garbage id, an empty body or an oversized field, whoever calls it;
 *   - a wrong HTTP method on a known path is never served by an unrelated handler.
 * Synthetic accounts, in-memory stores, no network. Mutating routes are called with invalid input only.
 */

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: { requiredPermissions?: readonly string[] } }> };
  handle: unknown;
  name?: string;
  regexp?: RegExp;
};
type RouteInfo = { method: string; path: string; permissions: readonly string[] | null };

const PUBLIC = new Set(['GET /api/health', 'GET /api/config', 'GET /api/taxonomy', 'POST /api/auth/login', 'GET /api/auth/demo-accounts', 'POST /api/auth/demo-login']);
// Routes that end the caller's own session or write nothing for the probe: skipped for the 5xx pass only.
const SKIP_FUZZ = new Set(['POST /api/auth/logout']);

function collect(): RouteInfo[] {
  const out: RouteInfo[] = [];
  const walk = (router: Router, prefix: string) => {
    for (const layer of (router as unknown as { stack: Layer[] }).stack) {
      if (layer.route) {
        const perms = layer.route.stack.map((l) => l.handle.requiredPermissions).find((p) => Array.isArray(p)) ?? null;
        for (const method of Object.keys(layer.route.methods)) out.push({ method: method.toUpperCase(), path: prefix + layer.route.path, permissions: perms as readonly string[] | null });
      } else if (layer.name === 'router') {
        const mount = layer.regexp?.source.replace(/^\^\\\//, '/').replace(/\\\/\?\(\?=\\\/\|\$\)$/i, '').replace(/\\\//g, '/') ?? '?';
        if (layer.handle === authRouter) continue;
        walk(layer.handle as Router, prefix + mount);
      }
    }
  };
  walk(apiRouter, '/api');
  const authLayer = (authRouter as unknown as { stack: Layer[] }).stack;
  for (const layer of authLayer) {
    if (!layer.route) continue;
    const perms = layer.route.stack.map((l) => l.handle.requiredPermissions).find((p) => Array.isArray(p)) ?? null;
    for (const method of Object.keys(layer.route.methods)) out.push({ method: method.toUpperCase(), path: `/api/auth${layer.route.path}`, permissions: perms as readonly string[] | null });
  }
  return out;
}

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('Route x role probe: anonymous, forbidden and hostile input on every route');
  console.log('================================================================\n');
  await initRepository();
  await CustomerRepository.getInstance().init();
  await ComplianceStore.getInstance().init();
  await initTradeCaseRepository();
  await initAccountDirectory();

  const routes = collect();
  assert.ok(routes.length > 100, `route introspection found the API (${routes.length})`);
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const keys = [...DEMO_ACCOUNT_KEYS] as DemoAccountKey[];
  const accounts = keys.map((k) => ({ key: k, profile: findDemoAccount(k)! })).filter((a) => a.profile);
  const tokens = new Map(accounts.map((a) => [a.key, signBankingToken(a.profile, 1)]));
  const fill = (path: string, id: string) => path.replace(/:[A-Za-z]+/g, id);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let throttled = 0;
  // A 429 means no handler ran, so it proves nothing: wait out the window and ask again until a handler answers.
  const call = async (r: RouteInfo, token: string | null, id: string, body: string | undefined): Promise<number> => {
    const init: RequestInit = { method: r.method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) } };
    if (body !== undefined && r.method !== 'GET' && r.method !== 'DELETE') init.body = body;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const res = await fetch(base + fill(r.path, id), { ...init, signal: AbortSignal.timeout(20_000) });
        await res.arrayBuffer().catch(() => null);
        if (res.status !== 429 || r.path.startsWith('/api/auth/')) return res.status;
        throttled++;
        await sleep(Math.min(61_000, Math.max(1, Number(res.headers.get('retry-after') ?? 5)) * 1000));
      } catch (e) {
        return e instanceof Error && e.name === 'TimeoutError' ? -2 : -1;
      }
    }
    return 429;
  };

  const problems: string[] = [];
  let calls = 0;

  // ------------------------------------------------------------------ anonymous
  for (const r of routes) {
    const id = `${r.method} ${r.path}`;
    if (PUBLIC.has(id) || r.path === '/api/auth/me' || r.path === '/api/auth/logout') continue;
    const s = await call(r, null, 'x', '{}');
    calls++;
    if (s !== 401) problems.push(`anonymous ${id} -> ${s} (expected 401)`);
  }
  console.log(`✔ P1 anonymous caller: ${calls} routes called without a token; failures: ${problems.length}`);

  // ------------------------------------------------------------------ forbidden roles
  let forbiddenChecks = 0;
  for (const a of accounts) {
    const held = permissionsOf(a.profile.role);
    for (const r of routes) {
      if (!r.permissions || r.permissions.length === 0) continue;
      if (r.permissions.some((p) => held.has(p as never))) continue;
      const s = await call(r, tokens.get(a.key)!, 'x', '{}');
      forbiddenChecks++;
      if (s !== 403) problems.push(`${a.profile.role} lacks [${r.permissions.join('|')}] but ${r.method} ${r.path} -> ${s} (expected 403)`);
    }
  }
  console.log(`✔ P2 forbidden roles: ${forbiddenChecks} (role, route) pairs without the permission; failures so far: ${problems.length}`);

  // ------------------------------------------------------------------ hostile input as every role
  const hostile: Array<[string, string | undefined]> = [
    ['not-a-real-id', '{}'],
    ['..%2f..%2fetc%2fpasswd', '{}'],
    ['%00', '{"x":'],
    ['x'.repeat(3000), JSON.stringify({ a: 'y'.repeat(50_000), __proto__: { admin: true }, constructor: { prototype: { admin: true } } })],
  ];
  let fuzz = 0;
  for (const a of accounts) {
    for (const r of routes) {
      const id = `${r.method} ${r.path}`;
      if (SKIP_FUZZ.has(id) || id === 'POST /api/auth/demo-login') continue;
      for (const [seg, body] of hostile) {
        const s = await call(r, tokens.get(a.key)!, seg, body);
        fuzz++;
        // sync-all runs a feed synchronisation inside the request (slow by design); a timeout there is not a crash.
        if (s === -2 && /\/sources\/sync/.test(r.path)) continue;
        if (s >= 500 || s < 0) problems.push(`${a.profile.role} ${id} with id "${seg.slice(0, 20)}" -> ${s}`);
      }
    }
  }
  console.log(`✔ P3 hostile input: ${fuzz} calls across ${accounts.length} roles (${throttled} waited out a 429); 5xx, hung or dropped so far: ${problems.length}`);

  // ------------------------------------------------------------------ method confusion
  for (const r of routes.filter((x) => x.path.startsWith('/api/trade-cases') || x.path.startsWith('/api/documents'))) {
    const other = r.method === 'GET' ? 'PATCH' : 'GET';
    if (routes.some((x) => x.path === r.path && x.method === other)) continue;
    const res = await fetch(base + fill(r.path, 'x'), { method: other, headers: { authorization: `Bearer ${tokens.get('platform_admin' as DemoAccountKey) ?? [...tokens.values()][0]}` } });
    await res.arrayBuffer().catch(() => null);
    if (res.status === 200 || res.status >= 500) problems.push(`${other} ${r.path} (no such route) -> ${res.status}`);
  }
  console.log(`✔ P4 method confusion checked; total problems: ${problems.length}`);

  server.close();
  if (problems.length) {
    console.error(`\n✘ ${problems.length} problem(s):`);
    for (const p of problems.slice(0, 60)) console.error('  - ' + p);
    process.exit(1);
  }
  console.log(`\n✔ ${routes.length} routes x ${accounts.length} roles verified (${calls + forbiddenChecks + fuzz} calls).`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
