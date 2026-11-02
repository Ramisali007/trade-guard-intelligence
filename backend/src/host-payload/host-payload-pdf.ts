import PDFDocument from 'pdfkit';
import type { HostPayloadModel } from './host-payload-model';

/**
 * Draws the host payload. A4, one navy header band, a teal link panel, summary tiles, then sections and tables that
 * wrap and break across pages with their header row repeated, and a footer on every page with the case, the payload,
 * the fingerprint and "page n of m". Only the standard PDF fonts are used, so no font file is needed.
 */

const C = {
  navy: '#0b1b3a',
  navyDeep: '#071329',
  teal: '#007575',
  tealBright: '#14b8b8',
  tealTint: '#e6f6f6',
  ink: '#0f172a',
  body: '#1e293b',
  muted: '#64748b',
  line: '#e2e8f0',
  stripe: '#f8fafc',
  white: '#ffffff',
  good: '#047857',
  goodTint: '#ecfdf5',
  warn: '#b45309',
  warnTint: '#fffbeb',
  bad: '#b91c1c',
  badTint: '#fef2f2',
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;
const INNER = PAGE_W - 2 * M;
const FOOTER_Y = PAGE_H - 30;
const BOTTOM = PAGE_H - 52;

/** The standard fonts cover Western European text. Anything else would print as the wrong glyph, so it is shown as a question mark. */
function clean(value: unknown): string {
  const s = String(value ?? '')
    .replace(/[→➔]/g, '->')
    .replace(/…/g, '...')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[−]/g, '-')
    .replace(/ /g, ' ');
  // Keep printable Latin-1 plus the WinAnsi extras the fonts have (en/em dash, bullet, euro).
  return [...s].map((ch) => (/[\n -~¡-ÿ–—•€]/.test(ch) ? ch : ch === '\t' ? ' ' : '?')).join('');
}

