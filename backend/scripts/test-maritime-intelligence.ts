import { MaritimeService } from '../src/compliance/maritime';
import { generatePdfReport } from '../src/services/pdf-report.service';
import type { DocumentRecord } from '../src/models/document.model';
import * as fs from 'fs';
import * as path from 'path';

async function runMaritimeRegressionTest() {
  console.log('=== RUNNING MARITIME ROUTE INTELLIGENCE REGRESSION TEST ===\n');

  const maritimeService = MaritimeService.getInstance();

  // Test Case 1: Commercial Transshipment Corridor (COSCO SHIPPING PEKING / IMO 9731937)
  console.log('Test 1: Testing COSCO SHIPPING PEKING (IMO 9731937) Shanghai -> Karachi corridor...');
  const res1 = await maritimeService.analyzeShipmentRoute({
    vesselName: 'COSCO SHIPPING PEKING',
    vesselImo: '9731937',
    vesselMmsi: '477123456',
    portOfLoading: 'Shanghai',
    portOfDischarge: 'Karachi',
    originCountry: 'China',
    destinationCountry: 'Pakistan',
    declaredTransitHubs: ['Singapore'], // Singapore declared, but Port Klang & Colombo undeclared
    transactionTimestamp: '2026-08-10T00:00:00Z',
  });

  console.log('  Classification:', res1.routeClassification);
  console.log('  Risk Level:', res1.routeRiskLevel);
  console.log('  Risk Score:', res1.routeRiskScore);
  console.log('  Intermediate Ports Count:', res1.intermediatePortsCount);
  console.log('  Undeclared Intermediate Ports Count:', res1.undeclaredIntermediatePortsCount);
  console.log('  Undeclared Ports:', res1.undeclaredPorts.map((p) => p.name).join(', '));
  console.log('  Route Deviation Detected:', res1.routeDeviationDetected);
  console.log('  Limitation Notice Present:', res1.limitationNotice.includes('Vessel-level route evidence does not by itself establish cargo-level transshipment'));

  if (!res1.routeDeviationDetected || res1.undeclaredIntermediatePortsCount !== 2) {
    throw new Error(`Test 1 Failed: Expected 2 undeclared intermediate ports, got ${res1.undeclaredIntermediatePortsCount}`);
  }

  // Test Case 2: Sanctioned Maritime Call
  console.log('\nTest 2: Testing Sanctioned Port Exposure (Iran / Bandar Abbas IRBND)...');
  const routeRiskService = new (require('../src/compliance/maritime/route-risk.service').RouteRiskService)();
  const res2 = routeRiskService.evaluateRoute({
    declaredOrigin: 'United Arab Emirates',
    declaredPortOfLoading: 'Jebel Ali',
    declaredPortOfDischarge: 'Karachi',
    declaredDestination: 'Pakistan',
    voyage: {
      provider: 'VesselFinder-AIS-Engine',
      vessel: { imo: '9123456', name: 'GULF RUNNER' },
      voyageNumber: 'VOY-IR-TEST',
      voyageWindowStart: '2026-07-01T00:00:00Z',
      voyageWindowEnd: '2026-07-25T00:00:00Z',
      events: [
        {
          timestamp: '2026-07-02T10:00:00Z',
          event: 'DEPARTURE',
          port: { name: 'Jebel Ali', locode: 'AEJEA', country: 'United Arab Emirates', countryCode: 'AE' },
          source: 'AIS',
        },
        {
          timestamp: '2026-07-08T14:00:00Z',
          event: 'ARRIVAL',
          port: { name: 'Bandar Abbas', locode: 'IRBND', country: 'Iran', countryCode: 'IR' },
          source: 'AIS',
        },
        {
          timestamp: '2026-07-12T08:00:00Z',
          event: 'DEPARTURE',
          port: { name: 'Bandar Abbas', locode: 'IRBND', country: 'Iran', countryCode: 'IR' },
          source: 'AIS',
        },
        {
          timestamp: '2026-07-20T16:00:00Z',
          event: 'ARRIVAL',
          port: { name: 'Karachi', locode: 'PKKHI', country: 'Pakistan', countryCode: 'PK' },
          source: 'AIS',
        },
      ],
      dataConfidence: 0.98,
      retrievedAt: new Date().toISOString(),
    },
  });

  console.log('  Classification:', res2.routeClassification);
  console.log('  Risk Level:', res2.routeRiskLevel);
  console.log('  Risk Score:', res2.routeRiskScore);
  if (res2.routeClassification !== 'HIGH_RISK_ROUTING' || res2.routeRiskLevel !== 'CRITICAL') {
    throw new Error(`Test 2 Failed: Expected HIGH_RISK_ROUTING and CRITICAL, got ${res2.routeClassification} / ${res2.routeRiskLevel}`);
  }

  // Test Case 3: Complete PDF Generation with Rich Maritime Dossier
  console.log('\nTest 3: Generating full PDF report containing maritime intelligence...');
  const mockDoc = ({
    id: 'doc-maritime-test',
    filename: 'Commercial_Invoice_Transshipment_Corridor.pdf',
    fileSize: 45020,
    fileType: 'pdf',
    storageKey: 'storage/uploads/mock.pdf',
    uploadedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: 'completed',
    analysis: {
      engine: { provider: 'anthropic', model: 'claude-opus-5' },
      timings: { totalMs: 2500 },
      tradeCompliance: {
        documentClassification: {
          type: 'COMMERCIAL_INVOICE',
          subtype: 'EXPORT_INVOICE',
          number: 'EXP-2026-SH-KHI',
          date: '2026-08-10',
          issuer: 'East Asia Textiles Export Corp',
        },
        transaction: {
          transactionId: 'TXN-998822',
          invoiceNumber: 'EXP-2026-SH-KHI',
          invoiceDate: '2026-08-10',
          proformaInvoiceNumber: 'N/A',
          purchaseOrderNumber: 'PO-77881',
          salesContractNumber: 'SC-8812',
          letterOfCreditNumber: 'LC-2026-PKB-44',
          amendmentNumber: 'N/A',
          customerReference: 'TG-CUST-100882',
          shipmentReference: 'SHP-PEKING-01',
          bookingReference: 'BKG-COSCO-991',
          customsReference: 'CUSTOMS-SH-09',
          insuranceReference: 'INS-PACIFIC-12',
          parties: {
            seller: { legalName: 'East Asia Textiles Export Corp', country: 'China' },
            buyer: { legalName: 'Al-Manar Trading FZE', country: 'United Arab Emirates' },
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
          billOfLadingNumber: 'COSU-987654321',
          containerNumber: 'COSU1234567',
          etd: '2026-08-12',
          eta: '2026-08-30',
          shipmentDate: '2026-08-12',
          transshipmentDetails: 'Transshipment via Singapore',
          currency: 'USD',
          totalValue: 340000,
          subtotal: 340000,
          freightCharges: 12000,
          insuranceCharges: 2500,
          paymentTerms: 'LC at 60 Days Sight',
          incoterm: 'CIF',
          transactionTimestamp: '2026-08-10T00:00:00Z',
        },
        goods: [
          {
            itemNumber: 1,
            productDescription: '100% Cotton Combed Yarn 40s Ring Spun',
            hsCode: '520522',
            declaredQuantity: 50000,
            unitOfMeasure: 'KG',
            declaredUnitPrice: 6.8,
            declaredTotalPrice: 340000,
            isDualUseCandidate: false,
          },
        ],
        scopeValidation: { isDocumentInScope: true, confidence: 0.99, classification: 'COMMERCIAL_INVOICE' },
        endUseAnalysis: { riskLevel: 'LOW', explanation: 'Customary textile manufacturing commodity.' },
        sanctions: { status: 'CLEARED', screenedEntitiesCount: 4, matches: [], jurisdictionRisks: [] },
        temporalScreening: {
          transactionTimestamp: '2026-08-10T00:00:00Z',
          wasListedAtTransactionTime: false,
          isCurrentlyListed: false,
          hasPostTransactionDesignations: false,
          historicalFindingsSummary: 'No designated entities found at transaction time.',
          currentFindingsSummary: 'All entities remain cleared in active sanction registers.',
          temporalMatches: [],
          screenedEntitiesCount: 4,
          confidence: 0.98,
        },
        jurisdictionalNexus: [],
        sbpCompliance: { isEligibleForSBPProcessing: true, overallComplianceStatus: 'COMPLIANT', requiresPriorSBPApproval: false, sbpDiscrepancies: [] } as any,
        ownershipCompliance: { isBlockedUnderOfac50PercentRule: false, aggregateBlockedOwnershipPercentage: 0, checkedEntitiesCount: 2, highRiskEntitiesFound: [] },
        retrospectiveAlerts: [],
        auditEvidencePackage: {
          evidencePackageId: 'TG-AUD-MARITIME-TEST',
          documentSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          transactionHashSha256: '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
          verificationDigestSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
          ruleSetVersion: 'TG-MARITIME-V2026.3',
          regulatorySnapshotsUsed: [],
        } as any,
        exportControls: { isControlled: false, matchedItems: [] },
        evasionIndicators: [],
        tbml: { overallTbmlRiskScore: 15, indicatorsTriggered: [] },
        discrepancies: [],
        mathematicalValidation: { isMathematicallySound: true, discrepancies: [] },
        documentIntegrity: { overallIntegrityScore: 98, hasForgedLetterhead: false, discrepancies: [] },
        routeAnalysis: { nodes: [], hasUnusualTransshipment: true, hasCircularRouting: false, overallRouteRiskScore: 25, routeSummary: 'Shanghai -> Karachi' },
        maritimeIntelligence: res1,
        riskScores: {
          sanctions: 5,
          exportControl: 5,
          goods: 10,
          tbml: 15,
          endUse: 10,
          endUser: 10,
          documentIntegrity: 5,
          geographic: res1.routeRiskScore,
          transactionAnomaly: 20,
          overall: 24,
        },
        decision: {
          decision: 'REVIEW',
          confidence: 0.95,
          reasons: [
            'Commercial transshipment observed via Port Klang and Colombo.',
            'Customary textile goods under standard trade documentary credit.',
          ],
          triggeredRules: ['RULE_COMMERCIAL_TRANSSHIPMENT_DETECTED'],
          evidenceFindings: [
            {
              id: 'EV-ROUTE-01',
              finding: 'Commercial Transshipment at Regional Hubs',
              severity: 'LOW',
              evidence: 'Vessel called at Port Klang (MYPKG) and Colombo (LKCMB).',
              sourceDocument: 'AIS Historical Port-Call Digest',
              reason: 'Customary container relay operation for East Asia - South Asia corridor.',
              confidence: 0.98,
              recommendedAction: 'Confirm carrier through-bill of lading (TBL) covers transshipment leg.',
            },
          ],
        },
        auditTrail: {
          timestamp: new Date().toISOString(),
          actor: 'DocuIntel Engine',
          action: 'PROCESS_TRADE_DOCUMENT',
          details: 'Automatic trade intelligence evaluation completed.',
        },
      },
    },
  } as unknown as DocumentRecord);

  const pdfBuffer = await generatePdfReport(mockDoc);
  const outDir = path.resolve(__dirname, '..', 'scratch');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.resolve(outDir, 'TradeGuard_Maritime_Transshipment_Dossier_Test.pdf');
  fs.writeFileSync(outPath, pdfBuffer);

  console.log(`\nPDF generated successfully! Size: ${pdfBuffer.length} bytes.`);
  console.log(`Saved to: ${outPath}`);
  console.log('\n=== ALL MARITIME REGRESSION TESTS PASSED CLEANLY! ===\n');
}

runMaritimeRegressionTest().catch((err) => {
  console.error('Maritime Regression Test Failed:', err);
  process.exit(1);
});
