import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { getPaymentConfig } from '../../integrations/payments/settings.js';

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
