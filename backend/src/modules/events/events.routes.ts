import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, param } from '../../lib/http.js';
import { conflict, notFound } from '../../lib/errors.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { attendanceListPdf, cancelRsvp, issueTicket, rsvp, scanTicket } from './events.service.js';
import { getActiveSubscription } from '../subscriptions/subscriptions.service.js';
import { paymentProvider } from '../../integrations/payments/gateway.js';
import { orderCode } from '../../lib/codes.js';
import { settleOrder } from '../orders/orders.service.js';

/**
 * Eventos (2.4 / 3.4).
 *
 * Atenção à autorização: a compra de ingresso avulso é o ÚNICO fluxo de compra
 * do app que NÃO exige assinatura (RN-01). Por isso ela vive aqui e não em
 * /orders — que é integralmente protegido por requireActiveSubscriber.
 */
export const eventsRouter: Router = Router();

eventsRouter.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const subscription = await getActiveSubscription(prisma, req.auth!.userId);

    const events = await prisma.event.findMany({
      where: { status: 'PUBLISHED', startsAt: { gte: new Date() } },
      orderBy: { startsAt: 'asc' },
      include: {
        ticketTypes: { where: { isActive: true }, orderBy: { priceCents: 'asc' } },
        attendees: { where: { userId: req.auth!.userId, canceledAt: null }, select: { id: true } },
        tickets: {
          where: { userId: req.auth!.userId, status: { in: ['VALID', 'USED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            code: true,
            status: true,
            kind: true,
            order: { select: { status: true } },
          },
        },
      },
    });

    /** Pedido cujo dinheiro entrou — mesma régua da lista da recepção. */
    const PAGO = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'];

    res.json(
      events.map((event) => {
        const ticket = event.tickets[0] ?? null;
        // Ingresso de assinante não tem pedido; o avulso só vale depois de pago.
        const ticketPago =
          ticket !== null && (ticket.order === null || PAGO.includes(ticket.order.status));

        return {
          ...event,
          attendees: undefined,
          tickets: undefined,
          /** Assinante não paga entrada; a UI esconde o preço nesse caso. */
          freeForMe: Boolean(subscription) && event.subscribersFree,
          confirmed: event.attendees.length > 0,
          canBuyTicket: event.sellsPublicTickets,
          /**
           * Onde a pessoa está neste evento — o app precisa disto para não
           * oferecer compra a quem já comprou nem confirmação a quem já confirmou.
           */
          myTicket: ticket
            ? {
                id: ticket.id,
                code: ticket.code,
                kind: ticket.kind,
                used: ticket.status === 'USED',
                paid: ticketPago,
              }
            : null,
        };
      }),
    );
  }),
);

eventsRouter.get(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const event = await prisma.event.findUnique({
      where: { id: param(req, 'id') },
      include: { ticketTypes: { where: { isActive: true } } },
    });
    if (!event || event.status !== 'PUBLISHED') throw notFound('Evento');
    res.json(event);
  }),
);

/** Assinante: confirmação de presença sem custo. */
eventsRouter.post(
  '/:id/rsvp',
  authenticate,
  asyncHandler(async (req, res) => {
    res.status(201).json(await rsvp(req.auth!.userId, param(req, 'id')));
  }),
);

eventsRouter.delete(
  '/:id/rsvp',
  authenticate,
  asyncHandler(async (req, res) => {
    await cancelRsvp(req.auth!.userId, param(req, 'id'));
    res.status(204).end();
  }),
);

/**
 * Bloco isolado de ingresso avulso (2.4).
 * Disponível para não assinantes: nenhuma checagem de assinatura aqui.
 */
