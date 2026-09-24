import { Injectable, signal } from '@angular/core';
import type { ThemeMode } from '../shared/palette';

const STORAGE_KEY = 'docuintel.theme';

/**
 * Banking Theme Management Service.
 * Strictly enforces canonical crisp high-contrast institutional theme across workbenches.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>('light');

  constructor() {
    // Strictly enforce light mode across the entire banking portal
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
    this.set('light');
  }

  set(_mode: ThemeMode): void {
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