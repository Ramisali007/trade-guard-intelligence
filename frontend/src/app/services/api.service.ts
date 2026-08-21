import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import type { ApiErrorBody } from '../models/api.models';

/**
 * The one place that talks HTTP.
 *
 * Its real job is error translation. Every failing endpoint on the backend returns the same
 * envelope — `{ code, message, requestId, retryable }` — with a message already written for a
 * reader, and the technical cause left in the server's logs. This service unwraps that envelope
 * into an `ApiError` the UI can display verbatim, and invents a safe message for the cases the
 * backend never gets to answer at all: a dropped connection, a CORS refusal, a dev server that
 * is not running. Nothing downstream ever has to inspect an `HttpErrorResponse`.
 *
 * There are no API credentials here, and there is no client for a model provider anywhere in
 * this application. The browser knows one host: this API.
 */

/** Overridable at deploy time by setting `window.DOCUINTEL_API_BASE` before the bundle loads. */
function resolveBase(): string {
  const configured = (globalThis as { DOCUINTEL_API_BASE?: unknown }).DOCUINTEL_API_BASE;
  if (typeof configured === 'string' && configured.length > 0) return configured.replace(/\/$/, '');
  // Development and the default single-origin deployment both proxy /api to the backend.
  return '/api';
}

export const API_BASE = resolveBase();

/** A failure with a message that is safe to render as-is. */
export class ApiError extends Error {
  constructor(
    override readonly message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  get<T>(path: string, params?: Record<string, unknown>): Observable<T> {
    return this.http
      .get<T>(`${API_BASE}${path}`, { params: toParams(params) })
      .pipe(catchError((error: unknown) => this.fail(error)));
  }

  post<T>(path: string, body?: unknown): Observable<T> {
    return this.http
      .post<T>(`${API_BASE}${path}`, body ?? {})
      .pipe(catchError((error: unknown) => this.fail(error)));
  }

  delete<T>(path: string): Observable<T> {
    return this.http
      .delete<T>(`${API_BASE}${path}`)
      .pipe(catchError((error: unknown) => this.fail(error)));
  }

  /** Multipart upload. Returns the raw request so the caller can track upload progress events. */
  upload<T>(path: string, form: FormData): Observable<T> {
    return this.http
      .post<T>(`${API_BASE}${path}`, form)
      .pipe(catchError((error: unknown) => this.fail(error)));
  }

  /** Text response, used for the report download. */
  getText(path: string): Observable<{ body: string; filename: string | null }> {
    return this.http
      .get(`${API_BASE}${path}`, { responseType: 'text', observe: 'response' })
      .pipe(
        catchError((error: unknown) => this.fail(error)),
      ) as unknown as Observable<{ body: string; filename: string | null }>;
  }

  private fail(error: unknown): Observable<never> {
    return throwError(() => toApiError(error));
  }
}

/**
 * Translate anything the HTTP layer can throw into an `ApiError`.
 *
 * `status === 0` is the interesting case: the request never reached the server, so there is no
 * envelope to read and no way to distinguish a stopped backend from a lost network. The message
 * says what the reader can act on rather than guessing at a cause.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return new ApiError(
        'We could not reach the analysis service. Check that the backend is running, then try again.',
        'NETWORK_UNREACHABLE',
        0,
        true,
      );
    }

    const body = extractBody(error.error);
    if (body) {
      return new ApiError(
        body.message,
        body.code ?? 'REQUEST_FAILED',
        error.status,
        body.retryable ?? error.status >= 500,
        body.requestId,
        body.details,
      );
    }

    // A non-envelope failure — a proxy error page, an HTML 502 — must not be shown raw.
    return new ApiError(
      error.status === 429
        ? 'Too many requests at once. Please wait a moment and try again.'
        : 'Something went wrong while talking to the analysis service. Please try again.',
      `HTTP_${error.status}`,
      error.status,
      error.status >= 500 || error.status === 429,
    );
  }

  return new ApiError(
    'Something unexpected went wrong. Please try again.',
    'UNKNOWN',
    0,
    true,
  );
}

/** The envelope arrives parsed for JSON responses and as a string for text ones. */
function extractBody(raw: unknown): ApiErrorBody | null {
  const candidate = typeof raw === 'string' ? tryParse(raw) : raw;
  if (candidate === null || typeof candidate !== 'object') return null;

  const record = candidate as Record<string, unknown>;
  const message = record['message'];
  if (typeof message !== 'string' || message.length === 0) return null;

  return {
    message,
    code: typeof record['code'] === 'string' ? record['code'] : 'REQUEST_FAILED',
    ...(typeof record['requestId'] === 'string' ? { requestId: record['requestId'] } : {}),
    ...(typeof record['retryable'] === 'boolean' ? { retryable: record['retryable'] } : {}),
    ...(record['details'] !== undefined ? { details: record['details'] } : {}),
  };
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Arrays become repeated parameters, which is what the backend's query parser expects. */
function toParams(params: Record<string, unknown> | undefined): HttpParams | undefined {
  if (!params) return undefined;

  let result = new HttpParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === null || entry === undefined || entry === '') continue;
        result = result.append(key, String(entry));
      }
    } else {
      result = result.set(key, String(value));
    }
  }
  return result;
}