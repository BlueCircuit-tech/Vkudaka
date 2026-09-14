import React, { useRef, useState } from 'react';
import { uploadImage } from '../api/client';

/** Blocos compartilhados do painel. Um só lugar define a linguagem visual. */

export function PageHead({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="titles">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  feature,
}: {
  label: string;
  value: string;
  hint?: string;
  feature?: boolean;
}) {
  return (
    <div className={feature ? 'card feature' : 'card'}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

/** Esqueleto em vez de "Carregando…": a tela não pula quando os dados chegam. */
export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="skeleton"
          style={{ width: `${88 - index * 12}%`, marginBottom: index === rows - 1 ? 0 : 14 }}
        />
      ))}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="card">
      <p className="error">{message}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div style={{ marginTop: 18 }}>{action}</div> : null}
    </div>
  );
}

/** Paginação real — as listas antes truncavam em silêncio. */
export function Pagination({
  page,
  perPage,
  total,
  onChange,
}: {
  page: number;
  perPage: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (total === 0) return null;

  const first = (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);

  return (
    <div className="pagination">
      <span>
        {first}–{last} de {total}
      </span>
      <div className="controls">
        <button className="ghost tiny" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Anterior
        </button>
        <button
          className="ghost tiny"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="modal">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="quiet" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/**
 * Envio de imagem de verdade (antes só existia um campo para colar URL).
 * Sobe o arquivo para a API e devolve a URL definitiva.
 */
export function ImageUploader({
  value,
  onChange,
  label = 'Imagem',
  hint = 'JPG, PNG ou WEBP · até 8 MB',
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  label?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadImage(file));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <label>{label}</label>
      <div className="uploader">
        {value ? (
          <img className="preview" src={value} alt="" />
        ) : (
          <div className="preview" aria-hidden="true" />
        )}

        <div
          className="drop"
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => event.key === 'Enter' && inputRef.current?.click()}
        >
          {busy ? 'Enviando…' : value ? 'Trocar imagem' : 'Escolher imagem'}
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
            {error ?? hint}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            onChange={(event) => void pick(event.target.files?.[0])}
          />
        </div>

        {value ? (
          <button type="button" className="quiet" onClick={() => onChange(null)}>
            Remover
          </button>
        ) : null}
      </div>
    </div>
  );
}
