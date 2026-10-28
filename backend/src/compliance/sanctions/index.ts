import type { ISanctionsProvider, ScreeningQuery } from './sanctions.provider';
import { isScreenableName } from './name-matching';
import { OfacSanctionsProvider } from './ofac.provider';
import { UnSanctionsProvider } from './un.provider';
import { EuUkSanctionsProvider } from './eu-uk.provider';
import { OpenSanctionsProvider } from './opensanctions.provider';
import type {
  JurisdictionRiskCheck,
  SanctionsMatch,
  SanctionsRiskStatus,
  SanctionsScreeningResult,
  TradeParties,
} from '../types';

/**
 * Screens parties, banks, vessels and jurisdictions.
 *
 * The local compliance store is always screened. The small built-in sample lists (OFAC/UN/EU-UK
 * providers) exist so the system works offline before any feed has been downloaded; each one is
 * dropped as soon as its list has been loaded from the publisher, so sample records never sit
 * alongside the real list.
 */
export class SanctionsEngine {
  private readonly storeProvider = new OpenSanctionsProvider();
  private readonly builtIn: Array<{ listId: string; provider: ISanctionsProvider }> = [
    { listId: 'OFAC_SDN', provider: new OfacSanctionsProvider() },
    { listId: 'UN_CONSOLIDATED', provider: new UnSanctionsProvider() },
    { listId: 'EU_FSF', provider: new EuUkSanctionsProvider() },
  ];
  private providers: ISanctionsProvider[] = [];
  private datasetVersion = '';

  private async resolveProviders(): Promise<void> {
    const { ComplianceStore } = await import('../db/compliance-store');
    const store = ComplianceStore.getInstance();
    await store.init();
    const live = store.getLiveSourceIds();
    const sources = (await store.getSources()).filter((s) => s.dataCategory === 'SANCTIONS');

    this.providers = [this.storeProvider, ...this.builtIn.filter((b) => !live.has(b.listId)).map((b) => b.provider)];
    const storeVersions = sources.map(
      (s) => `${s.sourceId}@${s.dataOrigin === 'LIVE_FEED' ? s.currentVersion : 'samples'} (${s.recordCount.toLocaleString('en-US')})`,
    );
    const builtInVersions = this.providers.filter((p) => p !== this.storeProvider).map((p) => p.datasetVersion);
    this.datasetVersion = [...storeVersions, ...builtInVersions].join(' | ');
  }

