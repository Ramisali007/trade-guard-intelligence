# Master audit report — TradeGuard Intelligence trade-finance platform

**Date:** 2026-10-27 · **Branch:** `audit/tbml-production-hardening` · **HEAD:** `744c1e6` + an uncommitted working tree of ~208 files (present before the audit; **nothing was committed, reset, cleaned or deleted**).
**Companion reports:** [ROUTE_AND_UI_VERIFICATION](ROUTE_AND_UI_VERIFICATION.md) · [ROLE_PERMISSION_MATRIX](ROLE_PERMISSION_MATRIX.md) · [WORKFLOW_VERIFICATION](WORKFLOW_VERIFICATION.md) · [BUG_FIX_REGISTER](BUG_FIX_REGISTER.md) · [TEST_EXECUTION_REPORT](TEST_EXECUTION_REPORT.md) · [DEPLOYMENT_READINESS](DEPLOYMENT_READINESS.md) · [CLEANUP_REPORT](CLEANUP_REPORT.md)

## 1. Verdict

The platform works as designed on every path that was driven, and the access-control layer holds under hostile testing. **No P0 or P1 defect was found.** Four defects were reproduced and fixed with regression tests in the first pass (AUDIT-001..004), and two further passes the same day closed five more (AUDIT-005..009: truncated PDFs, the demo sign-in limiter, the `zod` advisory (whose upgrade also exposed a real zod-4 regression, fixed), the background "sync all" with a truthful result message, and a wrong document-type label found by the first live-AI measurement). The audit key is now set and a live-AI check and a labelled extraction measurement were run (72/72 on ten clean sample documents; see the caveats in TEST_EXECUTION_REPORT.md). Two observations remain open. **Suitable for local demonstration; not yet for a controlled pilot (conditions are non-engineering approvals plus a live-AI accuracy measurement); not for production.**

This was a large audit, run to a real depth on security, authorization, workflow and UI, but it is not a proof of absence of defects. Section 7 lists what was not verified.

## 2. Baseline state (before any change)

Backend: typecheck, lint (0 errors / 146 warnings), build and the 21-suite `npm test` chain all pass (159 markers). Frontend: Angular build clean, 35/35 unit specs. Dependency audit: one high advisory (`zod`, backend); cleared in the second pass. Services found running on the user's machine: API on `4000`, Angular on `4200`, MongoDB on `27017`; all bound to loopback. They were left alone; testing used a separate in-memory stack on `4100`/`4300`.

## 3. Architecture as found

- **Backend** (Node 24, Express 4, TypeScript, MongoDB or in-memory stores): `routes/` (11 routers, 149 handlers) → `controllers/` → services (`trade-cases/trade-case.service.ts` is the lifecycle core, ~3,700 lines) → repositories (Mongo/memory) with a per-case mutex, revision guard and hash-chained audit events. `authorization/permissions.ts` is a single registry: 16 roles, 77 permissions, default deny. AI providers (`ai/`) sit behind an interface with a local heuristic fallback; pre-shipment scrutiny requires a model (`PRESHIPMENT_REQUIRE_AI`).
- **Frontend** (Angular 20, standalone components, lazy routes): 25 route entries guarded by `authGuard` + `permissionGuard` using the permission list the server returns; the API re-checks every call.
- **Document store:** originals in GridFS (or disk), content-hash identity per customer.
- Documentation vs implementation: `docs/RBAC_PERMISSION_MATRIX.md` is generated from the permission registry and its counts (16 roles, 77 permissions) match what the running system issued; `docs/DEPLOYMENT_READINESS.md` is flagged superseded by its own header. The top-level READMEs and architecture documents were not compared line by line with the code.
- Circular dependencies, dead code and unused assets were **not** analysed (Phase Twelve was not executed; see §7).

## 4. Method

1. Repository and state discovery; baseline builds/tests/audits.
2. A new route × role probe over HTTP (`route-role-probe.test.ts`).
3. A black-box probe of document upload, isolation, concurrency, tokens, headers and rate limiting against a live isolated server.
4. A real-browser pass: 15 roles × 27 URLs, an edge-state review, a scripted client→officer journey, and a click crawler over 32 screen/role pairs.
5. Live MongoDB suite in a throw-away database.
6. Code review of the write path (`mutate`), the upload paths and the failing screens; diff review of one corrupted template against `HEAD`.
7. Fix, regression-test, re-verify live, and re-run the full backend chain, probe and frontend specs.

## 5. Findings

| ID | Sev | Finding | Status |
|---|---|---|---|
| AUDIT-001 | P2 | Concurrent identical uploads each passed the pre-lock duplicate check and created their own link (3 copies from 6 simultaneous requests) | **Fixed**, regression test P3b, live re-verified |
| AUDIT-002 | P2 | Invalid document id left `/processing/:id` spinning at 0% and `/analysis/:id` blank | **Fixed**, 2 unit specs |
| AUDIT-003 | P3 | `class="lage"` / `dsize]` typos in the working-tree analysis page (HEAD was correct) | **Fixed** |
| AUDIT-004 | P3 | No test called every route as every role | **Added** (`npm run test:probe`) |
| AUDIT-005 | P3 | 9-byte `%PDF-1.7` stub (or a cut-off PDF) accepted at upload and replaced a good version | **Fixed** (`%%EOF` required at upload), test P3c |
| AUDIT-008 | P2 | `sync-all` held the request open, toasted success whatever happened, and the sync engine ignored `EXTERNAL_SOURCES_OFFLINE` | **Fixed** (background batch, status endpoint, truthful message), test H12 |
| AUDIT-009 | P3 | Live model typed an inspection certificate as "Certificate of Origin" | **Fixed** (prompt type list); first wording was rejected because it would have split analytics groups |
| OBS-3 | P2 | Case write + audit event not atomic without Mongo transactions (reported and detected, not prevented) | Open: use a replica set |
| AUDIT-007 | P2 | `zod` high advisory | **Fixed** by upgrading to v4; the upgrade broke AI-response parsing for missing fields (`z.any()` keys became required), found by the lifecycle suite and fixed |
| AUDIT-006 | P3 | Demo login shared the 10/min sign-in limiter | **Fixed** (own bucket, 60/min), test H7 |
| OBS-7 | P3 | 146 lint warnings (`no-explicit-any`) | Open, deliberately: dynamic data (CLEANUP_REPORT.md) |

