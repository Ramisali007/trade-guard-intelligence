import './test-env';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { ComplianceStore } from '../compliance/db/compliance-store';
import { RiskScoringEngine } from '../compliance/risk-scoring.service';
import { isScreenableName, matchNames, prepareName } from '../compliance/sanctions/name-matching';
import { PricingIntelligenceService } from '../compliance/pricing/pricing-intelligence.service';
import { convertUnitPrice } from '../compliance/pricing/unit-conversion';
import { FxRatesService } from '../compliance/pricing/fx-rates.service';
import { ImportBatchService } from '../compliance/import/import-batch.service';
import { MasterDataChangeService } from '../compliance/import/master-data-changes';
import { sanitizeForCsvInjection } from '../compliance/import/entity-registry';
import { TransactionRegistry } from '../compliance/fraud/transaction-registry';
import { TradeComplianceExtractor } from '../ai/trade-extractor';
import { signBankingToken } from '../middleware/auth.middleware';
import { DEMO_ACCOUNT_KEYS, findDemoAccount, hashPassword, initAccountDirectory, verifyPassword, type DemoAccountKey } from '../services/account-directory';
import { initRepository, MemoryDocumentRepository, resolveHistoryScope } from '../services/document.repository';
import { assertOverrideAllowed } from '../services/document.service';
import { buildComplianceReportModel } from '../services/report.dto';
import { loginRetryAfterSeconds, recordLoginFailure, recordLoginSuccess, resetLoginThrottle } from '../services/login-throttle';
import { listZipEntries, isWordDocument, zipBombReason } from '../document-processing/extractors/zip-guard';
import { detectFileType } from '../document-processing/extractors';
import { AppError } from '../utils/errors';
import { PdfExtractor } from '../document-processing/extractors/pdf.extractor';
import PDFDocument from 'pdfkit';
import { PNG } from 'pngjs';
import type { CommodityLineItem } from '../compliance/types';
import { createInitialProgress, type DocumentRecord } from '../models/document.model';
import type { Loose } from '../utils/loose-json';

/**
 * Regression tests for the hardening pass: every defect found in the audit has a test here that fails
 * on the old behaviour.
 *
 *   H1  sanctions name matching: other scripts, shortened names, unreadable names
 *   H2  risk decisions: a later designation must not hide an embargo; nothing screened is not "clear"
 *   H3  price comparison: units, currency, whole-word benchmark matching
 *   H4  archive / restore scope; the stored original; erasure
 *   H5  human overrides
 *   H6  configuration secrets and demo-login defaults
 *   H7  sign-in: async hashing, lockout, sign-out revokes the token
 *   H8  reference data: four-eyes control, versioned manual sanctions entries, actor from the token
 *   H9  documents: archive bombs and look-alike archives
 *   H10 reports state what was found; health is minimal; fraud history survives a restart
 *   H11 keyed audit chain: forging history needs the key
 */

const account = (key: DemoAccountKey) => findDemoAccount(key)!;

function line(partial: Partial<CommodityLineItem>): CommodityLineItem {
  return {
    id: 'LINE-1',
    itemNumber: 1,
    productDescription: 'Item',
    manufacturer: 'Not Found',
    brand: 'Not Found',
    model: 'Not Found',
    partNumber: 'Not Found',
    sku: 'Not Found',
    productCategory: 'General Merchandise',
    quantity: 1,
    unitOfMeasure: 'PCS',
    unitPrice: 0,
    totalLineValue: 0,
    currency: 'USD',
    countryOfOrigin: 'Not Found',
    hsCode: 'Not Specified',
    eccn: 'Not Specified',
    technicalSpecifications: '',
    statedEndUse: '',
    isAuthorizedScope: true,
    isControlledOrDualUse: false,
    riskSeverity: 'LOW',
    ...partial,
  };
}

