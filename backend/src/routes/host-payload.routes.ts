import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { authoriseLink, openByLink, payloadFilename, recordOpen } from '../host-payload/host-payload.service';
import { renderHostPage } from '../host-payload/host-payload-page';
import { rateLimit } from '../middleware/rate-limit.middleware';
import { getTradeCaseService } from '../trade-cases/trade-case.service';
import { Errors } from '../utils/errors';
import { asyncHandler } from '../utils/http';

/**
 * The link the host opens, and everything behind it, with no bank sign-in:
 *
 *   GET /api/host-payloads/:caseNumber/:token                    the page: references, the client, the payload and the client's documents
 *   GET /api/host-payloads/:caseNumber/:token/documents/:linkId  one pre-shipment document (`?download=1` saves it)
 *   GET /api/host-payloads/:caseNumber/:token/:filename          the payload PDF (`?download=1` saves it)
 *
 * The token in the link is the credential: 256 random bits, kept only in the host payload store, compared in constant
 * time. An unknown case and a wrong token get the same answer, a document that is not a pre-shipment document of that case
 * is "not found", every open is recorded (page, payload, each document), and the routes are rate limited. Nothing else of
 * the case can be reached through them.
 */
export const hostPayloadPublicRouter = Router();

const openLimit = rateLimit({ scope: 'host-payload-open', windowMs: 60_000, max: 60, message: 'Too many requests. Please wait a minute and try again.' });

const CASE_NUMBER = /^TC-\d{4}-\d{1,10}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,80}$/;
const LINK_ID = /^[A-Za-z0-9_.-]{1,40}$/;

const wellFormed = (req: Request): { caseNumber: string; token: string } => {
  const caseNumber = String(req.params['payloadId'] ?? '');
  const token = String(req.params['token'] ?? '');
  if (!CASE_NUMBER.test(caseNumber) || !TOKEN.test(token)) throw Errors.notFound('document');
  return { caseNumber, token };
};

const asciiName = (filename: string): string => filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');

/** A response that is a file, not a page: nothing may be kept, indexed or sniffed. */
function fileHeaders(res: Response, mimeType: string, filename: string, asAttachment: boolean): void {
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `${asAttachment ? 'attachment' : 'inline'}; filename="${asciiName(filename)}"`);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
}

// One of the client's documents.
hostPayloadPublicRouter.get(
  '/:payloadId/:token/documents/:linkId',
  openLimit,
  asyncHandler(async (req, res) => {
    const { caseNumber, token } = wellFormed(req);
    const linkId = String(req.params['linkId'] ?? '');
    if (!LINK_ID.test(linkId)) throw Errors.notFound('document');
    const record = await authoriseLink(caseNumber, token);
    if (!record) throw Errors.notFound('document');
    const file = await getTradeCaseService().hostPortalFile(record.caseId, linkId);
    if (!file) throw Errors.notFound('document');
    await recordOpen(record, 'DOCUMENT', req.ip ?? '', file.filename);
    // Only a PDF is shown by the browser; any other kind of file is always a download.
    fileHeaders(res, file.mimeType, file.filename, req.query['download'] === '1' || file.mimeType !== 'application/pdf');
    res.send(file.buffer);
  }),
);

// The payload PDF.
hostPayloadPublicRouter.get(
  '/:payloadId/:token/:filename',
  openLimit,
  asyncHandler(async (req, res) => {
    const { caseNumber, token } = wellFormed(req);
    const found = await openByLink(caseNumber, token, req.ip ?? '');
    if (!found) throw Errors.notFound('document');
    fileHeaders(res, 'application/pdf', found.filename, req.query['download'] === '1');
    res.setHeader('X-Content-SHA256', found.sha256);
    res.setHeader('X-Payload-Version', String(found.version));
    res.send(found.pdf);
  }),
);

// The page.
hostPayloadPublicRouter.get(
  '/:payloadId/:token',
  openLimit,
  asyncHandler(async (req, res) => {
    const { caseNumber, token } = wellFormed(req);
    const record = await authoriseLink(caseNumber, token);
    if (!record) throw Errors.notFound('document');
    const data = await getTradeCaseService().hostPortalData(record.caseId);
    if (!data) throw Errors.notFound('document');
    const latest = record.versions[record.versions.length - 1]!;
    await recordOpen(record, 'PAGE', req.ip ?? '');
    const nonce = randomBytes(16).toString('base64');
    const html = renderHostPage({
      data,
      basePath: `${req.baseUrl}/${record.payloadId}/${token}`,
      payload: { filename: payloadFilename(record.caseId), sizeBytes: latest.sizeBytes, sha256: latest.sha256, version: latest.version, generatedAt: latest.generatedAt },
      nonce,
    });
    // This page is the one place the API answers with HTML: it may use its own style and nothing else.
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  }),
);
