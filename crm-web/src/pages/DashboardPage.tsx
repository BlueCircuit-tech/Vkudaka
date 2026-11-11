import React, { useState } from 'react';
import { formatBRL } from '../api/client';
import { useApi } from '../lib/useApi';
import { EmptyState, ErrorBox, Loading, PageHead, SectionTitle, Stat } from '../components/Page';

/**
 * Dashboard (3.1) — lucro, vendas e saúde do clube.
 *
 * Composição: **um** número grande (a receita do período) e, abaixo, pares
 * rótulo/valor separados por filete. Vários números grandes competindo entre si
 * é o que fazia a tela parecer um painel qualquer; aqui a página tem um dono e
 * o resto é a composição dele.
 */

interface Dashboard {
  sales: {
    orderCount: number;
    grossCents: number;
    gatewayCents: number;
    walletCents: number;
    shippingCents: number;
  };
  subscriptions: {
    activeSubscribers: number;
    invoiceCount: number;
    grossCents: number;
    creditAppliedCents: number;
    netCents: number;
  };
  wallet: { topUpCents: number };
  rebate: { generatedCents: number; outstandingCents: number };
  totalRevenueCents: number;
  series: Array<{ date: string; saleCents: number; rentalCents: number; ticketCents: number }>;
}

interface SalesVsRentals {
  sold: {
    itemCount: number;
    revenueCents: number;
    topProducts: Array<{ name: string; quantity: number; revenueCents: number }>;
  };
  rented: SalesVsRentals['sold'];
}

/** GET /admin/reports/club — planos e créditos VKUDAKA. */
interface ClubReport {
  activeSubscribers: number;
  mrrCents: number;
  byPlan: Array<{
    planId: string;
    planName: string;
    isActive: boolean;
    subscribers: number;
    mrrCents: number;
  }>;
  credits: { outstandingCents: number; generatedCents: number; usedCents: number };
  upgrades: { count: number; eligible: number; rate: number };
}

const today = new Date();
const iso = (date: Date) => date.toISOString().slice(0, 10);
const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

/** Rótulo/valor com filete — o bloco que constrói toda a página. */
function Row({
  label,
  sub,
  value,
  tone,
}: {
  label: string;
  sub?: string;
  value: string;
  tone?: 'quiet' | 'strong';
}) {
  return (
    <div className="kv-row">
      <div className="k">
        {label}
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      <div className={tone ? `v ${tone}` : 'v'}>{value}</div>
    </div>
  );
}

export function DashboardPage() {
  const [from, setFrom] = useState(iso(firstOfMonth));
  const [to, setTo] = useState(iso(today));
  const [tab, setTab] = useState<'sold' | 'rented'>('sold');

  const range = `from=${from}&to=${to}`;
  const dashboard = useApi<Dashboard>(`/admin/dashboard?${range}`);
  const report = useApi<SalesVsRentals>(`/admin/reports/sales-vs-rentals?${range}`);
  const club = useApi<ClubReport>(`/admin/reports/club?${range}`);

  if (dashboard.error) return <ErrorBox message={dashboard.error} />;

  return (
    <>
      <PageHead
        title="Dashboard"
        description="Lucro, vendas e saúde do clube no período selecionado."
        actions={
          <>
            <div>
              <label>De</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label>Até</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        }
      />

      {dashboard.loading || !dashboard.data ? (
        <Loading rows={5} />
      ) : (
        <DashboardBody data={dashboard.data} />
      )}

      <section className="section">
        <SectionTitle>Clube</SectionTitle>
        {club.error ? (
          <ErrorBox message={club.error} />
        ) : club.loading || !club.data ? (
          <Loading rows={2} />
        ) : (
          <ClubSection data={club.data} />
        )}
      </section>

      <section className="section">
        <SectionTitle>Relatório de itens</SectionTitle>

        <div className="tabs">
          <button className={tab === 'sold' ? 'active' : ''} onClick={() => setTab('sold')}>
            Vendidos
          </button>
          <button className={tab === 'rented' ? 'active' : ''} onClick={() => setTab('rented')}>
            Alugados
          </button>
        </div>

        {report.loading || !report.data ? (
          <Loading rows={3} />
        ) : (
          <ItemReport report={report.data[tab]} kind={tab} />
        )}
      </section>
    </>
  );
}

function DashboardBody({ data }: { data: Dashboard }) {
  return (
    <>
      {/* O número da casa. */}
      <section className="card hero-band">
        <div className="label">Receita do período</div>
        <div className="figure-xl">{formatBRL(data.totalRevenueCents)}</div>
        <p className="hint" style={{ margin: 0 }}>
          vendas e aluguéis pagos + mensalidades recebidas
        </p>

        <div className="kv">
          <Row
            label="Vendas e aluguéis"
            sub={`${data.sales.orderCount} pedido(s) pago(s)`}
            value={formatBRL(data.sales.grossCents)}
          />
          <Row
            label="Mensalidades"
            sub={`${data.subscriptions.activeSubscribers} assinante(s) ativo(s)`}
            value={formatBRL(data.subscriptions.netCents)}
          />
          <Row
            label="Entrou pelo gateway"
            sub={`${formatBRL(data.sales.walletCents)} pagos com saldo da carteira`}
            value={formatBRL(data.sales.gatewayCents)}
          />
        </div>
      </section>

      <DailyChart series={data.series} />

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="label">O clube</div>
          <div className="kv" style={{ marginTop: 14 }}>
            <Row
              label="Crédito de mensalidade gerado"
              sub="regra antiga (crédito na próxima mensalidade)"
              value={formatBRL(data.rebate.generatedCents)}
            />
            <Row
              label="Crédito de mensalidade em aberto"
              sub="desconto já contratado das próximas mensalidades"
              value={formatBRL(data.rebate.outstandingCents)}
            />
          </div>
          <p className="hint" style={{ marginTop: 16 }}>
            Desde a regra nova, o desconto fidelidade sai na hora da compra e não gera mais este
            crédito; os créditos VKUDAKA da assinatura estão na seção Clube abaixo.
          </p>
        </section>

        <section className="card">
          <div className="label">Mensalidades do período</div>
          <div className="kv" style={{ marginTop: 14 }}>
            <Row label="Faturado bruto" value={formatBRL(data.subscriptions.grossCents)} tone="quiet" />
            <Row
              label="Abatido por crédito de compras"
              value={`−${formatBRL(data.subscriptions.creditAppliedCents)}`}
              tone="quiet"
            />
            <Row label="Recebido" value={formatBRL(data.subscriptions.netCents)} tone="strong" />
            <Row label="Recargas de carteira" value={formatBRL(data.wallet.topUpCents)} tone="quiet" />
          </div>
        </section>
      </div>
    </>
  );
}

