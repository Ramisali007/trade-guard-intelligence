-- TradeGuard Intelligence — Bitemporal Sanctions Store & Hash-Chained Audit Log Schema
-- Conforms with Part A2 of TradeGuard Point-in-Time Sanctions Compliance Specification

-- 1. One row per list snapshot ever ingested. Never deleted.
CREATE TABLE IF NOT EXISTS sanctions_list_version (
  version_id          UUID PRIMARY KEY,
  source              TEXT NOT NULL,       -- 'OFAC_SDN' | 'OFAC_CONSOLIDATED' | 'UN_CONSOLIDATED' | 'EU_FSF' | 'UK_UKSL' | 'SBP_TFS'
  published_at        TIMESTAMPTZ,        -- date the issuing authority published this version (from source metadata)
  ingested_at         TIMESTAMPTZ NOT NULL, -- when YOUR pipeline pulled it
  source_url          TEXT NOT NULL,
  file_sha256         TEXT NOT NULL,      -- checksum of raw file, for tamper-evidence
  raw_file_path       TEXT NOT NULL,      -- archived raw file, WORM storage
  record_count        INT,
  is_delta            BOOLEAN DEFAULT false -- true for EU DELTA.XML-style incremental files
);

-- 2. One row per entity-listing fact, versioned (SCD Type-2 style).
CREATE TABLE IF NOT EXISTS sanctions_entry (
  entry_id             UUID PRIMARY KEY,
  version_id           UUID REFERENCES sanctions_list_version(version_id),
  source_entity_id     TEXT NOT NULL,      -- the list's own ID (OFAC uid, UN reference number, EU entry ID, UK Group ID)
  entity_name          TEXT NOT NULL,
  aliases              JSONB,              -- AKA/FKA array
  entity_type          TEXT,               -- individual | entity | vessel | aircraft | bank
  program_tags         TEXT[],             -- e.g. ['IRAN','RUSSIA-EO14024']
  identifiers          JSONB,              -- passport, national ID, IMO, SWIFT/BIC, DOB, address
  valid_from           DATE NOT NULL,      -- date added to the list, per official notice
  valid_to             DATE,               -- date delisted (NULL = still active in this version)
  raw_record           JSONB NOT NULL      -- full original record, untouched, for audit reproduction
);

CREATE INDEX IF NOT EXISTS idx_sanctions_entry_asof ON sanctions_entry (source_entity_id, valid_from, valid_to);

-- 3. Immutable, hash-chained screening log. Append-only.
CREATE TABLE IF NOT EXISTS screening_event (
  screening_id          UUID PRIMARY KEY,
  transaction_id        TEXT NOT NULL,      -- document/transaction ID
  party_role            TEXT NOT NULL,      -- exporter | importer | consignee | issuing_bank | advising_bank | end_user
  party_snapshot        JSONB NOT NULL,     -- exact name/address/IDs AS EXTRACTED at screening time (immutable copy)
  screened_at           TIMESTAMPTZ NOT NULL, -- system clock at screening
  as_of_date            DATE NOT NULL,        -- business-effective date
  list_versions_used    UUID[] NOT NULL,      -- exact version_id(s) per source consulted
  match_result          TEXT NOT NULL,        -- NO_MATCH | POTENTIAL_MATCH | CONFIRMED_MATCH
  matched_entries       JSONB,                -- array of {entry_id, confidence_score, matching_fields}
  decision              TEXT,                 -- ALLOW | REVIEW | BLOCK
  reviewed_by           TEXT,                 -- officer ID, if manually reviewed
  reviewed_at           TIMESTAMPTZ,
  prev_event_hash       TEXT,                 -- hash of previous screening_event row -> tamper-evident chain
  event_hash            TEXT NOT NULL         -- sha256(prev_event_hash + this row's canonical JSON)
);
