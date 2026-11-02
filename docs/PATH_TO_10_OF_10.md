# Path to 10/10

**Date:** 2026-10-28 · **Branch:** `audit/tbml-production-hardening`

Everything that engineering alone can do is done and verified (section 1). What is left needs a decision, a license, a
person or an environment that only the owner has (section 2). Each item says who has to act, the steps, and how you will
know it is finished.

## 1. Done and verified by engineering

| Area | Result | Evidence |
|---|---|---|
| Build | Backend and frontend compile and build clean | `npm run typecheck`, `npm run build` (both), `ng build` |
| Lint | 0 errors, 0 warnings. Dynamic-data boundaries use one named type, `Loose` (`backend/src/utils/loose-json.ts`) | `npm run lint` |
| Tests | 23 backend suites in `npm test` (25 with the route probe and the live MongoDB suite), 89 frontend tests | `npm test`, `ng test` |
| Access control | 156 routes x 17 roles, 11,736 calls, no problem | `npm run test:probe` |
| Dependencies | 0 known vulnerabilities, backend and frontend | `npm audit` |
| Persistence | Case change and audit entry are **one transaction** on a replica set; on a standalone server they stay two writes and a gap is reported and detected | `npm run test:mongo` against a standalone server (9/9) and a real replica set (9/9, scenario M7) |
| Deployment | `docker-compose.yml` runs MongoDB as a one-node replica set and requires `AUDIT_HMAC_KEY` | built and started with Docker, section 3 |
| Accessibility | axe-core WCAG 2 A/AA, all rules, real Chrome, every role: 0 violations in light theme (color contrast fixed 2026-10-29, section 2.6). Menu, upload area and search work from the keyboard | `tools/a11y` |
| Config | `.env.example` lists every setting the code reads; settings nothing read were removed | grep of `process.env` and the config helpers |
| Accuracy tooling | `npm run measure:extraction` scores the model against labeled documents and fails below a bar | section 2.1 |
| Load | Server and rate limiter behave: about 3,400 health checks/s, 2-4 ms median on the list and analytics endpoints, no errors. **The store was nearly empty**, so this says nothing about scale | autocannon against the in-memory backend |

## 2. What is left, and how to close it

### 2.1 Accuracy on real documents (you and a trade-operations expert)

Why it matters: every test uses synthetic documents. The 72/72 score on clean synthetic PDFs was measured on the same
set the prompts were tuned on. Real scans, stamps, odd layouts and other languages are untested.

1. Collect 50-100 real documents per type you will process (invoice, bill of lading, packing list, certificate of origin,
   LC, inspection certificate). Use redacted copies, or ones the owner consented to send to the model provider.
2. For each, write the answers you are sure of in `labels.json` (format in the header of `backend/scripts/measure-extraction.ts`).
3. Run `cd backend && npm run measure:extraction -- --dir <folder> --labels labels.json --min 0.95 --out accuracy.md`.
4. Done when overall accuracy is at least 95% and **amount, currency, document number and HS code are at least 98%**.
   Read the "Mistakes" table: each row is a prompt or parser fix. Repeat until the bar holds, and again after every
   model or prompt change. Keep `accuracy.md` as the evidence.

### 2.2 Regulatory sign-off (bank compliance head)

Every rule is `PENDING_BANK_SIGN_OFF`. Code cannot decide that a rule matches the regulation.

1. Give `docs/REGULATORY_SOURCE_REGISTER.md` and the rule catalog (`/verification`) to the bank's compliance and legal teams.
2. Obtain what the register lists as not retrievable automatically (for example the TBML framework annex and the current
   Foreign Exchange Manual chapter).
3. Approve each rule in the platform with dual control (one person proposes, a second approves; the audit chain records both).
4. Done when no rule you rely on is pending and the unapproved-rule mode (`VERIFICATION_UNAPPROVED_RULE_MODE`) is set to
   what the bank accepts.

### 2.3 Licensed data (procurement)

