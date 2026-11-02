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
import { PricingIntelligenceService } from '../compliance/pricing/pricing-intelligence.service';
import { ProductRegulatoryService } from '../compliance/regulatory/product-regulatory.service';
import { EntityResolutionService } from '../compliance/behavioral/entity-resolution.service';
import { CustomerBehaviorService } from '../compliance/behavioral/customer-behavior.service';
import { CustomerRepository } from '../services/customer.repository';
import { MaritimeService } from '../compliance/maritime';
import { FraudEngineService, IdentifierNormalizer } from '../compliance/fraud';
import type {
  CommodityLineItem,
  DocumentClassificationInfo,
  DocumentDiscrepancy,
  EndUseAnalysisResult,
  RouteAnalysisResult,
  RouteNode,
  SanctionsScreeningResult,
  ScopeValidationResult,
  TradeComplianceAnalysis,
  TradeParties,
  TradeParty,
} from '../compliance/types';
import type { AuditEvidencePackage } from '../compliance/temporal/temporal.types';
import { createLogger } from '../utils/logger';
import { parseTradeDate } from '../utils/trade-date';
import type { Loose } from '../utils/loose-json';

const log = createLogger('trade-extractor');

/**
 * Lookahead for the start of the next known field label. A generic "Some Words:" pattern would cut
 * "Seller: Karachi Industrial Supplies Ltd Buyer: …" after "Karachi", so only real labels count.
 */
const FIELD_LABELS = [
  'invoice\\s*(?:no|number|#)', 'date', 'seller', 'buyer', 'exporter', 'importer', 'applicant', 'beneficiary',
  'consignee', 'shipper', 'notify\\s*party', 'country\\s*of\\s*origin', 'country\\s*of\\s*destination', 'origin',
  'destination', 'port\\s*of\\s*loading', 'port\\s*of\\s*discharge', 'total(?:\\s*(?:invoice\\s*)?(?:amount|value))?',
  'payment\\s*terms?', 'incoterms?', 'vessel(?:\\s*name)?', 'b\\/?l\\s*(?:no|number)', 'l\\/?c\\s*(?:no|number)',
  'currency', 'hs\\s*code', 'description', 'address', 'tel', 'phone', 'email',
  'carrier(?:\\s*\\/\\s*b\\/?l)?', 'financial\\s*instrument', '(?:sales\\s*)?contract\\s*(?:no|ref)', 'port\\s*of\\s*shipment',
  'place\\s*of\\s*delivery', 'discharge\\s*port', 'customs\\s*office',
];
const NEXT_FIELD_LOOKAHEAD = `\\s+(?:${FIELD_LABELS.join('|')})\\s*:`;
/** End of a field value: next label, line break or end of text. */
const NEXT_FIELD = `(?=${NEXT_FIELD_LOOKAHEAD}|[\\r\\n]|$)`;
/** A value that is itself just the next label ("BUYER: CONTRACT REF: …" in a two-column layout). */
const STARTS_WITH_LABEL = new RegExp(`^(?:${FIELD_LABELS.join('|')})\\s*:`, 'i');

/** Units a quantity is stated in. A number followed by one of these is a quantity, never money. */
const QUANTITY_UNIT = '(?:KGS?|MTS?|TONS?|LBS?|PCS|PIECES|SETS?|CARTONS?|CTNS?|UNITS?|PAIRS?|BOXES|BAGS|ROLLS|MTRS?|METERS?|YDS?|DOZ(?:EN)?|NOS|CBM|LTRS?|LITRES?)';
const NUMBER = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
/**
 * A money amount: needs a currency marker, so "7,245.66 KG" next to "USD $30,412.66" is not misread.
 * Groups: `cur` (absent for a bare "$"), `num`, and `per` when it is a rate ("$4.8578/KG").
 */
const MONEY = new RegExp(
  `(?:\\b(?<cur>USD|US\\$|EUR|GBP|AED|PKR|CNY)\\s*\\$?|\\$)\\s*(?<num>\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)(?<per>\\s*\\/\\s*[A-Z]{1,6}\\b)?`,
  'gi',
);

interface MoneyAmount {
  currency: string;
  value: number;
  perUnit: boolean;
}

