# TradeGuard Intelligence — Operations & Administration Runbook

## 1. Environment & Service Startup

### Backend Service (Express + TypeScript + TSX)
```bash
cd backend
npm install
npm run dev
```
- Starts API server on port `4000` (configurable via `PORT` in `.env`).
- Automatically initializes `ComplianceStore` and loads local baseline if MongoDB is unreachable.
- Automatically starts `SyncSchedulerService` with default background intervals.

### Frontend Service (Angular 18 Enterprise UI)
```bash
cd frontend
npm install
npm start
```
- Starts Angular development server on `http://localhost:4200`.
- Proxies `/api` requests to backend at `http://localhost:4000`.

---

## 2. Operational Health & Dashboard Controls

### Sources & Sync Health Dashboard
Navigate to `http://localhost:4200/sources` in your browser.

The dashboard displays:
- **Global Overview**: Total active sources, healthy vs degraded counts, total entities, benchmarks, vessels, and ports.
- **Source Health Cards**: Status badges (`HEALTHY`, `DEGRADED`, `SUSPICIOUS`, `FAILED`), last sync time, record counts, and SHA-256 checksums.
- **Sync Now Actions**:
  - Click **Sync Now** on any individual source card to trigger an immediate background run.
  - Click **Sync All Registered Sources** at the top right to trigger a global refresh.
- **Recent Sync Runs Audit Table**: Detailed chronological log of run outcomes, durations, records inserted/updated/unchanged, and error descriptions.

---

## 3. Operational REST Endpoints

### Query Source Health
```http
GET /api/documents/compliance/sources
```
Returns list of all 9 registered sources, statuses, record counts, and last sync runs.

### Query Global Compliance Metrics
```http
GET /api/documents/compliance/health
```
Returns aggregated health metrics:
```json
{
  "status": "HEALTHY",
  "driver": "mongo",
  "activeSources": 9,
  "healthySources": 9,
  "degradedSources": 0,
  "totalEntities": 4,
  "totalPriceBenchmarks": 5,
  "totalVessels": 3,
  "totalPorts": 13,
  "totalFxRates": 6,
  "schedulerActive": true
}
```

### Trigger Manual Sync for a Specific Feed
```http
POST /api/documents/compliance/sources/:sourceId/sync
```

### Trigger Global Sync
```http
POST /api/documents/compliance/sources/sync-all
```

---

## 4. Automated Verification & Testing Commands

To run the complete automated test suite:

```bash
# 1. Synchronization Engine & Anomaly Defense (5 tests)
cd backend
npx tsx scripts/test-sync-engine.ts

# 2. Bitemporal Point-in-Time Sanctions Screening (4 tests)
npx tsx scripts/test-point-in-time.ts

# 3. Complete Offline Mode & Zero Network Dependency (4 tests)
npx tsx scripts/test-offline-mode.ts

# 4. Master Smoke Test Suite (6 end-to-end checks)
npm run smoke

# 5. Full REST API Verification (27/27 endpoints)
npx tsx scripts/verify-all-endpoints.ts

# 6. TypeScript Typecheck (Zero Errors)
npm run typecheck
```

---

## 5. Disaster Recovery & Troubleshooting

### Scenario A: Upstream Feed Returns Empty or Truncated File
1. The **Anomaly Defense Guard** triggers automatically if record count drops > 80%.
2. The sync run is aborted and flagged as `SUSPICIOUS`.
3. The existing canonical database remains completely intact.
4. An administrator can inspect `compliance_raw_snapshots` to view the corrupt payload without having affected production data.

### Scenario B: Database Cluster Unreachable (`ECONNREFUSED`)
1. `ComplianceStore` catches the connection error and outputs a warning log.
2. The store automatically falls back to local disk storage in `backend/storage/compliance/`.
3. All document analyses, point-in-time checks, and pricing benchmark lookups continue with 0 interruption.
4. When MongoDB recovers, restarts reconnect seamlessly.

### Scenario C: Resetting Local Baseline
To reset the local memory/disk store to pristine factory baseline:
```bash
# Delete local JSON mirrors
rm backend/storage/compliance/*.json

# Restart backend; baseline will automatically re-seed
npm run dev
```
