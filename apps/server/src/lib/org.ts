import type { FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { HttpError, badRequest, forbidden, notFound } from './http';
import { getDag } from '../dag/cache';

declare module 'fastify' {
  interface FastifyRequest {
    /** Active organization (SOT §14.3); null when the user belongs to none. */
    orgId: string | null;
  }
}

/**
 * Sets req.orgId: the `X-Org-Id` header if the user is an active member of that org, otherwise their
 * earliest active org. Every company-scoped query reads it through `orgOf(req)`.
 */
export async function resolveOrg(req: FastifyRequest): Promise<void> {
  const header = req.headers['x-org-id'];
  const wanted = typeof header === 'string' && header ? header : undefined;
  const m = await prisma.orgMember.findFirst({
    where: { userId: req.user.sub, status: 'ACTIVE', ...(wanted ? { orgId: wanted } : { org: { suspendedAt: null } }) },
    orderBy: { joinedAt: 'asc' },
    select: { orgId: true, org: { select: { suspendedAt: true } } },
  });
  if (wanted && !m) throw forbidden('You are not a member of this organization');
  // Suspended by a platform admin (2b): members are locked out of the org until it is unsuspended.
  if (m?.org.suspendedAt) throw new HttpError(403, 'ORG_SUSPENDED', 'This organization is suspended');
  req.orgId = m?.orgId ?? null;
}

export function orgOf(req: FastifyRequest): string {
  if (!req.orgId) throw forbidden('Join a company to use this');
  return req.orgId;
}

export async function orgsOf(userId: string) {
  const rows = await prisma.orgMember.findMany({
    where: { userId, status: 'ACTIVE', org: { suspendedAt: null } },
    orderBy: { joinedAt: 'asc' },
    select: { org: { select: { id: true, slug: true, name: true, logoUrl: true } } },
  });
  return rows.map((r) => r.org);
}

export async function orgMemberIds(orgId: string): Promise<string[]> {
  const rows = await prisma.orgMember.findMany({ where: { orgId, status: 'ACTIVE' }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** Rows owned by this org or by nobody (public/personal, SOT §14.2) — for Group/Event/Job/Newsletter. */
export const visibleIn = (orgId: string | null) => (orgId ? { OR: [{ orgId }, { orgId: null }] } : { orgId: null });

/**
 * Posts tied to a group/event/job are only visible where that row is (SOT D20). General post visibility
 * (PUBLIC/CONNECTIONS/ORG) is phase 2c.
 */
export const postsVisibleIn = (orgId: string | null): Prisma.PostWhereInput => ({
  AND: [
    { OR: [{ groupId: null }, { group: visibleIn(orgId) }] },
    { OR: [{ eventId: null }, { event: visibleIn(orgId) }] },
    { OR: [{ jobId: null }, { job: visibleIn(orgId) }] },
  ],
});

export async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  return (await prisma.orgMember.count({ where: { orgId, userId, status: 'ACTIVE' } })) > 0;
}

export async function assertNodesInOrg(
orgId: string, nodeIds: (string | null | undefined)[]): Promise<void> {
  const dag = await getDag(orgId);
  for (const id of nodeIds) if (id && !dag.has(id)) throw notFound('Unit');
}

export async function assertOrgMembers(orgId: string, userIds: (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (!ids.length) return;
  const n = await prisma.orgMember.count({ where: { orgId, status: 'ACTIVE', userId: { in: ids } } });
  if (n !== ids.length) throw badRequest('Everyone must be a member of this organization');
}
