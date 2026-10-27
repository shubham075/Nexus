import { io, type Socket } from 'socket.io-client';
import { getBaseUrl, getToken } from './api';

let socket: Socket | null = null;
const listeners = new Map<string, Set<(data: any) => void>>();

export function connectSocket() {
  if (socket) return socket;
  socket = io(getBaseUrl(), { auth: { token: getToken() }, transports: ['websocket'] });
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
