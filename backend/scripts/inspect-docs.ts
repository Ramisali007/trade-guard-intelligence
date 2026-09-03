import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'node:path';
import dns from 'node:dns';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

async function inspect() {
  const uri = process.env.MONGODB_URI!;
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('docuintel');

  const docs = await db.collection('documents').find({}).toArray();
  console.log(`Total documents in Atlas: ${docs.length}`);
  for (const d of docs) {
    console.log(`- ID: ${d.id} | Name: ${d.filename} | Uploaded: ${d.uploadedAt} | Archived: ${d.isArchived}`);
  }

  await client.close();
}

inspect().catch(console.error);
