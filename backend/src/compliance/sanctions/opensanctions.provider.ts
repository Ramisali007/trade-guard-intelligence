import type { ISanctionsProvider, ScreeningQuery } from './sanctions.provider';
import type { JurisdictionRiskCheck, SanctionsMatch } from '../types';
import { SANCTIONED_JURISDICTIONS } from './jurisdictions.data';
import { createLogger } from '../../utils/logger';
import type { ComplianceEntityRecord } from '../db/compliance-store';
import { matchNames, normalizeName, prepareName, type PreparedName } from './name-matching';

const log = createLogger('opensanctions-provider');

interface PreparedEntity {
  ent: ComplianceEntityRecord;
  primary: PreparedName;
  aliases: PreparedName[];
}

let preparedCache: { revision: number; entries: PreparedEntity[] } | null = null;

/** Current store entities with names pre-normalised; rebuilt only when the store changes. */
async function preparedCurrentEntities(): Promise<PreparedEntity[]> {
  const { ComplianceStore } = await import('../db/compliance-store');
  const store = ComplianceStore.getInstance();
  await store.init();
  const { revision } = store.getEntitySnapshot();
  if (preparedCache?.revision === revision) return preparedCache.entries;
  const entries = (await store.getAllCurrentEntities()).map((ent) => ({
    ent,
    primary: prepareName(ent.canonicalName),
    aliases: (ent.aliases || []).map(prepareName).filter((a) => a.normalized.length > 0),
  }));
  preparedCache = { revision, entries };
  return entries;
}

/**
 * Screens against the local compliance store (every list synced or imported into
 * `compliance_entities`), optionally enriched by the OpenSanctions match API when
 * OPENSANCTIONS_API_KEY is set. Despite the class name, nothing here claims to be the full
 * OpenSanctions dataset: the version string reports what was actually screened.
 */
export class OpenSanctionsProvider implements ISanctionsProvider {
  readonly id = 'LOCAL_COMPLIANCE_STORE';
  readonly name = 'Local Compliance Store (synced & imported sanctions lists)';
  readonly datasetVersion = process.env.OPENSANCTIONS_API_KEY
    ? 'LOCAL-COMPLIANCE-STORE + OPENSANCTIONS-MATCH-API'
    : 'LOCAL-COMPLIANCE-STORE';
  readonly lastUpdated = new Date().toISOString();

  async screenEntity(query: ScreeningQuery): Promise<SanctionsMatch[]> {
    if (!query.name || query.name.trim().length < 2) return [];
    const target = prepareName(query.name);
    const matches: SanctionsMatch[] = [];

    // 1. Live Web API Query (If API key provided)
    const apiKey = process.env.OPENSANCTIONS_API_KEY;
    if (apiKey) {
      try {
        const liveMatch = await this.queryLiveApi(query, apiKey);
        if (liveMatch.length > 0) return liveMatch;
      } catch (err) {
        log.warn('OpenSanctions live API request failed, falling back to canonical store', { err: String(err) });
      }
    }

    // 2. Query Local Canonical Compliance Database (compliance_entities in MongoDB Atlas)
    try {
      for (const { ent, primary, aliases } of await preparedCurrentEntities()) {
        const onPrimary = matchNames(target, primary);
        if (onPrimary?.kind === 'EXACT') {
          matches.push(this.buildMatchFromDb(ent, query, 'EXACT', 0.99));
          continue;
        }
        let best = onPrimary;
        let viaAlias = false;
        for (const alias of aliases) {
          const m = matchNames(target, alias);
          if (m && (!best || m.confidence > best.confidence)) {
            best = m;
            viaAlias = true;
          }
        }
        if (!best) continue;
        if (best.kind === 'EXACT') {
          matches.push(this.buildMatchFromDb(ent, query, 'ALIAS', 0.95));
        } else {
          // Token containment / near-spelling: a lead, deliberately below the 0.95 "confirmed" line.
          matches.push(this.buildMatchFromDb(ent, query, viaAlias ? 'ALIAS' : 'FUZZY_NAME', Math.min(0.9, best.confidence)));
        }
      }
    } catch (err) {
      log.warn('Error screening against ComplianceStore', { err: String(err) });
    }

    return matches;
  }

  async screenVessel(vesselName: string, imoNumber?: string): Promise<SanctionsMatch[]> {
    if (!vesselName && !imoNumber) return [];
    const matches: SanctionsMatch[] = [];
    const cleanImo = imoNumber?.replace(/\D/g, '') || '';
    const normVessel = normalizeName(vesselName || '');

    try {
      const { ComplianceStore } = await import('../db/compliance-store');
      const store = ComplianceStore.getInstance();
      await store.init();
      const entities = await store.getAllCurrentEntities();

      for (const ent of entities.filter((e) => e.entityType === 'VESSEL')) {
        if (cleanImo && ent.identifiers?.imoNumber && ent.identifiers.imoNumber.replace(/\D/g, '') === cleanImo) {
          matches.push(this.buildMatchFromDb(ent, { name: vesselName, role: 'VESSEL', imoNumber }, 'VESSEL_IMO', 0.99));
          continue;
        }

        if (normVessel) {
          const entNameNorm = normalizeName(ent.canonicalName);
          if (entNameNorm === normVessel) {
            matches.push(this.buildMatchFromDb(ent, { name: vesselName, role: 'VESSEL', imoNumber }, 'EXACT', 0.95));
          }
        }
      }
    } catch {
      // Graceful fallback
    }

    return matches;
  }

