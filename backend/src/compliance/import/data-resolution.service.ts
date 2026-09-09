import { ComplianceStore } from '../db/compliance-store';
import { RealtimeMarketScraperService } from '../pricing/realtime-market-scraper.service';
import { RealtimeVesselFinderScraperService } from '../maritime/providers/realtime-vesselfinder-scraper.service';
import { CustomerRepository } from '../../services/customer.repository';
import { createLogger } from '../../utils/logger';

const log = createLogger('data-resolution');

export type ResolutionStatus =
  | 'FRESH'
  | 'DATABASE_FALLBACK'
  | 'HISTORICAL'
  | 'UNVERIFIED'
  | 'UNKNOWN';

export interface ResolutionMetadata {
  status: ResolutionStatus;
  sourceName: string;
  sourceUrl?: string;
  lastVerifiedAt: string;
  asOfDate?: string;
  confidence: 'VERY_HIGH' | 'HIGH' | 'MODERATE' | 'LOW' | 'NONE';
  isHistorical: boolean;
  notes?: string;
}

export interface ResolvedEntityResult<T = any> {
  data: T | null;
  provenance: ResolutionMetadata;
  found: boolean;
}

export class DataResolutionService {
  private static instance: DataResolutionService;
  private readonly store = ComplianceStore.getInstance();
  private readonly priceScraper = new RealtimeMarketScraperService();
  private readonly vesselScraper = new RealtimeVesselFinderScraperService();
  private readonly customerRepo = CustomerRepository.getInstance();

  private constructor() {}

  public static getInstance(): DataResolutionService {
    if (!DataResolutionService.instance) {
      DataResolutionService.instance = new DataResolutionService();
    }
    return DataResolutionService.instance;
  }

  /**
   * Universal Entity Resolver obeying Priority 1 (Fresh External) -> Priority 2 (Local DB)
   * -> Priority 3 (Historical) -> Priority 4 (Unknown / Data Not Available).
   */
  public async resolveEntity(
    entityType: string,
    identifier: string,
    context: { asOfDate?: string; currency?: string; hsCode?: string; [key: string]: any } = {},
  ): Promise<ResolvedEntityResult> {
    await this.store.init();

    switch (entityType.toLowerCase()) {
      case 'country':
      case 'countries':
        return this.resolveCountry(identifier, context.asOfDate);
      case 'sanction':
      case 'sanctions':
        return this.resolveSanctionStatus(identifier, context.asOfDate);
      case 'price':
      case 'prices':
        return this.resolvePrice(identifier, context.hsCode, context.currency, context.asOfDate);
      case 'port':
      case 'ports':
        return this.resolvePort(identifier);
      case 'vessel':
      case 'vessels':
        return this.resolveVessel(identifier);
      case 'bank':
      case 'banks':
        return this.resolveBank(identifier);
      case 'currency':
      case 'currencies':
        return this.resolveCurrency(identifier, context.asOfDate);
      case 'company':
      case 'companies':
        return this.resolveCompany(identifier, context.taxId);
      case 'product':
      case 'products':
        return this.resolveProduct(identifier);
      case 'regulation':
      case 'regulations':
        return this.resolveRegulation(identifier);
      default:
        return {
          data: null,
          found: false,
          provenance: {
            status: 'UNKNOWN',
            sourceName: 'System Registry',
            lastVerifiedAt: new Date().toISOString(),
            confidence: 'NONE',
            isHistorical: false,
            notes: `Unsupported entity type: ${entityType}`,
          },
        };
    }
  }

