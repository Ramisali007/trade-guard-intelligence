# TradeGuard Intelligence — Point-in-Time Sanctions Compliance & Live List Ingestion
### Engineering + AI Implementation Specification (v1.0)

> **How to use this document:** Paste Part A into Claude Code / your coding AI as a build spec for the backend feature. Paste Part B directly into your `RAGService` / chat system prompt as-is. Part C is a pre-launch checklist — do not ship to a real bank until every item passes.
>
> **Disclaimer:** This is a software-architecture specification, not legal or regulatory advice. Before this touches real transactions at an actual bank, it must be reviewed and signed off by a licensed compliance officer / sanctions counsel. OFAC, UN, EU and UK sanctions law carry strict liability — get a human expert to validate the interpretation logic, not just the code.

---

## 0. The problem, restated precisely

> "Transaction ki date par Country X sanctioned nahi thi. 8 months baad Country X sanction ho gaya. Auditor 2 saal baad puchta hai: 'transaction ke waqt yeh party clean thi, prove karo.'"

You cannot answer this by re-querying today's sanctions list — today's list will show the party *as sanctioned*, which is factually true today but irrelevant to whether the transaction was compliant *on the transaction date*. You need a system that can answer:

**"What did the official sanctions lists say, exactly, on date D?"** — and reproduce that answer identically years later, from an immutable, timestamped record — not from live memory or a re-fetch.

This is a **bitemporal data problem**. Every fact needs two timelines:
- **Valid time** — when the fact was true in the real world (e.g., Entity X was on the OFAC SDN list from `2027-03-14` onward).
- **System time** — when *your* system learned about that fact (your ingestion timestamp).

A transaction screened on `2026-06-01` must permanently record which **list version** existed at that moment — not just "not sanctioned," but *proof of which snapshot was consulted*.

---

## PART A — Backend Implementation Spec

### A1. Non-negotiable design principles

1. **The LLM never makes the sanctions match/no-match decision.** Matching is deterministic (fuzzy-matching algorithm against a versioned database). The LLM only explains results already computed — never invents or infers a match status from its own knowledge.
2. **Every screening event is immutable and append-only.** No `UPDATE` or `DELETE` on screening records. Corrections are new rows referencing the old one, never overwrites.
3. **Every screening event freezes the exact list version(s) consulted**, not just "screened against OFAC" — capture *which* published snapshot, with its own timestamp and checksum.
4. **Report generation must be reproducible**: re-running the report for the same transaction ID six months later must render the *same* point-in-time facts, plus a clearly separated "status has changed since" addendum if applicable.

### A2. Data architecture — bitemporal sanctions store

Add a new module: `backend/src/compliance/sanctions/point-in-time/`

```sql
-- One row per list snapshot ever ingested. Never deleted.
CREATE TABLE sanctions_list_version (
  version_id          UUID PRIMARY KEY,
  source              TEXT NOT NULL,       -- 'OFAC_SDN' | 'OFAC_CONSOLIDATED' | 'UN_CONSOLIDATED' | 'EU_FSF' | 'UK_UKSL'
  published_at         TIMESTAMPTZ,        -- date the issuing authority published this version (from source metadata)
  ingested_at          TIMESTAMPTZ NOT NULL, -- when YOUR pipeline pulled it
  source_url           TEXT NOT NULL,
  file_sha256           TEXT NOT NULL,      -- checksum of raw file, for tamper-evidence
  raw_file_path         TEXT NOT NULL,      -- archived raw file, WORM storage (see A6)
  record_count          INT,
  is_delta              BOOLEAN DEFAULT false -- true for EU DELTA.XML-style incremental files
);

-- One row per entity-listing fact, versioned (SCD Type-2 style).
CREATE TABLE sanctions_entry (
  entry_id             UUID PRIMARY KEY,
  version_id           UUID REFERENCES sanctions_list_version(version_id),
  source_entity_id     TEXT NOT NULL,      -- the list's own ID (OFAC uid, UN reference number, EU entry ID, UK Group ID)
  entity_name          TEXT NOT NULL,
  aliases              JSONB,              -- AKA/FKA array
  entity_type          TEXT,               -- individual | entity | vessel | aircraft
  program_tags         TEXT[],             -- e.g. ['IRAN','RUSSIA-EO14024']
  identifiers          JSONB,              -- passport, national ID, IMO, SWIFT/BIC, DOB, address
  valid_from            DATE NOT NULL,      -- date added to the list, per official notice
  valid_to              DATE,               -- date delisted (NULL = still active in this version)
  raw_record            JSONB NOT NULL      -- full original record, untouched, for audit reproduction
);
CREATE INDEX idx_sanctions_entry_asof ON sanctions_entry (source_entity_id, valid_from, valid_to);

-- Immutable, hash-chained screening log. Append-only.
CREATE TABLE screening_event (
  screening_id          UUID PRIMARY KEY,
  transaction_id         TEXT NOT NULL,      -- your existing document/transaction ID
  party_role             TEXT NOT NULL,       -- exporter | importer | consignee | issuing_bank | advising_bank | end_user
  party_snapshot          JSONB NOT NULL,      -- exact name/address/IDs AS EXTRACTED at screening time (immutable copy)
  screened_at             TIMESTAMPTZ NOT NULL, -- system clock at screening
  as_of_date              DATE NOT NULL,        -- business-effective date (usually = screened_at date; different only on backfill/reprocessing)
  list_versions_used      UUID[] NOT NULL,      -- exact version_id(s) per source consulted
  match_result             TEXT NOT NULL,        -- NO_MATCH | POTENTIAL_MATCH | CONFIRMED_MATCH
  matched_entries          JSONB,                -- array of {entry_id, confidence_score, matching_fields}
  decision                  TEXT,                 -- ALLOW | REVIEW | BLOCK
  reviewed_by               TEXT,                 -- officer ID, if manually reviewed
  reviewed_at               TIMESTAMPTZ,
  prev_event_hash           TEXT,                 -- hash of previous screening_event row (any transaction) -> tamper-evident chain
  event_hash                TEXT NOT NULL          -- sha256(prev_event_hash + this row's canonical JSON)
);
```

