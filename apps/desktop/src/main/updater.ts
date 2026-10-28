import { app, ipcMain, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

export type UpdateState =
  | { status: 'idle' }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string };

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 15 * 1000;

/**
 * Background auto-update from an internal generic feed (SOT §13).
 * The feed folder holds latest.yml, Nexus-Setup-<v>.exe and its .blockmap.
 * Updates download silently; the renderer shows "Restart to update" and the
 * install only runs when the user clicks it or quits the app. Never restarts on its own.
 */
export function setupAutoUpdate(feedUrl: string, getWindow: () => BrowserWindow | null) {
  let state: UpdateState = { status: 'idle' };
  const publish = (next: UpdateState) => {
    state = next;
    getWindow()?.webContents.send('update:status', state);
  };

  ipcMain.handle('update:get', () => state);
  ipcMain.handle('update:install', () => {
    if (state.status !== 'ready') return;
    // Silent NSIS install, then relaunch. Only ever called from the user's click.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });

  // Dev runs have no app-update.yml and nothing to update.
  if (!app.isPackaged) return;

  // @fastify/static (and most static hosts) answer one byte range per request.
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl, useMultipleRangeRequest: false });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on('download-progress', (p) => {
    if (state.status !== 'ready') publish({ status: 'downloading', version: state.status === 'downloading' ? state.version : '', percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-available', (info) => publish({ status: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('update-downloaded', (info) => publish({ status: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => {
    // Feed unreachable, bad signature, etc. Keep quiet in the UI and retry on the next tick.
    console.warn('[updater]', err?.message ?? err);
    if (state.status === 'downloading') publish({ status: 'idle' });
  });

  const check = () => {
    if (state.status !== 'idle') return;
    autoUpdater.checkForUpdates().catch(() => {
      /* reported through the 'error' event */
    });
  };
  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, CHECK_EVERY_MS).unref();
}
