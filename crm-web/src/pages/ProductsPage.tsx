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
  colorHex?: string | null;
  sku: string;
  stock: number;
  rentalStock: number;
}

/** Grades de tamanho da loja: letras e numeração podem ser combinadas na mesma peça. */
const SIZE_GRID: Array<{ label: string; sizes: string[] }> = [
  { label: 'Letras', sizes: ['PP', 'P', 'M', 'G', 'GG', 'G1'] },
  { label: 'Numeração', sizes: ['36', '38', '40', '42', '44', '46'] },
];
const ALL_GRID_SIZES = SIZE_GRID.flatMap((g) => g.sizes);

interface ColorDraft {
  name: string;
  /** Amostra opcional (#rrggbb); null = sem amostra. */
  hex: string | null;
}

const parseExtraSizes = (value: string) =>
  value.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

/** SKU da variante: tamanho (e cor, quando há mais de uma) sufixados ao SKU da peça, dentro dos 50 chars da API. */
const variantSku = (base: string, size: string, color: string, multiColor: boolean) => {
  const suffix = multiColor
    ? `-${slugify(size)}-${slugify(color).slice(0, 10)}`.toUpperCase()
    : `-${slugify(size)}`.toUpperCase();
  return `${base.slice(0, 50 - suffix.length)}${suffix}`;
};

