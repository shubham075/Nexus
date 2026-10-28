import type { NexusBridge } from '../../../preload';

/** True when the renderer runs in a plain browser (the web client) instead of Electron. */
export const isWeb = !window.nexus;

/**
 * Fallback for running the renderer in a plain browser: the web client (`pnpm build:web`) and UI tests.
 * Electron's preload provides the real bridge with OS-encrypted token storage.
 *
 * Phase-2 web choices (SOT §14, 2d):
 * - Tokens live in localStorage. Same-origin scripts can read them, which the strict CSP on the
 *   web host mitigates; moving refresh tokens to an httpOnly cookie is a later hardening step.
 * - The API URL comes from `config.json` next to index.html (written by the web container at start),
 *   so one build serves any environment. Without it, VITE_API_URL or the local dev API is used.
 */
if (isWeb) {
  const KEY = 'nexus.token';
  const store = {
    get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
    set: (v: string | null) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* ignore */ } },
  };

  let config: Promise<{ apiUrl: string; version: string; platform: string }> | null = null;
  const loadConfig = async () => {
    let apiUrl: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
    try {
      const res = await fetch('./config.json', { cache: 'no-store' });
      // The dev server answers unknown paths with index.html, so only trust real JSON.
      if (res.ok && res.headers.get('content-type')?.includes('json')) {
        const json = (await res.json()) as { apiUrl?: unknown };
        if (typeof json.apiUrl === 'string' && json.apiUrl) apiUrl = json.apiUrl.replace(/\/+$/, '');
      }
    } catch { /* no runtime config: keep the build-time default */ }
    return { apiUrl, version: 'web', platform: 'web' };
  };

  const navigateListeners = new Set<(path: string) => void>();

  // Browsers only show the permission prompt reliably after a user gesture, so ask on the first click.
  const canNotify = typeof Notification !== 'undefined';
  if (canNotify && Notification.permission === 'default') {
    const ask = () => { Notification.requestPermission().catch(() => {}); };
    window.addEventListener('pointerdown', ask, { once: true, capture: true });
  }

  const bridge: NexusBridge = {
    auth: {
      get: async () => store.get(),
      set: async (t) => store.set(t),
      clear: async () => store.set(null),
    },
    // The loopback flow needs the desktop main process; the login page hides SSO on web
    // until the phase-2 redirect flow exists.
    sso: {
      start: async () => {
        throw new Error('Single sign-on is available in the desktop app.');
      },
      cancel: async () => {},
    },
    config: () => (config ??= loadConfig()),
    // Mirrors the desktop: notify only while the app is not focused; fail silently without permission.
    notify: (title, body, link) => {
      if (!canNotify || Notification.permission !== 'granted' || document.hasFocus()) return;
      try {
        const n = new Notification(title, { body });
        n.onclick = () => {
          window.focus();
          n.close();
          if (link) navigateListeners.forEach((cb) => cb(link));
        };
      } catch { /* e.g. mobile browsers that only allow service-worker notifications */ }
    },
    setBadge: (n) => {
      document.title = n > 0 ? `(${n}) Nexus` : 'Nexus';
      const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
      (n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => {});
    },
    onNavigate: (cb) => {
      navigateListeners.add(cb);
      return () => { navigateListeners.delete(cb); };
    },
    // Web deploys update by reloading; there is no auto-updater.
    update: {
      get: async () => ({ status: 'idle' }),
      install: async () => {},
      onStatus: () => () => {},
    },
  };
  window.nexus = bridge;
}
