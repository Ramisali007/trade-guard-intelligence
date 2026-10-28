import { IT_DATABASE, IT_URI } from './mongo-test-env';
import assert from 'node:assert';
import { MongoClient } from 'mongodb';
import { config } from '../config';
import { ComplianceStore } from '../compliance/db/compliance-store';
import type { AuthenticatedUser } from '../middleware/auth.middleware';
import { closeAccountDirectory, createManagedAccount, findDemoAccount, initAccountDirectory, listAccounts, resetAccountCache, type DemoAccountKey } from '../services/account-directory';
import { CustomerRepository } from '../services/customer.repository';
import { closeRepository, initRepository } from '../services/document.repository';
import {
  closeTradeCaseRepository,
  initTradeCaseRepository,
  MongoTradeCaseRepository,
  verifyChain,
} from '../trade-cases/trade-case.repository';
import { getTradeCaseService } from '../trade-cases/trade-case.service';
import { hashEntry } from '../utils/hash-chain';
import { createInitialProgress } from '../models/document.model';
import crypto from 'node:crypto';

/**
 * The stores against a real MongoDB server, in an isolated database that is dropped at the end.
 *
 *   M1  topology: what the server is, and whether multi-document transactions are available
 *   M2  every store opens on MongoDB (no silent memory fallback); collections and unique indexes
 *   M3  case numbering under 25 parallel requests; idempotent creation under parallel duplicates
 *   M4  two application instances: a stale revision is refused, the audit log cannot fork
 *   M5  restart: cases, audit chains and managed accounts survive closing and re-opening the stores
 *   M6  tampering with the stored log (alteration, deletion of the newest entries) is detected
 *   M7  an audit write that fails after the case was saved is reported, and the gap is detectable
 *   M8  an unreachable server stops start-up when fallback is off
 *   M9  document store: originals in GridFS, legacy inline files migrated, interrupted runs recovered,
 *       archive scope explicit, erasure complete
 *
 * Run with `npm run test:mongo`. Synthetic data only.
 */

const as = (key: DemoAccountKey): AuthenticatedUser => ({ ...findDemoAccount(key)!, tokenType: 'BEARER' });

async function expectStatus(promise: Promise<unknown>, status: number, label: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert.strictEqual((error as { status?: number }).status, status, `${label}: expected ${status}, got ${(error as Error).message}`);
    return;
  }
  assert.fail(`${label}: expected ${status}, but it succeeded`);
}

