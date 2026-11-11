/**
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  MOTOR DE PRECIFICAÇÃO E ABATIMENTO — núcleo do Clube VKUDAKA          ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * Implementa RN-02 e RN-03 (docs/REGRAS-DE-NEGOCIO.md).
 *
 * Função PURA: sem Prisma, sem HTTP, sem Date.now(). Recebe números, devolve
 * números. É a ÚNICA fonte de verdade de cálculo do sistema e é consumida por:
 *
 *   • POST /orders/quote  → preview do botão "Comprar" no app
 *   • POST /orders        → cálculo definitivo, dentro da transação
 *   • CRM                 → simulador de desconto por nível
 *
 * O app NUNCA envia valores calculados. Envia intenção (itens, cupom, quanto
 * quer usar da carteira); o servidor calcula.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type RebateMode = 'CREDIT_NEXT_INVOICE' | 'IMMEDIATE_DISCOUNT';
export type CouponType = 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';
export type ItemKind = 'SALE' | 'RENTAL' | 'TICKET';

/** Motivo pelo qual o abatimento não foi concedido. Vai para Order.rebateBlockedReason. */
export type RebateBlockedReason =
  | 'WALLET_USED' // RN-02: usou crédito da carteira
  | 'NO_PLAN' // sem assinatura ativa ou plano com 0%
  | 'PERCENT_COUPON' // RN-02: não é acumulativo com outro percentual
  | 'ZERO_BASE' // nada a abater (ex.: pedido só de frete)
  | 'PROMO_ITEMS'; // só peças em promoção, que não recebem o abatimento do plano

export interface QuoteItem {
  /** Referência opcional — o motor não consulta nada, só ecoa. */
  readonly reference?: string;
  readonly kind: ItemKind;
  readonly unitPriceCents: number;
  readonly quantity: number;
  /** Peça marcada como frete grátis no catálogo (RN-08). */
  readonly freeShipping?: boolean;
  /** Peça em promoção: fica fora da base do abatimento do plano. */
  readonly noRebate?: boolean;
}

export interface QuoteCoupon {
  readonly code: string;
  readonly type: CouponType;
  /** PERCENT: 10 = 10%. FIXED: centavos. FREE_SHIPPING: ignorado. */
  readonly value: number;
  readonly minSubtotalCents?: number;
  readonly minItems?: number;
}

export interface QuoteInput {
  readonly items: readonly QuoteItem[];
  /** Percentual do plano vindo do CRM (10 = 10%). 0 para não assinante. */
  readonly rebatePercent: number;
  readonly rebateMode: RebateMode;
  /** Assinatura ativa? Não assinante não recebe abatimento (RN-01/RN-06). */
  readonly hasActiveSubscription: boolean;
  /** Saldo disponível na carteira, em centavos. */
  readonly walletBalanceCents: number;
  /** Quanto o usuário PEDIU para usar da carteira. Será limitado pelo saldo e pelo total. */
  readonly requestedWalletCents: number;
  readonly coupon?: QuoteCoupon | null;
  /** Cotação dos Correios já calculada para o CEP (0 quando retirada). */
  readonly shippingQuoteCents: number;
  /** Alguma ShippingRule do CRM zerou o frete? */
  readonly shippingRuleFreeApplied?: boolean;
}

export interface QuoteResult {
  readonly subtotalCents: number;
  readonly couponDiscountCents: number;
  readonly netItemsCents: number;
  readonly shippingCents: number;
  readonly immediateDiscountCents: number;
  readonly totalCents: number;
  readonly walletAppliedCents: number;
  readonly gatewayAmountCents: number;

  // ── Abatimento (RN-02) ──
  readonly rebateEligible: boolean;
  readonly rebateBlockedReason: RebateBlockedReason | null;
  readonly rebatePercentApplied: number;
  readonly rebateBaseCents: number;
  readonly rebateCreditCents: number;
  readonly rebateMode: RebateMode;

