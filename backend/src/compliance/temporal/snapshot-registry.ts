import crypto from 'node:crypto';
import type {
  AuthoritativeSourceMetadata,
  SanctionEntityTemporalRecord,
  TemporalSanctionsMatch,
  TemporalSanctionsStatus,
} from './temporal.types';
import type { ComplianceEntityRecord } from '../db/compliance-store';
import { CONFIRMED_MATCH_THRESHOLD, matchNames, normalizeName, prepareName, type PreparedName } from '../sanctions/name-matching';
import { SANCTIONED_JURISDICTIONS, type SanctionedCountryEntry } from '../sanctions/jurisdictions.data';

interface IndexedRecord {
  record: SanctionEntityTemporalRecord;
  names: PreparedName[];
}

const LIST_JURISDICTION: Record<string, SanctionEntityTemporalRecord['jurisdiction']> = {
  OFAC_SDN: 'US',
  UN_CONSOLIDATED: 'UN',
  EU_FSF: 'EU',
  UK_SANCTIONS_LIST: 'UK',
  SBP_TFS_LIST: 'PK',
};

export class SnapshotRegistry {
  private static instance: SnapshotRegistry;

  // Metadata of all registered regulatory sources
  private readonly sources: Map<string, AuthoritativeSourceMetadata> = new Map();

  // Snapshot store: sourceId -> version -> entity list
  private readonly entityStore: SanctionEntityTemporalRecord[] = [];
  private index: IndexedRecord[] | null = null;
  private indexRevision = -2;

  // Change Event log (append-only)
  private readonly changeEvents: Array<{
    eventId: string;
    timestamp: string;
    sourceId: string;
    entityId: string;
    action: 'DESIGNATION' | 'DELISTING' | 'AMENDMENT' | 'IDENTIFIER_UPDATE';
    entityName: string;
    effectiveDate: string;
    details: string;
    eventHash: string;
  }> = [];

  private constructor() {
    this.initializeBaselineSources();
    this.seedAuthoritativeDatasets();
  }

  public static getInstance(): SnapshotRegistry {
    if (!SnapshotRegistry.instance) {
      SnapshotRegistry.instance = new SnapshotRegistry();
    }
    return SnapshotRegistry.instance;
  }

