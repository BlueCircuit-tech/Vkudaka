import React, { useState } from 'react';
import { api, session } from '../api/client';

/**
 * Acesso ao painel (STAFF, ADMIN ou portaria).
 *
 * Composição editorial: metade foto de campanha, metade formulário sobre o
 * marfim da marca. Os campos são de linha — sem caixa — porque a marca é
 * minimalista e a tela precisa parecer moda, não um ERP.
 */
export function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await api.post<{
        accessToken: string;
        refreshToken: string;
        user: { role: string; fullName: string };
      }>('/auth/signin', { identifier, password });
      if (response.user.role === 'MEMBER') {
        setError('Esta conta é de assinante e não tem acesso ao painel.');
        return;
      }
      session.set(response.accessToken, response.refreshToken);
      session.setUser({ fullName: response.user.fullName, role: response.user.role });
      window.location.href = '/';
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <aside
        className="auth-art"
        style={{ backgroundImage: 'url(/login-art.jpg)' }}
        aria-hidden="true"
      >
        {/* A própria foto traz a frase da marca; a legenda não repete. */}
        <div className="caption">
          <span className="eyebrow">Clube de assinantes VKUDAKA</span>
        </div>
      </aside>

      <main className="auth-panel">
        <img className="brand-mark" src="/logo-preto.png" alt="VKUDAKA" />

        <h1>Painel administrativo</h1>
        <p className="lead">Gestão do clube, da coleção e dos eventos.</p>

        <form onSubmit={submit}>
          <div className="line-field">
            <label htmlFor="identifier">E-mail ou CPF</label>
            <input
              id="identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div className="line-field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error ? <p className="error" style={{ marginBottom: 18 }}>{error}</p> : null}

          <button type="submit" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="auth-foot">
          Acesso restrito à equipe VKUDAKA. Assinantes usam o aplicativo do clube.
        </p>
      </main>
    </div>
  );
}
