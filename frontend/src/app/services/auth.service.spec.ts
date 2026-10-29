import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

@Component({ selector: 'app-stub', template: '' })
class StubPage {}

/** After sign-in a visitor goes where they were heading, never to another site, and never to a page they cannot open. */
describe('AuthService: returning to the page the visitor asked for', () => {
  const routes: Routes = [
    { path: '', component: StubPage },
    { path: 'workspace', component: StubPage },
    { path: 'sources', component: StubPage },
    { path: 'trade-cases/:id', component: StubPage },
    { path: 'forbidden', component: StubPage, canActivate: [() => TestBed.inject(Router).createUrlTree(['/access-denied'])] },
    { path: 'access-denied', component: StubPage },
  ];
  let signedInRole = 'TRADE_MAKER';
  let lastBody: Record<string, unknown> = {};
  const api = {
    post: (_path: string, body: Record<string, unknown>) => (lastBody = body, of({ token: 'token', user: { id: 'u1', name: 'Test User', email: 't@example.test', role: signedInRole, institution: 'Test Bank' } })),
    get: () => of({ user: {} }),
  };
  const toast = { success: () => undefined, warning: () => undefined, error: () => undefined, info: () => undefined };

  let router: Router;
  let auth: AuthService;

  beforeEach(() => {
    signedInRole = 'TRADE_MAKER';
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), { provide: ApiService, useValue: api }, { provide: ToastService, useValue: toast }],
    });
    router = TestBed.inject(Router);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  /** Arrive as the route guard leaves a visitor (`/?returnUrl=...`), then sign in as the pre- or post-shipment officer. */
  async function signInAfterAskingFor(returnUrl: string | null, stage: 'pre' | 'post'): Promise<string> {
    await router.navigateByUrl(returnUrl === null ? '/' : `/?returnUrl=${encodeURIComponent(returnUrl)}`);
    signedInRole = stage === 'post' ? 'POST_TRADE_OFFICER' : 'TRADE_MAKER';
    await auth.login('someone@example.test', 'password');
    await new Promise((resolve) => setTimeout(resolve, 50));
    return router.url;
  }

  it('goes to the page that was asked for', async () => {
    expect(await signInAfterAskingFor('/sources', 'post')).toBe('/sources');
  });

  it('keeps the rest of the address, such as a case number', async () => {
    expect(await signInAfterAskingFor('/trade-cases/TC-2026-00001', 'post')).toBe('/trade-cases/TC-2026-00001');
  });

  it('goes to the workspace when nothing was asked for', async () => {
    expect(await signInAfterAskingFor(null, 'post')).toBe('/workspace');
  });

  it('never follows an address that leaves the app', async () => {
    expect(await signInAfterAskingFor('//evil.example/phish', 'post')).toBe('/workspace');
    expect(await signInAfterAskingFor('https://evil.example', 'post')).toBe('/workspace');
  });

  it('does not open a screen the chosen stage hides', async () => {
    expect(await signInAfterAskingFor('/sources', 'pre')).toBe('/workspace');
  });

  describe('the reCAPTCHA token', () => {
    it('is sent with the sign-in when there is one', async () => {
      await auth.login('someone@example.test', 'password', 'token-from-the-widget');
      expect(lastBody['recaptchaToken']).toBe('token-from-the-widget');
      expect(lastBody['email']).toBe('someone@example.test');
    });

    it('is left out when there is none, so a server without the check sees the sign-in it always did', async () => {
      await auth.login('someone@example.test', 'password');
      expect('recaptchaToken' in lastBody).toBeFalse();
    });
  });

  describe('the portal a person works in follows from their role', () => {
    const stageAfterSigningInAs = async (role: string): Promise<string | null> => {
      signedInRole = role;
      await auth.login('someone@example.test', 'password');
      return auth.stage();
    };

    it('puts the customer and the pre-shipment officer in pre-shipment', async () => {
      expect(await stageAfterSigningInAs('CORPORATE_CUSTOMER')).toBe('pre');
      expect(await stageAfterSigningInAs('TRADE_MAKER')).toBe('pre');
    });

    it('puts the post-shipment officer in post-shipment', async () => {
      expect(await stageAfterSigningInAs('POST_TRADE_OFFICER')).toBe('post');
    });

    it('leaves every other role without a stage', async () => {
      expect(await stageAfterSigningInAs('CHIEF_COMPLIANCE_OFFICER')).toBeNull();
    });
  });

  it('falls back to the workspace when the role may not open the page, instead of the access-denied page', async () => {
    expect(await signInAfterAskingFor('/forbidden', 'post')).toBe('/workspace');
  });
});
