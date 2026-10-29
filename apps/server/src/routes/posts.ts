import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { REACTION_TYPES } from '@nexus/shared';
import { prisma } from '../lib/db';
import { badRequest, forbidden, notFound, page, pageArgs, parse } from '../lib/http';
import { assertCan, authenticate, requirePerm, uid } from '../lib/auth';
import { audit, notify, userLite } from '../lib/notify';
import { extractHashtags, extractMentions, plain } from '../lib/text';
import { canOverUser } from '../rbac';
import { assertNodesInOrg, isOrgMember, orgOf, visibleIn } from '../lib/org';
import { env } from '../lib/env';
import { assertSeePost, postWhere, viewerOf } from '../lib/visibility';

const mediaItem = z.object({ url: z.string().url(), mimeType: z.string(), fileName: z.string().nullish() });

/** Who a new post is for (SOT §14.2). Omitted visibility: ORG in your active org, PUBLIC when you have none. */
export const audienceBody = z.object({
  visibility: z.enum(['PUBLIC', 'CONNECTIONS', 'ORG']).nullish(),
  nodeIds: z.array(z.string()).max(20).default([]),
});

type Audience = { visibility: 'PUBLIC' | 'CONNECTIONS' | 'ORG'; orgId: string | null; nodeIds: string[] };

/** Resolves the requested audience; single mode is always ORG (SOT §14.3), and units only narrow ORG posts. */
export async function resolveAudience(req: FastifyRequest, a: z.infer<typeof audienceBody>): Promise<Audience> {
  const visibility = env.tenancy === 'single' ? 'ORG' : a.visibility ?? (req.orgId ? 'ORG' : 'PUBLIC');
  if (visibility !== 'ORG') return { visibility, orgId: null, nodeIds: [] };
  const orgId = orgOf(req);
  const nodeIds = [...new Set(a.nodeIds)];
  await assertNodesInOrg(orgId, nodeIds);
  return { visibility, orgId, nodeIds };
}

const createBody = audienceBody.extend({
  body: z.string().max(3000).default(''),
  media: z.array(mediaItem).max(9).default([]),
  poll: z
    .object({
      question: z.string().min(1).max(140),
      options: z.array(z.string().trim().min(1).max(30)).min(2).max(4),
      durationDays: z.number().int().min(1).max(14).default(7),
    })
    .nullish(),
  celebration: z.enum(['KUDOS', 'WELCOME', 'WORK_ANNIVERSARY', 'PROMOTION', 'PROJECT_LAUNCH']).nullish(),
  repostOfId: z.string().nullish(),
  groupId: z.string().nullish(),
  eventId: z.string().nullish(),
  jobId: z.string().nullish(),
});

/** Everything the feed card needs, computed for the viewer. */
export function postInclude(viewerId: string) {
  return {
    author: { select: userLite },
    media: { orderBy: { sortOrder: 'asc' } },
    poll: { include: { options: { orderBy: { sortOrder: 'asc' }, include: { _count: { select: { votes: true } } } }, votes: { where: { userId: viewerId } } } },
    article: { select: { id: true, title: true, coverUrl: true, body: true } },
    event: { select: { id: true, title: true, startsAt: true, isOnline: true, location: true, coverUrl: true } },
    job: { select: { id: true, title: true, location: true, workplace: true, status: true } },
    group: { select: { id: true, name: true } },
    org: { select: { id: true, name: true } },
    audience: { select: { node: { select: { id: true, name: true } } } },
    repostOf: {
      include: {
        author: { select: userLite },
        media: { orderBy: { sortOrder: 'asc' } },
        article: { select: { id: true, title: true, coverUrl: true } },
      },
    },
    reactions: { where: { userId: viewerId }, select: { type: true } },
    savedBy: { where: { userId: viewerId }, select: { userId: true } },
    _count: { select: { comments: true, reactions: true, reposts: true } },
  } satisfies Prisma.PostInclude;
}

type PostRow = Prisma.PostGetPayload<{ include: ReturnType<typeof postInclude> }>;

