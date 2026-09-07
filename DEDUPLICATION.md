# DocuIntel Content-Based Deduplication & Indexing Architecture

## Overview

DocuIntel enforces **content-based, tenant-isolated document deduplication** to guarantee data integrity, accurate billing/volume accounting, and zero wasted OCR/LLM compute.

---

## 1. Fingerprinting Mechanisms

### A. `contentHash` (Strict Byte-Identical Deduplication)
- **Algorithm:** SHA-256 over the raw uploaded file buffer (`crypto.createHash('sha256').update(file.buffer).digest('hex')`).
- **Timing:** Computed immediately at upload ingestion **before** any disk writes, parsing, OCR, or LLM processing.
- **Scope:** Scoped per tenant/customer (`customerId + contentHash`). Two separate tenants uploading the same public PDF will maintain isolated records.
- **Action on Exact Match:**
  - Silently deduplicated.
  - Returns existing canonical document record with HTTP `200` (`{ duplicate: true, documentId: canonicalId }`).
  - Skips OCR, text extraction, structuring, LLM classification, and `document_units` insertion.
  - Prevents double-incrementing `lifetimeVolumeUsd` or transaction counts.
  - Logs structured audit event: `[AUDIT_LOG] duplicate_upload_attempted`.

### B. `normalizedTextHash` (Near-Duplicate Signal)
- **Algorithm:** SHA-256 over normalized text (lower-cased, whitespace and newlines collapsed, page headers/footers/page numbers stripped).
- **Timing:** Computed immediately after extraction stage.
- **Action on Match:**
  - If `contentHash` is unique (e.g. re-scanned or re-saved PDF with different file metadata), `normalizedTextHash` flags a near-duplicate audit event (`[AUDIT_LOG] near_duplicate_detected`).
  - Surfaced for user advisory review rather than auto-blocking.

---

## 2. MongoDB Indexing Strategy

### `documents` Collection
```javascript
db.documents.createIndex(
  { customerId: 1, contentHash: 1 },
  { unique: true, name: "uniq_customer_contentHash" }
)
```
- **Concurrency Safety:** Enforces race-safety at the database layer. If two identical files are uploaded concurrently (milliseconds apart), MongoDB rejects the second insert with a duplicate key error (`E11000`), which DocuIntel catches and safely resolves to the winning record.

### `document_units` Collection
```javascript
db.document_units.createIndex(
  { documentId: 1, pageNumber: 1, paragraphNumber: 1 },
  { name: "documentId_page_paragraph" }
)
```
- **Per-Document Query Performance:** Allows fast indexed queries for document passages without scanning the entire collection or pulling unneeded documents into application memory.

---

## 3. Deduplication Cleanup & Migration Script

A migration script is provided at `backend/scripts/dedup-cleanup-migration.ts`.

### Safe Preview (`--dry-run`):
```bash
cd backend
npx tsx scripts/dedup-cleanup-migration.ts
```
- Analyzes existing documents in MongoDB Atlas.
- Groups documents by tenant and content hash / structural fingerprint.
- Shows exactly how many duplicate documents and orphan `document_units` would be deleted.
- Calculates customer volume adjustments.
- **Does not mutate or delete any data.**

### Executing Live Cleanup (`--commit`):
```bash
cd backend
npx tsx scripts/dedup-cleanup-migration.ts --commit
```
- Deletes duplicate `document_units` and duplicate `documents` records.
- Recomputes and updates affected customers' `lifetimeVolumeUsd` and transaction counts.
- Verifies and applies the unique compound indexes.

---

## 4. Test Suite

Run the automated deduplication test suite:
```bash
cd backend
npx tsx scripts/test-deduplication.ts
```

### Covered Test Cases:
1. **Fingerprint Accuracy:** Verifies SHA-256 byte hashing and normalized text invariance.
2. **Sequential Upload Dedup:** Validates second upload returns canonical ID and skips ingestion.
3. **Concurrency Race Safety:** Simulates 5 simultaneous parallel uploads of the identical file; verifies exactly 1 document record is created and 4 requests receive canonical duplicate pointers.
4. **Tenant Isolation:** Ensures different customer IDs receive independent document records for identical file bytes.
5. **Distinct Document Processing:** Validates that new documents process normally.
6. **Compound Index Ordering:** Validates `document_units` queries are strictly ordered by `pageNumber` and `paragraphNumber`.
