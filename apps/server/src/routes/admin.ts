import type { FastifyPluginAsync } from 'fastify';
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PERMISSION_KEYS, PERMISSIONS, PERMISSION_GROUPS, passwordProblem, type Permission } from '@nexus/shared';
import { prisma } from '../lib/db';
import { badRequest, forbidden, notFound, page, pageArgs, parse } from '../lib/http';
import { authenticate, requirePerm, uid } from '../lib/auth';
import { audit, userLite } from '../lib/notify';
import { revokeUserSessions } from '../lib/sessions';
import { can, invalidateRbac, permissionsOf } from '../rbac';
import { env } from '../lib/env';
import { exportFileName, exportUser } from '../lib/export';
import { lastPurge } from '../lib/retention';

/** Temporary password that satisfies the password policy (SOT §8): upper, lower, digit, symbol, 14 chars. */
export function tempPassword(): string {
  const pick = (set: string) => set[randomInt(set.length)];
  const body = Array.from({ length: 10 }, () => pick('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789')).join('');
  const pw = `Nx-${pick('ABCDEFGHJKLMNPQRSTUVWXYZ')}${body}${pick('23456789')}`;
  if (passwordProblem(pw) || !/[a-z]/.test(pw)) return tempPassword();
  return pw;
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.get('/permissions', async () => ({ permissions: PERMISSIONS, groups: PERMISSION_GROUPS }));

  // ───────── Users ─────────
  app.get<{ Querystring: { q?: string; cursor?: string; limit?: string } }>(
    '/users',
    { preHandler: requirePerm('users.manage') },
    async (req) => {
      const { limit, ...args } = pageArgs(req.query, 30);
      const q = req.query.q?.trim();
      const rows = await prisma.user.findMany({
        ...args,
        where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {},
        orderBy: { id: 'asc' },
        select: {
          ...userLite, email: true, isActive: true, isSuperAdmin: true, createdAt: true, lastSeenAt: true,
          memberships: { select: { title: true, isPrimary: true, node: { select: { id: true, name: true } } } },
          grants: { select: { id: true, role: { select: { name: true } }, node: { select: { name: true } } } },
        },
      });
      return page(rows, limit);
    },
  );

  app.post('/users', { preHandler: requirePerm('users.manage') }, async (req) => {
    const body = parse(
      z.object({
        email: z.string().email(),
        name: z.string().trim().min(1).max(120),
        headline: z.string().max(220).nullish(),
        nodeIds: z.array(z.string()).min(1, 'Place the employee in at least one unit'),
        title: z.string().max(120).nullish(),
      }),
      req.body,
    );
    const password = tempPassword();
    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        name: body.name,
        headline: body.headline ?? body.title,
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePassword: true,
        memberships: { create: body.nodeIds.map((nodeId, i) => ({ nodeId, title: body.title, isPrimary: i === 0 })) },
      },
      select: { ...userLite, email: true },
    });
    invalidateRbac();
    await audit(uid(req), 'user.invite', user.id, { email: user.email });
    // Shown once to the admin to hand over; the user must change it on first login.
    return { user, temporaryPassword: password };
  });

  app.patch<{ Params: { id: string } }>('/users/:id', { preHandler: requirePerm('users.manage') }, async (req) => {
    const body = parse(
      z.object({ isActive: z.boolean().optional(), isSuperAdmin: z.boolean().optional(), name: z.string().min(1).optional() }),
      req.body,
    );
    if (body.isSuperAdmin !== undefined && !(await can(uid(req), 'admin.all'))) throw forbidden('Only super admins can change super-admin status');
    if (req.params.id === uid(req) && body.isActive === false) throw badRequest('You cannot deactivate yourself');
    const user = await prisma.user.update({ where: { id: req.params.id }, data: body, select: { ...userLite, isActive: true, isSuperAdmin: true } });
    if (body.isActive === false) await revokeUserSessions(user.id);
    invalidateRbac();
    await audit(uid(req), 'user.update', user.id, body);
    return user;
  });

  app.post<{ Params: { id: string } }>('/users/:id/reset-password', { preHandler: requirePerm('users.manage') }, async (req) => {
    const password = tempPassword();
    await prisma.user.update({
      where: { id: req.params.id },
      data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true },
    });
    await revokeUserSessions(req.params.id);
    await audit(uid(req), 'user.reset_password', req.params.id);
    return { temporaryPassword: password };
  });

  app.get<{ Params: { id: string } }>('/users/:id/permissions', { preHandler: requirePerm('users.manage') }, async (req) => ({
    permissions: await permissionsOf(req.params.id),
  }));

  /** Export any employee's data (SOT §8); audited as `user.export`. */
  app.get<{ Params: { id: string } }>('/users/:id/export', { preHandler: requirePerm('users.manage') }, async (req, reply) => {
    const data = await exportUser(uid(req), req.params.id);
    reply.header('Content-Disposition', `attachment; filename="${exportFileName(data.profile.name)}"`);
    return data;
  });

  /** Current retention settings (env, SOT §11) and the last purge run. */
  app.get('/retention', { preHandler: requirePerm('users.manage') }, async () => ({ policy: env.retention, lastRun: lastPurge() }));

  // ───────── Roles ─────────
  const roleBody = z.object({
    name: z.string().trim().min(1).max(60),
    description: z.string().max(300).nullish(),
    permissions: z.array(z.string()).refine((ps) => ps.every((p) => PERMISSION_KEYS.includes(p as Permission)), 'Unknown permission'),
  });

  app.get('/roles', async () =>
    prisma.role.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }], include: { _count: { select: { grants: true } } } }),
  );

  app.post('/roles', { preHandler: requirePerm('roles.manage') }, async (req) => {
    const body = parse(roleBody, req.body);
    if (body.permissions.includes('admin.all') && !(await can(uid(req), 'admin.all'))) throw forbidden('Only super admins can grant admin.all');
    const role = await prisma.role.create({ data: body });
    await audit(uid(req), 'role.create', role.id, body);
    return role;
  });

  app.patch<{ Params: { id: string } }>('/roles/:id', { preHandler: requirePerm('roles.manage') }, async (req) => {
    const body = parse(roleBody.partial(), req.body);
    if (body.permissions?.includes('admin.all') && !(await can(uid(req), 'admin.all'))) throw forbidden('Only super admins can grant admin.all');
    const role = await prisma.role.update({ where: { id: req.params.id }, data: body });
    invalidateRbac();
    await audit(uid(req), 'role.update', role.id, body);
    return role;
  });

  app.delete<{ Params: { id: string } }>('/roles/:id', { preHandler: requirePerm('roles.manage') }, async (req) => {
    const role = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!role) throw notFound('Role');
    if (role.isSystem) throw badRequest('System roles cannot be deleted (you can edit them)');
    await prisma.role.delete({ where: { id: role.id } });
    invalidateRbac();
    await audit(uid(req), 'role.delete', role.id, { name: role.name });
    return { ok: true };
  });

  // ───────── Grants (role ↔ node [↔ user]) ─────────
  app.get('/grants', { preHandler: requirePerm('roles.manage') }, async () =>
    prisma.roleGrant.findMany({
      orderBy: { createdAt: 'desc' },
      include: { role: { select: { id: true, name: true } }, node: { select: { id: true, name: true } }, user: { select: userLite } },
    }),
  );

  app.post('/grants', { preHandler: requirePerm('roles.manage') }, async (req) => {
    const body = parse(z.object({ roleId: z.string(), nodeId: z.string(), userId: z.string().nullish() }), req.body);
    const role = await prisma.role.findUnique({ where: { id: body.roleId } });
    if (!role) throw notFound('Role');
    // You can only grant a role inside a scope where you yourself manage roles.
    if (!(await can(uid(req), 'roles.manage', [body.nodeId]))) throw forbidden('You cannot grant roles in this unit');
    if (role.permissions.includes('admin.all') && !(await can(uid(req), 'admin.all'))) throw forbidden('Only super admins can grant Super Admin');
    const grant = await prisma.roleGrant.create({ data: { roleId: body.roleId, nodeId: body.nodeId, userId: body.userId ?? null } });
    invalidateRbac();
    await audit(uid(req), 'grant.create', grant.id, body);
    return grant;
  });

  app.delete<{ Params: { id: string } }>('/grants/:id', { preHandler: requirePerm('roles.manage') }, async (req) => {
    const grant = await prisma.roleGrant.delete({ where: { id: req.params.id } });
    invalidateRbac();
    await audit(uid(req), 'grant.delete', grant.id, { roleId: grant.roleId, nodeId: grant.nodeId, userId: grant.userId });
    return { ok: true };
  });

  // ───────── Audit & analytics ─────────
  app.get<{ Querystring: { cursor?: string; limit?: string } }>('/audit', { preHandler: requirePerm('analytics.view') }, async (req) => {
    const { limit, ...args } = pageArgs(req.query, 50);
    const rows = await prisma.auditLog.findMany({ ...args, orderBy: { createdAt: 'desc' }, include: { actor: { select: userLite } } });
    return page(rows, limit);
  });

  app.get('/analytics', { preHandler: requirePerm('analytics.view') }, async () => {
    const dayAgo = new Date(Date.now() - 864e5);
    const weekAgo = new Date(Date.now() - 7 * 864e5);
    const [users, activeDay, activeWeek, posts, postsWeek, comments, reactions, openReports, topTags, perDay] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { lastSeenAt: { gte: dayAgo } } }),
      prisma.user.count({ where: { lastSeenAt: { gte: weekAgo } } }),
      prisma.post.count(),
      prisma.post.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.comment.count(),
      prisma.reaction.count(),
      prisma.report.count({ where: { status: 'OPEN' } }),
      prisma.hashtag.findMany({ take: 10, orderBy: { posts: { _count: 'desc' } }, select: { tag: true, _count: { select: { posts: true } } } }),
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, count(*) AS count
        FROM "Post" WHERE "createdAt" >= ${new Date(Date.now() - 14 * 864e5)}
        GROUP BY 1 ORDER BY 1`,
    ]);
    return {
      users, activeDay, activeWeek, posts, postsWeek, comments, reactions, openReports,
      topHashtags: topTags.map((t) => ({ tag: t.tag, count: t._count.posts })),
      // every one of the last 14 days, zero-filled, so the chart reads as a trend
      postsPerDay: Array.from({ length: 14 }, (_, i) => {
        const day = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10);
        const hit = perDay.find((r) => r.day.toISOString().slice(0, 10) === day);
        return { day, count: hit ? Number(hit.count) : 0 };
      }),
    };
  });
};
