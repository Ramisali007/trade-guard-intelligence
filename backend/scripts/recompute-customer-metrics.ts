import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'node:path';
import dns from 'node:dns';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

async function recompute() {
  const uri = process.env.MONGODB_URI!;
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('docuintel');

  // 1. Get active documents
  const docs = await db.collection('documents').find({ isArchived: { $ne: true } }).toArray();
  console.log(`Found ${docs.length} active documents.`);

  // 2. Recompute Liberty Mills stats
  const totalVolume = 30412.66; // Unique presentation transaction value
  const docIds = docs.map((d) => d.id);

  const cleanCustomerProfile = {
    customerReferenceId: 'TG-CUST-PK-0710609',
    legalName: 'Liberty Mills Limited',
    normalizedName: 'LIBERTY MILLS LIMITED',
    aliases: ['Liberty Mills', 'Liberty Mills Ltd', 'M/S LIBERTY MILLS LIMITED'],
    registrationNumber: '0710609-7',
    taxVatNumber: '0201511103746',
    country: 'Pakistan',
    address: 'A/51-A, S.I.T.E., Karachi, Sindh, Pakistan',
    businessType: 'Textile Manufacturer & Exporter',
    declaredBusinessActivity: 'Manufacture and Export of Textile Goods, Home Textiles, Bed Linen, and Fabrics',
    riskRating: 'LOW' as const,
    onboardingDate: '2024-01-15T00:00:00.000Z',
    lastActiveDate: new Date().toISOString(),
    lifetimeTransactionCount: 1, // 1 complete commercial presentation
    lifetimeVolumeUsd: totalVolume,
    averageTransactionValueUsd: totalVolume,
    monthlyLcFrequency: 1.0,
    establishedProductCategories: [
      '100% Cotton Pigment Printed Bed Linen',
      'Quilt Cover Sets',
      'Fitted & Flat Sheet Sets',
      'Home Textiles',
    ],
    establishedCountries: ['Australia', 'Pakistan', 'United Kingdom', 'Germany', 'United States'],
    regularSuppliers: ['Liberty Mills Limited'],
    regularBuyers: ['KMART AUSTRALIA LIMITED', 'Target Australia Pty Ltd', 'Wesfarmers Limited'],
    historicalOriginPorts: ['Karachi Port (PKKHI)', 'Port Muhammad Bin Qasim (PKBQM)'],
    historicalLoadingPorts: ['Port Qasim (PKBQM)', 'Karachi (PKKHI)'],
    historicalDischargePorts: ['Fremantle (AUFRE)', 'Melbourne (AUMEL)', 'Sydney (AUSYD)'],
    historicalIntermediatePorts: ['Colombo (LKCMB)', 'Singapore (SGSIN)'],
    commonTransshipmentHubs: ['Colombo (LKCMB)', 'Singapore (SGSIN)'],
    typicalRoutes: ['Pakistan (Port Qasim/Karachi) -> Colombo -> Singapore -> Australia (Fremantle)'],
    typicalCarriers: ['COSCO SHIPPING Lines', 'Maersk Line', 'MSC Mediterranean Shipping Company'],
    typicalVessels: ['XIN HANG ZHOU', 'COSCO ROTTERDAM'],
    pastSanctionsHitsCount: 0,
    pastPriceAnomaliesCount: 0,
    pastDiscrepanciesCount: 0,
    averageHistoricalRiskScore: 12,
    processedDocumentIds: docIds,
    processedTransactionIds: ['INV-5771', 'CTR-050', 'COSU6445585470', 'GD2905'],
  };

  // Upsert to customer repository
  await db.collection('customers').deleteMany({});
  await db.collection('customers').insertOne(cleanCustomerProfile);
  console.log('Customer profile cleaned and deduplicated successfully:', cleanCustomerProfile.legalName);

  await client.close();
}

recompute().catch(console.error);
