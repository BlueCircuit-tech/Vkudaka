import { Prisma } from '@prisma/client';
import type { OrderType } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { orderCode } from '../../lib/codes.js';
import { decimalToNumber, formatBRL } from '../../lib/money.js';
import {
  quoteOrder,
  describeRebate,
  type QuoteCoupon,
  type QuoteInput,
  type QuoteItem,
  type QuoteResult,
} from '../../domain/pricing/pricing.js';
import * as wallet from '../../domain/wallet/wallet.service.js';
import * as credits from '../../domain/credits/credits.service.js';
import { getRebateSettings, quarterlyRentalStatus } from '../subscriptions/subscriptions.service.js';
import { applyQuarterlyRental } from '../../domain/rental/quarterly.js';
import { notifyTrigger } from '../notifications/notifications.service.js';
import { quoteShipping, resolveFreeShipping } from '../shipping/shipping.service.js';

/**
 * Checkout (2.3 / 2.6 / RN-02 / RN-03).
 *
 * Princípio: o cliente envia INTENÇÃO, o servidor calcula VALOR.
 * `buildQuote` é usada tanto no preview do botão "Comprar" quanto dentro da
 * transação de criação — o preço mostrado e o cobrado saem da mesma função.
 */

export interface CheckoutItemInput {
  variantId?: string;
  productId?: string;
  ticketTypeId?: string;
  quantity: number;
  kind: OrderType;
}

export interface CheckoutInput {
  userId: string;
  items: CheckoutItemInput[];
  addressId?: string;
  shippingService?: 'PAC' | 'SEDEX' | 'PICKUP';
  couponCode?: string;
  /** Quanto o usuário quer usar da carteira. 0 = compra "limpa" (gera abatimento). */
  useWalletCents: number;
  rentalStartDate?: Date;
  notes?: string;
}