**Why the hash chain (`prev_event_hash` / `event_hash`):** it makes retroactive tampering with old audit records detectable — if row #4,502 is edited after the fact, every hash after it breaks. This mirrors how tamper-evident logs work in serious compliance systems; you don't need a blockchain, just a running SHA-256 chain over an append-only table.

### A3. Source list ingestion — exact specs per authority

Build one adapter per source in `backend/src/compliance/sanctions/providers/`.

**OFAC (US Treasury) — `ofac.provider.ts`**
- Official source: **Sanctions List Service (SLS)**. It is a raw file delivery service only — no built-in matching, no rate limit published, no API key required.
- Discover current filenames dynamically (OFAC renames files without notice): call the `/sanctions-lists` metadata endpoint first, then download from `https://sanctionslistservice.ofac.treas.gov/api/download/{filename}`.
- Pull both `SDN_ADVANCED.XML` (relational schema — better for aliases, digital-currency addresses, IDs) and `CONSOLIDATED.XML` (non-SDN lists: SSI, FSE, NS-PLC, CAPTA, etc.).
- Recommended poll interval: every 1–4 hours. OFAC publishes on an irregular schedule tied to designation actions, not a fixed daily cadence — poll, don't assume.
- Every downloaded file gets archived + hashed into `sanctions_list_version` **even if unchanged** (record the checksum match — proves you checked).

**UN Security Council Consolidated List — `un.provider.ts`**
- Source: `main.un.org/securitycouncil` — XML/HTML/PDF, all UN official languages.
- **Critical gotcha:** the file's own "Generated on" field is the date *you* pulled it, not the date of the last substantive change — do not use it as `published_at`. Cross-reference the separate **update log page** (`list-updates-unsc-consolidated-list`) which timestamps each substantive change per sanctions committee (1267/ISIL-Al-Qaida, 1970 Libya, etc.) — use that for `valid_from` on individual entries.
- Poll daily; UN updates are event-driven (committee decisions), not scheduled.

**EU Financial Sanctions Files (FSF) — `eu.provider.ts`**
- Source: `webgate.ec.europa.eu/fsd/fsf` — **requires an EU Login account and a per-user token**; this is not a fully anonymous public endpoint like OFAC's. Budget time for account setup before coding the adapter.
- Three file types are offered — use all three for your use case:
  - `DELTA.XML` — only what changed since the last Regulation (good for near-real-time polling).
  - `GLOBAL.XML` — full current snapshot, active records only.
  - **`ANNUAL.XML`** — the full yearly history *including modification/deletion history*. This is your best source for backfilling `valid_from`/`valid_to` on entries and reconstructing "was this entity listed on date D" for dates before your own ingestion started.
- Files are typically posted the same day as Official Journal publication — poll a few times a day.

