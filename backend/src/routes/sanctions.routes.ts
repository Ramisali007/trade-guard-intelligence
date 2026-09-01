import { Router } from 'express';
import {
  getEntitySanctionsHistory,
  getSanctionsLists,
  getSanctionsListVersions,
  screenAsOfDate,
} from '../controllers/sanctions.controller';
import { asyncHandler } from '../utils/http';

export const sanctionsRouter = Router();

// /api/sanctions/lists
sanctionsRouter.get('/lists', asyncHandler(getSanctionsLists));

// /api/sanctions/lists/:source/versions
sanctionsRouter.get('/lists/:source/versions', asyncHandler(getSanctionsListVersions));

// /api/sanctions/entities/:sourceEntityId/history
sanctionsRouter.get('/entities/:sourceEntityId/history', asyncHandler(getEntitySanctionsHistory));

// /api/sanctions/screen/as-of
sanctionsRouter.post('/screen/as-of', asyncHandler(screenAsOfDate));
