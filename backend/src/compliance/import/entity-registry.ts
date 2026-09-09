import crypto from 'node:crypto';

export type SupportedEntityType =
  | 'countries'
  | 'sanctions'
  | 'prices'
  | 'products'
  | 'ports'
  | 'routes'
  | 'companies'
  | 'banks'
  | 'currencies'
  | 'regulations'
  | 'vessels';

export interface EntityFieldDefinition {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'select' | 'array' | 'json';
  required?: boolean;
  options?: string[];
  placeholder?: string;
  helpText?: string;
  isPrimaryIdentifier?: boolean;
}

export interface EntityDefinition {
  type: SupportedEntityType;
  displayName: string;
  singularName: string;
  description: string;
  category: 'REGULATORY' | 'VALUATION' | 'LOGISTICS' | 'COUNTERPARTY' | 'FINANCIAL';
  icon: string;
  primaryKey: string;
  fields: EntityFieldDefinition[];
  capabilities: {
    create: boolean;
    update: boolean;
    bulkImport: boolean;
    scrape: boolean;
    history: boolean;
  };
  generateDeterministicId: (data: Record<string, any>) => string;
  validate: (data: Record<string, any>) => { valid: boolean; errors: string[] };
  normalize: (data: Record<string, any>) => Record<string, any>;
}

