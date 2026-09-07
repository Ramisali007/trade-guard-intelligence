import type { IMaritimeProvider } from './maritime.provider';
import type {
  PortLocation,
  ReconstructedVoyage,
  VesselIdentity,
  VoyageEvent,
} from './maritime.types';
import { PortNormalizationService } from './port-normalization.service';
import { ContainerBlScraperService, type EnrichedContainerBlResult } from './providers/container-bl-scraper.service';
import { createLogger } from '../../utils/logger';

const log = createLogger('voyage-reconstruction');

export class VoyageReconstructionService {
  private readonly portNormalizer = PortNormalizationService.getInstance();
  private readonly containerBlScraper = new ContainerBlScraperService();

  constructor(private readonly provider: IMaritimeProvider) {}

  /**
   * Reconstruct the historical voyage covering the shipment window.
   */
  async reconstructVoyage(params: {
    vesselName?: string;
    vesselImo?: string;
    vesselMmsi?: string;
    billOfLadingNumber?: string;
    containerNumber?: string;
    portOfLoading?: string;
    portOfDischarge?: string;
    originCountry?: string;
    destinationCountry?: string;
    declaredTransitHubs?: string[];
    transactionTimestamp?: string;
    etd?: string;
    eta?: string;
  }): Promise<{ voyage: ReconstructedVoyage | null; enrichedBl?: EnrichedContainerBlResult | null }> {
    let activeVesselName = params.vesselName && params.vesselName !== 'Not Found' ? params.vesselName : undefined;
    let activeVesselImo = params.vesselImo && params.vesselImo !== 'Not Found' ? params.vesselImo : undefined;
    let activeVesselMmsi = params.vesselMmsi && params.vesselMmsi !== 'Not Found' ? params.vesselMmsi : undefined;
    let enrichedBl: EnrichedContainerBlResult | null = null;

    // 1. If vessel identity is not directly present, query/scrape B/L & Container tracking networks
    if (!activeVesselName && !activeVesselImo) {
      if (params.billOfLadingNumber || params.containerNumber) {
        log.info('Vessel not provided; scraping B/L & Container tracking sources...', {
          bl: params.billOfLadingNumber,
          container: params.containerNumber,
        });

        enrichedBl = await this.containerBlScraper.lookupAndEnrich({
          billOfLadingNumber: params.billOfLadingNumber,
          containerNumber: params.containerNumber,
          portOfLoading: params.portOfLoading,
          portOfDischarge: params.portOfDischarge,
        });

        if (enrichedBl && enrichedBl.vesselName) {
          activeVesselName = enrichedBl.vesselName;
          activeVesselImo = enrichedBl.vesselImo;
          log.info('Successfully enriched vessel identity from B/L & container scrape', {
            scrapedVessel: activeVesselName,
            scrapedImo: activeVesselImo,
            carrier: enrichedBl.carrierName,
          });
        }
      }
    }

    log.info('Initiating historical voyage reconstruction', {
      vesselName: activeVesselName,
      vesselImo: activeVesselImo,
      pol: params.portOfLoading,
      pod: params.portOfDischarge,
    });

    // 2. Resolve Vessel Identity against multi-source maritime providers
    const vessel = await this.provider.getVesselIdentity({
      imo: activeVesselImo,
      mmsi: activeVesselMmsi,
      name: activeVesselName,
    });

    if (!vessel) {
      log.info('Vessel identity could not be resolved from maritime provider', {
        vesselName: activeVesselName,
        vesselImo: activeVesselImo,
      });
      return { voyage: null, enrichedBl };
    }

    // 3. Establish Voyage Window (Lookback & Forward)
    const parseSafeTime = (dateStr?: string): number => {
      if (!dateStr || typeof dateStr !== 'string' || dateStr === 'Not Found') return NaN;
      const clean = dateStr.trim();
      const direct = new Date(clean).getTime();
      if (!isNaN(direct)) return direct;
      const match = clean.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/);
      if (match && match[1]) {
        const t = new Date(match[1].replace(/[./]/g, '-')).getTime();
        if (!isNaN(t)) return t;
      }
      return NaN;
    };

    let baseTime = parseSafeTime(params.etd || enrichedBl?.etd);
    if (isNaN(baseTime)) baseTime = parseSafeTime(params.transactionTimestamp);
    if (isNaN(baseTime)) baseTime = Date.now();

    const lookbackDays = 15;
    const forwardDays = 35;

    const windowStart = new Date(baseTime - lookbackDays * 86400000).toISOString();
    const windowEnd = new Date(baseTime + forwardDays * 86400000).toISOString();

    // 4. Retrieve Historical Voyage & Observed Port Calls
    const voyage = await this.provider.getHistoricalVoyage({
      imo: vessel.imo,
      mmsi: vessel.mmsi,
      vesselName: vessel.name,
      loadingPort: params.portOfLoading || enrichedBl?.portOfLoading,
      dischargePort: params.portOfDischarge || enrichedBl?.portOfDischarge,
      declaredTransitHubs: params.declaredTransitHubs,
      dateRange: { from: windowStart, to: windowEnd },
    });

    return { voyage, enrichedBl };
  }
}
