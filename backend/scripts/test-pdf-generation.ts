import fs from 'node:fs';
import path from 'node:path';
import { generatePdfReport } from '../src/services/pdf-report.service';
import { TradeComplianceExtractor } from '../src/ai/trade-extractor';
import type { DocumentRecord } from '../src/models/document.model';

async function testPdf() {
  const extractor = new TradeComplianceExtractor();
  const sampleText = `COMMERCIAL INVOICE
Invoice Number: INV-2026-8891
Date: 2026-06-15
Exporter: Apex Textiles Global Ltd, Karachi, Pakistan (NTN-3029148-7)
Buyer: British Fashion Retailers PLC, London, United Kingdom
Letter of Credit: LC-994821
Incoterm: CIF
Currency: USD
Item 1: Men 100% Cotton Woven Shirts, Quantity: 5000 PCS, Unit Price: 26.50 USD, Total: 132500 USD
Origin: Pakistan
Destination: United Kingdom`;

  const result = await extractor.processTradeDocument({
    documentId: 'doc-test-pdf',
    filename: 'test-invoice.pdf',
    rawText: sampleText,
    rawBuffer: Buffer.from(sampleText),
    aiModel: 'pipeline-verification-engine',
    aiJsonOutput: {
      documentClassification: {
        documentType: 'COMMERCIAL_INVOICE',
        number: 'INV-2026-8891',
        date: '2026-06-15',
        originCountry: 'Pakistan',
        destinationCountry: 'United Kingdom',
      },
      parties: {
        seller: {
          role: 'SELLER_EXPORTER',
          legalName: 'Apex Textiles Global Ltd',
          taxVatNumber: 'NTN-3029148-7',
          country: 'Pakistan',
          address: 'Plot 44-B, Sector 15, Korangi Industrial Area, Karachi, Pakistan',
        },
        buyer: {
          role: 'BUYER_IMPORTER',
          legalName: 'British Fashion Retailers PLC',
          country: 'United Kingdom',
          address: '100 Oxford Street, London, United Kingdom',
        },
      },
      goods: [
        {
          id: 'ITEM-1',
          itemNumber: 1,
          productDescription: 'Men 100% Cotton Woven Shirts',
          quantity: 5000,
          unitOfMeasure: 'PCS',
          unitPrice: 26.50,
          totalLineValue: 132500,
          currency: 'USD',
          hsCode: '6205.20.00',
          isAuthorizedScope: true,
          isControlledOrDualUse: false,
          riskSeverity: 'LOW',
        },
      ],
      pricingAndFinancials: {
        totalAmount: 132500,
        currency: 'USD',
        incoterm: 'CIF',
      },
      routingAndLogistics: {
        originCountry: 'Pakistan',
        destinationCountry: 'United Kingdom',
      },
    },
  });

  const mockDoc = {
    id: 'doc-test-pdf',
    filename: 'test-invoice.pdf',
    fileType: 'pdf',
    mimeType: 'application/pdf',
    fileSize: 10240,
    storageKey: 'test.pdf',
    sha256: 'a'.repeat(64),
    status: 'completed',
    progress: {
      stages: [],
      percent: 100,
      analyzedUnits: 1,
      totalUnits: 1,
      completedBatches: 1,
      totalBatches: 1,
      etaSeconds: null,
    },
    uploadedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    extraction: null,
    analysis: {
      summary: {
        headline: 'Commercial Invoice point-in-time compliance report',
        narrative: 'Sample invoice analysis',
        dominantSentiment: 'neutral',
        dominantEmotion: 'neutral',
        dominantContentType: 'transactional',
        dominantTopic: 'Trade Finance',
        source: 'derived' as const,
        highlights: [],
      },
      statistics: {
        totalPages: 1,
        totalUnits: 1,
        analyzedUnits: 1,
        skippedShortUnits: 0,
        skippedOverCapUnits: 0,
        totalWords: sampleText.split(/\s+/).length,
        totalCharacters: sampleText.length,
        aiClassifiedUnits: 1,
        heuristicClassifiedUnits: 0,
        averageConfidence: 0.95,
        distributions: {},
        unitTypeDistribution: {},
        pageTimeline: [],
        topKeywords: [],
        sectionBreakdown: [],
      },
      timing: {
        totalDurationMs: 60,
      },
      engine: {
        provider: 'pipeline-verification-engine',
        model: 'gemini-flash-lite-latest',
        isLocalFallback: false,
      },
      completedAt: new Date().toISOString(),
      tradeCompliance: result,
    },
    error: null,
  } as unknown as DocumentRecord;


  const pdfBuffer = await generatePdfReport(mockDoc);
  const outPath = path.resolve(process.cwd(), 'scratch', 'test-compliance-dossier.pdf');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, pdfBuffer);

  console.log('PDF generated successfully!');
  console.log('Size:', pdfBuffer.length, 'bytes');
  console.log('Saved to:', outPath);
}

testPdf().catch((err) => {
  console.error('PDF Generation Failed:', err);
  process.exit(1);
});
