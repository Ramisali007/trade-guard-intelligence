import './test-env';
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { config } from '../config';
import { DEFAULT_DEV_DEMO_PASSWORD, findDemoAccount, initAccountDirectory } from '../services/account-directory';
import { loginRetryAfterSeconds, recordLoginFailure } from '../services/login-throttle';
import type { Loose } from '../utils/loose-json';
import { recaptchaClientConfig, recaptchaEnabled, verifyRecaptcha } from '../services/recaptcha.service';

/**
 * The reCAPTCHA check on the sign-in. Google is never called: the verification request is answered by a stand-in, so
 * what is proved is our side: the check is off until both keys are set; the secret key never reaches the browser;
 * the check runs before the password is looked at; a missing, rejected or unverifiable token never lets anyone in;
 * and a failed check is not counted as a wrong password.
 */

type Keys = { siteKey?: string; secretKey?: string };
const keys = config.auth.recaptcha as unknown as Keys;
const SITE = 'test-site-key-public';
const SECRET = 'test-secret-key-never-sent-to-the-browser';

type Answer = { success: boolean; 'error-codes'?: string[] } | 'network-error';
let answer: Answer = { success: true };
const siteverifyCalls: URLSearchParams[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://www.google.com/recaptcha/api/siteverify')) {
    siteverifyCalls.push(new URLSearchParams(String(init?.body ?? '')));
    if (answer === 'network-error') throw new Error('simulated: Google unreachable');
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(input, init);
}) as typeof fetch;

