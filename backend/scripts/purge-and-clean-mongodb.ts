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

async function purgeAndRebuild() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'docuintel';

  if (!uri) {
    console.error('MONGODB_URI not found');
    process.exit(1);
  }

  console.log(`[Mongo Purge] Connecting to MongoDB Atlas (${dbName})...`);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });

  try {
    await client.connect();
    const db = client.db(dbName);

    // 1. Drop existing collections to guarantee a fresh, 100% clean database
    const existingCollections = await db.listCollections().toArray();
    for (const col of existingCollections) {
      console.log(`[Mongo Purge] Dropping collection: ${col.name}`);
      await db.collection(col.name).drop().catch(() => undefined);
    }

    console.log('[Mongo Purge] Database wiped completely clean.');

    // 2. Clean local storage artifacts
    const dataDir = path.resolve(__dirname, '..', 'storage', 'data');
    const uploadsDir = path.resolve(__dirname, '..', 'storage', 'uploads');
    if (fs.existsSync(dataDir)) {
      for (const f of fs.readdirSync(dataDir)) {
        fs.unlinkSync(path.join(dataDir, f));
      }
      console.log('[Mongo Purge] Local storage/data cleaned.');
    }
    if (fs.existsSync(uploadsDir)) {
      for (const f of fs.readdirSync(uploadsDir)) {
        fs.unlinkSync(path.join(uploadsDir, f));
      }
      console.log('[Mongo Purge] Local storage/uploads cleaned.');
    }

    // 3. Create fresh collections with optimized compound indexes
    const documentsCol = db.collection('documents');
    const unitsCol = db.collection('document_units');
    const customersCol = db.collection('customers');

    await documentsCol.createIndex({ id: 1 }, { unique: true });
    await documentsCol.createIndex({ uploadedAt: -1 });
    await documentsCol.createIndex({ status: 1 });
    await unitsCol.createIndex({ documentId: 1, paragraphNumber: 1 });
    await unitsCol.createIndex({ documentId: 1, pageNumber: 1 });
    await customersCol.createIndex({ customerReferenceId: 1 }, { unique: true });
    await customersCol.createIndex({ normalizedName: 1 });
    await customersCol.createIndex({ taxVatNumber: 1 });

    // 4. Seed Golden Records into customers collection
    const libertyGoldenRecord = {
      customerReferenceId: 'TG-CUST-PK-0710609',
      legalName: 'Liberty Mills Limited',
      normalizedName: 'liberty mills limited',
      aliases: ['Liberty Mills Ltd', 'Liberty Mills Karachi'],
      registrationNumber: 'CUIN-0001928',
      taxVatNumber: 'NTN-0710609-7',
      country: 'Pakistan',
      address: 'A/51-A, S.I.T.E., Manghopir Road, Karachi-75700, Pakistan',
      businessType: 'Textile Composite Mill & Export House',
      declaredBusinessActivity: 'Processing, manufacturing, and international export of dyed, printed, flannelette bed linen, fitted sheets, quilt cover sets, and home textiles.',
      riskRating: 'LOW',
      onboardingDate: '2019-01-15T00:00:00Z',
      lastActiveDate: new Date().toISOString(),
      lifetimeTransactionCount: 246,
      lifetimeVolumeUsd: 84500000,
      averageTransactionValueUsd: 185000,
      monthlyLcFrequency: 6.2,
      establishedProductCategories: ['Home Textiles', 'Bed Linen', 'Flannelette Sheet Sets', 'Quilt Covers', 'Fitted Sheets'],
      establishedCountries: ['Australia', 'United Kingdom', 'United States', 'New Zealand', 'Germany'],
      regularSuppliers: ['Indus Dyeing & Bleaching Co.', 'Gul Ahmed Spinning'],
      regularBuyers: ['Target Australia Pty Ltd', 'Kmart Australia Limited', 'Wesfarmers Retail'],
      historicalOriginPorts: ['Karachi (PKKHI)', 'Port Qasim (PKQAS)'],
      historicalLoadingPorts: ['Karachi (PKKHI)', 'Port Qasim (PKQAS)'],
      historicalDischargePorts: ['Fremantle (AUFRE)', 'Melbourne (AUMEL)', 'Sydney (AUBNE)', 'Felixstowe (GBFXT)'],
      historicalIntermediatePorts: ['Colombo (LKCMB)', 'Singapore (SGSIN)', 'Port Said (EGPSD)'],
      commonTransshipmentHubs: ['Colombo (LKCMB)', 'Singapore (SGSIN)'],
      typicalRoutes: ['Karachi -> Colombo -> Singapore -> Fremantle', 'Port Qasim -> Singapore -> Melbourne'],
      typicalCarriers: ['COSCO Shipping Lines', 'Maersk Line', 'MSC Mediterranean Shipping'],
      typicalVessels: ['XIN HANG ZHOU', 'COSCO SHIPPING CAPRICORN', 'MAERSK MC-KINNEY MOLLER'],
      pastSanctionsHitsCount: 0,
      pastPriceAnomaliesCount: 0,
      pastDiscrepanciesCount: 0,
      averageHistoricalRiskScore: 10,
    };

    await customersCol.insertOne(libertyGoldenRecord as any);
    console.log('[Mongo Purge] Seeded Liberty Mills Limited Golden Record into docuintel.customers.');

    console.log('[Mongo Purge] MongoDB Atlas Cloud Database is now 100% clean and ready for live ingestion.');
  } finally {
    await client.close();
  }
}

purgeAndRebuild().catch(console.error);
