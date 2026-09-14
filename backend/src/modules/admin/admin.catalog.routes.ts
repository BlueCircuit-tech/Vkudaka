import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, pageResult, paginate, param } from '../../lib/http.js';
import { badRequest } from '../../lib/errors.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { notifyTrigger } from '../notifications/notifications.service.js';
import { entryList } from '../events/events.service.js';

/** Gestão de catálogo e eventos no CRM (3.3 / 3.4). */
export const adminCatalogRouter: Router = Router();

adminCatalogRouter.use(authenticate, requireRole('STAFF'));

// ── 3.3 Produtos ─────────────────────────────────────────────────────────────

const variantSchema = z.object({
  size: z.string().min(1).max(12),
  color: z.string().min(1).max(40),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sku: z.string().min(1).max(50),
  stock: z.number().int().min(0).default(0),
  rentalStock: z.number().int().min(0).default(0),
});

const productBase = z.object({
    sku: z.string().min(1).max(40),
    name: z.string().min(2).max(160),
    slug: z.string().min(2).max(180).regex(/^[a-z0-9-]+$/),
    description: z.string().max(4000).optional(),
    categoryId: z.string().uuid().optional(),
    /** 3.3 — define claramente se a peça é para Venda, Aluguel ou Ambos. */
    availability: z.enum(['SALE', 'RENTAL', 'BOTH']),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
    salePriceCents: z.number().int().min(0).optional(),
    rentalPriceCents: z.number().int().min(0).optional(),
    rentalDays: z.number().int().min(1).max(30).default(4),
    rentalDepositCents: z.number().int().min(0).optional(),
    composition: z.string().max(240).optional(),
    careLabel: z.string().max(240).optional(),
    weightGrams: z.number().int().min(50).max(30_000).default(500),
    lengthCm: z.number().int().min(1).default(30),
    widthCm: z.number().int().min(1).default(25),
    heightCm: z.number().int().min(1).default(5),
    freeShipping: z.boolean().default(false),
    isHighlighted: z.boolean().default(false),
    variants: z.array(variantSchema).min(1),
    images: z
      .array(z.object({ url: z.string().url(), alt: z.string().max(160).optional() }))
      .default([]),
});

// Coerência de preço x disponibilidade: peça de venda sem preço de venda é erro de cadastro.
const productSchema = productBase
  .refine((p) => (p.availability === 'SALE' || p.availability === 'BOTH' ? p.salePriceCents != null : true), {
    message: 'Peça de venda exige salePriceCents',
    path: ['salePriceCents'],
  })
  .refine(
    (p) => (p.availability === 'RENTAL' || p.availability === 'BOTH' ? p.rentalPriceCents != null : true),
    { message: 'Peça de aluguel exige rentalPriceCents', path: ['rentalPriceCents'] },
  );

const productListQuery = z.object({
  /**
   * Recorte da vitrine, não igualdade de campo.
   *
   * Uma peça marcada "Venda e aluguel" está disponível nas duas pontas — se o
   * filtro de Aluguel comparasse o campo direto, ela sumiria da lista e a
   * pergunta "o que temos para alugar?" teria a resposta errada.
   */
  // Campo vazio é "sem recorte", não valor inválido: a aba "Todas" pode chegar
  // como `availability=` dependendo de quem monta a URL.
  availability: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['SALE', 'RENTAL', 'BOTH']).optional(),
  ),
  status: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  ),
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(100).optional(),
});

const SCOPE: Record<'SALE' | 'RENTAL' | 'BOTH', Prisma.ProductWhereInput> = {
  SALE: { availability: { in: ['SALE', 'BOTH'] } },
  RENTAL: { availability: { in: ['RENTAL', 'BOTH'] } },
  BOTH: { availability: 'BOTH' },
};

adminCatalogRouter.get(
  '/products',
  validate(productListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as z.infer<typeof productListQuery>;
    const { page, perPage, skip, take } = paginate(req.query);
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.availability ? SCOPE[query.availability] : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { variants: true, images: true, category: true },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      prisma.product.count({ where }),
    ]);

    res.json(pageResult(products, total, page, perPage));
  }),
);

adminCatalogRouter.post(
  '/products',
  validate(productSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof productSchema>;

    const product = await prisma.product.create({
      data: {
        ...body,
        publishedAt: body.status === 'PUBLISHED' ? new Date() : null,
        variants: { create: body.variants },
        images: {
          create: body.images.map((img, index) => ({
            ...img,
            displayOrder: index,
            isCover: index === 0,
          })),
        },
      },
      include: { variants: true, images: true },
    });

    // RN-09 — gatilho automático: peça nova publicada.
    if (product.status === 'PUBLISHED') {
      await notifyTrigger('NEW_PRODUCT', {
        title: 'Nova peça no clube',
        body: `${product.name} acabou de entrar na vitrine.`,
        deepLink: `vkudaka://produto/${product.id}`,
      });
    }

    res.status(201).json(product);
  }),
);

