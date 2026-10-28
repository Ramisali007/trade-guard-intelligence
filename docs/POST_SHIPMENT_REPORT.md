# Post-shipment workflow: implementation report

**Date:** 2026-10-27. Read with `POST_SHIPMENT_BASELINE.md` (what existed, the gaps G1–G17 and the design decisions).

## 1. Verdict

The connected flow **works end to end in the demonstration environment and is covered by automated and browser evidence** (section 5). It is **not ready for production**: the new examination rules are unsigned, the platform's own "credit of record" assumption has to be confirmed by the bank, there is no real SWIFT, customs or payment connection, and the AI step needs provider approval (section 7). "Complete" here means: every step requested is implemented and demonstrated; it does not mean bank-approved.

## 2. What now happens

1. **Approval gives a reference.** `PSR-<year>-<sequence>`, derived from the case id (so it can be recomputed for cases approved earlier); shown to the client, on every officer screen and in the audit trail.
2. **Client: Post-Shipment screen** (`/post-shipment`). Lists only the client's own approved requests, by reference, with the state of any application. Starting an application on a request that is not approved is refused by the API.
3. **Client: application** (`/post-shipment/:id`). Choose several files at once; each gets a document type (guessed from the name, changeable); upload; the page shows which required documents are present; remove a document while it is a draft; submit with a confirmation. A byte-identical file is refused with a plain message; a changed file is accepted as a new version. A draft is invisible to the bank until submitted.
4. **Officer: queue and review** (`/trade-cases/:id/post-shipment`). Submitted documents beside the approved pre-shipment documents, a field-by-field comparison (what was approved, what was presented, agree/differ, where each value was read), and findings grouped by class.
5. **Scrutiny.** Deterministic rules (section 3), an optional **AI-assisted reading** (advice with quoted evidence), and the officer's own findings.
6. **Resolution loop.** The officer ticks findings and asks the client for a clarification or a corrected document; the client replies in the portal with text and replacement documents (new version of the same type, earlier version kept and marked replaced); "Send to bank" or the reply makes them visible; the officer sees "documents changed since the last examination" and re-examines; earlier decisions on findings survive the re-run.
7. **Decision.** Accept or refuse, with a mandatory written reason; non-blocking items may be marked verified manually; blocking items need the applicant's waiver or a correction. Settlement and closure follow as before.
8. **Traceability.** The case id, the reference, documents (with hashes and versions), findings (rule, version, evidence), queries and the decision all hang off one case; every change is a hash-chained audit event.

## 3. Rules and classes

Classes (derived, not stored): **blocking discrepancy**, **non-blocking discrepancy**, **warning**, **information**.

