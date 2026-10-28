import { create } from 'zustand';
import type { Permission } from '@nexus/shared';
import { api, ApiError, initApi, setToken, setUnauthorizedHandler } from './api';
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
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
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
        if (!(e instanceof ApiError) || (e.status !== 0 && e.status < 500)) {
          await setToken(null);
          break;
        }
        await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 5000)));
      }
    }
    set({ ready: true });
  },
  login: async (email, password) => {
    const { token } = await api.post<{ token: string }>('/auth/login', { email, password });
    await setToken(token);
    set({ me: await api.get<Me>('/auth/me') });
    connectSocket();
  },
  logout: async () => {
    disconnectSocket();
    await setToken(null);
    set({ me: null });
  },
  refresh: async () => set({ me: await api.get<Me>('/auth/me') }),
}));

/** UI-only gate; the server enforces every permission (SOT §8). */
export function useCan(perm: Permission): boolean {
  const perms = useAuth((s) => s.me?.permissions ?? []);
  return perms.includes('admin.all') || perms.includes(perm);
}
