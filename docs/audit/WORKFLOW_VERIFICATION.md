# Workflow verification — Pre-Shipment to Post-Shipment (2026-10-27)

Everything here ran on synthetic data in an **isolated in-memory stack** (API on `127.0.0.1:4100`, Angular dev server on `4300`, local heuristic AI, no network sources). The user's own servers on `4000`/`4200` and their MongoDB data were not touched. Status words: PASS, FAIL, BLOCKED, NOT TESTED, NOT APPLICABLE.

## How the lifecycle was exercised

| Layer | What ran | Where it is |
|---|---|---|
| Service/state machine | Scenarios A–U of the lifecycle suite (39 cases, chained audit events) | `backend/src/__tests__/trade-lifecycle.test.ts` |
| HTTP, as each role | Post-shipment endpoints P1–P5 (+ new P3b) | `post-shipment-http.test.ts` |
| Real browser | Client and officer journey J1–J19 (below) | scratchpad script, evidence in this report |
| Persistence | Same lifecycle stores against a real MongoDB in a throw-away database (M1–M9) | `mongo-live.test.ts` |
| Approved set | Seeded as the approval would leave it (`AUTHORIZED_FOR_ISSUANCE` + `TC-<year>-<seq>` reference). Approval itself was **not** repeated in the browser this session; it is covered by lifecycle Scenarios J/K/U and was browser-verified with the real AI model on 2026-10-26 (see `docs/POST_SHIPMENT_REPORT.md`). | |

## A. Pre-Shipment

| # | Behavior | Evidence | Status |
|---|---|---|---|
| A1 | Customer creates a request, uploads several documents, sends, and the maker scrutinizes, raises one mail for all fixable issues, customer replies with a corrected document (old one ignored), maker resolves and approves in one step | Scenarios I, J, K | PASS |
| A2 | Discrepancy → clarification → correction → re-submission, document versioning | Scenarios B, I, K | PASS |
| A3 | Approval persists; approved case keeps a unique reference | Scenario U (`TC-2026-00039`), M3 (numbering atomic under 25 parallel requests, creation idempotent under 8 parallel duplicates) | PASS |
| A4 | Rejection / withdrawal / cancellation paths | Scenarios D, H, lifecycle isolation block | PASS |
| A5 | Document added after sending waits for "Send to bank" and blocks approval until sent; identical file refused | Scenario T | PASS |
| A6 | Identical files uploaded **concurrently** are stored once | **AUDIT-001** — failed before the fix (3 stored), passes after (P3b, live probe D8) | PASS (after fix) |
| A7 | Real-AI scrutiny quality | Live extraction check and a 10-document labeled measurement were run later the same day (72/72 on clean synthetic documents; TEST_EXECUTION_REPORT.md section 7). The end-to-end scrutiny (per-document review, comparison, mail) was not re-run live today. Last verified live on 2026-10-26 according to `docs/POST_SHIPMENT_REPORT.md` and `docs/EXTERNAL_VERIFICATION_PHASE2_REPORT.md`; not independently re-verified today. | NOT TESTED today |

## B. Hand-off to Post-Shipment

| # | Behavior | Evidence | Status |
|---|---|---|---|
| B1 | Only the owning customer's **approved** requests are listed, by reference; a draft is not | P1; browser J1 (customer 1 sees `TC-2026-00001`, never `TC-2026-00002`) | PASS |
| B2 | Staff and the administrator are refused the client list (403) | P1 over all 17 accounts | PASS |
| B3 | Starting an application on an unapproved case → 409; on another customer's case → 404; by any staff role → 403 | P2; `doc-security` D3 | PASS |
| B4 | Clicking the reference opens that case's application | browser J2 (`/post-shipment/TC-2026-00001`) | PASS |
| B5 | Duplicate application is not created: six concurrent starts yield one draft | `doc-security` D7 | PASS |
| B6 | Other customer opening the LC by URL sees no data | browser J11 | PASS |

## C. Post-Shipment submission (client)

