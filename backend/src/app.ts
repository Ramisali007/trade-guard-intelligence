import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { config } from './config';
import { apiRouter } from './routes';
import { requestLogger } from './middleware/request-logger.middleware';
import { errorHandler, notFoundHandler } from './middleware/error-handler.middleware';
import { createLogger } from './utils/logger';

const log = createLogger('app');

/**
 * The Express application, kept separate from the server bootstrap so it can be constructed
 * without binding a port.
 *
 * Global middleware lives here. Per-route protection — the tighter upload rate cap, the multer
 * limits — lives with the route that needs it, so reading a route file tells you everything that
 * guards it.
 */
export function createApp(): express.Express {
  const app = express();

  // Express advertising itself is free information for someone fingerprinting the stack.
  app.disable('x-powered-by');

  // The rate limiter keys on `req.ip`, which only reflects the real client behind a proxy when
  // Express is told to trust one. Left off for a direct deployment, where a forwarded header
  // would simply be a way to spoof a fresh bucket.
  if (config.server.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      // The API serves JSON and a text report to a frontend on a different origin.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // No HTML is served from here, so a page-oriented CSP has nothing to protect.
      contentSecurityPolicy: false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header means a same-origin or non-browser client (curl, the smoke test).
        if (!origin || config.server.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        // Answering without CORS headers lets the browser block it. Throwing here would surface
        // as an opaque 500 and tell the caller more than it needs to know.
        log.warn('blocked a cross-origin request', { origin });
        callback(null, false);
      },
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Request-Id'],
      exposedHeaders: [
        'X-Request-Id',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Content-Disposition',
      ],
      maxAge: 600,
      credentials: false,
    }),
  );

  app.use(requestLogger);
  app.use(compression());

  // Uploads are read by multer inside the upload route, so these parsers only ever see small
  // JSON and form bodies. The modest limit is deliberate.
  app.use(express.json({ limit: config.server.bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.server.bodyLimit }));

  app.use('/api', apiRouter);

  // A bare GET at the root is usually someone checking whether the API is the thing listening.
  app.get('/', (_req, res) => {
    res.json({
      name: 'DocuIntel API',
      documentation: '/api/health, /api/config, /api/taxonomy, /api/documents',
    });
  });

  // These two must stay last, and in this order.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}