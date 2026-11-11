/**
 * Tradução dos enums do banco para a língua da casa.
 *
 * Um painel que mostra "PAID" ou "RETURN_PENDING" na tela expõe o esquema do
 * banco para quem só quer saber se o pedido saiu. Tudo o que a diretoria lê
 * passa por aqui.
 */

export type Tone = 'neutral' | 'gold' | 'ok' | 'danger';

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING_PAYMENT: { label: 'Aguardando pagamento', tone: 'neutral' },
  PAID: { label: 'Pago', tone: 'ok' },
  PROCESSING: { label: 'Em separação', tone: 'gold' },
  SHIPPED: { label: 'Enviado', tone: 'gold' },
  DELIVERED: { label: 'Entregue', tone: 'ok' },
  RETURN_PENDING: { label: 'Aguardando devolução', tone: 'gold' },
  RETURNED: { label: 'Devolvido', tone: 'neutral' },
  CANCELED: { label: 'Cancelado', tone: 'danger' },
  REFUNDED: { label: 'Estornado', tone: 'danger' },
};

export const ORDER_TYPE: Record<string, string> = {
  SALE: 'Venda',
  RENTAL: 'Aluguel',
  TICKET: 'Ingresso',
  WALLET_TOPUP: 'Recarga',
  SUBSCRIPTION: 'Assinatura',
};

export const EVENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Rascunho', tone: 'neutral' },
  PUBLISHED: { label: 'Publicado', tone: 'ok' },
  CANCELED: { label: 'Cancelado', tone: 'danger' },
  FINISHED: { label: 'Encerrado', tone: 'neutral' },
};

export const PRODUCT_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Rascunho', tone: 'neutral' },
  PUBLISHED: { label: 'No app', tone: 'ok' },
  ARCHIVED: { label: 'Arquivada', tone: 'neutral' },
};

export const CREDIT_STATUS: Record<string, { label: string; tone: Tone }> = {
  AVAILABLE: { label: 'Disponível', tone: 'ok' },
  PARTIALLY_APPLIED: { label: 'Usado em parte', tone: 'gold' },
  APPLIED: { label: 'Usado', tone: 'neutral' },
  CANCELED: { label: 'Cancelado', tone: 'danger' },
};

/** Movimentos da carteira (créditos VKUDAKA). */
export const WALLET_TX_TYPE: Record<string, { label: string; tone: Tone }> = {
  SUBSCRIPTION: { label: 'Créditos da assinatura', tone: 'gold' },
  TOPUP: { label: 'Recarga', tone: 'ok' },
  PURCHASE: { label: 'Compra', tone: 'neutral' },
  REFUND: { label: 'Estorno', tone: 'ok' },
  ADJUSTMENT_CREDIT: { label: 'Ajuste (+)', tone: 'neutral' },
  ADJUSTMENT_DEBIT: { label: 'Ajuste (−)', tone: 'danger' },
};

export const SUBSCRIPTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  TRIALING: { label: 'Em teste', tone: 'gold' },
  ACTIVE: { label: 'Ativa', tone: 'ok' },
  PAST_DUE: { label: 'Em atraso', tone: 'danger' },
  PAUSED: { label: 'Pausada', tone: 'neutral' },
  CANCELED: { label: 'Cancelada', tone: 'danger' },
  EXPIRED: { label: 'Expirada', tone: 'neutral' },
};

export const MODEL_STATUS: Record<string, { label: string; tone: Tone }> = {
  RECEIVED: { label: 'Recebida', tone: 'neutral' },
  IN_REVIEW: { label: 'Em análise', tone: 'gold' },
  APPROVED: { label: 'Aprovada', tone: 'ok' },
  REJECTED: { label: 'Recusada', tone: 'danger' },
};

/** Classe da pílula a partir do tom. */
export const tagClass = (tone: Tone = 'neutral'): string =>
  tone === 'neutral' ? 'tag dot' : `tag dot ${tone}`;

/** Rótulo + tom com fallback seguro para enum novo que ainda não foi traduzido. */
export const describe = (
  map: Record<string, { label: string; tone: Tone }>,
  key: string | null | undefined,
): { label: string; tone: Tone } =>
  (key && map[key]) || { label: key ?? '—', tone: 'neutral' };
