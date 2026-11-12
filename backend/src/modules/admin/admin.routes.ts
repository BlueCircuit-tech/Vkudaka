import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, pageResult, paginate, param } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { clubReport, dailySeries, dashboard, salesVsRentals } from './reports.service.js';
import * as wallet from '../../domain/wallet/wallet.service.js';
import { dispatch } from '../notifications/notifications.service.js';
import {
  createPlanCheckout,
  isPlanCheckoutEnabled,
  toPublicCheckout,
} from '../plans/plan-checkout.service.js';
import {
  getRebateSettings,
  grantPlanPeriod,
  quarterlyRentalStatus,
} from '../subscriptions/subscriptions.service.js';

/** API do painel CRM (3.1 a 3.7). Tudo aqui exige STAFF ou ADMIN. */
export const adminRouter: Router = Router();

adminRouter.use(authenticate, requireRole('STAFF'));

/**
 * Datas do CRM chegam como `YYYY-MM-DD`. Mantemos string de propósito:
 * `new Date('2026-09-01')` seria meia-noite **UTC**, o que no fuso de Brasília
 * cai no dia anterior e faria o relatório perder o próprio dia. `dayjs` sobre a
 * string interpreta em horário local, que é o que a diretoria espera ver.
 */
const rangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const resolveRange = (query: z.infer<typeof rangeQuery>) => ({
  from: (query.from ? dayjs(query.from) : dayjs().startOf('month')).startOf('day').toDate(),
  to: (query.to ? dayjs(query.to) : dayjs()).endOf('day').toDate(),
});

// ── 3.1 Dashboard e relatórios ───────────────────────────────────────────────

adminRouter.get(
  '/dashboard',
  validate(rangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    const range = resolveRange(req.query as z.infer<typeof rangeQuery>);
    res.json({ ...(await dashboard(range)), series: await dailySeries(range) });
  }),
);

/** Planos e créditos: assinantes por plano, MRR, créditos em aberto, upgrades. */
adminRouter.get(
  '/reports/club',
  validate(rangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await clubReport(resolveRange(req.query as z.infer<typeof rangeQuery>)));
  }),
);

adminRouter.get(
  '/reports/sales-vs-rentals',
  validate(rangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await salesVsRentals(resolveRange(req.query as z.infer<typeof rangeQuery>)));
  }),
);

// ── 3.2 Planos e níveis de desconto ──────────────────────────────────────────

/** Benefício do plano: texto do card + (opcional) linha da tabela comparativa. */
const benefitSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(300).optional(),
  compareLabel: z.string().max(60).nullable().optional(),
  compareValue: z.string().max(20).nullable().optional(),
});

const planSchema = z.object({
  name: z.string().min(2).max(60),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
  priceCents: z.number().int().min(0),
  /** Preço "de" (riscado no app). null remove. */
  compareAtPriceCents: z.number().int().min(0).nullable().optional(),
  promoLabel: z.string().max(40).nullable().optional(),
  highlightLabel: z.string().max(40).nullable().optional(),
  interval: z.enum(['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL']).default('MONTHLY'),
  intervalCount: z.number().int().min(1).max(12).default(1),
  /** RN-02 — percentual de abatimento do nível. É daqui que o app lê. */
  rebatePercent: z.number().min(0).max(100),
  rebateMode: z.enum(['CREDIT_NEXT_INVOICE', 'IMMEDIATE_DISCOUNT']).default('IMMEDIATE_DISCOUNT'),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().default(0),
  benefits: z.array(benefitSchema).max(20).default([]),
});

adminRouter.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.plan.findMany({
        include: { benefits: { orderBy: { displayOrder: 'asc' } }, _count: { select: { subscriptions: true } } },
        orderBy: { displayOrder: 'asc' },
      }),
    );
  }),
);

