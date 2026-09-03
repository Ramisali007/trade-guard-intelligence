import type {
  PortLocation,
  ReconstructedVoyage,
  VesselIdentity,
  VoyageEvent,
} from './maritime.types';

export interface IMaritimeProvider {
  readonly name: string;

  /**
   * Resolve vessel identity by priority:
   * 1. IMO number
   * 2. MMSI
   * 3. Exact vessel name + supporting data
   * 4. Fuzzy vessel name fallback
   */
  getVesselIdentity(query: {
    imo?: string;
    mmsi?: string;
    name?: string;
  }): Promise<VesselIdentity | null>;

  /**
   * Retrieve historical port calls covering the voyage window.
   */
  getHistoricalPortCalls(params: {
    imo?: string;
    mmsi?: string;
    vesselName?: string;
    fromDate: string;
    toDate: string;
  }): Promise<VoyageEvent[]>;

  /**
   * Reconstruct historical voyage covering origin departure to final destination arrival.
   */
  getHistoricalVoyage(params: {
    imo?: string;
    mmsi?: string;
    vesselName?: string;
    loadingPort?: string;
    dischargePort?: string;
    declaredTransitHubs?: string[];
    dateRange: { from: string; to: string };
  }): Promise<ReconstructedVoyage | null>;
}
