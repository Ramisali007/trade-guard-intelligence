import { ComplianceStore } from '../db/compliance-store';

/** The lists a clearance statement rests on. */
const SCREENED_LISTS = ['OFAC_SDN', 'UN_CONSOLIDATED', 'EU_FSF', 'UK_SANCTIONS_LIST', 'SBP_TFS_LIST'] as const;

export interface ListCoverage {
  sourceId: string;
  name: string;
  /** LIVE_FEED = downloaded from the publisher; anything else is sample or imported data. */
  origin: string;
  recordCount: number;
  lastSuccessfulSync: string | null;
  freshness: string;
  /** Whether a "no match" against this list can be relied on. */
  reliable: boolean;
  problem: string | null;
}

export interface ScreeningCoverage {
  lists: ListCoverage[];
  /** True only when every list is a live download that is not stale. */
  clearanceReliable: boolean;
  /** Plain-language reason a "clean" result must not be read as a clearance; null when it can. */
  warning: string | null;
}

/**
 * Which sanction lists actually stand behind a screening result.
 *
 * A search that matches nothing is only a clearance if the lists it searched were loaded. With a
 * list that was never downloaded, or has gone stale, "no match" means "not looked for" — so the
 * result carries this alongside the matches and the screen shows it before the word "clean".
 */
export async function getScreeningCoverage(): Promise<ScreeningCoverage> {
  const sources = await ComplianceStore.getInstance().getSources();
  const byId = new Map(sources.map((s) => [s.sourceId, s]));

  const lists: ListCoverage[] = SCREENED_LISTS.map((id) => {
    const s = byId.get(id);
    if (!s) {
      return { sourceId: id, name: id, origin: 'MISSING', recordCount: 0, lastSuccessfulSync: null, freshness: 'UNKNOWN', reliable: false, problem: 'not registered' };
    }
    const origin = s.dataOrigin ?? 'SEED';
    let problem: string | null = null;
    if (origin !== 'LIVE_FEED') problem = 'only sample records are loaded; the list has not been downloaded';
    else if (s.freshnessStatus === 'STALE' || s.freshnessStatus === 'SYNC_FAILED') problem = `the list is ${s.freshnessStatus === 'STALE' ? 'stale' : 'failing to sync'}`;
    else if (s.recordCount === 0) problem = 'the list is empty';
    return {
      sourceId: id,
      name: s.sourceName,
      origin,
      recordCount: s.recordCount,
      lastSuccessfulSync: s.lastSuccessfulSync,
      freshness: s.freshnessStatus,
      reliable: problem === null,
      problem,
    };
  });

  const bad = lists.filter((l) => !l.reliable);
  return {
    lists,
    clearanceReliable: bad.length === 0,
    warning:
      bad.length === 0
        ? null
        : `Not a clearance: ${bad.map((l) => `${l.name} (${l.problem})`).join('; ')}. Sync these lists before relying on a "no match" result.`,
  };
}
