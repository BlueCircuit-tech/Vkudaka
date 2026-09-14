import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Gateway de pagamento (2.6 / RN-10).
 *
 * A interface é do clube; o provedor é configuração. Isso é o que permite:
 *   • usar Pix/cartão no ambiente web hoje;
 *   • trocar por StoreKit/Play Billing na publicação (fase 6) sem mexer no
 *     checkout, apenas registrando outro provider.
 *
 * RN-10 — todo recebimento é roteado para a conta recebedora configurada em
 * PAYMENT_RECIPIENT_*. O identificador da conta viaja como `recipientRef`;
 * dados bancários nunca são versionados nem trafegam pela API do app.
 */

export type ChargeMethod = 'PIX' | 'CREDIT_CARD';

export interface ChargeRequest {
  orderId?: string;
  invoiceId?: string;
  amountCents: number;
  method: ChargeMethod;
  description: string;
  installments?: number;
  customer: { name: string; email: string; document: string; phone?: string };
  /** Token do cartão gerado no app — o backend nunca recebe PAN. */
  cardToken?: string;
}

export interface ChargeResult {
  provider: string;
  externalId: string;
  status: 'PENDING' | 'AUTHORIZED' | 'PAID' | 'FAILED';
  pixQrCode?: string;
  pixCopyPaste?: string;
  cardBrand?: string;
  cardLast4?: string;
  recipientRef: string;
  expiresAt?: Date;
}

export interface WebhookEvent {
  externalId: string;
  status: 'PAID' | 'FAILED' | 'REFUNDED' | 'CHARGEBACK';
  paidAt?: Date;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  refund(externalId: string, amountCents: number): Promise<void>;
  /** Valida a assinatura do webhook e normaliza o evento. */
  parseWebhook(rawBody: string, signature: string | undefined): WebhookEvent;
}

/** Referência opaca da conta recebedora — o suficiente para auditoria. */
export function recipientRef(): string {
  const doc = env.PAYMENT_RECIPIENT_DOCUMENT;
  if (!doc) return 'recipient:unset';
  return `recipient:${doc.slice(0, 3)}***${doc.slice(-2)}`;
}

/** Provider de desenvolvimento: aprova Pix por webhook manual e cartão na hora. */
const mockProvider: PaymentProvider = {
  name: 'mock',

  async charge(request) {
    const externalId = `mock_${randomUUID()}`;
    if (request.method === 'PIX') {
      return {
        provider: 'mock',
        externalId,
        status: 'PENDING',
        pixQrCode: `00020126VKUDAKA${request.amountCents}`,
        pixCopyPaste: `00020126580014BR.GOV.BCB.PIX0136${externalId}5204000053039865802BR`,
        recipientRef: recipientRef(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      };
    }
    return {
      provider: 'mock',
      externalId,
      status: 'PAID',
      cardBrand: 'VISA',
      cardLast4: '4242',
      recipientRef: recipientRef(),
    };
  },

  async refund() {
    /* no-op no mock */
  },

  parseWebhook(rawBody) {
    const body = JSON.parse(rawBody) as { externalId: string; status: WebhookEvent['status'] };
    return { externalId: body.externalId, status: body.status, paidAt: new Date(), raw: body };
  },
};

/**
 * Confere a assinatura HMAC-SHA256 do webhook sobre o corpo bruto.
 *
 * Fica aqui, e não em cada adapter, porque é a parte que não pode sair errada:
 * a comparação é feita em tempo constante para não vazar o segredo byte a byte,
 * e um comprimento diferente é tratado como falha em vez de estourar exceção.
 * Cada provedor tem seu formato de cabeçalho — o adapter extrai o hexadecimal e
 * chama esta função.
 */
export function verifySignature(rawBody: string, signatureHex: string | undefined): boolean {
  if (!signatureHex || !env.PAYMENT_WEBHOOK_SECRET) return false;

  const expected = createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signatureHex.trim().replace(/^sha256=/, ''), 'hex');
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

/**
 * Provedores reais: o encaixe está pronto, a implementação é a etapa seguinte.
 *
 * O que cada adapter precisa entregar, além de falar com a API do parceiro:
 *
 *   charge()        recebe valor em centavos e, no cartão, apenas `cardToken` —
 *                   o backend nunca vê o número. Devolve `externalId` (a chave
 *                   que o webhook usará para reencontrar o pagamento), o status
 *                   normalizado e, no Pix, o copia-e-cola.
 *   refund()        estorno parcial ou total, em centavos.
 *   parseWebhook()  valida a assinatura com `verifySignature` (ou o esquema
 *                   próprio do parceiro) e normaliza o evento. Assinatura
 *                   inválida deve lançar — nunca devolver um evento.
 *   recipientRef    RN-10: toda cobrança é roteada para a conta recebedora
 *                   configurada em PAYMENT_RECIPIENT_*.
 *
 * Enquanto não existir, qualquer tentativa de cobrar falha aqui, alto e claro,
 * em vez de simular uma aprovação que não houve.
 */
const pendingIntegration = (name: string): PaymentProvider => {
  const missing = (method: string) =>
    new Error(
      `Integração de pagamento pendente: ${name}.${method}() ainda não foi implementado. ` +
        `Escrever o adapter em backend/src/integrations/payments/ e registrá-lo aqui — ` +
        `ver docs/INTEGRACOES.md § 1.`,
    );

  return {
    name,
    async charge() {
      throw missing('charge');
    },
    async refund() {
      throw missing('refund');
    },
    parseWebhook() {
      throw missing('parseWebhook');
    },
  };
};

/**
 * O `mock` só é alcançável quando alguém pedir explicitamente em
 * desenvolvimento — `config/env.ts` derruba o boot se ele aparecer em qualquer
 * outro ambiente.
 */
export const paymentProvider: PaymentProvider =
  env.PAYMENT_PROVIDER === 'mock' ? mockProvider : pendingIntegration(env.PAYMENT_PROVIDER);
