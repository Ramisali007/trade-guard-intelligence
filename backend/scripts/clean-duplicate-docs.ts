import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'node:path';
import dns from 'node:dns';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const canonicalIds = [
  'ecd64006-7b37-41e2-bdab-3e659e2c3db5',
  '44720bde-8ebd-459c-83f7-55e992609540',
  '8b7738c6-2c38-4d7d-a561-b5519ef2850d',
  '87c36992-67e3-49b3-a47f-6f07d23a2bd6',
];

async function clean() {
  const uri = process.env.MONGODB_URI!;
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('docuintel');

  // Remove duplicates outside canonical set
  const resDocs = await db.collection('documents').deleteMany({ id: { $nin: canonicalIds } });
  const resUnits = await db.collection('document_units').deleteMany({ documentId: { $nin: canonicalIds } });

  console.log(`Removed ${resDocs.deletedCount} duplicate documents and ${resUnits.deletedCount} duplicate units.`);

  const remaining = await db.collection('documents').find({}).toArray();
  console.log(`Remaining authentic documents (${remaining.length}):`);
  for (const d of remaining) {
    console.log(`- ${d.id}: ${d.filename}`);
  }

  await client.close();
}

clean().catch(console.error);
