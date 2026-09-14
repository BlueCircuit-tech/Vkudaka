import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHead } from '../components/Page';

/**
 * Textos do app (2.3).
 *
 * O popup de regras de compra é editado aqui. É a diretoria quem escreve; o
 * app lê a versão publicada na hora em que o cliente toca em "Comprar", sem
 * necessidade de nova versão nas lojas.
 */

const KEYS = [
  { key: 'purchase_rules', label: 'Regras de compra', hint: 'Exibido no popup ao tocar em "Comprar".' },
  { key: 'rental_rules', label: 'Regras de aluguel', hint: 'Exibido no popup ao tocar em "Alugar".' },
  {
    key: 'rebate_rules',
    label: 'Como funciona o abatimento',
    hint: 'Exibido na Carteira do app. O cálculo em si vem dos planos — este é só o texto explicativo.',
  },
] as const;

interface Content {
  key: string;
  title: string | null;
  body: string;
  version: number;
}

export function ContentPage() {
  const [activeKey, setActiveKey] = useState<(typeof KEYS)[number]['key']>('purchase_rules');
  const [content, setContent] = useState<Content | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setStatus(null);
    api
      .get<Content>(`/content/${activeKey}`)
      .then((data) => {
        setContent(data);
        setTitle(data.title ?? '');
        setBody(data.body);
      })
      .catch(() => {
        setContent(null);
        setTitle('');
        setBody('');
      });
  }, [activeKey]);

  const save = async () => {
    setStatus(null);
    try {
      const saved = await api.put<Content>(`/admin/content/${activeKey}`, { title, body });
      setContent(saved);
      setStatus(`Publicado. Versão ${saved.version} já está valendo no app.`);
    } catch (caught) {
      setStatus((caught as Error).message);
    }
  };

  const current = KEYS.find((item) => item.key === activeKey);

  return (
    <>
      <PageHead
        title="Textos do app"
        description="Conteúdos editáveis pela diretoria, publicados sem nova versão nas lojas."
      />

      <div className="tabs">
        {KEYS.map((item) => (
          <button
            key={item.key}
            className={activeKey === item.key ? 'active' : ''}
            onClick={() => setActiveKey(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {current?.hint}
          {content ? ` · versão atual: ${content.version}` : ' · ainda não publicado'}
        </p>

        <div className="field">
          <label>Título do popup</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="field">
          <label>Texto</label>
          <textarea rows={16} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>

        {status ? <p className="muted">{status}</p> : null}
        <button onClick={() => void save()} disabled={!body.trim()}>
          Publicar no app
        </button>
      </div>
    </>
  );
}
