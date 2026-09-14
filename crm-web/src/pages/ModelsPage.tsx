import React, { useState } from 'react';
import { api, formatDate } from '../api/client';
import { MODEL_STATUS, describe, tagClass } from '../lib/labels';
import { useApi } from '../lib/useApi';
import {
  EmptyState,
  ErrorBox,
  Loading,
  Modal,
  PageHead,
  Pagination,
  SectionTitle,
} from '../components/Page';

/**
 * Modelos (3.5).
 *
 * Três jeitos de uma ficha chegar aqui, todos na mesma lista:
 *   • formulário público divulgado (link genérico);
 *   • convite pessoal — a equipe abre a ficha com nome e contato, manda o link
 *     por WhatsApp e a modelo completa o resto;
 *   • cadastro digitado pela equipe, já no elenco.
 *
 * Os campos da ficha seguem o briefing (nome, idade, manequim, medidas,
 * contato, portfólio) e serão ajustados ao formulário da Valéria quando ele
 * chegar — o servidor guarda tudo o que o formulário enviar, mesmo campos que
 * a ficha ainda não mostra.
 */

interface ModelProfile {
  id: string;
  fullName: string;
  birthDate: string | null;
  ageAtSignup: number | null;
  email: string | null;
  phone: string | null;
  instagram: string | null;
  city: string | null;
  state: string | null;
  dressSize: string | null;
  shoeSize: string | null;
  heightCm: number | null;
  bustCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  hairColor: string | null;
  eyeColor: string | null;
  portfolioUrl: string | null;
  photos: string[];
  notes: string | null;
  isActive: boolean;
  inviteToken: string | null;
  invitedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  application: {
    status: 'RECEIVED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
    source: string;
    reviewNotes: string | null;
  } | null;
}

type Status = 'RECEIVED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

const FORM_URL = `${window.location.origin}/cadastro-modelo`;
const inviteUrl = (token: string) => `${FORM_URL}?convite=${encodeURIComponent(token)}`;

const pendingInvite = (m: ModelProfile) => Boolean(m.inviteToken) && !m.completedAt;

/** Link do WhatsApp com a mensagem pronta — o número precisa vir com DDD. */
const whatsappUrl = (phone: string | null, name: string, link: string) => {
  const text = encodeURIComponent(
    `Olá, ${name.split(' ')[0]}! Aqui é da VKUDAKA. Complete seu cadastro de modelo por este link: ${link}`,
  );
  const digits = (phone ?? '').replace(/\D/g, '');
  const number = digits ? (digits.startsWith('55') ? digits : `55${digits}`) : '';
  return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
};

// ── Formulário da ficha (usado para criar e editar) ─────────────────────────

const emptyFicha = {
  fullName: '',
  birthDate: '',
  email: '',
  phone: '',
  instagram: '',
  city: '',
  state: '',
  dressSize: '',
  shoeSize: '',
  heightCm: '',
  bustCm: '',
  waistCm: '',
  hipsCm: '',
  hairColor: '',
  eyeColor: '',
  portfolioUrl: '',
  notes: '',
};
type Ficha = typeof emptyFicha;

const fichaOf = (m: ModelProfile): Ficha => ({
  fullName: m.fullName,
  birthDate: m.birthDate ? m.birthDate.slice(0, 10) : '',
  email: m.email ?? '',
  phone: m.phone ?? '',
  instagram: m.instagram ?? '',
  city: m.city ?? '',
  state: m.state ?? '',
  dressSize: m.dressSize ?? '',
  shoeSize: m.shoeSize ?? '',
  heightCm: m.heightCm?.toString() ?? '',
  bustCm: m.bustCm?.toString() ?? '',
  waistCm: m.waistCm?.toString() ?? '',
  hipsCm: m.hipsCm?.toString() ?? '',
  hairColor: m.hairColor ?? '',
  eyeColor: m.eyeColor ?? '',
  portfolioUrl: m.portfolioUrl ?? '',
  notes: m.notes ?? '',
});