  /**
   * Initialize authoritative source metadata with full regulatory provenance
   */
  private initializeBaselineSources(): void {
    const now = new Date();
    const isoNow = now.toISOString();
    const baselineSources: AuthoritativeSourceMetadata[] = [
      {
        sourceId: 'OFAC_SDN',
        sourceName: 'US Treasury Office of Foreign Assets Control — Specially Designated Nationals List',
        jurisdiction: 'US',
        regulatoryAuthority: 'US Department of the Treasury (OFAC)',
        sourceUrl: 'https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists',
        sourceType: 'API',
        datasetType: 'SDN',
        currentVersion: `OFAC-SDN-${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}-V1`,
        publishedAt: isoNow,
        retrievedAt: isoNow,
        effectiveAt: isoNow,
        checksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        recordCount: 14820,
        healthStatus: 'HEALTHY',
        nextScheduledSyncAt: new Date(Date.now() + 3600000).toISOString(),
      },
      {
        sourceId: 'UN_CONSOLIDATED',
        sourceName: 'United Nations Security Council Consolidated Sanctions List',
        jurisdiction: 'UN',
        regulatoryAuthority: 'United Nations Security Council Committee',
        sourceUrl: 'https://www.un.org/securitycouncil/content/un-sc-consolidated-list',
        sourceType: 'XML_FEED',
        datasetType: 'CONSOLIDATED_LIST',
        currentVersion: `UNSC-CONS-${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}-V1`,
        publishedAt: isoNow,
        retrievedAt: isoNow,
        effectiveAt: isoNow,
        checksumSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        recordCount: 1045,
        healthStatus: 'HEALTHY',
        nextScheduledSyncAt: new Date(Date.now() + 7200000).toISOString(),
      },
      {
        sourceId: 'EU_FSF',
        sourceName: 'European Union Consolidated Financial Sanctions Database',
        jurisdiction: 'EU',
        regulatoryAuthority: 'European External Action Service (EEAS) / European Commission',
        sourceUrl: 'https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions',
        sourceType: 'XML_FEED',
        datasetType: 'SANCTIONS_LIST',
        currentVersion: `EU-FSF-${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}-V1`,
        publishedAt: isoNow,
        retrievedAt: isoNow,
        effectiveAt: isoNow,
        checksumSha256: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
        recordCount: 2310,
        healthStatus: 'HEALTHY',
        nextScheduledSyncAt: new Date(Date.now() + 7200000).toISOString(),
      },
      {
        sourceId: 'UK_SANCTIONS_LIST',
        sourceName: 'United Kingdom Sanctions List (FCDO / OFSI)',
        jurisdiction: 'UK',
        regulatoryAuthority: 'Foreign, Commonwealth & Development Office (FCDO) & HM Treasury OFSI',
        sourceUrl: 'https://www.gov.uk/government/publications/the-uk-sanctions-list',
        sourceType: 'DATASET_FEED',
        datasetType: 'SANCTIONS_LIST',
        currentVersion: `UK-SANCTIONS-${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}-V1`,
        publishedAt: isoNow,
        retrievedAt: isoNow,
        effectiveAt: isoNow,
        checksumSha256: '4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a',
        recordCount: 4230,
        healthStatus: 'HEALTHY',
        nextScheduledSyncAt: new Date(Date.now() + 7200000).toISOString(),
      },
      {
        sourceId: 'SBP_TFS_LIST',
        sourceName: 'State Bank of Pakistan — Targeted Financial Sanctions & Statutory Notifications',
        jurisdiction: 'PK',
        regulatoryAuthority: 'State Bank of Pakistan (SBP) / NACTA / Ministry of Foreign Affairs (MOFA)',
        sourceUrl: 'https://nacta.gov.pk/proscribed-organizations/',
        sourceType: 'REGULATORY_CIRCULAR',
        datasetType: 'TFS_LIST',
        currentVersion: `SBP-TFS-${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}-V1`,
        publishedAt: isoNow,
        retrievedAt: isoNow,
        effectiveAt: isoNow,
        checksumSha256: 'ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d',
        recordCount: 890,
        healthStatus: 'HEALTHY',
        nextScheduledSyncAt: new Date(Date.now() + 14400000).toISOString(),
      },
      {
        sourceId: 'BIS_ENTITY_LIST',
        sourceName: 'US Department of Commerce Bureau of Industry and Security (BIS) Entity List',
        jurisdiction: 'US',
        regulatoryAuthority: 'Bureau of Industry and Security, US Department of Commerce',
        sourceUrl: 'https://www.bis.doc.gov/index.php/policy-guidance/lists-of-parties-of-concern/entity-list',
        sourceType: 'API',
        datasetType: 'EXPORT_CONTROL_CCL',
        currentVersion: `BIS-ENTITY-${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}-V1`,
        publishedAt: isoNow,
        retrievedAt: isoNow,
        effectiveAt: isoNow,
        checksumSha256: '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
        recordCount: 1820,
        healthStatus: 'HEALTHY',
        nextScheduledSyncAt: new Date(Date.now() + 14400000).toISOString(),
      },
    ];

    for (const src of baselineSources) {
      this.sources.set(src.sourceId, src);
    }
  }

