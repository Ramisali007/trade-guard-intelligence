# Baseline Audit — Pre-Trade Extension

**Branch:** `audit/tbml-production-hardening` (HEAD `744c1e6`, plus uncommitted working-tree changes, which are kept as they are)
**Audit date:** 2026-10-21
**Scope:** the repository as it stands before the pre-trade lifecycle work.

---

## 1. What the repository actually is

The historical description supplied with the task does not match the code in this repository. Each point was checked against the code.

| Claim | Verified state |
|---|---|
| Python backend | **False.** The backend is Node.js 20+ / Express 4 / TypeScript (`backend/src`). There are no `.py` files anywhere in the repository. |
| Groq via an OpenAI-compatible interface | **Partly true.** `ai/providers/openai.provider.ts` works with any OpenAI-compatible endpoint, and its *default* base URL is Groq. The local `.env` actually points at Gemini (`gemini-flash-lite-latest`). An Anthropic provider and a local `heuristic` engine also exist. |
| Model `openai/gpt-oss-20b` | **False.** The code default is `openai/gpt-oss-120b` (`config/index.ts`). |
| Web interface | Angular 20 standalone components, signals and SCSS (`frontend/src`). |
| Database | Two drivers behind one interface: MongoDB and an in-memory store mirrored to disk (`STORAGE_DRIVER`). There is no migration framework; schema changes are additive, with a startup pass in `MongoDocumentRepository.init`. |
| Pre-trade / LC workflow | **Missing.** There is no trade-case entity, no LC application, no review, query, maker-checker or issuance code in either app (`grep` for pretrade, trade case, LC application and maker-checker finds nothing). |

## 2. Baseline health (before any pre-trade change)

| Check | Command | Result |
|---|---|---|
| Backend typecheck | `npm run typecheck` | Pass (0 errors) |
| Backend build | `npm run build` | Pass |
| Security suite | `npx tsx src/__tests__/security.test.ts` | Pass |
| Deduplication suite | `…/document-deduplication.test.ts` | Pass (10 scenarios) |
| Analytics suite | `…/analytics.test.ts` | Pass |
| Integration suite | `…/integration.test.ts` | Pass |
| Fraud engine suite | `…/fraud-engine.test.ts` | Pass (18 scenarios) |
| Import suite | `…/import.test.ts` | Pass (28/28) |
| Compliance-correctness suite | `…/compliance-correctness.test.ts` | Pass |
| Extraction heuristics suite | `…/extraction-heuristics.test.ts` | Pass (5 scenarios) |
| Frontend build | `npx ng build` | Pass |
| Frontend unit tests | `npx ng test --watch=false --browsers=ChromeHeadless` | Pass (6/6, format helpers only) |
| Runtime smoke (isolated instance, all 9 samples) | upload → analysis → reports, plus 11 UI routes in headless Chrome | All completed; 0 console errors, 0 failed requests |

There are no pre-existing failures to carry forward. The defects fixed in the previous session are listed in §5.

**AI provider connectivity:** not exercised live. Sending sample documents to the configured external model needs explicit owner consent (see the privacy rule in the task). The provider adapter, timeout and retry logic were reviewed statically.

## 3. Implementation inventory

| Capability | Status | Evidence |
|---|---|---|
| Document upload with magic-byte validation, size limits and dedup by `(customerId, contentHash)` | Working, reusable | `middleware/upload.middleware.ts`, `services/document.service.ts`, dedup suite |
| PDF/DOC/DOCX extraction and OCR for scanned PDFs | Working (OCR is slow: ~77 s on the scanned sample) | `document-processing/extractors/*` |
| Structured trade-field extraction (AI first, deterministic fallback) | Working; the fallback was improved last session | `ai/trade-extractor.ts`, extraction suite |
| Sanctions screening (OFAC, UN, EU, UK, SBP list; point-in-time) | Working | `compliance/sanctions/*`, `temporal-sanctions.service.ts` |
| TBML indicators: pricing, quantity, routing, customer–product mismatch | Working | `compliance/tbml.service.ts`, `pricing/*`, `behavioral/*` |
| Fraud and replay: invoice / B/L / container reuse, UETR, payment tiers | Working | `compliance/fraud/*`, fraud suite (18) |
| Arithmetic and document-integrity validation | Working | `compliance/math-integrity.service.ts` |
| Explainable risk score and decision (ALLOW / REVIEW / BLOCK) | Working, per *document* | `compliance/risk-scoring.service.ts` |
| Cross-document comparison | Working, ad hoc (no persistent case) | `services/comparison.service.ts`, `POST /documents/compare` |
| Officer override of a document decision | Working; officer identity comes from the token | `POST /documents/:id/override` |
| Authentication: HMAC tokens, scrypt passwords, demo accounts | Working | `middleware/auth.middleware.ts`, `services/account-directory.ts` |
| RBAC | Working but **coarse**: 4 roles, and any authenticated user can read every document | `routes/*.routes.ts` |
| Customer tenancy | **Partial.** `customerId` exists on documents but is chosen by the client and never enforced on reads | `document.controller.ts` |
| Audit | Partial: document analysis/import events and a compliance-store audit log; no hash-chained, case-level trail | `document.repository.ts`, `compliance-store.ts` |
| Trade case / LC lifecycle / state machine | **Missing** | — |
| LC application (structured, versioned) and PI ↔ application comparison | **Missing** | — |
| RM / Trade Ops / Credit / Compliance review checkpoints | **Missing** | — |
| Queries and corrections | **Missing** | — |
| Maker-checker, separation of duties | **Missing** | — |
| LC issuance record and handover to post-trade | **Missing**; no SWIFT/PSW integration of any kind | — |
| Examination of a presentation against issued LC terms | **Missing.** The existing post-trade engine screens documents but never compares them with LC terms. | — |
| Settlement / investigation / case closure | **Missing** | — |
| Versioned regulatory rule registry | **Missing.** `regulatory/regulatory-citations.ts` holds static citations only. | — |
| Core banking / credit-limit / SWIFT / PSW adapters | **Absent** (blocked by external access) | — |
| Docker / CI / migrations | **Absent** | — |
| Potentially redundant | `GET /documents/:id/file` and `/source-file` are the same handler; `/delete-history` duplicates `DELETE /history` | `routes/documents.routes.ts` |