// ---------------------------------------------------------------------------------------------
// Formula Injection Sanitizer (prevents spreadsheet calculation execution e.g. =cmd|' /C ...'!)
// ---------------------------------------------------------------------------------------------
export function sanitizeForCsvInjection(value: any): any {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const firstChar = trimmed[0];
  if (firstChar && ['=', '+', '-', '@', '\t', '\r'].includes(firstChar)) {
    return `'${trimmed}`;
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Centralized Entity Registry
// ---------------------------------------------------------------------------------------------
export const ENTITY_REGISTRY: Record<SupportedEntityType, EntityDefinition> = {
  countries: {
    type: 'countries',
    displayName: 'Countries & Jurisdictions',
    singularName: 'Country',
    description: 'Statutory jurisdiction profiles, FATF risk rankings, sanction regimes, and trade embargo status.',
    category: 'REGULATORY',
    icon: 'globe',
    primaryKey: 'countryCode',
    fields: [
      { name: 'countryCode', label: 'ISO Alpha-2 Code', type: 'string', required: true, placeholder: 'e.g. PK, IR, RU', isPrimaryIdentifier: true },
      { name: 'countryName', label: 'Country / Jurisdiction Name', type: 'string', required: true, placeholder: 'e.g. Pakistan, Iran, Russia' },
      { name: 'isSanctioned', label: 'Sanctioned Status', type: 'boolean', required: true },
      { name: 'riskLevel', label: 'Risk Rating', type: 'select', options: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'], required: true },
      { name: 'sanctionPrograms', label: 'Sanction Programs', type: 'array', placeholder: 'e.g. OFAC-IRAN, UN-DPRK, EU-UKR' },
      { name: 'effectiveFrom', label: 'Sanctions Effective From', type: 'date', placeholder: 'YYYY-MM-DD' },
      { name: 'effectiveTo', label: 'Sanctions Expiry Date', type: 'date', placeholder: 'YYYY-MM-DD or null if active' },
      { name: 'aliases', label: 'Jurisdiction Aliases', type: 'array', placeholder: 'Alternative names or territorial variants' },
      { name: 'notes', label: 'Statutory Remarks / Notice', type: 'string', placeholder: 'Compliance remarks or advisory notes' },
    ],
    capabilities: { create: true, update: true, bulkImport: true, scrape: true, history: true },
    generateDeterministicId: (data) => {
      const code = String(data.countryCode || data.country || '').trim().toUpperCase();
      return code.length === 2 ? code : code.slice(0, 2) || `CTR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    },
    normalize: (data) => {
      const code = String(data.countryCode || data.iso || data.code || '').trim().toUpperCase();
      const name = String(data.countryName || data.name || data.country || '').trim();
      const isSanctioned = Boolean(data.isSanctioned === true || String(data.isSanctioned).toLowerCase() === 'true' || String(data.isSanctioned).toLowerCase() === 'yes');
      const riskLevel = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(String(data.riskLevel).toUpperCase()) ? String(data.riskLevel).toUpperCase() : (isSanctioned ? 'CRITICAL' : 'LOW');
      const aliases = Array.isArray(data.aliases) ? data.aliases : (typeof data.aliases === 'string' ? data.aliases.split(',').map((s: string) => s.trim()) : []);
      const sanctionPrograms = Array.isArray(data.sanctionPrograms) ? data.sanctionPrograms : (typeof data.sanctionPrograms === 'string' ? data.sanctionPrograms.split(',').map((s: string) => s.trim()) : []);

      return {
        countryCode: code,
        countryName: name,
        isSanctioned,
        riskLevel,
        sanctionPrograms,
        effectiveFrom: data.effectiveFrom || '1970-01-01',
        effectiveTo: data.effectiveTo || null,
        aliases,
        notes: data.notes || '',
        lastVerifiedAt: new Date().toISOString(),
      };
    },
    validate: (data) => {
      const errors: string[] = [];
      if (!data.countryCode || String(data.countryCode).trim().length < 2) errors.push('Valid 2-character ISO country code is required.');
      if (!data.countryName || String(data.countryName).trim().length === 0) errors.push('Country name is required.');
      return { valid: errors.length === 0, errors };
    },
  },

  sanctions: {
    type: 'sanctions',
    displayName: 'Sanctioned Parties & Entities',
    singularName: 'Sanctioned Entity',
    description: 'Bitemporal designations across OFAC SDN, UN Consolidated, EU Financial Sanctions, UK HMT, and SBP TFS.',
    category: 'REGULATORY',
    icon: 'shield',
    primaryKey: 'externalId',
    fields: [
      { name: 'externalId', label: 'External / Source ID', type: 'string', required: true, placeholder: 'e.g. OFAC-1004, UN-4521', isPrimaryIdentifier: true },
      { name: 'canonicalName', label: 'Designated Legal Name', type: 'string', required: true, placeholder: 'e.g. Bank Melli Iran, Sovcomflot' },
      { name: 'entityType', label: 'Entity Classification', type: 'select', options: ['INDIVIDUAL', 'ENTITY', 'BANK', 'VESSEL', 'AIRCRAFT'], required: true },
      { name: 'sourceId', label: 'Issuing Sanctions Regime', type: 'select', options: ['OFAC_SDN', 'UN_CONSOLIDATED', 'EU_FSF', 'UK_HMT', 'SBP_REGULATORY', 'MANUAL_COMPLIANCE'], required: true },
      { name: 'country', label: 'Country of Domicile', type: 'string', placeholder: 'e.g. Iran, Russia, Myanmar' },
      { name: 'programs', label: 'Sanctions Programs', type: 'array', placeholder: 'e.g. IRAN, RUSSIA-EO14024' },
      { name: 'aliases', label: 'Known Aliases / AKAs', type: 'array', placeholder: 'Alternative trading names or transliterations' },
      { name: 'swiftBic', label: 'SWIFT / BIC Code (if Bank)', type: 'string', placeholder: 'e.g. MELIIRTH' },
      { name: 'imoNumber', label: 'IMO Number (if Vessel)', type: 'string', placeholder: '7-digit IMO number' },
      { name: 'validFrom', label: 'Designation Date (Valid From)', type: 'date', required: true, placeholder: 'YYYY-MM-DD' },
      { name: 'validTo', label: 'De-listing Date (Valid To)', type: 'date', placeholder: 'YYYY-MM-DD or null if currently active' },
      { name: 'remarks', label: 'Compliance Grounds', type: 'string', placeholder: 'Statutory basis for designation' },
    ],
    capabilities: { create: true, update: true, bulkImport: true, scrape: true, history: true },
    generateDeterministicId: (data) => {
      const source = (data.sourceId || 'MANUAL').trim().toUpperCase();
      const extId = String(data.externalId || '').trim();
      if (extId) return `ENT-${source}-${extId}`;
      const nameHash = crypto.createHash('sha256').update(String(data.canonicalName || '').toLowerCase().trim()).digest('hex').slice(0, 8).toUpperCase();
      return `ENT-${source}-${nameHash}`;
    },
    normalize: (data) => {
      const cleanName = String(data.canonicalName || data.name || '').trim();
      const normName = cleanName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const aliases = Array.isArray(data.aliases) ? data.aliases : (typeof data.aliases === 'string' ? data.aliases.split(',').map((s: string) => s.trim()) : []);
      const normAliases = aliases.map((a: string) => a.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim());
      const programs = Array.isArray(data.programs) ? data.programs : (typeof data.programs === 'string' ? data.programs.split(',').map((s: string) => s.trim()) : []);

      return {
        canonicalName: cleanName,
        normalizedName: normName,
        externalId: String(data.externalId || `MANUAL-${Date.now()}`),
        sourceId: data.sourceId || 'MANUAL_COMPLIANCE',
        entityType: ['INDIVIDUAL', 'ENTITY', 'BANK', 'VESSEL', 'AIRCRAFT'].includes(data.entityType) ? data.entityType : 'ENTITY',
        country: data.country || 'Unknown',
        countryCode: data.countryCode || '',
        programs,
        aliases,
        normalizedAliases: normAliases,
        identifiers: {
          swiftBic: data.swiftBic ? String(data.swiftBic).trim().toUpperCase() : undefined,
          imoNumber: data.imoNumber ? String(data.imoNumber).replace(/\D/g, '') : undefined,
          passport: data.passport,
          taxId: data.taxId,
        },
        validFrom: data.validFrom ? String(data.validFrom).slice(0, 10) : new Date().toISOString().slice(0, 10),
        validTo: data.validTo ? String(data.validTo).slice(0, 10) : null,
        observedAt: new Date().toISOString(),
        effectiveFrom: data.effectiveFrom || data.validFrom || new Date().toISOString().slice(0, 10),
        effectiveTo: data.effectiveTo || data.validTo || null,
        isCurrent: !data.validTo,
        remarks: data.remarks || 'Master compliance designation',
      };
    },
    validate: (data) => {
      const errors: string[] = [];
      if (!data.canonicalName || String(data.canonicalName).trim().length === 0) errors.push('Designated canonical name is required.');
      if (data.validFrom && isNaN(Date.parse(data.validFrom))) errors.push('validFrom must be a valid ISO date (YYYY-MM-DD).');
      return { valid: errors.length === 0, errors };
    },
  },

  prices: {
    type: 'prices',
    displayName: 'Commodity Price Benchmarks',
    singularName: 'Price Benchmark',
    description: 'Customs valuation corridors, UN Comtrade commodity benchmarks, and TBML over/under-invoicing bands.',
    category: 'VALUATION',
    icon: 'tag',
    primaryKey: 'benchmarkId',
    fields: [
      { name: 'productKey', label: 'Product Key / Name', type: 'string', required: true, placeholder: 'e.g. raw_cotton, urea_fertilizer, refined_sugar', isPrimaryIdentifier: true },
      { name: 'category', label: 'Commodity Category', type: 'string', required: true, placeholder: 'e.g. Textiles, Agricultural, Metals, Chemicals' },
      { name: 'hsCodePrefix', label: 'HS Code Prefix (4-6 digits)', type: 'string', required: true, placeholder: 'e.g. 5201, 3102, 1701' },
      { name: 'benchmarkUnitPriceUsd', label: 'Fair Market Unit Price (USD)', type: 'number', required: true, placeholder: 'e.g. 1.85' },
      { name: 'observedLowUsd', label: 'Observed Low Corridor (USD)', type: 'number', required: true, placeholder: 'e.g. 1.45' },
      { name: 'observedHighUsd', label: 'Observed High Corridor (USD)', type: 'number', required: true, placeholder: 'e.g. 2.25' },
      { name: 'unitOfMeasure', label: 'Unit of Measure', type: 'string', required: true, placeholder: 'e.g. KG, MT, PCS, LTR' },
      { name: 'incotermBasis', label: 'Incoterm Basis', type: 'select', options: ['FOB', 'CIF', 'CFR', 'EXW'], required: true },
      { name: 'destinationMarket', label: 'Destination Market / Parity', type: 'string', placeholder: 'e.g. Pakistan, Global Parity, South Asia' },
      { name: 'confidenceLevel', label: 'Valuation Confidence', type: 'select', options: ['VERY_HIGH', 'HIGH', 'MODERATE'], required: true },
      { name: 'effectiveFrom', label: 'Effective Date', type: 'date', required: true, placeholder: 'YYYY-MM-DD' },
      { name: 'sourceId', label: 'Source Provider', type: 'string', placeholder: 'e.g. UN_COMTRADE, S&P_GLOBAL, SBP_VALUATION' },
    ],
    capabilities: { create: true, update: true, bulkImport: true, scrape: true, history: true },
    generateDeterministicId: (data) => {
      const pKey = String(data.productKey || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
      const hs = String(data.hsCodePrefix || '').replace(/\D/g, '').slice(0, 4);
      const uom = String(data.unitOfMeasure || 'MT').toUpperCase();
      return `PRC-${hs || '0000'}-${pKey}-${uom}`;
    },
    normalize: (data) => {
      const cleanKey = String(data.productKey || '').toLowerCase().replace(/[^a-z0-9]/g, '_').trim();
      const hsPrefix = String(data.hsCodePrefix || '').replace(/\D/g, '').slice(0, 6);
      const median = Number(data.benchmarkUnitPriceUsd || data.observedMedianUsd || data.price || 0);
      const low = Number(data.observedLowUsd || (median * 0.8));
      const high = Number(data.observedHighUsd || (median * 1.25));
      const uom = String(data.unitOfMeasure || 'MT').toUpperCase();
      const benchId = `PRC-${hsPrefix || '0000'}-${cleanKey}-${uom}`;

      return {
        benchmarkId: data.benchmarkId || benchId,
        productKey: cleanKey,
        category: data.category || 'General Merchandise',
        hsCodePrefix: hsPrefix,
        benchmarkUnitPriceUsd: median,
        observedLowUsd: low,
        observedMedianUsd: median,
        observedHighUsd: high,
        unitOfMeasure: String(data.unitOfMeasure || 'PCS').toUpperCase(),
        incotermBasis: ['FOB', 'CIF', 'CFR', 'EXW'].includes(data.incotermBasis) ? data.incotermBasis : 'FOB',
        destinationMarket: data.destinationMarket || 'Global Parity',
        sampleCount: Number(data.sampleCount) || 500,
        confidenceLevel: ['VERY_HIGH', 'HIGH', 'MODERATE'].includes(data.confidenceLevel) ? data.confidenceLevel : 'HIGH',
        effectiveFrom: data.effectiveFrom ? String(data.effectiveFrom).slice(0, 10) : new Date().toISOString().slice(0, 10),
        effectiveTo: data.effectiveTo ? String(data.effectiveTo).slice(0, 10) : null,
        sourceId: data.sourceId || 'MANUAL_IMPORT',
        isCurrent: true,
      };
    },
    validate: (data) => {
      const errors: string[] = [];
      if (!data.productKey) errors.push('Product key/identifier is required.');
      if (isNaN(Number(data.benchmarkUnitPriceUsd)) || Number(data.benchmarkUnitPriceUsd) <= 0) {
        errors.push('Benchmark unit price must be a positive number.');
      }
      return { valid: errors.length === 0, errors };
    },
  },

  products: {
    type: 'products',
    displayName: 'Products & Harmonized Codes',
    singularName: 'Product',
    description: 'Harmonized System (HS) classifications, dual-use ECCN export controls, and Pakistan Import Policy restrictions.',
    category: 'REGULATORY',
    icon: 'box',
    primaryKey: 'hsCode',
    fields: [
      { name: 'hsCode', label: 'HS Code (6-10 digits)', type: 'string', required: true, placeholder: 'e.g. 8471.30.00, 2904.20', isPrimaryIdentifier: true },
      { name: 'description', label: 'Commercial Description', type: 'string', required: true, placeholder: 'e.g. Portable automatic data processing machines' },
      { name: 'category', label: 'Commodity Section', type: 'string', required: true, placeholder: 'e.g. Electronics, Machinery, Chemicals' },
      { name: 'isControlledOrDualUse', label: 'Dual-Use / Controlled', type: 'boolean', required: true },
      { name: 'eccn', label: 'Export Control Classification (ECCN)', type: 'string', placeholder: 'e.g. 5A002, 3A001, EAR99' },
      { name: 'pakistanImportStatus', label: 'Pakistan IPO Status', type: 'select', options: ['FREELY_IMPORTABLE', 'APPENDIX_A_BANNED', 'APPENDIX_B_RESTRICTED', 'HEALTH_SAFETY_CONDITIONAL'], required: true },
      { name: 'statutoryRemarks', label: 'Statutory SRO / Directive', type: 'string', placeholder: 'e.g. SRO 520(I)/2022 restrictions apply' },
    ],
    capabilities: { create: true, update: true, bulkImport: true, scrape: false, history: true },
    generateDeterministicId: (data) => {
      const hs = String(data.hsCode || '').replace(/\D/g, '');
      return `HS-${hs || '000000'}`;
    },
    normalize: (data) => {
      const cleanHs = String(data.hsCode || '').replace(/[^0-9.]/g, '');
      const rawHsDigits = cleanHs.replace(/\D/g, '');
      return {
        hsCode: cleanHs,
        hsDigits: rawHsDigits,
        description: data.description || 'Standard Trade Commodity',
        category: data.category || 'General Merchandise',
        isControlledOrDualUse: Boolean(data.isControlledOrDualUse === true || String(data.isControlledOrDualUse).toLowerCase() === 'true'),
        eccn: data.eccn ? String(data.eccn).trim().toUpperCase() : 'EAR99',
        pakistanImportStatus: data.pakistanImportStatus || 'FREELY_IMPORTABLE',
        statutoryRemarks: data.statutoryRemarks || '',
      };
    },
    validate: (data) => {
      const errors: string[] = [];
      const digits = String(data.hsCode || '').replace(/\D/g, '');
      if (digits.length < 4) errors.push('HS Code must contain at least 4 digits.');
      if (!data.description) errors.push('Product description is required.');
      return { valid: errors.length === 0, errors };
    },
  },

  ports: {
    type: 'ports',
    displayName: 'Maritime Ports & LOCODEs',
    singularName: 'Port',
    description: 'UN/LOCODE port registry, geocoordinates, transit hub risk classifications, and sanctioned terminal lists.',
    category: 'LOGISTICS',
    icon: 'anchor',
    primaryKey: 'locode',
    fields: [
      { name: 'locode', label: 'UN/LOCODE (5 Characters)', type: 'string', required: true, placeholder: 'e.g. PKKHI, SGSIN, NLRTM', isPrimaryIdentifier: true },
      { name: 'name', label: 'Port Name', type: 'string', required: true, placeholder: 'e.g. Karachi Port, Port of Singapore' },
      { name: 'countryCode', label: 'Country Code (ISO 2)', type: 'string', required: true, placeholder: 'e.g. PK, SG, NL' },
      { name: 'country', label: 'Country', type: 'string', required: true, placeholder: 'e.g. Pakistan, Singapore, Netherlands' },
      { name: 'latitude', label: 'Latitude', type: 'number', required: true, placeholder: 'e.g. 24.84' },
      { name: 'longitude', label: 'Longitude', type: 'number', required: true, placeholder: 'e.g. 66.97' },
      { name: 'isSanctionedJurisdiction', label: 'Sanctioned Jurisdiction', type: 'boolean', required: true },
      { name: 'riskScore', label: 'Risk Score (0 - 100)', type: 'number', required: true, placeholder: 'e.g. 10' },
      { name: 'aliases', label: 'Port Aliases / Terminal Names', type: 'array', placeholder: 'e.g. KICT, PICT, SAPT' },
    ],
    capabilities: { create: true, update: true, bulkImport: true, scrape: true, history: true },
    generateDeterministicId: (data) => {
      const code = String(data.locode || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      return code.length === 5 ? code : `PORT-${code || crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    },
    normalize: (data) => {
      const locode = String(data.locode || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const aliases = Array.isArray(data.aliases) ? data.aliases : (typeof data.aliases === 'string' ? data.aliases.split(',').map((s: string) => s.trim()) : []);
      return {
        locode,
        name: data.name || locode,
        normalizedName: String(data.name || locode).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim(),
        country: data.country || '',
        countryCode: (data.countryCode || locode.slice(0, 2)).toUpperCase(),
        latitude: Number(data.latitude) || 0,
        longitude: Number(data.longitude) || 0,
        isSanctionedJurisdiction: Boolean(data.isSanctionedJurisdiction === true || String(data.isSanctionedJurisdiction).toLowerCase() === 'true'),
        riskScore: Number(data.riskScore) || (data.isSanctionedJurisdiction ? 90 : 10),
        aliases,
      };
    },
    validate: (data) => {
      const errors: string[] = [];
      const code = String(data.locode || '').replace(/[^A-Za-z0-9]/g, '');
      if (code.length !== 5) errors.push('UN/LOCODE must be exactly 5 alphanumeric characters (e.g. PKKHI).');
      if (!data.name) errors.push('Port name is required.');
      return { valid: errors.length === 0, errors };
    },
  },

  routes: {
    type: 'routes',
    displayName: 'Shipping Routes & Corridors',
    singularName: 'Shipping Route',
    description: 'Maritime trade lanes, typical transit hubs, high-risk transshipment waypoints, and diversion alerts.',
    category: 'LOGISTICS',
    icon: 'map',
    primaryKey: 'routeKey',
    fields: [
      { name: 'originCountry', label: 'Origin Country / Port', type: 'string', required: true, placeholder: 'e.g. Pakistan / PKKHI', isPrimaryIdentifier: true },
      { name: 'destinationCountry', label: 'Destination Country / Port', type: 'string', required: true, placeholder: 'e.g. United Kingdom / GBLON', isPrimaryIdentifier: true },
      { name: 'intermediateHubs', label: 'Standard Transshipment Hubs', type: 'array', placeholder: 'e.g. Jebel Ali, Port of Colombo, Salalah' },
      { name: 'prohibitedTransitZones', label: 'Prohibited / Embargoed Transit Zones', type: 'array', placeholder: 'e.g. Bandar Abbas, Crimea' },
      { name: 'typicalDurationDays', label: 'Expected Voyage Duration (Days)', type: 'number', placeholder: 'e.g. 24' },
      { name: 'routeRiskRating', label: 'Corridor Risk Level', type: 'select', options: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'], required: true },
    ],
    capabilities: { create: true, update: true, bulkImport: true, scrape: false, history: true },
    generateDeterministicId: (data) => {
      const orig = String(data.originCountry || '').trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5);
      const dest = String(data.destinationCountry || '').trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5);
      return `RTE-${orig}-TO-${dest}`;
    },
    normalize: (data) => {
      const hubs = Array.isArray(data.intermediateHubs) ? data.intermediateHubs : (typeof data.intermediateHubs === 'string' ? data.intermediateHubs.split(',').map((s: string) => s.trim()) : []);
      const prohibited = Array.isArray(data.prohibitedTransitZones) ? data.prohibitedTransitZones : (typeof data.prohibitedTransitZones === 'string' ? data.prohibitedTransitZones.split(',').map((s: string) => s.trim()) : []);
      return {
        originCountry: data.originCountry,
        destinationCountry: data.destinationCountry,
        intermediateHubs: hubs,
        prohibitedTransitZones: prohibited,
        typicalDurationDays: Number(data.typicalDurationDays) || 20,
        routeRiskRating: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(data.routeRiskRating) ? data.routeRiskRating : 'LOW',
      };
    },
    validate: (data) => {
      const errors: string[] = [];
      if (!data.originCountry) errors.push('Origin country/port is required.');
      if (!data.destinationCountry) errors.push('Destination country/port is required.');
      return { valid: errors.length === 0, errors };
    },
  },

  companies: {
    type: 'companies',
    displayName: 'Companies & Customer 360',
    singularName: 'Company Profile',
    description: 'Corporate golden records, National Tax Numbers (NTN), verified trading baselines, and commercial risk metrics.',
    category: 'COUNTERPARTY',
    icon: 'briefcase',
    primaryKey: 'customerReferenceId',
    fields: [
      { name: 'customerReferenceId', label: 'Customer ID / NTN', type: 'string', required: true, placeholder: 'e.g. CUST-PK-98124, 1234567-8', isPrimaryIdentifier: true },
      { name: 'legalName', label: 'Registered Legal Corporate Name', type: 'string', required: true, placeholder: 'e.g. Indus Textile Mills Ltd' },
      { name: 'taxVatNumber', label: 'Tax / NTN / VAT Number', type: 'string', placeholder: 'e.g. 7123456-9' },
      { name: 'registrationNumber', label: 'Company Registration / CRO', type: 'string', placeholder: 'e.g. SECP-009124' },
      { name: 'country', label: 'Country of Incorporation', type: 'string', required: true, placeholder: 'e.g. Pakistan, United Arab Emirates' },
      { name: 'declaredCoreBusiness', label: 'Declared Core Business', type: 'string', required: true, placeholder: 'e.g. Manufacture and Export of Cotton Apparel' },
      { name: 'riskLevel', label: 'AML / TBML Risk Level', type: 'select', options: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'], required: true },
      { name: 'baselineLcFrequencyMean', label: 'Baseline LC Transactions / Month', type: 'number', placeholder: 'e.g. 4.5' },
      { name: 'baselineMonthlyVolumeUsd', label: 'Baseline Monthly Trade (USD)', type: 'number', placeholder: 'e.g. 1500000' },
      { name: 'aliases', label: 'Trading Names / Aliases', type: 'array', placeholder: 'Alternative brand names' },
    ],
    capabilities: { create: true, update: true, bulkImport: true, scrape: false, history: true },
    generateDeterministicId: (data) => {
      if (data.customerReferenceId) return String(data.customerReferenceId).trim();
      const tax = String(data.taxVatNumber || '').replace(/[^0-9]/g, '');
      if (tax.length >= 7) return `CUST-TAX-${tax}`;
      const nameClean = String(data.legalName || '').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20);
      return `CUST-${nameClean}`;
    },
    normalize: (data) => {
      const cleanName = String(data.legalName || '').trim();
      const aliases = Array.isArray(data.aliases) ? data.aliases : (typeof data.aliases === 'string' ? data.aliases.split(',').map((s: string) => s.trim()) : []);
      return {
        customerReferenceId: String(data.customerReferenceId || '').trim(),
        legalName: cleanName,
        normalizedName: cleanName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim(),
        aliases,
        taxVatNumber: data.taxVatNumber || '',
        registrationNumber: data.registrationNumber || '',
        country: data.country || 'Pakistan',
        declaredCoreBusiness: data.declaredCoreBusiness || 'General Commercial Trading',
        riskLevel: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(data.riskLevel) ? data.riskLevel : 'LOW',
        baselineLcFrequencyMean: Number(data.baselineLcFrequencyMean) || 3.0,
        baselineMonthlyVolumeUsd: Number(data.baselineMonthlyVolumeUsd) || 500000,
        typicalGoodsCategories: Array.isArray(data.typicalGoodsCategories) ? data.typicalGoodsCategories : ['General Merchandise'],
        typicalSuppliers: Array.isArray(data.typicalSuppliers) ? data.typicalSuppliers : [],
        typicalBuyers: Array.isArray(data.typicalBuyers) ? data.typicalBuyers : [],
        typicalPortsOfLoading: Array.isArray(data.typicalPortsOfLoading) ? data.typicalPortsOfLoading : [],
        typicalPortsOfDischarge: Array.isArray(data.typicalPortsOfDischarge) ? data.typicalPortsOfDischarge : [],
        typicalTradeRoutes: Array.isArray(data.typicalTradeRoutes) ? data.typicalTradeRoutes : [],
      };
    },
    validate: (data) => {
      const errors: string[] = [];
      if (!data.legalName) errors.push('Legal corporate name is required.');
      return { valid: errors.length === 0, errors };
    },
  },

  banks: {
    type: 'banks',
    displayName: 'Banking Institutions & SWIFT BICs',
    singularName: 'Bank',
    description: 'Authorized dealer banks, SWIFT BIC directory, correspondent banking networks, and sanctioned bank lists.',
    category: 'FINANCIAL',
    icon: 'credit-card',
    primaryKey: 'swiftBic',
    fields: [
      { name: 'swiftBic', label: 'SWIFT / BIC Code (8 or 11 chars)', type: 'string', required: true, placeholder: 'e.g. HABBPAKAXXX, MCBIPKKA', isPrimaryIdentifier: true },
      { name: 'bankName', label: 'Bank Name', type: 'string', required: true, placeholder: 'e.g. Habib Bank Limited, MCB Bank' },
      { name: 'country', label: 'Domicile Country', type: 'string', required: true, placeholder: 'e.g. Pakistan, United Kingdom' },
      { name: 'isAuthorizedDealer', label: 'SBP Authorized Dealer', type: 'boolean', required: true },
      { name: 'isSanctioned', label: 'Sanctions Status', type: 'boolean', required: true },
      { name: 'riskScore', label: 'Financial Crime Risk Rating', type: 'select', options: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'], required: true },
    ],
    capabilities: { create: true, update: true, bulkImport: true, scrape: true, history: true },
    generateDeterministicId: (data) => {
      const bic = String(data.swiftBic || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      return bic || `BNK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    },
    normalize: (data) => {
      const bic = String(data.swiftBic || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      return {
        swiftBic: bic,
        bankName: data.bankName || bic,
        country: data.country || 'Unknown',
        isAuthorizedDealer: Boolean(data.isAuthorizedDealer === true || String(data.isAuthorizedDealer).toLowerCase() === 'true'),
        isSanctioned: Boolean(data.isSanctioned === true || String(data.isSanctioned).toLowerCase() === 'true'),
        riskScore: data.riskScore || (data.isSanctioned ? 'CRITICAL' : 'LOW'),
      };
    },
    validate: (data) => {
      const errors: string[] = [];
      const bic = String(data.swiftBic || '').trim().replace(/[^A-Za-z0-9]/g, '');
      if (bic.length !== 8 && bic.length !== 11) {
        errors.push('SWIFT / BIC code must be exactly 8 or 11 characters.');
      }
      if (!data.bankName) errors.push('Bank name is required.');
      return { valid: errors.length === 0, errors };
    },
  },

  currencies: {
    type: 'currencies',
    displayName: 'Currencies & Foreign Exchange',
    singularName: 'Currency FX Rate',
    description: 'ISO 4217 currency codes, central bank parity rates against USD, and currency risk classifications.',
    category: 'FINANCIAL',
    icon: 'dollar-sign',
    primaryKey: 'currencyCode',
    fields: [
      { name: 'currencyCode', label: 'Currency Code (ISO 4217)', type: 'string', required: true, placeholder: 'e.g. PKR, EUR, CNY, AED', isPrimaryIdentifier: true },
      { name: 'rateToUsd', label: 'Exchange Rate to 1 USD', type: 'number', required: true, placeholder: 'e.g. 278.50' },
      { name: 'effectiveDate', label: 'Rate Effective Date', type: 'date', required: true, placeholder: 'YYYY-MM-DD' },
      { name: 'source', label: 'Rate Source', type: 'string', placeholder: 'e.g. State Bank of Pakistan, IMF' },
    ],
    capabilities: { create: true, update: true, bulkImport: true, scrape: true, history: true },
    generateDeterministicId: (data) => {
      const code = String(data.currencyCode || '').trim().toUpperCase().slice(0, 3);
      return `FX-${code}`;
    },
    normalize: (data) => {
      const code = String(data.currencyCode || '').trim().toUpperCase().slice(0, 3);
      return {
        currencyCode: code,
        rateToUsd: Number(data.rateToUsd) || 1.0,
        effectiveDate: data.effectiveDate ? String(data.effectiveDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
        source: data.source || 'CENTRAL_BANK_FEED',
        isCurrent: true,
      };
    },
    validate: (data) => {
      const errors: string[] = [];
      const code = String(data.currencyCode || '').trim();
      if (code.length !== 3) errors.push('Currency code must be exactly 3 characters (ISO 4217).');
      if (isNaN(Number(data.rateToUsd)) || Number(data.rateToUsd) <= 0) {
        errors.push('Exchange rate to USD must be a positive number.');
      }
      return { valid: errors.length === 0, errors };
    },
  },

  regulations: {
    type: 'regulations',
    displayName: 'Trade Regulations & Statutory SROs',
    singularName: 'Trade Regulation',
    description: 'Pakistan statutory regulatory orders (SROs), Export/Import Policy Orders, and foreign trade directives.',
    category: 'REGULATORY',
    icon: 'file-text',
    primaryKey: 'regulationReference',
    fields: [
      { name: 'regulationReference', label: 'Statutory Reference', type: 'string', required: true, placeholder: 'e.g. SRO-520-2022, IPO-2022-SEC5', isPrimaryIdentifier: true },
      { name: 'title', label: 'Title / Subject of Directive', type: 'string', required: true, placeholder: 'e.g. Prohibition on Import of Luxury & Non-Essential Items' },
      { name: 'issuingAuthority', label: 'Issuing Authority', type: 'string', required: true, placeholder: 'e.g. Ministry of Commerce / SBP / FBR' },
      { name: 'effectiveDate', label: 'Effective Date', type: 'date', required: true, placeholder: 'YYYY-MM-DD' },
      { name: 'expiryDate', label: 'Sunset / Expiry Date', type: 'date', placeholder: 'YYYY-MM-DD or null if indefinite' },
      { name: 'controlledHsCodes', label: 'Controlled / Affected HS Codes', type: 'array', placeholder: 'e.g. 8703, 8528, 2202' },
      { name: 'directiveText', label: 'Summary of Regulatory Requirement', type: 'string', required: true, placeholder: 'Operational directives for Authorized Dealers' },
    ],
    capabilities: { create: true, update: true, bulkImport: true, scrape: false, history: true },
    generateDeterministicId: (data) => {
      const ref = String(data.regulationReference || '').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
      return `REG-${ref || crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    },
    normalize: (data) => {
      const hsList = Array.isArray(data.controlledHsCodes) ? data.controlledHsCodes : (typeof data.controlledHsCodes === 'string' ? data.controlledHsCodes.split(',').map((s: string) => s.trim()) : []);
      return {
        regulationReference: String(data.regulationReference || '').trim(),
        title: data.title || '',
        issuingAuthority: data.issuingAuthority || 'Ministry of Commerce',
        effectiveDate: data.effectiveDate ? String(data.effectiveDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
        expiryDate: data.expiryDate ? String(data.expiryDate).slice(0, 10) : null,
        controlledHsCodes: hsList,
        directiveText: data.directiveText || '',
      };
    },
    validate: (data) => {
      const errors: string[] = [];
      if (!data.regulationReference) errors.push('Statutory regulation reference is required.');
      if (!data.title) errors.push('Regulation title is required.');
      return { valid: errors.length === 0, errors };
    },
  },

  vessels: {
    type: 'vessels',
    displayName: 'Vessels & Maritime AIS Profiles',
    singularName: 'Vessel',
    description: 'IMO registry, maritime AIS tracking profiles, flag states, and designated fleet records.',
    category: 'LOGISTICS',
    icon: 'navigation',
    primaryKey: 'imo',
    fields: [
      { name: 'imo', label: 'IMO Number (7 digits)', type: 'string', required: true, placeholder: 'e.g. 9175717', isPrimaryIdentifier: true },
      { name: 'name', label: 'Vessel Name', type: 'string', required: true, placeholder: 'e.g. EVER GIVEN, ATLANTIC TRADER' },
      { name: 'flagCountry', label: 'Flag State / Registry', type: 'string', required: true, placeholder: 'e.g. Panama, Liberia, Marshall Islands' },
      { name: 'vesselType', label: 'Vessel Type', type: 'string', placeholder: 'e.g. Container Ship, Bulk Carrier, Oil Tanker' },
      { name: 'mmsi', label: 'MMSI Number (9 digits)', type: 'string', placeholder: 'e.g. 353136000' },
      { name: 'isSanctioned', label: 'Sanctions Status', type: 'boolean', required: true },
      { name: 'sanctionProgram', label: 'Sanctions Program (if any)', type: 'string', placeholder: 'e.g. OFAC-IRAN, RUSSIA-EO14024' },
    ],
    capabilities: { create: true, update: true, bulkImport: true, scrape: true, history: true },
    generateDeterministicId: (data) => {
      const imo = String(data.imo || '').replace(/\D/g, '');
      return imo.length === 7 ? imo : `VES-${data.name ? String(data.name).trim().toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 15) : crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    },
    normalize: (data) => {
      const imo = String(data.imo || '').replace(/\D/g, '');
      return {
        vesselId: `VES-${imo || crypto.randomBytes(3).toString('hex')}`,
        imo,
        mmsi: data.mmsi ? String(data.mmsi).replace(/\D/g, '') : undefined,
        name: data.name || 'Unknown Vessel',
        normalizedName: String(data.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim(),
        flagCountry: data.flagCountry || 'Unknown',
        vesselType: data.vesselType || 'General Cargo',
        isSanctioned: Boolean(data.isSanctioned === true || String(data.isSanctioned).toLowerCase() === 'true'),
        sanctionProgram: data.sanctionProgram || undefined,
        recentPortCalls: Array.isArray(data.recentPortCalls) ? data.recentPortCalls : [],
        sourceId: data.sourceId || 'MANUAL_IMPORT',
        syncedAt: new Date().toISOString(),
        isCurrent: true,
      };
    },
    validate: (data) => {
      const errors: string[] = [];
      const imo = String(data.imo || '').replace(/\D/g, '');
      if (imo.length !== 7) errors.push('IMO number must be exactly 7 numeric digits.');
      if (!data.name) errors.push('Vessel name is required.');
      return { valid: errors.length === 0, errors };
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Compatibility & Service Helpers
// ---------------------------------------------------------------------------------------------
export const sanitizeCsvCell = sanitizeForCsvInjection;

export function generateEntityId(type: SupportedEntityType, data: Record<string, any>): string {
  const def = ENTITY_REGISTRY[type];
  if (!def) return crypto.randomBytes(6).toString('hex');
  return def.generateDeterministicId(data);
}

export const entityRegistry = {
  get: (type: SupportedEntityType): EntityDefinition | undefined => ENTITY_REGISTRY[type],
  getAllConfigs: (): EntityDefinition[] => Object.values(ENTITY_REGISTRY),
  validate: (type: SupportedEntityType, data: Record<string, any>) => {
    const def = ENTITY_REGISTRY[type];
    if (!def) return { valid: false, errors: [`Unknown entity type: ${type}`] };
    return def.validate(data);
  },
  normalize: (type: SupportedEntityType, data: Record<string, any>) => {
    const def = ENTITY_REGISTRY[type];
    if (!def) return data;
    return def.normalize(data);
  },
  generateId: (type: SupportedEntityType, data: Record<string, any>): string => {
    return generateEntityId(type, data);
  }
};