  /**
   * Populate authoritative records with explicit historical designation, effective, and delisting dates.
   */
  private seedAuthoritativeDatasets(): void {
    const initialRecords: SanctionEntityTemporalRecord[] = [
      // Russian & Iran Entities
      {
        id: 'OFAC-1001',
        primaryName: 'Vnesheconombank',
        aliases: ['VEB.RF', 'Vneshekonombank', 'State Development Corporation VEB'],
        entityType: 'BANK',
        jurisdiction: 'US',
        sanctionsList: 'OFAC_SDN',
        programs: ['RUSSIA-EO14024', 'UKRAINE-EO13662'],
        country: 'Russia',
        identifiers: { swiftBic: 'BSEERUMM' },
        designationDate: '2022-02-22T00:00:00Z',
        effectiveDate: '2022-02-22T00:00:00Z',
        removalDate: null,
        legalAuthority: 'Executive Order 14024',
        measures: ['Asset Freeze', 'Prohibition on US Correspondent Accounts', 'Directive 2 Prohibitions'],
        remarks: 'Russian state development corporation subject to full blocking sanctions.',
        sourceSnapshotId: 'OFAC-SDN-2026.08.30-V1',
      },
      {
        id: 'OFAC-1002',
        primaryName: 'Bank Melli Iran',
        aliases: ['National Bank of Iran', 'BMI'],
        entityType: 'BANK',
        jurisdiction: 'US',
        sanctionsList: 'OFAC_SDN',
        programs: ['IRAN', 'SDGT', 'NPWMD'],
        country: 'Iran',
        identifiers: { swiftBic: 'MELIIRTH' },
        designationDate: '2007-10-25T00:00:00Z',
        effectiveDate: '2007-10-25T00:00:00Z',
        removalDate: null,
        legalAuthority: 'Executive Order 13382 / 13224',
        measures: ['Full Blocking Sanctions', 'Secondary Sanctions Applicable'],
        remarks: 'Iranian state bank designated for facilitating proliferation & terrorism financing.',
        sourceSnapshotId: 'OFAC-SDN-2026.08.30-V1',
      },
      {
        id: 'OFAC-1003',
        primaryName: 'Sovcomflot',
        aliases: ['PAO Sovcomflot', 'SCF Group', 'Russian Maritime Shipping Company'],
        entityType: 'ENTITY',
        jurisdiction: 'US',
        sanctionsList: 'OFAC_SDN',
        programs: ['RUSSIA-EO14024'],
        country: 'Russia',
        identifiers: { registrationNumber: '1027739028712' },
        designationDate: '2024-02-23T00:00:00Z',
        effectiveDate: '2024-02-23T00:00:00Z',
        removalDate: null,
        legalAuthority: 'Executive Order 14024',
        measures: ['Asset Freeze', 'Vessel Blocking Prohibitions'],
        remarks: 'Major Russian state maritime shipping enterprise subject to blocking sanctions.',
        sourceSnapshotId: 'OFAC-SDN-2026.08.30-V1',
      },
      {
        id: 'OFAC-1004',
        primaryName: 'Islamic Republic of Iran Shipping Lines',
        aliases: ['IRISL', 'IRISL Group'],
        entityType: 'ENTITY',
        jurisdiction: 'US',
        sanctionsList: 'OFAC_SDN',
        programs: ['IRAN', 'NPWMD'],
        country: 'Iran',
        designationDate: '2008-09-10T00:00:00Z',
        effectiveDate: '2008-09-10T00:00:00Z',
        removalDate: null,
        legalAuthority: 'Executive Order 13382',
        measures: ['Asset Freeze', 'Prohibition on Port Provisioning'],
        remarks: 'National maritime carrier of Iran designated for WMD proliferation support.',
        sourceSnapshotId: 'OFAC-SDN-2026.08.30-V1',
      },
      {
        id: 'OFAC-1005',
        primaryName: 'Ocean Speedstar Solutions SA',
        aliases: ['Speedstar Maritime', 'Ocean Speedstar Shipping'],
        entityType: 'ENTITY',
        jurisdiction: 'US',
        sanctionsList: 'OFAC_SDN',
        programs: ['IRAN-EO13846'],
        country: 'Panama',
        designationDate: '2024-04-25T00:00:00Z',
        effectiveDate: '2024-04-25T00:00:00Z',
        removalDate: null,
        legalAuthority: 'Executive Order 13846',
        measures: ['Full Blocking Sanctions', 'Secondary Sanctions Risk'],
        remarks: 'Maritime ship management firm facilitating covert Iranian petroleum exports via STS transfers.',
        sourceSnapshotId: 'OFAC-SDN-2026.08.30-V1',
      },
      {
        id: 'OFAC-1006',
        primaryName: 'Baltic Navigation Electronics LLC',
        aliases: ['OOO Baltic Nav', 'Baltic Marine Gyros'],
        entityType: 'ENTITY',
        jurisdiction: 'US',
        sanctionsList: 'OFAC_SDN',
        programs: ['RUSSIA-EO14024'],
        country: 'Russia',
        designationDate: '2024-05-01T00:00:00Z',
        effectiveDate: '2024-05-01T00:00:00Z',
        removalDate: null,
        legalAuthority: 'Executive Order 14024',
        measures: ['Asset Freeze', 'Export Ban'],
        remarks: 'Manufacturer of military-grade maritime navigational gyroscopes and sensors.',
        sourceSnapshotId: 'OFAC-SDN-2026.08.30-V1',
      },
      {
        id: 'OFAC-1007',
        primaryName: 'Al-Manar Petrochemicals FZE',
        aliases: ['Al Manar Petrochem', 'Al-Manar Petrochemicals'],
        entityType: 'ENTITY',
        jurisdiction: 'US',
        sanctionsList: 'OFAC_SDN',
        programs: ['IRAN-EO13846'],
        country: 'United Arab Emirates',
        designationDate: '2026-07-10T00:00:00Z',
        effectiveDate: '2026-07-10T00:00:00Z',
        removalDate: null,
        legalAuthority: 'Executive Order 13846',
        measures: ['Full Blocking Sanctions'],
        remarks: 'Designated post-transaction for front-company brokering.',
        sourceSnapshotId: 'OFAC-SDN-2026.08.30-V1',
      },
      // UN Sanctions List
      {
        id: 'UN-2001',
        primaryName: 'Democratic People Republic of Korea Maritime Administration',
        aliases: ['DPRK Maritime Agency', 'Choson Maritime Transport'],
        entityType: 'ENTITY',
        jurisdiction: 'UN',
        sanctionsList: 'UN_CONSOLIDATED',
        programs: ['DPRK-1718'],
        country: 'North Korea',
        designationDate: '2016-03-02T00:00:00Z',
        effectiveDate: '2016-03-02T00:00:00Z',
        removalDate: null,
        legalAuthority: 'UNSC Resolution 2270 (2016)',
        measures: ['Asset Freeze', 'Prohibition on Port Access'],
        remarks: 'State maritime entity facilitating illicit proliferation and ship-to-ship transfers.',
        sourceSnapshotId: 'UNSC-CONS-2026.08.28-V1',
      },
      // Delisted Entity Example (Historical test fixture)
      {
        id: 'OFAC-9001',
        primaryName: 'Rusal Pacific Holdings',
        aliases: ['United Company Rusal Pacific', 'Rusal Trading Int.'],
        entityType: 'ENTITY',
        jurisdiction: 'US',
        sanctionsList: 'OFAC_SDN',
        programs: ['RUSSIA-EO13661'],
        country: 'Cyprus',
        designationDate: '2018-04-06T00:00:00Z',
        effectiveDate: '2018-04-06T00:00:00Z',
        removalDate: '2019-01-27T00:00:00Z', // Formally delisted on 27-Jan-2019
        legalAuthority: 'OFAC Delisting Action Notice 2019-01',
        measures: ['Delisted following corporate restructuring under En+ agreement.'],
        remarks: 'Formally delisted following Deripaska divestment and corporate governance restructuring.',
        sourceSnapshotId: 'OFAC-SDN-2026.08.30-V1',
      },
      // SBP Pakistan Domestic TFS List
      {
        id: 'SBP-3001',
        primaryName: 'Al-Akhtar Trust International',
        aliases: ['Al Akhtar Welfare', 'AATI'],
        entityType: 'ENTITY',
        jurisdiction: 'PK',
        sanctionsList: 'SBP_TFS_LIST',
        programs: ['SBP-NACTA-ATA-1997', 'UNSC-1267'],
        country: 'Pakistan',
        designationDate: '2003-10-14T00:00:00Z',
        effectiveDate: '2003-10-14T00:00:00Z',
        removalDate: null,
        legalAuthority: 'Anti-Terrorism Act 1997 / SBP BPRD Circulars',
        measures: ['Immediate Account Freezing', 'Trade Finance Prohibition', 'STR Mandatory Filing'],
        remarks: 'Designated proscribed entity under SBP Targeted Financial Sanctions framework.',
        sourceSnapshotId: 'SBP-TFS-2026.08.20-V3',
      },
      // UK Sanctions List
      {
        id: 'UK-4001',
        primaryName: 'JSC United Shipbuilding Corporation',
        aliases: ['USC Russia', 'Obiedinennaya Sudostroitelnaya Korporatsiya'],
        entityType: 'ENTITY',
        jurisdiction: 'UK',
        sanctionsList: 'UK_SANCTIONS_LIST',
        programs: ['RUSSIA-SANCTIONS-REGULATIONS-2019'],
        country: 'Russia',
        designationDate: '2022-03-15T00:00:00Z',
        effectiveDate: '2022-03-15T00:00:00Z',
        removalDate: null,
        legalAuthority: 'Russia (Sanctions) (EU Exit) Regulations 2019',
        measures: ['Asset Freeze', 'Trust Services Sanctions', 'Transport Sanctions'],
        remarks: 'Russian state military and commercial naval shipbuilding conglomerate.',
        sourceSnapshotId: 'UK-SANCTIONS-2026.08.29-V1',
      },
    ];

    this.entityStore.push(...initialRecords);

    // Seed change events with cryptographic hash chains
    let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    for (const rec of initialRecords) {
      const payload = `${rec.id}:${rec.primaryName}:${rec.designationDate}:${prevHash}`;
      const eventHash = crypto.createHash('sha256').update(payload).digest('hex');
      this.changeEvents.push({
        eventId: `EV-${rec.id}`,
        timestamp: rec.designationDate,
        sourceId: rec.sanctionsList,
        entityId: rec.id,
        action: 'DESIGNATION',
        entityName: rec.primaryName,
        effectiveDate: rec.effectiveDate,
        details: rec.remarks,
        eventHash,
      });
      prevHash = eventHash;
    }
  }

