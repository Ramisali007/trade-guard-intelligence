const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const { MongoClient } = require('mongodb');

const CLOUD_URI = process.env.MONGODB_CLOUD_URI || process.env.CLOUD_URI || '';
const LOCAL_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.MONGODB_DB || 'docuintel';

if (!CLOUD_URI) {
  console.error('Error: MONGODB_CLOUD_URI is not set. Please provide it via environment variable or backend/.env file.');
  process.exit(1);
}

async function migrate() {
  console.log('====================================================');
  console.log('  MIGRATING DATA: MONGODB CLOUD ATLAS -> LOCAL COMMUNITY');
  console.log('====================================================\n');

  console.log('1. Connecting to Cloud Atlas...');
  const cloudClient = new MongoClient(CLOUD_URI);
  await cloudClient.connect();
  const cloudDb = cloudClient.db(DB_NAME);
  console.log('   ✔ Connected to Cloud Atlas.\n');

  console.log('2. Connecting to Local MongoDB Community (127.0.0.1:27017)...');
  const localClient = new MongoClient(LOCAL_URI);
  await localClient.connect();
  const localDb = localClient.db(DB_NAME);
  console.log('   ✔ Connected to Local MongoDB Server.\n');

  const collections = await cloudDb.listCollections().toArray();
  console.log(`Found ${collections.length} collections on Cloud Atlas to transfer:\n`);

  let totalDocsMigrated = 0;

  for (const colInfo of collections) {
    const colName = colInfo.name;
    const cloudCol = cloudDb.collection(colName);
    const localCol = localDb.collection(colName);

    const count = await cloudCol.countDocuments();
    if (count === 0) {
      console.log(` - ${colName}: 0 documents (skipped)`);
      continue;
    }

    process.stdout.write(` - ${colName} (${count} documents)... `);

    // Fetch all documents from Cloud
    const docs = await cloudCol.find({}).toArray();

    // Clear existing local collection and insert
    await localCol.deleteMany({});
    if (docs.length > 0) {
      await localCol.insertMany(docs);
    }

    // Copy indexes (excluding default _id_)
    try {
      const indexes = await cloudCol.indexes();
      for (const idx of indexes) {
        if (idx.name === '_id_') continue;
        const key = idx.key;
        const options = { name: idx.name };
        if (idx.unique) options.unique = true;
        if (idx.expireAfterSeconds !== undefined) options.expireAfterSeconds = idx.expireAfterSeconds;
        await localCol.createIndex(key, options).catch(() => {});
      }
    } catch {}

    totalDocsMigrated += docs.length;
    console.log('DONE ✔');
  }

  console.log('\n====================================================');
  console.log(`✔ SUCCESS: ${totalDocsMigrated} total documents migrated across ${collections.length} collections!`);
  console.log('====================================================\n');
  console.log('To switch your backend to Local MongoDB Community:');
  console.log('In your backend/.env file, change:');
  console.log('MONGODB_URI=mongodb://127.0.0.1:27017/docuintel\n');

  await cloudClient.close();
  await localClient.close();
}

migrate().catch(console.error);
