import type { Permission } from '@nexus/shared';
import { prisma } from '../lib/db';
import { getDag } from '../dag/cache';
import { resolveCan, effectivePermissions, type Grant, type Subject } from './resolve';

let grantsCache: Promise<Grant[]> | null = null;

function allGrants(): Promise<Grant[]> {
  grantsCache ??= prisma.roleGrant
    .findMany({ select: { nodeId: true, userId: true, role: { select: { permissions: true } } } })
    .then((rows) => rows.map((r) => ({ nodeId: r.nodeId, userId: r.userId, permissions: r.role.permissions })))
    .catch((e) => {
      grantsCache = null;
      throw e;
    });
  return grantsCache;
}

/** Call after any change to roles, grants, memberships or hierarchy. */
export function invalidateRbac(): void {
  grantsCache = null;
}

export async function subjectFor(userId: string): Promise<Subject> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { isSuperAdmin: true, memberships: { select: { nodeId: true } } },
  });
  return { userId, isSuperAdmin: u.isSuperAdmin, memberNodes: u.memberships.map((m) => m.nodeId) };
}

export async function memberNodesOf(userId: string): Promise<string[]> {
  const ms = await prisma.membership.findMany({ where: { userId }, select: { nodeId: true } });
  return ms.map((m) => m.nodeId);
}

export async function can(userId: string, perm: Permission, targetNodes?: string[]): Promise<boolean> {
  const [dag, grants, subject] = await Promise.all([getDag(), allGrants(), subjectFor(userId)]);
  return resolveCan(dag, subject, grants, perm, targetNodes);
}

/** Moderation-style check against the author of a piece of content. */
export async function canOverUser(actorId: string, perm: Permission, targetUserId: string): Promise<boolean> {
  return can(actorId, perm, await memberNodesOf(targetUserId));
}

export async function permissionsOf(userId: string): Promise<string[]> {
  const [dag, grants, subject] = await Promise.all([getDag(), allGrants(), subjectFor(userId)]);
  return effectivePermissions(dag, subject, grants);
}
