/**
 * Every failure that can reach a user goes through `AppError`.
 *
 * `message` is written for the person looking at the screen; the technical cause stays
 * in `internal` and is only ever logged. The error middleware never serialises `internal`
 * or a stack trace into a response.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly internal?: string;
  readonly details?: Record<string, unknown>;
  /** Whether a retry of the same request could plausibly succeed. */
  readonly retryable: boolean;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    internal?: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = 'AppError';
    this.status = options.status;
    this.code = options.code;
    this.internal = options.internal;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export const Errors = {
  noFile: () =>
    new AppError({
      status: 400,
      code: 'NO_FILE',
      message: 'No file was received. Please choose a PDF or Word document and try again.',
    }),

  unsupportedType: (detail: string) =>
    new AppError({
      status: 415,
      code: 'UNSUPPORTED_FILE_TYPE',
      message: 'That file type is not supported. Please upload a PDF, DOC or DOCX document.',
      internal: detail,
    }),

  fileTooLarge: (limitBytes: number) =>
    new AppError({
      status: 413,
      code: 'FILE_TOO_LARGE',
      message: `This file is larger than the ${Math.round(limitBytes / (1024 * 1024))} MB limit. Please upload a smaller document.`,
      details: { limitBytes },
    }),

  corruptFile: (internal: string) =>
    new AppError({
      status: 422,
      code: 'CORRUPT_FILE',
      message: "We couldn't read this document — it appears to be corrupted or password protected. Please try another file.",
      internal,
    }),

  emptyDocument: () =>
    new AppError({
      status: 422,
      code: 'EMPTY_DOCUMENT',
      message: 'This document contains no readable text. Scanned or image-only documents need OCR, which this platform does not perform.',
    }),

  extractionFailed: (internal: string) =>
    new AppError({
      status: 422,
      code: 'EXTRACTION_FAILED',
      message: "We couldn't extract text from this document. Please try again or upload another file.",
      internal,
    }),

  notFound: (what = 'document') =>
    new AppError({
      status: 404,
      code: 'NOT_FOUND',
      message: `That ${what} could not be found. It may have been deleted.`,
    }),

  conflict: (message: string) =>
    new AppError({ status: 409, code: 'CONFLICT', message }),

  notReady: (status: string) =>
    new AppError({
      status: 409,
      code: 'NOT_READY',
      message: `Analysis is not finished yet (status: ${status}). Results will be available once processing completes.`,
      details: { status },
    }),

  validation: (message: string, details?: Record<string, unknown>) =>
    new AppError({ status: 400, code: 'VALIDATION_ERROR', message, details }),

  aiUnavailable: (internal: string) =>
    new AppError({
      status: 503,
      code: 'AI_UNAVAILABLE',
      message: 'The analysis engine is temporarily unavailable. Please try again in a moment.',
      internal,
      retryable: true,
    }),

  /**
   * Rejected credentials, deliberately not retryable: a wrong key is wrong on every attempt, and
   * retrying it only delays the fallback to the local engine.
   */
  aiAuthFailed: (internal: string) =>
    new AppError({
      status: 503,
      code: 'AI_AUTH_FAILED',
      message: 'The analysis engine rejected its configured credentials, so the built-in local engine was used instead.',
      internal,
      retryable: false,
    }),

  aiRateLimited: (internal: string) =>
    new AppError({
      status: 429,
      code: 'AI_RATE_LIMITED',
      message: 'The analysis engine is rate limited right now. Please retry shortly.',
      internal,
      retryable: true,
    }),

  aiTimeout: (internal: string) =>
    new AppError({
      status: 504,
      code: 'AI_TIMEOUT',
      message: 'The analysis engine took too long to respond. Please try again.',
      internal,
      retryable: true,
    }),

  aiInvalidResponse: (internal: string) =>
    new AppError({
      status: 502,
      code: 'AI_INVALID_RESPONSE',
      message: 'The analysis engine returned an unexpected result. Please try again.',
      internal,
      retryable: true,
    }),

  processingFailed: (internal: string) =>
    new AppError({
      status: 500,
      code: 'PROCESSING_FAILED',
      message: "We couldn't process this document. Please try again or upload another file.",
      internal,
    }),

  storage: (internal: string) =>
    new AppError({
      status: 500,
      code: 'STORAGE_ERROR',
      message: 'A storage error interrupted the request. Please try again.',
      internal,
    }),

  internal: (internal: string) =>
    new AppError({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
      internal,
    }),
};

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function describeUnknown(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}