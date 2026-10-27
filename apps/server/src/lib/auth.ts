import type { FastifyRequest } from 'fastify';
import type { Permission } from '@nexus/shared';
import { prisma } from './db';
import { HttpError, forbidden } from './http';
import { can } from '../rbac';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export async function authenticate(req: FastifyRequest): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    throw new HttpError(401, 'UNAUTHORIZED', 'Please sign in');
  }
  const u = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { isActive: true } });
  if (!u?.isActive) throw new HttpError(401, 'UNAUTHORIZED', 'Account disabled');
  prisma.user.update({ where: { id: req.user.sub }, data: { lastSeenAt: new Date() } }).catch(() => {});
}

export const uid = (req: FastifyRequest) => req.user.sub;

export function requirePerm(perm: Permission) {
  return async (req: FastifyRequest) => {
    if (!(await can(uid(req), perm))) throw forbidden(`Missing permission: ${perm}`);
  };
}

export async function assertCan(userId: string, perm: Permission, targetNodes?: string[]) {
  if (!(await can(userId, perm, targetNodes))) throw forbidden(`Missing permission: ${perm}`);
}
