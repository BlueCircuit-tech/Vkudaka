import { describe, expect, it } from 'vitest';
import { applyQuarterlyRental, quarterOf } from './quarterly.js';

describe('RN-12 — peça do trimestre: calendário', () => {
  it('identifica o trimestre e o início do seguinte', () => {
    const q = quarterOf(new Date(2026, 8, 14)); // 14/set/2026
    expect(q.period).toBe('2026-Q3');
    expect(q.start).toEqual(new Date(2026, 6, 1));
    expect(q.nextStart).toEqual(new Date(2026, 9, 1));
    expect(q.label).toBe('jul–set/2026');
  });

  it('vira o ano no quarto trimestre', () => {
    const q = quarterOf(new Date(2026, 11, 31));
    expect(q.period).toBe('2026-Q4');
    expect(q.nextStart).toEqual(new Date(2027, 0, 1));
  });
});

describe('RN-12 — peça do trimestre: aplicação', () => {
  const rental = { kind: 'RENTAL' as const, unitPriceCents: 39_900, quantity: 1 };
  const sale = { kind: 'SALE' as const, unitPriceCents: 99_900, quantity: 1 };

  it('zera a locação de uma peça quando o direito está disponível', () => {
    const r = applyQuarterlyRental([sale, rental], true);
    expect(r.applied).toBe(true);
    expect(r.savedCents).toBe(39_900);
    expect(r.freeIndex).toBe(1);
    expect(r.items[1]!.unitPriceCents).toBe(0);
    expect(r.items[0]).toEqual(sale); // a venda não muda
  });

  it('não faz nada sem direito disponível', () => {
    const r = applyQuarterlyRental([rental], false);
    expect(r.applied).toBe(false);
    expect(r.items).toEqual([rental]);
  });

  it('não faz nada em pedido sem aluguel', () => {
    const r = applyQuarterlyRental([sale], true);
    expect(r.applied).toBe(false);
    expect(r.savedCents).toBe(0);
  });

  it('libera só UMA unidade: o resto da linha fica no preço normal', () => {
    const r = applyQuarterlyRental([{ ...rental, quantity: 3 }], true);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toEqual({ ...rental, unitPriceCents: 0, quantity: 1 });
    expect(r.items[1]).toEqual({ ...rental, quantity: 2 });
    expect(r.savedCents).toBe(39_900);
  });

  it('só a primeira peça de aluguel fica grátis; a segunda paga', () => {
    const outra = { kind: 'RENTAL' as const, unitPriceCents: 24_900, quantity: 1 };
    const r = applyQuarterlyRental([rental, outra], true);
    expect(r.items[0]!.unitPriceCents).toBe(0);
    expect(r.items[1]!.unitPriceCents).toBe(24_900);
  });

  it('não altera a entrada', () => {
    const input = [{ ...rental }];
    applyQuarterlyRental(input, true);
    expect(input[0]!.unitPriceCents).toBe(39_900);
  });
});
