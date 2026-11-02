import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createLogger } from './logger';
import { describeUnknown } from './errors';

const log = createLogger('snapshot');

/** Writes to the same file wait for each other: two renames onto one target race (EPERM on Windows). */
const pendingWrites = new Map<string, Promise<void>>();

const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      // Windows refuses to replace a file that a scanner or reader holds open for a moment.
      if (attempt >= 5 || !TRANSIENT_RENAME_CODES.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

/**
 * Write JSON so a crash mid-write can never leave a truncated file behind: the data goes to a
 * uniquely named temporary file in the same directory, which is then renamed over the target.
 * Rename is atomic on the same volume, so readers see the old file or the new one, nothing between.
 */
export async function writeJsonAtomic(file: string, data: unknown, options: { pretty?: boolean; mode?: number } = {}): Promise<void> {
  const key = path.resolve(file);
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => writeOnce(file, data, options));
  pendingWrites.set(key, current);
  try {
    await current;
  } finally {
    if (pendingWrites.get(key) === current) pendingWrites.delete(key);
  }
}

async function writeOnce(file: string, data: unknown, options: { pretty?: boolean; mode?: number }): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const text = options.pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  try {
    await fs.writeFile(temporary, text, { encoding: 'utf8', ...(options.mode !== undefined ? { mode: options.mode } : {}) });
    await renameWithRetry(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readJsonIfPresent<T>(file: string): Promise<T | null> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return JSON.parse(text) as T;
}

/**
 * A snapshot of in-memory state that is rewritten shortly after it changes. Writes are coalesced
 * (a burst of changes produces one file write) and serialized, and a failed write is logged and
 * retried on the next change rather than thrown into the request that happened to trigger it.
 */
export class DebouncedSnapshot {
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly collect: () => unknown,
    private readonly delayMs = 750,
  ) {}

  markDirty(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
    this.timer.unref();
  }

  /** Write now (also used at shutdown). Resolves when the file is on disk. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.writing = this.writing
      .then(() => writeJsonAtomic(this.file, this.collect(), { mode: 0o600 }))
      .catch((error: unknown) => {
        log.error('snapshot write failed', { file: this.file, error: describeUnknown(error) });
      });
    return this.writing;
  }
}
