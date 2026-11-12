import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { createMercadoPagoProvider } from './mercadopago.js';
import { getPaymentConfig, type EffectivePaymentConfig } from './settings.js';

/**
 * Gateway de pagamento (2.6 / RN-10).
 *
 * A interface é do clube; o provedor é configuração. Isso é o que permite:
 *   • usar Pix/cartão no ambiente web hoje;
 *   • trocar por StoreKit/Play Billing na publicação (fase 6) sem mexer no
 *     checkout, apenas registrando outro provider.
 *
 * RN-10 — todo recebimento é roteado para a conta recebedora configurada na
 * tela "Pagamentos" do CRM (ou em PAYMENT_RECIPIENT_*). O identificador da
 * conta viaja como `recipientRef`; dados bancários nunca são versionados nem
 * trafegam pela API do app.
 *
 * O provedor é resolvido a cada cobrança (`getPaymentProvider()`), porque a
 * diretoria pode colar as credenciais no CRM com o servidor no ar — e os dois
 * apps passam a cobrar de verdade sem deploy.
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
  /**
   * Referência nossa gravada na cobrança. É por ela que um pagamento feito num
   * link (Checkout Pro) é casado: o id do pagamento só nasce quando o cliente
   * paga, então não há como guardá-lo antes.
   */
  externalReference?: string;
  /** Valor efetivamente pago, quando o provedor informa. */
  amountCents?: number;
  /** Meio usado pelo cliente, quando o provedor informa (link aceita vários). */
  method?: 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'ACCOUNT_MONEY' | 'MANUAL';
  raw: unknown;
}

/**
 * Link de pagamento hospedado pelo provedor (Checkout Pro no Mercado Pago):
 * o cliente escolhe Pix ou cartão na página do próprio gateway — o app não
 * precisa de SDK de cartão. A confirmação chega pelo mesmo webhook.
 */
export interface CheckoutLinkRequest {
  /** Volta no webhook como `externalReference` (ex.: `plan:<uuid>`). */
  reference: string;
  title: string;
  description: string;
  amountCents: number;
  expiresAt: Date;
  customer: { name: string; email: string; document: string };
  /** Página para onde o cliente volta depois de pagar. */
  returnUrl: string;
}

export interface CheckoutLinkResult {
  provider: string;
  preferenceId: string;
  url: string;
}

/** Tudo o que um webhook traz: corpo bruto, cabeçalhos e query string. */
export interface WebhookContext {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: string;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  refund(externalId: string, amountCents: number): Promise<void>;
  /**
   * Valida a assinatura do webhook e normaliza o evento. Assinatura inválida
   * lança; `null` significa "aviso legítimo, mas sem nada a processar"
   * (ex.: pagamento ainda pendente, ou tópico que não é pagamento).
   */
  parseWebhook(ctx: WebhookContext): Promise<WebhookEvent | null>;
  createCheckoutLink(request: CheckoutLinkRequest): Promise<CheckoutLinkResult>;
}

/** Referência opaca da conta recebedora — o suficiente para auditoria. */
export function recipientRef(document?: string): string {
  const doc = document ?? env.PAYMENT_RECIPIENT_DOCUMENT;
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

  async parseWebhook({ rawBody }) {
    const body = JSON.parse(rawBody) as {
      externalId: string;
      status: WebhookEvent['status'];
      externalReference?: string;
      amountCents?: number;
      method?: WebhookEvent['method'];
    };
    return {
      externalId: body.externalId,
      status: body.status,
      paidAt: new Date(),
      externalReference: body.externalReference,
      amountCents: body.amountCents,
      method: body.method,
      raw: body,
    };
  },

  /**
   * Em desenvolvimento não há página de pagamento: simule a aprovação com
   * POST /webhooks/payments {"externalId":"qualquer","status":"PAID",
   * "externalReference":"<reference>"}.
   */
  async createCheckoutLink(request) {
    const preferenceId = `mock_pref_${randomUUID()}`;
    return {
      provider: 'mock',
      preferenceId,
      url: `${env.API_PUBLIC_URL}/payments/mock-checkout?ref=${encodeURIComponent(request.reference)}`,
    };
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
 * Provedores sem adapter ainda (Pagar.me, Asaas): o encaixe está pronto, a
 * implementação é a etapa seguinte. Enquanto não existir, qualquer tentativa de
 * cobrar falha aqui, alto e claro, em vez de simular uma aprovação que não houve.
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
    async parseWebhook() {
      throw missing('parseWebhook');
    },
    async createCheckoutLink() {
      throw missing('createCheckoutLink');
    },
  };
};

/** Nada configurado: o app recebe um motivo que a diretoria entende. */
const unconfigured = (problem?: string): PaymentProvider => {
  const error = () =>
    new AppError(
      503,
      'PAYMENT_NOT_CONFIGURED',
      problem ??
        'Pagamento ainda não configurado. Acesse CRM › Pagamentos, cole as credenciais do Mercado Pago e salve.',
    );
  return {
    name: 'none',
    async charge() {
      throw error();
    },
    async refund() {
      throw error();
    },
    async parseWebhook() {
      throw error();
    },
    async createCheckoutLink() {
      throw error();
    },
  };
};

function buildProvider(config: EffectivePaymentConfig): PaymentProvider {
  switch (config.provider) {
    case 'mock':
      return mockProvider;
    case 'mercadopago':
      return createMercadoPagoProvider({
        accessToken: config.accessToken ?? '',
        publicKey: config.publicKey,
        webhookSecret: config.webhookSecret,
        notificationUrl: `${env.API_PUBLIC_URL}/webhooks/payments`,
        recipientRef: recipientRef(config.recipient.document),
      });
    case 'pagarme':
    case 'asaas':
      return pendingIntegration(config.provider);
    default:
      return unconfigured(config.problem);
  }
}

/**
 * Provedor efetivo neste instante. O `mock` só é alcançável em
 * desenvolvimento — `config/env.ts` derruba o boot se ele aparecer em qualquer
 * outro ambiente, e `settings.ts` só cai nele sem nada configurado em dev.
 */
export async function getPaymentProvider(): Promise<PaymentProvider> {
  return buildProvider(await getPaymentConfig());
}
