import 'dotenv/config';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { MongoClient, type Db } from 'mongodb';

/**
 * Clears what rehearsals leave behind, so the demo starts clean:
 *   - every trade case, its audit events and the case counter (the next case is TC-<year>-00001);
 *   - the documents those cases hold, the documents analyzed for the pre-shipment flow, and any
 *     document named with --document, with their analysis, text units and stored files;
 *   - the fraud-engine history (storage/data/fraud-registry.json), which is what raises
 *     "proforma invoice also used on case ..." and "possible replay" on the sample files.
 * Workbench documents, sanctions lists, reference data and customers are left alone.
 *
 *   npm run reset-demo -- [--apply] [--skip-cloud] [--document <id>]...
 *
 * Without --apply it only reports what it would remove. With --apply it first writes a backup of
 * what it is about to delete to storage/backups/, and refuses to run while the API is up (the API
 * holds the fraud history in memory and would write it back). Stored files are not backed up: the
 * sample PDFs are in test-pdfs/.
 */

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const skipCloud = args.includes('--skip-cloud');
const extraDocuments: string[] = [];
args.forEach((a, i) => {
  if (a === '--document' && args[i + 1]) extraDocuments.push(args[i + 1]!);
});

const dbName = process.env['MONGODB_DB'] || 'docuintel';
const dataDir = path.resolve(process.env['DATA_DIR'] || 'storage/data');
const uploadDir = path.resolve(process.env['UPLOAD_DIR'] || 'storage/uploads');
const registryFile = path.join(dataDir, 'fraud-registry.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.resolve('storage/backups', `demo-reset-${stamp}`);

interface Plan {
  caseIds: string[];
  documentIds: string[];
  counts: Record<string, number>;
}

async function plan(db: Db): Promise<Plan> {
  const cases = await db.collection('trade_cases').find({}, { projection: { caseId: 1, documents: 1 } }).toArray();
  const ids = new Set<string>(extraDocuments);
  for (const c of cases) for (const d of (c['documents'] as Array<{ documentId: string }> | undefined) ?? []) ids.add(d.documentId);
  for (const d of await db.collection('documents').find({ analysisProfile: 'PRESHIPMENT' }, { projection: { id: 1 } }).toArray()) ids.add(String(d['id']));
  const documentIds = [...ids];
  const counts = {
    trade_cases: cases.length,
    trade_case_events: await db.collection('trade_case_events').countDocuments(),
    documents: await db.collection('documents').countDocuments({ id: { $in: documentIds } }),
    analysis_events: await db.collection('analysis_events').countDocuments({ documentId: { $in: documentIds } }),
    document_units: await db.collection('document_units').countDocuments({ documentId: { $in: documentIds } }),
    'document_files.files': await db.collection('document_files.files').countDocuments({ filename: { $in: documentIds } }),
  };
  return { caseIds: cases.map((c) => String(c['caseId'])), documentIds, counts };
}

async function backup(db: Db, label: string, p: Plan): Promise<void> {
  const dir = path.join(backupDir, label);
  fs.mkdirSync(dir, { recursive: true });
  const dump = async (name: string, rows: unknown[]) => fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(rows, null, 1));
  await dump('trade_cases', await db.collection('trade_cases').find().toArray());
  await dump('trade_case_events', await db.collection('trade_case_events').find().toArray());
  await dump('trade_case_counters', await db.collection('trade_case_counters').find().toArray());
  await dump('documents', await db.collection('documents').find({ id: { $in: p.documentIds } }).toArray());
  await dump('analysis_events', await db.collection('analysis_events').find({ documentId: { $in: p.documentIds } }).toArray());
}

async function remove(db: Db, p: Plan): Promise<void> {
  const ids = p.documentIds;
  await db.collection('trade_cases').deleteMany({});
  await db.collection('trade_case_events').deleteMany({});
  await db.collection('trade_case_counters').deleteMany({});
  await db.collection('analysis_events').deleteMany({ documentId: { $in: ids } });
  await db.collection('document_units').deleteMany({ documentId: { $in: ids } });
  await db.collection('documents').deleteMany({ id: { $in: ids } });
  const files = await db.collection('document_files.files').find({ filename: { $in: ids } }, { projection: { _id: 1 } }).toArray();
  const fileIds = files.map((f) => f['_id']);
  await db.collection('document_files.chunks').deleteMany({ files_id: { $in: fileIds } });
  await db.collection('document_files.files').deleteMany({ _id: { $in: fileIds } });
}

function apiIsUp(): Promise<boolean> {
  const port = Number(process.env['PORT'] || 4000);
  const host = process.env['HOST'] || '127.0.0.1';
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
    socket.setTimeout(1500, () => (socket.destroy(), resolve(false)));
  });
}

async function main(): Promise<void> {
  if (apply && (await apiIsUp())) {
    console.error('The API is running. Stop it first (it keeps the fraud history in memory), then run this again.');
    process.exit(1);
  }
  const targets: Array<[string, string]> = [['local', process.env['MONGODB_URI'] ?? '']];
  if (!skipCloud && process.env['MONGODB_CLOUD_URI']) targets.push(['cloud', process.env['MONGODB_CLOUD_URI']]);

  console.log(apply ? 'APPLYING the reset.\n' : 'DRY RUN: nothing is changed. Add --apply to do it.\n');
  let failed = false;
  for (const [label, uri] of targets) {
    if (!uri) continue;
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    try {
      await client.connect();
      const db = client.db(dbName);
      const p = await plan(db);
      console.log(`${label} database "${dbName}": ${p.caseIds.length} case(s) (${p.caseIds.join(', ') || '-'}), ${p.documentIds.length} document id(s)`);
      for (const [k, v] of Object.entries(p.counts)) console.log(`  ${k.padEnd(22)} ${v}`);
      if (apply) {
        await backup(db, label, p);
        await remove(db, p);
        console.log(`  removed. Backup: ${path.join(backupDir, label)}`);
        // The files of removed documents sit beside the database (local copy only).
        if (label === 'local') {
          let removedFiles = 0;
          for (const id of p.documentIds) {
            for (const f of [path.join(uploadDir, `${id}.pdf`), path.join(uploadDir, `${id}.docx`), path.join(uploadDir, `${id}.doc`), path.join(dataDir, `${id}.json`), path.join(dataDir, `${id}.report.txt`)]) {
              if (!fs.existsSync(f)) continue;
              fs.rmSync(f);
              removedFiles += 1;
            }
          }
          console.log(`  stored files removed: ${removedFiles}`);
        }
      }
    } catch (error) {
      failed = true;
      console.error(`${label}: skipped (${String(error).slice(0, 140)})`);
    } finally {
      await client.close();
    }
    console.log('');
  }

  if (fs.existsSync(registryFile)) {
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8')) as { transactions?: unknown[]; identifiers?: unknown[] };
    console.log(`fraud history: ${registry.transactions?.length ?? 0} transaction(s), ${registry.identifiers?.length ?? 0} identifier(s)`);
    if (apply) {
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(registryFile, path.join(backupDir, 'fraud-registry.json'));
      fs.writeFileSync(registryFile, JSON.stringify({ version: 1, transactions: [], identifiers: [] }, null, 2));
      console.log('  cleared.');
    }
  }
  if (apply && failed) console.log('\nA database above could not be reached, so it was not reset. Run again with --skip-cloud to ignore the cloud copy, or when it is reachable.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
