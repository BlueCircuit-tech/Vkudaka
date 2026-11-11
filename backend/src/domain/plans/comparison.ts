/**
 * Tabela comparativa "Qual experiência combina com você?" — montada a partir
 * dos benefícios cadastrados no CRM, sem nada fixo no app.
 *
 * Cada benefício com `compareLabel` vira (ou entra em) uma linha da tabela;
 * o valor é `compareValue` ou ✓. Plano sem aquele benefício mostra "—".
 * A ordem das linhas segue a ordem dos benefícios, plano a plano.
 */

export interface ComparablePlan {
  readonly id: string;
  readonly benefits: ReadonlyArray<{
    readonly compareLabel: string | null;
    readonly compareValue: string | null;
  }>;
}

export interface ComparisonRow {
  readonly label: string;
  /** Um valor por plano, na mesma ordem de `plans`. */
  readonly values: string[];
}

export const INCLUDED = '✓';
export const NOT_INCLUDED = '—';

export function buildComparison(plans: readonly ComparablePlan[]): ComparisonRow[] {
  const labels: string[] = [];
  const byKey = new Map<string, string>();
  const key = (planId: string, label: string) => `${planId}::${label.trim().toLowerCase()}`;

  for (const plan of plans) {
    for (const benefit of plan.benefits) {
      const label = benefit.compareLabel?.trim();
      if (!label) continue;
      if (!labels.some((l) => l.toLowerCase() === label.toLowerCase())) labels.push(label);
      byKey.set(key(plan.id, label), benefit.compareValue?.trim() || INCLUDED);
    }
  }

  return labels.map((label) => ({
    label,
    values: plans.map((plan) => byKey.get(key(plan.id, label)) ?? NOT_INCLUDED),
  }));
}
