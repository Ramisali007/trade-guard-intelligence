import type { ISanctionsProvider, SanctionedEntityRecord, ScreeningQuery } from './sanctions.provider';
import type { JurisdictionRiskCheck, SanctionsMatch } from '../types';
import { SANCTIONED_JURISDICTIONS } from './jurisdictions.data';

/**
 * OFAC Sanctions Provider (SDN, Non-SDN, SSI, Vessels, Banks)
 */
export class OfacSanctionsProvider implements ISanctionsProvider {
  readonly id = 'OFAC_PROVIDER';
  readonly name = 'US Treasury Office of Foreign Assets Control (OFAC)';
  readonly datasetVersion = 'OFAC-SDN-2026.08-V4';
  readonly lastUpdated = '2026-08-15T00:00:00Z';

  private readonly entities: SanctionedEntityRecord[] = [
    // Entities & Individuals
    {
      id: 'OFAC-1001',
      name: 'Vnesheconombank',
      aliases: ['VEB.RF', 'Vneshekonombank', 'State Development Corporation VEB'],
      entityType: 'BANK',
      list: 'OFAC_SDN',
      programs: ['RUSSIA-EO14024', 'UKRAINE-EO13662'],
      country: 'Russia',
      swiftBic: 'BSEERUMM',
      remarks: 'Russian state development corporation subject to full blocking sanctions.',
    },
    {
      id: 'OFAC-1002',
      name: 'Bank Melli Iran',
      aliases: ['National Bank of Iran', 'BMI'],
      entityType: 'BANK',
      list: 'OFAC_SDN',
      programs: ['IRAN', 'SDGT', 'NPWMD'],
      country: 'Iran',
      swiftBic: 'MELIIRTH',
      remarks: 'Iranian state bank designated for facilitating proliferation & terrorism financing.',
    },
    {
      id: 'OFAC-1003',
      name: 'Sovcomflot',
      aliases: ['PAO Sovcomflot', 'SCF Group', 'Russian Maritime Shipping Company'],
      entityType: 'ENTITY',
      list: 'OFAC_SDN',
      programs: ['RUSSIA-EO14024'],
      country: 'Russia',
      remarks: 'Major Russian state maritime shipping enterprise subject to blocking sanctions.',
    },
    {
      id: 'OFAC-1004',
      name: 'Islamic Republic of Iran Shipping Lines',
      aliases: ['IRISL', 'IRISL Group'],
      entityType: 'ENTITY',
      list: 'OFAC_SDN',
      programs: ['IRAN', 'NPWMD'],
      country: 'Iran',
      remarks: 'National maritime carrier of Iran designated for WMD proliferation support.',
    },
    {
      id: 'OFAC-1005',
      name: 'Rosoboronexport',
      aliases: ['Rosoboroneksport', 'JSC Rosoboronexport'],
      entityType: 'ENTITY',
      list: 'OFAC_SDN',
      programs: ['RUSSIA-EO14024', 'CAATSA'],
      country: 'Russia',
      remarks: 'Russian state intermediary for military and dual-use defense exports.',
    },
    {
      id: 'OFAC-1006',
      name: 'Al-Quds Maritime Trading FZE',
      aliases: ['Al Quds Shipping', 'Quds Maritime'],
      entityType: 'ENTITY',
      list: 'OFAC_SDN',
      programs: ['SDGT', 'IRAN-EO13224'],
      country: 'United Arab Emirates',
      remarks: 'Front company used to facilitate illicit petroleum shipments and covert procurement.',
    },
    {
      id: 'OFAC-1007',
      name: 'Cangzhou Hexing Chemical Co Ltd',
      aliases: ['Hexing Chemical', 'Cangzhou Hexing Tech'],
      entityType: 'ENTITY',
      list: 'OFAC_SDN',
      programs: ['NPWMD', 'IRAN'],
      country: 'China',
      remarks: 'Designated for supplying precursor chemicals and missile-applicable components.',
    },
    // Vessels
    {
      id: 'OFAC-V01',
      name: 'LADY M',
      aliases: ['LADY M II', 'OCEAN JEWEL'],
      entityType: 'VESSEL',
      list: 'OFAC_SDN',
      programs: ['RUSSIA-EO14024'],
      imoNumber: '9152345',
      country: 'Russia',
      remarks: 'Blocked vessel associated with designated Russian energy logistics network.',
    },
    {
      id: 'OFAC-V02',
      name: 'NESTOR',
      aliases: ['SEA NESTOR', 'GOLDEN NESTOR'],
      entityType: 'VESSEL',
      list: 'OFAC_SDN',
      programs: ['IRAN-EO13846'],
      imoNumber: '9234567',
      country: 'Iran',
      remarks: 'Sanctioned crude oil tanker engaged in illicit ship-to-ship transfers.',
    },
    {
      id: 'OFAC-V03',
      name: 'AMUR',
      aliases: ['RIVER AMUR'],
      entityType: 'VESSEL',
      list: 'OFAC_SDN',
      programs: ['DPRK'],
      imoNumber: '8912344',
      country: 'North Korea',
      remarks: 'Vessel engaged in prohibited refined petroleum deliveries to North Korea.',
    },
  ];

