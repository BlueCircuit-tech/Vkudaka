import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, paginate, pageResult, param } from '../../lib/http.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { authenticate } from '../../middleware/auth.js';
import { requireActiveSubscriber } from '../../middleware/requireActiveSubscriber.js';
import { validate } from '../../middleware/validate.js';
import { buildQuote, createOrder, settleOrder } from './orders.service.js';
import { paymentProvider } from '../../integrations/payments/gateway.js';

export const ordersRouter: Router = Router();

const itemSchema = z
  .object({
    kind: z.enum(['SALE', 'RENTAL', 'TICKET']),
    variantId: z.string().uuid().optional(),
    ticketTypeId: z.string().uuid().optional(),
    quantity: z.number().int().min(1).max(20),
  })
  .refine((i) => (i.kind === 'TICKET' ? Boolean(i.ticketTypeId) : Boolean(i.variantId)), {
    message: 'variantId é obrigatório para peças; ticketTypeId para ingressos',
  });

const checkoutSchema = z.object({
  items: z.array(itemSchema).min(1).max(20),
  addressId: z.string().uuid().optional(),
  shippingService: z.enum(['PAC', 'SEDEX', 'PICKUP']).optional(),
  couponCode: z.string().max(30).optional(),
  /** 2.6 — quanto usar da carteira. 0 preserva o abatimento (RN-02). */
  useWalletCents: z.number().int().min(0).default(0),
  paymentMethod: z.enum(['PIX', 'CREDIT_CARD']).default('PIX'),
  cardToken: z.string().optional(),
  installments: z.number().int().min(1).max(12).default(1),
  rentalStartDate: z.coerce.date().optional(),
  notes: z.string().max(500).optional(),
});

/**
 * Preview do botão "Comprar" (2.3 / 3.2).
 * Sem efeito colateral: pode ser chamado a cada mudança de quantidade, cupom
 * ou slider de saldo da carteira.
 */
ordersRouter.post(
  '/quote',
  authenticate,
  requireActiveSubscriber,
  validate(checkoutSchema.partial({ paymentMethod: true })),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof checkoutSchema>;
    const { quote } = await buildQuote(prisma, {
      userId: req.auth!.userId,
      items: body.items,
      addressId: body.addressId,
      shippingService: body.shippingService,
      couponCode: body.couponCode,
      useWalletCents: body.useWalletCents,
      rentalStartDate: body.rentalStartDate,
    });
    res.json(quote);
  }),
);

/** Fechamento do pedido. RN-01 barra quem não é assinante antes de chegar aqui. */
ordersRouter.post(
  '/',
  authenticate,
  requireActiveSubscriber,
  validate(checkoutSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof checkoutSchema>;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });

    const { order, quote } = await createOrder({
      userId: user.id,
      items: body.items,
      addressId: body.addressId,
      shippingService: body.shippingService,
      couponCode: body.couponCode,
      useWalletCents: body.useWalletCents,
      rentalStartDate: body.rentalStartDate,
      notes: body.notes,
    });

    // Diferença a pagar no gateway ("inteirar o valor" — 2.6).
    let payment = null;
    if (quote.gatewayAmountCents > 0) {
      const charge = await paymentProvider.charge({
        orderId: order.id,
        amountCents: quote.gatewayAmountCents,
        method: body.paymentMethod,
        description: `Pedido ${order.code} — Clube VKUDAKA`,
        installments: body.installments,
        cardToken: body.cardToken,
        customer: {
          name: user.fullName,
          email: user.email,
          document: user.cpf,
          phone: user.phone,
        },
      });

      payment = await prisma.payment.create({
        data: {
          orderId: order.id,
          method: body.paymentMethod,
          status: charge.status,
          amountCents: quote.gatewayAmountCents,
          provider: charge.provider,
          externalId: charge.externalId,
          pixQrCode: charge.pixQrCode,
          pixCopyPaste: charge.pixCopyPaste,
          cardBrand: charge.cardBrand,
          cardLast4: charge.cardLast4,
          installments: body.installments,
          recipientRef: charge.recipientRef,
          paidAt: charge.status === 'PAID' ? new Date() : null,
        },
      });

      if (charge.status === 'PAID') {
        await settleOrder(order.id);
      }
    } else {
      // Pago integralmente com saldo da carteira.
      await settleOrder(order.id);
    }

    res.status(201).json({ order, quote, payment });
  }),
);

ordersRouter.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { page, perPage, skip, take } = paginate(req.query);
    const where = { userId: req.auth!.userId };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { items: true, shipment: true, payments: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.order.count({ where }),
    ]);

    res.json(pageResult(orders, total, page, perPage));
  }),
);

ordersRouter.get(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: param(req, 'id'), userId: req.auth!.userId },
      include: {
        items: true,
        payments: true,
        shipment: true,
        generatedCredit: true,
        tickets: true,
      },
    });
    if (!order) throw notFound('Pedido');
    res.json(order);
  }),
);

ordersRouter.post(
  '/:id/cancel',
  authenticate,
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: param(req, 'id'), userId: req.auth!.userId },
    });
    if (!order) throw notFound('Pedido');
    if (order.status !== 'PENDING_PAYMENT') {
      throw badRequest('ORDER_NOT_CANCELABLE', 'Este pedido não pode mais ser cancelado pelo app.');
    }

    const canceled = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
    res.json(canceled);
  }),
);
