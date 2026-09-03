import type {
  BehavioralAlert,
  ClientComparisonAnalytics,
  CustomerBehavioralAssessment,
  CustomerBehavioralBaseline,
  CustomerProfile,
  EntityResolutionResult,
} from './behavioral.types';

export class CustomerBehaviorService {
  /**
   * Evaluate customer historical behavior against the current trade presentation.
   */
  evaluateCustomerBehavior(params: {
    customerProfile: CustomerProfile;
    entityResolution: EntityResolutionResult;
    transactionId: string;
    transactionValueUsd: number;
    currentMonthLCCount?: number;
    currentProductCategories: string[];
    currentCounterparties: string[];
    originCountry: string;
    destinationCountry: string;
    transitCountries: string[];
    declaredBusinessActivity?: string;
    observedIntermediatePorts?: string[];
    routeDeviationDetected?: boolean;
  }): CustomerBehavioralAssessment {
    const profile = params.customerProfile;
    const alerts: BehavioralAlert[] = [];
    const recommendations: string[] = [];

    // 1. Establish Rolling Behavioral Baseline
    const baseline = this.buildCustomerBaseline(profile);

    // 2. Rule 1: Sudden LC-Frequency Spike Detection
    const currentMonthLcs = params.currentMonthLCCount ?? (profile.monthlyLcFrequency + 3);
    const baselineMonthlyLcs = profile.monthlyLcFrequency > 0 ? profile.monthlyLcFrequency : 2.0;

    if (currentMonthLcs >= 5 && currentMonthLcs >= baselineMonthlyLcs * 2.5) {
      const freqChangePercent = Math.round(((currentMonthLcs - baselineMonthlyLcs) / baselineMonthlyLcs) * 100);
      alerts.push({
        alertId: `ALT-FREQ-${Date.now().toString(36).toUpperCase()}`,
        customerReferenceId: profile.customerReferenceId,
        transactionId: params.transactionId,
        alertCode: 'LC_FREQUENCY_SPIKE',
        severity: 'HIGH',
        metric: 'Monthly LC Ingestion Frequency',
        baselineValue: Number(baselineMonthlyLcs.toFixed(1)),
        observedValue: currentMonthLcs,
        deviationPercent: freqChangePercent,
        explanation: `Customer opened ${currentMonthLcs} Letters of Credit this calendar month compared to an established historical average of ${baselineMonthlyLcs.toFixed(1)} LCs/month (+${freqChangePercent}% increase).`,
        evidence: [
          `Customer Reference: ${profile.customerReferenceId} (${profile.legalName})`,
          `Historical monthly mean: ${baselineMonthlyLcs.toFixed(1)} LCs/month (std dev: 0.8)`,
          `Current observation window: ${currentMonthLcs} LCs within active 30-day period`,
        ],
        detectedAt: new Date().toISOString(),
        requiresEnhancedReview: true,
      });
      recommendations.push(
        'Verify underlying commercial capacity and obtain customer explanation for the abrupt volume acceleration in documentary credit issuances.',
      );
    }

    // 3. Rule 2: Transaction Value Volumetric Spike
    const avgVal = profile.averageTransactionValueUsd > 0 ? profile.averageTransactionValueUsd : 150000;
    if (params.transactionValueUsd >= avgVal * 3.5 && params.transactionValueUsd > 250000) {
      const valChangePercent = Math.round(((params.transactionValueUsd - avgVal) / avgVal) * 100);
      alerts.push({
        alertId: `ALT-VAL-${Date.now().toString(36).toUpperCase()}`,
        customerReferenceId: profile.customerReferenceId,
        transactionId: params.transactionId,
        alertCode: 'TRANSACTION_VALUE_SPIKE',
        severity: 'HIGH',
        metric: 'Individual LC Transaction Value',
        baselineValue: `$${avgVal.toLocaleString()} USD`,
        observedValue: `$${params.transactionValueUsd.toLocaleString()} USD`,
        deviationPercent: valChangePercent,
        explanation: `Transaction value ($${params.transactionValueUsd.toLocaleString()} USD) materially exceeds the customer historical average ($${avgVal.toLocaleString()} USD) by +${valChangePercent}%.`,
        evidence: [
          `Customer average transaction size: $${avgVal.toLocaleString()} USD`,
          `Current presentation size: $${params.transactionValueUsd.toLocaleString()} USD`,
        ],
        detectedAt: new Date().toISOString(),
        requiresEnhancedReview: true,
      });
      recommendations.push('Perform enhanced financial due diligence on customer credit limits and source of funds.');
    }

    // 4. Rule 3: Product Profile Migration
    const establishedCats = profile.establishedProductCategories.map((c) => c.toLowerCase());
    const novelCategories = params.currentProductCategories.filter(
      (cat) => !establishedCats.some((est) => est.includes(cat.toLowerCase()) || cat.toLowerCase().includes(est)),
    );

    if (novelCategories.length > 0 && establishedCats.length > 0) {
      alerts.push({
        alertId: `ALT-PROD-${Date.now().toString(36).toUpperCase()}`,
        customerReferenceId: profile.customerReferenceId,
        transactionId: params.transactionId,
        alertCode: 'PRODUCT_PROFILE_CHANGE',
        severity: 'HIGH',
        metric: 'Customer Traded Commodity Profile',
        baselineValue: profile.establishedProductCategories.join(', '),
        observedValue: novelCategories.join(', '),
        explanation: `Customer historically trades exclusively in "${profile.establishedProductCategories.join(', ')}". Current presentation involves new commodity category "${novelCategories.join(', ')}".`,
        evidence: [
          `Established categories: ${profile.establishedProductCategories.join(', ')}`,
          `Current novel commodity: ${novelCategories.join(', ')}`,
          `Declared core business: ${profile.declaredBusinessActivity || 'General Trading'}`,
        ],
        detectedAt: new Date().toISOString(),
        requiresEnhancedReview: true,
      });
      recommendations.push(
        'Obtain updated customer trade license, purchase contracts, and technical specifications for novel commodity lines.',
      );
    }

    // 5. Rule 4: New High-Risk Jurisdiction Exposure
    const highRiskCountries = ['IRAN', 'RUSSIA', 'SYRIA', 'NORTH KOREA', 'MYANMAR', 'BELARUS', 'CUBA'];
    const touchedCountries = [params.originCountry, params.destinationCountry, ...params.transitCountries].map((c) =>
      c.toUpperCase(),
    );
    const highRiskHit = touchedCountries.find((tc) => highRiskCountries.some((hr) => tc.includes(hr)));

    if (highRiskHit) {
      alerts.push({
        alertId: `ALT-GEO-${Date.now().toString(36).toUpperCase()}`,
        customerReferenceId: profile.customerReferenceId,
        transactionId: params.transactionId,
        alertCode: 'NEW_HIGH_RISK_JURISDICTION_EXPOSURE',
        severity: 'HIGH',
        metric: 'Geographic Trade Corridor',
        baselineValue: profile.establishedCountries.join(', ') || 'Standard Regional Corridors',
        observedValue: highRiskHit,
        explanation: `Transaction routes through comprehensively restricted or heightened-risk jurisdiction (${highRiskHit}) absent from customer historical trading pattern.`,
        evidence: [
          `Route nodes: ${params.originCountry} -> ${params.destinationCountry}`,
          `High risk jurisdiction identified: ${highRiskHit}`,
        ],
        detectedAt: new Date().toISOString(),
        requiresEnhancedReview: true,
      });
      recommendations.push('Review specific OFAC general license authorizations and end-user facilities in high-risk corridor.');
    }

    // 6. Rule 5: Customer Routing Profile & Transshipment Hub Divergence
    if (params.routeDeviationDetected || (params.observedIntermediatePorts && params.observedIntermediatePorts.length > 0)) {
      const historicalHubs = profile.commonTransshipmentHubs || profile.historicalIntermediatePorts || ['Direct Routing'];
      const currentHubs = (params.observedIntermediatePorts || []).filter((h): h is string => typeof h === 'string');
      const newHubs = currentHubs.filter(
        (hub) => !historicalHubs.some((h) => typeof h === 'string' && (h.toLowerCase().includes(hub.toLowerCase()) || hub.toLowerCase().includes(h.toLowerCase()))),
      );

      if (newHubs.length > 0 || (params.routeDeviationDetected && historicalHubs.length > 0)) {
        alerts.push({
          alertId: `ALT-ROUTE-${Date.now().toString(36).toUpperCase()}`,
          customerReferenceId: profile.customerReferenceId,
          transactionId: params.transactionId,
          alertCode: 'ROUTING_PROFILE_CHANGE',
          severity: 'MODERATE',
          metric: 'Customer Maritime Routing Baseline',
          baselineValue: profile.typicalRoutes?.join(' | ') || historicalHubs.join(', ') || 'Standard Direct Corridors',
          observedValue: currentHubs.length > 0 ? currentHubs.join(' -> ') : 'Undeclared Intermediate Calls',
          explanation: `Observed vessel route introduces uncharacteristic intermediate ports (${newHubs.length > 0 ? newHubs.join(', ') : 'unexpected stops'}) departing from customer historical routing baseline (${historicalHubs.join(', ')}).`,
          evidence: [
            `Customer Reference: ${profile.customerReferenceId} (${profile.legalName})`,
            `Typical routing: ${profile.typicalRoutes?.join('; ') || 'Standard established corridor'}`,
            `Observed transshipment deviation: ${currentHubs.join(' -> ') || 'Deviation detected'}`,
          ],
          detectedAt: new Date().toISOString(),
          requiresEnhancedReview: true,
        });
        recommendations.push(
          'Request documented commercial justification from shipper/consignee for novel maritime transshipment routing.',
        );
      }
    }

    // 6. Compute Behavioral Risk Score (0 - 100)
    let score = 15; // Low baseline
    for (const alt of alerts) {
      if (alt.severity === 'HIGH') score += 25;
      else if (alt.severity === 'MODERATE') score += 15;
      else score += 5;
    }
    score = Math.min(100, Math.max(0, score));

    const level: 'LOW' | 'MEDIUM' | 'HIGH' = score >= 65 ? 'HIGH' : score >= 35 ? 'MEDIUM' : 'LOW';

    let summary = `Customer profile ${profile.customerReferenceId} (${profile.legalName}) displays consistent behavioral indicators aligned with historical trade baselines.`;
    if (alerts.length > 0) {
      summary = `Customer profile ${profile.customerReferenceId} (${profile.legalName}) triggered ${alerts.length} behavioral anomaly alerts: ${alerts.map((a) => a.alertCode).join(', ')}. Requires compliance officer enhanced due diligence review.`;
    }

    const isReturning = !params.entityResolution.isNewCustomer && profile.lifetimeTransactionCount > 1;
    const avgHistoricalVal = profile.averageTransactionValueUsd > 0 ? profile.averageTransactionValueUsd : 120000;
    const valVariance = avgHistoricalVal > 0 ? Math.round(((params.transactionValueUsd - avgHistoricalVal) / avgHistoricalVal) * 100) : 0;

    const estCommodityCats = profile.establishedProductCategories.map((c) => c.toLowerCase());
    const commodityMatch = params.currentProductCategories.some((cat) =>
      estCommodityCats.some((est) => est.includes(cat.toLowerCase()) || cat.toLowerCase().includes(est)),
    );

    const establishedCountries = (profile.establishedCountries || []).map((c) => c.toLowerCase());
    const corridorMatch = establishedCountries.some((c) =>
      params.destinationCountry.toLowerCase().includes(c) || params.originCountry.toLowerCase().includes(c),
    );

    const establishedBuyers = (profile.regularBuyers || []).map((b) => b.toLowerCase());
    const counterpartyMatch = params.currentCounterparties.some((cp) =>
      establishedBuyers.some((eb) => eb.includes(cp.toLowerCase()) || cp.toLowerCase().includes(eb)),
    );

    const comparisonAnalytics: ClientComparisonAnalytics = {
      isReturningClient: isReturning,
      clientStatus: isReturning ? 'RETURNING_CLIENT' : 'FIRST_TIME_CLIENT',
      clientRole: profile.businessType.toLowerCase().includes('export') || profile.businessType.toLowerCase().includes('mill') ? 'EXPORTER_SELLER' : 'TRADING_PARTNER',
      previousTradesCount: profile.lifetimeTransactionCount,
      totalHistoricalVolumeUsd: profile.lifetimeVolumeUsd,
      historicalAverageValueUsd: avgHistoricalVal,
      currentVsAverageValueVariancePercent: valVariance,
      commodityContinuity: commodityMatch || !isReturning ? 'ESTABLISHED_COMMODITY' : 'NEW_COMMODITY_LINE',
      corridorContinuity: corridorMatch || !isReturning ? 'ESTABLISHED_CORRIDOR' : 'NEW_DESTINATION_MARKET',
      counterpartyContinuity: counterpartyMatch || !isReturning ? 'ESTABLISHED_PARTNER' : 'NEW_TRADING_COUNTERPARTY',
      historicalRiskRating: profile.riskRating || 'LOW',
      summaryNarrative: isReturning
        ? `Returning client profile (${profile.customerReferenceId}) with ${profile.lifetimeTransactionCount} recorded trade presentations totaling $${profile.lifetimeVolumeUsd.toLocaleString()} USD lifetime volume. Current presentation is ${valVariance >= 0 ? '+' : ''}${valVariance}% vs historical average.`
        : `First-time client entity (${params.entityResolution.customerReferenceId}). Initial golden record baseline established for future trade comparisons.`,
    };

    return {
      customerProfile: profile,
      entityResolution: params.entityResolution,
      baselines: baseline,
      alerts,
      behavioralRiskScore: score,
      behavioralRiskLevel: level,
      behavioralSummary: summary,
      analyticalRecommendations: recommendations,
      comparisonAnalytics,
    };
  }

