import type { PortLocation } from './maritime.types';

export class PortNormalizationService {
  private static instance: PortNormalizationService;

  /**
   * Authoritative UN/LOCODE reference dictionary for international shipping hubs
   */
  private readonly locodeDb: Map<string, PortLocation> = new Map([
    ['CNSHA', { locode: 'CNSHA', name: 'Shanghai', country: 'China', countryCode: 'CN', latitude: 31.2304, longitude: 121.4737, aliases: ['shanghai port', 'port of shanghai', 'yangshan', 'waigaoqiao'] }],
    ['CNNGB', { locode: 'CNNGB', name: 'Ningbo-Zhoushan', country: 'China', countryCode: 'CN', latitude: 29.8683, longitude: 121.544, aliases: ['ningbo', 'zhoushan', 'beilun'] }],
    ['CNSZX', { locode: 'CNSZX', name: 'Shenzhen', country: 'China', countryCode: 'CN', latitude: 22.5431, longitude: 114.0579, aliases: ['shekou', 'yantian', 'chiwan'] }],
    ['CNQDG', { locode: 'CNQDG', name: 'Qingdao', country: 'China', countryCode: 'CN', latitude: 36.0671, longitude: 120.3826, aliases: ['tsingtao', 'port of qingdao'] }],
    ['CNGZG', { locode: 'CNGZG', name: 'Guangzhou', country: 'China', countryCode: 'CN', latitude: 23.1291, longitude: 113.2644, aliases: ['nansha', 'huangpu'] }],
    ['SGSIN', { locode: 'SGSIN', name: 'Singapore', country: 'Singapore', countryCode: 'SG', latitude: 1.3521, longitude: 103.8198, aliases: ['jurong', 'pasir panjang', 'tanjong pagar', 'keppel', 'port of singapore'] }],
    ['MYPKG', { locode: 'MYPKG', name: 'Port Klang', country: 'Malaysia', countryCode: 'MY', latitude: 3.0033, longitude: 101.3923, aliases: ['port kelang', 'klang', 'pelabuhan klang', 'northport', 'westports'] }],
    ['MYTPP', { locode: 'MYTPP', name: 'Tanjung Pelepas', country: 'Malaysia', countryCode: 'MY', latitude: 1.3622, longitude: 103.5492, aliases: ['ptp', 'tanjung pelepas port', 'pelabuhan tanjung pelepas'] }],
    ['MYPEN', { locode: 'MYPEN', name: 'Penang', country: 'Malaysia', countryCode: 'MY', latitude: 5.4164, longitude: 100.3327, aliases: ['george town', 'butterworth'] }],
    ['LKCMB', { locode: 'LKCMB', name: 'Colombo', country: 'Sri Lanka', countryCode: 'LK', latitude: 6.9271, longitude: 79.8612, aliases: ['port of colombo', 'colombo port', 'jaya container terminal'] }],
    ['PKKHI', { locode: 'PKKHI', name: 'Karachi', country: 'Pakistan', countryCode: 'PK', latitude: 24.8607, longitude: 67.0011, aliases: ['karachi port', 'port of karachi', 'kict', 'sapt'] }],
    ['PKBQM', { locode: 'PKBQM', name: 'Port Qasim', country: 'Pakistan', countryCode: 'PK', latitude: 24.7816, longitude: 67.3484, aliases: ['muhammad bin qasim', 'qasim port', 'qict'] }],
    ['PKGWN', { locode: 'PKGWN', name: 'Gwadar', country: 'Pakistan', countryCode: 'PK', latitude: 25.1264, longitude: 62.3226, aliases: ['gwadar port', 'port of gwadar'] }],
    ['AEJEA', { locode: 'AEJEA', name: 'Jebel Ali', country: 'United Arab Emirates', countryCode: 'AE', latitude: 24.9857, longitude: 55.0273, aliases: ['dubai port', 'mina jebel ali', 'dp world jebel ali'] }],
    ['AEDXB', { locode: 'AEDXB', name: 'Dubai', country: 'United Arab Emirates', countryCode: 'AE', latitude: 25.2048, longitude: 55.2708, aliases: ['port rashid', 'mina rashid'] }],
    ['AEKHL', { locode: 'AEKHL', name: 'Khalifa Port', country: 'United Arab Emirates', countryCode: 'AE', latitude: 24.7869, longitude: 54.6738, aliases: ['abu dhabi port', 'khalifa'] }],
    ['OMSOH', { locode: 'OMSOH', name: 'Sohar', country: 'Oman', countryCode: 'OM', latitude: 24.4989, longitude: 56.6321, aliases: ['port of sohar'] }],
    ['OMSLL', { locode: 'OMSLL', name: 'Salalah', country: 'Oman', countryCode: 'OM', latitude: 16.9469, longitude: 54.0044, aliases: ['port of salalah', 'mina salalah'] }],
    ['INNSA', { locode: 'INNSA', name: 'Nhava Sheva', country: 'India', countryCode: 'IN', latitude: 18.9499, longitude: 72.9511, aliases: ['jnpt', 'jawaharlal nehru port', 'mumbai port'] }],
    ['INMUN', { locode: 'INMUN', name: 'Mundra', country: 'India', countryCode: 'IN', latitude: 22.7533, longitude: 69.7042, aliases: ['adani mundra', 'port of mundra'] }],
    ['EGPSD', { locode: 'EGPSD', name: 'Port Said', country: 'Egypt', countryCode: 'EG', latitude: 31.2653, longitude: 32.3019, aliases: ['suez canal north', 'port said east'] }],
    ['EGSUE', { locode: 'EGSUE', name: 'Suez', country: 'Egypt', countryCode: 'EG', latitude: 29.9668, longitude: 32.5498, aliases: ['port tewfik', 'suez port'] }],
    ['NLRTM', { locode: 'NLRTM', name: 'Rotterdam', country: 'Netherlands', countryCode: 'NL', latitude: 51.9244, longitude: 4.4777, aliases: ['port of rotterdam', 'maasvlakte', 'waalhaven'] }],
    ['DEHAM', { locode: 'DEHAM', name: 'Hamburg', country: 'Germany', countryCode: 'DE', latitude: 53.5511, longitude: 9.9937, aliases: ['port of hamburg', 'waltershof'] }],
    ['BEANR', { locode: 'BEANR', name: 'Antwerp', country: 'Belgium', countryCode: 'BE', latitude: 51.2194, longitude: 4.4025, aliases: ['port of antwerp', 'antwerpen'] }],
    ['GBFXT', { locode: 'GBFXT', name: 'Felixstowe', country: 'United Kingdom', countryCode: 'GB', latitude: 51.963, longitude: 1.3511, aliases: ['port of felixstowe'] }],
    ['GBLON', { locode: 'GBLON', name: 'London Gateway', country: 'United Kingdom', countryCode: 'GB', latitude: 51.5074, longitude: 0.4722, aliases: ['london port', 'tilbury'] }],
    ['USLAX', { locode: 'USLAX', name: 'Los Angeles', country: 'United States', countryCode: 'US', latitude: 33.7432, longitude: -118.2673, aliases: ['port of los angeles', 'san pedro'] }],
    ['USNYC', { locode: 'USNYC', name: 'New York / New Jersey', country: 'United States', countryCode: 'US', latitude: 40.7128, longitude: -74.006, aliases: ['new york port', 'port newark', 'elizabeth marine terminal'] }],
    ['IRBND', { locode: 'IRBND', name: 'Bandar Abbas', country: 'Iran', countryCode: 'IR', latitude: 27.1832, longitude: 56.2666, aliases: ['shahid rajaee', 'bandar e abbas'] }],
    ['RULED', { locode: 'RULED', name: 'Saint Petersburg', country: 'Russia', countryCode: 'RU', latitude: 59.9343, longitude: 30.3351, aliases: ['st petersburg', 'leningrad'] }],
    ['RUNVS', { locode: 'RUNVS', name: 'Novorossiysk', country: 'Russia', countryCode: 'RU', latitude: 44.7154, longitude: 37.7619, aliases: ['novorossiysk port', 'black sea port'] }],
  ]);

