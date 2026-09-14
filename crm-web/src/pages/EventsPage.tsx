import React, { useState } from 'react';
import { api, formatBRL } from '../api/client';
import { EVENT_STATUS, describe, tagClass } from '../lib/labels';
import { useApi } from '../lib/useApi';
import {
  EmptyState,
  ErrorBox,
  ImageUploader,
  Loading,
  Modal,
  PageHead,
  SectionTitle,
} from '../components/Page';

/**
 * Eventos e portaria (3.4).
 *
 * A lista de presença em PDF sai daqui: assinantes que confirmaram + compradores
 * avulsos. A arte de fundo do ingresso é enviada por evento — é o asset que o
 * app desenha atrás do QR Code.
 */

interface TicketType {
  id: string;
  name: string;
  priceCents: number;
  quantity: number;
  sold: number;
  isActive: boolean;
}

interface EventRow {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  startsAt: string;
  venueName: string | null;
  coverUrl: string | null;
  ticketArtUrl: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELED' | 'FINISHED';
  capacity: number | null;
  subscribersFree: boolean;
  sellsPublicTickets: boolean;
  ticketTypes: TicketType[];
  _count: { attendees: number; tickets: number };
}

type EntryRight =
  | 'SUBSCRIBER'
  | 'PAID_TICKET'
  | 'GUEST'
  | 'SUBSCRIPTION_INACTIVE'
  | 'PAYMENT_PENDING'
  | 'TICKET_CANCELED';

interface EntryRow {
  attendeeId: string;
  name: string;
  document: string | null;
  contact: string | null;
  kind: 'SUBSCRIBER_RSVP' | 'PAID_TICKET' | 'GUEST';
  ticketCode: string | null;
  allowed: boolean;
  right: EntryRight;
  checkedIn: boolean;
  checkedInAt: string | null;
}

interface EntryList {
  event: { title: string; startsAt: string; venueName: string | null; capacity: number | null };
  allowed: EntryRow[];
  blocked: EntryRow[];
  generatedAt: string;
}

/** Por que a pessoa entra — ou não. Mesmo vocabulário do PDF da recepção. */
const RIGHT_LABEL: Record<EntryRight, string> = {
  SUBSCRIBER: 'Plano do clube',
  PAID_TICKET: 'Ingresso pago',
  GUEST: 'Convidado da casa',
  SUBSCRIPTION_INACTIVE: 'Plano inativo',
  PAYMENT_PENDING: 'Pagamento pendente',
  TICKET_CANCELED: 'Ingresso cancelado',
};

