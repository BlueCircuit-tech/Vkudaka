import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, pageResult, paginate, param } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { authenticate } from '../../middleware/auth.js';
import { requireActiveSubscriber } from '../../middleware/requireActiveSubscriber.js';
import { validate } from '../../middleware/validate.js';
import { getRebateSettings, quarterlyRentalStatus } from '../subscriptions/subscriptions.service.js';
import { describeRebate, quoteOrder } from '../../domain/pricing/pricing.js';
import { withPromo } from '../../domain/pricing/promo.js';

/**
 * Vitrine (2.3).
 *
 * Vitrines separadas por rota, não por filtro no cliente:
 *   GET /catalog/shop   → "Compra"           (foco principal)
 *   GET /catalog/looks  → "Escolha seu Look" (looks de COMPRA)
 *   GET /catalog/rental → aluguel (segundo plano, sem porta no app hoje)
 *
 * Toda a vitrine é protegida por requireActiveSubscriber: quem não assina
 * recebe 402 e o app abre o redirecionamento para o site (RN-01).
 */
export const catalogRouter: Router = Router();

const listQuery = z.object({
  categoryId: z.string().uuid().optional(),
  search: z.string().max(80).optional(),
  size: z.string().max(12).optional(),
  color: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(50).optional(),
});

function buildWhere(
  scope: 'SALE' | 'RENTAL',
  query: z.infer<typeof listQuery>,
): Prisma.ProductWhereInput {
  return {
    status: 'PUBLISHED',
    deletedAt: null,
    availability: { in: [scope, 'BOTH'] },
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    ...(query.size || query.color
      ? {
          variants: {
            some: {
              isActive: true,
              ...(query.size ? { size: query.size } : {}),
              ...(query.color ? { color: { contains: query.color, mode: 'insensitive' } } : {}),
            },
          },
        }
      : {}),
  };
}

const productInclude = {
  images: { orderBy: { displayOrder: 'asc' } },
  variants: { where: { isActive: true } },
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductInclude;

/** Vitrine de compra — o foco do app. */
catalogRouter.get(
  '/shop',
  authenticate,
  requireActiveSubscriber,
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as z.infer<typeof listQuery>;
    const { page, perPage, skip, take } = paginate(req.query);
    const where = buildWhere('SALE', query);

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: [{ isHighlighted: 'desc' }, { publishedAt: 'desc' }],
        skip,
        take,
      }),
      prisma.product.count({ where }),
    ]);

    const now = new Date();
    res.json(pageResult(products.map((p) => withPromo(p, now)), total, page, perPage));
  }),
);

/**
 * "Escolha seu Look" — vitrine de COMPRA, por decisão da direção.
 *
 * No protótipo antigo este menu chamava-se "Aluguel de looks" e listava peças
 * de locação. A direção renomeou o menu e trocou o conteúdo: aqui entram
 * somente looks à venda. Difere da Loja pela ordenação — a Loja abre pelos
 * destaques, o lookbook abre pelos lançamentos.
 */
catalogRouter.get(
  '/looks',
  authenticate,
  requireActiveSubscriber,
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as z.infer<typeof listQuery>;
    const { page, perPage, skip, take } = paginate(req.query);
    const where = buildWhere('SALE', query);

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { publishedAt: 'desc' },
        skip,
        take,
      }),
      prisma.product.count({ where }),
    ]);

    const now = new Date();
    res.json(pageResult(products.map((p) => withPromo(p, now)), total, page, perPage));
  }),
);

/**
 * Aluguel (2.3) — mantido em segundo plano.
 *
 * Com o lookbook virando vitrine de compra, o aluguel deixou de ter menu
 * próprio no app. A rota permanece porque as peças de locação continuam no
 * catálogo e no CRM: o que a direção decidiu foi onde a porta fica, não que o
 * serviço acabou.
 */
catalogRouter.get(
  '/rental',
  authenticate,
  requireActiveSubscriber,
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as z.infer<typeof listQuery>;
    const { page, perPage, skip, take } = paginate(req.query);
    const where = buildWhere('RENTAL', query);

    const [products, total, quarterlyRental] = await Promise.all([
      prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { publishedAt: 'desc' },
        skip,
        take,
      }),
      prisma.product.count({ where }),
      quarterlyRentalStatus(prisma, req.auth!.userId),
    ]);

    // RN-12 — a vitrine diz se a peça do trimestre ainda está disponível.
    const now = new Date();
    res.json({
      ...pageResult(products.map((p) => withPromo(p, now)), total, page, perPage),
      quarterlyRental,
    });
  }),
);

catalogRouter.get(
  '/categories',
  authenticate,
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ scope: 'asc' }, { displayOrder: 'asc' }],
      }),
    );
  }),
);

/**
 * As 2 fotos do modal que abre ao tocar em Loja ("Mudar Categoria APP" no
 * CRM). Tocar numa foto filtra a vitrine por aquela categoria. Lista vazia =
 * o app não mostra o modal.
 */
catalogRouter.get(
  '/category-picker',
  authenticate,
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      where: { isActive: true, pickerOrder: { not: null }, imageUrl: { not: null } },
      orderBy: { pickerOrder: 'asc' },
      take: 2,
    });
    res.json(
      categories.map((category) => ({
        id: category.id,
        label: category.pickerLabel || category.name,
        scope: category.scope,
        imageUrl: category.imageUrl,
      })),
    );
  }),
);

/**
 * Detalhe da peça já com a prévia do abatimento (3.2): o botão "Comprar" mostra
 * o benefício calculado com o percentual que veio do CRM, sem regra no cliente.
 */
catalogRouter.get(
  '/products/:id',
  authenticate,
  requireActiveSubscriber,
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: param(req, 'id'), status: 'PUBLISHED', deletedAt: null },
      include: productInclude,
    });
    if (!product) throw notFound('Peça');

    const { rebatePercent, rebateMode, hasActiveSubscription } = await getRebateSettings(
      prisma,
      req.auth!.userId,
    );

    const priced = withPromo(product, new Date());

    const previewFor = (priceCents: number | null, noRebate = false) => {
      if (priceCents === null) return null;
      const quote = quoteOrder({
        items: [{ kind: 'SALE', unitPriceCents: priceCents, quantity: 1, noRebate }],
        rebatePercent,
        rebateMode,
        hasActiveSubscription,
        walletBalanceCents: 0,
        requestedWalletCents: 0,
        shippingQuoteCents: 0,
      });
      return {
        priceCents,
        rebateCreditCents: quote.rebateCreditCents,
        immediateDiscountCents: quote.immediateDiscountCents,
        message: describeRebate(quote),
      };
    };

    res.json({
      ...priced,
      rebatePreview: {
        percent: rebatePercent,
        mode: rebateMode,
        sale: previewFor(priced.salePriceCents, priced.promoActive),
        rental: previewFor(product.rentalPriceCents),
      },
      // RN-12 — o botão "Alugar" precisa saber se esta peça sai sem custo.
      quarterlyRental:
        product.availability !== 'SALE'
          ? await quarterlyRentalStatus(prisma, req.auth!.userId)
          : null,
    });
  }),
);
