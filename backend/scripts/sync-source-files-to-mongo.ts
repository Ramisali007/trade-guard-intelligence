import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import dns from 'node:dns';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

async function syncFiles() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'docuintel';
  if (!uri) process.exit(1);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const docsCol = db.collection('documents');

  const sampleReportsDir = path.resolve(__dirname, '../../sample_reports');
  const docs = await docsCol.find({}).toArray();

  for (const doc of docs) {
    let buf: Buffer | null = null;
    const samplePath = path.join(sampleReportsDir, doc.filename);
    if (fs.existsSync(samplePath)) {
      buf = fs.readFileSync(samplePath);
    } else if (doc.storagePath && fs.existsSync(doc.storagePath)) {
      buf = fs.readFileSync(doc.storagePath);
    }

    if (buf) {
      await docsCol.updateOne(
        { id: doc.id },
        { $set: { fileBase64: buf.toString('base64') } }
      );
      console.log(`[Sync] Backed up original file binary to MongoDB Atlas: ${doc.filename} (${buf.length} bytes)`);
    }
  }

  await client.close();
  console.log('[Sync] All documents backed up to cloud database.');
}

syncFiles().catch(console.error);