  /**
   * Cenário alternativo mostrado no app quando o usuário optou por usar a
   * carteira: "se você não usar saldo, ganha X de crédito na mensalidade".
   * Null quando não há escolha a apresentar.
   */
  readonly alternativeWithoutWallet: {
    readonly totalCents: number;
    readonly rebateCreditCents: number;
    readonly immediateDiscountCents: number;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuração da regra
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RN-02 — "o abatimento percentual na peça não é acumulativo".
 * Interpretação normativa: o percentual do plano não soma com outro percentual
 * (cupom PERCENT). Cupom de valor fixo e frete grátis continuam válidos, pois
 * não são percentuais sobre a peça.
 */
const ALLOW_REBATE_WITH_PERCENT_COUPON = false;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const clampToZero = (n: number) => (n > 0 ? n : 0);

/** Arredondamento monetário: uma única vez por linha de cálculo. */
const applyPercent = (baseCents: number, percent: number) =>
  Math.round((baseCents * percent) / 100);

function assertValid(input: QuoteInput): void {
  if (input.rebatePercent < 0 || input.rebatePercent > 100) {
    throw new RangeError(`rebatePercent fora do intervalo 0–100: ${input.rebatePercent}`);
  }
  if (input.walletBalanceCents < 0) {
    throw new RangeError('walletBalanceCents não pode ser negativo');
  }
  if (input.requestedWalletCents < 0) {
    throw new RangeError('requestedWalletCents não pode ser negativo');
  }
  if (input.shippingQuoteCents < 0) {
    throw new RangeError('shippingQuoteCents não pode ser negativo');
  }
  for (const item of input.items) {
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
      throw new RangeError('unitPriceCents deve ser inteiro não negativo (centavos)');
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new RangeError('quantity deve ser inteiro >= 1');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Etapas do cálculo (RN-03)
// ─────────────────────────────────────────────────────────────────────────────

function calcSubtotal(items: readonly QuoteItem[]): number {
  return items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
}

function calcCouponDiscount(
  coupon: QuoteCoupon | null | undefined,
  subtotalCents: number,
  itemCount: number,
): { discountCents: number; freeShipping: boolean; isPercent: boolean } {
  if (!coupon) return { discountCents: 0, freeShipping: false, isPercent: false };

  const meetsSubtotal = subtotalCents >= (coupon.minSubtotalCents ?? 0);
  const meetsItems = itemCount >= (coupon.minItems ?? 0);
  if (!meetsSubtotal || !meetsItems) {
    return { discountCents: 0, freeShipping: false, isPercent: false };
  }

  switch (coupon.type) {
    case 'PERCENT':
      return {
        discountCents: Math.min(applyPercent(subtotalCents, coupon.value), subtotalCents),
        freeShipping: false,
        isPercent: coupon.value > 0,
      };
    case 'FIXED':
      return {
        discountCents: Math.min(Math.round(coupon.value), subtotalCents),
        freeShipping: false,
        isPercent: false,
      };
    case 'FREE_SHIPPING':
      return { discountCents: 0, freeShipping: true, isPercent: false };
  }
}

function calcShipping(input: QuoteInput, couponFreeShipping: boolean): number {
  if (couponFreeShipping) return 0;
  if (input.shippingRuleFreeApplied) return 0;
  // Frete grátis por peça: se TODOS os itens físicos são isentos, o frete zera.
  const physical = input.items.filter((i) => i.kind !== 'TICKET');
  if (physical.length > 0 && physical.every((i) => i.freeShipping)) return 0;
  // Pedido puramente digital (ingressos) não tem frete.
  if (physical.length === 0) return 0;
  return input.shippingQuoteCents;
}

/**
 * RN-02 — decide se o abatimento é concedido.
 * A ordem dos motivos importa: WALLET_USED é a regra mais forte e é checada primeiro,
 * porque é a que o app precisa comunicar ao usuário no botão "Comprar".
 */
function evaluateRebate(params: {
  walletAppliedCents: number;
  hasActiveSubscription: boolean;
  rebatePercent: number;
  couponIsPercent: boolean;
  baseCents: number;
  /** Base sem as peças em promoção. */
  rebateBaseCents: number;
}): { eligible: boolean; reason: RebateBlockedReason | null } {
  if (params.walletAppliedCents > 0) return { eligible: false, reason: 'WALLET_USED' };
  if (!params.hasActiveSubscription || params.rebatePercent <= 0) {
    return { eligible: false, reason: 'NO_PLAN' };
  }
  if (params.couponIsPercent && !ALLOW_REBATE_WITH_PERCENT_COUPON) {
    return { eligible: false, reason: 'PERCENT_COUPON' };
  }
  if (params.baseCents <= 0) return { eligible: false, reason: 'ZERO_BASE' };
  if (params.rebateBaseCents <= 0) return { eligible: false, reason: 'PROMO_ITEMS' };
  return { eligible: true, reason: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula um pedido completo seguindo a ordem normativa da RN-03.
 *
 * Sequência (sem circularidade):
 *   1) subtotal → 2) cupom → 3) líquido → 4) frete → 5) total antes do abatimento
 *   6) carteira (limitada por 5) → 7) elegibilidade → 8) abatimento → 9) gateway
 *
 * O uso da carteira é resolvido ANTES do abatimento justamente porque é ele que
 * decide a elegibilidade (RN-02). No modo IMMEDIATE_DISCOUNT o total só encolhe
 * quando a carteira não foi usada, então o passo 6 nunca fica defasado.
 */
