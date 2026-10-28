# TradeGuard Intelligence — AI Trade Finance Compliance & Bitemporal Sanctions Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0%20%2F%205.9-blue.svg)](https://www.typescriptlang.org/)
[![Angular](https://img.shields.io/badge/Angular-20-dd0031.svg)](https://angular.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.22-lightgrey.svg)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.5-green.svg)](https://www.mongodb.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Enterprise Trade Compliance & Risk Intelligence**: TradeGuard Intelligence is a bank-grade, offline-capable, database-first platform for automated trade document examination, bitemporal sanctions screening, fair-market price valuation, and maritime vessel tracking. Built for commercial banks, Authorized Dealers (ADs), compliance examiners, and multinational trading desks.

---

## 📌 Table of Contents
1. [Executive Summary & Core Mission](#-executive-summary--core-mission)
2. [Database-First & 100% Offline-Capable Architecture](#-database-first--100-offline-capable-architecture)
3. [Continuous Synchronization Engine](#-continuous-synchronization-engine)
4. [The 9-Factor Explainable Compliance Engine](#-the-9-factor-explainable-compliance-engine)
5. [18-Rule Trade-Based Money Laundering (TBML) & Fraud Detection Engine](#-18-rule-trade-based-money-laundering-tbml--fraud-detection-engine)
5a. [Import LC Lifecycle — Pre-Trade to Post-Trade (`/trade-cases`)](#-import-lc-lifecycle--pre-trade-to-post-trade-trade-cases)
6. [Bitemporal Sanctions & Point-in-Time Evaluation (SCD Type-2)](#-bitemporal-sanctions--point-in-time-evaluation-scd-type-2)
7. [Enterprise Reference Data & Ingestion Center (`/import`)](#-enterprise-reference-data--ingestion-center-import)
8. [Real-Time Web Scraping & Multi-Carrier Tracking](#-real-time-web-scraping--multi-carrier-tracking)
9. [Selective Database Archive & Date Range Restoration](#-selective-database-archive--date-range-restoration)
10. [Left-Side Staggered Navigation System](#-left-side-staggered-navigation-system)
11. [Operational Control Dashboard (`/sources`)](#-operational-control-dashboard-sources)
12. [System Topology & Clean Directory Structure](#-system-topology--clean-directory-structure)
13. [Comprehensive REST API Reference](#-comprehensive-rest-api-reference)
14. [Quick Start & Developer Setup](#-quick-start--developer-setup)
15. [Bank-Grade Security & Hardening Architecture](#-bank-grade-security--hardening-architecture)
16. [Architectural Specifications & Documentation Index](#-architectural-specifications--documentation-index)

---

## 🌟 Executive Summary & Core Mission

**TradeGuard Intelligence** automates the end-to-end examination of complex trade presentations under **UCP 600, ISBP 745, FATF TBML guidelines, OFAC/UN/EU/UK regulations**, and the **State Bank of Pakistan (SBP) Foreign Exchange Manual**.

### Document Types Supported:
- **Commercial Invoices & Proforma Invoices**
- **Letters of Credit (LCs / Documentary Credits)**
- **Bills of Lading (B/L), Sea Waybills & Air Waybills**
- **Packing Lists & Weight Certificates**
- **Certificates of Origin & Inspection Certificates**
- **Purchase Orders & Sales Contracts**

### Key Problem Solved:
Trade document compliance cannot rely on live, ad-hoc internet lookups during document processing. Live web scraping during document examination introduces network latency, flakiness, rate limits, and failure during network outages. Furthermore, querying "today's" sanctions list against a transaction dated six months ago creates severe compliance inaccuracies:
- **False Negative**: An entity currently clean was sanctioned at transaction settlement time.
- **False Positive**: An entity currently designated was fully compliant and unlisted when the transaction occurred.

TradeGuard addresses these failures with a **database-first, bitemporal** architecture: lists are synced ahead of time and every transaction is screened as of its own document date.

---

## ⚡ Database-First & 100% Offline-Capable Architecture

```
                                    DOCUMENT ANALYSIS PIPELINE (100% OFFLINE)
 Document Presentation
 [PDF / DOCX / DOC] ──────► Extract ──► Structure ──► Chunk ──► 9-Factor Compliance Engine ──► Audit Report & PDF
                                                                          │
                                       ┌──────────────────────────────────┴──────────────────────────────┐
                                       ▼                                                                 ▼
                             Primary Tier: MongoDB                                          Secondary Tier: Disk Mirror
                        (compliance_* collections)                                         (backend/storage/compliance/*.json)
                        • 8 Compound-Indexed Collections                                   • Instant fallback on ECONNREFUSED
                        • SCD Type-2 Bitemporal Entities                                   • Zero network requests attempted
```

### Core Architecture Pillars:
1. **Database-First Screening**:
   Sanctions screening, FX conversion and price benchmarking read the local canonical database (`ComplianceStore`); sanctions lists are downloaded ahead of time by the sync engine, not during analysis. Outbound calls during an analysis are limited to: the configured AI provider (none with `AI_PROVIDER=heuristic`), optional vessel enrichment when a vessel/IMO is present, and the open-web price lookup, which is **off by default** (`ENABLE_WEB_PRICE_LOOKUP=false`) and never drives a finding.
2. **Dual-Tier Resilient Persistence**:
   - **Primary Tier**: MongoDB with compound indexes across 8 compliance collections (`compliance_entities`, `compliance_sources`, `compliance_price_benchmarks`, `compliance_ports`, `compliance_vessels`, `compliance_fx_rates`, `compliance_sync_runs`, `compliance_audit_log`).
   - **Secondary Tier**: Automatic fallback to local disk JSON mirrors (`backend/storage/compliance/`) when MongoDB clusters are unreachable (`ECONNREFUSED`), guaranteeing 100% system availability.
3. **Multi-Format Extraction**:
   High-fidelity text and structure extraction via `pdfjs-dist` (PDF), `mammoth` (DOCX), and `word-extractor` (DOC), backed by Tesseract OCR (`eng.traineddata`) for scanned image passages.

---

## 🔄 Continuous Synchronization Engine

A decoupled, background synchronization engine (`SyncEngineService` & `SyncSchedulerService`) keeps the local compliance database authoritative and synchronized with upstream regulatory feeds.

```
       [ Upstream Regulatory Feeds ]
  (OFAC, UN, EU, UK, SBP, Comtrade, LOCODE)
                     │
                     ▼
  Stage 1: Fetch & Staging Layer
                     │
                     ▼
  Stage 2: SHA-256 Checksum Diff ────────► Unchanged? ──► Skip (0ms, Zero DB Writes)
                     │
                     ▼ (Changed Feed)
  Stage 3: Anomaly Defense Guard ────────► >20% Record Drop? ──► Reject & Alert (Shield DB)
                     │
                     ▼ (Sanity Passed)
  Stage 4: SCD Type-2 Publication ───────► Retire Old (`effectiveTo = now`) & Publish New Version
```

### Registered Sources and What Is Actually Connected
Every registered source has a **live connector** that downloads the publisher's own file (`backend/src/compliance/sync/feed-connectors.ts`); a source only shows FRESH after a successful download, and ages to AGING/STALE when downloads stop. Pricing is deliberately conservative: Comtrade refreshes only Comtrade-derived corridors (trimming the highest and lowest exporter), never curated or imported benchmarks, and benchmarks priced in units Comtrade does not report (e.g. linear metres) are left unchanged with the reason recorded on the source.

| Source ID | Publisher feed | Cadence | Connector |
| :--- | :--- | :---: | :---: |
| `OFAC_SDN` | OFAC SDN list (`SDN.CSV` + `ALT.CSV` aliases, ~19k entries) | Daily | ✅ Live |
| `UN_CONSOLIDATED` | UN Security Council Consolidated List (XML, with `LISTED_ON` dates) | Daily | ✅ Live |
| `CENTRAL_BANK_FX` | Daily FX reference rates, USD base (open.er-api.com) | Daily | ✅ Live |
| `EU_FSF` | EU Consolidated Financial Sanctions List (semicolon CSV, ~6.2k entries, designation dates) | Daily | ✅ Live |
| `UK_SANCTIONS_LIST` | UK Sanctions List, FCDO (CSV, ~6.4k entries incl. ships with IMO numbers) | Daily | ✅ Live |
| `SBP_TFS_LIST` | Pakistan proscribed organisations — NACTA PDF (82 Schedule-I orgs + affiliates, Schedule-II watch list, UNSCR 1267) | Weekly | ✅ Live |
| `UN_LOCODE_PORTS` | UN/LOCODE seaports (~17.6k, via the datasets/un-locode mirror of UNECE's list) | Monthly | ✅ Live |
| `UN_COMTRADE_PRICING` | UN Comtrade export unit values (public preview API) for `BENCH-COMTRADE-*` corridors | Weekly | ✅ Live |

**Bitemporal rules applied by the sync engine:** records are versioned by the publisher's own ID; an amended record closes its old version; a record that disappears is *delisted* (`validTo` = sync date) and kept, so earlier transactions still screen as listed. OFAC's CSV publishes no designation dates, so entries present at first load are treated as listed for any past date (conservative, marked `UNKNOWN_ASSUMED_PRIOR`); entries first seen later are dated from the previous successful sync. UN entries use their published `LISTED_ON` date. Freshness ages to `AGING`/`STALE` automatically if downloads stop succeeding.

---

## 🛡️ The 9-Factor Explainable Compliance Engine

The composite risk score ($0–100$) is computed via a transparent, weighted regulatory formula:

$$\text{Overall Risk} = \text{round}\left(\begin{array}{l}
S_{\text{sanctions}} \times 0.30 + S_{\text{exportControl}} \times 0.15 + S_{\text{goodsScope}} \times 0.15 + \\
S_{\text{tbml}} \times 0.15 + S_{\text{endUse}} \times 0.08 + S_{\text{endUser}} \times 0.07 + \\
S_{\text{docIntegrity}} \times 0.04 + S_{\text{anomaly}} \times 0.04 + S_{\text{geographic}} \times 0.02
\end{array}\right)$$

### 1. Sanctions Screening (`sanctions/`)
Screens counterparties, banks, vessels, and ports across US, UN, EU, UK, and Pakistan lists with fuzzy string matching, alias matching, and jurisdictional embargo checks.

### 2. Beneficial Ownership & OFAC 50% Rule (`ownership/`)
Traverses corporate hierarchy graphs to calculate aggregate blocked beneficial ownership. If blocked entities hold $\ge 50\%$ aggregate equity, the entity is blocked by operation of law.

### 3. State Bank of Pakistan (SBP) Framework (`sbp/`)
Enforces **FE Manual Chapter 13 (Imports) & Chapter 12 (Exports)** rules, validating Authorized Dealer requirements, Electronic Import Form (EIF) compliance, and mandatory TFS screening.

### 4. Dual-Use & Multilateral Export Controls (`export-control.service.ts`)
Analyzes product specifications and HS codes against the Wassenaar Arrangement and US Commerce Control List (EAR99 / ECCNs) for categories like 6A005 (lasers), 3A001 (semiconductors), and 9A012 (drones).

### 5. Goods Scope & Customer Business Profile (`goods-scope.service.ts`)
Compares billed items against customer historical categories and declared lines of business, immediately flagging out-of-scope commodities.

### 6. TBML & Market Pricing Valuation (`pricing/`)
Detects over-invoicing, under-invoicing, and capital flight indicators by comparing declared unit values against official UN Comtrade benchmark corridors.

### 7. Maritime Logistics & Vessel Tracking (`maritime/`)
Extracts Vessel Name, IMO number, MMSI, Container Number, and Bill of Lading. Verifies Port of Loading (POL), Port of Discharge (POD), and transshipment hubs against canonical UN/LOCODE records.

### 8. Customer 360 Behavioral Risk Analytics (`behavioral/`)
Maintains customer risk profiles, monitoring transaction frequency, monthly volume spikes, routing deviations, and counterparty continuity over time.

### 9. Mathematical & Document Integrity (`math-integrity.service.ts`)
Deterministically verifies line item math:
$$\text{Line Total} = \text{Quantity} \times \text{Unit Price}$$
$$\text{Grand Total CIF} = \text{Subtotal FOB} + \text{Freight} + \text{Insurance} + \text{Taxes}$$

### Compliance Decision Thresholds:
- 🟢 **`ALLOW`** (Risk: 0–34) — Fully compliant presentation; proceed with trade settlement.
- 🟡 **`REVIEW`** (Risk: 35–79) — Enhanced Due Diligence (EDD) required; explanation or license needed.
- 🔴 **`BLOCK_ESCALATE`** (Risk: 80–100) — Direct sanctions match, embargoed port, or critical violation; immediate halt.

---

## 🚨 18-Rule Trade-Based Money Laundering (TBML) & Fraud Detection Engine

TradeGuard incorporates an enterprise, rule-deterministic TBML & forensic fraud engine (`backend/src/compliance/fraud/`) executing across 18 banking scenarios under FATF, Wolfsberg Group, and BAFT standards:

| # | Detection Scenario | Category | Primary Rule & Enforcement |
|:---|:---|:---|:---|
| **1** | **Genuine Baseline Verification** | Baseline | Clean trade presentations pass with zero false-positive alerts. |
| **2** | **Exact Document Re-Upload** | Forensic Replay | Byte SHA-256 hash matching flags legitimate duplicate submissions without duplicating DB records. |
| **3** | **Transaction Identity Resubmission** | Forensic Replay | Re-rendered trade documents with identical core identities identified as legitimate duplicate representations. |
| **4** | **Document Replay with Tampering** | Fraud / Tampering | Replayed document with altered amounts/dates triggers `CRITICAL` document tampering alerts. |
| **5** | **Cross-Customer ID Conflict** | Fraud / Hijacking | Transaction reference reuse across different customers triggers immediate `CRITICAL` alert. |
| **6** | **Invoice Reuse Across Different Buyers** | Fraud / Double Invoicing | Same seller reusing invoice number for distinct buyers without credit notes flagged. |
| **7** | **Tier 1/3 Core Banking Payment Match** | Payment Verification | Document settlement claims matched against authoritative MT103 / core banking ledger. |
| **8** | **Tier 2 SWIFT GPI UETR Match** | Payment Verification | Authoritative confirmation via SWIFT GPI Unique End-to-End Transaction Reference (UETR). |
| **9** | **Legitimate Repeated UETR** | False Positive Guard | Multiple documents (e.g. invoice + advice) sharing the same UETR within one deal permitted without alert. |
| **10** | **Synthetic / Conflicting UETR Reuse** | Payment Fraud | UETR reused across unrelated deals or contradictory settlement amounts triggers `CRITICAL`. |
| **11** | **Document "Paid" Without Bank Record** | Advisory Tier 6 | Unverified payment claims mapped to informational Tier 6 advisory (non-punitive). |
| **12** | **Contradicted Settlement (Rejected/Reversed)**| Payment Fraud | Document claiming "paid" when authoritative banking records show rejected/reversed settlement triggers Tier 8 alert. |
| **13** | **Bill of Lading Reuse** | Maritime Logistics | Reusing the same B/L on contradictory vessels or conflicting voyages flagged as `CRITICAL`. |
| **14** | **ISO 6346 Container Check-Digit** | Logistics Verification | Algorithmic ISO check-digit validation flags forged or fictitious container numbers. |
| **15** | **Container Logistics Conflict** | Logistics Anomaly | Container assigned to simultaneous active voyages at contradictory ports triggers conflict. |
| **16** | **Multiple Invoicing / Double Financing** | TBML Double Financing | Identical goods and invoices pledged across multiple trade facilities detected. |
| **17** | **UCP 600 Partial Drawing / Shipment** | False Positive Guard | Legitimate partial shipments under documentary credits recognized without false-positive alerts. |
| **18** | **Customer Frequency / Velocity Surge** | Behavioral Anomaly | Sudden abnormal surge in transaction frequency or volume against 90-day baseline flagged. |

---

## 🧭 Import LC Lifecycle — Pre-Trade to Post-Trade (`/trade-cases`)

One **trade case** (`TC-<year>-<n>`) carries an import LC from the customer's request to case closure, reusing the document pipeline and every engine above:

**Request → PI intake → validation → RM / Trade Ops / Compliance / Credit reviews (parallel) → queries & corrections → maker-checker authorisation → issuance (sandbox) → amendments (reviewed, authorised, sandbox-issued, effective on beneficiary acceptance) → presentation → examination against the terms in force → applicant waiver / bank decision → settlement record → monitoring / investigation → closure.**

- **Versioned application, nothing overwritten.** Every correction is a new version; the PI ↔ application comparison shows both values and where in the PI the value was found (page and excerpt).
- **Typed findings with owners.** Missing information, data inconsistency, LC-term, regulatory, compliance, TBML, credit, low-confidence extraction and documentary discrepancy, each with a rule id, severity, evidence and history. A data finding resolves itself when corrected; a compliance or TBML finding waits for a compliance officer's disposition.
- **Permission registry, default deny.** 14 roles map to 67 explicit permissions with a data scope each (own customer, assigned customers, institution, none). Every API route names its permission, and a test fails if one does not. The service then re-checks scope, workflow state and separation of duties. The maker can't authorise, the approver can't issue, whoever recorded a presentation can't decide it, and the system administrator holds no business permission at all. See [docs/RBAC_PERMISSION_MATRIX.md](docs/RBAC_PERMISSION_MATRIX.md).
- **Role portals.** Each sign-in lands on `/workspace`: the screens its permissions open and the cases waiting on it, built from the same registry. Compliance, credit and investigation detail is redacted on the server for roles that may not read it. Customers see only their own cases and never a compliance or TBML finding.
- **Amendments never edit the issued credit.** An amendment is its own record: revalidated, reviewed by the departments the change concerns, authorised maker-checker, issued in the sandbox, and effective only once the beneficiary's acceptance is recorded. Examination uses the effective terms.
- **Honest integrations.** Issuance is a **sandbox** record (no SWIFT, no PSW transmission); credit limits are officer-verified or labelled sandbox; settlement is recorded, never initiated.
- **Hash-chained audit log** per case, anchored on the case record so deleting the newest entries is detected too; verifiable from the Audit tab and the auditor's *Audit explorer*.
- **Administration with dual control.** Accounts start with no role; a role change is a request a second administrator approves; nobody changes their own access; a role change, revocation or disable ends that user's sessions immediately. All of it goes to a hash-chained identity log.

See [docs/TRADE_LIFECYCLE_ARCHITECTURE.md](docs/TRADE_LIFECYCLE_ARCHITECTURE.md) (workflow, data model, API), [docs/REGULATORY_SOURCE_REGISTER.md](docs/REGULATORY_SOURCE_REGISTER.md) (rules and their sources), [docs/RBAC_PERMISSION_MATRIX.md](docs/RBAC_PERMISSION_MATRIX.md) (roles and permissions, generated), [docs/INTEGRATION_INVENTORY.md](docs/INTEGRATION_INVENTORY.md) (what is live, sandbox or manual) and [docs/PILOT_READINESS_REPORT.md](docs/PILOT_READINESS_REPORT.md) (evidence and what remains before a pilot).

---

## ⏳ Bitemporal Sanctions & Point-in-Time Evaluation (SCD Type-2)

TradeGuard implements Slowly Changing Dimensions (SCD Type-2) across all watchlist records:

```typescript
interface ComplianceEntityRecord {
  entityId: string;
  sourceId: string;
  legalName: string;
  aliases: string[];
  entityType: 'INDIVIDUAL' | 'ORGANIZATION' | 'VESSEL';
  effectiveFrom: string;           // Valid Time Start
  effectiveTo: string | null;      // Valid Time End (null if currently active)
  version: number;                 // Monotonically increasing version
  isCurrent: boolean;              // True for the latest active snapshot
  checksumSha256: string;          // Cryptographic provenance digest
}
```

- **Historical Accuracy**: A document from June 2024 is evaluated against the regulatory snapshot effective on June 2024.
- **Post-Transaction Monitoring**: Entities designated after the document date trigger `ADDED_AFTER_TRANSACTION` exposure alerts without generating false retroactive violations.

---

## 🌐 Enterprise Reference Data & Ingestion Center (`/import`)

TradeGuard features a dedicated **Enterprise Master Data Management & Multi-Modal Ingestion Center** at `/import`:

```
                                  4-TIER DATA RESOLUTION HIERARCHY
               Trade Document Examination / Transaction Screening
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
    Priority 1: Live Scraper                              Priority 2: Local Database Fallback
    (Fresh Web Scraping / AIS Feeds)                     (Authoritative Canonical Records)
    Tagged: `provenance.status = FRESH`                   Tagged: `provenance.status = DATABASE_FALLBACK`
            │                                                     │
            └──────────────┬──────────────────────────────────────┘
                           ▼ (Historical Transaction Date / Old Bill of Lading)
                   Priority 3: Point-in-Time Historical Evaluation
                   (SCD Type-2 Validity Window: `effectiveFrom` → `effectiveTo`)
                   Tagged: `provenance.status = HISTORICAL`
                           │
                           ▼ (Unverifiable or Non-Existent Entity)
                   Priority 4: Zero-Hallucination Safe Fallback
                   (Null benchmarks / Non-fabricated status)
                   Tagged: `provenance.status = UNKNOWN`
```

### Key Capabilities:
- **11 Canonical Master Entities**:
  1. `countries`: Sovereign jurisdictions, ISO Alpha-2/3, FATF blacklist flags, and SBP currency controls.
  2. `sanctions`: OFAC, UN, EU, UK, and SBP targeted parties with hash-deterministic IDs (`SAN-OFAC-...`).
  3. `commodity_prices`: Official UN Comtrade international pricing benchmark corridors (`PRC-{HS}-{Key}-{UOM}`).
  4. `products`: Harmonized System (HS) codes, ECCN classifications, and dual-use indicators.
  5. `ports`: UNECE UN/LOCODE maritime ports, terminals, and transshipment hubs (`PKKHI`, `SGSIN`).
  6. `shipping_routes`: Maritime chokepoints, canal transits, and corridor risk ratings.
  7. `companies`: Customer 360 registries, national tax IDs, and authorized trade lines.
  8. `banks`: SWIFT BIC registries and SBP Authorized Dealer regulatory classifications.
  9. `currencies`: ISO 4217 currencies, pegged exchange controls, and reporting thresholds.
  10. `regulations`: Dual-use statutory regulatory orders (SROs) and licensing mandates.
  11. `vessels`: IMO 7-digit ship registrations, MMSI telemetry, and flag states.

- **Master Catalog Dropdown Navigation**:
  Intuitive catalog selector dropdown replacing horizontal scrollbars with instant entity switching, real-time record counting, and live scraping status badges.

- **Precision Field Patching & Audit Diffing**:
  Dedicated UI modal to modify specific entity attributes (e.g. risk scores, sanction designations, price corridors) with compliance remarks and immutable field-level diff tracking.

- **Enterprise Bulk Ingestion & Security Defenses**:
  - **CSV Injection Shield (`sanitizeForCsvInjection`)**: Automatically sanitizes spreadsheet formulas (`=`, `+`, `-`, `@`, `\t`, `\r`) by prepending a single quote `'` to prevent arbitrary spreadsheet code execution.
  - **SSRF Defense (`fetchUrlSourceSafely`)**: Validates HTTP(S) sources against the address the socket actually connects to, refuses redirects, caps the body at 5 MB, and blocks RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), localhost, and cloud metadata IPs (`169.254.169.254`).
  - **Batch Audit Ledger**: Every import generates a unique audit tracking batch (`IMP-YYYYMMDD-XXXXXX`) with granular execution metrics.

---

## 🌐 Real-Time Web Scraping & Multi-Carrier Tracking

For live market rates, maritime logistics, and container status resolution, TradeGuard integrates real-time web scraping services (`SCRAPING.md`) with automatic database fallback:

- **VesselFinder Real-Time Vessel Scraper (`RealtimeVesselFinderScraperService`)**:
  - Live lookup of commercial transport vessels by 7-digit IMO number or vessel name.
  - Extracts flag state, vessel classification (Container Ship, Bulk Carrier, Crude Oil Tanker), build year, and deadweight tonnage (DWT).
  - Strict match validation eliminates false-positive search table selections.
- **Central Bank & Multi-Source FX Scraper (`FxRatesService`)**:
  - Extracts real-time interbank foreign exchange rates from authentic central bank web sources.
  - Provides instantaneous cross-currency conversion between USD, EUR, GBP, AED, CNY, and PKR.
- **Multi-Carrier Container Logistics Scraper (`ContainerBlScraperService`)**:
  - Validates container IDs against the ISO 6346 algorithmic check digit standard.
  - Reconstructs active voyages and port calls to flag logistical impossibilities or simultaneous container presence across incompatible ports.
- **Real-Time Commodity Market Scraper (`RealtimeMarketScraperService`)**:
  - Fetches live market spot rates for key commodities (e.g. Brent Crude, Wheat, Metals) to detect over-invoicing and under-invoicing against UN Comtrade historical benchmark corridors.

---

## 📦 Selective Database Archive & Date Range Restoration

TradeGuard provides completely non-destructive document lifecycle management:

- **Clean Dashboard History**: Compliance officers can clear active presentations from the main workbench to maintain operational cleanliness without deleting underlying database records.
- **Selective Restoration with Date Range Filtering**:
  - Clicking **"Restore from Cloud"** prompts for a date interval (`From Date (Start)` to `To Date (End)`).
  - Calculates live matches from the database: `X of Y document(s) match this date filter`.
  - Supports full archive restoration or targeted point-in-time interval restoration.
  - Archiving never deletes: the record, its extracted passages, events and the **original file** (stored in GridFS on MongoDB, or a separate file in memory mode) all stay. An archive or restore request must say what it covers (`all`, a list of `ids`, or a date range); an empty request is refused instead of meaning "everything".
  - Permanent erasure is a separate, irreversible action (`POST /api/documents/:id/purge`) behind its own permission (`documents.purge`, Chief Compliance Officer), a written reason and an explicit confirmation; it removes the record, passages, events, images, cached reports and the stored original, and is logged.

---

## 🎨 Left-Side Staggered Navigation System

An enterprise-grade navigation experience inspired by React Bits:
- **Left-Positioned Staggered Menu**: Seamless collapsible drawer on the left viewport.
- **GSAP Physics & Micro-Interactions**: Fluid, staggered menu item reveals with SVG morphing icon transitions.
- **Full Responsive Viewport Adaptation**: Optimized across mobile phones, tablets, standard laptops, and high-DPI desktop displays.

---

## 🖥️ Operational Control Dashboard (`/sources`)

The Angular frontend includes a dedicated enterprise control workbench at `/sources`:
- **Global Ingestion Metrics**: Overall health status, active source count, total entities in database, and last-sync timestamps.
- **Per-Source Health Cards**: Status badges (`FRESH`, `SYNCING`, `DEGRADED`, `ANOMALY_BLOCKED`), record counts, version numbers, and SHA-256 checksums.
- **Manual Control Actions**: Independent **"Sync Now"** trigger buttons per feed and a global **"Sync All Sources"** button.
- **Live Sync Audit History**: Chronological run log displaying duration, records inserted/updated, actor, and status.

---

## 📂 System Topology & Clean Directory Structure

The repository contains **100% pure application code** with all temporary test scripts, scratch directories, and obsolete ad-hoc files completely eliminated:

```
trade-guard-intelligence/
├── ARCHITECTURE.md                 # High-level architecture & request lifecycles
├── DATABASE_SCHEMA.md              # MongoDB collections, indexes & SCD Type-2 schemas
├── DATA_SYNC.md                    # 8-Source sync engine & anomaly guard specifications
├── DEDUPLICATION.md                # Enterprise document & transaction deduplication engine
├── SCRAPING.md                     # Web scraping & AI API integration documentation
├── OFFLINE_MODE.md                 # Dual-tier persistence & offline validation guide
├── AUDIT_AND_PROVENANCE.md         # Bitemporal mechanics & SHA-256 evidence packages
├── OPERATIONS.md                   # Operations runbook & API endpoint documentation
├── sample_reports/                 # Production-ready test document dossiers
│   ├── TradeGuard_Test_Commercial_Invoice_INV-8842.docx
│   ├── Import LC.docx
│   ├── Liberty_Mills_Sales_Contract_CTR-050.pdf
│   └── Pakistan_Customs_GD_Bill_of_Export_GD2905.pdf
│
├── backend/
│   ├── src/
│   │   ├── __tests__/              # 6 Enterprise test suites (Security, Dedup, Analytics, Integration, Fraud, Import)
│   │   ├── ai/                     # AI classification & heuristic trade extractors
│   │   ├── compliance/             # 10 Compliance engines & local data stores
│   │   │   ├── behavioral/         # Customer 360 & entity resolution
│   │   │   ├── db/                 # ComplianceStore (MongoDB + local disk mirror)
│   │   │   ├── fraud/              # Enterprise Fraud & TBML Engine (Replay, Invoice reuse, SWIFT GPI, Logistics)
│   │   │   ├── maritime/           # AIS vessel tracking & port route analyzer
│   │   │   ├── nexus/              # Jurisdictional nexus assessment
│   │   │   ├── ownership/          # Beneficial ownership & OFAC 50% Rule
│   │   │   ├── pricing/            # UN Comtrade valuation corridors
│   │   │   ├── regulatory/         # Pakistan Trade Policy & bitemporal rules
│   │   │   ├── retro/              # Post-transaction monitoring
│   │   │   ├── sanctions/          # Multi-jurisdiction sanctions screening
│   │   │   ├── sbp/                # State Bank of Pakistan compliance
│   │   │   ├── sync/               # SyncEngineService & SyncSchedulerService
│   │   │   └── temporal/           # SnapshotRegistry & bitemporal types
│   │   ├── config/                 # Application config & trade taxonomy
│   │   ├── controllers/            # REST route controllers
│   │   ├── document-processing/    # PDF, DOCX, DOC extractors & normalizer
│   │   ├── middleware/             # Rate limiters, upload middleware & loggers
│   │   ├── models/                 # Document schemas & state interfaces
│   │   ├── routes/                 # Express API routes
│   │   ├── services/               # Document pipeline & PDF report generator
│   │   ├── types/                  # Shared TypeScript type definitions
│   │   ├── utils/                  # Cryptography, errors & logger
│   │   ├── app.ts                  # Express application configuration
│   │   └── server.ts               # Server startup & background sync bootstrap
│   ├── scripts/                    # Operational & maintenance utilities
│   │   ├── generate_liberty_dossier.js  # Automated dossier PDF generator
│   │   ├── migrate_atlas_to_local.js    # Data migration utility
│   │   └── verify_dual_write.ts         # Dual-sync validation utility
│   ├── storage/                    # Persistent disk storage (compliance mirror, uploads)
│   ├── eng.traineddata             # Tesseract OCR language pack for image extraction
│   ├── package.json                # Production scripts (dev, build, start, typecheck, test)
│   ├── tsconfig.json               # Scoped strictly to src/**/*.ts and scripts/**/*.ts
│   └── tsconfig.build.json         # Production compiler configuration (excludes tests and scripts)
│
└── frontend/
    ├── src/
    │   ├── app/
    │   │   ├── models/             # Frontend DTO interfaces
    │   │   ├── pages/              # Angular components
    │   │   │   ├── dashboard/      # Document upload & presentations list
    │   │   │   ├── processing/     # Live 7-stage processing progress bar
    │   │   │   ├── analysis/       # Flagship compliance & risk workbench
    │   │   │   └── sources/        # Regulatory sources health dashboard
    │   │   ├── services/           # DocumentsService & ThemeService
    │   │   ├── shared/             # Shared Icon component
    │   │   ├── app.config.ts       # Angular app configuration
    │   │   ├── app.html            # Navigation shell template
    │   │   └── app.routes.ts       # Application routes
    │   ├── styles.scss             # Design tokens (Dark/Light mode)
    │   └── main.ts                 # Angular bootstrap
    ├── angular.json
    ├── package.json
    ├── proxy.conf.json             # Dev proxy (routes /api to localhost:4000)
    └── tsconfig.json
```

---

## 📡 Comprehensive REST API Reference

### Document Processing & Results
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/documents/upload` | Upload single trade document (`.pdf`, `.docx`, `.doc`) |
| `POST` | `/api/documents/upload-batch` | Upload presentation batch of trade documents |
| `GET` | `/api/documents` | List all processed trade presentations |
| `GET` | `/api/documents/:id` | Get document metadata and processing status |
| `GET` | `/api/documents/:id/results` | Get full 9-factor compliance decision & risk breakdown |
| `GET` | `/api/documents/:id/evidence` | Retrieve cryptographic SHA-256 audit package |
| `GET` | `/api/documents/:id/report/pdf` | Download publication-grade PDF compliance dossier |
| `POST` | `/api/documents/:id/override` | Record human compliance officer override |

### Master Data Management & Import Center (`/api/import`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/import/entities` | List all 11 registered master entities with schemas and live counts |
| `GET` | `/api/import/:entity` | Query canonical records with text search, status filters, and pagination |
| `POST` | `/api/import/:entity` | **Submit** a new entity or field patch for approval (202); versioned (SCD Type-2) once approved |
| `POST` | `/api/import/:entity/preview` | Generate validation and duplicate conflict preview for CSV/JSON payloads |
| `POST` | `/api/import/:entity/bulk` | **Submit** a validated bulk batch for approval (202); applied only when a different officer approves |
| `GET` | `/api/import/changes` | Reference-data changes awaiting or past a decision (the four-eyes queue) |
| `POST` | `/api/import/changes/:changeId/decision` | Approve or reject another officer's change (`masterdata.approve`; a submitter cannot decide their own) |
| `POST` | `/api/import/:entity/scrape` | Trigger external web scraper / feed synchronization with local cache fallback |
| `GET` | `/api/import/batches` | List historical import batch runs (`IMP-YYYYMMDD-XXXXXX`) |
| `GET` | `/api/import/audit` | Retrieve immutable compliance audit logs and field diffs |

### Archive & Document Restoration
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/documents/archived-count` | Get total and date-filtered count of archived database presentations |
| `POST` | `/api/documents/restore-history`| Restore archived presentations by date range (`fromDate`, `toDate`) or all |
| `POST` | `/api/documents/delete-history` | Archive presentations (`all`, `ids` or `fromDate`/`toDate` are required); nothing is deleted |
| `POST` | `/api/documents/:id/purge` | Permanently erase one document (`documents.purge`; needs `reason` of 20+ characters and `confirm: true`) |

### Regulatory Sources & Sync Engine
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/documents/compliance/sources` | List all 8 regulatory feeds and health metrics |
| `POST` | `/api/documents/compliance/sources/:id/sync` | Trigger manual synchronization for a specific feed |
| `POST` | `/api/documents/compliance/sources/sync-all` | Trigger synchronization across all 8 feeds |
| `GET` | `/api/documents/compliance/health` | Get overall compliance store status & storage driver |
| `GET` | `/api/documents/compliance/retrospective-alerts` | List post-transaction sanctions exposure alerts |

---

## 🚀 Quick Start & Developer Setup

### Prerequisites:
- **Node.js**: `v20.19.0` or higher
- **npm**: `v10+`
- **MongoDB** (optional): Local or Atlas connection (falls back to disk persistence outside production if not configured). The in-process job queue and file stores assume **one API instance**; do not run several behind a balancer.

### 1. Clone & Configure Backend
```bash
git clone https://github.com/Ramisali007/trade-guard-intelligence.git
cd trade-guard-intelligence/backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
```

Key environment variables in `backend/.env` (full list with comments in `.env.example`):
```ini
PORT=4000
AI_PROVIDER=openai-compatible          # or anthropic, or heuristic (fully local, no API key)
OPENAI_API_KEY=your_key
OPENAI_BASE_URL=https://api.groq.com/openai/v1
STORAGE_DRIVER=mongo                   # or memory (with disk mirror)
MONGODB_URI=mongodb://127.0.0.1:27017/docuintel
AUTH_SECRET=<openssl rand -hex 32>     # required when NODE_ENV=production
```

### Signing in
- **Demo officers** (on by default only for `NODE_ENV=development`/`test` **while `HOST` is loopback**, which is the default; anywhere else they exist only with `ENABLE_DEMO_LOGIN=true`): use the *1-Click Demo Profiles* tab, or sign in with `ramis.ali@tradeguard.ai` (Chief Compliance Officer), `sara.khan@tradeguard.ai` (TBML Risk Analyst) or `tariq.mehmood@tradeguard.ai` (Trade Auditor) and the password `TradeGuard-Demo-2026` (override with `DEMO_ACCOUNT_PASSWORD`).
- **Trade lifecycle desks** (same password, or the "Trade lifecycle desks" buttons in the sign-in dialog): customers `imports@kamrantextiles.pk` (TG-CORP-1001) and `trade@indusagro.pk` (TG-CORP-2002), RM `ayesha.siddiqui@tradeguard.ai` (assigned TG-CORP-1001 only), Trade Ops maker `bilal.ahmed@`, checker `farah.naz@`, post-trade operations `kashif.raza@`, credit `usman.ghani@`, compliance reviewer `mehreen.aslam@`, senior approver `nadia.hussain@`, LC issuer `omar.farooq@`, settlements `hina.raza@`, and two system administrators `imran.qureshi@` / `zara.malik@` (two, so dual control can be shown). All are `@tradeguard.ai` except the customers.
- **Real users**: set `AUTH_USERS` to a JSON array of `{ email, name, role, institution, passwordHash, customerRef?, assignedCustomerRefs? }`; the role must be a canonical id or exact display name, or the entry is ignored. Create each hash with `npm run hash-password -- '<password>'`. Alternatively an administrator creates *managed* accounts in `/admin`, and a second administrator approves their role. Set `ENABLE_DEMO_LOGIN=false` in production.

### 2. Start Backend Server
```bash
# Development mode (with live reload)
npm run dev

# Or build and start production server
npm run build
npm start
```
*Backend runs on `http://localhost:4000`.*

### 3. Start Frontend Dashboard
```bash
cd ../frontend

# Install dependencies
npm install

# Start Angular dev server
npm start
```
*Frontend runs on `http://localhost:4200` with `/api` proxying to `localhost:4000`.*

### 3b. Or run it all with Docker
```bash
cp backend/.env.example .env.compose   # set PUBLIC_ORIGIN, AUTH_SECRET, AUDIT_HMAC_KEY and AUTH_USERS (see the file)
docker compose --env-file .env.compose up --build
```
The compose file starts MongoDB, the API (production mode, demo login off, no memory fallback) and the web tier
(`deploy/nginx.conf`: security headers, CSP, `/api` proxy) on port 8080. Terminate TLS in front of it.

### 4. Verify TypeScript Compilation & Run Test Suites
```bash
# Backend typecheck
npm run typecheck --prefix backend

# Frontend production build
npm run build --prefix frontend

# Run all 12 automated suites (Security, Deduplication, Analytics, Integration, Fraud, Import,
# Compliance Correctness, Extraction Heuristics, Trade Lifecycle, RBAC & Portals, AI Resilience).
# Tests force the in-memory store, a temp directory and the local heuristic engine (the AI suite
# uses an in-process fake endpoint), so they never touch your MongoDB, the cloud mirror or a paid
# AI provider.
npm test --prefix backend
npm run test:lifecycle --prefix backend  # Scenarios A–F incl. amendments; field redaction; audit tampering;
                                         # concurrency; SoD, ownership, HTTP guards
npm run test:rbac --prefix backend       # Registry invariants, default-deny route coverage, every role x
                                         # endpoint over HTTP, dual-control admin, revocation, portals, scope
npm run test:ai --prefix backend         # Malformed/truncated output, 429, 500, timeout, outage, prompt injection
npm run test:hardening --prefix backend  # Regression for every defect found in the hardening audit (see docs/HARDENING_REPORT.md)
npm run test:ci --prefix frontend        # Frontend unit tests, headless Chrome

# Opt-in suites that use real infrastructure
npm run test:mongo --prefix backend      # Live MongoDB (MONGO_IT_URI, default 127.0.0.1:27017) in an isolated
                                         # tradeguard_it_<ts> database that is dropped afterwards
RUN_LIVE_AI=1 npm run test:ai-live --prefix backend  # The provider configured in .env, synthetic documents only
npm run test:extraction --prefix backend # Field extraction on real waybill / invoice / contract / GD layouts
npm run test:compliance --prefix backend # Dates, name matching, feed parsing, SCD-2 sync, pricing→TBML, auth, SSRF

# Or execute individual specialized verification suites
npm run test:fraud --prefix backend      # 18 Mandatory TBML & Fraud detection scenarios (100% pass)
npm run test:import --prefix backend     # Enterprise Import & 4-Tier Resolution Engine (28/28 assertions)
npm run test:security --prefix backend   # Security Defenses (SSRF, Path Traversal, Auth Guards)
npm run test:integration --prefix backend # End-to-end integration workflows
```
Both backend and frontend compile with **0 errors**. CI (`.github/workflows/ci.yml`) runs the backend typecheck, lint, all suites, the build and a high-severity dependency audit, the same persistence code against a real MongoDB, and the frontend unit tests and production build. Run `npm run lint`, `npm test` (backend) and `npm run test:ci` (frontend) before every merge.

### 5. Walk through the lifecycle
1. Sign in as the **customer** desk → *New import request* → fill the form → *Save draft*.
2. On the case, *Documents* → attach the supplier's proforma invoice → wait for analysis → check *Findings* → *Submit for review*.
3. Sign in as each desk (RM, Trade Ops, risk analyst for Compliance, Credit) → *Reviews & approval* → tick the checklist, give a rationale, *Approve* (or *Return to customer* with a question).
4. Trade Ops maker → *Send for authorisation*; senior approver → *Authorise issuance*; LC issuer → *LC & post-trade* → *Record sandbox issuance* (FI number `AD-IMP-000001-DDMMYYYY`, expiry = LC expiry).
5. Trade Ops → *Record a presentation* (invoice, B/L, packing list) → *Examine*; customer waives any discrepancy; checker decides; settlement officer records settlement; checker closes. The auditor desk sees the hash-chained *Audit trail*.

---

## 🛡️ Bank-Grade Security & Hardening Architecture

TradeGuard Intelligence implements enterprise defense-in-depth principles:
1. **Server-Side Sign-In**: `POST /api/auth/login` verifies the password (scrypt, constant-time compare, same cost for unknown emails) and is rate-limited to 10 attempts/minute. The role belongs to the account; clients cannot choose it.
2. **Signed Identity Only**: HMAC-SHA256 tokens with mandatory expiry. Identity and role are read only from the token; `X-User-*` headers are ignored. Override records and sync runs name the signed-in officer, not a value from the request body.
3. **Live Authorisation**: every request re-reads the account; a disabled account, revoked sessions or a changed role invalidate outstanding tokens at once. Permissions come from one registry (default deny); an unknown role has none.
4. **No Anonymous Fallback**: every protected route requires a token or the integration API key, in every environment. Production refuses to start without `AUTH_SECRET`; demo accounts are off in production unless `ENABLE_DEMO_LOGIN=true`.
5. **SSRF Guard on Resolved Addresses**: the URL importer validates the IP the socket actually connects to (private, loopback, link-local, CGNAT, IPv4-mapped IPv6), refuses redirects and caps responses at 5 MB.
6. **Boundary Defense & Input Validation**:
   - Multi-document comparison requests are capped between 2 and 10 documents to protect CPU and memory.
   - Compliance overrides, chat turns (user/assistant only, size-capped) and sign-in payloads are parsed through Zod schemas.
   - SSRF and Path Traversal guards neutralize CWE-22 and CWE-918 threats.
7. **AI Output Is Never Trusted for Screening**: when the model's parties, countries or ports differ from the document text, the text values are screened too and the worse result kept; a "decision" in model output is ignored.
8. **Standardized Error Envelopes**: Leaks zero internal traces or provider details, routing through a secure `{ error: { code, message, requestId, retryable } }` envelope.
9. **Secrets Are Validated, Not Trusted**: a signing key under 32 characters, an API key under 24, or any value that still looks like the example file is ignored, and production refuses to start on it. The API listens on loopback unless told otherwise, and demo accounts need loopback or an explicit opt-in.
10. **Sign-In Hardening**: scrypt at the OWASP cost (2^17) on the thread pool with the cost stored in each hash (older hashes still verify); a per-account lockout (5 failures, doubling lock) alongside the per-address limit; `POST /api/auth/logout` revokes the token everywhere; the browser signs out after 15 minutes idle and never sends the token to any origin but the API.
11. **Four-Eyes On Reference Data**: sanctions entries, country risk, price corridors, banks and the rest are *submitted*, and applied only when a different officer holding `masterdata.approve` accepts them. The submitter and approver both come from their tokens and are written to the audit log; a hand-entered watchlist entry is versioned (SCD Type-2) and entries of a regulator's feed cannot be hand-edited.
12. **Overrides Are Constrained**: an action can only produce the decisions that fit it; a decision moves one step at a time; a block that rests on a sanctions prohibition cannot be lowered by an override; lowering any block is for the Chief Compliance Officer with a 30-character reason.
13. **Keyed Audit Chains**: set `AUDIT_HMAC_KEY` (held outside the database) and every new audit entry is an HMAC, so rewriting history consistently needs the key. Chains written before the key existed still verify.
14. **Hostile Files**: a DOCX is judged from its central directory before anything unpacks it (entry count, expansion ratio, total size), PDFs have a page limit, and every read has a wall-clock ceiling.
15. **Nothing Is Presented As Cleared Without A Screening Result**: reports and screens state what the screening found (match, possible match, incomplete, no match) with the lists and counts; a party whose name could not be compared is reported as unscreened and forces review.

---

## 📚 Architectural Specifications & Documentation Index

For in-depth engineering documentation, refer to the specialized technical guides:

- 🏛️ **[ARCHITECTURE.md](ARCHITECTURE.md)**: System topology, request lifecycles, and component interfaces.
- 🗄️ **[DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)**: Comprehensive schema dictionary for all 8 compliance collections.
- 🔄 **[DATA_SYNC.md](DATA_SYNC.md)**: 4-stage synchronization pipeline, checksum algorithm, and anomaly defense.
- 🔌 **[OFFLINE_MODE.md](OFFLINE_MODE.md)**: Dual-tier persistence fallback, network simulation, and disaster recovery.
- 📜 **[AUDIT_AND_PROVENANCE.md](AUDIT_AND_PROVENANCE.md)**: Bitemporal point-in-time mechanics and cryptographic evidence packages.
- 🛠️ **[OPERATIONS.md](OPERATIONS.md)**: Production runbooks, health monitoring, and disaster recovery procedures.
- 📑 **[DEDUPLICATION.md](DEDUPLICATION.md)**: SHA-256 content hashing and deduplication mechanics.
- 🛡️ **[docs/HARDENING_REPORT.md](docs/HARDENING_REPORT.md)**: every defect found in the hardening audit, its fix, and the test that proves it.
- 🔐 **[SECURITY.md](SECURITY.md)**: reporting, what is defended, and what is *not* (read before a production decision).

---

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.
