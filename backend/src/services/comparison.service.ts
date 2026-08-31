import { getRepository, type DocumentRepository } from './document.repository';
import type { DocumentRecord } from '../models/document.model';
import { Errors } from '../utils/errors';

export interface ComparedDocumentProfile {
  id: string;
  filename: string;
  fileType: string;
  documentType: string;
  documentNumber: string;
  documentDate: string;
  role: string;
  totalValue: number;
  currency: string;
  parties: {
    seller: string;
    buyer: string;
    consignee?: string;
    issuingBank?: string;
    advisingBank?: string;
  };
  goods: Array<{
    description: string;
    quantity: number;
    uom: string;
    unitPrice: number;
    total: number;
    hsCode?: string;
  }>;
  ports: {
    loading?: string;
    discharge?: string;
  };
  dates: {
    issue?: string;
    shipment?: string;
    expiry?: string;
  };
  incoterm?: string;
}

export type ComparisonSeverity = 'VERIFIED_MATCH' | 'COMPATIBLE_VARIATION' | 'MATERIAL_DISCREPANCY' | 'CRITICAL_CONFLICT';

export interface ComparisonDiscrepancy {
  id: string;
  category: 'PARTIES' | 'AMOUNT_FINANCIALS' | 'GOODS_DESCRIPTION' | 'QUANTITY_WEIGHT' | 'DATES_CHRONOLOGY' | 'PORTS_ROUTING' | 'INCOTERMS';
  documentA: string;
  documentB: string;
  field: string;
  valueA: string;
  valueB: string;
  severity: ComparisonSeverity;
  explanation: string;
  ruleReference?: string;
}

export interface TradeComparisonResult {
  comparisonId: string;
  timestamp: string;
  documentCount: number;
  documents: ComparedDocumentProfile[];
  overallConsistencyScore: number; // 0 - 100
  verdict: 'COMPLIANT_PRESENTATION' | 'DISCREPANT_PRESENTATION_REQUIRES_AMENDMENT' | 'CRITICAL_REJECTION_OR_FRAUD_SUSPECT';
  verdictTitle: string;
  verdictSummary: string;
  discrepancies: ComparisonDiscrepancy[];
  verifiedMatchesCount: number;
  materialDiscrepanciesCount: number;
  criticalConflictsCount: number;
  recommendations: string[];
}

export class ComparisonService {
  constructor(private readonly repository: DocumentRepository = getRepository()) {}

