import type { Request, Response } from 'express';
import { SnapshotRegistry } from '../compliance/temporal/snapshot-registry';
import { Errors } from '../utils/errors';

/**
 * GET /api/sanctions/lists
 * All tracked sources with their latest ingested version, published date, checksum
 */
export async function getSanctionsLists(req: Request, res: Response): Promise<void> {
  const registry = SnapshotRegistry.getInstance();
  const sources = registry.listSources();
  res.json({
    trackedSourcesCount: sources.length,
    sources,
  });
}

/**
 * GET /api/sanctions/lists/:source/versions
 * Full historical list of every ingested snapshot for a source (audit access)
 */
export async function getSanctionsListVersions(req: Request, res: Response): Promise<void> {
  const sourceId = req.params['source'];
  if (!sourceId) {
    throw Errors.validation('source parameter is required');
  }

  const registry = SnapshotRegistry.getInstance();
  const source = registry.getSource(sourceId);
  if (!source) {
    throw Errors.notFound(`Sanctions source "${sourceId}" not found`);
  }

  const changeEvents = registry.getChangeEvents().filter((ev) => ev.sourceId.toLowerCase() === sourceId.toLowerCase() || source.datasetType.toLowerCase().includes(ev.sourceId.toLowerCase()));

  res.json({
    sourceId: source.sourceId,
    sourceName: source.sourceName,
    currentVersion: source.currentVersion,
    checksumSha256: source.checksumSha256,
    publishedAt: source.publishedAt,
    retrievedAt: source.retrievedAt,
    effectiveAt: source.effectiveAt,
    versions: [
      {
        versionId: source.currentVersion,
        publishedAt: source.publishedAt,
        ingestedAt: source.retrievedAt,
        effectiveAt: source.effectiveAt,
        fileSha256: source.checksumSha256,
        recordCount: source.recordCount,
        isDelta: false,
        sourceUrl: source.sourceUrl,
      },
    ],
    changeEventsHistory: changeEvents,
  });
}

/**
 * GET /api/sanctions/entities/:sourceEntityId/history
 * Full listing/delisting timeline for one entity across all sources
 */
export async function getEntitySanctionsHistory(req: Request, res: Response): Promise<void> {
  const entityId = req.params['sourceEntityId'];
  if (!entityId) {
    throw Errors.validation('sourceEntityId parameter is required');
  }

  const registry = SnapshotRegistry.getInstance();
  const changeEvents = registry.getChangeEvents().filter((ev) => ev.entityId.toLowerCase() === entityId.toLowerCase());

  res.json({
    entityId,
    timelineEvents: changeEvents,
  });
}

/**
 * POST /api/sanctions/screen/as-of
 * Point-in-time re-screen using historical snapshot, for audit reconstruction or backfilled transactions
 */
export async function screenAsOfDate(req: Request, res: Response): Promise<void> {
  const { parties, as_of_date, jurisdictions } = req.body;
  if (!parties || !Array.isArray(parties) || parties.length === 0) {
    throw Errors.validation('parties array is required');
  }

  const asOf = as_of_date || new Date().toISOString();
  const registry = SnapshotRegistry.getInstance();
  const results: any[] = [];

  for (const p of parties) {
    const partyName = typeof p === 'string' ? p : p.name || p.legalName;
    const role = typeof p === 'object' ? p.role || 'COUNTERPARTY' : 'COUNTERPARTY';
    const swiftBic = typeof p === 'object' ? p.swiftBic : undefined;
    const imoNumber = typeof p === 'object' ? p.imoNumber : undefined;

    if (partyName) {
      const matches = registry.queryEntityPointInTime(partyName, role, asOf, {
        jurisdictions,
        swiftBic,
        imoNumber,
      });

      results.push({
        partyName,
        role,
        asOfDate: asOf,
        matchesCount: matches.length,
        isCleanAtAsOfDate: !matches.some((m) => m.wasListedAtTransactionTime),
        hasSubsequentDesignation: matches.some((m) => m.temporalStatus === 'ADDED_AFTER_TRANSACTION'),
        matches,
      });
    }
  }

  res.json({
    asOfDate: asOf,
    screenedPartiesCount: results.length,
    results,
  });
}
