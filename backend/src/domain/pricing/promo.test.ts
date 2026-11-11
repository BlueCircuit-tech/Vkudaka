import { describe, expect, it } from 'vitest';
import { isPromoActive, salePriceAt, withPromo } from './promo.js';
import { describeRebate, quoteOrder, type QuoteInput } from './pricing.js';

const now = new Date('2026-11-20T12:00:00Z');
const peca = {
  salePriceCents: 30_000,
  promoPriceCents: 25_000,
  promoStartsAt: null as Date | null,
  promoEndsAt: null as Date | null,
};

describe('valor promocional', () => {
  it('vale sem datas e devolve o preço "de"', () => {
    expect(salePriceAt(peca, now)).toEqual({
      priceCents: 25_000,
      listPriceCents: 30_000,
      promoActive: true,
      promoEndsAt: null,
    });
  });

  it('respeita início e fim (fim exclusivo)', () => {
    const start = new Date('2026-11-21T00:00:00Z');
    const end = new Date('2026-11-20T12:00:00Z');
    expect(isPromoActive({ ...peca, promoStartsAt: start }, now)).toBe(false);
    expect(isPromoActive({ ...peca, promoEndsAt: end }, now)).toBe(false);
    expect(isPromoActive({ ...peca, promoEndsAt: new Date('2026-11-30T00:00:00Z') }, now)).toBe(true);
  });

  it('ignora promocional maior ou igual ao preço de venda', () => {
    expect(salePriceAt({ ...peca, promoPriceCents: 30_000 }, now).priceCents).toBe(30_000);
  });

  it('vitrine: salePriceCents vira o preço que vale e esconde os campos crus', () => {
    const out = withPromo({ id: 'x', ...peca }, now);
    expect(out.salePriceCents).toBe(25_000);
    expect(out.listPriceCents).toBe(30_000);
    expect('promoPriceCents' in out).toBe(false);
  });
});

describe('peça em promoção não recebe abatimento do plano', () => {
  const base: QuoteInput = {
    items: [{ kind: 'SALE', unitPriceCents: 25_000, quantity: 1, noRebate: true }],
    rebatePercent: 15,
    rebateMode: 'CREDIT_NEXT_INVOICE',
    hasActiveSubscription: true,
    walletBalanceCents: 0,
    requestedWalletCents: 0,
    shippingQuoteCents: 0,
  };

  it('só peça em promoção: sem crédito e com motivo PROMO_ITEMS', () => {
    const q = quoteOrder(base);
    expect(q.totalCents).toBe(25_000);
    expect(q.rebateCreditCents).toBe(0);
    expect(q.rebateBlockedReason).toBe('PROMO_ITEMS');
    expect(describeRebate(q)).toMatch(/promoção/);
  });

  it('pedido misto: abatimento só sobre as peças fora da promoção', () => {
    const q = quoteOrder({
      ...base,
      items: [...base.items, { kind: 'SALE', unitPriceCents: 20_000, quantity: 1 }],
    });
    expect(q.rebateEligible).toBe(true);
    expect(q.rebateBaseCents).toBe(20_000);
    expect(q.rebateCreditCents).toBe(3_000);
  });

  it('desconto imediato também ignora a peça em promoção', () => {
    const q = quoteOrder({
      ...base,
      rebateMode: 'IMMEDIATE_DISCOUNT',
      items: [...base.items, { kind: 'SALE', unitPriceCents: 10_000, quantity: 1 }],
    });
    expect(q.immediateDiscountCents).toBe(1_500);
    expect(q.totalCents).toBe(33_500);
  });
});
