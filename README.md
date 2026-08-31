# TradeGuard Intelligence — AI Trade Finance Compliance & Sanctions Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Angular](https://img.shields.io/badge/Angular-19-dd0031.svg)](https://angular.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.22-lightgrey.svg)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**TradeGuard Intelligence** (formerly DocuIntel AI) is an enterprise-grade AI-powered **Trade Finance Document Intelligence & Compliance Platform**. It automates compliance auditing for Letters of Credit (LCs), Commercial Invoices, Bills of Lading, and Shipping Presentations.

The platform automatically extracts transaction counterparties, line items, and logistics nodes from PDF and Word (`.doc`, `.docx`) documents, screens all entities against global sanctions watchlists (**OFAC SDN, UN Consolidated, EU, UK OFSI**), validates dual-use export controls (**ECCN / Military lists**), detects Trade-Based Money Laundering (**TBML**) red flags, computes an **explainable 9-factor risk score**, and generates **audit-ready PDF compliance dossiers**.

---

## 🌟 Key Capabilities

### 1. 🔍 Automated Entity & Transaction Extraction
- **Supported File Types**: High-fidelity extraction from PDF and Word (`.doc`, `.docx`).
- **Counterparty Extraction**: Exporter/Seller, Importer/Buyer, Consignee, Shipper, Issuing/Advising Banks, Ultimate End-Users.
- **Commercial & Logistics Profiling**: Incoterms (CIF, FOB, CIP, etc.), Payment Terms, Origin & Destination Ports, Transit Routes, Currencies, and Declared Values.
- **Commodity Breakdown**: Automatic extraction of product descriptions, quantities, unit prices, HS Codes, and ECCN classifications.

### 2. 🛡️ Multi-Jurisdiction Sanctions Screening
- **Real-Time Screening**: Matches counterparties, vessel names, IMO numbers, and banks against:
  - **US Treasury OFAC** (SDN & Sectoral Sanctions)
  - **United Nations Consolidated List**
  - **European Union Financial Sanctions**
  - **UK OFSI Consolidated List**
- **Fuzzy Matching & Alias Resolution**: Identifies hidden aliases, state development corporations, and high-risk jurisdictions.

### 3. 🚨 TBML & Fraud Anomaly Detection
- **Pricing & Volume Anomalies**: Identifies over-invoicing and under-invoicing patterns compared against standard commodity benchmarks.
- **FATF Indicator Checks**: Detects consignee disconnections, circular shipping routes, third-party intermediary payments, and free-trade zone transit anomalies.
- **Documentary Discrepancies**: Automatic reconciliation between Commercial Invoices, Packing Lists, and Bills of Lading.

### 4. 📊 Explainable 9-Factor Risk Scoring (0–100)
A transparent, weighted scoring engine assessing 9 distinct compliance vectors:
1. **Sanctions Risk** (30% weight)
2. **Export Controls & Dual-Use Scope** (15% weight)
3. **Goods Scope & Authorization** (15% weight)
4. **TBML & Fraud Indicators** (15% weight)
5. **End-Use Consistency** (8% weight)
6. **End-User Identification** (7% weight)
7. **Document & Math Integrity** (4% weight)
8. **Transaction Anomalies** (4% weight)
9. **Geographic & Routing Risk** (2% weight)

**Automated Verdict Decisions**:
- 🟢 **`ALLOW`** (Risk: 0–34) — Compliant presentation; proceed with standard operations.
- 🟡 **`REVIEW`** (Risk: 35–79) — Manual verification required; discrepancies or missing licenses flagged.
- 🔴 **`BLOCK / ESCALATE`** (Risk: 80–100) — Critical violation / sanctions hit; halt processing immediately.

### 5. 📑 Enterprise PDF Compliance Dossier Export
- Generates publication-quality, multi-page PDF compliance reports.
- Includes dynamic key-value profile grids, color-coded risk meter bars, red-flag alert callouts, commodity tables, compliance officer sign-off seal boxes, and buffered running audit footers.

### 6. 🤖 Interactive RAG Compliance Copilot
- Context-aware chatbot grounded directly in the screened document's passages and compliance findings.
- Ask questions like: *"Why was this transaction flagged?"*, *"What are the controlled items?"*, or *"Which sanctions list matched the issuing bank?"*.

---

## 🧪 Included Sample Test Documents

The repository includes 3 pre-built, realistic test documents in the root directory for immediate validation:

