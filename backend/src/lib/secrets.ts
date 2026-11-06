import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Cofre mínimo para segredos que a diretoria cola no CRM (token do gateway,
 * assinatura do webhook). Ficam no banco, mas cifrados: um dump do Postgres
 * não entrega a chave da conta do Mercado Pago.
 *
 * AES-256-GCM com chave derivada de SETTINGS_ENCRYPTION_KEY (ou, na falta
 * dela, do JWT_SECRET). Trocar essa chave torna o que está salvo ilegível —
 * o CRM avisa e basta colar as credenciais de novo.
 */

const PREFIX = 'enc:v1:';

const key = (): Buffer =>
  createHash('sha256')
    .update(env.SETTINGS_ENCRYPTION_KEY ?? env.JWT_SECRET)
    .digest();

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${body.toString('base64')}`;
}

export class SecretUnreadableError extends Error {
  constructor() {
    super('Segredo gravado com outra chave de cifragem — salve as credenciais novamente.');
    this.name = 'SecretUnreadableError';
  }
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) throw new SecretUnreadableError();
  const [ivB64, tagB64, bodyB64] = stored.slice(PREFIX.length).split(':');
  if (!ivB64 || !tagB64 || !bodyB64) throw new SecretUnreadableError();
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(bodyB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new SecretUnreadableError();
  }
}

/** Para exibir no CRM sem revelar: `APP_USR-…9f3c`. */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const head = value.includes('-') ? value.slice(0, value.indexOf('-') + 1) : '';
  return `${head}…${value.slice(-4)}`;
}