adminRouter.post(
  '/plans',
  requireRole('ADMIN'),
  validate(planSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof planSchema>;
    const plan = await prisma.plan.create({
      data: {
        ...body,
        rebatePercent: new Prisma.Decimal(body.rebatePercent),
        benefits: {
          create: body.benefits.map((b, index) => ({ ...b, displayOrder: index })),
        },
      },
      include: { benefits: true },
    });
    res.status(201).json(plan);
  }),
);

/**
 * Substitui a lista de benefícios do plano (3.2).
 *
 * É a lista inteira, na ordem em que deve aparecer no app — a tela do CRM
 * edita a lista como um todo e manda o resultado. Trocar tudo numa transação
 * é o que garante que ninguém vê um plano pela metade entre o apagar e o
 * criar.
 */
adminRouter.put(
  '/plans/:id/benefits',
  requireRole('ADMIN'),
  validate(
    z.object({
      benefits: z.array(benefitSchema).max(20),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { benefits } = req.body as { benefits: Array<z.infer<typeof benefitSchema>> };
    const planId = param(req, 'id');

    const plan = await prisma.$transaction(async (tx) => {
      await tx.plan.findUniqueOrThrow({ where: { id: planId } });
      await tx.planBenefit.deleteMany({ where: { planId } });
      return tx.plan.update({
        where: { id: planId },
        data: {
          benefits: {
            create: benefits.map((b, index) => ({
              title: b.title,
              description: b.description ?? null,
              compareLabel: b.compareLabel?.trim() || null,
              compareValue: b.compareValue?.trim() || null,
              displayOrder: index,
            })),
          },
        },
        include: { benefits: { orderBy: { displayOrder: 'asc' } } },
      });
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.auth!.userId,
        action: 'plan.benefits',
        entity: 'Plan',
        entityId: plan.id,
        after: { benefits: benefits.map((b) => b.title) },
        ip: req.ip,
      },
    });

    res.json(plan);
  }),
);

adminRouter.patch(
  '/plans/:id',
  requireRole('ADMIN'),
  validate(planSchema.partial().omit({ benefits: true })),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof planSchema>>;
    const before = await prisma.plan.findUniqueOrThrow({ where: { id: param(req, 'id') } });

    const plan = await prisma.plan.update({
      where: { id: param(req, 'id') },
      data: {
        ...body,
        benefits: undefined,
        ...(body.rebatePercent !== undefined
          ? { rebatePercent: new Prisma.Decimal(body.rebatePercent) }
          : {}),
      },
    });

    // Alterar percentual de abatimento é decisão financeira: fica auditado.
    await prisma.auditLog.create({
      data: {
        actorId: req.auth!.userId,
        action: 'plan.update',
        entity: 'Plan',
        entityId: plan.id,
        before: {
          rebatePercent: before.rebatePercent.toString(),
          priceCents: before.priceCents,
          compareAtPriceCents: before.compareAtPriceCents,
        },
        after: {
          rebatePercent: plan.rebatePercent.toString(),
          priceCents: plan.priceCents,
          compareAtPriceCents: plan.compareAtPriceCents,
        },
        ip: req.ip,
      },
    });

    res.json(plan);
  }),
);

// ── 3.2 Lista de acessos / usuários ──────────────────────────────────────────

adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { page, perPage, skip, take } = paginate(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    /**
     * A tela "Assinantes" mostra clientes; a equipe (admin, operação, portaria)
     * é outra lista. Sem esta separação, quem procura uma cliente esbarra nas
     * contas internas.
     */
    const audience = req.query.audience === 'TEAM' ? 'TEAM' : 'MEMBERS';

    /**
     * O termo só entra na cláusula de CPF se tiver dígito: buscar por nome
     * gerava `cpf contains ''`, que casa com QUALQUER registro — a busca
     * devolvia a lista inteira em vez de filtrar.
     */
    const digits = search?.replace(/\D/g, '') ?? '';

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      role: audience === 'TEAM' ? { in: ['ADMIN', 'STAFF', 'GATE'] } : 'MEMBER',
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              ...(digits ? [{ cpf: { contains: digits } }] : []),
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          email: true,
          cpf: true,
          phone: true,
          instagram: true,
          status: true,
          role: true,
          createdAt: true,
          lastLoginAt: true,
          wallet: { select: { balanceCents: true } },
          subscriptions: {
            where: { status: { in: ['ACTIVE', 'TRIALING'] } },
            // `rebatePercent` da assinatura vem junto para a lista mostrar o
            // percentual que vale de fato, e não o do nível.
            select: {
              status: true,
              currentPeriodEnd: true,
              rebatePercent: true,
              plan: { select: { name: true, rebatePercent: true } },
            },
            take: 1,
          },
          _count: { select: { orders: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.user.count({ where }),
    ]);

    res.json(pageResult(users, total, page, perPage));
  }),
);

