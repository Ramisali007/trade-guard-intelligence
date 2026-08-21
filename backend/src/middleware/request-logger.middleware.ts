import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger';

const log = createLogger('http');

/**
 * One log line per request, emitted on finish so it can carry the status and duration.
 *
 * Every request also gets an id, echoed back as `X-Request-Id`. When a user reports "it said it
 * couldn't process my document", that id is what connects their screen to the stack trace in the
 * server log — which is the only place the stack trace ever appears.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  const requestId = headerValue(req.headers['x-request-id']) ?? randomUUID();

  res.locals['requestId'] = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const entry = {
      requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(durationMs),
    };

    // Polling the status endpoint is normal and frequent; logging it at info would drown
    // everything else that matters.
    if (res.statusCode >= 500) log.error('request failed', entry);
    else if (res.statusCode >= 400) log.warn('request rejected', entry);
    else if (req.method === 'GET' && req.originalUrl.includes('/status')) log.debug('request', entry);
    else log.info('request', entry);
  });

  next();
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value !== 'string') return undefined;
  // A client-supplied id is only useful if it is short and boring.
  return /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : undefined;
}