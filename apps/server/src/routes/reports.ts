import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { badRequest, forbidden, notFound, parse } from '../lib/http';
import { authenticate, requirePerm, uid } from '../lib/auth';
import { audit, notify, userLite } from '../lib/notify';
import { canOverUser } from '../rbac';
import { orgOf } from '../lib/org';
import { assertSeePost } from '../lib/visibility';

const REASONS = ['SPAM', 'HARASSMENT', 'HATE', 'MISINFORMATION', 'CONFIDENTIAL', 'INAPPROPRIATE', 'OTHER'] as const;

/** Moderation queue (SOT §5.11). Reports go to the reporter's active org; reviewers see that org's reports in their DAG scope. */
export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.post('/', async (req) => {
    const b = parse(
      z.object({
        postId: z.string().nullish(),
        commentId: z.string().nullish(),
        targetUserId: z.string().nullish(),
        reason: z.enum(REASONS),
        details: z.string().max(1000).nullish(),
      }),
      req.body,
    );
    if (!b.postId && !b.commentId && !b.targetUserId) throw badRequest('Nothing to report');
    if (b.postId) await assertSeePost(req, b.postId);
    if (b.commentId) {
      const c = await prisma.comment.findUnique({ where: { id: b.commentId }, select: { postId: true } });
      if (!c) throw notFound('Comment');
      await assertSeePost(req, c.postId);
    }
    await prisma.report.create({ data: { ...b, orgId: orgOf(req), reporterId: uid(req) } });
    return { ok: true };
  });

  app.get<{ Querystring: { status?: string } }>('/', { preHandler: requirePerm('report.review') }, async (req) => {
    const me = uid(req);
    const org = orgOf(req);
    const status = (req.query.status ?? 'OPEN') as 'OPEN' | 'DISMISSED' | 'ACTIONED';
    const rows = await prisma.report.findMany({
      where: { orgId: org, status },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        reporter: { select: userLite },
        reviewer: { select: userLite },
        post: { select: { id: true, body: true, authorId: true, isHidden: true, author: { select: userLite } } },
        comment: { select: { id: true, body: true, authorId: true, postId: true, author: { select: userLite } } },
      },
    });
    const visible = [];
    for (const r of rows) {
      const target = r.post?.authorId ?? r.comment?.authorId ?? r.targetUserId;
      if (!target || (await canOverUser(me, org, 'report.review', target))) visible.push(r);
    }
    return visible;
  });

  app.post<{ Params: { id: string } }>('/:id/resolve', { preHandler: requirePerm('report.review') }, async (req) => {
    const me = uid(req);
    const org = orgOf(req);
    const { action, note } = parse(z.object({ action: z.enum(['DISMISS', 'HIDE', 'DELETE', 'WARN']), note: z.string().max(500).nullish() }), req.body);
    const r = await prisma.report.findFirst({ where: { id: req.params.id, orgId: org }, include: { post: true, comment: true } });
    if (!r) throw notFound('Report');
    const authorId = r.post?.authorId ?? r.comment?.authorId ?? r.targetUserId;
    if (authorId && !(await canOverUser(me, org, 'report.review', authorId))) throw forbidden('Outside your moderation scope');

    if (action === 'HIDE') {
      if (r.postId) await prisma.post.update({ where: { id: r.postId }, data: { isHidden: true, hiddenAt: new Date() } });
      if (r.commentId) await prisma.comment.update({ where: { id: r.commentId }, data: { isHidden: true, hiddenAt: new Date() } });
    }
    if (action === 'DELETE') {
      if (r.commentId) await prisma.comment.delete({ where: { id: r.commentId } });
      else if (r.postId) await prisma.post.delete({ where: { id: r.postId } });
    }
    if (authorId && action !== 'DISMISS') {
      const verb = { HIDE: 'hidden', DELETE: 'removed', WARN: 'flagged' }[action];
      await notify({ recipientId: authorId, actorId: null, type: 'MODERATION', text: `Your content was ${verb} by moderators${note ? `: ${note}` : ''}` });
    }
    // DELETE cascades the report row away with the content
    if (action !== 'DELETE') {
      await prisma.report.update({
        where: { id: r.id },
        data: { status: action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED', resolution: note ?? action, reviewerId: me, resolvedAt: new Date() },
      });
    }
    await audit(org, me, `report.
${action.toLowerCase()}`, r.id, { postId: r.postId, commentId: r.commentId });
    return { ok: true };
  });
};
