import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ErrorBox, ImageUploader, Loading, PageHead } from '../components/Page';

/**
 * Mudar Categoria APP (2026-11-12).
 *
 * As 2 fotos que aparecem no modal quando o cliente toca em "Loja" no app.
 * Cada foto leva a uma categoria (ex.: Alfaiataria, Moda Festa): tocou, a
 * vitrine abre filtrada só com as peças dela. Salvou aqui, o app já mostra —
 * sem nova versão nas lojas.
 */

interface Slot {
  order: 1 | 2;
  categoryId: string | null;
  imageUrl: string | null;
  label: string | null;
}

interface Category {
  id: string;
  name: string;
  scope: 'SALE' | 'RENTAL' | 'BOTH';
  imageUrl: string | null;
}

const SCOPE: Record<Category['scope'], string> = {
  SALE: 'só venda',
  RENTAL: 'só aluguel',
  BOTH: 'venda e aluguel',
};

export function CategoryPickerPage() {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ slots: Slot[]; categories: Category[] }>('/admin/category-picker')
      .then((data) => {
        setSlots(data.slots);
        setCategories(data.categories);
      })
      .catch((caught) => setError((caught as Error).message));
  }, []);

  if (error && !slots) return <ErrorBox message={error} />;
  if (!slots) return <Loading rows={6} />;

  const update = (order: 1 | 2, patch: Partial<Slot>) => {
    setStatus(null);
    setSlots((current) => current!.map((slot) => (slot.order === order ? { ...slot, ...patch } : slot)));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await api.put('/admin/category-picker', {
        slots: slots.map((slot) => ({
          order: slot.order,
          categoryId: slot.categoryId,
          imageUrl: slot.imageUrl,
          label: slot.label?.trim() || null,
        })),
      });
      const active = slots.filter((slot) => slot.categoryId && slot.imageUrl).length;
      setStatus(
        active > 0
          ? 'Publicado. Na próxima vez que o cliente tocar em Loja, o app já mostra as fotos.'
          : 'Publicado sem fotos: o app abre a Loja direto, sem o modal.',
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="Mudar Categoria APP"
        description="As 2 fotos que abrem quando o cliente toca em Loja. Tocou na foto, a loja mostra só aquela categoria."
      />

      <div className="grid cols-2" style={{ marginBottom: 20 }}>
        {slots.map((slot) => {
          const category = categories.find((c) => c.id === slot.categoryId);
          const label = slot.label?.trim() || category?.name || '';
          return (
            <div className="card" key={slot.order}>
              <h3 style={{ marginTop: 0 }}>Foto {slot.order}</h3>

              <div className="field">
                <label>Categoria</label>
                <select
                  value={slot.categoryId ?? ''}
                  onChange={(e) => {
                    const picked = categories.find((c) => c.id === e.target.value);
                    update(slot.order, {
                      categoryId: e.target.value || null,
                      // Categoria que já tem foto: aproveita como ponto de partida.
                      imageUrl: slot.imageUrl ?? picked?.imageUrl ?? null,
                    });
                  }}
                >
                  <option value="">Nenhuma (sem foto {slot.order})</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {SCOPE[c.scope]}
                    </option>
                  ))}
                </select>
              </div>

              <ImageUploader
                label="Foto"
                hint="Vertical fica melhor (ex.: 1080×1350) · JPG, PNG ou WEBP"
                value={slot.imageUrl}
                onChange={(url) => update(slot.order, { imageUrl: url })}
              />

              <div className="field">
                <label>Texto sobre a foto</label>
                <input
                  value={slot.label ?? ''}
                  maxLength={40}
                  placeholder={category?.name ?? 'Nome da categoria'}
                  onChange={(e) => update(slot.order, { label: e.target.value })}
                />
                <span className="hint">Em branco = nome da categoria.</span>
              </div>

              {/* Prévia de como aparece no app */}
              {slot.imageUrl && slot.categoryId ? (
                <div
                  style={{
                    position: 'relative',
                    borderRadius: 16,
                    overflow: 'hidden',
                    aspectRatio: '16 / 10',
                    background: `#1d2433 url(${slot.imageUrl}) center / cover no-repeat`,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(to top, rgba(0,0,0,.6), rgba(0,0,0,0) 60%)',
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      left: 18,
                      bottom: 14,
                      color: '#fff',
                      fontSize: 22,
                      letterSpacing: '.12em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {label}
                  </span>
                </div>
              ) : (
                <p className="muted">Escolha a categoria e a foto para ver a prévia.</p>
              )}
            </div>
          );
        })}
      </div>

      {error ? <p className="error">{error}</p> : null}
      {status ? <p className="notice">{status}</p> : null}
      <button onClick={() => void save()} disabled={busy}>
        {busy ? 'Publicando…' : 'Publicar no app'}
      </button>
    </>
  );
}
