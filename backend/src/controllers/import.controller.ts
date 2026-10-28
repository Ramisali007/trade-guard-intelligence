import type { Request, Response } from 'express';
import { ENTITY_REGISTRY, type SupportedEntityType } from '../compliance/import/entity-registry';
import { ImportBatchService } from '../compliance/import/import-batch.service';
import { ComplianceStore } from '../compliance/db/compliance-store';
import { AppError, Errors } from '../utils/errors';
import { MasterDataChangeService } from '../compliance/import/master-data-changes';

const store = ComplianceStore.getInstance();
const batchService = ImportBatchService.getInstance();
const changeService = MasterDataChangeService.getInstance();

/** Who is acting: always the signed-in user, never a name from the request body. */
function actingUser(req: Request): { id: string; name: string; role: string } {
  if (!req.user) throw Errors.unauthorized();
  return { id: req.user.id, name: req.user.name, role: req.user.role };
}

function requireEntity(req: Request): SupportedEntityType {
  const rawEntity = req.params['entity'];
  const entityType = rawEntity ? (rawEntity.toLowerCase() as SupportedEntityType) : undefined;
  if (!entityType || !ENTITY_REGISTRY[entityType]) {
    throw new AppError({ status: 400, code: 'BAD_REQUEST', message: `Unsupported entity type: ${rawEntity}` });
  }
  return entityType;
}

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
 * Submit one record (or a field-level patch) for approval. Nothing changes until a different person
 * holding masterdata.approve accepts it; the response is the queued change request (202).
 */
export async function createOrUpdateEntity(req: Request, res: Response): Promise<void> {
  const entityType = requireEntity(req);
  const body = req.body ?? {};
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : undefined;
  const change = await changeService.submit(actingUser(req), {
    entityType,
    kind: 'SINGLE',
    payload: body.data || {},
    options: { isPatchDetails: Boolean(body.isPatchDetails), ...(notes ? { notes } : {}) },
  });
  res.status(202).json({ success: true, status: 'PENDING_APPROVAL', changeRequest: change });
}

/** GET /api/import/changes — change requests, newest first (optionally ?status=PENDING). */
export async function listMasterDataChanges(req: Request, res: Response): Promise<void> {
  const status = typeof req.query['status'] === 'string' ? req.query['status'].toUpperCase() : undefined;
  if (status && !['PENDING', 'APPLIED', 'REJECTED', 'APPLY_FAILED'].includes(status)) {
    throw Errors.validation('Unknown status filter.');
  }
  res.json({ changes: changeService.list(status as 'PENDING' | undefined) });
}

/** POST /api/import/changes/:changeId/decision — the second person's approval or rejection. */
export async function decideMasterDataChange(req: Request, res: Response): Promise<void> {
  const changeId = String(req.params['changeId'] ?? '');
  if (!/^MDC-[0-9A-F]{8}$/.test(changeId)) throw Errors.validation('That change id is not valid.');
  const change = await changeService.decide(actingUser(req), changeId, req.body ?? {});
  res.json({ changeRequest: change });
}

/**
 * POST /api/import/:entity/preview
 * Compute dry-run validation preview for CSV / JSON payloads before commit.
 */
export async function previewBulkImport(req: Request, res: Response): Promise<void> {
  const entityType = requireEntity(req);

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
 * Submit a bulk batch (from CSV / JSON) for approval after the preview. Applied only when a different
 * person approves it.
 */
export async function commitBulkImport(req: Request, res: Response): Promise<void> {
  const entityType = requireEntity(req);
  const body = req.body ?? {};
  const records = body.records;
  if (!Array.isArray(records) || records.length === 0) {
    throw new AppError({ status: 400, code: 'BAD_REQUEST', message: 'Payload must contain non-empty "records" array' });
  }
  const methods = ['MANUAL_FORM', 'JSON', 'CSV', 'EXCEL', 'SCRAPER', 'URL'];
  const change = await changeService.submit(actingUser(req), {
    entityType,
    kind: 'BULK',
    payload: records,
    options: {
      ingestionMethod: methods.includes(body.ingestionMethod) ? body.ingestionMethod : 'CSV',
      sourceName: typeof body.sourceName === 'string' ? body.sourceName.slice(0, 200) : 'Bulk File Import',
      ...(typeof body.sourceUrl === 'string' ? { sourceUrl: body.sourceUrl.slice(0, 500) } : {}),
      ...(typeof body.notes === 'string' ? { notes: body.notes.slice(0, 1000) } : {}),
    },
  });
  res.status(202).json({ success: true, status: 'PENDING_APPROVAL', changeRequest: change });
}

/**
 * POST /api/import/:entity/scrape
 * Trigger live external scraper for the specified entity.
 */
export async function triggerScraperForEntity(req: Request, res: Response): Promise<void> {
  const entityType = requireEntity(req);
  const user = actingUser(req);
  const result = await batchService.triggerScraperForEntity(entityType, user.name + ' <' + user.id + '>');
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

  try {
    const content = await batchService.fetchUrlSourceSafely(targetUrl);
    res.status(200).json({ url: targetUrl, content });
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    const isSsrf = err?.message && (err.message.includes('SSRF') || err.message.includes('Invalid URL'));
    throw new AppError({
      status: 400,
      code: isSsrf ? 'FORBIDDEN_URL' : 'FETCH_ERROR',
      message: err?.message || 'Failed to fetch content from the specified URL',
    });
  }
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
      const rawVal = values[j] !== undefined ? (values[j] as string).trim() : '';
      const val = cleanCsvCell(rawVal);
      row[header] = val;
    }
    records.push(row);
  }

  return records;
}

function cleanCsvCell(val: string): string {
  let cleaned = val.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned.replace(/""/g, '"');
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // advance past escaped double quote
      } else {
        insideQuotes = !insideQuotes;
      }
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