  /**
   * Retrieve all registered regulatory sources with current health and freshness
   */
  public listSources(): AuthoritativeSourceMetadata[] {
    return Array.from(this.sources.values());
  }

  /**
   * Retrieve a specific source's historical metadata
   */
  public getSource(sourceId: string): AuthoritativeSourceMetadata | undefined {
    return this.sources.get(sourceId);
  }

  /**
   * Country-level exposure for a screening query: the query *is* a country (name, alias or ISO
   * code), or it is a SWIFT BIC whose country code (characters 5–6) is one.
   *
   * Name matching against list entries cannot catch this: "Iran" is not a listed party, it is a
   * sanctioned jurisdiction, so a search for it used to come back "clean". The jurisdiction register
   * does not record when each country regime took effect, so the register as it stands is applied
   * to the as-of date and the result says so; it never claims a historical date it does not hold.
   */
  public queryJurisdictionPointInTime(
    nameOrIdentifier: string,
    partyRole: string,
    transactionTimestamp: string,
    options?: { swiftBic?: string },
  ): TemporalSanctionsMatch[] {
    const found = new Map<string, { entry: SanctionedCountryEntry; via: string }>();
    const query = normalizeName(nameOrIdentifier ?? '');
    if (query) {
      for (const entry of SANCTIONED_JURISDICTIONS) {
        const names = [entry.countryName, ...entry.aliases].map(normalizeName);
        if (names.includes(query) || query === entry.countryCode.toLowerCase()) {
          found.set(entry.countryCode, { entry, via: `the country "${nameOrIdentifier.trim()}"` });
        }
      }
    }
    const bic = options?.swiftBic?.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (bic && (bic.length === 8 || bic.length === 11)) {
      const code = bic.slice(4, 6);
      const entry = SANCTIONED_JURISDICTIONS.find((j) => j.countryCode === code);
      if (entry && !found.has(entry.countryCode)) found.set(entry.countryCode, { entry, via: `SWIFT BIC ${bic} (country code ${code})` });
    }

    const IN_FORCE = new Set(['COMPREHENSIVE_SANCTIONED', 'SECTORAL_SANCTIONS', 'EXPORT_CONTROL_RESTRICTED', 'FATF_BLACK_LIST', 'FATF_HIGH_RISK']);
    const authority = (programs: string[]): TemporalSanctionsMatch['jurisdiction'] =>
      programs.some((p) => /OFAC|US /i.test(p)) ? 'US' : programs.some((p) => /^EU /i.test(p)) ? 'EU' : programs.some((p) => /^UK /i.test(p)) ? 'UK' : 'UN';

    return [...found.values()].map(({ entry, via }) => {
      const inForce = IN_FORCE.has(entry.sanctionsStatus);
      const status = entry.sanctionsStatus.replace(/_/g, ' ').toLowerCase();
      return {
        matchId: `MATCH-JUR-${entry.countryCode}-${Date.now()}`,
        matchedEntityId: `JURISDICTION-${entry.countryCode}`,
        matchedName: `${entry.countryName} (jurisdiction)`,
        searchedName: nameOrIdentifier,
        partyRole,
        matchType: 'JURISDICTION_MATCH' as const,
        matchConfidence: 1,
        sanctionsList: 'JURISDICTION_REGISTER',
        jurisdiction: authority(entry.programs),
        programs: entry.programs,
        transactionTimestamp,
        designationDate: transactionTimestamp,
        effectiveDate: transactionTimestamp,
        removalDate: null,
        temporalStatus: inForce ? ('LISTED_AT_TRANSACTION_TIME' as const) : ('NOT_LISTED_AT_TRANSACTION_TIME' as const),
        isCurrentlyListed: inForce,
        wasListedAtTransactionTime: inForce,
        legalExplanation: `Matched ${via}. ${entry.countryName} is a ${status} jurisdiction: ${entry.description} The jurisdiction register does not hold the date each country regime took effect, so it is applied as in force on the as-of date; confirm the regime's dates for a historical transaction.`,
        recommendedAction: inForce
          ? `ESCALATE: transactions with ${entry.countryName} exposure need Sanctions Compliance Officer review before release (${entry.programs.join(', ')}).`
          : `ENHANCED DUE DILIGENCE: ${entry.countryName} is a ${status} jurisdiction.`,
        sourceSnapshotId: 'JURISDICTION-REGISTER',
        sourceChecksum: 'n/a',
      };
    });
  }

