import { Router } from 'express';
import {
  analyzeDocument,
  deleteDocument,
  downloadReport,
  getDocumentDetail,
  getDocumentResults,
  getDocumentStatus,
  getDocumentUnits,
  listDocuments,
  uploadDocument,
} from '../controllers/document.controller';
import { singleDocumentUpload } from '../middleware/upload.middleware';
import { uploadRateLimit } from '../middleware/rate-limit.middleware';
import { asyncHandler } from '../utils/http';

/**
 * The document endpoints.
 *
 * Each stage of the workflow gets its own route, and none of them does another's work: upload
 * stores and validates, analyze queues, status reports measured progress, results returns the
 * aggregate, units pages the passages, report renders the `.txt`. A client can therefore upload
 * without analysing, poll without fetching results, or re-download the report without
 * recomputing anything.
 */

export const documentsRouter = Router();

// ------------------------------------------------------------------ collection
documentsRouter.get('/', asyncHandler(listDocuments));

// Upload carries its own tighter limit: it is the one route that costs real work per call.
documentsRouter.post('/upload', uploadRateLimit, singleDocumentUpload, asyncHandler(uploadDocument));

// ------------------------------------------------------------------ single document
documentsRouter.get('/:id', asyncHandler(getDocumentDetail));
documentsRouter.delete('/:id', asyncHandler(deleteDocument));

documentsRouter.post('/:id/analyze', uploadRateLimit, asyncHandler(analyzeDocument));
documentsRouter.get('/:id/status', asyncHandler(getDocumentStatus));
documentsRouter.get('/:id/results', asyncHandler(getDocumentResults));
documentsRouter.get('/:id/units', asyncHandler(getDocumentUnits));
documentsRouter.get('/:id/report', asyncHandler(downloadReport));