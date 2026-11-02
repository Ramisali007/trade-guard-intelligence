# External verification: implementation report

**Updated:** 2026-10-26 (second increment). Companions: `EXTERNAL_VERIFICATION_BASELINE.md` (what existed, what was missing), `EXTERNAL_VERIFICATION_PHASE2_REPORT.md` (the completion report of the second increment: files, results, blockers, verdict), `PCT_INGESTION.md`, `PRICING_FRAMEWORK.md`.

**Read this first.** External verification is **not complete**. Three modules run against a source: HS classification (a real, public UN reference file), port identity (the UN/LOCODE list the platform already synchronizes) and the IMO number check digit (arithmetic, no data source). The national tariff (Pakistan Customs Tariff) works **only when the bank supplies and a second person approves a dataset**; none is loaded. Sanctions screening of parties, vessels and countries is the existing engine, unchanged in coverage. Product legality, port and terminal sanctions, vessel identity/ownership and price benchmarking are **not** verified against any external source. Every rule is **pending bank sign-off**, so results are labeled demonstration or shadow output, not approved controls.

## 1. What exists

```
backend/src/verification/
  verification.types.ts      claim, evidence (with origin and lineage), status, run, source entry, source health
  source-catalogue.ts        every external source: authority, lineage, licence, cadence, freshness, owner, integration state, gaps
  retrieval.ts               the only way a source is fetched: cataloged HTTPS hosts of integrated sources, SSRF-safe, Content-MD5 checked
  source-guard.ts            per source: one request in flight, a pause after a failure, a circuit breaker
  governance.ts              rule approval (propose / decide / revoke), hash-chained log, enforcement modes, mandatory-source policy
  verification.service.ts    builds the claim inventory from every document and runs the modules, each isolated from the others
  verification-report.ts     the evidence report (model + PDF)
  source-health.ts           one view of the state of every source
  hs/                        official HS reference (download, validate, cache, refresh), verifier, text matching
  pct/                       Pakistan Customs Tariff adapter: strict CSV, versioned datasets, dual-control approval, effective-dated lookup
  maritime/                  UN/LOCODE port index and verifier, IMO check digit and the vessel-provider interface
backend/src/compliance/pricing/   pricing-policy.ts, price-comparability.ts (see PRICING_FRAMEWORK.md)
```

Integration with the existing application (no parallel workflow):

| Where | What |
|---|---|
| `trade-cases/pretrade-validation.ts` | A result that needs a person becomes a finding through the same path as every other rule (approval, audit chain, disposition, blocking, customer mail). Clean results stay on the run. The finding says whether its rule is an approved control, a demonstration or shadow; whether the evidence is real or synthetic; whether it is officer-only or can be put to the customer. |
| `trade-cases/trade-case.service.ts` | Verification runs outside the case lock; the run is stored in `validation.externalVerification`; a failed run is stored as a failure and raised, never as a clean result. The scrutiny report returns the run, the rule enforcement and the source health to staff holding `tradecase.verification.view`. `exportVerificationReport` produces the PDF and records the export in the case audit chain. |
| `trade-cases/rule-registry.ts` | Rules `EXT-HS-VALID/CLASS/CROSSDOC`, `EXT-PCT-VALID/RESTRICTION`, `EXT-PORT-ID`, `EXT-VESSEL-ID`, `EXT-VERIFY-SOURCE`, each with source, interpretation status, sign-off, and now `applicability` (the kind of authority, what it applies to, what a finding does not establish). |
| `authorization/permissions.ts` | `tradecase.verification.view/export`, `verification.rules.propose/approve`, `verification.reference.submit/approve`. The system administrator holds none; customers hold none. |
| `routes/verification.routes.ts`, `routes/trade-cases.routes.ts` | `/api/verification/*` and `/api/trade-cases/:id/verification-report`; every route names a permission and the service checks it again. |
| Frontend | Scrutiny page: "Checks against official sources" with a download of the evidence report. `/verification` page: rules, approval, enforcement mode, datasets, sources. |

No database migration: the data lives in additive fields of the case document and in JSON files under `DATA_DIR` (governance log, tariff datasets, HS cache).

## 2. The modules

**HS classification.** Form (4/6/8/10 digits) → existence of heading and subheading in the official reference → fit between the goods description and the official wording (word overlap; if nothing is shared, an AI second opinion that sees only the description and the official wording and is told to ignore instructions in the description) → agreement across documents. A second-opinion answer is kept with the claim and reused while the claim and the reference are unchanged. Digits beyond the sixth are checked only against an approved Pakistan Customs Tariff dataset (existence on the transaction date, validity period, whether its HS6 matches the declared one, description fit, restrictions text); without one, the result says the national line was not checked.

**Port identity.** A port named in a document is looked up in the UN/LOCODE list: by code, exact name, or name with words such as "port of" removed; with the stated country if there is one. A place wins over its terminals only when exactly one candidate is the place itself (Karachi over Karachi Container Terminal). Several candidates, an unknown name, a name in the wrong country and an unrecognised country text are each reported for what they are. If the list is not loaded in full (fewer than 5,000 locations) the module is *source unavailable*, not "port not found". It identifies the port; it does not check any restriction on a port or terminal.

