import React, { useState } from 'react';
import { api, formatBRL } from '../api/client';
import { useApi } from '../lib/useApi';
import { ErrorBox, Loading, PageHead } from '../components/Page';

/**
 * Planos e benefícios (3.2).
 *
 * Modelo do clube (2026-11-11): 100% da mensalidade vira crédito VKUDAKA na
 * carteira, e o percentual editado aqui é o desconto fidelidade aplicado na
 * hora da compra. O app lê preço, selos, benefícios e a tabela comparativa
 * daqui — nada é hardcoded no cliente, a alteração vale sem deploy.
 */

interface Plan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  promoLabel: string | null;
  highlightLabel: string | null;
  interval: 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL';
  rebatePercent: string | number;
  rebateMode: 'CREDIT_NEXT_INVOICE' | 'IMMEDIATE_DISCOUNT';
  isActive: boolean;
  displayOrder: number;
  benefits: Array<{
    id: string;
    title: string;
    description: string | null;
    compareLabel: string | null;
    compareValue: string | null;
  }>;
  _count: { subscriptions: number };
}

/** Benefício em edição — sem id, porque a lista é substituída inteira ao salvar. */
interface BenefitDraft {
  title: string;
  description: string;
  /** Linha da tabela comparativa do app (vazio = fora da tabela). */
  compareLabel: string;
  /** Valor na tabela (vazio = ✓). */
  compareValue: string;
}

type PlanFields = Partial<{
  name: string;
  description: string | undefined;
  priceCents: number;
  compareAtPriceCents: number | null;
  promoLabel: string | null;
  highlightLabel: string | null;
  interval: Plan['interval'];
  rebatePercent: number;
  rebateMode: Plan['rebateMode'];
  isActive: boolean;
}>;

const toReais = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const toCents = (reais: string) =>
  Math.round(Number(reais.replace(/\./g, '').replace(',', '.')) * 100);
/** Campo opcional de preço: vazio = null. */
const toOptionalCents = (reais: string) => (reais.trim() ? toCents(reais) : null);

const MODE_LABEL: Record<Plan['rebateMode'], string> = {
  IMMEDIATE_DISCOUNT: 'Na hora da compra (padrão)',
  CREDIT_NEXT_INVOICE: 'Crédito na próxima mensalidade (antigo)',
};

/** "de R$ 119,00 por R$ 99,00" + selos, como aparece no app. */
function PriceLine({ plan }: { plan: Plan }) {
  const showCompare =
    plan.compareAtPriceCents != null && plan.compareAtPriceCents > plan.priceCents;
  return (
    <p style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {showCompare ? (
        <span className="muted">
          de <s>{formatBRL(plan.compareAtPriceCents!)}</s> por
        </span>
      ) : null}
      <strong>{formatBRL(plan.priceCents)}</strong>
      <span className="muted">/{INTERVAL_LABEL[plan.interval].toLowerCase()}</span>
      {plan.promoLabel ? <span className="tag gold">{plan.promoLabel}</span> : null}
      {plan.highlightLabel ? <span className="tag">{plan.highlightLabel}</span> : null}
    </p>
  );
}

const INTERVAL_LABEL: Record<Plan['interval'], string> = {
  MONTHLY: 'Mensal',
  QUARTERLY: 'Trimestral',
  SEMIANNUAL: 'Semestral',
  ANNUAL: 'Anual',
};

const emptyForm = {
  name: '',
  slug: '',
  description: '',
  priceReais: '99',
  compareAtReais: '',
  promoLabel: '',
  highlightLabel: '',
  interval: 'MONTHLY' as Plan['interval'],
  rebatePercent: '10',
  rebateMode: 'IMMEDIATE_DISCOUNT' as Plan['rebateMode'],
  benefits: '',
};

