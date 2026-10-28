import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import { config } from '../config';
import { AppError, Errors } from '../utils/errors';

/**
 * Upload handling.
 *
 * Memory storage rather than disk storage: the file is identified by magic bytes
 * before it is persisted. The size limit aborts streams exceeding the cap.
 */

function createFilter() {
  return (_req: Request, file: Express.Multer.File, callback: multer.FileFilterCallback) => {
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
  };
}

const singleUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSizeBytes,
    files: 1,
    fields: 8,
    fieldNameSize: 100,
  },
  fileFilter: createFilter(),
});

const multiUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSizeBytes,
    files: 10,
    fields: 16,
    fieldNameSize: 100,
  },
  fileFilter: createFilter(),
});

/**
 * Accepts a single file in the `file` field.
 */
export function singleDocumentUpload(req: Request, res: Response, next: NextFunction): void {
  singleUpload.single('file')(req, res, (error: unknown) => {
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

/**
 * Accepts multiple files (up to 10) in `files` or `file`.
 */
export function multiDocumentUpload(req: Request, res: Response, next: NextFunction): void {
  multiUpload.array('files', 10)(req, res, (error: unknown) => {
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
    next(Errors.validation('Batch upload could not be read. Please try again.'));
  });
}

function translateMulterError(error: multer.MulterError): AppError {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return Errors.fileTooLarge(config.upload.maxFileSizeBytes);
    case 'LIMIT_FILE_COUNT':
      return Errors.validation('Please upload at most 10 documents at a time.');
    case 'LIMIT_UNEXPECTED_FILE':
      return Errors.validation('The upload used an unexpected field name. Files must be sent as "files" or "file".');
    default:
      return Errors.validation('That upload could not be read. Please try again.', { reason: error.code });
  }
}

// ---------------------------------------------------------------------- reference datasets (CSV)

const datasetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 12, fieldNameSize: 100, fieldSize: 2000 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    // A tariff file is plain CSV text. Browsers label it text/csv, application/vnd.ms-excel or octet-stream.
    if (extension !== '.csv') {
      callback(Errors.unsupportedType(`Extension "${extension || '(none)'}" rejected: a reference dataset is a .csv file`));
      return;
    }
    callback(null, true);
  },
});

/** One CSV file in the `file` field, with the dataset's details as text fields. For reference-data submission only. */
export function datasetCsvUpload(req: Request, res: Response, next: NextFunction): void {
  datasetUpload.single('file')(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof AppError) {
      next(error);
      return;
    }
    if (error instanceof multer.MulterError) {
      next(error.code === 'LIMIT_FILE_SIZE' ? Errors.validation('A tariff file may be at most 12 MB.') : Errors.validation('That upload could not be read.', { reason: error.code }));
      return;
    }
    next(Errors.validation('That upload could not be read. Please try again.'));
  });
}
