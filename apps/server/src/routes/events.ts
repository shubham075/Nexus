import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { forbidden, notFound, parse } from '../lib/http';
import { authenticate, requirePerm, uid } from '../lib/auth';
import { notify, userLite } from '../lib/notify';
import { can } from '../rbac';
import { assertNodesInOrg, orgOf, visibleIn } from '../lib/org';

const eventBody = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(5000).nullish(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullish(),
  isOnline: z.boolean().default(true),
  location: z.string().max(200).nullish(),
  link: z.string().url().nullish(),
  coverUrl: z.string().url().nullish(),
  nodeId: z.string().nullish(),
});

/** An event visible in the request's active org (its own events + public ones). */
async function loadEvent(req: FastifyRequest<{ Params: { id: string } }>) {
  const e = await prisma.event.findFirst({ where: { id: req.params.id, ...visibleIn(req.orgId) } });
  if (!e) throw notFound('Event');
  return e;
}

/** Organizer, or an admin of the event's own org. */
async function canEdit(e: { organizerId: string; orgId: string | null }, userId: string) {
  return e.organizerId === userId || (!!e.orgId && (await can(userId, e.orgId, 'admin.all')));
}

export const eventRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.get<{ Querystring: { past?: string } }>('/', async (req) => {
    const me = uid(req);
    const now = new Date();
    const events = await prisma.event.findMany({
      where: {
        ...visibleIn(req.orgId),
        ...(req.query.past === 'true' ? { startsAt: { lt: now } } : { startsAt: { gte: new Date(now.getTime() - 3 * 36e5) } }),
      },
      orderBy: { startsAt: req.query.past === 'true' ? 'desc' : 'asc' },
      take: 50,
      include: {
        organizer: { select: userLite },
        node: { select: { name: true } },
        rsvps: { where: { userId: me }, select: { status: true } },
        _count: { select: { rsvps: { where: { status: 'GOING' } } } },
      },
    });
    return events.map(({ rsvps, _count, ...e }) => ({ ...e, myRsvp: rsvps[0]?.status ?? null, goingCount: _count.rsvps }));
  });

  app.post('/', { preHandler: requirePerm('event.create') }, async (req) => {
    const me = uid(req);
    const org = orgOf(req);
    const b = parse(eventBody, req.body);
    await assertNodesInOrg(org, [b.nodeId]);
    const event = await prisma.event.create({ data: { ...b, orgId: org, organizerId: me, rsvps: { create: { userId: me, status: 'GOING' } } } });
    // announce in the feed
    await prisma.post.create({ data: { authorId: me, kind: 'EVENT', eventId: event.id, body: `Join us: ${event.title}` } });
    return event;
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const me = uid(req);
    const e = await prisma.event.findFirst({
      where: { id: req.params.id, ...visibleIn(req.orgId) },
      include: {
        organizer: { select: userLite },
        node: { select: { id: true, name: true } },
        rsvps: { where: { status: { not: 'NOT_GOING' } }, include: { user: { select: userLite } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!e) throw notFound('Event');
    return { ...e, myRsvp: e.rsvps.find((r) => r.userId === me)?.status ?? null, canEdit: await canEdit(e, me) };
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req) => {
    const e = await loadEvent(req);
    if (!(await canEdit(e, uid(req)))) throw forbidden();
    const b = parse(eventBody.partial(), req.body);
    if (e.orgId) await assertNodesInOrg(e.orgId, [b.nodeId]);
    return prisma.event.update({ where: { id: e.id }, data: b });
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    const e = await loadEvent(req);
    if (!(await canEdit(e, uid(req)))) throw forbidden();
    await prisma.event.delete({ where: { id: e.id } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/:id/rsvp', async (req) => {
    const me = uid(req);
    const { status } = parse(z.object({ status: z.enum(['GOING', 'INTERESTED', 'NOT_GOING']) }), req.body);
    const e = await loadEvent(req);
    return prisma.eventRsvp.upsert({
      where: { eventId_userId: { eventId: e.id, userId: me } },
      create: { eventId: e.id, userId: me, status },
      update: { status },
    });
  });

  app.post<{ Params: { id: string } }>('/:id/invite', async (req) => {
    const me = uid(req);
    const { userIds } = parse(z.object({ userIds: z.array(z.string()).min(1) }), req.body);
    const e = await loadEvent(req);

    const meUser = await prisma.user.findUniqueOrThrow({ where: { id: me }, select: { name: true } });
    for (const id of userIds) await notify({ recipientId: id, actorId: me, type: 'EVENT_INVITE', text: `${meUser.name} invited you to ${e.title}`, link: `/events/${e.id}` });
    return { ok: true };
  });
};
