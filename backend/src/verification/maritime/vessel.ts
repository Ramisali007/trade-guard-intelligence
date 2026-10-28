import type { ClaimRef, ClaimVerification, ModuleRun } from '../verification.types';

/**
 * Vessel identity. Two things can be established without a data provider and one cannot.
 *
 *  - Whether an IMO number is well formed: seven digits whose last is a check digit computed from the first six
 *    (the IMO ship identification number scheme). A number that fails is mistyped or invented.
 *  - Whether the vessel appears on a sanctions list: the existing screening engine does this by name and IMO.
 *  - Whether the vessel is what the document says (flag, owner, operator, name history, port calls): this needs a
 *    licensed maritime data provider. None is connected, so it is reported as NOT VERIFIED. The provider boundary
 *    below is where one plugs in.
 */

export function isValidImo(imo: string): boolean {
  const digits = imo.replace(/^IMO\s*/i, '').trim();
  if (!/^\d{7}$/.test(digits)) return false;
  const sum = [7, 6, 5, 4, 3, 2].reduce((total, weight, i) => total + weight * Number(digits[i]), 0);
  return sum % 10 === Number(digits[6]);
}

export interface VesselRecord {
  imo: string;
  name: string;
  flag: string | null;
  registeredOwner: string | null;
  operator: string | null;
  /** Names the vessel has been known by, when the provider keeps them. */
  formerNames: string[];
  sourceName: string;
  retrievedAt: string;
}

/** What a licensed maritime data provider supplies. Nothing in the platform fabricates this. */
export interface VesselIntelligenceProvider {
  readonly id: string;
  readonly configured: boolean;
  lookupByImo(imo: string): Promise<VesselRecord | null>;
}

export const NOT_CONFIGURED_VESSEL_PROVIDER: VesselIntelligenceProvider = {
  id: 'AIS-VESSEL-PROVIDER',
  configured: false,
  async lookupByImo(): Promise<VesselRecord | null> {
    throw new Error('No licensed maritime data provider is connected.');
  },
};

export interface VesselClaim {
  documentId: string;
  filename: string;
  documentType: string;
  documentVersion?: number | null;
  page?: number | null;
  snippet?: string | null;
  extractionConfidence?: number | null;
  name: string | null;
  imo: string | null;
}

