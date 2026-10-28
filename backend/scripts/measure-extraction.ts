import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Loose } from '../src/utils/loose-json';

/**
 * Measures how accurately the configured AI model reads trade documents, against answers a person wrote down.
 * This is the one number the platform cannot produce about itself: every other test in the repository uses
 * synthetic documents. Run it on real (redacted or consented) documents before relying on the extraction.
 *
 *   npm run measure:extraction -- --dir <folder of PDF/DOCX files> --labels <labels.json> [--min 0.95] [--out report.md]
 *
 * labels.json maps a file name to the fields you know are right. Label only what you are sure of; a field that is
 * not labelled is not scored. Every field is optional:
 *
 *   {
 *     "invoice-001.pdf": {
 *       "documentType": "Commercial Invoice", "documentNumber": "CI-2026-0412", "seller": "Global Cotton Traders Limited",
 *       "buyer": "Kamran Textiles (Pvt) Ltd", "originCountry": "China", "portOfLoading": "Shanghai",
 *       "portOfDischarge": "Karachi", "currency": "USD", "totalValue": 250000, "incoterm": "CFR", "hsCodes": ["5201.0010"]
 *     }
 *   }
 *
 * Names, ports and numbers are compared after lower-casing and dropping punctuation; amounts must agree to the cent;
 * HS codes are compared as digits. The provider comes from backend/.env (AI_PROVIDER and its key); the key is never
 * printed. Documents are sent to that provider, so only use documents you are allowed to send to it. Exit code 1 when
 * the overall accuracy is below --min (default 0.95), so it can gate a release.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tradeguard-measure-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  STORAGE_DRIVER: 'memory',
  PERSIST_TO_DISK: 'false',
  ENABLE_DUAL_SYNC: 'false',
  MONGODB_CLOUD_URI: ' ',
  UPLOAD_DIR: path.join(root, 'uploads'),
  DATA_DIR: path.join(root, 'data'),
  IMAGES_DIR: path.join(root, 'images'),
  COMPLIANCE_DIR: path.join(root, 'compliance'),
});

type Labels = {
  documentType?: string;
  documentNumber?: string;
  seller?: string;
  buyer?: string;
  originCountry?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  currency?: string;
  totalValue?: number;
  incoterm?: string;
  hsCodes?: string[];
};
type FieldName = keyof Labels;
const FIELDS: FieldName[] = ['documentType', 'documentNumber', 'seller', 'buyer', 'originCountry', 'portOfLoading', 'portOfDischarge', 'currency', 'totalValue', 'incoterm', 'hsCodes'];

/** Exit without calling process.exit() while network handles are closing, which crashes Node on Windows with a wrong exit code. */
function finish(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 3000).unref();
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const plain = (v: unknown): string => text(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const digits = (v: unknown): string => text(v).replace(/\D+/g, '');

/** The model's answer for one field, as comparable text or number. */
function predicted(out: Loose, field: FieldName): unknown {
  const tx = (out?.transaction ?? {}) as Record<string, Loose>;
  switch (field) {
    case 'documentType': return out?.documentClassification?.type;
    case 'documentNumber': return out?.documentClassification?.number;
    case 'seller': return tx['seller']?.legalName;
    case 'buyer': return tx['buyer']?.legalName;
    case 'originCountry': return tx['originCountry'];
    case 'portOfLoading': return tx['portOfLoading'];
    case 'portOfDischarge': return tx['portOfDischarge'];
    case 'currency': return tx['currency'];
    case 'totalValue': return tx['totalValue'];
    case 'incoterm': return tx['incoterm'];
    case 'hsCodes': return Array.isArray(out?.goods) ? out.goods.map((g: Loose) => g?.hsCode) : [];
  }
}

function matches(field: FieldName, expected: unknown, got: unknown): boolean {
  if (field === 'totalValue') return Math.abs(Number(expected) - Number(got)) < 0.005;
  if (field === 'hsCodes') {
    const want = new Set((expected as string[]).map(digits).filter(Boolean));
    const have = new Set((got as unknown[]).map(digits).filter(Boolean));
    return want.size === have.size && [...want].every((c) => have.has(c));
  }
  // "Santos, Brazil" and "Santos" name the same port; "CFR Karachi" and "CFR" the same term.
  if (field === 'portOfLoading' || field === 'portOfDischarge') return plain(text(expected).split(',')[0]) !== '' && plain(text(expected).split(',')[0]) === plain(text(got).split(',')[0]);
  if (field === 'incoterm') return plain(text(expected).split(/\s+/)[0]) !== '' && plain(text(expected).split(/\s+/)[0]) === plain(text(got).split(/\s+/)[0]);
  return plain(expected) !== '' && plain(expected) === plain(got);
}

type Row = { file: string; field: FieldName; expected: unknown; got: unknown; ok: boolean };

async function run(): Promise<void> {
  const dir = arg('dir');
  const labelsPath = arg('labels');
  if (!dir || !labelsPath) {
    console.error('Usage: npm run measure:extraction -- --dir <folder> --labels <labels.json> [--min 0.95] [--out report.md]');
    return finish(2);
  }
  const min = Number(arg('min') ?? '0.95');
  const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf8')) as Record<string, Labels>;

  const { getProvider, ResilientAIService } = await import('../src/ai');
  const { extractDocument } = await import('../src/document-processing/extractors');
  const provider = getProvider();
  if (provider.isLocal) {
    console.error('No remote AI provider is configured (AI_PROVIDER in backend/.env); there is no model to measure.');
    return finish(2);
  }
  console.log(`Provider: ${provider.id}; model: ${provider.model}; documents: ${Object.keys(labels).length}`);

  const rows: Row[] = [];
  const unreadable: string[] = [];
  const seconds: number[] = [];
  for (const [file, expected] of Object.entries(labels)) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) {
      unreadable.push(`${file} (not found)`);
      continue;
    }
    const type = file.toLowerCase().endsWith('.docx') ? 'docx' : file.toLowerCase().endsWith('.doc') ? 'doc' : 'pdf';
    let out: Loose = null;
    try {
      const extraction = await extractDocument(type, fs.readFileSync(full), file);
      const started = Date.now();
      out = await new ResilientAIService(provider).extractTradeDoc(file, extraction.lineText ?? extraction.text);
      seconds.push((Date.now() - started) / 1000);
    } catch (error) {
      unreadable.push(`${file} (${error instanceof Error ? error.message.slice(0, 80) : 'failed'})`);
      continue;
    }
    if (!out) {
      unreadable.push(`${file} (the model returned nothing usable)`);
      continue;
    }
    for (const field of FIELDS) {
      const want = expected[field];
      if (want === undefined) continue;
      const got = predicted(out, field);
      rows.push({ file, field, expected: want, got, ok: matches(field, want, got) });
    }
    console.log(`  ${file}: ${rows.filter((r) => r.file === file && r.ok).length}/${rows.filter((r) => r.file === file).length} fields right`);
  }

  const right = rows.filter((r) => r.ok).length;
  const overall = rows.length ? right / rows.length : 0;
  const lines: string[] = [];
  lines.push(`# Extraction accuracy`, '', `Model: ${provider.id} / ${provider.model}. Documents scored: ${Object.keys(labels).length - unreadable.length} of ${Object.keys(labels).length}. Fields scored: ${rows.length}.`, '');
  lines.push(`**Overall: ${(overall * 100).toFixed(1)}% (${right}/${rows.length})** against a bar of ${(min * 100).toFixed(0)}%.`, '', '| Field | Right | Scored | Accuracy |', '|---|---|---|---|');
  for (const field of FIELDS) {
    const of = rows.filter((r) => r.field === field);
    if (!of.length) continue;
    const ok = of.filter((r) => r.ok).length;
    lines.push(`| ${field} | ${ok} | ${of.length} | ${((ok / of.length) * 100).toFixed(1)}% |`);
  }
  if (seconds.length) lines.push('', `Median time per document: ${[...seconds].sort((a, b) => a - b)[Math.floor(seconds.length / 2)]!.toFixed(1)} s.`);
  const wrong = rows.filter((r) => !r.ok);
  if (wrong.length) {
    lines.push('', '## Mistakes', '', '| File | Field | Expected | Model said |', '|---|---|---|---|');
    for (const r of wrong) lines.push(`| ${r.file} | ${r.field} | ${JSON.stringify(r.expected)} | ${JSON.stringify(r.got)} |`);
  }
  if (unreadable.length) lines.push('', '## Not scored', '', ...unreadable.map((u) => `- ${u}`));
  const report = lines.join('\n') + '\n';
  const outPath = arg('out');
  if (outPath) fs.writeFileSync(outPath, report);
  console.log('\n' + report);
  fs.rmSync(root, { recursive: true, force: true });
  if (!rows.length) {
    console.error('Nothing was scored.');
    return finish(1);
  }
  finish(overall >= min ? 0 : 1);
}

run().catch((error) => {
  console.error('MEASUREMENT FAILED:', error instanceof Error ? error.message : error);
  finish(1);
});
