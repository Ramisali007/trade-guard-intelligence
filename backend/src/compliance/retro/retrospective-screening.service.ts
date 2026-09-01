import type { RetrospectiveAlert } from '../temporal/temporal.types';

export class RetrospectiveScreeningService {
  private static instance: RetrospectiveScreeningService;
  private readonly alerts: RetrospectiveAlert[] = [];

  public static getInstance(): RetrospectiveScreeningService {
    if (!RetrospectiveScreeningService.instance) {
      RetrospectiveScreeningService.instance = new RetrospectiveScreeningService();
    }
    return RetrospectiveScreeningService.instance;
  }

  /**
   * Evaluate if a transaction has post-transaction designations.
   */
  evaluateRetrospectiveExposure(params: {
    transactionId: string;
    tradeReference: string;
    transactionTimestamp: string;
    parties: Array<{ name: string; role: string }>;
    postTransactionMatches: Array<{
      matchedName: string;
      role: string;
      sanctionsList: string;
      designationDate: string;
      effectiveDate: string;
    }>;
  }): RetrospectiveAlert[] {
    const generatedAlerts: RetrospectiveAlert[] = [];

    for (const match of params.postTransactionMatches) {
      const alertId = `RETRO-${params.transactionId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const alert: RetrospectiveAlert = {
        alertId,
        transactionId: params.transactionId,
        tradeReference: params.tradeReference,
        transactionTimestamp: params.transactionTimestamp,
        detectedAt: new Date().toISOString(),
        newlyDesignatedEntityName: match.matchedName,
        partyRoleInTransaction: match.role,
        sanctionsList: match.sanctionsList,
        designationDate: match.designationDate,
        effectiveDate: match.effectiveDate,
        retrospectiveImpact: 'POST_TRANSACTION_DESIGNATION_MONITORING',
        recommendedAction: `Conduct review of bank exposure to ${match.matchedName}. Ensure no active or forward settlement commitments remain open following designation on ${new Date(match.designationDate).toLocaleDateString()}.`,
        status: 'PENDING_REVIEW',
      };

      generatedAlerts.push(alert);
      this.alerts.push(alert);
    }

    return generatedAlerts;
  }

  public listAlerts(): RetrospectiveAlert[] {
    return [...this.alerts];
  }
}
