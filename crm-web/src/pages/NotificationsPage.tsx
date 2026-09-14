import React, { useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../lib/useApi';
import { EmptyState, ErrorBox, Loading, PageHead, Pagination, SectionTitle } from '../components/Page';

/** Push notifications (3.7) — disparo manual e histórico dos gatilhos automáticos. */

interface Campaign {
  id: string;
  title: string;
  body: string;
  trigger: string;
  status: string;
  deepLink: string | null;
  totalTargets: number;
  totalSent: number;
  totalFailed: number;
  sentAt: string | null;
  createdAt: string;
  targetPlan: { name: string } | null;
}

interface Plan {
  id: string;
  name: string;
}

const TRIGGER_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  NEW_PRODUCT: 'Peça nova',
  NEW_EVENT: 'Evento novo',
  WALLET_TOPUP_CONFIRMED: 'Recarga confirmada',
  WALLET_BALANCE_EMPTY: 'Carteira sem saldo',
  PURCHASE_CONFIRMED: 'Compra confirmada',
  ORDER_SHIPPED: 'Pedido enviado',
  SUBSCRIPTION_RENEWED: 'Assinatura renovada',
  SUBSCRIPTION_PAST_DUE: 'Assinatura em atraso',
};

export function NotificationsPage() {
  const [page, setPage] = useState(1);
  const perPage = 15;
  const campaigns = useApi<{ data: Campaign[]; total: number }>(
    `/admin/notifications?page=${page}&perPage=${perPage}`,
  );
  const plans = useApi<Plan[]>('/admin/plans');

  const [form, setForm] = useState({ title: '', body: '', deepLink: '', targetPlanId: '' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api.post('/admin/notifications', {
        title: form.title,
        body: form.body,
        deepLink: form.deepLink || undefined,
        targetPlanId: form.targetPlanId || undefined,
        targetActiveOnly: true,
      });
      setForm({ title: '', body: '', deepLink: '', targetPlanId: '' });
      await campaigns.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (campaigns.error) return <ErrorBox message={campaigns.error} />;

  return (
    <>
      <PageHead
        title="Push notifications"
        description="Disparo manual para os assinantes e histórico dos gatilhos automáticos."
      />

      <div className="grid cols-2">
        <form className="card" onSubmit={send}>
          <h2 style={{ marginBottom: 14 }}>Novo disparo</h2>

          <div className="field">
            <label>Título</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={120}
              required
            />
          </div>
          <div className="field">
            <label>Mensagem</label>
            <textarea
              rows={3}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              maxLength={400}
              required
            />
          </div>
          <div className="row">
            <div className="field">
              <label>Segmento</label>
              <select
                value={form.targetPlanId}
                onChange={(e) => setForm({ ...form, targetPlanId: e.target.value })}
              >
                <option value="">Todos os assinantes ativos</option>
                {(plans.data ?? []).map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Deep link (opcional)</label>
              <input
                value={form.deepLink}
                onChange={(e) => setForm({ ...form, deepLink: e.target.value })}
                placeholder="vkudaka://produto/<id>"
              />
            </div>
          </div>

          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={sending}>
            {sending ? 'Enviando…' : 'Disparar agora'}
          </button>
        </form>

        <div className="card">
          <div className="label">Gatilhos automáticos ativos</div>
          <ul className="muted" style={{ fontSize: 13, lineHeight: 1.9, paddingLeft: 18 }}>
            <li>Peça nova publicada no catálogo</li>
            <li>Evento novo publicado</li>
            <li>Recarga de carteira confirmada</li>
            <li>Carteira sem saldo após uma compra</li>
            <li>Compra confirmada</li>
            <li>Renovação e atraso de assinatura</li>
          </ul>
          <p className="hint">
            Os gatilhos disparam sozinhos a partir das ações do CRM e do app. Aparecem no histórico
            abaixo junto com os disparos manuais.
          </p>
        </div>
      </div>

      <section className="section">
        <SectionTitle>Histórico</SectionTitle>
      </section>
      {campaigns.loading || !campaigns.data ? (
        <Loading rows={4} />
      ) : campaigns.data.data.length === 0 ? (
        <div className="card">
          <EmptyState title="Nenhum disparo ainda" description="Envios manuais e gatilhos automáticos aparecem aqui." />
        </div>
      ) : (
        <div className="card flush">
          <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mensagem</th>
                <th>Origem</th>
                <th>Segmento</th>
                <th>Alvo</th>
                <th>Entregues</th>
                <th>Falhas</th>
                <th>Enviado em</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.data.data.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <strong>{campaign.title}</strong>
                    <div className="muted">{campaign.body}</div>
                  </td>
                  <td>
                    <span className={campaign.trigger === 'MANUAL' ? 'tag gold' : 'tag'}>
                      {TRIGGER_LABEL[campaign.trigger] ?? campaign.trigger}
                    </span>
                  </td>
                  <td>{campaign.targetPlan?.name ?? 'todos'}</td>
                  <td>{campaign.totalTargets}</td>
                  <td>{campaign.totalSent}</td>
                  <td>{campaign.totalFailed > 0 ? <span className="tag danger">{campaign.totalFailed}</span> : '0'}</td>
                  <td>{campaign.sentAt ? new Date(campaign.sentAt).toLocaleString('pt-BR') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <Pagination
            page={page}
            perPage={perPage}
            total={campaigns.data.total}
            onChange={setPage}
          />
        </div>
      )}
    </>
  );
}
