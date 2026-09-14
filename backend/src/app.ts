import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { plansRouter } from './modules/plans/plans.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';
import { webhooksRouter } from './modules/orders/webhooks.routes.js';
import { walletRouter } from './modules/wallet/wallet.routes.js';
import { eventsRouter } from './modules/events/events.routes.js';
import { communityRouter } from './modules/community/community.routes.js';
import { modelsRouter } from './modules/models/models.routes.js';
import { contentRouter } from './modules/content/content.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { adminCatalogRouter } from './modules/admin/admin.catalog.routes.js';
import { uploadsRouter } from './modules/admin/uploads.routes.js';
import { shippingRouter } from './modules/shipping/shipping.routes.js';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(pinoHttp({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' }));

  // Webhook ANTES do express.json(): a assinatura é conferida sobre o corpo bruto.
  app.use('/webhooks', webhooksRouter);

  // Upload antes do express.json(): consome corpo bruto, não JSON.
  app.use(uploadsRouter);

  app.use(express.json({ limit: '2mb' }));

  // Mídia estática (fotos de peças e eventos). Em produção isto sai para o S3/CDN.
  // O helmet aplica Cross-Origin-Resource-Policy: same-origin por padrão, o que
  // impediria o CRM (:5173) e o app de exibirem as imagens servidas aqui (:3333).
  // A exceção é restrita a esta rota — o resto da API segue com a política estrita.
  app.use(
    '/media',
    helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }),
    express.static(fileURLToPath(new URL('../public', import.meta.url))),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'clube-vkudaka-api', env: env.NODE_ENV });
  });

  // Força bruta em login e formulário público de modelos.
  const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });
  app.use('/auth/signin', strictLimiter);
  app.use('/models/apply', rateLimit({ windowMs: 60 * 60 * 1000, limit: 10 }));
  // Consulta pública do convite: o token tem 192 bits, adivinhar é inviável,
  // mas não há motivo para deixar alguém tentar sem limite.
  app.use('/models/invite', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }));

  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/plans', plansRouter);
  app.use('/catalog', catalogRouter);
  app.use('/orders', ordersRouter);
  app.use('/wallet', walletRouter);
  app.use('/events', eventsRouter);
  app.use('/community', communityRouter);
  app.use('/models', modelsRouter);
  app.use('/content', contentRouter);
  app.use('/shipping', shippingRouter);

  // CRM
  app.use('/admin', adminRouter);
  app.use('/admin', adminCatalogRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Rota não encontrada.' });
  });

  app.use(errorHandler);

  return app;
}
