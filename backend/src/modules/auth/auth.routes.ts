import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import dayjs from 'dayjs';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/http.js';
import { AppError, badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { signAccessToken } from '../../lib/jwt.js';
import { randomToken } from '../../lib/codes.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { getActiveSubscription } from '../subscriptions/subscriptions.service.js';
import { onlyDigits } from './cpf.js';
import { signUpSchema } from './signup.schema.js';
import { sendMail } from '../../integrations/mail/mailer.js';

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

// ── Esqueci a senha (2026-11-12) ─────────────────────────────────────────────
//
// 1. POST /auth/password/forgot {identifier} — manda um código de 6 dígitos
//    para o e-mail do cadastro. A resposta é sempre a mesma, exista ou não a
//    conta, para não revelar quem é cliente.
// 2. POST /auth/password/reset {identifier, code, newPassword} — confere o
//    código (15 min, 5 tentativas), troca a senha e derruba as sessões abertas.

const RESET_TTL_MINUTES = 15;
const RESET_MAX_ATTEMPTS = 5;
const RESET_RESEND_SECONDS = 60;

const resetCodeHash = (resetId: string, code: string) =>
  createHmac('sha256', env.JWT_SECRET).update(`${resetId}:${code}`).digest('hex');

const findByIdentifier = (identifier: string) => {
  const digits = onlyDigits(identifier);
  return prisma.user.findFirst({
    where: {
      OR: [{ email: identifier.trim().toLowerCase() }, ...(digits.length === 11 ? [{ cpf: digits }] : [])],
      deletedAt: null,
    },
  });
};

const FORGOT_MESSAGE =
  'Se houver uma conta com esse e-mail ou CPF, enviamos um código de 6 dígitos para o e-mail cadastrado. Confira também o spam.';

authRouter.post(
  '/password/forgot',
  validate(z.object({ identifier: z.string().trim().min(5, 'Informe seu e-mail ou CPF.') })),
  asyncHandler(async (req, res) => {
    const user = await findByIdentifier((req.body as { identifier: string }).identifier);

    if (user && user.status !== 'BLOCKED') {
      // Toques repetidos não disparam uma enxurrada de e-mails.
      const recent = await prisma.passwordReset.findFirst({
        where: {
          userId: user.id,
          usedAt: null,
          createdAt: { gt: dayjs().subtract(RESET_RESEND_SECONDS, 'second').toDate() },
        },
      });

      if (!recent) {
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const reset = await prisma.$transaction(async (tx) => {
          // Só o código mais novo vale.
          await tx.passwordReset.updateMany({
            where: { userId: user.id, usedAt: null },
            data: { usedAt: new Date() },
          });
          const created = await tx.passwordReset.create({
            data: {
              userId: user.id,
              codeHash: '0'.repeat(64),
              expiresAt: dayjs().add(RESET_TTL_MINUTES, 'minute').toDate(),
            },
          });
          return tx.passwordReset.update({
            where: { id: created.id },
            data: { codeHash: resetCodeHash(created.id, code) },
          });
        });

        const firstName = user.fullName.split(' ')[0] ?? user.fullName;
        const firstNameHtml = firstName.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
        try {
          await sendMail({
            to: user.email,
            subject: `${code} é o seu código do Clube VKUDAKA`,
            text:
              `Olá, ${firstName}!\n\nSeu código para criar uma nova senha no app Clube VKUDAKA é: ${code}\n\n` +
              `Ele vale por ${RESET_TTL_MINUTES} minutos. Se não foi você que pediu, ignore este e-mail — sua senha continua a mesma.\n\nClube VKUDAKA`,
            html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#22201d">
  <p style="letter-spacing:.2em;font-size:12px;color:#8a6d3b;margin:0 0 16px">CLUBE VKUDAKA</p>
  <p>Olá, ${firstNameHtml}!</p>
  <p>Seu código para criar uma nova senha no app é:</p>
  <p style="font-size:34px;letter-spacing:.3em;font-weight:bold;background:#FAF7F3;border:1px solid #e4ddd3;border-radius:12px;padding:16px;text-align:center;margin:20px 0">${code}</p>
  <p>Ele vale por ${RESET_TTL_MINUTES} minutos.</p>
  <p style="color:#7a736a;font-size:13px">Se não foi você que pediu, ignore este e-mail — sua senha continua a mesma.</p>
</div>`,
          });
        } catch (error) {
          // E-mail que não saiu não pode deixar a pessoa esperando um código.
          await prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
          console.error('[e-mail] falha ao enviar código de senha:', error);
          throw new AppError(
            503,
            'MAIL_SEND_FAILED',
            'Não conseguimos enviar o e-mail agora. Tente de novo em alguns minutos ou fale com o clube.',
          );
        }
      }
    }

    res.json({ message: FORGOT_MESSAGE });
  }),
);

authRouter.post(
  '/password/reset',
  validate(
    z.object({
      identifier: z.string().trim().min(5, 'Informe seu e-mail ou CPF.'),
      code: z.string().trim().regex(/^\d{6}$/, 'O código tem 6 números.'),
      newPassword: z
        .string()
        .min(8, 'A senha precisa ter pelo menos 8 caracteres.')
        .max(128, 'Senha longa demais.'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { identifier: string; code: string; newPassword: string };
    const invalid = () =>
      badRequest('INVALID_RESET_CODE', 'Código inválido ou vencido. Confira o e-mail ou peça um novo código.');

    const user = await findByIdentifier(body.identifier);
    if (!user || user.status === 'BLOCKED') throw invalid();

    const reset = await prisma.passwordReset.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!reset || reset.expiresAt < new Date() || reset.attempts >= RESET_MAX_ATTEMPTS) throw invalid();

    const expected = Buffer.from(reset.codeHash, 'hex');
    const received = Buffer.from(resetCodeHash(reset.id, body.code), 'hex');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      await prisma.passwordReset.update({
        where: { id: reset.id },
        data: { attempts: { increment: 1 } },
      });
      throw invalid();
    }

    const passwordHash = await argon2.hash(body.newPassword);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      // Senha nova derruba as sessões abertas em outros aparelhos.
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: { actorId: user.id, action: 'auth.password_reset', entity: 'User', entityId: user.id, ip: req.ip ?? null },
      }),
    ]);

    res.status(204).end();
  }),
);
