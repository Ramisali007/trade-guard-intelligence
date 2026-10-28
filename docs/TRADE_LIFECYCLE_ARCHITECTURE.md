# Import LC Lifecycle — Workflow, Architecture and Data Model

This document describes how an import letter of credit moves from the customer's request to case closure. It also describes how the new pre-trade module connects to the existing post-trade/TBML engine.

Code: `backend/src/trade-cases/`, `backend/src/routes/trade-cases.routes.ts`, `frontend/src/app/pages/trade-cases/`.

---

## 1. The trade case

Every import transaction is one **trade case** (`TC-<year>-<5 digits>`). The case does not copy documents or analyses. It **links** to the `DocumentRecord`s that the existing upload and analysis pipeline already stores, by document id. So the PI, the presented invoice and the B/L remain ordinary documents: each has its full post-trade analysis (sanctions, TBML, fraud/replay, pricing, arithmetic), and staff can open it from the case.

```
TradeCase
├── applicationVersions[]   LC application, versioned; never overwritten
├── documents[]             links → DocumentRecord (pre-trade PI/forms; post-trade presentation docs)
│                           with type, version, supersededBy, presentationId, duplicateUpload
├── findings[]              typed, owned, evidenced; stable key across revalidations; full history
├── reviews{RM,TRADE_OPS,COMPLIANCE,CREDIT}   status, checklist, decider, version decided on
├── queries[]               OPEN → ANSWERED → RESOLVED (or reopened); responses with corrections
├── approvals[]             maker request → checker decision; bound to application version + findings digest
├── creditFacility          officer-verified or SANDBOX figure; source always recorded
├── issuedLc                SANDBOX issuance: terms snapshot, FI number/expiry, adapter message
├── presentations[]         documents, examination result, decision
├── settlement              recorded only (SANDBOX or MANUAL_RECORD); never initiated
├── investigations[]        open/close with outcome; status resumes afterwards
├── statusHistory[]         every transition: from, to, when, who, why
└── validation              last run, rule set, PI extraction source, PKR equivalent
TradeCaseEvent (separate, append-only, SHA-256 hash-chained per case)
```

**Storage:** `trade_cases`, `trade_case_events` and `trade_case_counters` in MongoDB, using the same `STORAGE_DRIVER` as the rest of the platform. With the memory driver, cases live in `DATA_DIR/trade-cases.json` (written atomically with write-then-rename) and events in `trade-case-events.jsonl`. No existing collection or document schema was changed. Existing analyses are only extended: they gain an optional `engine.tradeExtractionSource`.

**Concurrency:** writes are serialised per case in-process. A revision number refuses a stale write from another process (409 `CONFLICT`). The `(customerRef, clientRequestId)` unique index makes case creation idempotent.

**Atomicity:** the case document, including its status history, is written in one operation. The hash-chained audit event is appended immediately after. If that append fails, the API reports `AUDIT_WRITE_FAILED` and the error is logged in full; it never fails silently. Multi-document transactions need a MongoDB replica set, which the current deployment does not require. See the production gap report.

## 2. States

```
DRAFT ──submit──▶ UNDER_REVIEW ◀──────────── answered / corrected ───────────┐
  │                 │  ├─ RETURN (query to customer) ─▶ PENDING_CUSTOMER_CLARIFICATION
  │                 │  └─ all reviews approved, no blockers ─ maker requests ─▶ APPROVAL_PENDING
  │                 │                                         checker returns ◀─┤
  │                 ▼                                                           ▼ checker approves
  │            REJECTED (senior approver)                          AUTHORIZED_FOR_ISSUANCE ─cancel─▶ CANCELLED
  └─withdraw─▶ WITHDRAWN                                                        │ issuer records (sandbox)
                                                                                ▼
                       ┌──────────── refused (awaiting re-presentation) ── LC_ISSUED
                       │                                                        │ presentation received
                       │                                                        ▼
                       │                                          DOCUMENT_EXAMINATION ── complying ─┐
                       │                                                        │ discrepant         │
                       └──────────────────────────────────── DISCREPANCY_RESOLUTION                 │
                                                                     │ accepted (applicant waived)   │
                                                                     ▼                               ▼
                                                              AWAITING_SETTLEMENT ◀──────── accepted
                                                                     │ settlement recorded
                                                                     ▼
                                                              SETTLED_MONITORING ──close──▶ CLOSED
   UNDER_INVESTIGATION: opened by compliance from any post-issuance state; returns to that state on close.
```