async function run(): Promise<void> {
  assert.ok(/^tradeguard_it_\d+$/.test(IT_DATABASE), 'the suite only ever uses its own tradeguard_it_* database');
  console.log('================================================================');
  console.log(`MongoDB live suite — isolated database ${IT_DATABASE}`);
  console.log('================================================================\n');

  const admin = new MongoClient(IT_URI, { serverSelectionTimeoutMS: 5000 });
  await admin.connect();
  const findings: string[] = [];
  try {
    const before = (await admin.db('admin').admin().listDatabases()).databases.map((d) => d.name);
    assert.ok(!before.includes(IT_DATABASE), 'the isolated database does not exist yet');

    // ------------------------------------------------------------------ M1 topology
    const hello = await admin.db('admin').command({ hello: 1 });
    const build = await admin.db('admin').command({ buildInfo: 1 });
    const replicaSet = typeof hello['setName'] === 'string';
    let transactions = 'not attempted';
    const session = admin.startSession();
    try {
      session.startTransaction();
      await admin.db(IT_DATABASE).collection('probe').insertOne({ probe: true }, { session });
      await session.commitTransaction();
      transactions = 'supported (committed a test transaction)';
    } catch (error) {
      transactions = `NOT supported: ${(error as Error).message.slice(0, 120)}`;
      await session.abortTransaction().catch(() => undefined);
    } finally {
      await session.endSession();
    }
    console.log(`   server ${build['version']}, ${replicaSet ? `replica set ${hello['setName']}` : 'standalone'}; transactions ${transactions}`);
    findings.push(`MongoDB ${build['version']} ${replicaSet ? 'replica set' : 'standalone'}; multi-document transactions ${transactions.startsWith('supported') ? 'available' : 'unavailable'}`);
    if (!replicaSet) assert.ok(transactions.startsWith('NOT'), 'a standalone server refuses transactions, as expected');
    console.log('✔ M1 Passed: topology identified.\n');

    // ------------------------------------------------------------------ M2 stores open on MongoDB
    const docs = await initRepository();
    await CustomerRepository.getInstance().init();
    await ComplianceStore.getInstance().init();
    const cases = await initTradeCaseRepository();
    await initAccountDirectory();
    assert.strictEqual(docs.driver, 'mongo', 'documents on MongoDB');
    assert.strictEqual(cases.driver, 'mongo', 'trade cases on MongoDB');
    const db = admin.db(IT_DATABASE);
    const indexes = async (name: string) => (await db.collection(name).indexes()).filter((i) => i.unique).map((i) => JSON.stringify(i.key));
    assert.ok((await indexes('trade_cases')).includes('{"caseId":1}'), 'unique caseId');
    assert.ok((await indexes('trade_cases')).includes('{"customerRef":1,"clientRequestId":1}'), 'unique client request per customer');
    assert.ok((await indexes('trade_case_events')).includes('{"caseId":1,"seq":1}'), 'one event per position in the chain');
    console.log('✔ M2 Passed: documents, trade cases and identity open on MongoDB; unique indexes in place.\n');

    // ------------------------------------------------------------------ M3 numbering and idempotency
    const year = 2099;
    const numbers = await Promise.all(Array.from({ length: 25 }, () => cases.nextCaseNumber(year)));
    assert.deepStrictEqual([...numbers].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1), '25 parallel requests get 1..25 exactly once');
    const svc = getTradeCaseService();
    const customer = as('corporate_customer');
    const application = { applicant: { name: 'Kamran Textiles (Pvt) Ltd', country: 'Pakistan' }, beneficiary: { name: 'Global Cotton Traders Limited', country: 'China' }, currency: 'USD', amount: 100000 };
    const dupes = await Promise.all(Array.from({ length: 8 }, () => svc.createCase(customer, { clientRequestId: 'MONGO-IT-SAME', application })));
    assert.strictEqual(new Set(dupes.map((d) => d.tradeCase.caseId)).size, 1, 'eight parallel identical requests produce one case');
    assert.strictEqual(dupes.filter((d) => d.created).length, 1);
    const caseId = dupes[0]!.tradeCase.caseId;
    assert.strictEqual(await db.collection('trade_cases').countDocuments({ clientRequestId: 'MONGO-IT-SAME' }), 1, 'one document in the collection');
    console.log(`✔ M3 Passed: counter is atomic; ${caseId} created once under eight parallel duplicates.\n`);

    // ------------------------------------------------------------------ M4 two instances
    const other = new MongoTradeCaseRepository();
    await other.init();
    const a = (await cases.findById(caseId))!;
    const b = (await other.findById(caseId))!;
    await cases.replace({ ...a, revision: a.revision + 1, updatedAt: new Date().toISOString() }, a.revision);
    await expectStatus(other.replace({ ...b, revision: b.revision + 1 }, b.revision), 409, 'second instance with a stale revision');
    const eventInput = { caseId, at: new Date().toISOString(), actor: { id: 'system' as const, name: 'IT', role: 'SYSTEM' as const }, action: 'IT_PROBE', fromStatus: null, toStatus: null, detail: {}, ruleSetVersion: 'it' };
    const e1 = await cases.prepareEvent(eventInput);
    const e2 = await other.prepareEvent({ ...eventInput, action: 'IT_PROBE_OTHER' });
    assert.strictEqual(e1.seq, e2.seq, 'both instances prepared the same position');
    await cases.insertEvent(e1);
    await expectStatus(other.insertEvent(e2), 409, 'a second event at the same position');
    const fixed = (await cases.findById(caseId))!;
    await cases.replace({ ...fixed, auditHead: { seq: e1.seq, hash: e1.hash }, revision: fixed.revision + 1 }, fixed.revision);
    assert.ok(verifyChain(await cases.listEvents(caseId), (await cases.findById(caseId))!.auditHead).valid, 'the chain did not fork');
    await other.close();
    console.log('✔ M4 Passed: revision guard and the (caseId, seq) index hold across two instances.\n');

    // ------------------------------------------------------------------ M5 restart
    const created = await createManagedAccount({ id: 'it-admin', name: 'IT Admin' }, { email: 'it.officer@tradeguard.ai', name: 'IT Officer' });
    const eventsBefore = (await cases.listEvents(caseId)).length;
    await closeTradeCaseRepository();
    await closeRepository();
    await closeAccountDirectory();
    resetAccountCache();
    const reopened = await initTradeCaseRepository();
    await initRepository();
    await initAccountDirectory();
    assert.notStrictEqual(reopened, cases, 'a new repository instance');
    const back = (await reopened.findById(caseId))!;
    assert.ok(back, 'the case survived the restart');
    const evs = await reopened.listEvents(caseId);
    assert.strictEqual(evs.length, eventsBefore);
    assert.ok(verifyChain(evs, back.auditHead).valid, 'and its chain verifies against the stored anchor');
    assert.ok(listAccounts().some((x) => x.id === created.account.id), 'the managed account survived the restart');
    console.log('✔ M5 Passed: cases, audit chains and managed accounts persist across a store restart.\n');

    // ------------------------------------------------------------------ M6 tampering in the database
    const auditor = as('trade_auditor');
    const live = (reopened as MongoTradeCaseRepository).eventsCollection;
    const pristine = await live.find({ caseId }).sort({ seq: 1 }).toArray();
    await live.updateOne({ caseId, seq: 1 }, { $set: { 'detail.customerRef': 'TG-CORP-EVIL' } });
    let verdict = (await svc.getAudit(auditor, caseId)).chain;
    assert.ok(!verdict.valid && verdict.brokenAtSeq === 1, `alteration in MongoDB detected: ${verdict.problem}`);
    await live.replaceOne({ caseId, seq: 1 }, pristine[0]!);
    const newest = pristine[pristine.length - 1]!;
    await live.deleteOne({ caseId, seq: newest.seq });
    verdict = (await svc.getAudit(auditor, caseId)).chain;
    assert.ok(!verdict.valid && /removed or never written/.test(verdict.problem!), `deleting the newest entry detected via the anchor: ${verdict.problem}`);
    await live.insertOne(newest);
    assert.ok((await svc.getAudit(auditor, caseId)).chain.valid, 'restored');
    // A forged entry appended with a correctly recomputed hash passes the link and content checks;
    // only the anchor stored on the case reveals it. (An attacker who can also rewrite the case
    // document's anchor is not detected: the chain is unkeyed — see the readiness report.)
    const { _id: _newestId, ...newestFields } = newest;
    const forgedBody = { ...newestFields, seq: newest.seq + 1, eventId: 'it-forged', action: 'APPROVED_BY_FORGERY', prevHash: newest.hash } as Record<string, unknown>;
    delete forgedBody['hash'];
    await live.insertOne({ ...forgedBody, hash: hashEntry(forgedBody) } as never);
    verdict = (await svc.getAudit(auditor, caseId)).chain;
    assert.ok(!verdict.valid && /beyond the record's anchor/.test(verdict.problem!), `appended forgery detected via the anchor: ${verdict.problem}`);
    await live.deleteOne({ caseId, eventId: 'it-forged' });
    assert.ok((await svc.getAudit(auditor, caseId)).chain.valid, 'restored');
    console.log('✔ M6 Passed: direct edits, deletions and a validly-hashed appended forgery in the events collection are detected.\n');

    // ------------------------------------------------------------------ M7 audit write fails after the case write
    // An outage between the two writes, on a server without transactions: the event insert fails once.
    const tradeRepo = reopened as MongoTradeCaseRepository;
    const revisionBefore = (await reopened.findById(caseId))!.revision;
    if (!tradeRepo.atomic) {
      const realInsert = tradeRepo.insertEvent.bind(tradeRepo);
      tradeRepo.insertEvent = async () => {
        tradeRepo.insertEvent = realInsert;
        throw new Error('simulated: connection reset by peer');
      };
      await expectStatus(svc.updateApplication(customer, caseId, { changes: { amount: 110000 }, reason: 'Amount corrected by the importer' }), 503, 'audit write failure is surfaced');
      const afterFailure = (await reopened.findById(caseId))!;
      assert.ok(afterFailure.revision > revisionBefore, 'the case change itself was saved (no transaction to roll it back)');
      verdict = (await svc.getAudit(auditor, caseId)).chain;
      assert.ok(!verdict.valid, `the missing audit entry is detectable: ${verdict.problem}`);
      findings.push('Without transactions the case write and its audit event are two writes; a failure between them leaves a saved change without its audit entry. It is reported (503 AUDIT_WRITE_FAILED, error log) and the chain check flags it, but it is not rolled back.');
      console.log(`✔ M7 Passed: a failed audit write is reported (503) and flagged by verification (${verdict.problem}).\n`);
    } else {
      // Replica set: the case and its audit event are one transaction, so a failed audit write undoes the change.
      const versionBefore = (await reopened.findById(caseId))!.currentApplicationVersion;
      const events = tradeRepo.eventsCollection;
      const eventsBefore = (await reopened.listEvents(caseId)).length;

      // (a) another writer takes the audit position after this one prepared its event: a clean 409, nothing changed
      const realPrepare = tradeRepo.prepareEvent.bind(tradeRepo);
      tradeRepo.prepareEvent = async (input) => {
        tradeRepo.prepareEvent = realPrepare;
        const prepared = await realPrepare(input);
        const rogue = { ...prepared, eventId: 'it-rogue', hash: 'rogue' } as Record<string, unknown>;
        delete rogue['_id'];
        await events.insertOne(rogue as never);
        return prepared;
      };
      await expectStatus(svc.updateApplication(customer, caseId, { changes: { amount: 110000 }, reason: 'Amount corrected by the importer' }), 409, 'a taken audit position is a conflict');
      await events.deleteOne({ eventId: 'it-rogue' });
      assert.strictEqual((await reopened.findById(caseId))!.revision, revisionBefore, 'the case revision is unchanged after the conflict');
      assert.deepStrictEqual((await reopened.findById(caseId))!.currentApplicationVersion, versionBefore, 'the application version was not changed');

      // (b) the audit insert fails inside the transaction (an outage): the case write is rolled back
      const realInsertOne = events.insertOne.bind(events);
      (events as { insertOne: unknown }).insertOne = async () => {
        (events as { insertOne: unknown }).insertOne = realInsertOne;
        throw new Error('simulated: connection reset by peer');
      };
      await expectStatus(svc.updateApplication(customer, caseId, { changes: { amount: 110000 }, reason: 'Amount corrected by the importer' }), 503, 'an audit write failure is surfaced');
      const afterFailure = (await reopened.findById(caseId))!;
      assert.strictEqual(afterFailure.revision, revisionBefore, 'the case change was rolled back with its audit entry');
      assert.deepStrictEqual(afterFailure.currentApplicationVersion, versionBefore, 'the application version was not changed');
      assert.strictEqual((await reopened.listEvents(caseId)).length, eventsBefore, 'no audit entry was added');
      assert.ok((await svc.getAudit(auditor, caseId)).chain.valid, 'the audit chain is still intact');

      // (c) with nothing wrong, the same change commits, with exactly one new audit entry
      await svc.updateApplication(customer, caseId, { changes: { amount: 110000 }, reason: 'Amount corrected by the importer' });
      assert.ok((await reopened.findById(caseId))!.revision > revisionBefore, 'the change is saved');
      assert.ok((await reopened.listEvents(caseId)).length > eventsBefore, 'with its audit entry');
      assert.ok((await svc.getAudit(auditor, caseId)).chain.valid, 'the chain verifies after the commit');
      findings.push('Replica set: a case change and its audit event are saved in one transaction; a failed audit write rolls the change back (tested).');
      console.log('✔ M7 Passed: on a replica set a failed audit write undoes the case change (conflict -> 409, outage -> 503), and a normal change commits with its entry.\n');
    }

    // ------------------------------------------------------------------ M8 unreachable server
    const realUri = config.storage.mongoUri;
    (config.storage as { mongoUri: string }).mongoUri = 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=1500';
    try {
      await closeTradeCaseRepository();
      await expectStatus(initTradeCaseRepository(), 503, 'start-up with MongoDB unreachable and fallback off');
    } finally {
      (config.storage as { mongoUri: string }).mongoUri = realUri;
    }
    console.log('✔ M8 Passed: with fallback off, an unreachable MongoDB stops start-up instead of running on memory.\n');

    // ------------------------------------------------------------------ M9 document store
    await closeRepository();
    const dbh = admin.db(IT_DATABASE);
    const legacyId = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
    const stamp = (d: string) => d + 'T10:00:00.000Z';
    const record = (id: string, hash: string, uploadedAt: string, extra: Record<string, unknown> = {}) => ({
      id, customerId: 'c-m9', contentHash: hash, uploadedAt, status: 'uploaded', progress: createInitialProgress(),
      filename: id + '.pdf', fileType: 'pdf', fileSize: 10, mimeType: 'application/pdf', storagePath: null, units: [], ...extra,
    });
    // what an older build left behind: the original inside the record, and a run that never finished
    await dbh.collection('documents').insertOne(record(legacyId, 'm9-legacy', stamp('2026-01-05'), { status: 'processing', fileBase64: Buffer.from('%PDF-legacy-original').toString('base64') }) as never);
    const docRepo = await initRepository();
    const legacyMeta = (await docRepo.findMeta(legacyId))!;
    assert.ok(!('fileBase64' in legacyMeta), 'a record read from the store never carries the original');
    assert.strictEqual(legacyMeta.status, 'failed', 'a run interrupted by a restart is marked failed, not left "processing" forever');
    assert.strictEqual(legacyMeta.error?.code, 'PROCESSING_INTERRUPTED');
    assert.strictEqual((await docRepo.loadSourceFile(legacyId))?.toString(), '%PDF-legacy-original', 'the embedded original was moved to GridFS');
    assert.strictEqual(await dbh.collection('documents').countDocuments({ id: legacyId, fileBase64: { $exists: true } }), 0, 'and removed from the record');

    const big = crypto.randomBytes(3 * 1024 * 1024);
    const bigId = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
    await docRepo.create(record(bigId, 'm9-big', stamp('2026-02-05')) as never);
    await docRepo.saveSourceFile(bigId, big);
    await docRepo.saveSourceFile(bigId, big);
    assert.ok((await docRepo.loadSourceFile(bigId))!.equals(big), 'a 3 MB original round-trips byte for byte (it would not fit inline with base64)');
    assert.strictEqual(await dbh.collection('document_files.files').countDocuments({ filename: bigId }), 1, 'saving twice keeps one file');
    await docRepo.update(bigId, (d) => {
      d.status = 'processing';
    });
    assert.ok(await docRepo.hasSourceFile(bigId), 'a progress update does not touch the stored original');
    assert.ok((await docRepo.listAllIds()).has(bigId));

    await assert.rejects(() => docRepo.deleteBatch({}), /Say what to archive/);
    assert.strictEqual((await docRepo.deleteBatch({ ids: [bigId] })).deletedCount, 1, 'by id: only that document');
    assert.strictEqual((await docRepo.list(50, 0)).items.some((d) => d.id === legacyId), true, 'the others are untouched');
    assert.strictEqual((await docRepo.deleteBatch({ fromDate: '2026-01-01', toDate: '2026-01-31' })).deletedCount, 1, 'a range archives only the range');
    assert.strictEqual((await docRepo.restoreBatch({ all: true })).restoredCount, 2);

    await docRepo.saveUnits(bigId, [{ id: 'u1', pageNumber: 1, paragraphNumber: 1, text: 'x', classification: {} } as never]);
    assert.strictEqual(await docRepo.purge(bigId), true);
    assert.strictEqual(await dbh.collection('documents').countDocuments({ id: bigId }), 0, 'purge removes the record');
    assert.strictEqual(await dbh.collection('document_units').countDocuments({ documentId: bigId }), 0, 'its passages');
    assert.strictEqual(await dbh.collection('document_files.files').countDocuments({ filename: bigId }), 0, 'and the stored original');
    assert.strictEqual((await dbh.collection('document_files.chunks').countDocuments({})) > 0, true, 'while other documents keep theirs');
    console.log('✔ M9 Passed: originals in GridFS, legacy inline files migrated, interrupted runs recovered, archive scope explicit, erasure complete.\n');
  } finally {
    await closeTradeCaseRepository().catch(() => undefined);
    await closeRepository().catch(() => undefined);
    await closeAccountDirectory().catch(() => undefined);
    // Drop only the database this suite created.
    if (/^tradeguard_it_\d+$/.test(IT_DATABASE)) await admin.db(IT_DATABASE).dropDatabase();
    const after = (await admin.db('admin').admin().listDatabases()).databases.map((d) => d.name);
    assert.ok(!after.includes(IT_DATABASE), 'the isolated database was removed');
    await admin.close();
  }

  console.log('Findings to carry into the readiness report:');
  for (const f of findings) console.log(`   - ${f}`);
  console.log('================================================================');
  console.log('ALL MONGODB LIVE SCENARIOS PASSED');
  console.log('================================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('MONGODB LIVE TEST FAILED:', err);
  process.exit(1);
});