| Rule | Checks |
|---|---|
| EXM-REQUIRED-DOCS, INV-AMOUNT/CURRENCY/BENEFICIARY/APPLICANT/GOODS, QUANTITY, TD-PORTS, TD-SHIPDATE, PRESENTATION-PERIOD | Existing ten rules, now against the credit of record |
| EXM-XD-PARTIES | Seller and buyer across invoice, transport document, packing list, insurance and the approved application |
| EXM-XD-GOODS, XD-HS, XD-QUANTITY, XD-VALUE | Goods description, HS code, quantity and unit (converted before comparing, tolerance applied), value against the approved application |
| EXM-XD-ROUTE | Loading and discharge port, origin and destination, incoterm (invoice only) |
| EXM-XD-DATES, XD-REFERENCE | Date order across documents; reference numbers that must agree (the transport document's own numbers are not treated as invoice numbers) |
| EXM-XD-INSURANCE, XD-COMPLETE | Insurance cover against value; completeness, expiry and unreadable documents |
| EXM-XD-BASIS | Information: states which approved terms were used |
| EXM-MANUAL | Officer-entered finding |
| AI-POST-XDOC | AI reading: advice only, grounded in quoted text, never blocking |

Every difference carries both values and their source document and page. A difference explained by a unit conversion, a tolerance or a missing value is not raised as a violation. Findings that concern compliance (for example an internal regulatory concern) are internal-only: the client never sees them (no tipping-off).

## 4. Files

Backend: `trade-cases/post-shipment-verification.ts` (new), `trade-case.service.ts`, `trade-case.types.ts`, `workflow.policy.ts`, `rule-registry.ts`, `presentation-examination.ts`, `preshipment-ai.service.ts`, `authorization/permissions.ts`, `workspaces.ts`, `services/account-directory.ts`, `controllers/trade-case.controller.ts`, `routes/trade-cases.routes.ts`.
Frontend: `pages/post-shipment/*` (list, application, review), `services/post-shipment.service.ts`, `models/post-shipment.models.ts`, `shared/stage.ts`, `shared/document-type.ts`, `app.routes.ts`, trade-case workspace and list pages.
Related changes made in the same session (user requests): Clear history for the trade maker, clickable KPI boxes, one all-desks post-trade profile, stage filtering of lists and screens, customer-side upload fixes. Endpoints are in `backend/src/routes/trade-cases.routes.ts`; permissions in `docs/RBAC_PERMISSION_MATRIX.md` (regenerated).

## 5. Evidence (run 2026-10-27)

| Check | Result |
|---|---|
| Backend `npm run build`, `tsc --noEmit` | clean |
| Backend lint | 0 errors, 146 warnings (earlier baseline 144; all `no-explicit-any` style) |
| Backend `npm test` (20 suites) | all pass, including `trade-lifecycle` Scenarios P–U, `rbac-portals`, `post-shipment-http` (roles, isolation, drafts, uploads, injection) |
| Frontend `ng build` | clean |
| Frontend `ng test` | 35 of 35 pass (list, application and review components included) |
| Browser journey (headless Chrome, seeded in-memory server) | client sees reference, picks 3 files, uploads, same file refused with message, submits; officer examines, sees the HS-code difference, sends request; client uploads corrected invoice and replies ("You replied: with the bank for re-examination"); officer re-examines (HS row now agrees) and records a decision; client sees it. No page errors. The only logged HTTP error is the deliberate 503 when the AI button is pressed without a model (the screen shows a plain message) |

**Not covered by evidence:** the AI-assisted reading against a real model for post-shipment documents (tested with the scripted fake model and for refusal without a model; not run live), real bank documents (only generated sample PDFs), load, and accessibility testing beyond the specs.

## 6. Assumptions

1. **Credit of record.** The issued credit if one exists; otherwise the approved pre-shipment application, labelled so on every finding. The platform's LC issuance is a sandbox step, so this is a platform decision the bank must confirm.
2. A post-shipment application is a presentation on the same case, not a second record.
3. Tolerances (quantity, value), unit conversions and the document-required list come from configuration in the workflow policy and are demonstration values.
4. Only the owner client of a case can start, upload or submit; officers cannot upload on the client's behalf.
5. The consolidated officer profile is a demonstration convenience; separation of duties is relaxed only for it, and the audit chain still names the person.

## 7. Remaining gaps and what must happen before production

- **Rule sign-off.** The EXM-XD rules and tolerances are not approved by the bank's trade operations and compliance functions. Each is registered as pending sign-off.
- **External verification not wired in.** HS code, port (UN/LOCODE) and IMO checks exist for pre-shipment (`verification/`) but are not run on post-shipment documents.
- **No customs, SWIFT or payment connection.** Pakistan-specific declarations (Form-E/I style, SBP/PSW references, GD numbers) are not modelled and need the bank's procedure and a regulatory source. No MT700/MT750/MT734 messages, no real settlement.
- **Fraud and alteration.** Possible alteration is flagged only through unreadable or inconsistent content, not forensic checks.
- **AI.** Provider approval and a data-protection review are the bank's. The AI may miss or invent differences: every point must quote text found in the documents and is dropped otherwise, but recall is unmeasured. It never blocks a case.
- **False positives and negatives.** Matching of names and goods wording is textual with normalisation; unusual wording will raise officer-confirmable findings, and a difference expressed very differently could be missed. Needs a pilot on real documents.
- **Operations.** Production database, backups, key management (`AUDIT_HMAC_KEY` unset), notifications to the client (there is no e-mail or SMS when the bank asks a question), queue assignment and SLAs.
- **Security review** of the new endpoints by the bank's own function; the existing injection and isolation tests are not a substitute.
- The two earlier open items remain: `zod` major-upgrade advisory, and the demo data reset (not applied; offered).

## 8. How to run it

Restart the backend (port 4000) and the frontend; sign in as the corporate customer (pre-shipment profile), get a case approved, then open **Post-Shipment**. The officer is "Trade Operations Officer (all desks)" in the post-shipment profile list. Tests: `cd backend && npm test`; `cd frontend && ng test`.

## 9. Update 2026-10-27: when a case reaches the post-shipment desk

A request appears in the post-shipment officer's Trade Cases list, counts and work queues only after the client has **submitted** post-shipment documents (`reachedPostShipment`: an approved-onwards status and at least one non-draft application). A draft, or an approved request nobody has started, stays on the pre-shipment side. Clearing history is a pre-shipment tidy-up only and has no effect on, and no button in, the post-shipment session. Sign-in without a stage still sees every case its role allows.
