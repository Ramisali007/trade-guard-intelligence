import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  const auth = {
    currentUser: () => ({ token: 'session-token' }),
    isLoggedIn: () => true,
    logout: jasmine.createSpy('logout'),
    openLoginModal: jasmine.createSpy('openLoginModal'),
  };
  const toast = { error: jasmine.createSpy('error') };

  beforeEach(() => {
    auth.logout.calls.reset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('sends the session token to this API', () => {
    http.get('/api/documents').subscribe();
    const req = controller.expectOne('/api/documents');
    expect(req.request.headers.get('Authorization')).toBe('Bearer session-token');
    req.flush({});
  });

  it('never sends the session token anywhere else', () => {
    http.get('https://third-party.example/analytics').subscribe();
    const req = controller.expectOne('https://third-party.example/analytics');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });

  it('does not attach a token to the sign-in call itself', () => {
    http.post('/api/auth/login', {}).subscribe({ error: () => undefined });
    const req = controller.expectOne('/api/auth/login');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('signs the user out when the server revokes the session', () => {
    http.get('/api/documents').subscribe({ error: () => undefined });
    controller.expectOne('/api/documents').flush({ error: { code: 'SESSION_REVOKED' } }, { status: 401, statusText: 'Unauthorized' });
    expect(auth.logout).toHaveBeenCalledWith(true);
    expect(auth.openLoginModal).toHaveBeenCalled();
  });
});
