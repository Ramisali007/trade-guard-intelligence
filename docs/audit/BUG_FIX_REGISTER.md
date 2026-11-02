# Bug fix register — audit of 2026-10-27

Branch `audit/tbml-production-hardening`, HEAD `744c1e6`, with the large uncommitted working tree that was present at the start (nothing was committed, reset, cleaned or deleted by this audit). Severity scale: P0 critical, P1 high, P2 medium, P3 low (as defined in the audit brief).

**Result: no P0 or P1 defect was found.** Two P2 and two P3 defects were reproduced and fixed in the first pass; a second pass the same day closed five more (AUDIT-005..009, below). Two observations remain open.

## Fixed

### AUDIT-001 — identical uploads in flight at once are stored several times (P2, data integrity)

- **Reproduction (live, isolated stack):** as the corporate customer, start a post-shipment application and send six uploads of the *same* PDF at the same moment (a double click does the same). Statuses `201,201,201,429,429,429`; the application then held three links to the one file (the earlier two marked superseded by the later). The same applies to pre-shipment `POST /trade-cases/:id/documents`.
- **Root cause:** `attachDocument` and `attachPresentationDocument` refuse "the same file already on this request" with a check made **before** `mutate()` takes the per-case lock. Every request in flight passed that check, then each created its own link inside the lock (`linkDocument` only supersedes by *type*, it does not look at the file).
- **Fix:** the same check is repeated inside the locked `mutate` callback, where the case is read fresh, so it is authoritative; the pre-lock check stays as the fast path. Both use one helper (`alreadyOnRequest`) so the message and the `409 DOCUMENT_ALREADY_ON_REQUEST` code are identical.
- **Files:** `backend/src/trade-cases/trade-case.service.ts`.
- **Regression test:** `backend/src/__tests__/post-shipment-http.test.ts`, scenario **P3b** — five concurrent identical uploads (post- and pre-shipment): exactly one succeeds, the rest are `DOCUMENT_ALREADY_ON_REQUEST`, one link and no superseded copies remain.
- **Verified:** suite passes; live re-run on a restarted isolated server: `201,409,409,429,429,429`, one stored document.
- **Status:** FIXED. Limitation: the test was not re-run against the pre-fix code; the pre-fix failure is the live reproduction above.

### AUDIT-002 — an invalid document id leaves the processing page spinning and the analysis page blank (P2, UI)

- **Reproduction:** as any staff role with `documents.read`, open `/processing/doc-x` (API answers `400`): the page stays on "Analyzing Your Document 0% … calculating…" for ever; only a toast that disappears is shown. `/analysis/doc-x` renders nothing but a toast.
- **Root cause:** the error handlers in `processing.component.ts` and `analysis.component.ts` only raised a toast; neither page had a state for "could not be read".
- **Fix:** `pollError` / `loadError` signals and a visible `role="alert"` card (message, "Try again" on the analysis page, link back to the dashboard).
- **Files:** `frontend/src/app/pages/processing/processing.component.ts`, `frontend/src/app/pages/analysis/analysis.component.ts`, `frontend/src/app/pages/analysis/analysis.component.html`.
- **Regression test:** `frontend/src/app/pages/processing/document-error-states.spec.ts` (2 specs).
- **Status:** FIXED. Frontend unit tests 37/37.

### AUDIT-003 — analysis page lost its layout class and spinner size (P3, working-tree regression)

- **Reproduction:** `git show HEAD:…/analysis.component.html` has `<div class="page analysis-page">` and `<app-icon … [size]="28" />`; the working copy had `class="lage analysis-page"` and `dsize]="28"`. The page therefore missed the global `.page` layout/entrance styling and the loading icon ignored its size. The build did not notice (an unknown class and an unknown attribute are legal HTML).
- **Root cause:** a typing slip in uncommitted work.
- **Fix:** both restored. No other difference in that file looked accidental (the rest of its diff is intended content work on sanctions/pricing wording).
- **Files:** `frontend/src/app/pages/analysis/analysis.component.html`.
- **Regression test:** none practical (a CSS class name); the grep `class="lage|dsize\]` over `frontend/src` now returns nothing.
- **Status:** FIXED.

