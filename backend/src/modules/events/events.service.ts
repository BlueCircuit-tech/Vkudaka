import PDFDocument from 'pdfkit';
import type { AttendeeKind } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { conflict, notFound } from '../../lib/errors.js';
import { encodeTicket, newTicketCode, decodeTicket } from '../../domain/tickets/ticket.codec.js';
import { getActiveSubscription } from '../subscriptions/subscriptions.service.js';

/** RN-07 — eventos, ingressos e portaria. */

// ─────────────────────────────────────────────────────────────────────────────
// Emissão
// ─────────────────────────────────────────────────────────────────────────────

export async function issueTicket(
  tx: Tx,
  params: {
    eventId: string;
    attendeeId: string;
    userId: string | null;
    ticketTypeId: string | null;
    orderId: string | null;
    kind: AttendeeKind;
    holderName: string;
  },
) {
  const code = newTicketCode();

  // O payload assinado precisa do id do ingresso, que só existe depois do insert.
  const ticket = await tx.ticket.create({
    data: {
      eventId: params.eventId,
      attendeeId: params.attendeeId,
      userId: params.userId,
      ticketTypeId: params.ticketTypeId,
      orderId: params.orderId,
      kind: params.kind,
      holderName: params.holderName,
      code,
      qrPayload: `pending:${code}`,
    },
  });

  return tx.ticket.update({
    where: { id: ticket.id },
    data: { qrPayload: encodeTicket({ eventId: params.eventId, ticketId: ticket.id, code }) },
  });
}

/**
 * Assinante confirma presença: não paga entrada (2.4).
 * Idempotente — confirmar duas vezes devolve o mesmo ingresso.
 */
export async function rsvp(userId: string, eventId: string) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event || event.status !== 'PUBLISHED') throw notFound('Evento');
    if (event.rsvpDeadline && event.rsvpDeadline < new Date()) {
      throw conflict('RSVP_CLOSED', 'O prazo de confirmação para este evento encerrou.');
    }

    const subscription = await getActiveSubscription(tx, userId);
    if (!subscription || !event.subscribersFree) {
      throw conflict('RSVP_NOT_ALLOWED', 'Este evento exige compra de ingresso.');
    }

    const existing = await tx.eventAttendee.findUnique({
      where: { eventId_userId: { eventId, userId } },
      include: { tickets: true },
    });
    if (existing && !existing.canceledAt) {
      return { attendee: existing, ticket: existing.tickets[0] ?? null, alreadyConfirmed: true };
    }

    if (event.capacity) {
      const confirmed = await tx.eventAttendee.count({ where: { eventId, canceledAt: null } });
      if (confirmed >= event.capacity) throw conflict('EVENT_FULL', 'Lista de presença esgotada.');
    }

    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

    const attendee = existing
      ? await tx.eventAttendee.update({
          where: { id: existing.id },
          data: { canceledAt: null, confirmedAt: new Date() },
        })
      : await tx.eventAttendee.create({
          data: { eventId, userId, kind: 'SUBSCRIBER_RSVP' },
        });

    const ticket = await issueTicket(tx, {
      eventId,
      attendeeId: attendee.id,
      userId,
      ticketTypeId: null,
      orderId: null,
      kind: 'SUBSCRIBER_RSVP',
      holderName: user.fullName,
    });

    return { attendee, ticket, alreadyConfirmed: false };
  });
}

