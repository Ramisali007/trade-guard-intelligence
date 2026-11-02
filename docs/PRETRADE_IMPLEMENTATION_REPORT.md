# Pre-Trade Implementation, Test and Readiness Report

**Branch:** `audit/tbml-production-hardening` (uncommitted working tree; nothing committed or pushed)
**Date:** 2026-10-21
**Companion documents:** [Baseline audit](PRETRADE_BASELINE_AUDIT.md) · [Lifecycle architecture](TRADE_LIFECYCLE_ARCHITECTURE.md) · [Regulatory source register](REGULATORY_SOURCE_REGISTER.md)

> **Superseded in part (later the same day):** role-based access, portals, amendments, MongoDB verification and AI failure handling were completed afterwards. See [PILOT_READINESS_REPORT.md](PILOT_READINESS_REPORT.md) for the current state. Items below marked *not implemented* that are now done: LC amendments (item 12), per-role portals, and RM assignment scope.

---

## 1. Summary

The existing post-trade platform now has an **import LC lifecycle** around it. A customer request becomes a trade case. The case collects a versioned application and its documents, and deterministic checks plus the existing engines raise typed, evidenced findings. Four departments review it in parallel, with queries and corrections. A maker requests authorization and a different person approves. Issuance is recorded through a sandbox adapter, and the approved terms are handed to post-trade. The presentation is examined against those terms; discrepancies are waived by the applicant or refused; settlement is recorded; compliance may investigate; the case closes. Every step is enforced on the server and hash-chain audited.

Nothing in this work talks to a real bank system. Where a real integration would be needed (SWIFT, PSW, core banking, payments), there is a labeled sandbox or a manual, officer-attested record.

## 2. Existing functionality preserved

All eight pre-existing backend suites pass unchanged in intent. Two assertions were *added* to existing suites; none were weakened or removed. The 11 original UI routes load with zero console errors and zero failed requests for staff. The existing document, analytics, import, sanctions, customer and chat APIs behave as before for bank staff.

**One deliberate behavior change:** those workbench APIs now refuse the new `CORPORATE_CUSTOMER` role (403), so a customer login cannot read the shared document store.

## 3. New functionality

| Area | Delivered | Where |
|---|---|---|
| Trade case and repository | Memory+disk and MongoDB drivers; optimistic revisions; idempotent creation; hash-chained audit log | `trade-cases/trade-case.repository.ts` |
| Lifecycle and policy | 15 statuses; transition table; configurable roles, reviews, checklists, SoD, tolerances and thresholds (`TRADE_WORKFLOW_POLICY_FILE`, validated at start-up) | `trade-cases/workflow.policy.ts` |
| Pre-trade validation | Required fields, firm commitment, extraction readiness and honesty, 9 PI ↔ application comparisons with page-located evidence, PI arithmetic, dates, validity period, terms of import, party and jurisdiction screening, PI engine findings (TBML, export control, replay), PI reuse across cases, material change, usance, credit sufficiency | `trade-cases/pretrade-validation.ts` |
| Findings lifecycle | Stable keys; merge without overwrite; auto-resolve only for data findings; compliance findings wait for a disposition; reopen on changed evidence; re-review for affected departments | `trade-case.service.ts › mergeFindings` |
| Reviews, queries, approvals | Parallel department reviews with checklists and blockers; query OPEN → ANSWERED → RESOLVED/REOPEN; corrections as new versions; maker-checker bound to version and findings digest | `trade-case.service.ts` |
| Issuance and handover | Sandbox adapter; FI number/expiry rule (EPD CL 09/2026); terms snapshot; monitoring conditions carried forward | `trade-cases/lc-issuance.adapter.ts` |
| Post-trade examination | 10 UCP-referenced checks against the issued terms, price drift against the approved PI, existing TBML, fraud and sanctions alerts on presented documents; applicant waiver plus bank decision with SoD | `trade-cases/presentation-examination.ts` |
| Settlement, investigation, closure | Recorded settlement within credit limits; investigation open/close with status resume; closure gated on compliance findings | `trade-case.service.ts` |
| Roles and identity | 10 new roles; `customerRef` signed into the token; exact role names cannot be promoted by keyword (a `PLATFORM_ADMIN` string previously mapped to Chief Compliance Officer); demo desks for every role | `middleware/auth.middleware.ts`, `services/account-directory.ts` |
| Customer confidentiality | Customers never see compliance, TBML, regulatory or credit findings, compliance holds, investigations or the audit log (tipping-off) | `trade-case.service.ts › toView` |
| Rule registry | Every rule with its source, reference, effective/verified dates, interpretation status, pending sign-off and tests; `GET /api/trade-cases/rules` | `trade-cases/rule-registry.ts` |
| Frontend | Case queue with live counts and "needs my action"; new-request form; case workspace (overview, versions with diff, documents, findings with evidence, queries, reviews and approval, LC and post-trade, audit trail); role-based landing; staff-only route guard; lifecycle desks in sign-in | `frontend/src/app/pages/trade-cases/` |

