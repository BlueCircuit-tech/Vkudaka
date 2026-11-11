import { describe, expect, it } from 'vitest';
import { buildComparison } from './comparison.js';

describe('tabela comparativa de planos', () => {
  it('une as linhas dos planos, com ✓, valor próprio e — para o que falta', () => {
    const rows = buildComparison([
      {
        id: 'essencia',
        benefits: [
          { compareLabel: 'Crédito VKUDAKA', compareValue: '100%' },
          { compareLabel: 'Desconto fidelidade', compareValue: '10%' },
          { compareLabel: 'Lives exclusivas', compareValue: null },
          { compareLabel: null, compareValue: null },
        ],
      },
      {
        id: 'premium',
        benefits: [
          { compareLabel: 'Crédito VKUDAKA', compareValue: '100%' },
          { compareLabel: 'desconto fidelidade', compareValue: '15%' },
          { compareLabel: 'Lives exclusivas', compareValue: '' },
          { compareLabel: 'Prioridade na locação', compareValue: null },
        ],
      },
    ]);

    expect(rows).toEqual([
      { label: 'Crédito VKUDAKA', values: ['100%', '100%'] },
      { label: 'Desconto fidelidade', values: ['10%', '15%'] },
      { label: 'Lives exclusivas', values: ['✓', '✓'] },
      { label: 'Prioridade na locação', values: ['—', '✓'] },
    ]);
  });
});