adminRouter.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: param(req, 'id') },
      include: {
        measurements: true,
        addresses: true,
        wallet: { include: { transactions: { orderBy: { createdAt: 'desc' }, take: 20 } } },
        subscriptions: { include: { plan: true, invoices: { orderBy: { referenceMonth: 'desc' }, take: 12 } } },
        credits: { orderBy: { createdAt: 'desc' }, take: 20 },
        orders: { orderBy: { createdAt: 'desc' }, take: 20, include: { items: true } },
      },
    });

    // Resumo do clube para o CRM: plano, % de desconto que vale, locações do
    // trimestre (limite 1) e do ano (limite 4, um por trimestre).
    const year = new Date().getFullYear();
    const [settings, quarterly, rentalsThisYear] = await Promise.all([
      getRebateSettings(prisma, user.id),
      quarterlyRentalStatus(prisma, user.id),
      prisma.order.count({
        where: {
          userId: user.id,
          quarterlyRentalPeriod: { startsWith: `${year}-Q` },
          status: { notIn: ['CANCELED', 'REFUNDED'] },
        },
      }),
    ]);

    res.json({
      ...user,
      passwordHash: undefined,
      club: {
        planName: settings.subscription?.plan.name ?? null,
        subscriptionStatus: settings.subscription?.status ?? null,
        renewsAt: settings.subscription?.currentPeriodEnd ?? null,
        rebatePercent: settings.rebatePercent,
        rebateMode: settings.rebateMode,
        quarterlyRental: quarterly,
        rentalsThisYear,
        rentalsYearLimit: 4,
      },
    });
  }),
);

adminRouter.patch(
  '/users/:id/status',
  requireRole('ADMIN'),
  validate(z.object({ status: z.enum(['ACTIVE', 'BLOCKED']) })),
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.user.update({
        where: { id: param(req, 'id') },
        data: { status: req.body.status as 'ACTIVE' | 'BLOCKED' },
        select: { id: true, status: true },
      }),
    );
  }),
);

/** Ajuste manual de carteira — sempre auditado e com motivo obrigatório. */
adminRouter.post(
  '/users/:id/wallet/adjust',
  requireRole('ADMIN'),
  validate(
    z.object({
      amountCents: z.number().int().min(1),
      direction: z.enum(['CREDIT', 'DEBIT']),
      reason: z.string().min(5).max(160),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      amountCents: number;
      direction: 'CREDIT' | 'DEBIT';
      reason: string;
    };

    const result = await prisma.$transaction((tx) =>
      wallet.move(tx, {
        userId: param(req, 'id'),
        type: body.direction === 'CREDIT' ? 'ADJUSTMENT_CREDIT' : 'ADJUSTMENT_DEBIT',
        amountCents: body.amountCents,
        description: body.reason,
        createdById: req.auth!.userId,
      }),
    );

    await prisma.auditLog.create({
      data: {
        actorId: req.auth!.userId,
        action: 'wallet.adjust',
        entity: 'Wallet',
        entityId: param(req, 'id'),
        after: { ...body, balanceAfter: result.balanceAfter },
        ip: req.ip,
      },
    });

    res.json(result);
  }),
);

// ── 3.6 Cupons e regras de frete ─────────────────────────────────────────────

adminRouter.get(
  '/coupons',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } }));
  }),
);