`STATE_TRANSITIONS` (in `workflow.policy.ts`) is the authoritative table of which action may start from which status. It is deliberately **not** configurable, because every guard depends on it. Terminal statuses (CLOSED, REJECTED, WITHDRAWN, CANCELLED) refuse every action except viewing.

**Reviews run in parallel.** RM, Trade Operations, Compliance and Credit each review the case independently. Which reviews are required is configurable (`requiredReviews`).

### Amendments (after issuance)

An amendment never edits the issued credit. It is a separate record on the case (`amendments[]`, `AM-01`, `AM-02`, …), and only one is open at a time. The case stays `LC_ISSUED` throughout.

```
UNDER_REVIEW ──(all required reviews APPROVED, no blocking amendment finding)──► APPROVAL_PENDING
      │ any review REJECT                                                            │ checker
      ▼                                                                              ▼
  REJECTED                                                          APPROVED ──(issuer, FI expiry = new expiry)──►
                                                                                     ISSUED_AWAITING_BENEFICIARY
                                                                                       │ accepted          │ refused
                                                                                       ▼                   ▼
                                                                                   EFFECTIVE       BENEFICIARY_REFUSED
```

- **Request** (customer, RM, maker): the changes and a reason. Changing the applicant is refused, as is a change that changes nothing.
- **Revalidation**: the proposed terms run through the pre-trade rules (dates, validity, screening of the parties, material change against the terms in force, usance, facility cover). Findings carry `stage: 'AMENDMENT'` and the `amendmentId`.
- **Reviews**: only the departments the changed fields concern (Trade Ops always; Compliance for parties, goods, amounts and routing; Credit for amounts, tenor and expiry). A department cannot approve while it owns a blocking finding on the amendment.
- **Maker-checker**: the maker submits. A different person approves, who must not be the maker or the Trade Ops reviewer (`amendmentApproverNotMaker`).
- **Issuance**: sandbox (`SBX-AMD-…`, "no SWIFT MT707 was sent"), by an issuer who is not the approver (`amendmentIssuerNotApprover`). The amended Financial Instrument expiry must equal the new LC expiry.
- **Effective only on beneficiary acceptance** (UCP 600 art. 10). Then `issuedLc.effectiveTerms` and `effectiveAmendmentNumber` are set and the FI expiry follows. `issuedLc.terms` (as issued) is never changed. A refusal leaves the terms in force unchanged.
- **Examination and settlement use `effectiveTerms`.**

## 3. Roles and separation of duties

Roles are defined in one permission registry (`backend/src/authorization/permissions.ts`, default deny). The full matrix, generated from the code, is in [RBAC_PERMISSION_MATRIX.md](RBAC_PERMISSION_MATRIX.md). Every action needs its permission (`ACTION_PERMISSIONS`) **and** the case's data scope: customers reach only their own customer reference, RMs only their assigned customers, bank staff the institution. Out-of-scope cases read as not found.

| Role | Typical actions |
|---|---|
| `CORPORATE_CUSTOMER` | Create, edit and submit **own** requests; attach documents; answer queries; withdraw; waive a discrepancy. Sees only their own cases, with no compliance, TBML or credit detail. |
| `RELATIONSHIP_MANAGER` | RM review for **assigned customers only**; may act for them (create, submit, answer). |
| `TRADE_MAKER` / `TRADE_CHECKER` / `OPERATIONS_DESK` | Trade Ops review, data findings, queries, presentation recording and examination. The maker requests approval; the checker may approve or decide a presentation. |
| `COMPLIANCE_REVIEWER` / `TBML_RISK_ANALYST` / `CHIEF_COMPLIANCE_OFFICER` | Compliance review, hold, dispositions of compliance/TBML/regulatory findings, investigations. |
| `CREDIT_REVIEWER` | Facility verification and credit review. |
| `SENIOR_APPROVER` | Authorise (checker), reject, cancel. |
| `LC_ISSUER` | Record issuance (sandbox). |
| `SETTLEMENT_OFFICER` | Record settlement (recording only). |
| `TRADE_AUDITOR` | Read-only, including internal findings and audit chains (`/audit` explorer). |
| `PLATFORM_ADMIN` | Accounts, dual-controlled access requests and platform health. **No** trade-case, document or compliance permission; a case id returns 403. |

Separation of duties (`policy.separationOfDuties`, all enforced in the service):

