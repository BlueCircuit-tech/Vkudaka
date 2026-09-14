import React, { useState } from 'react';
import { api, formatBRL } from '../api/client';
import { PRODUCT_STATUS, describe, tagClass } from '../lib/labels';
import { useApi } from '../lib/useApi';
import {
  EmptyState,
  ErrorBox,
  ImageUploader,
  Loading,
  Modal,
  PageHead,
  Pagination,
} from '../components/Page';

/**
 * Coleção (3.3) — cadastro, edição e estoque das peças.
 *
 * O cadastro define explicitamente Venda, Aluguel ou Ambos, e o formulário só
 * pede o preço da modalidade escolhida — a API recusa peça de venda sem preço
 * de venda, então a tela evita o erro antes de acontecer.
 *
 * As abas separam as duas vitrines (2.3): quem está montando o aluguel vê o
 * acervo de aluguel, quem está montando a loja vê o de venda. Peça marcada
 * "Venda e aluguel" aparece nas duas, porque está disponível nas duas — e a
 * aba já define a modalidade da próxima peça cadastrada.
 */

interface Variant {
  id: string;
  size: string;
  color: string;
  sku: string;
  stock: number;
  rentalStock: number;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  availability: 'SALE' | 'RENTAL' | 'BOTH';
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  salePriceCents: number | null;
  rentalPriceCents: number | null;
  freeShipping: boolean;
  isHighlighted: boolean;
  variants: Variant[];
  images: Array<{ id: string; url: string; isCover: boolean }>;
  category: { name: string } | null;
}

const AVAILABILITY_LABEL: Record<Product['availability'], string> = {
  SALE: 'Venda',
  RENTAL: 'Aluguel',
  BOTH: 'Venda e aluguel',
};

const statusOf = (status: Product['status']) => describe(PRODUCT_STATUS, status);

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const toCents = (value: string) => Math.round(Number(value.replace(',', '.')) * 100);
const toReais = (cents: number | null) => (cents === null ? '' : String(cents / 100));

const cover = (product: Product) => product.images.find((i) => i.isCover) ?? product.images[0];

type Scope = '' | 'SALE' | 'RENTAL' | 'BOTH';

const SCOPE_TABS: Array<{ key: Scope; label: string }> = [
  { key: '', label: 'Todas' },
  { key: 'SALE', label: 'Compra' },
  { key: 'RENTAL', label: 'Aluguel' },
  { key: 'BOTH', label: 'Venda e aluguel' },
];

