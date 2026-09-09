import type { Request, Response } from 'express';
import { ENTITY_REGISTRY, type SupportedEntityType } from '../compliance/import/entity-registry';
import { ImportBatchService } from '../compliance/import/import-batch.service';
import { ComplianceStore } from '../compliance/db/compliance-store';
import { AppError } from '../utils/errors';

const store = ComplianceStore.getInstance();
const batchService = ImportBatchService.getInstance();

/**
 * GET /api/import/entities
 * List all registered master entities with metadata, schemas, capabilities, and counts.
 */
export async function getRegisteredEntities(req: Request, res: Response): Promise<void> {
  await store.init();
  const list: any[] = [];

  for (const [key, def] of Object.entries(ENTITY_REGISTRY)) {
    const count = await store.countMasterEntities(key);
    list.push({
      type: def.type,
      displayName: def.displayName,
      singularName: def.singularName,
      description: def.description,
      category: def.category,
      icon: def.icon,
      primaryKey: def.primaryKey,
      fields: def.fields,
      capabilities: def.capabilities,
      count,
    });
  }

  res.status(200).json({ entities: list });
}

/**
 * GET /api/import/:entity
 * Query, search, and paginate records of a specific entity.
 */
export async function queryMasterData(req: Request, res: Response): Promise<void> {
  await store.init();
  const rawEntity = req.params['entity'];
  const entityType = rawEntity ? (rawEntity.toLowerCase() as SupportedEntityType) : undefined;
  if (!entityType || !ENTITY_REGISTRY[entityType]) {
    throw new AppError({ status: 400, code: 'BAD_REQUEST', message: `Unsupported entity type: ${rawEntity}` });
  }

  const limit = Math.min(Number(req.query['limit']) || 50, 200);
  const offset = Math.max(Number(req.query['offset']) || 0, 0);
  const search = req.query['search'] ? String(req.query['search']) : undefined;
  const statusFilter = req.query['status'] ? String(req.query['status']) : undefined;

  const result = await store.listMasterEntities(entityType, { limit, offset, search, statusFilter });
  res.status(200).json({
    entityType,
    items: result.items,
    total: result.total,
    limit,
    offset,
  });
}

/**
 * GET /api/import/:entity/:id
 * Retrieve a single entity and its audit log history.
 */
export async function getMasterEntityDetails(req: Request, res: Response): Promise<void> {
  await store.init();
  const rawEntity = req.params['entity'];
  const entityType = rawEntity ? (rawEntity.toLowerCase() as SupportedEntityType) : undefined;
  const id = req.params['id'];

  if (!entityType || !ENTITY_REGISTRY[entityType]) {
    throw new AppError({ status: 400, code: 'BAD_REQUEST', message: `Unsupported entity type: ${rawEntity}` });
  }
  if (!id) {
    throw new AppError({ status: 400, code: 'BAD_REQUEST', message: 'Entity ID is required' });
  }

  const record = await store.getMasterEntityById(entityType, id);
  if (!record) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: `Entity record "${id}" not found` });
  }

  const history = await store.getAuditLogs(50, entityType, id);

  res.status(200).json({
    entityType,
    record,
    auditHistory: history,
  });
}

/**
 * POST /api/import/:entity
 * Two-level manual import: Complete entity or partial field update.
 */
export async function createOrUpdateEntity(req: Request, res: Response): Promise<void> {
  const rawEntity = req.params['entity'];
  const entityType = rawEntity ? (rawEntity.toLowerCase() as SupportedEntityType) : undefined;
  if (!entityType || !ENTITY_REGISTRY[entityType]) {
    throw new AppError({ status: 400, code: 'BAD_REQUEST', message: `Unsupported entity type: ${rawEntity}` });
  }

  const payload = req.body.data || req.body;
  const isPatchDetails = Boolean(req.body.isPatchDetails);
  const actor = req.body.importedBy || 'COMPLIANCE_OFFICER';
  const notes = req.body.notes;

  const result = await batchService.commitSingleRecord(entityType, payload, {
    isPatchDetails,
    actor,
    notes,
  });

  res.status(200).json(result);
}

/**
 * POST /api/import/:entity/preview
 * Compute dry-run validation preview for CSV / JSON payloads before commit.
 */
