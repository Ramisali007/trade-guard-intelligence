import type { Request, Response } from 'express';
import { getDocumentService, type UploadedFile } from '../services/document.service';
import { contentDisposition, documentId, parsePagination, parseUnitQuery } from '../utils/http';

/**
 * HTTP translation only.
 *
 * Controllers read the request, call one service method and choose a status code. No parsing, no
 * business rules, no storage access — that keeps the pipeline testable without a server and
 * makes the API surface easy to read as a list of what the application can do.
 */

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const service = getDocumentService();
  // `req.file` is populated by the upload middleware; multer's own validation has already run.
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
  // Status is polled; a stale cached copy would show a frozen progress bar.
  res.setHeader('Cache-Control', 'no-store');
  res.json(status);
}

export async function getDocumentResults(req: Request, res: Response): Promise<void> {
  const results = await getDocumentService().getResults(documentId(req));
  res.json(results);
}

export async function getDocumentDetail(req: Request, res: Response): Promise<void> {
  const detail = await getDocumentService().getDetail(documentId(req));
  res.json(detail);
}

export async function getDocumentUnits(req: Request, res: Response): Promise<void> {
  const page = await getDocumentService().getUnits(documentId(req), parseUnitQuery(req));
  res.json({
    ...page,
    totalPages: Math.max(1, Math.ceil(page.total / page.pageSize)),
  });
}

export async function downloadReport(req: Request, res: Response): Promise<void> {
  const { filename, content } = await getDocumentService().getReport(documentId(req));

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', contentDisposition(filename));
  res.setHeader('Content-Length', String(Buffer.byteLength(content, 'utf8')));
  // The browser fetches this through the app, so the filename has to survive CORS.
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(content);
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

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return undefined;
}