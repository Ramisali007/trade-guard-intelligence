import { config } from '../config';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[config.logLevel] ?? ORDER.info;

const COLOR: Record<Level, string> = {
  debug: "\u001b[90m",
  info: "\u001b[36m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
};
const RESET = "\u001b[0m";

function emit(level: Level, scope: string, message: string, meta?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;

  const timestamp = new Date().toISOString();
  const payload = meta && Object.keys(meta).length > 0 ? ` ${safeJson(meta)}` : '';

  if (config.isProduction) {
    // Structured single-line JSON for log shippers.
    const line = safeJson({ timestamp, level, scope, message, ...(meta ?? {}) });
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
    return;
  }

  const line = `${COLOR[level]}${level.toUpperCase().padEnd(5)}${RESET} ${timestamp} [${scope}] ${message}${payload}\n`;
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val));
  } catch {
    return '"[unserialisable]"';
  }
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(childScope: string): Logger;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, meta) => emit('debug', scope, message, meta),
    info: (message, meta) => emit('info', scope, message, meta),
    warn: (message, meta) => emit('warn', scope, message, meta),
    error: (message, meta) => emit('error', scope, message, meta),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}

export const logger = createLogger('app');