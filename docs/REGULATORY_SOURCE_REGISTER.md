# Regulatory Source Register — Trade Lifecycle Rules

**Rule set version:** `2026.10.21-1` (`backend/src/trade-cases/rule-registry.ts`)
**Sources retrieved:** 2026-10-21
**Status of every rule:** `PENDING_BANK_SIGN_OFF`. Nothing here is production-effective until the bank's compliance function approves it.

The machine-readable register is served at `GET /api/trade-cases/rules` (staff only). It returns every rule, every source and the policy in force. This document explains it.

---

## 1. How the register separates source from interpretation

Each rule records two things:

- **The source** (`sourceId`, `sourceReference`): what was published, by whom, and when.
- **The interpretation** (`implementation`, `interpretationStatus`): how this application applies that text, and how far it has been verified.

| `interpretationStatus` | Meaning | Effect on a case |
|---|---|---|
| `SOURCE_TEXT_VERIFIED` | The source text was read and the rule follows it directly. | Applied as written. |
| `SOURCE_CURRENCY_UNVERIFIED` | Text read, but only an archived edition was available and later amendments may change it. | Applied, but the finding says so and routes to a person. |
| `SOURCE_NOT_RETRIEVED` | The source could not be fetched. The rule comes from the platform's existing engine and is not yet mapped to the source. | Indicator only; compliance dispositions it. |
| `BANK_POLICY_DEFAULT` | No regulation. A placeholder for the bank's own procedure. | Replace via `TRADE_WORKFLOW_POLICY_FILE`. |

Crawling a regulator's website does not produce a correct rule, so no rule is generated automatically. A new or changed rule needs a code change, a version bump, a test, and sign-off.

## 2. Sources

| Source ID | Document | Issuer | Date | How verified | Notes |
|---|---|---|---|---|---|
| `SBP-FEM-CH13` | FE Manual, Chapter 13 — Imports | SBP | archived edition (2002 base) | Full text retrieved and read | `archive.sbp.org.pk/fe_manual/chapters/chapter13.htm`. **Archived**: later circulars amend it (see CL 09/2026). Thresholds such as Rs 1.5 m (para 7) must be confirmed against the current consolidated manual. |
| `SBP-EPD-CL09-2026` | EPD Circular Letter No. 09 of 2026: amendments to "Imports under PSW — Financial Instrument Details" and to guarantees | SBP Exchange Policy Dept | 2026-04-23 | Annexure-A read in full | Replaces Ch.13 para 6B(viii). The effective date is taken as the circular date; confirm with the bank. |
| `SBP-EPD-CL08-2025-TBML` | Revision in the Framework for Managing Risks of TBML/TF | SBP Exchange Policy Dept | 2025-08-12 | **Circular page read; annexed framework not retrieved** (HTTP 403 to automated clients) | Replaces FE Circular 4 of 2019; ADs were to comply by 2025-10-31. The TBML indicators below are **not yet mapped** clause-by-clause to the framework's annexures. **Compliance must do this mapping.** |
| `PSW-FI` | Elimination of EIF/EFE — Financial Instruments | Pakistan Single Window | undated page | Read | The FI is shared by the bank with PSW over EDI; it must be active, match the payment mode, and be unexpired. **No PSW integration exists in this platform.** |
| `ICC-UCP600` | UCP 600 | ICC | 2007 | **Licensed text, not reproduced** | Articles are cited by number and paraphrased. Examiners work from the bank's licensed copy. Apply only when the credit is issued subject to UCP 600. |
| `BANK-POLICY-DEFAULT` | Platform default operating policy | this platform | — | n/a | Tolerances, thresholds and checklists are placeholders, not regulation. |

The PSW Import Single Declaration page was also retrieved. It describes declaration filing after the FI is issued, which happens outside the bank; no rule is derived from it.

## 3. Rules implemented

### Pre-trade (before issuance)

