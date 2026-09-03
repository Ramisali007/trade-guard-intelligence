import fs from 'node:fs';
import path from 'node:path';
import { initRepository, closeRepository } from '../src/services/document.repository';
import { DocumentService } from '../src/services/document.service';
import { AnalysisService } from '../src/services/analysis.service';

const sampleReportsDir = path.resolve(__dirname, '../../sample_reports');

const filesToIngest = [
  'Liberty_Mills_Commercial_Invoice_INV-5771.pdf',
  'Liberty_Mills_Sales_Contract_CTR-050.pdf',
  'Cosco_Shipping_Sea_Waybill_COSU6445585470.pdf',
  'Pakistan_Customs_GD_Bill_of_Export_GD2905.pdf',
];

async function ingestAll() {
  console.log('Ingesting and analyzing all 4 sample documents into TradeGuard repository...');
  const repo = await initRepository();
  const docService = new DocumentService();
  const analysisService = new AnalysisService(repo);

  const ingestedIds: string[] = [];

  for (const filename of filesToIngest) {
    const fullPath = path.join(sampleReportsDir, filename);
    if (!fs.existsSync(fullPath)) {
      console.warn(`File not found: ${fullPath}`);
      continue;
    }

    const buffer = fs.readFileSync(fullPath);
    console.log(`\nUploading ${filename} (${buffer.length} bytes)...`);

    const doc = await docService.createFromUpload(
      {
        originalname: filename,
        mimetype: 'application/pdf',
        size: buffer.length,
        buffer,
      },
      { autoStart: false },
    );

    console.log(`Document created with ID: ${doc.id}. Running AI analysis pipeline...`);
    await analysisService.run(doc.id);

    const status = await docService.getStatus(doc.id);
    console.log(`Document ${doc.id} (${filename}) finished with status: ${status.status} (${status.progress.percent}%)`);
    ingestedIds.push(doc.id);
  }

  console.log('\n================================================================');
  console.log('All 4 Sample Documents Ingested & Analyzed Successfully!');
  console.log('Ingested Document IDs:', ingestedIds);
  console.log('================================================================');

  await closeRepository();
}

ingestAll().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
