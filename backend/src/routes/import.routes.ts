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
} from '../controllers/import.controller';
import { asyncHandler } from '../utils/http';

export const importRouter = Router();

// /api/import/entities
importRouter.get('/entities', asyncHandler(getRegisteredEntities));

// /api/import/batches
importRouter.get('/batches', asyncHandler(getImportBatches));

// /api/import/audit and /api/import/audit-logs
importRouter.get('/audit', asyncHandler(getAuditLogs));
importRouter.get('/audit-logs', asyncHandler(getAuditLogs));

// /api/import/fetch-url
importRouter.post('/fetch-url', asyncHandler(fetchUrlSource));

// /api/import/:entity
importRouter.get('/:entity', asyncHandler(queryMasterData));

// /api/import/:entity/:id
importRouter.get('/:entity/:id', asyncHandler(getMasterEntityDetails));

// /api/import/:entity
importRouter.post('/:entity', asyncHandler(createOrUpdateEntity));

// /api/import/:entity/preview
importRouter.post('/:entity/preview', asyncHandler(previewBulkImport));

// /api/import/:entity/bulk
importRouter.post('/:entity/bulk', asyncHandler(commitBulkImport));

// /api/import/:entity/scrape
importRouter.post('/:entity/scrape', asyncHandler(triggerScraperForEntity));
