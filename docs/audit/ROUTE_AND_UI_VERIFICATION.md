# Route and UI verification — 2026-10-27

Real Chrome (headless, puppeteer-core) against an isolated stack: Angular dev server `127.0.0.1:4300` proxying to an in-memory API on `4100` seeded with synthetic cases (`TC-2026-00001` and `-00002` approved for customers 1 and 2, `-00003` a customer-1 draft). The user's own servers were not used. Sessions were injected into `localStorage` after a real `POST /auth/demo-login`, so the guards, token and permission list are the real ones.

## 1. Route inventory (`frontend/src/app/app.routes.ts`: 25 entries)

| Route | Screen | Guard (`anyOf`) | Tested as |
|---|---|---|---|
| `/` | Landing | public | 15 roles |
| `/dashboard` | Document dashboard | `documents.read` | 15 roles |
| `/analytics` | Analytics | `analytics.read` | 15 roles |
| `/processing/:id` | Processing progress | `documents.read` | 15 roles, id `doc-x` (invalid) |
| `/analysis/:id` | Analysis / compliance report | `documents.read` | 15 roles, id `doc-x` (invalid) |
| `/compare` | Comparison | `documents.read` | 15 roles |
| `/auditor` | Regulatory auditor | `documents.read` | 15 roles |
| `/sources` | Sources health | `compliance.sources.read` | 15 roles |
| `/customers` | Customer 360 | `customers360.read` | 15 roles |
| `/import` | Import center | `masterdata.read` | 15 roles |
| `/verification` | Verification governance | `tradecase.verification.view` | 15 roles |
| `/trade-cases` | Trade case list | any case-view permission | 15 roles |
| `/trade-cases/new` | New request | `tradecase.create` | 15 roles |
| `/post-shipment` | Client post-shipment list | `tradecase.postshipment.apply` | 15 roles |
| `/post-shipment/:id` | Client application | `tradecase.postshipment.apply` | 15 roles, own case; other customer's case |
| `/trade-cases/:id/post-shipment` | Officer examination | `tradecase.findings.internal.view` | 15 roles |
| `/trade-cases/:id/scrutiny` | Pre-shipment scrutiny | revalidate / review / audit permissions | 15 roles |
| `/trade-cases/:id` | Case workspace | any case-view permission | 15 roles; own, other customer's, missing id |
| `/workspace` | My workspace | any signed-in user | 15 roles |
| `/audit` | Audit explorer | `audit.overview` | 15 roles |
| `/admin` | Administration | admin view permissions | 15 roles |
| `/access-denied` | Denied page | public | 15 roles |
| `/blog/:id`, `/blogs/:id` (redirect) | Article | public | 15 roles |
| `**` | → `/` | — | 15 roles |

27 concrete URLs × 15 roles = **459 direct-URL page loads: 459 PASS, 0 FAIL.** "Direct navigation" is a full page load with the session restored from storage, so it is also the refresh test. Every route in the file is accounted for; none was skipped.

Results by role are in [ROLE_PERMISSION_MATRIX.md](ROLE_PERMISSION_MATRIX.md). The 35 console errors seen in that run were all browser reports of API refusals to *deliberately invalid* requests: `GET /documents/doc-x` family → 400 (the defect AUDIT-002, now fixed), and `GET /trade-cases/<missing or other customer's>` → 404 (correct, and the screen says "That trade case could not be found").

## 2. Edge states, as a user sees them

| Case | What the screen shows | Status |
|---|---|---|
| Other customer's case id | "That trade case could not be found. It may have been deleted." (same text as a nonexistent id: no existence leak) | PASS |
| Role without access | `/access-denied`: "Not available for your role — Corporate Customer does not have access to /dashboard … ask your administrator to raise an access request; a second administrator has to approve it" + "Go to my workspace" | PASS |
| Unknown path | Redirect to the landing page | PASS (a dedicated 404 screen does not exist: NOT APPLICABLE by design) |
| `/processing/doc-x` (API 400) | Before: "Analyzing Your Document 0%" for ever. After fix: alert card + link to dashboard | FAIL → FIXED (AUDIT-002); covered by a unit spec; not re-screenshotted in the browser after the fix |
| `/analysis/doc-x` | Before: blank page. After fix: "This analysis could not be opened" + Try again | FAIL → FIXED (AUDIT-002), unit spec only |
| Analysis page wrapper | `class="lage …"`, `dsize]` typos | FAIL → FIXED (AUDIT-003) |

