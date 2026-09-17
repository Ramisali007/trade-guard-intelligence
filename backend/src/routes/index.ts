import { Router } from 'express';
import { documentsRouter } from './documents.routes';
import { chatRouter } from './chat.routes';
import { sanctionsRouter } from './sanctions.routes';
import { customersRouter } from './customers.routes';
import { importRouter } from './import.routes';
import { analyticsRouter } from './analytics.routes';
import { authRouter } from './auth.routes';
import { getTaxonomy } from '../controllers/taxonomy.controller';
import { getClientConfig, getHealth } from '../controllers/health.controller';
import { apiRateLimit } from '../middleware/rate-limit.middleware';
import { authenticate } from '../middleware/auth.middleware';

/** Everything the API exposes, mounted under `/api`. */
export const apiRouter = Router();

// Health is deliberately outside the rate limiter so a monitor can always reach it.
apiRouter.get('/health', getHealth);

apiRouter.use(apiRateLimit);
apiRouter.get('/config', getClientConfig);
apiRouter.get('/taxonomy', getTaxonomy);

// Public / Auth endpoint
apiRouter.use('/auth', authRouter);

// Authenticated Banking API endpoints
apiRouter.use('/documents', documentsRouter);
apiRouter.use('/sanctions', authenticate, sanctionsRouter);
apiRouter.use('/customers', authenticate, customersRouter);
apiRouter.use('/chat', authenticate, chatRouter);
apiRouter.use('/import', importRouter);
apiRouter.use('/analytics', authenticate, analyticsRouter);