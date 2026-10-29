import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, Notification, safeStorage, shell } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { API_PREFIX } from '@nexus/shared';
import { setupAutoUpdate } from './updater';

const trimUrl = (url: string) => url.replace(/\/+$/, '');
declare const __BAKED_API_URL__: string;
declare const __BAKED_UPDATE_URL__: string;

/**
 * Client config, first match wins per key:
 *   1. nexus.config.json in %APPDATA%\Nexus (per user)  2. nexus.config.json next to Nexus.exe (IT-wide)
 *   3. NEXUS_API_URL / NEXUS_UPDATE_URL env vars  4. the address baked in at build time (same env vars)
 *   5. http://localhost:4000 (dev); update feed defaults to <apiUrl>/updates/
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
  const apiUrl = found.apiUrl ?? trimUrl(process.env.NEXUS_API_URL || __BAKED_API_URL__ || 'http://localhost:4000');
  const feed = process.env.NEXUS_UPDATE_URL || __BAKED_UPDATE_URL__;
  const updateUrl = found.updateUrl ?? (feed ? trimUrl(feed) : `${apiUrl}/updates`);
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

// ───────── SSO: system browser + one-shot loopback listener (SOT §8) ─────────
const SSO_TIMEOUT = 5 * 60_000;
let ssoAbort: (() => void) | null = null;

const ssoPage = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;display:grid;place-items:center;height:90vh;color:#333">` +
  `<div style="text-align:center"><h2>${title}</h2><p>${body}</p></div>`;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

ipcMain.handle('sso:start', async (_e, providerId: string) => {
  if (!/^[a-z0-9-]+$/.test(providerId)) throw new Error('Unknown sign-in provider');
  ssoAbort?.(); // a newer attempt replaces an unfinished one
  const codeVerifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(codeVerifier).digest('base64url');

  return new Promise<{ code: string; codeVerifier: string }>((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const finish = (err: Error | null, code?: string) => {
      clearTimeout(timer);
      ssoAbort = null;
      server.close();
      win?.show();
      win?.focus();
      if (err) reject(err);
      else resolve({ code: code!, codeVerifier });
    };
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const message = url.searchParams.get('message') ?? 'Sign-in was not completed.';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        code
          ? ssoPage('Signed in to Nexus', 'You can close this tab and return to the app.')
          : ssoPage('Sign-in failed', escapeHtml(message)),
      );
      finish(code ? null : new Error(message), code ?? undefined);
    });
    server.on('error', (err) => finish(err));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const q = new URLSearchParams({ redirect_uri: `http://127.0.0.1:${port}/callback`, code_challenge: challenge });
      shell.openExternal(`${API_URL}${API_PREFIX}/auth/sso/${providerId}/start?${q}`).catch((err) => finish(err));
    });
    timer = setTimeout(() => finish(new Error('Sign-in timed out. Please try again.')), SSO_TIMEOUT);
    ssoAbort = () => finish(new Error('Sign-in was cancelled.'));
  });
});
ipcMain.handle('sso:cancel', () => ssoAbort?.());

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

ipcMain.on('badge', (_e, count: number, icon: string | null) => {
  app.setBadgeCount(count); // macOS / Linux only
  if (process.platform === 'win32') win?.setOverlayIcon(icon ? nativeImage.createFromDataURL(icon) : null, count > 0 ? `${count} unread` : '');
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
