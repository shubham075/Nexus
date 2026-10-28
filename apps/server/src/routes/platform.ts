import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { badRequest, forbidden, notFound, page, pageArgs, parse } from '../lib/http';
import { authenticate, uid } from '../lib/auth';
import { env } from '../lib/env';
import { revokeUserSessions } from '../lib/sessions';
import { invalidateRbac } from '../rbac';

/** Platform admin console (multi mode, SOT §14.2): User.isSuperAdmin runs the platform, not any one company. */

async function requirePlatformAdmin(req: FastifyRequest) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: uid(req) }, select: { isSuperAdmin: true } });
  if (!u.isSuperAdmin) throw forbidden('Platform admins only');
}

const suspendBody = z.object({ suspended: z.boolean() });

export const platformRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async () => {
    if (env.tenancy !== 'multi') throw notFound('Route');
  });
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requirePlatformAdmin);

  app.get<{ Querystring: { q?: string; cursor?: string; limit?: string } }>('/orgs', async (req) => {
    const { limit, ...args } = pageArgs(req.query, 30);
    const q = req.query.q?.trim();
    const rows = await prisma.organization.findMany({
      where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q.toLowerCase() } }] } : {},
      orderBy: { id: 'desc' },
      select: {
        id: true, slug: true, name: true, createdAt: true, suspendedAt: true,
        _count: { select: { members: { where: { status: 'ACTIVE' } } } },
      },
      ...args,
    });
    const { items, nextCursor } = page(rows, limit);
    return { items: items.map(({ _count, ...o }) => ({ ...o, memberCount: _count.members })), nextCursor };
  });

  app.post<{ Params: { id: string } }>('/orgs/:id/suspend', async (req) => {
    const { suspended } = parse(suspendBody, req.body);
    const org = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!org) throw notFound('Organization');
    invalidateRbac(org.id);
    return prisma.organization.update({
      where: { id: org.id },
      data: { suspendedAt: suspended ? new Date() : null },
      select: { id: true, slug: true, name: true, suspendedAt: true },
    });
  });

  app.get<{ Querystring: { q?: string; cursor?: string; limit?: string } }>('/users', async (req) => {
    const { limit, ...args } = pageArgs(req.query, 30);
    const q = req.query.q?.trim();
    const rows = await prisma.user.findMany({
      where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q.toLowerCase() } }] } : {},
      orderBy: { id: 'desc' },
      select: { id: true, name: true, email: true, isActive: true, isSuperAdmin: true, emailVerifiedAt: true, createdAt: true },
      ...args,
    });
    return page(rows, limit);
  });

  /** Suspending a user deactivates the account and signs it out everywhere. */
  app.post<{ Params: { id: string } }>('/users/:id/suspend', async (req) => {
    const { suspended } = parse(suspendBody, req.body);
    if (req.params.id === uid(req)) throw badRequest('You cannot suspend yourself');
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!user) throw notFound('User');
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { isActive: !suspended },
      select: { id: true, name: true, email: true, isActive: true },
    });
    if (suspended) await revokeUserSessions(user.id);
    return updated;
  });
};