## 3. Interactive-control inventory

Counted from the templates (inline and `.html`): **394 `<button>`, 114 internal/external links, 143 inputs/selects/textareas, 494 `(click)` bindings, 11 forms** (the `<form>`/`ngSubmit` count). These are template counts; a control inside an `@for` is one entry but many on screen.

| Method | Scope | Result |
|---|---|---|
| Click crawler: every visible, enabled button and internal link on each screen, per owning role (CCO, maker, customer, all-desks officer, administrator, auditor, RM) | 32 screen/role pairs; **457 distinct controls found, 385 clicked** (72 were disabled at the time or disappeared once an earlier click changed the screen) | **0 uncaught page exceptions, 0 × 5xx responses** |
| Scripted business journey (client → officer), J1–J19 | 30 assertions | 30 PASS after re-running 3 steps with corrected selectors (see WORKFLOW_VERIFICATION.md) |
| Angular unit specs | 37 (35 existing + 2 new) | 37 PASS |

What the crawler does **not** prove: it clicks with empty or default input, so it shows a control does not crash or hit a server error; it does not show that each control performs the right business action. That is proven only for the controls on the post-shipment journey (start, choose files, set type, remove selection, upload, duplicate refusal, submit/confirm/"Not yet", run examination, add finding, record decision, send clarification, open link by reference) and for those exercised through the HTTP lifecycle suites. Per-control status for the rest is therefore **"clicked, no error" (PASS-weak)**, not "business action verified".

## 4. Form validation (verified)

| Form | Check | Status |
|---|---|---|
| Upload (client, post-shipment) | wrong kind/extension/MIME, executable disguised as PDF, empty, 51 MB, duplicate, null byte in name — each refused with a visible message; selection can be cleared (✕); UI and API agree on 415/409/422/413 | PASS |
| Decision reason | button disabled until ≥10 characters; server also validates (400) | PASS |
| Clarification / finding | disabled until ≥10 / ≥5+10 characters; API enforces the same (P5) | PASS |
| Submit | confirmation step; required-document check server side (409 naming the missing type) | PASS |
| Login | 10 attempts a minute per address then 429; locks after repeated failure per account | PASS |
| New-request form, admin forms, import center, master-data forms | field-level boundary/format validation not driven through the browser | NOT TESTED in browser (server rules covered by `import.test.ts`, `rbac-portals` R4, `compliance-correctness`) |

## 5. Not verified

- Scroll restoration, and the deep-link *after* sign-in (that the signed-out redirect to `/?returnUrl=…` and the sign-in dialog work was verified; completing a sign-in and landing on the original URL was not driven).
- Print styles, keyboard-only and screen-reader use. (The unit specs assert some `aria-label`s and `role="alert"`.) Phone (390 px) and tablet (768 px) width were checked on 23 screens: no horizontal page overflow, which detects page-level scrolling only, not text clipped inside a container.
- Idle auto-lock after 15 minutes (`IDLE_LIMIT_MS`) — not waited out.
- File download buttons in the browser (the API download was verified byte-for-byte, D2).
- Network-failure recovery in the UI (API-offline behavior not simulated).

## 6. Second pass (same day)

| Check | Result |
|---|---|
| Back, forward, refresh: workspace → list → case → back → back → forward → reload | 5 of 5 PASS; route and session preserved |
| Signed-out visit to `/trade-cases/TC-2026-00001` | PASS: lands on `/?returnUrl=%2Ftrade-cases%2FTC-2026-00001` and opens the sign-in dialog |
| Forged client-side session (fake token, admin role, admin permissions in `localStorage`) opening `/admin` | PASS: refused (the session is validated against the server, not trusted from storage) |
| `/processing/doc-x` and `/analysis/doc-x` after AUDIT-002 | PASS in a real browser: "This document's progress cannot be shown" and "This analysis could not be opened" |
| Phone/tablet width, 46 checks (23 screens × 390 and 768 px) | 0 horizontal page overflows |
