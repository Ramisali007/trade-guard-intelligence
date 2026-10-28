# Integration inventory

Every external system the platform touches or would need to touch, with how it is connected today. Status as of 2026-10-21.

**Legend.** **Live**: calls a real external service. **Sandbox**: a stand-in that sends nothing and is labelled so on every record it produces. **Manual**: an officer records the fact and the platform stores who did and on what basis. **Not integrated**: nothing exists; the step happens outside the platform.

## Banking channels (none live)

| Integration | Status | What the platform does instead | What a pilot needs |
|---|---|---|---|
| SWIFT MT700 (LC issuance) | **Sandbox** (`LC_ISSUANCE_ADAPTER=sandbox`) | Assigns `SBX-LC-…`. The record and every screen say no MT700 was sent and no obligation was created. Any other adapter value refuses with 501. | A live adapter behind the same interface, called only after the service has verified the maker-checker authorisation. |
| SWIFT MT707 (amendment) | **Sandbox** | Assigns `SBX-AMD-…-NN` and states that no MT707 was sent. The amendment takes effect only when the beneficiary's acceptance is recorded. | Same as above. Beneficiary acceptance would arrive as an inbound message instead of a manual record. |
| PSW Financial Instrument | **Not integrated / Manual** | The officer enters the FI number and expiry. The format and the expiry-equals-LC-expiry rule are validated, and an amendment requires the FI expiry to follow. Nothing is sent to PSW. | PSW API access for FI creation and amendment. |
| Core banking: credit facility | **Manual** | Credit records the facility reference, limit and margin. The source is kept as `MANUAL_OFFICER_VERIFIED` or `SANDBOX_DEMO_DATA`. | A read-only limit lookup, plus earmarking and release of the limit. |
| Core banking: payment / settlement | **Manual** | The settlement officer records a settlement that happened elsewhere. The platform never moves funds. | Inbound confirmation of settlement. |
| Customer onboarding / KYC | **Not integrated** | The customer reference is assigned to the account by an administrator (dual control). | The bank's CIF and KYC status as the source of customer references and RM assignments. |
| Identity provider (SSO) | **Not integrated** | Local accounts (scrypt hashes), demo accounts, `AUTH_USERS` config, and managed accounts with dual-controlled role changes. | SAML/OIDC with role claims mapped to the registry, keeping dual control for role grants. |
| STR / goAML filing | **Not integrated** (by design) | Investigations and dispositions are recorded for the bank's own STR process. Nothing is filed. | None inside this platform. |

## Data sources (live, public)

| Source | Use | Notes |
|---|---|---|
| UN Statistics Division HS reference (`comtradeapi.un.org/files/v1/app/reference/HS.json`) | HS code verification (chapter, heading, 6-digit subheading wording) | **Live, new.** Downloaded (never scraped), validated, cached with SHA-256 and time, refreshed every 30 days; fetched only through the allowlisted, SSRF-safe path. UN terms for commercial bank use to be confirmed. National 8-digit tariff lines are **not** covered. See `EXTERNAL_VERIFICATION_IMPLEMENTATION.md`. |
| OFAC SDN (`sanctionslistservice.ofac.treas.gov`) | Sanctions screening | Synced by scheduler; SCD-2 versions; point-in-time screening. |
| UN Consolidated (`scsanctions.un.org`) | Sanctions screening | As above. |
| EU (`webgate.ec.europa.eu`, `data.europa.eu`) and UK FCDO (`sanctionslist.fcdo.gov.uk`) | Sanctions screening | As above. |
| OpenSanctions (`api.opensanctions.org`) | Supplementary screening | **Licensing** for commercial use must be confirmed. |
| NACTA proscribed lists (`nacta.gov.pk`) | Pakistan proscribed persons and organisations | Parsed from published lists. |
| FX rates (`open.er-api.com`) | PKR equivalents (e.g. the Rs 1.5 m checkpoint) | Not an official rate source. The bank should substitute SBP or treasury rates. When unavailable, the checkpoint stays required. |
| UN Comtrade (`comtradeapi.un.org`) | Price benchmarks for TBML | Rate limited. Unknown goods are never benchmarked by guesswork. |
| Vessel and container web pages (vesselfinder, myshiptracking, searates, track-trace) | Vessel and route evidence | **Web scraping**: terms of service and reliability are not suitable for production. Replace with a licensed AIS/maritime data provider before a pilot relies on it. |
| Web evidence search (`html.duckduckgo.com`) | Supplementary price evidence | Scraping; treat as advisory only. Replace or disable for a pilot. |

## Platform services

| Service | Status | Verified in this audit |
|---|---|---|
| MongoDB | **Live** (optional; `STORAGE_DRIVER=mongo`) | `npm run test:mongo` passes 8 scenarios against MongoDB 8.3.11 **standalone**: unique indexes, atomic counters, idempotent creation, cross-instance revision guard, no audit fork, restart durability, tamper detection, audit-write failure reporting, and fail-closed start-up. A standalone server has **no transactions**, so the case write and its audit event are two writes; see the readiness report. |
| AI provider (OpenAI-compatible; configured: Gemini `gemini-flash-lite-latest`) | **Live**, optional | `npm run test:ai-live` with synthetic documents: usable JSON in about 4 s; the model resisted a prompt injection; screening caught the sanctioned origin regardless. `npm run test:ai` covers malformed output, truncated output, 429, 500, timeout, connection refused and injection offline. |
| Cloud Mongo mirror (`MONGODB_CLOUD_URI`) | Optional dual write | Not exercised in this audit. |
