import dayjs from 'dayjs';
import type { BillingInterval, Prisma } from '@prisma/client';
import type { Tx } from '../../lib/prisma.js';
import { decimalToNumber } from '../../lib/money.js';
import * as credits from '../../domain/credits/credits.service.js';
import { quarterOf } from '../../domain/rental/quarterly.js';

/**
 * RN-06 — assinaturas e níveis.
 * `getActiveSubscription` é chamada em todo request protegido: mantida enxuta
 * e com apenas os campos que o gate e o motor de preço precisam.
 */
export async function getActiveSubscription(tx: Tx, userId: string) {
  return tx.subscription.findFirst({
    where: {
      userId,
      status: { in: ['ACTIVE', 'TRIALING'] },
      currentPeriodEnd: { gte: new Date() },
    },
    include: {
      plan: {
        select: {
          id: true,
          name: true,
          slug: true,
          rebatePercent: true,
          rebateMode: true,
          priceCents: true,
          interval: true,
        },
      },
    },
    orderBy: { currentPeriodEnd: 'desc' },
  });
}

/**
 * Percentual de abatimento vigente de um contrato (RN-02).
 *
 * A direção pode negociar uma condição própria com a assinante — 10, 15 ou o
 * que combinar — e esse valor fica gravado na assinatura. Quando não há nada
 * negociado, vale o percentual do plano. Existe um único lugar que decide isso
 * porque o número aparece na vitrine, no checkout, no crédito gerado e no
 * cartão do clube: se cada ponto resolvesse por conta própria, uma condição
 * especial apareceria em uns e não em outros.
 */
export function effectiveRebatePercent(subscription: {
  rebatePercent: Prisma.Decimal | null;
  plan: { rebatePercent: Prisma.Decimal };
}): number {
  return decimalToNumber(subscription.rebatePercent ?? subscription.plan.rebatePercent);
}

/**
 * Percentual e modo de abatimento vigentes para o usuário (RN-02).
 * Quem não tem assinatura ativa recebe 0% — o motor de preço já trata isso,
 * mas devolver explicitamente evita `undefined` viajando pelo código.
 */
export async function getRebateSettings(tx: Tx, userId: string) {
  const subscription = await getActiveSubscription(tx, userId);
  return {
    subscription,
    hasActiveSubscription: Boolean(subscription),
    rebatePercent: subscription ? effectiveRebatePercent(subscription) : 0,
    rebateMode: subscription?.plan.rebateMode ?? ('CREDIT_NEXT_INVOICE' as const),
  };
}

const MONTHS_BY_INTERVAL: Record<BillingInterval, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

export const periodEnd = (start: Date, interval: BillingInterval, count = 1): Date =>
  dayjs(start)
    .add(MONTHS_BY_INTERVAL[interval] * count, 'month')
    .toDate();

/** Meses cobertos por um período do plano (Mensal = 1, Trimestral = 3…). */
export const planPeriodMonths = (plan: { interval: BillingInterval; intervalCount: number }) =>
  MONTHS_BY_INTERVAL[plan.interval] * Math.max(1, plan.intervalCount);

/**
 * Ativa, renova ou troca o plano de uma pessoa por `months` meses.
 *
 * É a mesma regra para a concessão manual do CRM e para o pagamento confirmado
 * pelo Mercado Pago: a renovação parte do fim do período vigente (quem paga
 * antes de vencer não perde dias); trocar de plano encerra o contrato anterior
 * e abre outro com o preço do plano novo (RN-06 — preço travado no contrato).
 *
 * `rebatePercent`: omitido = não mexe; null = volta ao do plano; número = negociado.
 */
