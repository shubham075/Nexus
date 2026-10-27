import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/db';
import { page, pageArgs } from '../lib/http';
import { authenticate, uid } from '../lib/auth';
import { userLite } from '../lib/notify';

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.get<{ Querystring: { cursor?: string; limit?: string; unread?: string } }>('/', async (req) => {
    const { limit, ...args } = pageArgs(req.query, 30);
    const rows = await prisma.notification.findMany({
      ...args,
      where: { recipientId: uid(req), ...(req.query.unread === 'true' ? { readAt: null } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { actor: { select: userLite } },
    });
    return page(rows, limit);
  });

  app.get('/unread-count', async (req) => ({
    count: await prisma.notification.count({ where: { recipientId: uid(req), readAt: null } }),
  }));

  app.post<{ Params: { id: string } }>('/:id/read', async (req) => {
    await prisma.notification.updateMany({ where: { id: req.params.id, recipientId: uid(req) }, data: { readAt: new Date() } });
    return { ok: true };
  });

  app.post('/read-all', async (req) => {
    await prisma.notification.updateMany({ where: { recipientId: uid(req), readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    await prisma.notification.deleteMany({ where: { id: req.params.id, recipientId: uid(req) } });
    return { ok: true };
  });
};
