import crypto from 'node:crypto';
import { SanctionsEngine } from '../compliance/sanctions';
import { TemporalSanctionsService } from '../compliance/sanctions/temporal-sanctions.service';
import { JurisdictionalNexusService } from '../compliance/nexus/jurisdictional-nexus.service';
import { SbpRegulatoryService } from '../compliance/sbp/sbp-regulatory.service';
import { OwnershipGraphService } from '../compliance/ownership/ownership-graph.service';
import { RetrospectiveScreeningService } from '../compliance/retro/retrospective-screening.service';
import { SnapshotRegistry } from '../compliance/temporal/snapshot-registry';
import { GoodsScopeService } from '../compliance/goods-scope.service';
import { ExportControlService } from '../compliance/export-control.service';
import { TBMLService } from '../compliance/tbml.service';
import { MathIntegrityService } from '../compliance/math-integrity.service';
import { ReconciliationEngine } from '../compliance/reconciliation.service';
import { RiskScoringEngine } from '../compliance/risk-scoring.service';
import { AuditService } from '../compliance/audit.service';
import type {
  CommodityLineItem,
  DocumentClassificationInfo,
  DocumentDiscrepancy,
  EndUseAnalysisResult,
  LetterOfCreditProfile,
  RouteAnalysisResult,
  RouteNode,
  ScopeValidationResult,
  TradeComplianceAnalysis,
  TradeParties,
  TradeParty,
} from '../compliance/types';
import type { AuditEvidencePackage } from '../compliance/temporal/temporal.types';
import { createLogger } from '../utils/logger';

const log = createLogger('trade-extractor');

export class TradeComplianceExtractor {
  private readonly sanctionsEngine = new SanctionsEngine();
  private readonly temporalSanctionsService = new TemporalSanctionsService();
  private readonly jurisdictionalNexusService = new JurisdictionalNexusService();
  private readonly sbpRegulatoryService = new SbpRegulatoryService();
  private readonly ownershipGraphService = new OwnershipGraphService();
  private readonly retrospectiveScreeningService = RetrospectiveScreeningService.getInstance();
  private readonly snapshotRegistry = SnapshotRegistry.getInstance();
  private readonly goodsScopeService = new GoodsScopeService();
  private readonly exportControlService = new ExportControlService();
  private readonly tbmlService = new TBMLService();
  private readonly mathIntegrityService = new MathIntegrityService();
  private readonly reconciliationEngine = new ReconciliationEngine();
  private readonly riskScoringEngine = new RiskScoringEngine();
  private readonly auditService = new AuditService();

