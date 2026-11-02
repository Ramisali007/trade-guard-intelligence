# RBAC permission matrix

> Generated from `backend/src/authorization/permissions.ts` by `backend/scripts/generate-rbac-matrix.ts`. Do not edit by hand: change the registry and regenerate. The server enforces exactly this table; the frontend reads the same list from `/api/auth/me`.

## Principles

- **Default deny.** A role has only the permissions listed. An unknown role has none; an account without a role cannot sign in. Every API route names the permission it needs (`requirePermission`), and a test fails if one does not.
- **Three layers on every trade-case action:** the route permission, then in the service the exact action permission, the case's data scope (own customer / assigned customers / institution), the workflow state, and separation of duties.
- **Out-of-scope cases read as missing (404)**, so a customer or RM cannot learn that another customer's case exists. A role with no case access at all gets 403 for any id.
- **Field-level redaction** is decided on the server (`toView`): compliance/TBML findings, credit facility details, investigations and compliance review notes are replaced by a "restricted" placeholder unless the viewer holds the matching `*.view` permission. Customers never see that such items exist (tipping-off).
- **Administration is not business authority.** The System Administrator manages accounts and platform health and holds no trade-case, document, compliance or audit permission. Role changes are requests that a *different* administrator approves; nobody changes their own access.
- **Session safety.** Every request re-reads the account: a disabled account, revoked sessions or a changed role invalidate outstanding tokens immediately (401 `SESSION_REVOKED`).

## Roles

| Code | Role | Data scope | Assignable | Description |
|---|---|---|---|---|
| CUST | Corporate Customer (`CORPORATE_CUSTOMER`) | OWN_CUSTOMER | yes | An importer: files and follows its own LC requests. Never sees internal findings. |
| RM | Relationship Manager (`RELATIONSHIP_MANAGER`) | ASSIGNED_CUSTOMERS | yes | Owns assigned customers: RM review, acts for the customer, no compliance or credit authority. |
| MAKER | Trade Operations (Maker) (`TRADE_MAKER`) | INSTITUTION | yes | Scrutiny and preparation; cannot authorize its own work. |
| CHECK | Trade Operations (Checker) (`TRADE_CHECKER`) | INSTITUTION | yes | Independent check of maker work: authorizes versions and decides presentations. |
| OPS | Post-Trade Documentary Operations (`OPERATIONS_DESK`) | INSTITUTION | yes | Receives and examines presentations; maintains feeds and reference data. |
| CRED | Credit Reviewer (`CREDIT_REVIEWER`) | INSTITUTION | yes | Facility verification and credit decisions; no compliance or issuance authority. |
| COMP | Compliance Reviewer (`COMPLIANCE_REVIEWER`) | INSTITUTION | yes | Compliance review, holds and dispositions; cannot run or close investigations. |
| TBML | TBML Risk Analyst / Investigator (`TBML_RISK_ANALYST`) | INSTITUTION | yes | Compliance review plus TBML investigations and document-level overrides. |
| CCO | Chief Compliance Officer (`CHIEF_COMPLIANCE_OFFICER`) | INSTITUTION | yes | Head of compliance: everything an analyst does, plus document lifecycle and feed control. No credit, approval or issuance authority. |
| APPR | Senior Approver (`SENIOR_APPROVER`) | INSTITUTION | yes | Checker for authorization; rejects and cancels. Sees the full risk picture it decides on. |
| ISSUE | LC Issuance Officer (`LC_ISSUER`) | INSTITUTION | yes | Records issuance and amendment issuance of authorized credits (sandbox). |
| SETL | Settlement Officer (`SETTLEMENT_OFFICER`) | INSTITUTION | yes | Records settlement of accepted presentations. Never initiates payment. |
| AUD | Auditor (read-only) (`TRADE_AUDITOR`) | INSTITUTION | yes | Reads everything in scope including audit chains; changes nothing. |
| ALL | Trade Operations Officer (all desks) (`POST_TRADE_OFFICER`) | INSTITUTION | no (machine) | One officer for all the bank-side work of an import LC after it is authorized: reviews, approval, issuance, presentations, settlement, amendments, investigations and closure. Separation of duties between desks does not apply to this role; the audit trail names the officer on every step. |
| ADMIN | System Administrator (`PLATFORM_ADMIN`) | NONE | yes | Accounts, access requests and technical health. No business data or business decisions. |
| API | Integration Gateway (machine) (`INTEGRATION_GATEWAY`) | NONE | no (machine) | The X-API-Key principal: uploads and reads documents for a core-banking caller. No case or compliance authority. |

