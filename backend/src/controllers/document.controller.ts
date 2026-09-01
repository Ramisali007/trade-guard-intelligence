import type { Request, Response } from 'express';
import { getDocumentService, type UploadedFile } from '../services/document.service';
import { ComparisonService } from '../services/comparison.service';
import { generateComparisonPdfReport } from '../services/pdf-report.service';
import { contentDisposition, documentId, parsePagination, parseUnitQuery } from '../utils/http';
import { Errors } from '../utils/errors';

/**
 * HTTP translation only.
 *
 * Controllers read the request, call one service method and choose a status code.
 */

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const service = getDocumentService();
  const file = req.file as UploadedFile | undefined;
  const autoStart = readBoolean(req.body?.['autoStart']) ?? false;

  const document = await service.createFromUpload(file, { autoStart });

  res.status(201).json({
    id: document.id,
    filename: document.filename,
    fileType: document.fileType,
    fileSize: document.fileSize,
    uploadedAt: document.uploadedAt,
    status: document.status,
    progress: document.progress,
    analysisStarted: autoStart,
  });
}

export async function uploadMultipleDocuments(req: Request, res: Response): Promise<void> {
  const service = getDocumentService();
  const files = (req.files as UploadedFile[]) || (req.file ? [req.file as UploadedFile] : []);
  const autoStart = readBoolean(req.body?.['autoStart']) ?? true;

  if (!files || files.length === 0) {
    throw Errors.validation('No files uploaded.');
  }

  const results = [];
  for (const file of files) {
    const document = await service.createFromUpload(file, { autoStart });
    results.push({
      id: document.id,
      filename: document.filename,
      fileType: document.fileType,
      fileSize: document.fileSize,
      uploadedAt: document.uploadedAt,
      status: document.status,
      progress: document.progress,
      analysisStarted: autoStart,
    });
  }

  res.status(201).json({
    count: results.length,
    documents: results,
  });
}

export async function compareDocuments(req: Request, res: Response): Promise<void> {
  const documentIds = req.body?.documentIds;
  if (!Array.isArray(documentIds) || documentIds.length < 2) {
    throw Errors.validation('Please provide at least 2 document IDs in "documentIds" array.');
  }

  const comparisonService = new ComparisonService();
  const result = await comparisonService.compareDocuments(documentIds);
  res.json(result);
}

export async function downloadComparisonPdfReport(req: Request, res: Response): Promise<void> {
  let documentIds: string[] = [];
  if (Array.isArray(req.body?.documentIds)) {
    documentIds = req.body.documentIds;
  } else if (typeof req.query['ids'] === 'string') {
    documentIds = req.query['ids'].split(',').map((s) => s.trim()).filter(Boolean);
  }

  if (!documentIds || documentIds.length < 2) {
    throw Errors.validation('Please provide at least 2 document IDs to generate comparison report.');
  }

  const comparisonService = new ComparisonService();
  const comparisonResult = await comparisonService.compareDocuments(documentIds);
  const buffer = await generateComparisonPdfReport(comparisonResult);

  const filename = `Trade_Reconciliation_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(filename));
  res.send(buffer);
}

export async function analyzeDocument(req: Request, res: Response): Promise<void> {
  const service = getDocumentService();
  const id = documentId(req);
  const document = await service.startAnalysis(id);

  res.status(202).json({
    id: document.id,
    status: document.status,
    progress: document.progress,
    queuePosition: service.queueStats().pending,
  });
}

export async function getDocumentStatus(req: Request, res: Response): Promise<void> {
  const status = await getDocumentService().getStatus(documentId(req));
  res.setHeader('Cache-Control', 'no-store');
  res.json(status);
}

export async function getDocumentDetail(req: Request, res: Response): Promise<void> {
  const document = await getDocumentService().getDetail(documentId(req));
  res.json(document);
}

export async function getDocumentResults(req: Request, res: Response): Promise<void> {
  const document = await getDocumentService().getResults(documentId(req));
  res.json(document);
}

export async function getDocumentUnits(req: Request, res: Response): Promise<void> {
  const query = parseUnitQuery(req);
  const page = await getDocumentService().getUnits(documentId(req), query);
  res.json(page);
}

export async function downloadReport(req: Request, res: Response): Promise<void> {
  const format = req.query['format'];
  if (format === 'pdf') {
    return downloadPdfReport(req, res);
  }
  const { filename, content } = await getDocumentService().getReport(documentId(req));
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', contentDisposition(filename));
  res.send(content);
}

export async function downloadPdfReport(req: Request, res: Response): Promise<void> {
  const { filename, buffer } = await getDocumentService().getPdfReport(documentId(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(filename));
  res.send(buffer);
}

export async function listDocuments(req: Request, res: Response): Promise<void> {
  const { limit, offset } = parsePagination(req);
  const { items, total } = await getDocumentService().list(limit, offset);
  res.json({ items, total, limit, offset });
}

export async function deleteDocument(req: Request, res: Response): Promise<void> {
  await getDocumentService().delete(documentId(req));
  res.status(204).send();
}

export async function overrideComplianceDecision(req: Request, res: Response): Promise<void> {
  const id = documentId(req);
  const { action, officerName, officerRole, newDecision, reason, notes } = req.body;
  const updatedDoc = await getDocumentService().overrideComplianceDecision(id, {
    action,
    officerName,
    officerRole,
    newDecision,
    reason,
    notes,
  });
  res.json(updatedDoc);
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return undefined;
}
