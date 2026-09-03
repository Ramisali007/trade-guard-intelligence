import * as fs from 'node:fs';
import * as path from 'node:path';
import { generatePdfReport } from '../src/services/pdf-report.service';
import { buildComplianceReportModel } from '../src/services/report.dto';
import type { DocumentRecord } from '../src/models/document.model';

const outputDir = path.resolve(__dirname, '..', '..', 'sample_reports');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// ============================================================================
// SAMPLE REPORT 1: POINT-TO-POINT COMPLIANT TRADE (ALLOW)
// ============================================================================
const sample1Doc = ({
  id: 'doc-sample-001-allow',
  filename: 'Commercial_Invoice_CNC_Lathes_INV-2026-MUC-8812.pdf',
  fileSize: 52400,
  fileType: 'pdf',
  storageKey: 'storage/uploads/sample-001.pdf',
  uploadedAt: '2026-08-11T09:15:00Z',
  startedAt: '2026-08-11T09:15:02Z',
  completedAt: '2026-08-11T09:15:10Z',
  status: 'completed',
  analysis: {
    engine: {
      provider: 'openai-compatible',
      model: 'gpt-4o-trade-engine',
      batchCount: 1,
      aiRequests: 3,
      aiRetries: 0,
      aiFailures: 0,
      totalDurationMs: 4200,
      rollingTpm: 2400,
    },
    timings: { totalMs: 4200 },
    tradeCompliance: {
      documentClassification: {
        type: 'COMMERCIAL_INVOICE',
        subtype: 'EXPORT_INVOICE',
        number: 'INV-2026-MUC-8812',
        date: '2026-08-10',
        relatedPoNumber: 'PO-UK-99214',
        relatedContractNumber: 'CTR-2026-BPT-04',
        relatedLcNumber: 'LC-DB-LON-260810',
      },
      transaction: {
        transactionId: 'TXN-2026-DE-UK-001',
        invoiceNumber: 'INV-2026-MUC-8812',
        invoiceDate: '2026-08-10',
        proformaInvoiceNumber: 'PI-2026-0771',
        purchaseOrderNumber: 'PO-UK-99214',
        salesContractNumber: 'CTR-2026-BPT-04',
        letterOfCreditNumber: 'LC-DB-LON-260810',
        amendmentNumber: 'Not Applicable',
        customerReference: 'TG-CUST-100319',
        shipmentReference: 'SHP-PACIFIC-01',
        bookingReference: 'BKG-HAPAG-2026',
        customsReference: 'DE-CUST-EXP-88192',
        insuranceReference: 'ALLIANZ-MAR-99120',
        parties: {
          seller: {
            legalName: 'Bavaria Precision Tooling GmbH',
            country: 'Germany',
            role: 'EXPORTER_MANUFACTURER',
            address: 'Industriestrasse 14, 80331 Munich, Germany',
            registrationNumber: 'HRB-89104-MUC',
            taxVatNumber: 'DE-289410928',
          },
          buyer: {
            legalName: 'British Engineering Works Ltd',
            country: 'United Kingdom',
            role: 'IMPORTER_CONSIGNEE',
            address: 'Port Industrial Estate, Southampton SO14 3HN, UK',
            registrationNumber: 'UK-COMP-0881920',
            taxVatNumber: 'GB-992182012',
          },
          consignee: {
            legalName: 'British Engineering Works Ltd',
            country: 'United Kingdom',
            role: 'CONSIGNEE',
          },
          endUser: {
            legalName: 'British Engineering Works Manufacturing Facility',
            country: 'United Kingdom',
            role: 'END_USER',
            address: 'Assembly Hall 3, Southampton Industrial Hub, UK',
          },
          issuingBank: {
            bank: 'Barclays Bank PLC, London',
            legalName: 'Barclays Bank PLC',
            swiftBic: 'BARCGB22XXX',
            country: 'United Kingdom',
            role: 'ISSUING_BANK',
          },
          advisingBank: {
            bank: 'Deutsche Bank AG, Frankfurt',
            legalName: 'Deutsche Bank AG',
            swiftBic: 'DEUTDDFBXXX',
            country: 'Germany',
            role: 'ADVISING_BANK',
          },
        },
        originCountry: 'Germany',
        destinationCountry: 'United Kingdom',
        transitCountries: [],
        portOfLoading: 'Hamburg',
        portOfDischarge: 'Southampton',
        vesselName: 'PACIFIC VOYAGER',
        vesselImo: '9324567',
        vesselMmsi: '636018234',
        voyageNumber: 'VOY-DE-UK-26A',
        billOfLadingNumber: 'HLCUHAM2608101',
        containerNumber: 'HLXU8821904',
        etd: '2026-08-11',
        eta: '2026-08-14',
        shipmentDate: '2026-08-11',
        transshipmentDetails: 'Direct Point-to-Point Sea Carriage without Transshipment',
        currency: 'EUR',
        totalValue: 258000,
        subtotal: 250000,
        freightCharges: 6500,
        insuranceCharges: 1500,
        paymentTerms: 'Confirmed Irrevocable Documentary Credit at Sight',
        incoterm: 'CIF',
        transactionTimestamp: '2026-08-10T11:00:00Z',
      },
      goods: [
        {
          itemNumber: 1,
          productDescription: 'High-Precision Horizontal CNC Lathe Model BPT-600 with Standard 3-Axis Tooling',
          productCategory: 'Industrial Machinery & Machine Tools',
          hsCode: '845811',
          unitOfMeasure: 'UNIT',
          declaredQuantity: 2,
          unitPrice: 125000,
          totalPrice: 250000,
          countryOfOrigin: 'Germany',
          isDualUseCandidate: false,
          dualUseAssessment: 'Standard civil industrial tolerance lathe; precision positioning below 2B001 control threshold (>5 microns error margin).',
        },
      ],
      scopeValidation: {
        isDocumentInScope: true,
        confidence: 0.99,
        classification: 'COMMERCIAL_INVOICE',
        hasOutOfScopeGoods: false,
        scopeAssessment: 'Machinery matches customer declared engineering scope.',
      },
      endUseAnalysis: {
        riskLevel: 'LOW',
        explanation: 'Civil manufacturing application in British automotive component production facility.',
        hasRedFlags: false,
      },
      sanctions: {
        status: 'CLEARED',
        screenedEntitiesCount: 6,
        matches: [],
        jurisdictionRisks: [],
      },
      temporalScreening: {
        transactionTimestamp: '2026-08-10T11:00:00Z',
        wasListedAtTransactionTime: false,
        isCurrentlyListed: false,
        hasPostTransactionDesignations: false,
        historicalFindingsSummary: 'Zero designations across OFAC, EU, UN, UK, SBP on transaction date.',
        currentFindingsSummary: 'Zero designations in active regulatory watchlists as of current date.',
        temporalMatches: [],
        screenedEntitiesCount: 6,
        confidence: 0.99,
      },
      jurisdictionalNexus: [],
      sbpCompliance: {
        isEligibleForSBPProcessing: true,
        overallComplianceStatus: 'COMPLIANT',
        requiresPriorSBPApproval: false,
        sbpDiscrepancies: [],
      },
      ownershipCompliance: {
        isBlockedUnderOfac50PercentRule: false,
        aggregateBlockedOwnershipPercentage: 0,
        checkedEntitiesCount: 4,
        highRiskEntitiesFound: [],
        explanation: 'Direct beneficial owners verified with German Unternehmensregister; 0% sanctioned equity.',
      },
      retrospectiveAlerts: [],
      auditEvidencePackage: {
        evidencePackageId: 'TG-AUD-2026-DE-001',
        documentSha256: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b',
        transactionHashSha256: '3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e',
        verificationDigestSha256: '7c8b9a0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
        ruleSetVersion: 'TG-RULES-V2026.3',
        regulatorySnapshotsUsed: [
          {
            sourceId: 'OFAC_SDN',
            version: '2026.08.08',
            checksumSha256: '88a99b00c11d22e33f44a55b66c77d88e99f00a11b22c33d44e55f66a77b88c9',
            effectiveAt: '2026-08-08T00:00:00Z',
          },
          {
            sourceId: 'EU_FSF',
            version: '2026.08.09',
            checksumSha256: '77b88c99d00e11f22a33b44c55d66e77f88a99b00c11d22e33f44a55b66c77d8',
            effectiveAt: '2026-08-09T00:00:00Z',
          },
        ],
      },
      exportControls: {
        isControlled: false,
        matchedItems: [],
        eccn: 'EAR99',
        exportLicenseRequired: false,
      },
      evasionIndicators: [],
      tbml: {
        overallTbmlRiskScore: 8,
        priceConsistencyAssessment: 'Unit price EUR 125,000 matches historical median EUR 124,500.',
        routingConsistencyAssessment: 'Direct sea voyage Hamburg to Southampton.',
        redFlags: [],
      },
      discrepancies: [],
      mathematicalValidation: {
        isMathematicallySound: true,
        calculatedSubtotal: 250000,
        declaredSubtotal: 250000,
        calculatedTotal: 258000,
        declaredTotal: 258000,
        currency: 'EUR',
        discrepancies: [],
      },
      documentIntegrity: {
        overallIntegrityScore: 98,
        hasForgedLetterhead: false,
        discrepancies: [],
      },
      routeAnalysis: {
        nodes: [
          { nodeType: 'ORIGIN', locationName: 'Germany', country: 'Germany', riskScore: 5, sanctionsConcern: false },
          { nodeType: 'PORT_OF_LOADING', locationName: 'Hamburg', country: 'Germany', riskScore: 5, sanctionsConcern: false },
          { nodeType: 'PORT_OF_DISCHARGE', locationName: 'Southampton', country: 'United Kingdom', riskScore: 5, sanctionsConcern: false },
          { nodeType: 'FINAL_DESTINATION', locationName: 'United Kingdom', country: 'United Kingdom', riskScore: 5, sanctionsConcern: false },
        ],
        hasUnusualTransshipment: false,
        hasCircularRouting: false,
        overallRouteRiskScore: 10,
        routeSummary: 'Hamburg (DEHAM) -> Southampton (GBSOU) [Direct Point-to-Point]',
      },
      maritimeIntelligence: {
        declaredRoute: {
          origin: 'Germany',
          portOfLoading: 'Hamburg',
          loadingLocode: 'DEHAM',
          transitHubs: [],
          portOfDischarge: 'Southampton',
          dischargeLocode: 'GBSOU',
          finalDestination: 'United Kingdom',
          etd: '2026-08-11',
          eta: '2026-08-14',
        },
        observedRoute: {
          originPort: { name: 'Hamburg', locode: 'DEHAM', country: 'Germany', countryCode: 'DE' },
          portOfLoading: { name: 'Hamburg', locode: 'DEHAM', country: 'Germany', countryCode: 'DE' },
          intermediateCalls: [],
          portOfDischarge: { name: 'Southampton', locode: 'GBSOU', country: 'United Kingdom', countryCode: 'GB' },
          departureTime: '2026-08-11T08:00:00Z',
          arrivalTime: '2026-08-14T14:30:00Z',
        },
        vessel: {
          imo: '9324567',
          mmsi: '636018234',
          name: 'PACIFIC VOYAGER',
          flag: 'Liberia',
          vesselType: 'Container Ship (Feedermax)',
          confidence: 0.99,
        },
        intermediatePortsCount: 0,
        undeclaredIntermediatePortsCount: 0,
        undeclaredPorts: [],
        routeClassification: 'DIRECT_ROUTE',
        routeDeviationDetected: false,
        routeRiskLevel: 'LOW',
        routeRiskScore: 10,
        routeFindings: [
          'Direct point-to-point carriage observed between Hamburg (DEHAM) and Southampton (GBSOU).',
          'Vessel port-call timeline aligns with declared bill of lading dates (ETD Aug 11 / ETA Aug 14).',
        ],
        evidenceRecords: [
          {
            provider: 'VesselFinder-AIS-Engine',
            query: 'IMO:9324567 | PACIFIC VOYAGER [Hamburg -> Southampton]',
            vesselIdentifier: 'IMO 9324567 (PACIFIC VOYAGER)',
            dateRange: '2026-08-11 to 2026-08-14',
            retrievedTimestamp: '2026-08-11T09:15:00Z',
            observedPorts: ['Hamburg (DEHAM) [DEPARTURE]', 'Southampton (GBSOU) [ARRIVAL]'],
            dataConfidence: 0.99,
            sourceReference: 'AIS Automated Port-Call Digest • Ref AIS-HIST-DEUK-01',
          },
        ],
        limitationNotice:
          'Vessel-level route evidence does not by itself establish cargo-level transshipment. Historical port-call records reflect observed vessel movements during the relevant voyage window, which may include customary commercial transshipment or multi-port discharge operations.',
      },
      pricingIntelligence: [
        {
          itemNumber: 1,
          productDescription: 'High-Precision Horizontal CNC Lathe Model BPT-600',
          declaredUnitPrice: 125000,
          declaredCurrency: 'EUR',
          hsCode: '845811',
          hasMarketData: true,
          benchmarkUnitPriceUsd: 136250,
          observedMarketLowUsd: 130000,
          observedMarketHighUsd: 145000,
          priceVariancePercent: 1.2,
          classification: 'FAIR_MARKET_PRICE',
          evidenceRecords: [
            {
              sourceTitle: 'Global Machine Tool Pricing Index 2026',
              sourceAuthorityLevel: 'STATISTICAL_AUTHORITY',
              benchmarkDate: '2026-08-01',
            },
          ],
        },
      ],
      customerBehavioralAssessment: {
        customerProfile: {
          customerReferenceId: 'TG-CUST-100319',
          legalName: 'Bavaria Precision Tooling GmbH',
          normalizedName: 'bavaria precision tooling gmbh',
          aliases: ['Bavaria Tools Engineering'],
          country: 'Germany',
          declaredBusinessActivity: 'Design and manufacture of high-precision CNC lathes and tooling.',
          lifetimeTransactionCount: 112,
          lifetimeVolumeUsd: 28900000,
          averageTransactionValueUsd: 258000,
          monthlyLcFrequency: 1.8,
          establishedProductCategories: ['Industrial Machinery & Machine Tools', 'Precision CNC Lathes'],
          establishedCountries: ['United Kingdom', 'United States', 'Switzerland'],
          regularSuppliers: ['Krupp Steel Technologies'],
          regularBuyers: ['British Engineering Works Ltd'],
        },
        entityResolution: {
          customerReferenceId: 'TG-CUST-100319',
          matchedName: 'Bavaria Precision Tooling GmbH',
          matchConfidence: 0.99,
        },
        baselines: {
          customerReferenceId: 'TG-CUST-100319',
          historicalLcFrequencyMean: 1.8,
          historicalLcFrequencyStdDev: 0.4,
          historicalAverageValueUsd: 258000,
          establishedCategories: ['Industrial Machinery & Machine Tools'],
          establishedCountries: ['United Kingdom'],
          establishedSuppliers: ['Krupp Steel Technologies'],
          establishedBuyers: ['British Engineering Works Ltd'],
        },
        alerts: [],
        behavioralRiskScore: 8,
        behavioralRiskLevel: 'LOW',
        behavioralSummary: 'Customer trading pattern fully conforms with established 5-year historical German-UK engineering corridor.',
        analyticalRecommendations: ['Proceed with standard documentary credit settlement.'],
      },
      riskScores: {
        sanctions: 5,
        exportControl: 5,
        goods: 8,
        tbml: 8,
        endUse: 5,
        endUser: 5,
        documentIntegrity: 2,
        geographic: 10,
        transactionAnomaly: 8,
        overall: 8,
      },
      decision: {
        decision: 'ALLOW',
        confidence: 0.98,
        reasons: [
          'Direct point-to-point carriage verified from Hamburg to Southampton with zero intermediate calls.',
          'All parties cleared under multi-jurisdiction point-in-time sanctions watchlists.',
          'Machine specifications verified below dual-use control thresholds (EAR99).',
          'Price variance (+1.2%) conforms to independent market benchmark.',
          'Documentary presentation fully reconciled under UCP 600 standards.',
        ],
        triggeredRules: ['RULE_DIRECT_ROUTE_CONFORMANCE', 'RULE_SANCTIONS_CLEARED', 'RULE_FAIR_PRICE_VALIDATED'],
        missingInformation: [],
        recommendedActions: ['Release presentation documents to issuing bank under LC terms.'],
        evidenceFindings: [
          {
            id: 'EV-ALLOW-01',
            finding: 'Point-to-Point Route Verification',
            severity: 'LOW',
            evidence: 'AIS tracking confirms vessel PACIFIC VOYAGER sailed directly Hamburg to Southampton.',
            sourceDocument: 'AIS Historical Port-Call Digest',
            reason: 'Zero route deviation or transshipment exposure.',
            confidence: 0.99,
            recommendedAction: 'Proceed with documentary release.',
          },
        ],
      },
      auditTrail: {
        auditTrailId: 'AUD-2026-DE-001',
        events: [
          { timestamp: '2026-08-11T09:15:02Z', event: 'DOCUMENT_UPLOADED', actor: 'Client Gateway' },
          { timestamp: '2026-08-11T09:15:05Z', event: 'SANCTIONS_SCREENED', actor: 'TradeGuard Engine' },
          { timestamp: '2026-08-11T09:15:08Z', event: 'AIS_ROUTE_RECONSTRUCTED', actor: 'Maritime AIS Module' },
          { timestamp: '2026-08-11T09:15:10Z', event: 'DECISION_FINALIZED_ALLOW', actor: 'Compliance Rule Engine' },
        ],
      },
    },
  },
} as unknown as DocumentRecord);

