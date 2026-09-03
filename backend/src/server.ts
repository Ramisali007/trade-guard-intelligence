import type { Server } from 'node:http';
import dns from 'node:dns';

// Ensure robust SRV record resolution for MongoDB Atlas across all network environments
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch {
  // fallback to system default
}

import { config, ensureRuntimeDirectories } from './config';
import { createApp } from './app';
import { getProvider, validateProviderOnStartup } from './ai';
import { closeRepository, initRepository } from './services/document.repository';
import { cleanupService } from './services/cleanup.service';
import { getQueue } from './services/queue.service';
import { createLogger } from './utils/logger';
import { describeUnknown } from './utils/errors';

const log = createLogger('server');

/**
 * Bootstrap, in dependency order: directories, then storage, then the analysis engine, then the
 * HTTP listener. Nothing accepts a request until the store it will read from is open.
 *
 * Shutdown is the same order reversed, and it waits: an in-flight analysis is finished work the
 * user is watching a progress bar for, so the process stops listening first, drains the queue,
 * and only then closes the store.
 */

async function bootstrap(): Promise<void> {
  ensureRuntimeDirectories();

  const repository = await initRepository();
  const { CustomerRepository } = await import('./services/customer.repository');
  await CustomerRepository.getInstance().init();
  log.info('storage ready', { driver: repository.driver, requested: config.storage.driver });

  const provider = getProvider();
  if (provider.isLocal) {
    log.warn(
      'no AI provider configured — every passage will be classified by the built-in local engine. Set OPENAI_API_KEY in backend/.env to use a language model.',
      { model: provider.model },
    );
  } else {
    log.info('analysis engine ready', { provider: provider.id, model: provider.model });
    const validation = await validateProviderOnStartup();
    if (!validation.ok) {
      log.error('AI provider configuration warning:', { error: validation.message, availableModels: validation.availableModels });
    } else {
      log.info('AI provider validated successfully:', { message: validation.message });
    }
  }

  cleanupService.start();

  const app = createApp();
  const server = await startServerWithRetry(app, config.server.port, config.server.host);

  const shown = config.server.host === '0.0.0.0' ? 'localhost' : config.server.host;
  log.info(`API listening on http://${shown}:${config.server.port}`, {
    environment: config.env,
    storage: repository.driver,
    engine: provider.id,
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    log.error('HTTP server encountered an error', { error: describeUnknown(error) });
  });

  // Long uploads and long model calls both need more than Node's default 5 s header timeout.
  server.headersTimeout = 65_000;
  server.requestTimeout = 15 * 60 * 1000;

  registerShutdown(server);
}

async function startServerWithRetry(
  app: ReturnType<typeof createApp>,
  port: number,
  host: string,
  maxRetries = 6,
  delayMs = 600,
): Promise<Server> {
  let attempt = 0;
  while (true) {
    try {
      return await new Promise<Server>((resolve, reject) => {
        const s: Server = app.listen(port, host);
        const onError = (err: NodeJS.ErrnoException) => {
          s.removeAllListeners();
          reject(err);
        };
        s.once('error', onError);
        s.once('listening', () => {
          s.removeListener('error', onError);
          resolve(s);
        });
      });
    } catch (err: any) {
      if (err?.code === 'EADDRINUSE' && attempt < maxRetries) {
        attempt += 1;
        log.warn(`port ${port} is occupied, waiting for previous process to release (attempt ${attempt}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        log.error(`Failed to bind to port ${port}: ${describeUnknown(err)}`);
        throw err;
      }
    }
  }
}

function registerShutdown(server: Server): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      log.warn('second shutdown signal — exiting immediately', { signal });
      process.exit(1);
    }
    shuttingDown = true;
    log.info('shutting down', { signal });

    // Instantly close all keep-alive and open HTTP connections to immediately free the port
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();

    // Stop taking new work, but let what is already open finish.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cleanupService.stop();

    const queue = getQueue();
    const pending = queue.stats();
    if (pending.active > 0 || pending.pending > 0) {
      log.info('waiting for in-flight analyses', pending);
      await queue.drain(config.env === 'development' ? 2000 : 30_000);
    }

    await closeRepository();
    log.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // A rejection nobody handled is a bug, but it is not a reason to drop a running analysis.
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled promise rejection', { reason: describeUnknown(reason) });
  });

  // An uncaught exception leaves the process in an unknown state; log it fully, then leave cleanly.
  process.on('uncaughtException', (error) => {
    log.error('uncaught exception — exiting', { error: describeUnknown(error), stack: error.stack });
    process.exit(1);
  });
}

void bootstrap().catch((error: unknown) => {
  log.error('failed to start', { error: describeUnknown(error), stack: error instanceof Error ? error.stack : undefined });
  process.exit(1);
});