export function quoteOrder(input: QuoteInput): QuoteResult {
  assertValid(input);

  const itemCount = input.items.reduce((sum, i) => sum + i.quantity, 0);

  // 1 ─ Subtotal dos itens
  const subtotalCents = calcSubtotal(input.items);

  // 2 ─ Cupom
  const coupon = calcCouponDiscount(input.coupon, subtotalCents, itemCount);
  const couponDiscountCents = coupon.discountCents;

  // 3 ─ Líquido de itens (base do abatimento — nunca inclui frete)
  const netItemsCents = clampToZero(subtotalCents - couponDiscountCents);

  // 4 ─ Frete
  const shippingCents = calcShipping(input, coupon.freeShipping);

  // 5 ─ Total antes do abatimento
  const totalBeforeRebate = netItemsCents + shippingCents;

  // Peças em promoção ficam fora da base; o cupom é rateado pelo valor dos itens.
  const promoSubtotalCents = calcSubtotal(input.items.filter((i) => i.noRebate));
  const eligibleNetCents =
    promoSubtotalCents === 0
      ? netItemsCents
      : subtotalCents === 0
        ? 0
        : Math.round((netItemsCents * (subtotalCents - promoSubtotalCents)) / subtotalCents);

  const isImmediate = input.rebateMode === 'IMMEDIATE_DISCOUNT';

  const rebateFor = (walletAppliedCents: number) =>
    evaluateRebate({
      walletAppliedCents,
      hasActiveSubscription: input.hasActiveSubscription,
      rebatePercent: input.rebatePercent,
      couponIsPercent: coupon.isPercent,
      baseCents: netItemsCents,
      rebateBaseCents: eligibleNetCents,
    });

  let walletAppliedCents: number;
  let eligible: boolean;
  let reason: RebateBlockedReason | null;
  let immediateDiscountCents = 0;
  let rebateCreditCents = 0;

  if (isImmediate) {
    // Desconto fidelidade (padrão desde 2026-11-11): a mensalidade inteira já
    // virou crédito na carteira, então pagar com saldo NÃO tira o desconto.
    // O desconto sai primeiro e a carteira cobre o que sobra.
    ({ eligible, reason } = rebateFor(0));
    immediateDiscountCents = eligible ? applyPercent(eligibleNetCents, input.rebatePercent) : 0;
    walletAppliedCents = Math.min(
      input.requestedWalletCents,
      input.walletBalanceCents,
      clampToZero(totalBeforeRebate - immediateDiscountCents),
    );
  } else {
    // 6 ─ Carteira: limitada pelo saldo e pelo total
    walletAppliedCents = Math.min(
      input.requestedWalletCents,
      input.walletBalanceCents,
      totalBeforeRebate,
    );
    // 7 ─ Elegibilidade: no modo crédito, usar a carteira bloqueia (RN-02 original)
    ({ eligible, reason } = rebateFor(walletAppliedCents));
    // 8 ─ Crédito para a próxima mensalidade
    rebateCreditCents = eligible ? applyPercent(eligibleNetCents, input.rebatePercent) : 0;
  }

  const rebateBaseCents = eligible ? eligibleNetCents : 0;
  const totalCents = clampToZero(totalBeforeRebate - immediateDiscountCents);

  // 9 ─ Diferença a pagar no gateway ("inteirar o valor" — 2.6)
  const gatewayAmountCents = clampToZero(totalCents - walletAppliedCents);

  return {
    subtotalCents,
    couponDiscountCents,
    netItemsCents,
    shippingCents,
    immediateDiscountCents,
    totalCents,
    walletAppliedCents,
    gatewayAmountCents,
    rebateEligible: eligible,
    rebateBlockedReason: reason,
    rebatePercentApplied: eligible ? input.rebatePercent : 0,
    rebateBaseCents,
    rebateCreditCents,
    rebateMode: input.rebateMode,
    alternativeWithoutWallet: buildAlternative(input, walletAppliedCents),
  };
}

