import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string) ??
  'http://localhost:3333';

const ACCESS_KEY = '@vkudaka/access';
const REFRESH_KEY = '@vkudaka/refresh';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** RN-01 — o app abre a tela de redirecionamento ao site quando isto é true. */
  get isSubscriptionRequired(): boolean {
    return this.status === 402 && this.code === 'SUBSCRIPTION_REQUIRED';
  }

  get storeUrl(): string | undefined {
    return (this.details as { storeUrl?: string } | undefined)?.storeUrl;
  }
}

export const tokens = {
  get: async () => ({
    accessToken: await AsyncStorage.getItem(ACCESS_KEY),
    refreshToken: await AsyncStorage.getItem(REFRESH_KEY),
  }),
  save: (accessToken: string, refreshToken: string) =>
    AsyncStorage.multiSet([
      [ACCESS_KEY, accessToken],
      [REFRESH_KEY, refreshToken],
    ]),
  clear: () => AsyncStorage.multiRemove([ACCESS_KEY, REFRESH_KEY]),
};

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  // Uma única renovação por vez: várias telas carregando juntas não devem
  // disparar N refreshes e invalidar o token umas das outras (há rotação).
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const stored = await AsyncStorage.getItem(REFRESH_KEY);
    if (!stored) return null;

    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: stored }),
    });
    if (!response.ok) {
      await tokens.clear();
      return null;
    }

    const data = (await response.json()) as { accessToken: string; refreshToken: string };
    await tokens.save(data.accessToken, data.refreshToken);
    return data.accessToken;
  })().finally(() => {
    refreshing = null;
  });

  return refreshing;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const accessToken = await AsyncStorage.getItem(ACCESS_KEY);

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401 && retry) {
    const renewed = await refreshAccessToken();
    if (renewed) return request<T>(path, init, false);
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const body = payload as { error?: string; message?: string; details?: unknown };
    throw new ApiError(
      response.status,
      body.error ?? 'UNKNOWN',
      body.message ?? 'Não foi possível concluir a operação.',
      body.details,
    );
  }

  return payload as T;
}

/**
 * Envia um arquivo do aparelho e devolve a URL pública.
 *
 * `uploadAsync` com BINARY_CONTENT põe o arquivo como corpo bruto da requisição
 * — é o que o endpoint espera. Antes disso o app gravava no post a URI local
 * (`file:///...`), que só existia no aparelho de quem publicou: a foto ficava
 * quebrada para todo mundo no feed.
 */
export async function uploadMedia(
  uri: string,
  mimeType: string,
): Promise<{ url: string; kind: 'IMAGE' | 'VIDEO' }> {
  const accessToken = await AsyncStorage.getItem(ACCESS_KEY);

  const response = await FileSystem.uploadAsync(`${BASE_URL}/uploads`, uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      'Content-Type': mimeType,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  const payload = JSON.parse(response.body || '{}') as {
    url?: string;
    kind?: 'IMAGE' | 'VIDEO';
    error?: string;
    message?: string;
  };

  if (response.status >= 400 || !payload.url) {
    throw new ApiError(
      response.status,
      payload.error ?? 'UPLOAD_FAILED',
      payload.message ?? 'Não foi possível enviar o arquivo.',
    );
  }

  return { url: payload.url, kind: payload.kind ?? 'IMAGE' };
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
};
