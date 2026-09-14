import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { subscriptionRequired, unauthorized } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { getActiveSubscription } from '../modules/subscriptions/subscriptions.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Assinatura ativa carregada uma única vez por request. */
      subscription?: Awaited<ReturnType<typeof getActiveSubscription>>;
    }
  }
}

/**
 * RN-01 — o app é exclusivo para assinantes.
 * Toda rota de compra/aluguel passa por aqui. O 402 carrega a URL do site
 * externo para o app abrir o redirecionamento sem ter o link hardcoded.
 */
export async function requireActiveSubscriber(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.auth) return next(unauthorized());
  // Staff e admin testam o fluxo do app sem precisar assinar.
  if (req.auth.role === 'ADMIN' || req.auth.role === 'STAFF') return next();

  const subscription = await getActiveSubscription(prisma, req.auth.userId);
  if (!subscription) return next(subscriptionRequired(env.EXTERNAL_STORE_URL));

  req.subscription = subscription;
  next();
}
