import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import type {
  ChargeRequest,
  ChargeResult,
  PaymentProvider,
  WebhookContext,
  WebhookEvent,
} from './gateway.js';

/**
 * Mercado Pago — API de Pagamentos (Checkout Transparente).
 *
 * Pix: `POST /v1/payments` com `payment_method_id=pix` devolve o copia-e-cola
 * e o QR em base64; a confirmação chega pelo webhook. Cartão: só com `cardToken`
 * gerado pelo SDK do Mercado Pago no app — o backend nunca vê o número.
 *
 * Webhook: o cabeçalho `x-signature` traz `ts` e `v1`; a assinatura é o
 * HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com a
 * "assinatura secreta" copiada do painel. O aviso não traz o status: depois de
 * validar, consultamos `GET /v1/payments/{id}`.
 *
 * Sem SDK: a API é REST simples e `fetch` é nativo no Node 20.
 */

const API = 'https://api.mercadopago.com';

export interface MercadoPagoConfig {
  accessToken: string;
  publicKey?: string;
  webhookSecret?: string;
  notificationUrl: string;
  recipientRef: string;
}

interface MpPayment {
  id: number;
  status: string;
  status_detail?: string;
  date_approved?: string | null;
  date_of_expiration?: string | null;
  payment_method_id?: string;
  card?: { last_four_digits?: string };
  point_of_interaction?: {
    transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string };
  };
}

export class MercadoPagoApiError extends AppError {
  constructor(status: number, message: string, details?: unknown) {
    super(502, 'PAYMENT_GATEWAY_ERROR', `Mercado Pago: ${message}`, { status, details });
  }
}

export async function mpFetch<T>(
  accessToken: string,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.idempotencyKey ? { 'X-Idempotency-Key': init.idempotencyKey } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
    cause?: unknown;
  };
  if (!response.ok) {
    throw new MercadoPagoApiError(
      response.status,
      payload.message ?? payload.error ?? `HTTP ${response.status}`,
      payload.cause,
    );
  }
  return payload as T;
}

/** Status do Mercado Pago → status do clube. `null` = nada a fazer ainda. */
export function mapStatus(status: string): WebhookEvent['status'] | null {
  switch (status) {
    case 'approved':
      return 'PAID';
    case 'rejected':
    case 'cancelled':
      return 'FAILED';
    case 'refunded':
      return 'REFUNDED';
    case 'charged_back':
      return 'CHARGEBACK';
    default:
      return null; // pending, in_process, authorized, in_mediation
  }
}

/**
 * Monta o texto assinado exatamente como o painel documenta: cada parte só
 * entra se existir, e um `data.id` alfanumérico vai em minúsculas.
 */
export function buildManifest(parts: { dataId?: string; requestId?: string; ts?: string }): string {
  let manifest = '';
  if (parts.dataId) {
    const id = /^[0-9]+$/.test(parts.dataId) ? parts.dataId : parts.dataId.toLowerCase();
    manifest += `id:${id};`;
  }
  if (parts.requestId) manifest += `request-id:${parts.requestId};`;
  if (parts.ts) manifest += `ts:${parts.ts};`;
  return manifest;
}

