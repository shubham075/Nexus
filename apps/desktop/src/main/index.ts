import { app, BrowserWindow, ipcMain, nativeTheme, Notification, safeStorage, shell } from 'electron';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setupAutoUpdate } from './updater';

const trimUrl = (url: string) => url.replace(/\/+$/, '');

/**
 * Client config, first match wins per key:
 *   1. nexus.config.json in %APPDATA%\Nexus (per user)  2. nexus.config.json next to Nexus.exe (IT-wide)
 *   3. NEXUS_API_URL / NEXUS_UPDATE_URL env vars  4. http://localhost:4000 (dev); update feed defaults to <apiUrl>/updates/
 * File format: { "apiUrl": "https://nexus.yourcompany.internal", "updateUrl": "https://files.yourcompany.internal/nexus/" }
 * `updateUrl` is optional.
 */
function resolveConfig(): { apiUrl: string; updateUrl: string } {
  const candidates = [join(app.getPath('userData'), 'nexus.config.json'), join(dirname(process.execPath), 'nexus.config.json')];
  const found: { apiUrl?: string; updateUrl?: string } = {};
  for (const file of candidates) {
    try {
      const json = JSON.parse(readFileSync(file, 'utf8'));
      for (const key of ['apiUrl', 'updateUrl'] as const) {
        const url = json[key];
        if (!found[key] && typeof url === 'string' && /^https?:\/\//.test(url)) found[key] = trimUrl(url);
      }
    } catch {
      /* missing or invalid — try the next source */
    }
  }
  const apiUrl = found.apiUrl ?? trimUrl(process.env.NEXUS_API_URL ?? 'http://localhost:4000');
  const updateUrl = found.updateUrl ?? (process.env.NEXUS_UPDATE_URL ? trimUrl(process.env.NEXUS_UPDATE_URL) : `${apiUrl}/updates`);
  return { apiUrl, updateUrl: `${updateUrl}/` };
}

let API_URL = 'http://localhost:4000';
const tokenFile = () => join(app.getPath('userData'), 'session.bin');

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: 'Nexus',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0c0d' : '#f7f7f5',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win?.show());

  // External links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file:')) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

// ───────── Session token kept in main, encrypted with OS keychain (SOT §8) ─────────
ipcMain.handle('auth:get', () => {
  try {
    if (!existsSync(tokenFile())) return null;
    const buf = readFileSync(tokenFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch {
    return null;
  }
});
ipcMain.handle('auth:set', (_e, token: string) => {
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8');
  writeFileSync(tokenFile(), data);
});
ipcMain.handle('auth:clear', () => {
  if (existsSync(tokenFile())) unlinkSync(tokenFile());
});

ipcMain.handle('config:get', () => ({ apiUrl: API_URL, version: app.getVersion(), platform: process.platform }));

ipcMain.on('notify', (_e, payload: { title: string; body: string; link?: string }) => {
  if (!Notification.isSupported() || win?.isFocused()) return;
  const n = new Notification({ title: payload.title, body: payload.body });
  n.on('click', () => {
    win?.show();
    win?.focus();
    if (payload.link) win?.webContents.send('navigate', payload.link);
  });
  n.show();
});

ipcMain.on('badge', (_e, count: number) => {
  app.setBadgeCount(count);
  win?.setTitle(count > 0 ? `(${count}) Nexus` : 'Nexus');
});

app.whenReady().then(() => {
  const config = resolveConfig();
  API_URL = config.apiUrl;
  if (process.platform === 'win32') app.setAppUserModelId('com.nexus.desktop');
  createWindow();
  setupAutoUpdate(config.updateUrl, () => win);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
