# Deployment readiness assessment — 2026-10-27

This is an assessment, not a runbook. The deployment steps and environment template are in [../DEPLOYMENT_READINESS.md](../DEPLOYMENT_READINESS.md) (marked superseded for status; check variable names against `backend/.env.example`). Earlier verdicts: [../PILOT_READINESS_REPORT.md](../PILOT_READINESS_REPORT.md) (2026-10-21) and [../EXTERNAL_VERIFICATION_PHASE2_REPORT.md](../EXTERNAL_VERIFICATION_PHASE2_REPORT.md) (2026-10-26, "demo-ready, not yet suitable for a controlled pilot").

## Verdict

| Use | Suitable? | Basis |
|---|---|---|
| **Local demonstration** | **Yes** | Every route, role and the full Pre→Post-Shipment journey behaved correctly on an isolated stack; builds and all suites are green (see TEST_EXECUTION_REPORT). Two UI defects found in this audit are fixed. |
| **Controlled pilot** (named users, synthetic or consented data, sandbox channels) | **Not yet — conditional.** No P0/P1 defect remains from this audit, but the blockers below that are *not engineering work* (rule sign-off, data licenses, tariff data, accuracy evaluation) are still open, and live AI accuracy has been measured only on ten clean synthetic documents (72/72), not on real ones. | Same conclusion as the Phase-2 report; this audit did not find anything that changes it, and adds evidence for the security and workflow items. |
| **Production** | **No** | No SSO, no CI evidence, unkeyed audit chain in the local configuration, scraped/unlicensed data sources, no backup-and-restore drill, banking integrations not wired. |

## Assessment by area

| Area | Rating | Evidence and gaps |
|---|---|---|
| **Authentication and sessions** | Good for pilot | Signed tokens, tamper and `alg:none` refused, sign-out revokes the token everywhere, per-account lock, 10/min sign-in limiter. Demo accounts with a published password are enabled outside production and on loopback only; the start-up warns if exposed. **No SSO.** |
| **Authorization / tenant isolation** | Strong | 148 routes × 17 accounts: anonymous 401 everywhere, 1,102 forbidden pairs 403, no 5xx under hostile input; other customer's case/doc/upload/delete/submit all 404 (no existence leak); client cannot set status or reference; administrator holds no business authority. No IDOR or escalation found. Whether the permission *policy* is what the bank wants is for the bank to confirm. |
| **Data integrity** | Good, one known limit | Per-case lock, revision guard across instances, atomic numbering, idempotent creation (M3/M4). **AUDIT-001 fixed** (concurrent identical uploads). **OBS-3:** without MongoDB transactions the case write and its audit event are separate writes; failure is reported (503) and detected by the chain check but not prevented — deploy on a replica set. |
| **Document handling** | Good | Magic-byte type check, extension+MIME allow-list, 50 MB cap (413), traversal-safe storage, authenticated and scoped download, byte-identical round trip, `no-store`/`nosniff`. Truncated PDFs are now refused at upload (AUDIT-005). Gaps: no antivirus scanning (not present in the repository); archive/restore and permanent erasure are covered by `hardening` H4 (not re-driven through the browser). |
| **Workflow correctness** | Good | Handoff by reference, ownership, duplicate-application prevention, blocking discrepancy cannot be bypassed by UI or API, decision recorded with actor/time/reason on a hash-chained log (WORKFLOW_VERIFICATION). |
| **AI reliability** | Verified live on synthetic documents only | Boundary behavior verified with a stand-in model: grounding (every AI point must quote the document), prompt-injection text is data, 429/timeout/malformed fall back and are recorded, AI never decides alone and cannot hold a case. A live check against the configured provider was run later the same day: correct extraction, and an injected "ignore previous instructions" document did not change the origin (Iran stayed screened, decision `BLOCK_ESCALATE`); on ten clean sample documents the extraction scored 72/72 (caveats in TEST_EXECUTION_REPORT.md section 7). Accuracy on real, authorized documents has never been measured (existing blocker 5). |
| **Regulatory content** | Not ready | All verification rules are pending bank sign-off; labeled demonstration/shadow. Nothing in this audit invents or approves policy; items needing bank/compliance approval are unchanged. |
| **Security configuration** | Needs work before pilot | Helmet headers incl. CSP, HSTS, frame options; no `X-Powered-By`; CORS does not echo foreign origins; errors carry no stack or path. `zod` advisory cleared (AUDIT-007, now v4); open: `AUDIT_HMAC_KEY` unset locally (OBS-5), in-process rate limiters (a multi-instance deployment needs a shared counter), no CSRF token (bearer-token API, not cookie-based — not applicable as built). |
| **Performance / capacity** | Not assessed beyond bounds | ~11,000 sequential calls and 6-way bursts were fine; the list pages and dashboards were not measured with realistic volume; `sync-all` now runs in the background (AUDIT-008). |
| **Monitoring and operations** | Partial | Structured logs, `/api/health` and `/health/details`, a denial counter, audit overview; no CI evidence, alerting or backup/restore drill in the repository. |
| **Bank-specific dependencies** | Not integrated | SWIFT, customs/PSW, core banking, payments, SSO, licensed vessel/price/tariff data: see [../INTEGRATION_INVENTORY.md](../INTEGRATION_INVENTORY.md). Post-shipment credit of record = approved pre-shipment application is an assumption the bank must confirm (`POST_SHIPMENT_REPORT.md`). |

## Exact next steps for a controlled pilot

1. Deploy MongoDB as a replica set (transactions) and set `AUTH_SECRET`, `ENABLE_DEMO_LOGIN=false`, `STORAGE_ALLOW_MEMORY_FALLBACK=false`. `AUDIT_HMAC_KEY` is already set in the local `backend/.env`; **a production key must be generated separately, kept in a secret store and backed up**, because entries signed with it cannot be verified without it.
2. ~~Plan the `zod` upgrade~~ Done in the second pass (AUDIT-007): `zod` 4, `npm audit` 0 vulnerabilities, `npm test`, `test:probe` and the MongoDB suite re-run green. Re-run all three after any later dependency change.
3. `test:ai-live` and a 10-document labeled extraction measurement were run today on the configured provider (see TEST_EXECUTION_REPORT.md section 7). Still to do: measure accuracy, with the bank's chosen provider, on a labeled set of **real, authorized** documents (scans, varied layouts, mistakes), and re-run the end-to-end scrutiny live.
4. Bank sign-off of each `EXT-*` rule; written confirmation of UN HS file terms and feed licenses; supply and approve the Pakistan Customs Tariff dataset.
5. Confirm the upload rule added in AUDIT-005 (a PDF must contain `%%EOF`; all 116 sample PDFs do) and add malware scanning in front of the document store.
6. Add the committed branch to CI so `typecheck`, `lint`, `npm test`, `ng test`, `ng build` run on every change, and keep `test:probe` as a nightly job.
7. Run one backup-and-restore drill and one failover test of the document store.
8. **Commit the work.** Roughly 200 files of this system exist only as uncommitted changes on the working tree; until they are committed and pushed, a disk failure loses them.