/** A ZIP central directory describing `entries`, with no entry data behind it (enough to be judged). */
function zipWith(entries: Array<{ name: string; compressed: number; uncompressed: number }>): Buffer {
  // A real archive opens with a local file header (PK); the entry data itself is not needed here.
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  const parts: Buffer[] = [local];
  let directorySize = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt32LE(e.compressed, 20);
    header.writeUInt32LE(e.uncompressed, 24);
    header.writeUInt16LE(name.length, 28);
    parts.push(header, name);
    directorySize += 46 + name.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directorySize, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([...parts, eocd]);
}

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('HARDENING REGRESSION SUITE');
  console.log('================================================================\n');

  await initRepository();
  await ComplianceStore.getInstance().init();
  await initAccountDirectory();

  // ------------------------------------------------------------------ H1 name matching
  const m = (q: string, l: string) => matchNames(prepareName(q), prepareName(l));
  assert.strictEqual(m('Банк Мелли Иран', 'BANK MELLI IRAN')?.kind, 'EXACT', 'Cyrillic meets its Latin transliteration');
  assert.strictEqual(m('بانک ملی ایران', 'بانک ملی ایران')?.kind, 'EXACT', 'identical Arabic-script names match');
  assert.strictEqual(m('中国航天科工集团', '中国航天科工集团')?.kind, 'EXACT', 'identical CJK names match');
  assert.strictEqual(m('Bank Melli', 'BANK MELLI IRAN')?.kind, 'TOKEN_CONTAINMENT', 'a shortened name is a possible match');
  assert.ok((m('Bank Melli', 'BANK MELLI IRAN')?.confidence ?? 1) < 0.95, 'but never a confirmed listing');
  assert.ok(m('Sberbank', 'SBERBANK OF RUSSIA'), 'a distinctive single token still finds the longer listing');
  assert.strictEqual(m('Kamran Textiles', 'Zenith Marine Services'), null, 'unrelated names do not match');
  assert.strictEqual(m('Al Noor', 'AL NOOR TRADING COMPANY LIMITED FZE')?.kind, 'TOKEN_CONTAINMENT');
  assert.strictEqual(isScreenableName('???'), false, 'a name with no letters cannot be screened');
  assert.strictEqual(isScreenableName('Лукойл'), true);
  console.log('✔ H1 Passed: other scripts and shortened names are compared; unreadable names are reported, not cleared.');

  // ------------------------------------------------------------------ H2 decisions
  const engine = new RiskScoringEngine();
  const scoringBase: Loose = {
    sanctions: {
      status: 'RESTRICTED_JURISDICTION',
      overallSanctionsRiskScore: 98,
      matches: [],
      jurisdictionRisks: [{ countryName: 'Iran', nodeRole: 'ORIGIN', description: 'embargo', riskScore: 98, sanctionsStatus: 'COMPREHENSIVE_SANCTIONED' }],
      screenedEntitiesCount: 2,
      screenedCountriesCount: 2,
      screenedVesselsCount: 0,
    },
    scopeValidation: { hasOutOfScopeGoods: false, outOfScopeGoods: [], declaredAuthorizedScope: '' },
    exportControls: { riskScore: 0, controlledGoods: [] },
    endUse: { redFlags: [], isIndustryConsistent: true, explanation: '' },
    tbml: { overallTbmlRiskScore: 0, redFlags: [] },
    mathValidation: { isMathematicallySound: true, discrepancies: [] },
    documentIntegrity: { riskScore: 0 },
    discrepancies: [],
    route: { overallRouteRiskScore: 0 },
  };
  const postTx = (matchedName: string) => ({
    wasListedAtTransactionTime: false,
    hasPostTransactionDesignations: true,
    possibleMatchCount: 0,
    temporalMatches: [
      { temporalStatus: 'ADDED_AFTER_TRANSACTION', designationDate: '2027-01-01', matchedName, searchedName: matchedName, sanctionsList: 'OFAC', programs: [], legalExplanation: '', matchConfidence: 1, recommendedAction: '', wasListedAtTransactionTime: false },
    ],
  });
  const withPost = engine.calculateScoresAndDecision({ ...scoringBase, temporal: postTx('Acme Trading') });
  assert.strictEqual(withPost.decision.decision, 'BLOCK_ESCALATE', 'a later designation of one party does not hide an embargoed route');
  assert.ok(withPost.riskScores.sanctions >= 90);

  const postOnly = engine.calculateScoresAndDecision({
    ...scoringBase,
    sanctions: { ...scoringBase.sanctions, status: 'CONFIRMED_MATCH', overallSanctionsRiskScore: 100, jurisdictionRisks: [], matches: [{ entityOrSubject: 'Acme Trading', matchedSanctionedName: 'Acme Trading', matchConfidence: 1, sanctionsList: 'OFAC_SDN' }] },
    temporal: postTx('Acme Trading'),
  });
  assert.notStrictEqual(postOnly.decision.decision, 'BLOCK_ESCALATE', 'the post-transaction listing itself still does not block retroactively');
  const postPlusOther = engine.calculateScoresAndDecision({
    ...scoringBase,
    sanctions: { ...scoringBase.sanctions, status: 'CONFIRMED_MATCH', overallSanctionsRiskScore: 100, jurisdictionRisks: [], matches: [{ entityOrSubject: 'Beta Carrier', matchedSanctionedName: 'Beta Carrier', matchConfidence: 1, sanctionsList: 'OFAC_SDN' }] },
    temporal: postTx('Acme Trading'),
  });
  assert.strictEqual(postPlusOther.decision.decision, 'BLOCK_ESCALATE', 'a confirmed hit on a different party still blocks');

  const unknown = engine.calculateScoresAndDecision({
    ...scoringBase,
    sanctions: { ...scoringBase.sanctions, status: 'UNKNOWN_INSUFFICIENT_DATA', overallSanctionsRiskScore: 40, jurisdictionRisks: [], screenedEntitiesCount: 0, screenedCountriesCount: 0 },
  });
  assert.strictEqual(unknown.decision.decision, 'REVIEW', 'nothing could be screened: that is a review, not an allow');
  assert.ok(unknown.decision.triggeredRules.includes('RULE_SANCTIONS_SCREENING_INCOMPLETE'));

  const unreadable = [
    'COMMERCIAL INVOICE',
    'Invoice No: INV-U-1',
    'Date: 13/06/2026',
    'Seller: Lahore Textile Mills Ltd',
    'Buyer: ؟؟؟؟',
    'Country of Origin: Pakistan',
    'Country of Destination: Sweden',
    '10 pcs @ USD 5.00 Cotton shirts',
    'Total Amount: USD 50.00',
  ].join('\n');
  const result = await new TradeComplianceExtractor().processTradeDocument({
    documentId: '00000000-0000-4000-8000-0000000000a1',
    filename: 'u.pdf',
    rawText: unreadable,
    rawBuffer: Buffer.from(unreadable),
    aiModel: 'heuristic',
  });
  assert.ok(result.sanctions.unscreenedNames?.length, 'a party name that cannot be compared is listed as not screened');
  assert.notStrictEqual(result.decision.decision, 'ALLOW', 'and the document is not allowed on that basis');
  console.log('✔ H2 Passed: embargo survives a later designation; unscreened parties force review.\n');

  // ------------------------------------------------------------------ H3 pricing
  assert.strictEqual(convertUnitPrice(950, 'MT', 'KG'), 0.95);
  assert.strictEqual(convertUnitPrice(0.95, 'KG', 'MT'), 950);
  assert.strictEqual(convertUnitPrice(141.6, 'DOZ', 'PCS'), 11.8);
  assert.strictEqual(convertUnitPrice(5, 'KG', 'MTR'), null, 'mass and length are not convertible');
  assert.strictEqual(convertUnitPrice(5, 'BOXES', 'PCS'), null, 'an unknown unit is not guessed');
  const fx = FxRatesService.getInstance();
  assert.strictEqual(fx.getConversionQuote(100, 'XYZ', 'USD').rateKnown, false, 'an unknown currency has no rate');
  assert.strictEqual(fx.getConversionQuote(100, 'USD', 'PKR').rateKnown, true);

  await ComplianceStore.getInstance().init();
  const goods = [
    line({ id: 'R1', itemNumber: 1, productDescription: 'Basmati rice 5% broken', quantity: 100, unitOfMeasure: 'MT', unitPrice: 950, totalLineValue: 95000 }),
    line({ id: 'R2', itemNumber: 2, productDescription: 'Basmati rice 5% broken', quantity: 100000, unitOfMeasure: 'KG', unitPrice: 0.95, totalLineValue: 95000 }),
    line({ id: 'R3', itemNumber: 3, productDescription: 'Electric rice cooker 1.8L', quantity: 1000, unitOfMeasure: 'PCS', unitPrice: 25, totalLineValue: 25000 }),
    line({ id: 'R4', itemNumber: 4, productDescription: 'Price adjustment fee', quantity: 1, unitOfMeasure: 'PCS', unitPrice: 40, totalLineValue: 40 }),
    line({ id: 'S1', itemNumber: 5, productDescription: 'Cotton shirts men woven', quantity: 100, unitOfMeasure: 'DOZ', unitPrice: 141.6, totalLineValue: 14160 }),
    line({ id: 'S2', itemNumber: 6, productDescription: 'Cotton shirts men woven', quantity: 1000, unitOfMeasure: 'PCS', unitPrice: 11.8, totalLineValue: 11800, currency: 'XYZ' }),
    line({ id: 'S3', itemNumber: 7, productDescription: 'Cotton shirts men woven', quantity: 1000, unitOfMeasure: 'PCS', unitPrice: 30, totalLineValue: 30000 }),
  ];
  const priced = await new PricingIntelligenceService().evaluatePricingIntelligence({ goods, currency: 'USD', incoterm: 'FOB', destinationCountry: 'Pakistan' });
  const by = Object.fromEntries(priced.map((p) => [p.lineItemId, p]));
  assert.strictEqual(by['R1']!.classification, 'WITHIN_EXPECTED_RANGE', 'USD 950 per MT of rice is the benchmark, not a 99.9% under-invoice');
  assert.strictEqual(by['R2']!.classification, 'WITHIN_EXPECTED_RANGE', 'the same price quoted per kilogram agrees');
  assert.strictEqual(by['R3']!.hasMarketData, false, 'a rice cooker is not rice');
  assert.strictEqual(by['R4']!.hasMarketData, false, '"price" is not "rice"');
  assert.strictEqual(by['S1']!.classification, 'WITHIN_EXPECTED_RANGE', 'a dozen-priced shirt converts to the per-piece benchmark');
  assert.strictEqual(by['S2']!.classification, 'INSUFFICIENT_MARKET_DATA', 'a price in a currency with no rate is not comparable');
  assert.ok(/NOT COMPARABLE/.test(by['S2']!.explanation));
  assert.strictEqual(by['S3']!.classification, 'HIGH_PRICE_ANOMALY', 'a genuine over-invoice is still found');
  console.log('✔ H3 Passed: prices compare per the benchmark unit and currency; look-alike words do not match.\n');

  // ------------------------------------------------------------------ H4 archive scope, stored original, erasure
  assert.throws(() => resolveHistoryScope({}, { requireScope: true }), /Say what to archive/, 'no criteria is not "everything"');
  assert.throws(() => resolveHistoryScope({ fromDate: 'garbage' }, { requireScope: true }), /not a valid date/);
  assert.throws(() => resolveHistoryScope({ ids: ['not-a-uuid'] }, { requireScope: true }), /document ids/);
  assert.throws(() => resolveHistoryScope({ fromDate: '2026-02-01', toDate: '2026-01-01' }, { requireScope: true }), /must not be after/);
  assert.strictEqual(resolveHistoryScope({ all: true }, { requireScope: true }).all, true);

  const repo = new MemoryDocumentRepository();
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ];
  const stamp = (d: string) => `${d}T12:00:00.000Z`;
  const dates = ['2026-01-10', '2026-02-10', '2026-03-10'];
  for (const [i, id] of ids.entries()) await repo.create({ id, customerId: 'c1', contentHash: id, uploadedAt: stamp(dates[i]!), units: [], progress: createInitialProgress(), status: 'uploaded', filename: `${id}.pdf`, fileType: 'pdf', fileSize: 1, mimeType: 'application/pdf', storagePath: null } as unknown as DocumentRecord);
  await assert.rejects(() => repo.deleteBatch({}), /Say what to archive/);
  assert.strictEqual((await repo.deleteBatch({ ids: [ids[0]!] })).deletedCount, 1, 'by id: only that document');
  assert.strictEqual((await repo.list(10, 0)).total, 2, 'the others are untouched');
  assert.strictEqual((await repo.deleteBatch({ fromDate: '2026-02-01', toDate: '2026-02-28' })).deletedCount, 1, 'a date range archives only the range');
  assert.strictEqual((await repo.restoreBatch({ ids: [ids[0]!] })).restoredCount, 1);
  await repo.saveSourceFile(ids[2]!, Buffer.from('%PDF-original-bytes'));
  assert.strictEqual((await repo.loadSourceFile(ids[2]!))?.toString(), '%PDF-original-bytes', 'the original is stored outside the record');
  assert.strictEqual(await repo.hasSourceFile(ids[1]!), false);
  assert.ok((await repo.listAllIds()).has(ids[1]!), 'the id list includes archived documents');
  assert.strictEqual(await repo.purge(ids[2]!), true);
  assert.strictEqual(await repo.loadSourceFile(ids[2]!), null, 'purge removes the stored original');
  assert.strictEqual(await repo.findMeta(ids[2]!), null, 'and the record');
  console.log('✔ H4 Passed: nothing is archived by omission; originals live outside the record; purge erases.\n');

  // ------------------------------------------------------------------ H5 overrides
  const rules = ['RULE_TBML_RED_FLAGS_TRIGGERED'];
  const ok = (o: Partial<Parameters<typeof assertOverrideAllowed>[0]>) =>
    assertOverrideAllowed({ action: 'APPROVE_WITH_REVIEW', officerRole: 'TBML_RISK_ANALYST', current: 'REVIEW', requested: 'ALLOW', reason: 'Customer verified the goods against the PO', triggeredRules: rules, ...o });
  assert.strictEqual(ok({}), 'ALLOW', 'an analyst may clear a REVIEW with a reason');
  assert.throws(() => ok({ action: 'ADD_INVESTIGATION_NOTE', current: 'BLOCK_ESCALATE', requested: 'ALLOW' }), /note cannot change/, 'a note cannot flip a decision');
  assert.throws(() => ok({ action: 'ESCALATE', requested: 'ALLOW' }), /cannot produce/);
  assert.throws(() => ok({ action: 'MARK_FALSE_POSITIVE', current: 'BLOCK_ESCALATE', requested: 'ALLOW' }), /one step/, 'a block goes to REVIEW first');
  assert.throws(() => ok({ action: 'MARK_FALSE_POSITIVE', current: 'BLOCK_ESCALATE', requested: 'REVIEW' }), /Chief Compliance Officer/, 'only the CCO lowers a block');
  assert.throws(
    () => ok({ action: 'MARK_FALSE_POSITIVE', officerRole: 'CHIEF_COMPLIANCE_OFFICER', current: 'BLOCK_ESCALATE', requested: 'REVIEW', reason: 'too short', triggeredRules: rules }),
    /at least 30/,
  );
  assert.strictEqual(
    ok({ action: 'MARK_FALSE_POSITIVE', officerRole: 'CHIEF_COMPLIANCE_OFFICER', current: 'BLOCK_ESCALATE', requested: 'REVIEW', reason: 'Name collision confirmed against passport data, see file 88', triggeredRules: rules }),
    'REVIEW',
  );
  assert.throws(
    () => ok({ action: 'MARK_FALSE_POSITIVE', officerRole: 'CHIEF_COMPLIANCE_OFFICER', current: 'BLOCK_ESCALATE', requested: 'REVIEW', reason: 'Name collision confirmed against passport data, see file 88', triggeredRules: ['RULE_SANCTIONS_CONFIRMED_MATCH'] }),
    (e: unknown) => e instanceof AppError && e.code === 'OVERRIDE_NOT_PERMITTED',
    'a sanctions prohibition cannot be overridden at all',
  );
  assert.strictEqual(ok({ action: 'ESCALATE_TO_COMPLIANCE', current: 'BLOCK_ESCALATE', requested: 'REVIEW' }), 'BLOCK_ESCALATE', 'escalating never lowers');
  console.log('✔ H5 Passed: overrides fit the action, move one step, and never lift a sanctions block.\n');

  // ------------------------------------------------------------------ H6 secrets and demo defaults
  const runConfig = (env: Record<string, string>): { secret: boolean; apiKey: boolean; demo: boolean; host: string; problems: string[]; threw?: string } => {
    const tsx = require.resolve('tsx/cli');
    const code = `
      process.env.PERSIST_TO_DISK='false';
      try {
        const c = require(${JSON.stringify(path.resolve(__dirname, '../config'))});
        let threw;
        try { c.ensureRuntimeDirectories(); } catch (e) { threw = String(e.message); }
        console.log(JSON.stringify({ secret: Boolean(c.config.auth.secret), apiKey: Boolean(c.config.auth.apiKey), demo: c.config.auth.demoLoginEnabled, host: c.config.server.host, problems: c.secretProblems, threw }));
      } catch (e) { console.log(JSON.stringify({ fatal: String(e) })); }`;
    // Every variable the config reads is pinned, so a developer's own .env cannot change the outcome.
    const out = execFileSync(process.execPath, [tsx, '-e', code], {
      env: { PATH: process.env['PATH'] ?? '', SystemRoot: process.env['SystemRoot'] ?? '', TEMP: os.tmpdir(), UPLOAD_DIR: path.join(os.tmpdir(), 'tg-cfg-up'), DATA_DIR: path.join(os.tmpdir(), 'tg-cfg-data'), IMAGES_DIR: path.join(os.tmpdir(), 'tg-cfg-img'), HOST: '127.0.0.1', ENABLE_DEMO_LOGIN: '', AUTH_SECRET: '', JWT_SECRET: '', API_SECRET_KEY: '', API_KEY: '', ...env },
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '../..'),
    });
    return JSON.parse(out.trim().split('\n').pop()!);
  };
  const placeholder = runConfig({ NODE_ENV: 'production', AUTH_SECRET: 'your_super_secret_jwt_hmac_signing_key_here' });
  assert.ok(placeholder.threw && /AUTH_SECRET/.test(placeholder.threw), 'production refuses to start on the example signing key');
  const shortSecret = runConfig({ NODE_ENV: 'production', AUTH_SECRET: 'abc123' });
  assert.ok(shortSecret.threw, 'and on a short one');
  const goodSecret = runConfig({ NODE_ENV: 'production', AUTH_SECRET: 'f3a9c4e1b7d2486a9c0e5b1d7f2a8c43e6b9d0a1c5f7e2b4' });
  assert.strictEqual(goodSecret.threw, undefined);
  assert.strictEqual(goodSecret.demo, false, 'demo accounts are off in production');
  const placeholderKey = runConfig({ NODE_ENV: 'development', AUTH_SECRET: 'f3a9c4e1b7d2486a9c0e5b1d7f2a8c43e6b9d0a1c5f7e2b4', API_SECRET_KEY: 'your_bank_api_gateway_secret_key_here' });
  assert.strictEqual(placeholderKey.apiKey, false, 'the example API key is ignored, not accepted');
  assert.strictEqual(runConfig({ NODE_ENV: 'development' }).demo, true, 'a local development run keeps demo accounts');
  assert.strictEqual(runConfig({ NODE_ENV: 'development', HOST: '0.0.0.0' }).demo, false, 'but not when it listens on the network');
  assert.strictEqual(runConfig({ NODE_ENV: 'development', HOST: '0.0.0.0', ENABLE_DEMO_LOGIN: 'true' }).demo, true, 'unless asked for explicitly');
  assert.strictEqual(runConfig({ NODE_ENV: 'development' }).host, '127.0.0.1', 'the default host is loopback');
  console.log('✔ H6 Passed: placeholder/short secrets are refused; demo login needs loopback or an explicit opt-in.\n');

  // ------------------------------------------------------------------ H7 sign-in
  const hash = hashPassword('correct horse battery staple');
  assert.ok(hash.startsWith('scrypt$'), 'hashes name their own cost');
  assert.strictEqual(hash.split('$').length, 6);
  assert.strictEqual(await verifyPassword('correct horse battery staple', hash), true);
  assert.strictEqual(await verifyPassword('wrong', hash), false);
  assert.strictEqual(await verifyPassword('x', 'scrypt$not$valid'), false, 'a malformed hash fails closed');
  const crypto = await import('node:crypto');
  const legacySalt = crypto.randomBytes(16);
  const legacy = `scrypt$${legacySalt.toString('base64url')}$${crypto.scryptSync('old-password-123', legacySalt, 32).toString('base64url')}`;
  assert.strictEqual(await verifyPassword('old-password-123', legacy), true, 'hashes from earlier builds still verify');

  resetLoginThrottle();
  for (let i = 0; i < 4; i += 1) recordLoginFailure('victim@bank.com');
  assert.strictEqual(loginRetryAfterSeconds('victim@bank.com'), 0, 'four failures do not lock');
  recordLoginFailure('victim@bank.com');
  assert.ok(loginRetryAfterSeconds('victim@bank.com') > 0, 'the fifth locks the account');
  assert.ok(loginRetryAfterSeconds('VICTIM@bank.com') > 0, 'regardless of letter case');
  assert.strictEqual(loginRetryAfterSeconds('someone-else@bank.com'), 0, 'and only that account');
  recordLoginSuccess('victim@bank.com');
  assert.strictEqual(loginRetryAfterSeconds('victim@bank.com'), 0);
  resetLoginThrottle();

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (p: string, token?: string, init: RequestInit = {}) => {
    const res = await fetch(apiBase + p, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    return { status: res.status, headers: res.headers, body: (await res.json().catch(() => null)) as Record<string, Loose> | null };
  };
  const post = (p: string, token: string | undefined, body: unknown) => call(p, token, { method: 'POST', body: JSON.stringify(body) });

  try {
    for (let i = 0; i < 5; i += 1) {
      const r = await post('/auth/login', undefined, { email: 'sara.khan@tradeguard.ai', password: 'wrong-wrong-wrong' });
      assert.strictEqual(r.status, 401);
    }
    const locked = await post('/auth/login', undefined, { email: 'sara.khan@tradeguard.ai', password: 'wrong-wrong-wrong' });
    assert.strictEqual(locked.status, 429, 'the account is locked after repeated failures');
    assert.strictEqual(locked.body?.['error']?.code, 'TOO_MANY_ATTEMPTS');
    const lockedRight = await post('/auth/login', undefined, { email: 'sara.khan@tradeguard.ai', password: 'TradeGuard-Demo-2026' });
    assert.strictEqual(lockedRight.status, 429, 'even the right password waits out the lock');
    resetLoginThrottle();

    const login = await post('/auth/login', undefined, { email: 'ramis.ali@tradeguard.ai', password: 'TradeGuard-Demo-2026' });
    assert.strictEqual(login.status, 200);
    const token = login.body!['token'] as string;
    assert.strictEqual((await call('/auth/me', token)).status, 200);
    assert.strictEqual((await post('/auth/logout', token, {})).status, 204);
    const afterLogout = await call('/auth/me', token);
    assert.strictEqual(afterLogout.status, 401, 'a signed-out token stops working');
    assert.strictEqual(afterLogout.body?.['error']?.code, 'SESSION_REVOKED');
    // AUDIT-006: the one-click demo sign-in has its own bucket, so a rehearsal cannot lock anyone out of the real one.
    const demoKeys = ['trade_maker', 'corporate_customer', 'post_trade_officer'] as const;
    for (let i = 0; i < 25; i += 1) assert.strictEqual((await post('/auth/demo-login', undefined, { account: demoKeys[i % 3] })).status, 200, `demo sign-in ${i + 1} is not throttled`);
    assert.strictEqual((await post('/auth/login', undefined, { email: 'ramis.ali@tradeguard.ai', password: 'TradeGuard-Demo-2026' })).status, 200, 'and the password sign-in still works after them');
    console.log('✔ H7 Passed: hashing is async and self-describing; accounts lock after repeated failures; sign-out kills the token.\n');

    // ---------------------------------------------------------------- H8 reference data
    const submitter = signBankingToken(account('operations_desk'), 1);
    const approver = signBankingToken(account('compliance_officer'), 1);
    const reviewer = signBankingToken(account('risk_analyst'), 1);

    const entry = (name: string, externalId: string) => ({ data: { canonicalName: name, externalId, sourceId: 'MANUAL_COMPLIANCE', entityType: 'ENTITY', validFrom: '2026-01-01' }, notes: 'internal watchlist' });
    const s1 = await post('/import/sanctions', submitter, entry('Harbour Trading Test One', 'HT-1'));
    assert.strictEqual(s1.status, 202, 'a change is queued, not applied');
    assert.strictEqual(s1.body?.['status'], 'PENDING_APPROVAL');
    const changeId = s1.body!['changeRequest'].changeId as string;
    assert.strictEqual((await ComplianceStore.getInstance().listMasterEntities('sanctions', { search: 'Harbour Trading Test One' })).total, 0, 'nothing changed before approval');

    const spoof = await post('/import/sanctions', submitter, { ...entry('Spoofed Actor Test', 'HT-9'), importedBy: 'SOMEONE_ELSE' });
    assert.strictEqual(spoof.body?.['changeRequest'].requestedBy.id, account('operations_desk').id, 'the submitter is the signed-in user, not a body field');

    assert.strictEqual((await post(`/import/changes/${changeId}/decision`, submitter, { approve: true, rationale: 'approving my own change' })).status, 403, 'the operations desk cannot approve anything');
    const selfApprove = signBankingToken(account('compliance_officer'), 1);
    const own = await post('/import/sanctions', selfApprove, entry('Own Change Test', 'HT-2'));
    assert.strictEqual((await post(`/import/changes/${own.body!['changeRequest'].changeId}/decision`, selfApprove, { approve: true, rationale: 'approving my own change' })).status, 403, 'nobody approves their own change');
    assert.strictEqual((await post(`/import/changes/${changeId}/decision`, approver, { approve: true, rationale: 'short' })).status, 400, 'a rationale is required');

    const decided = await post(`/import/changes/${changeId}/decision`, approver, { approve: true, rationale: 'Verified against the internal watchlist memo 2026-14' });
    assert.strictEqual(decided.status, 200);
    assert.strictEqual(decided.body?.['changeRequest'].status, 'APPLIED');
    assert.strictEqual((await post(`/import/changes/${changeId}/decision`, approver, { approve: true, rationale: 'deciding it twice' })).status, 409, 'a change is decided once');

    const second = await post('/import/sanctions', submitter, entry('Second Entry Test Two', 'HT-3'));
    await post(`/import/changes/${second.body!['changeRequest'].changeId}/decision`, reviewer, { approve: true, rationale: 'Second watchlist entry, memo 2026-15' });
    const found = await ComplianceStore.getInstance().listMasterEntities('sanctions', { search: 'test' });
    const names = found.items.map((i: Loose) => i.canonicalName);
    assert.ok(names.includes('Harbour Trading Test One') && names.includes('Second Entry Test Two'), 'two manual entries both persist (they used to overwrite each other)');
    assert.ok(found.items.every((i: Loose) => typeof i.canonicalId === 'string' && i.canonicalId.includes(':v')), 'each is a versioned record');

    const audit = (await ComplianceStore.getInstance().getAuditLogs(20, 'sanctions')).find((l) => l.notes?.includes(changeId));
    assert.ok(audit?.approvedBy?.includes(account('compliance_officer').name), 'the audit log names the approver');
    assert.ok(audit?.actor.includes(account('operations_desk').id), 'and the submitter, from the token');

    // an edit is a new version; the earlier one is closed, not overwritten
    const edit = await post('/import/sanctions', submitter, { data: { canonicalName: 'Harbour Trading Test One', externalId: 'HT-1', sourceId: 'MANUAL_COMPLIANCE', entityType: 'ENTITY', validFrom: '2026-01-01', aliases: ['HT One'] }, isPatchDetails: false });
    await post(`/import/changes/${edit.body!['changeRequest'].changeId}/decision`, approver, { approve: true, rationale: 'Added the trading alias per memo 2026-16' });
    const versions = ComplianceStore.getInstance().getEntitiesForSource('MANUAL_COMPLIANCE').filter((e) => e.externalId === 'ENT-MANUAL_COMPLIANCE-HT-1');
    assert.strictEqual(versions.length, 2, 'the earlier version is kept');
    assert.strictEqual(versions.filter((v) => v.isCurrent).length, 1, 'exactly one is current');

    // feed-sourced entries cannot be hand-edited
    await ComplianceStore.getInstance().saveSource({ ...(await ComplianceStore.getInstance().getSourceById('OFAC_SDN'))!, dataOrigin: 'LIVE_FEED' });
    await assert.rejects(
      () => ImportBatchService.getInstance().commitSingleRecord('sanctions', { canonicalName: 'Feed Entry', externalId: 'F-1', sourceId: 'OFAC_SDN', entityType: 'ENTITY', validFrom: '2026-01-01' }, { actor: 'test' }),
      /cannot be edited here/,
    );

    assert.strictEqual(sanitizeForCsvInjection('=1+1'), "'=1+1");
    assert.strictEqual(sanitizeForCsvInjection('@SUM(A1)'), "'@SUM(A1)");
    assert.strictEqual(sanitizeForCsvInjection("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
    assert.strictEqual(sanitizeForCsvInjection('-5'), '-5', 'a negative number is left alone');
    assert.strictEqual(sanitizeForCsvInjection('+92-300-1234567'), '+92-300-1234567', 'so is a phone number');
    assert.strictEqual(MasterDataChangeService.getInstance().list('PENDING').length >= 2, true);
    console.log('✔ H8 Passed: reference data needs a second person; actors come from the token; manual entries are versioned.\n');

    // ---------------------------------------------------------------- H9 archives
    const entriesOk = [
      { name: '[Content_Types].xml', compressed: 300, uncompressed: 900 },
      { name: 'word/document.xml', compressed: 4000, uncompressed: 30000 },
    ];
    assert.strictEqual(isWordDocument(listZipEntries(zipWith(entriesOk))), true);
    assert.strictEqual(zipBombReason(listZipEntries(zipWith(entriesOk))), null);
    assert.ok(zipBombReason(listZipEntries(zipWith([...entriesOk, { name: 'word/media/bomb.bin', compressed: 40_000, uncompressed: 90 * 1024 * 1024 }]))), 'a 2000:1 entry is refused');
    assert.ok(zipBombReason(listZipEntries(zipWith([{ name: 'a', compressed: 1_000_000, uncompressed: 300 * 1024 * 1024 }]))), 'an entry that expands past the cap is refused');
    assert.strictEqual(isWordDocument(listZipEntries(zipWith([{ name: '[Content_Types].xml', compressed: 1, uncompressed: 1 }, { name: 'xl/workbook.xml', compressed: 1, uncompressed: 1 }]))), false, 'a spreadsheet is not a Word file');
    const notWord = (e: unknown) => e instanceof AppError && e.code === 'UNSUPPORTED_FILE_TYPE' && /WordprocessingML/.test(e.internal ?? '');
    assert.strictEqual(detectFileType(zipWith(entriesOk), 'a.docx'), 'docx');
    assert.throws(() => detectFileType(zipWith([{ name: 'word/', compressed: 0, uncompressed: 0 }, { name: '[Content_Types].xml', compressed: 1, uncompressed: 1 }]), 'a.docx'), notWord, 'mentioning "word/" is not enough');
    assert.throws(() => detectFileType(Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(100)]), 'a.docx'), notWord, 'a truncated archive is refused');
    // A scanned page is an image with no text. The PDF reader upgrade made image objects arrive lazily; if they are
    // not waited for, the page reads as empty and the document is rejected instead of being sent to OCR.
    const png = new PNG({ width: 160, height: 160 });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = i % 251;
      png.data[i + 1] = (i >> 2) % 241;
      png.data[i + 2] = 128;
      png.data[i + 3] = 255;
    }
    const scanned = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: 'A4' });
      const chunks: Buffer[] = [];
      pdf.on('data', (c: Buffer) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
      pdf.image(PNG.sync.write(png), 50, 50, { width: 300 });
      pdf.end();
    });
    const scannedResult = await new PdfExtractor().extract(scanned);
    assert.ok((scannedResult.extractedImages?.length ?? 0) >= 1, 'an image-only PDF yields its image for OCR');
    console.log('✔ H9 Passed: archives are judged before they are unpacked, and a Word file must really be one.\n');

    // erasure is its own permission, with a reason and an explicit confirmation
    const ghost = '99999999-9999-4999-8999-999999999999';
    const purgeBody = { reason: 'Customer withdrew consent; erasure approved by the DPO under ticket 4411', confirm: true };
    assert.strictEqual((await post(`/documents/${ghost}/purge`, reviewer, purgeBody)).status, 403, 'an analyst cannot erase');
    assert.strictEqual((await post(`/documents/${ghost}/purge`, approver, { ...purgeBody, reason: 'no' })).status, 400, 'a reason is required');
    assert.strictEqual((await post(`/documents/${ghost}/purge`, approver, { reason: purgeBody.reason })).status, 400, 'and an explicit confirmation');
    assert.strictEqual((await post(`/documents/${ghost}/purge`, approver, purgeBody)).status, 404, 'the CCO may, once those are given');

    // ---------------------------------------------------------------- H10 honesty of reports, health, fraud history
    const blockedText =
      'COMMERCIAL INVOICE\nInvoice No: INV-2026-0777 Date: 02/03/2026 Seller: Karachi Industrial Supplies Ltd ' +
      'Buyer: Banco Nacional de Cuba Country of Origin: Pakistan Country of Destination: Cuba ' +
      '50 pcs @ USD 400.00 Industrial valves Total Amount: USD 20,000.00';
    const blocked = await new TradeComplianceExtractor().processTradeDocument({
      documentId: '00000000-0000-4000-8000-0000000000b1',
      filename: 'cuba.pdf',
      rawText: blockedText,
      rawBuffer: Buffer.from(blockedText),
      aiModel: 'heuristic',
    });
    assert.strictEqual(blocked.decision.decision, 'BLOCK_ESCALATE');
    const model = buildComplianceReportModel({
      id: '00000000-0000-4000-8000-0000000000b1',
      filename: 'cuba.pdf',
      uploadedAt: new Date().toISOString(),
      analysis: { tradeCompliance: blocked, summary: { headline: '', narrative: '', highlights: [] }, statistics: {}, engine: {}, timing: {}, completedAt: new Date().toISOString() },
      extraction: { pageCount: 1 },
    } as unknown as DocumentRecord);
    const clearance = model.regulatoryProvenance.openSanctionsClearance;
    assert.notStrictEqual(clearance.verdict, 'NO_MATCH', 'a blocked document is never reported as cleared');
    assert.ok(!/CLEARED|ZERO MATCHES/i.test(clearance.status), 'and the wording does not say so');
    assert.ok(!('entitiesCoveredCount' in clearance), 'the invented "1,224,672 entities" is gone');
    assert.ok(!/OPENSANCTIONS-GLOBAL/i.test(clearance.datasetVersion), 'the dataset version is the real one');
    assert.ok(model.regulatoryProvenance.liveFxQuote.convertedAmountFormatted.length > 0);

    const health = await call('/health');
    assert.deepStrictEqual(Object.keys(health.body!).sort(), ['status', 'timestamp'], 'the public probe says only that it is alive');
    assert.strictEqual((await call('/health/details')).status, 401, 'detail needs a signed-in user');
    const details = await call('/health/details', approver);
    assert.strictEqual(details.status, 200);
    assert.ok(details.body!['engine'] && details.body!['queue']);
    assert.ok(!('environment' in details.body!), 'the environment name is not exposed');
    assert.strictEqual(health.headers.get('cache-control'), 'no-store');
    assert.match(health.headers.get('content-security-policy') ?? '', /default-src 'none'/, 'the API sends a deny-all content security policy');
    assert.strictEqual((await call('/documents', approver)).headers.get('cache-control'), 'no-store', 'private responses are never cached');

    const registryFile = path.join(os.tmpdir(), `tg-registry-${Date.now()}.json`);
    const registry = TransactionRegistry.getInstance();
    registry.resetForTesting();
    await registry.attachPersistence(registryFile);
    registry.recordIdentifier(
      { type: 'INVOICE_NUMBER', normalizedValue: 'INV-H10', sourceDocumentId: 'doc-1', sourceDocumentName: 'a.pdf' } as Loose,
      { transactionId: 'T-1', customerId: 'c1', beneficiary: 'Seller A' },
    );
    await registry.flush();
    registry.resetForTesting();
    assert.strictEqual(registry.getIdentifierHistory('INVOICE_NUMBER' as Loose, 'INV-H10'), null, 'a restart empties the memory');
    await registry.attachPersistence(registryFile);
    assert.strictEqual(registry.getIdentifierHistory('INVOICE_NUMBER' as Loose, 'INV-H10')?.appearancesCount, 1, 'but the invoice history is read back from disk');
    fs.rmSync(registryFile, { force: true });
    console.log('✔ H10 Passed: reports state what the screening found; health is minimal; fraud history survives a restart.\n');

    // ---------------------------------------------------------------- H12 "sync all" runs in the background (AUDIT-008)
    const syncer = signBankingToken(account('operations_desk'), 1);
    const reader = signBankingToken(account('trade_maker'), 1);
    assert.strictEqual((await post('/documents/compliance/sources/sync-all', reader, {})).status, 403, 'reading the feeds is not permission to start a sync');
    assert.strictEqual((await call('/documents/compliance/sources/sync-all/status')).status, 401, 'anonymous callers cannot read the status');
    const startedAt = Date.now();
    const started = await post('/documents/compliance/sources/sync-all', syncer, {});
    assert.strictEqual(started.status, 202, 'the request is accepted, not held until every feed has been downloaded');
    assert.ok(Date.now() - startedAt < 3000, 'and it answers at once');
    assert.strictEqual(started.body?.['started'], true);
    const again = await post('/documents/compliance/sources/sync-all', syncer, {});
    assert.strictEqual(again.status, 202);
    assert.ok(again.body?.['started'] === false || (again.body?.['batch'] as { state?: string } | undefined)?.state === 'FINISHED', 'a second request while one runs joins it instead of starting another');
    type SyncBatch = { state?: string; runs?: Array<{ status?: unknown }>; actor?: string };
    let batch: SyncBatch | null = null;
    for (const deadline = Date.now() + 90_000; Date.now() < deadline; ) {
      batch = ((await call('/documents/compliance/sources/sync-all/status', reader)).body?.['batch'] as SyncBatch | undefined) ?? null;
      if (batch?.state === 'FINISHED') break;
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.strictEqual(batch?.state, 'FINISHED', `the batch finishes and says so (last seen: ${JSON.stringify(batch)?.slice(0, 400)})`);
    assert.ok(Array.isArray(batch?.runs) && batch.runs.length > 0 && batch.runs.every((r) => typeof r.status === 'string'), 'with each source\'s own recorded outcome, so a failure is never reported as success');
    assert.strictEqual(batch?.actor, account('operations_desk').email, 'and who started it');
    console.log('✔ H12 Passed: sync-all is accepted at once, runs once at a time in the background, and its per-source outcome is readable (AUDIT-008).\n');
  } finally {
    server.close();
  }

  // ------------------------------------------------------------------ H11 keyed audit chain
  const chainTool = (env: Record<string, string>, body: string): Record<string, Loose> => {
    const tsx = require.resolve('tsx/cli');
    const hashChainPath = JSON.stringify(path.resolve(__dirname, '../utils/hash-chain'));
    const out = execFileSync(process.execPath, [tsx, '-e', `const hc = require(${hashChainPath}); ${body}`], {
      env: { PATH: process.env['PATH'] ?? '', SystemRoot: process.env['SystemRoot'] ?? '', PERSIST_TO_DISK: 'false', HOST: '127.0.0.1', AUDIT_HMAC_KEY: '', AUTH_SECRET: '', ...env },
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '../..'),
    });
    return JSON.parse(out.trim().split('\n').pop()!);
  };
  const KEY_A = 'a-very-long-audit-key-held-outside-the-database-0123456789';
  const KEY_B = 'another-very-long-audit-key-that-the-forger-guessed-0123456';
  const build = `
    const mk = (seq, prev, data) => { const b = { seq, prevHash: prev, data, ...hc.chainAlgorithmField() }; return { ...b, hash: hc.hashEntry(b) }; };
    const e1 = mk(1, hc.GENESIS_HASH, 'opened'); const e2 = mk(2, e1.hash, 'approved');`;
  const keyed = chainTool({ AUDIT_HMAC_KEY: KEY_A }, `${build} console.log(JSON.stringify({ e1, e2, ok: hc.verifyHashChain([e1, e2]).valid }));`);
  assert.strictEqual(keyed['e1'].alg, 'hmac-sha256', 'with a key, entries are HMACs');
  assert.strictEqual(keyed['ok'], true);
  const unkeyed = chainTool({}, `${build} console.log(JSON.stringify({ e1, ok: hc.verifyHashChain([e1, e2]).valid }));`);
  assert.strictEqual(unkeyed['e1'].alg, undefined, 'without one, the original SHA-256 scheme is unchanged');
  const entries = JSON.stringify([keyed['e1'], keyed['e2']]);
  const rewrite = `const [e1, e2] = ${entries}; const forged = { ...e2, data: 'rejected' }; const { hash, ...body } = forged; const rehashed = { ...forged, hash: hc.hashEntry(body) };`;
  assert.strictEqual(
    chainTool({ AUDIT_HMAC_KEY: KEY_B }, `${rewrite} console.log(JSON.stringify({ valid: hc.verifyHashChain([e1, rehashed]).valid }));`)['valid'],
    false,
    'someone who rewrites an entry and re-hashes it with a guessed key is caught',
  );
  const noKey = chainTool({}, `const [e1, e2] = ${entries}; const r = hc.verifyHashChain([e1, e2]); console.log(JSON.stringify(r));`);
  assert.strictEqual(noKey['valid'], false);
  assert.match(noKey['problem'], /audit key/, 'a server without the key says so instead of passing the chain');
  console.log('✔ H11 Passed: with an audit key, rewriting history consistently requires the key; unkeyed chains are unchanged.\n');

  // every demo account still exists after the identity changes
  assert.strictEqual(DEMO_ACCOUNT_KEYS.every((k) => Boolean(findDemoAccount(k))), true);

  console.log('================================================================');
  console.log('ALL HARDENING SCENARIOS PASSED');
  console.log('================================================================\n');
}

run().catch((error) => {
  console.error('HARDENING TEST FAILED:', error);
  process.exit(1);
});