## Permissions by role

| Permission | CUST | RM | MAKER | CHECK | OPS | CRED | COMP | TBML | CCO | APPR | ISSUE | SETL | AUD | ALL | ADMIN | API |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `documents.read` — Read the document store: analyses, reports, files, comparisons |  |  | ● | ● | ● |  | ● | ● | ● |  |  |  | ● | ● |  | ● |
| `documents.upload` — Upload documents and start or re-run analysis |  |  | ● |  | ● |  |  |  | ● |  |  |  |  | ● |  | ● |
| `documents.delete` — Delete or archive documents and restore archived history |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |  |  |
| `documents.purge` — Permanently erase a document, its passages, events and stored original (irreversible) |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |  |  |
| `documents.override` — Override a document-level compliance decision |  |  |  |  |  |  |  | ● | ● |  |  |  |  | ● |  |  |
| `compliance.sources.read` — Read sanctions-feed status, FX rates and retrospective alerts |  |  | ● | ● | ● |  | ● | ● | ● |  |  |  | ● | ● |  |  |
| `compliance.sources.sync` — Trigger sanctions and reference-data feed synchronization |  |  |  |  | ● |  |  |  | ● |  |  |  |  | ● |  |  |
| `compliance.screening.run` — Run ad-hoc and point-in-time sanctions screening |  |  |  |  |  |  | ● | ● | ● |  |  |  |  | ● |  |  |
| `analytics.read` — Read platform analytics |  |  |  |  |  |  | ● | ● | ● |  |  |  | ● | ● |  |  |
| `customers360.read` — Read Customer 360 counterparty profiles |  |  |  |  |  |  | ● | ● | ● |  |  |  | ● | ● |  |  |
| `masterdata.read` — Read master/reference data |  |  | ● | ● | ● |  | ● | ● | ● |  |  |  | ● | ● |  |  |
| `masterdata.write` — Submit changes to master/reference data (applied only after a second person approves) and synchronize feeds |  |  |  |  | ● |  |  |  | ● |  |  |  |  | ● |  |  |
| `masterdata.approve` — Approve or reject another person's master-data change (four-eyes control) |  |  |  |  |  |  | ● | ● | ● |  |  |  |  | ● |  |  |
| `chat.use` — Use the document assistant (reads the document store) |  |  | ● | ● | ● |  | ● | ● | ● |  |  |  |  | ● |  |  |
| `system.storage.status` — See database connectivity and targets |  |  |  |  | ● |  |  |  | ● |  |  |  |  | ● | ● |  |
| `tradecase.view.own` — View trade cases of the customer the login belongs to | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `tradecase.view.assigned` — View trade cases of customers assigned to this user |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `tradecase.view.all` — View trade cases across the institution |  |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |
| `tradecase.findings.internal.view` — See compliance, TBML and regulatory findings in full |  |  | ● |  |  |  | ● | ● | ● | ● |  |  | ● | ● |  |  |
| `tradecase.credit.view` — See credit facility details and credit findings |  |  |  |  |  | ● |  |  |  | ● |  |  | ● | ● |  |  |
| `tradecase.investigation.view` — See TBML investigations |  |  |  |  |  |  | ● | ● | ● |  |  |  | ● | ● |  |  |
| `tradecase.audit.view` — Read a case's hash-chained audit log |  |  |  |  |  |  | ● | ● | ● | ● |  |  | ● | ● |  |  |
| `audit.overview` — Audit explorer: every case's chain verification |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |
| `tradecase.rules.view` — Read the rule registry and workflow policy |  |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |
| `tradecase.verification.view` — Read external verification results, their evidence and the source catalog |  |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |
| `tradecase.verification.export` — Download the evidence-based scrutiny report of a case (what the holder may read in the case, nothing more) |  |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |
| `verification.rules.propose` — Propose that a verification rule be approved as a bank control (a second person decides) |  |  |  |  |  |  | ● | ● | ● |  |  |  |  | ● |  |  |
| `verification.rules.approve` — Approve, reject or revoke a verification rule as a bank control (never the person who proposed it) |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |  |  |
| `verification.reference.submit` — Submit a reference dataset (for example the Pakistan Customs Tariff) for approval |  |  |  |  |  |  | ● | ● | ● |  |  |  |  | ● |  |  |
| `verification.reference.approve` — Approve or reject a submitted reference dataset, and retire an approved one (never the person who submitted it) |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |  |  |
| `tradecase.create` — Create an import request | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `tradecase.application.edit` — Edit the LC application (new version) | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `tradecase.document.attach` — Attach pre-trade documents to a case | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `tradecase.document.remove` — Remove a pre-trade document that was attached by mistake | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `tradecase.document.download` — Download a case document | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |
| `tradecase.submit` — Submit a draft for review | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `tradecase.withdraw` — Withdraw a request | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `tradecase.revalidate` — Re-run validation |  |  | ● |  |  |  | ● | ● | ● |  |  |  |  | ● |  |  |
| `tradecase.postshipment.apply` — Start, prepare and submit a post-shipment application against an approved request, and send corrected documents (the customer, for their own requests) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `tradecase.history.clear` — Hide approved pre-shipment cases from your own case list and counts (nothing is deleted: the case, its documents and its audit trail stay in the database, and the hidden cases can be shown again) |  |  | ● |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.preshipment.approve` — Approve a pre-shipment request after the trade desk's scrutiny (single step, no separate approver) |  |  | ● |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.review.rm` — Perform the RM review |  | ● |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.review.trade_ops` — Perform Trade Operations scrutiny |  |  | ● | ● | ● |  |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.review.compliance` — Perform the compliance review (including holds) |  |  |  |  |  |  | ● | ● | ● |  |  |  |  | ● |  |  |
| `tradecase.review.credit` — Perform the credit review |  |  |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.query.raise` — Raise a query for the user's department |  | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |  | ● |  |  |
| `tradecase.query.respond.customer` — Answer a query addressed to the customer | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `tradecase.query.respond.internal` — Answer a query addressed to the user's department |  |  | ● |  | ● | ● | ● | ● | ● |  |  |  |  | ● |  |  |
| `tradecase.query.resolve` — Resolve or reopen a query the user's department raised |  | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |  | ● |  |  |
| `tradecase.finding.disposition.data` — Disposition data, document and LC-term findings |  |  | ● | ● | ● |  |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.finding.disposition.compliance` — Disposition compliance, TBML and regulatory findings |  |  | ● |  |  |  | ● | ● | ● |  |  |  |  | ● |  |  |
| `tradecase.finding.disposition.credit` — Disposition credit findings |  |  |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.credit.record` — Record a credit facility verification |  |  |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.approval.request` — Request authorization (maker) |  |  | ● |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.approval.decide` — Authorize or return (checker) |  |  |  | ● |  |  |  |  |  | ● |  |  |  | ● |  |  |
| `tradecase.reject` — Reject a case |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |
| `tradecase.cancel` — Cancel an authorized case before issuance |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |
| `tradecase.issuance.record` — Record (sandbox) LC issuance |  |  |  |  |  |  |  |  |  |  | ● |  |  | ● |  |  |
| `tradecase.amendment.request` — Request an LC amendment | ● | ● | ● |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.amendment.submit` — Submit a reviewed amendment for approval (maker) |  |  | ● |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.amendment.approve` — Approve or reject an amendment (checker) |  |  |  | ● |  |  |  |  |  | ● |  |  |  | ● |  |  |
| `tradecase.amendment.issue` — Record (sandbox) amendment issuance |  |  |  |  |  |  |  |  |  |  | ● |  |  | ● |  |  |
| `tradecase.amendment.beneficiary_response` — Record the beneficiary's acceptance or refusal of an amendment |  |  | ● |  | ● |  |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.presentation.record` — Record a documentary presentation |  |  | ● |  | ● |  |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.presentation.examine` — Examine a presentation |  |  | ● | ● | ● |  |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.presentation.waive` — Give the applicant's waiver on a discrepancy | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `tradecase.presentation.decide` — Accept or refuse a presentation (bank decision) |  |  |  | ● |  |  |  |  |  |  |  |  |  | ● |  |  |
| `tradecase.settlement.record` — Record settlement (sandbox / manual record) |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |
| `tradecase.investigation.open` — Open a TBML investigation |  |  |  |  |  |  |  | ● | ● |  |  |  |  | ● |  |  |
| `tradecase.investigation.close` — Close a TBML investigation |  |  |  |  |  |  |  | ● | ● |  |  |  |  | ● |  |  |
| `tradecase.close` — Close a settled case |  |  |  | ● |  |  |  |  |  | ● |  |  |  | ● |  |  |
| `admin.users.view` — List user accounts and access requests |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `admin.users.manage` — Create users, disable accounts, revoke sessions |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `admin.access.request` — Request a role or assignment change |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `admin.access.approve` — Approve or reject another administrator's access request |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |
| `admin.rbac.view` — Read the role-permission matrix |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● |  |
| `system.health.view` — Read technical health and security-denial metrics |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |

