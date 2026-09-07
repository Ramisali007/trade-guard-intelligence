# TradeGuard Intelligence — Database Schema & Data Dictionary

## 1. Schema Architecture Overview

TradeGuard utilizes a **database-first canonical storage model** managed by `ComplianceStore`. The architecture is bitemporal (SCD Type-2), recording both valid real-world time (`effectiveFrom`, `effectiveTo`) and system transaction time (`recordedAt`, `syncedAt`).

The database engine is MongoDB, with automatic schema-mirrored JSON persistence in `backend/storage/compliance/` for full offline capability.

---

## 2. Collections Data Dictionary

### Collection 1: `compliance_sources`
Tracks external data feed metadata, schedules, checksums, and operational health.

| Field | Type | Description | Index |
| :--- | :--- | :--- | :--- |
| `sourceId` | `String` | Unique canonical source identifier (e.g. `OFAC_SDN`) | **Unique Primary** |
| `sourceName` | `String` | Full human-readable name of feed publisher | - |
| `category` | `Enum` | `SANCTIONS`, `COMMODITY_PRICING`, `MARITIME_AIS`, `PORT_AUTHORITY`, `EXCHANGE_RATES` | Standard |
| `frequencyMinutes`| `Number` | Scheduled polling frequency (e.g. 720, 1440) | - |
| `lastSyncAt` | `String (ISO)`| Timestamp of most recent sync execution | - |
| `lastStatus` | `Enum` | `HEALTHY`, `DEGRADED`, `FAILED`, `SUSPICIOUS` | Standard |
| `lastChecksum` | `String` | SHA-256 digest of last ingested clean snapshot | - |
| `recordCount` | `Number` | Total active records published by this source | - |
| `failureCount` | `Number` | Consecutive error count | - |
| `createdAt` | `String (ISO)`| Source registration date | - |
| `updatedAt` | `String (ISO)`| Last metadata update date | - |

---

### Collection 2: `compliance_sync_runs`
Audit ledger tracking every background ingestion or manual synchronization attempt.

| Field | Type | Description | Index |
| :--- | :--- | :--- | :--- |
| `syncRunId` | `String` | UUID for the synchronization execution | **Unique Primary** |
| `sourceId` | `String` | Reference to parent `compliance_sources.sourceId` | Compound Index (1) |
| `startedAt` | `String (ISO)`| Job initiation timestamp | Compound Index (2) |
| `completedAt` | `String (ISO)`| Job completion timestamp | - |
| `durationMs` | `Number` | Execution elapsed time in milliseconds | - |
| `status` | `Enum` | `SUCCESS`, `SKIPPED_NOT_MODIFIED`, `FAILED`, `SUSPICIOUS` | Standard |
| `recordsIngested`| `Number` | Count of records in raw feed payload | - |
| `recordsInserted`| `Number` | New records inserted into canonical collection | - |
| `recordsUpdated` | `Number` | Existing records modified (SCD Type-2 versioned) | - |
| `recordsUnchanged`| `Number`| Records with matching content hashes | - |
| `triggerType` | `Enum` | `SCHEDULED`, `MANUAL`, `SYSTEM_STARTUP`, `REPAIR` | - |
| `errorMessage` | `String?` | Stack trace or failure description if failed | - |

---

### Collection 3: `compliance_raw_snapshots`
Immutable staging table storing cryptographic copies of raw external feeds before transformation.

| Field | Type | Description | Index |
| :--- | :--- | :--- | :--- |
| `snapshotId` | `String` | UUID for the raw staging record | **Unique Primary** |
| `sourceId` | `String` | External feed source ID | Compound Index (1) |
| `capturedAt` | `String (ISO)`| Ingestion timestamp | Compound Index (2) |
| `checksumSha256` | `String` | SHA-256 digest of the payload content | Standard |
| `payloadJson` | `String` | Raw unparsed JSON/XML text representation | - |
| `byteSize` | `Number` | Payload size in bytes | - |
| `status` | `Enum` | `STAGED`, `VALIDATED`, `PROCESSED`, `REJECTED_ANOMALY` | Standard |

---

### Collection 4: `compliance_entities` (Bitemporal Sanctions)
Stores sanctioned individuals, companies, and institutions with SCD Type-2 temporal versioning.

| Field | Type | Description | Index |
| :--- | :--- | :--- | :--- |
| `canonicalId` | `String` | Natural or external identifier (e.g. `OFAC-992101`) | Standard Index |
| `sourceId` | `String` | Publishing regime (`OFAC_SDN`, `EU_FSF`, `UK_OFSI`) | - |
| `primaryName` | `String` | Primary official legal or individual name | Standard Index |
| `normalizedName` | `String` | Lowercase alphanumeric representation for fuzzy search | Standard Index |
| `aliases` | `Array<String>`| Alternative spellings, acronyms, and DBA names | Standard Index |
| `entityType` | `Enum` | `INDIVIDUAL`, `ENTITY`, `VESSEL`, `AIRCRAFT` | - |
| `country` | `String` | Primary operating or registration jurisdiction | Standard Index |
| `regime` | `String` | Sanctions program (e.g. `RUSSIA-EO14024`, `IRAN-TRA`) | - |
| `effectiveFrom`| `String (ISO)`| Historical valid from timestamp (Designation Date) | Compound Index (1) |
| `effectiveTo` | `String (ISO)?`| Historical valid to timestamp (Delisting Date / null) | Compound Index (2) |
| `isCurrent` | `Boolean` | True if this record represents the latest version | Compound Index (3) |
| `version` | `Number` | Monotonically increasing revision number (1, 2, ...) | - |
| `hashSha256` | `String` | SHA-256 digest of record contents for change detection | - |