interface ResolvedItem {
  input: CheckoutItemInput;
  quoteItem: QuoteItem;
  snapshot: {
    productId: string | null;
    variantId: string | null;
    ticketTypeId: string | null;
    nameSnapshot: string;
    skuSnapshot: string | null;
    sizeSnapshot: string | null;
    colorSnapshot: string | null;
    imageSnapshot: string | null;
  };
  weightGrams: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolução dos itens a partir do catálogo (preço NUNCA vem do cliente)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveItems(tx: Tx, items: CheckoutItemInput[]): Promise<ResolvedItem[]> {
  if (items.length === 0) throw badRequest('EMPTY_CART', 'Nenhum item no pedido.');

  const resolved: ResolvedItem[] = [];

  for (const item of items) {
    if (item.kind === 'TICKET') {
      const type = await tx.eventTicketType.findUnique({
        where: { id: item.ticketTypeId },
        include: { event: { select: { title: true, status: true, coverUrl: true } } },
      });
      if (!type || !type.isActive) throw notFound('Ingresso');
      if (type.event.status !== 'PUBLISHED') throw conflict('EVENT_CLOSED', 'Evento indisponível.');
      if (type.sold + item.quantity > type.quantity) {
        throw conflict('TICKETS_SOLD_OUT', 'Ingressos esgotados.');
      }

      resolved.push({
        input: item,
        quoteItem: {
          kind: 'TICKET',
          unitPriceCents: type.priceCents,
          quantity: item.quantity,
          reference: type.id,
        },
        snapshot: {
          productId: null,
          variantId: null,
          ticketTypeId: type.id,
          nameSnapshot: `${type.event.title} — ${type.name}`,
          skuSnapshot: null,
          sizeSnapshot: null,
          colorSnapshot: null,
          imageSnapshot: type.event.coverUrl,
        },
        weightGrams: 0,
      });
      continue;
    }

    const variant = await tx.productVariant.findUnique({
      where: { id: item.variantId },
      include: {
        product: { include: { images: { where: { isCover: true }, take: 1 } } },
      },
    });
    if (!variant || !variant.isActive) throw notFound('Peça');

    const product = variant.product;
    if (product.status !== 'PUBLISHED' || product.deletedAt) {
      throw conflict('PRODUCT_UNAVAILABLE', `"${product.name}" não está disponível.`);
    }

    const isRental = item.kind === 'RENTAL';
    // 3.3 — a peça só pode ser vendida/alugada conforme sua disponibilidade.
    const allowed =
      product.availability === 'BOTH' || product.availability === (isRental ? 'RENTAL' : 'SALE');
    if (!allowed) {
      throw conflict(
        'AVAILABILITY_MISMATCH',
        `"${product.name}" não está disponível para ${isRental ? 'aluguel' : 'compra'}.`,
      );
    }

    const unitPriceCents = isRental ? product.rentalPriceCents : product.salePriceCents;
    if (unitPriceCents === null || unitPriceCents === undefined) {
      throw conflict('PRICE_MISSING', `"${product.name}" está sem preço cadastrado.`);
    }

    const stock = isRental ? variant.rentalStock : variant.stock;
    if (stock < item.quantity) {
      throw conflict('OUT_OF_STOCK', `Estoque insuficiente para "${product.name}".`);
    }

    resolved.push({
      input: item,
      quoteItem: {
        kind: isRental ? 'RENTAL' : 'SALE',
        unitPriceCents,
        quantity: item.quantity,
        // RN-12: aluguel sempre paga frete, mesmo em peça marcada frete grátis.
        freeShipping: isRental ? false : product.freeShipping,
        reference: variant.id,
      },
      snapshot: {
        productId: product.id,
        variantId: variant.id,
        ticketTypeId: null,
        nameSnapshot: product.name,
        skuSnapshot: variant.sku,
        sizeSnapshot: variant.size,
        colorSnapshot: variant.color,
        imageSnapshot: product.images[0]?.url ?? null,
      },
      weightGrams: product.weightGrams * item.quantity,
    });
  }

  return resolved;
}

async function resolveCoupon(tx: Tx, code: string | undefined): Promise<QuoteCoupon | null> {
  if (!code) return null;

  const coupon = await tx.coupon.findUnique({ where: { code: code.toUpperCase() } });
  const now = new Date();

  if (
    !coupon ||
    !coupon.isActive ||
    (coupon.startsAt && coupon.startsAt > now) ||
    (coupon.endsAt && coupon.endsAt < now) ||
    (coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions)
  ) {
    throw badRequest('COUPON_INVALID', 'Cupom inválido ou expirado.');
  }

  return {
    code: coupon.code,
    type: coupon.type,
    value: coupon.type === 'FIXED' ? Number(coupon.value) : decimalToNumber(coupon.value),
    minSubtotalCents: coupon.minSubtotalCents,
    minItems: coupon.minItems,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cotação
// ─────────────────────────────────────────────────────────────────────────────

export interface QuoteResponse extends QuoteResult {
  items: Array<{
    name: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    /** RN-12 — esta linha é a peça do trimestre, sem custo de locação. */
    quarterlyRental?: boolean;
  }>;
  /** RN-12 — o que aconteceu com o direito do trimestre neste orçamento. */
  quarterlyRental: {
    applied: boolean;
    savedCents: number;
    period: string;
    periodLabel: string;
  } | null;
  rebateMessage: string;
  couponCode: string | null;
  shippingService: string | null;
  estimatedDays: number | null;
}

export async function buildQuote(tx: Tx, input: CheckoutInput): Promise<{
  quote: QuoteResponse;
  resolved: ResolvedItem[];
  planId: string | null;
  subscriptionId: string | null;
  couponId: string | null;
  /** Devolvidos junto para que o pedido persista exatamente o que foi cotado. */
  rebatePercent: number;
  rebateMode: 'CREDIT_NEXT_INVOICE' | 'IMMEDIATE_DISCOUNT';
  /** RN-12 — período gravado no pedido quando a peça do trimestre foi usada. */
  quarterlyRentalPeriod: string | null;
  quarterlyRentalSavedCents: number;
}> {
  let resolved = await resolveItems(tx, input.items);
  const coupon = await resolveCoupon(tx, input.couponCode);
  const { subscription, hasActiveSubscription, rebatePercent, rebateMode } =
    await getRebateSettings(tx, input.userId);

  // RN-12 — peça do trimestre: uma unidade de aluguel sai sem custo de locação
  // quando a assinante ainda não usou o direito neste trimestre. Aplicado
  // ANTES do frete e do abatimento, porque muda o subtotal.
  const quarterly = await quarterlyRentalStatus(tx, input.userId);
  const quarterlyApplied = applyQuarterlyRental(
    resolved.map((r) => r.quoteItem),
    quarterly.available,
  );
  if (quarterlyApplied.applied) {
    // Reconstrói os itens resolvidos espelhando a divisão feita no domínio:
    // a linha grátis herda o snapshot da peça de origem.
    const rebuilt: ResolvedItem[] = [];
    let cursor = 0;
    for (const original of resolved) {
      const first = quarterlyApplied.items[cursor]!;
      const isSplit =
        cursor === quarterlyApplied.freeIndex && original.quoteItem.quantity > 1;
      rebuilt.push({ ...original, quoteItem: { ...original.quoteItem, ...first } });
      cursor += 1;
      if (isSplit) {
        const rest = quarterlyApplied.items[cursor]!;
        rebuilt.push({
          ...original,
          quoteItem: { ...original.quoteItem, ...rest },
          weightGrams: Math.round((original.weightGrams * rest.quantity) / original.quoteItem.quantity),
        });
        cursor += 1;
      }
    }
    resolved = rebuilt;
  }

  const balanceCents = await wallet.getBalance(tx, input.userId);

  // ── Frete (RN-08) ──
  const physical = resolved.filter((r) => r.quoteItem.kind !== 'TICKET');
  const subtotalCents = resolved.reduce(
    (sum, r) => sum + r.quoteItem.unitPriceCents * r.quoteItem.quantity,
    0,
  );
  const itemCount = resolved.reduce((sum, r) => sum + r.quoteItem.quantity, 0);

  let shippingQuoteCents = 0;
  let estimatedDays: number | null = null;
  let shippingRuleFreeApplied = false;

  if (physical.length > 0 && input.shippingService && input.shippingService !== 'PICKUP') {
    if (!input.addressId) throw badRequest('ADDRESS_REQUIRED', 'Informe o endereço de entrega.');

    const address = await tx.address.findFirst({
      where: { id: input.addressId, userId: input.userId },
    });
    if (!address) throw notFound('Endereço');

    const shipping = await quoteShipping({
      destinationZip: address.zipCode,
      service: input.shippingService,
      weightGrams: physical.reduce((sum, r) => sum + r.weightGrams, 0),
      declaredValueCents: subtotalCents,
    });
    shippingQuoteCents = shipping.priceCents;
    estimatedDays = shipping.estimatedDays;

    // RN-12: pedido só de aluguel não ganha frete grátis por regra — a
    // cliente paga o frete do aluguel sempre. Pedido misto segue as regras.
    const rentalOnly = physical.every((r) => r.quoteItem.kind === 'RENTAL');
    shippingRuleFreeApplied = rentalOnly
      ? false
      : await resolveFreeShipping(tx, {
          subtotalCents,
          itemCount,
          state: address.state,
          service: input.shippingService,
        });
  }

  const quoteInput: QuoteInput = {
    items: resolved.map((r) => r.quoteItem),
    rebatePercent,
    rebateMode,
    hasActiveSubscription,
    walletBalanceCents: balanceCents,
    requestedWalletCents: input.useWalletCents,
    coupon,
    shippingQuoteCents,
    shippingRuleFreeApplied,
  };

  const result = quoteOrder(quoteInput);

  const couponRecord = coupon
    ? await tx.coupon.findUnique({ where: { code: coupon.code }, select: { id: true } })
    : null;

  return {
    quote: {
      ...result,
      items: resolved.map((r, index) => ({
        name: r.snapshot.nameSnapshot,
        quantity: r.quoteItem.quantity,
        unitPriceCents: r.quoteItem.unitPriceCents,
        totalCents: r.quoteItem.unitPriceCents * r.quoteItem.quantity,
        ...(quarterlyApplied.applied && index === quarterlyApplied.freeIndex
          ? { quarterlyRental: true }
          : {}),
      })),
      quarterlyRental: quarterly.eligible
        ? {
            applied: quarterlyApplied.applied,
            savedCents: quarterlyApplied.savedCents,
            period: quarterly.period,
            periodLabel: quarterly.periodLabel,
          }
        : null,
      rebateMessage: describeRebate(result),
      couponCode: coupon?.code ?? null,
      shippingService: input.shippingService ?? null,
      estimatedDays,
    },
    resolved,
    planId: subscription?.planId ?? null,
    subscriptionId: subscription?.id ?? null,
    couponId: couponRecord?.id ?? null,
    rebatePercent,
    rebateMode,
    quarterlyRentalPeriod: quarterlyApplied.applied ? quarterly.period : null,
    quarterlyRentalSavedCents: quarterlyApplied.savedCents,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Criação do pedido
// ─────────────────────────────────────────────────────────────────────────────

async function nextOrderCode(tx: Tx): Promise<string> {
  const year = new Date().getFullYear();
  const count = await tx.order.count({
    where: { createdAt: { gte: new Date(`${year}-01-01T00:00:00Z`) } },
  });
  return orderCode(count + 1, year);
}

const orderTypeOf = (items: ResolvedItem[]): OrderType => {
  if (items.every((i) => i.quoteItem.kind === 'TICKET')) return 'TICKET';
  if (items.some((i) => i.quoteItem.kind === 'RENTAL')) return 'RENTAL';
  return 'SALE';
};

/**
 * Cria o pedido inteiro em UMA transação (RN-03/RN-04):
 * recalcula → cria pedido → baixa estoque → debita carteira → gera crédito.
 *
 * `Serializable` porque duas compras concorrentes do mesmo saldo ou do mesmo
 * último item em estoque precisam ser serializadas de verdade.
 */
export async function createOrder(input: CheckoutInput) {
  return prisma.$transaction(
    async (tx) => {
      const {
        quote,
        resolved,
        planId,
        subscriptionId,
        couponId,
        rebatePercent,
        rebateMode,
        quarterlyRentalPeriod,
        quarterlyRentalSavedCents,
      } =
        await buildQuote(tx, input);

      const type = orderTypeOf(resolved);

      const order = await tx.order.create({
        data: {
          code: await nextOrderCode(tx),
          userId: input.userId,
          type,
          status: 'PENDING_PAYMENT',

          subtotalCents: quote.subtotalCents,
          couponDiscountCents: quote.couponDiscountCents,
          shippingCents: quote.shippingCents,
          immediateDiscountCents: quote.immediateDiscountCents,
          totalCents: quote.totalCents,
          walletAppliedCents: quote.walletAppliedCents,
          gatewayAmountCents: quote.gatewayAmountCents,

          planRebatePercent: new Prisma.Decimal(rebatePercent),
          quarterlyRentalPeriod,
          quarterlyRentalSavedCents,
          rebateMode,
          rebateEligible: quote.rebateEligible,
          rebateBlockedReason: quote.rebateBlockedReason,
          rebateCreditCents: quote.rebateCreditCents,

          couponId,
          planIdAtOrder: planId,
          notes: input.notes,
          rentalStartDate: input.rentalStartDate ?? null,

          items: {
            create: resolved.map((r) => ({
              ...r.snapshot,
              kind: r.quoteItem.kind as OrderType,
              quantity: r.quoteItem.quantity,
              unitPriceCents: r.quoteItem.unitPriceCents,
              totalCents: r.quoteItem.unitPriceCents * r.quoteItem.quantity,
            })),
          },
        },
        include: { items: true },
      });

      // ── Reserva de estoque ──
      for (const r of resolved) {
        if (r.snapshot.variantId) {
          const field = r.quoteItem.kind === 'RENTAL' ? 'rentalStock' : 'stock';
          const updated = await tx.productVariant.updateMany({
            where: { id: r.snapshot.variantId, [field]: { gte: r.quoteItem.quantity } },
            data: { [field]: { decrement: r.quoteItem.quantity } },
          });
          if (updated.count === 0) {
            throw conflict('OUT_OF_STOCK', `Estoque esgotou durante o pagamento.`);
          }
        }
        if (r.snapshot.ticketTypeId) {
          await tx.eventTicketType.update({
            where: { id: r.snapshot.ticketTypeId },
            data: { sold: { increment: r.quoteItem.quantity } },
          });
        }
      }

      // ── Carteira (RN-04) ──
      if (quote.walletAppliedCents > 0) {
        await wallet.debit(tx, {
          userId: input.userId,
          amountCents: quote.walletAppliedCents,
          description: `Compra ${order.code}`,
          orderId: order.id,
        });
      }

      // ── Abatimento (RN-02) — crédito da próxima mensalidade ──
      if (quote.rebateEligible && quote.rebateCreditCents > 0) {
        await credits.grantFromOrder(tx, {
          userId: input.userId,
          subscriptionId,
          orderId: order.id,
          amountCents: quote.rebateCreditCents,
          rebatePercent,
          baseCents: quote.rebateBaseCents,
        });
      }

      if (couponId) {
        await tx.coupon.update({ where: { id: couponId }, data: { redemptions: { increment: 1 } } });
      }

      // ── Frete: registra o envio a ser despachado ──
      if (input.addressId && quote.shippingService && quote.shippingService !== 'PICKUP') {
        await tx.shipment.create({
          data: {
            orderId: order.id,
            addressId: input.addressId,
            service: quote.shippingService as 'PAC' | 'SEDEX',
            quotedCents: quote.shippingCents,
            chargedCents: quote.shippingCents,
            estimatedDays: quote.estimatedDays,
          },
        });
      }

      return { order, quote };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
  );
}

/**
 * Marca o pedido como pago e dispara os efeitos (RN-09, 3.6).
 *
 * Vive no service, e não na rota, porque três caminhos distintos precisam dele:
 * o checkout da loja, a compra de ingresso avulso e o webhook do gateway. Foi
 * justamente por estar preso à rota de /orders que a compra de ingresso no
 * cartão ficava com o pagamento aprovado e o pedido eternamente pendente — e
 * quem pagou não entrava na lista da recepção.
 */
export async function settleOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.paidAt) return; // idempotente: webhook reenviado não repete o efeito

  const paid = await prisma.order.update({
    where: { id: orderId },
    data: { status: 'PAID', paidAt: new Date() },
  });

  // Toda notificação de crédito diz quanto a pessoa tem — é o que a direção
  // pediu: "sempre aparecer o valor, você tem x de créditos".
  const wallet = await prisma.wallet.findUnique({ where: { userId: paid.userId } });
  const balance = formatBRL(wallet?.balanceCents ?? 0);

  await notifyTrigger('PURCHASE_CONFIRMED', {
    userIds: [paid.userId],
    title: 'Compra confirmada',
    body: `Seu pedido ${paid.code} foi confirmado. Você tem ${balance} de créditos na carteira.`,
    deepLink: `vkudaka://pedido/${paid.id}`,
  });

  // Saldo zerado após a compra (gatilho de 3.7).
  if (wallet && wallet.balanceCents === 0 && paid.walletAppliedCents > 0) {
    await notifyTrigger('WALLET_BALANCE_EMPTY', {
      userIds: [paid.userId],
      title: 'Sua carteira ficou sem saldo',
      body: 'Você tem R$ 0,00 de créditos. Recarregue para continuar aproveitando o clube.',
      deepLink: 'vkudaka://carteira',
    });
  }
}