| Data | Why | How |
|---|---|---|
| Pakistan Customs Tariff (8-digit) | HS checks beyond the 6-digit UN reference | supply the file, follow `docs/PCT_INGESTION.md` |
| Vessel / AIS provider | vessel and voyage checks; the current source is scraped | sign a license, add a provider behind `IMaritimeProvider` |
| Price benchmarks | price-deviation findings need approved thresholds per product | write the bank-approved `PRICING_POLICY_FILE` (`docs/PRICING_FRAMEWORK.md`) |
| Sanctions lists | keep lists current | set `OPENSANCTIONS_API_KEY` or schedule the official list syncs; confirm the terms of use for each |
| UN HS reference | used in checks | confirm the UN's terms for commercial use |

### 2.4 Production environment (your infrastructure team)

1. Run MongoDB as a replica set (the compose file does this for one host; use three nodes in production). The API prints
   which mode it is in at start-up.
2. Terminate TLS in front of nginx; keep the HSTS header.
3. Keep `AUTH_SECRET` and `AUDIT_HMAC_KEY` in a secret store, different from each other. Back up `AUDIT_HMAC_KEY`: without
   it the audit chains cannot be verified.
4. Replace demo sign-in with the bank's sign-in (SSO/OIDC). Demo accounts must be off (`ENABLE_DEMO_LOGIN=false`).
5. Alert on these log lines: `AUDIT EVENT NOT WRITTEN`, `STORAGE_WRITE_FAILED`, any 5xx rate above normal.
6. Take backups and **practice a restore** into a clean environment; finish with the audit-chain check on a restored case.
7. Run one API instance per environment (queue, rate limiter and fraud history are in-process).
8. Done when a restore drill and a failover drill (stop the primary) both end with the system serving and the chain valid.

### 2.5 Independent security test (external)

Engineering tests cannot replace an outside tester. Commission a penetration test of the deployed system, give the tester
`SECURITY.md`, `docs/RBAC_PERMISSION_MATRIX.md` and two accounts per role. Done when high and critical findings are closed.

### 2.6 Color contrast (done 2026-10-29)

Done. The brand teal `#00a8a8` (2.9:1 against white) is kept for decoration (dots, glows, borders, gradients, scrollbars,
anything on the navy hero). Wherever it carries text, or is the background of white text, the app now uses `#007575`
(5.5:1 on white). `--accent` is `#007575`; the light-theme status tokens are `--positive #047857`, `--negative #b91c1c`,
`--warning #b45309`, `--info #2563eb`; muted greys and the footer text were darkened or lightened to pass.
Verified in a real Chrome over 336 role x page x tab views, including seeded cases (findings, post-shipment examination):
0 color-contrast violations and 0 violations in the full WCAG 2 A/AA rule set. The tab "Reading your documents..." label
no longer fades its text (a faded label cannot meet contrast). The app forces the light theme, so the dark theme's own
values were not part of this pass; check them if dark mode is ever enabled.

### 2.7 Scale test with real data volume

