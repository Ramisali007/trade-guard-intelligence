import type {
  IntermediatePortDetail,
  MaritimeEvidenceRecord,
  PortLocation,
  ReconstructedVoyage,
  RouteClassification,
  RouteComparisonResult,
  RouteRiskLevel,
} from './maritime.types';
import { PortNormalizationService } from './port-normalization.service';
import { SANCTIONED_JURISDICTIONS } from '../sanctions/jurisdictions.data';

export class RouteRiskService {
  private readonly portNormalizer = PortNormalizationService.getInstance();

  /**
   * High-risk or heavily monitored maritime transshipment corridors
   */
  private readonly monitoredTransshipmentHubs = new Set([
    'IRBND', // Bandar Abbas, Iran (Comprehensively Sanctioned)
    'RULED', // St. Petersburg, Russia (Sanctioned / Export Control)
    'RUNVS', // Novorossiysk, Russia (Sanctioned)
    'KPNAJ', // Rason / Najin, North Korea (Embargoed)
    'SYLAT', // Latakia, Syria (Sanctioned)
  ]);

  /**
   * Standard established global container transshipment hubs (Commercial normal)
   */
  private readonly normalCommercialHubs = new Set([
    'SGSIN', // Singapore
    'MYPKG', // Port Klang
    'MYTPP', // Tanjung Pelepas
    'LKCMB', // Colombo
    'AEJEA', // Jebel Ali
    'OMSLL', // Salalah
    'EGPSD', // Port Said
    'NLRTM', // Rotterdam
    'BEANR', // Antwerp
  ]);

