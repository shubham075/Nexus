import type { NexusBridge } from '../../../preload';

/**
 * Fallback for running the renderer in a plain browser (dev preview now, web client in phase 2).
 * Electron's preload provides the real bridge with OS-encrypted token storage.
 */
if (!window.nexus) {
  const KEY = 'nexus.token';
  const store = {
    get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
    set: (v: string | null) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* ignore */ } },
  };
  const bridge: NexusBridge = {
    auth: {
      get: async () => store.get(),
      set: async (t) => store.set(t),
      clear: async () => store.set(null),
    },
    // The loopback flow needs the desktop main process; the phase-2 web client will use a redirect flow.
    sso: {
      start: async () => {
        throw new Error('Single sign-on is available in the desktop app.');
      },
      cancel: async () => {},
    },
    config: async () => ({ apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000', version: 'web', platform: 'web' }),
    notify: () => {},
    setBadge: (n) => { document.title = n > 0 ? `(${n}) Nexus` : 'Nexus'; },
    onNavigate: () => () => {},
    update: {
      get: async () => ({ status: 'idle' }),
      install: async () => {},
      onStatus: () => () => {},
    },
  };
  window.nexus = bridge;
}
