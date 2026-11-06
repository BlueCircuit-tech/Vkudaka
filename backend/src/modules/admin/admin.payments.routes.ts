import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/http.js';
import { badRequest } from '../../lib/errors.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { decryptSecret, encryptSecret, maskSecret, SecretUnreadableError } from '../../lib/secrets.js';
import { getPaymentConfig, invalidatePaymentConfig } from '../../integrations/payments/settings.js';
import { describeAccount, MercadoPagoApiError } from '../../integrations/payments/mercadopago.js';

/**
 * Tela "Pagamentos" do CRM — configuração do Mercado Pago sem abrir código.
 *
 * Só ADMIN. Os segredos nunca voltam inteiros para o navegador: a leitura
 * devolve o final mascarado, e no salvamento um campo vazio significa
 * "mantenha o que já está" — a diretoria não precisa colar tudo de novo para
 * mudar a chave Pix.
 */
export const adminPaymentsRouter: Router = Router();

adminPaymentsRouter.use(authenticate, requireRole('ADMIN'));

const onlyDigits = (value: string) => value.replace(/\D/g, '');

const webhookUrl = () => `${env.API_PUBLIC_URL}/webhooks/payments`;

/** Credenciais de teste do Mercado Pago começam com TEST-; as reais com APP_USR-. */
const credentialMode = (token: string | null | undefined): 'test' | 'production' | null => {
  if (!token) return null;
  if (token.startsWith('TEST-')) return 'test';
  if (token.startsWith('APP_USR-')) return 'production';
  return null;
};

async function readSecret(stored: string | null): Promise<{ value: string | null; unreadable: boolean }> {
  if (!stored) return { value: null, unreadable: false };
  try {
    return { value: decryptSecret(stored), unreadable: false };
  } catch (error) {
    if (error instanceof SecretUnreadableError) return { value: null, unreadable: true };
    throw error;
  }
}

async function view() {
  const row = await prisma.paymentSettings.findUnique({ where: { id: 'default' } });
  const effective = await getPaymentConfig();
  const token = await readSecret(row?.accessTokenEnc ?? null);
  const secret = await readSecret(row?.webhookSecretEnc ?? null);
  const updatedBy = row?.updatedById
    ? await prisma.user.findUnique({ where: { id: row.updatedById }, select: { fullName: true } })
    : null;

  return {
    /** De onde o servidor está cobrando AGORA. */
    effective: {
      source: effective.source,
      provider: effective.provider,
      acceptCard: effective.acceptCard,
      problem: effective.problem ?? null,
    },
    webhookUrl: webhookUrl(),
    environment: env.NODE_ENV,
    settings: {
      provider: row?.provider ?? 'mercadopago',
      isEnabled: row?.isEnabled ?? false,
      acceptCard: row?.acceptCard ?? false,
      publicKey: row?.publicKey ?? '',
      accessTokenMasked: maskSecret(token.value),
      webhookSecretMasked: maskSecret(secret.value),
      hasAccessToken: Boolean(row?.accessTokenEnc),
      hasWebhookSecret: Boolean(row?.webhookSecretEnc),
      secretsUnreadable: token.unreadable || secret.unreadable,
      credentialMode: credentialMode(token.value),
      recipientName: row?.recipientName ?? '',
      recipientDocument: row?.recipientDocument ?? '',
      recipientPixKey: row?.recipientPixKey ?? '',
      updatedAt: row?.updatedAt ?? null,
      updatedBy: updatedBy?.fullName ?? null,
    },
  };
}

adminPaymentsRouter.get(
  '/payment-settings',
  asyncHandler(async (_req, res) => {
    res.json(await view());
  }),
);

const saveSchema = z.object({
  isEnabled: z.boolean(),
  acceptCard: z.boolean().default(false),
  publicKey: z.string().trim().max(120).default(''),
  /** Vazio = manter o que já está salvo. */
  accessToken: z.string().trim().max(400).default(''),
  webhookSecret: z.string().trim().max(200).default(''),
  recipientName: z.string().trim().max(160).default(''),
  recipientDocument: z.string().trim().max(20).default(''),
  recipientPixKey: z.string().trim().max(120).default(''),
});

