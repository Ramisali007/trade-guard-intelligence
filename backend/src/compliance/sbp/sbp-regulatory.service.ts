import type { SBPComplianceAssessment } from '../temporal/temporal.types';
import type { CommodityLineItem, TradeParties } from '../types';

export class SbpRegulatoryService {
  /**
   * Evaluate compliance against State Bank of Pakistan (SBP) statutory trade finance directives,
   * TFS regulations, TBML risk indicators, and Foreign Exchange Manual Chapters 12 & 13.
   */
  evaluateSbpCompliance(params: {
    parties: TradeParties;
    goods: CommodityLineItem[];
    currency: string;
    totalAmount: number;
    paymentTerms?: string;
    hasTfsHit: boolean;
    hasTbmlFlags: boolean;
    hasOutOfScopeGoods: boolean;
    hasDiscrepancies: boolean;
  }): SBPComplianceAssessment {
    const triggeredCirculars: SBPComplianceAssessment['triggeredSbpCirculars'] = [];
    let isCompliant = true;
    let requiresInquiry = false;

    // 1. SBP TFS Directives (BPRD Circular No. 02 of 2019 / NACTA)
    if (params.hasTfsHit) {
      isCompliant = false;
      triggeredCirculars.push({
        circularRef: 'SBP-BPRD-CIR-02-2019',
        title: 'Targeted Financial Sanctions (TFS) under UNSC Resolutions & ATA 1997',
        requirement: 'Immediate freezing of funds and prohibition on providing trade finance services to designated entities/individuals.',
        complianceStatus: 'NON_COMPLIANT',
      });
    } else {
      triggeredCirculars.push({
        circularRef: 'SBP-BPRD-CIR-02-2019',
        title: 'TFS Mandatory Screening Verification',
        requirement: 'All counterparties, issuing/advising banks, and beneficial owners verified against SBP/MOFA statutory lists.',
        complianceStatus: 'COMPLIANT',
      });
    }

    // 2. SBP TBML / TF Risk Management Framework for Authorized Dealers
    if (params.hasTbmlFlags || params.hasOutOfScopeGoods) {
      requiresInquiry = true;
      triggeredCirculars.push({
        circularRef: 'SBP-BPRD-TBML-FRAMEWORK-2020',
        title: 'Framework for Managing Risks of Trade-Based Money Laundering & Terrorist Financing',
        requirement: 'Authorized Dealers must perform price verification, dual-use screening, and customer profile consistency checks before LC issuance / document negotiation.',
        complianceStatus: 'FURTHER_INQUIRY_REQUIRED',
      });
    } else {
      triggeredCirculars.push({
        circularRef: 'SBP-BPRD-TBML-FRAMEWORK-2020',
        title: 'Trade-Based Money Laundering & Price Verification',
        requirement: 'Commodity pricing and volumetric profiles conform with market norms.',
        complianceStatus: 'COMPLIANT',
      });
    }

    // 3. Foreign Exchange Manual Chapter 12 & 13 (Import/Export Controls & e-Form Validation)
    if (params.hasDiscrepancies) {
      requiresInquiry = true;
      triggeredCirculars.push({
        circularRef: 'SBP-FE-MANUAL-CH12-13',
        title: 'Foreign Exchange Manual Chapter 12 (Imports) & Chapter 13 (Exports)',
        requirement: 'Authorized Dealer must verify documentary conformity between invoice, shipping transport documents, and customs electronic verification (e-Form E / Form I).',
        complianceStatus: 'FURTHER_INQUIRY_REQUIRED',
      });
    } else {
      triggeredCirculars.push({
        circularRef: 'SBP-FE-MANUAL-CH12-13',
        title: 'e-Form Verification & Document Conformity',
        requirement: 'Trade documentation complies with SBP Authorized Dealer examination standard.',
        complianceStatus: 'COMPLIANT',
      });
    }

    // 4. Determine SBP Verdict
    let overallSbpVerdict: SBPComplianceAssessment['overallSbpVerdict'] = 'COMPLIANT';
    let explanation = 'Presentation conforms with State Bank of Pakistan (SBP) Trade Regulatory Framework and TFS mandates.';

    if (!isCompliant) {
      overallSbpVerdict = 'REJECT';
      explanation = 'CRITICAL VIOLATION: Direct match against SBP / MOFA Targeted Financial Sanctions proscription list. Transaction must be halted and reported via STR to Financial Monitoring Unit (FMU).';
    } else if (requiresInquiry) {
      overallSbpVerdict = 'FURTHER_DUE_DILIGENCE';
      explanation = 'Enhanced Due Diligence required under SBP TBML Framework: Discrepancies, pricing variations, or customer profile inconsistencies require verification by Authorized Dealer.';
    }

    return {
      regime: 'SBP_PAKISTAN_FRAMEWORK',
      frameworkVersion: 'SBP-BPRD-V2026.2',
      authorizedDealerChecks: {
        tfsMandatoryScreening: !params.hasTfsHit,
        tbmlRiskRating: params.hasTfsHit ? 'PROHIBITED' : params.hasTbmlFlags ? 'HIGH' : params.hasOutOfScopeGoods ? 'MEDIUM' : 'LOW',
        feManualChapter12Compliant: !params.hasDiscrepancies,
        eFormValidation: params.hasDiscrepancies ? 'DISCREPANT' : 'VERIFIED',
        customerProfileConsistency: !params.hasOutOfScopeGoods,
      },
      triggeredSbpCirculars: triggeredCirculars,
      overallSbpVerdict,
      explanation,
    };
  }
}
