import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import type { PlanCheckout, PlanCheckoutSource } from '@prisma/client';
import { env } from '../../config/env.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { formatBRL } from '../../lib/money.js';
import { prisma } from '../../lib/prisma.js';
import { getPaymentProvider, type WebhookEvent } from '../../integrations/payments/gateway.js';
import { getPaymentConfig } from '../../integrations/payments/settings.js';
import * as wallet from '../../domain/wallet/wallet.service.js';
import { notifyTrigger } from '../notifications/notifications.service.js';
import { grantPlanPeriod, planPeriodMonths } from '../subscriptions/subscriptions.service.js';

/**
 * Pagamento do plano por link do Mercado Pago (2026-11-12).
 *
 * Fluxo: app (ou CRM) gera o link → cliente paga com Pix ou cartão na página
 * do Mercado Pago → webhook confirma → nesta mesma transação a pessoa vira
 * assinante e 100% do valor entra como crédito VKUDAKA na carteira.
 *
 * Cada pagamento libera UM período do plano (Mensal = 1 mês). Para renovar, a
 * pessoa paga de novo — o período novo começa no fim do vigente.
 */

/** Prefixo do `external_reference` — é como o webhook reconhece um plano. */
export const PLAN_REFERENCE_PREFIX = 'plan:';

const LINK_VALIDITY_HOURS: Record<PlanCheckoutSource, number> = {
  APP: 24,
  // Link mandado por WhatsApp: a pessoa pode demorar a abrir.
  CRM: 72,
};

/**
 * Há gateway capaz de gerar link? Sem isso o app volta ao botão do site.
 *
 * Simulação só quando pedida EXPLICITAMENTE (PAYMENT_PROVIDER=mock). O mock
 * que `settings.ts` usa como quebra-galho em NODE_ENV=development não vale:
 * um servidor publicado em modo development sem o Mercado Pago ativo daria
 * assinatura de graça a quem abrisse a página simulada.
 */
export async function isPlanCheckoutEnabled(): Promise<boolean> {
  const config = await getPaymentConfig();
  if (config.provider === 'mercadopago') return true;
  return config.provider === 'mock' && env.PAYMENT_PROVIDER === 'mock';
}

/** Status exibido: um link pendente que passou da validade aparece como vencido. */
export const effectiveStatus = (checkout: Pick<PlanCheckout, 'status' | 'expiresAt'>) =>
  checkout.status === 'PENDING' && checkout.expiresAt < new Date() ? 'EXPIRED' : checkout.status;

export async function createPlanCheckout(input: {
  userId: string;
  planId: string;
  source: PlanCheckoutSource;
  createdById?: string;
}) {
  const [user, plan] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, fullName: true, email: true, cpf: true, deletedAt: true },
    }),
    prisma.plan.findUnique({ where: { id: input.planId } }),
  ]);
  if (!(await isPlanCheckoutEnabled())) {
    throw new AppError(
      503,
      'PAYMENT_NOT_CONFIGURED',
      'Pagamento do plano indisponível: ative o Mercado Pago em CRM › Pagamentos.',
    );
  }
  if (!user || user.deletedAt) throw notFound('Usuário');
  if (!plan) throw notFound('Plano');
  // O app só oferece planos à venda; o CRM pode cobrar um plano fora de linha.
  if (!plan.isActive && input.source === 'APP') {
    throw badRequest('PLAN_INACTIVE', 'Este plano não está mais disponível.');
  }

  // Link ainda válido para o mesmo plano e valor: reaproveita em vez de gerar
  // outro (o cliente que toca duas vezes não fica com dois links abertos).
  const reusable = await prisma.planCheckout.findFirst({
    where: {
      userId: user.id,
      planId: plan.id,
      amountCents: plan.priceCents,
      source: input.source,
      status: 'PENDING',
      expiresAt: { gt: dayjs().add(1, 'hour').toDate() },
    },
    orderBy: { createdAt: 'desc' },
    include: { plan: { select: { name: true } } },
  });
  if (reusable) return reusable;

  const id = randomUUID();
  const expiresAt = dayjs().add(LINK_VALIDITY_HOURS[input.source], 'hour').toDate();
  const provider = await getPaymentProvider();
  const link = await provider.createCheckoutLink({
    reference: `${PLAN_REFERENCE_PREFIX}${id}`,
    title: `Clube VKUDAKA — Plano ${plan.name}`,
    description: `Assinatura do Plano ${plan.name}. 100% do valor vira crédito VKUDAKA.`,
    amountCents: plan.priceCents,
    expiresAt,
    customer: { name: user.fullName, email: user.email, document: user.cpf },
    returnUrl: `${env.PUBLIC_WEB_URL}/pagamento-concluido.html`,
  });

  return prisma.planCheckout.create({
    data: {
      id,
      userId: user.id,
      planId: plan.id,
      source: input.source,
      amountCents: plan.priceCents,
      provider: link.provider,
      preferenceId: link.preferenceId,
      checkoutUrl: link.url,
      expiresAt,
      createdById: input.createdById ?? null,
    },
    include: { plan: { select: { name: true } } },
  });
}

/**
 * Pagamento aprovado de um link de plano. Idempotente pelo id do pagamento no
 * gateway (único em `payments`): webhook reenviado não ativa nem credita duas
 * vezes; dois avisos simultâneos do mesmo pagamento esbarram no índice único e
 * o segundo falha (o gateway reenvia e cai na checagem).
 *
 * Link vencido ou substituído que mesmo assim foi pago é honrado: o dinheiro
 * entrou, a pessoa recebe o período e os créditos.
 */
