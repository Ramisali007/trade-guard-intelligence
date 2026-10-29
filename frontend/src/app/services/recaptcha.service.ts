import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

interface Grecaptcha {
  render(container: HTMLElement, parameters: Record<string, unknown>): number;
  reset(widgetId?: number): void;
}

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
    __tradeguardRecaptchaReady?: () => void;
  }
}

const SCRIPT_URL = 'https://www.google.com/recaptcha/api.js?onload=__tradeguardRecaptchaReady&render=explicit';

/**
 * Google reCAPTCHA v2 ("I'm not a robot") for the sign-in form. Whether it is on, and the public site key, come from the
 * server (`/api/config`); Google's script is fetched only when the check is on and only when the form is opened. The
 * token it produces is worthless until the server has checked it with Google, which it does before looking at the password.
 */
@Injectable({ providedIn: 'root' })
export class RecaptchaService {
  private readonly api = inject(ApiService);

  /** The public site key while the check is on, otherwise null. */
  readonly siteKey = signal<string | null>(null);
  private loaded = false;
  private script: Promise<void> | null = null;
  private widgetId: number | null = null;

  /** Ask the server once whether the sign-in is protected by reCAPTCHA. */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const config = await firstValueFrom(this.api.get<{ auth?: { recaptcha?: { enabled?: boolean; siteKey?: string | null } } }>('/config'));
      const recaptcha = config.auth?.recaptcha;
      this.siteKey.set(recaptcha?.enabled && recaptcha.siteKey ? recaptcha.siteKey : null);
      this.loaded = true;
    } catch {
      // The server is unreachable; the sign-in will say so itself. Try again next time the form opens.
    }
  }

  private ensureScript(): Promise<void> {
    if (window.grecaptcha?.render) return Promise.resolve();
    if (!this.script) {
      this.script = new Promise<void>((resolve, reject) => {
        window.__tradeguardRecaptchaReady = () => resolve();
        const tag = document.createElement('script');
        tag.src = SCRIPT_URL;
        tag.async = true;
        tag.defer = true;
        tag.onerror = () => {
          this.script = null; // allow another try, e.g. after the network comes back
          reject(new Error('The reCAPTCHA script could not be loaded.'));
        };
        document.head.appendChild(tag);
      });
    }
    return this.script;
  }

  /**
   * Draws the checkbox into `container`. `onToken` receives the token when the visitor passes; `onExpired` is called when
   * it runs out (about two minutes). Resolves false when the widget could not be drawn (blocked script, offline).
   */
  async render(container: HTMLElement, onToken: (token: string) => void, onExpired: () => void): Promise<boolean> {
    const siteKey = this.siteKey();
    if (!siteKey) return false;
    try {
      await this.ensureScript();
    } catch {
      return false;
    }
    if (!window.grecaptcha) return false;
    container.innerHTML = '';
    this.widgetId = window.grecaptcha.render(container, {
      sitekey: siteKey,
      theme: 'dark',
      callback: onToken,
      'expired-callback': onExpired,
      'error-callback': onExpired,
    });
    return true;
  }

  /** A token works once, so the widget starts over after every sign-in attempt. */
  reset(): void {
    if (this.widgetId !== null) window.grecaptcha?.reset(this.widgetId);
  }
}
