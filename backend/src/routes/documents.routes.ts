import { Router } from 'express';
import {
  analyzeDocument,
  deleteDocument,
  deleteHistory,
  restoreHistory,
  getArchivedCount,
  downloadReport,
  downloadPdfReport,
  downloadSourceFile,
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
  syncComplianceSource,
  syncAllComplianceSources,
  getComplianceHealth,
  screenHistoricalPointInTime,
  getDocumentTimeline,
  getDocumentEvidence,
  getDocumentAuditCertificate,
  listRetrospectiveAlerts,
  getDocumentImage,
} from '../controllers/document.controller';
import { singleDocumentUpload, multiDocumentUpload } from '../middleware/upload.middleware';
import { uploadRateLimit } from '../middleware/rate-limit.middleware';
import { asyncHandler } from '../utils/http';

export const documentsRouter = Router();

// ------------------------------------------------------------------ regulatory & sources
documentsRouter.get('/compliance/sources', asyncHandler(listComplianceSources));
documentsRouter.post('/compliance/sources/sync-all', asyncHandler(syncAllComplianceSources));
documentsRouter.post('/compliance/sources/:sourceId/sync', asyncHandler(syncComplianceSource));
documentsRouter.get('/compliance/health', asyncHandler(getComplianceHealth));
documentsRouter.post('/compliance/screen/historical', asyncHandler(screenHistoricalPointInTime));
documentsRouter.get('/compliance/retrospective-alerts', asyncHandler(listRetrospectiveAlerts));

// ------------------------------------------------------------------ collection & batch
documentsRouter.get('/', asyncHandler(listDocuments));
documentsRouter.delete('/history', asyncHandler(deleteHistory));
documentsRouter.post('/delete-history', asyncHandler(deleteHistory));
documentsRouter.post('/restore-history', asyncHandler(restoreHistory));
documentsRouter.get('/archived-count', asyncHandler(getArchivedCount));
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
documentsRouter.get('/:id/images/:imageId', asyncHandler(getDocumentImage));
documentsRouter.get('/:id/timeline', asyncHandler(getDocumentTimeline));
documentsRouter.get('/:id/evidence', asyncHandler(getDocumentEvidence));
documentsRouter.get('/:id/audit-certificate', asyncHandler(getDocumentAuditCertificate));
documentsRouter.get('/:id/report', asyncHandler(downloadReport));
documentsRouter.get('/:id/report/pdf', asyncHandler(downloadPdfReport));
documentsRouter.get('/:id/file', asyncHandler(downloadSourceFile));
documentsRouter.get('/:id/source-file', asyncHandler(downloadSourceFile));