eventsRouter.post(
  '/:id/tickets',
  authenticate,
  validate(
    z.object({
      ticketTypeId: z.string().uuid(),
      quantity: z.number().int().min(1).max(6),
      paymentMethod: z.enum(['PIX', 'CREDIT_CARD']).default('PIX'),
      cardToken: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      ticketTypeId: string;
      quantity: number;
      paymentMethod: 'PIX' | 'CREDIT_CARD';
      cardToken?: string;
    };
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });

    const result = await prisma.$transaction(async (tx) => {
      const type = await tx.eventTicketType.findUnique({
        where: { id: body.ticketTypeId },
        include: { event: true },
      });
      if (!type || !type.isActive || type.eventId !== param(req, 'id')) throw notFound('Ingresso');
      if (type.event.status !== 'PUBLISHED' || !type.event.sellsPublicTickets) {
        throw conflict('TICKETS_CLOSED', 'Venda de ingressos indisponível para este evento.');
      }

      const reserved = await tx.eventTicketType.updateMany({
        where: { id: type.id, sold: { lte: type.quantity - body.quantity } },
        data: { sold: { increment: body.quantity } },
      });
      if (reserved.count === 0) throw conflict('TICKETS_SOLD_OUT', 'Ingressos esgotados.');

      const totalCents = type.priceCents * body.quantity;
      const year = new Date().getFullYear();
      const count = await tx.order.count({
        where: { createdAt: { gte: new Date(`${year}-01-01T00:00:00Z`) } },
      });

      const order = await tx.order.create({
        data: {
          code: orderCode(count + 1, year),
          userId: user.id,
          type: 'TICKET',
          status: 'PENDING_PAYMENT',
          subtotalCents: totalCents,
          totalCents,
          gatewayAmountCents: totalCents,
          // RN-02: ingresso avulso não gera abatimento.
          rebateEligible: false,
          rebateBlockedReason: 'NO_PLAN',
          items: {
            create: {
              ticketTypeId: type.id,
              nameSnapshot: `${type.event.title} — ${type.name}`,
              kind: 'TICKET',
              quantity: body.quantity,
              unitPriceCents: type.priceCents,
              totalCents,
            },
          },
        },
      });

      const attendee = await tx.eventAttendee.upsert({
        where: { eventId_userId: { eventId: type.eventId, userId: user.id } },
        create: {
          eventId: type.eventId,
          userId: user.id,
          kind: 'PAID_TICKET',
          guestName: user.fullName,
          guestEmail: user.email,
          guestPhone: user.phone,
          guestDocument: user.cpf,
        },
        update: { canceledAt: null },
      });

      const tickets = [];
      for (let i = 0; i < body.quantity; i++) {
        tickets.push(
          await issueTicket(tx, {
            eventId: type.eventId,
            attendeeId: attendee.id,
            userId: user.id,
            ticketTypeId: type.id,
            orderId: order.id,
            kind: 'PAID_TICKET',
            holderName: user.fullName,
          }),
        );
      }

      return { order, tickets, totalCents };
    });

    const charge = await paymentProvider.charge({
      orderId: result.order.id,
      amountCents: result.totalCents,
      method: body.paymentMethod,
      description: `Ingresso — ${result.order.code}`,
      cardToken: body.cardToken,
      customer: { name: user.fullName, email: user.email, document: user.cpf, phone: user.phone },
    });

    const payment = await prisma.payment.create({
      data: {
        orderId: result.order.id,
        userId: user.id,
        method: body.paymentMethod,
        status: charge.status,
        amountCents: result.totalCents,
        provider: charge.provider,
        externalId: charge.externalId,
        pixQrCode: charge.pixQrCode,
        pixCopyPaste: charge.pixCopyPaste,
        cardBrand: charge.cardBrand,
        cardLast4: charge.cardLast4,
        recipientRef: charge.recipientRef,
        paidAt: charge.status === 'PAID' ? new Date() : null,
      },
    });

    // Cartão aprovado na hora fecha o pedido aqui mesmo; no Pix quem fecha é o
    // webhook. Sem isto o ingresso ficava pago e o pedido pendente — e a lista
    // da recepção barrava quem pagou.
    if (charge.status === 'PAID') {
      await settleOrder(result.order.id);
    }

    res.status(201).json({ ...result, payment });
  }),
);

/** Meus ingressos — alimenta a tela do ingresso com QR Code sobre a arte. */
eventsRouter.get(
  '/me/tickets',
  authenticate,
  asyncHandler(async (req, res) => {
    const tickets = await prisma.ticket.findMany({
      where: { userId: req.auth!.userId, status: { in: ['VALID', 'USED'] } },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            venueName: true,
            venueAddress: true,
            ticketArtUrl: true,
          },
        },
        ticketType: { select: { name: true } },
        order: { select: { status: true, code: true } },
      },
      orderBy: { event: { startsAt: 'asc' } },
    });

    /** Mesma régua da porta: sem pagamento confirmado o ingresso não vale. */
    const PAGO = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'];

    res.json(
      tickets.map((ticket) => ({
        ...ticket,
        order: undefined,
        orderCode: ticket.order?.code ?? null,
        // Ingresso de assinante não tem pedido: vale desde a confirmação.
        paid: ticket.order === null || PAGO.includes(ticket.order.status),
      })),
    );
  }),
);

// ── Portaria (GATE) ──────────────────────────────────────────────────────────

eventsRouter.post(
  '/tickets/scan',
  authenticate,
  requireRole('GATE'),
  validate(z.object({ payload: z.string().min(10) })),
  asyncHandler(async (req, res) => {
    res.json(await scanTicket(req.body.payload as string, req.auth!.userId));
  }),
);

eventsRouter.get(
  '/:id/attendance.pdf',
  authenticate,
  requireRole('GATE'),
  asyncHandler(async (req, res) => {
    const pdf = await attendanceListPdf(param(req, 'id'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="lista-entrada-${param(req, 'id')}.pdf"`);
    res.send(pdf);
  }),
);
