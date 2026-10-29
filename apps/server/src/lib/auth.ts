import type { FastifyRequest } from 'fastify';
import type { Permission } from '@nexus/shared';
import { prisma } from './db';
import { HttpError, forbidden } from './http';
import { can } from '../rbac';
import { sessionIsLive } from './sessions';
import { orgOf, resolveOrg } from './org';
import { env } from './env';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    /** `sid` = AuthSession id (SOT §8). */
    payload: { sub: string; sid: string };
    user: { sub: string; sid?: string };
  }
}

export async function authenticate(req: FastifyRequest): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    throw new HttpError(401, 'UNAUTHORIZED', 'Please sign in');
  }
  if (!(await sessionIsLive(req.user.sub, req.user.sid))) throw new HttpError(401, 'UNAUTHORIZED', 'Your session has ended');
  prisma.user.update({ where: { id: req.user.sub }, data: { lastSeenAt: new Date() } }).catch(() => {});
  await resolveOrg(req);
}

export const uid = (req: FastifyRequest) => req.user.sub;

export function requirePerm(perm: Permission) {
  return async (req: FastifyRequest) => {
    if (!(await can(uid(req), orgOf(req), perm))) throw forbidden(`Missing permission: ${perm}`);
  };
}

/**
 * Network actions (posting, commenting): checked against the active org's grants when you have one; in multi
 * mode someone without a company still takes part in the global network (SOT §14.3).
 */
export async function assertNetworkPerm(req: FastifyRequest, perm: Permission) {
  if (!req.orgId && env.tenancy === 'multi') return;
  await assertCan(uid(req), orgOf(req), perm);
}

export async function assertCan(userId: string, orgId: string, perm: Permission, targetNodes?: string[]) {
  if (!(await can(userId, orgId, perm, targetNodes))) throw forbidden(`Missing permission: ${perm}`);
}
