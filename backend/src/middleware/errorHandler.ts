import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { isProd } from '../config/env.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    return;
  }

  // O body-parser recusa o corpo grande com um erro genérico; sem isto, quem
  // escolheu um vídeo longo recebia "erro interno" e não sabia o que fazer.
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as { type?: string }).type === 'entity.too.large'
  ) {
    res.status(413).json({
      error: 'FILE_TOO_LARGE',
      message: 'Arquivo grande demais. Envie uma imagem de até 8 MB ou um vídeo de até 25 MB.',
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const fields = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'registro';
      res.status(409).json({ error: 'DUPLICATE', message: `Já existe um registro com ${fields}.` });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Registro não encontrado.' });
      return;
    }
  }

  req.log?.error({ err }, 'erro não tratado');
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'Erro interno. Tente novamente.',
    ...(isProd ? {} : { debug: err instanceof Error ? err.message : String(err) }),
  });
}
