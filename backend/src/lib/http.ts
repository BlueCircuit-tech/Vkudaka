import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errors.js';

/** Envolve handler async para que rejeições cheguem ao errorHandler do Express 4. */
export const asyncHandler =
  <T>(fn: (req: Request, res: Response, next: NextFunction) => Promise<T>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

export interface Page<T> {
  data: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export const paginate = (query: Record<string, unknown>, maxPerPage = 50) => {
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(maxPerPage, Math.max(1, Number(query.perPage) || 20));
  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
};

export const pageResult = <T>(data: T[], total: number, page: number, perPage: number): Page<T> => ({
  data,
  page,
  perPage,
  total,
  totalPages: Math.max(1, Math.ceil(total / perPage)),
});

/**
 * Acesso tipado a parâmetro de rota.
 * Com `noUncheckedIndexedAccess`, `param(req, 'id')` é `string | undefined`; este
 * helper transforma a ausência (que só ocorre por erro de registro de rota) em
 * erro de requisição explícito em vez de `undefined` viajando até o Prisma.
 */
export const param = (req: Request, name: string): string => {
  const value = req.params[name];
  if (!value) throw new AppError(400, 'INVALID_PARAM', `Parâmetro "${name}" ausente na rota.`);
  return value;
};
