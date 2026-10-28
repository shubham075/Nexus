import { API_PREFIX, UPLOAD_TYPES } from '@nexus/shared';

let baseUrl = 'http://localhost:4000';
let token: string | null = null;

export async function initApi() {
  const cfg = await window.nexus.config();
  baseUrl = cfg.apiUrl;
  token = await window.nexus.auth.get();
  return token;
}

export const getToken = () => token;
export const getBaseUrl = () => baseUrl;

export async function setToken(t: string | null) {
  token = t;
  if (t) await window.nexus.auth.set(t);
  else await window.nexus.auth.clear();
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the Nexus server. Is it running?');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
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

export const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
