/** Utilidades monetárias. Toda conta do sistema é em centavos inteiros. */

export const toCents = (reais: number): number => Math.round(reais * 100);
export const toReais = (cents: number): number => cents / 100;

export const formatBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Converte Decimal do Prisma (ou string) em number de forma segura. */
export const decimalToNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value.toString());
};
