import React, { useState } from 'react';
import { api, formatBRL, formatDate } from '../api/client';
import { useApi } from '../lib/useApi';
import { EmptyState, ErrorBox, Loading, PageHead, Pagination } from '../components/Page';
import { ORDER_STATUS, ORDER_TYPE, describe, tagClass } from '../lib/labels';

/** Operação de pedidos: status, envio e declaração de conteúdo (3.6). */

interface Order {
  id: string;
  code: string;
  type: 'SALE' | 'RENTAL' | 'TICKET' | 'WALLET_TOPUP' | 'SUBSCRIPTION';
  status: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  walletAppliedCents: number;
  gatewayAmountCents: number;
  rebateEligible: boolean;
  rebateBlockedReason: string | null;
  rebateCreditCents: number;
  createdAt: string;
  user: { fullName: string; email: string; phone: string };
  items: Array<{ id: string; nameSnapshot: string; quantity: number; sizeSnapshot: string | null }>;
  shipment: {
    service: string;
    trackingCode: string | null;
    contentDeclarationUrl: string | null;
  } | null;
}

const NEXT_STATUS = ['PROCESSING', 'SHIPPED', 'DELIVERED', 'RETURN_PENDING', 'RETURNED', 'CANCELED'] as const;

const BLOCK_LABEL: Record<string, string> = {
  WALLET_USED: 'usou saldo da carteira',
  NO_PLAN: 'sem plano ativo',
  PERCENT_COUPON: 'cupom percentual',
  ZERO_BASE: 'base zero',
  PROMO_ITEMS: 'peça em promoção',
};

export function OrdersPage() {
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 20;

  const { data, error, loading, reload } = useApi<{ data: Order[]; total: number }>(
    `/admin/orders?page=${page}&perPage=${perPage}` +
      `${status ? `&status=${status}` : ''}${type ? `&type=${type}` : ''}`,
  );
  const [tracking, setTracking] = useState<Record<string, string>>({});

  if (error) return <ErrorBox message={error} />;

  const updateStatus = async (order: Order, next: string) => {
    await api.patch(`/admin/orders/${order.id}/status`, {
      status: next,
      trackingCode: tracking[order.id] || undefined,
    });
    await reload();
  };

  return (
    <>
      <PageHead
        title="Pedidos"
        description="Compras, aluguéis e ingressos, com o abatimento aplicado em cada pedido."
        actions={
          <>
            <div>
              <label>Tipo</label>
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todos</option>
                <option value="SALE">Venda</option>
                <option value="RENTAL">Aluguel</option>
                <option value="TICKET">Ingresso</option>
              </select>
            </div>
            <div>
              <label>Status</label>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todos</option>
                <option value="PENDING_PAYMENT">Aguardando pagamento</option>
                <option value="PAID">Pago</option>
                <option value="PROCESSING">Em separação</option>
                <option value="SHIPPED">Enviado</option>
                <option value="DELIVERED">Entregue</option>
              </select>
            </div>
          </>
        }
      />

      {loading || !data ? (
        <Loading rows={5} />
      ) : data.data.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nenhum pedido no filtro"
            description="Compras, aluguéis e ingressos aparecem aqui assim que são criados no app."
          />
        </div>
      ) : (
        <div className="card flush">
          <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Itens</th>
                <th>Valores</th>
                <th>Abatimento</th>
                <th>Envio</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>{order.code}</strong>
                    <div className="sub">
                      {formatDate(order.createdAt)} · {ORDER_TYPE[order.type] ?? order.type}
                    </div>
                  </td>
                  <td>
                    {order.user.fullName}
                    <div className="sub">{order.user.phone}</div>
                  </td>
                  <td>
                    {order.items.map((item) => (
                      <div key={item.id}>
                        {item.quantity}× {item.nameSnapshot}
                        {item.sizeSnapshot ? ` (${item.sizeSnapshot})` : ''}
                      </div>
                    ))}
                  </td>
                  <td>
                    <span className="num">{formatBRL(order.totalCents)}</span>
                    {order.walletAppliedCents > 0 ? (
                      <div className="sub">carteira {formatBRL(order.walletAppliedCents)}</div>
                    ) : null}
                    {order.gatewayAmountCents > 0 ? (
                      <div className="sub">gateway {formatBRL(order.gatewayAmountCents)}</div>
                    ) : null}
                  </td>
                  <td>
                    {order.rebateEligible ? (
                      <span className="tag gold">+{formatBRL(order.rebateCreditCents)}</span>
                    ) : (
                      <span className="tag">
                        {BLOCK_LABEL[order.rebateBlockedReason ?? ''] ?? 'não aplicado'}
                      </span>
                    )}
                  </td>
                  <td>
                    {order.shipment ? (
                      <>
                        <span className="muted">{order.shipment.service}</span>
                        <input
                          placeholder="rastreio"
                          value={tracking[order.id] ?? order.shipment.trackingCode ?? ''}
                          onChange={(e) =>
                            setTracking({ ...tracking, [order.id]: e.target.value })
                          }
                          style={{ marginTop: 6 }}
                        />
                        {order.shipment.contentDeclarationUrl ? (
                          <a href={order.shipment.contentDeclarationUrl} target="_blank" rel="noreferrer">
                            declaração de conteúdo
                          </a>
                        ) : (
                          <span className="muted">declaração pendente</span>
                        )}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {(() => {
                      const status = describe(ORDER_STATUS, order.status);
                      return <span className={tagClass(status.tone)}>{status.label}</span>;
                    })()}
                    <select
                      aria-label={`Alterar status do pedido ${order.code}`}
                      value=""
                      onChange={(e) => e.target.value && void updateStatus(order, e.target.value)}
                      style={{ marginTop: 8 }}
                    >
                      <option value="">Alterar status…</option>
                      {NEXT_STATUS.map((next) => (
                        <option key={next} value={next}>
                          {ORDER_STATUS[next]?.label ?? next}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <Pagination page={page} perPage={perPage} total={data.total} onChange={setPage} />
        </div>
      )}
    </>
  );
}
