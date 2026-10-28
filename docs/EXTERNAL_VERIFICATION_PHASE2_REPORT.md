# External verification, second increment: completion report

**Date:** 2026-10-26. Branch `audit/tbml-production-hardening` (working tree; nothing committed by this work).
Companions: `EXTERNAL_VERIFICATION_IMPLEMENTATION.md` (how it works), `PCT_INGESTION.md`, `PRICING_FRAMEWORK.md`, `EXTERNAL_VERIFICATION_BASELINE.md`.

## Verdict

**Demo-ready. Not yet suitable for a controlled pilot.** It becomes a **controlled-pilot candidate, subject to approvals** once the bank (1) confirms the terms for using the UN HS file, (2) supplies and approves a Pakistan Customs Tariff dataset, (3) signs off or rejects each `EXT-*` rule, and (4) decides which sources are mandatory. External verification is **not complete**: only HS classification (real public file), port identity (the platform's UN/LOCODE list) and the IMO check digit run; the national tariff, port/terminal restrictions, vessel identity and ownership, product legality and price benchmarking depend on data the platform does not have. Passing tests show the specified behaviour on synthetic cases and say nothing about accuracy on real traffic.

## 1. Validation of the first increment (done before building)

| Check | Result |
|---|---|
| Backend suites at start | 14 of 14 then; all still pass (19 in this increment, see 7) |
| Angular specs / build at start | 17 of 17 / builds |
| Behaviour on the case lifecycle | A clean case raises nothing; a wrong HS code raises a blocking discrepancy for officers only; a source outage is a visible non-blocking finding; a dispositioned finding stayed decided across refreshes |
| Regressions found and fixed | Customer saw officer wording and operational findings; dispositioned findings reopened on timestamps; a stale "consistent" run survived a failure; the HS source was misattributed to the UN; an unrecognised country text was silently ignored; stale-source retries were not backed off; the Content-MD5 header was ignored |
| Found in this increment | A non-boolean `approve` in a rule/dataset decision was silently recorded as a rejection → now 400. "Karachi, Pakistan" matched both Karachi and Karachi Container Terminal on the real list and went to review → fixed and checked on the real list. Vessel name/IMO from the documents never reached the sanctions screening → now passed |

## 2. Features delivered (cumulative for both increments, new ones marked ★)

- **Governance and fail-safe.** Per-rule propose/decide/revoke, dual control, hash-chained log, approval bound to a rule version, tamper ⇒ nothing honoured. Unapproved rules run as *demonstration* or *shadow* (`VERIFICATION_UNAPPROVED_RULE_MODE`). Mandatory sources (`VERIFICATION_MANDATORY_SOURCES`) hold *approval* when unavailable once the rule is a control; an optional source down is a visible, non-blocking warning; an outage is never a clean result and never rejects a customer. Dispositioning an approved control needs the compliance permission.
- **HS classification** against the real UN file; WCO lineage; point-in-time metadata; AI second opinion kept and reused while unchanged.
- ★ **Pakistan Customs Tariff adapter** (bank-supplied strict CSV, versions, effective dates, HS6 mapping, restrictions text, SHA-256 re-check, full tariff vs extract, retire without deleting) with its own approval workflow; `PCT_INGESTION.md`.
- ★ **All document types.** Claims carry document id/version, location, extracted and normalised value, extraction confidence, source record, timestamps, rule version; an unchanged claim reuses its stored evidence and AI opinion.
- ★ **Port identity** on the UN/LOCODE list (real list verified: 17,529 locations) and **vessel IMO** check; a licensed vessel-provider interface (nothing connected) that reports identity as *not verified*, never clear. Vessel name and IMO now reach the existing sanctions screening.
- ★ **Pricing framework**: thresholds untouched but labelled unapproved; approved category thresholds only from a documented policy file; comparability grading; retained inputs; provider interface; bundled corridors can never be an approved control. `PRICING_FRAMEWORK.md`.
- ★ **Rule applicability metadata**: for every rule, the kind of authority (regulatory direction, documentary standard, reference-data check, bank policy), where it applies and what a finding does not establish; shown on `/verification` and returned by the rules API. A missing document is never presented as a prohibition; the keyword product indicator is not used by any pre-trade rule.
- ★ **Evidence report (PDF)**, `GET /api/trade-cases/:id/verification-report`, permission `tradecase.verification.export`, never cached, content-hashed, and an audited case event. Separates real / bank-supplied / seed / **synthetic** evidence, source failures (marking mandatory ones), incomplete checks, unapproved rules, and what is not integrated. Download button on the scrutiny page.
- ★ **Source protection**: per source one request in flight, a pause after a failure, a circuit breaker; an open circuit shows in source health.
- ★ **In-app rule approval** (`/verification`), dataset approval, source health; governance page spec.

## 3. Source catalogue and licensing

| Source | State | Licence / owner | Operational? |
|---|---|---|---|
| HS Combined reference (UN Comtrade file; WCO owns the nomenclature) | Retrieved and parsed in a live test: 8,262 entries, ETag, Content-MD5 matched | **UN terms for a bank's commercial use unconfirmed** | **Yes** (live retrieval, parsing, validity and evidence tests passed) |
| UN/LOCODE (platform synchroniser) | 17,529 locations loaded on this machine; port identity tested live | Public (UNECE) | **Yes** |
| Pakistan Customs Tariff | Adapter and approval tested on synthetic data | Bank must hold the right to use its copy (a confirmation is required at submission) | **No: nothing is loaded** |
| Sanctions lists (OFAC, UN, EU, UK, SBP/NACTA), FX, UN Comtrade pricing | Existing engine, unchanged | Public; applicability is the bank's legal call; FX/pricing terms unconfirmed | Existing |
| WCO Explanatory Notes, Import Policy Order, licensed AIS/vessel data, commodity benchmarks | Not integrated | Licensed or controlled; each catalogue entry says why | **No** |

## 4. Rules and approval status

| Rule | Source | Authority kind | Status |
|---|---|---|---|
| `EXT-HS-VALID`, `EXT-HS-CLASS`, `EXT-HS-CROSSDOC` | UN HS reference | Reference-data check | Pending bank sign-off |
| `EXT-PCT-VALID`, `EXT-PCT-RESTRICTION` | Pakistan Customs Tariff (bank dataset) | Reference-data check | Pending; inactive until a dataset is approved |
| `EXT-PORT-ID` | UN/LOCODE | Reference-data check | Pending |
| `EXT-VESSEL-ID` | IMO check digit | Reference-data check | Pending |
| `EXT-VERIFY-SOURCE` | Any | Reference-data check | Pending |

Nothing is approved. Until it is, results are labelled *demonstration* (can hold a case) or *shadow* (advisory). The default outside production is demonstration, in production shadow.

## 5. Real data versus demonstration fixtures

- **Real:** the UN HS file (live retrieval test); the UN/LOCODE list on this machine (live port-identity test: Karachi, Port Qasim, Santos, Jebel Ali, Karachi Container Terminal identified; Santos stated in India is a discrepancy; Chittagong, listed as Chattogram, goes to review).
- **Synthetic (tests and demo only):** every tariff dataset, every price benchmark, the vessel provider, the port lists inside the test suites, all customers, documents and accounts. Test evidence carries origin `SYNTHETIC_TEST` and the report announces it on its first page.
- **Seed:** the built-in reference price corridors (labelled as such, never a control) and any bundled port seed (the check refuses to run on fewer than 5,000 locations).

## 6. Database and migrations

None. New fields are additive in the case document (`validation.externalVerification`, `Finding.customerFixable`). New JSON files under `DATA_DIR`: the governance log, tariff dataset index and files, HS cache. The demo database was not reset and no other database was touched (the reset script from earlier exists, dry-run only, and has not been applied).

## 7. Test results

| What | Result |
|---|---|
| Backend `npm test` (19 suites, chain) | See the line "Final run" below |
| New suites in this increment | `verification-pct` (7 scenarios), `verification-routes` (7), `pricing-framework` (5), `verification-http` (6); extended `verification-governance` (6), `external-verification` (10), lifecycle Scenarios N and O |
| Backend typecheck / build | Clean |
| Backend lint | 0 errors; warnings are `any` types (146 at start of the verification work, 148 now: two in the new HTTP test) |
| Angular unit specs | 22 of 22 (17 existing + 5 for the governance screen) |
| Angular production build | Succeeds |
| `npm audit` | Unchanged: one high advisory in `zod` (needs a major upgrade, not done) |

Security and regression coverage added (`verification-http.test.ts`, `verification-governance.test.ts`, lifecycle O, `external-verification` Scenario 8): role boundaries for every demo role against `/verification/overview`; anonymous and forged tokens; no role can propose or decide a rule except the permitted ones; nobody approves what they proposed (over HTTP too); malformed ids and decisions are refused cleanly; upload type, extension, binary content, size and invalid rows; a dataset is a source only after a second person approves; report download limited to staff who may read the case (customers, administrators and out-of-portfolio relationship managers refused), never cached, audited with its hash, intact audit chain under four concurrent exports; a customer's instruction inside a goods description is data to the HS judge and produces no pass when the model is down; only catalogued HTTPS hosts of integrated sources are ever requested (foreign host, plain HTTP, internal address, unknown source refused); no result is carried over as a pass after an outage; a mandatory-source outage holds approval (lifecycle Scenario O). A low risk score cannot release a blocking finding by construction (`preShipmentBlockers` reads open findings, documents and queries and no score), which was confirmed by reading the code and is not covered by a separate test. Not covered by an automated test: cross-tenant isolation beyond the existing RBAC data-scope tests (the report uses the existing case access), real-network SSRF to a rebinding host.

## 8. Blocked and not done

| Item | Why |
|---|---|
| National tariff verification | No dataset supplied. Needs the bank's lawful copy (`PCT_INGESTION.md`). |
| Port/terminal/free-zone restrictions, transshipment-port parsing, ownership (50% rule), programme scope | No licensed or official machine-readable source; none invented. |
| Vessel identity, flag, ownership, history, route consistency | Needs a licensed maritime data provider; the interface exists. |
| Price benchmarks and category thresholds | Needs licensed benchmarks and an approved methodology. A pre-shipment pricing finding was deliberately not added. |
| Product legality and import permits | Needs the Import Policy Order and notifications as controlled files; the keyword indicator is not used. |
| Background job queue | Not added: verification runs inside the existing revalidation, bounded by the source guard. A queue is justified only when licensed providers with real latency are connected. |
| Post-trade/TBML reuse of pre-trade verification evidence | Not wired. Stored runs are available on the case; nothing consumes them downstream. |
| Accuracy | Not measured (no labelled dataset). |
| SBP/customs/ICC/SWIFT applicability | Rule metadata distinguishes regulatory direction, documentary standard and reference-data check; **no SWIFT message validation exists** in the platform, so no messaging rule is claimed. Legal reading of each rule remains the bank's. |

## 9. False-positive and false-negative limits

- HS fit is word overlap plus an optional AI opinion on 6-digit wording: it catches a code for clearly different goods; it **cannot** tell two plausible subheadings apart and says "consistent" for any code in the right area (false negative by design, stated on every result). Vague descriptions go to review (false positive by design). Digits 7–8 are unchecked without a tariff dataset.
- Port identity: transliterated or colloquial names (Chittagong/Chattogram) go to review; a private terminal not in UN/LOCODE is "could not be identified". It cannot detect a real port that is sanctioned or restricted.
- IMO check digit: catches typos and invented numbers; a valid number for the wrong ship passes.
- Price flags: the default thresholds have no approved methodology; bundled corridors are coarse; quantity, specification and origin are not compared.
- Sanctions: name matching of parties is the existing engine; its false-positive/negative rate was not measured here.

## 10. Remaining production blockers

1. Rule sign-off by the bank for each `EXT-*` rule, and a decision on which sources are mandatory.
2. Written confirmation of the UN terms for the HS file (or the bank's own copy), and of the licence status of the sanctions, FX and price feeds.
3. A supplied and approved Pakistan Customs Tariff dataset and a procedure for keeping it current.
4. Licensed vessel and price providers, or an explicit decision to operate without them.
5. An accuracy evaluation on a labelled set of real (authorised) cases.
6. Operational hardening already listed in `DEPLOYMENT_READINESS.md` (secrets, TLS, backups, monitoring), the `zod` advisory, and a restart of the running backend to load this code.
7. Legal review of the applicability of each international list and standard to the bank's transactions.

## 11. Files

New: `backend/src/verification/` (`governance.ts`, `retrieval.ts`, `source-guard.ts`, `source-health.ts`, `source-catalogue.ts`, `verification.service.ts`, `verification.types.ts`, `verification-report.ts`, `hs/*`, `pct/*`, `maritime/*`), `backend/src/compliance/pricing/pricing-policy.ts`, `price-comparability.ts`, `backend/src/controllers/verification.controller.ts`, `routes/verification.routes.ts`, tests `external-verification`, `verification-governance`, `verification-pct`, `verification-routes`, `verification-http`, `pricing-framework`, frontend `pages/verification/*` (component and spec), `services/verification.service.ts`, `models/verification.models.ts`, docs `PCT_INGESTION.md`, `PRICING_FRAMEWORK.md`, this report.
Changed: `trade-cases/{trade-case.service,pretrade-validation,rule-registry,trade-case.types,finding-dedupe,preshipment-ai.service}.ts`, `controllers/trade-case.controller.ts`, `routes/trade-cases.routes.ts` and `routes/index.ts`, `authorization/permissions.ts`, `middleware/upload.middleware.ts`, `utils/safe-fetch.ts`, `server.ts`, `compliance/pricing/{pricing-intelligence.service,pricing.types}.ts`, `compliance/regulatory/product-regulatory.service.ts`, `backend/.env.example`, `backend/package.json`, frontend scrutiny page, services and models, `app.routes.ts`, `app.ts`, `RBAC_PERMISSION_MATRIX.md`, `EXTERNAL_VERIFICATION_IMPLEMENTATION.md`, `INTEGRATION_INVENTORY.md`, and the rbac/lifecycle tests for the new behaviour.

Final run (2026-10-26): backend `npm test` exit 0, all 19 suites passed; `npm run build` clean; typecheck clean; Angular `ng test` 22 of 22; `ng build` succeeded. Re-run after the last small test edits: verification-routes and verification-http passed individually.
