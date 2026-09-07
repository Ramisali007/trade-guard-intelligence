# TradeGuard Intelligence — AI Trade Finance Compliance & Bitemporal Sanctions Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
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
5. [Bitemporal Sanctions & Point-in-Time Evaluation (SCD Type-2)](#-bitemporal-sanctions--point-in-time-evaluation-scd-type-2)
6. [Operational Control Dashboard (`/sources`)](#-operational-control-dashboard-sources)
7. [System Topology & Clean Directory Structure](#-system-topology--clean-directory-structure)
8. [Comprehensive REST API Reference](#-comprehensive-rest-api-reference)
9. [Quick Start & Developer Setup](#-quick-start--developer-setup)
10. [Architectural Specifications & Documentation Index](#-architectural-specifications--documentation-index)

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

TradeGuard completely eliminates these failures through a **database-first, bitemporal, and 100% offline-capable** architecture.

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
1. **Zero Outbound HTTP Calls During Document Processing**:
   All entity screening, vessel tracking, foreign exchange conversions, and commodity price valuations query the local canonical database (`ComplianceStore`). Analysis takes milliseconds rather than seconds.
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
  Stage 3: Anomaly Defense Guard ────────► >80% Record Drop? ──► Reject & Alert (Shield DB)
                     │
                     ▼ (Sanity Passed)
  Stage 4: SCD Type-2 Publication ───────► Retire Old (`effectiveTo = now`) & Publish New Version
```

### 9 Tracked Regulatory Feeds:
| Source ID | Regulatory Feed Name | Frequency | Change Detection |
| :--- | :--- | :---: | :---: |
| `OFAC_SDN` | US Treasury OFAC Specially Designated Nationals List | Hourly | SHA-256 Checksum |
| `UN_CONSOLIDATED` | United Nations Security Council Consolidated Sanctions | Hourly | SHA-256 Checksum |
| `EU_FSF` | European Union Financial Sanctions Database (EEAS) | Daily | SHA-256 Checksum |
| `UK_OFSI` | UK HM Treasury Office of Financial Sanctions Implementation | Daily | SHA-256 Checksum |
| `SBP_TFS` | State Bank of Pakistan Targeted Financial Sanctions | Daily | SHA-256 Checksum |
| `UN_COMTRADE_PRICING`| UN Comtrade International Trade Valuation Corridors | Weekly | SHA-256 Checksum |
| `UN_LOCODE_PORTS` | UNECE UN/LOCODE Global Shipping Ports & Terminals | Monthly | SHA-256 Checksum |
| `OPEN_MMSI_VESSELS` | Global Maritime Fleet Registry & AIS Telemetry | Weekly | SHA-256 Checksum |
| `ECB_FX_RATES` | European Central Bank & SBP Weighted Foreign Exchange | Hourly | SHA-256 Checksum |

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
├── DATA_SYNC.md                    # 9-Source sync engine & anomaly guard specifications
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
│   │   ├── ai/                     # AI classification & heuristic trade extractors
│   │   ├── compliance/             # 9 Compliance engines & local data stores
│   │   │   ├── behavioral/         # Customer 360 & entity resolution
│   │   │   ├── db/                 # ComplianceStore (MongoDB + local disk mirror)
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
│   ├── storage/                    # Persistent disk storage (compliance mirror, uploads)
│   ├── eng.traineddata             # Tesseract OCR language pack for image extraction
│   ├── package.json                # Production scripts (dev, build, start, typecheck)
│   ├── tsconfig.json               # Scoped strictly to src/**/*.ts
│   └── tsconfig.build.json         # Production compiler configuration
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

### Regulatory Sources & Sync Engine
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/documents/compliance/sources` | List all 9 regulatory feeds and health metrics |
| `POST` | `/api/documents/compliance/sources/:id/sync` | Trigger manual synchronization for a specific feed |
| `POST` | `/api/documents/compliance/sources/sync-all` | Trigger synchronization across all 9 feeds |
| `GET` | `/api/documents/compliance/health` | Get overall compliance store status & storage driver |
| `GET` | `/api/documents/compliance/retrospective-alerts` | List post-transaction sanctions exposure alerts |

---

## 🚀 Quick Start & Developer Setup

### Prerequisites:
- **Node.js**: `v20.19.0` or higher
- **npm**: `v10+`
- **MongoDB** (optional): Local or Atlas connection (falls back to disk persistence if not configured)

### 1. Clone & Configure Backend
```bash
git clone https://github.com/Ramisali007/trade-guard-intelligence.git
cd trade-guard-intelligence/backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
```

Key environment variables in `backend/.env`:
```ini
PORT=4000
AI_PROVIDER=openai-compatible
AI_MODEL=gemini-flash-lite-latest
AI_API_KEY=your_gemini_or_openai_api_key
MONGODB_URI=mongodb+srv://... (optional, memory-disk fallback active)
MONGODB_DB=docuintel
SYNC_ENABLED=true
SYNC_CRON_INTERVAL=0 * * * *
```

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

### 4. Verify TypeScript Compilation
```bash
# Backend typecheck
npm run typecheck --prefix backend

# Frontend typecheck
npx tsc -p tsconfig.app.json --prefix frontend
```
Both compile with **0 errors**.

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

---

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.
