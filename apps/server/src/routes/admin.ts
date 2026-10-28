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
import { can, invalidateRbac, permissionScope, permissionsOf } from '../rbac';
import { env } from '../lib/env';
import { exportFileName, exportUser } from '../lib/export';
import { lastPurge } from '../lib/retention';
import { assertNodesInOrg, assertOrgMembers, orgMemberIds, orgOf } from '../lib/org';

/** Temporary password that satisfies the password policy (SOT §8): upper, lower, digit, symbol, 14 chars. */
export function tempPassword(): string {
  const pick = (set: string) => set[randomInt(set.length)];
  const body = Array.from({ length: 10 }, () => pick('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789')).join('');
  const pw = `Nx-${pick('ABCDEFGHJKLMNPQRSTUVWXYZ')}${body}${pick('23456789')}`;
  if (passwordProblem(pw) || !/[a-z]/.test(pw)) return tempPassword();
  return pw;
}

/** User.isSuperAdmin is the company super admin in single mode and the platform admin in multi mode (SOT §14.2). */
async function canSetSuperAdmin(actorId: string, orgId: string): Promise<boolean> {
  if (env.tenancy === 'single') return can(actorId, orgId, 'admin.all');
  return (await prisma.user.findUniqueOrThrow({ where: { id: actorId }, select: { isSuperAdmin: true } })).isSuperAdmin;
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.get('/permissions', async () => ({ permissions: PERMISSIONS, groups: PERMISSION_GROUPS }));

  // ───────── Users ─────────
  app.get<{ Querystring: { q?: string; cursor?: string; limit?: string } }>(
    '/users',
    { preHandler: requirePerm('users.manage') },
    async (req) => {
      const org = orgOf(req);
      const { limit, ...args } = pageArgs(req.query, 30);
      const q = req.query.q?.trim();
      const rows = await prisma.user.findMany({
        ...args,
        where: {
          orgMemberships: { some: { orgId: org, status: 'ACTIVE' } },
          ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}),
        },
        orderBy: { id: 'asc' },
        select: {
          ...userLite, email: true, isActive: true, isSuperAdmin: true, createdAt: true, lastSeenAt: true,
          memberships: { where: { node: { orgId: org } }, select: { title: true, isPrimary: true, node: { select: { id: true, name: true } } } },
          grants: { where: { node: { orgId: org } }, select: { id: true, role: { select: { name: true } }, node: { select: { name: true } } } },
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
    const org = orgOf(req);
    await assertNodesInOrg(org, body.nodeIds);
    const password = tempPassword();
    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        name: body.name,
        headline: body.headline ?? body.title,
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePassword: true,
        memberships: { create: body.nodeIds.map((nodeId, i) => ({ nodeId, title: body.title, isPrimary: i === 0 })) },
        orgMemberships: { create: { orgId: org } },
      },
      select: { ...userLite, email: true },
    });
    invalidateRbac(org);
    await audit(org, uid(req), 'user.invite', user.id, { email: user.email });
    // Shown once to the admin to hand over; the user must change it on first login.
    return { user, temporaryPassword: password };
  });

  app.patch<{ Params: { id: string } }>('/users/:id', { preHandler: requirePerm('users.manage') }, async (req) => {
    const body = parse(
      z.object({ isActive: z.boolean().optional(), isSuperAdmin: z.boolean().optional(), name: z.string().min(1).optional() }),
      req.body,
    );
    const org = orgOf(req);
    await assertOrgMembers(org, [req.params.id]);
    if (body.isSuperAdmin !== undefined && !(await canSetSuperAdmin(uid(req), org))) throw forbidden('Only super admins can change super-admin status');
    if (req.params.id === uid(req) && body.isActive === false) throw badRequest('You cannot deactivate yourself');
    const user = await prisma.user.update({ where: { id: req.params.id }, data: body, select: { ...userLite, isActive: true, isSuperAdmin: true } });
    if (body.isActive === false) await revokeUserSessions(user.id);
    invalidateRbac(org);
    await audit(org, uid(req), 'user.update', user.id, body);
    return user;
  });

  app.post<{ Params: { id: string } }>('/users/:id/reset-password', { preHandler: requirePerm('users.manage') }, async (req) => {
    const org = orgOf(req);
    await assertOrgMembers(org, [req.params.id]);
    const password = tempPassword();
    await prisma.user.update({
      where: { id: req.params.id },
      data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true },
    });
    await revokeUserSessions(req.params.id);
    await audit(org, uid(req), 'user.reset_password', req.params.id);
    return { temporaryPassword: password };
  });

  app.get<{ Params: { id: string } }>('/users/:id/permissions', { preHandler: requirePerm('users.manage') }, async (req) => {
    const org = orgOf(req);
    await assertOrgMembers(org, [req.params.id]);
    return { permissions: await permissionsOf(req.params.id, org) };
  });

  /** Export any employee's data (SOT §8); audited as `user.export`. */
  app.get<{ Params: { id: string } }>('/users/:id/export', { preHandler: requirePerm('users.manage') }, async (req, reply) => {
    const org = orgOf(req);
    await assertOrgMembers(org, [req.params.id]);
    const data = await exportUser(uid(req), req.params.id, org);
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

  app.get('/roles', async (req) =>
    prisma.role.findMany({ where: { orgId: orgOf(req) }, orderBy: [{ isSystem: 'desc' }, { name: 'asc' }], include: { _count: { select: { grants: true } } } }),
  );

  app.post('/roles', { preHandler: requirePerm('roles.manage') }, async (req) => {
    const org = orgOf(req);
    const body = parse(roleBody, req.body);
    if (body.permissions.includes('admin.all') && !(await can(uid(req), org, 'admin.all'))) throw forbidden('Only super admins can grant admin.all');
    const role = await prisma.role.create({ data: { ...body, orgId: org } });
    await audit(org, uid(req), 'role.create', role.id, body);
    return role;
  });

  app.patch<{ Params: { id: string } }>('/roles/:id', { preHandler: requirePerm('roles.manage') }, async (req) => {
    const org = orgOf(req);
    const body = parse(roleBody.partial(), req.body);
    if (body.permissions?.includes('admin.all') && !(await can(uid(req), org, 'admin.all'))) throw forbidden('Only super admins can grant admin.all');
    if (!(await prisma.role.count({ where: { id: req.params.id, orgId: org } }))) throw notFound('Role');
    const role = await prisma.role.update({ where: { id: req.params.id }, data: body });
    invalidateRbac(org);
    await audit(org, uid(req), 'role.update', role.id, body);
    return role;
  });

  app.delete<{ Params: { id: string } }>('/roles/:id', { preHandler: requirePerm('roles.manage') }, async (req) => {
    const org = orgOf(req);
    const role = await prisma.role.findFirst({ where: { id: req.params.id, orgId: org } });
    if (!role) throw notFound('Role');
    if (role.isSystem) throw badRequest('System roles cannot be deleted (you can edit them)');
    await prisma.role.delete({ where: { id: role.id } });
    invalidateRbac(org);
    await audit(org, uid(req), 'role.delete', role.id, { name: role.name });
    return { ok: true };
  });

  // ───────── Grants (role ↔ node [↔ user]) ─────────
  app.get('/grants', { preHandler: requirePerm('roles.manage') }, async (req) =>
    prisma.roleGrant.findMany({
      where: { role: { orgId: orgOf(req) } },
      orderBy: { createdAt: 'desc' },
      include: { role: { select: { id: true, name: true } }, node: { select: { id: true, name: true } }, user: { select: userLite } },
    }),
  );

  app.post('/grants', { preHandler: requirePerm('roles.manage') }, async (req) => {
    const org = orgOf(req);
    const body = parse(z.object({ roleId: z.string(), nodeId: z.string(), userId: z.string().nullish() }), req.body);
    const role = await prisma.role.findFirst({ where: { id: body.roleId, orgId: org } });
    if (!role) throw notFound('Role');
    await assertNodesInOrg(org, [body.nodeId]);
    await assertOrgMembers(org, [body.userId]);
    // You can only grant a role inside a scope where you yourself manage roles.
    if (!(await can(uid(req), org, 'roles.manage', [body.nodeId]))) throw forbidden('You cannot grant roles in this unit');
    if (role.permissions.includes('admin.all') && !(await can(uid(req), org, 'admin.all'))) throw forbidden('Only super admins can grant Super Admin');
    const grant = await prisma.roleGrant.create({ data: { roleId: body.roleId, nodeId: body.nodeId, userId: body.userId ?? null } });
    invalidateRbac(org);
    await audit(org, uid(req), 'grant.create', grant.id, body);
    return grant;
  });

  app.delete<{ Params: { id: string } }>('/grants/:id', { preHandler: requirePerm('roles.manage') }, async (req) => {
    const org = orgOf(req);
    if (!(await prisma.roleGrant.count({ where: { id: req.params.id, role: { orgId: org } } }))) throw notFound('Grant');
    const grant = await prisma.roleGrant.delete({ where: { id: req.params.id } });
    invalidateRbac(org);
    await audit(org, uid(req), 'grant.delete', grant.id, { roleId: grant.roleId, nodeId: grant.nodeId, userId: grant.userId });
    return { ok: true };
  });

  // ───────── Audit & analytics ─────────
  app.get<{ Querystring: { cursor?: string; limit?: string } }>('/audit', { preHandler: requirePerm('analytics.view') }, async (req) => {
    // The audit log is company-wide; managers with unit-scoped analytics do not get it.
    const org = orgOf(req);
    if ((await permissionScope(uid(req), org, 'analytics.view')) !== 'ALL') throw forbidden('The audit log is available to company-wide admins only');
    const { limit, ...args } = pageArgs(req.query, 50);
    const rows = await prisma.auditLog.findMany({ ...args, where: { orgId: org }, orderBy: { createdAt: 'desc' }, include: { actor: { select: userLite } } });
    return page(rows, limit);
  });

  /** Company-wide for admins; managers granted analytics.view on a unit see only that unit's sub-DAG (SOT D18). */
  app.get('/analytics', { preHandler: requirePerm('analytics.view') }, async (req) => {
    const org = orgOf(req);
    const scope = await permissionScope(uid(req), org, 'analytics.view');
    const scoped = scope !== 'ALL';
    const units = scoped ? await prisma.orgNode.findMany({ where: { id: { in: [...scope] }, orgId: org }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [];
    // Company-wide = everyone in the active org; scoped = members of the covered units (SOT D18, §14.3).
    const ids = scoped
      ? [...new Set((await prisma.membership.findMany({ where: { nodeId: { in: [...scope] }, node: { orgId: org } }, select: { userId: true } })).map((m) => m.userId))]
      : await orgMemberIds(org);
    // Each metric counts activity by people inside the scope.
    const byUser = { id: { in: ids } };
    const byAuthor = { authorId: { in: ids } };
    const byActor = { userId: { in: ids } };
    const dayAgo = new Date(Date.now() - 864e5);
    const weekAgo = new Date(Date.now() - 7 * 864e5);
    const since = new Date(Date.now() - 14 * 864e5);
    const [users, activeDay, activeWeek, posts, postsWeek, comments, reactions, openReports, topTags, perDay] = await Promise.all([
      prisma.user.count({ where: { isActive: true, ...byUser } }),
      prisma.user.count({ where: { lastSeenAt: { gte: dayAgo }, ...byUser } }),
      prisma.user.count({ where: { lastSeenAt: { gte: weekAgo }, ...byUser } }),
      prisma.post.count({ where: byAuthor }),
      prisma.post.count({ where: { createdAt: { gte: weekAgo }, ...byAuthor } }),
      prisma.comment.count({ where: byAuthor }),
      prisma.reaction.count({ where: byActor }),
      prisma.report.count({
        where: { orgId: org, status: 'OPEN', ...(scoped ? { OR: [{ post: byAuthor }, { comment: byAuthor }, { targetUserId: { in: ids } }] } : {}) },
      }),
      prisma.hashtag.findMany({
        take: 10,
        where: { posts: { some: { post: byAuthor } } },
        orderBy: { posts: { _count: 'desc' } },
        select: { tag: true, _count: { select: { posts: { where: { post: byAuthor } } } } },
      }),
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, count(*) AS count
        FROM "Post" WHERE "createdAt" >= ${since} AND "authorId" = ANY(${ids})
        GROUP BY 1 ORDER BY 1`,

    ]);
    return {
      scope: { all: !scoped, units },
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
