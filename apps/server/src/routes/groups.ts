import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { forbidden, notFound, page, pageArgs, parse } from '../lib/http';
import { authenticate, requirePerm, uid } from '../lib/auth';
import { notify, userLite } from '../lib/notify';
import { can } from '../rbac';
import { assertNodesInOrg, orgOf, visibleIn } from '../lib/org';
import { postInclude, serializePosts } from './posts';
import { postWhere, viewerOf } from '../lib/visibility';

const groupBody = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).nullish(),
  rules: z.string().max(4000).nullish(),
  privacy: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  coverUrl: z.string().url().nullish(),
  nodeId: z.string().nullish(),
});

type GroupRef = { id: string; orgId: string | null; nodeId: string | null };

/** Group admins/moderators, or company moderators of the group's own org (public groups have none). */
async function canManage(g: GroupRef, userId: string) {
  const m = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId } } });
  if (m && (m.role === 'ADMIN' || m.role === 'MODERATOR')) return true;
  return !!g.orgId && can(userId, g.orgId, 'group.moderate', g.nodeId ? [g.nodeId] : undefined);
}

/** A group visible in the request's active org (its own groups + public ones). */
async function loadGroup(req: FastifyRequest<{ Params: { id: string } }>) {
  const g = await prisma.group.findFirst({ where: { id: req.params.id, ...visibleIn(req.orgId) } });
  if (!g) throw notFound('Group');
  return g;
}

export const groupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.get<{ Querystring: { mine?: string; q?: string } }>('/', async (req) => {
    const me = uid(req);
    const q = req.query.q?.trim();
    const groups = await prisma.group.findMany({
      where: {
        ...visibleIn(req.orgId),
        ...(req.query.mine === 'true' ? { members: { some: { userId: me, role: { not: 'PENDING' } } } } : {}),
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { members: true } }, members: { where: { userId: me }, select: { role: true } }, node: { select: { name: true } } },
    });
    return groups.map(({ members, _count, ...g }) => ({ ...g, memberCount: _count.members, myRole: members[0]?.role ?? null }));
  });

  app.post('/', { preHandler: requirePerm('group.create') }, async (req) => {
    const me = uid(req);
    const org = orgOf(req);
    const b = parse(groupBody, req.body);
    await assertNodesInOrg(org, [b.nodeId]);
    return prisma.group.create({ data: { ...b, orgId: org, creatorId: me, members: { create: { userId: me, role: 'ADMIN' } } } });
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const me = uid(req);
    const g = await prisma.group.findFirst({
      where: { id: req.params.id, ...visibleIn(req.orgId) },
      include: {
        node: { select: { id: true, name: true } },
        creator: { select: userLite },
        members: { where: { role: { not: 'PENDING' } }, take: 12, include: { user: { select: userLite } }, orderBy: { joinedAt: 'asc' } },
        _count: { select: { members: true, posts: true } },
      },
    });
    if (!g) throw notFound('Group');
    const mine = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId: me } } });
    return { ...g, myRole: mine?.role ?? null, canManage: await canManage(g, me) };
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req) => {
    const g = await loadGroup(req);
    if (!(await canManage(g, uid(req)))) throw forbidden();
    const b = parse(groupBody.partial(), req.body);
    if (g.orgId) await assertNodesInOrg(g.orgId, [b.nodeId]);
    else if (b.nodeId) throw forbidden('Public groups cannot belong to a unit');
    return prisma.group.update({ where: { id: g.id }, data: b });
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    const g = await loadGroup(req);
    if (!(await canManage(g, uid(req)))) throw forbidden();
    await prisma.group.delete({ where: { id: g.id } });
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>('/:id/posts', async (req) => {
    const me = uid(req);
    const g = await loadGroup(req);
    if (g.privacy === 'PRIVATE') {
      const m = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId: me } } });
      if ((!m || m.role === 'PENDING') && !(g.orgId && (await can(me, g.orgId, 'group.moderate')))) return { items: [], nextCursor: null, locked: true };
    }
    const { limit, ...args } = pageArgs(req.query, 10);
    const rows = await prisma.post.findMany({ ...args, where: { AND: [postWhere(await viewerOf(req)), { groupId: g.id }] }, orderBy: { createdAt: 'desc' }, include: postInclude(me) });
    const { items, nextCursor } = page(rows, limit);
    return { items: await serializePosts(items), nextCursor };
  });

  app.post<{ Params: { id: string } }>('/:id/join', async (req) => {
    const me = uid(req);
    const g = await loadGroup(req);
    const role = g.privacy === 'PUBLIC' ? 'MEMBER' : 'PENDING';
    await prisma.groupMember.upsert({ where: { groupId_userId: { groupId: g.id, userId: me } }, create: { groupId: g.id, userId: me, role }, update: {} });
    if (role === 'PENDING') {
      const admins = await prisma.groupMember.findMany({ where: { groupId: g.id, role: 'ADMIN' } });
      const meUser = await prisma.user.findUniqueOrThrow({ where: { id: me }, select: { name: true } });
      for (const a of admins) await notify({ recipientId: a.userId, actorId: me, type: 'GROUP_REQUEST', text: `${meUser.name} asked to join ${g.name}`, link: `/groups/${g.id}` });
    }
    return { role };
  });

  app.post<{ Params: { id: string } }>('/:id/leave', async (req) => {
    const g = await loadGroup(req);
    await prisma.groupMember.deleteMany({ where: { groupId: g.id, userId: uid(req) } });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/:id/members', async (req) => {
    const g = await loadGroup(req);
    return prisma.groupMember.findMany({ where: { groupId: g.id }, include: { user: { select: userLite } }, orderBy: { joinedAt: 'asc' } });
  });

  app.patch<{ Params: { id: string; userId: string } }>('/:id/members/:userId', async (req) => {
    const g = await loadGroup(req);
    if (!(await canManage(g, uid(req)))) throw forbidden();
    const { role } = parse(z.object({ role: z.enum(['ADMIN', 'MODERATOR', 'MEMBER']) }), req.body);
    const m = await prisma.groupMember.update({ where: { groupId_userId: { groupId: g.id, userId: req.params.userId } }, data: { role } });
    await notify({ recipientId: req.params.userId, actorId: uid(req), type: 'GROUP_INVITE', text: `You are now ${role.toLowerCase()} of ${g.name}`, link: `/groups/${g.id}` });
    return m;
  });

  app.delete<{ Params: { id: string; userId: string } }>('/:id/members/:userId', async (req) => {
    const g = await loadGroup(req);
    if (!(await canManage(g, uid(req)))) throw forbidden();
    await prisma.groupMember.delete({ where: { groupId_userId: { groupId: g.id, userId: req.params.userId } } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/:id/invite', async (req) => {
    const me = uid(req);
    const { userIds } = parse(z.object({ userIds: z.array(z.string()).min(1) }), req.body);
    const g = await loadGroup(req);
    const meUser = await prisma.user.findUniqueOrThrow({ where: { id: me }, select: { name: true } });
    for (const id of userIds) await notify({ recipientId: id, actorId: me, type: 'GROUP_INVITE', text: `${meUser.name} invited you to join ${g.name}`, link: `/groups/${g.id}` });
    return { ok: true };
  });
};