export async function previewBulkImport(req: Request, res: Response): Promise<void> {
  const rawEntity = req.params['entity'];
  const entityType = rawEntity ? (rawEntity.toLowerCase() as SupportedEntityType) : undefined;
  if (!entityType || !ENTITY_REGISTRY[entityType]) {
    throw new AppError({ status: 400, code: 'BAD_REQUEST', message: `Unsupported entity type: ${rawEntity}` });
  }

  let records: any[] = [];
  if (Array.isArray(req.body.records)) {
    records = req.body.records;
  } else if (typeof req.body.rawContent === 'string') {
    // Parse CSV or JSON string
    const raw = req.body.rawContent.trim();
    if (raw.startsWith('[') || raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        records = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        throw new AppError({ status: 400, code: 'BAD_REQUEST', message: 'Invalid JSON payload' });
      }
    } else {
      // Parse CSV
      records = parseCsvContent(raw);
    }
  } else {
    throw new AppError({ status: 400, code: 'BAD_REQUEST', message: 'Missing records array or rawContent string' });
  }

  if (records.length === 0) {
    throw new AppError({ status: 400, code: 'BAD_REQUEST', message: 'No data rows detected in import payload' });
  }

  const preview = await batchService.previewBulkImport(entityType, records);
  res.status(200).json(preview);
}

/**
 * POST /api/import/:entity/bulk
 * Commit a bulk batch (from CSV / JSON) following preview confirmation.
 */
export async function commitBulkImport(req: Request, res: Response): Promise<void> {
  const rawEntity = req.params['entity'];
  const entityType = rawEntity ? (rawEntity.toLowerCase() as SupportedEntityType) : undefined;
  if (!entityType || !ENTITY_REGISTRY[entityType]) {
    throw new AppError({ status: 400, code: 'BAD_REQUEST', message: `Unsupported entity type: ${rawEntity}` });
  }

  const records = req.body.records;
  if (!Array.isArray(records) || records.length === 0) {
    throw new AppError({ status: 400, code: 'BAD_REQUEST', message: 'Payload must contain non-empty "records" array' });
  }

  const batch = await batchService.commitBulkBatch(entityType, records, {
    entityType,
    ingestionMethod: req.body.ingestionMethod || 'CSV',
    sourceName: req.body.sourceName || 'Bulk File Import',
    sourceUrl: req.body.sourceUrl,
    importedBy: req.body.importedBy || 'ADMIN_USER',
    notes: req.body.notes,
  });

  res.status(200).json(batch);
}

/**
 * POST /api/import/:entity/scrape
 * Trigger live external scraper for the specified entity.
 */
export async function triggerScraperForEntity(req: Request, res: Response): Promise<void> {
  const rawEntity = req.params['entity'];
  const entityType = rawEntity ? (rawEntity.toLowerCase() as SupportedEntityType) : undefined;
  if (!entityType || !ENTITY_REGISTRY[entityType]) {
    throw new AppError({ status: 400, code: 'BAD_REQUEST', message: `Unsupported entity type: ${rawEntity}` });
  }

  const actor = req.body.actor || 'COMPLIANCE_OFFICER';
  const result = await batchService.triggerScraperForEntity(entityType, actor);
  res.status(200).json({
    success: true,
    entityType,
    syncRun: result,
  });
}

/**
 * POST /api/import/fetch-url
 * SSRF-safe URL content fetcher for source preview.
 */
export async function fetchUrlSource(req: Request, res: Response): Promise<void> {
  const targetUrl = req.body.url;
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new AppError({ status: 400, code: 'BAD_REQUEST', message: 'Valid URL is required' });
  }

  const content = await batchService.fetchUrlSourceSafely(targetUrl);
  res.status(200).json({ url: targetUrl, content });
}

/**
 * GET /api/import/batches
 * Retrieve historical import batches.
 */
export async function getImportBatches(req: Request, res: Response): Promise<void> {
  await store.init();
  const limit = Math.min(Number(req.query['limit']) || 50, 100);
  const batches = await store.getImportBatches(limit);
  res.status(200).json({ batches });
}

/**
 * GET /api/import/audit
 * Query audit log across all master data updates.
 */
export async function getAuditLogs(req: Request, res: Response): Promise<void> {
  await store.init();
  const limit = Math.min(Number(req.query['limit']) || 100, 500);
  const entityType = req.query['entityType'] ? String(req.query['entityType']) : undefined;
  const recordId = req.query['recordId'] ? String(req.query['recordId']) : undefined;

  const logs = await store.getAuditLogs(limit, entityType, recordId);
  res.status(200).json({ logs });
}

// ---------------------------------------------------------------------------------------------
// Lightweight CSV Parsing Utility (Handles quotes and commas)
// ---------------------------------------------------------------------------------------------
function parseCsvContent(csvText: string): Array<Record<string, any>> {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const firstLine = lines[0];
  if (!firstLine) return [];

  const headers = splitCsvLine(firstLine).map((h) => h.trim().replace(/^["']|["']$/g, ''));
  const records: Array<Record<string, any>> = [];

  for (let i = 1; i < lines.length; i++) {
    const curLine = lines[i];
    if (!curLine) continue;

    const values = splitCsvLine(curLine);
    if (values.length === 0) continue;
    const row: Record<string, any> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (!header) continue;
      const val = values[j] !== undefined ? (values[j] as string).trim().replace(/^["']|["']$/g, '') : '';
      row[header] = val;
    }
    records.push(row);
  }

  return records;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