**UK Sanctions List (UKSL) — `uk.provider.ts`**
- **Do not build against "OFSI Consolidated List of Asset Freeze Targets" — it closed permanently on 28 January 2026.** The single current official source is the **UK Sanctions List**, maintained by the FCDO under the Sanctions and Anti-Money Laundering Act 2018, published at gov.uk in XML, CSV, HTML, PDF, TXT and XLSX.
- Update your README, your `.env` provider config, and any hardcoded list names accordingly — this is a functional bug in the current architecture description, not just cosmetic.
- Poll daily.

**Optional accelerant:** an aggregator like OpenSanctions normalizes all four (plus more) into one schema and tracks its own change history — useful to prototype matching logic fast, but it is a *paid* commercial license for business use (free tier is non-commercial only), and using it doesn't remove your obligation to independently retain the primary-source snapshots for audit defensibility. Treat it as a convenience layer, not a replacement for A2/A3.

### A4. Ingestion pipeline requirements

- Scheduled jobs (cron/queue worker), not on-demand-only. Also expose a manual "force refresh" trigger for compliance officers, but *always* also snapshot on that trigger.
- Idempotent: re-running a job for an unchanged source should not create duplicate `sanctions_list_version` rows — hash-compare first.
- Diff every new version against the previous one per source; emit a structured "what changed" event (additions, removals, modifications) — this both powers your existing "red-flag alert" UI and gives compliance officers a daily digest.
- Never delete a `sanctions_list_version` or its archived raw file. Storage is cheap; unreproducible audits are not. Use WORM-style storage (S3 Object Lock / versioned bucket with delete protection, or equivalent) for `raw_file_path`.
- Failure handling: if a source is unreachable, log it and **do not silently proceed as if the list were unchanged** — flag any screening performed during a stale window with a `stale_source_warning` on the screening event.

### A5. Deterministic matching engine

- Fuzzy match on name + transliteration variants + aliases, weighted by supporting identifiers (DOB, passport, national ID, IMO number, SWIFT/BIC, address, nationality). Name-only matching is the single biggest source of both false negatives and false positives — always score identifiers alongside the name.
- Confidence score, not a binary flag, feeding into `matched_entries`. Your existing 9-factor risk model already has a 30% Sanctions Risk weight — feed the confidence score in there rather than a blunt yes/no.
- Every match (and every no-match near a threshold) is logged, not just confirmed hits — a "we checked and it was close but didn't cross threshold" record is exactly what protects you in an audit.

### A6. Immutable audit log & storage