The load test above ran on an empty store. Before relying on response times, load a realistic volume (for example the
bank's last year of cases, anonymised) into a test environment and repeat the autocannon run
(`npx autocannon -c 4 -R 8 -d 30 -H "authorization=Bearer <token>" <url>`). Done when the 99th percentile is acceptable for
the bank's users on `/api/analytics`, `/api/trade-cases` and `/api/documents`.

### 2.8 Smaller items

- **Identity log order.** The account directory records its audit event before it saves the account, so a failure between
  the two leaves an event for a change that was not made (the reverse of the case store's old gap). The log shows what was
  attempted; it is not atomic. Low risk; fix with the same transaction pattern if it matters to the bank.
- **Real-AI end-to-end run for post-shipment documents** has not been done (the stand-in model covers it in tests).
  Run `test-pdfs/<round>/D..F` through the UI with the real model once the key and budget are set.
- **Demo data reset** (`npm run reset-demo`) is available but was not applied; apply it before a demonstration if old test
  cases would confuse the audience.

### 2.9 Engineering review of 2026-11-02 (done, and what is left)

Done and verified (backend tests, access probe 159 routes x 17 roles = 0 problems, live MongoDB scenarios M1-M11, frontend build,
lint and 89 specs):

1. **Case lists scale.** Measured with `npm run bench:cases -- --cases 1000 --fixture <backup.json>` using a real 60 KB case.
   The staff case list took 1,451 ms at 1,000 cases and blocked the event loop for all of it; it now takes 77 ms (workspace
   queues 1,420 -> 46 ms, customer list 638 -> 46 ms), and 3,000 cases take about 376 ms. Causes removed: the memory driver deep-copied
   every case on every list (now one frozen copy per case, handed out read-only, so a reader that tries to change one fails
   loudly), the permission set was rebuilt on every check (now built once per role), and every list built the full case view
   (now `listRow`, which gives the same status, next steps, findings and queries without checklists, blockers or redaction).
   On MongoDB a list no longer loads the AI-review, comparison, scrutiny-run, screening and verification results (about 70% of
   a case, read only on the case's own page): `CaseHeader` and `CASE_HEADER_PROJECTION`; 1,000 full documents took 2,049 ms to
   fetch and 816 ms without them. Indexes on `customerRef`+`status` already existed. Tests: `case-list.test.ts` (C1-C3), `mongo-live` M11.
2. **The case service is smaller.** `trade-case.service.ts` went from 4,186 to 3,755 lines; the pure rules (who may see a case, what is a
   draft, whether a finding blocks, where a post-shipment application stands) are in `case-rules.ts` and the per-user views in
   `case-views.ts`. External imports are unchanged (the service re-exports what it used to export).
3. **Frontend lint.** `angular-eslint` with `no-explicit-any` as an error, template accessibility rules and `npm run lint` in CI. 118 findings
   fixed: ten modals and cards now close and activate from the keyboard (Escape, Enter, Space), six labels are tied to their
   fields, `*ngIf`/`*ngFor` moved to control flow, and the `any`s are gone except at the named `Loose` boundary (`shared/loose.ts`).
   The 5,466-line dashboard component is 813 lines; its template and styles are files.
4. **Chat output is sanitized** (`shared/chat-html.ts`): only the tags and classes the formatter makes survive; a document that steers
   the model can no longer produce lookalike markup. 7 specs.
5. **Sign-in lock.** A lock per email *and address* (5 wrong passwords) plus a looser lock per email across all addresses (25). One
   address can no longer keep an officer out of their account for everyone; guessing spread over many addresses is still stopped.
6. Karma noise removed, silent failures logged (events files, customer seed writes), shutdown always exits, probe and lint in CI.

Still open (engineering):

- `trade-case.service.ts` is still large (3,755 lines). Next seams, in order of independence: host payload (about 230 lines), amendments
  (about 215), post-shipment application and examination (about 520), history/activity (about 100). Each needs a small shared context
  (`mutate`, `loadFor`, the repository) passed in; move one at a time and run lifecycle, rbac and the probe after each.
- The case list still returns every case the user may see. Fine for thousands; at tens of thousands add server paging to
  `GET /trade-cases` and the Dashboard. Re-run `bench:cases` and section 2.7 with the bank's real volume first.
- Other large components (analysis, analytics, import, sources, blog) still carry inline styles or templates and have no unit tests; the
  real-browser checks in `tools/a11y` are not yet run in CI (they need a served build and a throwaway backend).
- Development-tool advisories: moderate `glob`/`minimatch` in the Angular CLI and ESLint chains, no fix published. Production
  dependencies are clean (`npm audit --omit=dev`: 0, both packages), and CI checks that.

## 3. How the deployment was verified

The shipped `docker-compose.yml` was built from the repository and started with Docker (project `tgtest`, port 18080, test-only
secrets, removed afterwards):

- MongoDB came up as a replica set `rs0` and became healthy through the compose health check, which also initiates the set.
- The API reported "a case change and its audit entry are saved in one transaction".
- Signing in as a customer through nginx worked. A case was created and changed three times. In MongoDB the case revision
  (8) equalled the audit head (8), eight events were stored with no gaps, the hash links were intact and the chain was HMAC-keyed.
- A trade maker was refused the audit log with 403, as the permission matrix says.
- **A real defect was found and fixed.** In Chrome, behind nginx's Content-Security-Policy, the page's main stylesheet never
  applied: Angular's inline-critical-CSS option loads it with an inline `onload` handler, which the policy blocks. The
  landing page lost its button colors, fonts and spacing. It worked in `ng serve` and in every earlier test. Fixed with
  `inlineCritical: false` in `frontend/angular.json`; after the fix six page loads (public, customer, trade maker) show no
  policy violations and no failed requests, and the page matches the design.

Not verified: TLS, a multi-node replica set, failover, backup restore, behavior with a real AI key inside the container.
Those belong to section 2.4.
