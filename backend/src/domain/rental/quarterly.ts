/**
 * Peça do trimestre (RN-12) — benefício definido pela Valéria em 14/09/2026.
 *
 *   • Assinante ativa tem direito a 1 peça de aluguel por trimestre, sem custo
 *     de locação — 4 por ano.
 *   • O frete é sempre pago pela cliente ("aluguel tem que pagar o frete").
 *   • Querendo alugar mais no mesmo trimestre, paga o valor normal da peça.
 *   • Não acumula: trimestre que passa sem uso, passa. (Suposição nossa até a
 *     direção dizer o contrário — ela não respondeu esse ponto.)
 *
 * Trimestre é o do calendário (jan–mar, abr–jun, jul–set, out–dez), porque é
 * o que a cliente consegue conferir sozinha sem saber a data em que assinou.
 *
 * Módulo puro: nada de banco. Quem decide se o direito está disponível é o
 * serviço, que consulta os pedidos; aqui só há calendário e aplicação.
 */

export interface QuarterInfo {
  /** Identificador estável do período, gravado no pedido: "2026-Q3". */
  period: string;
  start: Date;
  /** Primeiro instante do trimestre seguinte. */
  nextStart: Date;
  /** Rótulo humano: "jul–set/2026". */
  label: string;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function quarterOf(date: Date): QuarterInfo {
  const year = date.getFullYear();
  const q = Math.floor(date.getMonth() / 3); // 0..3
  const start = new Date(year, q * 3, 1);
  const nextStart = new Date(year, q * 3 + 3, 1);
  return {
    period: `${year}-Q${q + 1}`,
    start,
    nextStart,
    label: `${MONTHS[q * 3]}–${MONTHS[q * 3 + 2]}/${year}`,
  };
}

export interface RentalLine {
  readonly kind: 'SALE' | 'RENTAL' | 'TICKET';
  readonly unitPriceCents: number;
  readonly quantity: number;
}

export interface QuarterlyApplication<T extends RentalLine> {
  readonly items: readonly T[];
  readonly applied: boolean;
  /** Valor de locação que deixou de ser cobrado. */
  readonly savedCents: number;
  /** Índice, em `items`, da linha que ficou grátis. */
  readonly freeIndex: number | null;
}

/**
 * Zera a locação de UMA unidade de UMA peça de aluguel — a primeira do pedido.
 * Se a linha tem mais de uma unidade, ela é dividida: uma grátis, o resto no
 * preço normal. As demais linhas seguem intocadas. A função devolve novos
 * objetos; nunca altera a entrada.
 */
export function applyQuarterlyRental<T extends RentalLine>(
  items: readonly T[],
  available: boolean,
): QuarterlyApplication<T> {
  const index = items.findIndex((i) => i.kind === 'RENTAL' && i.unitPriceCents > 0);
  if (!available || index < 0) {
    return { items, applied: false, savedCents: 0, freeIndex: null };
  }

  const target = items[index]!;
  const free: T = { ...target, unitPriceCents: 0, quantity: 1 };
  const next: T[] = [...items];

  if (target.quantity > 1) {
    next.splice(index, 1, free, { ...target, quantity: target.quantity - 1 });
  } else {
    next.splice(index, 1, free);
  }

  return { items: next, applied: true, savedCents: target.unitPriceCents, freeIndex: index };
}
