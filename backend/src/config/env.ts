import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Carrega o `.env` local sem dependência externa (Node >= 20.12).
 * Em produção as variáveis vêm do orquestrador/secret manager e não há arquivo:
 * a ausência é normal e não deve derrubar o boot aqui — quem valida é o schema
 * abaixo.
 */
try {
  process.loadEnvFile?.(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  /* sem arquivo .env: segue com as variáveis já presentes no ambiente */
}

/**
 * Validação das variáveis de ambiente no boot. Falha rápido: é preferível o
 * container não subir a descobrir em produção que o gateway está sem chave.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  API_PUBLIC_URL: z.string().url().default('http://localhost:3333'),

  // RN-01 — destino do usuário sem assinatura
  EXTERNAL_STORE_URL: z.string().url(),
  CLUB_WHATSAPP_URL: z.string().url(),
  CLUB_INSTAGRAM_URL: z.string().url(),
  /** Site público (Vercel): página de retorno depois do pagamento do plano. */
  PUBLIC_WEB_URL: z.string().url().default('https://vkudaka.vercel.app'),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de ao menos 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_EXPIRES_IN: z.string().default('30d'),
  TICKET_HMAC_SECRET: z.string().min(16),

  /**
   * `crm` (padrão): o gateway é configurado pela diretoria na tela
   * "Pagamentos" do CRM e lido do banco — sem variável de ambiente, sem deploy.
   * Os demais valores mantêm o caminho antigo, por ambiente.
   */
  PAYMENT_PROVIDER: z.enum(['crm', 'mock', 'mercadopago', 'pagarme', 'asaas']).default('crm'),
  PAYMENT_API_KEY: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  /** Cifra os segredos salvos pelo CRM. Na falta, deriva do JWT_SECRET. */
  SETTINGS_ENCRYPTION_KEY: z.string().min(16).optional(),

  // RN-10 — conta recebedora. Obrigatória em produção.
  PAYMENT_RECIPIENT_NAME: z.string().optional(),
  PAYMENT_RECIPIENT_DOCUMENT: z.string().optional(),
  PAYMENT_RECIPIENT_BANK: z.string().optional(),
  PAYMENT_RECIPIENT_AGENCY: z.string().optional(),
  PAYMENT_RECIPIENT_ACCOUNT: z.string().optional(),
  PAYMENT_RECIPIENT_PIX_KEY: z.string().optional(),

  CORREIOS_PROVIDER: z.enum(['mock', 'table', 'correios', 'melhorenvio']).default('mock'),
  CORREIOS_USER: z.string().optional(),
  CORREIOS_PASSWORD: z.string().optional(),
  CORREIOS_ORIGIN_ZIP: z.string().length(8).default('01310100'),
  LABEL_PROVIDER: z.enum(['mock', 'none', 'melhorenvio', 'nuvemshop']).default('mock'),

  PUSH_PROVIDER: z.enum(['expo', 'fcm', 'mock']).default('mock'),
  EXPO_ACCESS_TOKEN: z.string().optional(),

  STORAGE_PROVIDER: z.enum(['local', 'supabase']).default('local'),
  STORAGE_BUCKET: z.string().default('media'),
  SUPABASE_URL: z.string().url().optional(),
  // service_role: usada só no servidor para gravar no bucket. Nunca vai ao app.
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('✖ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

const fail = (message: string): never => {
  console.error(`✖ ${message}`);
  process.exit(1);
};

/**
 * RN-10 — em produção o dinheiro precisa ter para onde ir.
 * Com PAYMENT_PROVIDER=crm a conta recebedora é preenchida (e validada) na
 * tela "Pagamentos" do CRM; o boot não tem como conferir sem o banco, e a
 * cobrança já recusa sozinha enquanto a tela não estiver completa.
 */
if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER !== 'crm') {
  const missing = (
    ['PAYMENT_RECIPIENT_NAME', 'PAYMENT_RECIPIENT_DOCUMENT', 'PAYMENT_RECIPIENT_PIX_KEY'] as const
  ).filter((key) => !env[key]);
  if (missing.length > 0) {
    fail(`RN-10: conta recebedora não configurada (${missing.join(', ')})`);
  }
}

/**
 * Modo Supabase exige URL e service_role. Sem elas o upload falha só na primeira
 * foto enviada — melhor o boot parar e dizer o que falta.
 */
if (env.STORAGE_PROVIDER === 'supabase') {
  const missingStorage = (
    [
      ['SUPABASE_URL', env.SUPABASE_URL],
      ['SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingStorage.length > 0) {
    fail(`STORAGE_PROVIDER=supabase sem ${missingStorage.join(', ')}.`);
  }
}

/**
 * Simulações não sobem fora de desenvolvimento.
 *
 * Cada `mock` responde "deu certo" sem falar com ninguém. Em homologação isso é
 * pior do que uma falha: a equipe testa um fluxo que parece funcionar, aprova, e
 * o problema aparece com dinheiro real na frente. Por isso a lista é conferida
 * uma a uma e o boot para, dizendo qual variável está simulando o quê.
 */
const SIMULATED = [
  ['PAYMENT_PROVIDER', env.PAYMENT_PROVIDER, 'cobrança de Pix e cartão'],
  ['CORREIOS_PROVIDER', env.CORREIOS_PROVIDER, 'cotação de frete'],
  ['LABEL_PROVIDER', env.LABEL_PROVIDER, 'etiqueta e declaração de conteúdo'],
  ['PUSH_PROVIDER', env.PUSH_PROVIDER, 'envio de notificação'],
] as const;

const simulating = SIMULATED.filter(([, value]) => value === 'mock');

if (env.NODE_ENV !== 'development' && simulating.length > 0) {
  fail(
    ['Provedores simulados não são permitidos fora de desenvolvimento:']
      .concat(simulating.map(([key, , what]) => `   ${key}=mock — ${what}`))
      .join('\n'),
  );
}

/**
 * Provedor real escolhido exige credencial. Falhar aqui é melhor do que
 * descobrir na primeira cobrança que a chave nunca foi preenchida.
 *
 * Em desenvolvimento vira aviso: quem está escrevendo o adapter precisa subir o
 * servidor antes de ter as chaves em mãos, e a cobrança já falha sozinha na
 * chamada, com a mensagem certa.
 */
if (env.PAYMENT_PROVIDER !== 'mock' && env.PAYMENT_PROVIDER !== 'crm') {
  const missingCredentials = (
    [
      ['PAYMENT_API_KEY', env.PAYMENT_API_KEY],
      ['PAYMENT_WEBHOOK_SECRET', env.PAYMENT_WEBHOOK_SECRET],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingCredentials.length > 0) {
    const message =
      `PAYMENT_PROVIDER=${env.PAYMENT_PROVIDER} sem ${missingCredentials.join(' e ')}. ` +
      'Sem o segredo do webhook não há como distinguir um aviso do gateway de um POST ' +
      'forjado. Ver docs/INTEGRACOES.md § 1.';
    if (env.NODE_ENV === 'development') console.warn(`⚠ ${message}`);
    else fail(message);
  }
}

if (simulating.length > 0) {
  console.warn(
    ['⚠ Desenvolvimento com provedor simulado:']
      .concat(simulating.map(([key, , what]) => `   ${key}=mock — ${what} não acontece de verdade`))
      .join('\n'),
  );
}

export const isProd = env.NODE_ENV === 'production';
