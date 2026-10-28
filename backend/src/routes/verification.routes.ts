import { Router } from 'express';
import * as v from '../controllers/verification.controller';
import { requirePermission } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/http';
import { datasetCsvUpload } from '../middleware/upload.middleware';
import { uploadRateLimit } from '../middleware/rate-limit.middleware';

/**
 * /api/verification: which verification rules are bank controls, and the state of every external source.
 * Mounted behind `authenticate`. Each route names its permission; the service checks it again and enforces
 * dual control (the person who proposes a rule or a dataset can never be the one who approves it).
 */
export const verificationRouter = Router();

verificationRouter.get('/overview', requirePermission('tradecase.verification.view'), asyncHandler(v.verificationOverview));
verificationRouter.get('/governance-log', requirePermission('tradecase.audit.view'), asyncHandler(v.governanceLog));
verificationRouter.post('/rules/:ruleId/propose', requirePermission('verification.rules.propose'), asyncHandler(v.proposeRule));
verificationRouter.post('/rules/:ruleId/decision', requirePermission('verification.rules.approve'), asyncHandler(v.decideRule));
verificationRouter.post('/rules/:ruleId/revoke', requirePermission('verification.rules.approve'), asyncHandler(v.revokeRule));

// Reference datasets: the bank's controlled copy of the Pakistan Customs Tariff. Submitting and approving are
// different permissions held by different people; the service refuses a person approving their own submission.
verificationRouter.get('/reference/pct', requirePermission('tradecase.verification.view'), asyncHandler(v.listDatasets));
verificationRouter.post('/reference/pct', requirePermission('verification.reference.submit'), uploadRateLimit, datasetCsvUpload, asyncHandler(v.submitDataset));
verificationRouter.post('/reference/pct/:datasetId/decision', requirePermission('verification.reference.approve'), asyncHandler(v.decideDataset));
verificationRouter.post('/reference/pct/:datasetId/retire', requirePermission('verification.reference.approve'), asyncHandler(v.retireDataset));
