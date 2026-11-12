import { Router, raw } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/http.js';
import { getPaymentProvider } from '../../integrations/payments/gateway.js';
import { getPaymentConfig } from '../../integrations/payments/settings.js';
import { labelProvider } from '../../integrations/labels/declaration.js';
import { env } from '../../config/env.js';
import { creditTopUp } from '../wallet/wallet.routes.js';
import { settleOrder } from './orders.service.js';
import * as credits from '../../domain/credits/credits.service.js';
import {
  PLAN_REFERENCE_PREFIX,
  flagPlanCheckoutReversal,
  settlePlanCheckout,
} from '../plans/plan-checkout.service.js';

/**
 * Webhooks do gateway.
 *
 * Regras deste endpoint:
 *  1. Corpo bruto (raw) — a assinatura é calculada sobre os bytes originais.
 *  2. Idempotente — o gateway reenvia; processar duas vezes não pode creditar
 *     duas vezes (a trava está em creditTopUp e no status do pagamento).
 *  3. Responde 200 mesmo em evento desconhecido: erro aqui faz o gateway
 *     reenviar indefinidamente.
 */
export const webhooksRouter: Router = Router();

webhooksRouter.post(
  '/payments',
  raw({ type: '*/*' }),
  asyncHandler(async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    const signature = req.headers['x-signature'] as string | undefined;

    // Aviso sem assinatura não é aviso do gateway: é um POST anônimo afirmando
    // que um pagamento foi aprovado. Recusamos antes de ler o corpo — quem
    // valida o conteúdo da assinatura é o adapter, mas a ausência dela já basta
    // para descartar. Só desenvolvimento aceita, para simular eventos na mão.
    if (env.NODE_ENV !== 'development' && !signature) {
      res.status(401).json({ error: 'UNSIGNED_WEBHOOK', message: 'Assinatura ausente.' });
      return;
    }

    const paymentProvider = await getPaymentProvider();
    const event = await paymentProvider.parseWebhook({
      rawBody,
      headers: req.headers,
      query: req.query as Record<string, unknown>,
    });
    if (!event) {
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    const payment = await prisma.payment.findFirst({
      where: { provider: paymentProvider.name, externalId: event.externalId },
      include: { planCheckout: { select: { id: true } } },
    });
    if (!payment) {
      // Link de plano (Checkout Pro): o pagamento só existe depois que o
      // cliente paga — o casamento é pela referência que gravamos no link.
      if (event.externalReference?.startsWith(PLAN_REFERENCE_PREFIX)) {
        const checkoutId = event.externalReference.slice(PLAN_REFERENCE_PREFIX.length);
        const outcome = /^[0-9a-f-]{36}$/i.test(checkoutId)
          ? await settlePlanCheckout(checkoutId, event, paymentProvider.name)
          : 'ignored';
        res.status(200).json({ received: true, plan: outcome });
        return;
      }
      res.status(200).json({ received: true, matched: false });
      return;
    }

    // Já processado: idempotência.
    if (payment.status === 'PAID' && event.status === 'PAID') {
      res.status(200).json({ received: true, duplicated: true });
      return;
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: event.status === 'PAID' ? 'PAID' : event.status,
        paidAt: event.status === 'PAID' ? (event.paidAt ?? new Date()) : null,
        refundedAt: event.status === 'REFUNDED' ? new Date() : null,
        rawPayload: event.raw as never,
      },
    });

    if (payment.planCheckout) {
      // Pagamento de plano já ativado: só estorno/contestação interessa aqui.
      if (event.status === 'REFUNDED' || event.status === 'CHARGEBACK') {
        await flagPlanCheckoutReversal(payment.id, event.status);
      }
      res.status(200).json({ received: true });
      return;
    }

    if (event.status === 'PAID') {
      if (payment.orderId) {
        await settleOrder(payment.orderId);
        await issueDeclarationIfNeeded(payment.orderId);
      } else if (payment.userId) {
        await creditTopUp({
          userId: payment.userId,
          paymentId: payment.id,
          amountCents: payment.amountCents,
        });
      }
    }

    if (event.status === 'REFUNDED' || event.status === 'CHARGEBACK') {
      if (payment.orderId) {
        await prisma.order.update({
          where: { id: payment.orderId },
          data: { status: 'REFUNDED' },
        });
        // RN-02 — pedido estornado não pode continuar valendo abatimento.
        await prisma.$transaction((tx) => credits.revokeFromOrder(tx, payment.orderId!));
      }
    }

    res.status(200).json({ received: true });
  }),
);

/**
 * 3.6 — declaração de conteúdo emitida automaticamente após o pagamento.
 * Falha na emissão não desfaz a venda: fica registrada para reprocessamento.
 */
async function issueDeclarationIfNeeded(orderId: string): Promise<void> {
  const shipment = await prisma.shipment.findUnique({
    where: { orderId },
    include: {
      address: true,
      order: { include: { items: true, user: { select: { fullName: true, cpf: true } } } },
    },
  });
  if (!shipment || shipment.declarationIssuedAt) return;

  try {
    const { recipient } = await getPaymentConfig();
    const result = await labelProvider.issue({
      orderCode: shipment.order.code,
      sender: {
        name: recipient.name ?? 'VKUDAKA',
        document: recipient.document ?? '',
        address: 'Endereço de origem configurado no ambiente',
        zipCode: env.CORREIOS_ORIGIN_ZIP,
      },
      recipient: {
        name: shipment.order.user.fullName,
        document: shipment.order.user.cpf,
        address: `${shipment.address.street}, ${shipment.address.number} — ${shipment.address.district}, ${shipment.address.city}/${shipment.address.state}`,
        zipCode: shipment.address.zipCode,
      },
      items: shipment.order.items.map((item) => ({
        description: item.nameSnapshot,
        quantity: item.quantity,
        valueCents: item.totalCents,
      })),
      totalCents: shipment.order.subtotalCents,
      weightGrams: 1000,
    });

    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        contentDeclarationUrl: result.declarationUrl,
        labelUrl: result.labelUrl,
        trackingCode: result.trackingCode,
        declarationIssuedAt: new Date(),
      },
    });
  } catch (error) {
    console.error(`[frete] falha ao emitir declaração do pedido ${orderId}:`, error);
  }
}