- the approver is not the maker who requested approval;
- the approver did not complete the Trade Ops review;
- the issuer is not the approver;
- whoever recorded a presentation cannot decide it;
- the settlement officer is not the issuer;
- an investigation is closed by someone other than its opener;
- an amendment is approved by neither its maker nor its Trade Ops reviewer, and issued by someone other than its approver.

**Field visibility** is decided by the server (`toView`). Compliance, TBML and regulatory findings need `tradecase.findings.internal.view`; credit blockers and the facility record need `tradecase.credit.view`; investigations need `tradecase.investigation.view`. Without the permission, a finding becomes a "restricted" placeholder, so a blocker is visible without its content. Customers do not learn that such findings exist.

The existing workbench routes (`/documents`, `/analytics`, `/import`, `/customers`, `/sanctions`, `/chat`) each require their own permission (for example `documents.read`, `analytics.read`). Customers, RMs, settlement officers and administrators do not have them.

## 4. Gates

| Gate | What must hold |
|---|---|
| Department **APPROVE** | Applicable checklist ticked; no blocking finding owned by the department; its own queries resolved. Credit additionally needs a facility record; Compliance needs screening to have run. |
| **Request approval** (maker) | Every required review APPROVED **on the current application version**; no blocking pre-trade finding; no open or answered query; facility recorded. |
| **Approve** (checker) | The same checks re-run. The application version and the findings digest are unchanged since the request (otherwise refused); SoD. |
| **Issuance** | An approved authorisation on the current version; FI number in the prescribed format; FI expiry equals LC expiry; SoD. |
| **Accept presentation** | Every documentary discrepancy waived by the applicant; no other blocking finding on the presentation; SoD. |
| **Close** | No open compliance, TBML or regulatory finding. |

"Blocking now" means: a blocking finding that is OPEN, **or** one dispositioned as `CONFIRMED_ESCALATED` / `DISCREPANCY_UPHELD`. A confirmed sanctions hit keeps blocking after its disposition.

## 5. Findings: how evidence is kept and nothing is overwritten

Each rule produces a candidate with a **stable key** (rule id + subject). On every revalidation:

- A candidate with an existing key **updates** that finding. If the observed values changed, a history entry is added; if the finding had been resolved, it **reopens**.
- A data finding (missing, inconsistent, low-confidence…) that no longer triggers becomes **RESOLVED_BY_REVALIDATION**. It is kept, with its history.
- A **compliance, TBML or regulatory** finding that no longer triggers stays **OPEN** with the note "no longer triggered — awaiting disposition". Only its owner can clear it.
- A dispositioned pre-trade finding whose evidence changes **reopens**.
- A new or reopened blocking finding sends an already-approved department back to `RE_REVIEW_REQUIRED`.

Application changes create a new version, invalidate any pending approval, and put the **affected** departments back to re-review. For example, a date change touches Trade Ops only; a beneficiary change touches Trade Ops, Compliance and RM.

A query is **answered** when the customer replies, and **resolved** only by the asking department, once its linked findings are no longer open. Answering a query never clears a compliance hold.

## 6. How pre-trade connects to the existing post-trade engine

| Existing component | Reused for |
|---|---|
| Upload, magic-byte check, dedup (`DocumentService.createFromUpload`) | Every case document. An identical resend maps to the same stored document and is flagged `duplicateUpload`. |
| Extraction and analysis pipeline (`AnalysisService`, `TradeComplianceExtractor`) | Reads the PI and presented documents. `analysisEvents.settled` triggers case revalidation. |
| Sanctions engine | Screens the application parties as typed, plus parties named on any document. |
| TBML, pricing, export-control and fraud/replay engines | Their alerts on the PI become pre-trade findings; their alerts on presented documents become post-trade findings. |
| Arithmetic engine | PI arithmetic. |
| Document analysis screen (`/analysis/:id`) | "Full analysis" link from every case document. |

**Cross-stage linkage:**

- The issued credit snapshots the approved terms. Accepted amendments produce `effectiveTerms`, and the snapshot is kept.
- Examination compares the presented documents against **the terms in force**, not the application.
- The invoiced unit price is compared with the **approved PI** (`TBML-POST-PRICE-DRIFT`).
- PI reuse across cases is detected, by file and by PI number.
- Pre-trade findings accepted as risks are carried into the issuance handover as **monitoring conditions**.
- Pre-trade and post-trade findings live side by side on one case, each with its own history.

