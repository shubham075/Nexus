import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { badRequest, forbidden, notFound, parse } from '../lib/http';
import { authenticate, requirePerm, uid } from '../lib/auth';
import { notify, userLite } from '../lib/notify';
import { can } from '../rbac';
import { assertNodesInOrg, orgOf, visibleIn } from '../lib/org';

const jobBody = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().min(1).max(20_000),
  location: z.string().max(120).nullish(),
  workplace: z.enum(['ONSITE', 'HYBRID', 'REMOTE']).default('ONSITE'),
  employment: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP']).default('FULL_TIME'),
  skills: z.array(z.string().max(40)).max(15).default([]),
  nodeId: z.string().nullish(),
});

/** Poster, or anyone in the job's org with job.manage scoped over the job's unit (SOT §5.9). */
async function canManageJob(userId: string, job: { posterId: string; nodeId: string | null; orgId: string | null }) {
  return job.posterId === userId || (!!job.orgId && (await can(userId, job.orgId, 'job.manage', job.nodeId ? [job.nodeId] : undefined)));
}

/** A job visible in the request's active org (its own jobs + public ones). */
async function loadJob(req: FastifyRequest<{ Params: { id: string } }>) {
  const job = await prisma.job.findFirst({ where: { id: req.params.id, ...visibleIn(req.orgId) } });
  if (!job) throw notFound('Job');
  return job;
}

export const jobRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.get<{ Querystring: { q?: string; saved?: string; mine?: string } }>('/', async (req) => {
    const me = uid(req);
    const q = req.query.q?.trim();
    const jobs = await prisma.job.findMany({
      where: {
        ...visibleIn(req.orgId),
        ...(req.query.mine === 'true' ? { posterId: me } : { status: 'OPEN' }),
        ...(req.query.saved === 'true' ? { savedBy: { some: { userId: me } } } : {}),
        ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { skills: { has: q } }, { location: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        node: { select: { id: true, name: true } },
        poster: { select: userLite },
        savedBy: { where: { userId: me } },
        applications: { where: { userId: me }, select: { status: true } },
        _count: { select: { applications: true } },
      },
    });
    return jobs.map(({ savedBy, applications, _count, ...j }) => ({
      ...j, saved: savedBy.length > 0, myApplication: applications[0]?.status ?? null, applicantCount: _count.applications,
    }));
  });

  app.get('/applications/mine', async (req) =>
    prisma.jobApplication.findMany({
      where: { userId: uid(req), job: visibleIn(req.orgId) },
      orderBy: { updatedAt: 'desc' },
      include: { job: { select: { id: true, title: true, location: true, status: true, node: { select: { name: true } } } } },
    }),
  );

  app.post('/', { preHandler: requirePerm('job.create') }, async (req) => {
    const me = uid(req);
    const org = orgOf(req);
    const b = parse(jobBody, req.body);
    await assertNodesInOrg(org, [b.nodeId]);
    const job = await prisma.job.create({ data: { ...b, orgId: org, posterId: me } });
    await prisma.post.create({ data: { authorId: me, kind: 'JOB', jobId: job.id, body: `We're hiring: ${job.title}` } });
    return job;
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const me = uid(req);
    const job = await prisma.job.findFirst({
      where: { id: req.params.id, ...visibleIn(req.orgId) },
      include: {
        node: { select: { id: true, name: true } },
        poster: { select: userLite },
        savedBy: { where: { userId: me } },
        applications: { where: { userId: me } },
        _count: { select: { applications: true } },
      },
    });
    if (!job) throw notFound('Job');
    const { savedBy, applications, _count, ...j } = job;
    return { ...j, saved: savedBy.length > 0, myApplication: applications[0] ?? null, applicantCount: _count.applications, canManage: await canManageJob(me, job) };
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req) => {
    const job = await loadJob(req);
    if (!(await canManageJob(uid(req), job))) throw forbidden();
    const b = parse(jobBody.partial().extend({ status: z.enum(['OPEN', 'CLOSED']).optional() }), req.body);
    if (job.orgId) await assertNodesInOrg(job.orgId, [b.nodeId]);
    return prisma.job.update({ where: { id: job.id }, data: b });
  });

  app.post<{ Params: { id: string } }>('/:id/save', async (req) => {
    const key = { userId: uid(req), jobId: (await loadJob(req)).id };
    const existing = await prisma.savedJob.findUnique({ where: { userId_jobId: key } });
    if (existing) await prisma.savedJob.delete({ where: { userId_jobId: key } });
    else await prisma.savedJob.create({ data: key });
    return { saved: !existing };
  });

  app.post<{ Params: { id: string } }>('/:id/apply', async (req) => {
    const me = uid(req);
    const { note } = parse(z.object({ note: z.string().max(3000).nullish() }), req.body);
    const job = await loadJob(req);
    if (job.status !== 'OPEN') throw badRequest('This job is closed');
    if (job.posterId === me) throw badRequest('You posted this job');
    const application = await prisma.jobApplication.create({ data: { jobId: job.id, userId: me, note } });
    const meUser = await prisma.user.findUniqueOrThrow({ where: { id: me }, select: { name: true } });
    await notify({ recipientId: job.posterId, actorId: me, type: 'JOB_APPLICATION', text: `${meUser.name} applied for ${job.title}`, link: `/jobs/${job.id}` });
    return application;
  });

  app.get<{ Params: { id: string } }>('/:id/applications', async (req) => {
    const job = await loadJob(req);
    if (!(await canManageJob(uid(req), job))) throw forbidden();
    return prisma.jobApplication.findMany({
      where: { jobId: job.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { ...userLite, email: true } } },
    });
  });

  app.patch<{ Params: { id: string; appId: string } }>('/:id/applications/:appId', async (req) => {
    const job = await loadJob(req);
    if (!(await canManageJob(uid(req), job))) throw forbidden();
    const { status } = parse(z.object({ status: z.enum(['APPLIED', 'REVIEWING', 'INTERVIEW', 'OFFER', 'REJECTED', 'HIRED']) }), req.body);
    if (!(await prisma.jobApplication.count({ where: { id: req.params.appId, jobId: job.id } }))) throw notFound('Application');
    const application = await prisma.jobApplication.update({ where: { id: req.params.appId }, data: { status } });

    await notify({
      recipientId: application.userId, actorId: uid(req), type: 'JOB_STATUS',
      text: `Your application for ${job.title} is now ${status.toLowerCase()}`, link: `/jobs/${job.id}`,
    });
    return application;
  });
};