### AUDIT-004 — the dynamic route × role behavior of the API had no automated check (P3, test gap)

- `rbac-portals.test.ts` proves statically that each route names a permission and checks 289 role × endpoint pairs. Nothing called *every* route as *every* role with hostile input.
- **Added:** `backend/src/__tests__/route-role-probe.test.ts` (`npm run test:probe`, about 10 minutes, so it is deliberately not part of `npm test`): anonymous refused on every non-public route; every role lacking a route's permission gets 403; ~9,900 calls with garbage ids, traversal strings, malformed/oversized JSON and `__proto__` bodies never produce 5xx, a hang or a dropped connection; wrong-method calls are never served.
- **Result:** first run (148 routes): 11,170 calls, only the `sync-all` timeouts that led to AUDIT-008; after the fix and with no exemption, see TEST_EXECUTION_REPORT.md section 7.
- **Status:** ADDED.

### AUDIT-005 — a truncated PDF replaced a good document (P3, was OBS-1)

- **Reproduction:** upload a 9-byte `%PDF-1.7` stub, or a real PDF cut in half, as a document type that already has a valid version: it was accepted (201) and became the *current* version; analysis then failed.
- **Root cause:** the upload gate checked only the `%PDF-` header.
- **Fix:** `assertPdfComplete` requires a `%%EOF` marker anywhere in the file and is called at upload only (not inside `detectFileType`, so documents stored earlier cannot become unreadable). It answers with the existing `422 CORRUPT_FILE` message, not "unsupported type". Trailing bytes after the marker are accepted. All 116 real PDFs in the repository (`test-pdfs`, `sample_reports`) contain the marker.
- **Files:** `backend/src/document-processing/extractors/index.ts`, `backend/src/services/document.service.ts`.
- **Regression test:** `post-shipment-http.test.ts` scenario **P3c** (stub refused 422, half a real PDF refused 422, PDF with trailing bytes accepted). Three mock fixtures in `document-deduplication.test.ts` were one-line stand-ins without an end marker; they now end like real PDFs (the failed-analysis scenario keeps its intent: marker present, structure broken).
- **Status:** FIXED. Judgment call to confirm: a PDF that lacks `%%EOF` for an unusual reason would now be refused. None of the 116 samples is affected.

### AUDIT-006 — demo sign-in locked presenters out (P3, was OBS-6)

- **Reproduction:** more than 10 one-click demo sign-ins in a minute from one address returned 429, also blocking the password sign-in.
- **Fix:** `/auth/demo-login` has its own bucket (60 a minute); the password sign-in keeps 10 a minute. Demo login still exists only on loopback or by explicit opt-in.
- **Files:** `backend/src/routes/auth.routes.ts`. **Test:** `hardening.test.ts` H7 (25 demo sign-ins unthrottled, password sign-in still works).
- **Status:** FIXED.

### AUDIT-007 — `zod` high advisory cleared by upgrading to v4 (P2, was OBS-4), and a regression found on the way

- **Change:** `zod` `^3.25.76` to `^4.6.7`. `npm audit --omit=dev` now reports 0 vulnerabilities (was 1 high). The project typechecked unchanged, which is **not** proof of compatibility.
- **Regression found by the existing lifecycle suite:** in zod 4 an object key declared `z.any()` is *required*; in zod 3 a missing key passed. The AI-response helpers in `trade-cases/preshipment-ai.service.ts` rely on a missing field becoming `''`, `[]` or a fallback, so every model answer that omitted `regulation` or `evidence` was rejected, the review retried, and the step failed (`'FAILED' !== 'DONE'` in `trade-lifecycle.test.ts` line 830). With a real model this would have silently failed scrutiny whenever the model left a field out.
- **Fix:** the eight helpers are now `z.any().optional().transform(...)`, which restores the old behavior (verified in isolation and by the suite).
- **Files:** `backend/package.json`, `backend/package-lock.json`, `backend/src/trade-cases/preshipment-ai.service.ts`.
- **Regression test:** the lifecycle suite (its stand-in model omits fields) now guards this; no separate test was added.
- **Status:** FIXED. Limitation: not exercised against a live model.

