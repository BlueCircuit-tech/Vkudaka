import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Router, raw, type RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../lib/http.js';
import { badRequest } from '../../lib/errors.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { requireActiveSubscriber } from '../../middleware/requireActiveSubscriber.js';

/**
 * Upload de mídia.
 *
 * Recebe o arquivo como corpo bruto em vez de multipart: evita uma dependência
 * a mais para um caso de uso simples (um arquivo por requisição) e mantém o
 * limite de tamanho explícito.
 *
 * Duas portas, porque são dois públicos com riscos diferentes:
 *   • `/admin/uploads`  — equipe: foto de peça, capa e arte de ingresso
 *   • `/uploads`        — assinante: mídia da comunidade, com vídeo liberado
 *
 * Em produção isto vira upload direto ao S3 com URL assinada; o contrato de
 * resposta (`{ url }`) permanece, então o app e o CRM não mudam.
 */
export const uploadsRouter: Router = Router();

const IMAGES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const VIDEOS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

const MB = 1024 * 1024;
const UPLOAD_DIR = fileURLToPath(new URL('../../../public/uploads', import.meta.url));

/**
 * Handler de gravação. O `raw()` já recusou o que passa do limite; aqui só
 * resta conferir o tipo e nomear o arquivo — o nome é sorteado para que o
 * nome original do aparelho não vire URL pública.
 */
const store = (allowed: Record<string, string>): RequestHandler =>
  asyncHandler(async (req, res) => {
    const contentType = req.headers['content-type']?.split(';')[0]?.trim() ?? '';
    const extension = allowed[contentType];

    if (!extension) {
      const nomes = [...new Set(Object.values(allowed))].join(', ').toUpperCase();
      throw badRequest('UNSUPPORTED_MEDIA_TYPE', `Formato não aceito. Envie ${nomes}.`);
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw badRequest('EMPTY_FILE', 'Arquivo vazio.');
    }

    await mkdir(UPLOAD_DIR, { recursive: true });

    const filename = `${randomUUID()}.${extension}`;
    await writeFile(`${UPLOAD_DIR}/${filename}`, req.body);

    res.status(201).json({
      url: `${env.API_PUBLIC_URL}/media/uploads/${filename}`,
      kind: contentType.startsWith('video/') ? 'VIDEO' : 'IMAGE',
      bytes: req.body.length,
    });
  });

// ── Equipe: catálogo, eventos, arte de ingresso ──────────────────────────────
uploadsRouter.post(
  '/admin/uploads',
  authenticate,
  requireRole('STAFF'),
  raw({ type: Object.keys(IMAGES), limit: 8 * MB }),
  store(IMAGES),
);

// ── Assinante: mídia da comunidade (2.5) ─────────────────────────────────────
//
// Vídeo tem teto menor do que o de um app de vídeo porque o corpo bruto passa
// pela memória do processo. Em produção o arquivo vai direto ao S3 e este
// limite deixa de existir.
uploadsRouter.post(
  '/uploads',
  authenticate,
  requireActiveSubscriber,
  raw({ type: [...Object.keys(IMAGES), ...Object.keys(VIDEOS)], limit: 25 * MB }),
  store({ ...IMAGES, ...VIDEOS }),
);
