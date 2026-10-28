import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';
import { authenticate, uid } from '../lib/auth';
import { userLite } from '../lib/notify';
import { hashtagTerm, inOrder, prefixQuery, searchPostIds, searchTableIds, searchUserIds } from '../lib/search';
import { postInclude, serializePosts } from './posts';
import { postsVisibleIn, visibleIn } from '../lib/org';

/** Global search (SOT §5.10): Postgres full-text (tsvector + ts_rank, prefix terms) for content; ILIKE for tags and units. */
export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.get<{ Querystring: { q?: string; type?: string } }>('/', async (req) => {
    const me = uid(req);
    const q = (req.query.q ?? '').trim();
    const empty = { people: [], posts: [], groups: [], events: [], jobs: [], hashtags: [], units: [] };
    const bare = q.replace(/^#/, '');
    if (!bare) return empty;
    const fts = prefixQuery(q);
    const like = { contains: bare, mode: 'insensitive' as const };
    const type = req.query.type;
    const want = (t: string) => !type || type === 'all' || type === t;
    const wantFts = (t: string) => fts !== null && want(t);
    const take = type && type !== 'all' ? 30 : 5;

    const [people, posts, groups, events, jobs, hashtags, units] = await Promise.all([
      wantFts('people')
        ? searchUserIds(fts!, take).then(async (ids) =>
            inOrder(ids, await prisma.user.findMany({
              where: { id: { in: ids } },
              select: { ...userLite, memberships: { where: { isPrimary: true, node: { orgId: req.orgId ?? '' } }, select: { node: { select: { name: true } } } } },
            })),
          )
        : [],
      wantFts('posts')
        ? searchPostIds(fts!, hashtagTerm(q), take).then(async (ids) =>
            serializePosts(inOrder(ids, await prisma.post.findMany({ where: { id: { in: ids }, ...postsVisibleIn(req.orgId) }, include: postInclude(me) }))),
          )
        : [],
      wantFts('groups')
        ? searchTableIds('Group', fts!, take).then(async (ids) =>
            inOrder(ids, await prisma.group.findMany({ where: { id: { in: ids }, ...visibleIn(req.orgId) }, include: { _count: { select: { members: true } } } })),
          )
        : [],
      wantFts('events')
        ? searchTableIds('Event', fts!, take, { tiebreak: Prisma.sql`t."startsAt" DESC` }).then(async (ids) =>
            inOrder(ids, await prisma.event.findMany({ where: { id: { in: ids }, ...visibleIn(req.orgId) } })),
          )
        : [],
      wantFts('jobs')
        ? searchTableIds('Job', fts!, take, { filter: Prisma.sql`t.status = 'OPEN'` }).then(async (ids) =>
            inOrder(ids, await prisma.job.findMany({ where: { id: { in: ids }, ...visibleIn(req.orgId) }, include: { node: { select: { name: true } } } })),
          )
        : [],
      want('hashtags')
        ? prisma.hashtag.findMany({ where: { tag: like }, take, orderBy: { posts: { _count: 'desc' } }, include: { _count: { select: { posts: true } } } })
        : [],
      want('units') ? prisma.orgNode.findMany({ where: { name: like, orgId: req.orgId ?? '' }, take,
 include: { _count: { select: { memberships: true } } } }) : [],
    ]);
    return { people, posts, groups, events, jobs, hashtags, units };
  });
};
