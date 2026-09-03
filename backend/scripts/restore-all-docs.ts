import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'node:path';
import dns from 'node:dns';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

async function restoreAll() {
  const uri = process.env.MONGODB_URI!;
  const dbName = process.env.MONGODB_DB || 'docuintel';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const res = await db.collection('documents').updateMany(
    {},
    { $set: { isArchived: false, archivedAt: null } }
  );

  console.log(`[Restore] Unarchived ${res.modifiedCount} documents in MongoDB Atlas.`);
  const total = await db.collection('documents').countDocuments({ isArchived: { $ne: true } });
  console.log(`[Restore] Active documents in MongoDB Atlas: ${total}`);

  await client.close();
}

restoreAll().catch(console.error);
