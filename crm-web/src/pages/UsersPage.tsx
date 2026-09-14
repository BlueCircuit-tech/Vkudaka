import React, { useState } from 'react';
import { api, formatBRL, formatDate } from '../api/client';
import { CREDIT_STATUS, ORDER_STATUS, describe, tagClass } from '../lib/labels';
import { useApi } from '../lib/useApi';
import {
  EmptyState,
  ErrorBox,
  Loading,
  Modal,
  PageHead,
  Pagination,
  SectionTitle,
  Stat,
} from '../components/Page';

/**
 * Assinantes (3.2) — lista de acessos, carteira, créditos e assinatura.
 *
 * É aqui que a diretoria concede, migra e cancela plano. Antes disso o clube
 * não tinha como admitir ninguém pelo painel: a assinatura só existia via seed.
 */

interface Subscription {
  id: string;
  status: string;
  currentPeriodEnd: string;
  priceCents: number;
  /** Abatimento negociado com a assinante. Nulo = vale o do plano. */
  rebatePercent: string | number | null;
  plan: { id: string; name: string; rebatePercent: string | number };
}

interface UserRow {
  id: string;
  fullName: string;
  email: string;
  cpf: string;
  phone: string;
  instagram: string | null;
  status: 'ACTIVE' | 'BLOCKED' | 'DELETED';
  role: string;
  createdAt: string;
  lastLoginAt: string | null;
  wallet: { balanceCents: number } | null;
  subscriptions: Array<{
    status: string;
    currentPeriodEnd: string;
    rebatePercent: string | number | null;
    plan: { name: string; rebatePercent: string | number };
  }>;
  _count: { orders: number };
}

interface Credit {
  id: string;
  amountCents: number;
  usedCents: number;
  status: string;
  reason: string;
  createdAt: string;
}

interface UserDetail extends Omit<UserRow, 'subscriptions'> {
  birthDate: string | null;
  gender: string | null;
  subscriptions: Subscription[];
  credits: Credit[];
  orders: Array<{ id: string; code: string; totalCents: number; status: string; createdAt: string }>;
  measurements: {
    dressSize: string | null;
    topSize: string | null;
    bottomSize: string | null;
    shoeSize: string | null;
    bustCm: number | null;
    waistCm: number | null;
    hipsCm: number | null;
    heightCm: number | null;
    favoriteColors: string[];
    notes: string | null;
  } | null;
  addresses: Array<{ id: string; street: string; number: string; city: string; state: string }>;
}

interface Plan {
  id: string;
  name: string;
  priceCents: number;
  rebatePercent: string | number;
}

const isActive = (s: { status: string; currentPeriodEnd: string }) =>
  ['ACTIVE', 'TRIALING'].includes(s.status) && new Date(s.currentPeriodEnd) >= new Date();

/**
 * Percentual que vale de fato para a assinante: o negociado quando existe,
 * senão o do nível. Espelha `effectiveRebatePercent` no servidor — o CRM
 * precisa mostrar o mesmo número que o app cobra.
 */
const effectiveRebate = (s: {
  rebatePercent: string | number | null;
  plan: { rebatePercent: string | number };
}) => Number(s.rebatePercent ?? s.plan.rebatePercent);

const isNegotiated = (s: { rebatePercent: string | number | null }) => s.rebatePercent != null;

/**
 * Campo do abatimento negociado, com atalhos para as condições mais usadas.
 * Vazio significa "vale o percentual do nível" — é o mesmo contrato do
 * servidor, onde `null` desfaz a condição especial.
 */