export function ProductsPage() {
  const [filter, setFilter] = useState<Scope>('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  /** A coleção abre como lookbook; a lista fica para conferir estoque e preço. */
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const perPage = 20;
  const { data, error, loading, reload } = useApi<{ data: Product[]; total: number }>(
    `/admin/products?page=${page}&perPage=${perPage}${filter ? `&availability=${filter}` : ''}`,
  );

  if (error) return <ErrorBox message={error} />;

  const publish = async (product: Product) => {
    await api.patch(`/admin/products/${product.id}`, { status: 'PUBLISHED' });
    await reload();
  };

  return (
    <>
      <PageHead
        title={filter === 'RENTAL' ? 'Aluguel' : filter === 'SALE' ? 'Coleção' : 'Coleção'}
        description={
          filter === 'RENTAL'
            ? 'Peças liberadas para aluguel, com preço por período, caução e estoque de locação.'
            : filter === 'SALE'
              ? 'Peças à venda, com preço, tamanhos, cores e estoque.'
              : 'Peças da casa, com preço de venda e/ou aluguel, tamanhos, cores e estoque.'
        }
        actions={
          <>
            <div className="view-switch">
              <button
                className={view === 'grid' ? 'active' : ''}
                onClick={() => setView('grid')}
              >
                Lookbook
              </button>
              <button
                className={view === 'list' ? 'active' : ''}
                onClick={() => setView('list')}
              >
                Lista
              </button>
            </div>
            <button onClick={() => setCreating(true)}>Nova peça</button>
          </>
        }
      />

      <div className="tabs">
        {SCOPE_TABS.map((tab) => (
          <button
            key={tab.key || 'all'}
            className={filter === tab.key ? 'active' : ''}
            onClick={() => {
              setFilter(tab.key);
              setPage(1);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading || !data ? (
        <Loading rows={5} />
      ) : data.data.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nenhuma peça cadastrada"
            description="Cadastre a primeira peça para que ela apareça na vitrine do app."
            action={<button onClick={() => setCreating(true)}>Nova peça</button>}
          />
        </div>
      ) : view === 'grid' ? (
        <>
          <div className="lookbook">
            {data.data.map((product) => (
              <LookCard key={product.id} product={product} onEdit={() => setEditing(product)} />
            ))}
          </div>
          <div className="card flush" style={{ marginTop: 24 }}>
            <Pagination page={page} perPage={perPage} total={data.total} onChange={setPage} />
          </div>
        </>
      ) : (
        <div className="card flush">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Peça</th>
                  <th>Disponibilidade</th>
                  <th>Venda</th>
                  <th>Aluguel</th>
                  <th>Estoque</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((product) => {
                  const image = cover(product);
                  const stock = product.variants.reduce((sum, v) => sum + v.stock, 0);
                  const rentalStock = product.variants.reduce((sum, v) => sum + v.rentalStock, 0);

                  return (
                    <tr key={product.id}>
                      <td>
                        {image ? (
                          <img className="thumb" src={image.url} alt="" />
                        ) : (
                          <div className="thumb" />
                        )}
                      </td>
                      <td>
                        <strong>{product.name}</strong>
                        <div className="sub">
                          {product.sku}
                          {product.category ? ` · ${product.category.name}` : ''}
                          {product.freeShipping ? ' · frete grátis' : ''}
                          {product.isHighlighted ? ' · destaque' : ''}
                        </div>
                      </td>
                      <td>
                        <span className="tag gold">{AVAILABILITY_LABEL[product.availability]}</span>
                      </td>
                      <td className="num">
                        {product.salePriceCents ? formatBRL(product.salePriceCents) : '—'}
                      </td>
                      <td className="num">
                        {product.rentalPriceCents ? formatBRL(product.rentalPriceCents) : '—'}
                      </td>
                      <td>
                        {product.availability !== 'RENTAL' ? `${stock} venda` : '—'}
                        {product.availability !== 'SALE' ? (
                          <div className="sub">{rentalStock} aluguel</div>
                        ) : null}
                      </td>
                      <td>
                        <span className={tagClass(statusOf(product.status).tone)}>
                          {statusOf(product.status).label}
                        </span>
                      </td>
                      <td className="right actions">
                        <button className="ghost tiny" onClick={() => setEditing(product)}>
                          Editar
                        </button>{' '}
                        {product.status !== 'PUBLISHED' ? (
                          <button className="tiny" onClick={() => void publish(product)}>
                            Publicar
                          </button>
                        ) : null}
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
        <ProductForm
          // A aba aberta diz o que a pessoa está montando: cadastrar dentro de
          // "Aluguel" já abre o formulário como peça de aluguel.
          initialAvailability={filter === '' ? 'SALE' : filter}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void reload();
          }}
        />
      ) : null}

      {editing ? (
        <ProductEditor
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      ) : null}
    </>
  );
}

/** Peça no lookbook: a foto manda, o resto é legenda. */
function LookCard({ product, onEdit }: { product: Product; onEdit: () => void }) {
  const image = cover(product);
  const stock = product.variants.reduce((sum, v) => sum + v.stock, 0);
  const rentalStock = product.variants.reduce((sum, v) => sum + v.rentalStock, 0);
  const relevantStock = product.availability === 'RENTAL' ? rentalStock : stock;

  return (
    <article className="look">
      <div className="frame">
        {image ? (
          <img src={image.url} alt={product.name} loading="lazy" />
        ) : (
          <div className="placeholder">sem foto</div>
        )}

        <div className="badges">
          <span className="tag gold">{AVAILABILITY_LABEL[product.availability]}</span>
          {product.status !== 'PUBLISHED' ? (
            <span className="tag">{statusOf(product.status).label}</span>
          ) : null}
        </div>

        <div className="veil">
          <button className="gold tiny" onClick={onEdit}>
            Editar peça
          </button>
        </div>
      </div>

      <div className="meta">
        <h3>{product.name}</h3>
        <div className="sku">
          {product.sku}
          {product.category ? ` · ${product.category.name}` : ''}
        </div>
        <div className="prices">
          {product.salePriceCents ? <span>{formatBRL(product.salePriceCents)}</span> : null}
          {product.rentalPriceCents ? (
            <span className="rent">aluguel {formatBRL(product.rentalPriceCents)}</span>
          ) : null}
        </div>
        <div className="stock">
          {relevantStock > 0
            ? `${relevantStock} em estoque`
            : 'sem estoque'}
          {product.freeShipping ? ' · frete grátis' : ''}
        </div>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cadastro
// ─────────────────────────────────────────────────────────────────────────────

function ProductForm({
  initialAvailability = 'SALE',
  onClose,
  onSaved,
}: {
  initialAvailability?: Product['availability'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    sku: '',
    availability: initialAvailability,
    salePrice: '',
    rentalPrice: '',
    sizes: '36, 38, 40, 42',
    color: 'Único',
    stockPerSize: '3',
    description: '',
    composition: '',
    freeShipping: false,
    isHighlighted: false,
    publish: true,
  });
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);

    const sku = form.sku || `VK-${slugify(form.name).toUpperCase().slice(0, 20)}`;
    const sizes = form.sizes.split(',').map((s) => s.trim()).filter(Boolean);

    try {
      await api.post('/admin/products', {
        sku,
        name: form.name,
        slug: slugify(form.name),
        description: form.description || undefined,
        composition: form.composition || undefined,
        availability: form.availability,
        status: form.publish ? 'PUBLISHED' : 'DRAFT',
        salePriceCents: form.availability !== 'RENTAL' ? toCents(form.salePrice) : undefined,
        rentalPriceCents: form.availability !== 'SALE' ? toCents(form.rentalPrice) : undefined,
        freeShipping: form.freeShipping,
        isHighlighted: form.isHighlighted,
        variants: sizes.map((size) => ({
          size,
          color: form.color,
          sku: `${sku}-${size}`,
          stock: form.availability !== 'RENTAL' ? Number(form.stockPerSize) : 0,
          rentalStock: form.availability !== 'SALE' ? Number(form.stockPerSize) : 0,
        })),
        images: imageUrl ? [{ url: imageUrl }] : [],
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
      title="Nova peça"
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose}>Cancelar</button>
          <button form="product-form" type="submit" disabled={saving}>
            {saving ? 'Salvando…' : 'Cadastrar peça'}
          </button>
        </>
      }
    >
      <form id="product-form" onSubmit={submit}>
        <ImageUploader value={imageUrl} onChange={setImageUrl} label="Foto de capa" />

        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Nome</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="field">
            <label>SKU (opcional)</label>
            <input
              value={form.sku}
              onChange={(e) => set('sku', e.target.value)}
              placeholder="gerado do nome"
            />
          </div>
        </div>

        <div className="field">
          <label>Disponibilidade</label>
          <select
            value={form.availability}
            onChange={(e) => set('availability', e.target.value as Product['availability'])}
          >
            <option value="SALE">Somente venda</option>
            <option value="RENTAL">Somente aluguel</option>
            <option value="BOTH">Venda e aluguel</option>
          </select>
        </div>

        <div className="row">
          {form.availability !== 'RENTAL' ? (
            <div className="field">
              <label>Preço de venda (R$)</label>
              <input
                value={form.salePrice}
                onChange={(e) => set('salePrice', e.target.value)}
                required
              />
            </div>
          ) : null}
          {form.availability !== 'SALE' ? (
            <div className="field">
              <label>Preço de aluguel (R$)</label>
              <input
                value={form.rentalPrice}
                onChange={(e) => set('rentalPrice', e.target.value)}
                required
              />
            </div>
          ) : null}
        </div>

        <div className="row">
          <div className="field">
            <label>Tamanhos (vírgula)</label>
            <input value={form.sizes} onChange={(e) => set('sizes', e.target.value)} />
          </div>
          <div className="field">
            <label>Cor</label>
            <input value={form.color} onChange={(e) => set('color', e.target.value)} />
          </div>
          <div className="field">
            <label>Estoque por tamanho</label>
            <input
              value={form.stockPerSize}
              onChange={(e) => set('stockPerSize', e.target.value)}
            />
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

        <div className="field">
          <label>Composição</label>
          <input
            value={form.composition}
            onChange={(e) => set('composition', e.target.value)}
            placeholder="Ex.: 70% viscose, 30% linho"
          />
        </div>

        <div className="row" style={{ gap: 22 }}>
          <label className="check">
            <input
              type="checkbox"
              checked={form.freeShipping}
              onChange={(e) => set('freeShipping', e.target.checked)}
            />
            Frete grátis nesta peça
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.isHighlighted}
              onChange={(e) => set('isHighlighted', e.target.checked)}
            />
            Destacar na vitrine
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.publish}
              onChange={(e) => set('publish', e.target.checked)}
            />
            Publicar (dispara push)
          </label>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </form>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edição — antes não existia: uma peça cadastrada errado ficava errada.
// ─────────────────────────────────────────────────────────────────────────────

function ProductEditor({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [salePrice, setSalePrice] = useState(toReais(product.salePriceCents));
  const [rentalPrice, setRentalPrice] = useState(toReais(product.rentalPriceCents));
  const [availability, setAvailability] = useState(product.availability);
  const [status, setStatus] = useState(product.status);
  const [freeShipping, setFreeShipping] = useState(product.freeShipping);
  const [isHighlighted, setIsHighlighted] = useState(product.isHighlighted);
  const [imageUrl, setImageUrl] = useState<string | null>(cover(product)?.url ?? null);
  const [stock, setStock] = useState<Record<string, { stock: string; rentalStock: string }>>(
    Object.fromEntries(
      product.variants.map((v) => [v.id, { stock: String(v.stock), rentalStock: String(v.rentalStock) }]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/admin/products/${product.id}`, {
        name,
        availability,
        status,
        freeShipping,
        isHighlighted,
        salePriceCents: availability !== 'RENTAL' && salePrice ? toCents(salePrice) : undefined,
        rentalPriceCents: availability !== 'SALE' && rentalPrice ? toCents(rentalPrice) : undefined,
      });

      // Estoque vive na variante: só envia as que realmente mudaram.
      for (const variant of product.variants) {
        const next = stock[variant.id];
        if (!next) continue;
        if (Number(next.stock) !== variant.stock || Number(next.rentalStock) !== variant.rentalStock) {
          await api.patch(`/admin/variants/${variant.id}/stock`, {
            stock: Number(next.stock),
            rentalStock: Number(next.rentalStock),
          });
        }
      }

      if (imageUrl && imageUrl !== cover(product)?.url) {
        await api.post(`/admin/products/${product.id}/images`, { url: imageUrl, isCover: true });
      }

      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!window.confirm(`Arquivar "${product.name}"? Ela sai da vitrine do app.`)) return;
    await api.delete(`/admin/products/${product.id}`);
    onSaved();
  };

  return (
    <Modal
      title={product.name}
      onClose={onClose}
      footer={
        <>
          <button className="quiet" onClick={() => void archive()}>Arquivar peça</button>
          <button className="ghost" onClick={onClose}>Cancelar</button>
          <button onClick={() => void save()} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <ImageUploader value={imageUrl} onChange={setImageUrl} label="Foto de capa" />

      <div className="field">
        <label>Nome</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="row">
        <div className="field">
          <label>Disponibilidade</label>
          <select
            value={availability}
            onChange={(e) => setAvailability(e.target.value as Product['availability'])}
          >
            <option value="SALE">Somente venda</option>
            <option value="RENTAL">Somente aluguel</option>
            <option value="BOTH">Venda e aluguel</option>
          </select>
        </div>
        <div className="field">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as Product['status'])}>
            <option value="DRAFT">Rascunho</option>
            <option value="PUBLISHED">Publicada no app</option>
            <option value="ARCHIVED">Arquivada</option>
          </select>
        </div>
      </div>

      <div className="row">
        {availability !== 'RENTAL' ? (
          <div className="field">
            <label>Preço de venda (R$)</label>
            <input value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
          </div>
        ) : null}
        {availability !== 'SALE' ? (
          <div className="field">
            <label>Preço de aluguel (R$)</label>
            <input value={rentalPrice} onChange={(e) => setRentalPrice(e.target.value)} />
          </div>
        ) : null}
      </div>

      <div className="row" style={{ gap: 22, marginBottom: 20 }}>
        <label className="check">
          <input
            type="checkbox"
            checked={freeShipping}
            onChange={(e) => setFreeShipping(e.target.checked)}
          />
          Frete grátis
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={isHighlighted}
            onChange={(e) => setIsHighlighted(e.target.checked)}
          />
          Destaque na vitrine
        </label>
      </div>

      <label>Estoque por tamanho</label>
      <div className="card flush" style={{ marginBottom: 8 }}>
        <table>
          <thead>
            <tr>
              <th>Tamanho</th>
              <th>Cor</th>
              <th>Venda</th>
              <th>Aluguel</th>
            </tr>
          </thead>
          <tbody>
            {product.variants.map((variant) => (
              <tr key={variant.id}>
                <td><strong>{variant.size}</strong></td>
                <td className="muted">{variant.color}</td>
                <td style={{ width: 110 }}>
                  <input
                    value={stock[variant.id]?.stock ?? ''}
                    onChange={(e) =>
                      setStock((current) => ({
                        ...current,
                        [variant.id]: {
                          stock: e.target.value,
                          rentalStock: current[variant.id]?.rentalStock ?? '0',
                        },
                      }))
                    }
                  />
                </td>
                <td style={{ width: 110 }}>
                  <input
                    value={stock[variant.id]?.rentalStock ?? ''}
                    onChange={(e) =>
                      setStock((current) => ({
                        ...current,
                        [variant.id]: {
                          stock: current[variant.id]?.stock ?? '0',
                          rentalStock: e.target.value,
                        },
                      }))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