  /**
   * Resolve Country / Jurisdiction Status & Embargoes with Point-in-Time Support.
   */
  public async resolveCountry(countryNameOrCode: string, asOfDate?: string): Promise<ResolvedEntityResult> {
    const raw = (countryNameOrCode || '').trim();
    if (!raw) return this.createUnknownResult('Country / Jurisdiction', 'No country provided');

    const norm = raw.toLowerCase();
    const code = raw.toUpperCase();
    const targetDate = (asOfDate || new Date().toISOString()).slice(0, 10);

    // 1. Query Local Database
    const countries = await this.store.getCountries();
    const match = countries.find(
      (c) =>
        c.countryCode.toUpperCase() === code ||
        c.countryName.toLowerCase() === norm ||
        c.aliases.some((a) => a.toLowerCase() === norm),
    );

    if (match) {
      const isHistoricalEvaluation = Boolean(asOfDate && asOfDate.slice(0, 10) < new Date().toISOString().slice(0, 10));
      let wasSanctionedAtDate = match.isSanctioned;

      if (match.effectiveFrom && targetDate < match.effectiveFrom) {
        // Not yet sanctioned at transaction date!
        wasSanctionedAtDate = false;
      } else if (match.effectiveTo && targetDate > match.effectiveTo) {
        // Sanction had already expired!
        wasSanctionedAtDate = false;
      }

      return {
        data: {
          ...match,
          isSanctionedAtAsOfDate: wasSanctionedAtDate,
        },
        found: true,
        provenance: {
          status: isHistoricalEvaluation ? 'HISTORICAL' : 'DATABASE_FALLBACK',
          sourceName: 'Statutory Master Country Registry',
          lastVerifiedAt: match.lastVerifiedAt || new Date().toISOString(),
          asOfDate: targetDate,
          confidence: 'HIGH',
          isHistorical: isHistoricalEvaluation,
          notes: wasSanctionedAtDate
            ? `Jurisdiction designated under ${match.sanctionPrograms.join(', ') || 'Statutory Embargo'}`
            : 'Jurisdiction was not subject to active embargo at evaluated date',
        },
      };
    }

    return this.createUnknownResult('Country / Jurisdiction', `No statutory record found for "${countryNameOrCode}"`);
  }

  /**
   * Resolve Sanctions Designation with Point-in-Time SCD Type-2 Evaluation.
   */
  public async resolveSanctionStatus(entityName: string, asOfDate?: string): Promise<ResolvedEntityResult> {
    const cleanName = (entityName || '').trim();
    if (!cleanName) return this.createUnknownResult('Sanctions Screening', 'No party name provided');

    const targetDate = (asOfDate || new Date().toISOString()).slice(0, 10);
    const pitQuery = await this.store.findEntityPointInTime(cleanName, targetDate);

    // Did we have hits on asOfDate?
    if (pitQuery.matches.length > 0 && pitQuery.matches[0]) {
      const primary = pitQuery.matches[0];
      const isHistorical = targetDate < new Date().toISOString().slice(0, 10);

      return {
        data: {
          isListed: true,
          entity: primary,
          matchedName: primary.canonicalName,
          programs: primary.programs,
          sanctionsList: primary.sourceId,
          validFrom: primary.validFrom,
          validTo: primary.validTo,
        },
        found: true,
        provenance: {
          status: isHistorical ? 'HISTORICAL' : 'DATABASE_FALLBACK',
          sourceName: primary.sourceId || 'Consolidated Sanctions Registry',
          lastVerifiedAt: primary.observedAt || new Date().toISOString(),
          asOfDate: targetDate,
          confidence: 'VERY_HIGH',
          isHistorical,
          notes: `Designated on ${primary.validFrom} (${primary.programs.join(', ')})`,
        },
      };
    }

    // Was it listed after the transaction date?
    if (pitQuery.currentListing) {
      const cur = pitQuery.currentListing;
      return {
        data: {
          isListed: false,
          listedLater: true,
          currentListing: cur,
          designationDate: cur.validFrom,
          remarks: `Added after transaction date (Designated: ${cur.validFrom}, Transaction Date: ${targetDate})`,
        },
        found: true,
        provenance: {
          status: 'HISTORICAL',
          sourceName: cur.sourceId || 'Consolidated Sanctions Registry',
          lastVerifiedAt: cur.observedAt || new Date().toISOString(),
          asOfDate: targetDate,
          confidence: 'HIGH',
          isHistorical: true,
          notes: `Post-transaction designation: Not designated on ${targetDate}`,
        },
      };
    }

    // Not found in sanctions database
    return {
      data: { isListed: false, entity: null },
      found: false,
      provenance: {
        status: 'DATABASE_FALLBACK',
        sourceName: 'Consolidated Sanctions Registry',
        lastVerifiedAt: new Date().toISOString(),
        asOfDate: targetDate,
        confidence: 'HIGH',
        isHistorical: false,
        notes: 'No matching designated entity found in master sanctions registry',
      },
    };
  }

