# Hardening Report — audit findings, fixes and evidence

**Date:** 2026-10-22 · **Branch:** `audit/tbml-production-hardening` · **Scope:** a line-level review of the backend core, the frontend shell and the delivery tooling, followed by fixes. Each defect below was first **reproduced** (a throw-away script or a failing assertion), then fixed, and now has a regression test in [`backend/src/__tests__/hardening.test.ts`](../backend/src/__tests__/hardening.test.ts) (`npm run test:hardening`) or the live MongoDB suite (`npm run test:mongo`, scenario M9).

All verification used synthetic data. The MongoDB scenarios ran in an isolated `tradeguard_it_<timestamp>` database that was dropped afterwards.

## 1. Screening and decisions

| # | Defect (as reproduced) | Fix | Evidence |
|---|---|---|---|
| 1 | Names in Cyrillic, Arabic or Chinese normalised to an empty string and **never matched**, not even an identical listing. | Unicode-aware normalisation; Cyrillic and Greek are transliterated to the Latin the lists publish; other scripts match exactly. | H1 |
| 2 | "Bank Melli" did not match "BANK MELLI IRAN"; "Sberbank" did not match "SBERBANK OF RUSSIA". | A shortened distinctive name is a *possible* match (never a confirmed listing). | H1 |
| 3 | A name that could not be compared was counted as "screened" and the document came out clear. | Such names are listed as `unscreenedNames`; status becomes `UNKNOWN_INSUFFICIENT_DATA`, which forces REVIEW. | H1, H2 |
| 4 | A party designated *after* the transaction date capped the sanctions score at 45, which **hid** an embargoed route (BLOCK_ESCALATE 95 became REVIEW 18). | The cap applies to the late designation only; a comprehensively sanctioned jurisdiction or a confirmed hit on another party still sets the score. | H2 |
| 5 | "Nothing could be screened" produced ALLOW with "No material compliance concern". | Rule `RULE_SANCTIONS_SCREENING_INCOMPLETE`, missing-information entry, decision REVIEW. | H2 |
| 6 | The point-in-time screen skipped carriers, forwarders, manufacturers, suppliers, nominated/remitting/intermediary banks and trading names. | All roles the list engine screens are now screened as of the transaction date. | code review |
| 7 | The fraud `TransactionRegistry` (invoice/B-L/UETR/container history) lived in memory only; every restart forgot it. | Persisted atomically and reloaded at start-up; per-identifier history is bounded. | H10 |
| 8 | Human overrides: any action could set any decision (a "note" could flip BLOCK to ALLOW); a 3-character reason sufficed; an override was lost on re-analysis and was not concurrency-safe. | Action ↔ outcome rules; one step at a time; a sanctions-founded block cannot be lowered; lowering a block is CCO-only with a 30-character reason; done inside one serialised update; kept as history (marked superseded) across re-analysis; the certificate lists the system verdict and every override separately. | H5 |
| 9 | Pricing: correctly priced rice (USD 950/MT) was flagged as a **critical −99.9% under-invoice** (unit mismatch). | Prices are converted to the benchmark's own unit (MT/KG/DOZ/PCS/…); an inconvertible unit is "not comparable". | H3 |
| 10 | `"rice"` matched "rice cooker" and "Price adjustment fee"; "router" matched any telecom text. | Whole-word matching with exclusions, also in the MongoDB benchmark lookup. | H3 |
| 11 | An unknown currency (INR, SAR, …) converted **1:1 to USD**. | A currency with no rate is "not comparable"; point-in-time rate used for older transactions; pegged currencies added to the offline table. | H3 |
| 12 | Hand-entered sanctions entries had no `canonicalId`, so **each overwrote the previous one** under the key `undefined`. | Manual entries are real SCD Type-2 records (`MANUAL_COMPLIANCE:<id>:vN`); an edit closes the previous version. Entries of a regulator's feed cannot be hand-edited. | H8 |

## 2. Honesty of what the product says

| # | Defect | Fix |
|---|---|---|
| 13 | Every report and the analysis screen printed **"100% CLEARED — ZERO MATCHES ACROSS 1,224,672 GLOBAL ENTITIES (OPENSANCTIONS-GLOBAL-2026.09-LIVE)"**, even for a blocked document, although OpenSanctions is not what is screened. | Derived from the screening result: no match / match / possible match / incomplete, with the real dataset versions and counts. A hash over the real result replaces the decorative one. (H10) |
| 14 | Hard-coded "100% DETERMINISTIC VERIFICATION", "STANDARDS MET", "100% Active" watchlist SLA, "FAIR VALUE" with no benchmark, "Live SBP parity" for a free aggregator's rate, an invented registration number and a "CLEARED" badge on customer profiles, fabricated `sampleCount`s on built-in corridors. | Replaced with data-driven or neutral wording; FX quotes say whether they are live or bundled and are explicitly "not a central-bank rate". |
| 15 | The TBML assessment always asserted "Shipment volume aligns with standard containerized commercial lots" and "Direct commercial routing indicated". | Each statement says what was actually checked, or that nothing was assessed. |
| 16 | Report defaults claimed "No active designation found at transaction date" and "CLEARED under OFAC 50% rule" when no screening/ownership data existed. | Say that nothing is recorded. |