async function rejects(promise: Promise<unknown>, status: number, code: string, label: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const e = error as { status?: number; code?: string };
    assert.ok(e.status === status && e.code === code, `${label}: expected ${status} ${code}, got ${e.status} ${e.code}`);
    return;
  }
  assert.fail(`${label}: expected ${status} ${code}, but it succeeded`);
}

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('reCAPTCHA on the sign-in: server-side check');
  console.log('================================================================\n');

  await initAccountDirectory();
  const account = findDemoAccount('compliance_officer')!;
  const password = config.auth.demoPassword ?? DEFAULT_DEV_DEMO_PASSWORD;

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const post = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, Loose> };
  };
  const signIn = (extra: Record<string, unknown> = {}, pw = password) => post('/auth/login', { email: account.email, password: pw, ...extra });

  // ---------------------------------------------------------------- C1 off until both keys are set
  assert.ok(!recaptchaEnabled(), 'off by default');
  assert.deepStrictEqual(recaptchaClientConfig(), { enabled: false, siteKey: null });
  keys.siteKey = SITE;
  assert.ok(!recaptchaEnabled(), 'a site key alone does not turn it on');
  keys.siteKey = undefined;
  keys.secretKey = SECRET;
  assert.ok(!recaptchaEnabled(), 'a secret key alone does not turn it on');
  keys.secretKey = undefined;
  await verifyRecaptcha(undefined); // no token needed while it is off
  const open = await signIn();
  assert.strictEqual(open.status, 200, 'sign-in works without a token while the check is off');
  assert.strictEqual(siteverifyCalls.length, 0, 'Google is not called while it is off');
  console.log('✔ C1 Passed: the check is off until both keys are set, and nothing changes for sign-in meanwhile.\n');

  keys.siteKey = SITE;
  keys.secretKey = SECRET;

  // ---------------------------------------------------------------- C2 what the browser is told
  const cfgRes = await fetch(base + '/config');
  const cfgText = await cfgRes.text();
  const cfg = JSON.parse(cfgText) as { auth: { recaptcha: { enabled: boolean; siteKey: string | null } } };
  assert.deepStrictEqual(cfg.auth.recaptcha, { enabled: true, siteKey: SITE });
  assert.ok(!cfgText.includes(SECRET), 'the secret key is never sent to the browser');
  console.log('✔ C2 Passed: the browser is given the site key and the on/off switch, never the secret key.\n');

  // ---------------------------------------------------------------- C3 no token, no sign-in
  const none = await signIn();
  assert.ok(none.status === 400 && none.json['error']?.code === 'CAPTCHA_REQUIRED', `missing token: ${none.status} ${JSON.stringify(none.json)}`);
  const empty = await signIn({ recaptchaToken: '' });
  assert.ok(empty.status === 400 && empty.json['error']?.code === 'CAPTCHA_REQUIRED', 'an empty token is the same as none');
  const huge = await signIn({ recaptchaToken: 'x'.repeat(5000) });
  assert.strictEqual(huge.status, 400, 'an oversized token is refused before it is sent anywhere');
  assert.strictEqual(siteverifyCalls.length, 0, 'nothing is sent to Google for a missing or absurd token');
  console.log('✔ C3 Passed: a missing, empty or oversized token is refused, and Google is not called.\n');

  // ---------------------------------------------------------------- C4 a solved check lets the password be tried
  answer = { success: true };
  const good = await signIn({ recaptchaToken: 'token-from-the-widget' });
  assert.strictEqual(good.status, 200, 'a verified token lets the sign-in through');
  assert.ok(good.json['token'], 'a session token is issued');
  const sent = siteverifyCalls.at(-1)!;
  assert.strictEqual(sent.get('secret'), SECRET, 'the secret key goes to Google');
  assert.strictEqual(sent.get('response'), 'token-from-the-widget', 'the widget token goes to Google');
  assert.ok(sent.get('remoteip'), 'the caller address goes to Google');
  const wrongPassword = await signIn({ recaptchaToken: 'token-from-the-widget' }, 'not-the-password');
  assert.strictEqual(wrongPassword.status, 401, 'a solved check does not make a wrong password right');
  console.log('✔ C4 Passed: a verified token lets the password be tried; the secret, token and address are what Google receives.\n');

  // ---------------------------------------------------------------- C5 a rejected token never signs anyone in
  answer = { success: false, 'error-codes': ['invalid-input-response'] };
  const rejected = await signIn({ recaptchaToken: 'bad-token' });
  assert.ok(rejected.status === 400 && rejected.json['error']?.code === 'CAPTCHA_FAILED', `rejected token: ${rejected.status}`);
  const rejectedWrong = await signIn({ recaptchaToken: 'bad-token' }, 'not-the-password');
  assert.strictEqual(rejectedWrong.status, 400, 'the check comes before the password: a wrong password behind a failed check is not even tried');
  console.log('✔ C5 Passed: a rejected token never signs anyone in, and the password is not looked at.\n');

  // ---------------------------------------------------------------- C6 Google cannot be reached: fail closed
  answer = 'network-error';
  const down = await signIn({ recaptchaToken: 'token-from-the-widget' });
  assert.ok(down.status === 503 && down.json['error']?.code === 'CAPTCHA_UNAVAILABLE', `unreachable: ${down.status}`);
  assert.strictEqual(down.json['error']?.retryable, true, 'the user is told to try again');
  console.log('✔ C6 Passed: if Google cannot be reached nobody is let in without the check (503, try again).\n');

  // ---------------------------------------------------------------- C7 a failed check is not a wrong password
  // Someone who cannot solve the check must not be able to lock the real owner out of the account.
  answer = { success: false };
  for (let i = 0; i < 12; i++) await signIn({ recaptchaToken: 'bad-token' });
  assert.strictEqual(loginRetryAfterSeconds(account.email), 0, 'failed security checks leave the account unlocked');
  // ...whereas real password failures do lock it, so the counter this proves nothing against is genuinely working.
  for (let i = 0; i < 12; i++) recordLoginFailure(account.email);
  assert.ok(loginRetryAfterSeconds(account.email) > 0, 'wrong passwords do lock the account');
  console.log('✔ C7 Passed: failed security checks are not counted against the account (wrong passwords still are).\n');

  // ---------------------------------------------------------------- C8 the verifier directly
  answer = { success: true };
  await rejects(verifyRecaptcha(undefined), 400, 'CAPTCHA_REQUIRED', 'undefined token');
  await rejects(verifyRecaptcha(42 as unknown), 400, 'CAPTCHA_REQUIRED', 'a number is not a token');
  const failingFetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
  await rejects(verifyRecaptcha('t', undefined, failingFetch), 503, 'CAPTCHA_UNAVAILABLE', 'an error answer from Google');
  console.log('✔ C8 Passed: the verifier refuses non-tokens and treats a Google error as "cannot check".\n');

  keys.siteKey = undefined;
  keys.secretKey = undefined;
  globalThis.fetch = realFetch;
  server.close();
  console.log('================================================================');
  console.log('ALL RECAPTCHA SCENARIOS PASSED');
  console.log('================================================================');
  process.exit(0);
}

run().catch((error) => {
  console.error('RECAPTCHA TEST FAILED:', error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
