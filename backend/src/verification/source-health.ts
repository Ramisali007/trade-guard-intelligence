import { ComplianceStore } from '../compliance/db/compliance-store';
import { hsReferenceHealth } from './hs/hs-reference';
import { PctStore } from './pct/pct-store';
import { allGuardStates } from './source-guard';
import { SOURCE_CATALOGUE } from './source-catalogue';
import type { SourceHealth } from './verification.types';

/**
 * One view of the state of every source the platform depends on: the verification sources loaded by this
 * layer, and the sanctions, FX, port and price feeds the existing synchroniser keeps. A source that is in
 * the catalogue but not integrated is listed as NOT_INTEGRATED, never omitted, so the gap is visible.
 */
export async function allSourceHealth(): Promise<SourceHealth[]> {
  const out: SourceHealth[] = [hsReferenceHealth(), PctStore.getInstance().health()];
  // A source whose circuit is open is shown as unavailable with the reason and when it is tried again, whatever its last data say.
  for (const g of allGuardStates()) {
    const h = out.find((x) => x.sourceId === g.sourceId);
    if (h && g.state === 'OPEN') {
      h.state = h.recordCount ? 'STALE' : 'UNAVAILABLE';
      h.lastError = `Circuit open after ${g.consecutiveFailures} failures${g.nextAttemptAt ? `; next attempt ${g.nextAttemptAt}` : ''}. ${g.lastError ?? ''}`.trim();
    }
  }
  const integrated = new Set(out.map((h) => h.sourceId));
  try {
    for (const s of await ComplianceStore.getInstance().getSources()) {
      integrated.add(s.sourceId);
      const state: SourceHealth['state'] = !s.enabled
        ? 'NOT_INTEGRATED'
        : s.syncStatus === 'FAILED' || s.freshnessStatus === 'SYNC_FAILED'
          ? 'UNAVAILABLE'
          : s.freshnessStatus === 'FRESH' || s.freshnessStatus === 'AGING'
            ? 'CURRENT'
            : s.freshnessStatus === 'STALE'
              ? 'STALE'
              : 'NOT_LOADED';
      out.push({
        sourceId: s.sourceId,
        lastSuccessfulRetrievalAt: s.lastSuccessfulSync,
        lastAttemptAt: s.lastAttemptedSync,
        lastError: s.syncStatus === 'FAILED' ? s.lastSyncNote ?? 'The last synchronisation failed.' : null,
        recordCount: s.recordCount ?? null,
        contentHash: s.checksumSha256 || null,
        datasetVersion: s.currentVersion || null,
        publishedOn: s.publishedAt ?? null,
        state,
        origin: s.dataOrigin ?? null,
      });
    }
  } catch {
    // The compliance store being unavailable is shown as those sources not being loaded, not hidden.
  }
  for (const entry of SOURCE_CATALOGUE) {
    if (!integrated.has(entry.sourceId)) {
      out.push({ sourceId: entry.sourceId, lastSuccessfulRetrievalAt: null, lastAttemptAt: null, lastError: null, recordCount: null, contentHash: null, state: 'NOT_INTEGRATED', origin: null });
    }
  }
  return out;
}