## 4. Defects found and fixed during this work

| Defect | Impact | Fix |
|---|---|---|
| The fraud engine flagged "transaction reference reused with conflicting amount" when a packing list or B/L (no amount, recorded as 0) quoted the invoice number | A CRITICAL alert on ordinary presentations | Compare only two stated amounts (`fraud-engine.service.ts`) |
| The shipment-date regex captured the word after the label (`SHIPPED ON BOARD DATE: …` → "DATE") | Late-shipment and presentation-period checks could never run on that layout | Date-shaped capture (`trade-extractor.ts`); regression assertion added |
| The FX service retried the external feed on **every** call after a failure, waiting up to 6 s each time | Every report download and case action stalled on an offline or firewalled network; found by the browser test (case save took over 3 s or hung) | 10-minute back-off after a failure, one shared in-flight refresh, a non-blocking cached read for case actions (save now ~250 ms) |
| `normalizeRole('PLATFORM_ADMIN')` returned `CHIEF_COMPLIANCE_OFFICER` | Privilege escalation by role name | Exact canonical names first |
| The AI trade-extraction fallback was silent | Parser output was indistinguishable from model output | `engine.tradeExtractionSource` plus a blocking low-confidence finding |
| The customer overview said "every review is complete" while reviews were pending (UI) | Misleading status to the customer | Customer-specific wording |

## 5. Database and API changes

- **New collections** (MongoDB driver): `trade_cases` (unique `caseId`; unique partial `customerRef + clientRequestId`; indexes on customer/status and `documents.documentId`), `trade_case_events` (unique `caseId + seq`), `trade_case_counters`. **New files** (memory driver): `DATA_DIR/trade-cases.json`, `DATA_DIR/trade-case-events.jsonl`.
- **No change** to existing collections. Existing analyses gain an optional `engine.tradeExtractionSource`; older records without it read as "unknown legacy analysis" and require manual verification.
- **New API**: `/api/trade-cases/*` (see the architecture document §9).
- **Changed API**: `/documents`, `/analytics`, `/import`, `/customers`, `/sanctions` and `/chat` now require a staff role.
- **New config**: `TRADE_WORKFLOW_POLICY_FILE`, `LC_ISSUANCE_ADAPTER`; `AUTH_USERS` entries accept `customerRef`.

No migration is needed, and no destructive operation was performed on any data store.

## 6. Tests executed

All commands from `backend/` unless noted. Results are from the final run on 2026-10-21.

