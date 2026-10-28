import type { Permission } from '@nexus/shared';
import { prisma } from '../lib/db';
import { env } from '../lib/env';
import { getDag } from '../dag/cache';
import { resolveCan, resolveScope, effectivePermissions, type Grant, type Subject } from './resolve';

/** Grants per organization (SOT §14.3): only grants on that org's units count there. */
const grantsCache = new Map<string, Promise<Grant[]>>();

function orgGrants(orgId: string): Promise<Grant[]> {
  let grants = grantsCache.get(orgId);
  if (!grants) {
    grants = prisma.roleGrant
      .findMany({ where: { node: { orgId } }, select: { nodeId: true, userId: true, role: { select: { permissions: true } } } })
      .then((rows) => rows.map((r) => ({ nodeId: r.nodeId, userId: r.userId, permissions: r.role.permissions })))
      .catch((e) => {
        grantsCache.delete(orgId);
        throw e;
      });
    grantsCache.set(orgId, grants);
  }
  return grants;
}

/** Call after any change to roles, grants, memberships or hierarchy; no id clears every org. */
export function invalidateRbac(orgId?: string): void {
  if (orgId) grantsCache.delete(orgId);
  else grantsCache.clear();
}

/**
 * The user as seen inside one org. `isSuperAdmin` here means "bypasses checks in this org": the org-admin
 * shortcut, or User.isSuperAdmin in single mode (in multi mode that flag is the platform admin, SOT §14.2).
 */
export async function subjectFor(userId: string, orgId: string): Promise<Subject> {
  const [u, member, memberNodes] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { isSuperAdmin: true } }),
    prisma.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } }, select: { status: true, isOrgAdmin: true } }),
    memberNodesOf(userId, orgId),
  ]);
  if (member?.status !== 'ACTIVE') return { userId, isSuperAdmin: false, memberNodes: [] };
  return { userId, isSuperAdmin: member.isOrgAdmin || (env.tenancy === 'single' && u.isSuperAdmin), memberNodes };
}

export async function memberNodesOf(userId: string, orgId: string): Promise<string[]> {
  const ms = await prisma.membership.findMany({ where: { userId, node: { orgId } }, select: { nodeId: true } });
  return ms.map((m) => m.nodeId);
}

export async function can(userId: string, orgId: string, perm: Permission, targetNodes?: string[]): Promise<boolean> {
  const [dag, grants, subject] = await Promise.all([getDag(orgId), orgGrants(orgId), subjectFor(userId, orgId)]);
  return resolveCan(dag, subject, grants, perm, targetNodes);
}

/** Moderation-style check against the author of a piece of content. Authors outside this org are out of reach. */
export async function canOverUser(actorId: string, orgId: string, perm: Permission, targetUserId: string): Promise<boolean> {
  const targetNodes = await memberNodesOf(targetUserId, orgId);
  return targetNodes.length > 0 && can(actorId, orgId, perm, targetNodes);
}

/** Units a permission covers for this user ('ALL' = company-wide). See resolveScope. */
export async function permissionScope(userId: string, orgId: string, perm: Permission): Promise<'ALL' | Set<string>> {
  const [dag, grants, subject] = await Promise.all([getDag(orgId), orgGrants(orgId), subjectFor(userId, orgId)]);
  return resolveScope(dag, subject, grants, perm);
}

export async function permissionsOf(userId: string, orgId: string): Promise<string[]> {
  const [dag, grants, subject] = await Promise.all([getDag(orgId), orgGrants(orgId), subjectFor(userId, orgId)]);
  return effectivePermissions(dag, subject, grants);
}
