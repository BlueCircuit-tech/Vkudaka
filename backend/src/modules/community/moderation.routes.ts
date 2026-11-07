import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, param } from '../../lib/http.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';

/**
 * Denunciar e bloquear (exigência das lojas para apps com conteúdo de usuários).
 *
 *  • Denúncia: uma por (denunciante, alvo). Denunciar de novo atualiza o motivo
 *    em vez de duplicar. Fica na fila do CRM (Clube › Denúncias); nada é
 *    ocultado automaticamente — é a moderação quem decide.
 *  • Bloqueio: imediato e silencioso. O feed passa a esconder o bloqueado para
 *    quem bloqueou e vice-versa (ver moderation.service.ts).
 *
 * As rotas não exigem assinatura ativa: quem perdeu a assinatura ainda pode
 * gerir bloqueios feitos enquanto era assinante.
 */
export const moderationRouter: Router = Router();

const REASONS = ['SPAM', 'HARASSMENT', 'NUDITY', 'VIOLENCE', 'HATE', 'SCAM', 'OTHER'] as const;

const reportSchema = z.object({
  reason: z.enum(REASONS),
  details: z.string().trim().max(500).optional(),
});

type TargetType = 'POST' | 'COMMENT' | 'USER';

/** Confere que o alvo existe, está visível e não pertence a quem denuncia. */
async function resolveTarget(type: TargetType, id: string, reporterId: string) {
  if (type === 'POST') {
    const post = await prisma.post.findFirst({ where: { id, deletedAt: null }, select: { userId: true } });
    if (!post) throw notFound('Publicação');
    if (post.userId === reporterId) throw badRequest('OWN_CONTENT', 'Você não pode denunciar a própria publicação.');
    return;
  }
  if (type === 'COMMENT') {
    const comment = await prisma.comment.findFirst({ where: { id, deletedAt: null }, select: { userId: true } });
    if (!comment) throw notFound('Comentário');
    if (comment.userId === reporterId) throw badRequest('OWN_CONTENT', 'Você não pode denunciar o próprio comentário.');
    return;
  }
  if (id === reporterId) throw badRequest('OWN_CONTENT', 'Você não pode denunciar a si mesmo.');
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!user) throw notFound('Membro');
}

const report = (type: TargetType) =>
  asyncHandler(async (req, res) => {
    const targetId = param(req, 'id');
    const reporterId = req.auth!.userId;
    const body = req.body as z.infer<typeof reportSchema>;
    await resolveTarget(type, targetId, reporterId);

    const created = await prisma.contentReport.upsert({
      where: { reporterId_targetType_targetId: { reporterId, targetType: type, targetId } },
      create: { reporterId, targetType: type, targetId, reason: body.reason, details: body.details || null },
      // Se a denúncia anterior já foi tratada, uma nova reabre a fila.
      update: { reason: body.reason, details: body.details || null, status: 'OPEN', resolution: null, resolvedAt: null, resolvedById: null },
      select: { id: true, status: true, createdAt: true },
    });
    res.status(201).json(created);
  });

moderationRouter.post('/posts/:id/report', authenticate, validate(reportSchema), report('POST'));
moderationRouter.post('/comments/:id/report', authenticate, validate(reportSchema), report('COMMENT'));
moderationRouter.post('/users/:id/report', authenticate, validate(reportSchema), report('USER'));

// ── Bloqueios ────────────────────────────────────────────────────────────────

const blockedSelect = { id: true, fullName: true, avatarUrl: true } as const;

moderationRouter.get(
  '/blocks',
  authenticate,
  asyncHandler(async (req, res) => {
    const blocks = await prisma.userBlock.findMany({
      where: { blockerId: req.auth!.userId },
      include: { blocked: { select: blockedSelect } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(blocks.map((block) => ({ user: block.blocked, createdAt: block.createdAt })));
  }),
);

moderationRouter.post(
  '/users/:id/block',
  authenticate,
  asyncHandler(async (req, res) => {
    const blockedId = param(req, 'id');
    const blockerId = req.auth!.userId;
    if (blockedId === blockerId) throw badRequest('SELF_BLOCK', 'Você não pode bloquear a si mesmo.');
    const target = await prisma.user.findFirst({ where: { id: blockedId, deletedAt: null }, select: blockedSelect });
    if (!target) throw notFound('Membro');

    await prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
    res.status(201).json({ user: target });
  }),
);

moderationRouter.delete(
  '/users/:id/block',
  authenticate,
  asyncHandler(async (req, res) => {
    await prisma.userBlock.deleteMany({ where: { blockerId: req.auth!.userId, blockedId: param(req, 'id') } });
    res.status(204).end();
  }),
);
