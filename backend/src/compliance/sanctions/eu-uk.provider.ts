import type { ISanctionsProvider, SanctionedEntityRecord, ScreeningQuery } from './sanctions.provider';
import type { JurisdictionRiskCheck, SanctionsMatch } from '../types';
import { SANCTIONED_JURISDICTIONS } from './jurisdictions.data';

/**
 * EU Financial Sanctions & UK OFSI/HMT Provider
 */
export class EuUkSanctionsProvider implements ISanctionsProvider {
  readonly id = 'EU_UK_PROVIDER';
  readonly name = 'European Union Consolidated List & UK OFSI/HMT Sanctions';
  readonly datasetVersion = 'EU-UK-OFSI-2026.08-V2';
  readonly lastUpdated = '2026-08-18T00:00:00Z';

  private readonly entities: SanctionedEntityRecord[] = [
    {
      id: 'EU-3001',
      name: 'Promsyrioimport',
      aliases: ['AO Promsyrioimport', 'Promsyryoimport'],
      entityType: 'ENTITY',
      list: 'EU_SANCTIONS',
      programs: ['EU UKRAINE SANCTIONS', 'UK RUSSIA REGS'],
      country: 'Russia',
      remarks: 'Sanctioned for facilitating illicit shipments and violating trade restrictions.',
    },
    {
      id: 'UK-3002',
      name: 'United Shipbuilding Corporation',
      aliases: ['USC', 'JSC United Shipbuilding'],
      entityType: 'ENTITY',
      list: 'UK_OFSI',
      programs: ['UK RUSSIA SANCTIONS', 'EU COUNCIL REG 269/2014'],
      country: 'Russia',
      remarks: 'Primary state-owned shipbuilding conglomerate producing naval vessels and maritime systems.',
    },
    {
      id: 'EU-3003',
      name: 'Sberbank of Russia',
      aliases: ['PJSC Sberbank', 'Sberbank'],
      entityType: 'BANK',
      list: 'EU_SANCTIONS',
      programs: ['EU SWIFT BAN', 'UK OFSI FINANCIAL SANCTIONS'],
      country: 'Russia',
      swiftBic: 'SABRRUMM',
      remarks: 'Excluded from SWIFT and subjected to full asset freeze by EU and UK authorities.',
    },
    {
      id: 'UK-3004',
      name: 'Wagner Group',
      aliases: ['PMC Wagner', 'ChVK Wagner', 'Africa Corps'],
      entityType: 'ENTITY',
      list: 'UK_OFSI',
      programs: ['UK PROSCRIBED ORG', 'EU HUMAN RIGHTS SANCTIONS'],
      country: 'Russia',
      remarks: 'Designated terrorist organization and illicit extraction/procurement facilitator.',
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
        matches.push(this.buildMatch(record, query, 'FUZZY_NAME', 0.79));
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
    const cleanSwift = (swiftBic || '').toUpperCase().trim();

    for (const record of this.entities.filter((e) => e.entityType === 'BANK')) {
      if (cleanSwift && record.swiftBic && (record.swiftBic.startsWith(cleanSwift.slice(0, 6)) || cleanSwift.startsWith(record.swiftBic.slice(0, 6)))) {
        matches.push(this.buildMatch(record, { name: bankName, role: 'BANK', swiftBic, country }, 'SWIFT_CODE', 0.98));
      } else if (normBank && (normalize(record.name) === normBank || record.aliases.some((a) => normalize(a) === normBank))) {
        matches.push(this.buildMatch(record, { name: bankName, role: 'BANK', swiftBic, country }, 'EXACT', 0.96));
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
      description: `EU / UK Sanctions: ${hit.description}`,
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
      sanctionsList: record.list as any,
      sanctionProgram: record.programs.join('; '),
      matchType,
      matchConfidence: confidence,
      matchedIdentifiers: [record.id, record.swiftBic ? `SWIFT: ${record.swiftBic}` : null, record.country ? `Country: ${record.country}` : null].filter((x): x is string => x !== null),
      countryAssociated: record.country,
      sourceDatasetVersion: this.datasetVersion,
      screeningTimestamp: new Date().toISOString(),
      recommendedAction: `Escalate to Compliance. Prohibited under EU Regulation / UK Sanctions Regulations (${record.programs.join(', ')}).`,
    };
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}
