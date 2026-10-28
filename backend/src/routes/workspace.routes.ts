import { Router, type Request, type Response } from 'express';
import { requireAuthenticatedUser } from '../middleware/auth.middleware';
import { DEPARTMENT_PERMISSION, hasAnyPermission, hasPermission, permissionsOf, ROLE_DEFINITIONS, TRADE_CASE_VIEW } from '../authorization/permissions';
import { sectionsFor, WORK_QUEUES } from '../authorization/workspaces';
import { getTradeCaseService, isCustomerView } from '../trade-cases/trade-case.service';
import type { TradeCase } from '../trade-cases/trade-case.types';
import { Errors } from '../utils/errors';
import { asyncHandler } from '../utils/http';

/**
 * /api/workspace — the signed-in user's portal: who they are, what they may open, and the cases
 * waiting on them. Queues are built from the same `availableActions` the case screen shows, so a
 * case appears in a queue only when the server would accept the user's next step on it.
 */
export const workspaceRouter = Router();

interface QueueItem {
  caseId: string;
  status: string;
  customerRef: string;
  updatedAt: string;
}

function item(c: TradeCase, view: Record<string, unknown>): QueueItem {
  return { caseId: c.caseId, status: String(view['status'] ?? c.status), customerRef: c.customerRef, updatedAt: c.updatedAt };
}

workspaceRouter.get(
  '/',
  requireAuthenticatedUser,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) throw Errors.unauthorized();
    const role = ROLE_DEFINITIONS[user.role];
    const queues: Array<{ id: string; title: string; description: string; count: number; items: QueueItem[] }> = [];

    if (hasAnyPermission(user, TRADE_CASE_VIEW)) {
      const service = getTradeCaseService();
      const cases = await service.listCases(user, { stage: req.query['stage'] });
      const views = cases.map((c) => ({ c, view: service.toView(user, c) }));
      const customer = isCustomerView(user);

      for (const q of WORK_QUEUES) {
        const hits = views.filter(({ view }) => ((view['availableActions'] as string[]) ?? []).some((a) => q.actions.includes(a)));
        if (hits.length) queues.push({ id: q.id, title: q.title, description: q.description, count: hits.length, items: hits.slice(0, 20).map(({ c, view }) => item(c, view)) });
      }
      // Questions addressed to this user's side: the customer's own, or a department the user reviews for.
      const queryHits = views.filter(({ c }) =>
        c.queries.some(
          (q) =>
            q.status === 'OPEN' &&
            (customer ? q.assignee === 'CUSTOMER' : q.assignee !== 'CUSTOMER' && hasPermission(user, DEPARTMENT_PERMISSION[q.assignee])),
        ),
      );
      if (queryHits.length) {
        queues.unshift({
          id: 'open-queries',
          title: customer ? 'Questions from the bank' : 'Open queries for your desk',
          description: 'Queries waiting for a response.',
          count: queryHits.length,
          items: queryHits.slice(0, 20).map(({ c, view }) => item(c, view)),
        });
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      user: { id: user.id, name: user.name, email: user.email, institution: user.institution, customerRef: user.customerRef ?? null },
      role: { id: user.role, displayName: role.displayName, description: role.description, dataScope: role.dataScope },
      permissions: [...permissionsOf(user.role)].sort(),
      sections: sectionsFor(user),
      queues,
    });
  }),
);