  async processTradeDocument(params: {
    documentId: string;
    filename: string;
    rawText: string;
    rawBuffer: Buffer;
    aiJsonOutput?: any;
    aiModel: string;
  }): Promise<TradeComplianceAnalysis> {
    log.info('Running trade compliance pipeline', { documentId: params.documentId, filename: params.filename });

    const data = params.aiJsonOutput || this.heuristicExtract(params.filename, params.rawText);

    // 1. Normalize Document Classification
    const docClass: DocumentClassificationInfo = {
      type: data.documentClassification?.type || this.detectDocumentType(params.filename, params.rawText),
      subtype: data.documentClassification?.subtype || 'Standard Trade Presentation',
      number: data.documentClassification?.number || this.extractPattern(params.rawText, /(?:invoice\s*(?:no|number|#)|inv\s*#|lc\s*(?:no|number)|bl\s*(?:no|number)|po\s*(?:no|number))[:\s]*([A-Z0-9\-\/]+)/i) || 'Not Found',
      date: data.documentClassification?.date || this.extractPattern(params.rawText, /(?:date|issue\s*date|dated)[:\s]*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})/i) || 'Not Found',
      issuingParty: data.documentClassification?.issuingParty || data.transaction?.seller?.legalName || 'Not Found',
      issuingCountry: data.documentClassification?.issuingCountry || data.transaction?.seller?.country || 'Not Found',
      transactionReference: data.documentClassification?.transactionReference || data.transaction?.transactionId || 'Not Found',
      relatedLcNumber: data.documentClassification?.relatedLcNumber || data.transaction?.letterOfCreditNumber || this.extractPattern(params.rawText, /(?:lc\s*(?:no|number|ref)|documentary\s*credit\s*no)[:\s]*([A-Z0-9\-\/]+)/i) || 'Not Found',
      relatedPoNumber: data.documentClassification?.relatedPoNumber || data.transaction?.purchaseOrderNumber || this.extractPattern(params.rawText, /(?:p\.?o\.?\s*(?:no|number|ref)|purchase\s*order\s*no)[:\s]*([A-Z0-9\-\/]+)/i) || 'Not Found',
      relatedContractNumber: data.documentClassification?.relatedContractNumber || data.transaction?.salesContractNumber || 'Not Found',
      confidence: data.documentClassification?.confidence || (params.aiJsonOutput ? 0.95 : 0.82),
    };

    // 2. Normalize Parties
    const rawParties = data.transaction || {};
    const parties: TradeParties = {
      seller: this.cleanParty(rawParties.seller, 'Seller / Exporter', this.extractPartyFromText(params.rawText, 'seller')),
      buyer: this.cleanParty(rawParties.buyer, 'Buyer / Importer', this.extractPartyFromText(params.rawText, 'buyer')),
      applicant: this.cleanParty(rawParties.applicant, 'Applicant'),
      beneficiary: this.cleanParty(rawParties.beneficiary, 'Beneficiary'),
      issuingBank: this.cleanParty(rawParties.issuingBank, 'Issuing Bank'),
      advisingBank: this.cleanParty(rawParties.advisingBank, 'Advising Bank'),
      shipper: this.cleanParty(rawParties.shipper, 'Shipper'),
      consignee: this.cleanParty(rawParties.consignee, 'Consignee'),
      notifyParty: this.cleanParty(rawParties.notifyParty, 'Notify Party'),
      ultimateConsignee: this.cleanParty(rawParties.ultimateConsignee, 'Ultimate Consignee'),
      endUser: this.cleanParty(rawParties.endUser, 'End User'),
      carrier: this.cleanParty(rawParties.carrier, 'Carrier'),
      freightForwarder: this.cleanParty(rawParties.freightForwarder, 'Freight Forwarder'),
      manufacturer: this.cleanParty(rawParties.manufacturer, 'Manufacturer'),
      supplier: this.cleanParty(rawParties.supplier, 'Supplier'),
    };

    // 3. Normalize Goods Line Items
    const rawGoods: any[] = Array.isArray(data.goods) && data.goods.length > 0 ? data.goods : this.extractGoodsFromText(params.rawText);
    const goods: CommodityLineItem[] = rawGoods.map((item, idx) => {
      const qty = Number(item.quantity) || 1;
      const unitP = Number(item.unitPrice) || 0;
      const totalV = Number(item.totalLineValue) || (qty * unitP) || 0;

      return {
        id: `LINE-${idx + 1}`,
        itemNumber: item.itemNumber || (idx + 1),
        productDescription: item.productDescription || 'General Merchandise',
        manufacturer: item.manufacturer || 'Not Found',
        brand: item.brand || 'Not Found',
        model: item.model || 'Not Found',
        partNumber: item.partNumber || 'Not Found',
        sku: item.sku || 'Not Found',
        productCategory: item.productCategory || this.guessCategory(item.productDescription || ''),
        quantity: qty,
        unitOfMeasure: item.unitOfMeasure || 'PCS',
        unitPrice: unitP,
        totalLineValue: totalV,
        currency: item.currency || rawParties.currency || 'USD',
        countryOfOrigin: item.countryOfOrigin || rawParties.originCountry || 'Not Found',
        hsCode: item.hsCode || this.extractHsCode(item.productDescription || '') || 'Not Specified',
        eccn: item.eccn || 'Not Specified',
        technicalSpecifications: item.technicalSpecifications || 'Standard commercial specifications',
        statedEndUse: item.statedEndUse || data.statedEndUse || 'Commercial Sale / Distribution',
        isAuthorizedScope: true,
        isControlledOrDualUse: false,
        riskSeverity: 'LOW',
      };
    });

    // 4. Totals & Incoterms
    const totalVal = Number(rawParties.totalValue) || goods.reduce((s, g) => s + g.totalLineValue, 0) || 0;
    const subtotal = Number(rawParties.subtotal) || goods.reduce((s, g) => s + (g.quantity * g.unitPrice), 0) || totalVal;
    const currency = rawParties.currency || (goods[0]?.currency) || 'USD';
    const incoterm = rawParties.incoterm || this.extractIncoterm(params.rawText) || 'FOB';

    // 5. Derive Transaction Timestamp (Normalized to UTC)
    let transactionTimestamp = new Date().toISOString();
    if (docClass.date && docClass.date !== 'Not Found') {
      try {
        const parsedDate = new Date(docClass.date);
        if (!isNaN(parsedDate.getTime())) {
          transactionTimestamp = parsedDate.toISOString();
        }
      } catch {
        // Fallback to current UTC
      }
    }

    // 6. Multi-Jurisdiction Baseline Sanctions Screening
    const sanctionsResult = await this.sanctionsEngine.screenTransaction({
      parties,
      vesselName: rawParties.vesselName,
      vesselImo: rawParties.vesselImo,
      originCountry: rawParties.originCountry,
      destinationCountry: rawParties.destinationCountry,
      transitCountries: rawParties.transitCountries,
      portOfLoading: rawParties.portOfLoading,
      portOfDischarge: rawParties.portOfDischarge,
    });

    // 7. Point-in-Time Temporal Sanctions Screening
    const temporalScreening = this.temporalSanctionsService.screenTransactionPointInTime({
      parties,
      transactionTimestamp,
      vesselName: rawParties.vesselName,
      vesselImo: rawParties.vesselImo,
    });

    // 8. Jurisdictional Nexus Assessment (US, UN, EU, UK, PK)
    const jurisdictionalNexus = this.jurisdictionalNexusService.evaluateJurisdictionalNexus({
      bankDomicile: rawParties.issuingBank?.bankCountry || 'PK',
      parties,
      currency,
      paymentRoute: rawParties.paymentTerms,
      originCountry: rawParties.originCountry,
      destinationCountry: rawParties.destinationCountry,
      transitCountries: rawParties.transitCountries,
    });

    // 9. Beneficial Ownership & Control Rules (OFAC 50% Rule / EU & UK Control)
    const sellerName = parties.seller?.legalName || 'Not Found';
    const ownershipCompliance = this.ownershipGraphService.evaluateOwnership(sellerName, transactionTimestamp);

    // 10. Scope of Trade & Customer Business Validation
    const declaredScope = data.declaredAuthorizedScope || data.declaredCustomerBusiness || parties.buyer?.tradingName || 'Standard Commercial Trade';
    const scopeResult: ScopeValidationResult = this.goodsScopeService.validateScope({
      goods,
      declaredScope,
      relatedPoNumber: docClass.relatedPoNumber,
      relatedLcNumber: docClass.relatedLcNumber,
      customerDeclaredBusiness: data.declaredCustomerBusiness,
    });

    // 11. Export Controls & Dual-Use Detection
    const exportControlsResult = this.exportControlService.analyzeGoods(goods, rawParties.destinationCountry);

    // 12. End-Use & End-User Consistency
    const statedEndUse = data.statedEndUse || 'Commercial retail/wholesale';
    const customerBiz = data.declaredCustomerBusiness || parties.buyer?.tradingName || 'General Merchandising';
    const endUseMismatch = scopeResult.hasOutOfScopeGoods;
    const endUseResult: EndUseAnalysisResult = {
      statedEndUse,
      declaredCustomerBusiness: customerBiz,
      isIndustryConsistent: !endUseMismatch,
      makesCommercialSense: !endUseMismatch && !exportControlsResult.controlledGoods.some((g) => g.riskSeverity === 'CRITICAL'),
      explanation: endUseMismatch
        ? `Goods such as "${scopeResult.outOfScopeGoods.map((g) => g.productDescription).join(', ')}" do not align with declared business profile ("${customerBiz}").`
        : 'Declared end-use and commodity profile are commercially aligned.',
      redFlags: endUseMismatch ? ['Product category inconsistent with customer declared core business.'] : [],
      riskSeverity: endUseMismatch ? 'HIGH' : 'LOW',
    };

    // 13. Cross-Document Discrepancies & Letter of Credit Checks
    const discrepancies: DocumentDiscrepancy[] = this.reconciliationEngine.reconcileDocuments({
      invoice: {
        number: docClass.number,
        seller: parties.seller?.legalName,
        buyer: parties.buyer?.legalName,
        consignee: parties.consignee?.legalName,
        origin: rawParties.originCountry,
        destination: rawParties.destinationCountry,
        totalQuantity: goods.reduce((s, g) => s + g.quantity, 0),
        totalAmount: totalVal,
        currency,
      },
      billOfLading: {
        shipper: parties.shipper?.legalName || parties.seller?.legalName,
        consignee: parties.consignee?.legalName,
        portOfLoading: rawParties.portOfLoading,
        portOfDischarge: rawParties.portOfDischarge,
        vesselName: rawParties.vesselName,
      },
      letterOfCredit: data.letterOfCreditProfile ? {
        lcNumber: data.letterOfCreditProfile.lcNumber || docClass.relatedLcNumber,
        amount: data.letterOfCreditProfile.amount,
        currency: data.letterOfCreditProfile.currency,
        portOfLoading: data.letterOfCreditProfile.portOfLoading,
      } : undefined,
    });

    // 14. TBML Analysis (FATF & SBP Indicators)
    const tbmlResult = this.tbmlService.analyzeTBML({
      goods,
      parties,
      originCountry: rawParties.originCountry,
      destinationCountry: rawParties.destinationCountry,
      transitCountries: rawParties.transitCountries,
      totalValue: totalVal,
      currency,
      paymentTerms: rawParties.paymentTerms,
      hasOutOfScopeGoods: scopeResult.hasOutOfScopeGoods,
      hasDiscrepancies: discrepancies.length > 0,
      customerDeclaredBusiness: data.declaredCustomerBusiness,
    });

    // 15. State Bank of Pakistan (SBP) Framework Assessment
    const sbpCompliance = this.sbpRegulatoryService.evaluateSbpCompliance({
      parties,
      goods,
      currency,
      totalAmount: totalVal,
      paymentTerms: rawParties.paymentTerms,
      hasTfsHit: temporalScreening.wasListedAtTransactionTime || sanctionsResult.status === 'CONFIRMED_MATCH',
      hasTbmlFlags: tbmlResult.redFlags.length > 0,
      hasOutOfScopeGoods: scopeResult.hasOutOfScopeGoods,
      hasDiscrepancies: discrepancies.length > 0,
    });

    // 16. Retrospective Exposure Alerts (Post-Transaction Monitoring)
    const postTransactionMatches = temporalScreening.temporalMatches
      .filter((m) => m.temporalStatus === 'ADDED_AFTER_TRANSACTION')
      .map((m) => ({
        matchedName: m.matchedName,
        role: m.partyRole,
        sanctionsList: m.sanctionsList,
        designationDate: m.designationDate,
        effectiveDate: m.effectiveDate,
      }));

    const transactionId = docClass.number !== 'Not Found' ? docClass.number : `TXN-${params.documentId.slice(0, 8).toUpperCase()}`;
    const retrospectiveAlerts = this.retrospectiveScreeningService.evaluateRetrospectiveExposure({
      transactionId,
      tradeReference: docClass.transactionReference || transactionId,
      transactionTimestamp,
      parties: Object.entries(parties)
        .filter(([_, p]) => p?.legalName && p.legalName !== 'Not Found')
        .map(([role, p]) => ({ name: p!.legalName, role })),
      postTransactionMatches,
    });

    // 17. Mathematical Validation & Document Integrity
    const mathResult = this.mathIntegrityService.validateMath({
      goods,
      declaredSubtotal: subtotal,
      declaredTotal: totalVal,
      freightCharges: Number(rawParties.freightCharges) || 0,
      insuranceCharges: Number(rawParties.insuranceCharges) || 0,
      currency,
    });

    const docIntegrityResult = this.mathIntegrityService.checkDocumentIntegrity({
      rawText: params.rawText,
      hasMathErrors: !mathResult.isMathematicallySound,
      chronologyValid: true,
    });

    // 18. Geographic Route Analysis
    const routeNodes: RouteNode[] = [];
    if (rawParties.originCountry && rawParties.originCountry !== 'Not Found') {
      routeNodes.push({ nodeType: 'ORIGIN', locationName: rawParties.originCountry, country: rawParties.originCountry, riskScore: 10, sanctionsConcern: false });
    }
    if (rawParties.portOfLoading && rawParties.portOfLoading !== 'Not Found') {
      routeNodes.push({ nodeType: 'PORT_OF_LOADING', locationName: rawParties.portOfLoading, country: rawParties.originCountry || 'Port Country', riskScore: 10, sanctionsConcern: false });
    }
    if (rawParties.transitCountries && Array.isArray(rawParties.transitCountries)) {
      for (const tc of rawParties.transitCountries) {
        routeNodes.push({ nodeType: 'TRANSIT_PORT', locationName: tc, country: tc, riskScore: 25, sanctionsConcern: false });
      }
    }
    if (rawParties.portOfDischarge && rawParties.portOfDischarge !== 'Not Found') {
      routeNodes.push({ nodeType: 'PORT_OF_DISCHARGE', locationName: rawParties.portOfDischarge, country: rawParties.destinationCountry || 'Port Country', riskScore: 10, sanctionsConcern: false });
    }
    if (rawParties.destinationCountry && rawParties.destinationCountry !== 'Not Found') {
      routeNodes.push({ nodeType: 'FINAL_DESTINATION', locationName: rawParties.destinationCountry, country: rawParties.destinationCountry, riskScore: 10, sanctionsConcern: false });
    }

    const routeAnalysis: RouteAnalysisResult = {
      nodes: routeNodes,
      hasUnusualTransshipment: (rawParties.transitCountries?.length || 0) > 1,
      hasCircularRouting: false,
      overallRouteRiskScore: sanctionsResult.jurisdictionRisks.length > 0 ? Math.max(...sanctionsResult.jurisdictionRisks.map((j) => j.riskScore)) : 10,
      routeSummary: `${rawParties.originCountry || 'Origin'} -> ${rawParties.destinationCountry || 'Destination'} (via ${rawParties.transitCountries?.join(', ') || 'Direct routing'})`,
    };

    // 19. Risk Scoring & Deterministic Compliance Decisioning
    const { riskScores, decision } = this.riskScoringEngine.calculateScoresAndDecision({
      sanctions: sanctionsResult,
      temporal: temporalScreening,
      ownership: ownershipCompliance,
      sbpCompliance,
      jurisdictionalNexus,
      scopeValidation: scopeResult,
      exportControls: exportControlsResult,
      endUse: endUseResult,
      tbml: tbmlResult,
      mathValidation: mathResult,
      documentIntegrity: docIntegrityResult,
      discrepancies,
      route: routeAnalysis,
      hasMissingEndUser: !parties.endUser || parties.endUser.legalName === 'Not Found' || parties.endUser.legalName === 'Not Disclosed',
    });

    // 20. Cryptographic Evidence Package
    const docSha256 = crypto.createHash('sha256').update(params.rawBuffer).digest('hex');
    const txnSummaryStr = `${transactionId}:${transactionTimestamp}:${currency}:${totalVal}:${parties.seller?.legalName}:${parties.buyer?.legalName}`;
    const txnHashSha256 = crypto.createHash('sha256').update(txnSummaryStr).digest('hex');

    const sourcesUsed = this.snapshotRegistry.listSources().map((s) => ({
      sourceId: s.sourceId,
      version: s.currentVersion,
      checksumSha256: s.checksumSha256,
      effectiveAt: s.effectiveAt,
    }));

    const auditEvidencePackage: AuditEvidencePackage = {
      evidencePackageId: `TG-AUD-${Date.now()}-${params.documentId.slice(0, 6).toUpperCase()}`,
      transactionId,
      tradeReference: docClass.transactionReference !== 'Not Found' ? docClass.transactionReference : transactionId,
      transactionTimestamp,
      generatedAt: new Date().toISOString(),
      documentSha256: docSha256,
      transactionHashSha256: txnHashSha256,
      regulatorySnapshotsUsed: sourcesUsed,
      ruleSetVersion: 'TG-COMPLIANCE-RULES-V2026.3',
      scoringModelVersion: this.riskScoringEngine.riskModelVersion,
      aiPromptVersion: 'TRADE-EXTRACTOR-PROMPT-V2.1',
      verificationDigestSha256: crypto.createHash('sha256').update(`${docSha256}:${txnHashSha256}:${decision.decision}:${riskScores.overall}`).digest('hex'),
      examinerSeal: {
        status: decision.decision as any,
        certifiedAt: new Date().toISOString(),
        examinerName: 'TradeGuard Automated Examination System',
        examinerRole: 'Senior Compliance Audit Engine',
      },
      limitations: [
        'Sanctions screening performed against authoritative snapshots active at transaction timestamp.',
        'Beneficial ownership calculations based on corporate registry filings available at transaction date.',
        'Supplementary news and open-source intelligence treated as risk indicators, not independent legal prohibitions.',
      ],
    };

    // 21. Audit Trail Record
    const auditTrail = this.auditService.createInitialAuditRecord({
      documentId: params.documentId,
      rawBuffer: params.rawBuffer,
      aiModel: params.aiModel,
      sanctionsDatasetVersion: sanctionsResult.datasetVersion,
      extractedFieldsCount: 28 + goods.length * 6,
      rulesTriggered: decision.triggeredRules,
      riskScores,
      initialDecision: decision.decision,
    });

    return {
      documentClassification: docClass,
      transaction: {
        transactionId,
        invoiceNumber: docClass.number,
        invoiceDate: docClass.date,
        proformaInvoiceNumber: 'Not Found',
        purchaseOrderNumber: docClass.relatedPoNumber,
        salesContractNumber: docClass.relatedContractNumber,
        letterOfCreditNumber: docClass.relatedLcNumber,
        amendmentNumber: 'Not Found',
        customerReference: parties.buyer?.registrationNumber || 'Not Found',
        shipmentReference: rawParties.shipmentReference || 'Not Found',
        bookingReference: rawParties.bookingReference || 'Not Found',
        customsReference: rawParties.customsReference || 'Not Found',
        insuranceReference: rawParties.insuranceReference || 'Not Found',
        parties,
        originCountry: rawParties.originCountry || 'Not Found',
        destinationCountry: rawParties.destinationCountry || 'Not Found',
        transitCountries: rawParties.transitCountries || [],
        portOfLoading: rawParties.portOfLoading,
        portOfDischarge: rawParties.portOfDischarge,
        currency,
        totalValue: totalVal,
        subtotal,
        freightCharges: Number(rawParties.freightCharges) || 0,
        insuranceCharges: Number(rawParties.insuranceCharges) || 0,
        paymentTerms: rawParties.paymentTerms || 'Standard Trade Credit',
        incoterm,
        transactionTimestamp,
      },
      goods,
      scopeValidation: scopeResult,
      endUseAnalysis: endUseResult,
      sanctions: sanctionsResult,
      temporalScreening,
      jurisdictionalNexus,
      sbpCompliance,
      ownershipCompliance,
      retrospectiveAlerts,
      auditEvidencePackage,
      exportControls: exportControlsResult,
      evasionIndicators: [],
      tbml: tbmlResult,
      discrepancies,
      mathematicalValidation: mathResult,
      documentIntegrity: docIntegrityResult,
      letterOfCredit: data.letterOfCreditProfile,
      routeAnalysis,
      riskScores,
      decision,
      auditTrail,
    };
  }

  private cleanParty(raw: any, defaultRole: string, textFallback?: Partial<TradeParty>): TradeParty {
    if (!raw && !textFallback) {
      return { role: defaultRole, legalName: 'Not Found', country: 'Not Found', address: 'Not Found' };
    }
    const p = raw || textFallback || {};
    return {
      role: p.role || defaultRole,
      legalName: p.legalName && p.legalName !== 'Not Found' ? p.legalName : (textFallback?.legalName || 'Not Found'),
      tradingName: p.tradingName || p.legalName,
      address: p.address || textFallback?.address || 'Not Found',
      country: p.country || textFallback?.country || 'Not Found',
      registrationNumber: p.registrationNumber || 'Not Found',
      taxVatNumber: p.taxVatNumber || 'Not Found',
      website: p.website || 'Not Found',
      contactDetails: p.contactDetails || 'Not Found',
      bank: p.bank || textFallback?.bank || 'Not Found',
      bankCountry: p.bankCountry || 'Not Found',
      ibanOrAccountNumber: p.ibanOrAccountNumber || 'Not Found',
      swiftBic: p.swiftBic || 'Not Found',
    };
  }

  private detectDocumentType(filename: string, text: string): string {
    const fn = filename.toLowerCase();
    const t = text.toLowerCase();

    if (fn.includes('lc') || fn.includes('credit') || t.includes('documentary credit') || t.includes('letter of credit') || t.includes('form of doc credit')) {
      return 'Letter of Credit / Documentary Credit';
    }
    if (fn.includes('bl') || fn.includes('lading') || t.includes('bill of lading') || t.includes('ocean bill of lading')) {
      return 'Bill of Lading';
    }
    if (fn.includes('invoice') || t.includes('commercial invoice') || t.includes('invoice no')) {
      return 'Commercial Invoice';
    }
    if (fn.includes('packing') || t.includes('packing list')) {
      return 'Packing List';
    }
    if (fn.includes('origin') || t.includes('certificate of origin')) {
      return 'Certificate of Origin';
    }
    if (fn.includes('po') || fn.includes('purchase') || t.includes('purchase order')) {
      return 'Purchase Order';
    }
    return 'Trade Document / Commercial Presentation';
  }

  private extractPartyFromText(text: string, partyType: 'seller' | 'buyer'): Partial<TradeParty> {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const current = lines[i];
      if (!current) continue;
      const line = current.toLowerCase();
      if (partyType === 'seller' && (line.includes('beneficiary') || line.includes('exporter') || line.includes('seller') || line.includes('shipper:'))) {
        const name = lines[i + 1] || 'Not Found';
        return { legalName: name.replace(/^[0-9\.\-\:\s]+/, '') };
      }
      if (partyType === 'buyer' && (line.includes('applicant') || line.includes('importer') || line.includes('buyer') || line.includes('consignee:'))) {
        const name = lines[i + 1] || 'Not Found';
        return { legalName: name.replace(/^[0-9\.\-\:\s]+/, '') };
      }
    }
    return {};
  }

