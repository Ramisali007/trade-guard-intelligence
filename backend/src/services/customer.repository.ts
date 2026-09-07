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
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  public static getInstance(): CustomerRepository {
    if (!CustomerRepository.instance) {
      CustomerRepository.instance = new CustomerRepository();
    }
    return CustomerRepository.instance;
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // 1. If MongoDB configured, attempt cloud connection
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

          const cloudDocs = await this.mongoCollection.find({}).toArray();
          for (const doc of cloudDocs) {
            this.profiles.set(doc.customerReferenceId, doc);
          }
          log.info('Loaded customer records from MongoDB Atlas', { count: cloudDocs.length });
        } catch (err) {
          log.warn('Could not connect CustomerRepository to MongoDB, falling back to memory/local', { error: err });
        }
      }

      // 2. Load from local disk storage (customers.json) if not loaded from MongoDB
      if (this.profiles.size === 0) {
        try {
          const raw = await fs.readFile(this.storagePath, 'utf-8');
          const parsed = JSON.parse(raw) as CustomerProfile[];
          if (Array.isArray(parsed)) {
            for (const profile of parsed) {
              if (profile.customerReferenceId) {
                this.profiles.set(profile.customerReferenceId, profile);
              }
            }
            log.info('Loaded customer records from local disk storage', { count: this.profiles.size });
          }
        } catch {
          // File does not exist yet
        }
      }

      // 3. Seed canonical baseline customer (Apex Textiles Global Ltd) if not yet present
      if (!this.profiles.has('TG-CUST-100241')) {
        const canonicalSeed: CustomerProfile = {
          customerReferenceId: 'TG-CUST-100241',
          legalName: 'Apex Textiles Global Ltd',
          normalizedName: 'apex textiles global ltd',
          aliases: ['Apex Garments Manufacturing', 'Apex Textiles Corp', 'Apex Textiles Global Private Limited'],
          taxVatNumber: 'NTN-3029148-7',
          registrationNumber: 'REG-PK-10293',
          country: 'Pakistan',
          address: 'Plot 42, Sector 15, Korangi Industrial Area, Karachi, Pakistan',
          businessType: 'Textile Manufacturer & Exporter',
          declaredBusinessActivity: 'Textiles & Garments Manufacturing',
          riskRating: 'LOW',
          onboardingDate: '2023-01-15T00:00:00.000Z',
          lastActiveDate: new Date().toISOString(),
          lifetimeTransactionCount: 24,
          lifetimeVolumeUsd: 2800000,
          averageTransactionValueUsd: 116666,
          monthlyLcFrequency: 2.1,
          establishedProductCategories: ['Textiles & Apparel', 'Cotton Fabrics'],
          establishedCountries: ['United Kingdom', 'Germany', 'United States'],
          regularSuppliers: ['Indus Cotton Ginners Ltd'],
          regularBuyers: ['British Fashion Retailers PLC'],
          historicalOriginPorts: ['Karachi Port', 'Port Muhammad Bin Qasim'],
          historicalLoadingPorts: ['Karachi Port'],
          historicalDischargePorts: ['Port of Felixstowe', 'Southampton'],
          typicalRoutes: ['Pakistan -> United Kingdom'],
          typicalCarriers: ['Maersk Line', 'MSC'],
          pastSanctionsHitsCount: 0,
          pastPriceAnomaliesCount: 0,
          pastDiscrepanciesCount: 0,
          averageHistoricalRiskScore: 12,
        };
        this.profiles.set(canonicalSeed.customerReferenceId, canonicalSeed);
        await this.persistToDisk();
        if (this.mongoCollection) {
          try {
            await this.mongoCollection.updateOne(
              { customerReferenceId: canonicalSeed.customerReferenceId },
              { $set: canonicalSeed },
              { upsert: true },
            );
          } catch {}
        }
      }

      this.initialized = true;
    })();

    return this.initPromise;
  }

  private async persistToDisk(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
      const data = JSON.stringify(Array.from(this.profiles.values()), null, 2);
      await fs.writeFile(this.storagePath, data, 'utf-8');
    } catch (err) {
      log.warn('Failed to write customers to disk storage', { error: err });
    }
  }

  async listAll(): Promise<CustomerProfile[]> {
    if (!this.initialized) await this.init();

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
    if (!this.initialized) await this.init();

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
    if (!this.initialized) await this.init();

    this.profiles.set(profile.customerReferenceId, profile);
    await this.persistToDisk();

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

  public clear(): void {
    this.profiles.clear();
  }
}
