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
