import { io, type Socket } from 'socket.io-client';
import { getBaseUrl, getToken, refreshAccess } from './api';

let socket: Socket | null = null;
const listeners = new Map<string, Set<(data: any) => void>>();

export function connectSocket() {
  if (socket) return socket;
  // `auth` as a callback re-reads the current access token on every reconnect, so refreshes carry over.
  const s = io(getBaseUrl(), { auth: (cb) => cb({ token: getToken() }), transports: ['websocket'] });
  socket = s;
  // The server refuses an expired/revoked token at handshake and socket.io won't retry that on its own:
  // refresh, then reconnect. A failed refresh means the session is over (the API layer signs out).
  s.on('connect_error', (err) => {
    if (err.message !== 'unauthorized') return;
    refreshAccess()
      .then((ok) => {
        if (ok && socket === s) s.connect();
      })
      .catch(() => {
        if (socket === s) setTimeout(() => socket === s && s.connect(), 5000);
      });
  });
  for (const [event, set] of listeners) for (const fn of set) socket.on(event, fn);
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Subscribe to a realtime event; returns an unsubscribe fn. Survives reconnects/logins. */
export function onSocket(event: string, fn: (data: any) => void) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
  socket?.on(event, fn);
  return () => {
    listeners.get(event)?.delete(fn);
    socket?.off(event, fn);
  };
}

export function emitSocket(event: string, data: unknown) {
  socket?.emit(event, data);
}
