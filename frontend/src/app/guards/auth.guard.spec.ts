import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { permissionGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

describe('permissionGuard', () => {
  const held = new Set<string>();
  const auth = { canAny: (...permissions: string[]) => permissions.some((p) => held.has(p)) };

  beforeEach(() => {
    held.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AuthService, useValue: auth }] });
  });

  const run = (anyOf: string[]) =>
    TestBed.runInInjectionContext(() =>
      permissionGuard({ data: { anyOf } } as unknown as ActivatedRouteSnapshot, { url: '/admin' } as RouterStateSnapshot),
    );

  it('lets a user in who holds one of the permissions', () => {
    held.add('documents.read');
    expect(run(['documents.read', 'analytics.read'])).toBeTrue();
  });

  it('sends everyone else to the access-denied page, remembering where they were going', () => {
    const result = run(['admin.users.view']);
    expect(result instanceof UrlTree).toBeTrue();
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/access-denied?from=%2Fadmin');
  });

  it('does not guard a route that names no permission', () => {
    expect(run([])).toBeTrue();
  });
});
