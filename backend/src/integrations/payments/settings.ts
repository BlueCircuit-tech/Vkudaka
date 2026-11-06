import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { decryptSecret, SecretUnreadableError } from '../../lib/secrets.js';

/**
 * De onde vem a configuração do gateway, em ordem de precedência:
 *
 *   1. `crm`  — tela "Pagamentos" do CRM (tabela payment_settings), ativa.
 *   2. `env`  — PAYMENT_PROVIDER=mercadopago com PAYMENT_API_KEY no ambiente.
 *   3. `mock` — PAYMENT_PROVIDER=mock, ou `crm` sem nada salvo em desenvolvimento.
 *   4. `none` — nada configurado: toda cobrança recusa com mensagem clara.
 *
 * A diretoria preenche a tela uma vez e os dois apps (iOS e Android) passam a
 * cobrar de verdade, porque quem fala com o gateway é este servidor.
 */

export type PaymentSource = 'crm' | 'env' | 'mock' | 'none';

export interface Recipient {
  name?: string;
  document?: string;
  pixKey?: string;
}

export interface EffectivePaymentConfig {
  source: PaymentSource;
  provider: 'mercadopago' | 'pagarme' | 'asaas' | 'mock' | 'none';
  accessToken?: string;
  publicKey?: string;
  webhookSecret?: string;
  acceptCard: boolean;
  recipient: Recipient;
  /** Motivo de `source=none` quando havia algo salvo (ex.: cifra ilegível). */
  problem?: string;
}

const TTL_MS = 15_000;
let cache: { at: number; value: EffectivePaymentConfig } | null = null;
let warnedMock = false;

/** Chamado pelo CRM após salvar: a próxima cobrança já usa o novo valor. */
export function invalidatePaymentConfig(): void {
  cache = null;
}

const envRecipient = (): Recipient => ({
  name: env.PAYMENT_RECIPIENT_NAME,
  document: env.PAYMENT_RECIPIENT_DOCUMENT,
  pixKey: env.PAYMENT_RECIPIENT_PIX_KEY,
});

async function resolve(): Promise<EffectivePaymentConfig> {
  const row = await prisma.paymentSettings.findUnique({ where: { id: 'default' } });

  if (row?.isEnabled && row.accessTokenEnc) {
    try {
      return {
        source: 'crm',
        provider: row.provider as EffectivePaymentConfig['provider'],
        accessToken: decryptSecret(row.accessTokenEnc),
        webhookSecret: row.webhookSecretEnc ? decryptSecret(row.webhookSecretEnc) : undefined,
        publicKey: row.publicKey ?? undefined,
        acceptCard: row.acceptCard,
        recipient: {
          name: row.recipientName ?? undefined,
          document: row.recipientDocument ?? undefined,
          pixKey: row.recipientPixKey ?? undefined,
        },
      };
    } catch (error) {
      if (!(error instanceof SecretUnreadableError)) throw error;
      return {
        source: 'none',
        provider: 'none',
        acceptCard: false,
        recipient: envRecipient(),
        problem: error.message,
      };
    }
  }

  if (env.PAYMENT_PROVIDER === 'mock') {
    return { source: 'mock', provider: 'mock', acceptCard: true, recipient: envRecipient() };
  }

  if (env.PAYMENT_PROVIDER !== 'crm' && env.PAYMENT_API_KEY) {
    return {
      source: 'env',
      provider: env.PAYMENT_PROVIDER,
      accessToken: env.PAYMENT_API_KEY,
      webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
      acceptCard: false,
      recipient: envRecipient(),
    };
  }

  if (env.NODE_ENV === 'development') {
    if (!warnedMock) {
      warnedMock = true;
      console.warn('⚠ Pagamento sem configuração no CRM: usando simulação (só em desenvolvimento).');
    }
    return { source: 'mock', provider: 'mock', acceptCard: true, recipient: envRecipient() };
  }

  return { source: 'none', provider: 'none', acceptCard: false, recipient: envRecipient() };
}

export async function getPaymentConfig(): Promise<EffectivePaymentConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await resolve();
  cache = { at: Date.now(), value };
  return value;
}