function RebateField({
  value,
  onChange,
  planPercent,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  planPercent: number | null;
  error: string | null;
}) {
  const parsed = value.trim() === '' ? null : Number(value.trim().replace(',', '.'));
  return (
    <div className="field" style={{ flex: '1 1 260px', maxWidth: 340 }}>
      <label>Abatimento (%)</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={planPercent != null ? `${planPercent} (do plano)` : 'do plano'}
          inputMode="decimal"
          style={{ width: 88, flex: '0 0 88px' }}
        />
        {['10', '15'].map((quick) => (
          <button
            key={quick}
            type="button"
            className={value === quick ? 'gold tiny' : 'quiet tiny'}
            onClick={() => onChange(value === quick ? '' : quick)}
          >
            {quick}%
          </button>
        ))}
        <button
          type="button"
          className={value.trim() === '' ? 'gold tiny' : 'quiet tiny'}
          onClick={() => onChange('')}
        >
          Do plano
        </button>
      </div>
      <span className="sub" style={{ marginTop: 6 }}>
        {error ??
          (parsed == null
            ? `Em branco: vale o percentual do nível${planPercent != null ? ` (${planPercent}%)` : ''}.`
            : `Condição negociada de ${parsed}%${
                planPercent != null ? ` — o nível dá ${planPercent}%` : ''
              }.`)}
      </span>
    </div>
  );
}

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [audience, setAudience] = useState<'MEMBERS' | 'TEAM'>('MEMBERS');
  const [detailId, setDetailId] = useState<string | null>(null);

  const perPage = 20;
  const { data, error, loading, reload } = useApi<{ data: UserRow[]; total: number }>(
    `/admin/users?page=${page}&perPage=${perPage}&audience=${audience}` +
      `${query ? `&search=${encodeURIComponent(query)}` : ''}`,
  );

  if (error) return <ErrorBox message={error} />;

  const applySearch = () => {
    setQuery(search);
    setPage(1);
  };

  return (
    <>
      <PageHead
        title={audience === 'MEMBERS' ? 'Assinantes' : 'Equipe'}
        description={
          audience === 'MEMBERS'
            ? 'Clientes do app, com plano vigente, carteira e histórico.'
            : 'Contas internas: administração, operação e portaria.'
        }
        actions={
          <>
            <div>
              <label>Buscar</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                placeholder="nome, e-mail ou CPF"
              />
            </div>
            <button className="ghost" onClick={applySearch}>Buscar</button>
          </>
        }
      />

      <div className="tabs">
        <button
          className={audience === 'MEMBERS' ? 'active' : ''}
          onClick={() => {
            setAudience('MEMBERS');
            setPage(1);
          }}
        >
          Assinantes
        </button>
        <button
          className={audience === 'TEAM' ? 'active' : ''}
          onClick={() => {
            setAudience('TEAM');
            setPage(1);
          }}
        >
          Equipe
        </button>
      </div>

      {loading || !data ? (
        <Loading rows={5} />
      ) : data.data.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nenhum cadastro encontrado"
            description={
              query
                ? `Nada corresponde a "${query}".`
                : audience === 'MEMBERS'
                  ? 'Ainda não há clientes cadastrados no app.'
                  : 'Nenhuma conta interna cadastrada.'
            }
          />
        </div>
      ) : (
        <div className="card flush">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Contato</th>
                  <th>Plano</th>
                  <th>Carteira</th>
                  <th>Pedidos</th>
                  <th>Desde</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((user) => {
                  const subscription = user.subscriptions.find(isActive);
                  return (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.fullName}</strong>
                        <div className="sub">
                          {user.cpf}
                          {user.status === 'BLOCKED' ? ' · bloqueado' : ''}
                        </div>
                      </td>
                      <td>
                        {user.email}
                        <div className="sub">{user.phone}</div>
                      </td>
                      <td>
                        {subscription ? (
                          <>
                            <span className="tag gold">{subscription.plan.name}</span>
                            <div className="sub">
                              {effectiveRebate(subscription)}% de abatimento
                              {isNegotiated(subscription) ? ' · negociado' : ''}
                            </div>
                            <div className="sub">até {formatDate(subscription.currentPeriodEnd)}</div>
                          </>
                        ) : (
                          <span className="tag">sem assinatura</span>
                        )}
                      </td>
                      <td className="num">{formatBRL(user.wallet?.balanceCents ?? 0)}</td>
                      <td>{user._count.orders}</td>
                      <td className="muted">{formatDate(user.createdAt)}</td>
                      <td className="right">
                        <button className="ghost tiny" onClick={() => setDetailId(user.id)}>
                          Abrir
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination page={page} perPage={perPage} total={data.total} onChange={setPage} />
        </div>
      )}

      {detailId ? (
        <UserDetailModal
          userId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => void reload()}
        />
      ) : null}
    </>
  );
}

