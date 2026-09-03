import type { CommodityLineItem } from '../types';
import type { PakistanTradePolicyAssessment, StatutoryLegalInstrument, ProductRestrictionStatus } from './regulatory.types';

export class PakistanTradePolicyService {
  /**
   * Evaluates a line item against the Pakistan Import Policy Order (IPO),
   * relevant S.R.O. notifications, and official Ministry of Commerce schedules.
   */
  evaluatePakistanTradePolicy(params: {
    item: CommodityLineItem;
    originCountry: string;
    transactionDate: string;
  }): PakistanTradePolicyAssessment {
    const desc = params.item.productDescription.toLowerCase();
    const hs = (params.item.hsCode || '').replace(/\D/g, '');
    const origin = (params.originCountry || '').toUpperCase().trim();
    const requiredPermits: string[] = [];

    // 1. Check Pakistan IPO Appendix A (Banned / Prohibited Goods)
    const isProhibitedCbrnOrHazardous =
      desc.includes('hazardous waste') ||
      desc.includes('ozone depleting') ||
      desc.includes('cfc refrigerant') ||
      desc.includes('narcotic') ||
      desc.includes('asbestos raw');

    if (isProhibitedCbrnOrHazardous) {
      return {
        isSubjectToImportPolicyOrder: true,
        ipoAppendixClassification: 'APPENDIX_A_BANNED',
        requiresSpecialAuthorization: false,
        requiredPermits: [],
        statutoryVerdict: 'PROHIBITED',
        summaryExplanation: `Prohibited from import into Pakistan under Import Policy Order (IPO) Appendix A (Banned Items - Environmental & Hazardous Goods).`,
      };
    }

    // 2. Check Pakistan IPO Appendix B (Restricted Goods Requiring Specific Statutory Regulatory Approval)
    let ipoAppendix: PakistanTradePolicyAssessment['ipoAppendixClassification'] = 'STANDARD_FREE_LIST';
    let verdict: ProductRestrictionStatus = 'PERMITTED';
    const explanationParts: string[] = [];

    // Telecom / Encryption / Wireless -> Requires PTA (Pakistan Telecommunication Authority) Type Approval
    if (
      desc.includes('router') ||
      desc.includes('wireless') ||
      desc.includes('telecom') ||
      desc.includes('satellite') ||
      desc.includes('encryption') ||
      hs.startsWith('8517')
    ) {
      ipoAppendix = 'APPENDIX_B_RESTRICTED';
      verdict = 'LICENSED';
      requiredPermits.push('PTA (Pakistan Telecommunication Authority) Type Approval Certificate');
      explanationParts.push('Requires PTA Type Approval and Commercial Import Certificate under IPO Appendix B Part-II.');
    }

    // Pharmaceutical / Active Pharmaceutical Ingredients (API) -> Requires DRAP Certificate
    if (
      desc.includes('pharmaceutical') ||
      desc.includes('medicine') ||
      desc.includes('therapeutic') ||
      desc.includes('capsule') ||
      hs.startsWith('3004') ||
      hs.startsWith('2936')
    ) {
      ipoAppendix = 'APPENDIX_B_RESTRICTED';
      verdict = 'LICENSED';
      requiredPermits.push('DRAP (Drug Regulatory Authority of Pakistan) Registration / NOC');
      explanationParts.push('Requires DRAP valid import registration or Form 6/7 import license.');
    }

    // Industrial Machinery / Pressure Vessels / Boilers -> Requires Chief Inspector of Boilers NOC
    if (desc.includes('boiler') || desc.includes('pressure vessel') || desc.includes('autoclave')) {
      ipoAppendix = 'APPENDIX_B_RESTRICTED';
      verdict = 'SPECIAL_CONDITIONS';
      requiredPermits.push('Chief Inspector of Boilers / Technical Safety NOC');
      explanationParts.push('Subject to pre-shipment technical safety inspection and certification.');
    }

    // 3. Country-of-Origin Statutory Analysis (e.g. S.R.O. 927(I)/2019 and Statutory Trade Orders)
    // Evaluates actual legal rules and exemptions rather than sweeping stereotypes
    let originSpecificRule: PakistanTradePolicyAssessment['originSpecificRule'];

    if (origin === 'INDIA' || origin === 'IN') {
      // Under S.R.O. 927(I)/2019 read with Ministry of Commerce notification No. 2(4)/2019-Exp,
      // bilateral trade with India was suspended with statutory exceptions for therapeutic goods/medicines.
      const isTherapeuticOrPharma =
        desc.includes('medicine') ||
        desc.includes('therapeutic') ||
        desc.includes('pharmaceutical') ||
        desc.includes('vaccine') ||
        desc.includes('api') ||
        hs.startsWith('3002') ||
        hs.startsWith('3004') ||
        hs.startsWith('2936');

      if (isTherapeuticOrPharma) {
        originSpecificRule = {
          originCountry: 'India',
          isRestrictedOrigin: true,
          statutoryBasis: 'S.R.O. 927(I)/2019 & Ministry of Commerce Statutory Exemption for Therapeutic Products',
          exceptionsApplicable: ['Therapeutic Goods and Essential Life-Saving Pharmaceuticals'],
          isExemptedForThisTransaction: true,
        };
        explanationParts.push(
          'Originating from India: Permitted under statutory humanitarian/therapeutic exception of S.R.O. 927(I)/2019 subject to DRAP clearance.',
        );
      } else {
        originSpecificRule = {
          originCountry: 'India',
          isRestrictedOrigin: true,
          statutoryBasis: 'Ministry of Commerce S.R.O. 927(I)/2019 (Bilateral Trade Restrictions)',
          exceptionsApplicable: ['Therapeutic Products only'],
          isExemptedForThisTransaction: false,
        };
        verdict = 'RESTRICTED';
        explanationParts.push(
          'Originating from India: General non-therapeutic commercial imports are restricted under S.R.O. 927(I)/2019. Specific Ministry of Commerce clearance required.',
        );
      }
    }

    if (explanationParts.length === 0) {
      explanationParts.push('Classified on standard Free Import List under Pakistan Customs Tariff and Import Policy Order.');
    }

    return {
      isSubjectToImportPolicyOrder: true,
      ipoAppendixClassification: ipoAppendix,
      requiresSpecialAuthorization: requiredPermits.length > 0,
      requiredPermits,
      originSpecificRule,
      statutoryVerdict: verdict,
      summaryExplanation: explanationParts.join(' '),
    };
  }

