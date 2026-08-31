import type {
  CommodityLineItem,
  DocumentIntegrityResult,
  MathematicalValidationResult,
  RiskSeverity,
} from './types';

export class MathIntegrityService {
  validateMath(params: {
    goods: CommodityLineItem[];
    declaredSubtotal: number;
    declaredTotal: number;
    freightCharges?: number;
    insuranceCharges?: number;
    taxesOrOtherCharges?: number;
    currency: string;
  }): MathematicalValidationResult {
    let calculatedSubtotal = 0;
    const discrepancies: MathematicalValidationResult['discrepancies'] = [];
    const integrityNotes: string[] = [];

    // 1. Verify Line Items: Quantity * UnitPrice == TotalLineValue
    for (const item of params.goods) {
      const expectedLineTotal = Math.round(item.quantity * item.unitPrice * 100) / 100;
      const actualLineTotal = Math.round(item.totalLineValue * 100) / 100;
      calculatedSubtotal += expectedLineTotal;

      const diff = Math.abs(expectedLineTotal - actualLineTotal);
      if (diff > 0.05) {
        discrepancies.push({
          lineNumber: item.itemNumber,
          description: `Line ${item.itemNumber} (${item.productDescription}): Quantity (${item.quantity}) × Unit Price (${item.unitPrice}) = ${expectedLineTotal}, but invoice declares ${actualLineTotal}.`,
          expectedValue: expectedLineTotal,
          actualValue: actualLineTotal,
          difference: diff,
          severity: diff > 100 ? 'HIGH' : 'ELEVATED',
        });
      }
    }

    calculatedSubtotal = Math.round(calculatedSubtotal * 100) / 100;
    const freight = params.freightCharges || 0;
    const insurance = params.insuranceCharges || 0;
    const taxes = params.taxesOrOtherCharges || 0;
    const calculatedTotal = Math.round((calculatedSubtotal + freight + insurance + taxes) * 100) / 100;

    // 2. Check Subtotal Match
    if (params.declaredSubtotal > 0) {
      const subtotalDiff = Math.abs(calculatedSubtotal - params.declaredSubtotal);
      if (subtotalDiff > 0.5) {
        discrepancies.push({
          description: `Sum of line items (${calculatedSubtotal}) differs from declared subtotal (${params.declaredSubtotal}).`,
          expectedValue: calculatedSubtotal,
          actualValue: params.declaredSubtotal,
          difference: subtotalDiff,
          severity: 'HIGH',
        });
      }
    }

    // 3. Check Grand Total Match
    if (params.declaredTotal > 0) {
      const totalDiff = Math.abs(calculatedTotal - params.declaredTotal);
      if (totalDiff > 0.5) {
        discrepancies.push({
          description: `Calculated grand total (${calculatedTotal} ${params.currency}) differs from stated document total (${params.declaredTotal} ${params.currency}).`,
          expectedValue: calculatedTotal,
          actualValue: params.declaredTotal,
          difference: totalDiff,
          severity: totalDiff > 500 ? 'HIGH' : 'ELEVATED',
        });
      }
    }

    const isMathematicallySound = discrepancies.length === 0;
    if (isMathematicallySound) {
      integrityNotes.push('All line calculations, subtotal summations, and grand totals are mathematically verified and sound.');
    } else {
      integrityNotes.push(`Identified ${discrepancies.length} arithmetic calculation discrepancy(ies) requiring verification.`);
    }

    return {
      isMathematicallySound,
      calculatedSubtotal: calculatedSubtotal || params.declaredSubtotal,
      declaredSubtotal: params.declaredSubtotal,
      calculatedTotal: calculatedTotal || params.declaredTotal,
      declaredTotal: params.declaredTotal,
      currency: params.currency,
      discrepancies,
      integrityNotes,
    };
  }

  checkDocumentIntegrity(params: {
    rawText: string;
    hasMathErrors: boolean;
    hasDuplicateNumbers?: boolean;
    chronologyValid: boolean;
    chronologyNote?: string;
  }): DocumentIntegrityResult {
    const issues: DocumentIntegrityResult['issues'] = [];
    let riskScore = 5;

    if (params.hasMathErrors) {
      issues.push({
        type: 'ARITHMETIC_MISMATCH',
        description: 'Document contains mathematical miscalculations in line item totals or subtotal summations.',
        evidence: 'Arithmetic validation failed between unit price × quantity and declared line totals.',
        severity: 'HIGH',
      });
      riskScore += 30;
    }

    if (!params.chronologyValid) {
      issues.push({
        type: 'CHRONOLOGY_ANOMALY',
        description: params.chronologyNote || 'Document dates present an impossible chronological sequence.',
        evidence: params.chronologyNote || 'Inconsistent document issue and shipment dates.',
        severity: 'HIGH',
      });
      riskScore += 25;
    }

    if (params.hasDuplicateNumbers) {
      issues.push({
        type: 'DUPLICATE_NUMBERING',
        description: 'Duplicate document or tracking numbers detected across different transaction references.',
        evidence: 'Colliding document numbering sequence.',
        severity: 'ELEVATED',
      });
      riskScore += 20;
    }

    riskScore = Math.min(100, riskScore);
    const riskLevel: RiskSeverity =
      riskScore >= 70 ? 'CRITICAL' :
      riskScore >= 50 ? 'HIGH' :
      riskScore >= 30 ? 'ELEVATED' :
      riskScore >= 15 ? 'MODERATE' : 'LOW';

    return {
      riskScore,
      riskLevel,
      issues,
    };
  }
}
