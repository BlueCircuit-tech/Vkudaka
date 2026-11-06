import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../lib/useApi';
import { ErrorBox, Loading, PageHead, SectionTitle } from '../components/Page';

/**
 * Pagamentos — Mercado Pago (2.6 / RN-10).
 *
 * A diretoria cola aqui as credenciais do Mercado Pago, clica em salvar, e os
 * apps (iOS e Android) passam a cobrar de verdade na hora: quem fala com o
 * gateway é o servidor, então não há nova versão nas lojas nem deploy.
 */

interface PaymentView {
  effective: {
    source: 'crm' | 'env' | 'mock' | 'none';
    provider: string;
    acceptCard: boolean;
    problem: string | null;
  };
  webhookUrl: string;
  environment: string;
  settings: {
    isEnabled: boolean;
    acceptCard: boolean;
    publicKey: string;
    accessTokenMasked: string | null;
    webhookSecretMasked: string | null;
    hasAccessToken: boolean;
    hasWebhookSecret: boolean;
    secretsUnreadable: boolean;
    credentialMode: 'test' | 'production' | null;
    recipientName: string;
    recipientDocument: string;
    recipientPixKey: string;
    updatedAt: string | null;
    updatedBy: string | null;
  };
}

interface TestResult {
  ok: boolean;
  mode: 'test' | 'production' | null;
  message?: string;
  account?: { id: number; nickname?: string; email?: string; siteId?: string };
}

const STEPS: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: 'Conta Mercado Pago da VKUDAKA',
    body: (
      <>
        Entre em <a href="https://www.mercadopago.com.br" target="_blank" rel="noreferrer">mercadopago.com.br</a>{' '}
        com a conta que vai <strong>receber</strong> o dinheiro (a da Valéria / CNPJ da VKUDAKA). Se
        ainda não existe, crie uma conta de vendedor e conclua a verificação de identidade — sem isso o
        Mercado Pago não libera credenciais de produção.
      </>
    ),
  },
  {
    title: 'Criar a aplicação',
    body: (
      <>
        Abra <a href="https://www.mercadopago.com.br/developers/panel/app" target="_blank" rel="noreferrer">Suas integrações</a>{' '}
        e clique em <strong>Criar aplicação</strong>. Nome: <em>Clube VKUDAKA</em>. Em “Qual produto você
        está integrando?”, escolha <strong>Pagamentos online → Checkout Transparente</strong>{' '}
        (também aparece como “CheckoutAPI”). Plataforma: nenhuma. Confirme.
      </>
    ),
  },
  {
    title: 'Copiar as credenciais de produção',
    body: (
      <>
        Dentro da aplicação, no menu lateral, abra <strong>Credenciais de produção</strong>. Copie a{' '}
        <strong>Public Key</strong> (começa com <code>APP_USR-</code>) e o <strong>Access Token</strong>{' '}
        (também <code>APP_USR-</code>, bem mais longo). Cole os dois no formulário ao lado. Para fazer um
        teste sem dinheiro real, use antes as <em>Credenciais de teste</em> (<code>TEST-</code>) — o
        painel aqui mostra qual tipo está salvo.
      </>
    ),
  },
  {
    title: 'Cadastrar o webhook (aviso de pagamento)',
    body: (
      <>
        Ainda na aplicação, abra <strong>Webhooks</strong> → <strong>Configurar notificações</strong>.
        Em <em>Modo produção</em>, cole a URL mostrada abaixo no campo de URL, marque o evento{' '}
        <strong>Pagamentos</strong> e salve. Depois clique em <strong>Revelar</strong> na “Assinatura
        secreta”, copie e cole no campo correspondente do formulário. Sem isso o servidor recusa todo
        aviso — é o que impede alguém de fingir que pagou.
      </>
    ),
  },
  {
    title: 'Conta recebedora e salvar',
    body: (
      <>
        Preencha nome, CPF/CNPJ e chave Pix de quem recebe (RN-10: fica registrado em cada pagamento
        para auditoria). Marque <strong>Ativar cobranças pelo Mercado Pago</strong>, clique em{' '}
        <strong>Salvar</strong> e depois em <strong>Testar conexão</strong>. A partir daí todo Pix
        gerado no app já é real.
      </>
    ),
  },
  {
    title: 'Conferir com um Pix de valor baixo',
    body: (
      <>
        No app, faça uma recarga de carteira de R$ 10. O código Pix deve ser do Mercado Pago, e ao
        pagar o saldo entra sozinho em até um minuto (é o webhook chegando). Em Pedidos o pagamento
        aparece como pago. Se não entrar, confira a URL do webhook e a assinatura secreta.
      </>
    ),
  },
];

