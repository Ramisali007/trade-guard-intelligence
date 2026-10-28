# TRADEGUARD INTELLIGENCE / DOCUINTEL: TBML SYSTEM DEEP AUDIT REPORT

**Confidential Regulatory Compliance & Application Security Audit**  
**Document Reference:** `DOC-TBML-AUDIT-2026-V1`  
**Classification:** Tier-1 Bank Technical Due Diligence / AML Compliance Audit  
**System Evaluated:** TradeGuard Intelligence / DocuIntel TBML Detection System  
**Audit Branch:** `audit/tbml-production-hardening`  
**Date:** October 13, 2026  

---

## 1. Executive Summary & Audit Scope

TradeGuard Intelligence (DocuIntel) was subjected to a comprehensive architecture, financial compliance, application security, data integrity, and production-readiness audit. The system serves as an enterprise-grade Trade-Based Money Laundering (TBML) detection, automated document examination (UCP 600 / ISBP 745), and point-in-time sanctions screening platform designed for corporate banking trade finance operations (Letters of Credit, Bills of Lading, Commercial Invoices, and Payment Advices).

### Core Findings Matrix
| Domain Area | Pre-Audit Status | Post-Audit Status | Risk Classification |
|---|---|---|---|
| **TBML Fraud Engine (18 Rules)** | Validated | Verified & Grounded | Low (Fully Preserved) |
| **Point-in-Time Sanctions Screening** | SCD Type-2 Implemented | Verified (Deterministic) | Low (Zero Hallucination) |
| **CORS & Cross-Origin Security** | Restricted Header Whitelist | Hardened (`Authorization`, Custom Headers, `PUT/PATCH`) | High Defect Remediated |
| **CSV Import & Injection Shielding** | Vulnerable to RFC 4180 Escaped Quotes | Hardened with Quote-Escaped Parsing & Formula Sanitization | High Defect Remediated |
| **Document Source Binary Downloads** | Missing Dedicated Route/File Handler | Implemented with Path Traversal Guard & RFC 6266 Headers | Medium Defect Remediated |
| **Static Asset Deployment Protection** | Blanket `*.jpg/*.png` ignored in `.gitignore` | Fixed with Exception `!frontend/public/**` | High Deployment Defect Remediated |
| **UI Grounding & KPI Counters** | Mocked Offset in Dashboard (`+ 24`) | Tied to Live Database / Compliance Health Signals | Medium Defect Remediated |
| **CommonJS Build Warnings** | 6 Angular Build Warnings (`jspdf`, `html2canvas`, etc.) | Whitelisted in `angular.json` | Clean Compilation Verified |

---

## 2. Complete Architecture Overview

The system employs a dual-tier persistence model with decoupled asynchronous document processing and multi-tiered compliance validation.

```
                              ┌───────────────────────────────────────────┐
                              │     Angular 18 Frontend (Standalone)      │
                              │     Signals, OnPush, RxJS, Modern SCSS    │
                              └─────────────────────┬─────────────────────┘
                                                    │ HTTPS / REST (JSON + Multipart)
                                                    ▼
                              ┌───────────────────────────────────────────┐
                              │       Express / TypeScript Gateway        │
                              │  Helmet, Compression, Bank-Grade CORS,    │
                              │  HMAC-SHA256 JWT Auth, Rate Limiter       │
                              └─────────────────────┬─────────────────────┘
                                                    │
         ┌──────────────────────────────────────────┼──────────────────────────────────────────┐
         │                                          │                                          │
         ▼                                          ▼                                          ▼
┌──────────────────┐                       ┌──────────────────┐                       ┌──────────────────┐
│ Ingestion & OCR  │                       │   TBML Engine    │                       │ Compliance Store │
│ - PDF/Word/OCR   │                       │ - 18 Rule Suites │                       │ - Dual-Tier DB   │
│ - Tesseract 7.0  │                       │ - UCP 600 / ISBP │                       │   (MongoDB Primary│
│ - Mammoth/Word   │                       │ - Container Digits│                      │   + Local JSON)  │
│ - SHA-256 Byte   │                       │ - Dual-Invoicing │                       │ - SCD Type-2     │
│   Deduplication  │                       │ - Price Corridors│                       │   Sanctions Reg. │
└──────────────────┘                       └──────────────────┘                       └──────────────────┘
         │                                          │                                          │
         └──────────────────────────────────────────┼──────────────────────────────────────────┘
                                                    │
                                                    ▼
                              ┌───────────────────────────────────────────┐
                              │        4-Tier Resolution Engine           │
                              │ 1. Fresh Live Scraping (Web/Comtrade/AIS) │
                              │ 2. In-Memory Cache (TTL & Invalidation)  │
                              │ 3. Stored Database Fallback (Dated)       │
                              │ 4. Deterministic Unknown (No Hallucination│
                              └───────────────────────────────────────────┘
```

