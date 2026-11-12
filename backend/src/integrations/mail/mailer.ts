import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

/**
 * E-mail transacional (2026-11-12) — hoje só o código de "Esqueci a senha".
 *
 * Envia pelo SMTP configurado no ambiente (Gmail da VKUDAKA com senha de app).
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
    });
  }
  return transporter;
}

export async function sendMail(message: MailMessage): Promise<void> {
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