// ============================================================================
// SAMPLE REPORT 2: COMMERCIAL TRANSSHIPMENT & PROFILE MIGRATION (REVIEW)
// ============================================================================
const sample2Doc = ({
  id: 'doc-sample-002-review',
  filename: 'Commercial_Invoice_Telecom_Routers_EXP-2026-SH-KHI-44.pdf',
  fileSize: 64200,
  fileType: 'pdf',
  storageKey: 'storage/uploads/sample-002.pdf',
  uploadedAt: '2026-08-15T14:20:00Z',
  startedAt: '2026-08-15T14:20:02Z',
  completedAt: '2026-08-15T14:20:12Z',
  status: 'completed',
  analysis: {
    engine: {
      provider: 'openai-compatible',
      model: 'gpt-4o-trade-engine',
      batchCount: 1,
      aiRequests: 3,
      aiRetries: 0,
      aiFailures: 0,
      totalDurationMs: 5100,
      rollingTpm: 3100,
    },
    timings: { totalMs: 5100 },
    tradeCompliance: {
      documentClassification: {
        type: 'COMMERCIAL_INVOICE',
        subtype: 'EXPORT_INVOICE',
        number: 'EXP-2026-SH-KHI-44',
        date: '2026-08-12',
        relatedPoNumber: 'PO-ALM-88910',
        relatedContractNumber: 'SC-2026-SH-912',
        relatedLcNumber: 'LC-BOC-HBL-260812',
      },
      transaction: {
        transactionId: 'TXN-2026-CN-PK-002',
        invoiceNumber: 'EXP-2026-SH-KHI-44',
        invoiceDate: '2026-08-12',
        proformaInvoiceNumber: 'PI-SH-260719',
        purchaseOrderNumber: 'PO-ALM-88910',
        salesContractNumber: 'SC-2026-SH-912',
        letterOfCreditNumber: 'LC-BOC-HBL-260812',
        amendmentNumber: 'Not Applicable',
        customerReference: 'TG-CUST-100882',
        shipmentReference: 'SHP-COSCO-PEKING-04',
        bookingReference: 'BKG-COSCO-8812',
        customsReference: 'CN-CUSTOMS-EXP-3312',
        insuranceReference: 'PICC-MAR-2026-88',
        parties: {
          seller: {
            legalName: 'Shenzhen Comms Technologies Ltd',
            country: 'China',
            role: 'EXPORTER_SUPPLIER',
            address: 'High-Tech Industrial Park, Nanshan, Shenzhen, China',
            registrationNumber: 'CN-91440300MA5XXXX',
          },
          buyer: {
            legalName: 'Al-Manar Trading FZE',
            country: 'United Arab Emirates',
            role: 'IMPORTER_RE_EXPORTER',
            address: 'JAFZA Free Zone, Jebel Ali, Dubai, United Arab Emirates',
            registrationNumber: 'FZE-99412',
            taxVatNumber: 'TRN-100249182300003',
          },
          consignee: {
            legalName: 'Indus Logistics & Telecommunications CJSC',
            country: 'Pakistan',
            role: 'CONSIGNEE',
            address: 'West Wharf Road, Karachi Port, Pakistan',
          },
          endUser: {
            legalName: 'Pakistan Regional Broadband Connectivity Project',
            country: 'Pakistan',
            role: 'END_USER',
          },
          issuingBank: {
            bank: 'Habib Bank Limited, Corporate Center Karachi',
            legalName: 'Habib Bank Limited',
            swiftBic: 'HABBPKKAXXX',
            country: 'Pakistan',
            role: 'ISSUING_BANK',
          },
          advisingBank: {
            bank: 'Bank of China, Shanghai Branch',
            legalName: 'Bank of China',
            swiftBic: 'BKCHCNBJ300',
            country: 'China',
            role: 'ADVISING_BANK',
          },
        },
        originCountry: 'China',
        destinationCountry: 'Pakistan',
        transitCountries: ['Singapore'],
        portOfLoading: 'Shanghai',
        portOfDischarge: 'Karachi',
        vesselName: 'COSCO SHIPPING PEKING',
        vesselImo: '9731937',
        vesselMmsi: '477123456',
        voyageNumber: 'VOY-042W',
        billOfLadingNumber: 'COSU987654321',
        containerNumber: 'COSU1234567',
        etd: '2026-08-12',
        eta: '2026-08-30',
        shipmentDate: '2026-08-12',
        transshipmentDetails: 'Commercial Relay Transshipment via Singapore',
        currency: 'USD',
        totalValue: 400000,
        subtotal: 390000,
        freightCharges: 8500,
        insuranceCharges: 1500,
        paymentTerms: 'Confirmed LC at 60 Days Sight',
        incoterm: 'CIF',
        transactionTimestamp: '2026-08-12T10:30:00Z',
      },
      goods: [
        {
          itemNumber: 1,
          productDescription: 'Industrial High-Density Enterprise Routing Gateways Model RG-9000',
          productCategory: 'Telecommunications & Networking Equipment',
          hsCode: '851762',
          unitOfMeasure: 'UNIT',
          declaredQuantity: 500,
          unitPrice: 780,
          totalPrice: 390000,
          countryOfOrigin: 'China',
          isDualUseCandidate: false,
          dualUseAssessment: 'Commercial encryption within Category 5 Part 2 Mass Market note exemption (Note 4).',
        },
      ],
      scopeValidation: {
        isDocumentInScope: true,
        confidence: 0.98,
        classification: 'COMMERCIAL_INVOICE',
        hasOutOfScopeGoods: false,
        scopeAssessment: 'Networking equipment authorized for commercial re-export.',
      },
      endUseAnalysis: {
        riskLevel: 'LOW',
        explanation: 'Civil telecommunication network upgrade in telecom corridor.',
        hasRedFlags: false,
      },
      sanctions: {
        status: 'CLEARED',
        screenedEntitiesCount: 6,
        matches: [],
        jurisdictionRisks: [],
      },
      temporalScreening: {
        transactionTimestamp: '2026-08-12T10:30:00Z',
        wasListedAtTransactionTime: false,
        isCurrentlyListed: false,
        hasPostTransactionDesignations: false,
        historicalFindingsSummary: 'No designated entities found at transaction time.',
        currentFindingsSummary: 'All entities remain cleared in active sanction registers.',
        temporalMatches: [],
        screenedEntitiesCount: 6,
        confidence: 0.98,
      },
      jurisdictionalNexus: [],
      sbpCompliance: {
        isEligibleForSBPProcessing: true,
        overallComplianceStatus: 'COMPLIANT',
        requiresPriorSBPApproval: false,
        sbpDiscrepancies: [],
      },
      ownershipCompliance: {
        isBlockedUnderOfac50PercentRule: false,
        aggregateBlockedOwnershipPercentage: 0,
        checkedEntitiesCount: 3,
        highRiskEntitiesFound: [],
        explanation: 'Al-Manar Trading FZE ownership verified in JAFZA registry; no designated beneficial owners.',
      },
      retrospectiveAlerts: [],
      auditEvidencePackage: {
        evidencePackageId: 'TG-AUD-2026-CN-002',
        documentSha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
        transactionHashSha256: '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e',
        verificationDigestSha256: '4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c',
        ruleSetVersion: 'TG-RULES-V2026.3',
        regulatorySnapshotsUsed: [
          {
            sourceId: 'OFAC_SDN',
            version: '2026.08.10',
            checksumSha256: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
            effectiveAt: '2026-08-10T00:00:00Z',
          },
        ],
      },
      exportControls: {
        isControlled: false,
        matchedItems: [],
        eccn: '5A992.c',
        exportLicenseRequired: false,
      },
      evasionIndicators: [],
      tbml: {
        overallTbmlRiskScore: 25,
        priceConsistencyAssessment: 'Unit price USD 780 within 1.9% of global market median USD 765.',
        routingConsistencyAssessment: 'Commercial transshipment via standard Asian relay hubs.',
        redFlags: [],
      },
      discrepancies: [],
      mathematicalValidation: {
        isMathematicallySound: true,
        calculatedSubtotal: 390000,
        declaredSubtotal: 390000,
        calculatedTotal: 400000,
        declaredTotal: 400000,
        currency: 'USD',
        discrepancies: [],
      },
      documentIntegrity: {
        overallIntegrityScore: 95,
        hasForgedLetterhead: false,
        discrepancies: [],
      },
      routeAnalysis: {
        nodes: [
          { nodeType: 'ORIGIN', locationName: 'China', country: 'China', riskScore: 10, sanctionsConcern: false },
          { nodeType: 'PORT_OF_LOADING', locationName: 'Shanghai', country: 'China', riskScore: 10, sanctionsConcern: false },
          { nodeType: 'TRANSIT_PORT', locationName: 'Singapore', country: 'Singapore', riskScore: 15, sanctionsConcern: false },
          { nodeType: 'PORT_OF_DISCHARGE', locationName: 'Karachi', country: 'Pakistan', riskScore: 10, sanctionsConcern: false },
          { nodeType: 'FINAL_DESTINATION', locationName: 'Pakistan', country: 'Pakistan', riskScore: 10, sanctionsConcern: false },
        ],
        hasUnusualTransshipment: true,
        hasCircularRouting: false,
        overallRouteRiskScore: 30,
        routeSummary: 'Shanghai (CNSHA) -> Singapore (SGSIN) -> Karachi (PKKHI)',
      },
      maritimeIntelligence: {
        declaredRoute: {
          origin: 'China',
          portOfLoading: 'Shanghai',
          loadingLocode: 'CNSHA',
          transitHubs: ['Singapore'],
          portOfDischarge: 'Karachi',
          dischargeLocode: 'PKKHI',
          finalDestination: 'Pakistan',
          etd: '2026-08-12',
          eta: '2026-08-30',
        },
        observedRoute: {
          originPort: { name: 'Shanghai', locode: 'CNSHA', country: 'China', countryCode: 'CN' },
          portOfLoading: { name: 'Shanghai', locode: 'CNSHA', country: 'China', countryCode: 'CN' },
          intermediateCalls: [
            {
              port: { name: 'Singapore', locode: 'SGSIN', country: 'Singapore', countryCode: 'SG' },
              arrivalTime: '2026-08-18T04:00:00Z',
              departureTime: '2026-08-19T16:00:00Z',
              wasDeclared: true,
              jurisdictionRiskLevel: 'CLEAR',
              jurisdictionExplanation: 'Major international container relay hub; declared in trade documents.',
            },
            {
              port: { name: 'Port Klang', locode: 'MYPKG', country: 'Malaysia', countryCode: 'MY' },
              arrivalTime: '2026-08-21T06:00:00Z',
              departureTime: '2026-08-22T02:00:00Z',
              wasDeclared: false,
              jurisdictionRiskLevel: 'CLEAR',
              jurisdictionExplanation: 'Standard regional multi-port liner feeder call.',
            },
            {
              port: { name: 'Colombo', locode: 'LKCMB', country: 'Sri Lanka', countryCode: 'LK' },
              arrivalTime: '2026-08-25T11:00:00Z',
              departureTime: '2026-08-26T08:00:00Z',
              wasDeclared: false,
              jurisdictionRiskLevel: 'CLEAR',
              jurisdictionExplanation: 'Customary South Asia transshipment hub.',
            },
          ],
          portOfDischarge: { name: 'Karachi', locode: 'PKKHI', country: 'Pakistan', countryCode: 'PK' },
          departureTime: '2026-08-12T12:00:00Z',
          arrivalTime: '2026-08-30T18:00:00Z',
        },
        vessel: {
          imo: '9731937',
          mmsi: '477123456',
          name: 'COSCO SHIPPING PEKING',
          flag: 'Hong Kong',
          vesselType: 'Container Ship',
          confidence: 0.99,
        },
        intermediatePortsCount: 3,
        undeclaredIntermediatePortsCount: 2,
        undeclaredPorts: [
          { name: 'Port Klang', locode: 'MYPKG', country: 'Malaysia', countryCode: 'MY' },
          { name: 'Colombo', locode: 'LKCMB', country: 'Sri Lanka', countryCode: 'LK' },
        ],
        routeClassification: 'NORMAL_TRANSSHIPMENT',
        routeDeviationDetected: true,
        routeRiskLevel: 'MEDIUM',
        routeRiskScore: 30,
        routeFindings: [
          'Commercial Transshipment Detected: The vessel called at established container relay hubs (Port Klang, Colombo) in addition to declared Singapore hub.',
          'Multi-port feeder and relay operations are standard commercial practice for this container trade corridor.',
          'No calls at sanctioned or high-risk maritime jurisdictions observed during voyage window.',
        ],
        evidenceRecords: [
          {
            provider: 'VesselFinder-AIS-Engine',
            query: 'IMO:9731937 | COSCO SHIPPING PEKING [Shanghai -> Karachi]',
            vesselIdentifier: 'IMO 9731937 (COSCO SHIPPING PEKING)',
            dateRange: '2026-08-12 to 2026-08-30',
            retrievedTimestamp: '2026-08-15T14:20:00Z',
            observedPorts: [
              'Shanghai (CNSHA) [DEPARTURE]',
              'Singapore (SGSIN) [CALL]',
              'Port Klang (MYPKG) [CALL]',
              'Colombo (LKCMB) [CALL]',
              'Karachi (PKKHI) [ARRIVAL]',
            ],
            dataConfidence: 0.98,
            sourceReference: 'AIS Automated Port-Call Digest • Ref VOY-COSCO-42W',
          },
        ],
        limitationNotice:
          'Vessel-level route evidence does not by itself establish cargo-level transshipment. Historical port-call records reflect observed vessel movements during the relevant voyage window, which may include customary commercial transshipment or multi-port discharge operations.',
      },
      pricingIntelligence: [
        {
          itemNumber: 1,
          productDescription: 'Industrial High-Density Enterprise Routing Gateways Model RG-9000',
          declaredUnitPrice: 780,
          declaredCurrency: 'USD',
          hsCode: '851762',
          hasMarketData: true,
          benchmarkUnitPriceUsd: 765,
          observedMarketLowUsd: 710,
          observedMarketHighUsd: 820,
          priceVariancePercent: 1.9,
          classification: 'FAIR_MARKET_PRICE',
          evidenceRecords: [
            {
              sourceTitle: 'S&P Global Enterprise Hardware Benchmark Q3 2026',
              sourceAuthorityLevel: 'MARKET_EXCHANGE',
              benchmarkDate: '2026-08-01',
            },
          ],
        },
      ],
      customerBehavioralAssessment: {
        customerProfile: {
          customerReferenceId: 'TG-CUST-100882',
          legalName: 'Al-Manar Trading FZE',
          normalizedName: 'al manar trading fze',
          aliases: ['Al-Manar Petrochemicals & Equipment FZE'],
          country: 'United Arab Emirates',
          declaredBusinessActivity: 'Commercial re-export and wholesale distribution of networking and consumer hardware.',
          lifetimeTransactionCount: 42,
          lifetimeVolumeUsd: 16800000,
          averageTransactionValueUsd: 400000,
          monthlyLcFrequency: 4.5,
          establishedProductCategories: ['Telecommunications & Networking Equipment', 'Consumer Electronics'],
          establishedCountries: ['Azerbaijan', 'Georgia', 'Turkey', 'China'],
          regularSuppliers: ['Shenzhen Comms Technologies'],
          regularBuyers: ['Caspian Logistics & Trade LLC'],
        },
        entityResolution: {
          customerReferenceId: 'TG-CUST-100882',
          matchedName: 'Al-Manar Trading FZE',
          matchConfidence: 0.99,
        },
        baselines: {
          customerReferenceId: 'TG-CUST-100882',
          historicalLcFrequencyMean: 4.5,
          historicalLcFrequencyStdDev: 0.8,
          historicalAverageValueUsd: 400000,
          establishedCategories: ['Telecommunications & Networking Equipment'],
          establishedCountries: ['Azerbaijan', 'Georgia'],
          establishedSuppliers: ['Shenzhen Comms Technologies'],
          establishedBuyers: ['Caspian Logistics & Trade LLC'],
        },
        alerts: [
          {
            alertId: 'ALT-ROUTE-2026-02',
            customerReferenceId: 'TG-CUST-100882',
            transactionId: 'TXN-2026-CN-PK-002',
            alertCode: 'ROUTING_PROFILE_CHANGE',
            severity: 'MODERATE',
            metric: 'Customer Maritime Routing Baseline',
            baselineValue: 'Shanghai -> Singapore -> Jebel Ali | Direct Jebel Ali Corridors',
            observedValue: 'Shanghai -> Singapore -> Port Klang -> Colombo -> Karachi',
            explanation: 'Vessel port call sequence includes Port Klang and Colombo relay hubs not in customer typical historical shipping corridor.',
            evidence: [
              'Customer Reference: TG-CUST-100882 (Al-Manar Trading FZE)',
              'Historical routing: Jebel Ali re-export hub',
              'Observed transshipment: Direct transit to Karachi via Southeast Asian feeder hubs',
            ],
            detectedAt: '2026-08-15T14:20:00Z',
            requiresEnhancedReview: true,
          },
        ],
        behavioralRiskScore: 35,
        behavioralRiskLevel: 'MEDIUM',
        behavioralSummary: 'Customer profile triggered 1 behavioral anomaly alert: ROUTING_PROFILE_CHANGE. Requires compliance officer enhanced due diligence review.',
        analyticalRecommendations: [
          'Verify carrier through-bill of lading covers transshipment via Port Klang and Colombo.',
          'Confirm consignee delivery authorization in Pakistan.',
        ],
      },
      riskScores: {
        sanctions: 5,
        exportControl: 10,
        goods: 15,
        tbml: 25,
        endUse: 10,
        endUser: 10,
        documentIntegrity: 5,
        geographic: 30,
        transactionAnomaly: 35,
        overall: 38,
      },
      decision: {
        decision: 'REVIEW',
        confidence: 0.94,
        reasons: [
          'Commercial transshipment observed via Port Klang and Colombo in addition to declared Singapore hub.',
          'Customer behavioral baseline triggered ROUTING_PROFILE_CHANGE (novel South Asia discharge port).',
          'Counterparties and commodities cleared under point-in-time sanctions registers.',
          'Pricing verified within fair market tolerance (+1.9%).',
        ],
        triggeredRules: ['RULE_COMMERCIAL_TRANSSHIPMENT_DETECTED', 'RULE_ROUTING_PROFILE_CHANGE'],
        missingInformation: ['Carrier Through-Bill of Lading endorsement covering feeder transshipment leg.'],
        recommendedActions: [
          'Request formal carrier certificate confirming through carriage to Karachi.',
          'Obtain end-use statement from Indus Logistics CJSC.',
        ],
        evidenceFindings: [
          {
            id: 'EV-REV-01',
            finding: 'Commercial Transshipment at Established Hubs',
            severity: 'LOW',
            evidence: 'Vessel called at Port Klang (MYPKG) and Colombo (LKCMB).',
            sourceDocument: 'AIS Historical Port-Call Digest',
            reason: 'Customary container relay operation for China-Pakistan corridor.',
            confidence: 0.98,
            recommendedAction: 'Confirm carrier through-bill of lading covers transshipment leg.',
          },
          {
            id: 'EV-REV-02',
            finding: 'Customer Routing Baseline Divergence',
            severity: 'MODERATE',
            evidence: 'First direct presentation to Karachi port; customer historically re-exports via Jebel Ali.',
            sourceDocument: 'Customer 360 Behavioral Analytics',
            reason: 'Divergence from 3-year established historical trading lane.',
            confidence: 0.95,
            recommendedAction: 'Verify commercial contract justification for direct Pakistan discharge.',
          },
        ],
      },
      auditTrail: {
        auditTrailId: 'AUD-2026-CN-002',
        events: [
          { timestamp: '2026-08-15T14:20:02Z', event: 'DOCUMENT_UPLOADED', actor: 'Operations Portal' },
          { timestamp: '2026-08-15T14:20:05Z', event: 'SANCTIONS_SCREENED', actor: 'TradeGuard Engine' },
          { timestamp: '2026-08-15T14:20:09Z', event: 'AIS_ROUTE_RECONSTRUCTED', actor: 'Maritime AIS Module' },
          { timestamp: '2026-08-15T14:20:12Z', event: 'DECISION_FINALIZED_REVIEW', actor: 'Compliance Rule Engine' },
        ],
      },
    },
  },
} as unknown as DocumentRecord);