  public evaluateRoute(params: {
    declaredOrigin?: string;
    declaredPortOfLoading?: string;
    declaredTransitHubs?: string[];
    declaredPortOfDischarge?: string;
    declaredDestination?: string;
    etd?: string;
    eta?: string;
    voyage: ReconstructedVoyage | null;
  }): RouteComparisonResult {
    const normOrigin = params.declaredOrigin || 'Origin';
    const normLoading = params.declaredPortOfLoading || params.declaredOrigin || 'Loading Port';
    const normDischarge = params.declaredPortOfDischarge || params.declaredDestination || 'Discharge Port';
    const normDest = params.declaredDestination || 'Final Destination';
    const declaredTransits = params.declaredTransitHubs || [];

    const loadingLocode = this.portNormalizer.normalizePort(normLoading, normOrigin).locode;
    const dischargeLocode = this.portNormalizer.normalizePort(normDischarge, normDest).locode;

    const declaredRoute = {
      origin: normOrigin,
      portOfLoading: normLoading,
      loadingLocode,
      transitHubs: declaredTransits,
      portOfDischarge: normDischarge,
      dischargeLocode,
      finalDestination: normDest,
      etd: params.etd,
      eta: params.eta,
    };

    const limitationNotice =
      'Vessel-level route evidence does not by itself establish cargo-level transshipment. Historical port-call records reflect observed vessel movements during the relevant voyage window, which may include customary commercial transshipment or multi-port discharge operations.';

    // Case 1: Route data unavailable
    if (!params.voyage || params.voyage.events.length === 0) {
      return {
        declaredRoute,
        intermediatePortsCount: 0,
        undeclaredIntermediatePortsCount: 0,
        undeclaredPorts: [],
        routeClassification: 'ROUTE_DATA_UNAVAILABLE',
        routeDeviationDetected: false,
        routeRiskLevel: 'LOW',
        routeRiskScore: 10,
        routeFindings: [
          'Historical vessel route evidence could not be retrieved for the relevant voyage window.',
          'Customary shipping document and carrier manifest review recommended.',
        ],
        evidenceRecords: [],
        limitationNotice,
      };
    }

    const voyage = params.voyage;
    const observedEvents = voyage.events;

    // Identify intermediate port calls (calls occurring between departure from loading port and arrival at discharge port)
    const departureEvent = observedEvents.find((e) => e.event === 'DEPARTURE');
    const arrivalEvent = [...observedEvents].reverse().find((e) => e.event === 'ARRIVAL');

    const intermediateDetails: IntermediatePortDetail[] = [];
    const undeclaredPorts: PortLocation[] = [];
    const routeFindings: string[] = [];

    // Group intermediate calls by port locode
    const intermediatePortMap = new Map<string, { port: PortLocation; arrival?: string; departure?: string }>();

    for (const ev of observedEvents) {
      // Exclude origin and final destination
      if (ev.port.locode === loadingLocode || ev.port.locode === dischargeLocode) {
        continue;
      }

      const existing = intermediatePortMap.get(ev.port.locode) || { port: ev.port };
      if (ev.event === 'ARRIVAL') existing.arrival = ev.timestamp;
      if (ev.event === 'DEPARTURE') existing.departure = ev.timestamp;
      intermediatePortMap.set(ev.port.locode, existing);
    }

    let hasSanctionedPort = false;
    let hasHighRiskJurisdiction = false;
    let hasCommercialNormalHubsOnly = true;

    for (const [locode, item] of intermediatePortMap.entries()) {
      const isDeclared = declaredTransits.some(
        (t) =>
          this.portNormalizer.normalizePort(t).locode === locode ||
          t.toLowerCase().includes(item.port.name.toLowerCase()),
      );

      if (!isDeclared) {
        undeclaredPorts.push(item.port);
      }

      // Check jurisdiction risk of intermediate port
      let jRiskLevel: IntermediatePortDetail['jurisdictionRiskLevel'] = 'CLEAR';
      let jExplanation = 'Standard commercial transit jurisdiction.';

      // Check against Comprehensive Sanctions
      const sanctionedHit = SANCTIONED_JURISDICTIONS.find(
        (sj) =>
          sj.countryName.toLowerCase() === item.port.country.toLowerCase() ||
          sj.countryCode === item.port.countryCode,
      );

      if (sanctionedHit || this.monitoredTransshipmentHubs.has(locode)) {
        jRiskLevel = 'SANCTIONED';
        hasSanctionedPort = true;
        hasCommercialNormalHubsOnly = false;
        jExplanation = `Intermediate port ${item.port.name} (${locode}) is located in a comprehensively sanctioned or restricted maritime jurisdiction (${item.port.country}).`;
      } else if (!this.normalCommercialHubs.has(locode)) {
        hasCommercialNormalHubsOnly = false;
        jRiskLevel = 'ELEVATED';
        jExplanation = `Port ${item.port.name} (${locode}) represents an unexpected intermediate call outside typical major commercial relay hubs.`;
      }

      intermediateDetails.push({
        port: item.port,
        arrivalTime: item.arrival,
        departureTime: item.departure,
        wasDeclared: isDeclared,
        jurisdictionRiskLevel: jRiskLevel,
        jurisdictionExplanation: jExplanation,
      });
    }

    const intermediateCount = intermediateDetails.length;
    const undeclaredCount = undeclaredPorts.length;
    const routeDeviationDetected = undeclaredCount > 0;

    // Determine Route Classification
    let routeClassification: RouteClassification = 'DIRECT_ROUTE';
    let routeRiskLevel: RouteRiskLevel = 'LOW';
    let routeRiskScore = 10;

    if (hasSanctionedPort) {
      routeClassification = 'HIGH_RISK_ROUTING';
      routeRiskLevel = 'CRITICAL';
      routeRiskScore = 90;
      routeFindings.push(
        `High-Risk Maritime Routing: Vessel called at sanctioned or embargoed port (${intermediateDetails.find((d) => d.jurisdictionRiskLevel === 'SANCTIONED')?.port.name}) during voyage window.`,
      );
    } else if (undeclaredCount > 0 && !hasCommercialNormalHubsOnly) {
      routeClassification = 'UNEXPECTED_TRANSIT_JURISDICTION';
      routeRiskLevel = 'HIGH';
      routeRiskScore = 55;
      routeFindings.push(
        `Unexpected Transit Jurisdiction: Vessel port-call sequence contains ${undeclaredCount} intermediate port(s) not declared in trade presentation documents.`,
      );
    } else if (undeclaredCount > 0 && hasCommercialNormalHubsOnly) {
      routeClassification = 'NORMAL_TRANSSHIPMENT';
      routeRiskLevel = 'MEDIUM';
      routeRiskScore = 30;
      routeFindings.push(
        `Customary Commercial Transshipment: The vessel called at established container relay hub(s) (${undeclaredPorts.map((p) => p.name).join(', ')}). Commercial transshipment is standard practice for this container trade corridor.`,
      );
    } else if (intermediateCount > 0) {
      routeClassification = 'INTERMEDIATE_PORTS_PRESENT';
      routeRiskLevel = 'LOW';
      routeRiskScore = 15;
      routeFindings.push(
        `Intermediate port calls match declared transport documentation (${intermediateDetails.map((d) => d.port.name).join(' -> ')}).`,
      );
    } else {
      routeClassification = 'DIRECT_ROUTE';
      routeRiskLevel = 'LOW';
      routeRiskScore = 10;
      routeFindings.push('Direct point-to-point carriage observed without intermediate port calls.');
    }

    // Compose Evidence Record
    const evidenceRecords: MaritimeEvidenceRecord[] = [
      {
        provider: voyage.provider,
        query: `IMO:${voyage.vessel.imo || 'N/A'} | ${voyage.vessel.name} [${normLoading} -> ${normDischarge}]`,
        vesselIdentifier: `IMO ${voyage.vessel.imo || 'N/A'} (${voyage.vessel.name})`,
        dateRange: `${voyage.voyageWindowStart.slice(0, 10)} to ${voyage.voyageWindowEnd.slice(0, 10)}`,
        retrievedTimestamp: voyage.retrievedAt,
        observedPorts: observedEvents.map((e) => `${e.port.name} (${e.port.locode}) [${e.event}]`),
        dataConfidence: voyage.dataConfidence,
        sourceReference: `AIS Automated Port-Call Digest • Ref ${voyage.voyageNumber || 'AIS-HIST-2026'}`,
      },
    ];

    const observedRoute = {
      originPort: this.portNormalizer.normalizePort(normOrigin),
      portOfLoading: departureEvent?.port || this.portNormalizer.normalizePort(normLoading),
      intermediateCalls: intermediateDetails,
      portOfDischarge: arrivalEvent?.port || this.portNormalizer.normalizePort(normDischarge),
      departureTime: departureEvent?.timestamp,
      arrivalTime: arrivalEvent?.timestamp,
    };

    return {
      declaredRoute,
      observedRoute,
      vessel: voyage.vessel,
      intermediatePortsCount: intermediateCount,
      undeclaredIntermediatePortsCount: undeclaredCount,
      undeclaredPorts,
      routeClassification,
      routeDeviationDetected,
      routeRiskLevel,
      routeRiskScore,
      routeFindings,
      evidenceRecords,
      limitationNotice,
    };
  }
}