async function reactionSummary(postIds: string[]) {
  const rows = await prisma.reaction.groupBy({ by: ['postId', 'type'], where: { postId: { in: postIds } }, _count: true });
  const out = new Map<string, { type: string; count: number }[]>();
  for (const r of rows) {
    const list = out.get(r.postId!) ?? [];
    list.push({ type: r.type, count: r._count });
    out.set(r.postId!, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.count - a.count);
  return out;
}

export async function serializePosts(rows: PostRow[]) {
  const summary = await reactionSummary(rows.map((r) => r.id));
  return rows.map(({ reactions, savedBy, poll, ...p }) => ({
    ...p,
    myReaction: reactions[0]?.type ?? null,
    saved: savedBy.length > 0,
    topReactions: summary.get(p.id) ?? [],
    poll: poll && {
      id: poll.id,
      question: poll.question,
      endsAt: poll.endsAt,
      myVote: poll.votes[0]?.optionId ?? null,
      totalVotes: poll.options.reduce((s, o) => s + o._count.votes, 0),
      options: poll.options.map((o) => ({ id: o.id, text: o.text, votes: o._count.votes })),
    },
  }));
}

async function loadPost(req: FastifyRequest, id: string) {
  const post = await prisma.post.findFirst({ where: { AND: [{ id }, postWhere(await viewerOf(req))] }, include: postInclude(uid(req)) });
  if (!post) throw notFound('Post');
  return (await serializePosts([post]))[0];
}

async function linkHashtags(postId: string, body: string) {
  const tags = extractHashtags(body);
  await prisma.postHashtag.deleteMany({ where: { postId } });
  for (const tag of tags) {
    const h = await prisma.hashtag.upsert({ where: { tag }, create: { tag }, update: {} });
    await prisma.postHashtag.create({ data: { postId, hashtagId: h.id } });
  }
}

async function notifyMentions(body: string, actorId: string, postId: string, what: string) {
  const ids = extractMentions(body);
  if (!ids.length) return;
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId }, select: { name: true } });
  for (const id of ids) await notify({ recipientId: id, actorId, type: 'MENTION', text: `${actor.name} mentioned you in a ${what}`, link: `/post/${postId}`, postId });
}

