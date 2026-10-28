import { SnapshotRegistry } from '../temporal/snapshot-registry';
import type { TemporalSanctionsMatch, TemporalSanctionsStatus } from '../temporal/temporal.types';
import type { TradeParties } from '../types';
import { CONFIRMED_MATCH_THRESHOLD, isScreenableName } from './name-matching';

export interface TemporalScreeningResult {
  transactionTimestamp: string;
  overallTemporalStatus: TemporalSanctionsStatus;
  isCurrentlyListed: boolean;
  wasListedAtTransactionTime: boolean;
  hasPostTransactionDesignations: boolean;
  temporalMatches: TemporalSanctionsMatch[];
  historicalFindingsSummary: string;
  currentFindingsSummary: string;
  screenedEntitiesCount: number;
  /** Name-similarity hits below the confirmation threshold, awaiting analyst disposition. */
  possibleMatchCount: number;
}

export class TemporalSanctionsService {
  private readonly registry = SnapshotRegistry.getInstance();

  /**
   * Screen counterparties, banks, and vessels as of transactionTimestamp.
   */
  screenTransactionPointInTime(params: {
    parties: TradeParties;
    transactionTimestamp: string;
    vesselName?: string;
    vesselImo?: string;
    jurisdictions?: Array<'US' | 'UN' | 'EU' | 'UK' | 'PK'>;
  }): TemporalScreeningResult {
    const txnTime = params.transactionTimestamp || new Date().toISOString();
    const temporalMatches: TemporalSanctionsMatch[] = [];
    let screenedEntitiesCount = 0;

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
      { role: 'ISSUING BANK', party: params.parties.issuingBank },
      { role: 'ADVISING BANK', party: params.parties.advisingBank },
      { role: 'CONFIRMING BANK', party: params.parties.confirmingBank },
      { role: 'NOMINATED BANK', party: params.parties.nominatedBank },
      { role: 'REMITTING BANK', party: params.parties.remittingBank },
      { role: 'INTERMEDIARY BANK', party: params.parties.intermediaryBank },
      // Carriers, forwarders and suppliers are screened by the list engine too; leaving them out here
      // would let a party designated at the transaction date pass the point-in-time check.
      { role: 'CARRIER', party: params.parties.carrier },
      { role: 'FREIGHT FORWARDER', party: params.parties.freightForwarder },
      { role: 'MANUFACTURER', party: params.parties.manufacturer },
      { role: 'SUPPLIER', party: params.parties.supplier },
    ];

    for (const item of partyList) {
      const names = [item.party?.legalName || item.party?.bank, item.party?.tradingName];
      for (const [index, name] of names.entries()) {
        if (!name || name === 'Not Found') continue;
        if (index === 1 && name === names[0]) continue;
        if (!isScreenableName(name)) continue;

        screenedEntitiesCount++;
        const hits = this.registry.queryEntityPointInTime(name, index === 0 ? item.role : `${item.role} (Trading Name)`, txnTime, {
          jurisdictions: params.jurisdictions,
          swiftBic: index === 0 ? item.party?.swiftBic : undefined,
        });
        temporalMatches.push(...hits);
      }
    }

    if (params.vesselName && params.vesselName !== 'Not Found') {
      screenedEntitiesCount++;
      const vesselHits = this.registry.queryEntityPointInTime(params.vesselName, 'VESSEL', txnTime, {
        jurisdictions: params.jurisdictions,
        imoNumber: params.vesselImo,
      });
      temporalMatches.push(...vesselHits);
    }

    // Only a confirmed match (exact name/alias or identifier) is treated as a listing. Weaker name
    // similarity is reported separately as a possible match for an analyst to disposition.
    const confirmed = temporalMatches.filter((m) => m.matchConfidence >= CONFIRMED_MATCH_THRESHOLD);
    const possibleMatchCount = temporalMatches.filter(
      (m) => m.matchConfidence < CONFIRMED_MATCH_THRESHOLD && (m.wasListedAtTransactionTime || m.isCurrentlyListed),
    ).length;
    const wasListedAtTransactionTime = confirmed.some((m) => m.wasListedAtTransactionTime);
    const isCurrentlyListed = confirmed.some((m) => m.isCurrentlyListed);
    const hasPostTransactionDesignations = confirmed.some((m) => m.temporalStatus === 'ADDED_AFTER_TRANSACTION');

    let overallTemporalStatus: TemporalSanctionsStatus = 'NOT_LISTED_AT_TRANSACTION_TIME';
    if (wasListedAtTransactionTime) {
      overallTemporalStatus = 'LISTED_AT_TRANSACTION_TIME';
    } else if (hasPostTransactionDesignations) {
      overallTemporalStatus = 'ADDED_AFTER_TRANSACTION';
    } else if (temporalMatches.some((m) => m.temporalStatus === 'REMOVED_BEFORE_TRANSACTION')) {
      overallTemporalStatus = 'REMOVED_BEFORE_TRANSACTION';
    }

    const historicalFindingsSummary = wasListedAtTransactionTime
      ? `PROHIBITED AT TRANSACTION DATE: Direct active designation identified on ${confirmed.find((m) => m.wasListedAtTransactionTime)?.sanctionsList} as of ${new Date(txnTime).toLocaleDateString()}.`
      : possibleMatchCount > 0
        ? `NO CONFIRMED DESIGNATION AT TRANSACTION DATE (${new Date(txnTime).toLocaleDateString()}), but ${possibleMatchCount} possible name match(es) require analyst disposition.`
        : `CLEAR AT TRANSACTION DATE: No active sanctions designations existed against screened parties on ${new Date(txnTime).toLocaleDateString()}.`;

    const currentFindingsSummary = isCurrentlyListed
      ? hasPostTransactionDesignations
        ? `CURRENT LISTING (POST-TRANSACTION): Entity was added to sanctions lists on ${new Date(confirmed.find((m) => m.temporalStatus === 'ADDED_AFTER_TRANSACTION')?.designationDate || '').toLocaleDateString()}, AFTER the transaction date. Retrospective review active.`
        : 'CURRENT STATUS: Subject remains an active designated party on international watchlists.'
      : 'CURRENT STATUS: No active designations found on current datasets.';

    return {
      transactionTimestamp: txnTime,
      overallTemporalStatus,
      isCurrentlyListed,
      wasListedAtTransactionTime,
      hasPostTransactionDesignations,
      temporalMatches,
      historicalFindingsSummary,
      currentFindingsSummary,
      screenedEntitiesCount,
      possibleMatchCount,
    };
  }
}
