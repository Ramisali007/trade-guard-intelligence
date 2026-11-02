import type { HostPortalData } from './host-payload-model';

/**
 * The page the host opens from the link: the case reference and TI reference, the client and the credit, the payload PDF,
 * and the client's pre-shipment documents, each to view or download. Plain server-rendered HTML with one inline style
 * (allowed by a nonce) and no script and no external resource, so it works in any browser and a policy of "nothing but
 * this style" can be enforced. Every value that comes from the case is escaped.
 */

export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const human = (v: string): string => v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()).replace(/\blc\b/gi, 'LC');
const size = (n: number | null): string => (n === null ? '-' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const money = (n: number | null, currency: string): string => (n === null ? '-' : `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim());
const when = (iso: string | null): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? escapeHtml(iso) : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
};

export interface HostPageInput {
  data: HostPortalData;
  /** Where the page's own files are: `<api>/host-payloads/<case>/<token>` (no trailing slash). */
  basePath: string;
  payload: { filename: string; sizeBytes: number; sha256: string; version: number; generatedAt: string };
  nonce: string;
}

/** A file a browser can show itself; anything else is offered as a download only. */
const viewable = (mime: string): boolean => mime === 'application/pdf';

const STYLE = `
:root{--navy:#0b1b3a;--teal:#007575;--bright:#14b8b8;--tint:#e6f6f6;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--stripe:#f8fafc}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);background:#f1f5f9;line-height:1.5}
header{background:var(--navy);color:#fff;border-bottom:3px solid var(--bright);padding:28px 24px 30px}
.wrap{max-width:1040px;margin:0 auto}
.brand{font-weight:800;font-size:1.05rem}.brand b{color:var(--bright)}
.kicker{font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:#94a3b8;font-weight:700;margin-top:2px}
h1{font-size:2.1rem;margin:14px 0 2px;letter-spacing:.01em}
.sub{color:#cbd5e1;font-size:.95rem}
.refs{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px}
.ref{background:rgba(255,255,255,.08);border-left:3px solid var(--bright);border-radius:8px;padding:10px 16px;min-width:230px}
.ref span{display:block;font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;font-weight:700}
.ref strong{font-size:1.1rem;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.ref.ti{background:var(--tint);border-left-color:var(--teal);color:var(--ink)}.ref.ti span{color:var(--muted)}.ref.ti strong{color:var(--teal)}
main{padding:22px 24px 48px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin-bottom:18px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
h2{font-size:1.05rem;margin:0 0 4px}.note{color:var(--muted);font-size:.88rem;margin:0 0 14px}.note.flush{margin:0}
dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px 22px;margin:0}
dt{font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700}dd{margin:2px 0 0;font-weight:600;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th{background:var(--navy);color:#fff;text-align:left;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;padding:9px 10px}
td{padding:11px 10px;border-bottom:1px solid var(--line);vertical-align:top}tr:nth-child(even) td{background:var(--stripe)}
.file{font-weight:600;overflow-wrap:anywhere}.hash{font-family:ui-monospace,Consolas,monospace;font-size:.72rem;color:var(--muted);overflow-wrap:anywhere}
.tag{display:inline-block;font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:99px;background:#fffbeb;color:#92400e;margin-left:6px}
.actions{display:flex;gap:8px;flex-wrap:wrap}
a.btn{display:inline-block;text-decoration:none;font-weight:700;font-size:.82rem;padding:7px 14px;border-radius:8px;border:1px solid var(--teal);color:var(--teal);background:#fff}
a.btn.primary{background:var(--teal);color:#fff}
a.btn:hover,a.btn:focus-visible{outline:2px solid var(--bright);outline-offset:2px}
.pdf{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
footer{color:var(--muted);font-size:.8rem;text-align:center;padding:0 24px 30px}
@media(max-width:720px){h1{font-size:1.6rem}th:nth-child(4),td:nth-child(4),th:nth-child(5),td:nth-child(5){display:none}}
`;

export function renderHostPage({ data, basePath, payload, nonce }: HostPageInput): string {
  const base = escapeHtml(basePath);
  const current = data.documents.filter((d) => d.current);
  const rows = data.documents
    .map((d) => {
      const file = `${base}/documents/${encodeURIComponent(d.linkId)}`;
      return `<tr>
  <td>${escapeHtml(human(d.type))}${d.current ? '' : '<span class="tag">Replaced by a newer version</span>'}</td>
  <td><div class="file">${escapeHtml(d.filename)}</div><div class="hash">SHA-256 ${escapeHtml(d.sha256 ? d.sha256.slice(0, 32) + '...' : '-')}</div></td>
  <td>v${d.version}</td>
  <td>${when(d.uploadedAt)}<br><span class="note">${escapeHtml(d.uploadedBy)}</span></td>
  <td>${size(d.sizeBytes)}</td>
  <td><div class="actions">${viewable(d.mimeType) ? `<a class="btn primary" href="${file}" target="_blank" rel="noopener noreferrer">View</a>` : ''}<a class="btn" href="${file}?download=1">Download</a></div></td>
</tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(data.caseId)} - pre-shipment documents</title>
<style nonce="${escapeHtml(nonce)}">${STYLE}</style>
</head>
<body>
<header><div class="wrap">
  <div class="brand">tradeguard<b>.ai</b></div>
  <div class="kicker">Host payload &nbsp;|&nbsp; Pre-shipment approval</div>
  <h1>${escapeHtml(data.caseId)}</h1>
  <div class="sub">${escapeHtml(data.applicant)} &rarr; ${escapeHtml(data.beneficiary)}</div>
  <div class="refs">
    <div class="ref"><span>Case reference</span><strong>${escapeHtml(data.caseId)}</strong></div>
    <div class="ref ti"><span>TI reference</span><strong>${data.tiReference ? escapeHtml(data.tiReference) : 'Not assigned yet'}</strong></div>
  </div>
</div></header>
<main><div class="wrap">
  <section class="card" aria-labelledby="client">
    <h2 id="client">The client and the credit</h2>
    <p class="note">Approved by the trade desk${data.approvedBy ? ` (${escapeHtml(data.approvedBy)})` : ''} on ${when(data.approvedAt)}.</p>
    <dl>
      <div><dt>Applicant (client)</dt><dd>${escapeHtml(data.applicant)}</dd></div>
      <div><dt>Customer reference</dt><dd>${escapeHtml(data.customerRef)}</dd></div>
      <div><dt>Beneficiary</dt><dd>${escapeHtml(data.beneficiary)}</dd></div>
      <div><dt>Amount</dt><dd>${escapeHtml(money(data.amount, data.currency))}</dd></div>
      <div><dt>Goods</dt><dd>${escapeHtml(data.goods || '-')}</dd></div>
      <div><dt>HS code</dt><dd>${escapeHtml(data.hsCode || '-')}</dd></div>
    </dl>
  </section>

  <section class="card pdf" aria-labelledby="payload">
    <div>
      <h2 id="payload">Payload PDF</h2>
      <p class="note flush">The whole case in one document: terms, documents, scrutiny, findings, approval and history. Version ${payload.version}, ${size(payload.sizeBytes)}, made ${when(payload.generatedAt)}.<br>SHA-256 <span class="hash">${escapeHtml(payload.sha256)}</span></p>
    </div>
    <div class="actions">
      <a class="btn primary" href="${base}/${encodeURIComponent(payload.filename)}" target="_blank" rel="noopener noreferrer">View PDF</a>
      <a class="btn" href="${base}/${encodeURIComponent(payload.filename)}?download=1">Download PDF</a>
    </div>
  </section>

  <section class="card" aria-labelledby="docs">
    <h2 id="docs">The client's pre-shipment documents (${current.length})</h2>
    <p class="note">These are the documents ${escapeHtml(data.applicant)} sent with this request, as the bank scrutinized them. Choose any one to view it or download it.</p>
    ${data.documents.length === 0 ? '<p class="note">No pre-shipment documents are on this request.</p>' : `<table>
<thead><tr><th>Document</th><th>File</th><th>Ver.</th><th>Received</th><th>Size</th><th>Open</th></tr></thead>
<tbody>
${rows}
</tbody></table>`}
  </section>
</div></main>
<footer>Private to the host. Every opening of this page, the payload and each document is recorded by the bank.</footer>
</body>
</html>
`;
}
