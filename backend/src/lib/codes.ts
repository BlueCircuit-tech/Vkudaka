import { randomBytes, randomInt } from 'node:crypto';

/** Alfabeto sem caracteres ambíguos (0/O, 1/I/L) — código lido em voz alta na portaria. */
const UNAMBIGUOUS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomTicketCode(length = 10): string {
  let out = '';
  for (let i = 0; i < length; i++) out += UNAMBIGUOUS[randomInt(UNAMBIGUOUS.length)];
  return out.replace(/(.{5})(?=.)/g, '$1-'); // ABCDE-FGHJK
}

/** Código sequencial legível do pedido: VK-2026-000123 */
export function orderCode(sequence: number, year = new Date().getFullYear()): string {
  return `VK-${year}-${String(sequence).padStart(6, '0')}`;
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('hex');