adminRouter.post(
  '/coupons',
  validate(
    z.object({
      code: z.string().min(3).max(30).toUpperCase(),
      description: z.string().max(160).optional(),
      type: z.enum(['PERCENT', 'FIXED', 'FREE_SHIPPING']),
      value: z.number().min(0).default(0),
      minSubtotalCents: z.number().int().min(0).default(0),
      minItems: z.number().int().min(0).default(0),
      maxRedemptions: z.number().int().min(1).optional(),
      perUserLimit: z.number().int().min(1).default(1),
      startsAt: z.coerce.date().optional(),
      endsAt: z.coerce.date().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown> & { value: number };
    res.status(201).json(
      await prisma.coupon.create({
        data: { ...body, value: new Prisma.Decimal(body.value) } as Prisma.CouponCreateInput,
      }),
    );
  }),
);

adminRouter.get(
  '/shipping-rules',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.shippingRule.findMany({ orderBy: { priority: 'desc' } }));
  }),
);

adminRouter.post(
  '/shipping-rules',
  validate(
    z.object({
      name: z.string().min(3).max(80),
      minSubtotalCents: z.number().int().min(0).default(0),
      minItems: z.number().int().min(0).default(0),
      states: z.array(z.string().length(2).toUpperCase()).default([]),
      service: z.enum(['PAC', 'SEDEX']).optional(),
      priority: z.number().int().default(0),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      await prisma.shippingRule.create({ data: req.body as Prisma.ShippingRuleCreateInput }),
    );
  }),
);

// ── 3.7 Push notifications ───────────────────────────────────────────────────

adminRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const { page, perPage, skip, take } = paginate(req.query);
    const [campaigns, total] = await Promise.all([
      prisma.notificationCampaign.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { targetPlan: { select: { name: true } } },
      }),
      prisma.notificationCampaign.count(),
    ]);
    res.json(pageResult(campaigns, total, page, perPage));
  }),
);

adminRouter.post(
  '/notifications',
  validate(
    z.object({
      title: z.string().min(3).max(120),
      body: z.string().min(3).max(400),
      deepLink: z.string().max(200).optional(),
      imageUrl: z.string().url().optional(),
      targetPlanId: z.string().uuid().optional(),
      targetActiveOnly: z.boolean().default(true),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      title: string;
      body: string;
      deepLink?: string;
      imageUrl?: string;
      targetPlanId?: string;
      targetActiveOnly: boolean;
    };
    res.status(201).json(await dispatch('MANUAL', { ...body, createdById: req.auth!.userId }));
  }),
);

// ── 2.3 Textos do app (popup de regras de compra) ────────────────────────────

adminRouter.put(
  '/content/:key',
  requireRole('ADMIN'),
  validate(z.object({ title: z.string().max(160).optional(), body: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const body = req.body as { title?: string; body: string };
    const existing = await prisma.appContent.findUnique({ where: { key: param(req, 'key') } });

    const content = await prisma.appContent.upsert({
      where: { key: param(req, 'key') },
      create: { key: param(req, 'key'), ...body, updatedById: req.auth!.userId },
      update: { ...body, version: (existing?.version ?? 0) + 1, updatedById: req.auth!.userId },
    });

    res.json(content);
  }),
);

// ── Pedidos (operação) ───────────────────────────────────────────────────────

adminRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const { page, perPage, skip, take } = paginate(req.query);
    const where: Prisma.OrderWhereInput = {
      ...(req.query.status ? { status: req.query.status as never } : {}),
      ...(req.query.type ? { type: req.query.type as never } : {}),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: true,
          user: { select: { fullName: true, email: true, phone: true } },
          shipment: true,
          payments: { select: { status: true, method: true, amountCents: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.order.count({ where }),
    ]);

    res.json(pageResult(orders, total, page, perPage));
  }),
);