/** Chips clicáveis das duas grades de tamanho, mais campo livre para tamanhos fora da grade (ex.: U, 48). */
function SizePicker({
  selected,
  extra,
  onToggle,
  onExtra,
}: {
  selected: string[];
  extra: string;
  onToggle: (size: string) => void;
  onExtra: (value: string) => void;
}) {
  return (
    <div className="field">
      <label>Tamanhos</label>
      {SIZE_GRID.map((group) => (
        <div className="chips" key={group.label}>
          <span className="chips-label">{group.label}</span>
          {group.sizes.map((size) => {
            const on = selected.includes(size);
            return (
              <button
                type="button"
                key={size}
                className={`chip${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => onToggle(size)}
              >
                {size}
              </button>
            );
          })}
        </div>
      ))}
      <input
        value={extra}
        onChange={(e) => onExtra(e.target.value)}
        placeholder="Outros tamanhos (ex.: U, 34, 48) — separados por vírgula"
      />
    </div>
  );
}

/** Lista de cores da peça: nome obrigatório, amostra de cor opcional. */
function ColorList({
  colors,
  onChange,
}: {
  colors: ColorDraft[];
  onChange: (colors: ColorDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<ColorDraft>) =>
    onChange(colors.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const remove = (index: number) => onChange(colors.filter((_, i) => i !== index));

  return (
    <div className="field">
      <label>Cores</label>
      {colors.map((color, index) => (
        <div className="color-row" key={index}>
          <input
            type="color"
            className="swatch-input"
            title={color.hex ? 'Amostra da cor' : 'Escolher amostra (opcional)'}
            value={color.hex ?? '#d9cfc2'}
            onChange={(e) => update(index, { hex: e.target.value })}
          />
          <input
            value={color.name}
            onChange={(e) => update(index, { name: e.target.value })}
            placeholder={index === 0 ? 'Ex.: Preto (ou Único)' : 'Nome da cor'}
            maxLength={40}
          />
          {color.hex ? (
            <button
              type="button"
              className="ghost tiny"
              title="Remover amostra"
              onClick={() => update(index, { hex: null })}
            >
              sem amostra
            </button>
          ) : null}
          <button
            type="button"
            className="quiet tiny"
            onClick={() => remove(index)}
            disabled={colors.length === 1}
            title="Remover cor"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ghost tiny"
        onClick={() => onChange([...colors, { name: '', hex: null }])}
      >
        + Adicionar cor
      </button>
    </div>
  );
}

/** Mostra a cor da variante com a amostra, quando cadastrada. */
function ColorCell({ color, hex }: { color: string; hex?: string | null }) {
  return (
    <span className="color-cell">
      {hex ? <span className="swatch" style={{ background: hex }} /> : null}
      {color}
    </span>
  );
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
    sizes: ['36', '38', '40', '42'] as string[],
    extraSizes: '',
    colors: [{ name: 'Único', hex: null }] as ColorDraft[],
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
    const sizes = Array.from(new Set([...form.sizes, ...parseExtraSizes(form.extraSizes)]));
    const colors = form.colors.map((c) => ({ ...c, name: c.name.trim() })).filter((c) => c.name);
    const colorNames = new Set(colors.map((c) => c.name.toLowerCase()));

    if (sizes.length === 0) {
      setError('Selecione pelo menos um tamanho.');
      setSaving(false);
      return;
    }
    if (colors.length === 0) {
      setError('Informe pelo menos uma cor (use "Único" se a peça não tem variação).');
      setSaving(false);
      return;
    }
    if (colorNames.size !== colors.length) {
      setError('Há cores repetidas na lista.');
      setSaving(false);
      return;
    }

    const multiColor = colors.length > 1;
    const stock = Number(form.stockPerSize) || 0;

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
        variants: colors.flatMap((color) =>
          sizes.map((size) => ({
            size,
            color: color.name,
            colorHex: color.hex ?? undefined,
            sku: variantSku(sku, size, color.name, multiColor),
            stock: form.availability !== 'RENTAL' ? stock : 0,
            rentalStock: form.availability !== 'SALE' ? stock : 0,
          })),
        ),
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

        <SizePicker
          selected={form.sizes}
          extra={form.extraSizes}
          onToggle={(size) =>
            set(
              'sizes',
              form.sizes.includes(size) ? form.sizes.filter((s) => s !== size) : [...form.sizes, size],
            )
          }
          onExtra={(value) => set('extraSizes', value)}
        />

        <ColorList colors={form.colors} onChange={(colors) => set('colors', colors)} />

        <div className="row">
          <div className="field">
            <label>Estoque inicial por tamanho e cor</label>
            <input
              value={form.stockPerSize}
              onChange={(e) => set('stockPerSize', e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div className="field">
            <label>Variantes a criar</label>
            <input
              readOnly
              value={`${Array.from(new Set([...form.sizes, ...parseExtraSizes(form.extraSizes)])).length} tamanho(s) × ${form.colors.filter((c) => c.name.trim()).length} cor(es)`}
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
  const [variants, setVariants] = useState<Variant[]>(product.variants);
  const [stock, setStock] = useState<Record<string, { stock: string; rentalStock: string }>>(
    Object.fromEntries(
      product.variants.map((v) => [v.id, { stock: String(v.stock), rentalStock: String(v.rentalStock) }]),
    ),
  );
  const [newVariant, setNewVariant] = useState<{ size: string; customSize: string; color: string; hex: string | null }>({
    size: ALL_GRID_SIZES[0] ?? '36',
    customSize: '',
    color: '',
    hex: null,
  });
  const [addingVariant, setAddingVariant] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const addVariant = async () => {
    const size = (newVariant.size === '__other' ? newVariant.customSize : newVariant.size).trim().toUpperCase();
    const color = newVariant.color.trim();
    if (!size) return setError('Informe o tamanho da nova variante.');
    if (!color) return setError('Informe a cor da nova variante.');
    if (variants.some((v) => v.size.toUpperCase() === size && v.color.toLowerCase() === color.toLowerCase())) {
      return setError(`A variante ${size} / ${color} já existe nesta peça.`);
    }
    setAddingVariant(true);
    setError(null);
    try {
      const multiColor = new Set([...variants.map((v) => v.color.toLowerCase()), color.toLowerCase()]).size > 1;
      const created = await api.post<Variant>(`/admin/products/${product.id}/variants`, {
        size,
        color,
        colorHex: newVariant.hex ?? undefined,
        sku: variantSku(product.sku, size, color, multiColor),
        stock: 0,
        rentalStock: 0,
      });
      setVariants((current) => [...current, created]);
      setStock((current) => ({ ...current, [created.id]: { stock: '0', rentalStock: '0' } }));
      setNewVariant((current) => ({ ...current, customSize: '' }));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setAddingVariant(false);
    }
  };

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
      for (const variant of variants) {
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

      <label>Estoque por tamanho e cor</label>
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
            {variants.map((variant) => (
              <tr key={variant.id}>
                <td><strong>{variant.size}</strong></td>
                <td className="muted"><ColorCell color={variant.color} hex={variant.colorHex} /></td>
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

      <label>Adicionar tamanho ou cor</label>
      <div className="row add-variant">
        <div className="field" style={{ minWidth: 120 }}>
          <select
            value={newVariant.size}
            onChange={(e) => setNewVariant((c) => ({ ...c, size: e.target.value }))}
          >
            {SIZE_GRID.map((group) => (
              <optgroup label={group.label} key={group.label}>
                {group.sizes.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </optgroup>
            ))}
            <option value="__other">Outro…</option>
          </select>
        </div>
        {newVariant.size === '__other' ? (
          <div className="field" style={{ minWidth: 100 }}>
            <input
              value={newVariant.customSize}
              onChange={(e) => setNewVariant((c) => ({ ...c, customSize: e.target.value }))}
              placeholder="Ex.: U, 48"
              maxLength={12}
            />
          </div>
        ) : null}
        <div className="field color-row" style={{ flex: 2 }}>
          <input
            type="color"
            className="swatch-input"
            value={newVariant.hex ?? '#d9cfc2'}
            onChange={(e) => setNewVariant((c) => ({ ...c, hex: e.target.value }))}
            title="Amostra (opcional)"
          />
          <input
            value={newVariant.color}
            onChange={(e) => setNewVariant((c) => ({ ...c, color: e.target.value }))}
            placeholder="Cor (ex.: Preto)"
            maxLength={40}
            list={`colors-${product.id}`}
          />
          <datalist id={`colors-${product.id}`}>
            {Array.from(new Set(variants.map((v) => v.color))).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="field" style={{ flex: '0 0 auto', minWidth: 0 }}>
          <button type="button" className="ghost" onClick={() => void addVariant()} disabled={addingVariant}>
            {addingVariant ? 'Adicionando…' : 'Adicionar'}
          </button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
        A nova variante entra com estoque zero; ajuste acima e clique em Salvar.
      </p>

      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
