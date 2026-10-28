import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { config } from '../config';
import {
  hasAnyPermission,
  normalizeRole as normalizeRoleStrict,
  type Permission,
  type RoleId,
} from '../authorization/permissions';
import { recordDenial } from '../authorization/security-events';
import { getAccount } from '../services/account-directory';
import { isTokenRevoked } from '../services/token-revocation';

const log = createLogger('auth-middleware');

export type BankingRole = RoleId;

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: BankingRole;
  institution: string;
  /** CORPORATE_CUSTOMER: the customer whose cases this login may see. */
  customerRef?: string;
  /** RELATIONSHIP_MANAGER: customers assigned to this RM. */
  assignedCustomerRefs?: string[];
  tokenType: 'BEARER' | 'API_KEY' | 'SESSION';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      /** The signed token's id and expiry (seconds), so a sign-out can revoke exactly this token. */
      tokenId?: string;
      tokenExp?: number;
    }
  }
}

/**
 * HMAC signing key. Production refuses to boot without AUTH_SECRET (see `ensureRuntimeDirectories`).
 * Outside production a random key is generated once and kept in the git-ignored data directory, so a
 * dev-server restart does not sign everybody out.
 */
const JWT_SECRET: string = config.auth.secret || loadOrCreateDevSecret();

function loadOrCreateDevSecret(): string {
  const secretPath = path.join(config.upload.dataDir, '.auth-secret');
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // Not created yet.
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  } catch {
    log.warn('could not persist the development signing key; sessions will reset on restart');
  }
  return generated;
}

/** Signed claims. The role is informational: every request re-reads it from the account directory. */
export interface TokenClaims extends Omit<AuthenticatedUser, 'tokenType'> {
  /** The account's session version when the token was issued; a later version invalidates it. */
  sessionVersion?: number;
}

export function signBankingToken(payload: TokenClaims, expiresInHours = 24): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...payload, jti: crypto.randomUUID(), iat: now, exp: now + expiresInHours * 3600 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

/** Signature and expiry only. Whether the session is still good is `authenticate`'s question. */
export function verifyBankingToken(token: string): (AuthenticatedUser & { sessionVersion?: number; jti?: string; exp: number }) | null {
  try {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature || token.split('.').length !== 3) return null;
    const expected = Buffer.from(crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url'));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      log.warn('expired token presented', { exp: payload.exp });
      return null;
    }
    const role = normalizeRoleStrict(payload.role);
    if (!role || typeof payload.id !== 'string') return null;
    return {
      id: payload.id,
      name: String(payload.name ?? ''),
      email: String(payload.email ?? ''),
      role,
      institution: String(payload.institution ?? ''),
      ...(typeof payload.customerRef === 'string' && payload.customerRef ? { customerRef: payload.customerRef } : {}),
      ...(typeof payload.sessionVersion === 'number' ? { sessionVersion: payload.sessionVersion } : {}),
      ...(typeof payload.jti === 'string' ? { jti: payload.jti } : {}),
      exp: payload.exp as number,
      tokenType: 'BEARER',
    };
  } catch {
    return null;
  }
}

/**
 * A configured role string to a role. Canonical id or exact display name only; anything else is not
 * a role. Kept here for callers that import it from the middleware.
 */
export function normalizeRole(rawRole?: string): BankingRole | null {
  return normalizeRoleStrict(rawRole);
}

function routePattern(req: Request): string {
  return `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`;
}

function unauthorized(req: Request, kind: 'UNAUTHENTICATED' | 'SESSION_REVOKED', message: string, code = 'UNAUTHORIZED'): AppError {
  recordDenial({ kind, role: null, permission: null, route: routePattern(req) });
  return new AppError({ status: 401, code, message });
}

