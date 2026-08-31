import type { SanctionsMatch, JurisdictionRiskCheck } from '../types';

export interface SanctionedEntityRecord {
  id: string;
  name: string;
  aliases: string[];
  entityType: 'INDIVIDUAL' | 'ENTITY' | 'VESSEL' | 'AIRCRAFT' | 'BANK';
  list: 'OFAC_SDN' | 'UN_CONSOLIDATED' | 'EU_SANCTIONS' | 'UK_OFSI' | 'INTERNAL_WATCHLIST';
  programs: string[];
  country?: string;
  address?: string;
  registrationNumber?: string;
  imoNumber?: string;
  swiftBic?: string;
  remarks?: string;
  dateListed?: string;
}

export interface ScreeningQuery {
  name: string;
  role: string;
  country?: string;
  address?: string;
  imoNumber?: string;
  swiftBic?: string;
  entityType?: 'INDIVIDUAL' | 'ENTITY' | 'VESSEL' | 'AIRCRAFT' | 'BANK';
}

export interface ISanctionsProvider {
  readonly id: string;
  readonly name: string;
  readonly datasetVersion: string;
  readonly lastUpdated: string;

  screenEntity(query: ScreeningQuery): Promise<SanctionsMatch[]>;
  screenVessel(vesselName: string, imoNumber?: string): Promise<SanctionsMatch[]>;
  screenBank(bankName: string, swiftBic?: string, country?: string): Promise<SanctionsMatch[]>;
  checkJurisdiction(countryName: string, nodeRole: JurisdictionRiskCheck['nodeRole']): Promise<JurisdictionRiskCheck | null>;
}
