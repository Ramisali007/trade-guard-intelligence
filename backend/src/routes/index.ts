import { Router } from 'express';
import { documentsRouter } from './documents.routes';
import { chatRouter } from './chat.routes';
import { sanctionsRouter } from './sanctions.routes';
import { customersRouter } from './customers.routes';
import { getTaxonomy } from '../controllers/taxonomy.controller';
import { getClientConfig, getHealth } from '../controllers/health.controller';
import { apiRateLimit } from '../middleware/rate-limit.middleware';

/** Everything the API exposes, mounted under `/api`. */
export const apiRouter = Router();

// Health is deliberately outside the rate limiter so a monitor can always reach it.
apiRouter.get('/health', getHealth);

apiRouter.use(apiRateLimit);
apiRouter.get('/config', getClientConfig);
apiRouter.get('/taxonomy', getTaxonomy);
apiRouter.use('/documents', documentsRouter);
apiRouter.use('/sanctions', sanctionsRouter);
apiRouter.use('/customers', customersRouter);
apiRouter.use('/chat', chatRouter);