| Command | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run build` | success |
| `npx tsx src/__tests__/security.test.ts` | pass |
| `npx tsx src/__tests__/document-deduplication.test.ts` | pass (10 scenarios) |
| `npx tsx src/__tests__/analytics.test.ts` | pass |
| `npx tsx src/__tests__/integration.test.ts` | pass |
| `npx tsx src/__tests__/fraud-engine.test.ts` | pass (18 scenarios) |
| `npx tsx src/__tests__/import.test.ts` | pass (28/28) |
| `npx tsx src/__tests__/compliance-correctness.test.ts` | pass |
| `npx tsx src/__tests__/extraction-heuristics.test.ts` | pass (5 scenarios) |
| `npx tsx src/__tests__/trade-lifecycle.test.ts` | pass: rule unit checks, Scenarios A–E, isolation/HTTP |
| `frontend: npx ng build` | success, 0 warnings |
| `frontend: npx ng test --watch=false --browsers=ChromeHeadless` | 6/6 |
| Browser-driven lifecycle (headless Chrome over CDP, isolated backend) | customer form → case created with typed values; PI uploaded via the file input and parsed; Submit → UNDER_REVIEW; RM checklist and Approve → APPROVED; auditor sees an intact chain; customer `/dashboard` redirects to `/trade-cases`; 0 console errors, 0 failed requests |
| Route crawl as staff (11 original routes + new routes) | 0 console errors, 0 failed requests |

**Scenario coverage (`trade-lifecycle.test.ts`):**

- **A — successful request.** Idempotent creation; PI matches the application; parallel reviews; credit approval refused until a facility is recorded; maker-checker with SoD refusals (checker who did Trade Ops, platform admin); FI mismatch refused (422); sandbox issuance; presentation by staff only; examination finds exactly the real discrepancy (port of discharge); acceptance refused before the applicant waives and when the presenter decides; settlement above the credit or in "LIVE" mode refused; closure; the audit chain verifies, and an edited entry breaks it; customer refused the audit log.
- **B — amount mismatch.** USD 250,000 vs 245,000 with evidence on PI page 1; returned with a query; resolving an unanswered or not-yet-fixed query refused; reopen; correction saved as v2 with v1 preserved; finding resolved and kept; Trade Ops re-review required.
- **C — missing information.** Missing shipment date fixed; only Trade Ops re-runs, RM untouched; an independent compliance hold still blocks; the customer is not told about the hold.
- **D — compliance/TBML.** Iran origin raises a CRITICAL jurisdiction alert (sanctions engine); PI reuse across cases detected; neither is visible to the customer (also over HTTP); a trade maker cannot clear a compliance alert; confirmed escalation keeps blocking; only the approver may reject; a rejected case is frozen.
- **E — AI provider down.** The upload succeeds; extraction is recorded as a fallback with a note; a blocking low-confidence finding is raised; deterministic comparisons still ran; double revalidation adds no duplicate findings; an identical resend maps to the same stored document; manual verification clears it.
- **Isolation.** Another customer gets 404 (service and HTTP); 401 without a token; customers get 403 on documents and analytics; approval via a direct API call is refused.

**Not automated:** frontend component unit tests for the new pages (covered by the build and the browser test instead); load and concurrency tests; MongoDB-driver runs of the lifecycle suite (tests use the memory driver by design; the Mongo driver shares the same interface but has not been exercised against a live server in this session).

## 7. Readiness classification

| Level | Status | Evidence |
|---|---|---|
| **Local demonstration** | **Ready** | Builds clean; all suites pass; end-to-end UI walk-through works with demo desks. |
| **Functional integration testing** | **Ready, with caveats** | Complete lifecycle with server-enforced controls. Caveats: sandbox issuance and settlement; manual credit figures; the Mongo driver for trade cases is untested against a live server. |
| **Controlled pilot** | **Not yet** | Needs the bank-side items in §8, at minimum the policy sign-off, the TBML framework mapping, real user provisioning, a Mongo replica set, and a security review. |
| **Production (regulated banking)** | **Not ready** | Requires everything in §8 plus penetration testing, the regulator-facing approvals the bank's process demands, and real integrations. |

## 8. Production gaps and blockers

**Requires the bank (cannot be done in code alone)**

1. Compliance sign-off of every rule in the registry (`signOff` is `PENDING_BANK_SIGN_OFF` on all).
2. TBML framework (EPD CL 08/2025) annex retrieved through an authenticated channel and mapped to rules.
3. The current consolidated FE Manual Chapter 13 to replace the archived text (Rs 1.5 m threshold, validity periods, terms of import).
4. The bank's approved operating procedure written into `TRADE_WORKFLOW_POLICY_FILE`: departments, checklists, SoD, tolerances, hold and escalation thresholds.
5. Licensed UCP 600 / ISBP text for examiners; confirmation of the sanctions list set and provider licensing.
6. Data-handling approval before any confidential document is sent to an external AI provider. The default for regulated use should be the local engine, or a provider under contract.

**Requires external integration (interfaces exist; implementations do not)**

7. SWIFT (MT700/MT707) issuance channel behind `LcIssuanceAdapter`.
8. PSW Financial Instrument exchange (EDI).
9. Core-banking facility, limit and margin lookup, replacing the manual or sandbox record.
10. Payment and settlement status feed.
11. A malware scanner on uploads (currently magic-byte, size and extension validation only).

**Engineering work remaining**

12. LC amendments (MT707 equivalent): not implemented; changes after issuance are refused.
13. Other payment modes (contract/collection, advance payment, open account): not implemented.
14. MongoDB replica set and multi-document transactions for case + audit writes. The current order is case first, then audit; an audit-write failure is reported (`AUDIT_WRITE_FAILED`), not hidden.
15. Field-level manual correction of extracted values (today a reviewer verifies against the original and records `VERIFIED_MANUALLY`; extracted values are not edited in place).
16. Notifications (email/SMS) for queries and approvals.
17. Session tokens in `localStorage` (move to secure HTTP-only cookies); no token revocation list.
18. CI pipeline, container images, backup/restore runbook for the new collections, monitoring and alerting on `AUDIT_WRITE_FAILED`.
19. Existing app-shell header clips at phone widths (≈390 px); predates this work.
20. Encryption at rest for uploads and the disk store (relies on the host today).
