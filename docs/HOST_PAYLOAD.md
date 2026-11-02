# Host payload: the approved request as a PDF for the host system

When the pre-shipment trade officer clicks **Approve the request**, the platform makes one PDF holding the whole case, stores
it in the database, and gives it a link the host system can open. **Send to host** then creates the TI reference, issues the
copy of the PDF that carries it, and records the delivery.

## What happens, step by step

| Step | Who / when | What the platform does | Saved where |
|---|---|---|---|
| 1. Approve | Trade maker clicks *Approve the request* (reason required) | Approval is recorded and the case becomes *Authorized for issuance*. The payload PDF is made **in the same request**: if it cannot be made the approval stands and the card offers *Generate the payload PDF*. | `trade_cases` (meta + audit entry `HOST_PAYLOAD_GENERATED`), `host_payloads` (PDF bytes, token) |
| 2. Look | Maker, auditor (read only) | The **Host payload** card shows the link, the PDF fingerprint, who made it, and how often the host opened it. *Open*, *Download* (audited) and *Copy link*. | |
| 3. Send to host | Maker clicks *Send to host* | Creates the **TI reference** `TI-<year>-<6 digits>` once (audit `HOST_REFERENCE_CREATED`), makes version 2 of the PDF that carries it (`HOST_PAYLOAD_ISSUED_WITH_REFERENCE`), then hands the link to the host (`HOST_PAYLOAD_SENT`, or `HOST_PAYLOAD_SEND_FAILED`). | `trade_cases`, `host_payloads`, `host_payload_counters` |
| 4. Host opens | The host, from the link, with no bank sign-in | Serves the latest PDF and records the open. | `host_payloads` (count, last 50 opens as hashed caller) |
| 5. Send again | Maker | Never makes a second TI reference or a new version; records another delivery. | `trade_cases` |

Every step is an entry in the case's hash-chained audit trail, so the Audit Explorer shows who did what and when.

## What the PDF contains (3 pages for a typical case)

Header band with the case number, the parties, a status pill, and two references: the **case reference** (the one number used for the PDF, the link and the file name) and the host's **TI reference** or
"Assigned when sent to the host". No other reference number (no PSR- or HP- number) appears in the document. A panel with **the link** (clickable, written in full). Summary tiles
(amount, goods, payment, latest shipment). Then: approval decision (who, when, the reason), parties, credit terms, goods and
shipment, every document with its SHA-256 fingerprint, the AI scrutiny result and every finding with how it was settled,
sanctions screening and checks against official sources (stating what was *not* checked), customer messages, the status history,
and an integrity block (a SHA-256 over the data in the document and the case's audit-trail position). Every page has a footer with
the case, the payload, the fingerprint and "page n of m".

The PDF is drawn from one data structure (`host-payload-model.ts`) so what it says can be tested; the test reads the text back
out of the PDF itself.

## The link and the host page

`<PUBLIC_BASE_URL>/api/host-payloads/<caseNumber>/<token>`

Clicking it (the TI officer, or anyone at the bank using **Open the host page** on the card) opens a page, with no sign-in:

* the **case reference** and the **TI reference** at the top;
* **the client and the credit**: applicant, customer reference, beneficiary, amount, goods, HS code, who approved and when;
* **the payload PDF**: *View PDF* / *Download PDF* (with its version, size and SHA-256);
* **the client's pre-shipment documents**: a table of every document the client sent with the request (type, file name, version,
  when received, size, SHA-256), each with **View** (PDFs open in the browser) and **Download** (saved under its own name). A
  document that was replaced by a newer version stays in the list, marked; a document the client added but has not yet sent to the
  bank is not shown. Other file kinds (Word) are download-only.

The host's choice of document is free: nothing is selected for them. The file served is the stored original, byte for byte (the
test compares its SHA-256 with the one recorded at upload).

| URL | Gives |
|---|---|
| `…/<caseNumber>/<token>` | the page |
| `…/<caseNumber>/<token>/documents/<linkId>` (`?download=1`) | one pre-shipment document of that case |
| `…/<caseNumber>/<token>/<caseId>-host-payload.pdf` (`?download=1`) | the payload PDF |

* The **token** is 256 random bits, stored only in the host payload store, compared in constant time. It is the credential: anyone
  holding the link can read the PDF **and the client's documents**. It is never put in a case view, the audit log or the case
  record. An unknown case and a wrong token get the same 404; a document id that is not a pre-shipment document of that case is
  a 404. The routes are rate limited (60/min per address) and reach nothing else of the case.
* The page is plain HTML: no script, no external file, one inline style allowed by a one-time nonce
  (`default-src 'none'; style-src 'nonce-…'`), every value from the case escaped. Responses are `no-store` and `noindex`.
* **Every opening is recorded**: the page, the payload PDF, and each document by file name (with a short hash of the caller, not
  the address). The officer's card shows "What the host opened".
* The PDF's first page says what the link opens ("private to the host: do not share it. Every opening is recorded").
* The link is stable: version 2 (with the TI reference) is served from the same link.