/**
 * Quando o usuário escolheu usar saldo, o app precisa mostrar o que ele abre mão
 * (RN-02). Recalcula o mesmo pedido com `requestedWalletCents = 0`.
 */
function buildAlternative(
  input: QuoteInput,
  walletAppliedCents: number,
): QuoteResult['alternativeWithoutWallet'] {
  // No desconto fidelidade a carteira não muda o benefício: não há escolha a mostrar.
  if (walletAppliedCents === 0 || input.rebateMode === 'IMMEDIATE_DISCOUNT') return null;
  const withoutWallet = quoteOrder({ ...input, requestedWalletCents: 0 });
  if (!withoutWallet.rebateEligible) return null;
  return {
    totalCents: withoutWallet.totalCents,
    rebateCreditCents: withoutWallet.rebateCreditCents,
    immediateDiscountCents: withoutWallet.immediateDiscountCents,
  };
}

/**
 * Texto curto exibido junto ao botão "Comprar" (2.3 / 3.2).
 * Fica no domínio para que app e CRM digam exatamente a mesma coisa.
 */
export function describeRebate(quote: QuoteResult): string {
  if (quote.rebateEligible && quote.rebateMode === 'CREDIT_NEXT_INVOICE') {
    return `Esta compra gera ${formatBRL(quote.rebateCreditCents)} de crédito na sua próxima mensalidade.`;
  }
  if (quote.rebateEligible) {
    return `Desconto fidelidade de ${quote.rebatePercentApplied}% (${formatBRL(quote.immediateDiscountCents)}) já aplicado nesta compra.`;
  }
  switch (quote.rebateBlockedReason) {
    case 'WALLET_USED':
      return quote.alternativeWithoutWallet
        ? `Ao usar o saldo da carteira você abre mão de ${formatBRL(
            quote.alternativeWithoutWallet.rebateCreditCents,
          )} de crédito na próxima mensalidade.`
        : 'O abatimento não se aplica quando você usa saldo da carteira.';
    case 'PERCENT_COUPON':
      return 'O cupom percentual substitui o abatimento do plano — os dois não se somam.';
    case 'PROMO_ITEMS':
      return 'Peça em promoção: o desconto do plano não se soma ao valor promocional.';
    case 'NO_PLAN':
      return quote.rebateMode === 'IMMEDIATE_DISCOUNT'
        ? 'Assine o clube para ter desconto fidelidade em toda compra.'
        : 'Assine o clube para gerar crédito de mensalidade a cada compra.';
    default:
      return '';
  }
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