- `screening_event` table is INSERT-only at the application layer — enforce with DB permissions (no UPDATE/DELETE grants for the app's runtime role), not just code discipline.
- Hash-chain as described in A2. Optionally, batch-anchor daily hash roots to an external RFC 3161 trusted timestamp authority for an extra layer of "this record existed before date X" proof — not required for an MVP/student project, but this is the pattern real institutions use.

### A7. Point-in-time query & retroactive audit endpoint

New capability: answer "was Party X sanctioned as of date D" using historical data, not the current list.

```sql
SELECT * FROM sanctions_entry
WHERE source_entity_id = :entity_id
  AND valid_from <= :as_of_date
  AND (valid_to IS NULL OR valid_to >= :as_of_date);
```

New REST endpoints (add to your existing table):

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/sanctions/lists` | All tracked sources with their latest ingested version, published date, checksum |
| GET | `/api/sanctions/lists/:source/versions` | Full historical list of every ingested snapshot for a source (audit access) |
| GET | `/api/sanctions/entities/:sourceEntityId/history` | Full listing/delisting timeline for one entity across all sources |
| POST | `/api/sanctions/screen/as-of` | `{ parties: [...], as_of_date }` → point-in-time re-screen using historical snapshot, for audit reconstruction or backfilled transactions |
| GET | `/api/documents/:id/audit-certificate` | The immutable proof-of-screening record (hash, timestamp, exact list versions used) — separate from the narrative PDF report, meant for a regulator/auditor to independently verify |

### A8. Ongoing / continuous re-screening

- Nightly batch job: re-screen every counterparty that appears in an open/active trade relationship (not just new uploads) against the latest ingested lists.
- If a party that previously cleared now matches: create a **new** `screening_event` row (never modify the original), with `as_of_date` = today, and surface it as a distinct alert type: "Newly designated — no violation at original transaction date, review required for ongoing exposure."
- This is what actually answers your original question in production: the original transaction's audit certificate stays valid and unchanged forever; a *separate*, clearly dated new record captures the new designation.

### A9. Compliance report — required schema

Every generated PDF/report must contain, at minimum:

- **Transaction ID / reference number** (yours) + any bank reference/SWIFT message reference extracted from the document
- **Document metadata:** type, source file SHA-256 hash, upload timestamp
- **Screening metadata:** `screened_at` timestamp, `as_of_date`, and for **each** source list: version_id, published_at, ingested_at, file checksum
- **Per counterparty:** full legal name, all matched aliases, role (exporter/importer/consignee/bank/end-user), all identifiers used in matching, nationality/country
- **Per match (if any):** which list, matched entry ID, confidence score, the matched entry's own `valid_from` (critical — this is the date the party actually became sanctioned, which may be *after* your transaction date; state that explicitly)
- **9-factor risk score breakdown** with weights, as you already have
- **Decision + officer sign-off** (name, timestamp, digital signature if reviewed)
- **Explicit point-in-time statement**, e.g.: *"Screened 2026-06-01 09:14 UTC against OFAC SDN v.2026-05-30, UN Consolidated v.2026-05-28, EU FSF v.2026-05-31, UK UKSL v.2026-06-01. No match found at time of screening."*
- **Status-change addendum (auto-generated at report re-render time, clearly separated/boxed):** *"As of report generation ([today's date]), note: Entity [X] was subsequently added to [list] on [date], under program [Y]. This does not alter the compliance status of this transaction, screened and cleared on [original date] against the list versions then in force."*

---

## PART B — Drop-in system prompt for your RAG Compliance Copilot

Use this as (or merge into) the system prompt sent to your AI provider (`AI_PROVIDER` in `.env`) for the existing `/api/chat` copilot. It exists to stop the LLM from ever answering a sanctions-status question from its own training data instead of your database.

```
You are the TradeGuard Compliance Copilot. You answer questions about a specific screened
trade document using ONLY the structured screening data and document passages provided to
you in context. You never answer a sanctions-status question from general knowledge.

HARD RULES:
1. Never state whether a person, company, vessel, or bank is "currently sanctioned" or
   "not sanctioned" unless that fact comes from a `screening_event` or `sanctions_entry`
   record explicitly provided to you in this context, and you cite its list version and
   as_of_date.
2. Always distinguish between "sanctioned status at time of transaction (as_of_date: X)"
   and "sanctioned status as of today" — these can differ, and conflating them is the
   single most damaging error you can make. If asked "is this party sanctioned," ask
   yourself: sanctioned WHEN? If not specified, answer for the transaction's as_of_date
   and separately flag if that differs from the party's current status per your most
   recent screening_event.
3. If the data needed to answer isn't in the provided context (e.g. you weren't given a
   screening_event for a party being asked about), say so explicitly and suggest the user
   trigger a fresh screening — do not guess, estimate, or recall from training data.
4. Always cite: list source, list version/published date, and the as_of_date of the
   screening you're referencing, in every substantive answer.
5. You may explain WHY a risk score or flag was generated (referencing the 9-factor
   breakdown already computed), but you never recompute or override a risk score
   yourself — you explain a decision that was already made deterministically upstream.
6. If asked for the current, real-time sanctions status of an entity and no fresh
   screening exists, say the last available screening's as_of_date and recommend
   re-screening — never imply you have live internet access unless a fresh
   screening_event has genuinely just been created for this query.
```

---

## PART C — Pre-launch checklist ("no room for error")

Do not consider this feature done until all of these pass:

- [ ] Screening the same historical transaction twice, a year apart, produces an identical original point-in-time verdict (only the addendum may differ).
- [ ] Deleting/mutating a `screening_event` row is impossible at the DB permission level, not just blocked in application code.
- [ ] A party sanctioned *after* a transaction's `as_of_date` never causes that transaction's original decision to change — only a new, separately dated `screening_event` is created.
- [ ] Every report can show, per source list, the exact version/date consulted — not just "OFAC: no match."
- [ ] UK provider is pulling from the current **UK Sanctions List (UKSL)**, not the retired OFSI Consolidated List.
- [ ] A source outage during a screening is visibly flagged on that screening's record, not silently ignored.
- [ ] The RAG copilot, when asked "is this entity sanctioned," always answers with a specific as_of_date and list version — never a bare yes/no.
- [ ] A compliance officer / legal counsel has reviewed the matching thresholds and report language before any real transaction relies on this.