  private extractGoodsFromText(text: string): any[] {
    const items: any[] = [];
    const lines = text.split('\n');

    // Look for lines with quantities and monetary amounts
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const match = line.match(/([0-9]+(?:\.[0-9]+)?)\s*(pcs|units|kgs|sets|pairs|boxes)?\s*[\@x]\s*(?:usd|eur|gbp|\$)?\s*([0-9]+(?:\.[0-9]+)?)/i);
      if (match && match[1] && match[3]) {
        const qty = parseFloat(match[1]);
        const price = parseFloat(match[3]);
        items.push({
          itemNumber: items.length + 1,
          productDescription: line.slice(0, 50).trim(),
          quantity: qty,
          unitOfMeasure: match[2] || 'PCS',
          unitPrice: price,
          totalLineValue: qty * price,
          currency: 'USD',
        });
      }
    }

    return items;
  }

  private extractPattern(text: string, regex: RegExp): string | null {
    const match = text.match(regex);
    return match && match[1] ? match[1].trim() : null;
  }

  private extractIncoterm(text: string): string | null {
    const match = text.match(/\b(FOB|CIF|CFR|EXW|FCA|CPT|CIP|DAP|DPU|DDP|FAS)\b/i);
    return match && match[1] ? match[1].toUpperCase() : null;
  }

  private extractHsCode(desc: string): string | null {
    const match = desc.match(/\b([0-9]{4}(?:\.[0-9]{2}(?:\.[0-9]{2})?)?)\b/);
    return match && match[1] ? match[1] : null;
  }

  private guessCategory(desc: string): string {
    const d = desc.toLowerCase();
    if (d.includes('shirt') || d.includes('cotton') || d.includes('garment') || d.includes('fabric')) return 'Textiles & Apparel';
    if (d.includes('shoe') || d.includes('footwear')) return 'Footwear & Leather';
    if (d.includes('laser') || d.includes('optic')) return 'Precision Industrial Optics';
    if (d.includes('machinery') || d.includes('pump') || d.includes('valve')) return 'Industrial Machinery';
    if (d.includes('electronic') || d.includes('chip') || d.includes('semiconductor')) return 'Electronics';
    return 'General Merchandise';
  }

  private heuristicExtract(filename: string, text: string): any {
    return {
      documentClassification: {
        type: this.detectDocumentType(filename, text),
        subtype: 'Standard Commercial Presentation',
        number: this.extractPattern(text, /(?:invoice\s*no|lc\s*no|doc\s*no)[:\s]*([A-Z0-9\-]+)/i) || 'Not Found',
        date: this.extractPattern(text, /(?:date|dated)[:\s]*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})/i) || 'Not Found',
        confidence: 0.85,
      },
      transaction: {
        seller: { legalName: this.extractPattern(text, /(?:beneficiary|seller|exporter)[:\s]*([^\n\r]+)/i) || 'Not Found' },
        buyer: { legalName: this.extractPattern(text, /(?:applicant|buyer|importer)[:\s]*([^\n\r]+)/i) || 'Not Found' },
        currency: 'USD',
        totalValue: 0,
        incoterm: this.extractIncoterm(text) || 'FOB',
      },
      goods: this.extractGoodsFromText(text),
    };
  }
}
