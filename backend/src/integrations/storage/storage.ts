import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/env.js';

/**
 * Armazenamento de mídia da comunidade e do catálogo.
 *
 * Dois modos, escolhidos por `STORAGE_PROVIDER`:
 *   • `local`    — grava em `public/uploads` e serve por `/media` (desenvolvimento).
 *   • `supabase` — envia ao Supabase Storage (bucket público) via API REST.
 *
 * O contrato de saída é sempre `{ url }` público, então app e CRM não mudam ao
 * trocar o provedor. Em hospedagem com disco efêmero (Render, Fly) o modo
 * `local` perde os arquivos a cada deploy — produção deve usar `supabase`.
 */

export interface StoredObject {
  url: string;
}

interface Storage {
  save(buffer: Buffer, extension: string, contentType: string): Promise<StoredObject>;
}

const LOCAL_DIR = fileURLToPath(new URL('../../../public/uploads', import.meta.url));

const local: Storage = {
  async save(buffer, extension) {
    await mkdir(LOCAL_DIR, { recursive: true });
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(`${LOCAL_DIR}/${filename}`, buffer);
    return { url: `${env.API_PUBLIC_URL}/media/uploads/${filename}` };
  },
};

/**
 * Supabase Storage via API REST. Usa a service_role no servidor (nunca exposta
 * ao app) e grava num bucket público; a URL pública é estável e servida por CDN.
 */
const supabase: Storage = {
  async save(buffer, extension, contentType) {
    const bucket = env.STORAGE_BUCKET;
    const key = `uploads/${randomUUID()}.${extension}`;
    const base = env.SUPABASE_URL!.replace(/\/$/, '');

    const response = await fetch(`${base}/storage/v1/object/${bucket}/${key}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: buffer,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Supabase Storage respondeu ${response.status}: ${detail}`);
    }

    return { url: `${base}/storage/v1/object/public/${bucket}/${key}` };
  },
};

/** Grava um arquivo e devolve sua URL pública, conforme o provedor configurado. */
export async function saveMedia(
  buffer: Buffer,
  extension: string,
  contentType: string,
): Promise<StoredObject> {
  const storage = env.STORAGE_PROVIDER === 'supabase' ? supabase : local;
  return storage.save(buffer, extension, contentType);
}
