import { SnapshotRegistry } from '../temporal/snapshot-registry';
import type { TemporalSanctionsMatch, TemporalSanctionsStatus } from '../temporal/temporal.types';
import type { TradeParties } from '../types';

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
    ];

    for (const item of partyList) {
      const name = item.party?.legalName || item.party?.bank;
      if (!name || name === 'Not Found') continue;

      screenedEntitiesCount++;
      const hits = this.registry.queryEntityPointInTime(name, item.role, txnTime, {
        jurisdictions: params.jurisdictions,
        swiftBic: item.party?.swiftBic,
      });
      temporalMatches.push(...hits);
    }

    if (params.vesselName && params.vesselName !== 'Not Found') {
      screenedEntitiesCount++;
      const vesselHits = this.registry.queryEntityPointInTime(params.vesselName, 'VESSEL', txnTime, {
        jurisdictions: params.jurisdictions,
        imoNumber: params.vesselImo,
      });
      temporalMatches.push(...vesselHits);
    }

    const wasListedAtTransactionTime = temporalMatches.some((m) => m.wasListedAtTransactionTime);
    const isCurrentlyListed = temporalMatches.some((m) => m.isCurrentlyListed);
    const hasPostTransactionDesignations = temporalMatches.some((m) => m.temporalStatus === 'ADDED_AFTER_TRANSACTION');

    let overallTemporalStatus: TemporalSanctionsStatus = 'NOT_LISTED_AT_TRANSACTION_TIME';
    if (wasListedAtTransactionTime) {
      overallTemporalStatus = 'LISTED_AT_TRANSACTION_TIME';
    } else if (hasPostTransactionDesignations) {
      overallTemporalStatus = 'ADDED_AFTER_TRANSACTION';
    } else if (temporalMatches.some((m) => m.temporalStatus === 'REMOVED_BEFORE_TRANSACTION')) {
      overallTemporalStatus = 'REMOVED_BEFORE_TRANSACTION';
    }

    const historicalFindingsSummary = wasListedAtTransactionTime
      ? `PROHIBITED AT TRANSACTION DATE: Direct active designation identified on ${temporalMatches.find((m) => m.wasListedAtTransactionTime)?.sanctionsList} as of ${new Date(txnTime).toLocaleDateString()}.`
      : `CLEAR AT TRANSACTION DATE: No active sanctions designations existed against screened parties on ${new Date(txnTime).toLocaleDateString()}.`;

    const currentFindingsSummary = isCurrentlyListed
      ? hasPostTransactionDesignations
        ? `CURRENT LISTING (POST-TRANSACTION): Entity was added to sanctions lists on ${new Date(temporalMatches.find((m) => m.temporalStatus === 'ADDED_AFTER_TRANSACTION')?.designationDate || '').toLocaleDateString()}, AFTER the transaction date. Retrospective review active.`
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
    };
  }
}
