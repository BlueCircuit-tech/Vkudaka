import { z } from 'zod';

/**
 * Lê uma data digitada por gente: DD/MM/AAAA (também com "-" ou "."), AAAA-MM-DD
 * ou ISO completo. Devolve meia-noite UTC — a coluna é @db.Date — ou null se a
 * data não existe (31/02, mês 13...).
 *
 * Antes o cadastro usava z.coerce.date(), que recusava "15/03/1990": era
 * exatamente o que as pessoas digitam no app, e o cadastro falhava com
 * "Dados inválidos." sem dizer o campo.
 */
export function parseBrDate(input: string): Date | null {
  const value = input.trim();

  let day: number;
  let month: number;
  let year: number;

  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(value);
  if (br) {
    [day, month, year] = [Number(br[1]), Number(br[2]), Number(br[3])];
  } else if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Data de nascimento opcional: vazio vira undefined; futuro ou antes de 1900 é recusado. */
export const optionalBirthDate = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z
    .union([z.string(), z.date()])
    .transform((value, ctx) => {
      const date = typeof value === 'string' ? parseBrDate(value) : value;
      if (!date || Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900 || date > new Date()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Data de nascimento inválida. Use o formato DD/MM/AAAA.',
        });
        return z.NEVER;
      }
      return date;
    })
    .optional(),
);