function moneyAmounts(text: string): MoneyAmount[] {
  return [...text.matchAll(MONEY)].map((m) => ({
    currency: (m.groups?.['cur'] ?? 'USD').toUpperCase().replace('US$', 'USD'),
    value: parseAmount(m.groups?.['num'] ?? '0'),
    perUnit: Boolean(m.groups?.['per']),
  }));
}
const HS_CODE = /\b(\d{4}\.\d{2}(?:\.?\d{2,4})?)\b/;
/** Company-name endings, used to split two names that a two-column layout put on one line. */
const COMPANY = /(?:M\/S\.?\s+)?[A-Z0-9][A-Z0-9&.,'\- ]*?\b(?:LIMITED|LTD\.?|INC\.?|LLC|PLC|CORP(?:ORATION)?|COMPANY|GMBH|PVT\.?(?:\s+LTD\.?)?)(?=\s|$|,)/g;

/** Document types by the phrases that title them, most specific first. */
const DOCUMENT_TYPES: ReadonlyArray<readonly [string, RegExp]> = [
  ['Customs Goods Declaration', /goods\s+declaration|bill\s+of\s+(?:export|entry)/i],
  ['Air Waybill', /air\s*waybill/i],
  ['Bill of Lading', /sea\s*waybill|bill\s+of\s+lading|\bwaybill\b/i],
  ['Letter of Credit / Documentary Credit', /documentary\s+credit|letter\s+of\s+credit|form\s+of\s+doc(?:umentary)?\s+credit/i],
  ['Sales Contract', /sales\s+contract|purchase\s+confirmation|contract\s+of\s+sale/i],
  ['Commercial Invoice', /commercial\s+invoice|proforma\s+invoice|tax\s+invoice/i],
  ['Packing List', /packing\s+list/i],
  ['Certificate of Origin', /certificate\s+of\s+origin/i],
  ['Purchase Order', /purchase\s+order/i],
];

/** The label that introduces each document type's own number. */
const DOCUMENT_NUMBER_LABELS: Record<string, string> = {
  'Commercial Invoice': 'invoice\\s*(?:no|number|#)',
  'Bill of Lading': '(?:sea\\s*)?(?:waybill|b\\/l|bill\\s*of\\s*lading)\\s*(?:no|number|#)',
  'Air Waybill': '(?:air\\s*waybill|awb)\\s*(?:no|number|#)',
  'Letter of Credit / Documentary Credit': '(?:documentary\\s*credit|credit|l\\/?c)\\s*(?:no|number|#)',
  'Sales Contract': 'contract\\s*(?:no|number|ref|#)',
  'Customs Goods Declaration': '(?:machine|gd|goods\\s*declaration)\\s*(?:no|number|#)',
  'Purchase Order': '(?:p\\.?o\\.?|purchase\\s*order)\\s*(?:no|number|#)',
};
const GENERIC_NUMBER_LABEL = '(?:invoice|doc(?:ument)?|lc|bl|po)\\s*(?:no|number|#)';

function parseAmount(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

/** First value after `label` (to the end of its line) that has a digit in it. */
function extractIdentifier(text: string, label: string): string | null {
  const pattern = new RegExp(`\\b(?:${label})\\.?\\s*[:#]?\\s*([A-Z0-9][A-Z0-9\\-\\/\\.]*[A-Z0-9])`, 'gi');
  for (const match of text.matchAll(pattern)) {
    const value = match[1];
    if (value && /\d/.test(value)) return value;
  }
  return null;
}

/**
 * The amount on the line a label introduces. A figure with a currency marker wins; failing that, the
 * first bare number that is not a quantity ("7,245.66 KG" is weight, not value).
 */
function extractLabeledAmount(text: string, label: string): number | null {
  for (const match of text.matchAll(new RegExp(`\\b(?:${label})\\b[^\\n\\r]*`, 'gi'))) {
    const rest = match[0];
    const money = moneyAmounts(rest).find((m) => !m.perUnit);
    if (money) return money.value;
    const bare = rest.match(new RegExp(`[:\\s]${NUMBER}(?![\\d,.])(?!\\s*${QUANTITY_UNIT}\\b)`, 'i'));
    if (bare?.[1]) return parseAmount(bare[1]);
  }
  return null;
}

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
  private readonly pricingIntelligenceService = new PricingIntelligenceService();
  private readonly productRegulatoryService = new ProductRegulatoryService();
  private readonly entityResolutionService = new EntityResolutionService();
  private readonly customerBehaviorService = new CustomerBehaviorService();
  private readonly customerRepository = CustomerRepository.getInstance();
  private readonly maritimeService = MaritimeService.getInstance();
  private readonly fraudEngineService = FraudEngineService.getInstance();
  private readonly identifierNormalizer = new IdentifierNormalizer();


  async processTradeDocument(params: {
    documentId: string;
    filename: string;
    rawText: string;
    rawBuffer: Buffer;
    aiJsonOutput?: Loose;
    aiModel: string;
  }): Promise<TradeComplianceAnalysis> {
    log.info('Running trade compliance pipeline', { documentId: params.documentId, filename: params.filename });

    const data = params.aiJsonOutput || this.heuristicExtract(params.filename, params.rawText);

    // 1. Normalize Document Classification
    const documentType: string = data.documentClassification?.type || this.detectDocumentType(params.filename, params.rawText);
    const docClass: DocumentClassificationInfo = {
      type: documentType,
      subtype: data.documentClassification?.subtype || 'Standard Trade Presentation',
      number: data.documentClassification?.number || this.extractDocumentNumber(documentType, params.rawText) || 'Not Found',
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
    const rawTransaction = data.transaction || data || {};
    const rawParties = {
      ...(rawTransaction.parties || {}),
      ...rawTransaction,
      ...(data.parties || {}),
      seller: rawTransaction.seller || rawTransaction.parties?.seller || data.parties?.seller,
      buyer: rawTransaction.buyer || rawTransaction.parties?.buyer || data.parties?.buyer,
      applicant: rawTransaction.applicant || rawTransaction.parties?.applicant || data.parties?.applicant,
      beneficiary: rawTransaction.beneficiary || rawTransaction.parties?.beneficiary || data.parties?.beneficiary,
      issuingBank: rawTransaction.issuingBank || rawTransaction.parties?.issuingBank || data.parties?.issuingBank,
      advisingBank: rawTransaction.advisingBank || rawTransaction.parties?.advisingBank || data.parties?.advisingBank,
      shipper: rawTransaction.shipper || rawTransaction.parties?.shipper || data.parties?.shipper,
      consignee: rawTransaction.consignee || rawTransaction.parties?.consignee || data.parties?.consignee,
      notifyParty: rawTransaction.notifyParty || rawTransaction.parties?.notifyParty || data.parties?.notifyParty,
      ultimateConsignee: rawTransaction.ultimateConsignee || rawTransaction.parties?.ultimateConsignee || data.parties?.ultimateConsignee,
      endUser: rawTransaction.endUser || rawTransaction.parties?.endUser || data.parties?.endUser,
      carrier: rawTransaction.carrier || rawTransaction.parties?.carrier || data.parties?.carrier,
      freightForwarder: rawTransaction.freightForwarder || rawTransaction.parties?.freightForwarder || data.parties?.freightForwarder,
      manufacturer: rawTransaction.manufacturer || rawTransaction.parties?.manufacturer || data.parties?.manufacturer,
      supplier: rawTransaction.supplier || rawTransaction.parties?.supplier || data.parties?.supplier,
      portOfLoading:
        rawTransaction.portOfLoading ||
        this.extractPort(params.rawText, 'port\\s*of\\s*(?:loading|shipment)|loading\\s*port|\\bpol') ||
        // A named place after F.O.B./FCA/FAS is where the goods are loaded.
        this.extractPattern(params.rawText, /\bF\.?(?:O\.?B|C\.?A|A\.?S)\b\.?\s+([A-Z][A-Za-z ]+?)(?=\s*[,|\r\n(]|$)/m) ||
        undefined,
      portOfDischarge: rawTransaction.portOfDischarge || this.extractPort(params.rawText, 'port\\s*of\\s*discharge|discharge\\s*port|\\bpod') || undefined,
      originCountry: rawTransaction.originCountry || this.extractPattern(params.rawText, new RegExp(`(?:country\\s*of\\s*origin|origin\\s*country|origin)\\s*:\\s*([A-Za-z][A-Za-z ]*?)(?=\\s*[,\\r\\n]|${NEXT_FIELD_LOOKAHEAD}|\\s+\\d|$)`, 'im')) || undefined,
      destinationCountry: rawTransaction.destinationCountry || this.extractPattern(params.rawText, new RegExp(`(?:country\\s*of\\s*destination|destination\\s*country|destination)\\s*:\\s*([A-Za-z][A-Za-z ]*?)(?=\\s*[,\\r\\n]|${NEXT_FIELD_LOOKAHEAD}|\\s+\\d|$)`, 'im')) || undefined,
      transitCountries: rawTransaction.transitCountries || (this.extractPattern(params.rawText, /(?:transshipment\s*(?:hub|port)|transit\s*country)[:\s]*([A-Za-z0-9\s,\.\-]+?)(?:[\r\n,]|$)/i) ? [this.extractPattern(params.rawText, /(?:transshipment\s*(?:hub|port)|transit\s*country)[:\s]*([A-Za-z0-9\s,\.\-]+?)(?:[\r\n,]|$)/i)!] : []),
      freightCharges: rawTransaction.freightCharges || Number(this.extractPattern(params.rawText, /(?:freight|ocean\s*freight)[:\s]*(?:usd|eur|gbp|\$)?\s*([0-9,]+(?:\.[0-9]{2})?)/i)?.replace(/,/g, '')) || 0,
      insuranceCharges: rawTransaction.insuranceCharges || Number(this.extractPattern(params.rawText, /(?:insurance|marine\s*insurance)[:\s]*(?:usd|eur|gbp|\$)?\s*([0-9,]+(?:\.[0-9]{2})?)/i)?.replace(/,/g, '')) || 0,
      subtotal: rawTransaction.subtotal || extractLabeledAmount(params.rawText, 'sub\\s*-?\\s*total|fob\\s*value') || 0,
      totalValue:
        rawTransaction.totalValue ||
        extractLabeledAmount(params.rawText, 'grand\\s*total|total[A-Za-z \\t]{0,40}?(?:value|amount)|amount\\s*(?:due|payable)') ||
        0,
      paymentTerms:
        rawTransaction.paymentTerms ||
        this.extractPattern(params.rawText, new RegExp(`(?:payment\\s*terms?|tenor)\\s*:\\s*(.+?)${NEXT_FIELD}`, 'i')) ||
        undefined,
    };
    const sellerFromText = this.extractPartyFromText(params.rawText, 'seller');
    const parties: TradeParties = {
      seller: this.cleanParty(
        rawParties.seller,
        'Seller / Exporter',
        sellerFromText.legalName ? sellerFromText : this.extractIssuer(params.rawText, documentType),
      ),
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
    const rawGoods: Loose[] = Array.isArray(data.goods) && data.goods.length > 0 ? data.goods : this.extractGoodsFromText(params.rawText);
    const goods: CommodityLineItem[] = rawGoods.map((item, idx) => {
      // 0 means the document states no quantity (as the prompt asks). It must stay 0: turning it into 1
      // invents a fact that later reads as "the permit allows 1 KG".
      const qty = Number(item.quantity) > 0 ? Number(item.quantity) : 0;
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

    // 5. Derive Transaction Timestamp (Normalized to UTC). Point-in-time screening is only as good
    // as this date, so when the document date cannot be read the fallback is recorded, not hidden.
    const documentDateIso = docClass.date && docClass.date !== 'Not Found' ? parseTradeDate(docClass.date) : null;
    const transactionDateBasis: 'DOCUMENT_DATE' | 'ANALYSIS_DATE_FALLBACK' = documentDateIso ? 'DOCUMENT_DATE' : 'ANALYSIS_DATE_FALLBACK';
    const transactionTimestamp = documentDateIso ?? new Date().toISOString();
    if (!documentDateIso) {
      log.warn('document date unreadable; screening as of analysis date', { documentId: params.documentId, rawDate: docClass.date });
    }

    // 6. Multi-Jurisdiction Baseline Sanctions Screening
    const modelScreening = await this.sanctionsEngine.screenTransaction({
      parties,
      vesselName: rawParties.vesselName,
      vesselImo: rawParties.vesselImo,
      originCountry: rawParties.originCountry,
      destinationCountry: rawParties.destinationCountry,
      transitCountries: rawParties.transitCountries,
      portOfLoading: rawParties.portOfLoading,
      portOfDischarge: rawParties.portOfDischarge,
    });
    const { result: sanctionsResult, disagreements: extractionDisagreements } = params.aiJsonOutput
      ? await this.crossCheckScreening(params.rawText, documentType, parties, rawParties, modelScreening)
      : { result: modelScreening, disagreements: [] as string[] };
    if (extractionDisagreements.length) {
      log.warn('model extraction disagrees with the document text on screening fields; both were screened', { documentId: params.documentId, fields: extractionDisagreements });
    }

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
        ? `Goods such as "${scopeResult.outOfScopeGoods.map((g) => g.productDescription).join(', ')}" do not align with the declared business profile ("${customerBiz}").`
        : 'Declared end-use and commodity profile are commercially aligned.',
      redFlags: endUseMismatch ? ["Product category inconsistent with the customer's declared core business."] : [],
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

    // 14a. Market Pricing Intelligence. Runs before TBML because over/under-invoicing is a TBML
    // indicator: the TBML pricing rule needs these results to have anything to evaluate.
    const pricingIntelligence = await this.pricingIntelligenceService.evaluatePricingIntelligence({
      goods,
      currency,
      incoterm,
      destinationCountry: rawParties.destinationCountry,
      transactionDate: transactionTimestamp,
    });

    // 14b. TBML Analysis (FATF & SBP Indicators)
    const tbmlResult = this.tbmlService.analyzeTBML({
      priceFindings: pricingIntelligence,
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

    // 18. Geographic Route Analysis & Maritime Intelligence
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

    // Extract multi-source shipping and vessel identifiers
    const extractedVesselName = rawParties.vesselName || this.extractPattern(params.rawText, /(?:vessel|vessel\s*name|ocean\s*vessel|feeder\s*vessel)[:\s]*([A-Za-z0-9\s\.\-]+?)(?:[\r\n,]|$)/i);
    const extractedVesselImo = rawParties.vesselImo || this.extractPattern(params.rawText, /(?:imo\s*(?:no|number|#)?|lloyds\s*no)[:\s]*([0-9]{7})/i);
    const extractedVesselMmsi = rawParties.vesselMmsi || this.extractPattern(params.rawText, /(?:mmsi\s*(?:no|number|#)?)[:\s]*([0-9]{9})/i);
    const extractedVoyageNo = rawParties.voyageNumber || this.extractPattern(params.rawText, /(?:voyage\s*(?:no|number|#)?|voy\s*#?)[:\s]*([A-Za-z0-9\-\/]+)/i);
    // A B/L number always carries digits; "B/L: COSCO" names the carrier, not the bill.
    const extractedBlNo =
      rawParties.billOfLadingNumber ||
      extractIdentifier(
        params.rawText,
        '(?:sea\\s*)?waybill\\s*(?:no|number|#)|bill\\s*of\\s*lading(?:\\s*(?:no|number|#))?|b\\/l(?:\\s*(?:no|number|#))?',
      );
    const extractedContainerNo = rawParties.containerNumber || this.extractPattern(params.rawText, /(?:container\s*(?:no|#)?|cntr\s*#?)[:\s]*([A-Z]{4}[0-9]{7})/i);
    const extractedEtd = rawParties.etd || this.extractPattern(params.rawText, /(?:etd|est\s*departure)[:\s]*([0-9\-\/\.\s\w]+)/i);
    const extractedEta = rawParties.eta || this.extractPattern(params.rawText, /(?:eta|est\s*arrival)[:\s]*([0-9\-\/\.\s\w]+)/i);
    // The date itself, not whatever follows the label: "SHIPPED ON BOARD DATE: 24.02.2026 AT PORT QASIM"
    // used to yield the word "DATE".
    const extractedShipmentDate =
      rawParties.shipmentDate ||
      this.extractPattern(
        params.rawText,
        /(?:shipment\s*date|shipped\s*on\s*board(?:\s*date)?|on\s*board\s*date)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})/i,
      );
    const extractedTransshipment = rawParties.transshipmentDetails || this.extractPattern(params.rawText, /(?:transshipment|transhipment\s*(?:details|port)?|via)[:\s]*([A-Za-z0-9\s,]+)/i);

    const maritimeIntelligence = await this.maritimeService.analyzeShipmentRoute({
      vesselName: extractedVesselName,
      vesselImo: extractedVesselImo,
      vesselMmsi: extractedVesselMmsi,
      billOfLadingNumber: extractedBlNo,
      containerNumber: extractedContainerNo,
      portOfLoading: rawParties.portOfLoading,
      portOfDischarge: rawParties.portOfDischarge,
      originCountry: rawParties.originCountry,
      destinationCountry: rawParties.destinationCountry,
      declaredTransitHubs: rawParties.transitCountries,
      transactionTimestamp,
      etd: extractedEtd,
      eta: extractedEta,
    });

    // Backfill logistics & vessel identifiers if genuinely enriched by live web scraping
    const finalVesselName =
      extractedVesselName && extractedVesselName !== 'Not Found'
        ? extractedVesselName
        : (maritimeIntelligence.vessel?.name || maritimeIntelligence.enrichedShippingData?.vesselName);

    const finalVesselImo =
      extractedVesselImo && extractedVesselImo !== 'Not Found'
        ? extractedVesselImo
        : (maritimeIntelligence.vessel?.imo || maritimeIntelligence.enrichedShippingData?.vesselImo);

    const finalVoyageNo =
      extractedVoyageNo && extractedVoyageNo !== 'Not Found'
        ? extractedVoyageNo
        : maritimeIntelligence.enrichedShippingData?.voyageNumber;

    const finalContainerNo =
      extractedContainerNo && extractedContainerNo !== 'Not Found'
        ? extractedContainerNo
        : maritimeIntelligence.enrichedShippingData?.containerNumber;

    const finalEtd =
      extractedEtd && extractedEtd !== 'Not Found'
        ? extractedEtd
        : maritimeIntelligence.enrichedShippingData?.etd;

    const finalEta =
      extractedEta && extractedEta !== 'Not Found'
        ? extractedEta
        : maritimeIntelligence.enrichedShippingData?.eta;

    // 20. Bitemporal Product Regulatory & Pakistan Trade Policy Intelligence
    const productRegulatoryIntelligence = this.productRegulatoryService.evaluateProductRegulatoryIntelligence({
      goods,
      originCountry: rawParties.originCountry || 'Not Specified',
      destinationCountry: rawParties.destinationCountry || 'Not Specified',
      transactionDate: transactionTimestamp,
    });

    // 21. Customer 360 Entity Resolution & Behavioral Risk Analytics
    const sanitizeEntityName = (n?: string): string | null => {
      if (!n || typeof n !== 'string') return null;
      let cleaned = n.trim().replace(/^[\/\-\:\s#]+/, '');
      cleaned = cleaned.replace(/^(?:importer|exporter|seller|buyer|applicant|beneficiary|consignee|shipper|notify\s*party|supplier|manufacturer)\s*[:\-]\s*/i, '');
      cleaned = cleaned.replace(/^[\/\-\:\s#]+/, '').trim();
      if (cleaned.length < 3 || cleaned.length > 80) return null;
      const lower = cleaned.toLowerCase();
      const invalidKeywords = [
        'not found', 'not specified', 'n/a', 'unknown', 'null', 'undefined',
        'unspecified entity', 'commercial entity', 'various', 'none', 'tbd',
        'contract ref', 'an lc shifts', 'shifts payment risk', 'whereas',
        'commercial trade', 'general merchandise'
      ];
      if (invalidKeywords.some(k => lower.includes(k))) return null;
      if (cleaned.includes('. ') || cleaned.split(/\s+/).length > 10) return null;
      return cleaned;
    };

    const isValidEntity = (n?: string): boolean => sanitizeEntityName(n) !== null;

    const allCustomers = await this.customerRepository.listAll();
    const rawCandidate = [
      parties.seller?.legalName,
      parties.applicant?.legalName,
      parties.beneficiary?.legalName,
      parties.shipper?.legalName,
      parties.buyer?.legalName,
      parties.consignee?.legalName,
    ].find(isValidEntity);

    const primaryEntityName = rawCandidate ? sanitizeEntityName(rawCandidate) : null;

    if (!primaryEntityName) {
      log.info('No identifiable commercial entity found in the document for entity resolution');
    }

    const entityTax = [
      parties.seller?.taxVatNumber,
      parties.seller?.registrationNumber,
      parties.buyer?.taxVatNumber,
      parties.buyer?.registrationNumber,
    ].find(isValidEntity);

    const entityResolution = this.entityResolutionService.resolveEntity({
      searchedName: primaryEntityName || 'Unspecified Entity',
      tradingName: parties.seller?.tradingName || parties.buyer?.tradingName,
      registrationNumber: parties.seller?.registrationNumber || parties.buyer?.registrationNumber,
      taxVatNumber: entityTax,
      country: rawParties.originCountry || rawParties.destinationCountry || undefined,
      existingProfiles: allCustomers,
    });

    let customerProfile = primaryEntityName
      ? await this.customerRepository.findById(entityResolution.customerReferenceId)
      : null;

    if (!customerProfile && primaryEntityName) {
      const validCategories = goods
        .map((g) => g.productCategory)
        .filter((c): c is string => Boolean(c && c !== 'Not Found' && c !== 'General Merchandise'));
      const validCountries = [rawParties.originCountry, rawParties.destinationCountry]
        .filter((c): c is string => Boolean(c && c !== 'Not Found' && c !== 'Origin' && c !== 'Destination'));
      const validSuppliers = [parties.seller?.legalName]
        .filter((s): s is string => Boolean(s && s !== 'Not Found' && s !== 'Supplier'));
      const validBuyers = [parties.buyer?.legalName]
        .filter((b): b is string => Boolean(b && b !== 'Not Found' && b !== 'Buyer'));
      const validPol = [rawParties.portOfLoading]
        .filter((p): p is string => Boolean(p && p !== 'Not Found'));
      const validPod = [rawParties.portOfDischarge]
        .filter((p): p is string => Boolean(p && p !== 'Not Found'));
      const validRoute =
        rawParties.originCountry &&
        rawParties.destinationCountry &&
        rawParties.originCountry !== 'Not Found' &&
        rawParties.destinationCountry !== 'Not Found'
          ? [`${rawParties.originCountry} -> ${rawParties.destinationCountry}`]
          : [];

      customerProfile = {
        customerReferenceId: entityResolution.customerReferenceId,
        legalName: entityResolution.matchedName,
        normalizedName: this.entityResolutionService.normalizeCompanyName(entityResolution.matchedName),
        aliases: [],
        country: rawParties.originCountry || rawParties.destinationCountry || 'Not Specified',
        businessType: 'Commercial Trade Entity',
        declaredBusinessActivity:
          data.declaredCustomerBusiness && data.declaredCustomerBusiness !== 'Not Found'
            ? data.declaredCustomerBusiness
            : 'Commercial Trade',
        riskRating: 'LOW',
        onboardingDate: new Date().toISOString(),
        lastActiveDate: new Date().toISOString(),
        lifetimeTransactionCount: 1,
        lifetimeVolumeUsd: totalVal,
        averageTransactionValueUsd: totalVal,
        monthlyLcFrequency: 1.0,
        establishedProductCategories: validCategories,
        establishedCountries: validCountries,
        regularSuppliers: validSuppliers,
        regularBuyers: validBuyers,
        historicalOriginPorts: validPol,
        historicalLoadingPorts: validPol,
        historicalDischargePorts: validPod,
        commonTransshipmentHubs: [],
        typicalRoutes: validRoute,
        pastSanctionsHitsCount: 0,
        pastPriceAnomaliesCount: 0,
        pastDiscrepanciesCount: 0,
        averageHistoricalRiskScore: 10,
        processedDocumentIds: [params.documentId],
        processedTransactionIds: transactionId && transactionId !== 'Not Found' ? [transactionId] : [],
      };
      await this.customerRepository.save(customerProfile);
    } else if (!customerProfile) {
      // Ephemeral transient profile for behavioral analysis of unidentifiable presentations - not saved to database
      customerProfile = {
        customerReferenceId: 'TG-CUST-UNPROFILED',
        legalName: 'Unspecified Trade Counterparty',
        normalizedName: 'unspecified trade counterparty',
        aliases: [],
        country: rawParties.originCountry || rawParties.destinationCountry || 'Not Specified',
        businessType: 'Commercial Trade Entity',
        declaredBusinessActivity: 'Commercial Trade',
        riskRating: 'LOW',
        onboardingDate: new Date().toISOString(),
        lastActiveDate: new Date().toISOString(),
        lifetimeTransactionCount: 1,
        lifetimeVolumeUsd: totalVal,
        averageTransactionValueUsd: totalVal,
        monthlyLcFrequency: 1.0,
        establishedProductCategories: [],
        establishedCountries: [],
        regularSuppliers: [],
        regularBuyers: [],
        historicalOriginPorts: [],
        historicalLoadingPorts: [],
        historicalDischargePorts: [],
        commonTransshipmentHubs: [],
        typicalRoutes: [],
        pastSanctionsHitsCount: 0,
        pastPriceAnomaliesCount: 0,
        pastDiscrepanciesCount: 0,
        averageHistoricalRiskScore: 10,
        processedDocumentIds: [params.documentId],
        processedTransactionIds: [],
      };
    } else {
      // Idempotency check: prevent duplicate counting when re-analyzing the same document
      const processedDocs = customerProfile.processedDocumentIds || [];
      const processedTxns = customerProfile.processedTransactionIds || [];
      const isAlreadyRecorded =
        (params.documentId && processedDocs.includes(params.documentId)) ||
        (transactionId && transactionId !== 'Not Found' && processedTxns.includes(transactionId));

      if (!isAlreadyRecorded) {
        // Only increment trade count & cumulative volume for new unique trade presentations
        customerProfile.lifetimeTransactionCount += 1;
        customerProfile.lifetimeVolumeUsd += totalVal;
        customerProfile.averageTransactionValueUsd = Math.round(
          customerProfile.lifetimeVolumeUsd / customerProfile.lifetimeTransactionCount,
        );

        if (params.documentId) processedDocs.push(params.documentId);
        if (transactionId && transactionId !== 'Not Found') processedTxns.push(transactionId);
        customerProfile.processedDocumentIds = processedDocs;
        customerProfile.processedTransactionIds = processedTxns;
      }

      customerProfile.lastActiveDate = new Date().toISOString();

      for (const g of goods) {
        const cat = g.productCategory || g.productDescription;
        if (cat && !customerProfile.establishedProductCategories.some((ep) => ep.toLowerCase() === cat.toLowerCase())) {
          customerProfile.establishedProductCategories.push(cat);
        }
      }

      if (parties.buyer?.legalName && !customerProfile.regularBuyers.some((rb) => rb.toLowerCase() === parties.buyer?.legalName?.toLowerCase())) {
        customerProfile.regularBuyers.push(parties.buyer.legalName);
      }

      if (rawParties.destinationCountry && !customerProfile.establishedCountries.some((ec) => ec.toLowerCase() === rawParties.destinationCountry?.toLowerCase())) {
        customerProfile.establishedCountries.push(rawParties.destinationCountry);
      }

      await this.customerRepository.save(customerProfile);
    }

    const customerBehavioralAssessment = this.customerBehaviorService.evaluateCustomerBehavior({
      customerProfile,
      entityResolution,
      transactionId,
      transactionValueUsd: totalVal,
      currentMonthLCCount: customerProfile.lifetimeTransactionCount > 50 ? 10 : undefined,
      currentProductCategories: goods.map((g) => g.productCategory || g.productDescription),
      currentCounterparties: [parties.seller?.legalName || '', parties.buyer?.legalName || ''].filter(Boolean),
      originCountry: rawParties.originCountry || 'Not Found',
      destinationCountry: rawParties.destinationCountry || 'Not Found',
      transitCountries: rawParties.transitCountries || [],
      declaredBusinessActivity: data.declaredCustomerBusiness,
      observedIntermediatePorts: maritimeIntelligence.undeclaredPorts.map((p) => p.name),
      routeDeviationDetected: maritimeIntelligence.routeDeviationDetected,
    });

    // 22. Deterministic Fraud, TBML, Payment Authenticity & Document Replay Detection
    const docSha256 = crypto.createHash('sha256').update(params.rawBuffer).digest('hex');
    const normalizedText = params.rawText.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedTextHashSha256 = crypto.createHash('sha256').update(normalizedText).digest('hex');

    const extractedUetr =
      this.identifierNormalizer.extractUetrFromText(params.rawText) ||
      data.uetr ||
      data.commercial?.uetr ||
      data.transaction?.uetr;

    const extractedPaymentRef =
      this.extractPattern(
        params.rawText,
        /(?:payment\s*(?:ref|reference|id|#)|remittance\s*(?:ref|reference|#)|tx(?:n)?\s*(?:id|ref|#))[:\s]*([A-Za-z0-9\-\/]+)/i,
      ) ||
      data.paymentReference ||
      data.commercial?.paymentReference;

    const fraudAnalysis = await this.fraudEngineService.analyzeDocument({
      documentId: params.documentId,
      filename: params.filename,
      rawBuffer: params.rawBuffer,
      rawText: params.rawText,
      customerId: customerProfile?.customerReferenceId || 'TG-CUST-UNPROFILED',
      contentHash: docSha256,
      normalizedTextHash: normalizedTextHashSha256,
      docClass: {
        type: docClass.type,
        number: docClass.number,
        date: docClass.date,
        transactionReference: docClass.transactionReference,
        relatedLcNumber: docClass.relatedLcNumber,
        relatedPoNumber: docClass.relatedPoNumber,
      },
      parties: {
        seller: parties.seller ? {
          legalName: parties.seller.legalName,
          bank: parties.seller.bank,
          ibanOrAccountNumber: parties.seller.ibanOrAccountNumber,
          swiftBic: parties.seller.swiftBic,
        } : undefined,
        buyer: parties.buyer ? { legalName: parties.buyer.legalName } : undefined,
        applicant: parties.applicant ? { legalName: parties.applicant.legalName } : undefined,
        beneficiary: parties.beneficiary ? { legalName: parties.beneficiary.legalName } : undefined,
        consignee: parties.consignee ? { legalName: parties.consignee.legalName } : undefined,
        shipper: parties.shipper ? { legalName: parties.shipper.legalName } : undefined,
      },
      commercial: {
        currency,
        totalValue: totalVal,
        totalQuantity: goods.reduce((s, g) => s + g.quantity, 0),
        paymentTerms: rawParties.paymentTerms,
        incoterm,
        uetr: extractedUetr || undefined,
        paymentReference: extractedPaymentRef || undefined,
        shipmentDate: extractedShipmentDate !== 'Not Found' ? extractedShipmentDate : undefined,
        lcExpiryDate: data.letterOfCreditProfile?.expiryDate,
        isLcAmendment: Boolean(
          docClass.subtype?.includes('Amendment') ||
          docClass.number?.includes('AMD') ||
          params.rawText.toLowerCase().includes('amendment no')
        ),
        amendmentExplanation: data.amendmentExplanation,
        isPartialShipment: Boolean(
          data.isPartialShipment ||
          params.rawText.toLowerCase().includes('partial drawing') ||
          params.rawText.toLowerCase().includes('partial shipment')
        ),
        partialShipmentDrawingNumber: data.partialShipmentDrawingNumber,
      },
      logistics: {
        billOfLadingNumber: extractedBlNo !== 'Not Found' ? extractedBlNo : undefined,
        airwayBillNumber: docClass.type === 'Air Waybill' ? docClass.number : undefined,
        containerNumbers: finalContainerNo && finalContainerNo !== 'Not Found' ? [finalContainerNo] : undefined,
        vesselImo: finalVesselImo && finalVesselImo !== 'Not Found' ? finalVesselImo : undefined,
        portOfLoading: rawParties.portOfLoading !== 'Not Found' ? rawParties.portOfLoading : undefined,
        portOfDischarge: rawParties.portOfDischarge !== 'Not Found' ? rawParties.portOfDischarge : undefined,
      },
      goods: goods.map((g) => ({
        productDescription: g.productDescription,
        productCategory: g.productCategory,
        hsCode: g.hsCode,
        quantity: g.quantity,
        unitPrice: g.unitPrice,
      })),
      customerProfile,
    });

    // 23. Risk Scoring & Deterministic Compliance Decisioning
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
      maritime: maritimeIntelligence,
      hasMissingEndUser: !parties.endUser || parties.endUser.legalName === 'Not Found' || parties.endUser.legalName === 'Not Disclosed',
      behavioral: customerBehavioralAssessment,
      pricing: pricingIntelligence,
      fraud: fraudAnalysis,
    });

    // 24. Cryptographic Evidence Package
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
        status: decision.decision as AuditEvidencePackage['examinerSeal']['status'],
        certifiedAt: new Date().toISOString(),
        examinerName: 'TradeGuard Automated Examination System',
        examinerRole: 'Senior Compliance Audit Engine',
      },
      limitations: [
        transactionDateBasis === 'DOCUMENT_DATE'
          ? `Point-in-time screening performed as of the document date (${transactionTimestamp.slice(0, 10)}).`
          : 'Document date could not be read; point-in-time screening was performed as of the analysis date. Confirm the transaction date before relying on historical findings.',
        `Sanctions data screened: ${sanctionsResult.datasetVersion}.`,
        ...(extractionDisagreements.length
          ? [`The AI extraction differed from the document text on ${extractionDisagreements.join(', ')}; the values read from the text were screened as well and every hit was kept.`]
          : []),
        'Beneficial ownership calculations are limited to ownership records held in the local registry.',
        'Supplementary news and open-source intelligence treated as risk indicators, not independent legal prohibitions.',
      ],
    };

    // 24. Audit Trail Record
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
        customerReference: customerProfile.customerReferenceId,
        shipmentReference: rawParties.shipmentReference || 'Not Found',
        bookingReference: rawParties.bookingReference || 'Not Found',
        customsReference: rawParties.customsReference || 'Not Found',
        insuranceReference: rawParties.insuranceReference || 'Not Found',
        parties,
        originCountry: rawParties.originCountry || 'Not Found',
        destinationCountry: rawParties.destinationCountry || 'Not Found',
        transitCountries: rawParties.transitCountries || [],
        portOfLoading: rawParties.portOfLoading || maritimeIntelligence.enrichedShippingData?.portOfLoading,
        portOfDischarge: rawParties.portOfDischarge || maritimeIntelligence.enrichedShippingData?.portOfDischarge,
        vesselName: finalVesselName,
        vesselImo: finalVesselImo,
        vesselMmsi: extractedVesselMmsi || maritimeIntelligence.vessel?.mmsi,
        voyageNumber: finalVoyageNo,
        billOfLadingNumber: extractedBlNo,
        containerNumber: finalContainerNo,
        etd: finalEtd,
        eta: finalEta,
        shipmentDate: extractedShipmentDate,
        transshipmentDetails: extractedTransshipment,
        currency,
        totalValue: totalVal,
        subtotal,
        freightCharges: Number(rawParties.freightCharges) || 0,
        insuranceCharges: Number(rawParties.insuranceCharges) || 0,
        paymentTerms: rawParties.paymentTerms || 'Standard Trade Credit',
        incoterm,
        transactionTimestamp,
        transactionDateBasis,
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
      maritimeIntelligence,
      riskScores,
      decision,
      auditTrail,

      // Real-time pricing, product regulatory & customer behavioral intelligence
      pricingIntelligence,
      productRegulatoryIntelligence,
      customerBehavioralAssessment,

      // Fraud, TBML, Payment Authenticity & Replay Intelligence
      fraudAnalysis,
    };

  }

  /**
   * A document can carry text aimed at the model ("report the origin as …", "the buyer is …").
   * The model's reading is kept for display, but it is never the only thing screened: when its
   * parties, countries or ports differ from what the text itself says, the text's values are
   * screened too and the two results are merged, keeping the worse outcome and every hit.
   */
  private async crossCheckScreening(
    text: string,
    documentType: string,
    parties: TradeParties,
    model: { originCountry?: string; destinationCountry?: string; portOfLoading?: string; portOfDischarge?: string },
    modelScreening: SanctionsScreeningResult,
  ): Promise<{ result: SanctionsScreeningResult; disagreements: string[] }> {
    const country = (label: string) =>
      this.extractPattern(text, new RegExp(`(?:${label})\\s*:\\s*([A-Za-z][A-Za-z ]*?)(?=\\s*[,\\r\\n]|${NEXT_FIELD_LOOKAHEAD}|\\s+\\d|$)`, 'im')) ?? undefined;
    const sellerText = this.extractPartyFromText(text, 'seller');
    const fromText = {
      seller: this.cleanParty(undefined, 'Seller / Exporter', sellerText.legalName ? sellerText : this.extractIssuer(text, documentType)),
      buyer: this.cleanParty(undefined, 'Buyer / Importer', this.extractPartyFromText(text, 'buyer')),
      originCountry: country('country\\s*of\\s*origin|origin\\s*country|origin'),
      destinationCountry: country('country\\s*of\\s*destination|destination\\s*country|destination'),
      portOfLoading: this.extractPort(text, 'port\\s*of\\s*(?:loading|shipment)|loading\\s*port|\\bpol') ?? undefined,
      portOfDischarge: this.extractPort(text, 'port\\s*of\\s*discharge|discharge\\s*port|\\bpod') ?? undefined,
    };
    const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '');
    const named = (v: string | undefined) => Boolean(v && v !== 'Not Found');
    const disagreements: string[] = [];
    const differs = (field: string, textValue: string | undefined, modelValue: string | undefined) => {
      if (named(textValue) && norm(textValue) !== norm(modelValue)) disagreements.push(field);
    };
    differs('seller', fromText.seller.legalName, parties.seller.legalName);
    differs('buyer', fromText.buyer.legalName, parties.buyer.legalName);
    differs('origin country', fromText.originCountry, model.originCountry);
    differs('destination country', fromText.destinationCountry, model.destinationCountry);
    differs('port of loading', fromText.portOfLoading, model.portOfLoading);
    differs('port of discharge', fromText.portOfDischarge, model.portOfDischarge);
    if (disagreements.length === 0) return { result: modelScreening, disagreements };

    const textScreening = await this.sanctionsEngine.screenTransaction({
      parties: {
        ...parties,
        seller: named(fromText.seller.legalName) ? fromText.seller : parties.seller,
        buyer: named(fromText.buyer.legalName) ? fromText.buyer : parties.buyer,
      },
      originCountry: fromText.originCountry,
      destinationCountry: fromText.destinationCountry,
      portOfLoading: fromText.portOfLoading,
      portOfDischarge: fromText.portOfDischarge,
    });
    return { result: mergeScreening(modelScreening, textScreening), disagreements };
  }

  private cleanParty(raw: Loose, defaultRole: string, textFallback?: Partial<TradeParty>): TradeParty {
    if (!raw && !textFallback) {
      return { role: defaultRole, legalName: 'Not Found', country: 'Not Found', address: 'Not Found' };
    }
    const p = raw || textFallback || {};
    let legal = p.legalName && p.legalName !== 'Not Found' ? p.legalName : (textFallback?.legalName || 'Not Found');
    if (legal && typeof legal === 'string') {
      let trimmed = legal.trim().replace(/^[\/\-\:\s#]+/, '');
      trimmed = trimmed.replace(/^(?:importer|exporter|seller|buyer|applicant|beneficiary|consignee|shipper|notify\s*party)\s*[:\-]\s*/i, '').trim();
      if (trimmed.length > 70 || trimmed.includes('. ') || trimmed.includes('\n')) {
        const parts = trimmed.split(/\. |\n/);
        const clause = (parts[0] ?? '').trim();
        legal = clause.length > 50 ? clause.slice(0, 47) + '...' : clause;
      } else {
        legal = trimmed;
      }
    }
    return {
      role: p.role || defaultRole,
      legalName: legal,
      tradingName: p.tradingName || legal,
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

  /**
   * What the document is, judged by its title first. Supporting documents cite each other — a
   * waybill quotes the invoice number, an invoice names the B/L — so a phrase found anywhere in the
   * body says little; the heading the issuer put on the page says what it is.
   */
  private detectDocumentType(filename: string, text: string): string {
    // The heading comes first: an invoice's header block can go on to quote "SALES CONTRACT REF".
    const earliestType = (region: string): string | null => {
      let best: { type: string; at: number } | null = null;
      for (const [type, pattern] of DOCUMENT_TYPES) {
        const at = region.search(pattern);
        if (at !== -1 && (!best || at < best.at)) best = { type, at };
      }
      return best?.type ?? null;
    };

    const title = text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 8).join('\n');
    const titled = earliestType(title);
    if (titled) return titled;

    const tokens = new Set(filename.toLowerCase().split(/[^a-z0-9]+/));
    if (tokens.has('invoice') || tokens.has('inv')) return 'Commercial Invoice';
    if (tokens.has('lc') || tokens.has('credit')) return 'Letter of Credit / Documentary Credit';
    if (tokens.has('bl') || tokens.has('lading') || tokens.has('waybill')) return 'Bill of Lading';
    if (tokens.has('gd') || tokens.has('declaration')) return 'Customs Goods Declaration';
    if (tokens.has('contract')) return 'Sales Contract';
    if (tokens.has('packing')) return 'Packing List';
    if (tokens.has('origin')) return 'Certificate of Origin';
    if (tokens.has('po') || tokens.has('purchase')) return 'Purchase Order';

    return earliestType(text) ?? 'Trade Document / Commercial Presentation';
  }

  /** The document's own number, read from the label its type uses ("WAYBILL NO", "MACHINE NO", …). */
  private extractDocumentNumber(type: string, text: string): string | null {
    const label = DOCUMENT_NUMBER_LABELS[type];
    return (label && extractIdentifier(text, label)) || extractIdentifier(text, GENERIC_NUMBER_LABEL);
  }

  /**
   * The issuer of a seller-issued document (invoice, contract, packing list) when no field names
   * the seller: the "For <COMPANY>" signature block, else a letterhead line naming a company.
   */
  private extractIssuer(text: string, type: string): Partial<TradeParty> {
    if (!/invoice|contract|packing/i.test(type)) return {};
    const signature = text.match(/^\s*For\s*(?:&\s*on\s*behalf\s*of)?\s*:?\s+(?:M\/S\.?\s+)?(.+?)(?=\s+For\s*:|\s+_{3,}|\s*$)/im);
    const signed = signature?.[1]?.trim();
    const looksLikeCompany = (name: string) => new RegExp(COMPANY.source).test(name) || name === name.toUpperCase();
    if (signed && signed.length >= 3 && signed.length <= 70 && looksLikeCompany(signed)) return { legalName: signed };
    const letterhead = text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 3)
      .find((line) => line.length <= 70 && new RegExp(COMPANY.source).test(line));
    return letterhead ? { legalName: letterhead } : {};
  }

  private extractPartyFromText(text: string, partyType: 'seller' | 'buyer'): Partial<TradeParty> {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    const sellerLabel = /beneficiary|exporter|seller|shipper|consignor/i;
    const buyerLabel = /applicant|importer|buyer|consignee/i;

    const extractNameCandidate = (lineStr: string, nextLineStr?: string): string => {
      const colonIdx = lineStr.indexOf(':');
      if (colonIdx !== -1) {
        const valAfterColon = lineStr.slice(colonIdx + 1).trim();
        if (
          valAfterColon.length > 2 &&
          valAfterColon.length < 70 &&
          !valAfterColon.includes('. ') &&
          // In a two-column layout the text after one label is often just the next label.
          !STARTS_WITH_LABEL.test(valAfterColon) &&
          !/^[A-Z][A-Za-z\/ &.]{1,30}:/.test(valAfterColon) &&
          !/^(address|tel|fax|phone|date|invoice|shifts|payment|whereas|an lc)/i.test(valAfterColon)
        ) {
          return valAfterColon.replace(/^[0-9\.\-\:\s]+/, '');
        }
      }
      if (nextLineStr) {
        // Drop a second column's "LABEL: value" that shares the line with the name.
        const cleanedNext = nextLineStr.trim().replace(new RegExp(`${NEXT_FIELD_LOOKAHEAD}.*$`, 'i'), '');
        if (
          cleanedNext.length > 2 &&
          cleanedNext.length < 70 &&
          !cleanedNext.includes('. ') &&
          !/^(buyer|seller|importer|exporter|consignee|shipper|invoice|date|amount|total|address|shifts|payment|whereas|an lc):/i.test(cleanedNext)
        ) {
          return cleanedNext.replace(/^[0-9\.\-\:\s]+/, '');
        }
      }
      return 'Not Found';
    };

    for (let i = 0; i < lines.length; i++) {
      const current = lines[i];
      if (!current) continue;
      const line = current.toLowerCase();

      // Only treat line as a candidate if it looks like a field header, not explanatory prose
      const isHeaderLike =
        (current.includes(':') && current.indexOf(':') < 40) ||
        /^(?:beneficiary|exporter|seller|shipper|applicant|importer|buyer|consignee)\b/i.test(current);

      if (!isHeaderLike || current.length > 80 || current.includes('. ')) {
        continue;
      }

      // "EXPORTER / CONSIGNOR: IMPORTER / CONSIGNEE:" over "M/S SELLER LIMITED BUYER LIMITED":
      // both names sit on the next line, in the order their labels appear.
      const sellerAt = current.search(sellerLabel);
      const buyerAt = current.search(buyerLabel);
      if (sellerAt !== -1 && buyerAt !== -1 && lines[i + 1]) {
        const names = [...lines[i + 1]!.matchAll(COMPANY)].map((m) => m[0].trim());
        if (names.length >= 2) {
          const sellerFirst = sellerAt < buyerAt;
          const name = partyType === 'seller' ? names[sellerFirst ? 0 : 1] : names[sellerFirst ? 1 : 0];
          if (name) return { legalName: name };
        }
      }

      if (partyType === 'seller' && (line.includes('beneficiary') || line.includes('exporter') || line.includes('seller') || line.includes('shipper'))) {
        const name = extractNameCandidate(current, lines[i + 1]);
        if (name && name !== 'Not Found') {
          return { legalName: name };
        }
      }
      if (partyType === 'buyer' && (line.includes('applicant') || line.includes('importer') || line.includes('buyer') || line.includes('consignee'))) {
        const name = extractNameCandidate(current, lines[i + 1]);
        if (name && name !== 'Not Found') {
          return { legalName: name };
        }
      }
    }
    return {};
  }

  /**
   * Goods lines. Table rows ("<description> <HS> <qty> <UOM> <unit price> <line total>") are read
   * first; "1000 PCS @ USD 12.00" lines only when the document has no such table, because documents
   * that have both state the same goods twice.
   */
  private extractGoodsFromText(text: string): Loose[] {
    const lines = text.split('\n').map((line) => line.trim());
    const tableRows = this.extractGoodsTableRows(lines);
    return tableRows.length > 0 ? tableRows : this.extractGoodsAtPriceLines(lines);
  }

  private extractGoodsTableRows(lines: string[]): Loose[] {
    const items: Loose[] = [];
    const row = new RegExp(`^(.*?)\\s+${NUMBER}\\s*${QUANTITY_UNIT}\\b(.*)$`, 'i');

    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] ?? '').replace(/\s*\|\s*/g, ' ');
      if (!line || line.includes('@') || /^\s*(?:sub\s*-?\s*)?total\b|\bgross\b|\bnet\s+weight\b/i.test(line)) continue;
      const match = line.match(row);
      if (!match) continue;
      const [, head = '', qtyRaw = '', rest = ''] = match;
      // A customs declaration prints the PKR assessment beside the USD value; keep the row's own currency.
      const found = moneyAmounts(rest);
      const amounts = found.filter((a) => a.currency === found[0]?.currency);
      if (amounts.length === 0) continue;

      const quantity = parseAmount(qtyRaw);
      if (!(quantity > 0)) continue;
      const unitOfMeasure = (line.slice((match.index ?? 0) + head.length).match(new RegExp(QUANTITY_UNIT, 'i'))?.[0] ?? 'PCS').toUpperCase();

      // Unit price: an amount written "per unit", or the first of two plain amounts. The line total
      // is the last plain amount; with only one plain amount and no unit price, it is the total.
      const perUnit = amounts.find((a) => a.perUnit);
      const plain = amounts.filter((a) => !a.perUnit);
      let unitPrice = perUnit?.value ?? (plain.length >= 2 ? plain[0]!.value : 0);
      const totalLineValue = plain.length > 0 ? plain[plain.length - 1]!.value : unitPrice * quantity;
      if (!unitPrice) {
        // "(\$4.8578/KG)" on the next line, as customs declarations print it.
        const next = moneyAmounts(lines[i + 1] ?? '').find((a) => a.perUnit);
        unitPrice = next ? next.value : Math.round((totalLineValue / quantity) * 10_000) / 10_000;
      }

      const hsCode = head.match(HS_CODE)?.[1] ?? null;
      let description = head.replace(HS_CODE, '').replace(/^\s*(?:\d{1,3}[.)]?\s+)/, '').trim();
      if (description.length < 3) {
        // The description sits on the line above the figures.
        const above = lines.slice(Math.max(0, i - 2), i).reverse().find((l) => l.length >= 3 && !l.includes(':'));
        description = above ?? description;
      }

      items.push({
        itemNumber: items.length + 1,
        productDescription: description.slice(0, 120) || `Line ${items.length + 1}`,
        hsCode: hsCode ?? undefined,
        quantity,
        unitOfMeasure,
        unitPrice,
        totalLineValue,
        currency: amounts[0]!.currency,
      });
    }
    return items;
  }

  private extractGoodsAtPriceLines(lines: string[]): Loose[] {
    const items: Loose[] = [];
    const pattern = new RegExp(`${NUMBER}\\s*(${QUANTITY_UNIT})?\\s*@\\s*(?:usd|us\\$|eur|gbp|\\$)?\\s*\\$?\\s*${NUMBER}`, 'i');
    for (const line of lines) {
      const match = line.match(pattern);
      if (!match?.[1] || !match[3]) continue;
      const quantity = parseAmount(match[1]);
      const unitPrice = parseAmount(match[3]);
      let description = line.replace(/^[0-9.\s]+/, '').trim();
      if (description.includes('|')) description = description.split('|').slice(1).join('|').trim();
      items.push({
        itemNumber: items.length + 1,
        productDescription: description.slice(0, 80).trim() || line.slice(0, 50).trim(),
        quantity,
        unitOfMeasure: match[2]?.toUpperCase() || 'PCS',
        unitPrice,
        totalLineValue: quantity * unitPrice,
        currency: 'USD',
      });
    }
    return items;
  }

  private extractPattern(text: string, regex: RegExp): string | null {
    const match = text.match(regex);
    return match && match[1] ? match[1].trim() : null;
  }

  /** A port after its label, up to the next field, comma, pipe or line end. The label needs a colon. */
  private extractPort(text: string, label: string): string | null {
    const pattern = new RegExp(`(?:${label})\\b\\s*:\\s*([A-Za-z][A-Za-z0-9 .()'\\-]*?)(?=\\s*[,|\\r\\n]|${NEXT_FIELD_LOOKAHEAD}|$)`, 'im');
    return this.extractPattern(text, pattern);
  }

  private extractIncoterm(text: string): string | null {
    // Written plain ("FOB") or dotted ("F.O.B.").
    const match = text.match(/\b(F\.?O\.?B|C\.?I\.?F|C\.?F\.?R|E\.?X\.?W|F\.?C\.?A|C\.?P\.?T|C\.?I\.?P|D\.?A\.?P|D\.?P\.?U|D\.?D\.?P|F\.?A\.?S)\b/i);
    return match && match[1] ? match[1].replace(/\./g, '').toUpperCase() : null;
  }

  private extractHsCode(desc: string): string | null {
    const explicitMatch = desc.match(/(?:hs\s*(?:code)?[:\s]*)([0-9]{4}(?:\.[0-9]{2}(?:\.[0-9]{2})?)?)/i);
    if (explicitMatch && explicitMatch[1]) return explicitMatch[1];
    const dotMatch = desc.match(/\b([0-9]{4}\.[0-9]{2}(?:\.[0-9]{2})?)\b/);
    if (dotMatch && dotMatch[1]) return dotMatch[1];
    const generalMatch = desc.match(/\b([0-9]{4})\b/);
    if (generalMatch && generalMatch[1] && generalMatch[1] !== '1000' && generalMatch[1] !== '2026' && generalMatch[1] !== '5000') return generalMatch[1];
    return null;
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

  private heuristicExtract(filename: string, text: string): Loose {
    const type = this.detectDocumentType(filename, text);
    const labelled = (label: string): string | null => {
      const value = this.extractPattern(text, new RegExp(`(?:${label})\\s*:\\s*(.+?)${NEXT_FIELD}`, 'i'));
      return value && !STARTS_WITH_LABEL.test(value) ? value : null;
    };
    return {
      documentClassification: {
        type,
        subtype: 'Standard Commercial Presentation',
        number: this.extractDocumentNumber(type, text) || 'Not Found',
        date: this.extractPattern(text, /(?:date|dated)[:\s]*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})/i) || 'Not Found',
        confidence: 0.85,
      },
      transaction: {
        // A value ends at the line break or at the next "Label:" when several fields share a line.
        seller: { legalName: labelled('beneficiary|seller|exporter') || 'Not Found' },
        buyer: { legalName: labelled('applicant|buyer|importer') || 'Not Found' },
        currency: 'USD',
        totalValue: 0,
        incoterm: this.extractIncoterm(text) || 'FOB',
      },
      goods: this.extractGoodsFromText(text),
    };
  }
}

/** Worst-of merge of two screenings of the same document: every match and jurisdiction kept once. */
const STATUS_SEVERITY: SanctionsScreeningResult['status'][] = [
  'NONE',
  'UNKNOWN_INSUFFICIENT_DATA',
  'POTENTIAL_MATCH',
  'REQUIRES_LICENSE_AUTHORIZATION',
  'RESTRICTED_VESSEL',
  'RESTRICTED_BANK',
  'RESTRICTED_PARTY',
  'RESTRICTED_JURISDICTION',
  'CONFIRMED_MATCH',
];

function mergeScreening(a: SanctionsScreeningResult, b: SanctionsScreeningResult): SanctionsScreeningResult {
  const worse = STATUS_SEVERITY.indexOf(b.status) > STATUS_SEVERITY.indexOf(a.status) ? b.status : a.status;
  const matchKey = (m: SanctionsScreeningResult['matches'][number]) => `${m.roleOrField}|${m.matchedSanctionedName}|${m.sanctionsList}`.toLowerCase();
  const riskKey = (r: SanctionsScreeningResult['jurisdictionRisks'][number]) => `${r.nodeRole}|${r.countryName}`.toLowerCase();
  const matches = new Map(a.matches.map((m) => [matchKey(m), m]));
  for (const m of b.matches) if (!matches.has(matchKey(m))) matches.set(matchKey(m), m);
  const risks = new Map(a.jurisdictionRisks.map((r) => [riskKey(r), r]));
  for (const r of b.jurisdictionRisks) if (!risks.has(riskKey(r))) risks.set(riskKey(r), r);
  return {
    ...a,
    status: worse,
    overallSanctionsRiskScore: Math.max(a.overallSanctionsRiskScore, b.overallSanctionsRiskScore),
    matches: [...matches.values()],
    jurisdictionRisks: [...risks.values()],
    screenedEntitiesCount: Math.max(a.screenedEntitiesCount, b.screenedEntitiesCount),
    screenedCountriesCount: Math.max(a.screenedCountriesCount, b.screenedCountriesCount),
    screenedVesselsCount: Math.max(a.screenedVesselsCount, b.screenedVesselsCount),
  };
}