export async function grantPlanPeriod(
  tx: Tx,
  input: {
    userId: string;
    planId: string;
    months: number;
    rebatePercent?: Prisma.Decimal | null;
  },
) {
  const plan = await tx.plan.findUniqueOrThrow({ where: { id: input.planId } });

  const current = await tx.subscription.findFirst({
    where: { userId: input.userId, status: { in: ['ACTIVE', 'TRIALING'] } },
    orderBy: { currentPeriodEnd: 'desc' },
  });

  const start =
    current && current.currentPeriodEnd > new Date() ? current.currentPeriodEnd : new Date();
  const end = dayjs(start).add(input.months, 'month').toDate();

  if (current) {
    if (current.planId === input.planId) {
      const renewed = await tx.subscription.update({
        where: { id: current.id },
        data: {
          currentPeriodEnd: end,
          status: 'ACTIVE',
          cancelAtPeriodEnd: false,
          ...(input.rebatePercent !== undefined ? { rebatePercent: input.rebatePercent } : {}),
        },
        include: { plan: true },
      });
      return { subscription: renewed, periodStart: start };
    }
    await tx.subscription.update({
      where: { id: current.id },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
  }

  const created = await tx.subscription.create({
    data: {
      userId: input.userId,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      priceCents: plan.priceCents,
      rebatePercent: input.rebatePercent ?? null,
    },
    include: { plan: true },
  });
  return { subscription: created, periodStart: start };
}

/**
 * RN-05 — gera a fatura do período e aplica os créditos de abatimento
 * acumulados (FIFO, sem teto, sem expiração).
 */
export async function generateInvoice(
  tx: Tx,
  subscriptionId: string,
  referenceMonth: Date,
  dueDate: Date,
) {
  const subscription = await tx.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
  });

  const existing = await tx.subscriptionInvoice.findUnique({
    where: { subscriptionId_referenceMonth: { subscriptionId, referenceMonth } },
  });
  if (existing) return existing;

  const invoice = await tx.subscriptionInvoice.create({
    data: {
      subscriptionId,
      referenceMonth,
      grossCents: subscription.priceCents,
      netCents: subscription.priceCents,
      dueDate,
    },
  });

  await credits.applyToInvoice(tx, {
    userId: subscription.userId,
    invoiceId: invoice.id,
    grossCents: subscription.priceCents,
  });

  return tx.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
}

/** Prévia da próxima mensalidade — alimenta o cartão do clube na home do app. */
export async function nextInvoicePreview(tx: Tx, userId: string) {
  const subscription = await getActiveSubscription(tx, userId);
  if (!subscription) return null;

  const availableCredit = await credits.availableBalance(tx, userId);
  const grossCents = subscription.priceCents;
  const creditCents = Math.min(availableCredit, grossCents);

  return {
    planName: subscription.plan.name,
    grossCents,
    creditCents,
    netCents: grossCents - creditCents,
    /** Crédito que sobra para as faturas seguintes (não expira). */
    carryOverCents: availableCredit - creditCents,
    dueDate: subscription.currentPeriodEnd,
    rebatePercent: effectiveRebatePercent(subscription),
  };
}

/**
 * RN-12 — a assinante ainda tem a peça do trimestre disponível?
 *
 * Conta qualquer pedido do trimestre que tenha usado o direito e não tenha
 * sido cancelado/estornado — inclusive os pendentes de pagamento, senão dois
 * pedidos abertos em sequência sairiam os dois de graça.
 */
export async function quarterlyRentalStatus(tx: Tx, userId: string, now = new Date()) {
  const quarter = quarterOf(now);
  const subscription = await getActiveSubscription(tx, userId);

  if (!subscription) {
    return {
      eligible: false,
      available: false,
      period: quarter.period,
      periodLabel: quarter.label,
      nextPeriodStart: quarter.nextStart,
      usedByOrderCode: null as string | null,
    };
  }

  const used = await tx.order.findFirst({
    where: {
      userId,
      quarterlyRentalPeriod: quarter.period,
      status: { notIn: ['CANCELED', 'REFUNDED'] },
    },
    select: { code: true },
  });

  return {
    eligible: true,
    available: !used,
    period: quarter.period,
    periodLabel: quarter.label,
    nextPeriodStart: quarter.nextStart,
    usedByOrderCode: used?.code ?? null,
  };
}
