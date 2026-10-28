# Pakistan Customs Tariff: how the bank supplies it

The platform does **not** fetch the Pakistan Customs Tariff. No machine-readable copy that it may lawfully retrieve was found, and the tariff changes by notification (Finance Acts, SROs). The bank supplies a controlled copy; the platform stores it, checks it, and uses it only after a second person approves it. Until one is approved, tariff lines are not verified and every result says so ("National tariff lines … not checked").

## File format (CSV, UTF-8)

One header row, then one row per tariff line and edition. Column order does not matter; names are case-insensitive.

| Column | Required | Rule |
|---|---|---|
| `pct_code` | yes | 8 digits (dots, spaces and hyphens are removed: `5201.0000` is `52010000`) |
| `hs6` | yes | 6 digits, and exactly the first six digits of `pct_code` |
| `description` | yes | 3 to 600 characters |
| `unit` | no | the tariff's unit (kg, m2, u …) |
| `customs_duty_pct` | no | number from 0 to 500 |
| `regulatory_duty_pct` | no | number from 0 to 500 |
| `notes` | no | the tariff's own note for the line, shown with results |
| `restrictions` | no | a permit, licence or condition the tariff records. Shown to a trade officer as "carries a recorded condition"; never blocks by itself |
| `effective_from` | yes | `YYYY-MM-DD` |
| `effective_to` | no | `YYYY-MM-DD`, not before `effective_from`; empty = still in force |

Rules the platform enforces: every row must be valid (one bad row rejects the whole file); a line may appear more than once only with different `effective_from` dates; at most 25,000 lines and 12 MB; plain text only.

Example:

```
pct_code,hs6,description,unit,customs_duty_pct,regulatory_duty_pct,notes,restrictions,effective_from,effective_to
5201.0000,520100,"Cotton, not carded or combed",kg,0,0,,,2024-07-01,2026-12-31
5201.0010,520100,"Cotton, not carded or combed, raw",kg,0,1,,,2027-01-01,
```

(The data above is invented to show the format; it is not the tariff.)

## Workflow

1. **Submit** (needs `verification.reference.submit`: compliance roles). On the *Verification controls* screen choose the CSV and state:
   - the edition or version label, the publisher, the source reference (publication, notification number or internal export) and the publication date;
   - whether the file is the **full tariff** or an **extract**. For an extract, a line that is not in the file is sent to review, not reported as an error;
   - who at the bank confirmed the bank may use this copy for this purpose, and tick the confirmation. The platform records this statement; it does not judge it.
2. The platform validates every row, computes the SHA-256 of the file, stores it and records the submission in the hash-chained governance log.
3. **Approve or reject** (needs `verification.reference.approve`: the Chief Compliance Officer). The person who submitted a dataset can never approve it. The decision, the person and the reason are recorded.
4. Once approved, the dataset answers for the dates it covers. Where several approved datasets cover a date, the most recently published one answers. Each line is used only if it was in force on the transaction date.
5. **Retire** an edition when it is superseded. A retired dataset is kept, with its hash, so an assessment made against it can be reproduced; it simply stops answering.

## Safeguards

- The stored file is re-hashed every time it is loaded. A file that no longer matches the hash recorded at submission is not used, and the source shows as unavailable.
- If the governance log itself fails its integrity check, **no** dataset or rule approval is honoured.
- A dataset older than 120 days is still used, but its evidence is marked as possibly predating later notifications.
- Evidence from a dataset states its version, publication date, hash and origin (bank-supplied or synthetic test). Synthetic data is labelled "SYNTHETIC TEST DATASET" and can only be installed by the automated tests, never through the API.

## What a match does and does not mean

A line found in the approved dataset shows the code exists in that edition on that date, and lets the platform compare the goods description with the tariff's own wording. It does **not** prove the duty rate, the import's eligibility, or that a permit is on file. Duty rates and conditions are shown as the dataset records them.
