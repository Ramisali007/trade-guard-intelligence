import { inject } from '@angular/core';
import { type HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';
import { API_BASE } from '../services/api.service';

/**
 * Attaches the signed session token to API calls and reacts to authorization failures.
 *
 * Only the Bearer token is sent. Identity and role are read by the server from that token; no
 * `X-User-*` headers are sent because the server must never take them on trust.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const toast = inject(ToastService);

  const token = auth.currentUser()?.token;
  const isAuthCall = req.url.includes('/auth/login') || req.url.includes('/auth/demo-login');
  // The session token goes to this API and nowhere else, whatever URL a future caller passes in.
  const isApiCall = req.url.startsWith(API_BASE);
  const authenticatedReq = token && !isAuthCall && isApiCall ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authenticatedReq).pipe(
    catchError((error: unknown) => {
      // A failed sign-in is shown inside the login dialog, not treated as an expired session.
      if (error instanceof HttpErrorResponse && !isAuthCall) {
        if (error.status === 401 && auth.isLoggedIn()) {
          const revoked = error.error?.error?.code === 'SESSION_REVOKED' || error.error?.code === 'SESSION_REVOKED';
          toast.error(
            revoked ? 'Access changed' : 'Session expired',
            revoked ? 'Your access was changed or your session was ended by an administrator. Please sign in again.' : 'Please sign in again to continue.',
          );
          auth.logout(true);
          auth.openLoginModal(true);
        } else if (error.status === 403) {
          toast.error(
            'Not permitted',
            error.error?.error?.message || 'Your role does not have permission for this action.',
          );
        }
      }
      return throwError(() => error);
    }),
  );
};
