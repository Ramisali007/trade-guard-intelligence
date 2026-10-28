# Post-shipment workflow: baseline and gaps

**Date:** 2026-10-27. Written before any change for the connected pre-shipment to post-shipment feature. It records what the platform already does after an LC is approved, what is missing against the requested flow, and the design decisions that follow from it.

## 1. What already exists (reused, not rebuilt)

| Area | What is there | Where |
|---|---|---|
| Case record | One `TradeCase` document per request, with application versions, documents, findings, queries, approvals, `presentations[]`, `settlement`, `investigations[]`, an audit chain per case, optimistic revisions | `trade-cases/trade-case.types.ts`, `trade-case.service.ts`, `trade-case.repository.ts` |
| Lifecycle | `DRAFT → UNDER_REVIEW → … → AUTHORIZED_FOR_ISSUANCE → LC_ISSUED → DOCUMENT_EXAMINATION → DISCREPANCY_RESOLUTION → AWAITING_SETTLEMENT → SETTLED_MONITORING → CLOSED` (and refused/withdrawn/cancelled). Which action may start from which status is one table | `workflow.policy.ts` (`STATE_TRANSITIONS`, `ACTION_PERMISSIONS`) |
| Pre-shipment approval | The trade desk approves alone (`approvePreShipment`, status `AUTHORIZED_FOR_ISSUANCE`); the full flow has four reviews, a maker-checker approval and an issuance record | `trade-case.service.ts` |
| Presentation (post-shipment documents) | `recordPresentation` (bank staff only: a customer gets 403), `examinePresentation`, `applicantWaiver`, `decidePresentation` (ACCEPT / REFUSE with a rationale), settlement, investigation, closure | `trade-case.service.ts` |
| Examination rules | Ten deterministic rules against the **issued credit** (UCP 600, paraphrased): required documents, amount, currency, beneficiary, applicant, goods wording, quantity tolerance, transport ports, latest shipment date, presentation period. Plus the document analysis' own sanctions, TBML and fraud alerts and a price-drift check against the approved proforma invoice | `presentation-examination.ts` |
| Findings | Id, rule and version, category, severity, `blocking`, evidence (`observed` with document/page/quote), `expected`, `recommendedAction`, history, disposition, applicant waiver. Merged on re-run so decisions survive | `trade-case.types.ts`, `rule-helpers.ts` |
| Messages to the customer | Queries with subject, correction flag, linked findings; the customer answers with text and documents; AI-written mail exists for pre-shipment | `raiseQuery`, `respondQuery` |
| Roles | Customer, relationship manager, maker, checker, operations, credit, compliance, TBML, CCO, approver, issuer, settlement, auditor, administrator; the all-desks post-trade officer for the demonstration; per-role data scope; customers see only their own cases and no compliance/TBML findings | `authorization/permissions.ts` |
| Document store | Content-hash de-duplication, background analysis (AI model with a deterministic fallback), page units kept for evidence | `services/document.service.ts` |
| AI scrutiny (pre-shipment) | Per-document review and cross-document comparison, every issue grounded in quoted text, a second look before a difference becomes a finding | `preshipment-ai.service.ts`, `grounding.ts` |
| External verification | HS code against the official reference, port identity (UN/LOCODE), IMO check digit; per-claim provenance | `verification/` |
| Audit | Hash-chained event per change, verified per case | `utils/hash-chain.ts` |

## 2. Gaps against the requested flow