export async function cancelRsvp(userId: string, eventId: string) {
  return prisma.$transaction(async (tx) => {
    const attendee = await tx.eventAttendee.findUnique({
      where: { eventId_userId: { eventId, userId } },
    });
    if (!attendee) throw notFound('Confirmação');

    await tx.ticket.updateMany({
      where: { attendeeId: attendee.id, status: 'VALID' },
      data: { status: 'CANCELED' },
    });

    return tx.eventAttendee.update({
      where: { id: attendee.id },
      data: { canceledAt: new Date() },
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Portaria
// ─────────────────────────────────────────────────────────────────────────────

export type ScanResult =
  | { status: 'OK'; ticket: { code: string; holderName: string; kind: AttendeeKind } }
  | { status: 'ALREADY_USED'; usedAt: Date; holderName: string }
  | { status: 'INVALID'; reason: string };

/**
 * Validação na portaria. Idempotente por definição: a primeira leitura marca
 * USED, as seguintes informam quando foi usado — sem erro, porque quem está na
 * porta precisa de resposta, não de exceção.
 */
export async function scanTicket(rawPayload: string, scannedById: string): Promise<ScanResult> {
  const decoded = decodeTicket(rawPayload);
  if (!decoded.valid) return { status: 'INVALID', reason: decoded.reason };

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: decoded.payload.ticketId } });

    if (!ticket || ticket.code !== decoded.payload.code) {
      return { status: 'INVALID', reason: 'NOT_FOUND' };
    }
    if (ticket.eventId !== decoded.payload.eventId) {
      return { status: 'INVALID', reason: 'WRONG_EVENT' };
    }
    if (ticket.status === 'CANCELED' || ticket.status === 'REFUNDED') {
      return { status: 'INVALID', reason: ticket.status };
    }
    if (ticket.status === 'USED') {
      return { status: 'ALREADY_USED', usedAt: ticket.usedAt!, holderName: ticket.holderName };
    }

    const updated = await tx.ticket.updateMany({
      where: { id: ticket.id, status: 'VALID' },
      data: { status: 'USED', usedAt: new Date(), scannedById },
    });
    if (updated.count === 0) {
      const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      return { status: 'ALREADY_USED', usedAt: current.usedAt!, holderName: current.holderName };
    }

    return {
      status: 'OK',
      ticket: { code: ticket.code, holderName: ticket.holderName, kind: ticket.kind },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Lista de entrada (3.4)
// ─────────────────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<AttendeeKind, string> = {
  SUBSCRIBER_RSVP: 'Assinante',
  PAID_TICKET: 'Ingresso avulso',
  GUEST: 'Convidado',
};

/** Por que a pessoa pode — ou não pode — entrar. */
export type EntryRight =
  | 'SUBSCRIBER' // plano do clube ativo
  | 'PAID_TICKET' // comprou e pagou o ingresso
  | 'GUEST' // convidado da casa
  | 'SUBSCRIPTION_INACTIVE' // confirmou presença, mas o plano não está mais ativo
  | 'PAYMENT_PENDING' // reservou ingresso e não pagou
  | 'TICKET_CANCELED'; // ingresso cancelado ou estornado

const BLOCKED_LABEL: Record<string, string> = {
  SUBSCRIPTION_INACTIVE: 'plano inativo',
  PAYMENT_PENDING: 'pagamento pendente',
  TICKET_CANCELED: 'ingresso cancelado',
};

export interface EntryRow {
  attendeeId: string;
  name: string;
  document: string | null;
  contact: string | null;
  kind: AttendeeKind;
  ticketCode: string | null;
  allowed: boolean;
  right: EntryRight;
  checkedIn: boolean;
  checkedInAt: Date | null;
}

/** Pedido cujo dinheiro entrou — só isso libera o ingresso avulso. */
const PAID_ORDER_STATUSES = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] as const;

/**
 * Quem pode entrar no evento.
 *
 * Regra da porta: entra quem **é do plano do clube** ou **pagou o ingresso**.
 * Isso não é o mesmo que "confirmou presença" — dois casos escapavam antes:
 *
 *  • o ingresso avulso é emitido junto com o pedido, ANTES da confirmação do
 *    pagamento; quem reservou e não pagou aparecia na lista da recepção;
 *  • quem confirmou presença como assinante e depois teve o plano cancelado
 *    continuava listado.
 *
 * O direito é apurado no momento em que a lista é gerada — por isso o PDF traz
 * data e hora da emissão, e deve ser tirado no dia do evento.
 */
export async function entryList(eventId: string): Promise<{
  event: { title: string; startsAt: Date; venueName: string | null; capacity: number | null };
  rows: EntryRow[];
  allowed: EntryRow[];
  blocked: EntryRow[];
  generatedAt: Date;
}> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      attendees: {
        where: { canceledAt: null },
        include: {
          user: {
            select: {
              fullName: true,
              cpf: true,
              phone: true,
              email: true,
              subscriptions: {
                where: { status: { in: ['ACTIVE', 'TRIALING'] }, currentPeriodEnd: { gte: new Date() } },
                select: { id: true },
                take: 1,
              },
            },
          },
          tickets: {
            select: {
              code: true,
              status: true,
              usedAt: true,
              order: { select: { status: true } },
            },
          },
        },
      },
    },
  });
  if (!event) throw notFound('Evento');

  const isPaid = (t: { order: { status: string } | null }) =>
    Boolean(t.order && (PAID_ORDER_STATUSES as readonly string[]).includes(t.order.status));

  const rows: EntryRow[] = event.attendees.map((attendee) => {
    const validos = attendee.tickets.filter(
      (t) => t.status !== 'CANCELED' && t.status !== 'REFUNDED',
    );
    // Quem reservou duas vezes e pagou uma entra: vale o ingresso pago, e é o
    // código dele que a recepção deve enxergar.
    const ticket = validos.find(isPaid) ?? validos[0] ?? attendee.tickets[0];

    let right: EntryRight;
    if (attendee.kind === 'GUEST') {
      right = 'GUEST';
    } else if (attendee.kind === 'SUBSCRIBER_RSVP') {
      right = (attendee.user?.subscriptions.length ?? 0) > 0 ? 'SUBSCRIBER' : 'SUBSCRIPTION_INACTIVE';
    } else if (validos.length === 0) {
      right = 'TICKET_CANCELED';
    } else {
      right = validos.some(isPaid) ? 'PAID_TICKET' : 'PAYMENT_PENDING';
    }

    return {
      attendeeId: attendee.id,
      name: attendee.user?.fullName ?? attendee.guestName ?? '—',
      document: attendee.user?.cpf ?? attendee.guestDocument ?? null,
      contact: attendee.user?.phone ?? attendee.guestPhone ?? attendee.guestEmail ?? null,
      kind: attendee.kind,
      ticketCode: ticket?.code ?? null,
      allowed: right === 'SUBSCRIBER' || right === 'PAID_TICKET' || right === 'GUEST',
      right,
      checkedIn: Boolean(ticket?.usedAt),
      checkedInAt: ticket?.usedAt ?? null,
    };
  });

  const byName = (a: EntryRow, b: EntryRow) => a.name.localeCompare(b.name, 'pt-BR');

  return {
    event: {
      title: event.title,
      startsAt: event.startsAt,
      venueName: event.venueName,
      capacity: event.capacity,
    },
    rows: rows.sort(byName),
    allowed: rows.filter((r) => r.allowed).sort(byName),
    blocked: rows.filter((r) => !r.allowed).sort(byName),
    generatedAt: new Date(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF da recepção
// ─────────────────────────────────────────────────────────────────────────────

const COLUMNS = [
  { label: 'Nome', x: 40, width: 168 },
  { label: 'Documento', x: 212, width: 88 },
  { label: 'Contato', x: 304, width: 92 },
  { label: 'Acesso', x: 400, width: 82 },
  { label: 'Ingresso', x: 486, width: 62 },
  { label: 'Entrou', x: 552, width: 40 },
];

/**
 * PDF que a recepção imprime. Traz apenas quem tem direito de entrar e, ao fim,
 * uma lista curta de quem foi barrado e por quê — porque essas pessoas vão
 * aparecer na porta e alguém precisa saber o que dizer.
 */
export async function attendanceListPdf(eventId: string): Promise<Buffer> {
  const list = await entryList(eventId);

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  // ── Cabeçalho ──
  doc.fontSize(17).fillColor('#000').text('CLUBE VKUDAKA', { align: 'center' });
  doc.fontSize(9).fillColor('#8C6A2F').text('LISTA DE ENTRADA', { align: 'center', characterSpacing: 3 });
  doc.moveDown(0.8);
  doc.fontSize(13).fillColor('#000').text(list.event.title, { align: 'center' });
  doc
    .fontSize(9)
    .fillColor('#555')
    .text(
      [
        list.event.startsAt.toLocaleString('pt-BR'),
        list.event.venueName,
        `${list.allowed.length} pessoa(s) liberada(s)`,
        list.event.capacity ? `capacidade ${list.event.capacity}` : null,
      ]
        .filter(Boolean)
        .join('  ·  '),
      { align: 'center' },
    );
  doc
    .fontSize(8)
    .fillColor('#777')
    .text(`Emitida em ${list.generatedAt.toLocaleString('pt-BR')}`, { align: 'center' });
  doc.moveDown(1.2);

  const header = (y: number) => {
    doc.fontSize(7.5).fillColor('#777');
    for (const col of COLUMNS) {
      doc.text(col.label.toUpperCase(), col.x, y, { width: col.width, characterSpacing: 1 });
    }
    doc.moveTo(40, y + 12).lineTo(592, y + 12).lineWidth(0.7).strokeColor('#000').stroke();
  };

  let y = doc.y;
  header(y);
  y += 19;

  for (const row of list.allowed) {
    if (y > 770) {
      doc.addPage();
      y = 50;
      header(y);
      y += 19;
    }

    const values = [
      row.name,
      row.document ?? '—',
      row.contact ?? '—',
      KIND_LABEL[row.kind],
      row.ticketCode ?? '—',
      '', // conferência manual na porta
    ];

    doc.fontSize(8.5).fillColor('#000');
    COLUMNS.forEach((col, index) => {
      doc.text(values[index] ?? '', col.x, y, { width: col.width, ellipsis: true, lineBreak: false });
    });

    // Quadradinho de conferência: a recepção risca a caneta.
    doc.rect(COLUMNS[5]!.x + 12, y - 1, 9, 9).lineWidth(0.6).strokeColor('#999').stroke();

    doc.moveTo(40, y + 13).lineTo(592, y + 13).lineWidth(0.4).strokeColor('#DDD').stroke();
    y += 18;
  }

  if (list.allowed.length === 0) {
    doc.fontSize(9).fillColor('#777').text('Ninguém liberado até o momento.', 40, y + 6);
    y += 26;
  }

  // ── Barrados ──
  if (list.blocked.length > 0) {
    if (y > 690) {
      doc.addPage();
      y = 50;
    }
    y += 16;
    doc.fontSize(8).fillColor('#9E3B32').text('NÃO LIBERADOS', 40, y, { characterSpacing: 2 });
    y += 13;
    doc
      .fontSize(7.5)
      .fillColor('#777')
      .text('Confirmaram presença mas não têm direito de entrada nesta data.', 40, y);
    y += 15;

    for (const row of list.blocked) {
      if (y > 780) {
        doc.addPage();
        y = 50;
      }
      doc.fontSize(8.5).fillColor('#000').text(row.name, 40, y, { width: 200, lineBreak: false });
      doc
        .fillColor('#9E3B32')
        .text(BLOCKED_LABEL[row.right] ?? row.right, 250, y, { width: 200, lineBreak: false });
      y += 15;
    }
  }

  // ── Rodapé com paginação ──
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // O rodapé fica ABAIXO da margem inferior; sem suspender a margem, o pdfkit
    // entende como transbordo e abre uma página em branco só para ele.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .fontSize(7.5)
      .fillColor('#999')
      .text(
        `${list.event.title}  ·  página ${i + 1} de ${range.count}`,
        40,
        doc.page.height - 34,
        { width: 552, align: 'center', lineBreak: false },
      );
    doc.page.margins.bottom = bottom;
  }

  doc.end();

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
