import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, ReportTargetType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, pageResult, paginate, param } from '../../lib/http.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';

/**
 * Fila de denúncias da comunidade (CRM › Clube › Denúncias).
 *
 * STAFF vê a fila, oculta conteúdo e ignora denúncias. Bloquear a conta do
 * membro é decisão de ADMIN, como já vale em /admin/users/:id/status.
 *
 * Resolver uma denúncia resolve TODAS as abertas sobre o mesmo alvo: a equipe
 * não precisa clicar dez vezes porque dez pessoas denunciaram o mesmo post.
 */
export const adminModerationRouter: Router = Router();

adminModerationRouter.use(authenticate, requireRole('STAFF'));

const userSelect = { id: true, fullName: true, email: true, status: true, avatarUrl: true } as const;

/** Junta ao registro da denúncia um retrato do alvo para a fila mostrar o que foi denunciado. */
async function describeTargets(reports: Array<{ targetType: ReportTargetType; targetId: string }>) {
  const ids = (type: ReportTargetType) =>
    Array.from(new Set(reports.filter((r) => r.targetType === type).map((r) => r.targetId)));

  const [posts, comments, users] = await Promise.all([
    prisma.post.findMany({
      where: { id: { in: ids('POST') } },
      select: { id: true, content: true, status: true, createdAt: true, user: { select: userSelect }, media: { select: { url: true, kind: true }, take: 1 } },
    }),
    prisma.comment.findMany({
      where: { id: { in: ids('COMMENT') } },
      select: { id: true, content: true, status: true, createdAt: true, postId: true, user: { select: userSelect } },
    }),
    prisma.user.findMany({ where: { id: { in: ids('USER') } }, select: userSelect }),
  ]);

  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
  return { posts: byId(posts), comments: byId(comments), users: byId(users) };
}

adminModerationRouter.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const { page, perPage, skip, take } = paginate(req.query);
    const status = req.query.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
    const where: Prisma.ContentReportWhereInput =
      status === 'OPEN' ? { status: 'OPEN' } : { status: { in: ['RESOLVED', 'DISMISSED'] } };

    const [reports, total, openCount] = await Promise.all([
      prisma.contentReport.findMany({
        where,
        include: { reporter: { select: userSelect }, resolvedBy: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: status === 'OPEN' ? 'asc' : 'desc' },
        skip,
        take,
      }),
      prisma.contentReport.count({ where }),
      prisma.contentReport.count({ where: { status: 'OPEN' } }),
    ]);

    const targets = await describeTargets(reports);
    const data = reports.map((report) => {
      const target =
        report.targetType === 'POST'
          ? targets.posts.get(report.targetId)
          : report.targetType === 'COMMENT'
            ? targets.comments.get(report.targetId)
            : targets.users.get(report.targetId);
      return { ...report, target: target ?? null };
    });

    res.json({ ...pageResult(data, total, page, perPage), openCount });
  }),
);

const resolveSchema = z.object({
  /** HIDE oculta o post/comentário; BLOCK_USER bloqueia a conta do autor; DISMISS mantém. */
  action: z.enum(['HIDE', 'BLOCK_USER', 'DISMISS']),
});

adminModerationRouter.patch(
  '/reports/:id',
  validate(resolveSchema),
  asyncHandler(async (req, res) => {
    const { action } = req.body as z.infer<typeof resolveSchema>;
    const report = await prisma.contentReport.findUnique({ where: { id: param(req, 'id') } });
    if (!report) throw notFound('Denúncia');
    if (action === 'BLOCK_USER' && req.auth!.role !== 'ADMIN') throw forbidden('Só a administração bloqueia contas.');

    const actorId = req.auth!.userId;
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      let resolution: 'HIDDEN' | 'USER_BLOCKED' | 'DISMISSED' = 'DISMISSED';
      let authorId: string | null = report.targetType === 'USER' ? report.targetId : null;

      if (action === 'HIDE') {
        if (report.targetType === 'POST') {
          const post = await tx.post.findUnique({ where: { id: report.targetId } });
          if (!post) throw notFound('Publicação');
          if (!post.deletedAt) await tx.post.update({ where: { id: post.id }, data: { status: 'HIDDEN', deletedAt: now } });
          authorId = post.userId;
        } else if (report.targetType === 'COMMENT') {
          const comment = await tx.comment.findUnique({ where: { id: report.targetId } });
          if (!comment) throw notFound('Comentário');
          if (!comment.deletedAt) {
            await tx.comment.update({ where: { id: comment.id }, data: { status: 'HIDDEN', deletedAt: now } });
            await tx.post.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } });
          }
          authorId = comment.userId;
        } else {
          throw badRequest('INVALID_ACTION', 'Denúncia de membro: bloqueie a conta ou ignore.');
        }
        resolution = 'HIDDEN';
      }

      if (action === 'BLOCK_USER') {
        if (!authorId) {
          const row =
            report.targetType === 'POST'
              ? await tx.post.findUnique({ where: { id: report.targetId }, select: { userId: true } })
              : await tx.comment.findUnique({ where: { id: report.targetId }, select: { userId: true } });
          if (!row) throw notFound('Conteúdo denunciado');
          authorId = row.userId;
        }
        const author = await tx.user.findUnique({ where: { id: authorId }, select: { role: true, status: true } });
        if (!author) throw notFound('Membro');
        if (author.role !== 'MEMBER') throw badRequest('TEAM_ACCOUNT', 'Contas da equipe não são bloqueadas por aqui.');
        await tx.user.update({ where: { id: authorId }, data: { status: 'BLOCKED' } });
        // Quem teve a conta bloqueada some do feed: oculta tudo que publicou.
        await tx.post.updateMany({ where: { userId: authorId, deletedAt: null }, data: { status: 'HIDDEN', deletedAt: now } });
        await tx.comment.updateMany({ where: { userId: authorId, deletedAt: null }, data: { status: 'HIDDEN', deletedAt: now } });
        resolution = 'USER_BLOCKED';
      }

      await tx.contentReport.updateMany({
        where: { targetType: report.targetType, targetId: report.targetId, status: 'OPEN' },
        data: { status: resolution === 'DISMISSED' ? 'DISMISSED' : 'RESOLVED', resolution, resolvedById: actorId, resolvedAt: now },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: `moderation.${action.toLowerCase()}`,
          entity: report.targetType.toLowerCase(),
          entityId: report.targetId,
          after: { reportId: report.id, resolution, authorId },
          ip: req.ip ?? null,
        },
      });
    });

    res.json(await prisma.contentReport.findUniqueOrThrow({ where: { id: report.id } }));
  }),
);
