import type { Tx } from '../../lib/prisma.js';
import { freightProvider, type FreightQuote } from '../../integrations/correios/correios.js';
import { env } from '../../config/env.js';

/** RN-08 — cotação e regras de frete grátis. */

export async function quoteShipping(params: {
  destinationZip: string;
  service: 'PAC' | 'SEDEX';
  weightGrams: number;
  declaredValueCents: number;
}): Promise<FreightQuote> {
  return freightProvider.quote({
    originZip: env.CORREIOS_ORIGIN_ZIP,
    destinationZip: params.destinationZip,
    service: params.service,
    weightGrams: Math.max(params.weightGrams, 300),
    declaredValueCents: params.declaredValueCents,
  });
}

/** Cotação das duas modalidades para a tela de fechamento do app. */
export async function quoteAllServices(params: {
  destinationZip: string;
  weightGrams: number;
  declaredValueCents: number;
}): Promise<FreightQuote[]> {
  return Promise.all(
    (['PAC', 'SEDEX'] as const).map((service) => quoteShipping({ ...params, service })),
  );
}

/**
 * Avalia as ShippingRules cadastradas no CRM, da maior prioridade para a menor.
 * Retorna true assim que uma regra concede frete grátis.
 */
export async function resolveFreeShipping(
  tx: Tx,
  ctx: { subtotalCents: number; itemCount: number; state: string; service: string },
): Promise<boolean> {
  const rules = await tx.shippingRule.findMany({
    where: { isActive: true },
    orderBy: { priority: 'desc' },
  });

  return rules.some((rule) => {
    if (rule.service && rule.service !== ctx.service) return false;
    if (rule.states.length > 0 && !rule.states.includes(ctx.state)) return false;
    if (rule.minSubtotalCents > 0 && ctx.subtotalCents < rule.minSubtotalCents) return false;
    if (rule.minItems > 0 && ctx.itemCount < rule.minItems) return false;
    // Uma regra sem nenhum critério não concede frete grátis a tudo por acidente.
    return rule.minSubtotalCents > 0 || rule.minItems > 0;
  });
}
