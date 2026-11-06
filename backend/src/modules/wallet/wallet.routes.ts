import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { formatBRL } from '../../lib/money.js';
import { asyncHandler, paginate, param } from '../../lib/http.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as wallet from '../../domain/wallet/wallet.service.js';
import * as credits from '../../domain/credits/credits.service.js';
import { getPaymentProvider } from '../../integrations/payments/gateway.js';
import { notifyTrigger } from '../notifications/notifications.service.js';

/**
 * Carteira digital (2.6) — menu apartado no app.
 *
 * Distinção que o app deixa explícita na tela:
 *   • SALDO da carteira  → paga compras; usar bloqueia o abatimento (RN-02)
 *   • CRÉDITO do clube   → abate a próxima mensalidade; não paga compras (RN-05)
 */
export const walletRouter: Router = Router();

const MIN_TOPUP_CENTS = 1_000; // R$ 10,00
const MAX_TOPUP_CENTS = 5_000_00;

walletRouter.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const balanceCents = await wallet.getBalance(prisma, userId);
    const clubCreditCents = await credits.availableBalance(prisma, userId);

    res.json({
      balanceCents,
      clubCreditCents,
      hint: 'O saldo paga compras. O crédito do clube abate a próxima mensalidade.',
    });
  }),
);

walletRouter.get(
  '/statement',
  authenticate,
  asyncHandler(async (req, res) => {
    const { skip, take } = paginate(req.query);
    res.json(await wallet.statement(prisma, req.auth!.userId, skip, take));
  }),
);

walletRouter.get(
  '/credits',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    res.json({
      availableCents: await credits.availableBalance(prisma, userId),
      history: await credits.history(prisma, userId),
    });
  }),
);

/** Recarga via Pix ou cartão. O saldo só entra quando o webhook confirma. */
walletRouter.post(
  '/topup',
  authenticate,
  validate(
    z.object({
      amountCents: z.number().int().min(MIN_TOPUP_CENTS).max(MAX_TOPUP_CENTS),
      method: z.enum(['PIX', 'CREDIT_CARD']),
      cardToken: z.string().optional(),
      installments: z.number().int().min(1).max(12).default(1),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      amountCents: number;
      method: 'PIX' | 'CREDIT_CARD';
      cardToken?: string;
      installments: number;
    };
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });

    const paymentProvider = await getPaymentProvider();
    const charge = await paymentProvider.charge({
      amountCents: body.amountCents,
      method: body.method,
      description: 'Recarga da carteira — Clube VKUDAKA',
      installments: body.installments,
      cardToken: body.cardToken,
      customer: { name: user.fullName, email: user.email, document: user.cpf, phone: user.phone },
    });

    const payment = await prisma.payment.create({
      data: {
        userId: user.id, // recarga não tem pedido: o dono fica no próprio pagamento
        method: body.method,
        status: charge.status,
        amountCents: body.amountCents,
        provider: charge.provider,
        externalId: charge.externalId,
        pixQrCode: charge.pixQrCode,
        pixCopyPaste: charge.pixCopyPaste,
        cardBrand: charge.cardBrand,
        cardLast4: charge.cardLast4,
        installments: body.installments,
        recipientRef: charge.recipientRef,
      },
    });

    if (charge.status === 'PAID') {
      await creditTopUp({ userId: user.id, paymentId: payment.id, amountCents: body.amountCents });
    }

    res.status(201).json({
      payment,
      pix: charge.pixCopyPaste
        ? { qrCode: charge.pixQrCode, copyPaste: charge.pixCopyPaste, expiresAt: charge.expiresAt }
        : null,
    });
  }),
);

/**
 * Situação de uma recarga (2.6).
 *
 * O Pix é assíncrono: o app cria a cobrança, mostra o código e precisa saber
 * quando o dinheiro entrou — quem credita é o webhook, não esta rota. Serve
 * para a tela de recarga acompanhar sem inventar saldo na frente do usuário.
 */
walletRouter.get(
  '/topup/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findFirst({
      where: { id: param(req, 'id'), userId: req.auth!.userId, orderId: null },
    });
    if (!payment) throw notFound('Recarga');

    const credited = await prisma.walletTransaction.findFirst({
      where: { paymentId: payment.id, type: 'TOPUP' },
      select: { createdAt: true },
    });

    res.json({
      id: payment.id,
      status: payment.status,
      amountCents: payment.amountCents,
      method: payment.method,
      pix: payment.pixCopyPaste
        ? { qrCode: payment.pixQrCode, copyPaste: payment.pixCopyPaste }
        : null,
      creditedAt: credited?.createdAt ?? null,
      balanceCents: await wallet.getBalance(prisma, req.auth!.userId),
    });
  }),
);

walletRouter.get(
  '/integrity',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await wallet.assertIntegrity(prisma, req.auth!.userId));
  }),
);

/**
 * Credita a recarga (chamada pelo webhook e pelo caminho de cartão aprovado).
 * Idempotente: a existência de um WalletTransaction TOPUP para o mesmo
 * `paymentId` é a trava — webhook reenviado não credita duas vezes.
 */
export async function creditTopUp(params: {
  userId: string;
  paymentId: string;
  amountCents: number;
}): Promise<void> {
  const created = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: params.paymentId } });
    if (!payment) throw notFound('Pagamento');
    if (payment.orderId) throw badRequest('NOT_A_TOPUP', 'Este pagamento não é uma recarga.');

    const already = await tx.walletTransaction.findFirst({
      where: { paymentId: params.paymentId, type: 'TOPUP' },
    });
    if (already) return false;

    await wallet.credit(tx, {
      userId: params.userId,
      type: 'TOPUP',
      amountCents: params.amountCents,
      description: 'Recarga da carteira',
      paymentId: params.paymentId,
    });
    return true;
  });

  if (!created) return;

  const balance = formatBRL(await wallet.getBalance(prisma, params.userId));
  await notifyTrigger('WALLET_TOPUP_CONFIRMED', {
    userIds: [params.userId],
    title: 'Créditos adicionados',
    body: `Recarga de ${formatBRL(params.amountCents)} confirmada. Você tem ${balance} de créditos na carteira.`,
    deepLink: 'vkudaka://carteira',
  });
}
