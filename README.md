# TradeGuard Intelligence — AI Trade Finance Compliance & Bitemporal Sanctions Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Angular](https://img.shields.io/badge/Angular-20-dd0031.svg)](https://angular.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.22-lightgrey.svg)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Agent Context & Technical Briefing**: This README serves as the definitive system specification, architectural blueprint, and engineering reference for **TradeGuard Intelligence** (formerly DocuIntel AI). Any AI agent working on this codebase should use this document to understand the system domains, bitemporal data principles, compliance algorithms, API contracts, and directory structure.

---

## 📌 Table of Contents
1. [Executive Summary & Core Mission](#-executive-summary--core-mission)
2. [The Core Problem: Bitemporal Sanctions & Trade Compliance](#-the-core-problem-bitemporal-sanctions--trade-compliance)
3. [Key Capabilities & Subsystems](#-key-capabilities--subsystems)
4. [Explainable 9-Factor Compliance Risk Engine](#-explainable-9-factor-compliance-risk-engine)
5. [System Architecture & Tech Stack](#-system-architecture--tech-stack)
6. [Complete Repository Anatomy](#-complete-repository-anatomy)
7. [Frontend Workbenches & Pages](#-frontend-workbenches--pages)
8. [Comprehensive REST API Reference](#-comprehensive-rest-api-reference)
9. [Pre-Built Sample Test Documents](#-pre-built-sample-test-documents)
10. [Quick Start & Developer Guide](#-quick-start--developer-guide)
11. [Engineering Rules & Guiding Principles for AI Agents](#-engineering-rules--guiding-principles-for-ai-agents)

---

## 🌟 Executive Summary & Core Mission

**TradeGuard Intelligence** is an enterprise-grade AI-powered **Trade Finance Document Intelligence, Bitemporal Sanctions Screening & Regulatory Compliance Platform**.

Designed for commercial banks, Authorized Dealers (ADs), trade finance desks, issuing/advising institutions, and compliance audit teams, TradeGuard automates the examination of complex trade presentations under **UCP 600, ISBP 745, FATF TBML standards, OFAC/UN/EU/UK regulations**, and the **State Bank of Pakistan (SBP) Foreign Exchange Manual**.

### Target Documents Screened:
- **Commercial Invoices & Proforma Invoices**
- **Letters of Credit (LCs - Documentary Credits)**
- **Bills of Lading (B/L) & Sea/Air Waybills**
- **Packing Lists & Weight Certificates**
- **Certificates of Origin & Inspection Certificates**
- **End-User Certificates (EUC) & Purchase Orders**

---

## ⏳ The Core Problem: Bitemporal Sanctions & Trade Compliance

In international trade finance compliance, querying today's live sanctions list is a major regulatory failure:

> *"A transaction was executed on June 1, 2024 when Counterparty X was clean. In February 2025, Counterparty X was designated by OFAC. In 2026, an auditor demands: 'Prove this transaction was compliant on the date of settlement.'"*

If a system simply re-queries today's watchlist, the party will show as **SANCTIONED**, yielding a false retroactive violation. Conversely, if a system only stores `"clean"` in a mutable database, it cannot prove to an auditor *which official list version was consulted* or *whether the record was altered*.

### The TradeGuard Bitemporal Solution:
1. **Valid Time**: The exact date an entity was listed or delisted by official authorities (OFAC, UN, EU, UK).
2. **System Time**: The immutable timestamp when TradeGuard ingested and checksummed the authoritative feed.
3. **Point-in-Time Evaluation**: When evaluating a document from `2024-06-01`, TradeGuard reconstructs the regulatory universe as it existed on that date:
   - **Listed before transaction date** $\implies$ Critical direct hit (`BLOCK_ESCALATE`).
   - **Listed after transaction date** $\implies$ Flagged as `ADDED_AFTER_TRANSACTION` for retrospective forward-settlement monitoring, but **never produces an illegal retroactive block**.
4. **Tamper-Evident SHA-256 Hash Chaining**: Every screening event records input document hashes, snapshot version IDs, rule IDs, and a running hash-chain (`prev_event_hash` $\to$ `event_hash`), making retroactive tampering mathematically impossible.

---

## 🛡️ Key Capabilities & Subsystems

### 1. Multi-Jurisdiction Sanctions Screening
Screens sellers, buyers, consignees, issuing/advising banks, vessels (name + IMO), ports, and shipping agents against:
- **US OFAC**: Specially Designated Nationals (SDN), Sectoral Sanctions (SSI), Consolidated Non-SDN.
- **United Nations**: UNSC Consolidated Sanctions List.
- **European Union**: EU Consolidated Financial Sanctions Database (EEAS/FSF).
- **United Kingdom**: UK OFSI Consolidated List / HM Treasury.

### 2. Beneficial Ownership & OFAC 50% Rule Graph (`ownership-graph.service.ts`)
Traverses corporate hierarchy trees. If blocked persons hold $\ge 50\%$ aggregate direct or indirect equity in an entity, that entity is blocked by operation of law even if not named on an SDN list.

### 3. State Bank of Pakistan (SBP) Framework (`sbp-regulatory.service.ts`)
Tailored for Pakistani commercial banking compliance:
- Enforces **FE Manual Chapter 13 (Imports) & Chapter 12 (Exports)** rules.
- Validates **Targeted Financial Sanctions (TFS)** directives issued under AMLA / UNSC Acts.
- Flags Authorized Dealer (AD) documentary requirements and mandatory Form 'E' / Electronic Import Form (EIF) criteria.

### 4. Dual-Use & Multilateral Export Controls (`export-control.service.ts`)
Analyzes commodity descriptions, technical parameters, and HS Codes against dual-use regimes (Wassenaar, BIS Commerce Control List):
- **ECCN Classifications**: Detects categories such as **6A005** (lasers/optics), **3A001/4A003** (advanced semiconductors/microprocessors), **9A012** (UAVs/drones), **5A002** (cryptography/HSMs), **1C350/2B350** (chemical precursors/reactors), and **7A003** (inertial navigation gyroscopes).

### 5. Goods Scope & Customer Business Profile (`goods-scope.service.ts`)
Compares billed commodities against the customer's declared line of business and PO scope. Immediately flags `OUT_OF_SCOPE_GOODS` (e.g., a garment exporter billing industrial laser machinery or advanced electronics).

### 6. TBML & Pricing Anomaly Detection (`tbml.service.ts`)
Implements Financial Action Task Force (FATF) Trade-Based Money Laundering indicators:
- **Unit Price Anomalies**: Detects over-invoicing and under-invoicing against benchmark ranges.
- **Consignee Disconnects**: Flags consignees located in third-party jurisdictions without commercial justification.
- **Routing & Free-Trade Zone Anomalies**: Detects circular logistics and unnecessary transshipment hubs.

### 7. Mathematical & Calculation Integrity (`math-integrity.service.ts`)
Deterministic calculation verification:
$$\text{Line Total} = \text{Quantity} \times \text{Unit Price}$$
$$\text{Calculated Subtotal} = \sum \text{Line Totals}$$
$$\text{Declared Grand Total} = \text{Subtotal} + \text{Freight} + \text{Insurance} + \text{Taxes}$$
Flags rounding discrepancies, calculation errors, and arithmetic mismatches.

### 8. Cross-Document Reconciliation Studio (`comparison.service.ts`)
Pairwise reconciliation across presentation sets (Invoice vs. Letter of Credit vs. Bill of Lading vs. Packing List) under UCP 600 rules:
- Checks consistency of party names, shipment deadlines, ports of loading/discharge, currencies, amounts, and Incoterms.

### 9. Publication-Grade PDF Compliance Dossier Export (`pdf-report.service.ts`)
A dedicated 1,040-line `pdfkit` engine that renders multi-page, publication-quality audit reports with:
- Running headers and buffered audit footers.
- Color-coded decision status and 10D risk meter bars.
- 4-column counterparty profiles, Incoterms, and payment terms.
- Line-item commodity schedule with HS Codes, ECCNs, and scope flags.
- Red-flag alert callouts with legal basis and FATF references.
- Cryptographic SHA-256 evidence package and examiner sign-off seal boxes.

### 10. Interactive RAG Compliance Copilot (`rag.service.ts` & `chatbot.ts`)
Context-aware chatbot grounded directly in document passages:
- Cites exact page numbers, paragraph IDs, and confidence scores.
- Operates via cloud LLM (Groq / OpenAI / Anthropic) with graceful fallback to an offline heuristic compliance engine.

---

## 📊 Explainable 9-Factor Compliance Risk Engine

The composite risk score ($0–100$) is computed via a transparent, weighted regulatory formula:

$$\text{Overall Risk} = \text{round}\left(\begin{array}{l}
S_{\text{sanctions}} \times 0.30 + S_{\text{exportControl}} \times 0.15 + S_{\text{goodsScope}} \times 0.15 + \\
S_{\text{tbml}} \times 0.15 + S_{\text{endUse}} \times 0.08 + S_{\text{endUser}} \times 0.07 + \\
S_{\text{docIntegrity}} \times 0.04 + S_{\text{anomaly}} \times 0.04 + S_{\text{geographic}} \times 0.02
\end{array}\right)$$

### Factor Breakdown:
| Factor | Weight | Evaluation Focus |
| :--- | :---: | :--- |
| **Sanctions Risk** | **30%** | Point-in-time matching against OFAC, UN, EU, UK, and restricted country embargoes. |
| **Export Control & Dual-Use** | **15%** | ECCN categorization, military utility, CBRN / laser / UAV / crypto indicators. |
| **Goods Scope & Authorization** | **15%** | Commodity alignment with customer profile, PO, and declared business scope. |
| **TBML & Fraud Risk** | **15%** | FATF indicators, over/under-invoicing, volume anomalies, payment route red flags. |
| **End-Use Consistency** | **8%** | Plausibility of declared commercial use vs. commodity capabilities. |
| **End-User Identification** | **7%** | Verification of ultimate consignee, facility physical address, and EUC. |
| **Document & Math Integrity** | **4%** | Arithmetic validation of unit prices, line totals, subtotals, and grand totals. |
| **Transaction & Doc Anomalies** | **4%** | Cross-document discrepancies between LC, Invoice, and Bill of Lading. |
| **Geographic & Routing Risk** | **2%** | High-risk transshipment ports, circular voyages, and OFAC 50% maritime concerns. |

### Mandatory Regulatory Hard Floors:
- **Active Sanctions Match at Transaction Date**: Forces Risk $\ge 95$ $\implies$ **`BLOCK_ESCALATE`** (strict liability).
- **Out-of-Scope Goods + Document Discrepancy**: Forces Risk $\ge 68$ $\implies$ **`REVIEW`**.
- **Critical TBML Indicator ($S_{\text{tbml}} \ge 70$)**: Forces Risk $\ge 72$ $\implies$ **`REVIEW`**.

### Verdict Thresholds:
- 🟢 **`ALLOW`** (Risk: 0–34) — Compliant presentation; proceed with standard trade finance operations.
- 🟡 **`REVIEW`** (Risk: 35–79) — Enhanced Due Diligence (EDD) required; customer explanation or license needed.
- 🔴 **`BLOCK_ESCALATE`** (Risk: 80–100) — Direct sanctions hit, embargoed port, or critical violation; halt immediately.

---

## 🏗️ System Architecture & Tech Stack

```
trade-guard-intelligence/
├── backend/                  # Node.js 20+ / Express 4.22 / TypeScript 5.9
│   ├── Storage Drivers       # In-memory repository with file persistence (or MongoDB)
│   ├── Parsers               # pdfjs-dist (PDF), mammoth (DOCX), word-extractor (DOC)
│   ├── AI Integration        # OpenAI-compatible (Groq / OpenAI), Anthropic SDK, Heuristic offline engine
│   └── Reporting             # PDFKit with custom font metrics and dynamic page flow
│
└── frontend/                 # Angular 20 (Standalone Components + Signals)
    ├── Framework             # Angular 20, RxJS 7.8, jsPDF 4.2
    ├── Styling               # Custom SCSS Token Design System (Light/Dark mode, zero Tailwind)
    └── UI Components         # Custom canvas/SVG charts (Donut, Bar, Timeline), Chatbot, Dossier Modal
```

---

## 📂 Complete Repository Anatomy

```
pdf analyzer/
├── README.md                                             # Master documentation and agent briefing
├── TradeGuard_PointInTime_Sanctions_Compliance_Spec.md   # Bitemporal sanctions engineering specification
├── Sample_1_Very_Safe_Document.pdf                      # Baseline safe test document (Score ~5, ALLOW)
├── Sample_2_Moderate_Risk_Document.pdf                   # Dual-use & scope mismatch test doc (Score ~50, REVIEW)
├── Sample_3_High_Risk_Sanctioned_Document.pdf            # Sanctioned entities & vessel test doc (Score ~98, BLOCK)
├── AI_Document_Intelligence_Test_Sample.docx             # Commercial test sample in Word (.docx)
├── Import LC.docx                                        # Documentary credit sample in Word (.docx)
│
├── backend/
│   ├── package.json                                      # Node dependencies & npm scripts
│   ├── tsconfig.json                                     # TypeScript configuration
│   ├── src/
│   │   ├── server.ts                                     # Server bootstrap, port-retry & graceful shutdown
│   │   ├── app.ts                                        # Express configuration, CORS, Helmet, rate-limiters
│   │   ├── config/
│   │   │   ├── index.ts                                  # Environment variable loader & defaults
│   │   │   ├── taxonomy.ts                               # Trade classification types & sentiment taxonomy
│   │   │   └── trade-taxonomy.ts                         # Incoterms, document types & party role definitions
│   │   ├── controllers/
│   │   │   ├── document.controller.ts                    # REST handlers for upload, results, reports, overrides
│   │   │   ├── chat.controller.ts                        # RAG chat controller
│   │   │   ├── sanctions.controller.ts                   # Sanctions & historical query endpoints
│   │   │   ├── health.controller.ts                      # System & AI engine health handler
│   │   │   └── taxonomy.controller.ts                    # Taxonomy lookup handlers
│   │   ├── document-processing/
│   │   │   ├── text-normalizer.ts                        # Text cleanup & word counter
│   │   │   ├── segmenter.ts                              # Paragraph segmentation & heading detector
│   │   │   ├── chunker.ts                                # Model batch planner with local heuristic division
│   │   │   └── extractors/
│   │   │       ├── index.ts                              # Filetype sniffer & extractor router
│   │   │       ├── pdf.extractor.ts                      # High-fidelity pdfjs-dist text extractor
│   │   │       ├── docx.extractor.ts                     # Mammoth DOCX parser
│   │   │       └── doc.extractor.ts                      # Binary Word .doc extractor
│   │   ├── ai/
│   │   │   ├── trade-extractor.ts                        # Master trade compliance extraction coordinator
│   │   │   ├── trade-prompt.ts                           # Few-shot trade prompt engineering
│   │   │   ├── response-schema.ts                        # Zod JSON schemas for LLM outputs
│   │   │   ├── rate-limiter.ts                           # Token & request concurrency limiter
│   │   │   └── providers/
│   │   │       ├── openai.provider.ts                    # OpenAI & Groq client adapter
│   │   │       ├── anthropic.provider.ts                 # Claude Anthropic client adapter
│   │   │       └── heuristic.provider.ts                 # Resilient offline rule-based fallback provider
│   │   ├── compliance/
│   │   │   ├── types.ts                                  # Comprehensive trade compliance TypeScript interfaces
│   │   │   ├── risk-scoring.service.ts                   # 9-Factor weighted scoring & decision engine
│   │   │   ├── export-control.service.ts                 # Dual-use & ECCN classification engine
│   │   │   ├── goods-scope.service.ts                    # Commodity scope-of-trade authorization validator
│   │   │   ├── tbml.service.ts                           # FATF & SBP Trade-Based Money Laundering detector
│   │   │   ├── math-integrity.service.ts                 # Invoice math, unit prices & subtotal checker
│   │   │   ├── reconciliation.service.ts                 # In-document and cross-document conflict detector
│   │   │   ├── audit.service.ts                          # Tamper-evident SHA-256 audit record builder
│   │   │   ├── sanctions/
│   │   │   │   ├── index.ts                              # Sanctions engine & provider aggregator
│   │   │   │   ├── sanctions.provider.ts                 # Sanctions provider interface
│   │   │   │   ├── ofac.provider.ts                      # US Treasury OFAC SDN & Consolidated provider
│   │   │   │   ├── un.provider.ts                        # United Nations Consolidated List provider
│   │   │   │   ├── eu-uk.provider.ts                     # EU FSF & UK OFSI Consolidated provider
│   │   │   │   ├── jurisdictions.data.ts                 # Sanctioned/embargoed countries dataset
│   │   │   │   ├── temporal-sanctions.service.ts         # Point-in-Time historical vs current comparator
│   │   │   │   └── point-in-time/
│   │   │   │       ├── bitemporal-store.service.ts       # Bitemporal storage service
│   │   │   │       └── schema.sql                        # Production SQL schema for bitemporal tables
│   │   │   ├── temporal/
│   │   │   │   ├── snapshot-registry.ts                  # Registered authoritative regulatory feed registry
│   │   │   │   └── temporal.types.ts                     # Snapshot & bitemporal TypeScript definitions
│   │   │   ├── ownership/
│   │   │   │   └── ownership-graph.service.ts            # Beneficial ownership & OFAC 50% Rule engine
│   │   │   ├── sbp/
│   │   │   │   └── sbp-regulatory.service.ts             # State Bank of Pakistan TFS & FE Manual compliance
│   │   │   ├── nexus/
│   │   │   │   └── jurisdictional-nexus.service.ts       # US, UN, EU, UK, PK nexus applicability engine
│   │   │   └── retro/
│   │   │       └── retrospective-screening.service.ts    # Post-transaction exposure alert service
│   │   ├── services/
│   │   │   ├── analysis.service.ts                       # 7-Stage pipeline orchestrator
│   │   │   ├── document.service.ts                       # Document CRUD & query service
│   │   │   ├── document.repository.ts                    # Storage repository (Memory / Disk / MongoDB)
│   │   │   ├── pdf-report.service.ts                     # Multi-page PDF compliance dossier generator
│   │   │   ├── report.service.ts                         # Plain-text audit report generator
│   │   │   ├── comparison.service.ts                     # Multi-document presentation reconciliation
│   │   │   ├── rag.service.ts                            # Document-grounded RAG copilot service
│   │   │   ├── queue.service.ts                          # In-memory document processing queue
│   │   │   ├── aggregation.service.ts                    # Statistical aggregations
│   │   │   └── cleanup.service.ts                        # Periodic stale document cleanup worker
│   │   ├── middleware/
│   │   │   ├── upload.middleware.ts                      # Multer configuration & magic-byte validator
│   │   │   ├── rate-limit.middleware.ts                  # IP and endpoint rate limiters
│   │   │   ├── error-handler.middleware.ts               # Global AppError handler
│   │   │   └── request-logger.middleware.ts              # Structured HTTP request logger
│   │   ├── models/
│   │   │   └── document.model.ts                         # Document schema & status definitions
│   │   └── utils/
│   │       ├── logger.ts                                 # Leveled stdout logger
│   │       ├── errors.ts                                 # Typed AppError catalogue
│   │       ├── http.ts                                   # Async router wrapper & response formatters
│   │       └── async.ts                                  # Concurrency map & retry utilities
│   └── scripts/
│       ├── smoke-test.ts                                 # Headless end-to-end smoke test
│       └── build-sample-pdf.ts                           # In-memory PDF generator for testing
│
└── frontend/
    ├── package.json                                      # Angular 20 dependencies
    ├── angular.json                                      # Angular workspace & build configuration
    ├── proxy.conf.json                                   # Dev proxy (routes `/api` to `localhost:4000`)
    └── src/
        ├── styles.scss                                   # 23KB Global design system tokens (Dark/Light)
        └── app/
            ├── app.config.ts                             # Angular application config & HTTP providers
            ├── app.routes.ts                             # Routing definitions
            ├── app.ts / app.html / app.scss              # Shell navigation header & theme toggle
            ├── models/api.models.ts                      # Frontend TypeScript mirrors of all API models
            ├── services/
            │   ├── api.service.ts                        # Base HTTP client with typed error handling
            │   ├── documents.service.ts                  # Document state management, uploads, and queries
            │   ├── chat.service.ts                       # RAG chat service
            │   ├── theme.service.ts                      # Dark / Light / System theme engine
            │   ├── toast.service.ts                      # User notification service
            │   └── taxonomy.service.ts                   # Taxonomy lookup service
            ├── pages/
            │   ├── dashboard/dashboard.component.ts      # Main upload zone, file table & health banner
            │   ├── processing/processing.component.ts    # 7-Stage live progress bar & ETA ticker
            │   ├── analysis/analysis.component.ts        # Flagship 80KB compliance & risk workbench
            │   ├── auditor/auditor.component.ts          # Historical point-in-time audit time-machine
            │   ├── sources/sources-health.component.ts   # Live regulatory feeds & XML schema inspector
            │   └── comparison/comparison.component.ts    # Multi-document reconciliation studio
            └── shared/
                ├── format.ts                             # Currency, date, byte, and duration formatters
                ├── palette.ts                            # Dynamic chart color utilities
                └── components/
                    ├── icon.ts                           # Zero-dependency SVG icon system
                    ├── chatbot.ts                        # Floating RAG compliance assistant modal
                    ├── report-modal.ts                   # Audit dossier preview & printer modal
                    ├── kpi-card.ts                       # Analytics metric cards
                    ├── donut-chart.ts                    # SVG Donut chart component
                    ├── bar-chart.ts                      # SVG Bar chart component
                    ├── timeline-chart.ts                 # SVG Page sentiment timeline component
                    └── toast-container.ts                # Toast notifications container
```

---

## 🖥️ Frontend Workbenches & Pages

The frontend is an **Angular 20 Single Page Application** featuring dark and light mode, accessible design tokens, and six specialized workspaces:

### 1. 📊 Dashboard (`/`)
- **Drag-and-Drop Dropzone**: Handles single or multi-file uploads (PDF, DOC, DOCX up to 50MB).
- **Engine Status Badge**: Real-time indicator showing active AI provider, model, and storage driver.
- **Documents Table**: Filterable document list with risk badges, decision chips, passage counts, and quick actions (Inspect, Compare, Download PDF Report, Delete).

### 2. ⚡ Processing Tracker (`/documents/:id/processing`)
- **Honest 7-Stage Tracker**: Real-time progress monitoring through `upload`, `extract`, `structure`, `chunk`, `analyze`, `aggregate`, and `report`.
- **Passage-by-Passage Progress**: Reflects actual model throughput with calculated ETA ticker.

### 3. 🔬 Compliance Analysis Workbench (`/documents/:id`)
The flagship 80KB analytical workspace:
- **Executive Decision Banner**: Visual `ALLOW`, `REVIEW`, or `BLOCK_ESCALATE` badge with model confidence and primary compliance findings.
- **Point-in-Time Temporal Banner**: Evaluation date comparison showing *historical position at transaction date* versus *current watchlist position*.
- **Trade Transaction & Counterparty Profile**: 4-card grid detailing Seller, Buyer, Consignee/End-User, and Issuing/Advising Banks.
- **Shipment Route Strip**: Graphical visualization of Origin $\to$ Port of Loading $\to$ Transit Hubs $\to$ Port of Discharge $\to$ Destination.
- **Goods & Scope Intelligence Matrix**: Table displaying every line item with description, HS Code, ECCN, quantities, unit prices, line totals, and scope authorization tags.
- **Tabbed Compliance Intelligence**:
  - `Sanctions & Watchlists`: Match confidence, listed aliases, legal grounds, and restricted jurisdictions.
  - `Export Controls & Dual-Use`: ECCN justifications, licensing requirements, and CBRN/laser/UAV flags.
  - `TBML & Route Risk`: FATF red flags, pricing variance indicators, and transit anomalies.
  - `Math & Integrity`: Arithmetic verification of quantities $\times$ unit prices and grand totals.
  - `Cross-Doc Reconciliation`: Conflicting field values between Invoice, Packing List, and BL.
  - `10D Risk Breakdown`: Visual radar/meter bars across all 9 compliance risk vectors.

### 4. 🕰️ Auditor Workbench (`/auditor`)
- **Point-in-Time Reconstruction**: Historical time-machine enabling compliance officers to test any counterparty, vessel, or bank as of any past calendar date.
- **Retrospective Diff**: Identifies parties that were legal at the time of trade execution but subsequently designated, ensuring compliant defense during regulatory audits.

### 5. 📡 Regulatory Sources Health (`/sources`)
- **Live Watchlist Feeds**: Real-time monitoring of OFAC SLS, UN Consolidated, EU FSF, UK OFSI, SBP TFS, and Dual-Use lists.
- **Integrity Tracking**: Displays dataset version tags, last synchronization timestamp, sync SLAs, active record counts, and immutable SHA-256 provenance checksums.
- **Feed Inspector Modal**: Explores raw parsed XML/JSON structures directly in the browser.

### 6. ⚖️ Comparison Studio (`/comparison`)
- **Multi-Document Presentation Audit**: Selects 2 or more related documents (e.g. Commercial Invoice + Letter of Credit + Bill of Lading) to compute an **Overall Consistency Score (0–100%)**.
- **Discrepancy Matrix**: Categorizes discrepancies by `PARTIES`, `FINANCIALS`, `GOODS`, `QUANTITIES`, `DATES`, `PORTS`, and `INCOTERMS` with UCP 600 citations.
- **Dedicated Comparison PDF**: Generates comparison PDF dossiers for bank presentation discrepancy notices.

---

## 📡 Comprehensive REST API Reference

All backend routes are prefixed with `/api`.

### Document Ingestion & Screening
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/documents/upload` | Upload a single PDF/DOCX file and queue ingestion |
| `POST` | `/api/documents/upload-batch` | Upload multiple documents simultaneously |
| `GET` | `/api/documents` | List all documents with summary risk scores and verdicts |
| `GET` | `/api/documents/:id` | Retrieve full document details, metadata, and extraction |
| `DELETE`| `/api/documents/:id` | Permanently delete a document and purge all associated units |
| `POST` | `/api/documents/:id/analyze` | Re-run or trigger analysis on an uploaded document |
| `GET` | `/api/documents/:id/status` | Polling endpoint for real-time 7-stage processing progress and ETA |
| `GET` | `/api/documents/:id/results` | Complete compliance analysis, risk scores, decisions, and evidence |
| `GET` | `/api/documents/:id/units` | Paginated paragraph units with classifications and bounding metadata |

### Audit Reports & Evidence
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/documents/:id/report/pdf` | **Download publication-quality multi-page PDF compliance dossier** |
| `GET` | `/api/documents/:id/report` | Download structured plain-text audit report |
| `GET` | `/api/documents/:id/audit-certificate`| Retrieve cryptographic SHA-256 audit certificate & evidence package |
| `GET` | `/api/documents/:id/timeline` | Page-by-page sentiment, topic, and risk timeline |
| `GET` | `/api/documents/:id/evidence` | Raw structured evidence findings (`EV-SANC`, `EV-MATH`, etc.) |
| `POST` | `/api/documents/:id/override` | Record compliance officer manual override with mandatory audit reason |

### Cross-Document Reconciliation
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/documents/compare` | Run pairwise cross-document reconciliation for $\ge 2$ document IDs |
| `POST` | `/api/documents/compare/pdf` | Generate and download a presentation comparison PDF report |

### Regulatory Sources & Point-in-Time Screening
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/documents/compliance/sources` | List all authoritative regulatory feeds, versions, and checksums |
| `POST` | `/api/documents/compliance/screen/historical` | Query sanctions status for an entity as of a specific historical date |
| `GET` | `/api/documents/compliance/retrospective-alerts` | List all transactions with post-transaction sanctions designations |

### AI RAG Copilot & System Health
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/chat` | Send conversational query with optional `documentId` for grounded RAG |
| `GET` | `/api/health` | Service status, active AI provider, model, and queue stats |
| `GET` | `/api/taxonomy` | Reference dictionary of document types, Incoterms, and categories |

---

## 🧪 Pre-Built Sample Test Documents

The repository root includes three realistic, pre-constructed test documents designed for immediate verification:

| Test Document | File Path | Risk Score | Decision | Key Characteristics |
| :--- | :--- | :---: | :---: | :--- |
| **Sample 1: Very Safe** | [`Sample_1_Very_Safe_Document.pdf`](./Sample_1_Very_Safe_Document.pdf) | **~5 / 100** | 🟢 **`ALLOW`** | German precision tool manufacturer exporting to UK buyer. Clean counterparties, verified Deutsche Bank / Barclays routing, EAR99 civilian scope, perfect math. |
| **Sample 2: Moderate Risk** | [`Sample_2_Moderate_Risk_Document.pdf`](./Sample_2_Moderate_Risk_Document.pdf) | **~50 / 100** | 🟡 **`REVIEW`** | UAE to Azerbaijan router shipment. Disconnected third-party consignee, dual-use ECCN 5A002 encryption, pending End-User Certificate (EUC). |
| **Sample 3: High Risk** | [`Sample_3_High_Risk_Sanctioned_Document.pdf`](./Sample_3_High_Risk_Sanctioned_Document.pdf) | **~98 / 100** | 🔴 **`BLOCK`** | Russia to Iran shipment of navigation gyros. Sanctioned parties (Sovcomflot, Bank Melli Iran, IRISL), embargoed destination, missile tech ECCN 7A003. |

---

## 🚀 Quick Start & Developer Guide

### Prerequisites
- **Node.js**: `v20.19.0` or higher
- **npm**: `v10.x` or higher

---

### 1. Backend Setup

```bash
cd backend
npm install
```

Create and configure your `.env` file:
```bash
cp .env.example .env
```

#### Configuration Options in `backend/.env`:
```env
PORT=4000
NODE_ENV=development

# Storage Driver: 'memory' (with disk backup) or 'mongodb'
STORAGE_DRIVER=memory

# AI Provider Configuration
# Options: 'openai-compatible' (Groq, OpenAI, Ollama), 'anthropic', or leave empty for offline Heuristic mode
AI_PROVIDER=openai-compatible
OPENAI_API_KEY=your_groq_or_openai_api_key
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=llama-3.3-70b-versatile

# Concurrency & Batching Limits
PROCESSING_CONCURRENCY=2
AI_BATCH_MAX_CHARS=6000
```

Start the backend in development mode (with auto-reload):
```bash
npm run dev
# API server will listen on http://localhost:4000
```

---

### 2. Frontend Setup

In a separate terminal:
```bash
cd frontend
npm install
npm start
# Application will serve at http://localhost:4200 (proxies /api to http://localhost:4000)
```

---

### 3. Verification & Quality Checks

Run the TypeScript typecheck on the backend:
```bash
cd backend
npm run typecheck
```

Run the end-to-end headless smoke test:
```bash
cd backend
npm run smoke
```

Build the frontend for production:
```bash
cd frontend
npm run build
```

---

## 🧠 Engineering Rules & Guiding Principles for AI Agents

Any AI agent modifying, extending, or maintaining this codebase **must adhere strictly to the following architectural rules**:

1. **The LLM Never Decides Match / No-Match**:
   - The LLM is used for structural document extraction and explaining findings.
   - All sanctions screening, export control classification, beneficial ownership calculation, and mathematical validation are **deterministic algorithms**.
   - Never allow an LLM to invent or infer a match status based on internal memory.

2. **Immutable Screening Logs (Append-Only)**:
   - Screening records must never be overwritten or deleted.
   - Every screening event creates a new entry with an immutable snapshot of extracted fields, list versions consulted, and a SHA-256 hash chain (`event_hash`).

3. **Adhere to the Bitemporal Principle**:
   - Never query current sanctions lists to decide the compliance status of a past transaction.
   - Always query the version active as of the transaction's effective date. If an entity was designated later, record it as `ADDED_AFTER_TRANSACTION` with an alert, but do not retroactively block the historical trade.

4. **Preserve the 9-Factor Scoring Formula**:
   - When introducing new risk factors or regulatory rules, maintain the weighted distribution and enforce the mandatory hard floors for direct sanctions matches ($S_{\text{sanctions}} \ge 90 \implies \text{Overall} \ge 95$).

5. **Maintain Pure Vanilla SCSS in the Frontend**:
   - The frontend uses a custom SCSS design token system (`styles.scss`). **Do not introduce TailwindCSS** or external component libraries without explicit user request.
   - Use modern Angular 20 primitives (`signal()`, `computed()`, `@if`, `@for`, standalone components).

6. **Preserve High-Fidelity PDF Dossier Formatting**:
   - Any modifications to [`pdf-report.service.ts`](file:///d:/Ramis/Sir%20Imad/pdf%20analyzer/backend/src/services/pdf-report.service.ts) must preserve page budget measurements, running headers/footers, and print-ready A4 dimensions ($595.28 \times 841.89$ pt).

---

## 📜 Regulatory Standards & Acknowledgements
- **ICC UCP 600 & ISBP 745**: Uniform Customs and Practice for Documentary Credits.
- **FATF TBML Typologies**: Financial Action Task Force Best Practices on Trade-Based Money Laundering.
- **Wolfsberg Group**: Trade Finance Principles on Sanctions Screening and Due Diligence.
- **State Bank of Pakistan**: Foreign Exchange Manual (Chapters 12 & 13) and Targeted Financial Sanctions Directives.
- **US OFAC & BIS**: Export Administration Regulations (EAR) and Commerce Control List (CCL).

---

## 📄 License
This project is licensed under the **MIT License**. See `LICENSE` for details.
