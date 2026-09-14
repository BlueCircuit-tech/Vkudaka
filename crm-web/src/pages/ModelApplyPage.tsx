import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

/**
 * Formulário público de cadastro de modelos (3.5).
 *
 * Rota aberta, sem login: é o link divulgado para as candidatas. Substitui o
 * Google Forms porque grava direto no CRM — sem exportação nem digitação.
 *
 * Com `?convite=<token>` na URL, o formulário é o link pessoal gerado no CRM:
 * cumprimenta pelo nome, pré-preenche o contato e, ao enviar, completa a ficha
 * que a equipe abriu — em vez de criar outra.
 */

const inviteToken = new URLSearchParams(window.location.search).get('convite');

const emptyForm = {
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
  portfolioUrl: '',
};

export function ModelApplyPage() {
  const [form, setForm] = useState(emptyForm);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [invite, setInvite] = useState<'none' | 'loading' | 'ok' | 'used' | 'invalid'>(
    inviteToken ? 'loading' : 'none',
  );

  useEffect(() => {
    if (!inviteToken) return;
    api
      .get<{ fullName: string; email: string | null; phone: string | null; instagram: string | null; used: boolean }>(
        `/models/invite/${encodeURIComponent(inviteToken)}`,
      )
      .then((data) => {
        if (data.used) {
          setInvite('used');
          return;
        }
        setForm((current) => ({
          ...current,
          fullName: data.fullName,
          email: data.email ?? '',
          phone: data.phone ?? '',
          instagram: data.instagram ?? '',
        }));
        setInvite('ok');
      })
      .catch(() => setInvite('invalid'));
  }, []);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: event.target.value });

  const numeric = (value: string) => (value ? Number(value.replace(/\D/g, '')) : undefined);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api.post('/models/apply', {
        fullName: form.fullName,
        birthDate: form.birthDate || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        instagram: form.instagram || undefined,
        city: form.city || undefined,
        state: form.state ? form.state.toUpperCase() : undefined,
        dressSize: form.dressSize || undefined,
        shoeSize: form.shoeSize || undefined,
        heightCm: numeric(form.heightCm),
        bustCm: numeric(form.bustCm),
        waistCm: numeric(form.waistCm),
        hipsCm: numeric(form.hipsCm),
        portfolioUrl: form.portfolioUrl || undefined,
        source: 'form',
        inviteToken: invite === 'ok' ? inviteToken : undefined,
      });
      setSent(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="auth">
        <aside
          className="auth-art"
          style={{ backgroundImage: 'url(/apply-art.jpg)' }}
          aria-hidden="true"
        >
          <div className="caption">
            <span className="eyebrow">Casting</span>
            <blockquote>Moda com essência</blockquote>
          </div>
        </aside>
        <main className="auth-panel">
          <img className="brand-mark" src="/logo-preto.png" alt="VKUDAKA" />
          <h1>Cadastro recebido</h1>
          <p className="lead">
            Obrigado, {form.fullName.split(' ')[0]}. A equipe VKUDAKA analisa as candidaturas e entra
            em contato pelos dados informados.
          </p>
        </main>
      </div>
    );
  }

  if (invite === 'used' || invite === 'invalid') {
    return (
      <div className="public-page">
        <header className="public-hero">
          <img src="/logo-preto.png" alt="VKUDAKA — moda com essência" />
          <h1>{invite === 'used' ? 'Este link já foi usado' : 'Link inválido'}</h1>
          <p>
            {invite === 'used'
              ? 'O cadastro deste convite já foi enviado. Se precisar alterar algo, fale com a equipe VKUDAKA.'
              : 'Não encontramos este convite. Peça um novo link para a equipe VKUDAKA.'}
          </p>
        </header>
      </div>
    );
  }

  return (
    <div className="public-page">
      <header className="public-hero">
        <img src="/logo-preto.png" alt="VKUDAKA — moda com essência" />
        <span className="eyebrow">Clube de assinantes VKUDAKA</span>
        <h1>{invite === 'ok' ? `Olá, ${form.fullName.split(' ')[0]}` : 'Cadastro de modelos'}</h1>
        <p>
          {invite === 'ok'
            ? 'A equipe VKUDAKA abriu sua ficha. Confira seus dados e complete as medidas.'
            : 'Preencha seus dados e medidas. A equipe entra em contato para os próximos passos.'}
        </p>
      </header>

      <form className="card" onSubmit={submit}>
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Nome completo *</label>
            <input value={form.fullName} onChange={set('fullName')} required />
          </div>
          <div className="field">
            <label>Data de nascimento</label>
            <input type="date" value={form.birthDate} onChange={set('birthDate')} />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>E-mail</label>
            <input type="email" value={form.email} onChange={set('email')} />
          </div>
          <div className="field">
            <label>Celular</label>
            <input value={form.phone} onChange={set('phone')} />
          </div>
          <div className="field">
            <label>Instagram</label>
            <input value={form.instagram} onChange={set('instagram')} placeholder="sem o @" />
          </div>
        </div>

        <div className="row">
          <div className="field" style={{ flex: 3 }}>
            <label>Cidade</label>
            <input value={form.city} onChange={set('city')} />
          </div>
          <div className="field" style={{ maxWidth: 110 }}>
            <label>UF</label>
            <input maxLength={2} value={form.state} onChange={set('state')} />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Manequim</label>
            <input value={form.dressSize} onChange={set('dressSize')} />
          </div>
          <div className="field">
            <label>Calçado</label>
            <input value={form.shoeSize} onChange={set('shoeSize')} />
          </div>
          <div className="field">
            <label>Altura (cm)</label>
            <input value={form.heightCm} onChange={set('heightCm')} />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Busto (cm)</label>
            <input value={form.bustCm} onChange={set('bustCm')} />
          </div>
          <div className="field">
            <label>Cintura (cm)</label>
            <input value={form.waistCm} onChange={set('waistCm')} />
          </div>
          <div className="field">
            <label>Quadril (cm)</label>
            <input value={form.hipsCm} onChange={set('hipsCm')} />
          </div>
        </div>

        <div className="field">
          <label>Portfólio (link)</label>
          <input value={form.portfolioUrl} onChange={set('portfolioUrl')} placeholder="https://" />
        </div>

        {error ? <p className="error" style={{ marginBottom: 16 }}>{error}</p> : null}

        <button type="submit" disabled={sending || invite === 'loading'}>
          {sending ? 'Enviando…' : 'Enviar cadastro'}
        </button>

        <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
          Seus dados são usados apenas para o processo de seleção da VKUDAKA.
        </p>
      </form>
    </div>
  );
}
