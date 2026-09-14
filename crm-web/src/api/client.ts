const BASE_URL = import.meta.env.DEV ? '/api' : (import.meta.env.VITE_API_URL as string);

const TOKEN_KEY = 'vkudaka.crm.token';
const REFRESH_KEY = 'vkudaka.crm.refresh';
const USER_KEY = 'vkudaka.crm.user';

export interface SessionUser {
  fullName: string;
  role: string;
}

export const session = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string, refreshToken?: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  refreshToken: () => localStorage.getItem(REFRESH_KEY),
  setUser: (user: SessionUser) => localStorage.setItem(USER_KEY, JSON.stringify(user)),
  user: (): SessionUser | null => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as SessionUser) : null;
    } catch {
      return null;
    }
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

/**
 * O access token dura 15 minutos. Sem renovação, quem está trabalhando no painel
 * era jogado para o login no meio de um cadastro. Uma renovação por vez: várias
 * telas carregando juntas não podem disparar N refreshes e invalidar umas às
 * outras (o backend rotaciona o refresh a cada uso).
 */
let refreshing: Promise<string | null> | null = null;

async function renewAccessToken(): Promise<string | null> {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const stored = session.refreshToken();
    if (!stored) return null;

    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: stored }),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { accessToken: string; refreshToken: string };
    session.set(data.accessToken, data.refreshToken);
    return data.accessToken;
  })()
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });

  return refreshing;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = session.get();

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401) {
    if (retry) {
      const renewed = await renewAccessToken();
      if (renewed) return request<T>(path, init, false);
    }
    session.clear();
    window.location.href = '/login';
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sessão expirada.');
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/pdf')) {
    return (await response.blob()) as T;
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const body = payload as { error?: string; message?: string };
    throw new ApiError(response.status, body.error ?? 'UNKNOWN', body.message ?? 'Erro na operação.');
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Download direto (lista de presença em PDF — 3.4). */
  download: async (path: string, filename: string) => {
    const blob = await request<Blob>(path);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  },
};

/**
 * Upload de imagem para a API. Envia o arquivo como corpo bruto — o endpoint
 * devolve a URL definitiva, que é o que gravamos no cadastro.
 */
export async function uploadImage(file: File): Promise<string> {
  const token = session.get();
  const response = await fetch(`${BASE_URL}/admin/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
    message?: string;
  };
  if (!response.ok || !payload.url) {
    throw new ApiError(response.status, payload.error ?? 'UPLOAD_FAILED', payload.message ?? 'Falha no envio da imagem.');
  }
  return payload.url;
}

export const formatBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatDate = (iso: string | Date): string =>
  new Date(iso).toLocaleDateString('pt-BR');
