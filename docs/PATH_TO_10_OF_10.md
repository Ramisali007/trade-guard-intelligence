# Path to 10/10

**Date:** 2026-10-28 · **Branch:** `audit/tbml-production-hardening`

Everything that engineering alone can do is done and verified (section 1). What is left needs a decision, a licence, a
person or an environment that only the owner has (section 2). Each item says who has to act, the steps, and how you will
know it is finished.

## 1. Done and verified by engineering

| Area | Result | Evidence |
|---|---|---|
| Build | Backend and frontend compile and build clean | `npm run typecheck`, `npm run build` (both), `ng build` |
| Lint | 0 errors, 0 warnings. Dynamic-data boundaries use one named type, `Loose` (`backend/src/utils/loose-json.ts`) | `npm run lint` |
| Tests | 21 backend suites, 37 frontend specs | `npm test`, `ng test` |
| Access control | 149 routes x 17 roles, about 11,000 calls, no problem | `npm run test:probe` |
| Dependencies | 0 known vulnerabilities, backend and frontend | `npm audit` |
| Persistence | Case change and audit entry are **one transaction** on a replica set; on a standalone server they stay two writes and a gap is reported and detected | `npm run test:mongo` against a standalone server (9/9) and a real replica set (9/9, scenario M7) |
| Deployment | `docker-compose.yml` runs MongoDB as a one-node replica set and requires `AUDIT_HMAC_KEY` | built and started with Docker, section 3 |
| Accessibility | axe-core WCAG 2 A/AA over 34 pages in light and dark: only `color-contrast` remains. Menu, upload area and search work from the keyboard | `tools/a11y` |
| Config | `.env.example` lists every setting the code reads; settings nothing read were removed | grep of `process.env` and the config helpers |
| Accuracy tooling | `npm run measure:extraction` scores the model against labelled documents and fails below a bar | section 2.1 |
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

1. Give `docs/REGULATORY_SOURCE_REGISTER.md` and the rule catalogue (`/verification`) to the bank's compliance and legal teams.
2. Obtain what the register lists as not retrievable automatically (for example the TBML framework annex and the current
   Foreign Exchange Manual chapter).
3. Approve each rule in the platform with dual control (one person proposes, a second approves; the audit chain records both).
4. Done when no rule you rely on is pending and the unapproved-rule mode (`VERIFICATION_UNAPPROVED_RULE_MODE`) is set to
   what the bank accepts.

### 2.3 Licensed data (procurement)

| Data | Why | How |
|---|---|---|
| Pakistan Customs Tariff (8-digit) | HS checks beyond the 6-digit UN reference | supply the file, follow `docs/PCT_INGESTION.md` |
| Vessel / AIS provider | vessel and voyage checks; the current source is scraped | sign a licence, add a provider behind `IMaritimeProvider` |
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
6. Take backups and **practise a restore** into a clean environment; finish with the audit-chain check on a restored case.
7. Run one API instance per environment (queue, rate limiter and fraud history are in-process).
8. Done when a restore drill and a failover drill (stop the primary) both end with the system serving and the chain valid.

### 2.5 Independent security test (external)

Engineering tests cannot replace an outside tester. Commission a penetration test of the deployed system, give the tester
`SECURITY.md`, `docs/RBAC_PERMISSION_MATRIX.md` and two accounts per role. Done when high and critical findings are closed.

### 2.6 Colour contrast (a design decision: yours)

axe finds 581 elements (light) and 645 (dark) below WCAG AA. They come from a few hard-coded colours, mainly the brand teal
`#00a8a8` (2.9:1 against white). Changing them changes the product's look, so I did not. To apply, replace the colour across
`frontend/src` for text and for backgrounds that carry white text (not decorative borders or gradients), then run
`tools/a11y` (`npm run scan`) until `color-contrast` is gone. Replacements, checked against the backgrounds the scan found:

| Now | Ratio now | Replace with | Ratio after |
|---|---|---|---|
| teal `#00a8a8` (text on white, or white text on it) | 2.9 | `#007575` | 5.5 on white, 4.9 on the pale teal tints |
| teal `#008c8c` / `#008888` | 4.1 / 4.3 | `#007575` | 5.5 |
| green `#10b981` | 2.3-2.5 | `#047857` | 5.5 on white, 4.9 on the pale green |
| green `#059669` | 3.4 | `#047857` | 5.0 |
| red `#ef4444` | 3.2-3.5 | `#b91c1c` | 5.6-6.1 |
| red `#dc2626` | 4.2 | `#b91c1c` | 5.7 |
| amber `#d97706` | 3.2 | `#b45309` | 5.0 |
| cyan `#06b6d4` | 2.2 | `#0e7490` | 4.8 |
| blue `#4f6ef7` (on `#eef1fe`) | 3.8 | `#3b55d9` | 5.4 |
| grey `#777777` | 4.5 | `#6b6b6b` | 5.3 |

If you want to keep the bright teal, keep it for decoration and use `#007575` wherever it carries text. The dark theme has
its own values and needs the same pass. Tell me which option you want and I will apply it and re-run the scan.

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
  landing page lost its button colours, fonts and spacing. It worked in `ng serve` and in every earlier test. Fixed with
  `inlineCritical: false` in `frontend/angular.json`; after the fix six page loads (public, customer, trade maker) show no
  policy violations and no failed requests, and the page matches the design.

Not verified: TLS, a multi-node replica set, failover, backup restore, behaviour with a real AI key inside the container.
Those belong to section 2.4.
