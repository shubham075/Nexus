import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { forbidden, notFound, parse } from '../lib/http';
import { authenticate, requirePerm, uid } from '../lib/auth';
import { notify, userLite } from '../lib/notify';
import { can } from '../rbac';

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

export const eventRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.get<{ Querystring: { past?: string } }>('/', async (req) => {
    const me = uid(req);
    const now = new Date();
    const events = await prisma.event.findMany({
      where: req.query.past === 'true' ? { startsAt: { lt: now } } : { startsAt: { gte: new Date(now.getTime() - 3 * 36e5) } },
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
    const b = parse(eventBody, req.body);
    const event = await prisma.event.create({ data: { ...b, organizerId: me, rsvps: { create: { userId: me, status: 'GOING' } } } });
    // announce in the feed
    await prisma.post.create({ data: { authorId: me, kind: 'EVENT', eventId: event.id, body: `Join us: ${event.title}` } });
    return event;
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const me = uid(req);
    const e = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: {
        organizer: { select: userLite },
        node: { select: { id: true, name: true } },
        rsvps: { where: { status: { not: 'NOT_GOING' } }, include: { user: { select: userLite } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!e) throw notFound('Event');
    return { ...e, myRsvp: e.rsvps.find((r) => r.userId === me)?.status ?? null, canEdit: e.organizerId === me || (await can(me, 'admin.all')) };
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req) => {
    const e = await prisma.event.findUniqueOrThrow({ where: { id: req.params.id } });
    if (e.organizerId !== uid(req) && !(await can(uid(req), 'admin.all'))) throw forbidden();
    return prisma.event.update({ where: { id: e.id }, data: parse(eventBody.partial(), req.body) });
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    const e = await prisma.event.findUniqueOrThrow({ where: { id: req.params.id } });
    if (e.organizerId !== uid(req) && !(await can(uid(req), 'admin.all'))) throw forbidden();
    await prisma.event.delete({ where: { id: e.id } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/:id/rsvp', async (req) => {
    const me = uid(req);
    const { status } = parse(z.object({ status: z.enum(['GOING', 'INTERESTED', 'NOT_GOING']) }), req.body);
    return prisma.eventRsvp.upsert({
      where: { eventId_userId: { eventId: req.params.id, userId: me } },
      create: { eventId: req.params.id, userId: me, status },
      update: { status },
    });
  });

  app.post<{ Params: { id: string } }>('/:id/invite', async (req) => {
    const me = uid(req);
    const { userIds } = parse(z.object({ userIds: z.array(z.string()).min(1) }), req.body);
    const e = await prisma.event.findUniqueOrThrow({ where: { id: req.params.id } });
    const meUser = await prisma.user.findUniqueOrThrow({ where: { id: me }, select: { name: true } });
    for (const id of userIds) await notify({ recipientId: id, actorId: me, type: 'EVENT_INVITE', text: `${meUser.name} invited you to ${e.title}`, link: `/events/${e.id}` });
    return { ok: true };
  });
};
