import { PakistanTradePolicyService } from './pakistan-trade-policy.service';
import type { CommodityLineItem } from '../types';
import type {
  BitemporalRegulatoryStatus,
  ProductRegulatoryIntelligenceResult,
  ProductRestrictionStatus,
} from './regulatory.types';

/**
 * What a reader must be told about this service's verdicts. They come from a short list of product keywords
 * and HS prefixes in the code, with statutory references written alongside. None of the cited instruments has
 * been retrieved and checked against the official text, none carries an effective date from its source, and the
 * rules have not been approved by the bank's compliance function (the rule registry in trade-cases is where
 * that is tracked). The result is therefore a prompt for a trade officer, never a statement of law.
 */
export const UNAPPROVED_INDICATOR_NOTICE =
  'Keyword-based indicator from built-in rules. The statutory references have not been verified against the official text of the Import Policy Order or the notifications, and the rules are not approved by the bank. A trade officer must confirm the legal position; this is not a finding that the goods are prohibited or permitted.';

export class ProductRegulatoryService {
  private readonly pakistanService = new PakistanTradePolicyService();

  /**
   * Evaluate comprehensive bitemporal product regulatory intelligence.
   */
  evaluateProductRegulatoryIntelligence(params: {
    goods: CommodityLineItem[];
    originCountry: string;
    destinationCountry: string;
    transactionDate: string;
  }): ProductRegulatoryIntelligenceResult[] {
    const results: ProductRegulatoryIntelligenceResult[] = [];
    const txnDate = this.parseDate(params.transactionDate);
    const dest = (params.destinationCountry || '').toUpperCase().trim();

    for (const item of params.goods) {
      // 1. Pakistan Trade Policy evaluation if destination or origin touches Pakistan
      const isPakistanTrade = dest.includes('PAKISTAN') || dest === 'PK';
      const pakistanAssessment = isPakistanTrade
        ? this.pakistanService.evaluatePakistanTradePolicy({
            item,
            originCountry: params.originCountry,
            transactionDate: params.transactionDate,
          })
        : undefined;

      const instruments = isPakistanTrade
        ? this.pakistanService.getStatutoryInstruments({
            productDescription: item.productDescription,
            originCountry: params.originCountry,
          })
        : [];

      // 2. Bitemporal Regulatory Date Evaluation
      // Check if any governing statutory instrument took effect after or before transaction date
      let temporalStatus: BitemporalRegulatoryStatus = 'ACTIVE_AT_TRANSACTION_DATE';
      let statusAtTxnDate: ProductRestrictionStatus = pakistanAssessment ? pakistanAssessment.statutoryVerdict : 'PERMITTED';
      let currentStatus: ProductRestrictionStatus = statusAtTxnDate;

      for (const inst of instruments) {
        const effectiveDate = this.parseDate(inst.effectiveDate);
        const expiryDate = inst.expiryDate ? this.parseDate(inst.expiryDate) : null;

        if (effectiveDate && txnDate) {
          if (txnDate < effectiveDate) {
            // Transaction occurred BEFORE the statutory restriction was enacted!
            temporalStatus = 'ADDED_AFTER_TRANSACTION';
            statusAtTxnDate = 'PERMITTED'; // Was legal at transaction time!
            currentStatus = pakistanAssessment ? pakistanAssessment.statutoryVerdict : 'RESTRICTED';
          } else if (expiryDate && txnDate > expiryDate) {
            // Statutory restriction had already expired by the transaction date
            temporalStatus = 'EXPIRED_BEFORE_TRANSACTION';
            statusAtTxnDate = 'PERMITTED';
          }
        }
      }

      // Build explainable regulatory text
      let regulatoryExplanation = pakistanAssessment
        ? `[Indicator only, not an approved rule] ${pakistanAssessment.summaryExplanation}`
        : 'Standard commercial merchandise subject to routine customs classification.';

      if (temporalStatus === 'ADDED_AFTER_TRANSACTION') {
        regulatoryExplanation += ` [Bitemporal Position]: This restriction was enacted on ${instruments[0]?.effectiveDate || 'subsequent date'}, AFTER the transaction date (${new Date(params.transactionDate).toLocaleDateString()}). The transaction was statutorily non-restricted on the date of execution.`;
      }

      results.push({
        lineItemId: item.id,
        itemNumber: item.itemNumber,
        productDescription: item.productDescription,
        hsCode: item.hsCode,
        countryOfOrigin: params.originCountry,
        destinationCountry: params.destinationCountry,
        transactionDate: params.transactionDate,
        temporalStatus,
        restrictionStatusAtTransactionDate: statusAtTxnDate,
        currentRestrictionStatus: currentStatus,
        pakistanAssessment,
        dualUseClassification: item.eccn,
        licenseRequirement: item.isControlledOrDualUse ? 'Export / Import License Check Required' : undefined,
        governingInstruments: instruments,
        regulatoryExplanation,
        confidence: 'LOW',
        limitations: [
          UNAPPROVED_INDICATOR_NOTICE,
          'Customs clearing agents must verify specific physical inspection quotas at designated port of entry.',
        ],
      });
    }

    return results;
  }

  private parseDate(dateStr?: string): Date | null {
    if (!dateStr || dateStr === 'Not Found') return null;
    try {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
}
