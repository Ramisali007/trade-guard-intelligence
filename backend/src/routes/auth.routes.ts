import { Router, Request, Response } from 'express';
import { authenticate, signBankingToken, normalizeRole, type BankingRole } from '../middleware/auth.middleware';
import { AppError } from '../utils/errors';
import { asyncHandler } from '../utils/http';

export const authRouter = Router();

const DEMO_ACCOUNTS: Record<string, { name: string; role: BankingRole; institution: string }> = {
  'ramis.ali@tradeguard.ai': {
    name: 'Ramis Ali',
    role: 'CHIEF_COMPLIANCE_OFFICER',
    institution: 'Habib Bank Limited · International Trade Ops',
  },
  'sara.khan@tradeguard.ai': {
    name: 'Sara Khan',
    role: 'TBML_RISK_ANALYST',
    institution: 'Standard Chartered Bank · Middle East & Asia',
  },
  'tariq.mehmood@tradeguard.ai': {
    name: 'Tariq Mehmood',
    role: 'TRADE_AUDITOR',
    institution: 'State Bank of Pakistan · BPRD Division',
  },
};

/**
 * POST /api/auth/login
 * Issue signed bank-grade token for user
 */
authRouter.post(
  '/login',
  asyncHandler(async (req: Request, res: Response) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const roleReq = String(req.body.role || '');

    if (!email || !email.includes('@')) {
      throw new AppError({ status: 400, code: 'BAD_REQUEST', message: 'Valid institutional email is required.' });
    }

    const demo = DEMO_ACCOUNTS[email];
    const role: BankingRole = demo ? demo.role : normalizeRole(roleReq);
    const emailPrefix = email.split('@')[0] || 'Officer';
    const name: string = demo ? demo.name : emailPrefix.replace('.', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const institution: string = demo ? demo.institution : 'State Bank of Pakistan Authorized Trade Desk';
    const userId = `usr-${Buffer.from(email).toString('hex').substring(0, 8)}`;

    const token = signBankingToken({
      id: userId,
      name,
      email,
      role,
      institution,
    }, 24);

    res.status(200).json({
      success: true,
      token,
      user: {
        id: userId,
        name,
        email,
        role,
        institution,
        avatar: name.split(' ').map((p) => p[0]).join('').substring(0, 2).toUpperCase(),
        tokenType: 'BEARER',
      },
    });
  }),
);

/**
 * GET /api/auth/me
 * Validate current token and return profile
 */
authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      user: req.user,
    });
  }),
);
