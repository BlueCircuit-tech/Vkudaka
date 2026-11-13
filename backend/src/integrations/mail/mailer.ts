import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

/**
 * E-mail transacional (2026-11-12) — hoje só o código de "Esqueci a senha".
 *
 * Envia pela API do Brevo quando BREVO_API_KEY existe (produção: o Render
 * gratuito bloqueia SMTP); senão, pelo SMTP do ambiente (Gmail com senha de app).
 * Sem SMTP, só um servidor local (localhost) joga o e-mail no console; em
 * qualquer servidor publicado a falta de configuração é erro — o cliente não
 * pode ficar esperando um código que nunca vai chegar.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: Transporter | null = null;

const configured = () => Boolean(env.SMTP_USER && env.SMTP_PASS);

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      // Falha rápido: com a porta bloqueada (ex.: plano gratuito do Render),
      // o padrão do nodemailer deixava o cliente esperando 2 minutos.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

/** Brevo — API transacional por HTTPS (porta 443, liberada no Render gratuito). */
async function sendWithBrevo(message: MailMessage): Promise<void> {
  const senderEmail = env.MAIL_SENDER_EMAIL ?? env.SMTP_USER;
  if (!senderEmail) {
    throw new AppError(503, 'MAIL_NOT_CONFIGURED', 'Remetente do e-mail não configurado (MAIL_SENDER_EMAIL).');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY!,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: env.MAIL_SENDER_NAME, email: senderEmail },
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Brevo HTTP ${response.status}: ${detail.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMail(message: MailMessage): Promise<void> {
  if (env.BREVO_API_KEY) return sendWithBrevo(message);
  if (!configured()) {
    // Só na máquina de quem desenvolve: o Render ainda roda em
    // NODE_ENV=development, e lá o código não pode sumir num log.
    if (env.NODE_ENV !== 'production' && env.API_PUBLIC_URL.startsWith('http://localhost')) {
      console.info(`[e-mail simulado] para ${message.to} · ${message.subject}\n${message.text}`);
      return;
    }
    throw new AppError(503, 'MAIL_NOT_CONFIGURED', 'Envio de e-mail não configurado (SMTP).');
  }
  await getTransporter().sendMail({
    from: env.MAIL_FROM ?? `Clube VKUDAKA <${env.SMTP_USER}>`,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
