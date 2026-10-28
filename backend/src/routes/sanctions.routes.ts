import { Router } from 'express';
import {
  getEntitySanctionsHistory,
  getSanctionsLists,
  getSanctionsListVersions,
  screenAsOfDate,
} from '../controllers/sanctions.controller';
import { asyncHandler } from '../utils/http';
import { requirePermission } from '../middleware/auth.middleware';

export const sanctionsRouter = Router();

// /api/sanctions/lists
sanctionsRouter.get('/lists', requirePermission('compliance.sources.read'), asyncHandler(getSanctionsLists));

// /api/sanctions/lists/:source/versions
sanctionsRouter.get('/lists/:source/versions', requirePermission('compliance.sources.read'), asyncHandler(getSanctionsListVersions));

// /api/sanctions/entities/:sourceEntityId/history
sanctionsRouter.get('/entities/:sourceEntityId/history', requirePermission('compliance.sources.read'), asyncHandler(getEntitySanctionsHistory));

// /api/sanctions/screen/as-of
sanctionsRouter.post('/screen/as-of', requirePermission('compliance.screening.run'), asyncHandler(screenAsOfDate));
