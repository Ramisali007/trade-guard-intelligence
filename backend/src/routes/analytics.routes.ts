import { Router } from 'express';
import { getAnalyticsDashboard, getAnalyticsDrilldown } from '../controllers/analytics.controller';
import { asyncHandler } from '../utils/http';
import { requirePermission } from '../middleware/auth.middleware';

export const analyticsRouter = Router();

analyticsRouter.get('/', requirePermission('analytics.read'), asyncHandler(getAnalyticsDashboard));
analyticsRouter.get('/dashboard', requirePermission('analytics.read'), asyncHandler(getAnalyticsDashboard));
analyticsRouter.get('/overview', requirePermission('analytics.read'), asyncHandler(getAnalyticsDashboard));
analyticsRouter.get('/drilldown', requirePermission('analytics.read'), asyncHandler(getAnalyticsDrilldown));

