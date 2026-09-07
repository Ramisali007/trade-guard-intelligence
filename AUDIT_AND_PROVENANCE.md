# TradeGuard Intelligence — Audit, Provenance & Point-in-Time Compliance

## 1. Regulatory Context

In international trade finance (under Wolfsberg Group, FATF, and Basel Committee standards), financial institutions and trading houses must be able to prove to regulatory examiners not just that a transaction is clean today, but that **it was compliant at the exact date and time the financial presentation occurred**.

If a shipping line or counterparty is added to a sanctions list on July 10, 2026, a bank that executed a Letter of Credit presentation on June 1, 2026 cannot be held legally liable for retrospective designations, provided they maintain tamper-evident audit evidence of their contemporaneous screening.

---

## 2. Bitemporal SCD Type-2 Architecture

TradeGuard implements **Slowly Changing Dimensions (SCD) Type-2** across all compliance entities.

### Schema Fields
- `effectiveFrom`: The exact statutory timestamp when the designation became legally active.
- `effectiveTo`: The timestamp when the designation was revoked/delisted (`null` for currently active designations).
- `isCurrent`: Boolean indicating whether this row is the latest known version of the entity.
- `version`: Revision number incremented on each official list modification.

### Point-in-Time Query Logic
When a document dated `transactionDate` is analyzed, the sanctions engine executes:

```typescript
const isDesignatedAtTxnDate = entity.effectiveFrom <= transactionDate && 
  (entity.effectiveTo === null || entity.effectiveTo > transactionDate);
```

### Four Possible Temporal Verdicts

1. **`NOT_LISTED_AT_TRANSACTION_TIME`**: Clean transaction. The entity was not on any sanctions list at transaction date and is not listed today.
2. **`LISTED_AT_TRANSACTION_TIME`**: Direct violation. The entity was actively designated on the date of transaction. Immediate `REJECT` decision.
3. **`ADDED_AFTER_TRANSACTION`**: Informational warning. The transaction was fully legal when executed; the entity was designated at a subsequent date. The transaction is **not** retroactively rejected, but an informational retrospective notice is appended to the audit report.
4. **`DELISTED_PRIOR_TO_TRANSACTION`**: The entity was previously sanctioned in the past, but the designation had expired or been officially lifted prior to the transaction date.

---

## 3. Cryptographic Audit Package & Hash Chains

For every analyzed document, TradeGuard produces an immutable, tamper-evident audit package (`AuditEvidencePackage`) embedded in the document's canonical record.

### Audit Package Structure
```json
{
  "packageId": "AUDIT-PKG-20260907-8812",
  "documentId": "22962e71-fd0b-4dfa-ac56-14de07c8cc27",
  "generatedAt": "2026-09-07T08:15:30.000Z",
  "documentHashSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "provenanceRecords": [
    {
      "checkCategory": "SANCTIONS_POINT_IN_TIME",
      "checkedParty": "Apex Textiles Global Ltd",
      "asOfDate": "2026-08-10T00:00:00.000Z",
      "canonicalSource": "OFAC_SDN",
      "sourceVersion": 4,
      "sourceChecksum": "3b26ff65afeb06e8a253f69b9c8cf147c4a4c41f31167c692b9823169e6fd410",
      "statusAtTransactionDate": "CLEAR",
      "currentStatus": "CLEAR"
    }
  ],
  "auditCertificateHash": "7a94bf827e8a93... (SHA-256 Digest of entire audit trail)"
}
```

### Regulatory Verification Endpoint
Examiners can independently verify the audit certificate for any processed document via:
```http
GET /api/documents/:id/audit-certificate
```
This returns the verifiable cryptographic hash, timestamp, and immutable list of data sources used to substantiate the decision.