const SOURCE_LABEL: Record<PaymentView['effective']['source'], { tag: string; cls: string; text: string }> = {
  crm: { tag: 'ativo', cls: 'tag ok dot', text: 'Os apps estão cobrando pelo Mercado Pago com as credenciais salvas aqui.' },
  env: { tag: 'ambiente', cls: 'tag gold dot', text: 'As credenciais vêm das variáveis do servidor. O que for salvo aqui passa a valer no lugar delas.' },
  mock: { tag: 'simulação', cls: 'tag dot', text: 'Nada configurado: o servidor está simulando pagamentos (só acontece em desenvolvimento).' },
  none: { tag: 'desligado', cls: 'tag danger dot', text: 'Nenhum gateway configurado. O app recusa qualquer cobrança até isto ser preenchido.' },
};

export function PaymentsPage() {
  const view = useApi<PaymentView>('/admin/payment-settings');

  if (view.error) return <ErrorBox message={view.error} />;
  if (view.loading || !view.data) return <Loading rows={6} />;

  return <PaymentsForm view={view.data} onSaved={(next) => view.setData(next)} />;
}

function PaymentsForm({ view, onSaved }: { view: PaymentView; onSaved: (next: PaymentView) => void }) {
  const s = view.settings;
  const [form, setForm] = useState({
    isEnabled: s.isEnabled,
    acceptCard: s.acceptCard,
    publicKey: s.publicKey,
    accessToken: '',
    webhookSecret: '',
    recipientName: s.recipientName,
    recipientDocument: s.recipientDocument,
    recipientPixKey: s.recipientPixKey,
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const next = await api.put<PaymentView>('/admin/payment-settings', form);
      onSaved(next);
      setForm((current) => ({ ...current, accessToken: '', webhookSecret: '' }));
      setStatus({
        kind: 'ok',
        text: next.settings.isEnabled
          ? 'Salvo. Os apps já estão cobrando pelo Mercado Pago.'
          : 'Salvo, mas as cobranças continuam desligadas — marque "Ativar" quando estiver pronta.',
      });
    } catch (caught) {
      setStatus({ kind: 'error', text: (caught as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.post<TestResult>('/admin/payment-settings/test', { accessToken: form.accessToken }));
    } catch (caught) {
      setTest({ ok: false, mode: null, message: (caught as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(view.webhookUrl);
      setCopied(true);
    } catch {
      /* navegador sem clipboard: a URL continua visível para seleção manual */
    }
  };

  const source = SOURCE_LABEL[view.effective.source];

  return (
    <>
      <PageHead
        title="Pagamentos"
        description="Integração com o Mercado Pago (Pix hoje; cartão quando o app tiver o SDK). Vale para iOS e Android ao mesmo tempo."
      />

      <div className="grid cols-2" style={{ marginBottom: 22 }}>
        <div className="card feature">
          <div className="label">Situação agora</div>
          <div className="value" style={{ fontSize: 22 }}>
            <span className={source.cls}>{source.tag}</span>
          </div>
          <div className="hint">{view.effective.problem ?? source.text}</div>
          {s.credentialMode ? (
            <div className="hint">
              Credenciais salvas:{' '}
              <strong>{s.credentialMode === 'test' ? 'de TESTE (TEST-) — nenhum dinheiro real circula' : 'de PRODUÇÃO (APP_USR-)'}</strong>
            </div>
          ) : null}
          {s.updatedAt ? (
            <div className="hint">
              Última alteração {new Date(s.updatedAt).toLocaleString('pt-BR')}
              {s.updatedBy ? ` por ${s.updatedBy}` : ''}
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="label">URL do webhook (passo 4)</div>
          <div className="webhook-url">
            <code>{view.webhookUrl}</code>
            <button type="button" className="ghost tiny" onClick={() => void copyWebhook()}>
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <div className="hint">
            Cole exatamente assim no painel do Mercado Pago, em Webhooks → Modo produção, evento “Pagamentos”.
          </div>
        </div>
      </div>

      <div className="payments-layout">
        <section>
          <SectionTitle>Passo a passo no Mercado Pago</SectionTitle>
          <ol className="steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="step-number">{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <SectionTitle>Credenciais e conta recebedora</SectionTitle>
          <form className="card" onSubmit={save}>
            {s.secretsUnreadable ? (
              <p className="error">
                As credenciais salvas ficaram ilegíveis (a chave de cifragem do servidor mudou). Cole o
                Access Token e a assinatura secreta de novo.
              </p>
            ) : null}

            <div className="field">
              <label>Access Token (produção)</label>
              <input
                value={form.accessToken}
                onChange={(e) => set('accessToken', e.target.value)}
                placeholder={s.hasAccessToken ? `salvo: ${s.accessTokenMasked} — cole outro só para trocar` : 'APP_USR-…'}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="field">
              <label>Public Key</label>
              <input
                value={form.publicKey}
                onChange={(e) => set('publicKey', e.target.value)}
                placeholder="APP_USR-…"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="hint">Não é segredo: vai para o app quando o pagamento com cartão for habilitado.</p>
            </div>

            <div className="field">
              <label>Assinatura secreta do webhook</label>
              <input
                value={form.webhookSecret}
                onChange={(e) => set('webhookSecret', e.target.value)}
                placeholder={s.hasWebhookSecret ? `salva: ${s.webhookSecretMasked} — cole outra só para trocar` : 'copiada em Webhooks → Revelar'}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="row">
              <div className="field">
                <label>Nome de quem recebe</label>
                <input value={form.recipientName} onChange={(e) => set('recipientName', e.target.value)} />
              </div>
              <div className="field">
                <label>CPF ou CNPJ</label>
                <input
                  value={form.recipientDocument}
                  onChange={(e) => set('recipientDocument', e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="field">
              <label>Chave Pix da conta recebedora</label>
              <input value={form.recipientPixKey} onChange={(e) => set('recipientPixKey', e.target.value)} />
            </div>

            <div className="field">
              <label className="check">
                <input type="checkbox" checked={form.isEnabled} onChange={(e) => set('isEnabled', e.target.checked)} />
                Ativar cobranças pelo Mercado Pago nos apps
              </label>
            </div>
            <div className="field">
              <label className="check">
                <input type="checkbox" checked={form.acceptCard} onChange={(e) => set('acceptCard', e.target.checked)} />
                Oferecer cartão de crédito além do Pix
              </label>
              <p className="hint">
                Deixe desmarcado por enquanto: o cartão exige o SDK do Mercado Pago dentro do app
                (versão nova nas lojas). Até lá, com isto marcado o app mostraria o botão e a cobrança
                falharia.
              </p>
            </div>

            {status ? <p className={status.kind === 'error' ? 'error' : 'success'}>{status.text}</p> : null}

            {test ? (
              <p className={test.ok ? 'success' : 'error'}>
                {test.ok
                  ? `Conectado: conta ${test.account?.nickname ?? test.account?.id}${test.account?.email ? ` (${test.account.email})` : ''}${test.mode === 'test' ? ' — credencial de TESTE' : ''}.`
                  : `Falhou: ${test.message ?? 'token recusado pelo Mercado Pago.'}`}
              </p>
            ) : null}

            <div className="form-actions">
              <button type="button" className="ghost" onClick={() => void runTest()} disabled={testing}>
                {testing ? 'Testando…' : 'Testar conexão'}
              </button>
              <button type="submit" disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
