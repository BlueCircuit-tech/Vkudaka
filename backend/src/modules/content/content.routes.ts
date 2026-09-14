import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, param } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { env } from '../../config/env.js';

/**
 * Conteúdo editável pela diretoria (2.3).
 * O popup de regras de compra lê `purchase_rules` daqui — o texto é fornecido
 * pela diretoria e alterado no CRM, sem republicar o app nas lojas.
 */
export const contentRouter: Router = Router();

contentRouter.get(
  '/club',
  asyncHandler(async (_req, res) => {
    res.json({
      welcome: 'Seja bem-vinda ao clube de assinantes VKUDAKA.',
      whatsappUrl: env.CLUB_WHATSAPP_URL,
      instagramUrl: env.CLUB_INSTAGRAM_URL,
      storeUrl: env.EXTERNAL_STORE_URL,
    });
  }),
);

contentRouter.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const content = await prisma.appContent.findFirst({
      where: { key: param(req, 'key'), isActive: true },
    });
    if (!content) throw notFound('Conteúdo');
    res.json({
      key: content.key,
      title: content.title,
      body: content.body,
      version: content.version,
    });
  }),
);
