import type { Request, Response } from 'express';
import { analyticsService, type AnalyticsFilterOptions, type TimeRangeKey } from '../services/analytics.service';
import { createLogger } from '../utils/logger';

const log = createLogger('analytics-controller');

export async function getAnalyticsDashboard(req: Request, res: Response): Promise<void> {
  const options: AnalyticsFilterOptions = {
    range: (req.query.range as TimeRangeKey) || '30d',
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    docType: req.query.docType as string | undefined,
    country: req.query.country as string | undefined,
    customer: req.query.customer as string | undefined,
    status: req.query.status as string | undefined,
    riskLevel: req.query.riskLevel as string | undefined,
    refresh: req.query.refresh === 'true' || req.query.refresh === '1',
  };

  const data = await analyticsService.getDashboardAnalytics(options);
  res.setHeader('Cache-Control', 'no-cache');
  res.json(data);
}

export async function getAnalyticsDrilldown(req: Request, res: Response): Promise<void> {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const options = {
    range: (req.query.range as TimeRangeKey) || 'all',
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    docType: req.query.docType as string | undefined,
    country: req.query.country as string | undefined,
    customer: req.query.customer as string | undefined,
    status: req.query.status as string | undefined,
    riskLevel: req.query.riskLevel as string | undefined,
    limit,
    offset,
  };

  const result = await analyticsService.getDrilldownDocuments(options);
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    items: result.items,
    documents: result.items,
    total: result.total,
    limit,
    offset,
  });
}
