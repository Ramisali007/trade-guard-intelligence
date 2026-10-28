/**
 * Recent authentication and authorization denials, for the system administrator's health view.
 *
 * Deliberately thin: the route *pattern* (never ids or query strings), the role, the permission and
 * the kind of denial. No tokens, no email, no record contents. A bounded ring buffer, so a flood of
 * denials cannot exhaust memory.
 */
export interface SecurityDenial {
  at: string;
  kind: 'UNAUTHENTICATED' | 'SESSION_REVOKED' | 'FORBIDDEN';
  role: string | null;
  permission: string | null;
  route: string;
}

const MAX = 500;
const denials: SecurityDenial[] = [];

export function recordDenial(denial: Omit<SecurityDenial, 'at'>): void {
  denials.push({ ...denial, at: new Date().toISOString() });
  if (denials.length > MAX) denials.splice(0, denials.length - MAX);
}

export function denialSummary(): { total: number; byKind: Record<string, number>; byRoute: Array<{ route: string; count: number }>; recent: SecurityDenial[] } {
  const byKind: Record<string, number> = {};
  const byRoute = new Map<string, number>();
  for (const d of denials) {
    byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
    byRoute.set(d.route, (byRoute.get(d.route) ?? 0) + 1);
  }
  return {
    total: denials.length,
    byKind,
    byRoute: [...byRoute.entries()].map(([route, count]) => ({ route, count })).sort((a, b) => b.count - a.count).slice(0, 15),
    recent: denials.slice(-25).reverse(),
  };
}