### AUDIT-008 — "Sync all sources" held the request open, announced success whatever happened, and was not offline-safe (P2, was OBS-2)

- **Reproduction:** `POST /documents/compliance/sources/sync-all` ran every feed download inside the HTTP request (over 20 s when sources are slow or unreachable). The Sources screen then toasted "All 8 regulatory feeds were successfully refreshed" **without reading any run's status**, so a failed or suspicious feed was reported as success. Separately, the sync engine's connectors made real internet requests even with `EXTERNAL_SOURCES_OFFLINE=true`, so a test of it took 20–106 s depending on the network (found when the new test was flaky).
- **Fix:** the endpoint now starts the batch in the background and answers `202` at once (one batch at a time; asking again joins the running one); new `GET …/sync-all/status` (permission `compliance.sources.read`) returns the batch and each source's recorded outcome. The screen polls it and reports what actually happened ("10 feeds checked: 6 refreshed, 3 unchanged, 1 failed (OFAC_SDN)"). With `EXTERNAL_SOURCES_OFFLINE=true` the real connectors refuse immediately and the engine records an honest `FAILED` run; connector overrides used by tests are never blocked.
- **Files:** `backend/src/compliance/sync/sync-engine.service.ts`, `backend/src/compliance/sync/feed-connectors.ts`, `backend/src/controllers/document.controller.ts`, `backend/src/routes/documents.routes.ts`, `frontend/src/app/services/documents.service.ts`, `frontend/src/app/models/api.models.ts`, `frontend/src/app/pages/sources/sources-health.component.ts`.
- **Regression test:** `hardening.test.ts` scenario **H12** (403 without the sync permission, 401 anonymous on status, `202` in under 3 s, a second request joins the first, the batch finishes with per-source statuses and the starting actor). Three consecutive runs: 19–20 s each, all pass.
- **Status:** FIXED. Not re-driven in a browser: the new polling UI is verified by build and the API by H12 only.

### AUDIT-009 — the model named an inspection certificate a "Certificate of Origin" (P3, found by the first live accuracy measurement)

- **Reproduction:** live model, `INS-SAN-2026-03355` (title "CERTIFICATE OF QUALITY AND QUANTITY"): `type = "Certificate of Origin"`. The type string appears in report headlines, the document assistant and the analytics grouping, so the wrong label would reach users.
- **Root cause:** the extraction prompt listed six types ending in "etc.", so the model chose the nearest listed one.
- **Fix:** `trade-prompt.ts` now lists the common trade documents (inspection and insurance certificates, import permit, purchase order, sales contract, customs goods declaration, air waybill) and asks for one of those names in that capitalization when it fits.
- **A first wording was wrong and was replaced:** "name the document by what its own title says" scored 100 % but made the model echo titles in capitals ("PROFORMA INVOICE", "OCEAN BILL OF LADING"). `analytics.service.ts` groups documents by this exact string, so that would have split analytics buckets. Caught by checking every consumer of the field; the final wording is above.
- **Files:** `backend/src/ai/trade-prompt.ts`. **Test:** the live evaluation (not part of `npm test`, needs the provider key).
- **Status:** FIXED for the sample set. Limitation: the prompt was adjusted against these same 10 documents, so the final score is not an unbiased estimate.

## Open observations (not changed; each needs a decision)

| ID | Sev | Observation | Why not changed |
|---|---|---|---|
| OBS-3 | P2 (design) | On a MongoDB server without transactions the case write and its audit event are two writes. A failure between them leaves a saved change with no audit entry. It is reported (`503 AUDIT_WRITE_FAILED`, error log) and the hash-chain check flags the gap (test M7), but it is not prevented. | Fixing it needs a replica set with transactions in production; documented in `mongo-live.test.ts`. |
| OBS-7 | P3 | `npm run lint`: 0 errors, 146 `no-explicit-any` warnings. | Sampled: almost all are genuinely dynamic data (external feed JSON, AI output, import payloads, test mocks). Converting to `unknown` forces casts at every use with no behavior gain, so it was not done; see CLEANUP_REPORT.md. |
