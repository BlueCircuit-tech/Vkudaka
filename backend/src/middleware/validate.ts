import type { NextFunction, Request, Response } from 'express';
import type { AnyZodObject, ZodTypeAny } from 'zod';
import { badRequest } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

/**
 * Valida e SUBSTITUI o campo pela versão parseada (coerções aplicadas).
 *
 * A substituição é feita esvaziando o objeto antes de copiar o resultado: o
 * Zod descarta as chaves que o schema não conhece, e só assim elas somem de
 * fato do `req`. Mesclar deixaria passar campo estranho até o Prisma — que
 * responde com erro 500 em vez do 400 devido, e abre porta para escrita em
 * coluna não prevista pelo schema.
 *
 * Não trocamos o objeto por outro porque `req.query`, no Express 4, é exposto
 * por um getter e não aceita atribuição direta.
 */
export const validate =
  (schema: AnyZodObject | ZodTypeAny, source: Source = 'body') =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        badRequest('VALIDATION_ERROR', 'Dados inválidos.', result.error.flatten().fieldErrors),
      );
    }
    const target = req[source] as Record<string, unknown>;
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, result.data);
    next();
  };
