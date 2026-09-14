import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { UserRole } from '@prisma/client';

export interface TokenPayload {
  sub: string;
  role: UserRole;
  /** Snapshot da assinatura no momento da emissão — revalidado no middleware. */
  sub_active: boolean;
}

export const signAccessToken = (payload: TokenPayload): string =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);

export const verifyAccessToken = (token: string): TokenPayload =>
  jwt.verify(token, env.JWT_SECRET) as TokenPayload;