  public static getInstance(): PortNormalizationService {
    if (!PortNormalizationService.instance) {
      PortNormalizationService.instance = new PortNormalizationService();
    }
    return PortNormalizationService.instance;
  }

  /**
   * Normalize any input (port name, city name, code or alias) to a standardized PortLocation.
   */
  public normalizePort(input?: string, countryHint?: string): PortLocation {
    if (!input || input.trim() === '' || input.toLowerCase() === 'not found') {
      return {
        locode: 'UNKNW',
        name: 'Unspecified Port',
        country: countryHint || 'Unknown Jurisdiction',
        countryCode: 'XX',
        latitude: 0,
        longitude: 0,
      };
    }

    const clean = input.trim().toUpperCase();

    // 1. Direct UN/LOCODE exact match
    if (clean.length === 5 && this.locodeDb.has(clean)) {
      return this.locodeDb.get(clean)!;
    }

    const lowerInput = input.trim().toLowerCase();

    // 2. Exact or Alias search across database
    for (const [_, port] of this.locodeDb.entries()) {
      if (port.name.toLowerCase() === lowerInput) {
        return port;
      }
      if (port.aliases && port.aliases.some((a) => a.toLowerCase() === lowerInput)) {
        return port;
      }
    }

    // 3. Substring / Token matching
    for (const [_, port] of this.locodeDb.entries()) {
      const portNameLower = port.name.toLowerCase();
      if (lowerInput.includes(portNameLower) || portNameLower.includes(lowerInput)) {
        return port;
      }
      if (port.aliases && port.aliases.some((a) => lowerInput.includes(a.toLowerCase()) || a.toLowerCase().includes(lowerInput))) {
        return port;
      }
    }

    // 4. Country fallback matching
    const derivedCountry = this.normalizeCountry(countryHint || input);
    const generatedLocode = this.generateSyntheticLocode(input, derivedCountry.countryCode);

    return {
      locode: generatedLocode,
      name: this.titleCase(input.replace(/port\s+of\s+/i, '').replace(/\s+port/i, '')),
      country: derivedCountry.countryName,
      countryCode: derivedCountry.countryCode,
      latitude: 0,
      longitude: 0,
    };
  }

