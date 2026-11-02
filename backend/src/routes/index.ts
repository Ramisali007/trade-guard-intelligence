import { Router } from 'express';
import { documentsRouter } from './documents.routes';
import { chatRouter } from './chat.routes';
import { sanctionsRouter } from './sanctions.routes';
import { customersRouter } from './customers.routes';
import { importRouter } from './import.routes';
import { analyticsRouter } from './analytics.routes';
import { authRouter } from './auth.routes';
import { getTaxonomy } from '../controllers/taxonomy.controller';
import { getClientConfig, getHealth, getHealthDetails } from '../controllers/health.controller';
import { apiRateLimit, userApiRateLimit } from '../middleware/rate-limit.middleware';
import { authenticate, requireAuthenticatedUser } from '../middleware/auth.middleware';
import { adminRouter } from './admin.routes';
import { workspaceRouter } from './workspace.routes';
import { tradeCasesRouter } from './trade-cases.routes';
import { verificationRouter } from './verification.routes';
import { hostPayloadPublicRouter } from './host-payload.routes';

/** Everything the API exposes, mounted under `/api`. */
export const apiRouter = Router();

// Everything here is private to the signed-in user or the institution; no browser or shared cache may keep
// it. A route that is safe to cache (the image endpoint, the client config) sets its own header after this.
apiRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Health is deliberately outside the rate limiter so a monitor can always reach it.
apiRouter.get('/health', getHealth);

apiRouter.use(apiRateLimit);
apiRouter.get('/config', getClientConfig);
apiRouter.get('/taxonomy', getTaxonomy);

// Public / Auth endpoint
apiRouter.use('/auth', authRouter);
// The one link a host system opens without a bank sign-in: the token in it is the credential (see the router).
apiRouter.use('/host-payloads', hostPayloadPublicRouter);

// Everything below needs a signed-in principal. Each route then names the permission it requires
// (requirePermission); a route without one is a test failure, and an unknown role has none.
apiRouter.use(authenticate);
apiRouter.use(userApiRateLimit);

apiRouter.get('/health/details', requireAuthenticatedUser, getHealthDetails);
apiRouter.use('/workspace', workspaceRouter);
apiRouter.use('/documents', documentsRouter);
apiRouter.use('/sanctions', sanctionsRouter);
apiRouter.use('/customers', customersRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/import', importRouter);
apiRouter.use('/analytics', analyticsRouter);
// The trade lifecycle, pre-trade to closure. Each action is checked again in the service for the
// exact permission, the case's scope, its state and separation of duties.
apiRouter.use('/trade-cases', tradeCasesRouter);
apiRouter.use('/verification', verificationRouter);
// Identity and platform administration: technical authority, no business data.
apiRouter.use('/admin', adminRouter);
