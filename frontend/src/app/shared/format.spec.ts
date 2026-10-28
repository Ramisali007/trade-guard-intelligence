import {
  formatBytes,
  formatDuration,
  formatPercent,
  formatRelative,
  humanize,
  pluralize,
  preview,
  sumValues,
} from './format';

describe('format helpers', () => {
  it('formats byte sizes in the unit a reader expects', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
    expect(formatBytes(null)).toBe('—');
  });

  it('formats durations as ms, seconds, or minutes and seconds', () => {
    expect(formatDuration(820)).toBe('820 ms');
    expect(formatDuration(4200)).toBe('4.2 s');
    expect(formatDuration(78_000)).toBe('1 m 18 s');
    expect(formatDuration(Number.NaN)).toBe('—');
  });

  it('formats fractions as percentages', () => {
    expect(formatPercent(0.256)).toBe('26%');
    expect(formatPercent(0.256, 1)).toBe('25.6%');
    expect(formatPercent(undefined)).toBe('—');
  });

  it('describes recent times relatively', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(formatRelative('2026-10-20T11:59:30Z', now)).toBe('just now');
    expect(formatRelative('2026-10-20T11:54:00Z', now)).toBe('6 min ago');
    expect(formatRelative('2026-10-20T09:00:00Z', now)).toBe('3 hrs ago');
    expect(formatRelative('not a date', now)).toBe('—');
  });

  it('humanizes identifiers and collapses previews to one line', () => {
    expect(humanize('customer_support')).toBe('Customer support');
    expect(preview('a\n\n  b', 10)).toBe('a b');
    expect(preview('abcdefghij', 5)).toBe('abcd…');
  });

  it('pluralizes and sums distributions', () => {
    expect(pluralize(1, 'page')).toBe('page');
    expect(pluralize(3, 'page')).toBe('pages');
    expect(sumValues({ a: 2, b: 3 })).toBe(5);
    expect(sumValues(null)).toBe(0);
  });
});