export function PlansPage() {
  const { data, error, loading, reload } = useApi<Plan[]>('/admin/plans');
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const savePlan = async (plan: Plan, fields: PlanFields, benefits: BenefitDraft[] | null) => {
    setSaving(plan.id);
    setFormError(null);
    try {
      if (Object.keys(fields).length > 0) await api.patch(`/admin/plans/${plan.id}`, fields);
      if (benefits) {
        await api.put(`/admin/plans/${plan.id}/benefits`, {
          benefits: benefits
            .filter((b) => b.title.trim())
            .map((b) => ({
              title: b.title.trim(),
              description: b.description.trim() || undefined,
              compareLabel: b.compareLabel.trim() || null,
              compareValue: b.compareValue.trim() || null,
            })),
        });
      }
      await reload();
    } catch (caught) {
      setFormError((caught as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const createPlan = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    try {
      await api.post('/admin/plans', {
        name: form.name,
        slug: form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        description: form.description || undefined,
        priceCents: Math.round(Number(form.priceReais.replace(',', '.')) * 100),
        compareAtPriceCents: toOptionalCents(form.compareAtReais),
        promoLabel: form.promoLabel.trim() || null,
        highlightLabel: form.highlightLabel.trim() || null,
        interval: form.interval,
        rebatePercent: Number(form.rebatePercent.replace(',', '.')),
        rebateMode: form.rebateMode,
        benefits: form.benefits
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((title) => ({ title })),
      });
      setForm(emptyForm);
      setCreating(false);
      await reload();
    } catch (caught) {
      setFormError((caught as Error).message);
    }
  };

  if (error) return <ErrorBox message={error} />;
  if (loading || !data) return <Loading />;

  return (
    <>
      <PageHead
        title="Planos e benefícios"
        description="Preço, selos, benefícios, tabela comparativa e desconto fidelidade de cada plano."
        actions={
          <button onClick={() => setCreating((current) => !current)}>
            {creating ? 'Cancelar' : 'Novo plano'}
          </button>
        }
      />

      <div className="notice" style={{ marginBottom: 18 }}>
        <strong>Como funciona o clube:</strong> <strong>100% da mensalidade vira crédito
        VKUDAKA</strong> na carteira da assinante, para comprar peças. O percentual de cada plano é o{' '}
        <strong>desconto fidelidade</strong>, aplicado na hora da compra — inclusive quando ela paga
        com créditos. Ele <strong>não é acumulativo</strong> com cupom percentual nem com peça em
        promoção. O app lê estes valores em tempo real; alterar aqui muda a tela de planos e o
        botão "Comprar" imediatamente.
      </div>

      {creating ? (
        <form className="card" onSubmit={createPlan} style={{ marginBottom: 18 }}>
          <h2 style={{ marginBottom: 14 }}>Novo plano</h2>
          <div className="row">
            <div className="field">
              <label>Nome</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="field">
              <label>Preço (R$)</label>
              <input value={form.priceReais} onChange={(e) => setForm({ ...form, priceReais: e.target.value })} />
            </div>
            <div className="field">
              <label>Preço cheio — "de" (R$)</label>
              <input
                value={form.compareAtReais}
                placeholder="opcional"
                onChange={(e) => setForm({ ...form, compareAtReais: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Periodicidade</label>
              <select
                value={form.interval}
                onChange={(e) => setForm({ ...form, interval: e.target.value as Plan['interval'] })}
              >
                {Object.entries(INTERVAL_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Desconto fidelidade (%)</label>
              <input
                value={form.rebatePercent}
                onChange={(e) => setForm({ ...form, rebatePercent: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Quando o desconto vale</label>
              <select
                value={form.rebateMode}
                onChange={(e) => setForm({ ...form, rebateMode: e.target.value as Plan['rebateMode'] })}
              >
                <option value="IMMEDIATE_DISCOUNT">{MODE_LABEL.IMMEDIATE_DISCOUNT}</option>
                <option value="CREDIT_NEXT_INVOICE">{MODE_LABEL.CREDIT_NEXT_INVOICE}</option>
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Selo de preço</label>
              <input
                value={form.promoLabel}
                placeholder="ex.: Preço Black Friday"
                maxLength={40}
                onChange={(e) => setForm({ ...form, promoLabel: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Selo de destaque</label>
              <input
                value={form.highlightLabel}
                placeholder="ex.: Mais popular"
                maxLength={40}
                onChange={(e) => setForm({ ...form, highlightLabel: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label>Benefícios (um por linha — a tabela comparativa é ajustada depois, no card do plano)</label>
            <textarea
              rows={4}
              value={form.benefits}
              onChange={(e) => setForm({ ...form, benefits: e.target.value })}
            />
          </div>
          {formError ? <p className="error">{formError}</p> : null}
          <button type="submit">Criar plano</button>
        </form>
      ) : null}

      {formError && !creating ? (
        <p className="error" style={{ marginBottom: 14 }}>{formError}</p>
      ) : null}

      <div className="grid cols-2">
        {data.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            saving={saving === plan.id}
            onSave={(fields, benefits) => void savePlan(plan, fields, benefits)}
          />
        ))}
      </div>
    </>
  );
}

function PlanCard({
  plan,
  saving,
  onSave,
}: {
  plan: Plan;
  saving: boolean;
  onSave: (fields: PlanFields, benefits: BenefitDraft[] | null) => void;
}) {
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? '');
  const [price, setPrice] = useState(toReais(plan.priceCents));
  const [compareAt, setCompareAt] = useState(
    plan.compareAtPriceCents != null ? toReais(plan.compareAtPriceCents) : '',
  );
  const [promoLabel, setPromoLabel] = useState(plan.promoLabel ?? '');
  const [highlightLabel, setHighlightLabel] = useState(plan.highlightLabel ?? '');
  const [interval, setInterval] = useState(plan.interval);
  const [percent, setPercent] = useState(String(Number(plan.rebatePercent)));
  const [mode, setMode] = useState(plan.rebateMode);
  const [isActive, setIsActive] = useState(plan.isActive);
  const [benefits, setBenefits] = useState<BenefitDraft[]>(
    plan.benefits.map((b) => ({
      title: b.title,
      description: b.description ?? '',
      compareLabel: b.compareLabel ?? '',
      compareValue: b.compareValue ?? '',
    })),
  );

  const priceCents = toCents(price);
  const priceError = !Number.isFinite(priceCents) || priceCents < 0 ? 'Preço inválido.' : null;
  const compareAtCents = toOptionalCents(compareAt);
  const compareAtError =
    compareAtCents === null
      ? null
      : !Number.isFinite(compareAtCents) || compareAtCents < 0
        ? 'Preço cheio inválido.'
        : !priceError && compareAtCents <= priceCents
          ? 'O preço cheio ("de") precisa ser maior que o preço.'
          : null;
  const percentValue = Number(percent.replace(',', '.'));
  const percentError =
    !Number.isFinite(percentValue) || percentValue < 0 || percentValue > 100
      ? 'Percentual entre 0 e 100.'
      : null;

  // Só o que mudou vai para o servidor — a auditoria registra o antes e o
  // depois, e mandar o plano inteiro poluiria o histórico com "alterações"
  // que não aconteceram.
  const fields: PlanFields = {};
  if (name.trim() !== plan.name) fields.name = name.trim();
  if ((description.trim() || undefined) !== (plan.description ?? undefined)) {
    fields.description = description.trim() || undefined;
  }
  if (!priceError && priceCents !== plan.priceCents) fields.priceCents = priceCents;
  if (!compareAtError && compareAtCents !== plan.compareAtPriceCents) {
    fields.compareAtPriceCents = compareAtCents;
  }
  if ((promoLabel.trim() || null) !== plan.promoLabel) fields.promoLabel = promoLabel.trim() || null;
  if ((highlightLabel.trim() || null) !== plan.highlightLabel) {
    fields.highlightLabel = highlightLabel.trim() || null;
  }
  if (interval !== plan.interval) fields.interval = interval;
  if (!percentError && percentValue !== Number(plan.rebatePercent)) {
    fields.rebatePercent = percentValue;
  }
  if (mode !== plan.rebateMode) fields.rebateMode = mode;
  if (isActive !== plan.isActive) fields.isActive = isActive;

  const benefitsChanged =
    JSON.stringify(
      benefits.map((b) => [
        b.title.trim(),
        b.description.trim(),
        b.compareLabel.trim(),
        b.compareValue.trim(),
      ]),
    ) !==
    JSON.stringify(
      plan.benefits.map((b) => [
        b.title,
        b.description ?? '',
        b.compareLabel ?? '',
        b.compareValue ?? '',
      ]),
    );

  const dirty = Object.keys(fields).length > 0 || benefitsChanged;
  const invalid =
    priceError !== null ||
    compareAtError !== null ||
    percentError !== null ||
    name.trim().length < 2;

  const updateBenefit = (index: number, patch: Partial<BenefitDraft>) =>
    setBenefits((list) => list.map((b, i) => (i === index ? { ...b, ...patch } : b)));

  const moveBenefit = (index: number, delta: -1 | 1) =>
    setBenefits((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      const a = next[index]!;
      next[index] = next[target]!;
      next[target] = a;
      return next;
    });

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2>{plan.name}</h2>
        <label className="check" style={{ marginBottom: 0 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {isActive ? 'ativo' : 'inativo'}
        </label>
      </div>
      <PriceLine plan={plan} />
      <p className="muted" style={{ marginTop: 4 }}>{plan._count.subscriptions} assinante(s)</p>

      <div className="row" style={{ marginTop: 14 }}>
        <div className="field">
          <label>Nome</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>Preço (R$)</label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
        </div>
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Periodicidade</label>
          <select value={interval} onChange={(e) => setInterval(e.target.value as Plan['interval'])}>
            {Object.entries(INTERVAL_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>
      {priceError ? <p className="error">{priceError}</p> : null}

      <div className="row">
        <div className="field" style={{ maxWidth: 170 }}>
          <label>Preço cheio — "de" (R$)</label>
          <input
            value={compareAt}
            placeholder="opcional"
            onChange={(e) => setCompareAt(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div className="field">
          <label>Selo de preço</label>
          <input
            value={promoLabel}
            placeholder="ex.: Preço Black Friday"
            maxLength={40}
            onChange={(e) => setPromoLabel(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Selo de destaque</label>
          <input
            value={highlightLabel}
            placeholder="ex.: Mais popular"
            maxLength={40}
            onChange={(e) => setHighlightLabel(e.target.value)}
          />
        </div>
      </div>
      {compareAtError ? <p className="error">{compareAtError}</p> : null}
      <p className="hint">
        Com preço cheio, o app mostra "de R$ X por R$ Y". O plano com selo de destaque aparece em
        destaque (fundo escuro). Deixe em branco para não mostrar.
      </p>

      <div className="field">
        <label>Descrição curta (aparece no app)</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
      </div>

      <div className="row">
        <div className="field" style={{ maxWidth: 150 }}>
          <label>Desconto fidelidade (%)</label>
          <input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Quando o desconto vale</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as Plan['rebateMode'])}>
            <option value="IMMEDIATE_DISCOUNT">{MODE_LABEL.IMMEDIATE_DISCOUNT}</option>
            <option value="CREDIT_NEXT_INVOICE">{MODE_LABEL.CREDIT_NEXT_INVOICE}</option>
          </select>
        </div>
      </div>
      {percentError ? <p className="error">{percentError}</p> : null}

      <p className="hint">
        Peça de {formatBRL(30_000)} gera{' '}
        <strong>
          {formatBRL(Math.round(30_000 * (Number.isFinite(percentValue) ? percentValue : 0)) / 100)}
        </strong>{' '}
        {mode === 'CREDIT_NEXT_INVOICE'
          ? 'de crédito na próxima mensalidade — só quando a assinante não usa saldo da carteira.'
          : 'de desconto fidelidade na hora da compra, mesmo pagando com créditos.'}
      </p>

      {/* ── Benefícios ── */}
      <div style={{ marginTop: 18 }}>
        <label>Benefícios (na ordem em que aparecem no app)</label>
        <p className="hint" style={{ marginTop: 0 }}>
          "Linha na tabela" coloca o benefício na tabela comparativa do app (ex.: "Desconto
          fidelidade"); use o mesmo nome nos dois planos para ficarem na mesma linha. "Valor" é o
          que aparece na célula (ex.: "15%"); vazio mostra ✓. Plano sem a linha mostra —.
        </p>
        {benefits.length === 0 ? (
          <p className="muted" style={{ fontSize: 12.5 }}>Nenhum benefício cadastrado.</p>
        ) : null}
        {benefits.map((benefit, index) => (
          <div
            key={index}
            style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 10 }}
          >
            <div style={{ display: 'grid', gap: 6 }}>
              <input
                value={benefit.title}
                placeholder="Título do benefício"
                onChange={(e) => updateBenefit(index, { title: e.target.value })}
                maxLength={120}
              />
              <input
                value={benefit.description}
                placeholder="Detalhe (opcional)"
                onChange={(e) => updateBenefit(index, { description: e.target.value })}
                maxLength={300}
                style={{ fontSize: 12.5 }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 6 }}>
                <input
                  value={benefit.compareLabel}
                  placeholder="Linha na tabela comparativa (opcional)"
                  onChange={(e) => updateBenefit(index, { compareLabel: e.target.value })}
                  maxLength={60}
                  style={{ fontSize: 12.5 }}
                />
                <input
                  value={benefit.compareValue}
                  placeholder="✓"
                  title="Valor na tabela (vazio = ✓)"
                  onChange={(e) => updateBenefit(index, { compareValue: e.target.value })}
                  maxLength={20}
                  style={{ fontSize: 12.5 }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button
                type="button"
                className="quiet tiny"
                onClick={() => moveBenefit(index, -1)}
                disabled={index === 0}
                title="Subir"
              >
                ↑
              </button>
              <button
                type="button"
                className="quiet tiny"
                onClick={() => moveBenefit(index, 1)}
                disabled={index === benefits.length - 1}
                title="Descer"
              >
                ↓
              </button>
              <button
                type="button"
                className="ghost tiny"
                onClick={() => setBenefits((list) => list.filter((_, i) => i !== index))}
                title="Remover"
              >
                ×
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="ghost tiny"
          onClick={() =>
            setBenefits((list) => [
              ...list,
              { title: '', description: '', compareLabel: '', compareValue: '' },
            ])
          }
        >
          + Benefício
        </button>
      </div>

      {fields.priceCents !== undefined && plan._count.subscriptions > 0 ? (
        <p className="hint" style={{ marginTop: 14 }}>
          O preço novo vale para quem assinar daqui em diante. As {plan._count.subscriptions}{' '}
          assinatura(s) em vigor seguem com o valor contratado — reajuste de plano não altera
          contrato vigente.
        </p>
      ) : null}

      <button
        style={{ marginTop: 16 }}
        disabled={!dirty || invalid || saving}
        onClick={() => onSave(fields, benefitsChanged ? benefits : null)}
      >
        {saving ? 'Salvando…' : 'Salvar alterações'}
      </button>
    </div>
  );
}
