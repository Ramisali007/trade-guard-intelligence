import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';

/**
 * Bank-Grade Angular Route Guard
 * Enforces authenticated session before granting access to operational trade finance workbenches.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const toast = inject(ToastService);

  if (auth.isLoggedIn() && auth.currentUser()) {
    return true;
  }

  toast.warning(
    'Banking Authentication Required',
    'Please sign in with your institutional credentials to access the TradeGuard Workbench.',
  );

  auth.openLoginModal();
  return router.createUrlTree(['/'], { queryParams: { returnUrl: state.url } });
};

/**
 * A screen needs one of the permissions in `route.data.anyOf`. Without it the user gets the
 * access-denied page rather than a screen full of 403s; the API refuses the calls regardless.
 */
export const permissionGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const anyOf = (route.data?.['anyOf'] as string[] | undefined) ?? [];
  if (anyOf.length === 0 || auth.canAny(...anyOf)) return true;
  return router.createUrlTree(['/access-denied'], { queryParams: { from: state.url } });
};