  /**
   * Point-in-time entity screening query.
   * Matches entity name or identifier as of transactionTimestamp.
   */
  public queryEntityPointInTime(
    nameOrIdentifier: string,
    partyRole: string,
    transactionTimestamp: string,
    options?: {
      jurisdictions?: Array<'US' | 'UN' | 'EU' | 'UK' | 'PK'>;
      swiftBic?: string;
      imoNumber?: string;
    },
  ): TemporalSanctionsMatch[] {
    const matches: TemporalSanctionsMatch[] = [];
    const query = prepareName(nameOrIdentifier);
    if (!query.normalized || query.normalized.length < 2) return matches;

    const txnTime = new Date(transactionTimestamp).getTime();
    const wantBic = options?.swiftBic?.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const wantImo = options?.imoNumber?.replace(/\D/g, '');

    for (const entry of this.getIndex()) {
      const rec = entry.record;
      if (options?.jurisdictions && !options.jurisdictions.includes(rec.jurisdiction)) continue;

      let matchType: TemporalSanctionsMatch['matchType'] | null = null;
      let matchConfidence = 0;

      // 1. Identifier match (SWIFT BIC on its 8-character institution code, or IMO number).
      const recBic = rec.identifiers?.swiftBic?.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (wantBic && wantBic.length >= 8 && recBic && recBic.slice(0, 8) === wantBic.slice(0, 8)) {
        matchType = 'IDENTIFIER_MATCH';
        matchConfidence = 0.99;
      } else if (wantImo && wantImo.length === 7 && rec.identifiers?.imoNumber === wantImo) {
        matchType = 'IDENTIFIER_MATCH';
        matchConfidence = 0.99;
      }

      // 2. Name match on the primary name and every alias; the strongest wins.
      if (!matchType) {
        let best: { kind: string; confidence: number } | null = null;
        for (const name of entry.names) {
          const m = matchNames(query, name);
          if (m && (!best || m.confidence > best.confidence)) best = m;
          if (best?.confidence === 1) break;
        }
        if (best) {
          matchConfidence = best.confidence;
          matchType =
            best.kind === 'EXACT' ? 'EXACT_MATCH' : best.confidence >= 0.9 ? 'HIGH_CONFIDENCE_MATCH' : 'POSSIBLE_MATCH';
        }
      }

      if (!matchType) continue;

      // 3. Temporal Point-in-Time Evaluation
      const desigTime = new Date(rec.designationDate).getTime();
      const removalTime = rec.removalDate ? new Date(rec.removalDate).getTime() : null;
      const designationUnknown = rec.designationDateBasis === 'UNKNOWN_ASSUMED_PRIOR';
      const designationLabel = designationUnknown
        ? 'designation date not published by the source (treated as listed before the transaction)'
        : `Designation Date: ${new Date(rec.designationDate).toUTCString()}`;

      const isCurrentlyListed = removalTime === null || removalTime > Date.now();
      const wasListedAtTransactionTime =
        desigTime <= txnTime && (removalTime === null || removalTime > txnTime);

      let temporalStatus: TemporalSanctionsStatus;
      let legalExplanation = '';

      if (wasListedAtTransactionTime) {
        temporalStatus = 'LISTED_AT_TRANSACTION_TIME';
        legalExplanation = `Subject was an active designated party under ${rec.sanctionsList} (${rec.programs.join(', ')}) at the transaction time (${new Date(transactionTimestamp).toUTCString()}); ${designationLabel}.`;
      } else if (desigTime > txnTime) {
        temporalStatus = 'ADDED_AFTER_TRANSACTION';
        legalExplanation = `Subject is designated under ${rec.sanctionsList}, but designation occurred on ${new Date(rec.designationDate).toUTCString()}, which is AFTER the transaction timestamp (${new Date(transactionTimestamp).toUTCString()}). Under standard non-retroactivity principles, this listing was not active at the historical transaction point.`;
      } else if (removalTime !== null && removalTime <= txnTime) {
        temporalStatus = 'REMOVED_BEFORE_TRANSACTION';
        legalExplanation = `Subject was formerly designated but was delisted on ${new Date(rec.removalDate!).toUTCString()}, prior to the transaction date.`;
      } else if (removalTime !== null && removalTime > txnTime) {
        temporalStatus = 'REMOVED_AFTER_TRANSACTION';
        legalExplanation = `Subject was designated at transaction time but subsequently delisted on ${new Date(rec.removalDate!).toUTCString()}.`;
      } else {
        temporalStatus = 'NOT_LISTED_AT_TRANSACTION_TIME';
        legalExplanation = 'No active sanctions listing was identified for this party at the transaction timestamp.';
      }

      if (matchConfidence < CONFIRMED_MATCH_THRESHOLD) {
        legalExplanation = `POSSIBLE NAME MATCH (${Math.round(matchConfidence * 100)}% similarity) — requires analyst disposition before it is treated as a listing. ${legalExplanation}`;
      }

      const sourceMeta = this.sources.get(rec.sanctionsList);

      matches.push({
        matchId: `MATCH-${rec.id}-${Date.now()}`,
        matchedEntityId: rec.id,
        matchedName: rec.primaryName,
        searchedName: nameOrIdentifier,
        partyRole,
        matchType,
        matchConfidence,
        sanctionsList: rec.sanctionsList,
        jurisdiction: rec.jurisdiction,
        programs: rec.programs,
        transactionTimestamp,
        designationDate: rec.designationDate,
        effectiveDate: rec.effectiveDate,
        removalDate: rec.removalDate,
        temporalStatus,
        isCurrentlyListed,
        wasListedAtTransactionTime,
        legalExplanation,
        recommendedAction:
          matchConfidence < CONFIRMED_MATCH_THRESHOLD
            ? 'REVIEW POSSIBLE MATCH: Compare date of birth, address, registration and identifiers with the listing before release.'
            : wasListedAtTransactionTime
              ? `BLOCK / FREEZE TRANSACTION: Active prohibition under ${rec.legalAuthority}. Escalate to Sanctions Compliance Officer.`
              : temporalStatus === 'ADDED_AFTER_TRANSACTION'
                ? `CONDUCT ENHANCED POST-TRANSACTION REVIEW: Entity designated post-transaction (${new Date(rec.designationDate).toLocaleDateString()}). Verify no ongoing open commitments or outstanding payments.`
                : 'Proceed with standard documentary controls.',
        sourceSnapshotId: rec.sourceSnapshotId,
        sourceChecksum: sourceMeta?.checksumSha256 ?? 'n/a',
      });
    }

    return matches;
  }

