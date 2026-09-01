import type { JurisdictionalApplicabilityStatus, JurisdictionalNexusAssessment } from '../temporal/temporal.types';
import type { TradeParties } from '../types';

export interface NexusEvaluationInput {
  bankDomicile?: string;
  parties: TradeParties;
  currency: string;
  paymentRoute?: string;
  originCountry?: string;
  destinationCountry?: string;
  transitCountries?: string[];
  vesselFlag?: string;
}

export class JurisdictionalNexusService {
  /**
   * Evaluate which regulatory regimes legally apply to this trade finance presentation.
   */
  evaluateJurisdictionalNexus(input: NexusEvaluationInput): JurisdictionalNexusAssessment[] {
    const assessments: JurisdictionalNexusAssessment[] = [];

    // 1. Pakistan Nexus (SBP / Domestic Mandate)
    const isPakBank = (input.bankDomicile || 'PK').toUpperCase().includes('PK') || (input.bankDomicile || '').toLowerCase().includes('pakistan');
    const touchesPak =
      isPakBank ||
      input.originCountry?.toLowerCase().includes('pakistan') ||
      input.destinationCountry?.toLowerCase().includes('pakistan') ||
      input.parties.applicant?.country?.toLowerCase().includes('pakistan') ||
      input.parties.beneficiary?.country?.toLowerCase().includes('pakistan') ||
      input.parties.issuingBank?.bankCountry?.toLowerCase().includes('pakistan');

    assessments.push({
      jurisdiction: 'PK',
      regimeName: 'State Bank of Pakistan (SBP) & MOFA Targeted Financial Sanctions',
      applicability: touchesPak ? 'LEGALLY_APPLICABLE' : 'POTENTIALLY_APPLICABLE',
      nexusBasis: [
        ...(isPakBank ? ['Authorized Dealer Bank licensed under State Bank of Pakistan statutory jurisdiction.'] : []),
        ...(touchesPak ? ['Transaction counterparty / geographical node domiciled in Pakistan.'] : []),
      ],
      reason: touchesPak
        ? 'Mandatory legal compliance under Anti-Terrorism Act 1997, UNSC Act 1948, and SBP BPRD circulars.'
        : 'Foreign presentation evaluated under standard international banking policy.',
      mandatoryLegalEffect: Boolean(touchesPak),
      applicableAuthorities: ['State Bank of Pakistan (SBP)', 'NACTA', 'Ministry of Foreign Affairs (MOFA)'],
    });

    // 2. United Nations Security Council (UNSC) Nexus
    assessments.push({
      jurisdiction: 'UN',
      regimeName: 'United Nations Security Council Consolidated Sanctions',
      applicability: 'LEGALLY_APPLICABLE',
      nexusBasis: ['Universal binding international treaty obligations under Chapter VII of the UN Charter.'],
      reason: 'UNSC Resolutions apply universally across all member states including Pakistan Authorized Dealers.',
      mandatoryLegalEffect: true,
      applicableAuthorities: ['United Nations Security Council Committee (Resolutions 1267, 1718, 2231)'],
    });

    // 3. United States Nexus (OFAC / BIS EAR)
    const isUsd = (input.currency || '').toUpperCase() === 'USD';
    const touchesUs =
      isUsd ||
      input.originCountry?.toLowerCase().includes('united states') ||
      input.destinationCountry?.toLowerCase().includes('united states') ||
      input.parties.applicant?.country?.toLowerCase().includes('united states') ||
      input.parties.seller?.country?.toLowerCase().includes('united states') ||
      input.parties.buyer?.country?.toLowerCase().includes('united states');

    let usApplicability: JurisdictionalApplicabilityStatus = 'NOT_APPLICABLE';
    const usBasis: string[] = [];

    if (touchesUs && isUsd) {
      usApplicability = 'LEGALLY_APPLICABLE';
      usBasis.push('USD currency clearing routes through US correspondent banking system (Primary US Nexus).');
      usBasis.push('Extraterritorial US OFAC and Secondary Sanctions exposure under Executive Orders.');
    } else if (isUsd) {
      usApplicability = 'LEGALLY_APPLICABLE';
      usBasis.push('Settlement in USD invokes US Clearing System jurisdiction (CHIPS / Fedwire).');
    } else if (touchesUs) {
      usApplicability = 'LEGALLY_APPLICABLE';
      usBasis.push('US incorporated party / geographical transit node.');
    } else {
      usApplicability = 'INTERNAL_POLICY_ONLY';
      usBasis.push('No direct US nexus detected. Screened under Bank Global Correspondent Policy & Secondary Sanctions protection.');
    }

    assessments.push({
      jurisdiction: 'US',
      regimeName: 'US Treasury OFAC & Commerce BIS Export Administration Regulations (EAR)',
      applicability: usApplicability,
      nexusBasis: usBasis,
      reason: isUsd
        ? 'Direct US regulatory jurisdiction created through USD clearing and Fedwire processing.'
        : 'Screened to protect international correspondent banking relationships against secondary sanctions.',
      mandatoryLegalEffect: Boolean(isUsd || touchesUs),
      applicableAuthorities: ['US Treasury OFAC', 'US Department of Commerce BIS'],
    });

    // 4. European Union (EU) Nexus
    const isEur = (input.currency || '').toUpperCase() === 'EUR';
    const touchesEu =
      isEur ||
      input.originCountry?.toLowerCase().includes('germany') ||
      input.destinationCountry?.toLowerCase().includes('france') ||
      input.parties.seller?.country?.toLowerCase().includes('germany') ||
      input.parties.buyer?.country?.toLowerCase().includes('netherlands');

    assessments.push({
      jurisdiction: 'EU',
      regimeName: 'European Union Consolidated Financial Sanctions (Council Regulations)',
      applicability: touchesEu ? 'LEGALLY_APPLICABLE' : isEur ? 'POTENTIALLY_APPLICABLE' : 'INTERNAL_POLICY_ONLY',
      nexusBasis: [
        ...(isEur ? ['EUR currency clearing via TARGET2 Eurosystem.'] : []),
        ...(touchesEu ? ['EU member state counterparty or logistics routing.'] : []),
        ...(!isEur && !touchesEu ? ['Screened under bank global risk tolerance policy.'] : []),
      ],
      reason: touchesEu
        ? 'EU Council Regulations binding on EU counterparties, vessels, and Euro financial rails.'
        : 'Bank internal correspondent compliance standard.',
      mandatoryLegalEffect: Boolean(touchesEu),
      applicableAuthorities: ['European Commission (EEAS / DG FISMA)', 'Council of the European Union'],
    });

    // 5. United Kingdom (UK) Nexus
    const isGbp = (input.currency || '').toUpperCase() === 'GBP';
    const touchesUk =
      isGbp ||
      input.originCountry?.toLowerCase().includes('united kingdom') ||
      input.destinationCountry?.toLowerCase().includes('united kingdom') ||
      input.parties.buyer?.country?.toLowerCase().includes('united kingdom') ||
      input.parties.seller?.country?.toLowerCase().includes('united kingdom');

    assessments.push({
      jurisdiction: 'UK',
      regimeName: 'UK Sanctions List & HM Treasury OFSI (Sanctions and AML Act 2018)',
      applicability: touchesUk ? 'LEGALLY_APPLICABLE' : isGbp ? 'POTENTIALLY_APPLICABLE' : 'INTERNAL_POLICY_ONLY',
      nexusBasis: [
        ...(isGbp ? ['GBP currency clearing via UK CHAPS.'] : []),
        ...(touchesUk ? ['UK legal entity counterparty or UK territorial routing.'] : []),
        ...(!isGbp && !touchesUk ? ['Screened for UK correspondent bank compliance.'] : []),
      ],
      reason: touchesUk
        ? 'Statutory compliance under UK Sanctions and Anti-Money Laundering Act (SAMLA 2018).'
        : 'Advisory screening for UK trade corridors.',
      mandatoryLegalEffect: Boolean(touchesUk),
      applicableAuthorities: ['HM Treasury OFSI', 'Foreign, Commonwealth & Development Office (FCDO)'],
    });

    return assessments;
  }
}