**Set `PUBLIC_BASE_URL`** to the address the *host* uses to reach this API. Without it the link says `http://localhost:<port>`,
which only works on one machine; the card shows a warning until it is set. The link is written inside the PDF at the moment the
PDF is made, so set it before approving real cases.

## Sending: what is real and what is not

There is no specification of the bank's host (TI) interface in this project, so the delivery is deliberately simple and honest:

* **`HOST_DELIVERY_URL` set:** the details and the link are `POST`ed as JSON to that address (with `Authorization: Bearer
  <HOST_DELIVERY_TOKEN>` if set, `Idempotency-Key: <TI reference>`, 10 s timeout, redirects refused). The body carries
  `tiReference, caseId, payloadUrl (the page), pdfUrl, sha256, sizeBytes, version, generatedAt, approvedAt,
  applicant, beneficiary, currency, amount`. The PDF itself is not pushed: the host fetches it from `pdfUrl`, or opens `payloadUrl`. A 2xx answer is
  *Sent to host*; anything else, or an outage, is *Send failed* with the reason, and **the TI reference is kept** so the send can
  be repeated.
* **`HOST_DELIVERY_URL` empty (the default):** nothing is posted, and the screen and the record say so ("Nothing was posted"):
  the TI reference is created and the payload and its link are recorded for the host to open. The platform never claims a
  delivery it did not make.

To connect the real host, shape the body or add a message format in `deliverToHost` (`host-payload.service.ts`); the rest does not
change.

## The TI reference

`TI-<year>-<NNNNNN>` (for example `TI-2026-000007`), from a counter per year in the database (atomic: 25 parallel requests give 25
different numbers). `HOST_TI_PREFIX` changes the prefix. It is created **once per case**, before the delivery is attempted, so a
failed or repeated send never makes a second one. Numbers are not reused; a number can be skipped only if the database fails at the
moment of creation. **The format is my choice, not the bank's**: if the host assigns its own references or needs another format,
say so and the creation step is the one place to change.

## API

| Call | Permission | Does |
|---|---|---|
| `GET /api/trade-cases/:id/host-payload` | `tradecase.hostpayload.view` | Status, link, versions, TI reference, deliveries, opens; `canSend`; whether an endpoint and a public address are configured |
| `GET /api/trade-cases/:id/host-payload/pdf` | `tradecase.hostpayload.view` | The stored PDF (latest version); audited (`HOST_PAYLOAD_DOWNLOADED`) |
| `POST /api/trade-cases/:id/host-payload` | `tradecase.hostpayload.send` | Make the payload when missing (idempotent) |
| `POST /api/trade-cases/:id/host-payload/send` | `tradecase.hostpayload.send` | Create the TI reference (once), issue the PDF that carries it, deliver |
| `GET /api/host-payloads/:caseNumber/:token` | none: the token | The host page: references, client, payload and the client's pre-shipment documents |
| `GET /api/host-payloads/:caseNumber/:token/documents/:linkId` | none: the token | One pre-shipment document of that case; `?download=1` saves it |
| `GET /api/host-payloads/:caseNumber/:token/:filename` | none: the token | The payload PDF; `?download=1` saves it |

## Where it is saved

* `trade_cases.hostPayload`: status, versions (fingerprint, size), the TI reference, every delivery attempt.
* `host_payloads` (own collection): the PDF of every version (BSON binary), the link token, open count and the last 50 opens. One
  record per case (unique index). The case document never carries PDF bytes.
* `host_payload_counters`: the TI counter per year.
* `trade_case_events`: the audit entries above.

## Who can do what

| Permission | Holders | Allows |
|---|---|---|
| `tradecase.hostpayload.view` | Trade maker, all-desks officer, auditor | See the card, the link, download the PDF (audited) |
| `tradecase.hostpayload.send` | Trade maker, all-desks officer | Send to host, generate when missing |

The customer, relationship manager, administrators and every other role get 403 and never see `hostPayload` in a case.

## Tests

`npm run test:host-payload` (12 scenarios): the PDF made at approval and its text read back; the link serves exactly the stored
bytes and nothing for a wrong, unknown or malformed token; opens are counted; TI reference format, once only, next case gets the
next number; second send changes nothing; audit chain verifies; roles; delivery to an endpoint (header, body, no PDF or token in
the body, no redirects), refusal and outage; failed send keeps the reference and the retry succeeds; a case approved before this
existed can have its payload made; a retired link gives nothing and generating again makes a new token with the TI reference kept. `npm run test:mongo` (M10) proves the Mongo driver on a real server. The frontend card has a
spec (`host-payload-card.spec.ts`). The route/role probe and RBAC suites list the one public route explicitly.

## Not done

* The real host interface (message format, authentication, acknowledgment and status callbacks). The delivery above is a
  generic JSON post.
* Expiry of the link, and a one-time-use link. The token does not expire. **To retire a leaked link**, delete that payload's
  record in the `host_payloads` collection: the old link then gives 404, the case's card offers *Generate the payload PDF*, and
  generating makes a new token and a new version that keeps the same TI reference (there is no button for the deletion, on purpose).
* A host-side "received" acknowledgment shown on the card (only the platform's own open count is shown).
* Payloads for post-shipment stages: this is the pre-shipment approval payload only.
