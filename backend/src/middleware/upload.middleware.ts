import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import { config } from '../config';
import { AppError, Errors } from '../utils/errors';

/**
 * Upload handling.
 *
 * Memory storage rather than disk storage, deliberately: the file has to be identified by its
 * magic bytes before it is trusted, and buffering means a rejected upload never becomes a file
 * on the server at all. The size limit is what makes that safe — multer aborts the stream as
 * soon as the limit is exceeded, so a 2 GB upload never accumulates in memory.
 *
 * The checks here are the cheap first pass. `DocumentService.createFromUpload` repeats them and
 * adds signature detection, so the real decision does not depend on this middleware being the
 * only path in.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSizeBytes,
    files: 1,
    fields: 8,
    // Nothing here needs a long field name; a short cap closes off a cheap abuse vector.
    fieldNameSize: 100,
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!(config.upload.allowedExtensions as readonly string[]).includes(extension)) {
      callback(Errors.unsupportedType(`Extension "${extension || '(none)'}" rejected at the upload filter`));
      return;
    }
    if (!(config.upload.allowedMimeTypes as readonly string[]).includes(file.mimetype)) {
      callback(Errors.unsupportedType(`MIME type "${file.mimetype}" rejected at the upload filter`));
      return;
    }
    callback(null, true);
  },
});

/**
 * Accepts a single file in the `file` field, translating multer's own errors into `AppError`s so
 * the error handler has nothing special to know about uploads.
 */
export function singleDocumentUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof AppError) {
      next(error);
      return;
    }
    if (error instanceof multer.MulterError) {
      next(translateMulterError(error));
      return;
    }
    next(Errors.validation('That upload could not be read. Please try again.'));
  });
}

function translateMulterError(error: multer.MulterError): AppError {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return Errors.fileTooLarge(config.upload.maxFileSizeBytes);
    case 'LIMIT_FILE_COUNT':
      return Errors.validation('Please upload one document at a time.');
    case 'LIMIT_UNEXPECTED_FILE':
      return Errors.validation('The upload used an unexpected field name. The file must be sent as "file".');
    default:
      return Errors.validation('That upload could not be read. Please try again.', { reason: error.code });
  }
}