adminCatalogRouter.patch(
  '/products/:id',
  validate(productBase.partial().omit({ variants: true, images: true })),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof productBase>>;
    const before = await prisma.product.findUniqueOrThrow({ where: { id: param(req, 'id') } });

    const product = await prisma.product.update({
      where: { id: param(req, 'id') },
      data: {
        ...body,
        variants: undefined,
        images: undefined,
        ...(body.status === 'PUBLISHED' && !before.publishedAt ? { publishedAt: new Date() } : {}),
      },
    });

    // Publicação posterior também dispara o gatilho, uma única vez.
    if (product.status === 'PUBLISHED' && before.status !== 'PUBLISHED') {
      await notifyTrigger('NEW_PRODUCT', {
        title: 'Nova peça no clube',
        body: `${product.name} acabou de entrar na vitrine.`,
        deepLink: `vkudaka://produto/${product.id}`,
      });
    }

    res.json(product);
  }),
);

adminCatalogRouter.post(
  '/products/:id/variants',
  validate(variantSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      await prisma.productVariant.create({
        data: { ...(req.body as z.infer<typeof variantSchema>), productId: param(req, 'id') },
      }),
    );
  }),
);

/** Adiciona (ou troca) a foto de capa da peça. */
adminCatalogRouter.post(
  '/products/:id/images',
  validate(
    z.object({
      url: z.string().url(),
      alt: z.string().max(160).optional(),
      isCover: z.boolean().default(false),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { url: string; alt?: string; isCover: boolean };
    const productId = param(req, 'id');

    const image = await prisma.$transaction(async (tx) => {
      // Só uma capa por peça: a nova destrona a anterior.
      if (body.isCover) {
        await tx.productImage.updateMany({ where: { productId }, data: { isCover: false } });
      }
      const count = await tx.productImage.count({ where: { productId } });
      return tx.productImage.create({
        data: { productId, url: body.url, alt: body.alt, isCover: body.isCover, displayOrder: count },
      });
    });

    res.status(201).json(image);
  }),
);

adminCatalogRouter.delete(
  '/images/:id',
  asyncHandler(async (req, res) => {
    await prisma.productImage.delete({ where: { id: param(req, 'id') } });
    res.status(204).end();
  }),
);

adminCatalogRouter.patch(
  '/variants/:id/stock',
  validate(z.object({ stock: z.number().int().min(0).optional(), rentalStock: z.number().int().min(0).optional() })),
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.productVariant.update({
        where: { id: param(req, 'id') },
        data: req.body as { stock?: number; rentalStock?: number },
      }),
    );
  }),
);

adminCatalogRouter.delete(
  '/products/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    // Soft delete: pedidos antigos continuam apontando para a peça.
    await prisma.product.update({
      where: { id: param(req, 'id') },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });
    res.status(204).end();
  }),
);

adminCatalogRouter.post(
  '/categories',
  validate(
    z.object({
      name: z.string().min(2).max(80),
      slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
      scope: z.enum(['SALE', 'RENTAL', 'BOTH']).default('SALE'),
      displayOrder: z.number().int().default(0),
      imageUrl: z.string().url().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(await prisma.category.create({ data: req.body as never }));
  }),
);

// ── 3.4 Eventos ──────────────────────────────────────────────────────────────

const eventSchema = z.object({
  title: z.string().min(3).max(160),
  slug: z.string().min(3).max(180).regex(/^[a-z0-9-]+$/),
  description: z.string().max(4000).optional(),
  coverUrl: z.string().url().optional(),
  /** Arte de fundo do ingresso, fornecida pela equipe. */
  ticketArtUrl: z.string().url().optional(),
  venueName: z.string().max(160).optional(),
  venueAddress: z.string().max(240).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  capacity: z.number().int().min(1).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELED', 'FINISHED']).default('DRAFT'),
  subscribersFree: z.boolean().default(true),
  sellsPublicTickets: z.boolean().default(true),
  rsvpDeadline: z.coerce.date().optional(),
  ticketTypes: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        priceCents: z.number().int().min(0),
        quantity: z.number().int().min(1),
        salesStart: z.coerce.date().optional(),
        salesEnd: z.coerce.date().optional(),
      }),
    )
    .default([]),
});

adminCatalogRouter.get(
  '/events',
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.event.findMany({
        include: {
          ticketTypes: true,
          _count: { select: { attendees: true, tickets: true } },
        },
        orderBy: { startsAt: 'desc' },
      }),
    );
  }),
);

