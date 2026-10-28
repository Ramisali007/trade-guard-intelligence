import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requireAuthenticatedUser, signBankingToken } from '../middleware/auth.middleware';
import { permissionsOf, ROLE_DEFINITIONS } from '../authorization/permissions';
import { rateLimit } from '../middleware/rate-limit.middleware';
import { loginRetryAfterSeconds, recordLoginFailure, recordLoginSuccess } from '../services/login-throttle';
import { revokeToken } from '../services/token-revocation';
import {
  authenticateCredentials,
  DEMO_ACCOUNT_KEYS,
  findDemoAccount,
  listDemoAccounts,
  type AccountProfile,
} from '../services/account-directory';
import { config } from '../config';
import { AppError, Errors } from '../utils/errors';
import { asyncHandler } from '../utils/http';
import { createLogger } from '../utils/logger';

const log = createLogger('auth');

export const authRouter = Router();

// Password guessing is the obvious attack on this endpoint; ten attempts a minute per address is
// generous for a person and useless for a script.
const loginRateLimit = rateLimit({
  scope: 'auth-login',
  windowMs: 60_000,
  max: 10,
  message: 'Too many sign-in attempts. Please wait a minute and try again.',
});

// The one-click demo sign-in has no password to guess and exists only on loopback (or by explicit opt-in), but
// presenters switch between many profiles in a minute. It gets its own, looser bucket so a rehearsal cannot lock
// anyone out of the real sign-in above, and the real sign-in's limit is untouched.
const demoLoginRateLimit = rateLimit({
  scope: 'auth-demo-login',
  windowMs: 60_000,
  max: 60,
  message: 'Too many demo sign-ins. Please wait a minute and try again.',
});

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
});

const DemoLoginSchema = z.object({
  account: z.enum(DEMO_ACCOUNT_KEYS),
});

/** What the client needs to build the portal; the server enforces the same registry on every call. */
function access(role: AccountProfile['role']): { roleDisplayName: string; dataScope: string; permissions: string[] } {
  const def = ROLE_DEFINITIONS[role];
  return { roleDisplayName: def.displayName, dataScope: def.dataScope, permissions: [...permissionsOf(role)].sort() };
}

function issueSession(res: Response, profile: AccountProfile & { sessionVersion: number }): void {
  const token = signBankingToken(profile, config.auth.sessionHours);
  res.status(200).json({
    success: true,
    token,
    expiresInHours: config.auth.sessionHours,
    user: {
      ...profile,
      avatar: profile.name
        .split(/\s+/)
        .map((part) => part[0] ?? '')
        .join('')
        .substring(0, 2)
        .toUpperCase(),
      tokenType: 'BEARER',
      ...access(profile.role),
    },
  });
}

/** POST /api/auth/login — email + password against the account directory. */
authRouter.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) throw Errors.validation('A valid institutional email and password are required.');

    // The same answer for every address, real or not, so the lock cannot be used to find accounts.
    const wait = loginRetryAfterSeconds(parsed.data.email);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      throw new AppError({
        status: 429,
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many failed sign-in attempts. Please wait before trying again.',
        details: { retryAfterSeconds: wait },
        retryable: true,
      });
    }

    const profile = await authenticateCredentials(parsed.data.email, parsed.data.password);
    if (!profile) {
      recordLoginFailure(parsed.data.email);
      log.warn('failed sign-in', { email: parsed.data.email, ip: req.ip });
      throw new AppError({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
    }
    recordLoginSuccess(parsed.data.email);

    log.info('signed in', { email: profile.email, role: profile.role });
    issueSession(res, profile);
  }),
);

/** GET /api/auth/demo-accounts — which one-click demo profiles exist (empty when disabled). */
authRouter.get('/demo-accounts', (_req: Request, res: Response) => {
  res.json({
    enabled: config.auth.demoLoginEnabled,
    accounts: listDemoAccounts().map(({ demoKey, name, role, institution, email }) => ({ demoKey, name, role, institution, email })),
  });
});

/** POST /api/auth/demo-login — one-click sign-in as a demo officer; only when demo login is enabled. */
authRouter.post(
  '/demo-login',
  demoLoginRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    if (!config.auth.demoLoginEnabled) {
      throw new AppError({ status: 404, code: 'ROUTE_NOT_FOUND', message: 'That endpoint does not exist.' });
    }
    const parsed = DemoLoginSchema.safeParse(req.body);
    if (!parsed.success) throw Errors.validation('Unknown demo account.');

    const profile = findDemoAccount(parsed.data.account);
    if (!profile) throw Errors.notFound('Demo account');

    log.info('demo sign-in', { email: profile.email, role: profile.role });
    issueSession(res, profile);
  }),
);

/** POST /api/auth/logout — end this session: the token stops working everywhere, not just in this browser. */
authRouter.post(
  '/logout',
  authenticate,
  requireAuthenticatedUser,
  asyncHandler(async (req: Request, res: Response) => {
    if (req.tokenId && req.tokenExp) revokeToken(req.tokenId, req.tokenExp);
    log.info('signed out', { email: req.user?.email });
    res.status(204).send();
  }),
);

/** GET /api/auth/me — validate the current token and return its profile. */
authRouter.get(
  '/me',
  authenticate,
  requireAuthenticatedUser,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw Errors.unauthorized();
    res.status(200).json({ success: true, user: { ...req.user, ...access(req.user.role) } });
  }),
);