| Rule | Source / reference | Implementation | Status | What it does |
|---|---|---|---|---|
| `PT-REQ-001` | Bank policy | Deterministic | Bank default | Each required application field is present; missing is reported, never inferred. |
| `PK-FEM13-07-FIRM` | Ch.13 ¶7 | Deterministic | Currency unverified | A PI, order or contract must be attached before an LC can be approved. |
| `PK-FEM13-07-REPORT` | Ch.13 ¶7 | Manual checkpoint (Trade Ops checklist `TO-EXPORTER-REPORT`) | Currency unverified | At or above Rs 1.5 m equivalent, a bank-obtained report on the exporter is required. When no FX rate is available, the item is still required (conservative default). |
| `PK-FEM13-09-VALIDITY` | Ch.13 ¶9(ii) | Deterministic | Currency unverified | Validity over 12 months needs a documented exemption (24 months for specially manufactured machinery). |
| `PK-FEM13-05-TERMS` | Ch.13 ¶5 | Advisory (never blocks) | Currency unverified | The archived text names FOB/CFR; other Incoterms prompt a check against the current manual. |
| `PT-CMP-*` (amount, currency, beneficiary, applicant, Incoterm, origin, quantity, unit price, PI number) | Bank policy | Deterministic | Bank default | Each compares the application with the extracted PI. Evidence carries both values, and the PI page and snippet where the value was found. A value that cannot be extracted is "unverifiable", not a match. |
| `PT-PI-ARITHMETIC` | Bank policy | Engine reuse | Bank default | The existing arithmetic engine, with a printed-precision tolerance. |
| `PT-DATE-ORDER` | UCP 600 arts 6(d), 14(c) | Deterministic | Verified (paraphrased) | Shipment before expiry; shipment + presentation period on or before expiry; expiry in the future. |
| `PT-DOC-EXTRACTION` | Bank policy | Deterministic | Bank default | Analysis pending, failed, or a model fallback is reported and blocks until resolved or manually verified. |
| `CMP-SANCTIONS-PARTY` | Existing sanctions engine (OFAC SDN, UN, EU, UK, SBP lists as synced) | Engine reuse | Bank default | Applicant and beneficiary are screened as entered, and so are parties named on documents. A name match is evidence, not proof. If screening cannot run, that is itself a blocking finding; the case is never treated as clear. |
| `CMP-JURISDICTION` | Existing engine | Engine reuse | Bank default | Origin, ports and counterparty countries against the sanctions, FATF and export-control lists. |
| `CMP-EXPORT-CONTROL` | Existing engine | Engine reuse | Bank default | Possibly controlled or dual-use goods. |
| `TBML-PI-INDICATOR` | SBP TBML framework 2025 (mapping pending) | Engine reuse | Source not retrieved | Pricing, quantity, routing and customer–product flags, plus replay alerts the existing engines raised on the PI. |
| `TBML-PI-REUSE` | SBP TBML framework 2025 (mapping pending) | Deterministic | Source not retrieved | The same PI file or PI number on another live case. |
| `TBML-MATERIAL-CHANGE` | Bank policy | Deterministic | Bank default | Beneficiary changed, or amount moved more than 10%, after first submission. |
| `TBML-USANCE` | Bank policy | Deterministic (never blocks) | Bank default | Usance over 180 days is routed for review. |
| `CRD-FACILITY` | Bank policy | Deterministic | Bank default | A recorded facility covers amount plus tolerance. The source of the figure (officer-verified or sandbox) is kept. |

### Issuance

| Rule | Source / reference | Implementation | Status | What it does |
|---|---|---|---|---|
| `PK-FEM13-6B8-FI` | EPD CL 09/2026, Annex A (Ch.13 ¶6B(viii)) | Deterministic; refuses issuance | Verified | FI number `<AD>-IMP-<6 digits>-<DDMMYYYY>[≤3 chars]`; valid, non-future date; **FI expiry equals LC expiry**. |

### Post-trade (presentation examination against the issued terms)

