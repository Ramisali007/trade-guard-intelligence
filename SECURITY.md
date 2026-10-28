# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately to the maintainers (the address on the
repository profile) with the steps to reproduce, and allow a reasonable time to fix it before disclosing.

## What the platform defends against

The controls are listed in the README ("Bank-Grade Security & Hardening Architecture") and were verified by
`backend/src/__tests__/security.test.ts`, `rbac-portals.test.ts` and `hardening.test.ts`. In short: default-deny
permissions on every route, live session revocation, sign-out that revokes the token, per-account lockout, scrypt
hashing, an SSRF guard on the address the socket really connects to, four-eyes control on reference data, constrained
human overrides, hostile-file limits, and keyed audit chains.

## What it does not do (read before a production decision)

- **No SSO or MFA.** Accounts are local. Put the application behind your identity provider's reverse proxy if you need them.
- **Session tokens live in the browser's local storage** (with a 15-minute idle sign-out and server-side revocation). A
  cross-site-scripting flaw would expose them. The application sanitises everything it renders and ships a strict
  Content-Security-Policy in `deploy/nginx.conf`; deploy with that policy.
- **Document reading runs inside the API process.** Limits (page count, archive expansion, wall-clock time) keep a
  hostile file from monopolising it, but they are not process isolation. Run the API with a memory limit and a restart policy.
- **One API instance.** The job queue, rate limiter, fraud history and file stores are in-process.
- **Standalone MongoDB has no transactions**: a case change and its audit entry are two writes. A failure between them is
  reported and detected by the chain check, not rolled back. Use a replica set for a pilot that needs more.
- **Regulatory content is not signed off.** Rules are marked `PENDING_BANK_SIGN_OFF` until compliance approves them.
- **Document text may leave the machine** when an AI provider is configured (`AI_PROVIDER` other than `heuristic`).
  Decide whether that is acceptable for the data you process; with `heuristic` nothing is sent.

## Known, accepted dependency advisories

- `mammoth` -> `argparse` -> `sprintf-js` (moderate, denial of service through unbounded precision specifiers): reachable only
  through a command-line parser that this application never calls with input.
- Frontend development tooling only (`@angular/cli`'s MCP server, `braces`, `vite` dev server): not part of the shipped bundle.
  `npm audit --omit=dev` is clean for the frontend and CI fails the build on a high advisory in production dependencies.
