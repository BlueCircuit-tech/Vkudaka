/**
 * Valor promocional de VENDA da peça.
 *
 * Função pura, como o resto de `domain/pricing`: recebe a peça e o instante,
 * devolve o preço que vale agora. A promoção vale quando:
 *   • há valor promocional e ele é menor que o preço de venda;
 *   • o instante está dentro do período (início e fim são opcionais; o fim é exclusivo).
 *
 * Peça em promoção não recebe o abatimento do plano (decisão da direção,
 * 2026-11-11): o item vai para o motor com `noRebate`.
 */

export interface PromoFields {
  readonly salePriceCents: number | null;
  readonly promoPriceCents: number | null;
  readonly promoStartsAt: Date | null;
  readonly promoEndsAt: Date | null;
}

export interface SalePrice {
  /** O que a cliente paga agora (promocional, se ativo). Null se a peça não tem preço de venda. */
  readonly priceCents: number | null;
  /** Preço "de" quando a promoção está ativa; null fora da promoção. */
  readonly listPriceCents: number | null;
  readonly promoActive: boolean;
  readonly promoEndsAt: Date | null;
}

export function isPromoActive(product: PromoFields, now: Date): boolean {
  const { salePriceCents, promoPriceCents, promoStartsAt, promoEndsAt } = product;
  if (salePriceCents == null || promoPriceCents == null) return false;
  if (promoPriceCents >= salePriceCents) return false;
  if (promoStartsAt && now < promoStartsAt) return false;
  if (promoEndsAt && now >= promoEndsAt) return false;
  return true;
}

export function salePriceAt(product: PromoFields, now: Date): SalePrice {
  if (isPromoActive(product, now)) {
    return {
      priceCents: product.promoPriceCents,
      listPriceCents: product.salePriceCents,
      promoActive: true,
      promoEndsAt: product.promoEndsAt,
    };
  }
  return {
    priceCents: product.salePriceCents,
    listPriceCents: null,
    promoActive: false,
    promoEndsAt: null,
  };
}

/**
 * Versão da peça para a vitrine do app: `salePriceCents` passa a ser o preço
 * que vale agora — assim os builds antigos do app já mostram (e cobram) o
 * promocional — e `listPriceCents` traz o preço "de" para o riscado.
 * Os campos crus da promoção não saem para o app.
 */
export function withPromo<T extends PromoFields>(product: T, now: Date) {
  const { promoPriceCents: _p, promoStartsAt: _s, promoEndsAt: _e, ...rest } = product;
  const price = salePriceAt(product, now);
  return {
    ...rest,
    salePriceCents: price.priceCents,
    listPriceCents: price.listPriceCents,
    promoActive: price.promoActive,
    promoEndsAt: price.promoEndsAt,
  };
}
