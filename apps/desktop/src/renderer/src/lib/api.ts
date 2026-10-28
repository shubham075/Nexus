import { API_PREFIX, UPLOAD_TYPES } from '@nexus/shared';

let baseUrl = 'http://localhost:4000';
let token: string | null = null;
let refreshToken: string | null = null;

/** Both tokens are persisted as one JSON blob through the bridge (Electron: `safeStorage` in main, SOT §8). */
interface StoredSession {
  token: string;
  refreshToken: string | null;
}

function readStored(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as StoredSession;
    if (typeof s.token === 'string') return s;
  } catch {
    /* pre-1c: a bare access token */
  }
  return { token: raw, refreshToken: null };
}

export async function initApi() {
  const cfg = await window.nexus.config();
  baseUrl = cfg.apiUrl;
  const s = readStored(await window.nexus.auth.get());
  token = s?.token ?? null;
  refreshToken = s?.refreshToken ?? null;
  return token;
}

export const getToken = () => token;
export const getBaseUrl = () => baseUrl;
export const getRefreshToken = () => refreshToken;

export async function setSession(s: { token: string; refreshToken: string | null } | null) {
  token = s?.token ?? null;
  refreshToken = s?.refreshToken ?? null;
  if (s) await window.nexus.auth.set(JSON.stringify({ token: s.token, refreshToken: s.refreshToken } satisfies StoredSession));
  else await window.nexus.auth.clear();
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

const url = (path: string) => `${baseUrl}${API_PREFIX}${path}`;

let refreshing: Promise<boolean> | null = null;

/**
 * Swaps the refresh token for a new pair. Single-flight: concurrent 401s share one refresh, because the server
 * treats a second use of the same refresh token as theft. Resolves false when the session is over.
 * A network error keeps the stored session (the server may just be unreachable) and rejects.
 */
export function refreshAccess(): Promise<boolean> {
  if (!refreshToken) return Promise.resolve(false);
  refreshing ??= (async () => {
    const sent = refreshToken;
    let res: Response;
    try {
      res = await fetch(url('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: sent }),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Cannot reach the Nexus server. Is it running?');
    }
    if (res.status === 401) return false;
    if (!res.ok) throw new ApiError(res.status, 'ERROR', res.statusText);
    const data = (await res.json()) as { token: string; refreshToken: string };
    await setSession(data);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

const NO_REFRESH = new Set(['/auth/login', '/auth/refresh', '/auth/logout', '/auth/sso/exchange']);

async function request<T>(method: string, path: string, body?: unknown, isForm = false, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url(path), {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the Nexus server. Is it running?');
  }
  if (res.status === 401 && token && !retried && !NO_REFRESH.has(path)) {
    // Access token expired or session revoked: refresh once, then retry transparently.
    if (await refreshAccess()) return request<T>(method, path, body, isForm, true);
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token && !NO_REFRESH.has(path)) onUnauthorized();
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? res.statusText);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  patch: <T = any>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T = any>(p: string) => request<T>('DELETE', p),
  upload: async (files: File[]) => {
    const bad = files.find((f) => !UPLOAD_TYPES[f.type]);
    if (bad) throw new ApiError(400, 'BAD_REQUEST', `${bad.name}: only PNG, JPEG, GIF, WebP, MP4, WebM and PDF files can be uploaded.`);
    const fd = new FormData();
    for (const f of files) fd.append('file', f, f.name);
    return request<{ url: string; mimeType: string; fileName: string }[]>('POST', '/media', fd, true);
  },
};

/** Fetch a JSON export and save it as a file (SOT §8 data export). */
export async function downloadJson(path: string, fallbackName: string) {
  const data = await api.get(path);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fallbackName });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
