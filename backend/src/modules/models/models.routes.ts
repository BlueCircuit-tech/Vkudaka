import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, pageResult, paginate, param } from '../../lib/http.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { onlyDigits } from '../auth/cpf.js';

/**
 * Modelos (3.5).
 *
 * Três portas para uma ficha entrar no elenco:
 *
 *   1. Formulário público  — `POST /models/apply`, o link divulgado. Cai no
 *      CRM como candidatura, aguardando aprovação.
 *   2. Convite pessoal     — a equipe cria a ficha só com nome e contato
 *      (`POST /models/invite`), recebe um token e manda o link. A modelo
 *      completa o resto pelo mesmo formulário; o token é de uso único.
 *   3. Cadastro pelo CRM   — `POST /models`, ficha completa digitada pela
 *      equipe, já no elenco.
 *
 * Os campos da ficha seguem o briefing (nome, idade, manequim, medidas,
 * contato, portfólio). O formulário da Valéria, quando chegar, ajusta esta
 * lista — o `payload` da candidatura guarda tudo o que veio, mesmo o que a
 * ficha ainda não tem coluna.
 */
export const modelsRouter: Router = Router();

const profileFields = {
  fullName: z.string().min(3).max(160),
  birthDate: z.coerce.date().optional(),
  email: z.string().email().max(160).optional(),
  phone: z.string().transform(onlyDigits).optional(),
  instagram: z
    .string()
    .max(60)
    .transform((v) => v.replace(/^@/, ''))
    .optional(),
  city: z.string().max(80).optional(),
  state: z.string().length(2).toUpperCase().optional(),
  dressSize: z.string().max(10).optional(), // manequim
  shoeSize: z.string().max(10).optional(),
  heightCm: z.number().int().min(120).max(220).optional(),
  bustCm: z.number().int().min(40).max(200).optional(),
  waistCm: z.number().int().min(40).max(200).optional(),
  hipsCm: z.number().int().min(40).max(200).optional(),
  hairColor: z.string().max(40).optional(),
  eyeColor: z.string().max(40).optional(),
  portfolioUrl: z.string().url().optional(),
  photos: z.array(z.string().url()).max(8).default([]),
};

const applicationSchema = z.object({
  ...profileFields,
  source: z.enum(['form', 'google_forms', 'crm']).default('form'),
  /** Presente quando a modelo veio por convite pessoal do CRM. */
  inviteToken: z.string().min(16).max(64).optional(),
});

/** Idade calculada uma vez, no cadastro — é o que o CRM lista. */
const ageOf = (birthDate?: Date | null) =>
  birthDate ? dayjs().diff(birthDate, 'year') : null;

// ── 1 + 2. Formulário público (com ou sem convite) ───────────────────────────

modelsRouter.post(
  '/apply',
  validate(applicationSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof applicationSchema>;
    const { source, inviteToken, ...profile } = body;

    // Convite pessoal: completa a ficha que a equipe abriu, em vez de criar outra.
    if (inviteToken) {
      const invited = await prisma.modelProfile.findUnique({ where: { inviteToken } });
      if (!invited) throw notFound('Convite');
      if (invited.completedAt) {
        throw badRequest('INVITE_USED', 'Este link já foi usado. Fale com a equipe VKUDAKA.');
      }

      const model = await prisma.modelProfile.update({
        where: { id: invited.id },
        data: {
          ...profile,
          ageAtSignup: ageOf(profile.birthDate),
          completedAt: new Date(),
          isActive: false, // segue para aprovação como qualquer candidatura
          application: { create: { source: 'form', payload: body } },
        },
        include: { application: true },
      });

      res.status(201).json({
        id: model.id,
        status: model.application?.status,
        message: 'Cadastro recebido. A equipe VKUDAKA entrará em contato.',
      });
      return;
    }

    const model = await prisma.modelProfile.create({
      data: {
        ...profile,
        ageAtSignup: ageOf(profile.birthDate),
        isActive: false, // só entra no elenco após aprovação
        application: { create: { source, payload: body } },
      },
      include: { application: true },
    });

    res.status(201).json({
      id: model.id,
      status: model.application?.status,
      message: 'Cadastro recebido. A equipe VKUDAKA entrará em contato.',
    });
  }),
);

/**
 * Dados que o formulário mostra ao abrir um link de convite: só o necessário
 * para cumprimentar e pré-preencher. Nada de medidas ou notas internas numa
 * rota pública.
 */
modelsRouter.get(
  '/invite/:token',
  asyncHandler(async (req, res) => {
    const model = await prisma.modelProfile.findUnique({
      where: { inviteToken: param(req, 'token') },
      select: { fullName: true, email: true, phone: true, instagram: true, completedAt: true },
    });
    if (!model) throw notFound('Convite');
    res.json({ ...model, used: Boolean(model.completedAt), completedAt: undefined });
  }),
);

// ── Equipe ───────────────────────────────────────────────────────────────────

