import { config } from '../config';
import { createLogger } from '../utils/logger';
import { describeUnknown } from '../utils/errors';

const log = createLogger('queue');

/**
 * A small in-process job queue.
 *
 * Uploading returns immediately; analysis happens here, behind a bounded number of workers.
 * That bound is the point: without it, ten simultaneous 300-page uploads would open forty
 * concurrent AI connections and compete for the same event loop. With it, the tenth document
 * simply waits its turn and its status honestly reads `queued`.
 *
 * The interface is deliberately the one a distributed queue would expose (`enqueue`,
 * `position`, `cancel`, `stats`), so moving to BullMQ or SQS later means replacing this file
 * rather than changing its callers.
 */

interface Job {
  id: string;
  run: () => Promise<void>;
  enqueuedAt: number;
}

export class JobQueue {
  private readonly pending: Job[] = [];
  private readonly active = new Set<string>();
  private readonly cancelled = new Set<string>();
  private draining = false;

  constructor(private readonly concurrency: number = config.processing.jobConcurrency) {}

  enqueue(id: string, run: () => Promise<void>): void {
    if (this.active.has(id) || this.pending.some((job) => job.id === id)) {
      log.debug('job already queued', { id });
      return;
    }
    this.pending.push({ id, run, enqueuedAt: Date.now() });
    this.pump();
  }

  /** 0 when running, 1-based place in line when waiting, null when unknown. */
  position(id: string): number | null {
    if (this.active.has(id)) return 0;
    const index = this.pending.findIndex((job) => job.id === id);
    return index === -1 ? null : index + 1;
  }

  /** Drops a job that has not started. A running job is left alone — see the note below. */
  cancel(id: string): boolean {
    const index = this.pending.findIndex((job) => job.id === id);
    if (index !== -1) {
      this.pending.splice(index, 1);
      return true;
    }
    // A running pipeline holds an open provider request; marking it lets the caller report
    // accurately without leaving a half-written record behind.
    if (this.active.has(id)) {
      this.cancelled.add(id);
      return false;
    }
    return false;
  }

  isCancelled(id: string): boolean {
    return this.cancelled.has(id);
  }

  stats(): { active: number; pending: number; concurrency: number } {
    return { active: this.active.size, pending: this.pending.length, concurrency: this.concurrency };
  }

  /** Resolves when the queue is empty. Used by the graceful-shutdown path and the smoke test. */
  async drain(timeoutMs = 10 * 60 * 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while ((this.pending.length > 0 || this.active.size > 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  private pump(): void {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.active.size < this.concurrency) {
        const job = this.pending.shift();
        if (!job) break;

        this.active.add(job.id);
        log.info('job started', { id: job.id, waitedMs: Date.now() - job.enqueuedAt, active: this.active.size });

        void job
          .run()
          .catch((error: unknown) => {
            // A job records its own failure on the document; this is the last-resort net.
            log.error('job threw', { id: job.id, error: describeUnknown(error) });
          })
          .finally(() => {
            this.active.delete(job.id);
            this.cancelled.delete(job.id);
            this.pump();
          });
      }
    } finally {
      this.draining = false;
    }
  }
}

let queue: JobQueue | null = null;

export function getQueue(): JobQueue {
  if (!queue) queue = new JobQueue();
  return queue;
}