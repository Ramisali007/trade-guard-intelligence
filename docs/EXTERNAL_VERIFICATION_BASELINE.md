# External verification — baseline audit and gap analysis

**Date:** 2026-10-26. **Scope:** the pre-trade (pre-shipment) Import LC flow and the engines it shares with the post-trade/TBML side.
**Method:** the repository was read before anything was changed; every statement below was checked against code or a test run, not assumed.

## 1. Stack, as found

Angular 20 frontend (standalone components, signals) and Node 20+/Express/TypeScript backend. MongoDB when `STORAGE_DRIVER=mongo`, otherwise an in-memory store with JSON mirrors. Optional dual write to a cloud MongoDB. AI through an OpenAI-compatible provider (Gemini Flash Lite configured). No Python, no second database, no queue server: background work is in-process. This matches the stack named in the brief, and none of it needs replacing.

## 2. Baseline test results (before this work began)

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` (backend) | pass |
| `npm test` (backend, 12 suites) | all pass: security, deduplication, analytics, integration, 18 fraud/TBML scenarios, import (28), compliance correctness, extraction heuristics, trade lifecycle, RBAC/portals, AI resilience, hardening |
| `ng build`, `ng test` (frontend) | build passes; 17 of 17 specs pass |
| `npm run lint` | 0 errors, 146 `no-explicit-any` warnings |
| `npm audit --omit=dev` | 1 high (`zod` < 4.6.6; needs a major upgrade; request body is capped at 1 MB) |
| Live check, real AI | clean sample set: 0 findings; set with mistakes: 3 findings, each once |

## 3. What exists and works (reuse these; do not rebuild)

| Capability | Where | Verdict |
|---|---|---|
| Document extraction, OCR, AI claim extraction | `document-processing/`, `ai/trade-extractor.ts` | Works. Page/span provenance is partial: per-claim page and text span are kept only for some fields. |
| Rule registry with source, interpretation status and sign-off | `trade-cases/rule-registry.ts`, `docs/REGULATORY_SOURCE_REGISTER.md` | Good design. Every rule is `PENDING_BANK_SIGN_OFF`; `SOURCE_TEXT_VERIFIED` / `SOURCE_CURRENCY_UNVERIFIED` / `SOURCE_NOT_RETRIEVED` / `BANK_POLICY_DEFAULT` are tracked. This is the model for new rules. |
| Finding model with evidence, history, disposition, blocking flag, rule version | `trade-cases/trade-case.types.ts`, `rule-helpers.ts` | Reusable. `observed: Evidence[]` carries source, label, value, snippet, page. It has no explicit source-freshness field or verification-status vocabulary. |
| Sanctions screening: OFAC, UN, EU, UK, OpenSanctions, NACTA; aliases, fuzzy matching, SCD-2 versions, point-in-time screening | `compliance/sanctions/*`, `temporal/*`, `sync/*` | Strong. Findings already say "evidence for review, not proof". |
| Source catalogue with freshness and sync status (8 sources) | `compliance_sources`, `sync/*`, `GET /api/documents/compliance/sources` | Reusable. It does not store licence terms, rate limits or retrieval method. |
| Price benchmarking with currency, unit and Incoterm normalisation; confidence-gated classification; "not comparable" outcomes | `compliance/pricing/*` | Good structure. See gaps (single global threshold). |
| Maker/checker, RBAC registry enforced server side, audit hash chain, dual control for reference data | `authorization/`, `middleware/`, `utils/hash-chain.ts` | Strong; tested by `rbac-portals.test.ts`. |
| SSRF-safe fetch (blocks private ranges at connect time, no redirects, capped body) | `utils/safe-fetch.ts` | Correct, but used in only one place. |
| AI grounding (quotes checked against the text; second look; de-duplication with rules) | `trade-cases/grounding.ts`, `finding-dedupe.ts` | Added earlier in this engagement; tested. |

## 4. What exists but is incomplete or inaccurate

1. **Product legality uses hard-coded keyword rules presented as statute.** `compliance/regulatory/pakistan-trade-policy.service.ts` returns `PROHIBITED` / `LICENSED` / `RESTRICTED` from phrases such as "router" or "narcotic" and cites an Import Policy Order appendix, a PTA/DRAP permit and an S.R.O. These rules are not in the rule registry, have no source record, no effective dates, no sign-off and no test fixture of official text. This is exactly what the brief forbids: a binding-looking legal verdict that nobody has verified. **Action:** keep it as an indicator only, label it as unapproved, never let it block on its own.
2. **Country sanctions status is a static list.** `sanctions/jurisdictions.data.ts` gives each country one status and score with no effective dates, no programme scope and no distinction between a comprehensive embargo, sectoral measures and a FATF listing. Not transaction-date aware.
3. **Port risk is five hard-coded UN/LOCODEs** (`maritime/route-risk.service.ts`) with comments such as "Sanctioned" by assumption. There is no port- or terminal-level sanctions source. This is a risk indicator, and must not be described as a sanctions finding.
4. **Pricing uses one global threshold** (+30% / -28%) for every product. The brief requires product-specific, statistically defensible thresholds and an explicit comparability statement.
5. **Only the proforma invoice is externally checked.** `pretrade-validation.ts` lifts sanctions, TBML, export-control and replay results from the PI alone. The contract, purchase order, permit and LC application form are compared by the AI but not screened or classified.
6. **Pricing, product-regulatory and route results are computed on the analysis but never become case findings**, so a reviewer cannot see them in the scrutiny.
7. **Most outbound HTTP uses raw `fetch`** to fixed URLs (feeds, FX, scrapers). Fixed URLs are not an SSRF risk, but the vessel/container scrapers build query URLs from document content and the open-web price search scrapes a search engine; both are marked unsuitable for production in `INTEGRATION_INVENTORY.md`.
8. **Source licence and terms are not recorded** in the catalogue (OpenSanctions commercial licence, UN Comtrade terms, FX provider terms are open questions).

## 5. What is missing entirely

| Requirement (brief section) | Status |
|---|---|
| HS code verification against an official nomenclature (4) | **Missing.** No tariff dataset is held. The HS code is used only as a lookup key for pricing and export control. |
| National tariff line (Pakistan Customs Tariff, 8-digit) verification (4) | **Missing; not obtainable by the platform today.** No machine-readable official source was found that the platform may retrieve; it needs a licensed feed or a bank-supplied file. |
| Port- and terminal-level restriction check from an official source (5B) | **Missing.** |
| Vessel IMO, flag, ownership check against a licensed provider (5D) | **Missing.** Only web-scraped evidence exists. |
| Shared verification vocabulary: verified / consistent / discrepancy / insufficient evidence / source unavailable / human review required (13) | **Missing.** Findings have OPEN / RESOLVED / DISPOSITIONED and a free-text title only. |
| Per-claim inventory with source freshness on each piece of evidence (9, 13) | **Missing.** |
| Verification run record (what was checked, against which source version, what could not be checked) (3, 12) | **Missing.** |
| Role and permission for viewing/administering external verification evidence (15) | **Missing** (existing permissions cover findings generally). |
| Source catalogue fields for licence, rate limit, retrieval method, ownership (11) | **Missing.** |

## 6. Credentials, licences and infrastructure that cannot be assumed

| Need | Why it cannot be built from here |
|---|---|
| Pakistan Customs Tariff national lines and current customs notifications | No machine-readable official feed was found; automated scraping of PDF notifications is not a reliable legal source. Needs FBR/PCT data under the bank's agreement. |
| Licensed AIS / vessel ownership data | The current scrapers breach site terms and are unreliable. |
| Commodity price benchmarks (Cotlook, LME, etc.) | Licensed. UN Comtrade unit values are aggregates, not like-for-like prices. |
| Official port/terminal sanctions designations | Not published as a list; they sit inside OFAC/EU/UK regimes (vessels and entities) and legal advice. |
| Rule sign-off | Only the bank's compliance function can approve a rule for production. |

## 7. Architectural conclusion

No new architecture is needed. The work is an **additive, shared verification layer** (`backend/src/verification/`) that:

- defines one claim / evidence / verification-result vocabulary;
- registers each external source with licence, freshness and retrieval method, and fetches only through the existing SSRF-safe path and an allowlist;
- plugs into the pre-trade evaluation as findings with rule IDs in the existing registry, so approval, audit, disposition and blocking behave as they already do;
- shows the results in the existing scrutiny screen.

The first module is HS classification, because an official public reference exists for it. Where an official source is not available (national tariff lines, port designations, vessel ownership), the layer reports **"source not integrated" or "insufficient evidence"** explicitly and never a clean result.

## 8. Risks to manage

- **False comfort.** "No issue found" must not read as "verified". The new vocabulary separates them.
- **Hard-coded legal claims** (item 4.1) must be demoted before anything is built on them.
- **Licensing** of UN Comtrade reference and trade-statistics data for commercial bank use must be confirmed.
- **Data protection:** HS verification sends no customer data out; it downloads a public reference and matches locally. Any future provider that receives a party name or document text needs the bank's third-party approval first.