## Trade-case actions

Each action needs one of the listed permissions *and* passes the scope, state and separation-of-duties checks in the service.

| Action | Permission(s) |
|---|---|
| VIEW | `tradecase.view.own`, `tradecase.view.assigned`, `tradecase.view.all` |
| CREATE | `tradecase.create` |
| EDIT_APPLICATION | `tradecase.application.edit` |
| ATTACH_PRETRADE_DOCUMENT | `tradecase.document.attach` |
| REMOVE_PRETRADE_DOCUMENT | `tradecase.document.remove` |
| SEND_DOCUMENTS | `tradecase.submit` |
| START_POST_SHIPMENT | `tradecase.postshipment.apply` |
| ATTACH_PRESENTATION_DOCUMENT | `tradecase.postshipment.apply` |
| REMOVE_PRESENTATION_DOCUMENT | `tradecase.postshipment.apply` |
| SUBMIT_POST_SHIPMENT | `tradecase.postshipment.apply` |
| REQUEST_CLARIFICATION | `tradecase.presentation.examine` |
| ADD_MANUAL_FINDING | `tradecase.presentation.examine` |
| SUBMIT | `tradecase.submit` |
| WITHDRAW | `tradecase.withdraw` |
| REVALIDATE | `tradecase.revalidate` |
| RAISE_QUERY | `tradecase.query.raise` |
| RESPOND_QUERY | `tradecase.query.respond.customer`, `tradecase.query.respond.internal` |
| RESOLVE_QUERY | `tradecase.query.resolve` |
| DISPOSITION_FINDING | `tradecase.finding.disposition.data`, `tradecase.finding.disposition.credit` |
| DISPOSITION_COMPLIANCE_FINDING | `tradecase.finding.disposition.compliance` |
| RECORD_CREDIT_FACILITY | `tradecase.credit.record` |
| REQUEST_APPROVAL | `tradecase.approval.request` |
| APPROVE | `tradecase.approval.decide` |
| APPROVE_PRESHIPMENT | `tradecase.preshipment.approve` |
| REJECT | `tradecase.reject` |
| CANCEL | `tradecase.cancel` |
| RECORD_ISSUANCE | `tradecase.issuance.record` |
| RECORD_PRESENTATION | `tradecase.presentation.record` |
| EXAMINE_PRESENTATION | `tradecase.presentation.examine` |
| APPLICANT_WAIVER | `tradecase.presentation.waive` |
| DECIDE_PRESENTATION | `tradecase.presentation.decide` |
| RECORD_SETTLEMENT | `tradecase.settlement.record` |
| OPEN_INVESTIGATION | `tradecase.investigation.open` |
| CLOSE_INVESTIGATION | `tradecase.investigation.close` |
| CLOSE_CASE | `tradecase.close` |
| REQUEST_AMENDMENT | `tradecase.amendment.request` |
| SUBMIT_AMENDMENT | `tradecase.amendment.submit` |
| DECIDE_AMENDMENT | `tradecase.amendment.approve` |
| ISSUE_AMENDMENT | `tradecase.amendment.issue` |
| AMENDMENT_BENEFICIARY_RESPONSE | `tradecase.amendment.beneficiary_response` |