## 3. Access control, identity and audit

| # | Defect | Fix | Evidence |
|---|---|---|---|
| 17 | The import endpoints took `importedBy`/`actor` **from the request body**, so the master-data audit trail (sanctions, country flags, price corridors) could be spoofed. | The actor is always the signed-in user. | H8 |
| 18 | Operations Desk and the CCO could change sanctions, countries and benchmarks alone. | **Four-eyes control**: changes are submitted (202) and applied only when a different officer holding the new `masterdata.approve` approves; the audit log names submitter and approver; a Pending-approvals tab was added to the Import Center. | H8 |
| 19 | The example `AUTH_SECRET`/`API_SECRET_KEY` values were accepted as real secrets; demo accounts with a published password were on whenever `NODE_ENV` was not `production`, and the server listened on all interfaces. | Short or placeholder secrets are ignored and production refuses them; provider keys that are placeholders are ignored; default host is loopback; demo login needs loopback or an explicit opt-in; start-up warns about risky combinations. | H6 |
| 20 | Sign-in: synchronous scrypt at Node's default cost, no per-account lockout, sign-out only forgot the token, no idle timeout, the bearer token went to any URL, rate limits keyed by address only (NAT lock-outs). | Async scrypt at 2^17 with self-describing hashes (old ones verify); per-account lockout with doubling; `POST /auth/logout` revokes the token (persisted); 15-minute idle sign-out; token sent to the API origin only; per-user rate limits after authentication. | H7, frontend specs |
| 21 | Administrative identity changes could number two audit events alike (the second failed after its change was made) and shared one temp file. | Serialised administrative writes; atomic file writes. | M-suite |
| 22 | `/api/health` revealed environment, model, storage driver and queue depth to anyone. | Public probe says only that it is alive; detail moved to `/health/details` (signed-in); API responses are `no-store`; strict deny-all CSP and `no-referrer`. | H10 |
| 23 | Audit chains were unkeyed SHA-256 (rewritable by anyone with database access). | Set `AUDIT_HMAC_KEY` and new entries are HMACs; old chains still verify; a server without the key says so instead of passing the chain. | H11 |

## 4. Data safety and robustness

| # | Defect | Fix | Evidence |
|---|---|---|---|
| 24 | `POST /documents/delete-history` with `{}` (or a typo) **archived every document**; in the memory driver, deleting by `ids` also archived everything not in the list; invalid dates returned 500. | An explicit scope is required (`all`, `ids` or a date range); `ids` are never widened by dates; dates are validated and UTC-based. | H4, M9 |
| 25 | The orphan sweep looked at only the first 10,000 *non-archived* documents and deleted the files of the rest. | Uses every document id, archived or not. | H4 |
| 26 | Each status poll and progress update read and rewrote the whole document including an up-to-8 MB base64 copy of the original; originals above 8 MB were not kept at all; "retention" deleted the file after 2 hours while the base64 stayed forever. | Originals live outside the record (GridFS / a separate file), any size, with legacy inline files migrated at start-up; the working copy is rebuilt on demand; `findMeta` never carries the file; **permanent erasure** is a separate permission-guarded, logged action (`documents.purge`). | H4, M9 |
| 27 | Cancelling a running analysis did nothing (`isCancelled` was never read); a cancelled queued job left the document "queued" forever; two concurrent starts both queued; interrupted runs stayed "processing" in MongoDB. | Cooperative cancellation at checkpoints; a waiting job's record says it was cancelled; per-document start lock; interrupted runs are marked failed on start-up. | M9 |
| 28 | Shutdown cut every connection first, contradicting its own comment; no keep-alive timeout (502s behind load balancers). | Graceful drain with a grace period; `keepAliveTimeout` above common load-balancer idle timeouts; registry/revocation/change queues flushed. | code review |
| 29 | A crafted DOCX could inflate to gigabytes; any ZIP mentioning `word/` was accepted as a Word file; no page cap. | The archive's central directory is judged before unpacking (entries, ratio, total size); a Word file must carry `word/document.xml`; PDF page limit; wall-clock ceiling; images are not inlined. | H9 |
| 30 | The disk mirrors were written non-atomically with errors swallowed; the master-data audit mirror kept 1,000 entries. | Atomic writes, logged failures, a much larger audit mirror. | code review |
| 31 | The publisher-list depletion guard only tripped on an 80% drop. | Trips on a 20% drop. | docs |
| 32 | The spreadsheet-formula shield rewrote legitimate values such as `-5` and `+92-300-…`. | Neutralises formulas only. | H8 |

