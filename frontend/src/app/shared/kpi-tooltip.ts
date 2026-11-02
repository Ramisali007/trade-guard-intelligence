/** Every headline box on every screen: the common tile and the older card styles. */
export const KPI_SELECTOR = '.kpi-tile, .kpi-card, .adm-kpi, .studio-kpi-card, .report-kpi-card, .tbml-metric-card';

const LABELS = ['.kpi-tile-label', '.kpi-title', '.kpi-label', '.adm-kpi-label'];
const VALUES = ['.kpi-tile-value', '.kpi-value', '.kpi-val', '.adm-kpi-value', '.metric-val'];
const NOTES = ['.kpi-tile-note', '.kpi-sub'];

const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
const first = (box: Element, selectors: string[]): string => {
  for (const s of selectors) {
    const text = squash(box.querySelector(s)?.textContent);
    if (text) return text;
  }
  return '';
};

/**
 * What a headline box says in a sentence, for the tooltip: "Pending work: 3 — cases that need your action". Read from the box
 * as it is on screen, so it is always the current number. A box with no recognisable parts reads as its own text.
 */
export function kpiTitle(box: Element): string {
  const label = first(box, LABELS);
  const value = first(box, VALUES);
  const note = first(box, NOTES);
  if (!label && !value) return squash(box.textContent).slice(0, 200);
  return [label && value ? `${label}: ${value}` : label || value, note].filter(Boolean).join(' — ');
}

/**
 * Hovering a headline box shows what it is. A box that already has a tooltip written for it (one that leads somewhere) keeps
 * that one; every other box gets one made from what it shows, refreshed on each hover so a changed number is never stale.
 */
export function describeKpiOnHover(target: EventTarget | null): void {
  const box = (target as Element | null)?.closest?.(KPI_SELECTOR);
  if (!box) return;
  if (box.hasAttribute('title') && !box.hasAttribute('data-auto-title')) return;
  const title = kpiTitle(box);
  if (!title) return;
  box.setAttribute('title', title);
  box.setAttribute('data-auto-title', '');
}
