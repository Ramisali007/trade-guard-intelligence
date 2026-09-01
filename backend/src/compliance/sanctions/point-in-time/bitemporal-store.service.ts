import crypto from 'node:crypto';

export interface SanctionsListVersionRecord {
  versionId: string;
  source: 'OFAC_SDN' | 'OFAC_CONSOLIDATED' | 'UN_CONSOLIDATED' | 'EU_FSF' | 'UK_UKSL' | 'SBP_TFS';
  publishedAt: string;
  ingestedAt: string;
  sourceUrl: string;
  fileSha256: string;
  rawFilePath: string;
  recordCount: number;
  isDelta: boolean;
}

export interface SanctionsEntryRecord {
  entryId: string;
  versionId: string;
  sourceEntityId: string;
  entityName: string;
  aliases: string[];
  entityType: 'INDIVIDUAL' | 'ENTITY' | 'VESSEL' | 'AIRCRAFT' | 'BANK';
  programTags: string[];
  identifiers: Record<string, any>;
  validFrom: string; // ISO Date YYYY-MM-DD
  validTo: string | null; // ISO Date or null if active
  rawRecord: Record<string, any>;
}

export interface ScreeningEventRecord {
  screeningId: string;
  transactionId: string;
  partyRole: string;
  partySnapshot: Record<string, any>;
  screenedAt: string;
  asOfDate: string; // YYYY-MM-DD
  listVersionsUsed: string[];
  matchResult: 'NO_MATCH' | 'POTENTIAL_MATCH' | 'CONFIRMED_MATCH';
  matchedEntries: Array<{
    entryId: string;
    confidenceScore: number;
    matchingFields: string[];
  }>;
  decision: 'ALLOW' | 'REVIEW' | 'BLOCK';
  reviewedBy?: string;
  reviewedAt?: string;
  prevEventHash: string;
  eventHash: string;
}

export class BitemporalSanctionsStore {
  private static instance: BitemporalSanctionsStore;

  private readonly listVersions: Map<string, SanctionsListVersionRecord> = new Map();
  private readonly entries: SanctionsEntryRecord[] = [];
  private readonly screeningEvents: ScreeningEventRecord[] = [];
  private latestEventHash = '0000000000000000000000000000000000000000000000000000000000000000';

  private constructor() {
    this.seedBaselineVersions();
  }

  public static getInstance(): BitemporalSanctionsStore {
    if (!BitemporalSanctionsStore.instance) {
      BitemporalSanctionsStore.instance = new BitemporalSanctionsStore();
    }
    return BitemporalSanctionsStore.instance;
  }

  private seedBaselineVersions(): void {
    const versions: SanctionsListVersionRecord[] = [
      {
        versionId: 'VER-OFAC-SDN-2026.08.30',
        source: 'OFAC_SDN',
        publishedAt: '2026-08-30T14:00:00Z',
        ingestedAt: '2026-08-30T14:15:00Z',
        sourceUrl: 'https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists',
        fileSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        rawFilePath: 'worm://archive/ofac/2026-08-30-SDN_ADVANCED.XML',
        recordCount: 14820,
        isDelta: false,
      },
      {
        versionId: 'VER-UN-CONS-2026.08.28',
        source: 'UN_CONSOLIDATED',
        publishedAt: '2026-08-28T09:00:00Z',
        ingestedAt: '2026-08-28T09:30:00Z',
        sourceUrl: 'https://www.un.org/securitycouncil/content/un-sc-consolidated-list',
        fileSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        rawFilePath: 'worm://archive/unsc/2026-08-28-consolidated.xml',
        recordCount: 1045,
        isDelta: false,
      },
      {
        versionId: 'VER-EU-FSF-2026.08.25',
        source: 'EU_FSF',
        publishedAt: '2026-08-25T11:00:00Z',
        ingestedAt: '2026-08-25T11:20:00Z',
        sourceUrl: 'https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions',
        fileSha256: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
        rawFilePath: 'worm://archive/eu/2026-08-25-ANNUAL.XML',
        recordCount: 2310,
        isDelta: false,
      },
      {
        versionId: 'VER-UK-UKSL-2026.08.29',
        source: 'UK_UKSL',
        publishedAt: '2026-08-29T16:00:00Z',
        ingestedAt: '2026-08-29T16:15:00Z',
        sourceUrl: 'https://www.gov.uk/government/publications/the-uk-sanctions-list',
        fileSha256: '4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a',
        rawFilePath: 'worm://archive/uk/2026-08-29-UK_Sanctions_List.xml',
        recordCount: 4230,
        isDelta: false,
      },
      {
        versionId: 'VER-SBP-TFS-2026.08.20',
        source: 'SBP_TFS',
        publishedAt: '2026-08-20T08:00:00Z',
        ingestedAt: '2026-08-20T08:30:00Z',
        sourceUrl: 'https://nacta.gov.pk/proscribed-organizations/',
        fileSha256: 'ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d',
        rawFilePath: 'worm://archive/sbp/2026-08-20-TFS.pdf',
        recordCount: 890,
        isDelta: false,
      },
    ];

    for (const v of versions) {
      this.listVersions.set(v.versionId, v);
    }
  }

  /**
   * Append-only immutable recording of a screening event with cryptographic hash chaining
   */
  public recordScreeningEvent(params: {
    transactionId: string;
    partyRole: string;
    partySnapshot: Record<string, any>;
    asOfDate: string;
    listVersionsUsed: string[];
    matchResult: 'NO_MATCH' | 'POTENTIAL_MATCH' | 'CONFIRMED_MATCH';
    matchedEntries: Array<{
      entryId: string;
      confidenceScore: number;
      matchingFields: string[];
    }>;
    decision: 'ALLOW' | 'REVIEW' | 'BLOCK';
    reviewedBy?: string;
    reviewedAt?: string;
  }): ScreeningEventRecord {
    const screeningId = `SCR-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const screenedAt = new Date().toISOString();
    const prevEventHash = this.latestEventHash;

    const canonicalData = JSON.stringify({
      screeningId,
      transactionId: params.transactionId,
      partyRole: params.partyRole,
      partySnapshot: params.partySnapshot,
      screenedAt,
      asOfDate: params.asOfDate,
      listVersionsUsed: params.listVersionsUsed,
      matchResult: params.matchResult,
      matchedEntries: params.matchedEntries,
      decision: params.decision,
      prevEventHash,
    });

    const eventHash = crypto.createHash('sha256').update(canonicalData).digest('hex');
    this.latestEventHash = eventHash;

    const record: ScreeningEventRecord = {
      screeningId,
      transactionId: params.transactionId,
      partyRole: params.partyRole,
      partySnapshot: params.partySnapshot,
      screenedAt,
      asOfDate: params.asOfDate,
      listVersionsUsed: params.listVersionsUsed,
      matchResult: params.matchResult,
      matchedEntries: params.matchedEntries,
      decision: params.decision,
      reviewedBy: params.reviewedBy,
      reviewedAt: params.reviewedAt,
      prevEventHash,
      eventHash,
    };

    this.screeningEvents.push(record);
    return record;
  }

  public getScreeningEventsForTransaction(transactionId: string): ScreeningEventRecord[] {
    return this.screeningEvents.filter((ev) => ev.transactionId === transactionId);
  }

  public listAllVersions(): SanctionsListVersionRecord[] {
    return Array.from(this.listVersions.values());
  }
}
