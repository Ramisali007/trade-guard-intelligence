import { inject } from '@angular/core';
import { type HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';

/**
 * Bank-Grade HTTP Interceptor
 * Injects cryptographic Bearer tokens and audit context headers into all outgoing API calls.
 * Catches 401 Unauthorized / 403 Forbidden responses to enforce re-authentication.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const toast = inject(ToastService);

  const currentUser = auth.currentUser();
  let headers = req.headers;

  if (currentUser) {
    if (currentUser.token) {
      headers = headers.set('Authorization', `Bearer ${currentUser.token}`);
    }
    if (currentUser.id) {
      headers = headers.set('X-User-Id', currentUser.id);
    }
    if (currentUser.role) {
      headers = headers.set('X-User-Role', currentUser.role);
    }
    if (currentUser.name) {
      headers = headers.set('X-User-Name', encodeURIComponent(currentUser.name));
    }
  }

  const authenticatedReq = req.clone({ headers });

  return next(authenticatedReq).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        if (error.status === 401) {
          toast.error(
            'Session Expired / Unauthorized',
            'Your institutional banking session has expired. Please sign in again.',
          );
          auth.logout();
          auth.openLoginModal();
        } else if (error.status === 403) {
          toast.error(
            'Privilege Denied (403)',
            error.error?.message || 'You do not have the required banking authority for this action.',
          );
        }
      }
      return throwError(() => error);
    }),
  );
};
