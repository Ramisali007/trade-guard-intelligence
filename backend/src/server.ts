import type { Server } from 'node:http';
import { config, ensureRuntimeDirectories } from './config';
import { createApp } from './app';
import { getProvider } from './ai';
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
  log.info('storage ready', { driver: repository.driver, requested: config.storage.driver });

  const provider = getProvider();
  if (provider.isLocal) {
    log.warn(
      'no AI provider configured — every passage will be classified by the built-in local engine. Set ANTHROPIC_API_KEY in backend/.env to use a language model.',
      { model: provider.model },
    );
  } else {
    log.info('analysis engine ready', { provider: provider.id, model: provider.model });
  }

  cleanupService.start();

  const app = createApp();
  const server: Server = app.listen(config.server.port, config.server.host, () => {
    const shown = config.server.host === '0.0.0.0' ? 'localhost' : config.server.host;
    log.info(`API listening on http://${shown}:${config.server.port}`, {
      environment: config.env,
      storage: repository.driver,
      engine: provider.id,
    });
  });

  // Long uploads and long model calls both need more than Node's default 5 s header timeout.
  server.headersTimeout = 65_000;
  server.requestTimeout = 15 * 60 * 1000;

  registerShutdown(server);
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

    // Stop taking new work, but let what is already open finish.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cleanupService.stop();

    const queue = getQueue();
    const pending = queue.stats();
    if (pending.active > 0 || pending.pending > 0) {
      log.info('waiting for in-flight analyses', pending);
      await queue.drain(30_000);
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

  // An uncaught exception leaves the process in an unknown state; log it fully, then leave.
  process.on('uncaughtException', (error) => {
    log.error('uncaught exception — exiting', { error: describeUnknown(error), stack: error.stack });
    process.exit(1);
  });
}

void bootstrap().catch((error: unknown) => {
  log.error('failed to start', { error: describeUnknown(error), stack: error instanceof Error ? error.stack : undefined });
  process.exit(1);
});