import fs from 'node:fs/promises';
import path from 'node:path';
import type { CustomerProfile } from '../compliance/behavioral/behavioral.types';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const log = createLogger('customer-repository');

export class CustomerRepository {
  private static instance: CustomerRepository;
  private readonly storagePath = path.resolve(process.cwd(), 'storage', 'customers.json');
  private readonly profiles: Map<string, CustomerProfile> = new Map();
  private mongoCollection: import('mongodb').Collection<CustomerProfile> | null = null;
  private initialized = false;

  private constructor() {
    this.seedBaselineCustomers();
  }

  public static getInstance(): CustomerRepository {
    if (!CustomerRepository.instance) {
      CustomerRepository.instance = new CustomerRepository();
    }
    return CustomerRepository.instance;
  }

  public async init(): Promise<void> {
    if (this.initialized) return;

    if (config.storage.driver === 'mongo') {
      try {
        const { MongoClient } = await import('mongodb');
        const client = new MongoClient(config.storage.mongoUri, { serverSelectionTimeoutMS: 8000 });
        await client.connect();
        const db = client.db(config.storage.mongoDb);
        this.mongoCollection = db.collection<CustomerProfile>('customers');

        await this.mongoCollection.createIndex({ customerReferenceId: 1 }, { unique: true });
        await this.mongoCollection.createIndex({ normalizedName: 1 });
        await this.mongoCollection.createIndex({ taxVatNumber: 1 });
        await this.mongoCollection.createIndex({ registrationNumber: 1 });

        const count = await this.mongoCollection.countDocuments();
        if (count === 0) {
          const baselineProfiles = Array.from(this.profiles.values());
          await this.mongoCollection.insertMany(baselineProfiles);
          log.info('Seeded customer golden records to MongoDB Atlas', { count: baselineProfiles.length });
        } else {
          const cloudDocs = await this.mongoCollection.find({}).toArray();
          for (const doc of cloudDocs) {
            this.profiles.set(doc.customerReferenceId, doc);
          }
          log.info('Loaded customer golden records from MongoDB Atlas', { count: cloudDocs.length });
        }
      } catch (err) {
        log.warn('Could not connect CustomerRepository to MongoDB, falling back to memory/local', { error: err });
      }
    }
    this.initialized = true;
  }

  /**
   * Seed realistic customer golden records for immediate testing and verification.
   */
  private seedBaselineCustomers(): void {
    const seed: CustomerProfile[] = [
      {
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
        lastActiveDate: '2026-08-30T00:00:00Z',
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
      },
    ];

    for (const c of seed) {
      this.profiles.set(c.customerReferenceId, c);
    }
  }

  async listAll(): Promise<CustomerProfile[]> {
    if (this.mongoCollection) {
      try {
        const docs = await this.mongoCollection.find({}, { projection: { _id: 0 } }).toArray();
        if (docs.length > 0) return docs as CustomerProfile[];
      } catch {
        // fallback to memory
      }
    }
    return Array.from(this.profiles.values());
  }

  async findById(customerReferenceId: string): Promise<CustomerProfile | null> {
    if (this.mongoCollection) {
      try {
        const found = await this.mongoCollection.findOne({ customerReferenceId }, { projection: { _id: 0 } });
        if (found) return found as CustomerProfile;
      } catch {
        // fallback to memory
      }
    }
    return this.profiles.get(customerReferenceId) || null;
  }

  async save(profile: CustomerProfile): Promise<void> {
    this.profiles.set(profile.customerReferenceId, profile);
    if (this.mongoCollection) {
      try {
        await this.mongoCollection.updateOne(
          { customerReferenceId: profile.customerReferenceId },
          { $set: profile },
          { upsert: true },
        );
      } catch (err) {
        log.warn('Failed to upsert customer profile to MongoDB Atlas', { id: profile.customerReferenceId, error: err });
      }
    }
  }
}