  async screenBank(bankName: string, swiftBic?: string, country?: string): Promise<SanctionsMatch[]> {
    if (!bankName && !swiftBic) return [];
    const matches: SanctionsMatch[] = [];
    const cleanBic = swiftBic?.replace(/[^A-Z0-9]/gi, '').toUpperCase() || '';
    const normBank = normalizeName(bankName || '');

    try {
      const { ComplianceStore } = await import('../db/compliance-store');
      const store = ComplianceStore.getInstance();
      await store.init();
      const entities = await store.getAllCurrentEntities();

      for (const ent of entities.filter((e) => e.entityType === 'BANK')) {
        if (cleanBic.length >= 8 && ent.identifiers?.swiftBic && ent.identifiers.swiftBic.toUpperCase().slice(0, 8) === cleanBic.slice(0, 8)) {
          matches.push(this.buildMatchFromDb(ent, { name: bankName, role: 'FINANCING_BANK', swiftBic, country }, 'SWIFT_CODE', 0.99));
          continue;
        }

        if (normBank) {
          const entNameNorm = normalizeName(ent.canonicalName);
          if (entNameNorm === normBank) {
            matches.push(this.buildMatchFromDb(ent, { name: bankName, role: 'FINANCING_BANK', swiftBic, country }, 'EXACT', 0.95));
          }
        }
      }
    } catch {
      // Graceful fallback
    }

    return matches;
  }

  async checkJurisdiction(countryName: string, nodeRole: JurisdictionRiskCheck['nodeRole']): Promise<JurisdictionRiskCheck | null> {
    if (!countryName) return null;
    const norm = countryName.toLowerCase().trim();

    for (const entry of SANCTIONED_JURISDICTIONS) {
      if (
        norm === entry.countryCode.toLowerCase() ||
        norm === entry.countryName.toLowerCase() ||
        entry.aliases.some((a) => norm === a.toLowerCase())
      ) {
        return {
          nodeRole,
          countryName: entry.countryName,
          countryCode: entry.countryCode,
          sanctionsStatus: entry.sanctionsStatus,
          riskScore: entry.riskScore,
          description: `${entry.countryName} is subject to comprehensive international sanctions & FATF jurisdiction risk controls. Authority: SBP BPRD / UN Security Council. Programs: ${entry.programs.join(', ')}`,
        };
      }
    }

    return null;
  }

  private async queryLiveApi(query: ScreeningQuery, apiKey: string): Promise<SanctionsMatch[]> {
    const targetUrl = 'https://api.opensanctions.org/match/default?algorithm=best';
    const body = {
      queries: {
        entity: {
          schema: query.entityType === 'VESSEL' ? 'Vessel' : query.entityType === 'BANK' ? 'Company' : 'LegalEntity',
          properties: {
            name: [query.name],
            country: query.country ? [query.country] : undefined,
          },
        },
      },
    };

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Authorization': `ApiKey ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return [];
    const data: any = await res.json();
    const responses = data?.responses?.entity?.results || [];

    return responses.map((r: any) => ({
      entityOrSubject: query.name,
      roleOrField: query.role,
      matchedSanctionedName: r.caption || query.name,
      sanctionsList: 'OTHER' as const,
      sanctionProgram: (r.properties?.topics || ['GLOBAL_SANCTIONS']).join(', '),
      matchType: (r.score > 0.9 ? 'EXACT' : 'FUZZY_NAME') as SanctionsMatch['matchType'],
      matchConfidence: Math.min(1.0, r.score || 0.9),
      matchedIdentifiers: [r.id],
      countryAssociated: r.properties?.country?.[0],
      sourceDatasetVersion: 'OPENSANCTIONS-MATCH-API',
      screeningTimestamp: new Date().toISOString(),
      recommendedAction: 'BLOCK_TRANSACTION_AND_ESCALATE_TO_COMPLIANCE_OFFICER',
    }));
  }

  private buildMatchFromDb(ent: any, query: ScreeningQuery, matchType: SanctionsMatch['matchType'], matchConfidence: number): SanctionsMatch {
    const listMap: Record<string, SanctionsMatch['sanctionsList']> = {
      OFAC_SDN: 'OFAC_SDN',
      UN_CONSOLIDATED: 'UN_CONSOLIDATED',
      EU_FSF: 'EU_SANCTIONS',
      UK_SANCTIONS_LIST: 'UK_OFSI',
    };

    return {
      entityOrSubject: query.name,
      roleOrField: query.role,
      matchedSanctionedName: ent.canonicalName,
      sanctionsList: listMap[ent.sourceId] || 'OTHER',
      sanctionProgram: (ent.programs || ['SANCTIONS_LIST']).join(', '),
      matchType,
      matchConfidence,
      matchedIdentifiers: [ent.canonicalId || ent.externalId],
      countryAssociated: ent.country,
      sourceDatasetVersion: `${ent.sourceId} v${ent.version ?? 1}`,
      screeningTimestamp: new Date().toISOString(),
      recommendedAction: 'FREEZE_OR_ESCALATE_UNDER_AML_CFT_REGULATIONS',
    };
  }
}
