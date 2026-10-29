import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { linkInStage } from '../shared/stage';
import { AuthService } from './auth.service';

/**
 * Whether the signed-in user may open a page, so a link, button or search result is offered only when it works.
 * The answer comes from the route table itself (the same `data.anyOf` the permission guard checks), so the menu,
 * the search and the guards can never disagree. This only decides what is shown; the guard and the API still enforce it.
 */
@Injectable({ providedIn: 'root' })
export class RouteAccess {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  /** True when the user may open `url`, and (for a demo sign-in) their chosen stage shows that screen. */
  canOpen(url: string): boolean {
    const segments = this.router.parseUrl(url).root.children['primary']?.segments.map((s) => s.path) ?? [];
    if (segments.length === 0) return true; // the public overview
    if (!linkInStage('/' + segments[0], this.auth.stage())) return false;
    for (const route of this.router.config) {
      const pattern = (route.path ?? '').split('/').filter(Boolean);
      if (pattern.length !== segments.length) continue;
      if (!pattern.every((part, i) => part.startsWith(':') || part === segments[i])) continue;
      const anyOf = (route.data?.['anyOf'] as string[] | undefined) ?? [];
      return anyOf.length === 0 || this.auth.canAny(...anyOf);
    }
    return true; // not a screen of ours (an external or unknown address): nothing to hide
  }
}
