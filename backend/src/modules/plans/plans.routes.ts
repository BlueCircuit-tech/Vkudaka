import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/http.js';
import { decimalToNumber } from '../../lib/money.js';
import { effectiveRebatePercent } from '../subscriptions/subscriptions.service.js';
import { authenticate } from '../../middleware/auth.js';

/**
 * Planos (3.2) — leitura pública para o app.
 * RN-06: o percentual de abatimento SEMPRE vem daqui. Nenhum valor de desconto
 * é constante no app ou no CRM.
 */
export const plansRouter: Router = Router();

plansRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      include: { benefits: { orderBy: { displayOrder: 'asc' } } },
      orderBy: { displayOrder: 'asc' },
    });

    res.json(
      plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        description: plan.description,
        priceCents: plan.priceCents,
        interval: plan.interval,
        intervalCount: plan.intervalCount,
        rebatePercent: decimalToNumber(plan.rebatePercent),
        rebateMode: plan.rebateMode,
        benefits: plan.benefits,
      })),
    );
  }),
);

/** Benefícios vigentes do usuário — usado pelo app para montar a tela do plano. */
plansRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: req.auth!.userId,
        status: { in: ['ACTIVE', 'TRIALING'] },
        currentPeriodEnd: { gte: new Date() },
      },
      include: { plan: { include: { benefits: { orderBy: { displayOrder: 'asc' } } } } },
    });

    if (!subscription) {
      res.json({ hasPlan: false, rebatePercent: 0, benefits: [] });
      return;
    }

    res.json({
      hasPlan: true,
      planName: subscription.plan.name,
      priceCents: subscription.priceCents,
      rebatePercent: effectiveRebatePercent(subscription),
      rebateMode: subscription.plan.rebateMode,
      currentPeriodEnd: subscription.currentPeriodEnd,
      benefits: subscription.plan.benefits,
    });
  }),
);
