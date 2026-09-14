import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@prisma/client';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string; role: UserRole };
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  try {
    const payload = verifyAccessToken(header.slice(7));
    req.auth = { userId: payload.sub, role: payload.role };
    next();
  } catch {
    next(unauthorized('Sessão expirada. Entre novamente.'));
  }
}

/** Hierarquia: ADMIN cobre STAFF, STAFF cobre GATE. MEMBER é isolado. */
const RANK: Record<UserRole, number> = { MEMBER: 0, GATE: 1, STAFF: 2, ADMIN: 3 };

export const requireRole =
  (minimum: UserRole) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(unauthorized());
    if (req.auth.role === 'MEMBER' && minimum !== 'MEMBER') return next(forbidden());
    if (RANK[req.auth.role] < RANK[minimum]) return next(forbidden());
    next();
  };