export const postRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  /**
   * Home feed (SOT §5.3, §14.3): pinned announcements first, then recent posts, with posts from
   * connections / follows ranked higher inside each page window. Single mode shows every post you may see;
   * multi mode narrows that to posts from connections and follows, public posts from people at followed
   * companies, and posts of the active org (filtered by unit audience).
   */
  app.get<{ Querystring: { cursor?: string; limit?: string; filter?: string } }>('/feed', async (req) => {
    const me = uid(req);
    const v = await viewerOf(req);
    const { limit, ...args } = pageArgs(req.query, 10);
    const filter = req.query.filter;
    const [follows, companies] = await Promise.all([
      prisma.follow.findMany({ where: { followerId: me }, select: { followeeId: true } }),
      prisma.companyFollow.findMany({ where: { userId: me }, select: { orgId: true } }),
    ]);
    const network = [...new Set([...v.connections, ...follows.map((f) => f.followeeId), me])];
    const base: Prisma.PostWhereInput[] = [postWhere(v), { groupId: null }];
    if (filter === 'network') base.push({ authorId: { in: network } });
    else if (env.tenancy === 'multi') {
      base.push({
        OR: [
          // postWhere already limits these to what the viewer may see (CONNECTIONS only from connections)
          { authorId: { in: network } },
          { visibility: 'PUBLIC', author: { orgMemberships: { some: { status: 'ACTIVE', orgId: { in: companies.map((c) => c.orgId) } } } } },
          { visibility: 'ORG' },
        ],
      });
    }

    const pinned = !req.query.cursor && filter !== 'network'
      ? await prisma.post.findMany({ where: { AND: [...base, { isPinned: true }] }, orderBy: { createdAt: 'desc' }, include: postInclude(me), take: 3 })
      : [];
    const rows = await prisma.post.findMany({
      ...args,
      where: { AND: filter === 'network' ? base : [...base, { isPinned: false }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: postInclude(me),
    });
    const { items, nextCursor } = page(rows, limit);

    // Light ranking inside the page: network + engagement boost, decayed by age.
    const close = new Set([...v.connections, me]);
    const score = (p: PostRow) => {
      const ageH = (Date.now() - p.createdAt.getTime()) / 36e5;
      const engagement = p._count.reactions + 2 * p._count.comments + 3 * p._count.reposts;
      return (close.has(p.authorId) ? 5 : 0) + Math.log1p(engagement) * 2 - ageH / 12;
    };
    const ranked = [...items].sort((a, b) => score(b) - score(a));
    return { items: await serializePosts([...pinned, ...ranked]), nextCursor };
  });

  app.get<{ Params: { tag: string }; Querystring: { cursor?: string } }>('/hashtag/:tag', async (req) => {
    const me = uid(req);
    const tag = req.params.tag.toLowerCase();
    const { limit, ...args } = pageArgs(req.query, 10);
    const where: Prisma.PostWhereInput = { AND: [postWhere(await viewerOf(req)), { hashtags: { some: { hashtag: { tag } } } }] };
    const [rows, h, postCount] = await Promise.all([
      prisma.post.findMany({ ...args, where, orderBy: { createdAt: 'desc' }, include: postInclude(me) }),
      prisma.hashtag.findUnique({ where: { tag }, include: { _count: { select: { followers: true } }, followers: { where: { userId: me } } } }),
      prisma.post.count({ where }),
    ]);
    const { items, nextCursor } = page(rows, limit);
    return {
      tag,
      followers: h?._count.followers ?? 0,
      postCount,
      following: !!h?.followers.length,
      items: await serializePosts(items),
      nextCursor,
    };
  });

  app.post<{ Params: { tag: string } }>('/hashtag/:tag/follow', async (req) => {
    const tag = req.params.tag.toLowerCase();
    const h = await prisma.hashtag.upsert({ where: { tag }, create: { tag }, update: {} });
    const key = { userId: uid(req), hashtagId: h.id };
    const existing = await prisma.hashtagFollow.findUnique({ where: { userId_hashtagId: key } });
    if (existing) await prisma.hashtagFollow.delete({ where: { userId_hashtagId: key } });
    else await prisma.hashtagFollow.create({ data: key });
    return { following: !existing };
  });

  app.get('/trending', async (req) => {
    const since = new Date(Date.now() - 7 * 864e5);
    const post: Prisma.PostWhereInput = { AND: [postWhere(await viewerOf(req)), { createdAt: { gte: since } }] };
    const tags = await prisma.hashtag.findMany({
      take: 8,
      where: { posts: { some: { post } } },
      orderBy: { posts: { _count: 'desc' } },
      select: { tag: true, _count: { select: { posts: { where: { post } } } } },
    });
    return tags.map((t) => ({ tag: t.tag, count: t._count.posts }));
  });

  app.get('/saved', async (req) => {
    const me = uid(req);
    const saved = await prisma.savedPost.findMany({
      where: { userId: me, post: postWhere(await viewerOf(req)) },
      orderBy: { createdAt: 'desc' },
      include: { post: { include: postInclude(me) } },
    });
    return serializePosts(saved.map((s) => s.post));
  });

  app.get<{ Params: { userId: string }; Querystring: { cursor?: string } }>('/by/:userId', async (req) => {
    const me = uid(req);
    const { limit, ...args } = pageArgs(req.query, 10);
    const rows = await prisma.post.findMany({
      ...args,
      where: { AND: [postWhere(await viewerOf(req)), { authorId: req.params.userId, groupId: null }] },
      orderBy: { createdAt: 'desc' },
      include: postInclude(me),
    });
    const { items, nextCursor } = page(rows, limit);
    return { items: await serializePosts(items), nextCursor };
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => loadPost(req, req.params.id));

  app.post('/', { preHandler: requirePerm('post.create') }, async (req) => {
    const me = uid(req);
    const b = parse(createBody, req.body);
    if (!b.body.trim() && !b.media.length && !b.poll && !b.repostOfId && !b.celebration) throw badRequest('Post is empty');
    let audience = await resolveAudience(req, b);
    // Posts in a group / about an event or job are for that row's org (everyone when it has none).
    let ownerOrg: string | null | undefined;
    if (b.groupId) {
      const m = await prisma.groupMember.findFirst({ where: { groupId: b.groupId, userId: me, group: visibleIn(req.orgId) }, include: { group: { select: { orgId: true } } } });
      if (!m || m.role === 'PENDING') throw forbidden('Join the group to post');
      ownerOrg = m.group.orgId;
    }
    if (b.eventId) {
      const e = await prisma.event.findFirst({ where: { id: b.eventId, ...visibleIn(req.orgId) }, select: { orgId: true } });
      if (!e) throw notFound('Event');
      ownerOrg ??= e.orgId;
    }
    if (b.jobId) {
      const j = await prisma.job.findFirst({ where: { id: b.jobId, ...visibleIn(req.orgId) }, select: { orgId: true } });
      if (!j) throw notFound('Job');
      ownerOrg ??= j.orgId;
    }
    if (ownerOrg !== undefined) audience = ownerOrg ? { visibility: 'ORG', orgId: ownerOrg, nodeIds: [] } : { visibility: 'PUBLIC', orgId: null, nodeIds: [] };
    let repostOf: { id: string; authorId: string; visibility: Audience['visibility']; orgId: string | null } | null = null;
    if (b.repostOfId) {
      const v = await viewerOf(req);
      const select = { id: true, authorId: true, repostOfId: true, visibility: true, orgId: true } as const;
      const p = await prisma.post.findFirst({ where: { AND: [{ id: b.repostOfId }, postWhere(v)] }, select });
      // reposting a repost shares the original
      repostOf = p?.repostOfId ? await prisma.post.findFirst({ where: { AND: [{ id: p.repostOfId }, postWhere(v)] }, select }) : p;
      if (!repostOf) throw notFound('Original post');
      // a repost can't widen the original's audience (it is also only shown where the original is)
      if (repostOf.visibility !== 'PUBLIC') audience = { visibility: repostOf.visibility, orgId: repostOf.orgId, nodeIds: [] };
    }
    const kind = repostOf ? 'REPOST'
      : b.poll ? 'POLL'
      : b.celebration ? 'CELEBRATION'
      : b.eventId ? 'EVENT'
      : b.jobId ? 'JOB'
      : b.media.some((m) => m.mimeType === 'application/pdf') ? 'DOCUMENT'
      : b.media.length ? 'MEDIA' : 'TEXT';

    const post = await prisma.post.create({
      data: {
        authorId: me,
        kind,
        visibility: audience.visibility,
        orgId: audience.orgId,
        audience: { create: audience.nodeIds.map((nodeId) => ({ nodeId })) },
        body: b.body,
        celebration: b.celebration,
        repostOfId: repostOf?.id,
        groupId: b.groupId,
        eventId: b.eventId,
        jobId: b.jobId,
        media: { create: b.media.map((m, i) => ({ ...m, sortOrder: i })) },
        poll: b.poll
          ? {
              create: {
                question: b.poll.question,
                endsAt: new Date(Date.now() + b.poll.durationDays * 864e5),
                options: { create: b.poll.options.map((text, i) => ({ text, sortOrder: i })) },
              },
            }
          : undefined,
      },
    });
    await linkHashtags(post.id, b.body);
    await notifyMentions(b.body, me, post.id, 'post');
    if (repostOf) {
      const actor = await prisma.user.findUniqueOrThrow({ where: { id: me }, select: { name: true } });
      await notify({ recipientId: repostOf.authorId, actorId: me, type: 'REPOST', text: `${actor.name} reposted your post`, link: `/post/${post.id}`, postId: post.id });
    }
    return loadPost(req, post.id);
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req) => {
    const me = uid(req);
    const { body } = parse(z.object({ body: z.string().max(3000) }), req.body);
    const post = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!post) throw notFound('Post');
    if (post.authorId !== me) throw forbidden('You can only edit your own posts');
    await prisma.post.update({ where: { id: post.id }, data: { body, editedAt: new Date() } });
    await linkHashtags(post.id, body);
    return loadPost(req, post.id);
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    const me = uid(req);
    const post = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!post) throw notFound('Post');
    if (post.authorId !== me) {
      const org = orgOf(req);
      if (!(await canOverUser(me, org, 'post.moderate', post.authorId))) throw forbidden();
      await audit(org, me, 'post.delete', post.id, { authorId: post.authorId });
    }
    await prisma.post.delete({ where: { id: post.id } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/:id/pin', { preHandler: requirePerm('post.pin') }, async (req) => {
    const org = orgOf(req);
    const post = await prisma.post.findUniqueOrThrow({ where: { id: req.params.id } });
    // pins are company announcements: only posts by people in the active org
    if (!(await isOrgMember(org, post.authorId))) throw forbidden('Only posts by your colleagues can be pinned');
    await prisma.post.update({ where: { id: post.id }, data: { isPinned: !post.isPinned } });
    await audit(org, uid(req), post.isPinned ? 'post.unpin' : 'post.pin', post.id);
    return { pinned: !post.isPinned };
  });

  app.post<{ Params: { id: string } }>('/:id/hide', async (req) => {
    const me = uid(req);
    const org = orgOf(req);
    const post = await prisma.post.findUniqueOrThrow({ where: { id: req.params.id } });
    if (!(await canOverUser(me, org, 'post.moderate', post.authorId))) throw forbidden();
    await prisma.post.update({ where: { id: post.id }, data: { isHidden: !post.isHidden, hiddenAt: post.isHidden ? null : new Date() } });
    await audit(org, me, post.isHidden ? 'post.unhide' : 'post.hide', post.id);
    if (!post.isHidden) await notify({ recipientId: post.authorId, actorId: me, type: 'MODERATION', text: 'One of your posts was hidden by a moderator' });
    return { hidden: !post.isHidden };
  });

  app.post<{ Params: { id: string } }>('/:id/save', async (req) => {
    await assertSeePost(req, req.params.id);
    const key = { userId: uid(req), postId: req.params.id };
    const existing = await prisma.savedPost.findUnique({ where: { userId_postId: key } });
    if (existing) await prisma.savedPost.delete({ where: { userId_postId: key } });
    else await prisma.savedPost.create({ data: key });
    return { saved: !existing };
  });

  // ───────── Reactions ─────────
  app.post<{ Params: { id: string } }>('/:id/react', async (req) => {
    const me = uid(req);
    const { type } = parse(z.object({ type: z.enum(REACTION_TYPES).nullable() }), req.body);
    await assertSeePost(req, req.params.id);
    const post = await prisma.post.findUniqueOrThrow({ where: { id: req.params.id }, select: { id: true, authorId: true, body: true } });
    const key = { userId_postId: { userId: me, postId: post.id } };
    if (!type) {
      await prisma.reaction.deleteMany({ where: { userId: me, postId: post.id } });
    } else {
      const existing = await prisma.reaction.findUnique({ where: key });
      await prisma.reaction.upsert({ where: key, create: { userId: me, postId: post.id, type }, update: { type } });
      if (!existing) {
        const actor = await prisma.user.findUniqueOrThrow({ where: { id: me }, select: { name: true } });
        await notify({
          recipientId: post.authorId, actorId: me, type: 'REACTION',
          text: `${actor.name} reacted to your post${post.body ? `: "${plain(post.body, 40)}"` : ''}`,
          link: `/post/${post.id}`,
          postId: post.id,
        });
      }
    }
    return loadPost(req, post.id);
  });

  app.get<{ Params: { id: string }; Querystring: { type?: string } }>('/:id/reactions', async (req) => {
    await assertSeePost(req, req.params.id);
    return prisma.reaction.findMany({
      where: { postId: req.params.id, ...(req.query.type ? { type: req.query.type as (typeof REACTION_TYPES)[number] } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { type: true, user: { select: userLite } },
    });
  });

  app.get<{ Params: { id: string } }>('/:id/reposts', async (req) => {
    await assertSeePost(req, req.params.id);
    return prisma.post.findMany({
      where: { AND: [postWhere(await viewerOf(req)), { repostOfId: req.params.id }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, body: true, createdAt: true, author: { select: userLite } },
    });
  });

  // ───────── Polls ─────────
  app.post<{ Params: { id: string } }>('/:id/vote', async (req) => {
    const me = uid(req);
    const { optionId } = parse(z.object({ optionId: z.string() }), req.body);
    await assertSeePost(req, req.params.id);
    const poll = await prisma.poll.findUnique({ where: { postId: req.params.id }, include: { options: true } });
    if (!poll) throw notFound('Poll');
    if (poll.endsAt < new Date()) throw badRequest('This poll has ended');
    if (!poll.options.some((o) => o.id === optionId)) throw badRequest('Unknown option');
    await prisma.pollVote.upsert({
      where: { pollId_userId: { pollId: poll.id, userId: me } },
      create: { pollId: poll.id, userId: me, optionId },
      update: { optionId },
    });
    return loadPost(req, req.params.id);
  });

  // ───────── Comments ─────────
  app.get<{ Params: { id: string } }>('/:id/comments', async (req) => {
    const me = uid(req);
    await assertSeePost(req, req.params.id);
    const rows = await prisma.comment.findMany({
      where: { postId: req.params.id, parentId: null, isHidden: false },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: userLite },
        reactions: { where: { userId: me }, select: { type: true } },
        _count: { select: { reactions: true } },
        replies: {
          where: { isHidden: false },
          orderBy: { createdAt: 'asc' },
          include: { author: { select: userLite }, reactions: { where: { userId: me }, select: { type: true } }, _count: { select: { reactions: true } } },
        },
      },
    });
    const shape = <T extends { reactions: { type: string }[]; _count: { reactions: number } }>({ reactions, _count, ...c }: T) => ({
      ...c,
      myReaction: reactions[0]?.type ?? null,
      reactionCount: _count.reactions,
    });
    return rows.map(({ replies, ...c }) => ({ ...shape(c), replies: replies.map(shape) }));
  });

  app.post<{ Params: { id: string } }>('/:id/comments', async (req) => {
    const me = uid(req);
    await assertCan(me, orgOf(req), 'comment.create');
    const b = parse(z.object({ body: z.string().trim().min(1).max(1250), parentId: z.string().nullish() }), req.body);
    await assertSeePost(req, req.params.id);
    const post = await prisma.post.findUniqueOrThrow({ where: { id: req.params.id }, select: { id: true, authorId: true } });
    let parentId = b.parentId ?? null;
    let parentAuthor: string | null = null;
    if (parentId) {
      const parent = await prisma.comment.findUnique({ where: { id: parentId } });
      if (!parent || parent.postId !== post.id) throw notFound('Comment');
      // one level of replies (SOT §5.3)
      parentId = parent.parentId ?? parent.id;
      parentAuthor = parent.authorId;
    }
    const comment = await prisma.comment.create({
      data: { postId: post.id, authorId: me, body: b.body, parentId },
      include: { author: { select: userLite } },
    });
    const actor = comment.author.name;
    await notify({ recipientId: post.authorId, actorId: me, type: 'COMMENT', text: `${actor} commented: "${plain(b.body, 50)}"`, link: `/post/${post.id}`, postId: post.id });
    if (parentAuthor && parentAuthor !== post.authorId) {
      await notify({ recipientId: parentAuthor, actorId: me, type: 'COMMENT', text: `${actor} replied to your comment`, link: `/post/${post.id}`, postId: post.id });
    }
    await notifyMentions(b.body, me, post.id, 'comment');
    return { ...comment, myReaction: null, reactionCount: 0, replies: [] };
  });

  app.patch<{ Params: { id: string; commentId: string } }>('/:id/comments/:commentId', async (req) => {
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(1250) }), req.body);
    const c = await prisma.comment.findUnique({ where: { id: req.params.commentId } });
    if (!c || c.authorId !== uid(req)) throw forbidden('You can only edit your own comments');
    return prisma.comment.update({ where: { id: c.id }, data: { body, editedAt: new Date() } });
  });

  app.delete<{ Params: { id: string; commentId: string } }>('/:id/comments/:commentId', async (req) => {
    const me = uid(req);
    const c = await prisma.comment.findUnique({ where: { id: req.params.commentId }, include: { post: { select: { authorId: true } } } });
    if (!c) throw notFound('Comment');
    // author, post owner, or a scoped moderator can delete
    if (c.authorId !== me && c.post.authorId !== me && !(await canOverUser(me, orgOf(req), 'post.moderate', c.authorId))) throw forbidden();

    await prisma.comment.delete({ where: { id: c.id } });
    return { ok: true };
  });

  app.post<{ Params: { id: string; commentId: string } }>('/:id/comments/:commentId/react', async (req) => {
    const me = uid(req);
    const { type } = parse(z.object({ type: z.enum(REACTION_TYPES).nullable() }), req.body);
    const c = await prisma.comment.findUnique({ where: { id: req.params.commentId }, select: { postId: true } });
    if (!c) throw notFound('Comment');
    await assertSeePost(req, c.postId);
    const key = { userId_commentId: { userId: me, commentId: req.params.commentId } };
    if (!type) await prisma.reaction.deleteMany({ where: { userId: me, commentId: req.params.commentId } });
    else await prisma.reaction.upsert({ where: key, create: { userId: me, commentId: req.params.commentId, type }, update: { type } });
    return { ok: true };
  });
};
