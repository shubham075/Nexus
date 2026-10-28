import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Organization } from '@prisma/client';
import { prisma } from '../lib/db';
import { HttpError, badRequest, conflict, forbidden, notFound, page, pageArgs, parse } from '../lib/http';
import { authenticate, uid } from '../lib/auth';
import { limits } from '../lib/rateLimit';
import { env } from '../lib/env';
import { audit, userLite } from '../lib/notify';
import { newSecret, sha256 } from '../lib/sessions';
import { sendMail } from '../lib/mailer';
import { inviteTemplate } from '../lib/emailTemplates';
import { INVITE_TTL_DAYS, appLink, tokenFrom } from '../lib/emailTokens';
import { domainHasToken, txtRecordFor } from '../lib/domains';
import {
  SLUG_RE, addOrgMember, assertCompanyAdmin, companyOr404, createOrganization, emailDomain, isCompanyAdmin, normalizeDomain,
  verifiedOwnerOf,
} from '../lib/companies';

/** Companies, company pages, domains, join requests and invites (SOT §14, 2b). Multi mode only. */

const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const website = z
  .string().trim().max(300).nullish()
  .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null))
  .refine((v) => !v || z.string().url().safeParse(v).success, 'Enter a valid website');
const profileFields = {
  about: optText(2000),
  website,
  industry: optText(100),
  size: optText(40),
};

const joinPolicy = z.enum(['AUTO', 'APPROVAL', 'INVITE']);

async function myEmail(req: FastifyRequest) {
  return (await prisma.user.findUniqueOrThrow({ where: { id: uid(req) }, select: { email: true } })).email;
}

/** How the viewer may join: AUTO / APPROVAL when their email domain is verified for this org, else null. */
async function joinRoute(org: Organization, email: string): Promise<'AUTO' | 'APPROVAL' | null> {
  if (org.joinPolicy === 'INVITE') return null;
  const match = await prisma.orgDomain.count({ where: { orgId: org.id, domain: emailDomain(email), verifiedAt: { not: null } } });
  return match ? org.joinPolicy : null;
}

async function companyView(org: Organization, req: FastifyRequest) {
  const me = uid(req);
  const [followerCount, memberCount, follow, member, admin, email] = await Promise.all([
    prisma.companyFollow.count({ where: { orgId: org.id } }),
    prisma.orgMember.count({ where: { orgId: org.id, status: 'ACTIVE' } }),
    prisma.companyFollow.findUnique({ where: { userId_orgId: { userId: me, orgId: org.id } } }),
    prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: org.id, userId: me } }, select: { status: true } }),
    isCompanyAdmin(me, org.id),
    myEmail(req),
  ]);
  const myStatus = member?.status === 'LEFT' ? null : member?.status ?? null;
  const { suspendedAt: _s, ...pub } = org;
  return {
    ...pub,
    followerCount,
    memberCount,
    isFollowing: !!follow,
    myStatus,
    isAdmin: admin,
    canJoin: myStatus ? null : await joinRoute(org, email),
  };
}

const companyLite = { id: true, slug: true, name: true, logoUrl: true, industry: true, about: true } as const;

