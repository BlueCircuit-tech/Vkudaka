import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { randomUUID } from 'node:crypto';
import { getPaymentConfig } from '../../integrations/payments/settings.js';
import { env } from '../../config/env.js';
import { notFound } from '../../lib/errors.js';
import { PLAN_REFERENCE_PREFIX, settlePlanCheckout } from '../plans/plan-checkout.service.js';

/**
 * O que os apps precisam saber antes de mostrar o botão de pagar: quais meios
 * estão disponíveis e a chave pública (para o SDK de cartão, quando existir).
 * Público e sem segredo — a chave pública do Mercado Pago é feita para o app.
 */
export const paymentsRouter: Router = Router();

paymentsRouter.get(
  '/methods',
  asyncHandler(async (_req, res) => {
    const config = await getPaymentConfig();
    const configured = config.provider !== 'none';
    res.json({
      provider: config.provider,
      configured,
      methods: configured ? ['PIX', ...(config.acceptCard ? ['CREDIT_CARD'] : [])] : [],
      publicKey: config.publicKey ?? null,
    });
  }),
);

/**
 * Só em desenvolvimento, com o provedor simulado: abrir o "link de pagamento"
 * aprova na hora, como se o Mercado Pago tivesse avisado pelo webhook.
 */
paymentsRouter.get(
  '/mock-checkout',
  asyncHandler(async (req, res) => {
    const config = await getPaymentConfig();
    if (
      env.NODE_ENV !== 'development' ||
      env.PAYMENT_PROVIDER !== 'mock' ||
      config.provider !== 'mock'
    ) {
      throw notFound('Página');
    }
    const ref = String(req.query.ref ?? '');
    if (!ref.startsWith(PLAN_REFERENCE_PREFIX)) throw notFound('Link');
    const outcome = await settlePlanCheckout(
      ref.slice(PLAN_REFERENCE_PREFIX.length),
      { externalId: `mock_${randomUUID()}`, status: 'PAID', method: 'PIX', paidAt: new Date(), raw: { ref } },
      'mock',
    );
    res.type('html').send(`<h1>Pagamento simulado: ${outcome}</h1><p>Volte ao app.</p>`);
  }),
);