adminCatalogRouter.post(
  '/events',
  validate(eventSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof eventSchema>;
    if (body.endsAt && body.endsAt < body.startsAt) {
      throw badRequest('INVALID_PERIOD', 'O término do evento é anterior ao início.');
    }

    const event = await prisma.event.create({
      data: {
        ...body,
        publishedAt: body.status === 'PUBLISHED' ? new Date() : null,
        ticketTypes: { create: body.ticketTypes },
      },
      include: { ticketTypes: true },
    });

    // RN-09 — gatilho automático: evento novo.
    if (event.status === 'PUBLISHED') {
      await notifyTrigger('NEW_EVENT', {
        title: 'Novo evento VKUDAKA',
        body: `${event.title} — confirme sua presença.`,
        deepLink: `vkudaka://evento/${event.id}`,
      });
    }

    res.status(201).json(event);
  }),
);

adminCatalogRouter.patch(
  '/events/:id',
  validate(eventSchema.partial().omit({ ticketTypes: true })),
  asyncHandler(async (req, res) => {
    const before = await prisma.event.findUniqueOrThrow({ where: { id: param(req, 'id') } });
    const event = await prisma.event.update({
      where: { id: param(req, 'id') },
      data: {
        ...(req.body as Partial<z.infer<typeof eventSchema>>),
        ticketTypes: undefined,
        ...(req.body.status === 'PUBLISHED' && !before.publishedAt
          ? { publishedAt: new Date() }
          : {}),
      },
    });

    if (event.status === 'PUBLISHED' && before.status !== 'PUBLISHED') {
      await notifyTrigger('NEW_EVENT', {
        title: 'Novo evento VKUDAKA',
        body: `${event.title} — confirme sua presença.`,
        deepLink: `vkudaka://evento/${event.id}`,
      });
    }

    res.json(event);
  }),
);

/**
 * Lista de entrada (3.4) — a MESMA apuração do PDF da recepção, para a tela e o
 * papel nunca discordarem sobre quem pode entrar.
 */
adminCatalogRouter.get(
  '/events/:id/attendees',
  asyncHandler(async (req, res) => {
    res.json(await entryList(param(req, 'id')));
  }),
);


// ── 3.4 Lotes de ingresso avulso ─────────────────────────────────────────────
//
// O bloco de ingresso avulso é o único caminho de compra do app aberto a quem
// NÃO é assinante (RN-01/RN-07). Assinante confirma presença e não paga; estes
// lotes existem só para o público de fora.

const ticketTypeSchema = z.object({
  name: z.string().min(1).max(80),
  priceCents: z.number().int().min(0),
  quantity: z.number().int().min(1),
  salesStart: z.coerce.date().optional(),
  salesEnd: z.coerce.date().optional(),
  isActive: z.boolean().default(true),
});

adminCatalogRouter.post(
  '/events/:id/ticket-types',
  validate(ticketTypeSchema),
  asyncHandler(async (req, res) => {
    const eventId = param(req, 'id');
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });

    // Criar lote sem abrir a venda avulsa deixaria o ingresso invisível no app.
    if (!event.sellsPublicTickets) {
      throw badRequest(
        'PUBLIC_TICKETS_DISABLED',
        'Ative a venda de ingresso avulso neste evento antes de criar lotes.',
      );
    }

    res.status(201).json(
      await prisma.eventTicketType.create({
        data: { ...(req.body as z.infer<typeof ticketTypeSchema>), eventId },
      }),
    );
  }),
);

adminCatalogRouter.patch(
  '/ticket-types/:id',
  validate(ticketTypeSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = param(req, 'id');
    const body = req.body as Partial<z.infer<typeof ticketTypeSchema>>;
    const current = await prisma.eventTicketType.findUniqueOrThrow({ where: { id } });

    // Reduzir o lote abaixo do que já foi vendido deixaria o evento com mais
    // gente confirmada do que lugares.
    if (body.quantity !== undefined && body.quantity < current.sold) {
      throw badRequest(
        'QUANTITY_BELOW_SOLD',
        `Já foram vendidos ${current.sold} ingressos deste lote.`,
      );
    }

    res.json(await prisma.eventTicketType.update({ where: { id }, data: body }));
  }),
);

adminCatalogRouter.delete(
  '/ticket-types/:id',
  asyncHandler(async (req, res) => {
    const id = param(req, 'id');
    const current = await prisma.eventTicketType.findUniqueOrThrow({ where: { id } });

    // Lote com venda tem ingresso emitido atrás: desativa, não apaga.
    if (current.sold > 0) {
      const disabled = await prisma.eventTicketType.update({
        where: { id },
        data: { isActive: false },
      });
      res.json({ ...disabled, deleted: false, reason: 'SOLD_TICKETS_EXIST' });
      return;
    }

    await prisma.eventTicketType.delete({ where: { id } });
    res.status(204).end();
  }),
);
