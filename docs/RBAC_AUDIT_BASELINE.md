# RBAC and Portal Audit — Baseline Before Hardening

**Date:** 2026-10-21 · **Branch:** `audit/tbml-production-hardening` (HEAD `744c1e6`, uncommitted tree preserved)
**Scope:** the repository *as left by the previous pre-trade work*, independently re-examined. Statements in earlier reports were treated as claims to verify, not facts.

## 1. Baseline test run (before any change in this task)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| 9 backend suites (security, dedup, analytics, integration, fraud ×18, import 28/28, compliance-correctness, extraction-heuristics, trade-lifecycle) | all pass |
| Pre-existing failures | none |

Passing tests did **not** mean RBAC was sound: several of the defects below were *encoded* by tests (for example, `security.test.ts` asserted that the unknown title "Front Desk Clerk" maps to the privileged `OPERATIONS_DESK` role).

## 2. How authorization actually worked

| Layer | Mechanism | Problem |
|---|---|---|
| Identity | HMAC token carrying `role`; `authenticate` trusted the role in the token for its whole 12 h life | No server-side re-check: a role change or a disabled account had no effect until the token expired. There was no runtime user management at all. |
| Role mapping | `normalizeRole`: exact canonical names first, then **substring keywords**, then **default `OPERATIONS_DESK`** | Unknown or unrecognised roles were silently granted a privileged desk. `"System Admin"` still mapped to Chief Compliance Officer via the keyword `ADMIN`; only the exact name `PLATFORM_ADMIN` had been fixed. |
| Route guards | `requireRole([...])` role-name lists in `documents.routes.ts` and `import.routes.ts`; `requireStaff` (= every role except the customer) on `/documents`, `/analytics`, `/import`, `/customers`, `/sanctions`, `/chat` | Scattered role checks; coarse "staff" bucket. |
| Trade cases | `policy.permissions` (action → role list) and `policy.reviewRoles` inside the service | A second, separate permission vocabulary. |
| Field visibility | `toView`: customer vs everyone else | Every staff role saw every sanctions match, TBML finding, credit facility and investigation. |
| Data scope | customer: own `customerRef`; **everyone else: all cases** | No RM assignment scope. |
| Frontend | `isCustomer()`, `canOverrideDecisions()` etc.; one menu, one flyout set, one dashboard for all staff | Same portal for a settlement officer, a credit reviewer, an auditor and a compliance officer. |
| Integration key | `X-API-Key` → synthetic user with role **CHIEF_COMPLIANCE_OFFICER** | A machine credential carried full compliance powers, including dispositions on trade cases. |

## 3. Role inventory (as found)

| Role | Intended responsibility | Data scope found | Backend permissions found | Frontend found | Gaps |
|---|---|---|---|---|---|
| `CORPORATE_CUSTOMER` | Own import requests | own `customerRef` ✓ | create/edit/submit/respond/waive ✓ | trade cases only ✓ | — (correctly isolated) |
| `RELATIONSHIP_MANAGER` | Assigned customers' requests, RM review | **all cases** | RM review, act for customer, **whole document store, analytics, chat** | full staff portal | No assignment scope; over-broad workbench access |
| `TRADE_MAKER` | Scrutiny, maker | all | Trade Ops review, request approval, presentations | full staff portal | OK in the workflow; workbench not least-privilege |
| `TRADE_CHECKER` | Independent checker | all | Trade Ops review **and** approve | full staff portal | SoD relied on a per-case rule only (correct but undocumented) |
| `OPERATIONS_DESK` | Post-trade documentary ops, feed sync | all | Trade Ops review, presentations, feed sync, master data write | full | **Default for unknown roles** (escalation) |
| `CREDIT_REVIEWER` | Credit review | all | facility record, credit review | full staff portal | Could read the whole document store, sanctions data, analytics, chat |
| `COMPLIANCE_REVIEWER` | Compliance review | all | compliance review, dispositions | full | No demo account; no investigation authority (correct) |
| `TBML_RISK_ANALYST` | Compliance/TBML investigation | all | compliance review, dispositions, investigations, document override | full | — |
| `CHIEF_COMPLIANCE_OFFICER` | Compliance head | all | as analyst plus document deletion, feed sync, master data write | full | Target of the keyword escalation |
| `SENIOR_APPROVER` | Authorize, reject, cancel | all | approve/reject/cancel/close | full staff portal | Saw all compliance detail (acceptable for the approver); workbench over-broad |
| `LC_ISSUER` | Record issuance | all | issuance | full staff portal | Saw all compliance and credit detail and the whole document store |
| `SETTLEMENT_OFFICER` | Settlement records | all | settlement | full staff portal | Same over-exposure |
| `TRADE_AUDITOR` | Read-only audit | all | read; audit log | full staff portal | Read-only by omission, not by design; no audit explorer |
| `PLATFORM_ADMIN` | System administration | **all trade cases (read)** | **trade-case VIEW, whole document store, analytics, sanctions, chat** | full staff portal | **Business data exposed to technical administration; no user-management capability at all** |
| API key (synthetic) | Machine integration | all | **as CHIEF_COMPLIANCE_OFFICER** | n/a | **Machine credential with compliance authority** |

## 4. Other confirmed gaps

| Area | Finding |
|---|---|
| Audit chain | Tamper, reorder and middle-deletion were detected, but **truncation (removing the newest events) was not**: nothing anchored the chain head outside the log. |
| Sessions | No revocation; no `sessionVersion`; tokens were not re-checked against an account record. |
| MongoDB | Trade-case repository never run against a live server; transaction support assumed absent, not verified. |
| Live AI | Never exercised; malformed output, timeouts and rate limits were not tested at the provider level. |
| Amendments | Not implemented (changes after issuance refused). |
| Dashboards | One generic trade-case dashboard; the post-trade workbench dashboard is identical for every staff role. |
| Default deny | No mechanism ensured a new route carried an authorization rule. |

## 5. Verdict

The pre-trade lifecycle's **workflow** controls (states, maker-checker, holds, customer isolation) were real and tested. The **platform-wide RBAC** was not: it was a coarse customer/staff split, with privileged defaults and an administrator who could read business data. The hardening in this task addresses each row above; see `docs/RBAC_PERMISSION_MATRIX.md` and `docs/PILOT_READINESS_REPORT.md`.
