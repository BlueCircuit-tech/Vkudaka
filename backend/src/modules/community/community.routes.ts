import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, pageResult, paginate, param } from '../../lib/http.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { authenticate } from '../../middleware/auth.js';
import { requireActiveSubscriber } from '../../middleware/requireActiveSubscriber.js';
import { validate } from '../../middleware/validate.js';
import { hiddenUserIdsFor } from './moderation.service.js';

/**
 * Comunidade (2.5) — feed entre assinantes.
 *
 * Decisões:
 *  • Soft delete: post apagado some do feed mas mantém histórico de moderação.
 *  • Contadores desnormalizados (likeCount/commentCount) atualizados na mesma
 *    transação da interação — o feed não faz COUNT por post.
 *  • Hiperlinks nos comentários são extraídos e devolvidos em `links` para o
 *    app renderizar como toque, sem parsear HTML no cliente.
 */
export const communityRouter: Router = Router();

const URL_PATTERN = /https?:\/\/[^\s<>"]+/gi;
const extractLinks = (text: string): string[] => Array.from(new Set(text.match(URL_PATTERN) ?? []));

const authorSelect = { id: true, fullName: true, avatarUrl: true } as const;

communityRouter.get(
  '/feed',
  authenticate,
  requireActiveSubscriber,
  asyncHandler(async (req, res) => {
    const { page, perPage, skip, take } = paginate(req.query);
    // Bloqueios somem do feed nos dois sentidos (moderation.service.ts).
    const hidden = await hiddenUserIdsFor(req.auth!.userId);
    const where = { status: 'PUBLISHED' as const, deletedAt: null, userId: { notIn: hidden } };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          user: { select: authorSelect },
          media: { orderBy: { displayOrder: 'asc' } },
          likes: { where: { userId: req.auth!.userId }, select: { userId: true } },
        },
        orderBy: [{ isOfficial: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      prisma.post.count({ where }),
    ]);

    res.json(
      pageResult(
        posts.map((post) => ({
          ...post,
          likes: undefined,
          likedByMe: post.likes.length > 0,
          isMine: post.userId === req.auth!.userId,
        })),
        total,
        page,
        perPage,
      ),
    );
  }),
);

const postSchema = z.object({
  content: z.string().min(1).max(2000),
  media: z
    .array(
      z.object({
        kind: z.enum(['IMAGE', 'VIDEO']),
        url: z.string().url(),
        thumbnailUrl: z.string().url().optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        durationMs: z.number().int().optional(),
      }),
    )
    .max(6)
    .default([]),
});

communityRouter.post(
  '/posts',
  authenticate,
  requireActiveSubscriber,
  validate(postSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof postSchema>;
    const post = await prisma.post.create({
      data: {
        userId: req.auth!.userId,
        content: body.content,
        media: { create: body.media.map((m, index) => ({ ...m, displayOrder: index })) },
      },
      include: { user: { select: authorSelect }, media: true },
    });
    res.status(201).json(post);
  }),
);

communityRouter.patch(
  '/posts/:id',
  authenticate,
  validate(z.object({ content: z.string().min(1).max(2000) })),
  asyncHandler(async (req, res) => {
    const post = await prisma.post.findUnique({ where: { id: param(req, 'id') } });
    if (!post || post.deletedAt) throw notFound('Publicação');
    if (post.userId !== req.auth!.userId) throw forbidden('Você só pode editar seus posts.');

    res.json(
      await prisma.post.update({
        where: { id: post.id },
        data: { content: req.body.content as string, editedAt: new Date() },
        include: { user: { select: authorSelect }, media: true },
      }),
    );
  }),
);

communityRouter.delete(
  '/posts/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const post = await prisma.post.findUnique({ where: { id: param(req, 'id') } });
    if (!post || post.deletedAt) throw notFound('Publicação');

    const isAuthor = post.userId === req.auth!.userId;
    const isModerator = req.auth!.role === 'ADMIN' || req.auth!.role === 'STAFF';
    if (!isAuthor && !isModerator) throw forbidden('Você só pode apagar seus posts.');

    await prisma.post.update({
      where: { id: post.id },
      data: { status: isAuthor ? 'DELETED' : 'HIDDEN', deletedAt: new Date() },
    });
    res.status(204).end();
  }),
);

/** Curtir é idempotente: a PK composta (postId, userId) impede duplicidade. */
communityRouter.post(
  '/posts/:id/like',
  authenticate,
  requireActiveSubscriber,
  asyncHandler(async (req, res) => {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.postLike.findUnique({
        where: { postId_userId: { postId: param(req, 'id'), userId: req.auth!.userId } },
      });

      if (existing) {
        await tx.postLike.delete({
          where: { postId_userId: { postId: param(req, 'id'), userId: req.auth!.userId } },
        });
        const post = await tx.post.update({
          where: { id: param(req, 'id') },
          data: { likeCount: { decrement: 1 } },
        });
        return { liked: false, likeCount: post.likeCount };
      }

      await tx.postLike.create({ data: { postId: param(req, 'id'), userId: req.auth!.userId } });
      const post = await tx.post.update({
        where: { id: param(req, 'id') },
        data: { likeCount: { increment: 1 } },
      });
      return { liked: true, likeCount: post.likeCount };
    });

    res.json(result);
  }),
);

communityRouter.get(
  '/posts/:id/comments',
  authenticate,
  requireActiveSubscriber,
  asyncHandler(async (req, res) => {
    const hidden = await hiddenUserIdsFor(req.auth!.userId);
    const comments = await prisma.comment.findMany({
      where: { postId: param(req, 'id'), status: 'PUBLISHED', deletedAt: null, userId: { notIn: hidden } },
      include: { user: { select: authorSelect } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(comments.map((comment) => ({ ...comment, isMine: comment.userId === req.auth!.userId })));
  }),
);

communityRouter.post(
  '/posts/:id/comments',
  authenticate,
  requireActiveSubscriber,
  validate(z.object({ content: z.string().min(1).max(1000), parentId: z.string().uuid().optional() })),
  asyncHandler(async (req, res) => {
    const content = req.body.content as string;

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          postId: param(req, 'id'),
          userId: req.auth!.userId,
          parentId: (req.body.parentId as string | undefined) ?? null,
          content,
          links: extractLinks(content), // hiperlinks clicáveis no app
        },
        include: { user: { select: authorSelect } },
      });
      await tx.post.update({
        where: { id: param(req, 'id') },
        data: { commentCount: { increment: 1 } },
      });
      return created;
    });

    res.status(201).json(comment);
  }),
);

communityRouter.delete(
  '/comments/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const comment = await prisma.comment.findUnique({ where: { id: param(req, 'id') } });
    if (!comment || comment.deletedAt) throw notFound('Comentário');

    const isAuthor = comment.userId === req.auth!.userId;
    const isModerator = req.auth!.role === 'ADMIN' || req.auth!.role === 'STAFF';
    if (!isAuthor && !isModerator) throw forbidden('Você só pode apagar seus comentários.');

    await prisma.$transaction(async (tx) => {
      await tx.comment.update({
        where: { id: comment.id },
        data: { status: isAuthor ? 'DELETED' : 'HIDDEN', deletedAt: new Date() },
      });
      await tx.post.update({
        where: { id: comment.postId },
        data: { commentCount: { decrement: 1 } },
      });
    });

    res.status(204).end();
  }),
);