  /**
   * Resolve Commodity Price Benchmark (Live Scraper -> DB Fallback -> Unknown).
   */
  public async resolvePrice(
    productDescription: string,
    hsCode?: string,
    currency = 'USD',
    asOfDate?: string,
  ): Promise<ResolvedEntityResult> {
    const text = (productDescription || '').trim();
    if (!text) return this.createUnknownResult('Price Valuation', 'No commodity description provided');

    // Priority 1: Fresh Live External Scraper (with safe timeout guard)
    try {
      const livePromise = this.priceScraper.scrapeLiveMarketPricing({ productDescription: text, hsCode });
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500));
      const liveResult = await Promise.race([livePromise, timeoutPromise]);

      if (liveResult && liveResult.benchmarkUnitPrice > 0) {
        log.info('Fresh live price scraping successful', { product: text, price: liveResult.benchmarkUnitPrice });
        return {
          data: {
            benchmarkUnitPriceUsd: liveResult.benchmarkUnitPrice,
            observedLowUsd: liveResult.observedLowPrice,
            observedHighUsd: liveResult.observedHighPrice,
            unitOfMeasure: liveResult.unitOfMeasure,
            productDescription: text,
            source: 'Live Market Scraper',
          },
          found: true,
          provenance: {
            status: 'FRESH',
            sourceName: 'UN Comtrade Live / Market Scraper',
            lastVerifiedAt: new Date().toISOString(),
            confidence: 'HIGH',
            isHistorical: false,
            notes: 'Fresh external market intelligence retrieved successfully',
          },
        };
      }
    } catch (err) {
      log.warn('Live price scraper failed or timed out, activating Database Fallback', { error: err });
    }

    // Priority 2: Database Fallback (Local Master Benchmarks)
    const dbBenchmark = await this.store.findBenchmark(text, hsCode);
    if (dbBenchmark) {
      const isHistorical = Boolean(asOfDate && asOfDate < (dbBenchmark.effectiveFrom || ''));
      return {
        data: {
          benchmarkUnitPriceUsd: dbBenchmark.benchmarkUnitPriceUsd,
          observedLowUsd: dbBenchmark.observedLowUsd,
          observedHighUsd: dbBenchmark.observedHighUsd,
          unitOfMeasure: dbBenchmark.unitOfMeasure,
          productDescription: text,
          hsCodePrefix: dbBenchmark.hsCodePrefix,
          category: dbBenchmark.category,
        },
        found: true,
        provenance: {
          status: isHistorical ? 'HISTORICAL' : 'DATABASE_FALLBACK',
          sourceName: 'UN Comtrade / Customs Valuation Master Database',
          lastVerifiedAt: dbBenchmark.effectiveFrom || new Date().toISOString(),
          asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
          confidence: dbBenchmark.confidenceLevel || 'HIGH',
          isHistorical,
          notes: 'Live market feed unavailable. Local canonical database benchmark used.',
        },
      };
    }

    // Priority 4: DATA_NOT_AVAILABLE (No hallucination)
    return this.createUnknownResult('Price Benchmark', `No authoritative valuation corridor available for "${text}"`);
  }

  /**
   * Resolve Maritime Port (LOCODE -> Local DB).
   */
  public async resolvePort(portCodeOrName: string): Promise<ResolvedEntityResult> {
    const query = (portCodeOrName || '').trim();
    if (!query) return this.createUnknownResult('Port Registry', 'No port specified');

    const port = await this.store.findPort(query);
    if (port) {
      return {
        data: port,
        found: true,
        provenance: {
          status: 'DATABASE_FALLBACK',
          sourceName: 'UN/LOCODE Maritime Registry',
          lastVerifiedAt: new Date().toISOString(),
          confidence: 'VERY_HIGH',
          isHistorical: false,
        },
      };
    }

    return this.createUnknownResult('UN/LOCODE Port', `Port "${query}" not found in UN/LOCODE database`);
  }

  /**
   * Resolve Vessel (Live AIS Scraper -> DB Fallback -> Unknown).
   */
  public async resolveVessel(imoOrName: string): Promise<ResolvedEntityResult> {
    const raw = (imoOrName || '').trim();
    if (!raw) return this.createUnknownResult('Vessel Registry', 'No vessel identifier provided');

    const isImo = /^[0-9]{7}$/.test(raw.replace(/\D/g, ''));
    const cleanImo = isImo ? raw.replace(/\D/g, '') : undefined;

    // Priority 1: Live VesselFinder Scraper
    try {
      const livePromise = this.vesselScraper.scrapeLiveVessel({ imo: cleanImo, name: isImo ? undefined : raw });
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500));
      const liveVessel = await Promise.race([livePromise, timeoutPromise]);

      if (liveVessel && liveVessel.name) {
        return {
          data: liveVessel,
          found: true,
          provenance: {
            status: 'FRESH',
            sourceName: 'VesselFinder Live AIS Telemetry',
            lastVerifiedAt: new Date().toISOString(),
            confidence: 'HIGH',
            isHistorical: false,
            notes: 'Live AIS vessel position and telemetry retrieved',
          },
        };
      }
    } catch {
      // Live AIS unavailable
    }

    // Priority 2: Local Database Fallback
    const dbVessel = await this.store.findVessel({ imo: cleanImo, name: isImo ? undefined : raw });
    if (dbVessel) {
      return {
        data: dbVessel,
        found: true,
        provenance: {
          status: 'DATABASE_FALLBACK',
          sourceName: 'Master Maritime Registry',
          lastVerifiedAt: dbVessel.syncedAt || new Date().toISOString(),
          confidence: 'HIGH',
          isHistorical: false,
          notes: 'Live AIS scraper unavailable. Local database vessel profile used.',
        },
      };
    }

    return this.createUnknownResult('Vessel Intelligence', `Vessel "${raw}" not found in live AIS or local database`);
  }

  /**
   * Resolve Bank / SWIFT BIC.
   */
  public async resolveBank(swiftBicOrName: string): Promise<ResolvedEntityResult> {
    const query = (swiftBicOrName || '').trim().toUpperCase();
    if (!query) return this.createUnknownResult('Bank Directory', 'No bank identifier provided');

    const banks = await this.store.getBanks();
    const match = banks.find(
      (b) => b.swiftBic.toUpperCase() === query || b.bankName.toUpperCase().includes(query),
    );

    if (match) {
      return {
        data: match,
        found: true,
        provenance: {
          status: 'DATABASE_FALLBACK',
          sourceName: 'Central Bank Authorized Dealer Directory',
          lastVerifiedAt: match.lastVerifiedAt || new Date().toISOString(),
          confidence: 'VERY_HIGH',
          isHistorical: false,
        },
      };
    }

    return this.createUnknownResult('Bank Directory', `Bank "${swiftBicOrName}" not found in authorized dealer registry`);
  }

  /**
   * Resolve Currency / FX Rate.
   */
  public async resolveCurrency(currencyCode: string, asOfDate?: string): Promise<ResolvedEntityResult> {
    const code = (currencyCode || '').trim().toUpperCase().slice(0, 3);
    if (!code) return this.createUnknownResult('Currency Registry', 'No currency code provided');

    try {
      const rate = await this.store.getFxRateToUsd(code, asOfDate);
      return {
        data: { currencyCode: code, rateToUsd: rate },
        found: true,
        provenance: {
          status: asOfDate ? 'HISTORICAL' : 'DATABASE_FALLBACK',
          sourceName: 'IMF & Central Bank Foreign Exchange Feed',
          lastVerifiedAt: asOfDate || new Date().toISOString(),
          confidence: 'HIGH',
          isHistorical: Boolean(asOfDate),
        },
      };
    } catch {
      return this.createUnknownResult('Currency Registry', `Exchange rate for "${code}" unavailable`);
    }
  }

  /**
   * Resolve Corporate Profile / Customer 360.
   */
  public async resolveCompany(name: string, taxId?: string): Promise<ResolvedEntityResult> {
    const cleanName = (name || '').trim();
    if (!cleanName && !taxId) return this.createUnknownResult('Customer 360', 'No company identifier provided');

    const all = await this.customerRepo.listAll();
    const match = all.find(
      (c) =>
        (taxId && c.taxVatNumber === taxId) ||
        c.legalName.toLowerCase() === cleanName.toLowerCase() ||
        c.aliases.some((a) => a.toLowerCase() === cleanName.toLowerCase()),
    );

    if (match) {
      return {
        data: match,
        found: true,
        provenance: {
          status: 'DATABASE_FALLBACK',
          sourceName: 'Customer 360 Golden Records',
          lastVerifiedAt: match.lastActiveDate || match.onboardingDate || new Date().toISOString(),
          confidence: 'HIGH',
          isHistorical: false,
        },
      };
    }

    return this.createUnknownResult('Customer 360', `Corporate profile for "${name}" not found`);
  }

  /**
   * Resolve Product / HS Code.
   */
  public async resolveProduct(hsCodeOrDesc: string): Promise<ResolvedEntityResult> {
    const raw = (hsCodeOrDesc || '').trim();
    if (!raw) return this.createUnknownResult('Product Registry', 'No HS code or description provided');

    const cleanDigits = raw.replace(/\D/g, '');
    const products = await this.store.getProducts();
    const match = products.find(
      (p) => (cleanDigits && p.hsDigits.startsWith(cleanDigits.slice(0, 4))) || p.description.toLowerCase().includes(raw.toLowerCase()),
    );

    if (match) {
      return {
        data: match,
        found: true,
        provenance: {
          status: 'DATABASE_FALLBACK',
          sourceName: 'Harmonized Tariff Schedule & Export Control Registry',
          lastVerifiedAt: match.lastVerifiedAt || new Date().toISOString(),
          confidence: 'HIGH',
          isHistorical: false,
        },
      };
    }

    return this.createUnknownResult('Product Classification', `HS code "${raw}" not found in regulatory tariff database`);
  }

  /**
   * Resolve Trade Regulation / SRO.
   */
  public async resolveRegulation(ref: string): Promise<ResolvedEntityResult> {
    const query = (ref || '').trim();
    if (!query) return this.createUnknownResult('Regulation Registry', 'No statutory reference provided');

    const regulations = await this.store.getRegulations();
    const match = regulations.find(
      (r) => r.regulationReference.toLowerCase().includes(query.toLowerCase()) || r.title.toLowerCase().includes(query.toLowerCase()),
    );

    if (match) {
      return {
        data: match,
        found: true,
        provenance: {
          status: 'DATABASE_FALLBACK',
          sourceName: 'Official Gazette / Trade Policy Orders',
          lastVerifiedAt: match.lastVerifiedAt || new Date().toISOString(),
          confidence: 'VERY_HIGH',
          isHistorical: false,
        },
      };
    }

    return this.createUnknownResult('Regulation Registry', `Regulation "${query}" not found`);
  }

  private createUnknownResult(category: string, reason: string): ResolvedEntityResult {
    return {
      data: null,
      found: false,
      provenance: {
        status: 'UNKNOWN',
        sourceName: `${category} Database`,
        lastVerifiedAt: new Date().toISOString(),
        confidence: 'NONE',
        isHistorical: false,
        notes: `DATA_NOT_AVAILABLE: ${reason}`,
      },
    };
  }
}

export const dataResolutionService = DataResolutionService.getInstance();

