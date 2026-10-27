import { contextBridge, ipcRenderer } from 'electron';

/** The only surface the renderer gets — keep it narrow (SOT §8). */
const api = {
  auth: {
    get: (): Promise<string | null> => ipcRenderer.invoke('auth:get'),
    set: (token: string): Promise<void> => ipcRenderer.invoke('auth:set', token),
    clear: (): Promise<void> => ipcRenderer.invoke('auth:clear'),
  },
  config: (): Promise<{ apiUrl: string; version: string; platform: string }> => ipcRenderer.invoke('config:get'),
  notify: (title: string, body: string, link?: string) => ipcRenderer.send('notify', { title, body, link }),
  setBadge: (count: number) => ipcRenderer.send('badge', count),
  onNavigate: (cb: (path: string) => void) => {
    const listener = (_: unknown, path: string) => cb(path);
    ipcRenderer.on('navigate', listener);
    return () => {
      ipcRenderer.removeListener('navigate', listener);
    };
  },
};

contextBridge.exposeInMainWorld('nexus', api);

export type NexusBridge = typeof api;
