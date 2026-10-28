import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../middleware/auth.middleware';
import { PERMISSIONS, ROLE_DEFINITIONS, ROLE_IDS } from '../authorization/permissions';
import { denialSummary } from '../authorization/security-events';
import {
  createManagedAccount,
  decideAccessChange,
  identityAudit,
  listAccessRequests,
  listAccounts,
  requestAccessChange,
  revokeSessions,
  setAccountStatus,
} from '../services/account-directory';
import { getProvider } from '../ai';
import { getRepository } from '../services/document.repository';
import { getQueue } from '../services/queue.service';
import { config } from '../config';
import { Errors } from '../utils/errors';
import { asyncHandler } from '../utils/http';

/**
 * /api/admin — identity and platform administration.
 *
 * Administration is technical authority only. Nothing here reads or changes a trade case, a
 * document or a finding, and a role change is a request that a *second* administrator approves;
 * nobody can change their own access. Every change is written to the hash-chained identity log.
 */
export const adminRouter = Router();

function actor(req: Request): { id: string; name: string } {
  if (!req.user) throw Errors.unauthorized();
  return { id: req.user.id, name: req.user.name };
}

const USER_ID = /^[A-Za-z0-9._:@-]{3,128}$/;
function userId(req: Request): string {
  const id = String(req.params['userId'] ?? '');
  if (!USER_ID.test(id)) throw Errors.validation('That user id is not valid.');
  return id;
}

adminRouter.get('/users', requirePermission('admin.users.view'), (_req: Request, res: Response) => {
  res.json({ users: listAccounts() });
});

adminRouter.post(
  '/users',
  requirePermission('admin.users.manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const { account, temporaryPassword } = await createManagedAccount(actor(req), req.body ?? {});
    // Returned once, to the administrator who created the account, for out-of-band delivery.
    res.status(201).json({ account, temporaryPassword });
  }),
);

adminRouter.post(
  '/users/:userId/status',
  requirePermission('admin.users.manage'),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ account: await setAccountStatus(actor(req), userId(req), req.body ?? {}) });
  }),
);

adminRouter.post(
  '/users/:userId/revoke-sessions',
  requirePermission('admin.users.manage'),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ account: await revokeSessions(actor(req), userId(req), req.body?.['reason']) });
  }),
);

adminRouter.get('/access-requests', requirePermission('admin.users.view'), (_req: Request, res: Response) => {
  res.json({ requests: listAccessRequests() });
});

adminRouter.post(
  '/access-requests',
  requirePermission('admin.access.request'),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json({ request: await requestAccessChange(actor(req), req.body ?? {}) });
  }),
);

adminRouter.post(
  '/access-requests/:requestId/decision',
  requirePermission('admin.access.approve'),
  asyncHandler(async (req: Request, res: Response) => {
    const requestId = String(req.params['requestId'] ?? '');
    if (!/^AR-[0-9A-F]{8}$/.test(requestId)) throw Errors.validation('That request id is not valid.');
    res.json({ request: await decideAccessChange(actor(req), requestId, req.body ?? {}) });
  }),
);

adminRouter.get('/identity-audit', requirePermission('admin.users.view', 'audit.overview'), (_req: Request, res: Response) => {
  res.json(identityAudit());
});

/** The permission matrix exactly as the server enforces it. */
adminRouter.get('/rbac', requirePermission('admin.rbac.view'), (_req: Request, res: Response) => {
  res.json({
    permissions: PERMISSIONS,
    roles: ROLE_IDS.map((id) => ({
      id,
      displayName: ROLE_DEFINITIONS[id].displayName,
      description: ROLE_DEFINITIONS[id].description,
      dataScope: ROLE_DEFINITIONS[id].dataScope,
      assignable: ROLE_DEFINITIONS[id].assignable,
      permissions: [...ROLE_DEFINITIONS[id].permissions].sort(),
    })),
  });
});

adminRouter.get('/system-health', requirePermission('system.health.view'), (_req: Request, res: Response) => {
  const provider = getProvider();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    environment: config.env,
    uptimeSeconds: Math.round(process.uptime()),
    storage: { driver: getRepository().driver, requestedDriver: config.storage.driver },
    engine: { provider: provider.id, model: provider.model, remote: !provider.isLocal },
    queue: getQueue().stats(),
    demoLoginEnabled: config.auth.demoLoginEnabled,
    identityChain: identityAudit().chain,
    accessDenials: denialSummary(),
  });
});
