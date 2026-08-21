import { Injectable, effect, signal } from '@angular/core';
import type { ThemeMode } from '../shared/palette';

const STORAGE_KEY = 'docuintel.theme';

/**
 * Light/dark mode.
 *
 * The chart components read `mode()` to choose their palette, so switching theme re-colours the
 * data visualisations as well as the chrome — the two palettes were checked against their own
 * surfaces, and using the light one on a dark card would undo that.
 *
 * The stored preference wins; with nothing stored the OS setting is followed, and a later change
 * to the OS setting is picked up as long as the user has not made an explicit choice.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly explicit = signal<ThemeMode | null>(readStored());
  private readonly system = signal<ThemeMode>(readSystem());

  readonly mode = signal<ThemeMode>(this.explicit() ?? this.system());

  constructor() {
    const query = matchMediaSafe();
    query?.addEventListener('change', (event) => {
      this.system.set(event.matches ? 'dark' : 'light');
      if (this.explicit() === null) this.mode.set(this.system());
    });

    effect(() => {
      const mode = this.mode();
      document.documentElement.dataset['theme'] = mode;
      const meta = document.querySelector('meta[name="theme-color"]');
      meta?.setAttribute('content', mode === 'dark' ? '#1a1a19' : '#fcfcfb');
    });
  }

  toggle(): void {
    this.set(this.mode() === 'dark' ? 'light' : 'dark');
  }

  set(mode: ThemeMode): void {
    this.explicit.set(mode);
    this.mode.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // A blocked localStorage only costs the preference across reloads.
    }
  }

  /** Forget the explicit choice and follow the OS again. */
  useSystem(): void {
    this.explicit.set(null);
    this.mode.set(this.system());
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignored for the same reason.
    }
  }
}

function readStored(): ThemeMode | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

function matchMediaSafe(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
}

function readSystem(): ThemeMode {
  return matchMediaSafe()?.matches ? 'dark' : 'light';
}