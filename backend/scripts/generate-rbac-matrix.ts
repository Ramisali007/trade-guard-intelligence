import fs from 'node:fs';
import path from 'node:path';
import { PERMISSIONS, ROLE_DEFINITIONS, ROLE_IDS, type Permission } from '../src/authorization/permissions';
import { WORKSPACE_SECTIONS, WORK_QUEUES } from '../src/authorization/workspaces';
import { ACTION_PERMISSIONS, DEFAULT_POLICY } from '../src/trade-cases/workflow.policy';

/**
 * Writes docs/RBAC_PERMISSION_MATRIX.md from the registry the server enforces.
 * Run after changing a role or permission: `npx tsx scripts/generate-rbac-matrix.ts`.
 */
const out = path.resolve(__dirname, '../../docs/RBAC_PERMISSION_MATRIX.md');
const short: Record<string, string> = {
  CORPORATE_CUSTOMER: 'CUST',
  RELATIONSHIP_MANAGER: 'RM',
  TRADE_MAKER: 'MAKER',
  TRADE_CHECKER: 'CHECK',
  OPERATIONS_DESK: 'OPS',
  CREDIT_REVIEWER: 'CRED',
  COMPLIANCE_REVIEWER: 'COMP',
  TBML_RISK_ANALYST: 'TBML',
  CHIEF_COMPLIANCE_OFFICER: 'CCO',
  SENIOR_APPROVER: 'APPR',
  LC_ISSUER: 'ISSUE',
  SETTLEMENT_OFFICER: 'SETL',
  TRADE_AUDITOR: 'AUD',
  POST_TRADE_OFFICER: 'ALL',
  PLATFORM_ADMIN: 'ADMIN',
  INTEGRATION_GATEWAY: 'API',
};

const lines: string[] = [];
lines.push('# RBAC permission matrix');
lines.push('');
lines.push('> Generated from `backend/src/authorization/permissions.ts` by `backend/scripts/generate-rbac-matrix.ts`. Do not edit by hand: change the registry and regenerate. The server enforces exactly this table; the frontend reads the same list from `/api/auth/me`.');
lines.push('');
lines.push('## Principles');
lines.push('');
lines.push('- **Default deny.** A role has only the permissions listed. An unknown role has none; an account without a role cannot sign in. Every API route names the permission it needs (`requirePermission`), and a test fails if one does not.');
lines.push('- **Three layers on every trade-case action:** the route permission, then in the service the exact action permission, the case\'s data scope (own customer / assigned customers / institution), the workflow state, and separation of duties.');
lines.push('- **Out-of-scope cases read as missing (404)**, so a customer or RM cannot learn that another customer\'s case exists. A role with no case access at all gets 403 for any id.');
lines.push('- **Field-level redaction** is decided on the server (`toView`): compliance/TBML findings, credit facility details, investigations and compliance review notes are replaced by a "restricted" placeholder unless the viewer holds the matching `*.view` permission. Customers never see that such items exist (tipping-off).');
lines.push('- **Administration is not business authority.** The System Administrator manages accounts and platform health and holds no trade-case, document, compliance or audit permission. Role changes are requests that a *different* administrator approves; nobody changes their own access.');
lines.push('- **Session safety.** Every request re-reads the account: a disabled account, revoked sessions or a changed role invalidate outstanding tokens immediately (401 `SESSION_REVOKED`).');
lines.push('');
lines.push('## Roles');
lines.push('');
lines.push('| Code | Role | Data scope | Assignable | Description |');
lines.push('|---|---|---|---|---|');
for (const id of ROLE_IDS) {
  const r = ROLE_DEFINITIONS[id];
  lines.push(`| ${short[id]} | ${r.displayName} (\`${id}\`) | ${r.dataScope} | ${r.assignable ? 'yes' : 'no (machine)'} | ${r.description} |`);
}
lines.push('');
lines.push('## Permissions by role');
lines.push('');
lines.push(`| Permission | ${ROLE_IDS.map((id) => short[id]).join(' | ')} |`);
lines.push(`|---|${ROLE_IDS.map(() => ':-:').join('|')}|`);
for (const p of Object.keys(PERMISSIONS) as Permission[]) {
  const cells = ROLE_IDS.map((id) => (ROLE_DEFINITIONS[id].permissions.includes(p) ? '●' : ''));
  lines.push(`| \`${p}\` — ${PERMISSIONS[p]} | ${cells.join(' | ')} |`);
}
lines.push('');
lines.push('## Trade-case actions');
lines.push('');
lines.push('Each action needs one of the listed permissions *and* passes the scope, state and separation-of-duties checks in the service.');
lines.push('');
lines.push('| Action | Permission(s) |');
lines.push('|---|---|');
for (const [action, perms] of Object.entries(ACTION_PERMISSIONS)) lines.push(`| ${action} | ${perms.map((p) => `\`${p}\``).join(', ')} |`);
lines.push('');
lines.push('## Separation of duties (record level)');
lines.push('');
lines.push('Enforced on the case record, independently of roles: a person who holds two permissions still cannot use both on the same case where these apply.');
lines.push('');
for (const [rule, on] of Object.entries(DEFAULT_POLICY.separationOfDuties)) lines.push(`- \`${rule}\`: ${on ? 'enforced' : 'off'}`);
lines.push('');
lines.push('## Portals');
lines.push('');
lines.push('Screens (`/api/workspace` → `sections`) and work queues are derived from permissions, never from role names.');
lines.push('');
lines.push(`| Screen | Route | ${ROLE_IDS.map((id) => short[id]).join(' | ')} |`);
lines.push(`|---|---|${ROLE_IDS.map(() => ':-:').join('|')}|`);
for (const s of WORKSPACE_SECTIONS) {
  const cells = ROLE_IDS.map((id) => (s.anyOf.length === 0 || s.anyOf.some((p) => ROLE_DEFINITIONS[id].permissions.includes(p)) ? '●' : ''));
  lines.push(`| ${s.title} | \`${s.route}\` | ${cells.join(' | ')} |`);
}
lines.push('');
lines.push('Work queues list the cases on which the user can take one of these next actions now:');
lines.push('');
for (const q of WORK_QUEUES) lines.push(`- **${q.title}** — ${q.actions.join(', ')}`);
lines.push('- **Open queries for your desk / Questions from the bank** — open queries addressed to the user\'s department, or to the customer');
lines.push('');
fs.writeFileSync(out, lines.join('\n'));
console.log(`wrote ${out}`);
