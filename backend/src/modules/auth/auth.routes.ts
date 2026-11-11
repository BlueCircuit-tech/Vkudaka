import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import dayjs from 'dayjs';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/http.js';
import { badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { signAccessToken } from '../../lib/jwt.js';
import { randomToken } from '../../lib/codes.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { getActiveSubscription } from '../subscriptions/subscriptions.service.js';
import { onlyDigits } from './cpf.js';
import { signUpSchema } from './signup.schema.js';

export const authRouter: Router = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const signInSchema = z.object({
  // Aceita e-mail ou CPF no mesmo campo — o app não pergunta qual é qual.
  identifier: z.string().min(5),
  password: z.string().min(1),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

async function issueSession(userId: string, role: 'MEMBER' | 'GATE' | 'STAFF' | 'ADMIN', ua?: string) {
  const subscription = await getActiveSubscription(prisma, userId);
  const accessToken = signAccessToken({ sub: userId, role, sub_active: Boolean(subscription) });

  const refreshToken = randomToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
      userAgent: ua?.slice(0, 255),
      expiresAt: dayjs().add(30, 'day').toDate(),
    },
  });

  return { accessToken, refreshToken, subscription };
}

authRouter.post(
  '/signup',
  validate(signUpSchema, 'body', { firstIssueAsMessage: true }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof signUpSchema>;

    const duplicate = await prisma.user.findFirst({
      where: { OR: [{ email: body.email }, { cpf: body.cpf }] },
      select: { email: true, cpf: true },
    });
    if (duplicate) {
      throw conflict(
        duplicate.email === body.email ? 'EMAIL_IN_USE' : 'CPF_IN_USE',
        duplicate.email === body.email
          ? 'Este e-mail já está cadastrado.'
          : 'Este CPF já está cadastrado.',
      );
    }

    const user = await prisma.user.create({
      data: {
        fullName: body.fullName,
        cpf: body.cpf,
        email: body.email,
        phone: body.phone,
        birthDate: body.birthDate,
        instagram: body.instagram,
        gender: body.gender,
        passwordHash: await argon2.hash(body.password),
        acceptedTermsAt: new Date(),
        addresses: { create: { ...body.address, isDefault: true } },
        wallet: { create: {} },
        measurements: { create: {} },
      },
      select: { id: true, fullName: true, email: true, role: true, avatarUrl: true },
    });

    const session = await issueSession(user.id, user.role, req.headers['user-agent']);

    res.status(201).json({
      user,
      ...session,
      // RN-01 — cadastro não cria assinatura. O app leva ao site para assinar.
      subscriptionRequired: !session.subscription,
      storeUrl: env.EXTERNAL_STORE_URL,
    });
  }),
);

authRouter.post(
  '/signin',
  validate(signInSchema),
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body as z.infer<typeof signInSchema>;
    const digits = onlyDigits(identifier);

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier.toLowerCase() }, ...(digits.length === 11 ? [{ cpf: digits }] : [])],
        deletedAt: null,
      },
    });

    // Mensagem única para não revelar se o cadastro existe.
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw unauthorized('E-mail/CPF ou senha incorretos.');
    }
    if (user.status === 'BLOCKED') {
      throw unauthorized('Conta bloqueada. Fale com o clube.');
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const session = await issueSession(user.id, user.role, req.headers['user-agent']);

    res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
      ...session,
      subscriptionRequired: !session.subscription,
      storeUrl: env.EXTERNAL_STORE_URL,
    });
  }),
);

authRouter.post(
  '/refresh',
  validate(z.object({ refreshToken: z.string().min(10) })),
  asyncHandler(async (req, res) => {
    const hash = createHash('sha256').update(req.body.refreshToken as string).digest('hex');
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw unauthorized('Sessão expirada. Entre novamente.');
    }

    // Rotação: o refresh usado é revogado e um novo é emitido.
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const session = await issueSession(stored.userId, stored.user.role, req.headers['user-agent']);
    res.json(session);
  }),
);

authRouter.post(
  '/signout',
  authenticate,
  asyncHandler(async (req, res) => {
    await prisma.refreshToken.updateMany({
      where: { userId: req.auth!.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.status(204).end();
  }),
);

authRouter.post(
  '/password/change',
  authenticate,
  validate(z.object({ currentPassword: z.string(), newPassword: z.string().min(8) })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    if (!(await argon2.verify(user.passwordHash, req.body.currentPassword as string))) {
      throw badRequest('WRONG_PASSWORD', 'Senha atual incorreta.');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(req.body.newPassword as string) },
    });
    res.status(204).end();
  }),
);