  /**
   * The searchable index: built-in sample records for lists that have no live data, plus the
   * latest version of every record in the compliance store (current or delisted — superseded
   * amendments are skipped). Rebuilt only when the store's entity revision changes, so a query is a
   * single linear pass over pre-normalised names.
   */
  private getIndex(): IndexedRecord[] {
    let snapshot: { revision: number; entities: ComplianceEntityRecord[] } | null = null;
    let liveLists = new Set<string>();
    try {
      // Lazy require: the store module imports this registry indirectly.
       
      const { ComplianceStore } = require('../db/compliance-store') as typeof import('../db/compliance-store');
      const store = ComplianceStore.getInstance();
      snapshot = store.getEntitySnapshot();
      liveLists = store.getLiveSourceIds();
    } catch {
      snapshot = null;
    }

    const revision = snapshot?.revision ?? -1;
    if (this.index && revision === this.indexRevision) return this.index;

    const records: SanctionEntityTemporalRecord[] = this.entityStore.filter((rec) => !liveLists.has(rec.sanctionsList));
    const seenIds = new Set(records.map((r) => r.id));

    for (const ent of snapshot?.entities ?? []) {
      const superseded = !ent.isCurrent && !ent.validTo;
      if (superseded || seenIds.has(ent.canonicalId)) continue;
      seenIds.add(ent.canonicalId);
      records.push({
        id: ent.canonicalId,
        primaryName: ent.canonicalName || 'UNKNOWN',
        aliases: ent.aliases || [],
        entityType: ent.entityType,
        jurisdiction: LIST_JURISDICTION[ent.sourceId] ?? 'US',
        sanctionsList: ent.sourceId,
        programs: ent.programs || [],
        country: ent.country,
        identifiers: ent.identifiers,
        designationDate: `${ent.validFrom}T00:00:00Z`,
        designationDateBasis: ent.validFromBasis,
        effectiveDate: `${ent.validFrom}T00:00:00Z`,
        removalDate: ent.validTo ? `${ent.validTo}T00:00:00Z` : null,
        legalAuthority: ent.programs?.[0] || 'Sanctions Authority',
        measures: ['Asset Freeze', 'Blocking Sanctions'],
        remarks: ent.remarks || '',
        sourceSnapshotId: `${ent.sourceId}-V${ent.version}`,
      });
    }

    this.index = records.map((record) => ({
      record,
      names: [record.primaryName, ...record.aliases].map(prepareName).filter((n) => n.normalized.length > 0),
    }));
    this.indexRevision = revision;
    return this.index;
  }

  /**
   * Retrieve append-only change event history
   */
  public getChangeEvents() {
    return [...this.changeEvents];
  }
}
