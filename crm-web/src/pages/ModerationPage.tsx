import React, { useState } from 'react';
import { api, formatDate, session } from '../api/client';
import { EmptyState, ErrorBox, Loading, PageHead, Pagination } from '../components/Page';
import { useApi } from '../lib/useApi';

/**
 * Denúncias da comunidade (política de conteúdo de usuários das lojas).
 *
 * O membro denuncia no app; a fila cai aqui. Cada linha mostra quem denunciou,
 * o que foi denunciado e o autor. Resolver uma denúncia resolve todas as
 * abertas sobre o mesmo conteúdo.
 */

const REASON: Record<string, string> = {
  SPAM: 'Spam ou propaganda',
  HARASSMENT: 'Assédio ou ofensa',
  NUDITY: 'Nudez ou conteúdo sexual',
  VIOLENCE: 'Violência',
  HATE: 'Discurso de ódio',
  SCAM: 'Golpe ou venda enganosa',
  OTHER: 'Outro motivo',
};

const TARGET: Record<string, string> = { POST: 'Publicação', COMMENT: 'Comentário', USER: 'Membro' };

const RESOLUTION: Record<string, string> = {
  HIDDEN: 'Conteúdo ocultado',
  USER_BLOCKED: 'Conta bloqueada',
  DISMISSED: 'Mantido',
};

interface Person {
  id: string;
  fullName: string;
  email: string;
  status: string;
}

interface Report {
  id: string;
  targetType: 'POST' | 'COMMENT' | 'USER';
  targetId: string;
  reason: string;
  details: string | null;
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  reporter: Person;
  resolvedBy: { fullName: string } | null;
  target:
    | { id: string; content: string; status: string; user: Person; media?: Array<{ url: string; kind: string }> }
    | Person
    | null;
}

interface ReportPage {
  data: Report[];
  total: number;
  page: number;
  perPage: number;
  openCount: number;
}

const isContent = (
  target: Report['target'],
): target is { id: string; content: string; status: string; user: Person; media?: Array<{ url: string; kind: string }> } =>
  Boolean(target && 'content' in target);

export function ModerationPage() {
  const [tab, setTab] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const perPage = 20;
  const isAdmin = session.user()?.role === 'ADMIN';

  const { data, error, loading, reload } = useApi<ReportPage>(
    `/admin/reports?status=${tab}&page=${page}&perPage=${perPage}`,
  );

  const resolve = async (report: Report, action: 'HIDE' | 'BLOCK_USER' | 'DISMISS') => {
    const confirmText =
      action === 'HIDE'
        ? 'Ocultar este conteúdo do app? O autor não é avisado.'
        : action === 'BLOCK_USER'
          ? 'Bloquear a conta do autor? A pessoa perde o acesso ao app e tudo que publicou some do feed.'
          : 'Manter o conteúdo e encerrar a denúncia?';
    if (!window.confirm(confirmText)) return;

    setBusy(report.id);
    setMessage(null);
    try {
      await api.patch(`/admin/reports/${report.id}`, { action });
      await reload();
    } catch (caught) {
      setMessage((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const author = (report: Report): Person | null =>
    isContent(report.target) ? report.target.user : (report.target as Person | null);

  return (
    <>
      <PageHead
        title="Denúncias"
        description="Conteúdo da comunidade denunciado pelos membros. Nada é ocultado sem a sua decisão."
      />

      <div className="tabs">
        <button className={tab === 'OPEN' ? 'active' : ''} onClick={() => { setTab('OPEN'); setPage(1); }}>
          Abertas{data?.openCount ? ` (${data.openCount})` : ''}
        </button>
        <button className={tab === 'CLOSED' ? 'active' : ''} onClick={() => { setTab('CLOSED'); setPage(1); }}>
          Resolvidas
        </button>
      </div>

      {message ? <ErrorBox message={message} /> : null}
      {error ? <ErrorBox message={error} /> : null}
      {loading && !data ? <Loading rows={5} /> : null}

      {data && data.data.length === 0 ? (
        <EmptyState
          title={tab === 'OPEN' ? 'Nenhuma denúncia aberta' : 'Nenhuma denúncia resolvida'}
          description={tab === 'OPEN' ? 'Quando um membro denunciar algo no app, aparece aqui.' : undefined}
        />
      ) : null}

      {data && data.data.length > 0 ? (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Denúncia</th>
                  <th>Conteúdo</th>
                  <th>Autor</th>
                  <th>{tab === 'OPEN' ? 'Ação' : 'Resultado'}</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((report) => {
                  const who = author(report);
                  return (
                    <tr key={report.id}>
                      <td>
                        <strong>{REASON[report.reason] ?? report.reason}</strong>
                        <div className="sub">
                          {TARGET[report.targetType]} · {formatDate(report.createdAt)}
                        </div>
                        <div className="sub">por {report.reporter.fullName}</div>
                        {report.details ? <div className="sub">“{report.details}”</div> : null}
                      </td>
                      <td style={{ maxWidth: 360 }}>
                        {isContent(report.target) ? (
                          <>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{report.target.content}</div>
                            {report.target.media?.[0] ? (
                              <a href={report.target.media[0].url} target="_blank" rel="noreferrer">
                                ver mídia
                              </a>
                            ) : null}
                            {report.target.status !== 'PUBLISHED' ? (
                              <div className="sub">já oculto</div>
                            ) : null}
                          </>
                        ) : report.targetType === 'USER' ? (
                          <span className="muted">perfil do membro</span>
                        ) : (
                          <span className="muted">conteúdo apagado</span>
                        )}
                      </td>
                      <td>
                        {who ? (
                          <>
                            {who.fullName}
                            <div className="sub">{who.email}</div>
                            {who.status === 'BLOCKED' ? <span className="tag danger">conta bloqueada</span> : null}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {tab === 'OPEN' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {report.targetType !== 'USER' ? (
                              <button
                                className="tiny"
                                disabled={busy === report.id}
                                onClick={() => void resolve(report, 'HIDE')}
                              >
                                Ocultar conteúdo
                              </button>
                            ) : null}
                            {isAdmin ? (
                              <button
                                className="ghost tiny"
                                disabled={busy === report.id || who?.status === 'BLOCKED'}
                                onClick={() => void resolve(report, 'BLOCK_USER')}
                              >
                                Bloquear conta
                              </button>
                            ) : null}
                            <button
                              className="quiet tiny"
                              disabled={busy === report.id}
                              onClick={() => void resolve(report, 'DISMISS')}
                            >
                              Manter
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className={report.resolution === 'DISMISSED' ? 'tag' : 'tag ok'}>
                              {RESOLUTION[report.resolution ?? ''] ?? report.status}
                            </span>
                            <div className="sub">
                              {report.resolvedBy?.fullName ?? '—'}
                              {report.resolvedAt ? ` · ${formatDate(report.resolvedAt)}` : ''}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} perPage={perPage} total={data.total} onChange={setPage} />
        </div>
      ) : null}
    </>
  );
}