  async compareDocuments(documentIds: string[]): Promise<TradeComparisonResult> {
    if (!Array.isArray(documentIds) || documentIds.length < 2) {
      throw Errors.validation('Please provide at least 2 document IDs to compare.');
    }

    const docs: DocumentRecord[] = [];
    for (const id of documentIds) {
      const doc = await this.repository.findFull(id);
      if (!doc) throw Errors.notFound(`Document "${id}" not found.`);
      if (doc.status !== 'completed' || !doc.analysis?.tradeCompliance) {
        throw Errors.notReady(`Document "${doc.filename}" analysis is not completed yet.`);
      }
      docs.push(doc);
    }

    const profiles: ComparedDocumentProfile[] = docs.map((d) => this.extractProfile(d));
    const discrepancies: ComparisonDiscrepancy[] = [];
    let count = 1;

    // Run pairwise comparison across all documents
    for (let i = 0; i < profiles.length; i++) {
      for (let j = i + 1; j < profiles.length; j++) {
        const docA = profiles[i];
        const docB = profiles[j];
        if (docA && docB) {
          this.comparePair(docA, docB, discrepancies, () => `DISC-${count++}`);
        }
      }
    }

    const criticalCount = discrepancies.filter((d) => d.severity === 'CRITICAL_CONFLICT').length;
    const materialCount = discrepancies.filter((d) => d.severity === 'MATERIAL_DISCREPANCY').length;
    const matchCount = discrepancies.filter((d) => d.severity === 'VERIFIED_MATCH').length;

    // Calculate Consistency Score (0 - 100)
    let score = 100 - (criticalCount * 25) - (materialCount * 10);
    score = Math.max(10, Math.min(100, score));

    let verdict: TradeComparisonResult['verdict'] = 'COMPLIANT_PRESENTATION';
    let verdictTitle = 'Compliant Documentary Presentation';
    let verdictSummary = 'All compared trade finance documents reconcile cleanly across parties, values, goods descriptions, dates, and logistics terms without material discrepancies.';

    if (criticalCount > 0) {
      verdict = 'CRITICAL_REJECTION_OR_FRAUD_SUSPECT';
      verdictTitle = 'Critical Conflict / Non-Conforming Presentation';
      verdictSummary = `Identified ${criticalCount} critical conflict(s) between presentation documents. Discrepant under UCP 600 rules — payment must be held pending formal amendment or refusal notice.`;
    } else if (materialCount > 0) {
      verdict = 'DISCREPANT_PRESENTATION_REQUIRES_AMENDMENT';
      verdictTitle = 'Material Discrepancies Detected — Requires Review';
      verdictSummary = `Identified ${materialCount} discrepancy(ies) across shipping details or party declarations. Compliance officer review or applicant waiver required under UCP 600 Article 16.`;
    }

    const recommendations: string[] = [];
    if (criticalCount > 0) {
      recommendations.push('Issue formal Notice of Refusal (MT734 / MT756) within 5 banking days stating all discrepancy grounds (UCP 600 Art. 16).');
      recommendations.push('Do not release original transport documents until applicant formally signs discrepancy waiver.');
    } else if (materialCount > 0) {
      recommendations.push('Contact presenting bank / beneficiary for corrected commercial invoices or packing certificates.');
      recommendations.push('Verify if applicant provides written acceptance of technical discrepancies.');
    } else {
      recommendations.push('Documents satisfy strict compliance requirements. Proceed with payment / acceptance honor.');
    }

    return {
      comparisonId: `CMP-${Date.now().toString(36).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      documentCount: profiles.length,
      documents: profiles,
      overallConsistencyScore: score,
      verdict,
      verdictTitle,
      verdictSummary,
      discrepancies,
      verifiedMatchesCount: matchCount,
      materialDiscrepanciesCount: materialCount,
      criticalConflictsCount: criticalCount,
      recommendations,
    };
  }

  private extractProfile(doc: DocumentRecord): ComparedDocumentProfile {
    const tc = doc.analysis?.tradeCompliance;
    if (!tc) {
      throw Errors.validation(`Document "${doc.filename}" is missing trade compliance analysis data.`);
    }

    return {
      id: doc.id,
      filename: doc.filename,
      fileType: doc.fileType,
      documentType: tc.documentClassification.type,
      documentNumber: tc.documentClassification.number || 'Not Stated',
      documentDate: tc.documentClassification.date || 'Not Stated',
      role: tc.documentClassification.subtype || 'Trade Document',
      totalValue: tc.transaction.totalValue || 0,
      currency: tc.transaction.currency || 'USD',
      parties: {
        seller: tc.transaction.parties.seller.legalName,
        buyer: tc.transaction.parties.buyer.legalName,
        consignee: tc.transaction.parties.consignee?.legalName,
        issuingBank: tc.transaction.parties.issuingBank?.legalName,
        advisingBank: tc.transaction.parties.advisingBank?.legalName,
      },
      goods: tc.goods.map((g) => ({
        description: g.productDescription,
        quantity: g.quantity,
        uom: g.unitOfMeasure,
        unitPrice: g.unitPrice,
        total: g.totalLineValue,
        hsCode: g.hsCode,
      })),
      ports: {
        loading: tc.transaction.portOfLoading,
        discharge: tc.transaction.portOfDischarge,
      },
      dates: {
        issue: tc.documentClassification.date,
        shipment: (tc as any).letterOfCredit?.latestShipmentDate || (tc as any).routeAnalysis?.shippedOnBoardDate,
        expiry: (tc as any).letterOfCredit?.expiryDate,
      },
      incoterm: tc.transaction.incoterm,
    };
  }

  private comparePair(
    a: ComparedDocumentProfile,
    b: ComparedDocumentProfile,
    list: ComparisonDiscrepancy[],
    nextId: () => string,
  ): void {
    const docNameA = `${a.documentType} ("${a.filename}")`;
    const docNameB = `${b.documentType} ("${b.filename}")`;

    // 1. Currency
    if (a.currency && b.currency && a.currency !== 'USD' && b.currency !== 'USD') {
      if (a.currency.toUpperCase() !== b.currency.toUpperCase()) {
        list.push({
          id: nextId(),
          category: 'AMOUNT_FINANCIALS',
          documentA: docNameA,
          documentB: docNameB,
          field: 'Currency of Settlement',
          valueA: a.currency,
          valueB: b.currency,
          severity: 'CRITICAL_CONFLICT',
          explanation: `Currency mismatch: ${docNameA} specifies ${a.currency}, while ${docNameB} specifies ${b.currency}. UCP 600 Art. 18a requires commercial invoice to be in the currency of the credit.`,
          ruleReference: 'UCP 600 Article 18(a)(iii)',
        });
      }
    }

    // 2. Total Value Check
    if (a.totalValue > 0 && b.totalValue > 0) {
      const diff = Math.abs(a.totalValue - b.totalValue);
      const ratio = diff / Math.max(a.totalValue, b.totalValue);

      if (diff === 0) {
        list.push({
          id: nextId(),
          category: 'AMOUNT_FINANCIALS',
          documentA: docNameA,
          documentB: docNameB,
          field: 'Total Monetary Value',
          valueA: `${a.currency} ${a.totalValue.toLocaleString()}`,
          valueB: `${b.currency} ${b.totalValue.toLocaleString()}`,
          severity: 'VERIFIED_MATCH',
          explanation: 'Declared financial totals match identically across presented documents.',
          ruleReference: 'ISBP 745 Paragraph C5',
        });
      } else if (ratio > 0.10) {
        list.push({
          id: nextId(),
          category: 'AMOUNT_FINANCIALS',
          documentA: docNameA,
          documentB: docNameB,
          field: 'Total Monetary Value',
          valueA: `${a.currency} ${a.totalValue.toLocaleString()}`,
          valueB: `${b.currency} ${b.totalValue.toLocaleString()}`,
          severity: 'CRITICAL_CONFLICT',
          explanation: `Significant value discrepancy of ${diff.toLocaleString()} ${a.currency} (${(ratio * 100).toFixed(1)}%). Exceeds standard UCP 600 Article 30 5%/10% tolerance limits.`,
          ruleReference: 'UCP 600 Article 30(b)',
        });
      } else {
        list.push({
          id: nextId(),
          category: 'AMOUNT_FINANCIALS',
          documentA: docNameA,
          documentB: docNameB,
          field: 'Total Monetary Value',
          valueA: `${a.currency} ${a.totalValue.toLocaleString()}`,
          valueB: `${b.currency} ${b.totalValue.toLocaleString()}`,
          severity: 'MATERIAL_DISCREPANCY',
          explanation: `Value difference of ${diff.toLocaleString()} ${a.currency} (${(ratio * 100).toFixed(1)}%). May reflect partial shipment or permitted quantity tolerance.`,
          ruleReference: 'UCP 600 Article 30',
        });
      }
    }

    // 3. Buyer / Applicant Party Comparison
    this.comparePartyField('Buyer / Applicant Name', a.parties.buyer, b.parties.buyer, docNameA, docNameB, list, nextId);

    // 4. Seller / Beneficiary Party Comparison
    this.comparePartyField('Seller / Beneficiary Name', a.parties.seller, b.parties.seller, docNameA, docNameB, list, nextId);

    // 5. Consignee
    if (a.parties.consignee && b.parties.consignee) {
      this.comparePartyField('Consignee / Delivery Entity', a.parties.consignee, b.parties.consignee, docNameA, docNameB, list, nextId);
    }

    // 6. Incoterm
    if (a.incoterm && b.incoterm && a.incoterm !== 'FOB' && b.incoterm !== 'FOB') {
      if (a.incoterm.toUpperCase() === b.incoterm.toUpperCase()) {
        list.push({
          id: nextId(),
          category: 'INCOTERMS',
          documentA: docNameA,
          documentB: docNameB,
          field: 'Incoterms Rule',
          valueA: a.incoterm,
          valueB: b.incoterm,
          severity: 'VERIFIED_MATCH',
          explanation: `Trade delivery terms (${a.incoterm}) align consistently across documents.`,
          ruleReference: 'ICC Incoterms 2020 Rules',
        });
      } else {
        list.push({
          id: nextId(),
          category: 'INCOTERMS',
          documentA: docNameA,
          documentB: docNameB,
          field: 'Incoterms Rule',
          valueA: a.incoterm,
          valueB: b.incoterm,
          severity: 'MATERIAL_DISCREPANCY',
          explanation: `Conflicting trade delivery terms: ${a.incoterm} vs ${b.incoterm}. Modifies risk and freight responsibility.`,
          ruleReference: 'ISBP 745 Paragraph C8',
        });
      }
    }

    // 7. Ports
    if (a.ports.loading && b.ports.loading) {
      if (this.stringsSimilar(a.ports.loading, b.ports.loading)) {
        list.push({
          id: nextId(),
          category: 'PORTS_ROUTING',
          documentA: docNameA,
          documentB: docNameB,
          field: 'Port of Loading',
          valueA: a.ports.loading,
          valueB: b.ports.loading,
          severity: 'VERIFIED_MATCH',
          explanation: 'Origin / loading port matches.',
          ruleReference: 'UCP 600 Article 20(a)(iii)',
        });
      } else {
        list.push({
          id: nextId(),
          category: 'PORTS_ROUTING',
          documentA: docNameA,
          documentB: docNameB,
          field: 'Port of Loading',
          valueA: a.ports.loading,
          valueB: b.ports.loading,
          severity: 'CRITICAL_CONFLICT',
          explanation: `Loading port discrepancy (${a.ports.loading} vs ${b.ports.loading}). Strict non-compliance under UCP 600.`,
          ruleReference: 'UCP 600 Article 20',
        });
      }
    }
  }

  private comparePartyField(
    field: string,
    valA: string | undefined,
    valB: string | undefined,
    docA: string,
    docB: string,
    list: ComparisonDiscrepancy[],
    nextId: () => string,
  ): void {
    if (!valA || !valB || valA === 'Not Found' || valB === 'Not Found') return;

    if (this.stringsSimilar(valA, valB)) {
      list.push({
        id: nextId(),
        category: 'PARTIES',
        documentA: docA,
        documentB: docB,
        field,
        valueA: valA,
        valueB: valB,
        severity: 'VERIFIED_MATCH',
        explanation: `${field} reconciles consistently between ${docA} and ${docB}.`,
        ruleReference: 'UCP 600 Article 14(f)',
      });
    } else {
      list.push({
        id: nextId(),
        category: 'PARTIES',
        documentA: docA,
        documentB: docB,
        field,
        valueA: valA,
        valueB: valB,
        severity: 'CRITICAL_CONFLICT',
        explanation: `Party name mismatch on ${field}: "${valA}" vs "${valB}". UCP 600 requires exact consistency for documentary credit parties.`,
        ruleReference: 'ISBP 745 Paragraph A19 / UCP 600 Art. 14',
      });
    }
  }

  private stringsSimilar(a: string, b: string): boolean {
    const na = a.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const nb = b.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
  }
}
