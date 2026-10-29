import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Preamble for the live MongoDB suite. Like test-env, but the stores use MongoDB — a database of
 * its own, `tradeguard_it_<timestamp>`, which the suite drops when it finishes. No other database
 * on the server is read or written. Fallback to memory is off so a connection failure is a failure.
 *
 * Target with MONGO_IT_URI (default mongodb://127.0.0.1:27017). Never point it at a production cluster.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tradeguard-mongo-it-'));
export const IT_DATABASE = `tradeguard_it_${Date.now()}`;
export const IT_URI = (process.env['MONGO_IT_URI'] ?? 'mongodb://127.0.0.1:27017').trim();

Object.assign(process.env, {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  AUTH_SCRYPT_LOG2_N: '14',
  LOG_LEVEL: process.env['TEST_LOG_LEVEL'] ?? 'warn',
  STORAGE_DRIVER: 'mongo',
  MONGODB_URI: IT_URI,
  MONGODB_DB: IT_DATABASE,
  STORAGE_ALLOW_MEMORY_FALLBACK: 'false',
  PERSIST_TO_DISK: 'false',
  ENABLE_DUAL_SYNC: 'false',
  MONGODB_CLOUD_URI: ' ',
  AI_PROVIDER: 'heuristic',
  // Sign-in settings are pinned too: a developer's .env may switch demo login off, provision its own users or turn on reCAPTCHA, and the suites must not depend on that.
  ENABLE_DEMO_LOGIN: 'true',
  DEMO_ACCOUNT_PASSWORD: ' ',
  AUTH_USERS: ' ',
  RECAPTCHA_SITE_KEY: ' ',
  RECAPTCHA_SECRET_KEY: ' ',
  UPLOAD_DIR: path.join(root, 'uploads'),
  DATA_DIR: path.join(root, 'data'),
  IMAGES_DIR: path.join(root, 'images'),
  COMPLIANCE_DIR: path.join(root, 'compliance'),
  AUTH_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
});

process.on('exit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
});
