import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
  /** Correlates a failure with the backend log line that recorded its real cause. */
  requestId?: string;
}

const DEFAULT_MS: Record<ToastKind, number> = {
  success: 4000,
  info: 5000,
  // Failures stay long enough to read and copy a request id from.
  error: 9000,
};

/**
 * Transient notifications.
 *
 * Errors arrive here already translated into a sentence a reader can act on — the API service
 * has unwrapped the backend's envelope and the backend put the stack trace in its own log. So a
 * toast shows a message and, for failures, the request id that ties it to that log entry. It
 * never shows a stack trace, because it never has one.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly items = signal<Toast[]>([]);
  private nextId = 1;

  readonly toasts = this.items.asReadonly();

  success(title: string, detail?: string): void {
    this.push('success', title, detail);
  }

  info(title: string, detail?: string): void {
    this.push('info', title, detail);
  }

  error(title: string, detail?: string, requestId?: string): void {
    this.push('error', title, detail, requestId);
  }

  dismiss(id: number): void {
    this.items.update((list) => list.filter((toast) => toast.id !== id));
  }

  clear(): void {
    this.items.set([]);
  }

  private push(kind: ToastKind, title: string, detail?: string, requestId?: string): void {
    const id = this.nextId++;
    const toast: Toast = {
      id,
      kind,
      title,
      ...(detail ? { detail } : {}),
      ...(requestId ? { requestId } : {}),
    };

    // Cap the stack so a burst of failures cannot bury the page.
    this.items.update((list) => [...list.slice(-3), toast]);
    setTimeout(() => this.dismiss(id), DEFAULT_MS[kind]);
  }
}