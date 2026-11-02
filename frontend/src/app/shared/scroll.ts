/**
 * A headline tile leads to what it counts: bring the first of these sections that is on the page into view.
 * (The header is fixed, so each target keeps a margin above it; see `scroll-margin-top` in the global styles.)
 */
export function scrollToSection(...ids: string[]): void {
  setTimeout(() => {
    for (const id of ids) {
      const target = document.getElementById(id);
      if (!target) continue;
      const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
      return;
    }
  }, 0);
}
