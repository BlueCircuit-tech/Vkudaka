import dayjs from 'dayjs';
import { prisma } from '../../lib/prisma.js';

/**
 * Dashboard e relatórios do CRM (3.1).
 *
 * Definições usadas (fixadas aqui para que CRM, planilha e diretoria falem a
 * mesma língua):
 *  • Receita bruta  = soma de Order.totalCents dos pedidos PAGOS no período.
 *  • Receita líquida de gateway = totalCents − walletAppliedCents (o que entrou
 *    de fato pelo gateway; o saldo da carteira já foi recebido na recarga).
 *  • Receita de assinaturas = faturas PAGAS no período (netCents).
 *  • Passivo de crédito = créditos de abatimento ainda não usados. Não é
 *    despesa do período, mas é desconto contratado da receita futura — a
 *    diretoria precisa vê-lo ao lado do lucro.
 */

const PAID_STATUSES = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'RETURNED'] as const;

export interface DashboardRange {
  from: Date;
  to: Date;
}

export async function dashboard(range: DashboardRange) {
  const paidWhere = {
    status: { in: [...PAID_STATUSES] },
    paidAt: { gte: range.from, lte: range.to },
  };

  const [orders, subscriptionInvoices, activeSubscribers, walletTopUps, pendingCredits] =
    await Promise.all([
      prisma.order.aggregate({
        where: paidWhere,
        _sum: {
          totalCents: true,
          walletAppliedCents: true,
          shippingCents: true,
          rebateCreditCents: true,
        },
        _count: true,
      }),
      prisma.subscriptionInvoice.aggregate({
        where: { status: 'PAID', paidAt: { gte: range.from, lte: range.to } },
        _sum: { netCents: true, grossCents: true, creditCents: true },
        _count: true,
      }),
      prisma.subscription.count({
        where: { status: { in: ['ACTIVE', 'TRIALING'] }, currentPeriodEnd: { gte: new Date() } },
      }),
      prisma.walletTransaction.aggregate({
        where: { type: 'TOPUP', createdAt: { gte: range.from, lte: range.to } },
        _sum: { amountCents: true },
      }),
      prisma.subscriptionCredit.aggregate({
        where: { status: { in: ['AVAILABLE', 'PARTIALLY_APPLIED'] } },
        _sum: { amountCents: true, usedCents: true },
      }),
    ]);

  const grossSalesCents = orders._sum.totalCents ?? 0;
  const walletUsedCents = orders._sum.walletAppliedCents ?? 0;
  const subscriptionRevenueCents = subscriptionInvoices._sum.netCents ?? 0;

  const outstandingCredit =
    (pendingCredits._sum.amountCents ?? 0) - (pendingCredits._sum.usedCents ?? 0);

  return {
    period: range,
    sales: {
      orderCount: orders._count,
      grossCents: grossSalesCents,
      gatewayCents: grossSalesCents - walletUsedCents,
      walletCents: walletUsedCents,
      shippingCents: orders._sum.shippingCents ?? 0,
    },
    subscriptions: {
      activeSubscribers,
      invoiceCount: subscriptionInvoices._count,
      grossCents: subscriptionInvoices._sum.grossCents ?? 0,
      /** Quanto de mensalidade foi abatido por crédito de compra (RN-02). */
      creditAppliedCents: subscriptionInvoices._sum.creditCents ?? 0,
      netCents: subscriptionRevenueCents,
    },
    wallet: { topUpCents: walletTopUps._sum.amountCents ?? 0 },
    rebate: {
      /** Crédito gerado no período. */
      generatedCents: orders._sum.rebateCreditCents ?? 0,
      /** Saldo de crédito não utilizado — desconto já contratado do futuro. */
      outstandingCents: outstandingCredit,
    },
    totalRevenueCents: grossSalesCents + subscriptionRevenueCents,
  };
}

/** Aba divisória do relatório: itens ALUGADOS vs. itens VENDIDOS (3.1). */
export async function salesVsRentals(range: DashboardRange) {
  const rows = await prisma.orderItem.findMany({
    where: {
      order: { status: { in: [...PAID_STATUSES] }, paidAt: { gte: range.from, lte: range.to } },
      kind: { in: ['SALE', 'RENTAL'] },
    },
    select: {
      kind: true,
      quantity: true,
      totalCents: true,
      nameSnapshot: true,
      productId: true,
      sizeSnapshot: true,
    },
  });

  const summarize = (kind: 'SALE' | 'RENTAL') => {
    const items = rows.filter((r) => r.kind === kind);
    const byProduct = new Map<string, { name: string; quantity: number; revenueCents: number }>();

    for (const item of items) {
      const key = item.productId ?? item.nameSnapshot;
      const current = byProduct.get(key) ?? {
        name: item.nameSnapshot,
        quantity: 0,
        revenueCents: 0,
      };
      current.quantity += item.quantity;
      current.revenueCents += item.totalCents;
      byProduct.set(key, current);
    }

    return {
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      revenueCents: items.reduce((sum, i) => sum + i.totalCents, 0),
      topProducts: [...byProduct.values()]
        .sort((a, b) => b.revenueCents - a.revenueCents)
        .slice(0, 10),
    };
  };

  return { period: range, sold: summarize('SALE'), rented: summarize('RENTAL') };
}

