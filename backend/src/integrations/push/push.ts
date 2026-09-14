import { env } from '../../config/env.js';

/** Adapter de push (3.7). Expo cobre iOS e Android com um único token. */

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

export interface PushResult {
  token: string;
  success: boolean;
  error?: string;
}

export interface PushProvider {
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

const expoProvider: PushProvider = {
  async send(messages) {
    if (messages.length === 0) return [];

    // A API do Expo aceita até 100 mensagens por chamada.
    const chunks: PushMessage[][] = [];
    for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100));

    const results: PushResult[] = [];
    for (const chunk of chunks) {
      const response = await fetch(EXPO_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(
          chunk.map((m) => ({
            to: m.to,
            title: m.title,
            body: m.body,
            data: m.data,
            sound: 'default',
            channelId: 'default',
          })),
        ),
      });

      const payload = (await response.json()) as { data?: Array<{ status: string; message?: string }> };
      chunk.forEach((m, index) => {
        const ticket = payload.data?.[index];
        results.push({
          token: m.to,
          success: ticket?.status === 'ok',
          error: ticket?.message,
        });
      });
    }
    return results;
  },
};

const mockProvider: PushProvider = {
  async send(messages) {
    for (const m of messages) console.log(`[push:mock] ${m.to} · ${m.title} — ${m.body}`);
    return messages.map((m) => ({ token: m.to, success: true }));
  },
};

export const pushProvider: PushProvider = env.PUSH_PROVIDER === 'expo' ? expoProvider : mockProvider;
