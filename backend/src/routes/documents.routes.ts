import { Router } from 'express';
import {
  analyzeDocument,
  deleteDocument,
  downloadReport,
  downloadPdfReport,
  getDocumentDetail,
  getDocumentResults,
  getDocumentStatus,
  getDocumentUnits,
  listDocuments,
  uploadDocument,
  uploadMultipleDocuments,
  compareDocuments,
  downloadComparisonPdfReport,
  overrideComplianceDecision,
  listComplianceSources,
  screenHistoricalPointInTime,
  getDocumentTimeline,
  getDocumentEvidence,
  listRetrospectiveAlerts,
} from '../controllers/document.controller';
import { singleDocumentUpload, multiDocumentUpload } from '../middleware/upload.middleware';
import { uploadRateLimit } from '../middleware/rate-limit.middleware';
import { asyncHandler } from '../utils/http';

export const documentsRouter = Router();

// ------------------------------------------------------------------ regulatory & sources
documentsRouter.get('/compliance/sources', asyncHandler(listComplianceSources));
documentsRouter.post('/compliance/screen/historical', asyncHandler(screenHistoricalPointInTime));
documentsRouter.get('/compliance/retrospective-alerts', asyncHandler(listRetrospectiveAlerts));

// ------------------------------------------------------------------ collection & batch
documentsRouter.get('/', asyncHandler(listDocuments));
documentsRouter.post('/upload', uploadRateLimit, singleDocumentUpload, asyncHandler(uploadDocument));
documentsRouter.post('/upload-batch', uploadRateLimit, multiDocumentUpload, asyncHandler(uploadMultipleDocuments));
documentsRouter.post('/compare', asyncHandler(compareDocuments));
documentsRouter.post('/compare/pdf', asyncHandler(downloadComparisonPdfReport));
documentsRouter.get('/compare/pdf', asyncHandler(downloadComparisonPdfReport));

// ------------------------------------------------------------------ single document & evidence
documentsRouter.get('/:id', asyncHandler(getDocumentDetail));
documentsRouter.delete('/:id', asyncHandler(deleteDocument));

documentsRouter.post('/:id/analyze', uploadRateLimit, asyncHandler(analyzeDocument));
documentsRouter.post('/:id/override', asyncHandler(overrideComplianceDecision));
documentsRouter.get('/:id/status', asyncHandler(getDocumentStatus));
documentsRouter.get('/:id/results', asyncHandler(getDocumentResults));
documentsRouter.get('/:id/units', asyncHandler(getDocumentUnits));
documentsRouter.get('/:id/timeline', asyncHandler(getDocumentTimeline));
documentsRouter.get('/:id/evidence', asyncHandler(getDocumentEvidence));
documentsRouter.get('/:id/report', asyncHandler(downloadReport));
documentsRouter.get('/:id/report/pdf', asyncHandler(downloadPdfReport));

