import './test-env';
import assert from 'node:assert';
import { parseTradeDate } from '../utils/trade-date';
import { matchNames, prepareName, CONFIRMED_MATCH_THRESHOLD } from '../compliance/sanctions/name-matching';
import {
  overrideConnectorForTesting,
  comtradeUnitValues,
  parseCsv,
  parseEuFsfCsv,
  parseNactaProscribedText,
  parseOfacSdnCsv,
  parseUkSanctionsCsv,
  parseUnLocodeCsv,
  parseUnConsolidatedXml,
  parseUsdBaseRatesJson,
  type FeedEntity,
} from '../compliance/sync/feed-connectors';
import { ComplianceStore } from '../compliance/db/compliance-store';
import { ComplianceSyncEngine } from '../compliance/sync/sync-engine.service';
import { freshnessOf } from '../compliance/sync/sync-scheduler.service';
import { SnapshotRegistry } from '../compliance/temporal/snapshot-registry';
import { getScreeningCoverage } from '../compliance/sanctions/screening-coverage';
import { TemporalSanctionsService } from '../compliance/sanctions/temporal-sanctions.service';
import { MathIntegrityService } from '../compliance/math-integrity.service';
import { TBMLService } from '../compliance/tbml.service';
import { PricingIntelligenceService } from '../compliance/pricing/pricing-intelligence.service';
import { TradeComplianceExtractor } from '../ai/trade-extractor';
import { authenticateCredentials, DEFAULT_DEV_DEMO_PASSWORD, findDemoAccount } from '../services/account-directory';
import { authenticate, signBankingToken } from '../middleware/auth.middleware';
import { isBlockedAddress, safeFetchText, UnsafeUrlError } from '../utils/safe-fetch';
import { toDetailView, type DocumentRecord } from '../models/document.model';
import type { CommodityLineItem, TradeParties } from '../compliance/types';

/**
 * Regression tests for the correctness fixes: transaction dates, sanctions name matching, real
 * feed parsing and bitemporal sync, pricing → TBML ordering, invoice arithmetic, the end-user
 * rule, authentication and SSRF. Everything runs offline against in-memory stores.
 */

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