| Rule | Source / reference | What it checks |
|---|---|---|
| `EXM-REQUIRED-DOCS` | UCP 600 art. 14 (paraphrased) | Every stipulated document presented. |
| `EXM-INV-AMOUNT` | arts 18(b), 30(a) | Invoice within the credit plus tolerance. |
| `EXM-INV-CURRENCY` | art. 18(a)(iii) | Invoice in the credit currency. |
| `EXM-INV-BENEFICIARY` | art. 18(a)(i) | Issued by the beneficiary. |
| `EXM-INV-APPLICANT` | art. 18(a)(ii) | Made out to the applicant. |
| `EXM-INV-GOODS` | art. 18(c) | Description corresponds. **Word overlap only: an examiner must judge.** |
| `EXM-QUANTITY` | art. 30(b) | Counted units: none; other units: ±5%. |
| `EXM-TD-PORTS` | art. 20(a)(iii) | Transport document ports match the credit. |
| `EXM-TD-SHIPDATE` | credit terms; art. 20(a)(ii) | On-board date on or before the latest shipment date. |
| `EXM-PRESENTATION-PERIOD` | arts 6(d), 14(c) | Presented within the period after shipment and before expiry. |
| `TBML-POST-PRICE-DRIFT` | SBP TBML framework 2025 (mapping pending) | Invoiced unit price departs from the approved PI by more than 5%. |
| `TBML-POST-ENGINE` | SBP TBML framework 2025 (mapping pending) | High/critical TBML and replay alerts the existing engines raised on presented documents. |

## 4. Known gaps that need the bank

1. **TBML framework mapping.** Retrieve the CL 08/2025 annex through an authenticated channel, map each red flag in its annexures to a rule (existing or new), and record any that the data cannot support.
2. **Current FE Manual.** Replace the archived Chapter 13 references with the current consolidated text. Confirm the Rs 1.5 m threshold, the validity periods, and the terms of import.
3. **Import Policy Order.** The current import policy (importability, conditional items, the "Category Pass Book" endorsement in ¶9(iv)) is a Trade Ops checklist item, not an automated rule. No machine-readable source was available.
4. **Sanctions and screening sources.** The engine uses the lists the sync jobs fetch. Licensing and the bank's approved list set (including any commercial screening provider) must be confirmed.
5. **UCP 600 / ISBP.** Confirm the bank's licensed copy, and whether ISBP 821 practice should add examination rules.
6. **AML/CFT/CPF regulations** applicable to the bank: not encoded. Screening dispositions and investigations are recorded for the bank's own STR process; this platform files nothing.

## 5. Re-verification attempt — 2026-10-21

Done for the pilot-readiness audit. Nothing below changes a rule; it records what could and could not be confirmed.

| Source | Result | Consequence |
|---|---|---|
| `SBP-EPD-CL08-2025-TBML` circular and annex (`sbp.org.pk/epd/2025/FECL8.htm`, `sbp.org.pk/Epd/2025/FECL8-Annex.pdf`) | **Not retrieved: HTTP 403** to automated clients, as before. Search-engine abstracts of the SBP pages agree with the register: dated 12 Aug 2025; revises the 2019 framework (FE Circular 4 of 2019); compliance due 31 Oct 2025; the annex is the revised *Framework for Managing Risks of TBML, TF and Proliferation Financing*, with governance, customer due diligence, and transaction due diligence/monitoring sections. | Gap 1 stands: the TBML rules remain **unmapped** to the annex clause by clause. A third-party index also lists an "EPD Circular Letter No. 10" (Nov 2025) on red flags and price verification. It is **not confirmed** on SBP's site and is **not** used by any rule. |
| FE Manual Ch.13 (current) | SBP announced an updated Chapter 13 on its website with a September 2025 circular. The consolidated PDF could not be fetched (403). | Gap 2 stands. The rules citing ¶5, ¶7 and ¶9 stay at `SOURCE_CURRENCY_UNVERIFIED`. |
| Ch.13 ¶6B (PSW Financial Instrument) | A third-party summary of an EPD circular dated 2026-04-23 describes import details sent through PSW with automatically generated Financial Instrument numbers. That agrees with the FI format rule `PK-FEM13-6B8-FI`. The SBP text itself could not be re-read in this session. | `PK-FEM13-6B8-FI` keeps its status, which rests on the earlier reading. Re-confirm on the bank's own copy before go-live. |
| EPD CL 04/2026 (temporary CIF basis for crude oil and petroleum imports, 60 days) | Seen in search only. | No rule depends on it. `PK-FEM13-05-TERMS` is advisory and never blocks. |

**Bottom line for go-live:** compliance must retrieve the CL 08/2025 annex and the current consolidated Chapter 13 through the bank's own access, then complete gaps 1 and 2. Automated retrieval from sbp.org.pk is blocked, so this is a manual step.
