import { contextBridge, ipcRenderer } from 'electron';
import type { UpdateState } from '../main/updater';

/**
 * Windows has no `app.setBadgeCount`, so main shows this as the taskbar overlay icon instead:
 * a red dot with the count, drawn here because main has no canvas.
 */
function badgeIcon(count: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#dc2626';
  g.beginPath();
  g.arc(16, 16, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `bold ${count > 9 ? 16 : 20}px "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(count > 99 ? '99+' : String(count), 16, 17);
  return c.toDataURL();
}

/** The only surface the renderer gets — keep it narrow (SOT §8). */
const api = {
  auth: {
    get: (): Promise<string | null> => ipcRenderer.invoke('auth:get'),
    set: (token: string): Promise<void> => ipcRenderer.invoke('auth:set', token),
    clear: (): Promise<void> => ipcRenderer.invoke('auth:clear'),
  },
  sso: {
    /** Opens the system browser; resolves with a one-time code to exchange at `/auth/sso/exchange`. */
    start: (providerId: string): Promise<{ code: string; codeVerifier: string }> => ipcRenderer.invoke('sso:start', providerId),
    cancel: (): Promise<void> => ipcRenderer.invoke('sso:cancel'),
  },
  config: (): Promise<{ apiUrl: string; version: string; platform: string }> => ipcRenderer.invoke('config:get'),
  notify: (title: string, body: string, link?: string) => ipcRenderer.send('notify', { title, body, link }),
  setBadge: (count: number) => ipcRenderer.send('badge', count, count > 0 ? badgeIcon(count) : null),
  onNavigate: (cb: (path: string) => void) => {
    const listener = (_: unknown, path: string) => cb(path);
    ipcRenderer.on('navigate', listener);
    return () => {
      ipcRenderer.removeListener('navigate', listener);
    };
  },
  update: {
    get: (): Promise<UpdateState> => ipcRenderer.invoke('update:get'),
    /** Quits, installs the downloaded update and relaunches. Only call from a user click. */
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onStatus: (cb: (state: UpdateState) => void) => {
      const listener = (_: unknown, state: UpdateState) => cb(state);
      ipcRenderer.on('update:status', listener);
      return () => {
        ipcRenderer.removeListener('update:status', listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('nexus', api);

export type NexusBridge = typeof api;