/**
 * Planos e créditos: com 100% da mensalidade virando crédito VKUDAKA, o saldo
 * das carteiras é passivo — dinheiro recebido que ainda vai virar peça.
 */
function ClubSection({ data }: { data: ClubReport }) {
  const percent = (rate: number) =>
    `${(rate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

  return (
    <>
      <div className="grid cols-4">
        <Stat label="Assinantes ativos" value={String(data.activeSubscribers)} hint="assinaturas vigentes hoje" />
        <Stat label="MRR" value={formatBRL(data.mrrCents)} hint="receita mensal recorrente" feature />
        <Stat
          label="Créditos em aberto"
          value={formatBRL(data.credits.outstandingCents)}
          hint={`passivo · ${formatBRL(data.credits.generatedCents)} gerados e ${formatBRL(
            data.credits.usedCents,
          )} usados no período`}
        />
        <Stat
          label="Taxa de upgrade"
          value={percent(data.upgrades.rate)}
          hint={`${data.upgrades.count} upgrade(s) no período`}
        />
      </div>

      <div className="card flush" style={{ marginTop: 16 }}>
        {data.byPlan.length === 0 ? (
          <EmptyState title="Nenhum plano ativo" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Plano</th>
                <th>Assinantes</th>
                <th>MRR</th>
              </tr>
            </thead>
            <tbody>
              {data.byPlan.map((row) => (
                <tr key={row.planId}>
                  <td>
                    <strong>{row.planName}</strong>
                    {!row.isActive ? <span className="sub"> · inativo</span> : null}
                  </td>
                  <td className="num">{row.subscribers}</td>
                  <td className="num">{formatBRL(row.mrrCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        Taxa de upgrade = trocas para um plano mais caro no período ÷ (essas trocas + assinantes
        ativos que ainda podem subir de plano). MRR usa o preço travado em cada contrato, por mês.
      </p>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const dayLabel = (date: string) =>
  new Date(`${date}T12:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

function DailyChart({ series }: { series: Dashboard['series'] }) {
  const totals = series.map((day) => day.saleCents + day.rentalCents + day.ticketCents);
  const max = Math.max(1, ...totals);
  const hasMovement = totals.some((total) => total > 0);

  /** Com poucos dias cabe o valor sobre a barra; com muitos, só a barra. */
  const showValues = series.length <= 10;
  /** Eixo cheio só em período curto — senão as datas se sobrepõem. */
  const showAllLabels = series.length <= 14;

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="label">Faturamento por dia</div>
        {hasMovement ? (
          <span className="muted" style={{ fontSize: 12 }}>
            pico {formatBRL(max)}
          </span>
        ) : null}
      </div>

      {hasMovement ? (
        <div className="chart">
          <div className="plot">
            {series.map((day, index) => {
              const total = totals[index] ?? 0;
              return (
                <div
                  key={day.date}
                  className="col"
                  title={`${dayLabel(day.date)}: ${formatBRL(total)}`}
                >
                  {showValues && total > 0 ? (
                    <span className="val">{formatBRL(total)}</span>
                  ) : null}
                  <div
                    className={total > 0 ? 'bar' : 'bar empty'}
                    style={{ height: total > 0 ? `${Math.max(4, (total / max) * 100)}%` : '2px' }}
                  />
                </div>
              );
            })}
          </div>

          <div className="axis">
            {series.map((day, index) => (
              <span key={day.date}>
                {showAllLabels || index === 0 || index === series.length - 1
                  ? dayLabel(day.date)
                  : ''}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          title="Nenhum pedido pago no período"
          description="Assim que a primeira venda for confirmada, a curva aparece aqui."
        />
      )}
    </section>
  );
}

function ItemReport({
  report,
  kind,
}: {
  report: SalesVsRentals['sold'];
  kind: 'sold' | 'rented';
}) {
  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="kv">
          <Row
            label={kind === 'sold' ? 'Peças vendidas' : 'Peças alugadas'}
            value={String(report.itemCount)}
          />
          <Row label="Receita" value={formatBRL(report.revenueCents)} tone="strong" />
        </div>
      </div>

      <div className="card flush">
        {report.topProducts.length === 0 ? (
          <EmptyState
            title={kind === 'sold' ? 'Nenhuma venda no período' : 'Nenhum aluguel no período'}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Peça</th>
                  <th>Quantidade</th>
                  <th className="right">Receita</th>
                </tr>
              </thead>
              <tbody>
                {report.topProducts.map((product) => (
                  <tr key={product.name}>
                    <td><strong>{product.name}</strong></td>
                    <td>{product.quantity}</td>
                    <td className="right num">{formatBRL(product.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