const LIMITS = ['A vessel on a sanctions list is found by the sanctions screening, not by this check.'];
const ref = (c: VesselClaim): ClaimRef => ({
  documentId: c.documentId,
  filename: c.filename,
  documentType: c.documentType,
  field: 'vessel',
  extractedValue: `${c.name ?? ''} ${c.imo ? `IMO ${c.imo}` : ''}`.trim(),
  page: c.page ?? null,
  documentVersion: c.documentVersion ?? null,
  normalizedValue: c.imo ? c.imo.replace(/\D/g, '') : null,
  extractionConfidence: c.extractionConfidence ?? null,
  snippet: c.snippet ?? null,
});

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function verifyVesselClaims(claims: VesselClaim[], provider: VesselIntelligenceProvider, ctx: { now: Date; transactionDate: string | null }): Promise<{ results: ClaimVerification[]; module: ModuleRun }> {
  const results: ClaimVerification[] = [];
  const assessedAt = ctx.now.toISOString();
  let providerUsed = false;

  for (const claim of claims) {
    const declared = `Vessel: ${claim.name ?? 'name not stated'}${claim.imo ? `, IMO ${claim.imo}` : ', no IMO stated'}`;
    const make = (over: Pick<ClaimVerification, 'status' | 'severity' | 'blocking' | 'humanReviewRequired' | 'customerFixable' | 'title' | 'explanation' | 'retrieved' | 'evidence'> & { limitations?: string[] }): ClaimVerification => ({
      subject: `${claim.documentType}:vessel`,
      module: 'VESSEL_IDENTITY',
      ruleId: 'EXT-VESSEL-ID',
      claims: [ref(claim)],
      declared,
      limitations: [...LIMITS, ...(over.limitations ?? [])],
      assessedAt,
      transactionDate: ctx.transactionDate,
      ...over,
    });

    if (!claim.imo) {
      results.push(make({ status: 'INSUFFICIENT_EVIDENCE', severity: 'LOW', blocking: false, humanReviewRequired: true, customerFixable: true, title: `Vessel "${claim.name}" has no IMO number`, explanation: 'A vessel is identified by its IMO number; a name alone can belong to several ships or have changed. Ask for the IMO number.', retrieved: null, evidence: [] }));
      continue;
    }
    if (!isValidImo(claim.imo)) {
      results.push(make({ status: 'DISCREPANCY', severity: 'MEDIUM', blocking: true, humanReviewRequired: true, customerFixable: true, title: `IMO ${claim.imo} is not a valid IMO number`, explanation: `An IMO number is seven digits whose last digit is a check digit worked out from the first six; "${claim.imo}" fails that check. It is mistyped or not a real IMO number. This is a discrepancy to confirm, not a finding of wrongdoing.`, retrieved: null, evidence: [] }));
      continue;
    }
    if (!provider.configured) {
      results.push(make({ status: 'INSUFFICIENT_EVIDENCE', severity: 'LOW', blocking: false, humanReviewRequired: true, customerFixable: false, title: `Vessel IMO ${claim.imo} is well formed but its identity was not verified`, explanation: 'The number passes the IMO check digit. Whether it belongs to the vessel named, and its flag, owner, operator and history, cannot be verified: no licensed maritime data provider is connected.', retrieved: null, evidence: [], limitations: ['Vessel ownership, flag and routing need a licensed provider (AIS-VESSEL-PROVIDER), which is not integrated.'] }));
      continue;
    }
    providerUsed = true;
    try {
      const record = await provider.lookupByImo(claim.imo.replace(/\D/g, ''));
      if (!record) {
        results.push(make({ status: 'INSUFFICIENT_EVIDENCE', severity: 'MEDIUM', blocking: false, humanReviewRequired: true, customerFixable: false, title: `IMO ${claim.imo} is not known to the maritime data provider`, explanation: 'The provider has no record for this IMO number. That is not proof it does not exist; a trade officer should check.', retrieved: null, evidence: [] }));
        continue;
      }
      const sameName = claim.name ? [record.name, ...record.formerNames].some((n) => norm(n) === norm(claim.name!)) : null;
      results.push(
        make({
          status: sameName === false ? 'DISCREPANCY' : 'CONSISTENT',
          severity: sameName === false ? 'MEDIUM' : 'INFO',
          blocking: false,
          humanReviewRequired: sameName === false,
          customerFixable: false,
          title: sameName === false ? `IMO ${claim.imo} belongs to "${record.name}", not "${claim.name}"` : `IMO ${claim.imo} matches ${record.name}`,
          explanation: `Provider record: ${record.name}, flag ${record.flag ?? 'not given'}, registered owner ${record.registeredOwner ?? 'not given'}, operator ${record.operator ?? 'not given'}.${record.formerNames.length ? ` Former names: ${record.formerNames.join(', ')}.` : ''}`,
          retrieved: `${record.name} (IMO ${record.imo})`,
          evidence: [{ sourceId: provider.id, sourceName: record.sourceName, recordId: record.imo, excerpt: `${record.name}; flag ${record.flag ?? '-'}; owner ${record.registeredOwner ?? '-'}`, url: '', retrievedAt: record.retrievedAt, publishedOn: null, effectiveFrom: null, contentHash: 'provider response', datasetVersion: null, lineage: 'Licensed maritime data provider chosen by the bank.', origin: 'LIVE_SOURCE', stale: false }],
        }),
      );
    } catch (error) {
      results.push(make({ status: 'SOURCE_UNAVAILABLE', severity: 'MEDIUM', blocking: false, humanReviewRequired: true, customerFixable: false, title: `Vessel IMO ${claim.imo} could not be checked: the maritime data provider is unavailable`, explanation: `The provider could not be reached (${error instanceof Error ? error.message.slice(0, 100) : 'error'}). The vessel has NOT been verified; this is not a clean result.`, retrieved: null, evidence: [] }));
    }
  }

  return {
    results,
    module: {
      module: 'VESSEL_IDENTITY',
      state: claims.length === 0 ? 'NOT_RUN' : provider.configured && providerUsed ? 'COMPLETE' : 'PARTIAL',
      claimsChecked: claims.length,
      sourcesConsulted: providerUsed ? [provider.id] : [],
      notChecked: provider.configured ? [] : ['Vessel identity, flag, ownership, operator, name history and port calls: no licensed maritime data provider is connected. Only the IMO check digit was verified.'],
    },
  };
}
