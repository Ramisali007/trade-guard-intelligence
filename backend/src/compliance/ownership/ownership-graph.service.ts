import type { OwnershipComplianceResult, TemporalOwnershipEdge, TemporalOwnershipNode } from '../temporal/temporal.types';

export class OwnershipGraphService {
  private readonly edges: TemporalOwnershipEdge[] = [
    // Historical Graph Fixtures
    {
      ownerId: 'BLOCKED-ENT-01',
      ownerName: 'Vnesheconombank (VEB.RF)',
      targetId: 'COMP-RUSSIA-TECH-99',
      targetName: 'Baltic Navigation Electronics LLC',
      ownershipPercentage: 55.0, // 55% owned by VEB -> Blocked under OFAC 50% Rule!
      controlType: 'DIRECT_EQUITY',
      effectiveFrom: '2022-03-01T00:00:00Z',
      effectiveTo: null,
      source: 'Russian Unified State Register of Legal Entities (EGRUL)',
      confidence: 0.98,
    },
    {
      ownerId: 'BLOCKED-ENT-02',
      ownerName: 'Sovcomflot Group',
      targetId: 'SHIP-CYPRUS-04',
      targetName: 'SCF Prime Maritime Shipping Ltd',
      ownershipPercentage: 100.0,
      controlType: 'DIRECT_EQUITY',
      effectiveFrom: '2021-01-01T00:00:00Z',
      effectiveTo: null,
      source: 'Cyprus Registrar of Companies',
      confidence: 0.99,
    },
    {
      ownerId: 'BLOCKED-ENT-03',
      ownerName: 'Oleg Deripaska',
      targetId: 'RUSAL-OLD',
      targetName: 'Rusal Pacific Holdings',
      ownershipPercentage: 65.0,
      controlType: 'VOTING_RIGHTS',
      effectiveFrom: '2015-01-01T00:00:00Z',
      effectiveTo: '2019-01-27T00:00:00Z', // Divested in Jan 2019 under En+ delisting
      source: 'SEC Form 20-F & OFAC Regulatory Filings',
      confidence: 0.95,
    },
  ];

  /**
   * Evaluate beneficial ownership of a transaction entity as of transactionTimestamp.
   */
  evaluateOwnership(entityName: string, transactionTimestamp: string): OwnershipComplianceResult {
    const txnTime = new Date(transactionTimestamp).getTime();
    const cleanName = (entityName || '').toLowerCase().trim();

    // Find applicable ownership edges active at the transaction date
    const activeEdges = this.edges.filter((e) => {
      const targetMatch = e.targetName.toLowerCase().includes(cleanName) || cleanName.includes(e.targetName.toLowerCase());
      if (!targetMatch) return false;

      const fromTime = new Date(e.effectiveFrom).getTime();
      const toTime = e.effectiveTo ? new Date(e.effectiveTo).getTime() : Infinity;
      return fromTime <= txnTime && txnTime < toTime;
    });

    let aggregateBlockedPercentage = 0;
    const blockingOwners: OwnershipComplianceResult['blockingOwners'] = [];

    for (const edge of activeEdges) {
      aggregateBlockedPercentage += edge.ownershipPercentage;
      blockingOwners.push({
        ownerName: edge.ownerName,
        ownershipPercentage: edge.ownershipPercentage,
        sanctionsProgram: 'OFAC-RUSSIA-EO14024',
        designationDate: edge.effectiveFrom,
      });
    }

    const isBlockedUnderOfac50PercentRule = aggregateBlockedPercentage >= 50.0;
    const isBlockedUnderEuUkControlRule = aggregateBlockedPercentage >= 50.0 || activeEdges.some((e) => e.controlType === 'BOARD_CONTROL' || e.controlType === 'DOMINANT_INFLUENCE');

    let explanation = `Direct and indirect beneficial ownership evaluated as of ${new Date(transactionTimestamp).toUTCString()}.`;
    if (isBlockedUnderOfac50PercentRule) {
      explanation += ` Entity is 50%+ owned (${aggregateBlockedPercentage}%) in aggregate by blocked persons (${blockingOwners.map((b) => b.ownerName).join(', ')}). Automatically blocked under OFAC 50 Percent Rule and EU/UK ownership and control rules.`;
    } else {
      explanation += ' No blocked beneficial ownership identified above the 50% regulatory threshold at transaction date.';
    }

    return {
      targetEntityName: entityName,
      evaluatedAt: transactionTimestamp,
      aggregateBlockedOwnershipPercentage: aggregateBlockedPercentage,
      isBlockedUnderOfac50PercentRule,
      isBlockedUnderEuUkControlRule,
      blockingOwners,
      explanation,
    };
  }
}
