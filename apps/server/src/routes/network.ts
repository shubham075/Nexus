import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { badRequest, notFound, parse } from '../lib/http';
import { authenticate, uid } from '../lib/auth';
import { notify, userLite } from '../lib/notify';
import { onlineUserIds } from '../lib/realtime';

export async function connectionIds(userId: string): Promise<string[]> {
  const rows = await prisma.connection.findMany({
    where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
}

/** 1 = direct connection, 2 = shares a connection, 3 = everyone else. */
export async function connectionDegree(a: string, b: string): Promise<number> {
  const mine = await connectionIds(a);
  if (mine.includes(b)) return 1;
  const theirs = new Set(await connectionIds(b));
  return mine.some((m) => theirs.has(m)) ? 2 : 3;
}

export const networkRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.get('/connections', async (req) => {
    const me = uid(req);
    const rows = await prisma.connection.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: me }, { addresseeId: me }] },
      orderBy: { respondedAt: 'desc' },
      include: { requester: { select: userLite }, addressee: { select: userLite } },
    });
    const online = new Set(await onlineUserIds());
    return rows.map((r) => {
      const other = r.requesterId === me ? r.addressee : r.requester;
      return { ...other, connectedAt: r.respondedAt, online: online.has(other.id) };
    });
  });

  app.get('/invitations', async (req) => {
    const me = uid(req);
    const [received, sent] = await Promise.all([
      prisma.connection.findMany({ where: { addresseeId: me, status: 'PENDING' }, include: { requester: { select: userLite } }, orderBy: { createdAt: 'desc' } }),
      prisma.connection.findMany({ where: { requesterId: me, status: 'PENDING' }, include: { addressee: { select: userLite } }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { received, sent };
  });

  app.post('/connect', async (req) => {
    const me = uid(req);
    const { userId, message } = parse(z.object({ userId: z.string(), message: z.string().max(300).nullish() }), req.body);
    if (userId === me) throw badRequest('You cannot connect with yourself');
    const existing = await prisma.connection.findFirst({
      where: { OR: [{ requesterId: me, addresseeId: userId }, { requesterId: userId, addresseeId: me }] },
    });
    if (existing?.status === 'ACCEPTED') return existing;
    // They already asked us → accept instead of creating a mirror request.
    if (existing && existing.requesterId === userId && existing.status === 'PENDING') return accept(existing.id, me);
    const conn = existing
      ? await prisma.connection.update({ where: { id: existing.id }, data: { status: 'PENDING', message, createdAt: new Date() } })
      : await prisma.connection.create({ data: { requesterId: me, addresseeId: userId, message } });
    const meUser = await prisma.user.findUniqueOrThrow({ where: { id: me }, select: { name: true } });
    await notify({ recipientId: userId, actorId: me, type: 'CONNECTION_REQUEST', text: `${meUser.name} wants to connect`, link: '/network' });
    return conn;
  });

  async function accept(id: string, me: string) {
    const conn = await prisma.connection.update({ where: { id }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
    await prisma.follow.createMany({
      data: [
        { followerId: conn.requesterId, followeeId: conn.addresseeId },
        { followerId: conn.addresseeId, followeeId: conn.requesterId },
      ],
      skipDuplicates: true,
    });
    const meUser = await prisma.user.findUniqueOrThrow({ where: { id: me }, select: { name: true } });
    await notify({ recipientId: conn.requesterId, actorId: me, type: 'CONNECTION_ACCEPTED', text: `${meUser.name} accepted your invitation`, link: `/profile/${me}` });
    return conn;
  }

  app.post<{ Params: { id: string } }>('/invitations/:id/accept', async (req) => {
    const conn = await prisma.connection.findFirst({ where: { id: req.params.id, addresseeId: uid(req), status: 'PENDING' } });
    if (!conn) throw notFound('Invitation');
    return accept(conn.id, uid(req));
  });

  app.post<{ Params: { id: string } }>('/invitations/:id/ignore', async (req) => {
    await prisma.connection.updateMany({ where: { id: req.params.id, addresseeId: uid(req) }, data: { status: 'IGNORED', respondedAt: new Date() } });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/invitations/:id', async (req) => {
    await prisma.connection.deleteMany({ where: { id: req.params.id, requesterId: uid(req), status: 'PENDING' } });
    return { ok: true };
  });

  app.delete<{ Params: { userId: string } }>('/connections/:userId', async (req) => {
    const me = uid(req);
    await prisma.connection.deleteMany({
      where: { OR: [{ requesterId: me, addresseeId: req.params.userId }, { requesterId: req.params.userId, addresseeId: me }] },
    });
    return { ok: true };
  });

  app.post<{ Params: { userId: string } }>('/follow/:userId', async (req) => {
    const key = { followerId: uid(req), followeeId: req.params.userId };
    if (key.followerId === key.followeeId) throw badRequest('You cannot follow yourself');
    const existing = await prisma.follow.findUnique({ where: { followerId_followeeId: key } });
    if (existing) {
      await prisma.follow.delete({ where: { followerId_followeeId: key } });
      return { following: false };
    }
    await prisma.follow.create({ data: key });
    return { following: true };
  });

  /** People You May Know — colleagues in the same units, then 2nd-degree connections (SOT §5.2). */
  app.get('/suggestions', async (req) => {
    const me = uid(req);
    const mine = await connectionIds(me);
    const pending = await prisma.connection.findMany({
      where: { status: 'PENDING', OR: [{ requesterId: me }, { addresseeId: me }] },
      select: { requesterId: true, addresseeId: true },
    });
    const exclude = new Set([me, ...mine, ...pending.flatMap((p) => [p.requesterId, p.addresseeId])]);
    const myNodes = (await prisma.membership.findMany({ where: { userId: me, node: { orgId: req.orgId ?? '' } }, select: { nodeId: true } })).map((m) => m.nodeId);


    const [colleagues, secondDegree] = await Promise.all([
      prisma.membership.findMany({
        where: { nodeId: { in: myNodes }, userId: { notIn: [...exclude] }, user: { isActive: true } },
        select: { user: { select: userLite }, node: { select: { name: true } } },
        take: 30,
      }),
      mine.length
        ? prisma.connection.findMany({
            where: {
              status: 'ACCEPTED',
              OR: [
                { requesterId: { in: mine }, addresseeId: { notIn: [...exclude] } },
                { addresseeId: { in: mine }, requesterId: { notIn: [...exclude] } },
              ],
            },
            include: { requester: { select: userLite }, addressee: { select: userLite } },
            take: 60,
          })
        : Promise.resolve([]),
    ]);

    const out = new Map<string, { user: (typeof colleagues)[number]['user']; reason: string; mutual: number }>();
    for (const c of colleagues) if (!out.has(c.user.id)) out.set(c.user.id, { user: c.user, reason: `Works in ${c.node.name}`, mutual: 0 });
    for (const c of secondDegree) {
      const other = mine.includes(c.requesterId) ? c.addressee : c.requester;
      if (exclude.has(other.id)) continue;
      const cur = out.get(other.id) ?? { user: other, reason: 'Mutual connections', mutual: 0 };
      cur.mutual += 1;
      out.set(other.id, cur);
    }
    if (out.size < 12) {
      const others = await prisma.user.findMany({
        where: { id: { notIn: [...exclude, ...out.keys()] }, isActive: true },
        select: userLite,
        take: 12 - out.size,
        orderBy: { createdAt: 'desc' },
      });
      for (const u of others) out.set(u.id, { user: u, reason: 'New at the company', mutual: 0 });
    }
    return [...out.values()].sort((a, b) => b.mutual - a.mutual).slice(0, 24);
  });

  app.get('/stats', async (req) => {
    const me = uid(req);
    const [connections, followers, following, invites] = await Promise.all([
      connectionIds(me).then((x) => x.length),
      prisma.follow.count({ where: { followeeId: me } }),
      prisma.follow.count({ where: { followerId: me } }),
      prisma.connection.count({ where: { addresseeId: me, status: 'PENDING' } }),
    ]);
    return { connections, followers, following, invites };
  });
};