const KIND_LABEL: Record<EntryRow['kind'], string> = {
  SUBSCRIBER_RSVP: 'Assinante',
  PAID_TICKET: 'Avulso',
  GUEST: 'Convidado',
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const datetimeLocal = (iso: string) => new Date(iso).toISOString().slice(0, 16);

export function EventsPage() {
  const { data, error, loading, reload } = useApi<EventRow[]>('/admin/events');
  const [attendeesOf, setAttendeesOf] = useState<EventRow | null>(null);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [creating, setCreating] = useState(false);

  if (error) return <ErrorBox message={error} />;

  return (
    <>
      <PageHead
        title="Eventos e portaria"
        description="Criação de eventos, ingressos avulsos, arte do ingresso e lista de presença."
        actions={<button onClick={() => setCreating(true)}>Novo evento</button>}
      />

      {loading || !data ? (
        <Loading rows={4} />
      ) : data.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nenhum evento criado"
            description="Publique um evento para que os assinantes possam confirmar presença."
            action={<button onClick={() => setCreating(true)}>Novo evento</button>}
          />
        </div>
      ) : (
        <div className="card flush">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Data</th>
                  <th>Status</th>
                  <th>Assinantes</th>
                  <th>Ingresso avulso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <strong>{event.title}</strong>
                      <div className="sub">
                        {event.venueName ?? '—'}
                        {event.ticketArtUrl ? ' · arte do ingresso enviada' : ' · sem arte de ingresso'}
                      </div>
                    </td>
                    <td className="muted">{new Date(event.startsAt).toLocaleString('pt-BR')}</td>
                    <td>
                      {(() => {
                        const status = describe(EVENT_STATUS, event.status);
                        return <span className={tagClass(status.tone)}>{status.label}</span>;
                      })()}
                    </td>
                    <td>
                      {event.subscribersFree ? (
                        <span className="tag gold dot">Entrada gratuita</span>
                      ) : (
                        <span className="tag">Pagam ingresso</span>
                      )}
                      <div className="sub">
                        {event._count.attendees} confirmado(s)
                        {event.capacity ? ` de ${event.capacity}` : ''}
                      </div>
                    </td>
                    <td>
                      {!event.sellsPublicTickets ? (
                        <span className="muted">fechado ao público</span>
                      ) : event.ticketTypes.length === 0 ? (
                        <span className="tag danger dot">sem lote</span>
                      ) : (
                        event.ticketTypes.map((type) => (
                          <div key={type.id}>
                            {type.name} · <span className="num">{formatBRL(type.priceCents)}</span>
                            <span className="muted">
                              {' '}
                              · {type.sold}/{type.quantity}
                              {type.isActive ? '' : ' · inativo'}
                            </span>
                          </div>
                        ))
                      )}
                    </td>
                    <td className="right" style={{ whiteSpace: 'nowrap' }}>
                      <button className="ghost tiny" onClick={() => setEditing(event)}>Editar</button>{' '}
                      <button className="ghost tiny" onClick={() => setAttendeesOf(event)}>Lista</button>{' '}
                      <button
                        className="tiny"
                        onClick={() =>
                          void api.download(
                            `/events/${event.id}/attendance.pdf`,
                            `lista-entrada-${event.slug}.pdf`,
                          )
                        }
                      >
                        PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating ? (
        <EventForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void reload();
          }}
        />
      ) : null}

      {editing ? (
        <EventEditor
          event={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
          onChanged={() => void reload()}
        />
      ) : null}

      {attendeesOf ? (
        <AttendeeModal event={attendeesOf} onClose={() => setAttendeesOf(null)} />
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AttendeeModal({ event, onClose }: { event: EventRow; onClose: () => void }) {
  const { data, loading } = useApi<EntryList>(`/admin/events/${event.id}/attendees`);

  return (
    <Modal
      title={`Lista de entrada — ${event.title}`}
      onClose={onClose}
      footer={
        <button
          onClick={() =>
            void api.download(
              `/events/${event.id}/attendance.pdf`,
              `lista-entrada-${event.slug}.pdf`,
            )
          }
        >
          Baixar PDF da recepção
        </button>
      }
    >
      {loading || !data ? (
        <Loading rows={4} />
      ) : (
        <>
          <div className="notice" style={{ marginBottom: 18 }}>
            Entra quem <strong>é do plano do clube</strong> ou <strong>pagou o ingresso</strong>.
            Confirmar presença não basta: plano cancelado e ingresso não pago ficam de fora, e
            aparecem abaixo para a recepção saber o que dizer na porta.
          </div>

          <SectionTitle>Liberados ({data.allowed.length})</SectionTitle>
          {data.allowed.length === 0 ? (
            <EmptyState
              title="Ninguém liberado ainda"
              description="Assinantes confirmam presença pelo app; avulsos entram ao pagar o ingresso."
            />
          ) : (
            <div className="card flush" style={{ marginBottom: 22 }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Documento</th>
                      <th>Acesso</th>
                      <th>Ingresso</th>
                      <th>Entrou</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.allowed.map((row) => (
                      <tr key={row.attendeeId}>
                        <td>
                          <strong>{row.name}</strong>
                          <div className="sub">{row.contact ?? '—'}</div>
                        </td>
                        <td className="muted">{row.document ?? '—'}</td>
                        <td>
                          <span className={row.kind === 'SUBSCRIBER_RSVP' ? 'tag gold dot' : 'tag dot'}>
                            {RIGHT_LABEL[row.right]}
                          </span>
                        </td>
                        <td className="muted">{row.ticketCode ?? '—'}</td>
                        <td>
                          {row.checkedIn ? (
                            <span className="tag ok dot">entrou</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.blocked.length > 0 ? (
            <>
              <SectionTitle>Não liberados ({data.blocked.length})</SectionTitle>
              <div className="card flush">
                <table>
                  <tbody>
                    {data.blocked.map((row) => (
                      <tr key={row.attendeeId}>
                        <td>
                          <strong>{row.name}</strong>
                          <div className="sub">{KIND_LABEL[row.kind]}</div>
                        </td>
                        <td className="right">
                          <span className="tag danger dot">{RIGHT_LABEL[row.right]}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function EventForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: '',
    startsAt: '',
    venueName: '',
    description: '',
    capacity: '',
    ticketName: 'Inteira',
    ticketPrice: '120',
    ticketQuantity: '100',
    subscribersFree: true,
    sellsPublicTickets: true,
    publish: true,
  });
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [ticketArtUrl, setTicketArtUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post('/admin/events', {
        title: form.title,
        slug: slugify(form.title),
        description: form.description || undefined,
        startsAt: new Date(form.startsAt).toISOString(),
        venueName: form.venueName || undefined,
        capacity: form.capacity ? Number(form.capacity) : undefined,
        coverUrl: coverUrl ?? undefined,
        ticketArtUrl: ticketArtUrl ?? undefined,
        status: form.publish ? 'PUBLISHED' : 'DRAFT',
        subscribersFree: form.subscribersFree,
        sellsPublicTickets: form.sellsPublicTickets,
        ticketTypes: form.sellsPublicTickets
          ? [
              {
                name: form.ticketName,
                priceCents: Math.round(Number(form.ticketPrice.replace(',', '.')) * 100),
                quantity: Number(form.ticketQuantity),
              },
            ]
          : [],
      });
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Novo evento"
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose}>Cancelar</button>
          <button form="event-form" type="submit" disabled={saving}>
            {saving ? 'Salvando…' : 'Criar evento'}
          </button>
        </>
      }
    >
      <form id="event-form" onSubmit={submit}>
        <div className="field">
          <label>Título</label>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} required />
        </div>

        <div className="row">
          <div className="field">
            <label>Início</label>
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => set('startsAt', e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Local</label>
            <input value={form.venueName} onChange={(e) => set('venueName', e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 140 }}>
            <label>Capacidade</label>
            <input value={form.capacity} onChange={(e) => set('capacity', e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>Descrição</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>

        <ImageUploader value={coverUrl} onChange={setCoverUrl} label="Capa do evento" />
        <ImageUploader
          value={ticketArtUrl}
          onChange={setTicketArtUrl}
          label="Arte de fundo do ingresso"
          hint="Fundo do ingresso no app, atrás do QR Code · vertical"
        />

        <SectionTitle>Acesso</SectionTitle>
        <label className="check" style={{ marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={form.subscribersFree}
            onChange={(e) => set('subscribersFree', e.target.checked)}
          />
          Assinantes não pagam — confirmam presença pelo app
        </label>
        <label className="check" style={{ marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={form.sellsPublicTickets}
            onChange={(e) => set('sellsPublicTickets', e.target.checked)}
          />
          Vender ingresso avulso a quem não é assinante
        </label>

        <div className="notice" style={{ margin: '4px 0 18px' }}>
          A venda avulsa é o único caminho de compra do app aberto a quem não assina — aparece
          num bloco isolado, sem acesso à loja nem ao clube.
        </div>

        {form.sellsPublicTickets ? (
          <div className="row">
            <div className="field">
              <label>Nome do ingresso</label>
              <input value={form.ticketName} onChange={(e) => set('ticketName', e.target.value)} />
            </div>
            <div className="field">
              <label>Preço (R$)</label>
              <input value={form.ticketPrice} onChange={(e) => set('ticketPrice', e.target.value)} />
            </div>
            <div className="field">
              <label>Quantidade</label>
              <input
                value={form.ticketQuantity}
                onChange={(e) => set('ticketQuantity', e.target.value)}
              />
            </div>
          </div>
        ) : null}

        <label className="check">
          <input
            type="checkbox"
            checked={form.publish}
            onChange={(e) => set('publish', e.target.checked)}
          />
          Publicar agora (dispara push para os assinantes)
        </label>

        {error ? <p className="error" style={{ marginTop: 14 }}>{error}</p> : null}
      </form>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function EventEditor({
  event,
  onClose,
  onSaved,
  onChanged,
}: {
  event: EventRow;
  onClose: () => void;
  onSaved: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [venueName, setVenueName] = useState(event.venueName ?? '');
  const [startsAt, setStartsAt] = useState(datetimeLocal(event.startsAt));
  const [capacity, setCapacity] = useState(event.capacity ? String(event.capacity) : '');
  const [status, setStatus] = useState(event.status);
  const [subscribersFree, setSubscribersFree] = useState(event.subscribersFree);
  const [sellsPublicTickets, setSells] = useState(event.sellsPublicTickets);
  const [coverUrl, setCoverUrl] = useState<string | null>(event.coverUrl);
  const [ticketArtUrl, setTicketArtUrl] = useState<string | null>(event.ticketArtUrl);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/admin/events/${event.id}`, {
        title,
        venueName: venueName || undefined,
        startsAt: new Date(startsAt).toISOString(),
        capacity: capacity ? Number(capacity) : undefined,
        status,
        subscribersFree,
        sellsPublicTickets,
        coverUrl: coverUrl ?? undefined,
        ticketArtUrl: ticketArtUrl ?? undefined,
      });
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Editar — ${event.title}`}
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose}>Cancelar</button>
          <button onClick={() => void save()} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Título</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="row">
        <div className="field">
          <label>Início</label>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Local</label>
          <input value={venueName} onChange={(e) => setVenueName(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 140 }}>
          <label>Capacidade</label>
          <input value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
      </div>

      <div className="field" style={{ maxWidth: 260 }}>
        <label>Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as EventRow['status'])}>
          <option value="DRAFT">Rascunho</option>
          <option value="PUBLISHED">Publicado</option>
          <option value="CANCELED">Cancelado</option>
          <option value="FINISHED">Encerrado</option>
        </select>
      </div>

      <SectionTitle>Acesso</SectionTitle>
      <label className="check" style={{ marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={subscribersFree}
          onChange={(e) => setSubscribersFree(e.target.checked)}
        />
        Assinantes não pagam — confirmam presença pelo app
      </label>
      <label className="check" style={{ marginBottom: 20 }}>
        <input
          type="checkbox"
          checked={sellsPublicTickets}
          onChange={(e) => setSells(e.target.checked)}
        />
        Vender ingresso avulso a quem não é assinante
      </label>

      <ImageUploader value={coverUrl} onChange={setCoverUrl} label="Capa do evento" />
      <ImageUploader
        value={ticketArtUrl}
        onChange={setTicketArtUrl}
        label="Arte de fundo do ingresso"
        hint="Fundo do ingresso no app, atrás do QR Code · vertical"
      />

      <TicketTypes
        event={event}
        enabled={sellsPublicTickets}
        onChanged={onChanged}
      />

      {error ? <p className="error" style={{ marginTop: 14 }}>{error}</p> : null}
    </Modal>
  );
}


/**
 * Bloco de ingresso avulso (2.4).
 *
 * Fica separado do resto do formulário porque é outra audiência: quem compra
 * aqui não é do clube. Assinante não passa por este bloco — confirma presença
 * e entra sem pagar.
 */
function TicketTypes({
  event,
  enabled,
  onChanged,
}: {
  event: EventRow;
  enabled: boolean;
  onChanged: () => void;
}) {
  const [types, setTypes] = useState(event.ticketTypes);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const fresh = await api.get<EventRow[]>('/admin/events');
    setTypes(fresh.find((e) => e.id === event.id)?.ticketTypes ?? []);
    onChanged();
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    void run(async () => {
      await api.post(`/admin/events/${event.id}/ticket-types`, {
        name,
        priceCents: Math.round(Number(price.replace(',', '.')) * 100),
        quantity: Number(quantity),
      });
      setName('');
      setPrice('');
      setQuantity('');
    });

  return (
    <>
      <SectionTitle>Ingresso avulso</SectionTitle>

      {!enabled ? (
        <p className="muted" style={{ marginBottom: 16 }}>
          A venda avulsa está desligada neste evento. Ligue acima e salve para cadastrar lotes.
        </p>
      ) : null}

      {types.length === 0 ? (
        <p className="muted" style={{ marginBottom: 16 }}>
          Nenhum lote cadastrado — hoje só assinantes entram neste evento.
        </p>
      ) : (
        <div className="card flush" style={{ marginBottom: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Lote</th>
                <th>Preço</th>
                <th>Vendidos</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {types.map((type) => (
                <tr key={type.id}>
                  <td>
                    <strong>{type.name}</strong>
                    {type.isActive ? null : <div className="sub">inativo</div>}
                  </td>
                  <td className="num">{formatBRL(type.priceCents)}</td>
                  <td>
                    {type.sold} / {type.quantity}
                  </td>
                  <td className="right actions">
                    <button
                      className="ghost tiny"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api.patch(`/admin/ticket-types/${type.id}`, { isActive: !type.isActive }),
                        )
                      }
                    >
                      {type.isActive ? 'Pausar' : 'Reabrir'}
                    </button>{' '}
                    <button
                      className="quiet tiny"
                      disabled={busy}
                      onClick={() => {
                        const aviso =
                          type.sold > 0
                            ? `Este lote já vendeu ${type.sold} ingresso(s); ele será desativado, não apagado. Continuar?`
                            : `Remover o lote "${type.name}"?`;
                        if (!window.confirm(aviso)) return;
                        void run(() => api.delete(`/admin/ticket-types/${type.id}`));
                      }}
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row">
        <div className="field">
          <label>Novo lote</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Inteira, Mesa, Camarote…"
            disabled={!enabled}
          />
        </div>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>Preço (R$)</label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} disabled={!enabled} />
        </div>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>Quantidade</label>
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={!enabled}
          />
        </div>
        <button className="ghost" disabled={!enabled || !name || !price || !quantity || busy} onClick={add}>
          Adicionar lote
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}
    </>
  );
}
