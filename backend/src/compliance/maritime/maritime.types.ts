/**
 * Maritime Route Intelligence & Vessel Tracking Types
 */

export interface VesselIdentity {
  imo?: string;
  mmsi?: string;
  name: string;
  flag?: string;
  callSign?: string;
  vesselType?: string;
  builtYear?: number;
  deadweightTonnage?: number;
  confidence: number; // 0 - 1.0
  resolutionMethod: 'IMO_EXACT' | 'MMSI_EXACT' | 'EXACT_NAME_MATCH' | 'FUZZY_NAME_FALLBACK';
}

export interface PortLocation {
  locode: string; // UN/LOCODE e.g. CNSHA, PKKHI, SGSIN
  name: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  aliases?: string[];
}

export type VoyageEventType = 'DEPARTURE' | 'ARRIVAL' | 'BERTH' | 'ANCHORAGE';

export type VoyageEventSource =
  | 'AIS_PORT_CALL'
  | 'AIS_SATELLITE'
  | 'CARRIER_EDI'
  | 'DOCUMENT_DECLARED';

export interface VoyageEvent {
  eventId: string;
  port: PortLocation;
  event: VoyageEventType;
  timestamp: string; // ISO UTC
  source: VoyageEventSource;
  confidence: number;
  isDeclaredInDocuments: boolean;
  berthOrTerminal?: string;
  draftMeters?: number;
}

export interface ReconstructedVoyage {
  vessel: VesselIdentity;
  voyageNumber?: string;
  voyageWindowStart: string;
  voyageWindowEnd: string;
  events: VoyageEvent[];
  originPort?: PortLocation;
  departureTime?: string;
  finalPort?: PortLocation;
  arrivalTime?: string;
  intermediatePorts: PortLocation[];
  provider: string;
  dataConfidence: number;
  retrievedAt: string;
}

export type RouteClassification =
  | 'DIRECT_ROUTE'
  | 'NORMAL_TRANSSHIPMENT'
  | 'INTERMEDIATE_PORTS_PRESENT'
  | 'ROUTE_DEVIATION'
  | 'UNEXPECTED_TRANSIT_JURISDICTION'
  | 'HIGH_RISK_ROUTING'
  | 'ROUTE_DATA_UNAVAILABLE'
  | 'INSUFFICIENT_ROUTE_EVIDENCE';

export type RouteRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface IntermediatePortDetail {
  port: PortLocation;
  arrivalTime?: string;
  departureTime?: string;
  durationHours?: number;
  wasDeclared: boolean;
  jurisdictionRiskLevel: 'CLEAR' | 'ELEVATED' | 'HIGH_RISK' | 'SANCTIONED';
  jurisdictionExplanation?: string;
}

export interface MaritimeEvidenceRecord {
  provider: string;
  query: string;
  vesselIdentifier: string;
  dateRange: string;
  retrievedTimestamp: string;
  observedPorts: string[];
  dataConfidence: number;
  sourceReference: string;
}

export interface RouteComparisonResult {
  declaredRoute: {
    origin: string;
    portOfLoading: string;
    loadingLocode?: string;
    transitHubs: string[];
    portOfDischarge: string;
    dischargeLocode?: string;
    finalDestination: string;
    etd?: string;
    eta?: string;
  };
  observedRoute?: {
    originPort: PortLocation;
    portOfLoading: PortLocation;
    intermediateCalls: IntermediatePortDetail[];
    portOfDischarge: PortLocation;
    finalPort?: PortLocation;
    departureTime?: string;
    arrivalTime?: string;
  };
  vessel?: VesselIdentity;
  intermediatePortsCount: number;
  undeclaredIntermediatePortsCount: number;
  undeclaredPorts: PortLocation[];
  routeClassification: RouteClassification;
  routeDeviationDetected: boolean;
  routeRiskLevel: RouteRiskLevel;
  routeRiskScore: number; // 0 - 100
  routeFindings: string[];
  evidenceRecords: MaritimeEvidenceRecord[];
  
  /**
   * Mandatory legal and compliance distinction:
   * AIS is vessel-level evidence, not cargo-level proof.
   */
  limitationNotice: string;
}