// ============================================================================
// SAMPLE REPORT 3: HIGH-RISK SANCTIONED CALL & ESCALATION (BLOCK_ESCALATE)
// ============================================================================
const sample3Doc = ({
  id: 'doc-sample-003-block',
  filename: 'Export_Invoice_5Axis_Motion_Controllers_EXP-2026-GULF-991.pdf',
  fileSize: 71800,
  fileType: 'pdf',
  storageKey: 'storage/uploads/sample-003.pdf',
  uploadedAt: '2026-08-20T11:45:00Z',
  startedAt: '2026-08-20T11:45:02Z',
  completedAt: '2026-08-20T11:45:15Z',
  status: 'completed',
  analysis: {
    engine: {
      provider: 'openai-compatible',
      model: 'gpt-4o-trade-engine',
      batchCount: 1,
      aiRequests: 3,
      aiRetries: 0,
      aiFailures: 0,
      totalDurationMs: 6500,
      rollingTpm: 3800,
    },
    timings: { totalMs: 6500 },
    tradeCompliance: {
      documentClassification: {
        type: 'COMMERCIAL_INVOICE',
        subtype: 'EXPORT_INVOICE',
        number: 'EXP-2026-GULF-991',
        date: '2026-08-18',
        relatedPoNumber: 'PO-CASPIAN-2026-09',
        relatedContractNumber: 'CTR-GULF-CASP-88',
        relatedLcNumber: 'LC-ENBD-IBA-260818',
      },
      transaction: {
        transactionId: 'TXN-2026-AE-IR-003',
        invoiceNumber: 'EXP-2026-GULF-991',
        invoiceDate: '2026-08-18',
        proformaInvoiceNumber: 'PI-GULF-8819',
        purchaseOrderNumber: 'PO-CASPIAN-2026-09',
        salesContractNumber: 'CTR-GULF-CASP-88',
        letterOfCreditNumber: 'LC-ENBD-IBA-260818',
        amendmentNumber: 'Not Applicable',
        customerReference: 'TG-CUST-100499',
        shipmentReference: 'SHP-GULF-RUNNER-03',
        bookingReference: 'BKG-CASP-7712',
        customsReference: 'AE-DXB-CUSTOMS-2026',
        insuranceReference: 'OMAN-INS-99182',
        parties: {
          seller: {
            legalName: 'Gulf Industrial Equipment Trading FZE',
            country: 'United Arab Emirates',
            role: 'EXPORTER_SUPPLIER',
            address: 'JAFZA South, Dubai, UAE',
            registrationNumber: 'FZE-11029',
          },
          buyer: {
            legalName: 'Caspian Precision Mechanics CJSC',
            country: 'Azerbaijan',
            role: 'IMPORTER_CONSIGNEE',
            address: 'Babek Avenue 12, Baku, Azerbaijan',
            registrationNumber: 'AZ-BAKU-881920',
          },
          consignee: {
            legalName: 'Trans-Caspian Forwarding LLC',
            country: 'Azerbaijan',
            role: 'CONSIGNEE',
          },
          endUser: {
            legalName: 'Not Disclosed / Unnamed Heavy Machinery Repair Facility',
            country: 'Azerbaijan',
            role: 'END_USER',
          },
          issuingBank: {
            bank: 'International Bank of Azerbaijan, Baku',
            legalName: 'International Bank of Azerbaijan',
            swiftBic: 'IBAZAZ2X',
            country: 'Azerbaijan',
            role: 'ISSUING_BANK',
          },
          advisingBank: {
            bank: 'Emirates NBD Bank PJSC, Dubai',
            legalName: 'Emirates NBD Bank PJSC',
            swiftBic: 'EBILAEADXXX',
            country: 'United Arab Emirates',
            role: 'ADVISING_BANK',
          },
        },
        originCountry: 'United Arab Emirates',
        destinationCountry: 'Azerbaijan',
        transitCountries: ['Georgia'],
        portOfLoading: 'Jebel Ali',
        portOfDischarge: 'Poti',
        vesselName: 'GULF RUNNER',
        vesselImo: '9181156',
        vesselMmsi: '351123000',
        voyageNumber: 'VOY-GULF-2026-03',
        billOfLadingNumber: 'BL-GULF-2026-991',
        containerNumber: 'GFCU9912048',
        etd: '2026-07-02',
        eta: '2026-07-28',
        shipmentDate: '2026-07-02',
        transshipmentDetails: 'Direct sea transit declared via Poti Port',
        currency: 'USD',
        totalValue: 840000,
        subtotal: 820000,
        freightCharges: 16000,
        insuranceCharges: 4000,
        paymentTerms: 'Irrevocable LC at Sight',
        incoterm: 'CIF',
        transactionTimestamp: '2026-07-01T09:00:00Z',
      },
      goods: [
        {
          itemNumber: 1,
          productDescription: 'High-Precision 5-Axis Multi-Axis CNC Digital Motion Controllers & Servodrives',
          productCategory: 'Controlled Industrial Machinery',
          hsCode: '846693',
          unitOfMeasure: 'SET',
          declaredQuantity: 12,
          unitPrice: 68333.33,
          totalPrice: 820000,
          countryOfOrigin: 'United Arab Emirates',
          isDualUseCandidate: true,
          dualUseAssessment: 'Controlled Dual-Use Commodity under Wassenaar Arrangement Dual-Use List Category 2 (2B001.a / 2B001.b) - Precision positioning resolution < 1.0 micron.',
        },
      ],
      scopeValidation: {
        isDocumentInScope: true,
        confidence: 0.99,
        classification: 'COMMERCIAL_INVOICE',
        hasOutOfScopeGoods: true,
        scopeAssessment: 'CRITICAL: Dual-use high-precision 5-axis CNC equipment presented without export control license.',
      },
      endUseAnalysis: {
        riskLevel: 'CRITICAL',
        explanation: 'Missing verifiable End-User Certificate (EUC); dual-use CNC hardware subject to diversion risk.',
        hasRedFlags: true,
      },
      sanctions: {
        status: 'SANCTIONED_ENTITY_IDENTIFIED',
        screenedEntitiesCount: 6,
        matches: [],
        jurisdictionRisks: [
          {
            jurisdiction: 'Iran',
            countryCode: 'IR',
            riskScore: 100,
            riskLevel: 'CRITICAL',
            sanctionsPrograms: ['OFAC_IRAN_COMPREHENSIVE', 'EU_IRAN_EMBARGO', 'UN_RESOLUTION_2231'],
            explanation: 'Comprehensively sanctioned jurisdiction touched during maritime vessel port-call transit.',
          },
        ],
      },
      temporalScreening: {
        transactionTimestamp: '2026-07-01T09:00:00Z',
        wasListedAtTransactionTime: false,
        isCurrentlyListed: true,
        hasPostTransactionDesignations: true,
        historicalFindingsSummary: 'No direct SDN listing on buyer entity at July 1, 2026.',
        currentFindingsSummary: 'High-risk maritime nexus and 50% Rule beneficial ownership exposure identified.',
        temporalMatches: [
          {
            matchId: 'MAT-IR-50RULE',
            matchedEntityId: 'IR-SOE-8812',
            matchedName: 'Sepahan Industrial Engineering Holdings',
            searchedName: 'Trans-Caspian Forwarding LLC (55% Shareholder)',
            partyRole: 'BENEFICIAL_OWNER',
            matchType: 'BENEFICIAL_OWNER_50_RULE',
            matchConfidence: 0.96,
            sanctionsList: 'OFAC SDN',
            jurisdiction: 'United States / OFAC',
            programs: ['IRAN-EO13871', 'SDGT'],
            transactionTimestamp: '2026-07-01T09:00:00Z',
            designationDate: '2024-03-15T00:00:00Z',
            effectiveDate: '2024-03-15T00:00:00Z',
            temporalStatus: 'ACTIVE_AT_TRANSACTION_TIME',
            isCurrentlyListed: true,
            wasListedAtTransactionTime: true,
            legalExplanation: 'Entity is 55% owned by designated Iranian state-owned industrial holding Sepahan.',
            recommendedAction: 'BLOCK transaction under OFAC 50% Rule.',
            sourceSnapshotId: 'OFAC_SDN_2026_06_30',
            sourceChecksum: '88a99b00c11d22e33f44a55b66c77d88',
          },
        ],
        screenedEntitiesCount: 6,
        confidence: 0.99,
      },
      jurisdictionalNexus: [
        {
          jurisdiction: 'United States',
          regimeName: 'OFAC Iran Sanctions Regulations (31 CFR Part 560)',
          applicability: 'CRITICAL_BLOCKING',
          nexusBasis: ['USD Clearing', 'Secondary Sanctions Risk', 'OFAC 50% Rule'],
        },
      ],
      sbpCompliance: {
        isEligibleForSBPProcessing: false,
        overallComplianceStatus: 'NON_COMPLIANT',
        requiresPriorSBPApproval: true,
        sbpDiscrepancies: ['Prohibited transshipment jurisdiction under FE Manual Chapter 12.'],
      },
      ownershipCompliance: {
        isBlockedUnderOfac50PercentRule: true,
        aggregateBlockedOwnershipPercentage: 55,
        checkedEntitiesCount: 3,
        highRiskEntitiesFound: ['Sepahan Industrial Engineering Holdings (55%)'],
        explanation: 'CRITICAL VIOLATION: Trans-Caspian Forwarding LLC is 55% owned by OFAC-designated Sepahan Industrial Engineering Holdings.',
      },
      retrospectiveAlerts: [],
      auditEvidencePackage: {
        evidencePackageId: 'TG-AUD-2026-IR-003',
        documentSha256: 'f5e4d3c2b1a0987654321fedcba0987654321fedcba0987654321fedcba09876',
        transactionHashSha256: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
        verificationDigestSha256: '99887766554433221100aabbccddeeff00112233445566778899aabbccddeeff',
        ruleSetVersion: 'TG-RULES-V2026.3',
        regulatorySnapshotsUsed: [
          {
            sourceId: 'OFAC_SDN',
            version: '2026.06.30',
            checksumSha256: '3344556677889900aabbccddeeff11223344556677889900aabbccddeeff1122',
            effectiveAt: '2026-06-30T00:00:00Z',
          },
        ],
      },
      exportControls: {
        isControlled: true,
        matchedItems: [
          {
            itemNumber: 1,
            productDescription: '5-Axis Multi-Axis CNC Digital Motion Controllers',
            eccn: '2B001.a',
            controlRegime: 'Wassenaar Arrangement / Dual-Use',
            reasonForControl: ['National Security', 'Non-Proliferation'],
          },
        ],
        eccn: '2B001.a',
        exportLicenseRequired: true,
      },
      evasionIndicators: [
        {
          indicatorId: 'EVASION-01',
          type: 'HIGH_RISK_TRANSSHIPMENT',
          description: 'Vessel stopped at Bandar Abbas, Iran for 4 days before proceeding to declared destination.',
        },
      ],
      tbml: {
        overallTbmlRiskScore: 90,
        priceConsistencyAssessment: 'Dual-use hardware value USD 840,000 without valid export permit.',
        routingConsistencyAssessment: 'CRITICAL: Port call at comprehensively sanctioned Iranian port.',
        redFlags: ['High-risk transshipment port', 'Dual-use hardware diversion', 'Blocked beneficial owner'],
      },
      discrepancies: [
        {
          id: 'DISC-01',
          field: 'Routing Discrepancy',
          severity: 'CRITICAL_CONFLICT',
          documentA: 'Export Invoice',
          valueA: 'Direct transit to Poti, Georgia',
          documentB: 'AIS Port Registry',
          valueB: '4-day intermediate call at Bandar Abbas, Iran',
          explanation: 'Transport presentation omitted intermediate transit through comprehensively sanctioned port.',
        },
      ],
      mathematicalValidation: {
        isMathematicallySound: true,
        calculatedSubtotal: 820000,
        declaredSubtotal: 820000,
        calculatedTotal: 840000,
        declaredTotal: 840000,
        currency: 'USD',
        discrepancies: [],
      },
      documentIntegrity: {
        overallIntegrityScore: 40,
        hasForgedLetterhead: false,
        discrepancies: [],
      },
      routeAnalysis: {
        nodes: [
          { nodeType: 'ORIGIN', locationName: 'United Arab Emirates', country: 'United Arab Emirates', riskScore: 20, sanctionsConcern: false },
          { nodeType: 'PORT_OF_LOADING', locationName: 'Jebel Ali', country: 'United Arab Emirates', riskScore: 15, sanctionsConcern: false },
          { nodeType: 'TRANSIT_PORT', locationName: 'Bandar Abbas', country: 'Iran', riskScore: 100, sanctionsConcern: true },
          { nodeType: 'PORT_OF_DISCHARGE', locationName: 'Poti', country: 'Georgia', riskScore: 25, sanctionsConcern: false },
          { nodeType: 'FINAL_DESTINATION', locationName: 'Azerbaijan', country: 'Azerbaijan', riskScore: 25, sanctionsConcern: false },
        ],
        hasUnusualTransshipment: true,
        hasCircularRouting: true,
        overallRouteRiskScore: 95,
        routeSummary: 'Jebel Ali (AEJEA) -> Bandar Abbas (IRBND) [SANCTIONED] -> Poti (GEPTI)',
      },
      maritimeIntelligence: {
        declaredRoute: {
          origin: 'United Arab Emirates',
          portOfLoading: 'Jebel Ali',
          loadingLocode: 'AEJEA',
          transitHubs: ['Georgia'],
          portOfDischarge: 'Poti',
          dischargeLocode: 'GEPTI',
          finalDestination: 'Azerbaijan',
          etd: '2026-07-02',
          eta: '2026-07-28',
        },
        observedRoute: {
          originPort: { name: 'Jebel Ali', locode: 'AEJEA', country: 'United Arab Emirates', countryCode: 'AE' },
          portOfLoading: { name: 'Jebel Ali', locode: 'AEJEA', country: 'United Arab Emirates', countryCode: 'AE' },
          intermediateCalls: [
            {
              port: { name: 'Bandar Abbas', locode: 'IRBND', country: 'Iran', countryCode: 'IR' },
              arrivalTime: '2026-07-08T14:00:00Z',
              departureTime: '2026-07-12T08:00:00Z',
              wasDeclared: false,
              jurisdictionRiskLevel: 'SANCTIONED',
              jurisdictionExplanation: 'CRITICAL: Port is located in comprehensively sanctioned jurisdiction (Iran). 4-day dwell time observed.',
            },
            {
              port: { name: 'Karachi', locode: 'PKKHI', country: 'Pakistan', countryCode: 'PK' },
              arrivalTime: '2026-07-20T16:00:00Z',
              departureTime: '2026-07-21T18:00:00Z',
              wasDeclared: false,
              jurisdictionRiskLevel: 'CLEAR',
              jurisdictionExplanation: 'Intermediate bunkering call.',
            },
          ],
          portOfDischarge: { name: 'Poti', locode: 'GEPTI', country: 'Georgia', countryCode: 'GE' },
          departureTime: '2026-07-02T10:00:00Z',
          arrivalTime: '2026-07-28T16:00:00Z',
        },
        vessel: {
          imo: '9181156',
          mmsi: '351123000',
          name: 'GULF RUNNER',
          flag: 'Panama',
          vesselType: 'General Cargo Carrier',
          confidence: 0.99,
        },
        intermediatePortsCount: 2,
        undeclaredIntermediatePortsCount: 2,
        undeclaredPorts: [
          { name: 'Bandar Abbas', locode: 'IRBND', country: 'Iran', countryCode: 'IR' },
          { name: 'Karachi', locode: 'PKKHI', country: 'Pakistan', countryCode: 'PK' },
        ],
        routeClassification: 'HIGH_RISK_ROUTING',
        routeDeviationDetected: true,
        routeRiskLevel: 'CRITICAL',
        routeRiskScore: 90,
        routeFindings: [
          'CRITICAL HIGH-RISK MARITIME ROUTING: Vessel called at comprehensively sanctioned port Bandar Abbas (IRBND, Iran) for 4 days during voyage window.',
          'Intermediate transit call was concealed / omitted from presented commercial invoice and ocean transport documentation.',
          'Commodity involves controlled Category 2 Wassenaar dual-use CNC motion controllers subject to strict non-proliferation embargoes.',
        ],
        evidenceRecords: [
          {
            provider: 'VesselFinder-AIS-Engine',
            query: 'IMO:9181156 | GULF RUNNER [Jebel Ali -> Poti]',
            vesselIdentifier: 'IMO 9181156 (GULF RUNNER)',
            dateRange: '2026-07-02 to 2026-07-28',
            retrievedTimestamp: '2026-08-20T11:45:00Z',
            observedPorts: [
              'Jebel Ali (AEJEA) [DEPARTURE: 2026-07-02]',
              'Bandar Abbas (IRBND) [ARRIVAL: 2026-07-08 / DEPARTURE: 2026-07-12]',
              'Karachi (PKKHI) [CALL: 2026-07-20]',
              'Poti (GEPTI) [ARRIVAL: 2026-07-28]',
            ],
            dataConfidence: 0.99,
            sourceReference: 'AIS Automated Port-Call Digest • Ref VOY-GULF-IRBND-03',
          },
        ],
        limitationNotice:
          'Vessel-level route evidence does not by itself establish cargo-level transshipment. Historical port-call records reflect observed vessel movements during the relevant voyage window, which may include customary commercial transshipment or multi-port discharge operations.',
      },
      pricingIntelligence: [
        {
          itemNumber: 1,
          productDescription: 'High-Precision 5-Axis Multi-Axis CNC Digital Motion Controllers',
          declaredUnitPrice: 68333.33,
          declaredCurrency: 'USD',
          hsCode: '846693',
          hasMarketData: true,
          benchmarkUnitPriceUsd: 65000,
          observedMarketLowUsd: 58000,
          observedMarketHighUsd: 72000,
          priceVariancePercent: 5.1,
          classification: 'FAIR_MARKET_PRICE',
          evidenceRecords: [],
        },
      ],
      customerBehavioralAssessment: {
        customerProfile: {
          customerReferenceId: 'TG-CUST-100499',
          legalName: 'Caspian Gateway Trading LLC',
          normalizedName: 'caspian gateway trading llc',
          aliases: ['Caspian Gateway Logistics'],
          country: 'United Arab Emirates',
          declaredBusinessActivity: 'Commercial re-export and trading of general merchandise.',
          lifetimeTransactionCount: 8,
          lifetimeVolumeUsd: 2100000,
          averageTransactionValueUsd: 262500,
          monthlyLcFrequency: 1.0,
          establishedProductCategories: ['General Hardware', 'Construction Supplies'],
          establishedCountries: ['Azerbaijan', 'Georgia'],
          regularSuppliers: ['Gulf General Trading'],
          regularBuyers: ['Caspian Precision Mechanics'],
        },
        entityResolution: {
          customerReferenceId: 'TG-CUST-100499',
          matchedName: 'Caspian Gateway Trading LLC',
          matchConfidence: 0.98,
        },
        baselines: {
          customerReferenceId: 'TG-CUST-100499',
          historicalLcFrequencyMean: 1.0,
          historicalLcFrequencyStdDev: 0.3,
          historicalAverageValueUsd: 262500,
          establishedCategories: ['General Hardware'],
          establishedCountries: ['Azerbaijan'],
          establishedSuppliers: ['Gulf General Trading'],
          establishedBuyers: ['Caspian Precision Mechanics'],
        },
        alerts: [
          {
            alertId: 'ALT-PROD-2026-03',
            customerReferenceId: 'TG-CUST-100499',
            transactionId: 'TXN-2026-AE-IR-003',
            alertCode: 'PRODUCT_PROFILE_CHANGE',
            severity: 'HIGH',
            metric: 'Customer Traded Commodity Profile',
            baselineValue: 'General Hardware, Construction Supplies',
            observedValue: 'Controlled 5-Axis CNC Motion Controllers',
            explanation: 'Sudden migration from low-tech construction hardware to controlled military/industrial dual-use CNC hardware.',
            evidence: ['Historical average: $262k USD vs Current presentation: $840k USD (+220% spike)'],
            detectedAt: '2026-08-20T11:45:00Z',
            requiresEnhancedReview: true,
          },
          {
            alertId: 'ALT-GEO-2026-03',
            customerReferenceId: 'TG-CUST-100499',
            transactionId: 'TXN-2026-AE-IR-003',
            alertCode: 'NEW_HIGH_RISK_JURISDICTION_EXPOSURE',
            severity: 'HIGH',
            metric: 'Geographic Trade Corridor',
            baselineValue: 'UAE -> Azerbaijan',
            observedValue: 'Bandar Abbas (Iran)',
            explanation: 'Vessel called at comprehensively sanctioned Iranian port absent from customer profile.',
            evidence: ['AIS confirmed 4-day dwell in Bandar Abbas (IRBND).'],
            detectedAt: '2026-08-20T11:45:00Z',
            requiresEnhancedReview: true,
          },
        ],
        behavioralRiskScore: 92,
        behavioralRiskLevel: 'HIGH',
        behavioralSummary: 'CRITICAL BEHAVIORAL PROFILE SPIKE: Dual alerts triggered for high-risk Iranian jurisdiction exposure and dual-use product migration.',
        analyticalRecommendations: ['IMMEDIATE BLOCK: Escalate to Chief Compliance Officer and Money Laundering Reporting Officer (MLRO).'],
      },
      riskScores: {
        sanctions: 95,
        exportControl: 90,
        goods: 85,
        tbml: 90,
        endUse: 95,
        endUser: 90,
        documentIntegrity: 60,
        geographic: 95,
        transactionAnomaly: 90,
        overall: 92,
      },
      decision: {
        decision: 'BLOCK_ESCALATE',
        confidence: 0.99,
        reasons: [
          'CRITICAL SANCTIONS VIOLATION: Consignee is 55% owned by OFAC-designated entity (Blocked under OFAC 50% Rule).',
          'HIGH-RISK MARITIME ROUTING: Vessel called at comprehensively sanctioned Iranian port (Bandar Abbas - IRBND) with 4-day unannounced dwell.',
          'CONTROLLED DUAL-USE GOODS: 5-Axis CNC motion controllers classified under Wassenaar 2B001.a presented without required export authorization.',
          'OMITTED TRANSIT DISCREPANCY: Transport documentation concealed intermediate call at sanctioned jurisdiction.',
        ],
        triggeredRules: [
          'RULE_OFAC_50_PERCENT_BLOCKED_OWNERSHIP',
          'RULE_HIGH_RISK_MARITIME_ROUTING',
          'RULE_CONTROLLED_DUAL_USE_UNLICENSED',
          'RULE_ROUTING_CONCEALMENT_DISCREPANCY',
        ],
        missingInformation: [
          'Valid Dual-Use Export Authorization License.',
          'Certified End-User Certificate (EUC) countersigned by Ministry of Defense/Trade.',
        ],
        recommendedActions: [
          'IMMEDIATE ACTION: Freeze letter of credit processing and halt document release.',
          'File Suspicious Activity Report (SAR) with Financial Intelligence Unit.',
          'Escalate to Group Head of Financial Crime Compliance and Legal Counsel.',
        ],
        evidenceFindings: [
          {
            id: 'EV-BLK-01',
            finding: 'OFAC 50% Rule Blocked Beneficial Ownership',
            severity: 'CRITICAL',
            evidence: 'Trans-Caspian Forwarding LLC is 55% owned by Sepahan Industrial Engineering Holdings (OFAC SDN designated).',
            sourceDocument: 'Entity Corporate Registry & OFAC SDN Register',
            reason: 'Mandatory property blocking under Executive Order 13871.',
            confidence: 0.99,
            recommendedAction: 'Freeze all funds and property interests.',
          },
          {
            id: 'EV-BLK-02',
            finding: 'Sanctioned Maritime Port Call & Dwell',
            severity: 'CRITICAL',
            evidence: 'Vessel GULF RUNNER berthed at Bandar Abbas, Iran from 2026-07-08 to 2026-07-12.',
            sourceDocument: 'AIS Historical Port Tracking',
            reason: 'Concealed transit via comprehensively sanctioned Iranian port.',
            confidence: 0.99,
            recommendedAction: 'Halt financing and initiate regulatory disclosure.',
          },
          {
            id: 'EV-BLK-03',
            finding: 'Unlicensed Dual-Use Controlled Machinery',
            severity: 'CRITICAL',
            evidence: 'HS 846693 / ECCN 2B001.a 5-axis digital motion controllers.',
            sourceDocument: 'Wassenaar Dual-Use Industrial Controls List',
            reason: 'Non-proliferation export license required prior to maritime carriage.',
            confidence: 0.98,
            recommendedAction: 'Require presentation of valid government export license.',
          },
        ],
      },
      auditTrail: {
        auditTrailId: 'AUD-2026-IR-003',
        events: [
          { timestamp: '2026-08-20T11:45:02Z', event: 'DOCUMENT_UPLOADED', actor: 'Operations Portal' },
          { timestamp: '2026-08-20T11:45:06Z', event: 'BENEFICIAL_OWNERSHIP_ALERT', actor: 'Ownership Graph Engine' },
          { timestamp: '2026-08-20T11:45:10Z', event: 'SANCTIONED_PORT_CALL_DETECTED', actor: 'Maritime AIS Module' },
          { timestamp: '2026-08-20T11:45:15Z', event: 'DECISION_FINALIZED_BLOCK_ESCALATE', actor: 'Compliance Rule Engine' },
        ],
      },
    },
  },
} as unknown as DocumentRecord);