/** Uma medida do cadastro. Vazio aparece como travessão, não some. */
function Measure({
  label,
  value,
  suffix = '',
}: {
  label: string;
  value: string | number | null;
  suffix?: string;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="num" style={{ marginTop: 6 }}>
        {value ? `${value}${suffix}` : '—'}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function UserDetailModal({
  userId,
  onClose,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, loading, reload } = useApi<UserDetail>(`/admin/users/${userId}`);
  const plans = useApi<Plan[]>('/admin/plans');

  const [planId, setPlanId] = useState('');
  const [months, setMonths] = useState('1');
  /** Vazio = usa o percentual do plano. Preenchido = condição negociada. */
  const [rebate, setRebate] = useState('');
  /** Mesma ideia, mas para corrigir o contrato que já está em vigor. */
  const [currentRebate, setCurrentRebate] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !data) {
    return (
      <Modal title="Assinante" onClose={onClose}>
        <Loading rows={4} />
      </Modal>
    );
  }

  const subscription = data.subscriptions.find(isActive);

  const selectedPlan = (plans.data ?? []).find((plan) => plan.id === planId);
  const planPercent = selectedPlan ? Number(selectedPlan.rebatePercent) : null;

  // Campo em branco vira `null` de propósito: é assim que o servidor entende
  // "desfaz a condição especial e volta ao percentual do nível".
  const typedRebate = rebate.trim().replace(',', '.');
  const parsedRebate = typedRebate === '' ? null : Number(typedRebate);
  const rebateError =
    parsedRebate != null && (!Number.isFinite(parsedRebate) || parsedRebate < 0 || parsedRebate > 100)
      ? 'Percentual inválido — use um número entre 0 e 100.'
      : null;

  const typedCurrent = (currentRebate ?? '').trim().replace(',', '.');
  const parsedCurrentRebate = typedCurrent === '' ? null : Number(typedCurrent);
  const currentRebateError =
    parsedCurrentRebate != null &&
    (!Number.isFinite(parsedCurrentRebate) || parsedCurrentRebate < 0 || parsedCurrentRebate > 100)
      ? 'Percentual inválido — use um número entre 0 e 100.'
      : null;
  const availableCredit = data.credits
    .filter((c) => c.status !== 'CANCELED')
    .reduce((sum, c) => sum + (c.amountCents - c.usedCents), 0);

  return (
    <Modal
      title={data.fullName}
      onClose={onClose}
      footer={
        <>
          <button
            className="quiet"
            disabled={busy}
            onClick={() =>
              void run(() =>
                api.patch(`/admin/users/${userId}/status`, {
                  status: data.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE',
                }),
              )
            }
          >
            {data.status === 'ACTIVE' ? 'Bloquear acesso' : 'Desbloquear acesso'}
          </button>
          <button className="ghost" onClick={onClose}>Fechar</button>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: 20 }}>
        {data.email} · {data.phone}
        {data.instagram ? ` · @${data.instagram}` : ''}
        {data.measurements?.dressSize ? ` · manequim ${data.measurements.dressSize}` : ''}
        {data.birthDate
          ? ` · ${new Date(data.birthDate).toLocaleDateString('pt-BR')}`
          : ''}
      </p>

      <div className="grid cols-2" style={{ marginBottom: 26 }}>
        <Stat label="Saldo da carteira" value={formatBRL(data.wallet?.balanceCents ?? 0)} hint="paga compras no app" />
        <Stat
          label="Crédito do clube"
          value={formatBRL(availableCredit)}
          hint="abate a mensalidade · não expira"
          feature
        />
      </div>

      {/* ── Assinatura ── */}
      <SectionTitle>Assinatura</SectionTitle>
      {subscription ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div>
              <strong>{subscription.plan.name}</strong>
              <div className="sub">
                {formatBRL(subscription.priceCents)} · vigente até {formatDate(subscription.currentPeriodEnd)}
              </div>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="tag gold">{effectiveRebate(subscription)}% de abatimento</span>
                <span className="sub">
                  {isNegotiated(subscription)
                    ? `negociado — o nível ${subscription.plan.name} dá ${Number(
                        subscription.plan.rebatePercent,
                      )}%`
                    : `percentual do nível ${subscription.plan.name}`}
                </span>
                {currentRebate === null ? (
                  <button
                    className="quiet tiny"
                    onClick={() =>
                      setCurrentRebate(
                        subscription.rebatePercent == null
                          ? ''
                          : String(Number(subscription.rebatePercent)),
                      )
                    }
                  >
                    Alterar
                  </button>
                ) : null}
              </div>
            </div>
            <button
              className="ghost tiny"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Cancelar a assinatura deste usuário?')) return;
                void run(() => api.delete(`/admin/users/${userId}/subscription`));
              }}
            >
              Cancelar
            </button>
          </div>

          {currentRebate !== null ? (
            <div className="row" style={{ marginTop: 16 }}>
              <RebateField
                value={currentRebate}
                onChange={setCurrentRebate}
                planPercent={Number(subscription.plan.rebatePercent)}
                error={currentRebateError}
              />
              <button
                className="tiny"
                style={{ flex: '0 0 auto' }}
                disabled={busy || currentRebateError != null}
                onClick={() =>
                  void run(async () => {
                    await api.patch(`/admin/users/${userId}/subscription/rebate`, {
                      rebatePercent: parsedCurrentRebate,
                    });
                    setCurrentRebate(null);
                  })
                }
              >
                Salvar
              </button>
              <button
                className="ghost tiny"
                style={{ flex: '0 0 auto' }}
                onClick={() => setCurrentRebate(null)}
              >
                Cancelar
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="muted" style={{ marginBottom: 14 }}>
          Sem assinatura ativa — o app está bloqueado para esta pessoa (RN-01).
        </p>
      )}

      <div className="row" style={{ marginBottom: 26 }}>
        <div className="field">
          <label>{subscription ? 'Trocar/renovar plano' : 'Conceder plano'}</label>
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Selecione…</option>
            {(plans.data ?? []).map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} — {formatBRL(plan.priceCents)} · {Number(plan.rebatePercent)}%
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 130 }}>
          <label>Meses</label>
          <input value={months} onChange={(e) => setMonths(e.target.value)} />
        </div>
        <RebateField
          value={rebate}
          onChange={setRebate}
          planPercent={planPercent}
          error={rebateError}
        />
        <button
          disabled={!planId || busy || rebateError != null}
          onClick={() =>
            void run(async () => {
              await api.post(`/admin/users/${userId}/subscription`, {
                planId,
                months: Number(months) || 1,
                // null devolve a pessoa ao percentual do nível; número grava a
                // condição negociada no contrato.
                rebatePercent: parsedRebate,
              });
              setPlanId('');
              setRebate('');
            })
          }
        >
          {subscription ? 'Aplicar' : 'Ativar assinatura'}
        </button>
      </div>


      {/* ── Carteira ── */}
      <SectionTitle>Ajuste manual de carteira</SectionTitle>
      <div className="row" style={{ marginBottom: 26 }}>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>Valor (R$)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Operação</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as 'CREDIT' | 'DEBIT')}>
            <option value="CREDIT">Creditar</option>
            <option value="DEBIT">Debitar</option>
          </select>
        </div>
        <div className="field" style={{ flex: 2 }}>
          <label>Motivo (fica em auditoria)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button
          className="ghost"
          disabled={!amount || reason.trim().length < 5 || busy}
          onClick={() =>
            void run(async () => {
              await api.post(`/admin/users/${userId}/wallet/adjust`, {
                amountCents: Math.round(Number(amount.replace(',', '.')) * 100),
                direction,
                reason,
              });
              setAmount('');
              setReason('');
            })
          }
        >
          Aplicar
        </button>
      </div>

      {error ? <p className="error" style={{ marginBottom: 18 }}>{error}</p> : null}

      {/* ── Medidas: o ateliê separa a peça a partir daqui ── */}
      <SectionTitle>Tamanhos e medidas</SectionTitle>
      {data.measurements ? (
        <div className="card" style={{ marginBottom: 26 }}>
          <div className="grid cols-4" style={{ gap: 20 }}>
            <Measure label="Manequim" value={data.measurements.dressSize} />
            <Measure label="Blusa" value={data.measurements.topSize} />
            <Measure label="Calça" value={data.measurements.bottomSize} />
            <Measure label="Calçado" value={data.measurements.shoeSize} />
            <Measure label="Busto" value={data.measurements.bustCm} suffix=" cm" />
            <Measure label="Cintura" value={data.measurements.waistCm} suffix=" cm" />
            <Measure label="Quadril" value={data.measurements.hipsCm} suffix=" cm" />
            <Measure label="Altura" value={data.measurements.heightCm} suffix=" cm" />
          </div>

          {data.measurements.favoriteColors.length > 0 ? (
            <p style={{ marginTop: 18 }}>
              <span className="label">Cores preferidas</span>
              <br />
              {data.measurements.favoriteColors.join(' · ')}
            </p>
          ) : null}

          {data.measurements.notes ? (
            <p style={{ marginTop: 14 }}>
              <span className="label">Observações para o ateliê</span>
              <br />
              {data.measurements.notes}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="muted" style={{ marginBottom: 26 }}>
          Esta pessoa ainda não preencheu tamanhos e medidas no app.
        </p>
      )}

      {/* ── Créditos ── */}
      <SectionTitle>Créditos de abatimento</SectionTitle>
      <div className="card flush" style={{ marginBottom: 26 }}>
        {data.credits.length === 0 ? (
          <EmptyState title="Nenhum crédito gerado" description="Compras sem uso de saldo geram crédito aqui." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Origem</th>
                <th>Valor</th>
                <th>Usado</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.credits.map((credit) => (
                <tr key={credit.id}>
                  <td className="muted">{formatDate(credit.createdAt)}</td>
                  <td>{credit.reason}</td>
                  <td className="num">{formatBRL(credit.amountCents)}</td>
                  <td className="num">{formatBRL(credit.usedCents)}</td>
                  <td>
                    {(() => {
                      const status = describe(CREDIT_STATUS, credit.status);
                      return <span className={tagClass(status.tone)}>{status.label}</span>;
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pedidos ── */}
      <SectionTitle>Últimos pedidos</SectionTitle>
      <div className="card flush">
        {data.orders.length === 0 ? (
          <EmptyState title="Nenhum pedido" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Data</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order) => (
                <tr key={order.id}>
                  <td><strong>{order.code}</strong></td>
                  <td className="muted">{formatDate(order.createdAt)}</td>
                  <td className="num">{formatBRL(order.totalCents)}</td>
                  <td>
                    {(() => {
                      const status = describe(ORDER_STATUS, order.status);
                      return <span className={tagClass(status.tone)}>{status.label}</span>;
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
