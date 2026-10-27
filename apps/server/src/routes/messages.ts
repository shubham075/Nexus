import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { forbidden, notFound, page, pageArgs, parse } from '../lib/http';
import { authenticate, requirePerm, uid } from '../lib/auth';
import { userLite } from '../lib/notify';
import { emitToUser, onlineUserIds } from '../lib/realtime';

async function membership(conversationId: string, userId: string) {
  const m = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
  if (!m) throw forbidden('Not part of this conversation');
  return m;
}

export const messageRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.get('/', async (req) => {
    const me = uid(req);
    const convs = await prisma.conversation.findMany({
      where: { members: { some: { userId: me } } },
      orderBy: { updatedAt: 'desc' },
      include: {
        members: { include: { user: { select: userLite } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: { id: true, name: true } } } },
      },
    });
    const online = new Set(onlineUserIds());
    return Promise.all(
      convs.map(async (c) => {
        const mine = c.members.find((m) => m.userId === me)!;
        const unread = await prisma.message.count({ where: { conversationId: c.id, createdAt: { gt: mine.lastReadAt }, NOT: { senderId: me } } });
        const others = c.members.filter((m) => m.userId !== me).map((m) => ({ ...m.user, online: online.has(m.userId) }));
        return { id: c.id, title: c.title, isGroup: c.isGroup, updatedAt: c.updatedAt, members: others, lastMessage: c.messages[0] ?? null, unread };
      }),
    );
  });

  app.get('/unread', async (req) => {
    const me = uid(req);
    const mems = await prisma.conversationMember.findMany({ where: { userId: me } });
    let total = 0;
    for (const m of mems) {
      total += await prisma.message.count({ where: { conversationId: m.conversationId, createdAt: { gt: m.lastReadAt }, NOT: { senderId: me } } });
    }
    return { unread: total };
  });

  /** Opens (or reuses) a 1:1 conversation, or creates a group conversation. */
  app.post('/', { preHandler: requirePerm('message.send') }, async (req) => {
    const me = uid(req);
    const b = parse(z.object({ userIds: z.array(z.string()).min(1).max(50), title: z.string().max(80).nullish() }), req.body);
    const ids = [...new Set(b.userIds.filter((id) => id !== me))];
    if (ids.length === 1 && !b.title) {
      const existing = await prisma.conversation.findFirst({
        where: { isGroup: false, AND: [{ members: { some: { userId: me } } }, { members: { some: { userId: ids[0] } } }] },
      });
      if (existing) return { id: existing.id };
    }
    const conv = await prisma.conversation.create({
      data: {
        isGroup: ids.length > 1 || !!b.title,
        title: b.title,
        members: { create: [me, ...ids].map((userId) => ({ userId })) },
      },
    });
    return { id: conv.id };
  });

  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>('/:id/messages', async (req) => {
    const me = uid(req);
    await membership(req.params.id, me);
    const { limit, ...args } = pageArgs(req.query, 40);
    const rows = await prisma.message.findMany({
      ...args,
      where: { conversationId: req.params.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { sender: { select: userLite } },
    });
    const members = await prisma.conversationMember.findMany({ where: { conversationId: req.params.id }, select: { userId: true, lastReadAt: true } });
    const p = page(rows, limit);
    return { ...p, items: p.items.reverse(), readState: members };
  });

  app.post<{ Params: { id: string } }>('/:id/messages', { preHandler: requirePerm('message.send') }, async (req) => {
    const me = uid(req);
    await membership(req.params.id, me);
    const b = parse(
      z.object({
        body: z.string().max(5000).default(''),
        attachment: z.object({ url: z.string().url(), name: z.string(), mime: z.string() }).nullish(),
      }).refine((x) => x.body.trim() || x.attachment, 'Message is empty'),
      req.body,
    );
    const msg = await prisma.message.create({
      data: {
        conversationId: req.params.id,
        senderId: me,
        body: b.body,
        attachmentUrl: b.attachment?.url,
        attachmentName: b.attachment?.name,
        attachmentMime: b.attachment?.mime,
      },
      include: { sender: { select: userLite } },
    });
    await prisma.conversation.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } });
    await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: req.params.id, userId: me } }, data: { lastReadAt: new Date() } });
    const members = await prisma.conversationMember.findMany({ where: { conversationId: req.params.id }, select: { userId: true } });
    for (const m of members) emitToUser(m.userId, 'message:new', msg);
    return msg;
  });

  app.post<{ Params: { id: string } }>('/:id/read', async (req) => {
    const me = uid(req);
    await membership(req.params.id, me);
    const now = new Date();
    await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: req.params.id, userId: me } }, data: { lastReadAt: now } });
    const members = await prisma.conversationMember.findMany({ where: { conversationId: req.params.id }, select: { userId: true } });
    for (const m of members) if (m.userId !== me) emitToUser(m.userId, 'message:read', { conversationId: req.params.id, userId: me, at: now });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const me = uid(req);
    await membership(req.params.id, me);
    const c = await prisma.conversation.findUnique({ where: { id: req.params.id }, include: { members: { include: { user: { select: userLite } } } } });
    if (!c) throw notFound('Conversation');
    const online = new Set(onlineUserIds());
    return { ...c, members: c.members.map((m) => ({ ...m.user, online: online.has(m.userId) })) };
  });
};