export function verifyMercadoPagoSignature(
  secret: string,
  header: string | undefined,
  parts: { dataId?: string; requestId?: string },
): boolean {
  if (!header) return false;
  const fields = Object.fromEntries(
    header.split(',').map((piece) => {
      const [k, ...rest] = piece.trim().split('=');
      return [k?.trim() ?? '', rest.join('=').trim()];
    }),
  ) as Record<string, string>;
  const ts = fields.ts;
  const v1 = fields.v1;
  if (!ts || !v1) return false;

  const expected = createHmac('sha256', secret).update(buildManifest({ ...parts, ts })).digest();
  let received: Buffer;
  try {
    received = Buffer.from(v1, 'hex');
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

const splitName = (full: string): { first: string; last: string } => {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? full, last: parts.slice(1).join(' ') || (parts[0] ?? full) };
};

const identification = (document: string) => ({
  type: document.replace(/\D/g, '').length > 11 ? 'CNPJ' : 'CPF',
  number: document.replace(/\D/g, ''),
});

const firstString = (value: unknown): string | undefined => {
  if (Array.isArray(value)) return firstString(value[0]);
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
};

export function createMercadoPagoProvider(config: MercadoPagoConfig): PaymentProvider {
  const payer = (customer: ChargeRequest['customer']) => {
    const name = splitName(customer.name);
    return {
      email: customer.email,
      first_name: name.first,
      last_name: name.last,
      identification: identification(customer.document),
    };
  };

  const toResult = (payment: MpPayment): ChargeResult => {
    const status = mapStatus(payment.status);
    const data = payment.point_of_interaction?.transaction_data;
    return {
      provider: 'mercadopago',
      externalId: String(payment.id),
      status:
        status === 'PAID'
          ? 'PAID'
          : status === 'FAILED'
            ? 'FAILED'
            : payment.status === 'authorized'
              ? 'AUTHORIZED'
              : 'PENDING',
      pixQrCode: data?.qr_code_base64,
      pixCopyPaste: data?.qr_code,
      cardBrand: payment.card ? payment.payment_method_id?.toUpperCase() : undefined,
      cardLast4: payment.card?.last_four_digits,
      recipientRef: config.recipientRef,
      expiresAt: payment.date_of_expiration ? new Date(payment.date_of_expiration) : undefined,
    };
  };

  return {
    name: 'mercadopago',

    async charge(request) {
      const base = {
        transaction_amount: Number((request.amountCents / 100).toFixed(2)),
        description: request.description,
        external_reference: request.orderId ?? request.invoiceId ?? randomUUID(),
        notification_url: config.notificationUrl,
        payer: payer(request.customer),
      };

      if (request.method === 'PIX') {
        const payment = await mpFetch<MpPayment>(config.accessToken, '/v1/payments', {
          method: 'POST',
          idempotencyKey: randomUUID(),
          body: {
            ...base,
            payment_method_id: 'pix',
            date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          },
        });
        return toResult(payment);
      }

      if (!request.cardToken) {
        throw new AppError(
          400,
          'CARD_NOT_AVAILABLE',
          'Pagamento com cartão ainda não está disponível no app. Pague com Pix.',
        );
      }

      // O token só carrega os seis primeiros dígitos; a bandeira vem da busca por BIN.
      const card = await mpFetch<{ first_six_digits?: string }>(
        config.accessToken,
        `/v1/card_tokens/${encodeURIComponent(request.cardToken)}`,
      );
      const query = new URLSearchParams({
        bin: card.first_six_digits ?? '',
        marketplace: 'NONE',
        status: 'active',
        ...(config.publicKey ? { public_key: config.publicKey } : {}),
      });
      const methods = await mpFetch<{ results?: Array<{ id: string }> }>(
        config.accessToken,
        `/v1/payment_methods/search?${query.toString()}`,
      );
      const paymentMethodId = methods.results?.[0]?.id;
      if (!paymentMethodId) {
        throw new AppError(400, 'CARD_BRAND_UNKNOWN', 'Bandeira do cartão não reconhecida.');
      }

      const payment = await mpFetch<MpPayment>(config.accessToken, '/v1/payments', {
        method: 'POST',
        idempotencyKey: randomUUID(),
        body: {
          ...base,
          token: request.cardToken,
          installments: request.installments ?? 1,
          payment_method_id: paymentMethodId,
        },
      });
      const result = toResult(payment);
      if (result.status === 'FAILED') {
        throw new AppError(402, 'CARD_REJECTED', `Cartão recusado (${payment.status_detail ?? 'sem detalhe'}).`);
      }
      return result;
    },

    async refund(externalId, amountCents) {
      await mpFetch(config.accessToken, `/v1/payments/${encodeURIComponent(externalId)}/refunds`, {
        method: 'POST',
        idempotencyKey: randomUUID(),
        body: amountCents > 0 ? { amount: Number((amountCents / 100).toFixed(2)) } : {},
      });
    },

    async parseWebhook(ctx: WebhookContext) {
      let body: { type?: string; topic?: string; action?: string; data?: { id?: unknown } } = {};
      try {
        body = ctx.rawBody ? (JSON.parse(ctx.rawBody) as typeof body) : {};
      } catch {
        body = {};
      }

      const dataId =
        firstString(ctx.query['data.id']) ??
        firstString(ctx.query['data_id']) ??
        firstString(body.data?.id) ??
        firstString(ctx.query['id']);
      const requestId = firstString(ctx.headers['x-request-id']);
      const signature = firstString(ctx.headers['x-signature']);

      if (!config.webhookSecret) {
        throw new AppError(401, 'WEBHOOK_SECRET_MISSING', 'Assinatura secreta do webhook não configurada no CRM.');
      }
      if (!verifyMercadoPagoSignature(config.webhookSecret, signature, { dataId, requestId })) {
        throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Assinatura do webhook inválida.');
      }

      const topic = body.type ?? firstString(ctx.query['type']) ?? body.topic ?? firstString(ctx.query['topic']);
      if (topic !== 'payment' || !dataId) return null;

      let payment: MpPayment;
      try {
        payment = await mpFetch<MpPayment>(config.accessToken, `/v1/payments/${encodeURIComponent(dataId)}`);
      } catch (error) {
        // O painel envia um aviso de teste com id inexistente: responder 200 é o
        // que faz o teste passar lá — e não há pagamento nosso para casar.
        if (error instanceof MercadoPagoApiError && (error.details as { status: number }).status === 404) {
          return null;
        }
        throw error;
      }

      const status = mapStatus(payment.status);
      if (!status) return null;

      return {
        externalId: String(payment.id),
        status,
        paidAt: payment.date_approved ? new Date(payment.date_approved) : undefined,
        raw: payment,
      };
    },
  };
}

/** Conta dona do token — usado pelo botão "Testar conexão" do CRM. */
export async function describeAccount(accessToken: string): Promise<{
  id: number;
  nickname?: string;
  email?: string;
  siteId?: string;
}> {
  const me = await mpFetch<{ id: number; nickname?: string; email?: string; site_id?: string }>(
    accessToken,
    '/users/me',
  );
  return { id: me.id, nickname: me.nickname, email: me.email, siteId: me.site_id };
}
