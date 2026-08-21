import type { Request, Response } from 'express';
import { config } from '../config';
import { getProvider } from '../ai';
import { getRepository } from '../services/document.repository';
import { getQueue } from '../services/queue.service';

/**
 * Operational endpoints.
 *
 * `/api/health` answers what an operator needs to know: is the process up, which storage driver
 * actually took (the MongoDB driver falls back to memory rather than refusing to boot), which
 * analysis engine is live, and how deep the queue is.
 *
 * `/api/config` gives the client the few limits it must respect to validate an upload before
 * sending 50 MB across the network. Both responses are built field by field. Neither one ever
 * touches `config.ai.*.apiKey` — the key exists only in this process, and a boolean is the most
 * the browser ever learns about it.
 */

export function getHealth(_req: Request, res: Response): void {
  const provider = getProvider();
  const queue = getQueue();

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    environment: config.env,
    storage: {
      driver: getRepository().driver,
      requestedDriver: config.storage.driver,
    },
    engine: {
      provider: provider.id,
      model: provider.model,
      // True when a real model is answering; false when the local engine is standing in.
      remote: !provider.isLocal,
      supportsSummary: provider.supportsSummary,
    },
    queue: queue.stats(),
    timestamp: new Date().toISOString(),
  });
}

export function getClientConfig(_req: Request, res: Response): void {
  const provider = getProvider();

  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({
    upload: {
      maxFileSizeBytes: config.upload.maxFileSizeBytes,
      maxFileSizeMb: Math.round(config.upload.maxFileSizeBytes / (1024 * 1024)),
      allowedExtensions: config.upload.allowedExtensions,
      retentionMinutes: config.upload.retentionMinutes,
    },
    processing: {
      unitsPerBatch: config.processing.unitsPerBatch,
      maxUnits: config.processing.maxUnits,
      minUnitChars: config.processing.minUnitChars,
      summaryEnabled: config.processing.enableSummary,
    },
    results: {
      defaultPageSize: 50,
      maxPageSize: 200,
    },
    engine: {
      provider: provider.id,
      model: provider.model,
      remote: !provider.isLocal,
    },
  });
}