---

### Collection 5: `compliance_price_benchmarks`
Stores official customs tariff corridors and wholesale commodity benchmarks.

| Field | Type | Description | Index |
| :--- | :--- | :--- | :--- |
| `benchmarkId` | `String` | Unique benchmark identifier (e.g. `BENCH-6205-SHIRTS`) | **Unique Primary** |
| `sourceId` | `String` | `UN_COMTRADE_PRICING`, `CUSTOMS_RULINGS` | - |
| `category` | `String` | Broad industry category | Standard Index |
| `productKey` | `String` | Semantic keyword token string for item matching | Compound Index (1) |
| `hsCodePrefix` | `String` | 2, 4, or 6-digit Harmonized Tariff prefix | Compound Index (2) |
| `benchmarkUnitPriceUsd` | `Number` | Central median market benchmark price | - |
| `observedLowUsd` | `Number` | Minimum plausible authentic market corridor price | - |
| `observedHighUsd` | `Number` | Maximum plausible authentic market corridor price | - |
| `unitOfMeasure`| `String` | Normalized unit of measure (`PCS`, `MTR`, `KG`, `MT`) | - |
| `incotermBasis` | `String` | Parity baseline (Standard: `FOB`) | - |
| `isCurrent` | `Boolean` | Current active indicator | Compound Index (3) |

---

### Collection 6: `compliance_vessels`
Stores global merchant fleet registry data, IMO numbers, and compliance statuses.

| Field | Type | Description | Index |
| :--- | :--- | :--- | :--- |
| `vesselId` | `String` | Canonical internal ID | **Unique Primary** |
| `imoNumber` | `String` | 7-digit International Maritime Organization number | **Unique Index** |
| `mmsi` | `String?` | 9-digit Maritime Mobile Service Identity | Standard Index |
| `name` | `String` | Official vessel registered name | Standard Index |
| `normalizedName` | `String` | Stripped alphanumeric name for fuzzy matching | Standard Index |
| `flagCountry` | `String` | Maritime flag registry nation | - |
| `vesselType` | `String` | `Container Ship`, `Bulk Carrier`, `Oil Tanker` | - |
| `isSanctioned` | `Boolean` | True if vessel appears on maritime blacklists | Standard Index |
| `isCurrent` | `Boolean` | Active version flag | - |

---

### Collection 7: `compliance_ports`
Stores official United Nations Code for Trade and Transport Locations (UN/LOCODE).

| Field | Type | Description | Index |
| :--- | :--- | :--- | :--- |
| `locode` | `String` | 5-character UN/LOCODE (e.g. `PKKHI`, `CNSHA`, `GBFXT`) | **Unique Primary** |
| `portName` | `String` | Official port name | Standard Index |
| `country` | `String` | Country name | - |
| `countryCode` | `String` | ISO 2-letter country code | Standard Index |
| `latitude` | `Number` | Decimal geographic latitude | - |
| `longitude` | `Number` | Decimal geographic longitude | - |
| `aliases` | `Array<String>`| Alternative transliterations and commercial port names | Standard Index |

---

### Collection 8: `compliance_fx_rates`
Stores point-in-time central bank foreign exchange conversion rates.

| Field | Type | Description | Index |
| :--- | :--- | :--- | :--- |
| `currencyCode` | `String` | 3-letter ISO-4217 code (e.g. `EUR`, `PKR`, `GBP`) | **Unique Primary** |
| `rateToUsd` | `Number` | Conversion multiplier to USD ($1 USD = X Currency) | - |
| `asOfDate` | `String (ISO)`| Valuation effective date | - |
| `sourceId` | `String` | Central bank feed reference | - |

---

## 3. Database Indexes

TradeGuard configures strict compound and unique indexes to guarantee high query throughput under sub-millisecond offline lookup constraints:

```typescript
// compliance_sources
db.compliance_sources.createIndex({ sourceId: 1 }, { unique: true });

// compliance_sync_runs
db.compliance_sync_runs.createIndex({ syncRunId: 1 }, { unique: true });
db.compliance_sync_runs.createIndex({ sourceId: 1, startedAt: -1 });

// compliance_raw_snapshots
db.compliance_raw_snapshots.createIndex({ snapshotId: 1 }, { unique: true });
db.compliance_raw_snapshots.createIndex({ sourceId: 1, capturedAt: -1 });

// compliance_entities
db.compliance_entities.createIndex({ canonicalId: 1 });
db.compliance_entities.createIndex({ normalizedName: 1 });
db.compliance_entities.createIndex({ aliases: 1 });
db.compliance_entities.createIndex({ primaryName: 1, isCurrent: 1 });
db.compliance_entities.createIndex({ effectiveFrom: 1, effectiveTo: 1 });

// compliance_price_benchmarks
db.compliance_price_benchmarks.createIndex({ benchmarkId: 1 }, { unique: true });
db.compliance_price_benchmarks.createIndex({ productKey: 1, hsCodePrefix: 1, isCurrent: 1 });

// compliance_vessels
db.compliance_vessels.createIndex({ imoNumber: 1 }, { unique: true });
db.compliance_vessels.createIndex({ normalizedName: 1 });

// compliance_ports
db.compliance_ports.createIndex({ locode: 1 }, { unique: true });
db.compliance_ports.createIndex({ portName: 1 });
db.compliance_ports.createIndex({ aliases: 1 });

// compliance_fx_rates
db.compliance_fx_rates.createIndex({ currencyCode: 1 }, { unique: true });
```