  async screenTransaction(params: {
    parties: TradeParties;
    vesselName?: string;
    vesselImo?: string;
    originCountry?: string;
    destinationCountry?: string;
    transitCountries?: string[];
    portOfLoading?: string;
    portOfDischarge?: string;
  }): Promise<SanctionsScreeningResult> {
    await this.resolveProviders();
    const matches: SanctionsMatch[] = [];
    const jurisdictionRisks: JurisdictionRiskCheck[] = [];
    let screenedEntitiesCount = 0;
    let screenedVesselsCount = 0;
    // Names present on the document that could not be compared at all. They are never reported as clear.
    const unscreenedNames: string[] = [];
    let screenedCountriesCount = 0;

    // 1. Screen Parties
    const partyList = [
      { role: 'SELLER / EXPORTER', party: params.parties.seller },
      { role: 'BUYER / IMPORTER', party: params.parties.buyer },
      { role: 'APPLICANT', party: params.parties.applicant },
      { role: 'BENEFICIARY', party: params.parties.beneficiary },
      { role: 'CONSIGNEE', party: params.parties.consignee },
      { role: 'ULTIMATE CONSIGNEE', party: params.parties.ultimateConsignee },
      { role: 'END USER', party: params.parties.endUser },
      { role: 'SHIPPER', party: params.parties.shipper },
      { role: 'NOTIFY PARTY', party: params.parties.notifyParty },
      { role: 'CARRIER', party: params.parties.carrier },
      { role: 'FREIGHT FORWARDER', party: params.parties.freightForwarder },
      { role: 'MANUFACTURER', party: params.parties.manufacturer },
      { role: 'SUPPLIER', party: params.parties.supplier },
    ];

    for (const item of partyList) {
      if (!item.party || !item.party.legalName || item.party.legalName === 'Not Found') continue;
      if (!isScreenableName(item.party.legalName)) {
        unscreenedNames.push(`${item.role}: ${item.party.legalName}`);
        continue;
      }
      screenedEntitiesCount++;
      const query: ScreeningQuery = {
        name: item.party.legalName,
        role: item.role,
        country: item.party.country,
        address: item.party.address,
        entityType: 'ENTITY',
      };

      for (const provider of this.providers) {
        const hits = await provider.screenEntity(query);
        matches.push(...hits);
      }

      // Check party trading name if distinct
      if (item.party.tradingName && item.party.tradingName !== item.party.legalName && item.party.tradingName !== 'Not Found') {
        const tradingQuery: ScreeningQuery = {
          name: item.party.tradingName,
          role: `${item.role} (Trading Name)`,
          country: item.party.country,
        };
        for (const provider of this.providers) {
          const hits = await provider.screenEntity(tradingQuery);
          matches.push(...hits);
        }
      }
    }

    // 2. Screen Banks
    const bankList = [
      { role: 'ISSUING BANK', party: params.parties.issuingBank },
      { role: 'ADVISING BANK', party: params.parties.advisingBank },
      { role: 'CONFIRMING BANK', party: params.parties.confirmingBank },
      { role: 'NOMINATED BANK', party: params.parties.nominatedBank },
      { role: 'REMITTING BANK', party: params.parties.remittingBank },
      { role: 'INTERMEDIARY BANK', party: params.parties.intermediaryBank },
    ];

    for (const b of bankList) {
      const bankName = b.party?.bank || b.party?.legalName;
      if (!bankName || bankName === 'Not Found') continue;
      if (!isScreenableName(bankName)) {
        unscreenedNames.push(`${b.role}: ${bankName}`);
        continue;
      }
      screenedEntitiesCount++;
      for (const provider of this.providers) {
        const hits = await provider.screenBank(bankName, b.party?.swiftBic, b.party?.bankCountry || b.party?.country);
        matches.push(...hits);
      }
    }

    // 3. Screen Vessels
    if (params.vesselName && params.vesselName !== 'Not Found') {
      screenedVesselsCount++;
      for (const provider of this.providers) {
        const hits = await provider.screenVessel(params.vesselName, params.vesselImo);
        matches.push(...hits);
      }
    }

    // 4. Screen Jurisdictions
    const geoNodes: Array<{ role: JurisdictionRiskCheck['nodeRole']; country?: string }> = [
      { role: 'ORIGIN', country: params.originCountry },
      { role: 'FINAL_DESTINATION', country: params.destinationCountry },
      { role: 'COUNTERPARTY_COUNTRY', country: params.parties.seller?.country },
      { role: 'COUNTERPARTY_COUNTRY', country: params.parties.buyer?.country },
      { role: 'COUNTERPARTY_COUNTRY', country: params.parties.consignee?.country },
      { role: 'COUNTERPARTY_COUNTRY', country: params.parties.endUser?.country },
    ];

    if (params.transitCountries) {
      for (const tc of params.transitCountries) {
        geoNodes.push({ role: 'TRANSIT_COUNTRY', country: tc });
      }
    }

    for (const node of geoNodes) {
      if (!node.country || node.country === 'Not Found') continue;
      screenedCountriesCount++;
      for (const provider of this.providers) {
        const risk = await provider.checkJurisdiction(node.country, node.role);
        if (risk && !jurisdictionRisks.some((j) => j.countryName === risk.countryName && j.nodeRole === risk.nodeRole)) {
          jurisdictionRisks.push(risk);
        }
      }
    }

    // 5. Determine Overall Sanctions Risk Status & Score
    let status: SanctionsRiskStatus = 'NONE';
    let overallSanctionsRiskScore = 0;

    const hasConfirmedHit = matches.some((m) => m.matchConfidence >= 0.95);
    const hasPotentialHit = matches.some((m) => m.matchConfidence >= 0.75);
    const hasRestrictedJurisdiction = jurisdictionRisks.some((j) => j.sanctionsStatus === 'COMPREHENSIVE_SANCTIONED');
    const hasSectoralJurisdiction = jurisdictionRisks.some((j) => j.sanctionsStatus === 'SECTORAL_SANCTIONS' || j.sanctionsStatus === 'FATF_BLACK_LIST');

    if (hasConfirmedHit) {
      status = 'CONFIRMED_MATCH';
      overallSanctionsRiskScore = 100;
    } else if (hasRestrictedJurisdiction) {
      status = 'RESTRICTED_JURISDICTION';
      overallSanctionsRiskScore = Math.max(90, ...jurisdictionRisks.map((j) => j.riskScore));
    } else if (hasPotentialHit) {
      status = 'POTENTIAL_MATCH';
      overallSanctionsRiskScore = 75;
    } else if (hasSectoralJurisdiction) {
      status = 'REQUIRES_LICENSE_AUTHORIZATION';
      overallSanctionsRiskScore = 65;
    } else if ((screenedEntitiesCount === 0 && screenedCountriesCount === 0) || unscreenedNames.length > 0) {
      // Nothing (or not everything) could be compared: that is an open question, not a clear result.
      status = 'UNKNOWN_INSUFFICIENT_DATA';
      overallSanctionsRiskScore = unscreenedNames.length > 0 ? 55 : 40;
    } else {
      status = 'NONE';
      overallSanctionsRiskScore = 5;
    }

    return {
      status,
      overallSanctionsRiskScore,
      matches,
      jurisdictionRisks,
      screenedEntitiesCount,
      screenedCountriesCount,
      screenedVesselsCount,
      ...(unscreenedNames.length > 0 ? { unscreenedNames } : {}),
      datasetVersion: this.datasetVersion,
      screeningTimestamp: new Date().toISOString(),
    };
  }
}