/**
 * Authenticate a request: a signed Bearer token, or the integration API key.
 *
 * The token proves who signed in. What they may do comes from the account directory *now*: the
 * account must still exist and be active, its session version must match the token's, and its role
 * must be the one the token was issued for. Disabling an account, revoking its sessions or changing
 * its role therefore ends every outstanding token immediately. Client-supplied `X-User-*` headers
 * are never read.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'] || req.headers['x-tradeguard-key'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';

  if (token) {
    const claims = verifyBankingToken(token);
    if (!claims) throw unauthorized(req, 'UNAUTHENTICATED', 'Invalid, forged, or expired banking authorization token.');
    if (isTokenRevoked(claims.jti)) throw unauthorized(req, 'SESSION_REVOKED', 'You have signed out. Please sign in again.', 'SESSION_REVOKED');
    const account = getAccount(claims.id);
    if (!account || account.status !== 'ACTIVE' || !account.role) {
      throw unauthorized(req, 'SESSION_REVOKED', 'This account is no longer active. Please contact your administrator.', 'SESSION_REVOKED');
    }
    if (claims.sessionVersion !== account.sessionVersion || claims.role !== account.role) {
      throw unauthorized(req, 'SESSION_REVOKED', 'Your access has changed or your session was ended. Please sign in again.', 'SESSION_REVOKED');
    }
    req.user = {
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role,
      institution: account.institution,
      ...(account.customerRef ? { customerRef: account.customerRef } : {}),
      ...(account.assignedCustomerRefs.length ? { assignedCustomerRefs: [...account.assignedCustomerRefs] } : {}),
      tokenType: 'BEARER',
    };
    if (claims.jti) req.tokenId = claims.jti;
    req.tokenExp = claims.exp;
    return next();
  }

  // The machine integration key: a dedicated, narrow principal — never a compliance officer.
  if (apiKeyHeader) {
    const configuredApiKey = config.auth.apiKey;
    if (configuredApiKey && typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
      const headerBuf = Buffer.from(apiKeyHeader);
      const secretBuf = Buffer.from(configuredApiKey);
      if (headerBuf.length === secretBuf.length && crypto.timingSafeEqual(headerBuf, secretBuf)) {
        req.user = {
          id: 'sys-api-client',
          name: 'Integration Gateway',
          email: 'gateway@corebank.internal',
          role: 'INTEGRATION_GATEWAY',
          institution: 'Core Banking API Integration',
          tokenType: 'API_KEY',
        };
        return next();
      }
    }
  }

  throw unauthorized(req, 'UNAUTHENTICATED', 'Authentication required. Please provide a valid banking authorization token.');
}

/** Middleware that requires at least one of `permissions`. Tagged, so a test can prove every route has one. */
export type PermissionGuard = ((req: Request, res: Response, next: NextFunction) => void) & { requiredPermissions: readonly Permission[] };

export function requirePermission(...permissions: Permission[]): PermissionGuard {
  const guard = ((req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw unauthorized(req, 'UNAUTHENTICATED', 'Authentication required before accessing this banking resource.');
    if (!hasAnyPermission(req.user, permissions)) {
      recordDenial({ kind: 'FORBIDDEN', role: req.user.role, permission: permissions.join('|'), route: routePattern(req) });
      log.warn('forbidden', { role: req.user.role, required: permissions, route: routePattern(req) });
      throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'You do not have permission for this action.' });
    }
    next();
  }) as PermissionGuard;
  guard.requiredPermissions = permissions;
  return guard;
}

/** Marks a route that any signed-in user may call (their own profile, their own workspace). */
export const requireAuthenticatedUser: PermissionGuard = Object.assign(
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw unauthorized(req, 'UNAUTHENTICATED', 'Authentication required.');
    next();
  },
  { requiredPermissions: [] as readonly Permission[] },
);

/**
 * Role-list guard, kept for callers that predate the permission registry. New code uses
 * `requirePermission`; no route uses this any more.
 */
export function requireRole(allowedRoles: BankingRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new AppError({ status: 401, code: 'UNAUTHORIZED', message: 'Authentication required before accessing this banking resource.' });
    if (!allowedRoles.includes(req.user.role)) {
      recordDenial({ kind: 'FORBIDDEN', role: req.user.role, permission: null, route: routePattern(req) });
      throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'You do not have permission for this action.' });
    }
    next();
  };
}
