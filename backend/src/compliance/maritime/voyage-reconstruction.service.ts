import type { IMaritimeProvider } from './maritime.provider';
import type {
  PortLocation,
  ReconstructedVoyage,
  VesselIdentity,
  VoyageEvent,
} from './maritime.types';
import { PortNormalizationService } from './port-normalization.service';
import { createLogger } from '../../utils/logger';

const log = createLogger('voyage-reconstruction');

export class VoyageReconstructionService {
  private readonly portNormalizer = PortNormalizationService.getInstance();

  constructor(private readonly provider: IMaritimeProvider) {}

  /**
   * Reconstruct the historical voyage covering the shipment window.
   */
  async reconstructVoyage(params: {
    vesselName?: string;
    vesselImo?: string;
    vesselMmsi?: string;
    portOfLoading?: string;
    portOfDischarge?: string;
    originCountry?: string;
    destinationCountry?: string;
    transactionTimestamp?: string;
    etd?: string;
    eta?: string;
  }): Promise<ReconstructedVoyage | null> {
    log.info('Initiating historical voyage reconstruction', {
      vesselName: params.vesselName,
      vesselImo: params.vesselImo,
      pol: params.portOfLoading,
      pod: params.portOfDischarge,
    });

    // 1. Resolve Vessel Identity
    const vessel = await this.provider.getVesselIdentity({
      imo: params.vesselImo,
      mmsi: params.vesselMmsi,
      name: params.vesselName,
    });

    if (!vessel) {
      log.info('Vessel identity could not be resolved from maritime provider', {
        vesselName: params.vesselName,
        vesselImo: params.vesselImo,
      });
      return null;
    }

    // 2. Establish Voyage Window (Lookback & Forward)
    const parseSafeTime = (dateStr?: string): number => {
      if (!dateStr || typeof dateStr !== 'string') return NaN;
      const clean = dateStr.trim();
      const direct = new Date(clean).getTime();
      if (!isNaN(direct)) return direct;
      // If composite like "2026-07-02 to 2026-07-28" or "2026/07/02", try finding first date pattern
      const match = clean.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/);
      if (match && match[1]) {
        const t = new Date(match[1].replace(/[./]/g, '-')).getTime();
        if (!isNaN(t)) return t;
      }
      return NaN;
    };

    let baseTime = parseSafeTime(params.etd);
    if (isNaN(baseTime)) baseTime = parseSafeTime(params.transactionTimestamp);
    if (isNaN(baseTime)) baseTime = Date.now();

    const lookbackDays = 15;
    const forwardDays = 35;

    const windowStart = new Date(baseTime - lookbackDays * 86400000).toISOString();
    const windowEnd = new Date(baseTime + forwardDays * 86400000).toISOString();

    // 3. Retrieve Historical Voyage
    const voyage = await this.provider.getHistoricalVoyage({
      imo: vessel.imo,
      mmsi: vessel.mmsi,
      vesselName: vessel.name,
      loadingPort: params.portOfLoading,
      dischargePort: params.portOfDischarge,
      dateRange: { from: windowStart, to: windowEnd },
    });

    return voyage;
  }
}
