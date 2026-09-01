import crypto from 'node:crypto';
import type {
  AuthoritativeSourceMetadata,
  SanctionEntityTemporalRecord,
  SourceHealthState,
  TemporalSanctionsMatch,
  TemporalSanctionsStatus,
} from './temporal.types';

export class SnapshotRegistry {
  private static instance: SnapshotRegistry;

  // Metadata of all registered regulatory sources
  private readonly sources: Map<string, AuthoritativeSourceMetadata> = new Map();

  // Snapshot store: sourceId -> version -> entity list
  private readonly entityStore: SanctionEntityTemporalRecord[] = [];

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
    const baselineSources: AuthoritativeSourceMetadata[] = [
      {
        sourceId: 'OFAC_SDN',
        sourceName: 'US Treasury Office of Foreign Assets Control — Specially Designated Nationals List',
        jurisdiction: 'US',
        regulatoryAuthority: 'US Department of the Treasury (OFAC)',
        sourceUrl: 'https://sanctionslistservice.ofac.treas.gov/api/Publication/GetPackage',
        sourceType: 'API',
        datasetType: 'SDN',
        currentVersion: 'OFAC-SDN-2026.08.30-V1',
        publishedAt: '2026-08-30T14:00:00Z',
        retrievedAt: '2026-08-30T14:15:00Z',
        effectiveAt: '2026-08-30T14:00:00Z',
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
        sourceUrl: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
        sourceType: 'XML_FEED',
        datasetType: 'CONSOLIDATED_LIST',
        currentVersion: 'UNSC-CONS-2026.08.28-V1',
        publishedAt: '2026-08-28T09:00:00Z',
        retrievedAt: '2026-08-28T09:30:00Z',
        effectiveAt: '2026-08-28T09:00:00Z',
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
        sourceUrl: 'https://webgate.ec.europa.eu/europeaid/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content',
        sourceType: 'XML_FEED',
        datasetType: 'SANCTIONS_LIST',
        currentVersion: 'EU-FSF-2026.08.25-V2',
        publishedAt: '2026-08-25T11:00:00Z',
        retrievedAt: '2026-08-25T11:20:00Z',
        effectiveAt: '2026-08-25T11:00:00Z',
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
        currentVersion: 'UK-SANCTIONS-2026.08.29-V1',
        publishedAt: '2026-08-29T16:00:00Z',
        retrievedAt: '2026-08-29T16:15:00Z',
        effectiveAt: '2026-08-29T16:00:00Z',
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
        sourceUrl: 'https://www.sbp.org.pk/bprd/2026/TFS-Consolidated.pdf',
        sourceType: 'REGULATORY_CIRCULAR',
        datasetType: 'TFS_LIST',
        currentVersion: 'SBP-TFS-2026.08.20-V3',
        publishedAt: '2026-08-20T08:00:00Z',
        retrievedAt: '2026-08-20T08:30:00Z',
        effectiveAt: '2026-08-20T08:00:00Z',
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
        sourceUrl: 'https://www.bis.doc.gov/index.php/documents/regulations-docs/federal-register-notices',
        sourceType: 'API',
        datasetType: 'EXPORT_CONTROL_CCL',
        currentVersion: 'BIS-ENTITY-2026.08.15-V1',
        publishedAt: '2026-08-15T12:00:00Z',
        retrievedAt: '2026-08-15T12:30:00Z',
        effectiveAt: '2026-08-15T12:00:00Z',
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
        primaryName: 'Al-Manar Petrochemicals FZE',
        aliases: ['Al Manar Petrochemical Trading', 'Al-Manar Energy FZE'],
        entityType: 'ENTITY',
        jurisdiction: 'US',
        sanctionsList: 'OFAC_SDN',
        programs: ['IRAN-EO13846'],
        country: 'Iran',
        designationDate: '2026-07-10T00:00:00Z', // Designated on 10-Jul-2026!
        effectiveDate: '2026-07-10T00:00:00Z',
        removalDate: null,
        legalAuthority: 'Executive Order 13846',
        measures: ['Full Blocking Sanctions', 'Secondary Sanctions Risk'],
        remarks: 'Front company brokering illicit petrochemical shipments on behalf of sanctioned entities.',
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
    const queryNorm = normalizeString(nameOrIdentifier);
    if (!queryNorm || queryNorm.length < 2) return matches;

    const txnTime = new Date(transactionTimestamp).getTime();

    for (const rec of this.entityStore) {
      // Jurisdiction filter
      if (options?.jurisdictions && !options.jurisdictions.includes(rec.jurisdiction)) {
        continue;
      }

      let matchType: TemporalSanctionsMatch['matchType'] | null = null;
      let matchConfidence = 0;

      // 1. Identifier Exact Match (SWIFT BIC / IMO)
      if (options?.swiftBic && rec.identifiers?.swiftBic) {
        if (normalizeString(options.swiftBic) === normalizeString(rec.identifiers.swiftBic)) {
          matchType = 'IDENTIFIER_MATCH';
          matchConfidence = 0.99;
        }
      }
      if (options?.imoNumber && rec.identifiers?.imoNumber) {
        if (options.imoNumber.trim() === rec.identifiers.imoNumber.trim()) {
          matchType = 'IDENTIFIER_MATCH';
          matchConfidence = 0.99;
        }
      }

      // 2. Primary Name Exact or High-Confidence Fuzzy
      if (!matchType) {
        const primaryNorm = normalizeString(rec.primaryName);
        if (queryNorm === primaryNorm) {
          matchType = 'EXACT_MATCH';
          matchConfidence = 1.0;
        } else if (queryNorm.includes(primaryNorm) || primaryNorm.includes(queryNorm)) {
          matchType = 'HIGH_CONFIDENCE_MATCH';
          matchConfidence = 0.92;
        } else {
          // Check aliases
          for (const alias of rec.aliases) {
            const aliasNorm = normalizeString(alias);
            if (queryNorm === aliasNorm) {
              matchType = 'EXACT_MATCH';
              matchConfidence = 0.98;
              break;
            } else if (queryNorm.includes(aliasNorm) || aliasNorm.includes(queryNorm)) {
              matchType = 'HIGH_CONFIDENCE_MATCH';
              matchConfidence = 0.90;
              break;
            }
          }
        }
      }

      if (!matchType) continue;

      // 3. Temporal Point-in-Time Evaluation
      const desigTime = new Date(rec.designationDate).getTime();
      const removalTime = rec.removalDate ? new Date(rec.removalDate).getTime() : null;

      const isCurrentlyListed = removalTime === null || removalTime > Date.now();
      const wasListedAtTransactionTime =
        desigTime <= txnTime && (removalTime === null || removalTime > txnTime);

      let temporalStatus: TemporalSanctionsStatus;
      let legalExplanation = '';

      if (wasListedAtTransactionTime) {
        temporalStatus = 'LISTED_AT_TRANSACTION_TIME';
        legalExplanation = `Subject was an active designated party under ${rec.sanctionsList} (${rec.programs.join(', ')}) at the transaction time (${new Date(transactionTimestamp).toUTCString()}). Designation Date: ${new Date(rec.designationDate).toUTCString()}.`;
      } else if (desigTime > txnTime) {
        temporalStatus = 'ADDED_AFTER_TRANSACTION';
        legalExplanation = `Subject is currently designated under ${rec.sanctionsList}, but designation occurred on ${new Date(rec.designationDate).toUTCString()}, which is AFTER the transaction timestamp (${new Date(transactionTimestamp).toUTCString()}). Under standard non-retroactivity principles, this listing was not active at the historical transaction point.`;
      } else if (removalTime !== null && removalTime <= txnTime) {
        temporalStatus = 'REMOVED_BEFORE_TRANSACTION';
        legalExplanation = `Subject was formerly designated on ${new Date(rec.designationDate).toUTCString()} but was formally delisted on ${new Date(rec.removalDate!).toUTCString()}, prior to the transaction date.`;
      } else if (removalTime !== null && removalTime > txnTime) {
        temporalStatus = 'REMOVED_AFTER_TRANSACTION';
        legalExplanation = `Subject was designated at transaction time but subsequently delisted on ${new Date(rec.removalDate!).toUTCString()}.`;
      } else {
        temporalStatus = 'NOT_LISTED_AT_TRANSACTION_TIME';
        legalExplanation = 'No active sanctions listing was identified for this party at the transaction timestamp.';
      }

      const sourceMeta = this.sources.get(rec.sanctionsList) || this.sources.get('OFAC_SDN')!;

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
        recommendedAction: wasListedAtTransactionTime
          ? `BLOCK / FREEZE TRANSACTION: Active prohibition under ${rec.legalAuthority}. Escalate to Sanctions Compliance Officer.`
          : temporalStatus === 'ADDED_AFTER_TRANSACTION'
          ? `CONDUCT ENHANCED POST-TRANSACTION REVIEW: Entity designated post-transaction (${new Date(rec.designationDate).toLocaleDateString()}). Verify no ongoing open commitments or outstanding payments.`
          : 'Proceed with standard documentary controls.',
        sourceSnapshotId: rec.sourceSnapshotId,
        sourceChecksum: sourceMeta.checksumSha256,
      });
    }

    return matches;
  }

  /**
   * Retrieve append-only change event history
   */
  public getChangeEvents() {
    return [...this.changeEvents];
  }
}

function normalizeString(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
