import type { NextFunction, Request, Response } from 'express';
import { AppError, Errors, describeUnknown, isAppError } from '../utils/errors';
import { createLogger } from '../utils/logger';

const log = createLogger('errors');

/**
 * The single exit for every failure.
 *
 * Two rules, and they are the whole point of this file:
 *
 *  1. The response body contains only `code`, `message`, `requestId` and — where it helps the UI
 *     act — a small `details` object. Never a stack trace, never a file path, never a provider
 *     error string, never anything about the internals.
 *  2. Everything that was withheld is logged, with the request id, so the detail is recoverable
 *     by whoever operates the service rather than lost.
 *
 * Unknown errors become a generic 500. That is not laziness: an error nobody anticipated is
 * exactly the kind whose message is most likely to leak something.
 */

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(
    new AppError({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
      message: 'That endpoint does not exist.',
      internal: `${req.method} ${req.originalUrl}`,
    }),
  );
}

export function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  // Headers already sent means a response is mid-stream; Express's default handler is the only
  // thing that can end it cleanly.
  if (res.headersSent) {
    log.error('error after response started', { error: describeUnknown(error) });
    next(error);
    return;
  }

  const appError = toAppError(error);
  const requestId = typeof res.locals['requestId'] === 'string' ? res.locals['requestId'] : 'unknown';

  const logPayload = {
    requestId,
    method: req.method,
    path: req.originalUrl.split('?')[0],
    status: appError.status,
    code: appError.code,
    internal: appError.internal,
    stack: error instanceof Error ? error.stack : undefined,
  };

  // 4xx is the client being told something reasonable; 5xx is ours to answer for.
  if (appError.status >= 500) log.error(appError.message, logPayload);
  else log.warn(appError.message, logPayload);

  const body: ErrorResponseBody = {
    error: {
      code: appError.code,
      message: appError.message,
      requestId,
      retryable: appError.retryable,
      ...(appError.details ? { details: appError.details } : {}),
    },
  };

  res.status(appError.status).json(body);
}

function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  // Express's own JSON body-parser errors are worth translating rather than flattening to 500.
  if (isSyntaxError(error)) {
    return Errors.validation('The request body was not valid JSON.');
  }
  if (isPayloadTooLarge(error)) {
    return new AppError({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'That request was too large to process.',
      internal: describeUnknown(error),
    });
  }
  return Errors.internal(describeUnknown(error));
}

function isSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError && 'body' in error;
}

function isPayloadTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: unknown }).type === 'entity.too.large'
  );
}