| # | Behavior | Evidence | Status |
|---|---|---|---|
| C1 | Start → draft with an upload control | browser J3 | PASS |
| C2 | Multi-file selection, type preset per file name, type editable, upload | browser J5, J6 (3 documents listed) | PASS |
| C3 | Executable disguised as `.pdf` refused with a visible message, API 415 | browser J4/J4b; API D4 | PASS |
| C4 | Other bad inputs refused 4xx without stack traces or paths: wrong extension, MIME spoof, `.pdf.exe`, `.html`, `.svg` with script, empty (422), null byte (400), fake DOCX (zip stub), 51 MB (413) | `doc-security` D4/D5 | PASS |
| C5 | Same file twice refused with the file's name | browser J7 | PASS |
| C6 | Submit asks to confirm; "Not yet" cancels; confirm submits; upload control then disappears (corrections only) | browser J8–J9b | PASS |
| C7 | Required document cannot be skipped (`409`, names `BILL_OF_LADING`) | P3; D9 | PASS |
| C8 | Path-traversal file names never write outside the store | D4/D4b | PASS |
| C9 | Truncated 9-byte `%PDF-1.7` stub, or a PDF cut in half, is refused (422 `CORRUPT_FILE`); a complete PDF with trailing bytes is accepted | AUDIT-005; `post-shipment-http` P3c | PASS (after fix; was FAIL in the first pass) |
| C10 | Download is byte-identical (SHA-256) with `Cache-Control: private, no-store`, `nosniff`, attachment disposition | D2/D2b | PASS |

## D. Officer scrutiny

| # | Behavior | Evidence | Status |
|---|---|---|---|
| D1 | Submitted case appears in the officer's list/queue; the draft was invisible to the bank before submit | browser J12; P3/P4 | PASS |
| D2 | Examination screen shows the three documents; "Run the examination" returns a result against the approved set | browser J13–J14 | PASS |
| D3 | Officer records a blocking finding; it appears | browser J15 | PASS |
| D4 | **Accepting with a blocking finding open is refused**, the UI says discrepancies without waiver cannot be accepted, and the persisted status stays `DOCUMENT_EXAMINATION` with no decision recorded | browser J16/J16b; API P5 (409) | PASS |
| D5 | Clarification reaches the client; the client sees the request and the bank's points, but no TBML/compliance/internal wording | browser J17/J19; P5 | PASS |
| D6 | Client cannot open the examination screen (403), cannot examine, ask, record findings or run the AI reading | P4, P5 | PASS |
| D7 | Hostile text inside a document is passed to the model as data, never into its instructions; no AI point can hold a case | P5 | PASS (stand-in model) |
| D8 | Missing-document, cross-document inconsistency rules (`EXM-XD-*`), waiver by the applicant, refusal with reason, re-application, acceptance | Scenario U; sample-flow test (E set → 4 blocking, F set clears) | PASS |
| D9 | Final decision records user, time, reason, chained audit | Scenario U (every step on one chain); audit tamper detection test | PASS |

## E. End-to-end persistence

| # | Behavior | Evidence | Status |
|---|---|---|---|
| E1 | One synthetic transaction keeps reference, statuses, document links and audit chain consistent through the stages | Scenario U | PASS |
| E2 | Cases, chains and accounts survive closing and re-opening the stores (MongoDB) | M5 | PASS |
| E3 | Altered, deleted or forged audit entries are detected | M6; hardening H-series; lifecycle "Audit" | PASS |
| E4 | Saved change whose audit write fails is reported (503) and flagged by verification | M7 | PASS, but not prevented — OBS-3 |
| E5 | Reload / sign out / sign in as another user and reopen by URL | 459 direct-URL page loads across 15 roles; sessions end on sign-out (D10) | PASS |
| E6 | Concurrent writers: stale revision refused, audit log cannot fork across two instances | M4; lifecycle "Concurrency" | PASS |

## F. Exceptional paths

| Path | Evidence | Status |
|---|---|---|
| Rejected application, refused once then re-applied | Scenario U | PASS |
| Missing documents | P3, D9 | PASS |
| AI unavailable / malformed / 429 / timeout | `ai-resilience` H1–H4; P5 (`ai-review` answers 503 with nothing guessed) | PASS |
| Failed AI analysis does not approve anything | H4, D7 | PASS |
| Awaiting clarification | Scenario U; browser J17/J19 | PASS |
| Live-model inference for post-shipment documents | not run | NOT TESTED |
| Real SWIFT / customs / Form-E, client notifications | not integrated (documented in `docs/POST_SHIPMENT_REPORT.md`) | NOT APPLICABLE today |

## Browser journey log (J-series)

30 steps were scripted. First run: 26 passed; the four non-passes were examined and are not product defects — J2 (script clicked the table row instead of the link, re-run passed), J10 (the browser logs the two *expected* 415/409 refusals as console errors; the API-level check J10b confirms they were the only failures), J16 (script looked for a `<textarea>`; the reason box is an `<input>`, re-run passed), J19b (the client is *meant* to see the bank's points; TBML and internal wording were absent). Screenshots from the run are in the audit scratch directory and were not committed.
