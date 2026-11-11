import { describe, expect, it } from 'vitest';
import { describeRebate, quoteOrder, type QuoteInput } from './pricing.js';

/**
 * Cobertura da RN-02 e RN-03. Este arquivo é o contrato executável das regras
 * de negócio: alterar regra sem alterar teste aqui é regressão.
 */

const base: QuoteInput = {
  items: [{ kind: 'SALE', unitPriceCents: 30_000, quantity: 1 }],
  rebatePercent: 10, // Signature
  rebateMode: 'CREDIT_NEXT_INVOICE',
  hasActiveSubscription: true,
  walletBalanceCents: 0,
  requestedWalletCents: 0,
  coupon: null,
  shippingQuoteCents: 0,
};

const quote = (over: Partial<QuoteInput> = {}) => quoteOrder({ ...base, ...over });

describe('RN-03 — ordem de cálculo', () => {
  it('soma itens por quantidade', () => {
    const r = quote({
      items: [
        { kind: 'SALE', unitPriceCents: 30_000, quantity: 2 },
        { kind: 'SALE', unitPriceCents: 12_550, quantity: 1 },
      ],
    });
    expect(r.subtotalCents).toBe(72_550);
    expect(r.totalCents).toBe(72_550);
  });

  it('aplica cupom fixo antes do frete e soma o frete ao total', () => {
    const r = quote({
      coupon: { code: 'BEMVINDA50', type: 'FIXED', value: 5_000 },
      shippingQuoteCents: 2_490,
    });
    expect(r.couponDiscountCents).toBe(5_000);
    expect(r.netItemsCents).toBe(25_000);
    expect(r.totalCents).toBe(27_490);
  });

  it('nunca deixa o cupom fixo tornar o pedido negativo', () => {
    const r = quote({
      items: [{ kind: 'SALE', unitPriceCents: 3_000, quantity: 1 }],
      coupon: { code: 'EXAGERO', type: 'FIXED', value: 90_000 },
    });
    expect(r.couponDiscountCents).toBe(3_000);
    expect(r.totalCents).toBe(0);
  });

  it('ignora cupom quando o mínimo não é atingido', () => {
    const r = quote({
      coupon: { code: 'ACIMA500', type: 'FIXED', value: 5_000, minSubtotalCents: 50_000 },
    });
    expect(r.couponDiscountCents).toBe(0);
  });

  it('não cobra frete de pedido só com ingressos', () => {
    const r = quote({
      items: [{ kind: 'TICKET', unitPriceCents: 8_000, quantity: 2 }],
      shippingQuoteCents: 3_500,
    });
    expect(r.shippingCents).toBe(0);
    expect(r.totalCents).toBe(16_000);
  });

  it('zera o frete quando todas as peças são isentas (RN-08)', () => {
    const r = quote({
      items: [{ kind: 'SALE', unitPriceCents: 30_000, quantity: 1, freeShipping: true }],
      shippingQuoteCents: 2_490,
    });
    expect(r.shippingCents).toBe(0);
  });

  it('zera o frete quando uma ShippingRule do CRM se aplica', () => {
    const r = quote({ shippingQuoteCents: 2_490, shippingRuleFreeApplied: true });
    expect(r.shippingCents).toBe(0);
  });

  it('zera o frete com cupom FREE_SHIPPING sem mexer no subtotal', () => {
    const r = quote({
      coupon: { code: 'FRETEGRATIS', type: 'FREE_SHIPPING', value: 0 },
      shippingQuoteCents: 4_990,
    });
    expect(r.shippingCents).toBe(0);
    expect(r.couponDiscountCents).toBe(0);
    expect(r.totalCents).toBe(30_000);
  });
});

