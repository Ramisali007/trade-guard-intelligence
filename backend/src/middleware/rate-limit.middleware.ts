import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';

/**
 * A small fixed-window rate limiter, per client address per route group.
 *
 * The purpose is narrow: uploading is expensive (parse a document, then pay a model per
 * passage), so one client should not be able to start fifty analyses in a second. Reads are
 * limited far more loosely because the processing screen polls status on purpose.
 *
 * Deliberately in-process. A multi-instance deployment would need a shared counter, and the
 * shape below — one `check` against a keyed bucket — is what a Redis-backed version would
 * replace, without any caller changing.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Distinguishes buckets so the upload limit and the read limit never share a counter. */
  scope: string;
  message: string;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

export function rateLimit(options: RateLimitOptions) {
  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    sweep(now);

    const key = `${options.scope}:${clientKey(req)}`;
    const existing = buckets.get(key);
    const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + options.windowMs };

    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, options.max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(options.max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      next(
        new AppError({
          status: 429,
          code: 'RATE_LIMITED',
          message: options.message,
          internal: `${key} exceeded ${options.max} requests per ${options.windowMs}ms`,
          details: { retryAfterSeconds: retryAfter },
          retryable: true,
        }),
      );
      return;
    }

    next();
  };
}

function clientKey(req: Request): string {
  // `req.ip` honours `trust proxy` when it is configured; the socket address is the fallback for
  // a direct connection.
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Drop expired buckets occasionally so the map cannot grow without bound. */
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export const uploadRateLimit = rateLimit({
  scope: 'upload',
  windowMs: 60_000,
  max: 20,
  message: 'That is a lot of uploads in one minute. Please wait a moment before uploading again.',
});

export const apiRateLimit = rateLimit({
  scope: 'api',
  windowMs: 60_000,
  max: 600,
  message: 'Too many requests. Please slow down and try again shortly.',
});