### Ingestion & Data Lifecycle
1. **Upload & Fingerprinting:** Ingestion starts at `POST /api/documents/upload` or `/batch`. A SHA-256 cryptographic digest of the raw binary payload is computed *before* any disk write.
2. **Deduplication Check:** The system looks up `(customerId, contentHash)`. If an exact duplicate exists, the existing document is returned without double-counting lifetime volumes or re-executing OCR.
3. **Extraction & Classification:** PdfJs and Tesseract (with Mammoth for `.docx`) extract raw text. Regex and heuristic extractors identify counterparties, LC references, ports, and line items.
4. **TBML 18-Rule Evaluation:** The document is evaluated across 18 rules (vessel tracking, container check digits, price corridors, UCP 600 partial drawings, and behavioral baselines).
5. **Point-in-Time Sanctions Screening:** Parties are matched against SCD Type-2 temporal snapshots as of the transaction date.
6. **Report Generation & Storage:** PDF and text audit dossiers are generated with cryptographic hashes and stored with immutable event logs.

---

## 3. TBML Domain Logic Audit

### A. Document Ingestion, Normalization, & Deduplication
- **Byte Fingerprinting:** `DocumentService` computes SHA-256 bytes immediately.
- **Tenant Isolation:** Scoped to `customerId`. Cross-tenant collisions are flagged as suspicious replay attacks (Scenario 5).
- **Normalization:** Currency normalization (USD basis), metric conversions (MT, kg, bbl), and ISO country code mapping.
- **Zero Hallucination:** If counterparty or commodity information is missing, the system outputs explicit uncertainties rather than synthesized defaults.

### B. Sanctions and Watchlist Screening (SCD Type-2)
- **Temporal Integrity:** Matches are evaluated against the list state valid *at the document date*.
- **Provenance Tracking:** Every match records the list version, source URL, effective date, and timestamp of verification.
- **Limitation Reporting:** When historical lists are unavailable, the engine reports an explicit historical limitation rather than claiming the entity was cleared.

### C. Trade Transaction & LC Consistency (UCP 600 / ISBP 745)
- **LC Expiry vs. Bill of Lading Date:** Flags late shipment per UCP 600 Article 14.
- **Partial Drawing vs. Over-drawing:** Validates partial shipments while preventing cumulative over-invoicing across multiple drawings.
- **Carrier & Vessel Validation:** Compares issuing bank instructions with shipping agent endorsements.

### D. Over/Under-Invoicing & Price Anomaly Detection
- **4-Tier Data Resolution:** Live Comtrade benchmark retrieval followed by database fallback.
- **Unit Normalization:** Normalizes metric tons, barrels, and bushels to standard units before computing deviations against the ±20% regulatory corridor.
- **Zero Hallucination Guarantee:** For unknown or unquoted commodities (e.g., fictional materials), the engine strictly reports `found: false` with `price: null` and provenance `UNKNOWN`.

### E. Container & Maritime Route Verification
- **ISO 6346 Check Digit:** Mathematically checks container numbers using the international mod-11 weighting algorithm.
- **Port Sequence Inconsistency:** Validates that loading and discharge ports follow real geographic routing without unexplained transshipment stops.

---

## 4. Confirmed Defects & Root Cause Analysis

### Defect 1: CORS Headers Blocked Banking Token Transports
- **File:** `backend/src/app.ts`
- **Severity:** High
- **Root Cause:** The CORS configuration allowed only `['Content-Type', 'X-Request-Id']`. Critical banking authentication and tenant isolation headers (`Authorization`, `X-API-Key`, `X-TradeGuard-Key`, `X-Customer-Id`, `X-User-Role`) were rejected by browser preflight requests.
- **Remediation:** Whitelisted all standard enterprise compliance headers and added `PUT` and `PATCH` methods.

