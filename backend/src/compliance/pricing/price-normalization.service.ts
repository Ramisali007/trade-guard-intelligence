import { FxRatesService } from './fx-rates.service';

export interface CurrencyRate {
  [currencyCode: string]: number; // Rate to 1 USD
}

export class PriceNormalizationService {
  /**
   * Convert an amount to USD. For a transaction older than a few days the rate held on that date (the
   * nearest earlier one in the rate history) is preferred over today's; otherwise the freshest rate known.
   * Returns null when no rate exists for the currency: treating an unknown currency as dollars one-to-one
   * would turn any price in it into a false over- or under-invoicing finding.
   */
  async normalizeCurrencyToUsd(amount: number, currency: string, asOfDate?: string): Promise<{ usd: number; basis: string } | null> {
    if (!amount || Number.isNaN(amount) || amount <= 0) return { usd: 0, basis: 'no amount' };
    const curr = (currency || 'USD').toUpperCase().trim();
    if (curr === 'USD') return { usd: Number(amount.toFixed(2)), basis: 'USD' };

    const fx = FxRatesService.getInstance();
    const ageDays = asOfDate ? (Date.now() - new Date(asOfDate).getTime()) / 86_400_000 : 0;
    if (asOfDate && ageDays > 3) {
      try {
        const { ComplianceStore } = await import('../db/compliance-store');
        const stored = await ComplianceStore.getInstance().getFxRateToUsd(curr, asOfDate);
        if (typeof stored === 'number' && stored > 0) return { usd: Number((amount / stored).toFixed(2)), basis: `${curr} rate on or before ${asOfDate.slice(0, 10)}` };
      } catch {
        // fall through to the freshest rate
      }
    }
    const cached = fx.cachedRate(curr);
    if (cached && cached > 0) {
      return { usd: Number((amount / cached).toFixed(2)), basis: fx.hasLiveRates() ? `${curr} daily reference rate` : `${curr} bundled reference rate` };
    }
    return null;
  }

  /**
   * Normalize Incoterm basis.
   * If benchmark is CIF and declared price is FOB, FOB is adjusted to CIF equivalent
   * by incorporating standard maritime freight and insurance allowance (+8%).
   * If benchmark is FOB and declared price is CIF, CIF is adjusted by -8%.
   */
  normalizeIncotermBasis(
    unitPrice: number,
    declaredIncoterm: string,
    targetBasis: 'CIF' | 'FOB' = 'CIF',
  ): { normalizedPrice: number; adjustmentAppliedPercent: number; note: string } {
    const incoterm = (declaredIncoterm || 'FOB').toUpperCase().trim();

    // If both are already aligned (e.g. both CIF or both FOB)
    if (
      (targetBasis === 'CIF' && (incoterm === 'CIF' || incoterm === 'CIP')) ||
      (targetBasis === 'FOB' && (incoterm === 'FOB' || incoterm === 'FCA' || incoterm === 'EXW'))
    ) {
      return {
        normalizedPrice: unitPrice,
        adjustmentAppliedPercent: 0,
        note: `Declared Incoterm (${incoterm}) matches target comparison basis (${targetBasis}).`,
      };
    }

    // FOB to CIF target: add estimated freight & insurance (+8%)
    if (targetBasis === 'CIF' && (incoterm === 'FOB' || incoterm === 'FCA' || incoterm === 'EXW')) {
      const adjusted = Number((unitPrice * 1.08).toFixed(2));
      return {
        normalizedPrice: adjusted,
        adjustmentAppliedPercent: 8,
        note: `Declared ${incoterm} adjusted +8% to CIF landed parity (incorporating estimated freight & marine insurance).`,
      };
    }

    // CIF to FOB target: discount freight & insurance (-8%)
    if (targetBasis === 'FOB' && (incoterm === 'CIF' || incoterm === 'CIP')) {
      const adjusted = Number((unitPrice * 0.9259).toFixed(2));
      return {
        normalizedPrice: adjusted,
        adjustmentAppliedPercent: -7.41,
        note: `Declared ${incoterm} discounted to FOB ex-factory/port parity.`,
      };
    }

    return {
      normalizedPrice: unitPrice,
      adjustmentAppliedPercent: 0,
      note: `Incoterm ${incoterm} evaluated as standard commercial baseline.`,
    };
  }

  /**
   * Normalize Unit of Measure (UOM) to standard baseline.
   */
  normalizeUnitOfMeasure(
    unitPrice: number,
    quantity: number,
    uom: string,
  ): { normalizedUnitPrice: number; normalizedQuantity: number; standardUom: string } {
    const normUom = (uom || 'PCS').toUpperCase().trim();

    // Dozen -> Pieces
    if (normUom === 'DOZ' || normUom === 'DOZEN' || normUom === 'DZN') {
      return {
        normalizedUnitPrice: Number((unitPrice / 12).toFixed(2)),
        normalizedQuantity: quantity * 12,
        standardUom: 'PCS',
      };
    }

    // Metric Ton -> Kilograms
    if (normUom === 'MT' || normUom === 'TON' || normUom === 'TONNE') {
      return {
        normalizedUnitPrice: Number((unitPrice / 1000).toFixed(4)),
        normalizedQuantity: quantity * 1000,
        standardUom: 'KG',
      };
    }

    // Pounds -> Kilograms
    if (normUom === 'LBS' || normUom === 'POUNDS' || normUom === 'LB') {
      return {
        normalizedUnitPrice: Number((unitPrice / 0.453592).toFixed(2)),
        normalizedQuantity: Number((quantity * 0.453592).toFixed(2)),
        standardUom: 'KG',
      };
    }

    return {
      normalizedUnitPrice: unitPrice,
      normalizedQuantity: quantity,
      standardUom: normUom,
    };
  }

  /**
   * Calculate transparent price variance percentage.
   */
  calculatePriceVariancePercent(declaredPrice: number, benchmarkPrice: number): number {
    if (!benchmarkPrice || benchmarkPrice <= 0) return 0;
    const variance = ((declaredPrice - benchmarkPrice) / benchmarkPrice) * 100;
    return Number(variance.toFixed(1));
  }
}
