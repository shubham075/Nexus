import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from './db';
import { env } from './env';
import { HttpError } from './http';
import { disconnectSessions } from './realtime';

/** Session + refresh-token handling (SOT §8). Only SHA-256 hashes of refresh tokens are stored. */

export const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');
export const newSecret = () => randomBytes(32).toString('base64url');

const refreshExpiry = () => new Date(Date.now() + env.refreshTokenTtlDays * 86_400_000);

export interface TokenPair {
  token: string;
  refreshToken: string;
}

const sessionExpired = () => new HttpError(401, 'SESSION_EXPIRED', 'Your session has ended. Please sign in again.');

export async function createSession(app: FastifyInstance, req: FastifyRequest, userId: string, method: string): Promise<TokenPair> {
  const refreshToken = newSecret();
  const s = await prisma.authSession.create({
    data: {
      userId,
      method,
      refreshHash: sha256(refreshToken),
      expiresAt: refreshExpiry(),
      ip: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 300),
    },
    select: { id: true },
  });
  return { token: app.jwt.sign({ sub: userId, sid: s.id }), refreshToken };
}

/** Rotates a refresh token. Replaying the previous token revokes the session (likely theft). */
export async function rotateSession(app: FastifyInstance, refreshToken: string): Promise<TokenPair> {
  const hash = sha256(refreshToken);
  const s = await prisma.authSession.findUnique({ where: { refreshHash: hash }, include: { user: { select: { isActive: true } } } });
  if (!s) {
    const replayed = await prisma.authSession.findUnique({ where: { prevHash: hash }, select: { id: true, revokedAt: true } });
    if (replayed && !replayed.revokedAt) await revokeSessions({ id: replayed.id });
    throw sessionExpired();
  }
  if (s.revokedAt || s.expiresAt < new Date() || !s.user.isActive) throw sessionExpired();

  const next = newSecret();
  // Conditional update: two concurrent refreshes with the same token can't both succeed.
  const { count } = await prisma.authSession.updateMany({
    where: { id: s.id, refreshHash: hash, revokedAt: null },
    data: { refreshHash: sha256(next), prevHash: hash, expiresAt: refreshExpiry(), lastUsedAt: new Date() },
  });
  if (count !== 1) throw sessionExpired();
  return { token: app.jwt.sign({ sub: s.userId, sid: s.id }), refreshToken: next };
}

/** Revokes matching live sessions and drops their sockets. */
export async function revokeSessions(where: { id?: string; userId?: string; NOT?: { id: string } }): Promise<void> {
  const live = await prisma.authSession.findMany({ where: { ...where, revokedAt: null }, select: { id: true } });
  if (!live.length) return;
  const ids = live.map((s) => s.id);
  await prisma.authSession.updateMany({ where: { id: { in: ids } }, data: { revokedAt: new Date() } });
  disconnectSessions(ids);
}

export const revokeUserSessions = (userId: string, exceptSessionId?: string) =>
  revokeSessions({ userId, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) });

/** True when the access token's session is live and its user active. Used by HTTP and Socket.IO auth. */
export async function sessionIsLive(userId: string, sessionId: string | undefined): Promise<boolean> {
  if (!sessionId) return false; // pre-1c tokens carry no session
  const s = await prisma.authSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, revokedAt: true, user: { select: { isActive: true } } },
  });
  return !!s && s.userId === userId && !s.revokedAt && s.user.isActive;
}

/** Sessions expire 30 days after last refresh; prune old rows occasionally. */
export async function pruneSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 86_400_000);
  await prisma.authSession.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } });
  await prisma.ssoRequest.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
