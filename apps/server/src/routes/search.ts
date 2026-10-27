import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/db';
import { authenticate, uid } from '../lib/auth';
import { userLite } from '../lib/notify';
import { postInclude, serializePosts } from './posts';

/** Global search (SOT §5.10) — ILIKE in phase 1, tsvector later. */
export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.get<{ Querystring: { q?: string; type?: string } }>('/', async (req) => {
    const me = uid(req);
    const q = (req.query.q ?? '').trim();
    if (!q) return { people: [], posts: [], groups: [], events: [], jobs: [], hashtags: [], units: [] };
    const like = { contains: q.replace(/^#/, ''), mode: 'insensitive' as const };
    const type = req.query.type;
    const want = (t: string) => !type || type === 'all' || type === t;
    const take = type && type !== 'all' ? 30 : 5;

    const [people, posts, groups, events, jobs, hashtags, units] = await Promise.all([
      want('people')
        ? prisma.user.findMany({
            where: { isActive: true, OR: [{ name: like }, { headline: like }, { skills: { some: { name: like } } }] },
            take,
            select: { ...userLite, memberships: { where: { isPrimary: true }, select: { node: { select: { name: true } } } } },
          })
        : [],
      want('posts')
        ? prisma.post.findMany({ where: { isHidden: false, body: like }, orderBy: { createdAt: 'desc' }, take, include: postInclude(me) }).then(serializePosts)
        : [],
      want('groups') ? prisma.group.findMany({ where: { OR: [{ name: like }, { description: like }] }, take, include: { _count: { select: { members: true } } } }) : [],
      want('events') ? prisma.event.findMany({ where: { title: like }, take, orderBy: { startsAt: 'desc' } }) : [],
      want('jobs') ? prisma.job.findMany({ where: { status: 'OPEN', OR: [{ title: like }, { description: like }] }, take, include: { node: { select: { name: true } } } }) : [],
      want('hashtags') ? prisma.hashtag.findMany({ where: { tag: like }, take, include: { _count: { select: { posts: true } } } }) : [],
      want('units') ? prisma.orgNode.findMany({ where: { name: like }, take, include: { _count: { select: { memberships: true } } } }) : [],
    ]);
    return { people, posts, groups, events, jobs, hashtags, units };
  });
};