describe('RN-02 — abatimento gera crédito da próxima mensalidade', () => {
  it('gera 10% de crédito e NÃO desconta do total da compra', () => {
    const r = quote();
    expect(r.rebateEligible).toBe(true);
    expect(r.rebateCreditCents).toBe(3_000); // 10% de R$ 300
    expect(r.immediateDiscountCents).toBe(0);
    expect(r.totalCents).toBe(30_000); // total intacto
    expect(r.gatewayAmountCents).toBe(30_000);
  });

  it('usa o percentual do plano Essence (5%) vindo do CRM', () => {
    const r = quote({ rebatePercent: 5 });
    expect(r.rebateCreditCents).toBe(1_500);
  });

  it('calcula o abatimento sobre o líquido de cupom, sem o frete', () => {
    const r = quote({
      coupon: { code: 'MENOS50', type: 'FIXED', value: 5_000 },
      shippingQuoteCents: 2_490,
    });
    expect(r.rebateBaseCents).toBe(25_000);
    expect(r.rebateCreditCents).toBe(2_500);
  });

  it('não tem teto: pedido alto gera crédito proporcional integral', () => {
    const r = quote({ items: [{ kind: 'SALE', unitPriceCents: 1_200_000, quantity: 1 }] });
    expect(r.rebateCreditCents).toBe(120_000); // R$ 1.200,00 de crédito
  });

  it('arredonda o percentual em centavos', () => {
    const r = quote({ items: [{ kind: 'SALE', unitPriceCents: 19_999, quantity: 1 }] });
    expect(r.rebateCreditCents).toBe(2_000); // round(199,99 * 10%) = 20,00
  });

  it('modo IMMEDIATE_DISCOUNT desconta na hora e não gera crédito', () => {
    const r = quote({ rebateMode: 'IMMEDIATE_DISCOUNT' });
    expect(r.immediateDiscountCents).toBe(3_000);
    expect(r.rebateCreditCents).toBe(0);
    expect(r.totalCents).toBe(27_000);
  });
});

describe('RN-02 — abatimento só quando NÃO usa a carteira', () => {
  it('bloqueia o abatimento assim que qualquer saldo é usado', () => {
    const r = quote({ walletBalanceCents: 10_000, requestedWalletCents: 10_000 });
    expect(r.rebateEligible).toBe(false);
    expect(r.rebateBlockedReason).toBe('WALLET_USED');
    expect(r.rebateCreditCents).toBe(0);
  });

  it('cenário do requisito: look R$300, R$100 na carteira, inteira a diferença', () => {
    const r = quote({ walletBalanceCents: 10_000, requestedWalletCents: 10_000 });
    expect(r.walletAppliedCents).toBe(10_000);
    expect(r.gatewayAmountCents).toBe(20_000); // paga R$ 200 no Pix/cartão
    expect(r.totalCents).toBe(30_000);
  });

  it('mantém o abatimento quando o usuário pede saldo mas não tem nenhum', () => {
    const r = quote({ walletBalanceCents: 0, requestedWalletCents: 10_000 });
    expect(r.walletAppliedCents).toBe(0);
    expect(r.rebateEligible).toBe(true);
    expect(r.rebateCreditCents).toBe(3_000);
  });

  it('limita o saldo aplicado ao total do pedido', () => {
    const r = quote({ walletBalanceCents: 100_000, requestedWalletCents: 100_000 });
    expect(r.walletAppliedCents).toBe(30_000);
    expect(r.gatewayAmountCents).toBe(0);
  });

  it('mostra o cenário alternativo do que se abre mão ao usar saldo', () => {
    const r = quote({ walletBalanceCents: 10_000, requestedWalletCents: 10_000 });
    expect(r.alternativeWithoutWallet).toEqual({
      totalCents: 30_000,
      rebateCreditCents: 3_000,
      immediateDiscountCents: 0,
    });
  });

  it('IMMEDIATE_DISCOUNT (desconto fidelidade) vale pagando com créditos da carteira', () => {
    // Regra de 2026-11-11: a mensalidade inteira vira crédito; o desconto não
    // depende de como a cliente paga.
    const r = quote({
      rebateMode: 'IMMEDIATE_DISCOUNT',
      walletBalanceCents: 10_000,
      requestedWalletCents: 10_000,
    });
    expect(r.rebateEligible).toBe(true);
    expect(r.immediateDiscountCents).toBe(3_000);
    expect(r.totalCents).toBe(27_000);
    expect(r.walletAppliedCents).toBe(10_000);
    expect(r.gatewayAmountCents).toBe(17_000);
    expect(r.alternativeWithoutWallet).toBeNull();
  });

  it('IMMEDIATE_DISCOUNT: carteira cobre o total já com desconto, nunca mais que isso', () => {
    const r = quote({
      rebateMode: 'IMMEDIATE_DISCOUNT',
      walletBalanceCents: 50_000,
      requestedWalletCents: 50_000,
    });
    expect(r.totalCents).toBe(27_000);
    expect(r.walletAppliedCents).toBe(27_000);
    expect(r.gatewayAmountCents).toBe(0);
  });
});

