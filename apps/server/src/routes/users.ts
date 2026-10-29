import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { notFound, parse } from '../lib/http';
import { authenticate, uid } from '../lib/auth';
import { notify, userLite } from '../lib/notify';
import { getDag } from '../dag/cache';
import { connectionDegree } from './network';
import { postWhere, viewerOf } from '../lib/visibility';
import { exportFileName, exportUser } from '../lib/export';

const dateish = z.coerce.date();
const experienceBody = z.object({
  title: z.string().min(1).max(120),
  company: z.string().min(1).max(120),
  location: z.string().max(120).nullish(),
  startDate: dateish,
  endDate: dateish.nullish(),
  description: z.string().max(2000).nullish(),
});
const educationBody = z.object({
  school: z.string().min(1).max(160),
  degree: z.string().max(120).nullish(),
  field: z.string().max(120).nullish(),
  startDate: dateish.nullish(),
  endDate: dateish.nullish(),
});

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  /** Lightweight directory used by mention pickers and admin selectors. */
  app.get<{ Querystring: { q?: string } }>('/', async (req) => {
    const q = req.query.q?.trim();
    return prisma.user.findMany({
      where: { isActive: true, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      take: 20,
      orderBy: { name: 'asc' },
      select: userLite,
    });
  });

  /** Download my own data as JSON (SOT §8 data export). */
  app.get('/me/export', async (req, reply) => {
    const data = await exportUser(uid(req), uid(req), req.orgId);
    reply.header('Content-Disposition', `attachment; filename="${exportFileName(data.profile.name)}"`);
    return data;
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const me = uid(req);
    const id = req.params.id === 'me' ? me : req.params.id;
    // Units are company-private: only show the profile's units inside my active org (SOT D20).
    const org = req.orgId ?? '';
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        ...userLite, email: true, about: true, location: true, coverUrl: true, pronouns: true, openTo: true, createdAt: true, isActive: true,
        memberships: { where: { node: { orgId: org } }, select: { title: true, isPrimary: true, node: { select: { id: true, name: true, type: true } } } },
        experiences: { orderBy: { startDate: 'desc' } },
        educations: { orderBy: { startDate: 'desc' } },
        skills: {
          select: {
            id: true, name: true,
            _count: { select: { endorsements: true } },
            endorsements: { where: { endorserId: me }, select: { endorserId: true } },
          },
        },
        _count: { select: { followers: true, following: true } },
      },
    });
    if (!user) throw notFound('User');

    const dag = await getDag(org);
    const nodeNames = new Map((await prisma.orgNode.findMany({ where: { orgId: org }, select: { id: true, name: true } })).map((n) => [n.id, n.name]));

    const orgPaths = user.memberships.flatMap((m) =>
      dag.has(m.node.id) ? dag.paths(m.node.id, 3).map((p) => p.map((nid) => ({ id: nid, name: nodeNames.get(nid) ?? '' }))) : [],
    );

    const [connections, degree, follow, pending] = await Promise.all([
      prisma.connection.count({ where: { status: 'ACCEPTED', OR: [{ requesterId: id }, { addresseeId: id }] } }),
      id === me ? Promise.resolve(0) : connectionDegree(me, id),
      prisma.follow.findUnique({ where: { followerId_followeeId: { followerId: me, followeeId: id } } }),
      prisma.connection.findFirst({
        where: { status: 'PENDING', OR: [{ requesterId: me, addresseeId: id }, { requesterId: id, addresseeId: me }] },
        select: { id: true, requesterId: true },
      }),
    ]);

    if (id !== me) {
      // record at most one view per viewer per day
      const since = new Date(Date.now() - 864e5);
      const recent = await prisma.profileView.findFirst({ where: { viewedId: id, viewerId: me, createdAt: { gte: since } } });
      if (!recent) await prisma.profileView.create({ data: { viewedId: id, viewerId: me } });
    }

    return {
      ...user,
      skills: user.skills.map((s) => ({ id: s.id, name: s.name, endorsements: s._count.endorsements, endorsedByMe: s.endorsements.length > 0 })),
      orgPaths,
      connections,
      degree,
      isFollowing: !!follow,
      pendingConnection: pending ? { id: pending.id, outgoing: pending.requesterId === me } : null,
    };
  });

  app.patch('/me', async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        headline: z.string().max(220).nullish(),
        about: z.string().max(2600).nullish(),
        location: z.string().max(120).nullish(),
        pronouns: z.string().max(30).nullish(),
        avatarUrl: z.string().url().nullish(),
        coverUrl: z.string().url().nullish(),
        openTo: z.array(z.string().max(40)).max(10).optional(),
      }),
      req.body,
    );
    return prisma.user.update({ where: { id: uid(req) }, data: body, select: { ...userLite, about: true, location: true, coverUrl: true } });
  });

  app.get('/me/profile-views', async (req) => {
    const views = await prisma.profileView.findMany({
      where: { viewedId: uid(req) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { viewer: { select: userLite } },
    });
    const weekAgo = new Date(Date.now() - 7 * 864e5);
    return { total: views.length, thisWeek: views.filter((v) => v.createdAt >= weekAgo).length, views };
  });

  // ───────── Experience / education ─────────
  app.post('/me/experiences', async (req) => prisma.experience.create({ data: { ...parse(experienceBody, req.body), userId: uid(req) } }));
  app.patch<{ Params: { id: string } }>('/me/experiences/:id', async (req) => {
    await prisma.experience.findFirstOrThrow({ where: { id: req.params.id, userId: uid(req) } });
    return prisma.experience.update({ where: { id: req.params.id }, data: parse(experienceBody.partial(), req.body) });
  });
  app.delete<{ Params: { id: string } }>('/me/experiences/:id', async (req) => {
    await prisma.experience.deleteMany({ where: { id: req.params.id, userId: uid(req) } });
    return { ok: true };
  });

  app.post('/me/educations', async (req) => prisma.education.create({ data: { ...parse(educationBody, req.body), userId: uid(req) } }));
  app.delete<{ Params: { id: string } }>('/me/educations/:id', async (req) => {
    await prisma.education.deleteMany({ where: { id: req.params.id, userId: uid(req) } });
    return { ok: true };
  });

  // ───────── Skills & endorsements ─────────
  app.post('/me/skills', async (req) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
    return prisma.skill.upsert({
      where: { userId_name: { userId: uid(req), name } },
      create: { userId: uid(req), name },
      update: {},
    });
  });
  app.delete<{ Params: { id: string } }>('/me/skills/:id', async (req) => {
    await prisma.skill.deleteMany({ where: { id: req.params.id, userId: uid(req) } });
    return { ok: true };
  });

  app.post<{ Params: { skillId: string } }>('/skills/:skillId/endorse', async (req) => {
    const skill = await prisma.skill.findUnique({ where: { id: req.params.skillId }, include: { user: { select: { id: true } } } });
    if (!skill) throw notFound('Skill');
    if (skill.userId === uid(req)) return { ok: false };
    const existing = await prisma.endorsement.findUnique({ where: { skillId_endorserId: { skillId: skill.id, endorserId: uid(req) } } });
    if (existing) {
      await prisma.endorsement.delete({ where: { skillId_endorserId: { skillId: skill.id, endorserId: uid(req) } } });
      return { endorsed: false };
    }
    await prisma.endorsement.create({ data: { skillId: skill.id, endorserId: uid(req) } });
    const me = await prisma.user.findUniqueOrThrow({ where: { id: uid(req) }, select: { name: true } });
    await notify({ recipientId: skill.userId, actorId: uid(req), type: 'ENDORSEMENT', text: `${me.name} endorsed you for ${skill.name}`, link: `/profile/${skill.userId}` });
    return { endorsed: true };
  });

  app.get<{ Params: { id: string } }>('/:id/activity', async (req) => {
    return prisma.post.findMany({
      where: { AND: [postWhere(await viewerOf(req)), { authorId: req.params.id, groupId: null }] },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true },
    });
  });
};