adminRouter.patch(
  '/orders/:id/status',
  validate(
    z.object({
      status: z.enum([
        'PROCESSING',
        'SHIPPED',
        'DELIVERED',
        'RETURN_PENDING',
        'RETURNED',
        'CANCELED',
      ]),
      trackingCode: z.string().max(40).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { status: never; trackingCode?: string };

    const order = await prisma.order.update({
      where: { id: param(req, 'id') },
      data: {
        status: body.status,
        ...(body.status === 'RETURNED' ? { returnedAt: new Date() } : {}),
      },
    });

    if (body.trackingCode) {
      await prisma.shipment.updateMany({
        where: { orderId: order.id },
        data: { trackingCode: body.trackingCode, shippedAt: new Date() },
      });
    }

    res.json(order);
  }),
);

// ── 3.2 Assinatura do usuário ────────────────────────────────────────────────

/**
 * Ativa (ou renova) a assinatura de um usuário pelo CRM.
 *
 * Sem isto o clube não tem como admitir ninguém fora do seed: a assinatura é
 * contratada no site, mas a diretoria precisa poder conceder, migrar de plano e
 * corrigir manualmente. O preço é travado no ato (RN-06).
 *
 * `rebatePercent` é o abatimento negociado com a assinante — 10, 15 ou o que
 * for combinado. Omitir mantém o percentual do plano; enviar `null` desfaz uma
 * condição especial e devolve a pessoa ao percentual do nível. O valor fica
 * travado no contrato junto com o preço: reajustar o plano depois não muda o
 * que foi acordado com quem já entrou.
 */
adminRouter.post(
  '/users/:id/subscription',
  requireRole('ADMIN'),
  validate(
    z.object({
      planId: z.string().uuid(),
      months: z.number().int().min(1).max(24).default(1),
      rebatePercent: z.number().min(0).max(100).nullable().optional(),
      /**
       * Créditos VKUDAKA lançados na carteira por este pagamento. Omitido =
       * 100% do valor (preço do contrato × meses); 0 = cortesia, sem crédito.
       */
      creditCents: z.number().int().min(0).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      planId: string;
      months: number;
      rebatePercent?: number | null;
      creditCents?: number;
    };
    const userId = param(req, 'id');

    // Omitido = "não mexe"; null = "volta para o do plano"; número = negociado.
    const negotiated =
      body.rebatePercent === undefined
        ? undefined
        : body.rebatePercent === null
          ? null
          : new Prisma.Decimal(body.rebatePercent);

    /**
     * 100% da mensalidade vira crédito VKUDAKA (regra de 2026-11-11): o valor
     * pago entra na carteira para comprar peças. Usa o preço travado no contrato.
     */
    const creditSubscription = async (
      tx: Prisma.TransactionClient,
      subscription: { priceCents: number; plan: { name: string } },
    ) => {
      const amountCents = body.creditCents ?? subscription.priceCents * body.months;
      if (amountCents <= 0) return 0;
      await wallet.credit(tx, {
        userId,
        type: 'SUBSCRIPTION',
        amountCents,
        description: `Assinatura ${subscription.plan.name} — ${body.months} ${
          body.months > 1 ? 'meses' : 'mês'
        } em créditos`,
        createdById: req.auth!.userId,
      });
      return amountCents;
    };

    const { result, creditedCents } = await prisma.$transaction(async (tx) => {
      const { subscription } = await grantPlanPeriod(tx, {
        userId,
        planId: body.planId,
        months: body.months,
        rebatePercent: negotiated,
      });
      return { result: subscription, creditedCents: await creditSubscription(tx, subscription) };
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.auth!.userId,
        action: 'subscription.grant',
        entity: 'Subscription',
        entityId: result.id,
        after: {
          planId: body.planId,
          months: body.months,
          userId,
          rebatePercent: result.rebatePercent?.toString() ?? null,
          planRebatePercent: result.plan.rebatePercent.toString(),
          creditedCents,
        },
        ip: req.ip,
      },
    });

    res.status(201).json({ ...result, creditedCents });
  }),
);

/**
 * Link de pagamento do plano (Mercado Pago) gerado pela equipe — para mandar
 * por WhatsApp. Quando o cliente paga, o webhook ativa a assinatura e lança
 * os créditos sozinho; ninguém precisa voltar aqui para "dar baixa".
 */