  /**
   * Get statutory instruments governing Pakistan trade policy for a commodity.
   */
  getStatutoryInstruments(params: {
    productDescription: string;
    originCountry: string;
  }): StatutoryLegalInstrument[] {
    const instruments: StatutoryLegalInstrument[] = [
      {
        instrumentId: 'PK-IPO-2022',
        authority: 'Ministry of Commerce, Government of Pakistan',
        instrumentType: 'IMPORT_POLICY_ORDER',
        referenceNumber: 'Import Policy Order 2022 (S.R.O. 543(I)/2022)',
        title: 'Statutory Import Regulations, Classifications, and Procedural Framework',
        effectiveDate: '2022-04-20',
        ingestedAt: '2024-01-15T00:00:00Z',
        sourceUrl: 'https://commerce.gov.pk/import-policy-order/',
        sourceAuthorityLevel: 'LEVEL_1_OFFICIAL_REGULATOR',
      },
    ];

    const origin = (params.originCountry || '').toUpperCase().trim();
    if (origin === 'INDIA' || origin === 'IN') {
      instruments.push({
        instrumentId: 'PK-SRO-927',
        authority: 'Ministry of Commerce, Government of Pakistan',
        instrumentType: 'SRO_NOTIFICATION',
        referenceNumber: 'S.R.O. 927(I)/2019',
        title: 'Amendments to the Import Policy Order Regarding Regional Trade Framework and Humanitarian Exemptions',
        effectiveDate: '2019-08-09',
        ingestedAt: '2024-01-15T00:00:00Z',
        sourceUrl: 'https://fbr.gov.pk/customs-sros-2019',
        sourceAuthorityLevel: 'LEVEL_1_OFFICIAL_REGULATOR',
      });
    }

    return instruments;
  }
}