## 5. AI and chat

| # | Defect | Fix |
|---|---|---|
| 33 | The Anthropic provider sent an assistant prefill and `temperature: 0`, both rejected (HTTP 400) by the Opus 5 family, and its default model was `claude-opus-5`; it also had no trade-field extraction. | Request follows the current API (no prefill/sampling, `output_config.effort`, reasoning headroom, refusal handling), default `claude-opus-5-5`, and `extractTradeDoc` added. |
| 34 | Chat sent document passages and the compliance summary to an external provider whenever *a key existed*, even with `AI_PROVIDER=heuristic`; it had no timeout; it searched only the first 200 passages. | Honours the configured provider; request timeout; pages through every passage. |

## 6. Delivery, dependencies and tests

- **Dependencies:** `npm audit --omit=dev` — backend 14 → 3 moderate (the accepted `mammoth` → `sprintf-js` chain, see `SECURITY.md`); frontend 5 → **0** (Angular 20.3.34, DOMPurify). `pdfjs-dist` upgraded 3.11 → 4.10.38 (removes the high advisory and the `tar` chain).
- **CI** (`.github/workflows/ci.yml`): backend typecheck, **ESLint**, 12 suites, build and a high-severity audit; the persistence code against a real MongoDB; frontend unit tests and production build. Dependabot added.
- **Packaging:** `backend/Dockerfile`, `frontend/Dockerfile`, `deploy/nginx.conf` (CSP and security headers, SPA fallback, API proxy), `docker-compose.yml`.
- **Frontend:** fonts self-hosted and bundled by the build (`src/fonts`; no third-party request, works offline); the chatbot and login modal are deferred, taking the initial bundle from 652 kB to 574 kB (budget 650 kB); unit tests run headless (`npm run test:ci`), 17 passing.
- **Repository:** `LICENSE` (MIT, as the README states), `SECURITY.md`, `.editorconfig`, `.gitattributes`, stray empty root `package-lock.json` removed, docs corrected (Angular 20, 8 sources, 20% guard, single-instance deployment, environment names).

## 7. Verification at the time of writing

| Check | Result |
|---|---|
| Backend `tsc --noEmit` | 0 errors |
| Backend `eslint` | 0 errors (151 warnings, almost all `no-explicit-any` in legacy code) |
| Backend `npm test` | 12 suites pass, including `hardening` (H1–H11) |
| Backend `npm run test:mongo` (live MongoDB 8.3, standalone) | M1–M9 pass |
| Frontend `ng build` | succeeds, initial 573.7 kB, no external requests |
| Frontend `npm run test:ci` | 17 of 17 |

## 8. What this does *not* change (be explicit before a pilot)

1. **Regulatory sign-off is still required.** The rules remain `PENDING_BANK_SIGN_OFF`; this pass fixes how rules are evaluated and reported, not whether the rules are the bank's rules.
2. **Standalone MongoDB has no transactions.** A case write and its audit event are still two writes (reported and detected, not rolled back). Use a replica set if that gap is not acceptable.
3. **Document reading is bounded, not isolated.** Limits and timeouts stop a hostile file monopolising the process, but extraction still runs in-process. Containerise with memory limits and a restart policy (`docker-compose.yml` does restart on failure).
4. **Single API instance.** Queue, rate limiter, fraud history and file stores are in-process.
5. **No SSO/MFA; token in local storage** (mitigated by idle sign-out, revocation and CSP). See `SECURITY.md`.
6. **Scraped sources** (vessel trackers, web prices) and the payment-reconciliation store remain unsuitable for production, as in the integration inventory.
7. **Name matching is deterministic and conservative, not a substitute for a licensed screening vendor.** It now covers scripts and shortened names; it does not do phonetic/transliteration matching for Arabic or CJK, secondary identifiers (date of birth, address) or PEP data.
8. Set `AUDIT_HMAC_KEY`, `AUTH_SECRET` and `AUTH_USERS`, keep `ENABLE_DEMO_LOGIN=false`, and run `npm run test:mongo` against a pilot-like database before go-live.
