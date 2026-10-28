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
  reanalyzeDocument,
  getDocumentAnalysisHistory,
  getDocumentImportHistory,
  compareDocuments,
  downloadComparisonPdfReport,
  overrideComplianceDecision,
  listComplianceSources,
  syncComplianceSource,
  syncAllComplianceSources,
  getSyncAllStatus,
  getComplianceHealth,
  screenHistoricalPointInTime,
  getDocumentTimeline,
  getDocumentEvidence,
  getDocumentAuditCertificate,
  listRetrospectiveAlerts,
  getDocumentImage,
  getLiveFxQuote,
  getLiveFxRates,
  getDualDbStatus,
  purgeDocument,
} from '../controllers/document.controller';
import { singleDocumentUpload, multiDocumentUpload } from '../middleware/upload.middleware';
import { uploadRateLimit } from '../middleware/rate-limit.middleware';
import { requirePermission } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/http';

export const documentsRouter = Router();

// Authenticated at the mount (routes/index.ts); every route below names the permission it needs.

// ------------------------------------------------------------------ regulatory & sources
documentsRouter.get('/compliance/sources', requirePermission('compliance.sources.read'), asyncHandler(listComplianceSources));
documentsRouter.post('/compliance/sources/sync-all', requirePermission('compliance.sources.sync'), asyncHandler(syncAllComplianceSources));
documentsRouter.get('/compliance/sources/sync-all/status', requirePermission('compliance.sources.read'), asyncHandler(getSyncAllStatus));
documentsRouter.post('/compliance/sources/:sourceId/sync', requirePermission('compliance.sources.sync'), asyncHandler(syncComplianceSource));
documentsRouter.get('/compliance/health', requirePermission('compliance.sources.read'), asyncHandler(getComplianceHealth));
// Names the database hosts and user: platform operations only.
documentsRouter.get('/compliance/dual-db-status', requirePermission('system.storage.status'), asyncHandler(getDualDbStatus));
documentsRouter.get('/compliance/fx-rates', requirePermission('compliance.sources.read'), asyncHandler(getLiveFxRates));
documentsRouter.get('/compliance/fx-quote', requirePermission('compliance.sources.read'), asyncHandler(getLiveFxQuote));
documentsRouter.post('/compliance/screen/historical', requirePermission('compliance.screening.run'), asyncHandler(screenHistoricalPointInTime));
documentsRouter.get('/compliance/retrospective-alerts', requirePermission('compliance.sources.read'), asyncHandler(listRetrospectiveAlerts));

// ------------------------------------------------------------------ collection & batch
documentsRouter.get('/', requirePermission('documents.read'), asyncHandler(listDocuments));
documentsRouter.delete('/history', requirePermission('documents.delete'), asyncHandler(deleteHistory));
documentsRouter.post('/delete-history', requirePermission('documents.delete'), asyncHandler(deleteHistory));
documentsRouter.post('/restore-history', requirePermission('documents.delete'), asyncHandler(restoreHistory));
documentsRouter.get('/archived-count', requirePermission('documents.read'), asyncHandler(getArchivedCount));
documentsRouter.post('/upload', requirePermission('documents.upload'), uploadRateLimit, singleDocumentUpload, asyncHandler(uploadDocument));
documentsRouter.post('/upload-batch', requirePermission('documents.upload'), uploadRateLimit, multiDocumentUpload, asyncHandler(uploadMultipleDocuments));
documentsRouter.post('/compare', requirePermission('documents.read'), asyncHandler(compareDocuments));
documentsRouter.post('/compare/pdf', requirePermission('documents.read'), asyncHandler(downloadComparisonPdfReport));
documentsRouter.get('/compare/pdf', requirePermission('documents.read'), asyncHandler(downloadComparisonPdfReport));

// ------------------------------------------------------------------ single document & evidence
documentsRouter.get('/:id', requirePermission('documents.read'), asyncHandler(getDocumentDetail));
documentsRouter.delete('/:id', requirePermission('documents.delete'), asyncHandler(deleteDocument));
documentsRouter.post('/:id/purge', requirePermission('documents.purge'), asyncHandler(purgeDocument));

documentsRouter.post('/:id/analyze', requirePermission('documents.upload'), uploadRateLimit, asyncHandler(analyzeDocument));
documentsRouter.post('/:id/reanalyze', requirePermission('documents.upload'), uploadRateLimit, asyncHandler(reanalyzeDocument));
documentsRouter.get('/:id/analysis-history', requirePermission('documents.read'), asyncHandler(getDocumentAnalysisHistory));
documentsRouter.get('/:id/import-history', requirePermission('documents.read'), asyncHandler(getDocumentImportHistory));
documentsRouter.post('/:id/override', requirePermission('documents.override'), asyncHandler(overrideComplianceDecision));
documentsRouter.get('/:id/status', requirePermission('documents.read'), asyncHandler(getDocumentStatus));
documentsRouter.get('/:id/results', requirePermission('documents.read'), asyncHandler(getDocumentResults));
documentsRouter.get('/:id/units', requirePermission('documents.read'), asyncHandler(getDocumentUnits));
documentsRouter.get('/:id/images/:imageId', requirePermission('documents.read'), asyncHandler(getDocumentImage));
documentsRouter.get('/:id/timeline', requirePermission('documents.read'), asyncHandler(getDocumentTimeline));
documentsRouter.get('/:id/evidence', requirePermission('documents.read'), asyncHandler(getDocumentEvidence));
documentsRouter.get('/:id/audit-certificate', requirePermission('documents.read'), asyncHandler(getDocumentAuditCertificate));
documentsRouter.get('/:id/report', requirePermission('documents.read'), asyncHandler(downloadReport));
documentsRouter.get('/:id/report/pdf', requirePermission('documents.read'), asyncHandler(downloadPdfReport));
documentsRouter.get('/:id/file', requirePermission('documents.read'), asyncHandler(downloadSourceFile));
documentsRouter.get('/:id/source-file', requirePermission('documents.read'), asyncHandler(downloadSourceFile));