## Separation of duties (record level)

Enforced on the case record, independently of roles: a person who holds two permissions still cannot use both on the same case where these apply.

- `approverNotMaker`: enforced
- `approverNotReviewerOf`: enforced
- `issuerNotApprover`: enforced
- `presentationDeciderNotPresenter`: enforced
- `settlementNotIssuer`: enforced
- `amendmentApproverNotMaker`: enforced
- `amendmentIssuerNotApprover`: enforced
- `investigationCloserNotOpener`: enforced

## Portals

Screens (`/api/workspace` → `sections`) and work queues are derived from permissions, never from role names.

| Screen | Route | CUST | RM | MAKER | CHECK | OPS | CRED | COMP | TBML | CCO | APPR | ISSUE | SETL | AUD | ALL | ADMIN | API |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| My workspace | `/workspace` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| Trade cases | `/trade-cases` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |
| Post-Shipment | `/post-shipment` | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| New LC application | `/trade-cases/new` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Document workbench | `/dashboard` |  |  | ● | ● | ● |  | ● | ● | ● |  |  |  | ● | ● |  | ● |
| Document comparison | `/compare` |  |  | ● | ● | ● |  | ● | ● | ● |  |  |  | ● | ● |  | ● |
| Document auditor | `/auditor` |  |  | ● | ● | ● |  | ● | ● | ● |  |  |  | ● | ● |  | ● |
| Analytics | `/analytics` |  |  |  |  |  |  | ● | ● | ● |  |  |  | ● | ● |  |  |
| Customer 360 | `/customers` |  |  |  |  |  |  | ● | ● | ● |  |  |  | ● | ● |  |  |
| Sanctions sources | `/sources` |  |  | ● | ● | ● |  | ● | ● | ● |  |  |  | ● | ● |  |  |
| Master data | `/import` |  |  | ● | ● | ● |  | ● | ● | ● |  |  |  | ● | ● |  |  |
| Audit explorer | `/audit` |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |
| Administration | `/admin` |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● |  |