**Vessel.** IMO number: seven digits and the check digit. The vessel's identity, flag, ownership and history need a licensed maritime data provider; the interface exists, none is connected, so those are reported as not verified. A vessel name and IMO number from the documents are passed to the existing sanctions screening.

**Isolation.** Each module runs on its own; one throwing or its source going away does not stop or hide the others.

## 3. Rules about evidence and states

- `VERIFIED` only when an authoritative record was found and matches. `CONSISTENT` means the evidence does not contradict the claim. "No issue found" is never "verified". A source that is down, stale or silent is `SOURCE_UNAVAILABLE` / `INSUFFICIENT_EVIDENCE`, never a pass.
- Every piece of evidence carries its source, record, retrieval time, SHA-256, publisher's version marker, lineage, and **origin**: `LIVE_SOURCE`, `BANK_SUPPLIED`, `SEED` or `SYNTHETIC_TEST`. Reports keep these apart.
- A claim carries the document, version, page/text location, extracted and normalized value, extraction confidence, and the rule and its version.
- Approval is explicit: a rule is a control only when a second person has approved that version in the hash-chained log. Until then it runs as a labeled **demonstration** (can hold a case) or **shadow** (advisory, never holds), set by `VERIFICATION_UNAPPROVED_RULE_MODE`. A log that fails its integrity check approves nothing. An outage of a source listed in `VERIFICATION_MANDATORY_SOURCES` holds *approval* of a case once its rule is an approved control; it never rejects a customer and never becomes a clean result.
- Sources are fetched only from their cataloged HTTPS hosts and only if integrated, through the SSRF-safe fetch; a URL from a document or a model is never fetched. A source that fails repeatedly is paused and then its circuit opens (`source-guard.ts`); concurrent requests share one retrieval.

## 4. Source catalog (what actually runs)

| Source | State | Use | License / owner |
|---|---|---|---|
| HS Combined reference (UN Comtrade file; nomenclature owned by the WCO) | **Operational** (real file, 8,262 entries, ETag and Content-MD5 checked) | HS validity, wording, standard unit | Public download; **UN terms for a bank's commercial use unconfirmed** |
| Pakistan Customs Tariff | **Adapter ready; nothing loaded** | 8-digit lines, duties, restrictions text | Bank supplies a lawfully held copy; a second person approves (`PCT_INGESTION.md`) |
| UN/LOCODE (via the platform's synchronizer) | Existing engine, used for port identity | Port identity | Public (UNECE) |
| OFAC, UN, EU, UK, SBP/NACTA lists | Existing engine | Party/vessel/entity screening | Public; legal applicability is the bank's |
| UN Comtrade pricing, FX | Existing engine | Price reference, FX | Terms unconfirmed; the bank should substitute treasury rates |
| WCO Explanatory Notes, Import Policy Order, licensed AIS, commodity benchmarks | **Not integrated** | | Each says what it would cover and why it is absent |

## 5. Rules and approval

All `EXT-*` rules: `PENDING_BANK_SIGN_OFF`; interpretation status `SOURCE_CURRENCY_UNVERIFIED` (the source's current edition has not been confirmed by a person). The existing `PT-*`, `CMP-*` rules are unchanged. `GET /api/trade-cases/rules` and the `/verification` page show for each rule the source, the kind of authority (regulatory direction, documentary standard, reference-data check, bank policy), where it applies and what a finding does not establish.

## 6. Corrections made to existing code

- The keyword product-regulatory indicator no longer claims `HIGH` confidence or "official gazetted orders"; it is `LOW` and labeled an unapproved indicator. It is produced by the document analysis only; no pre-trade rule uses it to block or to raise a finding.
- HS wording was attributed to the UN; it is WCO-owned and distributed by UNSD. Corrected in the catalog and every piece of evidence.
- A non-boolean `approve` in a rule or dataset decision was silently recorded as a rejection; it is now refused with 400.
- The price comparison used a fixed FOB basis whatever the benchmark's; it now uses the benchmark's own basis (`PRICING_FRAMEWORK.md`).
- Vessel name and IMO number stated in the documents were not passed to the sanctions screening in the pre-trade path; they are.
- Findings from external checks that only an officer can act on are no longer put into customer mail.

## 7. Settings

`EXTERNAL_VERIFICATION_ENABLED`, `EXTERNAL_SOURCES_OFFLINE`, `VERIFICATION_UNAPPROVED_RULE_MODE`, `VERIFICATION_MANDATORY_SOURCES`, `PRICING_POLICY_FILE` (see `backend/.env.example`).

## 8. Not done

See the phase report, section "Blocked and not done". In short: national tariff data, port/terminal restriction data, vessel intelligence, price benchmarks, product-legality sources, a background job queue, post-trade reuse of the results, sanctions programme-scope/ownership (50% rule) logic, and a measured false-positive/negative rate.
