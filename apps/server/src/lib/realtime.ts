import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { FastifyInstance } from 'fastify';
import { prisma } from './db';
import { env } from './env';
import { signMedia } from './storage';
import { sessionIsLive } from './sessions';

type Redis = ReturnType<typeof createClient>;

let io: Server | null = null;
/** Sockets per user on this instance. With Redis it is mirrored to a per-instance hash so all instances agree. */
const online = new Map<string, number>();

// Presence in Redis: `nexus:presence:<instance>` (hash userId → sockets) expires unless its instance
// keeps refreshing it, so a crashed instance's users drop off; `nexus:presence:instances` lists the hashes.
const INSTANCE = randomUUID();
const INSTANCES_KEY = 'nexus:presence:instances';
const presenceKey = (instance: string) => `nexus:presence:${instance}`;
const PRESENCE_TTL_S = 30;
let redis: Redis | null = null;
let closeRedis: (() => Promise<void>) | null = null;

async function connectRedis(app: FastifyInstance): Promise<{ pub: Redis; sub: Redis } | null> {
  if (!env.redisUrl) return null;
  const pub = createClient({ url: env.redisUrl });
  const sub = pub.duplicate();
  for (const c of [pub, sub]) c.on('error', (e: Error) => app.log.error(`redis: ${e.message}`));
  // REDIS_URL set means several instances rely on it: fail fast rather than silently diverge in memory.
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Redis not reachable at REDIS_URL within 5s`)), 5000).unref());
  try {
    await Promise.race([Promise.all([pub.connect(), sub.connect()]), timeout]);
  } catch (e) {
    await Promise.allSettled([pub.disconnect(), sub.disconnect()]);
    throw e;
  }
  return { pub, sub };
}

/** Rewrites this instance's presence hash from memory (also heals it after a Redis restart). */
async function syncPresence(): Promise<void> {
  if (!redis) return;
  const key = presenceKey(INSTANCE);
  const tx = redis.multi().del(key);
  if (online.size) tx.hSet(key, Object.fromEntries([...online].map(([id, n]) => [id, String(n)])));
  await tx.expire(key, PRESENCE_TTL_S).sAdd(INSTANCES_KEY, INSTANCE).exec();
}

export async function setupRealtime(app: FastifyInstance, server: HttpServer): Promise<Server> {
  io = new Server(server, { cors: { origin: true, credentials: true } });

  const clients = await connectRedis(app);
  if (clients) {
    io.adapter(createAdapter(clients.pub, clients.sub));
    redis = clients.pub;
    await syncPresence();
    const heartbeat = setInterval(() => syncPresence().catch((e) => app.log.warn(`presence sync: ${e.message}`)), (PRESENCE_TTL_S / 3) * 1000);
    heartbeat.unref();
    closeRedis = async () => {
      clearInterval(heartbeat);
      await redis?.multi().del(presenceKey(INSTANCE)).sRem(INSTANCES_KEY, INSTANCE).exec().catch(() => undefined);
      redis = null;
      await Promise.allSettled([clients.pub.quit(), clients.sub.quit()]);
    };
    app.log.info('realtime: Redis adapter enabled');
  }

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
    const n = (online.get(userId) ?? 0) + 1;
    online.set(userId, n);
    redis?.multi().hSet(presenceKey(INSTANCE), userId, String(n)).expire(presenceKey(INSTANCE), PRESENCE_TTL_S).exec().catch(() => undefined);
    // Another instance may already have this user online; a repeated `online: true` is harmless.
    if (n === 1) io!.emit('presence', { userId, online: true });

    socket.on('typing', async ({ conversationId }: { conversationId: string }) => {
      const members = await prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
      if (!members.some((m) => m.userId === userId)) return;
      for (const m of members) if (m.userId !== userId) emitToUser(m.userId, 'typing', { conversationId, userId });
    });

    socket.on('disconnect', async () => {
      const left = (online.get(userId) ?? 1) - 1;
      if (left > 0) {
        online.set(userId, left);
        await redis?.hSet(presenceKey(INSTANCE), userId, String(left)).catch(() => undefined);
        return;
      }
      online.delete(userId);
      if (redis) {
        await redis.hDel(presenceKey(INSTANCE), userId).catch(() => undefined);
        if ((await onlineUserIds()).includes(userId)) return; // still connected through another instance
      }
      io!.emit('presence', { userId, online: false });
    });
  });
  return io;
}

/** Drops this instance's presence from Redis and closes its connections (called on shutdown). */
export async function closeRealtime(): Promise<void> {
  await closeRedis?.();
  closeRedis = null;
}

export function emitToUser(userId: string, event: string, data: unknown): void {
  io?.to(`user:${userId}`).emit(event, signMedia(data));
}

/** Users with at least one open socket on any instance. Falls back to this instance if Redis errors. */
export async function onlineUserIds(): Promise<string[]> {
  if (!redis) return [...online.keys()];
  try {
    const instances = await redis.sMembers(INSTANCES_KEY);
    const ids = new Set(online.keys());
    for (const instance of instances) {
      const key = presenceKey(instance);
      const users = await redis.hKeys(key);
      if (users.length) users.forEach((u) => ids.add(u));
      else if (instance !== INSTANCE && !(await redis.exists(key))) await redis.sRem(INSTANCES_KEY, instance); // expired: instance died
    }
    return [...ids];
  } catch {
    return [...online.keys()];
  }
}

/** Drops the sockets of revoked sessions. */
export function disconnectSessions(sessionIds: string[]): void {
  if (io && sessionIds.length) io.in(sessionIds.map((id) => `session:${id}`)).disconnectSockets(true);
}