adminPaymentsRouter.put(
  '/payment-settings',
  validate(saveSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof saveSchema>;
    const current = await prisma.paymentSettings.findUnique({ where: { id: 'default' } });

    const accessTokenEnc = body.accessToken ? encryptSecret(body.accessToken) : current?.accessTokenEnc ?? null;
    const webhookSecretEnc = body.webhookSecret
      ? encryptSecret(body.webhookSecret)
      : current?.webhookSecretEnc ?? null;
    const document = onlyDigits(body.recipientDocument);

    if (body.isEnabled) {
      const missing: string[] = [];
      if (!accessTokenEnc) missing.push('Access Token');
      if (!webhookSecretEnc) missing.push('assinatura secreta do webhook');
      if (!body.recipientName) missing.push('nome do recebedor');
      if (!document) missing.push('CPF/CNPJ do recebedor');
      if (!body.recipientPixKey) missing.push('chave Pix do recebedor');
      if (missing.length > 0) {
        throw badRequest('PAYMENT_SETTINGS_INCOMPLETE', `Para ativar, preencha: ${missing.join(', ')}.`);
      }
      if (document.length !== 11 && document.length !== 14) {
        throw badRequest('INVALID_DOCUMENT', 'CPF precisa de 11 dígitos e CNPJ de 14.');
      }
      if (body.accessToken && credentialMode(body.accessToken) === null) {
        throw badRequest(
          'INVALID_ACCESS_TOKEN',
          'O Access Token do Mercado Pago começa com APP_USR- (produção) ou TEST- (teste).',
        );
      }
    }

    const data = {
      provider: 'mercadopago',
      isEnabled: body.isEnabled,
      acceptCard: body.acceptCard,
      publicKey: body.publicKey || null,
      accessTokenEnc,
      webhookSecretEnc,
      recipientName: body.recipientName || null,
      recipientDocument: document || null,
      recipientPixKey: body.recipientPixKey || null,
      updatedById: req.auth!.userId,
    };

    await prisma.paymentSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data },
      update: data,
    });
    invalidatePaymentConfig();

    // Decisão financeira: fica auditado, sem os segredos.
    await prisma.auditLog.create({
      data: {
        actorId: req.auth!.userId,
        action: 'payment.settings',
        entity: 'PaymentSettings',
        entityId: 'default',
        before: current
          ? { isEnabled: current.isEnabled, acceptCard: current.acceptCard, recipientDocument: current.recipientDocument }
          : undefined,
        after: {
          isEnabled: body.isEnabled,
          acceptCard: body.acceptCard,
          recipientDocument: document || null,
          accessTokenChanged: Boolean(body.accessToken),
          webhookSecretChanged: Boolean(body.webhookSecret),
        },
        ip: req.ip,
      },
    });

    res.json(await view());
  }),
);

/**
 * "Testar conexão": pergunta ao Mercado Pago de quem é o token. Usa o token
 * colado no formulário (ainda não salvo) ou, sem ele, o que está gravado.
 */
adminPaymentsRouter.post(
  '/payment-settings/test',
  validate(z.object({ accessToken: z.string().trim().max(400).default('') })),
  asyncHandler(async (req, res) => {
    const { accessToken } = req.body as { accessToken: string };
    let token = accessToken;
    if (!token) {
      const row = await prisma.paymentSettings.findUnique({ where: { id: 'default' } });
      token = (await readSecret(row?.accessTokenEnc ?? null)).value ?? '';
    }
    if (!token) throw badRequest('ACCESS_TOKEN_MISSING', 'Cole o Access Token para testar.');

    try {
      const account = await describeAccount(token);
      res.json({ ok: true, mode: credentialMode(token), account });
    } catch (error) {
      if (error instanceof MercadoPagoApiError) {
        res.json({ ok: false, mode: credentialMode(token), message: error.message });
        return;
      }
      throw error;
    }
  }),
);