// ============================================================================
// GENERATION RUNNER
// ============================================================================
async function run() {
  console.log('Generating 3 authoritative sample compliance dossiers...\n');

  const samples = [
    {
      num: 1,
      doc: sample1Doc,
      label: 'Sample_1_ALLOW_Compliant_PointToPoint',
    },
    {
      num: 2,
      doc: sample2Doc,
      label: 'Sample_2_REVIEW_Commercial_Transshipment',
    },
    {
      num: 3,
      doc: sample3Doc,
      label: 'Sample_3_BLOCK_HighRisk_Sanctioned_Transit',
    },
  ];

  for (const s of samples) {
    const custRef = s.doc.analysis?.tradeCompliance?.transaction.customerReference || 'GENERAL';
    const txnRef = s.doc.analysis?.tradeCompliance?.transaction.transactionId || `TXN-00${s.num}`;

    // 1. Generate PDF Report
    console.log(`[Sample ${s.num}] Generating PDF Report: ${s.label}...`);
    const pdfBuf = await generatePdfReport(s.doc);
    const pdfFileName = `TradeGuard_Compliance_Dossier_${custRef}_${txnRef}.pdf`;
    const pdfPath = path.resolve(outputDir, pdfFileName);
    fs.writeFileSync(pdfPath, pdfBuf);
    console.log(`  -> Saved PDF (${pdfBuf.length} bytes): ${pdfPath}`);

    // 2. Generate Full Structured JSON DTO (Ready for AI Agent Ingestion)
    const reportModel = buildComplianceReportModel(s.doc);
    const jsonFileName = `TradeGuard_Compliance_Dossier_${custRef}_${txnRef}.json`;
    const jsonPath = path.resolve(outputDir, jsonFileName);
    fs.writeFileSync(jsonPath, JSON.stringify(reportModel, null, 2), 'utf8');
    console.log(`  -> Saved Structured JSON DTO: ${jsonPath}`);

    // 3. Generate Complete Machine/Human Readable Text Dossier
    const txtFileName = `TradeGuard_Compliance_Dossier_${custRef}_${txnRef}.txt`;
    const txtPath = path.resolve(outputDir, txtFileName);
    const textDossier = formatTextDossier(reportModel);
    fs.writeFileSync(txtPath, textDossier, 'utf8');
    console.log(`  -> Saved Text Dossier: ${txtPath}\n`);
  }

  // Create an Index README in sample_reports
  const readmePath = path.resolve(outputDir, 'README.md');
  const readmeContent = `# TradeGuard Intelligence — Authoritative Sample Compliance Dossiers

This directory contains **exactly 3 comprehensive compliance dossiers** representing the full spectrum of trade finance banking decisions:

1. **Sample 1: ALLOW — Pass Verification**
   - **File**: \`TradeGuard_Compliance_Dossier_TG-CUST-100319_TXN-2026-DE-UK-001.pdf\` / \`.json\` / \`.txt\`
   - **Scenario**: Direct point-to-point sea transit from Hamburg to Southampton.
   - **Verdict**: ALLOW (Risk Score: 8/100, 98% Confidence).
   - **Key Features**: Clean point-in-time sanctions, fair market price validation, direct point-to-point AIS verification, 100% documentary reconciliation.

2. **Sample 2: REVIEW — Enhanced Due Diligence**
   - **File**: \`TradeGuard_Compliance_Dossier_TG-CUST-100882_TXN-2026-CN-PK-002.pdf\` / \`.json\` / \`.txt\`
   - **Scenario**: Commercial transshipment along the China-Pakistan maritime corridor via Singapore, Port Klang, and Colombo.
   - **Verdict**: REVIEW (Risk Score: 38/100, 94% Confidence).
   - **Key Features**: Multi-port relay hubs detected (2 undeclared intermediate calls at Port Klang and Colombo), customer routing baseline divergence (\`ROUTING_PROFILE_CHANGE\`), full legal cargo limitation notice.

3. **Sample 3: BLOCK / ESCALATE — Critical Violation**
   - **File**: \`TradeGuard_Compliance_Dossier_TG-CUST-100499_TXN-2026-AE-IR-003.pdf\` / \`.json\` / \`.txt\`
   - **Scenario**: High-risk concealed maritime port call at Bandar Abbas, Iran combined with unlicensed Wassenaar Category 2 dual-use CNC hardware and OFAC 50% Rule blocked ownership.
   - **Verdict**: BLOCK / ESCALATE (Risk Score: 92/100, 99% Confidence).
   - **Key Features**: Concealed intermediate transit in comprehensively sanctioned jurisdiction, 4-day dwell time, 55% blocked beneficial ownership, dual-use proliferation evasion alert.

---

### Machine-Readable Ingestion for AI Agents
Each sample report is accompanied by a **\`.json\` file** containing the complete, validated \`ComplianceReportModel\` DTO with every single field, timestamp, UN/LOCODE, risk score breakdown, and cryptographic evidence package ready for immediate programmatic analysis.
`;
  fs.writeFileSync(readmePath, readmeContent, 'utf8');
  console.log(`Generated sample_reports/README.md successfully!`);
}

