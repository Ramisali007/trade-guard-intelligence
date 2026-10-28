import { Router } from 'express';
import {
  getRegisteredEntities,
  queryMasterData,
  getMasterEntityDetails,
  createOrUpdateEntity,
  previewBulkImport,
  commitBulkImport,
  triggerScraperForEntity,
  fetchUrlSource,
  getImportBatches,
  getAuditLogs,
  listMasterDataChanges,
  decideMasterDataChange,
} from '../controllers/import.controller';
import { asyncHandler } from '../utils/http';
import { requirePermission } from '../middleware/auth.middleware';

export const importRouter = Router();

// Authenticated at the mount (routes/index.ts); each route names its permission.

// /api/import/entities
importRouter.get('/entities', requirePermission('masterdata.read'), asyncHandler(getRegisteredEntities));

// /api/import/batches
importRouter.get('/batches', requirePermission('masterdata.read'), asyncHandler(getImportBatches));

// /api/import/audit and /api/import/audit-logs
importRouter.get('/audit', requirePermission('masterdata.read'), asyncHandler(getAuditLogs));
importRouter.get('/audit-logs', requirePermission('masterdata.read'), asyncHandler(getAuditLogs));

// /api/import/changes — the four-eyes queue for reference-data changes
importRouter.get('/changes', requirePermission('masterdata.read'), asyncHandler(listMasterDataChanges));
importRouter.post('/changes/:changeId/decision', requirePermission('masterdata.approve'), asyncHandler(decideMasterDataChange));

// /api/import/fetch-url
importRouter.post('/fetch-url', requirePermission('masterdata.write'), asyncHandler(fetchUrlSource));

// /api/import/:entity
importRouter.get('/:entity', requirePermission('masterdata.read'), asyncHandler(queryMasterData));

// /api/import/:entity/:id
importRouter.get('/:entity/:id', requirePermission('masterdata.read'), asyncHandler(getMasterEntityDetails));

// /api/import/:entity
importRouter.post('/:entity', requirePermission('masterdata.write'), asyncHandler(createOrUpdateEntity));

// /api/import/:entity/preview
importRouter.post('/:entity/preview', requirePermission('masterdata.write'), asyncHandler(previewBulkImport));

// /api/import/:entity/bulk
importRouter.post('/:entity/bulk', requirePermission('masterdata.write'), asyncHandler(commitBulkImport));

// /api/import/:entity/scrape
importRouter.post('/:entity/scrape', requirePermission('masterdata.write'), asyncHandler(triggerScraperForEntity));