Work queues list the cases on which the user can take one of these next actions now:

- **Applications to complete and submit** — SUBMIT
- **Clarifications requested** — EDIT_APPLICATION
- **Documents to scrutinize** — REVALIDATE
- **Relationship review** — REVIEW_RM
- **Trade operations review** — REVIEW_TRADE_OPS
- **Compliance review** — REVIEW_COMPLIANCE
- **Credit review** — REVIEW_CREDIT, RECORD_CREDIT_FACILITY
- **Ready to send for approval** — REQUEST_APPROVAL
- **Awaiting your approval** — APPROVE
- **Authorized for issuance** — RECORD_ISSUANCE
- **Amendments** — REVIEW_AMENDMENT_RM, REVIEW_AMENDMENT_TRADE_OPS, REVIEW_AMENDMENT_COMPLIANCE, REVIEW_AMENDMENT_CREDIT, SUBMIT_AMENDMENT, DECIDE_AMENDMENT, ISSUE_AMENDMENT, AMENDMENT_BENEFICIARY_RESPONSE
- **Presentations** — RECORD_PRESENTATION, EXAMINE_PRESENTATION, DECIDE_PRESENTATION
- **Awaiting settlement** — RECORD_SETTLEMENT
- **Open investigations** — CLOSE_INVESTIGATION
- **Ready to close** — CLOSE_CASE
- **Open queries for your desk / Questions from the bank** — open queries addressed to the user's department, or to the customer