export async function settlePlanCheckout(
  checkoutId: string,
  event: WebhookEvent,
  providerName: string,
): Promise<'settled' | 'ignored'> {
  if (event.status !== 'PAID') return 'ignored';

  const result = await prisma.$transaction(async (tx) => {
    const checkout = await tx.planCheckout.findUnique({
      where: { id: checkoutId },
      include: { plan: true },
    });
    if (!checkout) return null;
    // O aviso tem de vir do mesmo provedor que gerou o link (um aviso do
    // simulador nunca liquida link do Mercado Pago, e vice-versa).
    if (checkout.provider !== providerName) return null;

    // Valor menor que o cobrado não ativa: fica para a equipe conferir no CRM.
    if (event.amountCents !== undefined && event.amountCents < checkout.amountCents) {
      console.error(
        `[plano] pagamento ${event.externalId} de ${event.amountCents} abaixo do link ${checkout.id} (${checkout.amountCents})`,
      );
      return null;
    }

    // Idempotência pelo id do pagamento no gateway: aviso repetido para.
    const known = await tx.payment.findFirst({
      where: { provider: providerName, externalId: event.externalId },
      select: { id: true },
    });
    if (known) return null;

    const payment = await tx.payment.create({
      data: {
        userId: checkout.userId,
        method: event.method ?? 'MANUAL',
        status: 'PAID',
        amountCents: event.amountCents ?? checkout.amountCents,
        provider: providerName,
        externalId: event.externalId,
        paidAt: event.paidAt ?? new Date(),
        rawPayload: event.raw as never,
      },
    });

    const { subscription, periodStart } = await grantPlanPeriod(tx, {
      userId: checkout.userId,
      planId: checkout.planId,
      months: planPeriodMonths(checkout.plan),
    });

    // 100% do valor pago vira crédito VKUDAKA (regra de 2026-11-11).
    await wallet.credit(tx, {
      userId: checkout.userId,
      type: 'SUBSCRIPTION',
      amountCents: payment.amountCents,
      description: `Assinatura ${checkout.plan.name} — pagamento Mercado Pago em créditos`,
      paymentId: payment.id,
    });

    // Fatura do período, já paga — histórico do CRM (Assinante › faturas).
    const referenceMonth = dayjs(periodStart).startOf('month').toDate();
    const existingInvoice = await tx.subscriptionInvoice.findUnique({
      where: { subscriptionId_referenceMonth: { subscriptionId: subscription.id, referenceMonth } },
    });
    if (!existingInvoice) {
      const invoice = await tx.subscriptionInvoice.create({
        data: {
          subscriptionId: subscription.id,
          referenceMonth,
          grossCents: payment.amountCents,
          netCents: payment.amountCents,
          status: 'PAID',
          dueDate: referenceMonth,
          paidAt: payment.paidAt,
        },
      });
      await tx.payment.update({ where: { id: payment.id }, data: { invoiceId: invoice.id } });
    }

    // O primeiro pagamento fica ligado ao link. Um segundo pagamento no mesmo
    // link (o cliente pagou duas vezes) é honrado — mais um período e mais
    // créditos — e aparece na auditoria e na lista de pagamentos.
    if (!checkout.paymentId) {
      await tx.planCheckout.update({
        where: { id: checkout.id },
        data: {
          status: 'PAID',
          paidAt: payment.paidAt,
          paymentId: payment.id,
          subscriptionId: subscription.id,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: checkout.userId,
        action: 'subscription.paid',
        entity: 'Subscription',
        entityId: subscription.id,
        after: {
          planCheckoutId: checkout.id,
          planId: checkout.planId,
          paymentId: payment.id,
          externalId: event.externalId,
          amountCents: payment.amountCents,
          currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
        },
      },
    });

    return { checkout, subscription, amountCents: payment.amountCents };
  });

  if (!result) return 'ignored';

  await notifyTrigger('SUBSCRIPTION_RENEWED', {
    userIds: [result.checkout.userId],
    title: 'Assinatura ativa no Clube VKUDAKA',
    body: `Plano ${result.checkout.plan.name} ativo até ${dayjs(result.subscription.currentPeriodEnd).format(
      'DD/MM/YYYY',
    )}. ${formatBRL(result.amountCents)} em créditos já estão na sua carteira.`,
    deepLink: 'vkudaka://carteira',
  });
  return 'settled';
}

/**
 * Estorno ou contestação de um pagamento de plano. A assinatura e os créditos
 * NÃO são desfeitos automaticamente — os créditos podem já ter virado peça. O
 * link fica marcado e a auditoria registra, para a equipe decidir no CRM.
 */
export async function flagPlanCheckoutReversal(paymentId: string, status: WebhookEvent['status']) {
  const checkout = await prisma.planCheckout.findUnique({ where: { paymentId } });
  if (!checkout) return;
  await prisma.planCheckout.update({ where: { id: checkout.id }, data: { status: 'REFUNDED' } });
  await prisma.auditLog.create({
    data: {
      actorId: checkout.userId,
      action: status === 'CHARGEBACK' ? 'subscription.chargeback' : 'subscription.refunded',
      entity: 'PlanCheckout',
      entityId: checkout.id,
      after: { paymentId, subscriptionId: checkout.subscriptionId, amountCents: checkout.amountCents },
    },
  });
}

/** Formato devolvido ao app e ao CRM. */
export const toPublicCheckout = (
  checkout: PlanCheckout & { plan: { name: string } },
) => ({
  id: checkout.id,
  planId: checkout.planId,
  planName: checkout.plan.name,
  status: effectiveStatus(checkout),
  source: checkout.source,
  amountCents: checkout.amountCents,
  url: checkout.checkoutUrl,
  expiresAt: checkout.expiresAt,
  paidAt: checkout.paidAt,
  createdAt: checkout.createdAt,
});