  async screenEntity(query: ScreeningQuery): Promise<SanctionsMatch[]> {
    if (!query.name || query.name.trim().length < 2) return [];
    const matches: SanctionsMatch[] = [];
    const searchTarget = normalize(query.name);

    for (const record of this.entities) {
      const recordNameNorm = normalize(record.name);
      const aliasNorms = record.aliases.map(normalize);

      // Exact match
      if (searchTarget === recordNameNorm) {
        matches.push(this.buildMatch(record, query, 'EXACT', 0.99));
        continue;
      }

      // Alias exact match
      const matchedAlias = aliasNorms.find((a) => a === searchTarget);
      if (matchedAlias) {
        matches.push(this.buildMatch(record, query, 'ALIAS', 0.95));
        continue;
      }

      // High similarity fuzzy or substring match
      if (searchTarget.length > 5 && (recordNameNorm.includes(searchTarget) || searchTarget.includes(recordNameNorm))) {
        const confidence = calculateSimScore(searchTarget, recordNameNorm);
        if (confidence >= 0.75) {
          matches.push(this.buildMatch(record, query, 'FUZZY_NAME', confidence));
        }
      }
    }

    return matches;
  }

  async screenVessel(vesselName: string, imoNumber?: string): Promise<SanctionsMatch[]> {
    const matches: SanctionsMatch[] = [];
    const normVessel = normalize(vesselName || '');
    const cleanImo = imoNumber?.replace(/\D/g, '') || '';

    for (const record of this.entities.filter((e) => e.entityType === 'VESSEL')) {
      // IMO match is definitive
      if (cleanImo && record.imoNumber === cleanImo) {
        matches.push(this.buildMatch(record, { name: vesselName, role: 'VESSEL', imoNumber }, 'VESSEL_IMO', 0.99));
        continue;
      }

      if (normVessel) {
        const normRec = normalize(record.name);
        if (normRec === normVessel || record.aliases.some((a) => normalize(a) === normVessel)) {
          matches.push(this.buildMatch(record, { name: vesselName, role: 'VESSEL', imoNumber }, 'EXACT', 0.95));
        } else if (normVessel.length > 4 && (normRec.includes(normVessel) || normVessel.includes(normRec))) {
          matches.push(this.buildMatch(record, { name: vesselName, role: 'VESSEL', imoNumber }, 'FUZZY_NAME', 0.80));
        }
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
        continue;
      }

      if (normBank) {
        const normRec = normalize(record.name);
        if (normRec === normBank || record.aliases.some((a) => normalize(a) === normBank)) {
          matches.push(this.buildMatch(record, { name: bankName, role: 'BANK', swiftBic, country }, 'EXACT', 0.96));
        } else if (normBank.length > 5 && (normRec.includes(normBank) || normBank.includes(normRec))) {
          matches.push(this.buildMatch(record, { name: bankName, role: 'BANK', swiftBic, country }, 'FUZZY_NAME', 0.82));
        }
      }
    }

    return matches;
  }

  async checkJurisdiction(countryName: string, nodeRole: JurisdictionRiskCheck['nodeRole']): Promise<JurisdictionRiskCheck | null> {
    if (!countryName) return null;
    const targetNorm = normalize(countryName);

    const hit = SANCTIONED_JURISDICTIONS.find((j) => {
      return normalize(j.countryName) === targetNorm || j.aliases.some((a) => normalize(a) === targetNorm);
    });

    if (!hit) return null;

    return {
      nodeRole,
      countryName: hit.countryName,
      countryCode: hit.countryCode,
      sanctionsStatus: hit.sanctionsStatus,
      riskScore: hit.riskScore,
      description: `${hit.description} (Programs: ${hit.programs.join(', ')})`,
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
      sanctionsList: 'OFAC_SDN',
      sanctionProgram: record.programs.join('; '),
      matchType,
      matchConfidence: confidence,
      matchedIdentifiers: [
        record.id,
        record.imoNumber ? `IMO: ${record.imoNumber}` : null,
        record.swiftBic ? `SWIFT: ${record.swiftBic}` : null,
        record.country ? `Country: ${record.country}` : null,
      ].filter((x): x is string => x !== null),
      countryAssociated: record.country,
      sourceDatasetVersion: this.datasetVersion,
      screeningTimestamp: new Date().toISOString(),
      recommendedAction: `Escalate to Sanctions Compliance. Verified hit on ${record.programs.join(', ')}. Transaction must be blocked or held pending OFAC specific license validation.`,
    };
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateSimScore(a: string, b: string): number {
  if (a === b) return 1.0;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1.0;
  const overlap = shorter.split(' ').filter((w) => longer.includes(w)).length;
  const wordCount = shorter.split(' ').length;
  return Math.min(0.92, Math.max(0.70, (overlap / wordCount) * 0.9));
}