  public normalizeCountry(countryStr?: string): { countryName: string; countryCode: string } {
    if (!countryStr || countryStr.trim() === '' || countryStr.toLowerCase() === 'not found') {
      return { countryName: 'Unknown Jurisdiction', countryCode: 'XX' };
    }

    const c = countryStr.trim().toLowerCase();

    if (c.includes('pakistan') || c === 'pk') return { countryName: 'Pakistan', countryCode: 'PK' };
    if (c.includes('china') || c === 'cn') return { countryName: 'China', countryCode: 'CN' };
    if (c.includes('singapore') || c === 'sg') return { countryName: 'Singapore', countryCode: 'SG' };
    if (c.includes('malaysia') || c === 'my') return { countryName: 'Malaysia', countryCode: 'MY' };
    if (c.includes('sri lanka') || c === 'lk') return { countryName: 'Sri Lanka', countryCode: 'LK' };
    if (c.includes('emirates') || c.includes('uae') || c === 'ae' || c.includes('dubai')) return { countryName: 'United Arab Emirates', countryCode: 'AE' };
    if (c.includes('united kingdom') || c.includes('britain') || c === 'uk' || c === 'gb') return { countryName: 'United Kingdom', countryCode: 'GB' };
    if (c.includes('germany') || c === 'de') return { countryName: 'Germany', countryCode: 'DE' };
    if (c.includes('united states') || c.includes('usa') || c === 'us') return { countryName: 'United States', countryCode: 'US' };
    if (c.includes('netherlands') || c.includes('holland') || c === 'nl') return { countryName: 'Netherlands', countryCode: 'NL' };
    if (c.includes('india') || c === 'in') return { countryName: 'India', countryCode: 'IN' };
    if (c.includes('oman') || c === 'om') return { countryName: 'Oman', countryCode: 'OM' };
    if (c.includes('iran') || c === 'ir') return { countryName: 'Iran', countryCode: 'IR' };
    if (c.includes('russia') || c === 'ru') return { countryName: 'Russia', countryCode: 'RU' };

    return { countryName: this.titleCase(countryStr), countryCode: 'XX' };
  }

  private generateSyntheticLocode(portName: string, countryCode: string): string {
    const lettersOnly = portName.replace(/[^A-Za-z]/g, '').toUpperCase();
    const sub = lettersOnly.slice(0, 3).padEnd(3, 'X');
    return `${countryCode}${sub}`;
  }

  private titleCase(s: string): string {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
