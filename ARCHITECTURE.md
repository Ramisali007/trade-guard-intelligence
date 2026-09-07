# TradeGuard Intelligence — Enterprise Architecture Guide

## 1. System Overview & Core Tenets

TradeGuard Intelligence is an enterprise-grade trade finance compliance and document analysis platform designed to evaluate complex international trade transactions (Commercial Invoices, Bills of Lading, Letters of Credit, Customs Declarations) against international regulatory regimes.

The platform is designed around five foundational architectural tenets:

1. **Database-First, Offline-Capable Execution**:
   - Document analysis never performs synchronous outbound internet requests during trade presentation evaluation.
   - All compliance intelligence (Sanctions designations, Commodity price corridors, Vessel identities, UN/LOCODE ports, FX exchange rates) is stored in the local canonical database.
2. **Background Ingestion & Synchronization**:
   - External intelligence feeds are synchronized asynchronously via background workers.
   - Sync pipelines feature SHA-256 change detection, staged snapshots, and automatic record drop protection (Anomaly Guard).
3. **Bitemporal Point-in-Time Integrity (SCD Type-2)**:
   - Historical compliance truth is immutably preserved.
   - Queries evaluate whether an entity was designated on the exact transaction date (`status_at(entity, timestamp)`), preventing false retrospective accusations.
4. **Resilient Dual-Tier Persistence**:
   - Primary persistence in MongoDB with compound and unique indexes.
   - Automatic, transparent local memory and disk fallback (`backend/storage/compliance/`) when database clusters are unreachable.
5. **Cryptographic Auditability & Provenance**:
   - Every screening verdict, benchmark comparison, and maritime route check produces tamper-evident audit evidence records chained by SHA-256 hashes.

---

## 2. Component Topology

```mermaid
flowchart TB
    subgraph Frontend["Angular 18 Enterprise UI (Vanilla SCSS)"]
        UI_Home["/documents (Document Hub)"]
        UI_Review["/documents/:id (Analysis & Audit)"]
        UI_Sources["/sources (Compliance Health Dashboard)"]
        UI_Compare["/compare (Dual Document Cross-Check)"]
    end

    subgraph API_Gateway["Express API Gateway & Routing"]
        R_Docs["/api/documents"]
        R_Sanctions["/api/sanctions"]
        R_Sources["/api/documents/compliance/sources"]
        R_Health["/api/documents/compliance/health"]
    end

    subgraph Processing_Pipeline["Document Analysis Pipeline (100% Offline-Decoupled)"]
        OCR["Tesseract OCR & PDF Parser"]
        Extractor["TradeComplianceExtractor"]
        SanctionsEngine["TemporalSanctionsEngine (Point-in-Time)"]
        PricingEngine["PricingIntelligenceService (UN Comtrade Parity)"]
        MaritimeEngine["MaritimeService (AIS Route Reconstruction)"]
        DecisionEngine["TradeDecisionEngine (9-Factor Risk Matrix)"]
    end

    subgraph Sync_Subsystem["Asynchronous Background Sync Subsystem"]
        Scheduler["SyncSchedulerService (Configurable Cron/Intervals)"]
        SyncEngine["SyncEngineService (Idempotent, SHA-256 Checksums)"]
        AnomalyGuard["Anomaly Defense Guard (Drops > 80% Rejected)"]
        Feeds["External Feeds (OFAC, EU, UN, AIS, Comtrade)"]
    end

    subgraph Canonical_Storage["Dual-Tier Canonical Store (ComplianceStore)"]
        MongoDB[("MongoDB Primary Replica Set")]
        LocalDisk[("Local Storage Mirroring /storage/compliance/")]
    end

    UI_Sources -->|Manual Sync Triggers & Health Query| R_Sources
    UI_Home -->|Submit Trade PDFs| R_Docs
    R_Docs --> Extractor
    Extractor --> SanctionsEngine
    Extractor --> PricingEngine
    Extractor --> MaritimeEngine
    Extractor --> DecisionEngine

    SanctionsEngine -->|Local Query| Canonical_Storage
    PricingEngine -->|Local Benchmark Lookup| Canonical_Storage
    MaritimeEngine -->|Local Vessel & Port Cache| Canonical_Storage

    Scheduler --> SyncEngine
    SyncEngine -->|Fetch Updates Out-of-Band| Feeds
    SyncEngine --> AnomalyGuard
    AnomalyGuard -->|Publish & Version (SCD Type-2)| Canonical_Storage

    Canonical_Storage -.->|Mongo Connection Failure| LocalDisk
```

---

## 3. Request Lifecycle & Analysis Pipeline

### A. Document Presentation Evaluation (Real-Time Path)
When an operator uploads a trade document or calls `POST /api/documents`:
1. **Document Ingestion**: PDF stream is parsed, OCR extracted, and document type identified (Commercial Invoice, Bill of Lading, etc.).
2. **Entity Extraction**: Parties (Exporter, Importer, Consignee, Issuing Bank), Commodity line items, Port names, Vessel names, and Incoterms are normalized.
3. **Point-in-Time Sanctions Screening**:
   - Parties are queried against `ComplianceStore.findEntityPointInTime(entity, transactionDate)`.
   - Distinguishes between `ACTIVE_DESIGNATION`, `ADDED_AFTER_TRANSACTION`, and `CLEAR_HISTORICAL`.
4. **Commodity Valuation Assessment**:
   - Line items are normalized to standard units (PCS, KG, MTR) and standard FOB parity.
   - Queried against local UN Comtrade benchmark corridors in `compliance_price_benchmarks`.
   - Over-invoicing (+30%) and under-invoicing (-28%) anomalies flagged.
5. **Maritime AIS Verification**:
   - Vessel IMO / Name and Ports are resolved against `compliance_vessels` and `compliance_ports`.
   - Observed voyage and intermediate calls checked for undeclared transshipment or embargoed waters.
6. **Decision & Audit Package Generation**:
   - Multi-factor risk scores computed.
   - Comprehensive cryptographic audit package generated with SHA-256 checksums and stored in document record.

### B. Background Intelligence Synchronization (Asynchronous Path)
1. `SyncSchedulerService` fires on configured intervals (or via manual operator trigger `POST /sources/:id/sync`).
2. Worker retrieves raw external payload and computes its SHA-256 content hash.
3. **Checksum Comparison**: If hash matches `compliance_sources.lastChecksum`, the sync run is recorded as `SKIPPED_NOT_MODIFIED` in zero milliseconds.
4. **Anomaly Defense**: If record count dropped by more than 80% compared to previous count, publication is blocked and status is marked `SUSPICIOUS`.
5. **SCD Type-2 Publication**: Unchanged records are untouched; updated records have `isCurrent: false` set on prior versions and a new version created with `effectiveFrom`.