const money = (n: number | null | undefined, currency = ''): string =>
  n === null || n === undefined ? '-' : `${currency ? currency + ' ' : ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number | null | undefined): string => (n === null || n === undefined ? '-' : n.toLocaleString('en-US', { maximumFractionDigits: 4 }));
const when = (iso: string | null | undefined): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? clean(iso) : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
};
const day = (iso: string | null | undefined): string => (iso ? clean(iso).slice(0, 10) : '-');
const dash = (v: unknown): string => (v === null || v === undefined || String(v).trim() === '' ? '-' : clean(v));
const human = (v: string): string => (v ? v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()).replace(/\blc\b/gi, 'LC').replace(/\bhs\b/gi, 'HS') : '-');
/** The screening dataset is a long " | " list of lists and notes; the first few say what was used, the rest stays in the case. */
const summariseLists = (value: string): string => {
  const parts = value.split(' | ').map((p) => p.trim()).filter(Boolean);
  return parts.length <= 3 ? value : `${parts.slice(0, 3).join(' | ')} (and ${parts.length - 3} more, recorded in the case)`;
};
const kb = (n: number | null): string => (n === null ? '-' : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);

interface Column {
  title: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
}

export function renderHostPayloadPdf(model: HostPayloadModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: M,
      bufferPages: true,
      autoFirstPage: false,
      info: {
        Title: `Host payload ${model.caseId}`,
        Author: 'TradeGuard',
        Subject: `Pre-shipment approval payload ${model.caseId}${model.tiReference ? ' / ' + model.tiReference : ''}`,
        Keywords: [model.caseId, model.tiReference ?? ''].filter(Boolean).join(', '),
        CreationDate: new Date(model.generatedAt),
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = M;
    let firstPage = true;

    const newPage = () => {
      doc.addPage({ size: 'A4', margin: M });
      if (firstPage) {
        firstPage = false;
        y = drawCover();
      } else {
        // A slim running header on every later page.
        doc.rect(0, 0, PAGE_W, 34).fill(C.navy);
        doc.rect(0, 34, PAGE_W, 2).fill(C.tealBright);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white).text('tradeguard', M, 13, { continued: true }).fillColor(C.tealBright).text('.ai');
        doc.font('Helvetica').fontSize(8).fillColor('#cbd5e1').text(`${model.caseId}${model.tiReference ? '   |   ' + model.tiReference : ''}`, M, 14, { width: INNER, align: 'right' });
        y = 54;
      }
    };
    const room = (h: number) => {
      if (y + h > BOTTOM) newPage();
    };

    // ------------------------------------------------------------------ pieces
    const section = (title: string, note?: string) => {
      room(54);
      y += 10;
      doc.rect(M, y + 1, 3.5, 14).fill(C.teal);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(C.ink).text(clean(title), M + 11, y, { width: INNER - 11 });
      y += 20;
      if (note) {
        doc.font('Helvetica').fontSize(8.5).fillColor(C.muted);
        const h = doc.heightOfString(clean(note), { width: INNER });
        doc.text(clean(note), M, y, { width: INNER });
        y += h + 4;
      }
    };

    const paragraph = (text: string, opts: { color?: string; size?: number; bold?: boolean } = {}) => {
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size ?? 9.5);
      const t = clean(text);
      const h = doc.heightOfString(t, { width: INNER });
      room(h + 4);
      doc.fillColor(opts.color ?? C.body).text(t, M, y, { width: INNER });
      y += h + 4;
    };

    /** Label / value pairs in two columns. */
    const pairs = (rows: Array<[string, string]>) => {
      const colW = (INNER - 16) / 2;
      for (let i = 0; i < rows.length; i += 2) {
        const left = rows[i]!;
        const right = rows[i + 1];
        doc.font('Helvetica').fontSize(9.5);
        const hl = doc.heightOfString(clean(left[1]), { width: colW });
        const hr = right ? doc.heightOfString(clean(right[1]), { width: colW }) : 0;
        const h = Math.max(hl, hr) + 15;
        room(h + 4);
        const cell = (x: number, [label, value]: [string, string]) => {
          doc.font('Helvetica-Bold').fontSize(7).fillColor(C.muted).text(clean(label).toUpperCase(), x, y, { width: colW, characterSpacing: 0.6 });
          doc.font('Helvetica').fontSize(9.5).fillColor(C.body).text(clean(value), x, y + 11, { width: colW });
        };
        cell(M, left);
        if (right) cell(M + colW + 16, right);
        y += h + 2;
        doc.moveTo(M, y - 3).lineTo(M + INNER, y - 3).lineWidth(0.4).strokeColor(C.line).stroke();
      }
      y += 2;
    };

    const table = (cols: Column[], rows: string[][], emptyText: string) => {
      const pad = 5;
      const header = () => {
        room(30);
        doc.rect(M, y, INNER, 19).fill(C.navy);
        let x = M;
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.white);
        for (const col of cols) {
          doc.text(col.title.toUpperCase(), x + pad, y + 6, { width: col.width - 2 * pad, align: col.align ?? 'left', characterSpacing: 0.4 });
          x += col.width;
        }
        y += 19;
      };
      header();
      if (rows.length === 0) {
        doc.rect(M, y, INNER, 24).fill(C.stripe);
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.muted).text(clean(emptyText), M + pad, y + 8, { width: INNER - 2 * pad });
        y += 24;
        return;
      }
      rows.forEach((row, index) => {
        doc.font('Helvetica').fontSize(8.5);
        const heights = row.map((cell, i) => doc.heightOfString(clean(cell), { width: cols[i]!.width - 2 * pad }));
        const h = Math.max(...heights) + 10;
        if (y + h > BOTTOM) {
          newPage();
          header();
        }
        if (index % 2 === 1) doc.rect(M, y, INNER, h).fill(C.stripe);
        let x = M;
        row.forEach((cell, i) => {
          const col = cols[i]!;
          doc.font(col.mono ? 'Courier' : 'Helvetica').fontSize(col.mono ? 7.5 : 8.5).fillColor(C.body).text(clean(cell), x + pad, y + 5, { width: col.width - 2 * pad, align: col.align ?? 'left' });
          x += col.width;
        });
        doc.moveTo(M, y + h).lineTo(M + INNER, y + h).lineWidth(0.4).strokeColor(C.line).stroke();
        y += h;
      });
      y += 4;
    };

    const pill = (text: string, x: number, py: number, fg: string, bg: string): number => {
      doc.font('Helvetica-Bold').fontSize(8);
      const w = doc.widthOfString(clean(text).toUpperCase(), { characterSpacing: 0.6 }) + 18;
      doc.roundedRect(x, py, w, 18, 9).fill(bg);
      doc.fillColor(fg).text(clean(text).toUpperCase(), x + 9, py + 5.5, { characterSpacing: 0.6, lineBreak: false });
      return w;
    };

    // ------------------------------------------------------------------ first page
    const drawCover = (): number => {
      doc.rect(0, 0, PAGE_W, 168).fill(C.navy);
      doc.rect(0, 168, PAGE_W, 3).fill(C.tealBright);
      // a soft glow in the corner
      doc.save();
      doc.fillOpacity(0.18).circle(PAGE_W - 40, 20, 150).fill(C.tealBright);
      doc.restore();

      doc.font('Helvetica-Bold').fontSize(13).fillColor(C.white).text('tradeguard', M, 30, { continued: true }).fillColor(C.tealBright).text('.ai');
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#94a3b8').text('HOST PAYLOAD   |   PRE-SHIPMENT APPROVAL', M, 50, { characterSpacing: 1.4 });
      doc.font('Helvetica-Bold').fontSize(27).fillColor(C.white).text(clean(model.caseId), M, 74, { lineBreak: false });
      const app = model.application;
      const line = app ? `${app.applicant.name}  to  ${app.beneficiary.name}` : 'Import letter of credit';
      doc.font('Helvetica').fontSize(10.5).fillColor('#cbd5e1').text(clean(line), M, 112, { width: INNER - 150 });
      doc.font('Helvetica').fontSize(9).fillColor('#94a3b8').text(`Generated ${when(model.generatedAt)}  |  by ${clean(model.generatedBy)}`, M, 134, { width: INNER - 150 });
      pill('Approved', PAGE_W - M - 92, 36, C.good, C.goodTint);

      // reference chips
      let cy = 186;
      const chip = (label: string, value: string, x: number, w: number, accent: boolean) => {
        doc.roundedRect(x, cy, w, 44, 6).fill(accent ? C.tealTint : C.stripe);
        doc.rect(x, cy + 6, 2.5, 32).fill(accent ? C.teal : '#cbd5e1');
        doc.font('Helvetica-Bold').fontSize(6.8).fillColor(C.muted).text(label.toUpperCase(), x + 12, cy + 9, { characterSpacing: 0.6, width: w - 16 });
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(accent ? C.teal : C.ink).text(clean(value), x + 12, cy + 22, { width: w - 16 });
      };
      // Two references only: the case number, which every other number in this document shares, and the host's TI reference.
      const w2 = (INNER - 10) / 2;
      chip('Case reference', model.caseId, M, w2, false);
      chip('TI reference', model.tiReference ?? 'Assigned when sent to the host', M + w2 + 10, w2, Boolean(model.tiReference));
      cy += 56;

      // the link
      doc.font('Helvetica').fontSize(9.5);
      const linkH = 74;
      doc.roundedRect(M, cy, INNER, linkH, 8).fill(C.navy);
      doc.rect(M, cy + 10, 3.5, linkH - 20).fill(C.tealBright);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.tealBright).text("OPEN THE CLIENT'S DOCUMENTS AND THIS PAYLOAD", M + 16, cy + 11, { characterSpacing: 1 });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white).text(clean(model.url), M + 16, cy + 26, { width: INNER - 32, underline: true, link: model.url });
      const urlH = doc.heightOfString(clean(model.url), { width: INNER - 32 });
      doc.font('Helvetica').fontSize(7.8).fillColor('#94a3b8').text("The link opens a page with this payload and the client's pre-shipment documents: view or download any of them, no sign-in. Private to the host: do not share it. Every opening is recorded by the bank.", M + 16, cy + 28 + urlH, { width: INNER - 32 });
      cy += linkH + 12;

      // tiles
      const app2 = model.application;
      const tiles: Array<[string, string, string]> = [
        ['Amount', money(app2?.amount, app2?.currency ?? ''), model.amountInPkr ? `about PKR ${num(Math.round(model.amountInPkr))}` : ''],
        ['Goods', app2 ? `${num(app2.quantity)} ${clean(app2.unitOfMeasure)}` : '-', app2 ? `HS ${dash(app2.hsCode)}` : ''],
        ['Payment', app2 ? (app2.paymentTerms === 'USANCE' ? `Usance ${app2.usanceDays ?? ''} days` : app2.paymentTerms === 'SIGHT' ? 'At sight' : '-') : '-', app2 ? `${dash(app2.incoterm)} ${dash(app2.namedPlace)}` : ''],
        ['Latest shipment', day(app2?.latestShipmentDate), `expires ${day(app2?.expiryDate)}`],
      ];
      const tw = (INNER - 3 * 10) / 4;
      tiles.forEach(([label, value, sub], i) => {
        const x = M + i * (tw + 10);
        doc.roundedRect(x, cy, tw, 62, 8).lineWidth(0.8).strokeColor(C.line).fillAndStroke(C.white, C.line);
        doc.rect(x, cy + 10, 2.5, 42).fill(C.teal);
        doc.font('Helvetica-Bold').fontSize(6.8).fillColor(C.muted).text(label.toUpperCase(), x + 12, cy + 10, { characterSpacing: 0.6, width: tw - 16 });
        doc.font('Helvetica-Bold').fontSize(value.length > 16 ? 10 : 12.5).fillColor(C.ink).text(clean(value), x + 12, cy + 25, { width: tw - 16, lineBreak: false });
        doc.font('Helvetica').fontSize(7.8).fillColor(C.muted).text(clean(sub), x + 12, cy + 46, { width: tw - 16, lineBreak: false });
      });
      return cy + 62 + 4;
    };

    // ------------------------------------------------------------------ body
    newPage();
    const app = model.application;

    section('Approval decision', 'Approved by the trade desk after the pre-shipment scrutiny. The decision and its reason are recorded in the case audit trail.');
    if (model.decision) {
      pairs([
        ['Approved by', `${dash(model.decision.approvedBy)} (${dash(model.decision.approvedByRole)})`],
        ['Approved at', when(model.decision.approvedAt)],
        ['Decision', 'Approved'],
        ['Application version approved', `v${model.decision.applicationVersion} of ${model.applicationVersionsCount}`],
      ]);
      room(40);
      const t = clean(model.decision.rationale);
      doc.font('Helvetica-Oblique').fontSize(9.5);
      const h = doc.heightOfString(t, { width: INNER - 28 }) + 16;
      room(h + 6);
      doc.roundedRect(M, y, INNER, h, 6).fill(C.tealTint);
      doc.rect(M, y + 6, 2.5, h - 12).fill(C.teal);
      doc.fillColor(C.body).text(t, M + 14, y + 8, { width: INNER - 28 });
      y += h + 6;
    } else {
      paragraph('No approval record is stored for this case.', { color: C.bad });
    }

    if (app) {
      section('Parties');
      pairs([
        ['Applicant (importer)', app.applicant.name],
        ['Beneficiary (exporter)', app.beneficiary.name],
        ['Applicant address', `${dash(app.applicant.address)}, ${dash(app.applicant.country)}`],
        ['Beneficiary address', `${dash(app.beneficiary.address)}, ${dash(app.beneficiary.country)}`],
        ['Customer reference', model.customerRef],
        ['Purpose of the import', app.purpose],
      ]);

      section('Credit terms');
      pairs([
        ['Amount', money(app.amount, app.currency)],
        ['Tolerance', `${num(app.amountTolerancePercent)} %`],
        ['Payment terms', app.paymentTerms === 'USANCE' ? `Usance, ${app.usanceDays ?? '-'} days` : app.paymentTerms === 'SIGHT' ? 'At sight' : '-'],
        ['Proforma invoice number', app.proformaInvoiceNumber],
        ['Latest date of shipment', day(app.latestShipmentDate)],
        ['Expiry date', day(app.expiryDate)],
        ['Presentation period', `${app.presentationPeriodDays} days after shipment`],
        ['Amount in PKR (at the rate used)', model.amountInPkr ? money(model.amountInPkr, 'PKR') : '-'],
      ]);
      pairs([['Documents the credit requires', app.requiredDocuments.map((d) => human(d)).join(', ') || '-']]);

      section('Goods and shipment');
      pairs([
        ['Description of goods', app.goodsDescription],
        ['HS code', app.hsCode],
        ['Quantity', `${num(app.quantity)} ${dash(app.unitOfMeasure)}`],
        ['Unit price', money(app.unitPrice, app.currency)],
        ['Incoterm', `${dash(app.incoterm)} ${dash(app.namedPlace)}`],
        ['Country of origin', app.countryOfOrigin],
        ['Port of loading', app.portOfLoading],
        ['Port of discharge', app.portOfDischarge],
        ['Partial shipments', app.partialShipments ? human(app.partialShipments) : '-'],
        ['Transshipment', app.transshipment ? human(app.transshipment) : '-'],
      ]);
    }

    section('Documents on the request', 'Each file is identified by its SHA-256 fingerprint, so the exact file the bank scrutinized can be recognized.');
    table(
      [
        { title: 'Document', width: 100 },
        { title: 'File', width: 150 },
        { title: 'v', width: 22, align: 'center' },
        { title: 'Received', width: 84 },
        { title: 'Size', width: 44, align: 'right' },
        { title: 'SHA-256', width: 115, mono: true },
      ],
      model.documents.map((d) => [d.type + (d.current ? '' : ' (replaced)'), d.filename, String(d.version), `${day(d.uploadedAt)} by ${d.uploadedBy}`, kb(d.sizeBytes), d.sha256 ? `${d.sha256.slice(0, 16)}\n${d.sha256.slice(16, 32)}` : '-']),
      'No documents are attached.',
    );

    section('Scrutiny');
    const sc = model.scrutiny;
    pairs([
      ['AI scrutiny run', sc ? `${human(sc.status)}; ${sc.documentsRead} of ${sc.documentsTotal} documents read` : 'No AI scrutiny run is recorded'],
      ['Finished', sc ? when(sc.finishedAt ?? sc.startedAt) : '-'],
      ['Findings raised', String(model.findingCounts.total)],
      ['Open at approval', `${model.findingCounts.open} (${model.findingCounts.blockingOpen} blocking)`],
      ['Resolved by correction', String(model.findingCounts.resolved)],
      ['Cleared by a reviewer with a reason', String(model.findingCounts.dispositioned)],
    ]);
    if (model.comparison) {
      paragraph(`Documents compared with each other (${model.comparison.model}, ${day(model.comparison.at)}): ${model.comparison.summary || 'no summary'}  [${model.comparison.issues} point${model.comparison.issues === 1 ? '' : 's'} raised]`, { size: 9 });
    }
    if (model.documentReviews.length > 0) {
      table(
        [
          { title: 'Document', width: 150 },
          { title: 'What the AI found', width: 273 },
          { title: 'Missing', width: 48, align: 'center' },
          { title: 'Issues', width: 44, align: 'center' },
        ],
        model.documentReviews.map((r) => [r.filename, r.summary.length > 420 ? r.summary.slice(0, 417) + '...' : r.summary, String(r.missing), String(r.issues)]),
        '',
      );
    }

    section('Findings and how each was settled');
    table(
      [
        { title: 'ID', width: 40 },
        { title: 'Severity', width: 58 },
        { title: 'Finding', width: 170 },
        { title: 'Status', width: 60 },
        { title: 'How it was settled', width: 187 },
      ],
      model.findings.map((f) => [f.findingId, human(f.severity) + (f.blocking ? '\nblocking' : ''), f.title, human(f.status), f.resolution]),
      'No findings were raised on this request.',
    );

    section('Sanctions screening and checks against official sources');
    if (model.screening) {
      pairs([
        ['Screened at', when(model.screening.screenedAt)],
        ['Lists screened against', summariseLists(model.screening.datasetVersion)],
        ['Parties checked', String(model.screening.partiesChecked)],
        ['Countries checked', String(model.screening.jurisdictionsChecked)],
        ['Matches', model.screening.error ? 'Screening could not run: ' + model.screening.error : String(model.screening.matches)],
      ]);
    } else {
      paragraph('No sanctions screening result is stored for this request.', { color: C.warn });
    }
    if (model.externalVerification && model.externalVerification.length > 0) {
      table(
        [
          { title: 'Check', width: 150 },
          { title: 'State', width: 80 },
          { title: 'Claims', width: 45, align: 'center' },
          { title: 'Not checked', width: 240 },
        ],
        model.externalVerification.map((m) => [m.module, m.state, String(m.claimsChecked), m.notChecked.join(' ') || 'Nothing left out']),
        '',
      );
      paragraph(`Checked against official sources on ${when(model.externalVerificationAt)}. A source the platform could not reach is stated above; it is not treated as clear.`, { color: C.muted, size: 8.5 });
    } else {
      paragraph('No check against official sources is stored for this request.', { color: C.warn });
    }

    if (model.creditFacility) {
      section('Credit facility');
      pairs([
        ['Facility', model.creditFacility.reference],
        ['Available limit', money(model.creditFacility.limit, model.creditFacility.currency)],
        ['Margin', `${num(model.creditFacility.margin)} %`],
        ['Source', model.creditFacility.source],
        ['Verified by', `${model.creditFacility.verifiedBy}, ${when(model.creditFacility.verifiedAt)}`],
      ]);
    }

    section('Messages with the customer');
    table(
      [
        { title: 'Ref', width: 48 },
        { title: 'To', width: 62 },
        { title: 'Subject', width: 225 },
        { title: 'Sent', width: 70 },
        { title: 'Status', width: 60 },
        { title: 'Replies', width: 50, align: 'center' },
      ],
      model.queries.map((q) => [q.queryId, q.to, q.subject, day(q.raisedAt), q.status, String(q.replies)]),
      'No message was needed: nothing was sent to the customer.',
    );

    section('History of the request');
    table(
      [
        { title: 'When', width: 100 },
        { title: 'Status', width: 120 },
        { title: 'By', width: 95 },
        { title: 'Reason', width: 200 },
      ],
      model.timeline.map((t) => [when(t.at), t.to, t.actor, t.reason]),
      'No history.',
    );

    // The closing block moves as one, so its note is never left alone on a page of its own.
    room(110);
    section('Integrity', 'This payload states what the bank recorded. The AI reads and checks documents to help the trade desk; the approval above is the decision of the named officer.');
    pairs([
      ['Content fingerprint (SHA-256)', model.contentHash],
      ['Audit trail position when generated', model.audit.headSeq !== null ? `Entry ${model.audit.headSeq}   ${model.audit.headHash ? model.audit.headHash.slice(0, 32) + '...' : ''}` : 'Not recorded'],
    ]);

    // ------------------------------------------------------------------ footers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // The footer sits inside the bottom margin; without this, writing there would start a new page.
      doc.page.margins.bottom = 0;
      doc.moveTo(M, FOOTER_Y - 8).lineTo(PAGE_W - M, FOOTER_Y - 8).lineWidth(0.5).strokeColor(C.line).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(C.muted);
      doc.text(`Confidential  |  ${model.caseId}  |  version ${model.version}  |  fingerprint ${model.contentHash.slice(0, 12)}`, M, FOOTER_Y, { width: INNER - 80, lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, PAGE_W - M - 80, FOOTER_Y, { width: 80, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