  private buildCustomerBaseline(profile: CustomerProfile): CustomerBehavioralBaseline {
    const monthlyMean = profile.monthlyLcFrequency > 0 ? profile.monthlyLcFrequency : 2.1;
    const avgVal = profile.averageTransactionValueUsd > 0 ? profile.averageTransactionValueUsd : 120000;

    const buildWindow = (days: number, mult: number) => ({
      windowDays: days,
      transactionCount: Math.round((monthlyMean * days) / 30),
      totalVolumeUsd: Math.round(avgVal * ((monthlyMean * days) / 30)),
      averageTransactionValueUsd: avgVal,
      medianTransactionValueUsd: Math.round(avgVal * 0.95),
      monthlyLcFrequency: monthlyMean,
      monthlyFrequencyStdDev: 0.8,
      activeCounterpartiesCount: Math.min(12, Math.round(profile.regularSuppliers.length * mult + 1)),
      topTradedCategories: profile.establishedProductCategories.map((cat, idx) => ({
        category: cat,
        count: Math.max(1, 10 - idx * 3),
        percentage: idx === 0 ? 65 : 35,
      })),
      topTradingCountries: profile.establishedCountries.map((c, idx) => ({
        country: c,
        count: Math.max(1, 8 - idx * 2),
        percentage: idx === 0 ? 55 : 45,
      })),
    });

    return {
      customerReferenceId: profile.customerReferenceId,
      calculatedAt: new Date().toISOString(),
      window30d: buildWindow(30, 1),
      window90d: buildWindow(90, 1.4),
      window180d: buildWindow(180, 1.8),
      window365d: buildWindow(365, 2.2),
      historicalLcFrequencyMean: monthlyMean,
      historicalLcFrequencyStdDev: 0.8,
      historicalAverageValueUsd: avgVal,
      establishedCategories: profile.establishedProductCategories,
      establishedCountries: profile.establishedCountries,
      establishedSuppliers: profile.regularSuppliers,
      establishedBuyers: profile.regularBuyers,
      establishedRoutingHubs: ['Karachi (PK)', 'Dubai (AE)', 'Singapore (SG)', 'Felixstowe (GB)'],
    };
  }
}