async function run(): Promise<void> {
  console.log('\n================================================================');
  console.log('COMPLIANCE CORRECTNESS REGRESSION SUITE');
  console.log('================================================================\n');

  // ------------------------------------------------------------------ 1. dates
  assert.strictEqual(parseTradeDate('13/06/2026'), '2026-06-13T00:00:00.000Z', 'day-first numeric date');
  assert.strictEqual(parseTradeDate('05/06/2026'), '2026-06-05T00:00:00.000Z', 'ambiguous numeric date is day-first');
  assert.strictEqual(parseTradeDate('06/13/2026'), '2026-06-13T00:00:00.000Z', 'month-first only when day > 12');
  assert.strictEqual(parseTradeDate('2026-06-13'), '2026-06-13T00:00:00.000Z', 'ISO date');
  assert.strictEqual(parseTradeDate('13 Jun 2026'), '2026-06-13T00:00:00.000Z', 'day month-name year');
  assert.strictEqual(parseTradeDate('June 13th, 2026'), '2026-06-13T00:00:00.000Z', 'month-name day year');
  assert.strictEqual(parseTradeDate('13-06-26'), '2026-06-13T00:00:00.000Z', 'two-digit year');
  assert.strictEqual(parseTradeDate('31/02/2026'), null, 'impossible date rejected, not rolled over');
  assert.strictEqual(parseTradeDate('Not Found'), null, 'non-date rejected');
  console.log('✔ Scenario 1 Passed: Trade document dates parse day-first and reject impossible dates.');

  // ------------------------------------------------------------------ 2. name matching
  const exact = matchNames(prepareName('Bank Melli Iran PLC'), prepareName('BANK MELLI IRAN'));
  assert.strictEqual(exact?.kind, 'EXACT', 'legal-form suffix ignored for exact match');
  const contained = matchNames(prepareName('Bank Melli Iran Dubai Branch'), prepareName('Bank Melli Iran'));
  assert.ok(contained && contained.confidence < CONFIRMED_MATCH_THRESHOLD, 'containment is a possible match, not a confirmed listing');
  assert.strictEqual(matchNames(prepareName('Analuxe Trading LLC'), prepareName('NALU')), null, 'short alias is never a substring hit');
  assert.strictEqual(matchNames(prepareName('Star Shipping Lines'), prepareName('STAR')), null, 'single short token never matches inside a longer name');
  assert.strictEqual(
    matchNames(prepareName('Al Noor Trading LLC'), prepareName('AL NOOR'))?.kind !== 'EXACT',
    true,
    'descriptive words are not stripped into an exact match',
  );
  assert.ok((matchNames(prepareName('Sovcomflott'), prepareName('Sovcomflot'))?.confidence ?? 0) >= 0.85, 'one-letter typo on a long name is caught');
  console.log('✔ Scenario 2 Passed: Sanctions name matching is token-based and never substring-based.');

  // ------------------------------------------------------------------ 3. feed parsers
  assert.deepStrictEqual(parseCsv('a,"b, c","d ""q"""\n1,2,3'), [['a', 'b, c', 'd "q"'], ['1', '2', '3']], 'RFC 4180 CSV');
  const sdn =
    '36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- \n' +
    '15036,"ARTAVIL","vessel","IRAN",-0- ,"T2EU4","Crude/Oil Products Tanker","99,144","56,068","Iran",-0- ,"Vessel Registration Identification IMO 9187629; MMSI 572469210."\n' +
    '906,"HAVIN BANK LIMITED",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"SWIFT/BIC HAVIGB2L; Website www.example.co.uk."\n';
  const alt = '36,12,"aka","AERO-CARIBBEAN",-0- \n15036,99,"fka","ALPHA",-0- \n';
  const ofac = parseOfacSdnCsv(sdn, alt);
  assert.strictEqual(ofac.length, 3, 'three SDN rows parsed');
  assert.deepStrictEqual(ofac[0]?.aliases, ['AERO-CARIBBEAN'], 'aliases joined from ALT.CSV');
  assert.strictEqual(ofac[1]?.entityType, 'VESSEL');
  assert.strictEqual(ofac[1]?.identifiers.imoNumber, '9187629', 'IMO number extracted from remarks');
  assert.strictEqual(ofac[2]?.entityType, 'BANK', 'SWIFT/BIC marks an entity as a bank');
  assert.strictEqual(ofac[2]?.identifiers.swiftBic, 'HAVIGB2L');

  const un = parseUnConsolidatedXml(
    '<CONSOLIDATED_LIST dateGenerated="2026-10-19T23:00:03.500Z"><INDIVIDUALS><INDIVIDUAL><DATAID>1</DATAID>' +
      '<FIRST_NAME>ERIC</FIRST_NAME><SECOND_NAME>BADEGE</SECOND_NAME><UN_LIST_TYPE>DRC</UN_LIST_TYPE>' +
      '<REFERENCE_NUMBER>CDi.001</REFERENCE_NUMBER><LISTED_ON>2012-12-31</LISTED_ON>' +
      '<NATIONALITY><VALUE>Democratic Republic of the Congo</VALUE></NATIONALITY>' +
      '<INDIVIDUAL_ALIAS><QUALITY/><ALIAS_NAME/></INDIVIDUAL_ALIAS></INDIVIDUAL></INDIVIDUALS>' +
      '<ENTITIES><ENTITY><DATAID>2</DATAID><FIRST_NAME>ADF</FIRST_NAME><UN_LIST_TYPE>DRC</UN_LIST_TYPE>' +
      '<REFERENCE_NUMBER>CDe.001</REFERENCE_NUMBER><LISTED_ON>2014-06-30</LISTED_ON>' +
      '<ENTITY_ALIAS><ALIAS_NAME>Allied Democratic Forces</ALIAS_NAME></ENTITY_ALIAS>' +
      '<ENTITY_ADDRESS><COUNTRY>Democratic Republic of the Congo</COUNTRY></ENTITY_ADDRESS></ENTITY></ENTITIES></CONSOLIDATED_LIST>',
  );
  assert.strictEqual(un.entities.length, 2, 'UN individual and entity parsed');
  assert.strictEqual(un.entities[0]?.name, 'ERIC BADEGE');
  assert.strictEqual(un.entities[0]?.listedOn, '2012-12-31', 'UN designation date kept');
  assert.deepStrictEqual(un.entities[1]?.aliases, ['Allied Democratic Forces']);

  const fx = parseUsdBaseRatesJson({ result: 'success', time_last_update_utc: 'Mon, 19 Oct 2026 00:02:31 +0000', rates: { USD: 1, PKR: 280.5, EUR: 0.89 } });
  assert.strictEqual(fx.effectiveDate, '2026-10-19', 'RFC 1123 timestamp converted to a real date');
  assert.strictEqual(fx.rates.find((r) => r.currencyCode === 'PKR')?.rateToUsd, 280.5);
  console.log('✔ Scenario 3 Passed: OFAC CSV, UN XML and FX feeds parse into canonical records.');

  // EU: semicolon CSV, one row per entity × name variant, quoted multi-line remarks.
  const euCsv =
    'fileGenerationDate;Entity_LogicalId;Entity_EU_ReferenceNumber;Entity_DesignationDate;Entity_Remark;Entity_SubjectType_ClassificationCode;Entity_Regulation_PublicationDate;Entity_Regulation_Programme;NameAlias_WholeName;Address_CountryDescription;Citizenship_CountryDescription;Identification_Number;Identification_TypeDescription\n' +
    '15/10/2026;13;EU.27.28;;"(UNSC RESOLUTION\n1483)";person;2003-07-08;IRQ;Saddam Hussein Al-Tikriti;;IRAQ;;\n' +
    '15/10/2026;13;EU.27.28;;;person;2003-07-08;IRQ;Abu Ali;;IRAQ;;\n' +
    '15/10/2026;99;EU.9.1;2022-03-15;SWIFT/BIC AGRULYLT;enterprise;;RUS;Example Bank JSC;RUSSIA;;;\n';
  const eu = parseEuFsfCsv(euCsv);
  assert.strictEqual(eu.entities.length, 2, 'EU rows grouped by entity');
  assert.deepStrictEqual(eu.entities[0]?.aliases, ['Abu Ali']);
  assert.strictEqual(eu.entities[0]?.listedOn, '2003-07-08', 'listing regulation date used when no designation date');
  assert.strictEqual(eu.entities[1]?.entityType, 'BANK');
  assert.strictEqual(eu.publishedAt, '2026-10-15');

  // UK: "Report Date" preamble, then one row per name variant.
  const ukCsv =
    'Report Date: 16-Oct-2026\n' +
    'Last Updated,Unique ID,Name 6,Name 1,Name 2,Name 3,Name 4,Name 5,Name type,Regime Name,Designation Type,Other Information,Address Country,Date Designated,Nationality(/ies),IMO number\n' +
    '04/08/2026,RUS1234,PETROV,Ivan,,,,,Primary Name,Russia,Individual,,,15/03/2022,Russia,\n' +
    '04/08/2026,RUS1234,PETROFF,Ivan,,,,,Alias,Russia,Individual,,,15/03/2022,Russia,\n' +
    '04/08/2026,RUS9001,OCEAN ARROW,,,,,,Primary Name,Russia,Ship,,,01/02/2025,,9123456\n';
  const uk = parseUkSanctionsCsv(ukCsv);
  assert.strictEqual(uk.entities.length, 2);
  assert.strictEqual(uk.entities[0]?.name, 'Ivan PETROV', 'name parts joined, primary name first');
  assert.deepStrictEqual(uk.entities[0]?.aliases, ['Ivan PETROFF']);
  assert.strictEqual(uk.entities[0]?.listedOn, '2022-03-15', 'day-first designation date');
  assert.strictEqual(uk.entities[1]?.entityType, 'VESSEL');
  assert.strictEqual(uk.entities[1]?.identifiers.imoNumber, '9123456');
  assert.strictEqual(uk.publishedAt, '2026-10-16');

  // NACTA: two columns, wrapped names, affiliates with a group date, a date-only row, page-2 sections.
  const t = (x: number, y: number, str: string) => ({ x, y, str });
  const nacta = parseNactaProscribedText([
    [
      t(100, 800, '3 Organizations Proscribed by Ministry of Interior u/s 11-B-(1)'),
      t(20, 780, 'S#'), t(305, 780, 'S#'),
      t(21, 760, '1'), t(35, 760, 'Lashkar-e-Jhangvi (LeJ)'), t(245, 760, '14 Aug, 2001'),
      t(305, 760, '2'), t(319, 760, 'Jamaat-ul-Da\'awa (JuD)'), t(536, 760, '05 March, 2019'),
      t(319, 750, 'Affiliated Organizations:'),
      t(319, 740, 'i. Al-Anfaal Trust, Lahore'), t(539, 735, '10 May, 2019'),
      t(319, 730, 'ii. Mosques & Welfare Trust, Lahore iii. Al Madina Foundation, Lahore'),
      t(35, 720, 'Khair-un-Naas International Trust (Splinter'),
      t(21, 710, '3'), t(245, 710, '27 Oct, 2004'),
      t(35, 700, 'Gp. of Jamat-ul-Da\'awa (JuD)'),
    ],
    [
      t(20, 437, '04 Organizations U/Watch by Ministry of Interior u/s 11-D-(1) r/w Schedule-II, ATA 1997'),
      t(23, 417, '1'), t(35, 417, 'Ghulaman-e-Sahaba (GS)'), t(236, 417, '30 May, 2017'),
      t(20, 377, '02 Organizations enlisted under UN Security Council Resolution No. 1267'),
      t(23, 356, '1'), t(35, 356, 'Al-Akhtar Trust'), t(237, 356, '01 Dec, 2005'),
      t(20, 332, 'NOTE:'), t(20, 324, 'This list is updated as of 06th October, 2024'),
    ],
  ]);
  const byId = new Map(nacta.entities.map((e) => [e.externalId, e]));
  assert.strictEqual(nacta.declaredCount, 3);
  assert.strictEqual(byId.get('NACTA-1')?.listedOn, '2001-08-14');
  assert.deepStrictEqual(byId.get('NACTA-1')?.aliases, ['LeJ'], 'bracketed acronym kept as alias');
  assert.strictEqual(byId.get('NACTA-3')?.name, "Khair-un-Naas International Trust (Splinter Gp. of Jamat-ul-Da'awa (JuD)", 'wrapped name around a number-only row');
  assert.strictEqual(byId.get('NACTA-2-i')?.listedOn, '2019-05-10', 'affiliates take the group date');
  assert.strictEqual(byId.get('NACTA-2-iii')?.name, 'Al Madina Foundation, Lahore', 'several affiliates on one line are split');
  assert.strictEqual(byId.get('NACTA-W-1')?.programs[0], 'ATA-1997-SCHEDULE-II-WATCH', 'watch-list section kept apart');
  assert.strictEqual(byId.get('NACTA-UN-1')?.name, 'Al-Akhtar Trust');
  assert.ok(![...byId.keys()].some((id) => /NACTA-(4|2)$/.test(id) && byId.get(id)!.name.includes('Organizations')), 'section headers are not organisations');

  // UN/LOCODE: seaports only, coordinates decoded.
  const ports = parseUnLocodeCsv(
    'Change,Country,Location,Name,NameWoDiacritics,Subdivision,Status,Function,Date,IATA,Coordinates,Remarks\n' +
      ',SG,SIN,Singapore,Singapore,,AI,12345---,0601,,0117N 10351E,\n' +
      ',AD,ALV,Andorra la Vella,Andorra la Vella,,AI,--34-6--,0601,,4230N 00131E,\n' +
      'X,PK,OLD,Old Port,Old Port,,AI,1-------,0601,,,\n',
  );
  assert.deepStrictEqual(ports.map((p) => p.locode), ['SGSIN'], 'only active seaports');
  assert.strictEqual(ports[0]?.latitude, 1.2833);

  // Comtrade: unit values only from reporters whose quantity is in a compatible unit.
  const unitValues = comtradeUnitValues(
    [
      { reporterCode: 586, qtyUnitCode: 5, qty: 1000, primaryValue: 6000 },
      { reporterCode: 156, qtyUnitCode: 5, qty: 2000, primaryValue: 10000 },
      { reporterCode: 380, qtyUnitCode: 8, qty: 50, primaryValue: 9000 },
    ],
    'DOZ',
  );
  assert.deepStrictEqual(unitValues, [60, 72], 'per-item values scaled to dozens; kg-based reporter ignored');
  console.log('✔ Scenario 3b Passed: EU, UK, NACTA, UN/LOCODE and Comtrade feeds parse correctly.');

  // ------------------------------------------------------------------ 4. bitemporal sync
  const store = ComplianceStore.getInstance();
  await store.init();
  const engine = ComplianceSyncEngine.getInstance();
  let feed: FeedEntity[] = [
    { externalId: '9001', entityType: 'ENTITY', name: 'ZEPHYR MARITIME HOLDINGS', aliases: [], country: 'Iran', programs: ['IRAN'], identifiers: {} },
    { externalId: '9002', entityType: 'VESSEL', name: 'OCEAN QUILL', aliases: [], country: 'Iran', programs: ['IRAN'], identifiers: { imoNumber: '9999991' } },
  ];
  overrideConnectorForTesting({
    sourceId: 'OFAC_SDN',
    endpoint: 'memory://ofac',
    fetch: async () => ({ kind: 'SANCTIONS', entities: feed, endpoint: 'memory://ofac' }),
  });

  const first = await engine.syncSource('OFAC_SDN', { triggerType: 'MANUAL', force: true });
  assert.strictEqual(first.status, 'SUCCESS', `first sync succeeded (${first.errorMessage ?? ''})`);
  const ofacSource = await store.getSourceById('OFAC_SDN');
  assert.strictEqual(ofacSource?.dataOrigin, 'LIVE_FEED');
  const ofacRecords = store.getEntitiesForSource('OFAC_SDN');
  assert.ok(ofacRecords.every((e) => e.canonicalId.startsWith('OFAC_SDN:')), 'sample OFAC records replaced by the feed');
  assert.ok(ofacRecords.every((e) => e.validFromBasis === 'UNKNOWN_ASSUMED_PRIOR'), 'first load without dates is conservative');

  const unchanged = await engine.syncSource('OFAC_SDN', { triggerType: 'SCHEDULED' });
  assert.strictEqual(unchanged.status, 'SKIPPED_NOT_MODIFIED', 'identical publication skipped by checksum');

  feed = [{ ...feed[0]!, aliases: ['ZEPHYR MARITIME'] }]; // 9001 amended, 9002 delisted
  const second = await engine.syncSource('OFAC_SDN', { triggerType: 'MANUAL' });
  assert.strictEqual(second.recordsUpdated, 1, 'amendment recorded as a new version');
  assert.strictEqual(second.recordsDeactivated, 1, 'missing record delisted');
  const versions = store.getEntitiesForSource('OFAC_SDN').filter((e) => e.externalId === '9001');
  assert.strictEqual(versions.length, 2, 'old version kept for history');
  assert.strictEqual(versions.filter((e) => e.isCurrent).length, 1, 'exactly one current version');
  const delisted = store.getEntitiesForSource('OFAC_SDN').find((e) => e.externalId === '9002');
  assert.ok(delisted && !delisted.isCurrent && delisted.validTo, 'delisted record retained with validTo');

  const temporal = new TemporalSanctionsService();
  const nobody = { role: 'Buyer', legalName: 'Not Found', country: 'X', address: 'X' };
  const party = (name: string): TradeParties => ({ seller: { role: 'Seller', legalName: name, country: 'X', address: 'X' }, buyer: nobody });
  const hit = temporal.screenTransactionPointInTime({ parties: party('Zephyr Maritime Holdings LLC'), transactionTimestamp: '2025-01-15T00:00:00Z' });
  assert.strictEqual(hit.wasListedAtTransactionTime, true, 'synced live record screens as listed');
  const pastVessel = temporal.screenTransactionPointInTime({
    parties: { seller: { ...nobody, role: 'Seller' }, buyer: nobody },
    vesselName: 'OCEAN QUILL',
    transactionTimestamp: '2025-01-15T00:00:00Z',
  });
  assert.strictEqual(pastVessel.wasListedAtTransactionTime, true, 'delisted vessel was still listed at an earlier transaction date');
  const sample = temporal.screenTransactionPointInTime({ parties: party('Sovcomflot'), transactionTimestamp: '2025-01-15T00:00:00Z' });
  assert.ok(
    !sample.temporalMatches.some((m) => m.sanctionsList === 'OFAC_SDN'),
    'built-in OFAC samples are hidden once the live list exists',
  );
  const possible = temporal.screenTransactionPointInTime({ parties: party('Zephyr Maritime Holdings Karachi Office'), transactionTimestamp: '2025-01-15T00:00:00Z' });
  assert.strictEqual(possible.wasListedAtTransactionTime, false, 'partial name is not a confirmed listing');
  assert.ok(possible.possibleMatchCount > 0, 'partial name surfaces as a possible match');
  overrideConnectorForTesting(null, 'OFAC_SDN');

  // Every registered publisher now has a connector; a manually maintained source must still never
  // be reported as synced.
  const ofacTemplate = (await store.getSourceById('OFAC_SDN'))!;
  await store.saveSource({
    ...ofacTemplate,
    sourceId: 'TEST_MANUAL_WATCHLIST',
    sourceName: 'Manually maintained watchlist',
    dataOrigin: 'MANUAL_IMPORT',
    syncStatus: 'IDLE',
    freshnessStatus: 'UNKNOWN',
    lastSuccessfulSync: null,
  });
  const notConnected = await engine.syncSource('TEST_MANUAL_WATCHLIST', { triggerType: 'MANUAL' });
  assert.strictEqual(notConnected.status, 'NOT_CONNECTED', 'sources without a connector are never reported as synced');
  const manualSource = await store.getSourceById('TEST_MANUAL_WATCHLIST');
  assert.notStrictEqual(manualSource?.freshnessStatus, 'FRESH');
  assert.ok(SnapshotRegistry.getInstance(), 'registry available');
  console.log('✔ Scenario 4 Passed: Sync applies SCD Type-2 versions, delistings and honest source status.');

  // Freshness is judged against the feed's own cadence: a daily feed is FRESH for its whole day.
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const cadenceFeed = (updateFrequency: 'HOURLY' | 'DAILY' | 'WEEKLY', staleAfterMinutes: number, syncedHoursAgo: number) =>
    ({ updateFrequency, staleAfterMinutes, lastSuccessfulSync: hoursAgo(syncedHoursAgo) }) as Parameters<typeof freshnessOf>[0];
  assert.strictEqual(freshnessOf(cadenceFeed('DAILY', 1440, 1)), 'FRESH');
  assert.strictEqual(freshnessOf(cadenceFeed('DAILY', 1440, 23.9)), 'FRESH', 'a daily feed synced 23.9 h ago is still current (the old rule called it AGING after 12 h)');
  assert.strictEqual(freshnessOf(cadenceFeed('DAILY', 1440, 30)), 'AGING', 'overdue by more than the grace period');
  assert.strictEqual(freshnessOf(cadenceFeed('DAILY', 1440, 49)), 'STALE', 'two cadences without a sync');
  assert.strictEqual(freshnessOf(cadenceFeed('WEEKLY', 10080, 6 * 24)), 'FRESH');
  assert.strictEqual(freshnessOf(cadenceFeed('WEEKLY', 10080, 20 * 24)), 'STALE');
  assert.strictEqual(freshnessOf(cadenceFeed('HOURLY', 120, 0.5)), 'FRESH');
  assert.strictEqual(freshnessOf(cadenceFeed('HOURLY', 120, 3)), 'STALE');
  console.log('✔ Scenario 4b Passed: Feed freshness follows the update cadence of each source.');

  // A country is not a listed party, but searching for one must not come back clean.
  const registry = SnapshotRegistry.getInstance();
  const asOf = new Date().toISOString();
  const jurisdictionHits = (query: string, swiftBic?: string) => registry.queryJurisdictionPointInTime(query, 'COUNTERPARTY', asOf, { swiftBic });
  for (const name of ['iran', ' IRAN ', 'Islamic Republic of Iran', 'IR', 'Persia']) {
    const hits = jurisdictionHits(name);
    assert.ok(hits.length === 1 && hits[0]!.wasListedAtTransactionTime && hits[0]!.matchType === 'JURISDICTION_MATCH', `"${name.trim()}" reads as the sanctioned jurisdiction Iran`);
  }
  assert.ok(jurisdictionHits('DPRK').length === 1 && jurisdictionHits('Burma').length === 1 && jurisdictionHits('Donetsk').length === 1, 'aliases resolve');
  assert.strictEqual(jurisdictionHits('Pakistan').length, 0, 'a clear country is not flagged');
  assert.strictEqual(jurisdictionHits('Irani Traders Ltd').length, 0, 'a company name that merely contains a country stem is not a country match');
  assert.strictEqual(jurisdictionHits('Karachi Traders', 'MELIIRTH')[0]?.matchedName, 'Iran (jurisdiction)', 'a SWIFT BIC with an Iranian country code is flagged');
  assert.strictEqual(jurisdictionHits('Karachi Traders', 'HABBPKKA').length, 0);
  const coverage = await getScreeningCoverage();
  assert.strictEqual(coverage.lists.length, 5);
  assert.strictEqual(coverage.clearanceReliable, coverage.warning === null, 'a warning is raised exactly when a list is not reliable');
  assert.ok(coverage.lists.every((l) => l.reliable === (l.problem === null)));
  const seedOnly = coverage.lists.filter((l) => l.origin !== 'LIVE_FEED');
  assert.ok(seedOnly.length === 0 || (coverage.warning ?? '').includes('Not a clearance'), 'sample-only lists make a no-match result an explicit non-clearance');
  console.log('✔ Scenario 4c Passed: Searching for a sanctioned country (or a BIC from one) is flagged, and a no-match result says when the lists behind it are not loaded.');

  // ------------------------------------------------------------------ 5. pricing → TBML
  const pricing = new PricingIntelligenceService();
  const overpriced = line({ productDescription: "Men's cotton woven shirts", quantity: 1000, unitPrice: 60, totalLineValue: 60000 });
  const findings = await pricing.evaluatePricingIntelligence({ goods: [overpriced], currency: 'USD', incoterm: 'FOB' });
  assert.strictEqual(findings[0]?.classification, 'HIGH_PRICE_ANOMALY', 'reference corridor flags 5x over-invoicing');
  const tbml = new TBMLService().analyzeTBML({
    priceFindings: findings,
    goods: [overpriced],
    parties: { seller: { ...nobody, role: 'Seller' }, buyer: nobody },
    totalValue: 60000,
    currency: 'USD',
  });
  assert.ok(tbml.redFlags.some((f) => f.category === 'PRICING_ANOMALY'), 'TBML pricing rule now receives benchmark findings');
  assert.ok(tbml.overallTbmlRiskScore >= 40, 'over-invoicing raises the TBML score');

  const unknownItem = line({ productDescription: 'Bespoke hand-carved walnut lectern', quantity: 1, unitPrice: 900, totalLineValue: 900 });
  const unknown = await pricing.evaluatePricingIntelligence({ goods: [unknownItem], currency: 'USD', incoterm: 'FOB' });
  assert.strictEqual(unknown[0]?.classification, 'INSUFFICIENT_MARKET_DATA', 'no benchmark → no invented finding');
  console.log('✔ Scenario 5 Passed: Price anomalies reach TBML; unknown goods are never benchmarked by guesswork.');

  // ------------------------------------------------------------------ 6. arithmetic
  const math = new MathIntegrityService().validateMath({
    goods: [line({ quantity: 10, unitPrice: 0, totalLineValue: 500 })],
    declaredSubtotal: 500,
    declaredTotal: 500,
    currency: 'USD',
  });
  assert.strictEqual(math.isMathematicallySound, true, 'missing unit price is not an arithmetic error');
  const wrong = new MathIntegrityService().validateMath({
    goods: [line({ quantity: 10, unitPrice: 50, totalLineValue: 600 })],
    declaredSubtotal: 600,
    declaredTotal: 600,
    currency: 'USD',
  });
  assert.strictEqual(wrong.isMathematicallySound, false, 'real arithmetic error still caught');
  const rounded = new MathIntegrityService().validateMath({
    goods: [line({ quantity: 28873, unitPrice: 9.37, totalLineValue: 270543.37 })],
    declaredSubtotal: 270543.37,
    declaredTotal: 270543.37,
    currency: 'USD',
  });
  assert.strictEqual(rounded.isMathematicallySound, true, 'a unit price printed rounded to cents is not an error');
  const inflated = new MathIntegrityService().validateMath({
    goods: [line({ quantity: 100000, unitPrice: 3, totalLineValue: 340000 })],
    declaredSubtotal: 340000,
    declaredTotal: 340000,
    currency: 'USD',
  });
  assert.strictEqual(inflated.isMathematicallySound, false, 'rounding allowance does not hide an inflated line');
  console.log('✔ Scenario 6 Passed: Invoice arithmetic flags real errors only.');

  // ------------------------------------------------------------------ 7. clean invoice end to end
  const invoice = [
    'COMMERCIAL INVOICE',
    'Invoice No: INV-2026-0042',
    'Date: 13/06/2026',
    'Seller: Lahore Textile Mills Ltd',
    'Buyer: Nordic Apparel AB',
    'Country of Origin: Pakistan',
    'Country of Destination: Sweden',
    "1000 pcs @ USD 12.00 Men's cotton woven shirts",
    'Total Amount: USD 12,000.00',
    'Payment Terms: Documentary credit at sight',
  ].join('\n');
  const analysis = await new TradeComplianceExtractor().processTradeDocument({
    documentId: '00000000-0000-4000-8000-000000000042',
    filename: 'invoice.pdf',
    rawText: invoice,
    rawBuffer: Buffer.from(invoice),
    aiModel: 'heuristic',
  });
  assert.strictEqual(analysis.transaction.transactionTimestamp, '2026-06-13T00:00:00.000Z', 'document date used for screening');
  assert.strictEqual(analysis.transaction.transactionDateBasis, 'DOCUMENT_DATE');
  assert.ok(!analysis.decision.triggeredRules.includes('RULE_END_USER_NOT_DISCLOSED'), 'EUC not demanded for ordinary goods');
  assert.strictEqual(analysis.decision.decision, 'ALLOW', `clean invoice is allowed (rules: ${analysis.decision.triggeredRules.join(', ')})`);
  console.log('✔ Scenario 7 Passed: A clean invoice reaches ALLOW and is screened as of its own date.');

  // Fields that share one line (PDF paragraphs, DOCX tables) must still separate cleanly.
  const merged =
    'COMMERCIAL INVOICE\nInvoice No: INV-2026-0777 Date: 02/03/2026 Seller: Karachi Industrial Supplies Ltd ' +
    'Buyer: Banco Nacional de Cuba Country of Origin: Pakistan Country of Destination: Cuba ' +
    '50 pcs @ USD 400.00 Industrial valves Total Amount: USD 20,000.00';
  const blocked = await new TradeComplianceExtractor().processTradeDocument({
    documentId: '00000000-0000-4000-8000-000000000777',
    filename: 'merged.pdf',
    rawText: merged,
    rawBuffer: Buffer.from(merged),
    aiModel: 'heuristic',
  });
  assert.strictEqual(blocked.transaction.parties.seller?.legalName, 'Karachi Industrial Supplies Ltd', 'seller stops at the next label');
  assert.strictEqual(blocked.transaction.parties.buyer?.legalName, 'Banco Nacional de Cuba', 'buyer stops at the next label');
  assert.strictEqual(blocked.transaction.destinationCountry, 'Cuba');
  assert.strictEqual(blocked.decision.decision, 'BLOCK_ESCALATE', 'embargoed destination blocks');
  assert.ok(
    !blocked.decision.triggeredRules.includes('RULE_DOCUMENT_REPLAY_ALTERATION'),
    'two unrelated invoices are not a replay just because both lack an LC number',
  );
  console.log('✔ Scenario 7b Passed: Fields on one line are separated; no sentinel-driven replay alert.');

  // ------------------------------------------------------------------ 8. authentication
  const officer = await authenticateCredentials('ramis.ali@tradeguard.ai', DEFAULT_DEV_DEMO_PASSWORD);
  assert.strictEqual(officer?.role, 'CHIEF_COMPLIANCE_OFFICER', 'demo officer signs in with the demo password');
  assert.strictEqual(await authenticateCredentials('ramis.ali@tradeguard.ai', 'wrong-password'), null, 'wrong password rejected');
  assert.strictEqual(await authenticateCredentials('anyone@bank.com', DEFAULT_DEV_DEMO_PASSWORD), null, 'unknown email rejected');
  assert.strictEqual(findDemoAccount('trade_auditor')?.role, 'TRADE_AUDITOR');

  const reqFor = (headers: Record<string, string>) => ({ headers } as any);
  assert.throws(() => authenticate(reqFor({}), {} as any, () => undefined), /Authentication required/, 'no anonymous fallback');
  assert.throws(
    () => authenticate(reqFor({ authorization: 'Bearer tg-jwt-forged', 'x-user-role': 'CHIEF_COMPLIANCE_OFFICER' }), {} as any, () => undefined),
    /Invalid, forged, or expired/,
    'client-made tokens and role headers are rejected',
  );
  const analyst = findDemoAccount('risk_analyst')!;
  const signed = reqFor({ authorization: `Bearer ${signBankingToken(analyst)}`, 'x-user-role': 'CHIEF_COMPLIANCE_OFFICER' });
  authenticate(signed, {} as any, () => undefined);
  assert.strictEqual(signed.user.role, 'TBML_RISK_ANALYST', 'role comes from the account directory, not a header');
  // A token whose role claim no longer matches the directory (a role change, or a signed claim for a
  // role the account does not hold) is refused: the session must be re-established under the current role.
  const stale = reqFor({ authorization: `Bearer ${signBankingToken({ ...officer!, role: 'TBML_RISK_ANALYST' })}` });
  assert.throws(() => authenticate(stale, {} as any, () => undefined), /access has changed|session was ended/, 'role claim must match the directory');
  console.log('✔ Scenario 8 Passed: Sign-in checks passwords; identity and role come only from signed tokens.');

  // ------------------------------------------------------------------ 9. SSRF
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1', '100.64.0.1']) {
    assert.strictEqual(isBlockedAddress(address), true, `${address} blocked`);
  }
  assert.strictEqual(isBlockedAddress('8.8.8.8'), false, 'public address allowed');
  for (const url of ['http://localhost:4000/api/config', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'ftp://example.com/x']) {
    await assert.rejects(safeFetchText(url), UnsafeUrlError, `${url} refused`);
  }
  console.log('✔ Scenario 9 Passed: SSRF guard checks resolved addresses, encodings and protocols.');

  // ------------------------------------------------------------------ 10. API views
  const view = toDetailView({ id: 'x', fileBase64: 'AAAA', storagePath: '/tmp/x', units: [] } as unknown as DocumentRecord);
  assert.ok(!('fileBase64' in view) && !('storagePath' in view) && !('units' in view), 'detail view carries no file bytes or paths');
  console.log('✔ Scenario 10 Passed: Document detail responses never embed the original file.');

  console.log('\n================================================================');
  console.log('ALL COMPLIANCE CORRECTNESS SCENARIOS PASSED');
  console.log('================================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('COMPLIANCE CORRECTNESS TEST FAILED:', err);
  process.exit(1);
});