What was checked and found **sound** (evidence in the companion reports): default-deny on all routes; cross-customer isolation returning 404; no privilege escalation or mass assignment; token tamper/`alg:none`/post-logout refusal; upload hardening (type, size, traversal, empty, null byte, MIME spoof); byte-exact download; blocking discrepancies unbypassable by direct API; no information leakage in error bodies; security headers; brute-force limiter; per-case concurrency control and audit-chain tamper detection on a real MongoDB.

## 6. Counts

| Item | Inventoried | PASS | FAIL (now fixed) | BLOCKED | NOT TESTED |
|---|---|---|---|---|---|
| Frontend routes (25 entries; 27 URLs × 15 roles) | 25 | 459 / 459 page loads | 0 (2 pages had missing error states: AUDIT-002/003, fixed) | 0 | 0 |
| Interactive controls (templates: 394 buttons, 114 links, 143 fields, 494 click bindings) | 457 on-screen controls reached by the crawler | 385 clicked with no exception or 5xx ("PASS-weak"); business action verified only on the post-shipment journey (~15 controls) | 0 | 0 | 72 not clicked (disabled or gone), plus every control on screens not in the crawl plan |
| API routes | 149 | 149 (anonymous, role denial, hostile input) | 0 | 0 | business-level happy paths for the non-trade-case routes (analytics, import, chat) rely on the existing suites |
| Roles | 16 | 15 browser + 17 API accounts | 0 | 0 | Integration Gateway beyond one existing scenario |
| Defects | 9 fixed + 2 observations open | — | P0: 0 · P1: 0 · P2: 4 fixed (+1 open) · P3: 5 fixed (+1 open) | — | — |

## 7. Not verified, and why

- **Live AI on real documents.** A live check and a 10-document labelled extraction measurement were run on synthetic sample documents (72/72), but accuracy on real, messy, authorised documents has never been measured, and the end-to-end scrutiny (review, comparison, mail) was not re-run live today.
- **Circular dependencies and duplicate implementations** were not analysed. The unused-code part of Phase Twelve was done (CLEANUP_REPORT.md); knip does not report cycles. A cleanup report would need the build and test run after each batch; recommended as a separate pass.
- Accessibility, cross-browser, idle auto-lock, UI behaviour with the API offline. (Back/forward/refresh, the signed-out redirect and phone/tablet page overflow were verified in the second pass; the overflow check detects page-level scrolling only.)
- Sustained load or multi-user concurrency beyond bounded bursts.
- Atlas cloud dual-write; real SWIFT/customs/Form-E; malware scanning; SSO.
- The pre-shipment approval click-path was not re-driven in the browser today (covered by lifecycle tests and by the 2026-10-26 browser run).

## 8. Files changed by this audit

| File | Why |
|---|---|
| `backend/src/trade-cases/trade-case.service.ts` | AUDIT-001: duplicate check repeated inside the case lock; one shared `alreadyOnRequest` error |
| `backend/src/__tests__/post-shipment-http.test.ts` | Regression scenario P3b |
| `backend/src/__tests__/route-role-probe.test.ts` (new), `backend/package.json` (`test:probe` script) | AUDIT-004 |
| `frontend/src/app/pages/processing/processing.component.ts` | AUDIT-002 error state |
| `frontend/src/app/pages/analysis/analysis.component.ts` / `.html` | AUDIT-002 error state; AUDIT-003 typos |
| `frontend/src/app/pages/processing/document-error-states.spec.ts` (new) | Regression specs |
| `backend/src/document-processing/extractors/index.ts`, `backend/src/services/document.service.ts`, `backend/src/__tests__/document-deduplication.test.ts` | AUDIT-005: `%%EOF` required at upload; three mock fixtures now end like real PDFs |
| `backend/src/routes/auth.routes.ts`, `backend/src/__tests__/hardening.test.ts` | AUDIT-006: separate demo sign-in limiter, test H7 |
| `backend/package.json`, `backend/package-lock.json`, `backend/src/trade-cases/preshipment-ai.service.ts` | AUDIT-007: `zod` 3 to 4 and the `z.any().optional()` fix for AI-response parsing |
| `backend/src/compliance/sync/sync-engine.service.ts`, `feed-connectors.ts`, `controllers/document.controller.ts`, `routes/documents.routes.ts`; `frontend` documents service, models and Sources screen | AUDIT-008: background sync-all, status endpoint, truthful result; real connectors honour `EXTERNAL_SOURCES_OFFLINE` |
| `backend/src/ai/trade-prompt.ts` | AUDIT-009: document type list |
| `backend/.env` (local, not tracked) | `AUDIT_HMAC_KEY` generated and added; previous file backed up outside the repo |
| `backend/src/__tests__/test-env.ts` | the suites pin the audit key off unless `TEST_AUDIT_HMAC_KEY` opts in |
| Removed: 8 unused backend helpers, `frontend/.../taxonomy.service.ts`, devDependency `@types/gsap` | CLEANUP_REPORT.md |
| `docs/audit/*.md` (8 new) | These reports |

Temporary scripts used for the live probes and the browser runs were kept outside the repository (and the one temporary folder inside it was removed); they are not part of the deliverable.
