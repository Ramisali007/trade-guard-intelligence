import { Router, type Request, type Response } from 'express';
import { requireAuthenticatedUser } from '../middleware/auth.middleware';
import { DEPARTMENT_PERMISSION, hasAnyPermission, hasPermission, permissionsOf, ROLE_DEFINITIONS, TRADE_CASE_VIEW } from '../authorization/permissions';
import { sectionsFor, WORK_QUEUES } from '../authorization/workspaces';
import { currentPreTradeDocuments, getTradeCaseService, isCustomerView } from '../trade-cases/trade-case.service';
import type { CaseHeader } from '../trade-cases/trade-case.types';
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
  /** Documents the request holds now; a draft is described by this instead of a reference number. */
  documents: number;
}

function item(c: CaseHeader, view: { status: string }): QueueItem {
  return { caseId: c.caseId, status: view.status, customerRef: c.customerRef, updatedAt: c.updatedAt, documents: currentPreTradeDocuments(c).length };
}

/** GET /api/workspace/history — the cases this user has worked on, pre- and post-shipment, with what they did on each. */
workspaceRouter.get(
  '/history',
  requireAuthenticatedUser,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) throw Errors.unauthorized();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ items: hasAnyPermission(user, TRADE_CASE_VIEW) ? await getTradeCaseService().myActivity(user) : [] });
  }),
);

workspaceRouter.get(
  '/',
  requireAuthenticatedUser,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) throw Errors.unauthorized();
    const role = ROLE_DEFINITIONS[user.role];
    // `caseIds` lists every case in the queue (items shows only the first few), so the page can count a case once however many queues hold it.
    const queues: Array<{ id: string; title: string; description: string; count: number; items: QueueItem[]; caseIds: string[] }> = [];

    if (hasAnyPermission(user, TRADE_CASE_VIEW)) {
      const service = getTradeCaseService();
      const cases = await service.listCases(user, { stage: req.query['stage'] });
      const views = cases.map((c) => ({ c, view: service.listRow(user, c) }));
      const customer = isCustomerView(user);

      for (const q of WORK_QUEUES) {
        const hits = views.filter(
          ({ c, view }) => (!q.statuses || q.statuses.includes(c.status)) && view.availableActions.some((a) => q.actions.includes(a)),
        );
        if (hits.length) queues.push({ id: q.id, title: q.title, description: q.description, count: hits.length, items: hits.slice(0, 20).map(({ c, view }) => item(c, view)), caseIds: hits.map(({ c }) => c.caseId) });
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
          caseIds: queryHits.map(({ c }) => c.caseId),
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
