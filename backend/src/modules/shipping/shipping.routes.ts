import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { authenticate } from '../../middleware/auth.js';
import { requireActiveSubscriber } from '../../middleware/requireActiveSubscriber.js';
import { validate } from '../../middleware/validate.js';
import { quoteAllServices, resolveFreeShipping } from './shipping.service.js';
import { salePriceAt } from '../../domain/pricing/promo.js';

/** Cotação de frete no fechamento da compra (3.6 / RN-08). */
export const shippingRouter: Router = Router();

shippingRouter.post(
  '/quote',
  authenticate,
  requireActiveSubscriber,
  validate(
    z.object({
      zipCode: z
        .string()
        .transform((v) => v.replace(/\D/g, ''))
        .pipe(z.string().length(8)),
      items: z
        .array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1) }))
        .min(1),
      state: z.string().length(2).toUpperCase().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      zipCode: string;
      items: Array<{ variantId: string; quantity: number }>;
      state?: string;
    };

    const variants = await prisma.productVariant.findMany({
      where: { id: { in: body.items.map((i) => i.variantId) } },
      include: {
        product: {
          select: {
            weightGrams: true,
            salePriceCents: true,
            promoPriceCents: true,
            promoStartsAt: true,
            promoEndsAt: true,
            freeShipping: true,
          },
        },
      },
    });
    if (variants.length !== body.items.length) throw notFound('Peça');

    const quantityOf = (variantId: string) =>
      body.items.find((i) => i.variantId === variantId)?.quantity ?? 1;

    const weightGrams = variants.reduce(
      (sum, v) => sum + v.product.weightGrams * quantityOf(v.id),
      0,
    );
    const now = new Date();
    const declaredValueCents = variants.reduce(
      (sum, v) => sum + (salePriceAt(v.product, now).priceCents ?? 0) * quantityOf(v.id),
      0,
    );
    const itemCount = body.items.reduce((sum, i) => sum + i.quantity, 0);

    const allFreeByProduct = variants.every((v) => v.product.freeShipping);
    const freeByRule = body.state
      ? await resolveFreeShipping(prisma, {
          subtotalCents: declaredValueCents,
          itemCount,
          state: body.state,
          service: 'PAC',
        })
      : false;

    const quotes = await quoteAllServices({
      destinationZip: body.zipCode,
      weightGrams,
      declaredValueCents,
    });

    const free = allFreeByProduct || freeByRule;

    res.json({
      freeShipping: free,
      freeShippingReason: allFreeByProduct ? 'PRODUCT' : freeByRule ? 'RULE' : null,
      options: quotes.map((q) => ({ ...q, priceCents: free ? 0 : q.priceCents })),
    });
  }),
);
