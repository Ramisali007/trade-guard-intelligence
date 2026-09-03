export interface CurrencyRate {
  [currencyCode: string]: number; // Rate to 1 USD
}

export class PriceNormalizationService {
  // Baseline currency conversion rates to USD (1 USD = X foreign currency)
  private readonly fxRatesToUsd: Record<string, number> = {
    USD: 1.0,
    EUR: 0.92,
    GBP: 0.79,
    AED: 3.67,
    CNY: 7.23,
    JPY: 154.5,
    PKR: 278.5,
    INR: 83.4,
    CHF: 0.90,
    SGD: 1.35,
    SAR: 3.75,
  };

  /**
   * Convert declared unit price into normalized USD.
   */
  normalizeCurrencyToUsd(amount: number, currency: string): number {
    if (!amount || isNaN(amount) || amount <= 0) return 0;
    const curr = (currency || 'USD').toUpperCase().trim();
    const rate = this.fxRatesToUsd[curr] || 1.0;
    return Number((amount / rate).toFixed(2));
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
