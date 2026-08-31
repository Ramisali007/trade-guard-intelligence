import type { JurisdictionRiskCheck } from '../types';

export interface SanctionedCountryEntry {
  countryName: string;
  aliases: string[];
  countryCode: string;
  sanctionsStatus: JurisdictionRiskCheck['sanctionsStatus'];
  riskScore: number;
  programs: string[];
  description: string;
}

export const SANCTIONED_JURISDICTIONS: SanctionedCountryEntry[] = [
  {
    countryName: 'Iran',
    aliases: ['Islamic Republic of Iran', 'IRN', 'Persia'],
    countryCode: 'IR',
    sanctionsStatus: 'COMPREHENSIVE_SANCTIONED',
    riskScore: 95,
    programs: ['OFAC IRAN', 'UN SANCTIONS', 'EU IRAN', 'UK IRAN', 'FATF_BLACK_LIST'],
    description: 'Subject to comprehensive OFAC trade embargo, UN non-proliferation sanctions, EU/UK financial restrictions, and FATF Black List counter-measures.',
  },
  {
    countryName: 'North Korea',
    aliases: ["Democratic People's Republic of Korea", 'DPRK', 'PRK', 'Korea, North'],
    countryCode: 'KP',
    sanctionsStatus: 'COMPREHENSIVE_SANCTIONED',
    riskScore: 100,
    programs: ['OFAC DPRK', 'UN 1718', 'EU DPRK', 'UK DPRK', 'FATF_BLACK_LIST'],
    description: 'Subject to comprehensive multilateral trade embargo and FATF Black List counter-measures. Direct and indirect trade strictly prohibited.',
  },
  {
    countryName: 'Cuba',
    aliases: ['Republic of Cuba', 'CUB'],
    countryCode: 'CU',
    sanctionsStatus: 'COMPREHENSIVE_SANCTIONED',
    riskScore: 85,
    programs: ['OFAC CACR', 'US EMBARGO'],
    description: 'Subject to comprehensive OFAC Cuban Assets Control Regulations embargo and financial transaction prohibitions.',
  },
  {
    countryName: 'Syria',
    aliases: ['Syrian Arab Republic', 'SYR'],
    countryCode: 'SY',
    sanctionsStatus: 'COMPREHENSIVE_SANCTIONED',
    riskScore: 95,
    programs: ['OFAC SYRIA', 'EU SYRIA', 'UK SYRIA', 'CAATSA'],
    description: 'Subject to comprehensive sanctions, luxury goods embargo, petroleum import/export bans, and central bank asset freezes.',
  },
  {
    countryName: 'Russia',
    aliases: ['Russian Federation', 'RUS'],
    countryCode: 'RU',
    sanctionsStatus: 'SECTORAL_SANCTIONS',
    riskScore: 80,
    programs: ['OFAC RUSSIA-EO14024', 'EU RUSSIA 833/2014', 'UK RUSSIA REGS', 'FATF_GREY_LIST'],
    description: 'Extensive multi-jurisdictional sectoral sanctions, dual-use export bans, G7 price cap on oil, SWIFT disconnection for major banks, and designated SDN entities.',
  },
  {
    countryName: 'Belarus',
    aliases: ['Republic of Belarus', 'BLR', 'Belorussia'],
    countryCode: 'BY',
    sanctionsStatus: 'SECTORAL_SANCTIONS',
    riskScore: 75,
    programs: ['OFAC BELARUS', 'EU BELARUS', 'UK BELARUS'],
    description: 'Sectoral sanctions on potash, petroleum, and financial sectors; targeted asset freezes on state-owned enterprises and dual-use restrictions.',
  },
  {
    countryName: 'Myanmar',
    aliases: ['Burma', 'MMR'],
    countryCode: 'MM',
    sanctionsStatus: 'FATF_BLACK_LIST',
    riskScore: 78,
    programs: ['OFAC BURMA', 'EU MYANMAR', 'UK MYANMAR', 'FATF_BLACK_LIST'],
    description: 'Targeted sanctions on military-controlled holding companies and state energy enterprises; FATF Black List enhanced due diligence required.',
  },
  {
    countryName: 'Venezuela',
    aliases: ['Bolivarian Republic of Venezuela', 'VEN'],
    countryCode: 'VE',
    sanctionsStatus: 'SECTORAL_SANCTIONS',
    riskScore: 65,
    programs: ['OFAC VENEZUELA-EO13884', 'EU VENEZUELA'],
    description: 'Sanctions on Government of Venezuela, state oil company PDVSA, and gold/mining sectors, subject to specific OFAC general licenses.',
  },
  {
    countryName: 'Crimea / Sevastopol / Donetsk / Luhansk',
    aliases: ['Crimea', 'Sevastopol', 'Donetsk People\'s Republic', 'Luhansk People\'s Republic', 'DNR', 'LNR'],
    countryCode: 'UA-CR',
    sanctionsStatus: 'COMPREHENSIVE_SANCTIONED',
    riskScore: 90,
    programs: ['OFAC UKRAINE-EO14065', 'EU RESTRICTIONS', 'UK RESTRICTIONS'],
    description: 'Comprehensive embargo on new investment, trade, and financial services in Russian-occupied regions of Ukraine.',
  },
  {
    countryName: 'Yemen',
    aliases: ['Republic of Yemen', 'YEM'],
    countryCode: 'YE',
    sanctionsStatus: 'SECTORAL_SANCTIONS',
    riskScore: 60,
    programs: ['UN 2140', 'OFAC YEMEN', 'EU YEMEN'],
    description: 'Targeted arms embargo and asset freezes against designated Ansar Allah / Houthi leaders and associated maritime procurement networks.',
  },
];
