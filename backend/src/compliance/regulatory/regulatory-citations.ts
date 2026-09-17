/**
 * TradeGuard Regulatory Citations & Statutory Authority Registry
 * Official legal, banking, customs, and intergovernmental compliance references.
 */

export interface RegulatoryCitation {
  authority: string;
  framework: string;
  statutoryReference: string;
  legalMandate: string;
  auditStandard: string;
}

export const REGULATORY_AUTHORITIES = {
  // 1. Sanctions & Targeted Financial Sanctions (TFS)
  OFAC_SDN: {
    authority: 'US Department of the Treasury (OFAC)',
    framework: 'US Specially Designated Nationals and Blocked Persons Regime',
    statutoryReference: 'Title 31 CFR Part 500 et seq. • International Emergency Economic Powers Act (50 U.S.C. § 1701)',
    legalMandate: 'Mandatory blocking of all property and interests in property of designated persons; secondary sanctions risk for non-US banks.',
    auditStandard: 'OFAC Sanctions Compliance Guidance for the Maritime and Trade Finance Sectors (May 2020)',
  },
  UNSC_TFS: {
    authority: 'United Nations Security Council Committee',
    framework: 'UN Consolidated Targeted Financial Sanctions',
    statutoryReference: 'UNSC Resolutions 1267 (1999), 1989 (2011), 2253 (2015), 1718 (2006) • United Nations (Security Council) Act, 1948',
    legalMandate: 'Universal international legal obligation on all UN member states to freeze without delay assets of designated terrorists and WMD proliferators.',
    auditStandard: 'FATF Recommendation 6 & 7 (Targeted Financial Sanctions)',
  },
  EU_FSF: {
    authority: 'European Commission / European External Action Service',
    framework: 'EU Consolidated Financial Sanctions Database',
    statutoryReference: 'Council Regulation (EU) No 269/2014 & Council Regulation (EU) No 833/2014',
    legalMandate: 'Asset freeze, prohibition on making funds or economic resources available, and trade restrictions on dual-use commodities.',
    auditStandard: 'EU Best Practices for the effective implementation of restrictive measures',
  },
  UK_OFSI: {
    authority: 'HM Treasury Office of Financial Sanctions Implementation (OFSI)',
    framework: 'UK Consolidated Sanctions List',
    statutoryReference: 'Sanctions and Anti-Money Laundering Act 2018 (SAMLA 2018)',
    legalMandate: 'Strict liability civil penalties for non-compliance with UK financial sanctions.',
    auditStandard: 'OFSI Financial Sanctions Guidance for Trade & Maritime Shipping',
  },
  SBP_TFS: {
    authority: 'State Bank of Pakistan (SBP) & NACTA',
    framework: 'SBP Anti-Money Laundering, Combating Financing of Terrorism & Countering Proliferation Financing (AML/CFT/CPF)',
    statutoryReference: 'SBP BPRD Circular No. 04 of 2019 • Anti-Terrorism Act, 1997 (Section 11EE & Fourth Schedule) • Anti-Money Laundering Act, 2020 (AMLA)',
    legalMandate: 'Immediate asset freezing and reporting of transactions involving proscribed individuals or organizations to SBP and Financial Monitoring Unit (FMU).',
    auditStandard: 'SBP Framework for Risk Management in Trade Finance (SBP BPRD Circular 02/2019)',
  },

  // 2. Trade-Based Money Laundering (FATF)
  FATF_TBML: {
    authority: 'Financial Action Task Force (FATF)',
    framework: 'FATF-Egmont International Best Practices on Trade-Based Money Laundering',
    statutoryReference: 'FATF Recommendation 19 & 20 • FATF Trade-Based Money Laundering Typologies (2020)',
    legalMandate: 'Obligation on authorized dealer banks to detect over/under-invoicing, phantom shipments, multiple invoicing, and obfuscated shipping routes.',
    auditStandard: 'Wolfsberg Group, ICC and BAFT Trade Finance Principles for AML/CFT',
  },

  // 3. Documentary Examination (ICC Standards)
  ICC_UCP600: {
    authority: 'International Chamber of Commerce (ICC)',
    framework: 'Uniform Customs and Practice for Documentary Credits (UCP 600)',
    statutoryReference: 'ICC Publication No. 600 • Articles 14 (Standard for Examination of Documents), 18 (Commercial Invoices), 20 (Bills of Lading)',
    legalMandate: 'Global standard governing documentary credits, letters of credit examination, and non-conflicting document presentations.',
    auditStandard: 'ICC International Standard Banking Practice (ISBP 745)',
  },

  // 4. Commodity Pricing & Valuation
  UN_COMTRADE: {
    authority: 'United Nations Statistics Division (UN Comtrade)',
    framework: 'UN International Trade Statistics Database (Harmonized System 6-Digit HS)',
    statutoryReference: 'Harmonized Commodity Description and Coding System (HS 2022 / 2026 Nomenclature)',
    legalMandate: 'Authoritative global benchmark for unit value export/import trade corridors across 200+ sovereign jurisdictions.',
    auditStandard: 'WCO Customs Valuation Compendium (WTO Agreement on Implementation of Article VII of GATT 1994)',
  },
  PAK_CUSTOMS_VALUATION: {
    authority: 'Federal Board of Revenue (FBR) & Pakistan Single Window (PSW)',
    framework: 'Pakistan Customs Valuation Rulings & Tariff Hierarchy',
    statutoryReference: 'Section 25 & 25A of the Customs Act, 1969 • Directorate General of Customs Valuation General Orders',
    legalMandate: 'Statutory minimum export and import customs value thresholds for authorized dealer trade settlement.',
    auditStandard: 'SBP Foreign Exchange Manual Chapter 12 & 13 (Import/Export Currency Realization)',
  },

  // 5. Maritime Carriage & Vessel Tracking
  UNECE_UNLOCODE: {
    authority: 'United Nations Economic Commission for Europe (UNECE)',
    framework: 'UN/LOCODE Standard Port & Location Codes',
    statutoryReference: 'UNECE Recommendation No. 16 (UN/LOCODE)',
    legalMandate: 'Universal standard for maritime, air, and multimodal port identification in trade logistics and customs declarations.',
    auditStandard: 'WCO Data Model & IMO Port Facility Security (ISPS Code)',
  },
  IMO_GISIS: {
    authority: 'International Maritime Organization (IMO)',
    framework: 'IMO Ship Identification Number Scheme',
    statutoryReference: 'SOLAS Convention Regulation XI-1/3 (Mandatory Ship Identification Numbers)',
    legalMandate: 'Permanent unique seven-digit identifier assigned to commercial vessels for non-repudiation and safety of life at sea.',
    auditStandard: 'BIMCO Sanctions Clause for Time and Voyage Charter Parties',
  },
} as const;

export function getAuthorityCitation(key: keyof typeof REGULATORY_AUTHORITIES): RegulatoryCitation {
  return REGULATORY_AUTHORITIES[key];
}
