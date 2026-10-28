import { app, BrowserWindow, ipcMain, nativeTheme, Notification, safeStorage, shell } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { API_PREFIX } from '@nexus/shared';

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
