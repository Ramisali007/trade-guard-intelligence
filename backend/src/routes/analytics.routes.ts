import { Router } from 'express';
import { getAnalyticsDashboard, getAnalyticsDrilldown } from '../controllers/analytics.controller';
import { asyncHandler } from '../utils/http';

export const analyticsRouter = Router();

analyticsRouter.get('/', asyncHandler(getAnalyticsDashboard));
analyticsRouter.get('/dashboard', asyncHandler(getAnalyticsDashboard));
analyticsRouter.get('/overview', asyncHandler(getAnalyticsDashboard));
analyticsRouter.get('/drilldown', asyncHandler(getAnalyticsDrilldown));

