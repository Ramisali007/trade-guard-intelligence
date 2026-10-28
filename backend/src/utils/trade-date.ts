/**
 * Dates as they appear on trade documents.
 *
 * `new Date('05/06/2025')` reads month-first (US) and `new Date('13/06/2025')` is invalid — both
 * wrong for documents that, like most outside the US, write the day first. Point-in-time sanctions
 * screening depends on this date, so it is parsed explicitly: numeric dates are day-first unless
 * the first field cannot be a day-of-month (> 12 in the second field means month-first is the only
 * reading), and month names are understood in either order.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

function expandYear(year: number): number {
  if (year >= 100) return year;
  return year + (year >= 70 ? 1900 : 2000);
}

function build(year: number, month: number, day: number): string | null {
  const y = expandYear(year);
  if (y < 1900 || y > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(y, month - 1, day));
  // Reject roll-overs such as 31 February becoming 3 March.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

/** Returns an ISO timestamp (UTC midnight) for a document date, or null when it cannot be read. */
export function parseTradeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/\s+/g, ' ');

  // ISO-like: 2025-06-13, 2025/06/13, 2025.06.13
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  // Numeric: 13/06/2025, 13-06-25, 06.13.2025
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = Number(m[3]);
    if (b > 12 && a <= 12) return build(year, a, b); // only month-first is possible
    return build(year, b, a); // day-first by default
  }

  // 13 Jun 2025, 13-Jun-2025, 13 June, 2025
  m = text.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})[\s\-/.,]+(\d{2,4})\b/);
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()];
    return month ? build(Number(m[3]), month, Number(m[1])) : null;
  }

  // June 13, 2025 / Jun 13 2025
  m = text.match(/^([A-Za-z]{3,9})[\s\-/.]+(\d{1,2}),?[\s\-/.]+(\d{2,4})\b/);
  if (m) {
    const month = MONTHS[m[1]!.toLowerCase()];
    return month ? build(Number(m[3]), month, Number(m[2])) : null;
  }

  return null;
}
