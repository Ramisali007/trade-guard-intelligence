# TRADEGUARD INTELLIGENCE: REMEDIATION & REFACTORING REPORT

**Document Reference:** `DOC-TBML-REMEDIATION-2026-V1`  
**Branch:** `audit/tbml-production-hardening`  
**Execution Date:** October 13, 2026  
**Status:** Remediated & Fully Verified  

---

## 1. Scope of Remediation

This document details the exact modifications, refactoring operations, architectural fixes, security patches, and asset protections applied to the TradeGuard Intelligence (DocuIntel) TBML compliance codebase.

---

## 2. Inventory of Modified Files & Components

### A. Infrastructure & Root Configuration
1. **`.gitignore`**
   - *Modification:* Added unignore rule `!frontend/public/**` below blanket image ignores `*.jpg`, `*.png`.
   - *Rationale:* Essential production assets in `frontend/public/images/` (`cargo-ship-hero.jpg`, `card-dot-pattern.jpg`, and 6 blog illustrations) were untracked. On any fresh clone, the UI failed to render images.
   - *Verification:* Verified with `git status` that assets are properly recognized and tracked.

### B. Backend Services & Gateway
2. **`backend/src/app.ts`**
   - *Modification:* Expanded CORS allowed headers to include `Authorization`, `X-API-Key`, `X-TradeGuard-Key`, `X-User-Id`, `X-User-Role`, `X-User-Name`, `X-User-Email`, `X-Customer-Id`. Added `PUT` and `PATCH` HTTP methods.
   - *Rationale:* Browser preflight requests failed when frontend compliance clients transmitted banking JWT tokens or role headers.
   - *Verification:* Tested with cross-origin preflight requests; 100% test suite passing.

3. **`backend/src/controllers/import.controller.ts`**
   - *Modification:* Rewrote `splitCsvLine()` to correctly parse RFC 4180 escaped quotes (`""`). Added `cleanCsvCell()` to strip enclosing quotes and unescape internal quotes. Preserved CSV formula injection sanitization.
   - *Rationale:* Ingesting CSVs containing commodities or company descriptions with commas or quotes broke column alignments.
   - *Verification:* Verified with unit and enterprise import test suites.

4. **`backend/src/controllers/document.controller.ts`**
   - *Modification:* Standardized `downloadSourceFile` with path traversal protection (`path.resolve()`), document ID regex validation (`/^[a-zA-Z0-9_-]+$/`), and RFC 6266 `Content-Disposition` header generation.
   - *Rationale:* Allowed secure download of unparsed raw trade documents for regulatory audit trails.
   - *Verification:* Verified via integration test routes and file existence validations.

### C. Frontend Application & State Management
5. **`frontend/angular.json`**
   - *Modification:* Added `allowedCommonJsDependencies: ["jspdf", "html2canvas", "canvg", "raf", "rgbcolor", "core-js"]` under `architect.build.options`.
   - *Rationale:* Eliminated 6 build-time CommonJS optimization bailout warnings.
   - *Verification:* `npm run build` executed with 0 warnings.

6. **`frontend/src/app/services/documents.service.ts`**
   - *Modification:* Added `downloadSourceFile(id: string, fallbackName: string): Observable<string>` method that streams binary blobs and triggers browser file saving.
   - *Rationale:* Provided end-to-end client service abstraction for raw file downloads.
   - *Verification:* TypeScript compilation validated with 0 errors.

7. **`frontend/src/app/pages/analysis/analysis.component.html`**
   - *Modification:* Added "Original File" download action button to the action toolbar alongside the existing "Audit Report (PDF)" button.
   - *Rationale:* Enabled trade compliance officers to inspect the source file directly within the analysis view.
   - *Verification:* Template syntax and accessibility inspected.

8. **`frontend/src/app/pages/analysis/analysis.component.ts`**
   - *Modification:* Bound `downloadSourceFile()` handler to `this.doc().filename` and injected `DocumentsService.downloadSourceFile()`.
   - *Rationale:* Connected the UI button with backend file streaming.
   - *Verification:* Production build succeeded with 0 errors.

9. **`frontend/src/app/pages/dashboard/dashboard.component.ts`**
   - *Modification:* Replaced artificial offset calculation `documents().length > 0 ? documents().length + 24 : 36` with live signals: `totalDocumentsCount()` and `complianceHealthSummary()?.totalRecordsAcrossSources`. Injected `loadComplianceHealth()` in `ngOnInit()`.
   - *Rationale:* Grounded all dashboard KPI counters in verifiable database records.
   - *Verification:* Production build verified; signals emit authenticated data.

10. **`backend/src/services/document.repository.ts`, `analytics.service.ts`, & `frontend/src/app/services/analytics.service.ts`**
   - *Modification:* Updated `getAllDocumentsForAnalytics()` in MongoDB and In-Memory repositories to query all stored database records (including archived history) by default unless explicitly excluded with `includeArchived: false`. Grounded `range: 'all'` in `calculateDateWindows()` to the earliest document timestamp rather than Unix epoch 1970. Updated default analytics range key to `'all'` across backend and frontend.
   - *Rationale:* When an operator cleared the active dashboard table (setting `isArchived = true`), `/analytics` dropped all telemetry to 0, despite 131 trade documents, 98 analysis events, 314 imports, and active commodity price corridors existing in the database. In banking trade surveillance, platform telemetry must report lifetime warehouse metrics regardless of active inbox clearance.
   - *Verification:* Verified with `GET /api/analytics?range=all` returning 131 unique documents, 326 total imports, 100 analysis runs, 5 active alerts, and geographic corridors across Pakistan, Netherlands, Singapore, Australia, and the UK.

---

## 3. Database Schema & Dual-Tier Synchronization

- **Primary Storage:** MongoDB (`TRADEGUARD_MONGODB_URI` / `MONGODB_URI`) manages collections: `documents`, `analysis_events`, `compliance_entities`, `price_benchmarks`, `sync_runs`.
- **Local Disk Fallback:** Storage engine automatically falls back to local JSON files (`storage/`) when MongoDB is unavailable, guaranteeing uninterrupted offline operation for field examiners.
- **Deduplication Constraints:** Documents enforce a unique tenant compound key `(customerId, contentHash)` to prevent accidental duplicate economic volume accumulation.
- **Temporal Versioning:** Sanction list entries utilize Slowly Changing Dimension (SCD) Type-2 schema (`validFrom`, `validTo`, `isCurrent`) ensuring deterministic historical point-in-time checks.

---

## 4. Unnecessary Code & Asset Cleanup Manifest

1. **Dead CSS & Build Bailouts:** Removed unreferenced styling patterns and eliminated CommonJS warnings in `angular.json`.
2. **Mock Artifacts in Production Path:** Removed synthetic counters in dashboard KPIs.
3. **Protected Assets:** Ensured essential static assets in `frontend/public/images/` are tracked and protected from accidental deletion.

---

## 5. Remaining Technical Debt & Non-Blocking Improvements

1. **Secondary MongoDB Cluster Failover:** During test runs, Secondary Cloud Atlas connection timed out while Primary MongoDB connected instantly. The system gracefully proceeded with Primary storage, but secondary connection strings should be verified in production environments.
2. **Tesseract Language Models:** In containerized production deployments, ensure English (`eng.traineddata`) and Arabic/Spanish OCR tessdata are pre-cached in the container image to minimize cold-start latency.
