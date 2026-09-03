import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import dns from 'node:dns';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch {
  // fallback
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'docuintel';

  if (!uri) {
    console.error('MONGODB_URI not found in .env');
    process.exit(1);
  }

  console.log(`[Mongo Test] Connecting to MongoDB Atlas (${dbName})...`);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });

  try {
    await client.connect();
    console.log('[Mongo Test] Connected successfully to MongoDB Atlas Cluster0!');

    const db = client.db(dbName);
    const collections = await db.listCollections().toArray();
    console.log('[Mongo Test] Existing collections:', collections.map((c) => c.name));

    // Migrate existing local documents from storage/data/*.json to MongoDB Atlas if not present
    const dataDir = path.resolve(__dirname, '..', 'storage', 'data');
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json') && !f.endsWith('.report.txt'));
      console.log(`[Mongo Test] Found ${files.length} local document records in storage/data to sync to MongoDB Atlas...`);

      const docsCollection = db.collection('documents');
      const unitsCollection = db.collection('document_units');

      for (const file of files) {
        const fullPath = path.join(dataDir, file);
        const record = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

        const existing = await docsCollection.findOne({ id: record.id });
        if (!existing) {
          const { units, ...meta } = record;
          await docsCollection.insertOne({ ...meta, units: [] });

          if (units && units.length > 0) {
            const unitsWithDocId = units.map((u: any) => ({ ...u, documentId: record.id }));
            await unitsCollection.insertMany(unitsWithDocId);
          }
          console.log(`[Mongo Test] Synced document to MongoDB Atlas: ${record.filename} (${record.id})`);
        } else {
          console.log(`[Mongo Test] Document already exists in MongoDB Atlas: ${record.filename} (${record.id})`);
        }
      }
    }

    // Ensure Indexes
    const docsCollection = db.collection('documents');
    const unitsCollection = db.collection('document_units');
    await docsCollection.createIndex({ id: 1 }, { unique: true });
    await docsCollection.createIndex({ uploadedAt: -1 });
    await unitsCollection.createIndex({ documentId: 1, paragraphNumber: 1 });
    await unitsCollection.createIndex({ documentId: 1, pageNumber: 1 });

    const count = await docsCollection.countDocuments();
    console.log(`[Mongo Test] Total documents stored in MongoDB Atlas cloud db: ${count}`);
    console.log('[Mongo Test] MongoDB Atlas Cloud Storage is 100% active and operational!');
  } catch (err) {
    console.error('[Mongo Test] Failed to connect or sync to MongoDB Atlas:', err);
  } finally {
    await client.close();
  }
}

main();
