import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/http.js';
import { decimalToNumber } from '../../lib/money.js';
import { env } from '../../config/env.js';
import { effectiveRebatePercent } from '../subscriptions/subscriptions.service.js';
import { authenticate } from '../../middleware/auth.js';
import { buildComparison } from '../../domain/plans/comparison.js';
import { getBalance } from '../../domain/wallet/wallet.service.js';

/**
 * Planos e benefícios (3.2) — leitura para o app.
 * RN-06: preço, percentual e benefícios SEMPRE vêm daqui. Nada é fixo no app.
 *
 * Modelo do clube (2026-11-11): 100% da mensalidade vira crédito VKUDAKA na
 * carteira, e o desconto fidelidade do plano vale na hora da compra.
 */
export const plansRouter: Router = Router();

const activePlans = () =>
  prisma.plan.findMany({
    where: { isActive: true },
    include: { benefits: { orderBy: { displayOrder: 'asc' } } },
    orderBy: { displayOrder: 'asc' },
  });

type PlanWithBenefits = Awaited<ReturnType<typeof activePlans>>[number];

const toPublicPlan = (plan: PlanWithBenefits) => ({
  id: plan.id,
  name: plan.name,
  slug: plan.slug,
  description: plan.description,
  priceCents: plan.priceCents,
  /** Preço "de", riscado. Só vem quando é maior que o preço atual. */
  compareAtPriceCents:
    plan.compareAtPriceCents && plan.compareAtPriceCents > plan.priceCents
      ? plan.compareAtPriceCents
      : null,
  promoLabel: plan.promoLabel,
  highlightLabel: plan.highlightLabel,
  interval: plan.interval,
  intervalCount: plan.intervalCount,
  rebatePercent: decimalToNumber(plan.rebatePercent),
  rebateMode: plan.rebateMode,
  benefits: plan.benefits.map((b) => ({
    id: b.id,
    title: b.title,
    description: b.description,
    icon: b.icon,
  })),
});

/** Catálogo de planos + tabela comparativa. Público: quem não assina também vê. */
plansRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const plans = await activePlans();
    res.json({
      plans: plans.map(toPublicPlan),
      comparison: buildComparison(plans),
      storeUrl: env.EXTERNAL_STORE_URL,
    });
  }),
);

/** Situação da assinante — plano atual, renovação, créditos e upgrade. */
plansRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const [subscription, walletBalanceCents, plans] = await Promise.all([
      prisma.subscription.findFirst({
        where: {
          userId,
          status: { in: ['ACTIVE', 'TRIALING'] },
          currentPeriodEnd: { gte: new Date() },
        },
        include: { plan: { include: { benefits: { orderBy: { displayOrder: 'asc' } } } } },
        orderBy: { currentPeriodEnd: 'desc' },
      }),
      getBalance(prisma, userId),
      activePlans(),
    ]);

    if (!subscription) {
      res.json({
        hasPlan: false,
        rebatePercent: 0,
        benefits: [],
        walletBalanceCents,
        storeUrl: env.EXTERNAL_STORE_URL,
      });
      return;
    }

    // Upgrade = o próximo plano ativo mais caro que o atual (Essência → Premium).
    const upgrade = plans
      .filter((p) => p.id !== subscription.planId && p.priceCents > subscription.plan.priceCents)
      .sort((a, b) => a.priceCents - b.priceCents)[0];

    res.json({
      hasPlan: true,
      planId: subscription.planId,
      planName: subscription.plan.name,
      status: subscription.status,
      priceCents: subscription.priceCents,
      rebatePercent: effectiveRebatePercent(subscription),
      rebateMode: subscription.plan.rebateMode,
      currentPeriodEnd: subscription.currentPeriodEnd,
      /** Data da renovação = fim do período pago. */
      renewsAt: subscription.cancelAtPeriodEnd ? null : subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      benefits: subscription.plan.benefits,
      walletBalanceCents,
      upgrade: upgrade ? toPublicPlan(upgrade) : null,
      storeUrl: env.EXTERNAL_STORE_URL,
    });
  }),
);
