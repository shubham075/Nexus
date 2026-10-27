import { app, BrowserWindow, ipcMain, nativeTheme, Notification, safeStorage, shell } from 'electron';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * API server URL, first match wins:
 *   1. nexus.config.json in %APPDATA%\Nexus (per user)  2. nexus.config.json next to Nexus.exe (IT-wide)
 *   3. NEXUS_API_URL env var  4. http://localhost:4000 (dev)
 * File format: { "apiUrl": "https://nexus.yourcompany.internal" }
 */
function resolveApiUrl(): string {
  const candidates = [join(app.getPath('userData'), 'nexus.config.json'), join(dirname(process.execPath), 'nexus.config.json')];
  for (const file of candidates) {
    try {
      const url = JSON.parse(readFileSync(file, 'utf8')).apiUrl;
      if (typeof url === 'string' && /^https?:\/\//.test(url)) return url.replace(/\/+$/, '');
    } catch {
      /* missing or invalid — try the next source */
    }
  }
  return process.env.NEXUS_API_URL ?? 'http://localhost:4000';
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
  API_URL = resolveApiUrl();
  if (process.platform === 'win32') app.setAppUserModelId('com.nexus.desktop');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