/** Converte a ficha para o corpo da API: vazio vira ausente, número vira número. */
const payloadOf = (f: Ficha) => {
  const text = (v: string) => (v.trim() ? v.trim() : undefined);
  const num = (v: string) => (v.trim() ? Number(v.replace(/\D/g, '')) : undefined);
  return {
    fullName: f.fullName.trim(),
    birthDate: text(f.birthDate),
    email: text(f.email),
    phone: text(f.phone),
    instagram: text(f.instagram),
    city: text(f.city),
    state: text(f.state)?.toUpperCase(),
    dressSize: text(f.dressSize),
    shoeSize: text(f.shoeSize),
    heightCm: num(f.heightCm),
    bustCm: num(f.bustCm),
    waistCm: num(f.waistCm),
    hipsCm: num(f.hipsCm),
    hairColor: text(f.hairColor),
    eyeColor: text(f.eyeColor),
    portfolioUrl: text(f.portfolioUrl),
    notes: text(f.notes),
  };
};

function FichaFields({ value, onChange }: { value: Ficha; onChange: (next: Ficha) => void }) {
  const set = (key: keyof Ficha) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [key]: e.target.value });

  return (
    <>
      <div className="row">
        <div className="field" style={{ flex: 2 }}>
          <label>Nome completo *</label>
          <input value={value.fullName} onChange={set('fullName')} required />
        </div>
        <div className="field" style={{ maxWidth: 180 }}>
          <label>Data de nascimento</label>
          <input type="date" value={value.birthDate} onChange={set('birthDate')} />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>E-mail</label>
          <input type="email" value={value.email} onChange={set('email')} />
        </div>
        <div className="field">
          <label>Celular (com DDD)</label>
          <input value={value.phone} onChange={set('phone')} />
        </div>
        <div className="field">
          <label>Instagram</label>
          <input value={value.instagram} onChange={set('instagram')} placeholder="sem o @" />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 3 }}>
          <label>Cidade</label>
          <input value={value.city} onChange={set('city')} />
        </div>
        <div className="field" style={{ maxWidth: 100 }}>
          <label>UF</label>
          <input maxLength={2} value={value.state} onChange={set('state')} />
        </div>
      </div>
      <SectionTitle>Manequim e medidas</SectionTitle>
      <div className="row">
        <div className="field">
          <label>Manequim</label>
          <input value={value.dressSize} onChange={set('dressSize')} />
        </div>
        <div className="field">
          <label>Calçado</label>
          <input value={value.shoeSize} onChange={set('shoeSize')} />
        </div>
        <div className="field">
          <label>Altura (cm)</label>
          <input value={value.heightCm} onChange={set('heightCm')} inputMode="numeric" />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>Busto (cm)</label>
          <input value={value.bustCm} onChange={set('bustCm')} inputMode="numeric" />
        </div>
        <div className="field">
          <label>Cintura (cm)</label>
          <input value={value.waistCm} onChange={set('waistCm')} inputMode="numeric" />
        </div>
        <div className="field">
          <label>Quadril (cm)</label>
          <input value={value.hipsCm} onChange={set('hipsCm')} inputMode="numeric" />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>Cabelo</label>
          <input value={value.hairColor} onChange={set('hairColor')} />
        </div>
        <div className="field">
          <label>Olhos</label>
          <input value={value.eyeColor} onChange={set('eyeColor')} />
        </div>
      </div>
      <div className="field">
        <label>Portfólio (link)</label>
        <input value={value.portfolioUrl} onChange={set('portfolioUrl')} placeholder="https://" />
      </div>
      <div className="field">
        <label>Observações internas</label>
        <textarea rows={3} value={value.notes} onChange={set('notes')} maxLength={500} />
      </div>
    </>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export function ModelsPage() {
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'ALL' | 'PENDING' | 'ACTIVE'>('ALL');
  const perPage = 20;
  const { data, error, loading, reload } = useApi<{ data: ModelProfile[]; total: number }>(
    `/models?page=${page}&perPage=${perPage}`,
  );

  const [copied, setCopied] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ fullName: string; phone: string | null; url: string } | null>(null);

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  if (error) return <ErrorBox message={error} />;

  const rows = (data?.data ?? []).filter((m) =>
    tab === 'ALL'
      ? true
      : tab === 'ACTIVE'
        ? m.isActive
        : !m.isActive && m.application?.status !== 'REJECTED',
  );

  const statusOf = (m: ModelProfile) => {
    if (pendingInvite(m)) return { label: 'Convite enviado', tone: 'gold' as const };
    return describe(MODEL_STATUS, m.application?.status ?? 'RECEIVED');
  };

  return (
    <>
      <PageHead
        title="Modelos"
        description="Elenco, candidaturas do formulário e convites pessoais de cadastro."
        actions={
          <>
            <button className="ghost" onClick={() => copy(FORM_URL, 'form')}>
              {copied === 'form' ? 'Link copiado' : 'Copiar link do formulário'}
            </button>
            <button className="ghost" onClick={() => setInviting(true)}>
              Gerar link de cadastro
            </button>
            <button onClick={() => setCreating(true)}>Nova modelo</button>
          </>
        }
      />

      <div className="notice" style={{ marginBottom: 18 }}>
        <strong>Dois links.</strong> O <em>formulário</em> ({FORM_URL}) é genérico, para divulgar.
        O <em>link de cadastro</em> é pessoal: você abre a ficha com nome e celular, manda pelo
        WhatsApp, e o cadastro volta preenchido já vinculado à modelo — dá para ver quem
        respondeu e quem não.
      </div>

      <div className="tabs">
        {(
          [
            ['ALL', 'Todas'],
            ['PENDING', 'Aguardando'],
            ['ACTIVE', 'No elenco'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {loading || !data ? (
        <Loading rows={4} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nenhuma ficha aqui"
            description="Cadastre uma modelo, gere um link de cadastro ou divulgue o formulário."
          />
        </div>
      ) : (
        <div className="card flush">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Idade</th>
                  <th>Contato</th>
                  <th>Cidade</th>
                  <th>Manequim</th>
                  <th>Medidas</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((model) => {
                  const status = statusOf(model);
                  return (
                    <tr key={model.id}>
                      <td>
                        <strong>{model.fullName}</strong>
                        <div className="muted">
                          {model.instagram ? `@${model.instagram} · ` : ''}
                          {formatDate(model.createdAt)}
                        </div>
                      </td>
                      <td>{model.ageAtSignup ?? '—'}</td>
                      <td>
                        {model.email}
                        <div className="muted">{model.phone}</div>
                      </td>
                      <td>{model.city ? `${model.city}/${model.state}` : '—'}</td>
                      <td>
                        {model.dressSize ?? '—'}
                        <div className="muted">calçado {model.shoeSize ?? '—'}</div>
                      </td>
                      <td className="muted">
                        {model.heightCm ? `${model.heightCm} cm` : '—'}
                        <div>
                          {[model.bustCm, model.waistCm, model.hipsCm].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </td>
                      <td>
                        <span className={tagClass(status.tone)}>{status.label}</span>
                      </td>
                      <td className="right" style={{ whiteSpace: 'nowrap' }}>
                        {pendingInvite(model) && model.inviteToken ? (
                          <button
                            className="quiet tiny"
                            onClick={() => copy(inviteUrl(model.inviteToken!), model.id)}
                          >
                            {copied === model.id ? 'Copiado' : 'Copiar link'}
                          </button>
                        ) : null}{' '}
                        <button className="ghost tiny" onClick={() => setOpenId(model.id)}>
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

      {creating ? (
        <NewModelModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void reload();
          }}
        />
      ) : null}

      {inviting ? (
        <InviteModal
          onClose={() => setInviting(false)}
          onCreated={(created) => {
            setInviting(false);
            setInvite(created);
            void reload();
          }}
        />
      ) : null}

      {invite ? (
        <Modal
          title={`Link de cadastro — ${invite.fullName}`}
          onClose={() => setInvite(null)}
          footer={<button className="ghost" onClick={() => setInvite(null)}>Fechar</button>}
        >
          <p className="muted" style={{ marginBottom: 12 }}>
            Mande este link para a modelo. Ele é pessoal e vale para um único envio.
          </p>
          <code style={{ display: 'block', wordBreak: 'break-all', marginBottom: 16 }}>{invite.url}</code>
          <div className="row">
            <button onClick={() => copy(invite.url, 'invite')}>
              {copied === 'invite' ? 'Link copiado' : 'Copiar link'}
            </button>
            <a
              className="btn ghost"
              href={whatsappUrl(invite.phone, invite.fullName, invite.url)}
              target="_blank"
              rel="noreferrer"
            >
              Enviar por WhatsApp
            </a>
          </div>
        </Modal>
      ) : null}

      {openId ? (
        <ModelDetailModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void reload()}
          onInvite={(created) => setInvite(created)}
        />
      ) : null}
    </>
  );
}

// ── Nova modelo (ficha completa, já no elenco) ──────────────────────────────

function NewModelModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [ficha, setFicha] = useState<Ficha>(emptyFicha);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post('/models', payloadOf(ficha));
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Nova modelo"
      onClose={onClose}
      footer={
        <>
          <button disabled={saving || ficha.fullName.trim().length < 3} onClick={() => void save()}>
            {saving ? 'Salvando…' : 'Cadastrar no elenco'}
          </button>
          <button className="ghost" onClick={onClose}>Cancelar</button>
        </>
      }
    >
      <FichaFields value={ficha} onChange={setFicha} />
      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}

// ── Convite pessoal ─────────────────────────────────────────────────────────

function InviteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (invite: { fullName: string; phone: string | null; url: string }) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<{ inviteToken: string; fullName: string }>('/models/invite', {
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
      });
      onCreated({
        fullName: created.fullName,
        phone: phone.trim() || null,
        url: inviteUrl(created.inviteToken),
      });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Gerar link de cadastro"
      onClose={onClose}
      footer={
        <>
          <button disabled={saving || fullName.trim().length < 3} onClick={() => void create()}>
            {saving ? 'Gerando…' : 'Gerar link'}
          </button>
          <button className="ghost" onClick={onClose}>Cancelar</button>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: 14 }}>
        Só o nome e o celular. A modelo preenche o resto pelo link — e a ficha aparece aqui
        marcada como "convite enviado" até ela responder.
      </p>
      <div className="field">
        <label>Nome *</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label>Celular (com DDD)</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11 9 9999-9999" />
      </div>
      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}

// ── Ficha completa: ver, editar, aprovar ────────────────────────────────────

function ModelDetailModal({
  id,
  onClose,
  onChanged,
  onInvite,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onInvite: (invite: { fullName: string; phone: string | null; url: string }) => void;
}) {
  const { data, error, loading, reload } = useApi<ModelProfile>(`/models/${id}`);
  const [editing, setEditing] = useState(false);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      await reload();
      onChanged();
    } catch (caught) {
      setProblem((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const review = (status: Status) => run(() => api.patch(`/models/${id}/review`, { status }));

  const save = () =>
    run(async () => {
      if (!ficha) return;
      await api.patch(`/models/${id}`, payloadOf(ficha));
      setEditing(false);
    });

  const regenerate = () =>
    run(async () => {
      const created = await api.post<{ inviteToken: string; fullName: string }>(`/models/${id}/invite`);
      onInvite({
        fullName: created.fullName,
        phone: data?.phone ?? null,
        url: inviteUrl(created.inviteToken),
      });
    });

  if (error) return <Modal title="Modelo" onClose={onClose}><ErrorBox message={error} /></Modal>;
  if (loading || !data) return <Modal title="Modelo" onClose={onClose}><Loading rows={3} /></Modal>;

  const status = pendingInvite(data)
    ? { label: 'Convite enviado', tone: 'gold' as const }
    : describe(MODEL_STATUS, data.application?.status ?? 'RECEIVED');

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '6px 0' }}>
      <span className="muted">{label}</span>
      <span style={{ textAlign: 'right' }}>{value ?? '—'}</span>
    </div>
  );

  return (
    <Modal
      title={data.fullName}
      onClose={onClose}
      footer={
        editing ? (
          <>
            <button disabled={busy} onClick={() => void save()}>
              {busy ? 'Salvando…' : 'Salvar ficha'}
            </button>
            <button className="ghost" onClick={() => setEditing(false)}>Cancelar</button>
          </>
        ) : (
          <>
            {data.application?.status !== 'APPROVED' && !pendingInvite(data) ? (
              <button disabled={busy} onClick={() => void review('APPROVED')}>
                Aprovar — entra no elenco
              </button>
            ) : null}
            {data.application?.status !== 'REJECTED' && !pendingInvite(data) ? (
              <button className="quiet" disabled={busy} onClick={() => void review('REJECTED')}>
                Recusar
              </button>
            ) : null}
            {pendingInvite(data) ? (
              <button className="ghost" disabled={busy} onClick={() => void regenerate()}>
                Gerar novo link
              </button>
            ) : null}
            <button
              className="ghost"
              onClick={() => {
                setFicha(fichaOf(data));
                setEditing(true);
              }}
            >
              Editar ficha
            </button>
            <button className="ghost" onClick={onClose}>Fechar</button>
          </>
        )
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span className={tagClass(status.tone)}>{status.label}</span>
        <span className="muted">
          {data.application?.source === 'crm'
            ? 'cadastrada pela equipe'
            : data.inviteToken
              ? `convite ${formatDate(data.invitedAt ?? data.createdAt)}${
                  data.completedAt ? ` · respondido ${formatDate(data.completedAt)}` : ''
                }`
              : `pelo formulário · ${formatDate(data.createdAt)}`}
        </span>
      </div>

      {problem ? <p className="error" style={{ marginBottom: 12 }}>{problem}</p> : null}

      {editing && ficha ? (
        <FichaFields value={ficha} onChange={setFicha} />
      ) : (
        <>
          <SectionTitle>Dados</SectionTitle>
          <Row label="Idade" value={data.ageAtSignup ?? '—'} />
          <Row label="Nascimento" value={data.birthDate ? formatDate(data.birthDate) : '—'} />
          <Row label="E-mail" value={data.email} />
          <Row label="Celular" value={data.phone} />
          <Row label="Instagram" value={data.instagram ? `@${data.instagram}` : '—'} />
          <Row label="Cidade" value={data.city ? `${data.city}/${data.state}` : '—'} />

          <SectionTitle>Manequim e medidas</SectionTitle>
          <Row label="Manequim" value={data.dressSize} />
          <Row label="Calçado" value={data.shoeSize} />
          <Row label="Altura" value={data.heightCm ? `${data.heightCm} cm` : '—'} />
          <Row
            label="Busto · Cintura · Quadril"
            value={[data.bustCm, data.waistCm, data.hipsCm].map((v) => v ?? '—').join(' · ')}
          />
          <Row label="Cabelo · Olhos" value={[data.hairColor, data.eyeColor].filter(Boolean).join(' · ') || '—'} />

          <SectionTitle>Portfólio</SectionTitle>
          <Row
            label="Link"
            value={
              data.portfolioUrl ? (
                <a href={data.portfolioUrl} target="_blank" rel="noreferrer">{data.portfolioUrl}</a>
              ) : (
                '—'
              )
            }
          />
          {data.photos.length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {data.photos.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt="" style={{ width: 84, height: 112, objectFit: 'cover', borderRadius: 6 }} />
                </a>
              ))}
            </div>
          ) : null}

          {data.notes ? (
            <>
              <SectionTitle>Observações internas</SectionTitle>
              <p className="muted">{data.notes}</p>
            </>
          ) : null}
        </>
      )}
    </Modal>
  );
}