### Defect 2: RFC 4180 Escaped Quotes Broken in CSV Import
- **File:** `backend/src/controllers/import.controller.ts`
- **Severity:** High
- **Root Cause:** In `splitCsvLine()`, consecutive double quotes (`""`) inside quoted strings were treated as toggle delimiters rather than an escaped single quote per RFC 4180 Section 2.7.
- **Remediation:** Rewrote `splitCsvLine()` with forward-peeking quote escape handler and added `cleanCsvCell()` to strip surrounding delimiters and unescape quotes.

### Defect 3: Missing Document Source Download Endpoint & UI Integration
- **Files:** `backend/src/controllers/document.controller.ts`, `backend/src/routes/documents.routes.ts`, `frontend/src/app/services/documents.service.ts`, `frontend/src/app/pages/analysis/analysis.component.ts`
- **Severity:** Medium
- **Root Cause:** Auditors viewing an analysis report could not download the original unparsed source PDF/DOCX to verify OCR fidelity.
- **Remediation:** Implemented `downloadSourceFile` in backend controller with path traversal guards, added route `GET /api/documents/:id/source`, hooked into frontend `DocumentsService`, and wired up an "Original File" download action in the analysis UI.

### Defect 4: Git-Ignored Static UI Assets Causing Production Breakage
- **File:** `.gitignore`
- **Severity:** High
- **Root Cause:** Root `.gitignore` had blanket patterns `*.jpg`, `*.png`, which caused critical frontend assets (`cargo-ship-hero.jpg`, `card-dot-pattern.jpg`, and 6 blog illustrations) to remain untracked. On a clean CI/CD or production server checkout, all images were missing.
- **Remediation:** Added `!frontend/public/**` exception rule to `.gitignore` so public static assets are preserved.

### Defect 5: Mocked KPI Offset in Frontend Dashboard
- **File:** `frontend/src/app/pages/dashboard/dashboard.component.ts`
- **Severity:** Medium
- **Root Cause:** The "Documents Ingested" counter used `documents().length > 0 ? documents().length + 24 : 36`, artificially inflating production metrics.
- **Remediation:** Bound counter to `totalDocumentsCount()` from the database pagination metadata and tied entity screening counters to `ComplianceHealthSummary`.

### Defect 6: Analytics Dropped to Zero on Cleared Dashboard Inbox
- **Files:** `backend/src/services/document.repository.ts`, `backend/src/services/analytics.service.ts`, `frontend/src/app/services/analytics.service.ts`
- **Severity:** High
- **Root Cause:** `getAllDocumentsForAnalytics()` strictly filtered `{ isArchived: { $ne: true } }`. When a compliance operator cleared their active operational workbench (setting `isArchived: true` for processed documents), the entire analytics module dropped all metrics to zero, despite 131 documents, 98 analysis events, 314 imports, and active commodity corridors existing in MongoDB. Additionally, `range: 'all'` was anchored to epoch 1970 instead of the earliest database record.
- **Remediation:** Removed the hardcoded filter so analytics functions as an enterprise data warehouse covering all stored documents. Anchored `range: 'all'` dynamically to the earliest recorded transaction date in MongoDB. Defaulted analytics views to `'all'` so complete lifetime intelligence is presented immediately upon navigation.

---

## 5. Security Posture Review

- **Path Traversal Defense:** `ImageStorageService` and `document.controller.ts` enforce base directory containment via `path.resolve()`, preventing `../` traversal (CWE-22).
- **SSRF Shielding:** `ImportBatchService` blocks AWS metadata endpoints (`169.254.169.254`), loopbacks (`127.0.0.1`, `[::1]`), and private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) (CWE-918).
- **Formula Injection Defense:** Spreadsheets uploaded or imported sanitize leading `=`, `+`, `-`, `@` characters by prepending `'` (CWE-1236).
- **Cryptographic Authentication:** HMAC-SHA256 banking tokens with expiry checks and role-based privilege enforcement (`CHIEF_COMPLIANCE_OFFICER`, `TBML_RISK_ANALYST`, `TRADE_AUDITOR`).

---

## 6. Audit Conclusion & Sign-Off

All critical and high-severity functional, security, and deployment defects identified during the audit have been repaired and verified through automated test suites. The 18 TBML detection rules, point-in-time sanctions engine, and dual-tier database architecture are fully operational and verified.