describe('RN-02 — o abatimento não é acumulativo', () => {
  it('cupom percentual substitui o abatimento do plano', () => {
    const r = quote({ coupon: { code: 'BLACK20', type: 'PERCENT', value: 20 } });
    expect(r.couponDiscountCents).toBe(6_000);
    expect(r.rebateEligible).toBe(false);
    expect(r.rebateBlockedReason).toBe('PERCENT_COUPON');
    expect(r.rebateCreditCents).toBe(0);
  });

  it('cupom de valor fixo convive com o abatimento (não é percentual)', () => {
    const r = quote({ coupon: { code: 'MENOS50', type: 'FIXED', value: 5_000 } });
    expect(r.rebateEligible).toBe(true);
    expect(r.rebateCreditCents).toBe(2_500);
  });

  it('um pedido gera um único crédito, nunca um por item', () => {
    const r = quote({
      items: [
        { kind: 'SALE', unitPriceCents: 30_000, quantity: 1 },
        { kind: 'SALE', unitPriceCents: 20_000, quantity: 1 },
      ],
    });
    expect(r.rebateCreditCents).toBe(5_000); // 10% de R$ 500, uma vez só
  });
});

describe('RN-01/RN-06 — quem não é assinante', () => {
  it('não gera abatimento algum', () => {
    const r = quote({ hasActiveSubscription: false, rebatePercent: 0 });
    expect(r.rebateEligible).toBe(false);
    expect(r.rebateBlockedReason).toBe('NO_PLAN');
    expect(r.rebateCreditCents).toBe(0);
    expect(r.rebatePercentApplied).toBe(0);
  });

  it('assinatura inativa anula o percentual mesmo que o plano tenha valor', () => {
    const r = quote({ hasActiveSubscription: false, rebatePercent: 10 });
    expect(r.rebateEligible).toBe(false);
  });
});

describe('bordas e integridade', () => {
  it('pedido de valor zero não gera crédito', () => {
    const r = quote({ items: [{ kind: 'SALE', unitPriceCents: 0, quantity: 1 }] });
    expect(r.rebateBlockedReason).toBe('ZERO_BASE');
    expect(r.rebateCreditCents).toBe(0);
  });

  it('total sempre fecha: carteira + gateway = total', () => {
    const cases: Partial<QuoteInput>[] = [
      {},
      { walletBalanceCents: 5_000, requestedWalletCents: 5_000, shippingQuoteCents: 2_490 },
      { rebateMode: 'IMMEDIATE_DISCOUNT', shippingQuoteCents: 1_990 },
      { coupon: { code: 'X', type: 'PERCENT', value: 15 }, shippingQuoteCents: 3_000 },
    ];
    for (const over of cases) {
      const r = quote(over);
      expect(r.walletAppliedCents + r.gatewayAmountCents).toBe(r.totalCents);
    }
  });

  it('rejeita percentual inválido', () => {
    expect(() => quote({ rebatePercent: 120 })).toThrow(RangeError);
  });

  it('rejeita quantidade ou preço inválidos', () => {
    expect(() => quote({ items: [{ kind: 'SALE', unitPriceCents: -1, quantity: 1 }] })).toThrow(
      RangeError,
    );
    expect(() => quote({ items: [{ kind: 'SALE', unitPriceCents: 100, quantity: 0 }] })).toThrow(
      RangeError,
    );
  });
});

describe('texto exibido no botão Comprar', () => {
  it('anuncia o crédito gerado', () => {
    expect(describeRebate(quote())).toContain('crédito na sua próxima mensalidade');
  });

  it('avisa o que se perde ao usar saldo', () => {
    const r = quote({ walletBalanceCents: 10_000, requestedWalletCents: 10_000 });
    expect(describeRebate(r)).toContain('abre mão');
  });

  it('explica a não acumulação com cupom percentual', () => {
    const r = quote({ coupon: { code: 'BLACK20', type: 'PERCENT', value: 20 } });
    expect(describeRebate(r)).toContain('não se somam');
  });
});
