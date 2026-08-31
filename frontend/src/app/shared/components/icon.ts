import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The icon set, as path data.
 *
 * One component with a lookup table beats twenty single-purpose components and beats an icon
 * font: the geometry is in the bundle, nothing is fetched at runtime, and the stroke inherits
 * `currentColor` so an icon is always the colour of the text it sits beside. All paths share a
 * 24×24 box and a 1.7 stroke weight, which is what makes them look like one family.
 */
const PATHS: Record<string, string[]> = {
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'],
  document: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H3'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3.5 6h.01', 'M3.5 12h.01', 'M3.5 18h.01'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M4 20h16'],
  trash: ['M4 7h16', 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  check: ['M5 13l4 4L19 7'],
  'check-circle': ['M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z', 'M8.5 12.5l2.5 2.5 4.5-5'],
  alert: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17h.01'],
  info: ['M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z', 'M12 11v5', 'M12 8h.01'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  search: ['M11 19a8 8 0 1 1 8-8 8 8 0 0 1-8 8z', 'M21 21l-4.3-4.3'],
  sun: ['M12 17a5 5 0 1 1 5-5 5 5 0 0 1-5 5z', 'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'M5 5l1.5 1.5', 'M17.5 17.5L19 19', 'M19 5l-1.5 1.5', 'M6.5 17.5L5 19'],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z'],
  chevronRight: ['M9 6l6 6-6 6'],
  chevronLeft: ['M15 6l-6 6 6 6'],
  chevronDown: ['M6 9l6 6 6-6'],
  refresh: ['M20 12a8 8 0 1 1-2.3-5.6', 'M20 4v4h-4'],
  clock: ['M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z', 'M12 7v5l3 2'],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
  filter: ['M3 5h18', 'M6 12h12', 'M10 19h4'],
  arrowRight: ['M5 12h14', 'M13 5l7 7-7 7'],
  sparkle: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z'],
  page: ['M6 3h9l4 4v14H6z', 'M9 12h7', 'M9 16h5', 'M9 8h3'],
  cpu: ['M8 8h8v8H8z', 'M5 5h14v14H5z', 'M2 10h3', 'M2 14h3', 'M19 10h3', 'M19 14h3', 'M10 2v3', 'M14 2v3', 'M10 19v3', 'M14 19v3'],
  database: ['M12 8c4.4 0 8-1.1 8-2.5S16.4 3 12 3 4 4.1 4 5.5 7.6 8 12 8z', 'M20 5.5v13c0 1.4-3.6 2.5-8 2.5s-8-1.1-8-2.5v-13', 'M20 12c0 1.4-3.6 2.5-8 2.5S4 13.4 4 12'],
  plus: ['M12 5v14', 'M5 12h14'],
  quote: ['M9 7H5v5h4c0 3-1.5 4.5-4 5', 'M19 7h-4v5h4c0 3-1.5 4.5-4 5'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  'shield-alert': ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M12 8v4', 'M12 16h.01'],
  globe: ['M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 0c2.5 2.5 4 6 4 10s-1.5 7.5-4 10c-2.5-2.5-4-6-4-10s1.5-7.5 4-10z', 'M2 12h20'],
  package: ['M16.5 9.4 7.55 4.24', 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', 'M3.27 6.96 12 12.01l8.73-5.05', 'M12 22.08V12'],
  bank: ['M3 21h18', 'M3 10h18', 'M5 6l7-3 7 3', 'M4 10v11', 'M20 10v11', 'M8 14v4', 'M12 14v4', 'M16 14v4'],
  anchor: ['M12 2a3 3 0 0 0-3 3c0 1.3.8 2.4 2 2.8V20a7 7 0 0 1-7-7H2a9 9 0 0 0 18 0h-2a7 7 0 0 1-7 7V7.8c1.2-.4 2-1.5 2-2.8a3 3 0 0 0-3-3z'],
  'user-check': ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M16 11l2 2 4-4'],
  scale: ['M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z', 'M2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z', 'M7 21h10', 'M12 3v18', 'M3 7h18'],
};

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="weight()"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @for (d of paths(); track $index) {
        <path [attr.d]="d" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
    }
  `,
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(16);
  readonly weight = input(1.7);

  protected readonly paths = computed(() => PATHS[this.name()] ?? []);
}