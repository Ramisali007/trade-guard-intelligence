import type { ISanctionsProvider, SanctionedEntityRecord, ScreeningQuery } from './sanctions.provider';
import type { JurisdictionRiskCheck, SanctionsMatch } from '../types';
import { SANCTIONED_JURISDICTIONS } from './jurisdictions.data';

/**
 * UN Consolidated Sanctions Provider (UN Security Council Resolutions)
 */
export class UnSanctionsProvider implements ISanctionsProvider {
  readonly id = 'UN_PROVIDER';
  readonly name = 'United Nations Security Council Consolidated Sanctions List';
  readonly datasetVersion = 'UN-SC-2026.08-V1';
  readonly lastUpdated = '2026-08-10T00:00:00Z';

  private readonly entities: SanctionedEntityRecord[] = [
    {
      id: 'UN-2001',
      name: 'Ocean Maritime Management Company',
      aliases: ['OMM', 'East Sea Shipping Company'],
      entityType: 'ENTITY',
      list: 'UN_CONSOLIDATED',
      programs: ['UN 1718 (DPRK)'],
      country: 'North Korea',
      remarks: 'Designated by UN 1718 Committee for arranging illicit arms and dual-use cargo shipments.',
    },
    {
      id: 'UN-2002',
      name: 'Korea Mining Development Trading Corporation',
      aliases: ['KOMID', 'Changgwang Sinyong Corporation'],
      entityType: 'ENTITY',
      list: 'UN_CONSOLIDATED',
      programs: ['UN 1718 (DPRK)'],
      country: 'North Korea',
      remarks: 'Primary arms dealer and main exporter of goods and equipment related to ballistic missiles.',
    },
    {
      id: 'UN-2003',
      name: 'Shahid Hemmat Industrial Group',
      aliases: ['SHIG', 'Hemmat Missile Industries'],
      entityType: 'ENTITY',
      list: 'UN_CONSOLIDATED',
      programs: ['UN 2231 (Iran)'],
      country: 'Iran',
      remarks: 'Subordinate to Iran Aerospace Industries Organization, develops ballistic missile systems.',
    },
    {
      id: 'UN-2004',
      name: 'Al-Barakaat Group of Companies',
      aliases: ['Barakaat Telecommunications', 'Al-Barakat Forex'],
      entityType: 'ENTITY',
      list: 'UN_CONSOLIDATED',
      programs: ['UN 1267 (ISIL & Al-Qaida)'],
      country: 'Somalia',
      remarks: 'Designated for providing financial support and money remittance to terrorist organizations.',
    },
    {
      id: 'UN-V01',
      name: 'JIE SHUN',
      aliases: ['HAO FAN 6'],
      entityType: 'VESSEL',
      list: 'UN_CONSOLIDATED',
      programs: ['UN 1718 (DPRK)'],
      imoNumber: '8512345',
      country: 'Cambodia (Flag of Convenience)',
      remarks: 'Vessel subjected to global port entry ban for prohibited North Korean cargo transport.',
    },
  ];

  async screenEntity(query: ScreeningQuery): Promise<SanctionsMatch[]> {
    if (!query.name || query.name.trim().length < 2) return [];
    const matches: SanctionsMatch[] = [];
    const target = normalize(query.name);

    for (const record of this.entities) {
      const recName = normalize(record.name);
      if (recName === target || record.aliases.some((a) => normalize(a) === target)) {
        matches.push(this.buildMatch(record, query, 'EXACT', 0.98));
      } else if (target.length > 5 && (recName.includes(target) || target.includes(recName))) {
        matches.push(this.buildMatch(record, query, 'FUZZY_NAME', 0.78));
      }
    }
    return matches;
  }

  async screenVessel(vesselName: string, imoNumber?: string): Promise<SanctionsMatch[]> {
    const matches: SanctionsMatch[] = [];
    const normVessel = normalize(vesselName || '');
    const cleanImo = imoNumber?.replace(/\D/g, '') || '';

    for (const record of this.entities.filter((e) => e.entityType === 'VESSEL')) {
      if (cleanImo && record.imoNumber === cleanImo) {
        matches.push(this.buildMatch(record, { name: vesselName, role: 'VESSEL', imoNumber }, 'VESSEL_IMO', 0.99));
      } else if (normVessel && (normalize(record.name) === normVessel || record.aliases.some((a) => normalize(a) === normVessel))) {
        matches.push(this.buildMatch(record, { name: vesselName, role: 'VESSEL', imoNumber }, 'EXACT', 0.95));
      }
    }
    return matches;
  }

  async screenBank(bankName: string, swiftBic?: string, country?: string): Promise<SanctionsMatch[]> {
    const matches: SanctionsMatch[] = [];
    const normBank = normalize(bankName || '');
    for (const record of this.entities.filter((e) => e.entityType === 'BANK')) {
      if (normBank && (normalize(record.name) === normBank || record.aliases.some((a) => normalize(a) === normBank))) {
        matches.push(this.buildMatch(record, { name: bankName, role: 'BANK', swiftBic, country }, 'EXACT', 0.95));
      }
    }
    return matches;
  }

  async checkJurisdiction(countryName: string, nodeRole: JurisdictionRiskCheck['nodeRole']): Promise<JurisdictionRiskCheck | null> {
    if (!countryName) return null;
    const targetNorm = normalize(countryName);
    const hit = SANCTIONED_JURISDICTIONS.find((j) => normalize(j.countryName) === targetNorm || j.aliases.some((a) => normalize(a) === targetNorm));
    if (!hit) return null;
    return {
      nodeRole,
      countryName: hit.countryName,
      countryCode: hit.countryCode,
      sanctionsStatus: hit.sanctionsStatus,
      riskScore: hit.riskScore,
      description: `UN Multilateral Sanctions: ${hit.description}`,
    };
  }

  private buildMatch(
    record: SanctionedEntityRecord,
    query: ScreeningQuery,
    matchType: SanctionsMatch['matchType'],
    confidence: number,
  ): SanctionsMatch {
    return {
      entityOrSubject: query.name,
      roleOrField: query.role,
      matchedSanctionedName: record.name,
      sanctionsList: 'UN_CONSOLIDATED',
      sanctionProgram: record.programs.join('; '),
      matchType,
      matchConfidence: confidence,
      matchedIdentifiers: [record.id, record.imoNumber ? `IMO: ${record.imoNumber}` : null, record.country ? `Country: ${record.country}` : null].filter((x): x is string => x !== null),
      countryAssociated: record.country,
      sourceDatasetVersion: this.datasetVersion,
      screeningTimestamp: new Date().toISOString(),
      recommendedAction: `Escalate immediately. UN Security Council sanctions match under ${record.programs.join(', ')}. Prohibited under international law.`,
    };
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}