function formatTextDossier(m: any): string {
  const line = '='.repeat(84);
  const subline = '-'.repeat(84);

  return `${line}
TRADEGUARD INTELLIGENCE — TRADE COMPLIANCE & SANCTIONS DOSSIER
OFFICIAL AUDIT REPORT • STRICTLY CONFIDENTIAL
${line}
Document File    : ${m.filename} (${m.fileType}, ${m.fileSizeFormatted})
Screened At      : ${m.screenedAtFormatted}
Engine Provider  : ${m.engineProvider}
Transaction Ref  : ${m.transactionProfile.transactionReference}
Customer Golden  : ${m.transactionProfile.customerReference}

${subline}
A. EXECUTIVE SUMMARY & COMPLIANCE VERDICT
${subline}
Verdict          : ${m.executiveDecision.verdictTitle}
Assessment       : ${m.executiveDecision.verdictText}
Confidence       : ${m.executiveDecision.confidencePercent}% (Deterministic Rules Engine)
Risk Score       : ${m.executiveDecision.overallRiskScore}/100 [${m.executiveDecision.riskSeverityLabel}]
Triggered Rules  : ${m.executiveDecision.triggeredRules.join(', ') || 'None (Standard Clearance)'}

Primary Rationale:
${m.executiveDecision.primaryRationale.map((r: string) => `  * ${r}`).join('\n')}

${subline}
B. TRANSACTION & COUNTERPARTIES PROFILE
${subline}
Document Type    : ${m.transactionProfile.documentType} (Doc No: ${m.transactionProfile.documentNumber}, Date: ${m.transactionProfile.documentDate})
Seller/Exporter  : ${m.transactionProfile.sellerName} [${m.transactionProfile.sellerCountry}]
Buyer/Importer   : ${m.transactionProfile.buyerName} [${m.transactionProfile.buyerCountry}]
Consignee        : ${m.transactionProfile.consignee || 'As per Bill of Lading'}
Ultimate End-User: ${m.transactionProfile.endUser || 'Not Disclosed / Missing EUC'}
Financial Banks  : Issuing: ${m.transactionProfile.issuingBank || 'Direct'} | Advising: ${m.transactionProfile.advisingBank || 'Direct'}
Shipment Corridor: ${m.transactionProfile.originCountry} (${m.transactionProfile.portOfLoading}) -> ${m.transactionProfile.destinationCountry} (${m.transactionProfile.portOfDischarge})
Vessel Carrier   : ${m.transactionProfile.vesselName || 'Unspecified'} (IMO: ${m.transactionProfile.vesselImo || 'N/A'})
Financial Terms  : ${m.transactionProfile.totalValueFormatted} [Incoterm: ${m.transactionProfile.incoterm}] | ${m.transactionProfile.paymentTerms}

${subline}
C. POINT-IN-TIME SANCTIONS & WATCHLIST SCREENING
${subline}
Watchlist Status : ${m.sanctionsSummary.status}
Historical Nexus : ${m.sanctionsSummary.historicalFindingsSummary}
Current Register : ${m.sanctionsSummary.currentFindingsSummary}
50% Rule Status  : ${m.sanctionsSummary.beneficialOwnershipVerdict}
Screened Entities: ${m.sanctionsSummary.screenedPartiesCount} Parties Verified

${subline}
D. MARITIME ROUTE INTELLIGENCE & TRANSSHIPMENT DETECTION
${subline}
Declared Route   : ${m.routeIntelligence.declaredRouteSummary}
Observed Calls   : ${m.routeIntelligence.observedRouteSummary}
Vessel Identity  : ${m.routeIntelligence.vesselIdentifier}
Intermediate Hubs: ${m.routeIntelligence.intermediatePortsCount} Total Calls (${m.routeIntelligence.undeclaredIntermediatePortsCount} Undeclared in Presented Docs)
Classification   : ${m.routeIntelligence.routeClassification}
Route Deviation  : ${m.routeIntelligence.routeDeviationDetected ? 'DETECTED' : 'CONFORMANT'}
Route Risk Score : ${m.routeIntelligence.routeRiskScore}/100 [${m.routeIntelligence.routeRiskLevel}]
Evidence Digest  : ${m.routeIntelligence.evidenceSummary}

Observed Port-Call Timeline:
${m.routeIntelligence.observedCallsTimeline.map((c: any) => `  * ${c.portName} (${c.locode}, ${c.country}) - ${c.timestamp} [Declared: ${c.isDeclared ? 'YES' : 'NO [!]'}]`).join('\n') || '  * Direct point-to-point carriage observed.'}

Findings:
${m.routeIntelligence.routeFindings.map((f: string) => `  * ${f}`).join('\n')}

Mandatory Notice : ${m.routeIntelligence.limitationNotice}

${subline}
E. REAL-TIME MARKET PRICING INTELLIGENCE
${subline}
${m.pricingIntelligence.items.map((pi: any) => `Item #${pi.itemNumber}: ${pi.description} (HS: ${pi.hsCode})
  Declared: ${pi.declaredPrice} | Benchmark: ${pi.benchmarkPrice} | Variance: ${pi.variancePercent} [${pi.classification}]
  Authority: ${pi.authorityExcerpt}`).join('\n\n') || 'No pricing anomalies detected.'}

${subline}
F. CUSTOMER 360 & BEHAVIORAL BASELINE ANALYSIS
${subline}
Golden Record    : ${m.customerBehavior?.customerReferenceId} (${m.customerBehavior?.legalName})
Declared Core    : ${m.customerBehavior?.declaredBusiness}
Baseline Volume  : Mean: ${m.customerBehavior?.historicalLcFrequencyMean} | Lifetime: ${m.customerBehavior?.lifetimeVolumeFormatted}
Alerts Triggered : ${m.customerBehavior?.alerts.length || 0}
${(m.customerBehavior?.alerts || []).map((a: any) => `  * [${a.alertCode}] ${a.metric}: ${a.explanation}\n    Observed: ${a.observedValue} vs Baseline: ${a.baselineValue}`).join('\n')}

${subline}
G. 9-FACTOR RISK SCORE MATRIX
${subline}
${m.riskScores.map((s: any) => `${s.label.padEnd(35)}: ${s.score}/100`).join('\n')}

${subline}
H. CRYPTOGRAPHIC PROVENANCE & AUDIT SEAL
${subline}
Package ID       : ${m.evidenceDigest.packageId}
Document SHA-256 : ${m.evidenceDigest.documentSha256}
Transaction Hash : ${m.evidenceDigest.transactionHashSha256}
Verification Seal: ${m.evidenceDigest.verificationDigestSha256}
Rule Set Version : ${m.evidenceDigest.ruleSetVersion}
${line}
END OF TRADEGUARD COMPLIANCE DOSSIER
${line}
`;
}

run().catch((err) => {
  console.error('Failed to generate sample reports:', err);
  process.exit(1);
});