| Test Document | Risk Level | Target Decision | Key Highlights |
| :--- | :--- | :--- | :--- |
| [`Sample_1_Very_Safe_Document.pdf`](./Sample_1_Very_Safe_Document.pdf) | **~5 / 100** | 🟢 **`ALLOW`** | German precision tools exporter to UK buyer. Clean banks (Deutsche Bank, Barclays), verified math, non-controlled civilian scope (EAR99). |
| [`Sample_2_Moderate_Risk_Document.pdf`](./Sample_2_Moderate_Risk_Document.pdf) | **~50 / 100** | 🟡 **`REVIEW`** | UAE to Azerbaijan router shipment. Consignee disconnected from buyer, dual-use ECCN 5A002 encryption, pending End-User Certificate. |
| [`Sample_3_High_Risk_Sanctioned_Document.pdf`](./Sample_3_High_Risk_Sanctioned_Document.pdf) | **~98 / 100** | 🔴 **`BLOCK`** | Russia to Iran navigation gyros. Sanctioned entities (Sovcomflot, Bank Melli Iran, IRISL), embargoed destination, missile tech ECCN 7A003. |

---

## 🏗️ System Architecture

```
trade-guard-intelligence/
├── backend/
│   ├── src/
│   │   ├── ai/                      # LLM providers (Anthropic, OpenAI-compatible, Groq) & Trade Extractor
│   │   ├── compliance/              # Sanctions Engine, TBML, Dual-Use, Risk Scoring, Reconciliation
│   │   │   ├── sanctions/           # OFAC, UN, EU/UK provider datasets & fuzzy matcher
│   │   │   ├── tbml.service.ts      # TBML red-flag rules & pricing anomaly algorithms
│   │   │   ├── risk-scoring.service.ts # 9-factor weighted matrix & decision logic
│   │   │   └── reconciliation.service.ts # Cross-document mismatch detector
│   │   ├── config/                  # Trade taxonomy, Incoterms, and environment settings
│   │   ├── controllers/             # Express route handlers
│   │   ├── document-processing/     # PDF, DOC, DOCX extractors, text normalizer, chunker
│   │   ├── routes/                  # REST API endpoints
│   │   ├── services/                # DocumentService, PDFReportService, RAGService, AnalysisService
│   │   └── server.ts                # Server bootstrap & WebSocket/HTTP handling
│   ├── scripts/                     # Smoke tests & sample document generators
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── pages/
│   │   │   │   ├── dashboard/       # Upload zone, document list, risk badges
│   │   │   │   ├── processing/      # 7-stage animated pipeline tracker
│   │   │   │   ├── analysis/        # Flagship compliance analytics & paragraph explorer
│   │   │   │   └── comparison/      # Cross-document reconciliation view
│   │   │   ├── services/            # DocumentsService, ChatService, ThemeService
│   │   │   └── shared/              # Reusable charts (Donut, Bar, Timeline), Chatbot, ReportModal
│   │   └── styles.scss              # Enterprise dark/light design system
│   └── package.json
```

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js**: `v20.x` or higher
- **npm**: `v10.x` or higher

---

### 1. Backend Setup

```bash
cd backend
npm install
```

Configure your `.env` file:
```bash
cp .env.example .env
```

Edit `backend/.env` with your preferred AI provider (supports Groq, OpenAI, Anthropic, or local offline Heuristic mode):
```env
PORT=4000
NODE_ENV=development
AI_PROVIDER=openai-compatible
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=llama-3.3-70b-versatile
```

Start the backend API server:
```bash
npm run dev
# Backend API will run at http://localhost:4000
```

---

### 2. Frontend Setup

In a new terminal:
```bash
cd frontend
npm install
npm start
# Frontend application will open at http://localhost:4200
```

---

## 📡 REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/documents/upload` | Upload PDF/DOCX file and begin ingestion |
| `GET` | `/api/documents` | List all screened documents with risk summaries |
| `GET` | `/api/documents/:id` | Retrieve full document details and metadata |
| `GET` | `/api/documents/:id/status` | Real-time 7-stage processing progress and ETA |
| `GET` | `/api/documents/:id/results` | Compliance verdicts, sanctions hits, TBML flags, risk scores |
| `GET` | `/api/documents/:id/report/pdf` | **Download publication-quality PDF compliance report** |
| `GET` | `/api/documents/:id/report` | Download structured plain-text audit report |
| `POST` | `/api/documents/:id/override` | Record compliance officer manual override with audit log |
| `POST` | `/api/chat` | Query the RAG Compliance Copilot with document context |
| `DELETE`| `/api/documents/:id` | Permanently delete document and purge stored data |

---

## 🛡️ Security & Regulatory Compliance
- **Zero API Key Exposure**: All AI client calls and watchlist checks execute securely on the backend.
- **Magic-Byte Signature Verification**: Uploads are verified via low-level binary inspection to prevent file-type spoofing.
- **Full Audit Trail**: Every screening event records timestamps, model version, dataset version, and rule IDs.
- **FATF & Wolfsberg Compliance**: Engineered in alignment with Financial Action Task Force (FATF) TBML guidelines and Wolfsberg Group trade finance principles.

---

## 📜 License
Distributed under the **MIT License**. See `LICENSE` for more information.
