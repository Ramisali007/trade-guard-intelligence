import type { IMaritimeProvider } from './maritime.provider';
import type { RouteComparisonResult } from './maritime.types';
import { VesselFinderMaritimeProvider } from './providers/vesselfinder.provider';
import { VoyageReconstructionService } from './voyage-reconstruction.service';
import { RouteRiskService } from './route-risk.service';
import { createLogger } from '../../utils/logger';

const log = createLogger('maritime-service');

export class MaritimeService {
  private static instance: MaritimeService;
  private readonly provider: IMaritimeProvider;
  private readonly voyageReconstruction: VoyageReconstructionService;
  private readonly routeRisk: RouteRiskService;

  // In-memory TTL cache for historical voyage lookups
  private readonly cache = new Map<string, { result: RouteComparisonResult; expiresAt: number }>();
  private readonly cacheTtlMs = 3600 * 1000; // 1 Hour

  constructor(provider?: IMaritimeProvider) {
    // Pluggable provider selection based on environment configuration
    this.provider = provider || new VesselFinderMaritimeProvider();
    this.voyageReconstruction = new VoyageReconstructionService(this.provider);
    this.routeRisk = new RouteRiskService();
    log.info('Maritime Intelligence Engine initialized', { activeProvider: this.provider.name });
  }

  public static getInstance(): MaritimeService {
    if (!MaritimeService.instance) {
      MaritimeService.instance = new MaritimeService();
    }
    return MaritimeService.instance;
  }

  /**
   * Complete end-to-end maritime route intelligence analysis.
   */
  async analyzeShipmentRoute(params: {
    vesselName?: string;
    vesselImo?: string;
    vesselMmsi?: string;
    portOfLoading?: string;
    portOfDischarge?: string;
    originCountry?: string;
    destinationCountry?: string;
    declaredTransitHubs?: string[];
    transactionTimestamp?: string;
    etd?: string;
    eta?: string;
  }): Promise<RouteComparisonResult> {
    const vesselKey = (params.vesselImo || params.vesselMmsi || params.vesselName || 'unspecified').trim().toUpperCase();
    const timeKey = (params.transactionTimestamp || params.etd || 'nodate').slice(0, 10);
    const cacheKey = `${this.provider.name}:${vesselKey}:${params.portOfLoading}:${params.portOfDischarge}:${timeKey}`;

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      log.debug('Returning cached maritime route intelligence', { cacheKey });
      return cached.result;
    }

    // 1. Reconstruct historical voyage
    const voyage = await this.voyageReconstruction.reconstructVoyage(params);

    // 2. Perform route comparison & risk analysis
    const result = this.routeRisk.evaluateRoute({
      declaredOrigin: params.originCountry,
      declaredPortOfLoading: params.portOfLoading,
      declaredTransitHubs: params.declaredTransitHubs,
      declaredPortOfDischarge: params.portOfDischarge,
      declaredDestination: params.destinationCountry,
      etd: params.etd,
      eta: params.eta,
      voyage,
    });

    // 3. Cache observation
    this.cache.set(cacheKey, {
      result,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return result;
  }
}
