import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/http.js';
import { badRequest, notFound, unauthorized } from '../../lib/errors.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';

/**
 * Exclusão de conta pelo próprio membro (exigência do Google Play e da LGPD).
 *
 * É uma anonimização, não um DELETE físico: pedidos, pagamentos e notas fiscais
 * têm retenção legal (5 anos) e continuam apontando para o id. O que identifica
 * a pessoa — nome, e-mail, CPF, telefone, nascimento, foto, medidas, endereços,
 * redes sociais — é apagado ou substituído na hora, as sessões caem, o aparelho
 * para de receber push, e o que foi publicado na comunidade some do feed.
 *
 * A mesma pessoa pode se cadastrar de novo depois com o mesmo CPF e e-mail,
 * porque os valores únicos são substituídos por placeholders derivados do id.
 */
export const accountDeletionRouter: Router = Router();

const schema = z.object({ password: z.string().min(1) });

/** CPF placeholder: 11 dígitos derivados do id, só para manter a unicidade da coluna. */
const placeholderCpf = (userId: string): string =>
  createHash('sha256').update(`deleted:${userId}`).digest('hex').replace(/\D/g, '').padEnd(11, '0').slice(0, 11);

accountDeletionRouter.post(
  '/me/delete',
  authenticate,
  validate(schema),
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw notFound('Conta');
    if (user.role !== 'MEMBER') throw badRequest('TEAM_ACCOUNT', 'Contas da equipe são encerradas pela administração.');
    if (!(await argon2.verify(user.passwordHash, (req.body as z.infer<typeof schema>).password))) {
      throw unauthorized('Senha incorreta.');
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'DELETED',
          deletedAt: now,
          fullName: 'Conta excluída',
          email: `excluida+${userId}@vkudaka.invalid`,
          cpf: placeholderCpf(userId),
          phone: '',
          birthDate: null,
          instagram: null,
          gender: null,
          avatarUrl: null,
          passwordHash: randomBytes(32).toString('hex'),
        },
      });
      await tx.measurement.deleteMany({ where: { userId } });
      await tx.address.deleteMany({ where: { userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.device.updateMany({ where: { userId }, data: { isActive: false } });
      await tx.subscription.updateMany({
        where: { userId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED'] } },
        data: { status: 'CANCELED', canceledAt: now, cancelAtPeriodEnd: false },
      });
      await tx.post.updateMany({ where: { userId, deletedAt: null }, data: { status: 'DELETED', deletedAt: now } });
      await tx.comment.updateMany({ where: { userId, deletedAt: null }, data: { status: 'DELETED', deletedAt: now } });
      await tx.userBlock.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
      await tx.auditLog.create({
        data: { actorId: userId, action: 'account.delete', entity: 'user', entityId: userId, ip: req.ip ?? null },
      });
    });

    res.status(204).end();
  }),
);
