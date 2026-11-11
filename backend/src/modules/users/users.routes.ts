import { Router } from 'express';
import { z } from 'zod';
import { optionalBirthDate } from '../../lib/br-date.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, param } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { onlyDigits } from '../auth/cpf.js';
import {
  effectiveRebatePercent,
  getActiveSubscription,
  nextInvoicePreview,
  quarterlyRentalStatus,
} from '../subscriptions/subscriptions.service.js';
import * as credits from '../../domain/credits/credits.service.js';
import * as wallet from '../../domain/wallet/wallet.service.js';
import { decimalToNumber } from '../../lib/money.js';

/** Perfil, medidas, endereços e dispositivos do assinante (2.1 / 2.2). */
export const usersRouter: Router = Router();

/** Avatar padrão quando não há foto (2.1): iniciais sobre o preto da marca. */
const initialsAvatar = (fullName: string): string => {
  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return `initials:${initials || 'V'}`;
};

usersRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      include: {
        measurements: true,
        addresses: { orderBy: { isDefault: 'desc' } },
      },
    });
    if (!user) throw notFound('Usuário');

    const subscription = await getActiveSubscription(prisma, user.id);

    res.json({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      cpf: user.cpf,
      phone: user.phone,
      birthDate: user.birthDate,
      instagram: user.instagram,
      gender: user.gender,
      role: user.role,
      avatarUrl: user.avatarUrl,
      avatarFallback: user.avatarUrl ? null : initialsAvatar(user.fullName),
      measurements: user.measurements,
      addresses: user.addresses,
      subscription: subscription && {
        id: subscription.id,
        status: subscription.status,
        planName: subscription.plan.name,
        rebatePercent: effectiveRebatePercent(subscription),
        rebateMode: subscription.plan.rebateMode,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
      // RN-01 — o app usa isto para decidir entre vitrine e redirecionamento.
      isSubscriber: Boolean(subscription),
      storeUrl: env.EXTERNAL_STORE_URL,
    });
  }),
);

usersRouter.patch(
  '/me',
  authenticate,
  validate(
    z.object({
      fullName: z.string().min(3).max(160).optional(),
      phone: z.string().transform(onlyDigits).optional(),
      birthDate: optionalBirthDate,
      instagram: z
        .string()
        .max(60)
        .transform((v) => v.replace(/^@/, ''))
        .optional(),
      gender: z
        .enum(['FEMININO', 'MASCULINO', 'NAO_BINARIO', 'OUTRO', 'PREFIRO_NAO_INFORMAR'])
        .optional(),
      avatarUrl: z.string().url().nullable().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: req.auth!.userId },
      data: req.body as Record<string, unknown>,
    });
    res.json({ ...user, passwordHash: undefined });
  }),
);

/** Preferências de tamanho e medidas (2.1). */
usersRouter.put(
  '/me/measurements',
  authenticate,
  validate(
    z.object({
      dressSize: z.string().max(10).optional(),
      topSize: z.string().max(10).optional(),
      bottomSize: z.string().max(10).optional(),
      shoeSize: z.string().max(10).optional(),
      bustCm: z.number().int().min(40).max(200).optional(),
      waistCm: z.number().int().min(40).max(200).optional(),
      hipsCm: z.number().int().min(40).max(200).optional(),
      heightCm: z.number().int().min(100).max(230).optional(),
      weightKg: z.number().int().min(30).max(250).optional(),
      favoriteColors: z.array(z.string().max(30)).max(10).optional(),
      notes: z.string().max(500).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const data = req.body as Record<string, unknown>;
    const measurements = await prisma.measurement.upsert({
      where: { userId: req.auth!.userId },
      create: { userId: req.auth!.userId, ...data },
      update: data,
    });
    res.json(measurements);
  }),
);

const addressSchema = z.object({
  label: z.string().max(40).optional(),
  zipCode: z.string().transform(onlyDigits).pipe(z.string().length(8)),
  street: z.string().min(3).max(160),
  number: z.string().max(20),
  complement: z.string().max(80).optional(),
  district: z.string().min(2).max(80),
  city: z.string().min(2).max(80),
  state: z.string().length(2).toUpperCase(),
  isDefault: z.boolean().default(false),
});

usersRouter.post(
  '/me/addresses',
  authenticate,
  validate(addressSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof addressSchema>;
    if (body.isDefault) {
      await prisma.address.updateMany({
        where: { userId: req.auth!.userId },
        data: { isDefault: false },
      });
    }
    res.status(201).json(
      await prisma.address.create({ data: { ...body, userId: req.auth!.userId } }),
    );
  }),
);

usersRouter.delete(
  '/me/addresses/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const deleted = await prisma.address.deleteMany({
      where: { id: param(req, 'id'), userId: req.auth!.userId },
    });
    if (deleted.count === 0) throw notFound('Endereço');
    res.status(204).end();
  }),
);

/** Cartão do clube da home (2.2): plano, crédito acumulado e próxima mensalidade. */
usersRouter.get(
  '/me/club',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const [invoice, creditCents, balanceCents, subscription, quarterlyRental] = await Promise.all([
      nextInvoicePreview(prisma, userId),
      credits.availableBalance(prisma, userId),
      wallet.getBalance(prisma, userId),
      getActiveSubscription(prisma, userId),
      quarterlyRentalStatus(prisma, userId),
    ]);

    // Benefícios do nível, na ordem definida no CRM — é onde a assinante vê o
    // que o plano dela inclui.
    const benefits = subscription
      ? await prisma.planBenefit.findMany({
          where: { planId: subscription.plan.id },
          orderBy: { displayOrder: 'asc' },
          select: { title: true, description: true },
        })
      : [];

    res.json({
      welcome: 'Seja bem-vinda ao clube de assinantes VKUDAKA.',
      isSubscriber: Boolean(subscription),
      planName: subscription?.plan.name ?? null,
      planBenefits: benefits,
      rebatePercent: subscription ? effectiveRebatePercent(subscription) : 0,
      // RN-12 — peça do trimestre
      quarterlyRental,
      clubCreditCents: creditCents,
      walletBalanceCents: balanceCents,
      nextInvoice: invoice,
      contacts: {
        whatsapp: env.CLUB_WHATSAPP_URL,
        instagram: env.CLUB_INSTAGRAM_URL,
      },
      storeUrl: env.EXTERNAL_STORE_URL,
    });
  }),
);

/** Registro do token de push (3.7). */
usersRouter.post(
  '/me/devices',
  authenticate,
  validate(
    z.object({
      token: z.string().min(10).max(255),
      platform: z.enum(['IOS', 'ANDROID']),
      appVersion: z.string().max(20).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { token: string; platform: 'IOS' | 'ANDROID'; appVersion?: string };
    const device = await prisma.device.upsert({
      where: { token: body.token },
      create: { ...body, userId: req.auth!.userId },
      update: { userId: req.auth!.userId, isActive: true, lastSeenAt: new Date() },
    });
    res.status(201).json(device);
  }),
);

/**
 * Desliga o aparelho (3.7). Sai da conta, para de receber.
 *
 * Desativa em vez de apagar: o histórico de entregas aponta para o token, e o
 * mesmo aparelho volta a ficar ativo no próximo login pelo upsert acima.
 */
usersRouter.delete(
  '/me/devices/:token',
  authenticate,
  asyncHandler(async (req, res) => {
    await prisma.device.updateMany({
      where: { token: param(req, 'token'), userId: req.auth!.userId },
      data: { isActive: false },
    });
    res.status(204).end();
  }),
);
