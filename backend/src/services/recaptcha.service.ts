import { config } from '../config';
import { AppError } from '../utils/errors';
import { createLogger } from '../utils/logger';

const log = createLogger('recaptcha');

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/** The check is on only when both keys are configured; without them the sign-in works as before. */
export function recaptchaEnabled(): boolean {
  return Boolean(config.auth.recaptcha.siteKey && config.auth.recaptcha.secretKey);
}

/** What the browser needs to show the widget. The site key is public by design; the secret key never leaves the server. */
export function recaptchaClientConfig(): { enabled: boolean; siteKey: string | null } {
  return recaptchaEnabled() ? { enabled: true, siteKey: config.auth.recaptcha.siteKey ?? null } : { enabled: false, siteKey: null };
}

/**
 * Checks the token the widget produced with Google. Throws when the check is on and the token is missing, rejected, or
 * cannot be checked: a sign-in is never let through because Google could not be reached. A token works once.
 */
export async function verifyRecaptcha(token: unknown, remoteIp?: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!recaptchaEnabled()) return;
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
    throw new AppError({ status: 400, code: 'CAPTCHA_REQUIRED', message: "Please confirm that you are not a robot, then sign in." });
  }
  const body = new URLSearchParams({ secret: config.auth.recaptcha.secretKey ?? '', response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  let result: { success?: boolean; 'error-codes'?: string[] };
  try {
    const response = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('siteverify answered ' + response.status);
    result = (await response.json()) as typeof result;
  } catch (error) {
    log.error('reCAPTCHA could not be checked', { error: String(error) });
    throw new AppError({ status: 503, code: 'CAPTCHA_UNAVAILABLE', message: 'The security check could not be reached. Please try again in a moment.', retryable: true });
  }
  if (!result.success) {
    log.warn('reCAPTCHA token rejected', { codes: result['error-codes'] ?? [] });
    throw new AppError({ status: 400, code: 'CAPTCHA_FAILED', message: 'The security check was not completed. Please try again.' });
  }
}
