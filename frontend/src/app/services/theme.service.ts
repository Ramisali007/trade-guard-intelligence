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
  readonly mode = signal<ThemeMode>('light');

  constructor() {
    // Strictly enforce light mode across the entire website
    if (typeof document !== 'undefined') {
      document.documentElement.dataset['theme'] = 'light';
      const meta = document.querySelector('meta[name="theme-color"]');
      meta?.setAttribute('content', '#fcfcfb');
    }
    try {
      localStorage.setItem(STORAGE_KEY, 'light');
    } catch {
      // Ignored
    }
  }

  toggle(): void {
    // Enforce light mode strictly
    this.set('light');
  }

  set(mode: ThemeMode): void {
    this.mode.set('light');
    if (typeof document !== 'undefined') {
      document.documentElement.dataset['theme'] = 'light';
    }
    try {
      localStorage.setItem(STORAGE_KEY, 'light');
    } catch {
      // Ignored
    }
  }

  useSystem(): void {
    this.set('light');
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