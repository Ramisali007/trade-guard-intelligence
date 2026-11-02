import type { Server } from 'node:http';
import dns from 'node:dns';
import path from 'node:path';
import { config, ensureRuntimeDirectories, securityWarnings } from './config';
import { createApp } from './app';
import { getProvider, validateProviderOnStartup } from './ai';
import { closeRepository, initRepository } from './services/document.repository';
import { cleanupService } from './services/cleanup.service';
import { getQueue } from './services/queue.service';
import { createLogger } from './utils/logger';
import { describeUnknown, errorFields } from './utils/errors';

const log = createLogger('server');

/** How long a request that is still running gets to finish once shutdown has begun. */
const SHUTDOWN_GRACE_MS = 15_000;

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
  for (const warning of securityWarnings()) log.warn('SECURITY: ' + warning);
  configureDns();

  const repository = await initRepository();
  const { CustomerRepository } = await import('./services/customer.repository');
  await CustomerRepository.getInstance().init();
  const { ComplianceStore } = await import('./compliance/db/compliance-store');
  await ComplianceStore.getInstance().init();
  // The trade lifecycle: an invalid bank policy file stops start-up here rather than half-applying.
  const { getWorkflowPolicy } = await import('./trade-cases/workflow.policy');
  const policy = getWorkflowPolicy();
  const { initTradeCaseRepository } = await import('./trade-cases/trade-case.repository');
  const tradeCases = await initTradeCaseRepository();
  const { initHostPayloadRepository } = await import('./host-payload/host-payload.repository');
  await initHostPayloadRepository();
  const { initAccountDirectory } = await import('./services/account-directory');
  await initAccountDirectory();
  const { initTokenRevocation } = await import('./services/token-revocation');
  await initTokenRevocation();
  await (await import('./compliance/import/master-data-changes')).MasterDataChangeService.getInstance().init();
  await (await import('./verification/governance')).VerificationGovernance.getInstance().init();
  await (await import('./verification/pct/pct-store')).PctStore.getInstance().init();
  if (config.storage.persistToDisk) {
    const { TransactionRegistry } = await import('./compliance/fraud/transaction-registry');
    await TransactionRegistry.getInstance().attachPersistence(path.join(config.upload.dataDir, 'fraud-registry.json'));
  }
  const { getTradeCaseService } = await import('./trade-cases/trade-case.service');
  getTradeCaseService();
  log.info('storage ready', { driver: repository.driver, requested: config.storage.driver, tradeCases: tradeCases.driver, workflowPolicy: policy.version });

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
  const { syncScheduler } = await import('./compliance/sync/sync-scheduler.service');
  syncScheduler.start();

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
  // keepAliveTimeout must exceed a load balancer's idle timeout (60 s on common ones), or the proxy
  // reuses a connection this process has just closed and the caller sees a 502.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 15 * 60 * 1000;

  registerShutdown(server);
}

/** Before any database connects: the mongodb+srv:// lookup is the first DNS query that matters. */
function configureDns(): void {
  const servers = config.server.dnsServers;
  try {
    if (!(servers.length === 1 && servers[0] === 'system')) dns.setServers(servers);
    dns.setDefaultResultOrder('ipv4first');
  } catch (error) {
    log.warn('DNS_SERVERS could not be applied; using the system resolvers', { servers, error: describeUnknown(error) });
  }
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
    } catch (err) {
      if (errorFields(err).code === 'EADDRINUSE' && attempt < maxRetries) {
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

    // Stop taking new work, but let requests already in flight finish. Idle keep-alive sockets are
    // closed at once; busy ones are given a grace period and then cut so the process can exit.
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    const forceTimer = setTimeout(() => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    }, SHUTDOWN_GRACE_MS);
    forceTimer.unref();
    await closed;
    clearTimeout(forceTimer);
    cleanupService.stop();
    const { syncScheduler } = await import('./compliance/sync/sync-scheduler.service');
    syncScheduler.stop();

    const queue = getQueue();
    const pending = queue.stats();
    if (pending.active > 0 || pending.pending > 0) {
      log.info('waiting for in-flight analyses', pending);
      await queue.drain(config.env === 'development' ? 2000 : 30_000);
    }

    const { TransactionRegistry } = await import('./compliance/fraud/transaction-registry');
    await TransactionRegistry.getInstance().flush();
    const { flushTokenRevocation } = await import('./services/token-revocation');
    await flushTokenRevocation();
    await (await import('./compliance/import/master-data-changes')).MasterDataChangeService.getInstance().flush();
    await (await import('./verification/governance')).VerificationGovernance.getInstance().flush();
    await (await import('./verification/pct/pct-store')).PctStore.getInstance().flush();
    await closeRepository();
    const { closeTradeCaseRepository } = await import('./trade-cases/trade-case.repository');
    await closeTradeCaseRepository();
    const { closeHostPayloadRepository } = await import('./host-payload/host-payload.repository');
    await closeHostPayloadRepository();
    const { closeAccountDirectory } = await import('./services/account-directory');
    await closeAccountDirectory();
    log.info('shutdown complete');
    process.exit(0);
  };

  // A flush or close that throws must not leave a half-stopped process holding the port: report it and exit non-zero.
  const shutdownAndExit = (signal: string): void => {
    shutdown(signal).catch((error: unknown) => {
      log.error('shutdown failed — exiting', { signal, error: describeUnknown(error) });
      process.exit(1);
    });
  };
  process.on('SIGINT', () => shutdownAndExit('SIGINT'));
  process.on('SIGTERM', () => shutdownAndExit('SIGTERM'));

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