modelsRouter.get(
  '/',
  authenticate,
  requireRole('STAFF'),
  asyncHandler(async (req, res) => {
    const { page, perPage, skip, take } = paginate(req.query);
    const where = req.query.status
      ? { application: { status: req.query.status as never } }
      : {};

    const [models, total] = await Promise.all([
      prisma.modelProfile.findMany({
        where,
        include: { application: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.modelProfile.count({ where }),
    ]);

    res.json(pageResult(models, total, page, perPage));
  }),
);

/** 3. Ficha completa digitada pela equipe — já no elenco. */
modelsRouter.post(
  '/',
  authenticate,
  requireRole('STAFF'),
  validate(z.object({ ...profileFields, notes: z.string().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<z.ZodObject<typeof profileFields>> & { notes?: string };

    const model = await prisma.modelProfile.create({
      data: {
        ...body,
        ageAtSignup: ageOf(body.birthDate),
        isActive: true,
        completedAt: new Date(),
        application: {
          create: { source: 'crm', payload: body, status: 'APPROVED', reviewedAt: new Date() },
        },
      },
      include: { application: true },
    });

    res.status(201).json(model);
  }),
);

/**
 * 2. Convite pessoal: abre a ficha com o mínimo e devolve o token.
 * O CRM monta o link (`/cadastro-modelo?convite=<token>`) e o botão de
 * WhatsApp — a URL pública é do CRM, não do servidor.
 */
modelsRouter.post(
  '/invite',
  authenticate,
  requireRole('STAFF'),
  validate(
    z.object({
      fullName: z.string().min(3).max(160),
      phone: z.string().transform(onlyDigits).optional(),
      email: z.string().email().max(160).optional(),
      instagram: z
        .string()
        .max(60)
        .transform((v) => v.replace(/^@/, ''))
        .optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { fullName: string; phone?: string; email?: string; instagram?: string };

    const model = await prisma.modelProfile.create({
      data: {
        ...body,
        isActive: false,
        inviteToken: randomBytes(24).toString('base64url'),
        invitedAt: new Date(),
      },
    });

    res.status(201).json({ id: model.id, inviteToken: model.inviteToken, fullName: model.fullName });
  }),
);

/** Convite ainda não respondido pode ser regerado (link perdido, número errado). */
modelsRouter.post(
  '/:id/invite',
  authenticate,
  requireRole('STAFF'),
  asyncHandler(async (req, res) => {
    const current = await prisma.modelProfile.findUnique({ where: { id: param(req, 'id') } });
    if (!current) throw notFound('Modelo');
    if (current.completedAt) {
      throw badRequest('ALREADY_COMPLETED', 'Esta ficha já foi preenchida — edite-a diretamente.');
    }
    const model = await prisma.modelProfile.update({
      where: { id: current.id },
      data: { inviteToken: randomBytes(24).toString('base64url'), invitedAt: new Date() },
    });
    res.json({ id: model.id, inviteToken: model.inviteToken, fullName: model.fullName });
  }),
);

modelsRouter.get(
  '/:id',
  authenticate,
  requireRole('STAFF'),
  asyncHandler(async (req, res) => {
    const model = await prisma.modelProfile.findUnique({
      where: { id: param(req, 'id') },
      include: { application: true },
    });
    if (!model) throw notFound('Modelo');
    res.json(model);
  }),
);

/** Edição da ficha pela equipe. Idade é recalculada se a data de nascimento mudar. */
modelsRouter.patch(
  '/:id',
  authenticate,
  requireRole('STAFF'),
  validate(
    z
      .object({ ...profileFields, notes: z.string().max(500).optional(), isActive: z.boolean() })
      .partial(),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<z.ZodObject<typeof profileFields>>> & {
      notes?: string;
      isActive?: boolean;
    };

    const model = await prisma.modelProfile.update({
      where: { id: param(req, 'id') },
      data: {
        ...body,
        ...(body.birthDate !== undefined ? { ageAtSignup: ageOf(body.birthDate) } : {}),
      },
      include: { application: true },
    });

    res.json(model);
  }),
);

modelsRouter.patch(
  '/:id/review',
  authenticate,
  requireRole('STAFF'),
  validate(
    z.object({
      status: z.enum(['IN_REVIEW', 'APPROVED', 'REJECTED']),
      reviewNotes: z.string().max(500).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { status: 'IN_REVIEW' | 'APPROVED' | 'REJECTED'; reviewNotes?: string };

    const model = await prisma.modelProfile.update({
      where: { id: param(req, 'id') },
      data: {
        isActive: body.status === 'APPROVED',
        application: {
          upsert: {
            create: {
              source: 'crm',
              payload: {},
              status: body.status,
              reviewNotes: body.reviewNotes,
              reviewedAt: new Date(),
            },
            update: {
              status: body.status,
              reviewNotes: body.reviewNotes,
              reviewedAt: new Date(),
            },
          },
        },
      },
      include: { application: true },
    });

    res.json(model);
  }),
);
