import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Imported first by every suite. Configuration is read once at import time and dotenv never
 * overrides variables that are already set, so pinning them here keeps tests away from the
 * developer's MongoDB, the cloud mirror, the on-disk stores and any paid AI provider.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tradeguard-test-'));

Object.assign(process.env, {
  NODE_ENV: 'test',
  // Pinned so a developer's .env cannot change what the suites exercise (demo login needs loopback).
  HOST: '127.0.0.1',
  LOG_LEVEL: process.env['TEST_LOG_LEVEL'] ?? 'warn',
  STORAGE_DRIVER: 'memory',
  PERSIST_TO_DISK: 'false',
  ENABLE_DUAL_SYNC: 'false',
  MONGODB_CLOUD_URI: ' ',
  // A developer's .env may carry the real audit key; the suites run unkeyed unless TEST_AUDIT_HMAC_KEY opts in (see the keyed run in docs/audit) or a suite sets its own (hardening H11).
  AUDIT_HMAC_KEY: process.env['TEST_AUDIT_HMAC_KEY'] ?? ' ',
  AI_PROVIDER: 'heuristic',
  // No model exists in the suites; the pre-shipment AI steps are exercised with a stub model instead.
  PRESHIPMENT_REQUIRE_AI: 'false',
  // No network in the suites. External verification is off unless a suite switches it on with a synthetic reference.
  EXTERNAL_SOURCES_OFFLINE: 'true',
  EXTERNAL_VERIFICATION_ENABLED: 'false',
  UPLOAD_DIR: path.join(root, 'uploads'),
  DATA_DIR: path.join(root, 'data'),
  IMAGES_DIR: path.join(root, 'images'),
  COMPLIANCE_DIR: path.join(root, 'compliance'),
  AUTH_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
  // Sign-in settings are pinned too: a developer's .env may switch demo login off, provision its own users or turn on reCAPTCHA, and the suites must not depend on that.
  ENABLE_DEMO_LOGIN: 'true',
  DEMO_ACCOUNT_PASSWORD: ' ',
  AUTH_USERS: ' ',
  RECAPTCHA_SITE_KEY: ' ',
  RECAPTCHA_SECRET_KEY: ' ',
  // A lower scrypt cost keeps the many sign-ins in the suites fast; production defaults to 2^17.
  AUTH_SCRYPT_LOG2_N: '14',
});

process.on('exit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // Best effort; the OS cleans its temp directory eventually.
  }
});
