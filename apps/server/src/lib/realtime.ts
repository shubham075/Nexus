import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { prisma } from './db';
import { sessionIsLive } from './sessions';

let io: Server | null = null;
const online = new Map<string, number>();

export function setupRealtime(app: FastifyInstance, server: HttpServer): Server {
  io = new Server(server, { cors: { origin: true, credentials: true } });

  // The client re-sends its current access token on every (re)connect; a revoked session is refused (SOT §8).
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('unauthorized'));
      const { sub, sid } = app.jwt.verify<{ sub: string; sid?: string }>(token);
      if (!(await sessionIsLive(sub, sid))) return next(new Error('unauthorized'));
      socket.data.userId = sub;
      socket.data.sessionId = sid;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId: string = socket.data.userId;
    socket.join(`user:${userId}`);
    socket.join(`session:${socket.data.sessionId}`);
    online.set(userId, (online.get(userId) ?? 0) + 1);
    io!.emit('presence', { userId, online: true });

    socket.on('typing', async ({ conversationId }: { conversationId: string }) => {
      const members = await prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
      if (!members.some((m) => m.userId === userId)) return;
      for (const m of members) if (m.userId !== userId) emitToUser(m.userId, 'typing', { conversationId, userId });
    });

    socket.on('disconnect', () => {
      const n = (online.get(userId) ?? 1) - 1;
      if (n <= 0) {
        online.delete(userId);
        io!.emit('presence', { userId, online: false });
      } else online.set(userId, n);
    });
  });
  return io;
}

export function emitToUser(userId: string, event: string, data: unknown): void {
  io?.to(`user:${userId}`).emit(event, data);
}

/** Drops the sockets of revoked sessions. */
export function disconnectSessions(sessionIds: string[]): void {
  if (io && sessionIds.length) io.in(sessionIds.map((id) => `session:${id}`)).disconnectSockets(true);
}

export const onlineUserIds = () => [...online.keys()];
