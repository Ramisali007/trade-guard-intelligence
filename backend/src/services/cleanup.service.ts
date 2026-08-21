import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { describeUnknown } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { getRepository } from './document.repository';

const log = createLogger('cleanup');

/**
 * Temporary-file hygiene.
 *
 * Uploaded source documents are the sensitive artefact here: they are the user's actual file,
 * they are only needed until extraction finishes, and keeping them indefinitely is a liability
 * rather than a feature. Two mechanisms cover it:
 *
 *  - a periodic sweep removes the stored upload once its document has been in a terminal state
 *    for longer than the retention window, and clears `storagePath` so nothing later believes
 *    the file is still there;
 *  - an orphan sweep removes files in the upload directory that no document record claims at
 *    all — the residue of a crash between writing the file and creating the record.
 *
 * The analysis results themselves survive; only the original binary is discarded.
 */

export class CleanupService {
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    const intervalMs = config.upload.cleanupIntervalMinutes * 60 * 1000;

    // Run once shortly after boot to clear anything left by a previous process.
    setTimeout(() => void this.sweep(), 5_000).unref();
    this.timer = setInterval(() => void this.sweep(), intervalMs);
    this.timer.unref();

    log.info('cleanup scheduled', {
      everyMinutes: config.upload.cleanupIntervalMinutes,
      retentionMinutes: config.upload.retentionMinutes,
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<{ removed: number; orphans: number }> {
    const cutoff = new Date(Date.now() - config.upload.retentionMinutes * 60 * 1000);
    let removed = 0;
    let orphans = 0;

    try {
      const repository = getRepository();
      const stale = await repository.findStaleUploads(cutoff);

      for (const entry of stale) {
        await fs.rm(entry.storagePath, { force: true }).catch((error: unknown) => {
          log.warn('could not remove upload', { id: entry.id, error: describeUnknown(error) });
        });
        await repository.update(entry.id, (doc) => {
          doc.storagePath = null;
        });
        removed += 1;
      }

      orphans = await this.removeOrphans();
    } catch (error) {
      log.warn('sweep failed', { error: describeUnknown(error) });
    }

    if (removed > 0 || orphans > 0) log.info('cleanup sweep', { removed, orphans });
    return { removed, orphans };
  }

  /** Files in the upload directory that no document claims, older than one retention window. */
  private async removeOrphans(): Promise<number> {
    const repository = getRepository();
    const entries = await fs.readdir(config.upload.uploadDir).catch(() => [] as string[]);
    if (entries.length === 0) return 0;

    const { items } = await repository.list(10_000, 0);
    const known = new Set<string>();
    for (const item of items) known.add(item.id);

    const ageCutoff = Date.now() - config.upload.retentionMinutes * 60 * 1000;
    let removed = 0;

    for (const entry of entries) {
      // Files are stored as `<documentId><ext>`, so the id is the name without its extension.
      const id = entry.replace(/\.[^.]*$/, '');
      if (known.has(id)) continue;

      const filePath = path.join(config.upload.uploadDir, entry);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat || stat.mtimeMs > ageCutoff) continue;

      await fs.rm(filePath, { force: true }).catch(() => undefined);
      removed += 1;
    }
    return removed;
  }

  /** Immediate removal, used when a document is deleted by the user. */
  static async removeArtifacts(storagePath: string | null, documentId: string): Promise<void> {
    if (storagePath) await fs.rm(storagePath, { force: true }).catch(() => undefined);
    await fs.rm(path.join(config.upload.dataDir, `${documentId}.report.txt`), { force: true }).catch(() => undefined);
    await fs.rm(path.join(config.upload.dataDir, `${documentId}.json`), { force: true }).catch(() => undefined);
  }
}

export const cleanupService = new CleanupService();