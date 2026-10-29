import { create } from 'zustand';
import type { Permission } from '@nexus/shared';
import { ApiError, api, getActiveOrg, getRefreshToken, initApi, setActiveOrg, setSession, setUnauthorizedHandler } from './api';
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
  /** SOT D23: the org switcher only exists in multi mode. */
  tenancy: 'single' | 'multi';
  orgs: { id: string; slug: string; name: string; logoUrl: string | null }[];
  activeOrgId: string | null;
}

interface AuthState {
  me: Me | null;
  ready: boolean;
  boot: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithSso: (providerId: string) => Promise<void>;
  /** Signs in with a token pair from an email link (verify-email). */
  loginWithTokens: (pair: { token: string; refreshToken: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  switchOrg: (orgId: string) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  me: null,
  ready: false,
  boot: async () => {
    setUnauthorizedHandler(() => get().logout());
    const token = await initApi();
    // Keep the session while the server is unreachable or failing (offline, restarting, DB down); only a rejected token signs out.
    for (let attempt = 0; token; attempt++) {
      try {
        set({ me: await api.get<Me>('/auth/me') });
        connectSocket();
        break;
      } catch (e) {
        // A remembered org I no longer belong to: fall back to my default org.
        if (e instanceof ApiError && e.status === 403 && getActiveOrg()) {
          setActiveOrg(null);
          continue;
        }
        // /auth/me already tried a refresh; only a rejected session (4xx) signs out. Offline, restarting or 5xx keeps it and retries.
        if (!(e instanceof ApiError) || (e.status !== 0 && e.status < 500)) {
          await setSession(null);
          break;
        }
        await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 5000)));
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
  loginWithTokens: async (pair) => {
    await setSession(pair);
    set({ me: await api.get<Me>('/auth/me') });
    connectSocket();
  },
  logout: async () => {
    disconnectSocket();
    const refreshToken = getRefreshToken();
    if (refreshToken) api.post('/auth/logout', { refreshToken }).catch(() => {});
    await setSession(null);
    setActiveOrg(null);
    set({ me: null });

  },
  refresh: async () => set({ me: await api.get<Me>('/auth/me') }),
  /** Every view is org-scoped, so start over on the home page with fresh data. */
  switchOrg: (orgId) => {
    setActiveOrg(orgId);
    window.location.hash = '#/';
    window.location.reload();
  },
}));

/** UI-only gate; the server enforces every permission (SOT §8). */
export function useCan(perm: Permission): boolean {
  const perms = useAuth((s) => s.me?.permissions ?? []);
  return perms.includes('admin.all') || perms.includes(perm);
}

/** Posting / commenting (mirrors the server's assertNetworkPerm): in multi mode people without a company may too. */
export function useCanNetwork(perm: Permission): boolean {
  const noCompany = useAuth((s) => s.me?.tenancy === 'multi' && !s.me.activeOrgId);
  return useCan(perm) || noCompany;
}
