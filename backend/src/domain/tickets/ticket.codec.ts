import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { randomTicketCode } from '../../lib/codes.js';

/**
 * RN-07 — Ingresso.
 *
 * O QR Code carrega um payload ASSINADO (HMAC-SHA256). A portaria valida a
 * assinatura offline antes de tocar no banco: um QR forjado é descartado sem
 * consulta, e um print de tela do ingresso de outra pessoa é pego na conferência
 * de status (VALID → USED) que continua sendo feita no servidor.
 *
 * Formato: v1.<eventId>.<ticketId>.<code>.<assinatura base64url>
 */

const VERSION = 'v1';

export interface TicketPayload {
  eventId: string;
  ticketId: string;
  code: string;
}

const sign = (data: string): string =>
  createHmac('sha256', env.TICKET_HMAC_SECRET).update(data).digest('base64url');

export function encodeTicket(payload: TicketPayload): string {
  const body = [VERSION, payload.eventId, payload.ticketId, payload.code].join('.');
  return `${body}.${sign(body)}`;
}

export type DecodeResult =
  | { valid: true; payload: TicketPayload }
  | { valid: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'BAD_VERSION' };

export function decodeTicket(raw: string): DecodeResult {
  const parts = raw.trim().split('.');
  if (parts.length !== 5) return { valid: false, reason: 'MALFORMED' };

  const [version, eventId, ticketId, code, signature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== VERSION) return { valid: false, reason: 'BAD_VERSION' };

  const expected = sign([version, eventId, ticketId, code].join('.'));
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'BAD_SIGNATURE' };
  }

  return { valid: true, payload: { eventId, ticketId, code } };
}

/** Código legível impresso sobre a arte do ingresso. */
export const newTicketCode = () => randomTicketCode(10);