adminRouter.post(
  '/users/:id/plan-checkout',
  validate(z.object({ planId: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    const checkout = await createPlanCheckout({
      userId: param(req, 'id'),
      planId: (req.body as { planId: string }).planId,
      source: 'CRM',
      createdById: req.auth!.userId,
    });
    await prisma.auditLog.create({
      data: {
        actorId: req.auth!.userId,
        action: 'plan_checkout.create',
        entity: 'PlanCheckout',
        entityId: checkout.id,
        after: { userId: checkout.userId, planId: checkout.planId, amountCents: checkout.amountCents },
        ip: req.ip,
      },
    });
    res.status(201).json(toPublicCheckout(checkout));
  }),
);

/** Últimos links de pagamento de plano da pessoa, com a situação de cada um. */
adminRouter.get(
  '/users/:id/plan-checkouts',
  asyncHandler(async (req, res) => {
    const checkouts = await prisma.planCheckout.findMany({
      where: { userId: param(req, 'id') },
      include: { plan: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    res.json({
      enabled: await isPlanCheckoutEnabled(),
      data: checkouts.map(toPublicCheckout),
    });
  }),
);

/**
 * Altera só o abatimento negociado do contrato vigente.
 *
 * Existe separado da concessão porque conceder/renovar empurra o fim do
 * período: quem quisesse apenas corrigir o percentual de uma assinante ativa
 * acabaria dando um mês de brinde sem perceber.
 */
adminRouter.patch(
  '/users/:id/subscription/rebate',
  requireRole('ADMIN'),
  validate(z.object({ rebatePercent: z.number().min(0).max(100).nullable() })),
  asyncHandler(async (req, res) => {
    const { rebatePercent } = req.body as { rebatePercent: number | null };
    const userId = param(req, 'id');

    const current = await prisma.subscription.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'TRIALING'] } },
      orderBy: { currentPeriodEnd: 'desc' },
    });
    if (!current) throw notFound('Assinatura ativa');

    const updated = await prisma.subscription.update({
      where: { id: current.id },
      data: { rebatePercent: rebatePercent === null ? null : new Prisma.Decimal(rebatePercent) },
      include: { plan: true },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.auth!.userId,
        action: 'subscription.rebate',
        entity: 'Subscription',
        entityId: updated.id,
        before: { rebatePercent: current.rebatePercent?.toString() ?? null },
        after: {
          rebatePercent: updated.rebatePercent?.toString() ?? null,
          planRebatePercent: updated.plan.rebatePercent.toString(),
        },
        ip: req.ip,
      },
    });

    res.json(updated);
  }),
);

adminRouter.delete(
  '/users/:id/subscription',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const userId = param(req, 'id');
    const current = await prisma.subscription.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'TRIALING'] } },
      orderBy: { currentPeriodEnd: 'desc' },
    });
    if (!current) throw notFound('Assinatura ativa');

    const canceled = await prisma.subscription.update({
      where: { id: current.id },
      data: { status: 'CANCELED', canceledAt: new Date(), cancelAtPeriodEnd: true },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.auth!.userId,
        action: 'subscription.cancel',
        entity: 'Subscription',
        entityId: canceled.id,
        before: { status: current.status },
        after: { status: 'CANCELED' },
        ip: req.ip,
      },
    });

    res.json(canceled);
  }),
);

// ── Ativar/desativar cupons e regras de frete ────────────────────────────────

adminRouter.patch(
  '/coupons/:id',
  validate(z.object({ isActive: z.boolean() })),
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.coupon.update({
        where: { id: param(req, 'id') },
        data: { isActive: req.body.isActive as boolean },
      }),
    );
  }),
);

adminRouter.patch(
  '/shipping-rules/:id',
  validate(z.object({ isActive: z.boolean() })),
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.shippingRule.update({
        where: { id: param(req, 'id') },
        data: { isActive: req.body.isActive as boolean },
      }),
    );
  }),
);
