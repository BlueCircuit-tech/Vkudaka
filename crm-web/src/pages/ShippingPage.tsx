import React, { useState } from 'react';
import { api, formatBRL } from '../api/client';
import { useApi } from '../lib/useApi';
import { EmptyState, ErrorBox, Loading, Modal, PageHead } from '../components/Page';

/**
 * Logística e fretes (3.6).
 * Cupons de desconto, regras de frete grátis e o status da declaração de
 * conteúdo emitida automaticamente após o pagamento.
 */

interface Coupon {
  id: string;
  code: string;
  description: string | null;
  type: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';
  value: string | number;
  minSubtotalCents: number;
  minItems: number;
  redemptions: number;
  maxRedemptions: number | null;
  isActive: boolean;
}

interface ShippingRule {
  id: string;
  name: string;
  minSubtotalCents: number;
  minItems: number;
  states: string[];
  service: string | null;
  isActive: boolean;
  priority: number;
}

const COUPON_LABEL: Record<Coupon['type'], string> = {
  PERCENT: 'Percentual',
  FIXED: 'Valor fixo',
  FREE_SHIPPING: 'Frete grátis',
};

export function ShippingPage() {
  const coupons = useApi<Coupon[]>('/admin/coupons');
  const rules = useApi<ShippingRule[]>('/admin/shipping-rules');
  const [tab, setTab] = useState<'coupons' | 'rules'>('coupons');
  /* Formulário em modal: a página é a lista, não o cadastro. */
  const [creating, setCreating] = useState(false);

  if (coupons.error) return <ErrorBox message={coupons.error} />;

  return (
    <>
      <PageHead
        title="Logística e fretes"
        description="Cálculo Correios (PAC/Sedex) por CEP, cupons e regras de frete grátis."
        actions={
          <button onClick={() => setCreating(true)}>
            {tab === 'coupons' ? 'Novo cupom' : 'Nova regra'}
          </button>
        }
      />

      <div className="notice" style={{ marginBottom: 18 }}>
        O frete é cotado no fechamento da compra pelo CEP de destino. A declaração de conteúdo é
        emitida automaticamente assim que o pedido é pago, e fica anexada ao envio na tela de
        Pedidos.
        <br />
        <strong>Atenção (RN-02):</strong> cupom percentual substitui o abatimento do plano — os dois
        não se somam. Cupom de valor fixo e frete grátis convivem com o abatimento.
      </div>

      <div className="tabs">
        <button className={tab === 'coupons' ? 'active' : ''} onClick={() => setTab('coupons')}>
          Cupons
        </button>
        <button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>
          Regras de frete grátis
        </button>
      </div>

      {tab === 'coupons' ? (
        <>
          {coupons.loading || !coupons.data ? (
            <Loading />
          ) : (
            <div className="card flush">
              <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Tipo</th>
                    <th>Valor</th>
                    <th>Mínimo</th>
                    <th>Usos</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {coupons.data.map((coupon) => (
                    <tr key={coupon.id}>
                      <td>
                        <strong>{coupon.code}</strong>
                        <div className="muted">{coupon.description}</div>
                      </td>
                      <td>{COUPON_LABEL[coupon.type]}</td>
                      <td>
                        {coupon.type === 'PERCENT'
                          ? `${Number(coupon.value)}%`
                          : coupon.type === 'FIXED'
                            ? formatBRL(Number(coupon.value))
                            : '—'}
                      </td>
                      <td>
                        {coupon.minSubtotalCents > 0 ? formatBRL(coupon.minSubtotalCents) : '—'}
                        {coupon.minItems > 0 ? ` · ${coupon.minItems} peças` : ''}
                      </td>
                      <td>
                        {coupon.redemptions}
                        {coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ''}
                      </td>
                      <td>
                        <span className={coupon.isActive ? 'tag ok' : 'tag'}>
                          {coupon.isActive ? 'ativo' : 'inativo'}
                        </span>
                      </td>
                      <td className="right">
                        <button
                          className="ghost tiny"
                          onClick={async () => {
                            await api.patch(`/admin/coupons/${coupon.id}`, {
                              isActive: !coupon.isActive,
                            });
                            await coupons.reload();
                          }}
                        >
                          {coupon.isActive ? 'Desativar' : 'Ativar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {rules.loading || !rules.data ? (
            <Loading />
          ) : (
            <div className="card flush">
              <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Regra</th>
                    <th>Subtotal mínimo</th>
                    <th>Peças mínimas</th>
                    <th>Estados</th>
                    <th>Modalidade</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rules.data.map((rule) => (
                    <tr key={rule.id}>
                      <td><strong>{rule.name}</strong></td>
                      <td>{rule.minSubtotalCents > 0 ? formatBRL(rule.minSubtotalCents) : '—'}</td>
                      <td>{rule.minItems > 0 ? rule.minItems : '—'}</td>
                      <td>{rule.states.length > 0 ? rule.states.join(', ') : 'todos'}</td>
                      <td>{rule.service ?? 'todas'}</td>
                      <td>
                        <span className={rule.isActive ? 'tag ok' : 'tag'}>
                          {rule.isActive ? 'ativa' : 'inativa'}
                        </span>
                      </td>
                      <td className="right">
                        <button
                          className="ghost tiny"
                          onClick={async () => {
                            await api.patch(`/admin/shipping-rules/${rule.id}`, {
                              isActive: !rule.isActive,
                            });
                            await rules.reload();
                          }}
                        >
                          {rule.isActive ? 'Desativar' : 'Ativar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}

      {creating && tab === 'coupons' ? (
        <CouponForm
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void coupons.reload();
          }}
        />
      ) : null}

      {creating && tab === 'rules' ? (
        <RuleForm
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void rules.reload();
          }}
        />
      ) : null}
    </>
  );
}

function CouponForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    code: '',
    description: '',
    type: 'FIXED' as Coupon['type'],
    value: '50',
    minSubtotal: '',
    minItems: '',
  });
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await api.post('/admin/coupons', {
        code: form.code.toUpperCase(),
        description: form.description || undefined,
        type: form.type,
        // FIXED trafega em centavos; PERCENT em pontos percentuais.
        value:
          form.type === 'FIXED'
            ? Math.round(Number(form.value.replace(',', '.')) * 100)
            : Number(form.value.replace(',', '.')),
        minSubtotalCents: form.minSubtotal
          ? Math.round(Number(form.minSubtotal.replace(',', '.')) * 100)
          : 0,
        minItems: form.minItems ? Number(form.minItems) : 0,
      });
      setForm({ ...form, code: '', description: '' });
      onCreated();
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  return (
    <Modal
      title="Novo cupom"
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose}>Cancelar</button>
          <button form="coupon-form" type="submit">Criar cupom</button>
        </>
      }
    >
      <form id="coupon-form" onSubmit={submit}>
      <div className="row">
        <div className="field">
          <label>Código</label>
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
        </div>
        <div className="field">
          <label>Tipo</label>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Coupon['type'] })}>
            <option value="FIXED">Valor fixo (R$)</option>
            <option value="PERCENT">Percentual (%)</option>
            <option value="FREE_SHIPPING">Frete grátis</option>
          </select>
        </div>
        {form.type !== 'FREE_SHIPPING' ? (
          <div className="field">
            <label>Valor</label>
            <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          </div>
        ) : null}
        <div className="field">
          <label>Subtotal mínimo (R$)</label>
          <input value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} />
        </div>
        <div className="field">
          <label>Peças mínimas</label>
          <input value={form.minItems} onChange={(e) => setForm({ ...form, minItems: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label>Descrição</label>
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </Modal>
  );
}

function RuleForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', minSubtotal: '', minItems: '', states: '', priority: '0' });
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await api.post('/admin/shipping-rules', {
        name: form.name,
        minSubtotalCents: form.minSubtotal
          ? Math.round(Number(form.minSubtotal.replace(',', '.')) * 100)
          : 0,
        minItems: form.minItems ? Number(form.minItems) : 0,
        states: form.states
          .split(',')
          .map((state) => state.trim().toUpperCase())
          .filter(Boolean),
        priority: Number(form.priority),
      });
      setForm({ name: '', minSubtotal: '', minItems: '', states: '', priority: '0' });
      onCreated();
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  return (
    <Modal
      title="Nova regra de frete grátis"
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose}>Cancelar</button>
          <button form="rule-form" type="submit">Criar regra</button>
        </>
      }
    >
      <form id="rule-form" onSubmit={submit}>
      <div className="row">
        <div className="field">
          <label>Nome</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="field">
          <label>Subtotal mínimo (R$)</label>
          <input value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} />
        </div>
        <div className="field">
          <label>Quantidade mínima de peças</label>
          <input value={form.minItems} onChange={(e) => setForm({ ...form, minItems: e.target.value })} />
        </div>
        <div className="field">
          <label>Estados (UF, separados por vírgula)</label>
          <input value={form.states} onChange={(e) => setForm({ ...form, states: e.target.value })} />
        </div>
        <div className="field">
          <label>Prioridade</label>
          <input value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
        </div>
      </div>
        <p className="hint">
          Informe pelo menos um critério — regra sem critério não concede frete grátis.
        </p>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </Modal>
  );
}