export const companyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async () => {
    if (env.tenancy !== 'multi') throw notFound('Route');
  });
  app.addHook('preHandler', authenticate);

  // ───────── Directory + pages ─────────
  app.get<{ Querystring: { q?: string; cursor?: string; limit?: string } }>('/', async (req) => {
    const { limit, ...args } = pageArgs(req.query);
    const q = req.query.q?.trim();
    const rows = await prisma.organization.findMany({
      where: { suspendedAt: null, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { id: 'desc' },
      select: { ...companyLite, _count: { select: { followers: true } } },
      ...args,
    });
    const { items, nextCursor } = page(rows, limit);
    return { items: items.map(({ _count, ...c }) => ({ ...c, followerCount: _count.followers })), nextCursor };
  });

  /** Companies I belong to, with my status and whether I administer them. */
  app.get('/mine', async (req) => {
    const rows = await prisma.orgMember.findMany({
      where: { userId: uid(req), status: { in: ['ACTIVE', 'PENDING'] }, org: { suspendedAt: null } },
      orderBy: { joinedAt: 'asc' },
      select: { status: true, org: { select: companyLite } },
    });
    return Promise.all(rows.map(async (r) => ({ ...r.org, myStatus: r.status, isAdmin: await isCompanyAdmin(uid(req), r.org.id) })));
  });

  /** A verified user creates a company and becomes its admin (every signed-in user is verified). */
  app.post('/', { config: { rateLimit: limits.companyWrite } }, async (req) => {
    const body = parse(
      z.object({ name: z.string().trim().min(2).max(120), slug: z.string().trim().toLowerCase().regex(SLUG_RE, 'Use lowercase letters, digits and dashes').optional(), ...profileFields }),
      req.body,
    );
    if (body.slug && (await prisma.organization.findUnique({ where: { slug: body.slug }, select: { id: true } }))) {
      throw conflict('That company URL is taken');
    }
    const org = await createOrganization(uid(req), body);
    await audit(org.id, uid(req), 'company.create', org.id);
    return companyView(org, req);
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => companyView(await companyOr404(req.params.id), req));

  app.patch<{ Params: { id: string } }>('/:id', { config: { rateLimit: limits.companyWrite } }, async (req) => {
    const org = await assertCompanyAdmin(uid(req), req.params.id);
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(120).optional(),
        about: profileFields.about.optional(),
        website: profileFields.website.optional(),
        industry: profileFields.industry.optional(),
        size: profileFields.size.optional(),
        logoUrl: z.string().url().nullish(),
        coverUrl: z.string().url().nullish(),
        joinPolicy: joinPolicy.optional(),
      }),
      req.body,
    );
    const updated = await prisma.organization.update({ where: { id: org.id }, data: body });
    await audit(org.id, uid(req), 'company.update', org.id, body);
    return companyView(updated, req);
  });

  // ───────── Follow ─────────
  app.post<{ Params: { id: string } }>('/:id/follow', async (req) => {
    const org = await companyOr404(req.params.id);
    await prisma.companyFollow.upsert({
      where: { userId_orgId: { userId: uid(req), orgId: org.id } },
      create: { userId: uid(req), orgId: org.id },
      update: {},
    });
    return { following: true, followerCount: await prisma.companyFollow.count({ where: { orgId: org.id } }) };
  });

  app.delete<{ Params: { id: string } }>('/:id/follow', async (req) => {
    const org = await companyOr404(req.params.id);
    await prisma.companyFollow.deleteMany({ where: { userId: uid(req), orgId: org.id } });
    return { following: false, followerCount: await prisma.companyFollow.count({ where: { orgId: org.id } }) };
  });

  // ───────── Domains (DNS TXT verification, SOT D22) ─────────
  const domainView = (d: { id: string; domain: string; verificationToken: string; verifiedAt: Date | null }) => ({
    id: d.id,
    domain: d.domain,
    verifiedAt: d.verifiedAt,
    txtName: d.domain,
    txtValue: txtRecordFor(d.verificationToken),
  });

  app.get<{ Params: { id: string } }>('/:id/domains', async (req) => {
    const org = await assertCompanyAdmin(uid(req), req.params.id);
    const rows = await prisma.orgDomain.findMany({ where: { orgId: org.id }, orderBy: { createdAt: 'asc' } });
    return rows.map(domainView);
  });

  app.post<{ Params: { id: string } }>('/:id/domains', { config: { rateLimit: limits.companyWrite } }, async (req) => {
    const org = await assertCompanyAdmin(uid(req), req.params.id);
    const { domain: raw } = parse(z.object({ domain: z.string().max(260) }), req.body);
    const domain = normalizeDomain(raw);
    if (!domain) throw badRequest('Enter a domain like acme.com');
    if (await verifiedOwnerOf(domain, org.id)) throw conflict('Another company has already verified this domain');
    if (await prisma.orgDomain.findUnique({ where: { orgId_domain: { orgId: org.id, domain } } })) throw conflict('Domain already added');
    const d = await prisma.orgDomain.create({ data: { orgId: org.id, domain, verificationToken: newSecret().slice(0, 32) } });
    await audit(org.id, uid(req), 'company.domain.add', d.id, { domain });
    return domainView(d);
  });

  app.post<{ Params: { id: string; domainId: string } }>('/:id/domains/:domainId/verify', { config: { rateLimit: limits.companyWrite } }, async (req) => {
    const org = await assertCompanyAdmin(uid(req), req.params.id);
    const d = await prisma.orgDomain.findFirst({ where: { id: req.params.domainId, orgId: org.id } });
    if (!d) throw notFound('Domain');
    if (d.verifiedAt) return domainView(d);
    if (await verifiedOwnerOf(d.domain, org.id)) throw conflict('Another company has already verified this domain');
    if (!(await domainHasToken(d.domain, d.verificationToken))) {
      throw new HttpError(400, 'DOMAIN_NOT_VERIFIED', `TXT record not found on ${d.domain}. DNS changes can take a while; try again later.`);
    }
    const verified = await prisma.orgDomain.update({ where: { id: d.id }, data: { verifiedAt: new Date() } });
    await audit(org.id, uid(req), 'company.domain.verify', d.id, { domain: d.domain });
    return domainView(verified);
  });

  app.delete<{ Params: { id: string; domainId: string } }>('/:id/domains/:domainId', async (req) => {
    const org = await assertCompanyAdmin(uid(req), req.params.id);
    const { count } = await prisma.orgDomain.deleteMany({ where: { id: req.params.domainId, orgId: org.id } });
    if (!count) throw notFound('Domain');
    await audit(org.id, uid(req), 'company.domain.remove', req.params.domainId);
    return { ok: true };
  });

  // ───────── Joining ─────────
  /** Verified-domain members join directly (AUTO) or ask (APPROVAL); everyone else needs an invite. */
  app.post<{ Params: { id: string } }>('/:id/join', { config: { rateLimit: limits.companyWrite } }, async (req) => {
    const org = await companyOr404(req.params.id);
    const me = uid(req);
    const current = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: org.id, userId: me } } });
    if (current?.status === 'ACTIVE') return { status: 'ACTIVE' };
    if (current?.status === 'PENDING') return { status: 'PENDING' };
    const route = await joinRoute(org, await myEmail(req));
    if (!route) throw forbidden('This company is invite-only for your email address');
    if (route === 'AUTO') {
      await addOrgMember(org.id, me);
      await audit(org.id, me, 'company.join', me);
      return { status: 'ACTIVE' };
    }
    await prisma.orgMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: me } },
      create: { orgId: org.id, userId: me, status: 'PENDING' },
      update: { status: 'PENDING', isOrgAdmin: false },
    });
    return { status: 'PENDING' };
  });

  app.get<{ Params: { id: string } }>('/:id/requests', async (req) => {
    const org = await assertCompanyAdmin(uid(req), req.params.id);
    const rows = await prisma.orgMember.findMany({
      where: { orgId: org.id, status: 'PENDING' },
      orderBy: { joinedAt: 'asc' },
      select: { joinedAt: true, user: { select: { ...userLite, email: true } } },
    });
    return rows.map((r) => ({ requestedAt: r.joinedAt, user: r.user }));
  });

  app.post<{ Params: { id: string; userId: string } }>('/:id/requests/:userId', async (req) => {
    const org = await assertCompanyAdmin(uid(req), req.params.id);
    const { approve } = parse(z.object({ approve: z.boolean() }), req.body);
    const m = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: org.id, userId: req.params.userId } } });
    if (m?.status !== 'PENDING') throw notFound('Join request');
    if (approve) await addOrgMember(org.id, req.params.userId);
    else await prisma.orgMember.delete({ where: { orgId_userId: { orgId: org.id, userId: req.params.userId } } });
    await audit(org.id, uid(req), approve ? 'company.request.approve' : 'company.request.reject', req.params.userId);
    return { ok: true };
  });

  // ───────── Invites ─────────
  app.get<{ Params: { id: string } }>('/:id/invites', async (req) => {
    const org = await assertCompanyAdmin(uid(req), req.params.id);
    return prisma.orgInvite.findMany({
      where: { orgId: org.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, createdAt: true, expiresAt: true },
    });
  });

  app.post<{ Params: { id: string } }>('/:id/invites', { config: { rateLimit: limits.companyWrite } }, async (req) => {
    const org = await assertCompanyAdmin(uid(req), req.params.id);
    const { email } = parse(z.object({ email: z.string().trim().email().max(254).transform((e) => e.toLowerCase()) }), req.body);
    const already = await prisma.orgMember.findFirst({ where: { orgId: org.id, status: 'ACTIVE', user: { email } } });
    if (already) throw conflict('That person is already a member');
    const token = newSecret();
    // One live invite per address: a new one replaces the old link.
    await prisma.orgInvite.deleteMany({ where: { orgId: org.id, email, acceptedAt: null } });
    const invite = await prisma.orgInvite.create({
      data: { orgId: org.id, email, tokenHash: sha256(token), invitedById: uid(req), expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 864e5) },
      select: { id: true, email: true, createdAt: true, expiresAt: true },
    });
    const inviter = await prisma.user.findUniqueOrThrow({ where: { id: uid(req) }, select: { name: true } });
    try {
      await sendMail({ to: email, ...inviteTemplate({ inviterName: inviter.name, companyName: org.name, url: appLink('invite', token), expiresInDays: INVITE_TTL_DAYS }) });
    } catch (e) {
      req.log.error(e, 'invite mail failed');
      await prisma.orgInvite.delete({ where: { id: invite.id } });
      throw new HttpError(502, 'MAIL_FAILED', 'The invitation email could not be sent. Try again later.');
    }
    await audit(org.id, uid(req), 'company.invite', invite.id, { email });
    return invite;
  });

  app.delete<{ Params: { id: string; inviteId: string } }>('/:id/invites/:inviteId', async (req) => {
    const org = await assertCompanyAdmin(uid(req), req.params.id);
    const { count } = await prisma.orgInvite.deleteMany({ where: { id: req.params.inviteId, orgId: org.id, acceptedAt: null } });
    if (!count) throw notFound('Invite');
    return { ok: true };
  });

  /** Accepts an invite sent to my (verified) email address. */
  app.post('/invites/accept', { config: { rateLimit: limits.redeem } }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(1).max(500).transform(tokenFrom) }), req.body);
    const invite = await prisma.orgInvite.findUnique({ where: { tokenHash: sha256(token) }, include: { org: true } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date() || invite.org.suspendedAt) {
      throw new HttpError(400, 'INVALID_TOKEN', 'This invitation is invalid or has expired. Ask for a new one.');
    }
    if (invite.email !== (await myEmail(req))) throw forbidden(`This invitation was sent to ${invite.email}. Sign in with that address.`);
    const { count } = await prisma.orgInvite.updateMany({ where: { id: invite.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (count !== 1) throw new HttpError(400, 'INVALID_TOKEN', 'This invitation has already been used.');
    await addOrgMember(invite.orgId, uid(req));
    await audit(invite.orgId, uid(req), 'company.invite.accept', invite.id);
    return companyView(invite.org, req);
  });
};
