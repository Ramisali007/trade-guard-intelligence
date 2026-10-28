# Role and permission matrix — expected vs observed (2026-10-27)

The authoritative, generated permission table is [../RBAC_PERMISSION_MATRIX.md](../RBAC_PERMISSION_MATRIX.md) (16 roles, 77 permissions, produced from `backend/src/authorization/permissions.ts`). This report does not repeat it; it records what was **observed** when the running system was exercised as each role, and compares it with that registry.

## Role model found in the repository

16 roles: Corporate Customer, Relationship Manager, Trade Maker, Trade Checker, Operations Desk, Credit Reviewer, Compliance Reviewer, TBML Risk Analyst, Chief Compliance Officer, Senior Approver, LC Issuer, Settlement Officer, Trade Auditor, Trade Operations Officer (all desks, `POST_TRADE_OFFICER`, not assignable), System Administrator, Integration Gateway (machine, `X-API-Key`). The role list in the brief ("policy owner", "pre-/post-shipment officer") does not map one-to-one: the pre-shipment officer is the **Trade Maker**, the post-shipment officer is the **Trade Operations Officer (all desks)**, and the policy owner is a verification-governance permission, not a role.

Default deny: an unknown role has no permissions (`permissionsOf('SUPER_ADMIN').size === 0`, test R1) and an account without a role cannot sign in.

## Observed — screens (real browser, direct URL navigation)

Each of 15 roles (the ones the demo sign-in lists; the Integration Gateway has no UI) opened each of 27 route variants in a fresh page with a valid session injected. **459 of 459 loads ended where the route's `anyOf` rule says they should** (✔ opens, ⛔ redirected to `/access-denied`). Expected outcomes were computed from the permissions the server returned for that session, not hard-coded.

| Route | CCO | TBML | AUD | CUST | RM | MAKER | ALL | CHECK | OPS | CRED | COMP | APPR | ISSUE | SETL | ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `/` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `/dashboard` | ✔ | ✔ | ✔ | ⛔ | ⛔ | ✔ | ✔ | ✔ | ✔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `/analytics` | ✔ | ✔ | ✔ | ⛔ | ⛔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `/processing/doc-x` | ✔ | ✔ | ✔ | ⛔ | ⛔ | ✔ | ✔ | ✔ | ✔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `/analysis/doc-x` | ✔ | ✔ | ✔ | ⛔ | ⛔ | ✔ | ✔ | ✔ | ✔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `/compare` | ✔ | ✔ | ✔ | ⛔ | ⛔ | ✔ | ✔ | ✔ | ✔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `/auditor` | ✔ | ✔ | ✔ | ⛔ | ⛔ | ✔ | ✔ | ✔ | ✔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `/sources` | ✔ | ✔ | ✔ | ⛔ | ⛔ | ✔ | ✔ | ✔ | ✔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `/customers` | ✔ | ✔ | ✔ | ⛔ | ⛔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `/import` | ✔ | ✔ | ✔ | ⛔ | ⛔ | ✔ | ✔ | ✔ | ✔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `/verification` | ✔ | ✔ | ✔ | ⛔ | ⛔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ⛔ |
| `/trade-cases` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ⛔ |
| `/trade-cases/new` | ⛔ | ⛔ | ⛔ | ✔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `/post-shipment` | ⛔ | ⛔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `/post-shipment/TC-2026-00001` | ⛔ | ⛔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `/trade-cases/TC-2026-00001/post-shipment` | ✔ | ✔ | ✔ | ⛔ | ⛔ | ✔ | ✔ | ⛔ | ⛔ | ⛔ | ✔ | ✔ | ⛔ | ⛔ | ⛔ |
| `/trade-cases/TC-2026-00001/scrutiny` | ✔ | ✔ | ✔ | ⛔ | ⛔ | ✔ | ✔ | ✔ | ✔ | ⛔ | ✔ | ✔ | ⛔ | ⛔ | ⛔ |
| `/trade-cases/TC-2026-00001` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ⛔ |
| `/trade-cases/TC-2026-00002` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ⛔ |
| `/trade-cases/TC-9999-99999` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ⛔ |
| `/workspace` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `/audit` | ✔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `/admin` | ⛔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ✔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ✔ |
| `/access-denied` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `/blog/1` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `/blogs/1` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `/no/such/page` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

What this proves and does not: it proves the screens a role reaches match the route guards and the permission list the server issues to that role (the UI cannot drift from the registry). It does not judge whether the registry is the correct banking policy (for example, that the Trade Auditor may open `/admin` because it holds `admin.rbac.view`); that is a policy decision for the bank and is listed in the deployment readiness report.

Notes: `/trade-cases/TC-9999-99999` (missing) and `/trade-cases/TC-2026-00002` opened by the *other* customer show the same message, "That trade case could not be found"; `/blogs/1` redirects to `/blog/1`; an unknown path redirects to `/`. ↪ marks none in this run.

## Observed — API

| Check | Method | Result |
|---|---|---|
| Anonymous on every non-public route | `route-role-probe` P1 | 140 routes → 401, 0 exceptions |
| Role lacking *every* permission a route names | P2 | 1,102 (role, route) pairs → 403, 0 exceptions |
| Hostile input as every role (garbage/traversal ids, bad/oversized JSON, `__proto__`) | P3 | 9,996 calls, 0 × 5xx, 0 hangs, no route exempted (in the first run `sync-all` timed out because it waited on the internet; fixed, AUDIT-008) |
| Role × endpoint over HTTP, critical denials and direct-API bypasses | `rbac-portals` R3 | 289 checks pass |
| Dual-controlled role changes; role change/disable/revoke ends the session at once | R4 | pass |
| Own-customer and assigned-customer scopes for reads, lists, creation | R6 | pass |
| Other customer: read, download, upload, delete, submit, start post-shipment on a case that is not theirs | `doc-security` D3 | all **404** (the case reads as missing, no existence leak) |
| Customer on staff APIs (`/documents`, case audit chain, rule registry, self-approval) | D3 | **403** |
| Client cannot set status or reference by posting them in the application body | D14 | refused (400), status unchanged |
| Tampered role claim in a token; `alg: none` | D11 | 401 |
| Token after sign-out | D10 | 401 |
| Blocking finding cannot be bypassed by a direct decision request | `post-shipment-http` P5 | 409 |
| Only the owning customer starts an application; staff and the administrator cannot | P2 | pass |

## Findings

- No instance of privilege escalation, cross-customer exposure, hidden-button-only enforcement, or an IDOR was found. The browser run and the API run agree: the UI hides what the API refuses, and the API refuses without the UI.
- Not tested: role change taking effect on an *open browser tab* (covered at API level by R4 only), and the Integration Gateway's X-API-Key path beyond the existing `security.test.ts` scenario 4.
