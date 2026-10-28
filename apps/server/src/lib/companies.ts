import { SYSTEM_ROLES } from '@nexus/shared';
import { prisma } from './db';
import { forbidden, notFound } from './http';
import { can, invalidateRbac } from '../rbac';
import { invalidateDag } from '../dag/cache';
export { emailDomain, normalizeDomain } from './domains';

/** Companies (SOT §14, 2b): creation, membership and domain helpers shared by the company routes. */

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export const slugify = (name: string) =>
  name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'company';

async function freeSlug(base: string): Promise<string> {
  for (let i = 0; ; i++) {
    const slug = i ? `${base}-${i + 1}` : base;
    if (!(await prisma.organization.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
}

/**
 * Creates an org the way `prisma/seed.ts` does: a root COMPANY unit, the system roles, Employee granted on
 * the root (so every member gets it) and the creator as org admin + Super Admin on the root.
 */
export async function createOrganization(
  userId: string,
  data: { name: string; slug?: string; about?: string | null; website?: string | null; industry?: string | null; size?: string | null },
) {
  const slug = data.slug ?? (await freeSlug(slugify(data.name)));
  const org = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { slug, name: data.name, about: data.about, website: data.website, industry: data.industry, size: data.size },
    });
    const root = await tx.orgNode.create({ data: { orgId: org.id, name: data.name, type: 'COMPANY', isRoot: true } });
    const roles: Record<string, string> = {};
    for (const r of SYSTEM_ROLES) roles[r.name] = (await tx.role.create({ data: { ...r, orgId: org.id, isSystem: true } })).id;
    await tx.roleGrant.createMany({
      data: [
        { roleId: roles['Employee'], nodeId: root.id },
        { roleId: roles['Super Admin'], nodeId: root.id, userId },
      ],
    });
    await tx.membership.create({ data: { userId, nodeId: root.id, isPrimary: true } });
    await tx.orgMember.create({ data: { orgId: org.id, userId, isOrgAdmin: true } });
    return org;
  });
  invalidateDag(org.id);
  invalidateRbac(org.id);
  return org;
}

/** Makes the user an active member, placed in the root unit if they have no unit in this org yet. */
export async function addOrgMember(orgId: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.orgMember.upsert({
      where: { orgId_userId: { orgId, userId } },
      create: { orgId, userId },
      update: { status: 'ACTIVE', joinedAt: new Date() },
    });
    if (!(await tx.membership.count({ where: { userId, node: { orgId } } }))) {
      const root = await tx.orgNode.findFirstOrThrow({ where: { orgId, isRoot: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      const primary = !(await tx.membership.count({ where: { userId, isPrimary: true } }));
      await tx.membership.create({ data: { userId, nodeId: root.id, isPrimary: primary } });
    }
  });
  invalidateRbac(orgId);
}

/** Company admin = org admin or holder of admin.all in that org. Suspended orgs can't be administered. */
export async function isCompanyAdmin(userId: string, orgId: string): Promise<boolean> {
  return can(userId, orgId, 'admin.all');
}

export async function companyOr404(idOrSlug: string, opts: { includeSuspended?: boolean } = {}) {
  const org = await prisma.organization.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
  if (!org || (org.suspendedAt && !opts.includeSuspended)) throw notFound('Company');
  return org;
}

export async function assertCompanyAdmin(userId: string, idOrSlug: string) {
  const org = await companyOr404(idOrSlug);
  if (!(await isCompanyAdmin(userId, org.id))) throw forbidden('Only company admins can do this');
  return org;
}

/** The org (other than `exceptOrgId`) that has verified this domain, if any. */
export const verifiedOwnerOf = (domain: string, exceptOrgId?: string) =>
  prisma.orgDomain.findFirst({ where: { domain, verifiedAt: { not: null }, ...(exceptOrgId ? { NOT: { orgId: exceptOrgId } } : {}) } });