| # | Requested | State today | Consequence |
|---|---|---|---|
| G1 | A unique reference number is assigned when a pre-shipment case is approved | None. Only the case id (`TC-2026-00012`) | Nothing for the client to quote or click; no stable link to the approved documents |
| G2 | The client opens a **Post-Shipment** screen listing approved LCs with their references | No such screen. The client sees an undifferentiated case list | Client cannot start post-shipment |
| G3 | The **client** starts the application and uploads many documents | `recordPresentation` is bank-only; the customer is refused | The flow is inverted: the bank keys in what the client should submit |
| G4 | A draft application the client can review and then submit; submitting puts it in the officer's queue | A presentation exists only once the bank has recorded it (it starts the examination) | No draft, no client submission step |
| G5 | Works for a pre-shipment approval | `RECORD_PRESENTATION` needs `LC_ISSUED` and `examinePresentation` needs an `issuedLc`; pre-shipment stops at `AUTHORIZED_FOR_ISSUANCE` (the issuance record is a separate sandbox step) | A pre-shipment-approved case cannot be presented against at all |
| G6 | Compare post-shipment documents with the **approved pre-shipment documents** | Only invoice price drift against the proforma invoice | No check of parties, HS code, goods, quantity, origin, destination, incoterm against the approved set |
| G7 | Cross-document consistency (invoice, bill of lading, packing list, certificates, insurance) | Each document is checked against the credit, none against another | An invoice and a bill of lading can disagree unnoticed |
| G8 | Missing, incomplete, expired, possibly altered documents | Required types only; unreadable documents are flagged; nothing on expiry or alteration | Gaps in what is examined |
| G9 | AI-assisted scrutiny of the presentation, evidence-based | None for post-shipment (the pre-shipment AI is keyed to pre-shipment document types) | Officer has no assisted reading |
| G10 | Finding classes: blocking discrepancy, non-blocking discrepancy, warning, information | `blocking` flag and a severity, no named class | Officer cannot filter by what matters |
| G11 | Officer requests clarification or documents; client responds in the portal with corrected documents; versions kept | Queries exist and answer with documents, but the customer can attach only pre-shipment documents, and a corrected presented document does not replace the earlier one | The correction loop cannot be closed by the client |
| G12 | Re-examination after a correction | `EXAMINE_PRESENTATION` is allowed only from `DOCUMENT_EXAMINATION` | A discrepant presentation cannot be examined again |
| G13 | Accept, ask for clarification, or reject with a documented reason | ACCEPT / REFUSE with rationale exist; clarification is a separate query | Needs one coherent officer screen |
| G14 | One officer screen: submitted documents beside the approved ones, findings by class | Scattered across the case page tabs | Slow review |
| G15 | Traceability by the pre-shipment reference across approval, application, documents, findings, decision | Joined by case id only; the client has no reference | Needs the reference everywhere |
| G16 | Role-appropriate visibility | Customer sees documentary discrepancies, not compliance/TBML; this must hold for the new findings too | Must be tested for the new rules |
| G17 | Settlement and closure after acceptance | `recordSettlement` reads `issuedLc` and its issuer | Fails for a case with no issuance record |

## 3. Design decisions

1. **One case, one reference, one lifecycle.** A post-shipment application is a `Presentation` of the same `TradeCase`, not a second entity. This keeps the document store, findings, queries, audit chain, roles and queue code, and gives traceability for free. The new fields are additive.
2. **Reference number.** Assigned automatically when the pre-shipment approval is granted and recorded in the audit event: `PSR-<year>-<sequence>` derived from the case id, so it is unique without a second counter and can be recomputed for cases approved before this change. A post-shipment application carries `<reference>/P<n>`.
3. **Terms of record.** The credit examined against is the issued credit when one exists (its amended terms), otherwise the **approved pre-shipment application**, labelled as such on every finding. This is an assumption (see section 5): the platform's LC issuance is a sandbox step, and the requested flow starts post-shipment straight after approval.
4. **Client actions** are their own actions and permission (`SEND`-style, customer only): start, attach, remove, submit, respond. A draft touches no status; submitting moves the case to `DOCUMENT_EXAMINATION`, which is what puts it in the officer's "Presentations" queue.
5. **Corrections are versions.** A document of the same type in the same application replaces the earlier one (which stays, marked superseded); re-examination merges findings so decisions already taken survive.
6. **New verification is deterministic and evidence-based**, as separate rules in the registry (pending bank sign-off like every other rule): parties, goods, HS, quantity, value, dates, ports, origin and destination against the approved set; invoice, transport document, packing list, certificates and insurance against each other. A difference is reported with the two values and where each was read; a difference that is explained by a tolerance, a unit conversion or a legitimate amendment is not raised.
7. **AI assists, never decides.** AI findings are grounded in quoted text, are labelled as AI, and cannot be blocking on their own; an officer confirms or dismisses them. Sanctions/TBML engine alerts stay with compliance.
8. **Classes** are derived, not stored: blocking discrepancy, non-blocking discrepancy, warning, information.
9. **Client wording.** The client sees documentary discrepancies and the officer's requests in plain words; sanctions, TBML and officer-only verification stay hidden as they are today.

## 4. Out of scope for this increment

Real SWIFT messaging (MT700/MT750/MT734), real payment, core-banking limits, customs (WeBOC/PSW) retrieval of the declared documents, and any bank-specific document checklist beyond what is configured in the workflow policy.

## 5. Assumptions and approvals this feature depends on

- The examination rules paraphrase UCP 600 and apply only where the credit is subject to it; the bank's compliance function must sign off each new rule and confirm the tolerances.
- Examining against the approved application when no credit has been recorded as issued is a platform decision; the bank must confirm that this matches its procedure (normally the credit is issued first).
- The Pakistan-specific requirements for import documents (Form-I/Form-E style declarations, SBP/PSW references, GD numbers) are not modelled; they need the bank's procedure and a regulatory source before they can be rules.
- AI scrutiny of a customer's documents sends text to the configured model provider: provider approval and data-protection review are the bank's.

## 6. Status (2026-10-27)

Gaps G1–G17 are implemented for the demonstration environment; see `POST_SHIPMENT_REPORT.md` for what was built, the evidence and what still blocks production.