## 7. AI and extraction honesty

- The analysis records `tradeExtractionSource`: `AI_MODEL`, `DETERMINISTIC_PARSER` (no model configured) or `DETERMINISTIC_FALLBACK_AFTER_AI_FAILURE`.
- A fallback (or an older analysis with unknown provenance) raises a blocking **LOW_CONFIDENCE_EXTRACTION** finding. It is cleared only by a reviewer's `VERIFIED_MANUALLY` disposition.
- A field that could not be extracted is reported as *unverifiable*, never as a match.
- An AI-assisted finding is labelled with its origin and carries the text it rests on. No model output can change a status, approve anything, or override a deterministic rule.
- Uploaded documents are data only: nothing in a document is executed or treated as an instruction.
- **Prompt injection is contained.** When the model's parties, countries or ports differ from what the text says, the text's values are screened too and the worse result is kept. The disagreement is written to the evidence package. A "decision" or score in model output is ignored.
- **Failures are counted.** A malformed, truncated, rate-limited (429), failing (5xx), timed-out or unreachable model call falls back to the deterministic parser, marks the run degraded and records the reason.

## 8. External integrations (what is real)

| Integration | State |
|---|---|
| SWIFT / LC issuance | **Not integrated.** `LcIssuanceAdapter` interface; only `SandboxLcIssuanceAdapter` exists (`SBX-LC-…`; "no SWIFT MT700 was sent"). `LC_ISSUANCE_ADAPTER` set to anything else fails with 501. |
| PSW Financial Instrument | **Not integrated.** The FI number and expiry are validated against the circular's format and recorded; nothing is transmitted. |
| Core banking / credit limits | **Not integrated.** The credit reviewer records the facility with `verificationSource` = `MANUAL_OFFICER_VERIFIED` or `SANDBOX_DEMO_DATA`; both are shown on screen. |
| Payments / settlement | **Never initiated.** Only `SANDBOX` or `MANUAL_RECORD` records. |
| Sanctions lists | Synced public feeds (existing sync engine). Licensing and the approved list set must be confirmed by the bank. |
| FX | Public FX feed with a baseline fallback. It is read from cache on case actions; a failed fetch is retried at most every 10 minutes. |

## 9. API

All under `/api/trade-cases`, behind authentication and a permission guard. Every action checks the permission, data scope, status and separation of duties in the service.

```
GET    /                         list (customer: own only)          GET  /dashboard   queue counts
POST   /                         create (idempotent clientRequestId) GET  /rules       rule registry (staff)
GET    /:id                      case (role-filtered view)          GET  /:id/audit   events + chain check (staff)
POST   /:id/application          new application version            POST /:id/documents  attach (multipart)
GET    /:id/documents/:link/file original file                      POST /:id/submit | /withdraw | /revalidate
POST   /:id/reviews/:department  APPROVE | RETURN | HOLD | RECOMMEND_REJECT
POST   /:id/queries              raise      POST /:id/queries/:q/respond | /resolve
POST   /:id/findings/:f/disposition         POST /:id/findings/:f/applicant-waiver
POST   /:id/credit-facility      POST /:id/approval/request | /approval/decision | /reject | /cancel
POST   /:id/issuance             POST /:id/presentations (multipart) | /presentations/examine | /presentations/decision
POST   /:id/settlement           POST /:id/investigations | /investigations/close     POST /:id/close
POST   /:id/amendments           request      POST /:id/amendments/reviews/:department   APPROVE | REJECT
POST   /:id/amendments/submit | /amendments/decision | /amendments/issuance | /amendments/beneficiary-response
GET    /audit-overview           every case in scope with its chain verdict (audit.overview)
```

Outside the case API: `GET /api/workspace` returns the signed-in user's role, permissions, screens and work queues. `/api/admin/*` covers users, access requests and their decisions, status, session revocation, the identity log, the RBAC matrix and system health.

## 10. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `TRADE_WORKFLOW_POLICY_FILE` | unset (built-in default) | JSON merged over the default policy (top-level keys replace). Validated at start-up; an invalid file stops the server. |
| `LC_ISSUANCE_ADAPTER` | `sandbox` | Only `sandbox` is implemented. |
| `AUTH_USERS` | — | Provisioned users; may include `customerRef` for customer logins. |
| `ENABLE_DEMO_LOGIN` | on outside production | Demo desks for every lifecycle role. |
