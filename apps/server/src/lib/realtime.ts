import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { prisma } from './db';
import { signMedia } from './storage';

let io: Server | null = null;
const online = new Map<string, number>();

export function setupRealtime(app: FastifyInstance, server: HttpServer): Server {
  io = new Server(server, { cors: { origin: true, credentials: true } });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('unauthorized'));
      socket.data.userId = app.jwt.verify<{ sub: string }>(token).sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId: string = socket.data.userId;
    socket.join(`user:${userId}`);
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
  io?.to(`user:${userId}`).emit(event, signMedia(data));
}

export const onlineUserIds = () => [...online.keys()];