## 4. Gap matrix

| Requirement | Existing | Evidence | Gap | Dependency | Priority | Approach | Verification |
|---|---|---|---|---|---|---|---|
| Central trade case | None | — | No entity links PI, application, findings, approvals and post-trade documents | Document repository | Critical | New `trade-cases` module; repository with memory+disk and Mongo drivers; links existing `DocumentRecord`s by id | Lifecycle E2E test |
| Configurable lifecycle | None | — | No states, no validated transitions | Case | Critical | State table and permissions in a policy object, overridable by `TRADE_WORKFLOW_POLICY_FILE` | Transition and negative tests |
| Import request + structured LC application with versions | None | — | — | Case | Critical | Versioned application on the case; every edit is a new version, nothing is overwritten | Scenario B/C tests |
| Document intake for a case | Upload pipeline exists | `document.service.ts` | Not tied to a case, no document-type versions | Upload pipeline | High | Reuse `createFromUpload`; record document type, version and supersession on the case | Integration test |
| PI ↔ application comparison with evidence | None | — | — | Extraction (`tradeCompliance`) | Critical | Deterministic comparison rules; evidence is located in the PI's own units (page + snippet) | Scenario B test |
| Typed findings and their lifecycle | Per-document decision reasons only | `risk-scoring.service.ts` | No categories, owners, dispositions or history | — | Critical | Finding model with stable keys; revalidation merges instead of overwriting; compliance findings never auto-clear | Scenario C/D tests |
| Department reviews and checklists | None | — | — | Roles | Critical | Review per department, with policy checklists tied to rule IDs | Scenario A test |
| Queries and corrections | None | — | — | Findings | High | Query lifecycle: OPEN → ANSWERED → RESOLVED; "answered" is not "resolved" | Scenario B/C tests |
| Maker-checker / SoD | None | — | — | Roles | Critical | Policy-driven SoD checks inside the service, not the UI | Negative tests |
| Roles for the lifecycle | 4 roles | `auth.middleware.ts` | No customer, RM, maker, checker, credit, approver, issuer or settlement roles; `normalizeRole` maps any "ADMIN" string to Chief Compliance Officer | Auth | Critical | Extend roles; exact-match role names before legacy heuristics; add demo accounts | Security tests |
| Customer data isolation | None on reads | `routes/documents.routes.ts` | A customer user could read every document | Auth | Critical | Customer role is confined to its own cases; staff-only guard on existing routes | Negative tests |
| Pre-trade compliance / TBML | Engines exist for documents | `sanctions/*`, `tbml.service.ts` | Not run against the application's parties, and not linked to a case | Sanctions, TBML | High | Screen application parties with the existing `SanctionsEngine`; lift the PI's existing TBML/fraud results into case findings | Scenario D test |
| Credit check | None; no core-banking access | — | — | External | High | Manual, officer-verified facility record, labelled as not system-verified | Scenario A test |
| Issuance + handover | None | — | — | External SWIFT/PSW | Critical | Sandbox issuance adapter (labelled SANDBOX); FI number/expiry rule (FE Manual Ch.13 ¶6B(viii)); handover snapshot | Scenario A test |
| Presentation examination against LC terms | None | — | — | Extraction | High | Deterministic examination rules referencing UCP 600 articles (paraphrased) | Scenario A test |
| Discrepancy waiver, settlement, investigation, closure | None | — | — | Case | High | Applicant waiver plus bank decision (SoD), manual/sandbox settlement record, investigation open/close | Scenario A/D tests |
| Hash-chained case audit | None | — | — | Case | High | Append-only event log with a SHA-256 chain; verification endpoint | Audit test |
| Rule registry with sources | None | — | — | Sources | High | `trade-cases/rule-registry.ts`, sources in `docs/REGULATORY_SOURCE_REGISTER.md` | Registry test |
| AI failure honesty in extraction | Silent fallback | `analysis.service.ts` | No record of whether trade fields came from the model or the fallback | AI | High | Record the extraction source; a model failure raises a low-confidence finding | Scenario E test |
| Frontend for the lifecycle | None | — | — | API | Critical | Case list/queue, new request, case workspace | Build + headless UI crawl |

## 5. Defects already fixed before this work (previous session)

These are kept, with their regression tests:

- Fraud engine false positives: supporting documents citing an invoice read as invoice reuse; B/L and container reuse flagged within one shipment.
- Heuristic extraction errors: truncated invoice numbers, weight read as value, spec strings read as line items, document-type misclassification.
- Arithmetic check ignoring printed price precision.
- Customer store path depending on the working directory, which let test runs write to real data.
- MongoDB 16 MB limit breached by inline file copies.
- A hardcoded "Screening Cleared" label in the UI.
- Chat with no rate limit.
- Database host details exposed to all roles.
