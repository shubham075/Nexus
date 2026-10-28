import { create } from 'zustand';
import type { Permission } from '@nexus/shared';
import { ApiError, api, getRefreshToken, initApi, setSession, setUnauthorizedHandler } from './api';
import { connectSocket, disconnectSocket } from './socket';

export interface Me {
  id: string;
  email: string;
  name: string;
  headline: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  location: string | null;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  permissions: string[];
  memberships: { title: string | null; isPrimary: boolean; node: { id: string; name: string; type: string } }[];
}

interface AuthState {
  me: Me | null;
  ready: boolean;
  boot: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithSso: (providerId: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  me: null,
  ready: false,
  boot: async () => {
    setUnauthorizedHandler(() => get().logout());
    const token = await initApi();
    if (token) {
      try {
        set({ me: await api.get<Me>('/auth/me') });
        connectSocket();
      } catch (e) {
        // /auth/me already tried a refresh; only a definite 401 ends the session (offline keeps it).
        if (e instanceof ApiError && e.status === 401) await setSession(null);
      }
    }
    set({ ready: true });
  },
  login: async (email, password) => {
    await setSession(await api.post<{ token: string; refreshToken: string }>('/auth/login', { email, password }));
    set({ me: await api.get<Me>('/auth/me') });
    connectSocket();
  },
  loginWithSso: async (providerId) => {
    // Opens the system browser; resolves with a one-time code from the loopback redirect (SOT §8).
    const { code, codeVerifier } = await window.nexus.sso.start(providerId).catch((e: Error) => {
      // Electron prefixes IPC rejections with "Error invoking remote method …: Error: ".
      throw new Error(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    });
    await setSession(await api.post<{ token: string; refreshToken: string }>('/auth/sso/exchange', { code, codeVerifier }));
    set({ me: await api.get<Me>('/auth/me') });
    connectSocket();
  },
  logout: async () => {
    disconnectSocket();
    const refreshToken = getRefreshToken();
    if (refreshToken) api.post('/auth/logout', { refreshToken }).catch(() => {});
    await setSession(null);
    set({ me: null });
  },
  refresh: async () => set({ me: await api.get<Me>('/auth/me') }),
}));

/** UI-only gate; the server enforces every permission (SOT §8). */
export function useCan(perm: Permission): boolean {
  const perms = useAuth((s) => s.me?.permissions ?? []);
  return perms.includes('admin.all') || perms.includes(perm);
}