/** Série diária para o gráfico do dashboard. */
export async function dailySeries(range: DashboardRange) {
  const orders = await prisma.order.findMany({
    where: { status: { in: [...PAID_STATUSES] }, paidAt: { gte: range.from, lte: range.to } },
    select: { paidAt: true, totalCents: true, type: true },
  });

  const buckets = new Map<string, { saleCents: number; rentalCents: number; ticketCents: number }>();
  for (
    let cursor = dayjs(range.from);
    cursor.isBefore(range.to) || cursor.isSame(range.to, 'day');
    cursor = cursor.add(1, 'day')
  ) {
    buckets.set(cursor.format('YYYY-MM-DD'), { saleCents: 0, rentalCents: 0, ticketCents: 0 });
  }

  for (const order of orders) {
    if (!order.paidAt) continue;
    const key = dayjs(order.paidAt).format('YYYY-MM-DD');
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (order.type === 'RENTAL') bucket.rentalCents += order.totalCents;
    else if (order.type === 'TICKET') bucket.ticketCents += order.totalCents;
    else bucket.saleCents += order.totalCents;
  }

  return [...buckets.entries()].map(([date, values]) => ({ date, ...values }));
}

const MONTHS_BY_INTERVAL = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 } as const;

/**
 * Relatório do clube (planos e créditos — 2026-11-11).
 *
 *  • Assinantes por plano e MRR: assinaturas ativas agora; o preço travado no
 *    contrato é normalizado para 1 mês (trimestral ÷ 3 etc.).
 *  • Créditos em aberto (passivo): soma dos saldos de carteira — com 100% da
 *    mensalidade virando crédito, é dinheiro recebido que ainda vai virar peça.
 *  • Créditos gerados/usados no período: lançamentos de assinatura (+) e
 *    compras pagas com saldo (−).
 *  • Taxa de upgrade: trocas para um plano mais caro no período ÷ (essas trocas
 *    + assinantes ativos que ainda têm um plano acima para onde subir).
 */
export async function clubReport(range: DashboardRange) {
  const now = new Date();
  const [active, plans, walletTotals, generated, used, newInPeriod] = await Promise.all([
    prisma.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'TRIALING'] }, currentPeriodEnd: { gte: now } },
      select: { userId: true, planId: true, priceCents: true },
    }),
    prisma.plan.findMany({
      select: {
        id: true,
        name: true,
        priceCents: true,
        interval: true,
        intervalCount: true,
        isActive: true,
        displayOrder: true,
      },
      orderBy: { displayOrder: 'asc' },
    }),
    prisma.wallet.aggregate({ _sum: { balanceCents: true }, _count: true }),
    prisma.walletTransaction.aggregate({
      where: { type: 'SUBSCRIPTION', createdAt: { gte: range.from, lte: range.to } },
      _sum: { amountCents: true },
    }),
    prisma.walletTransaction.aggregate({
      where: { type: 'PURCHASE', createdAt: { gte: range.from, lte: range.to } },
      _sum: { amountCents: true },
    }),
    prisma.subscription.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
      select: { id: true, userId: true, createdAt: true, plan: { select: { priceCents: true } } },
    }),
  ]);

  const planById = new Map(plans.map((p) => [p.id, p]));
  const monthly = (planId: string, priceCents: number) => {
    const plan = planById.get(planId);
    const months = plan ? MONTHS_BY_INTERVAL[plan.interval] * plan.intervalCount : 1;
    return Math.round(priceCents / months);
  };

  const byPlan = plans
    .map((plan) => {
      const subs = active.filter((s) => s.planId === plan.id);
      return {
        planId: plan.id,
        planName: plan.name,
        isActive: plan.isActive,
        subscribers: subs.length,
        mrrCents: subs.reduce((sum, s) => sum + monthly(s.planId, s.priceCents), 0),
      };
    })
    .filter((row) => row.isActive || row.subscribers > 0);

  // Upgrades: assinatura nova cuja anterior (mesma cliente) era de plano mais barato.
  const userIds = [...new Set(newInPeriod.map((s) => s.userId))];
  const history = userIds.length
    ? await prisma.subscription.findMany({
        where: { userId: { in: userIds } },
        select: { id: true, userId: true, createdAt: true, plan: { select: { priceCents: true } } },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const upgrades = newInPeriod.filter((sub) => {
    const previous = history
      .filter((h) => h.userId === sub.userId && h.createdAt < sub.createdAt && h.id !== sub.id)
      .at(-1);
    return previous ? sub.plan.priceCents > previous.plan.priceCents : false;
  }).length;

  const topActivePrice = Math.max(0, ...plans.filter((p) => p.isActive).map((p) => p.priceCents));
  const canUpgrade = active.filter(
    (s) => (planById.get(s.planId)?.priceCents ?? topActivePrice) < topActivePrice,
  ).length;

  return {
    period: range,
    activeSubscribers: active.length,
    mrrCents: byPlan.reduce((sum, row) => sum + row.mrrCents, 0),
    byPlan,
    credits: {
      /** Saldo total das carteiras: créditos recebidos e ainda não usados (passivo). */
      outstandingCents: walletTotals._sum.balanceCents ?? 0,
      generatedCents: generated._sum.amountCents ?? 0,
      usedCents: Math.abs(used._sum.amountCents ?? 0),
    },
    upgrades: {
      count: upgrades,
      eligible: canUpgrade,
      rate: upgrades + canUpgrade > 0 ? upgrades / (upgrades + canUpgrade) : 0,
    },
  };
}
