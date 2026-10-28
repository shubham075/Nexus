import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { forbidden, notFound, parse } from '../lib/http';
import { authenticate, requirePerm, uid } from '../lib/auth';
import { notify, userLite } from '../lib/notify';
import { visibleIn } from '../lib/org';

const articleBody = z.object({
  title: z.string().trim().min(1).max(150),
  body: z.string().min(1).max(100_000),
  coverUrl: z.string().url().nullish(),
  newsletterId: z.string().nullish(),
});

export const articleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.get<{ Querystring: { authorId?: string } }>('/', async (req) =>
    prisma.article.findMany({
      where: req.query.authorId ? { authorId: req.query.authorId } : {},
      orderBy: { publishedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, coverUrl: true, publishedAt: true, author: { select: userLite }, newsletter: { select: { id: true, title: true } }, post: { select: { id: true } } },
    }),
  );

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const a = await prisma.article.findUnique({
      where: { id: req.params.id },
      include: { author: { select: userLite }, newsletter: { select: { id: true, title: true } }, post: { select: { id: true } } },
    });
    if (!a) throw notFound('Article');
    return a;
  });

  /** Publishing creates the article plus a feed post that shares it, and notifies newsletter subscribers. */
  app.post('/', { preHandler: requirePerm('article.publish') }, async (req) => {
    const me = uid(req);
    const b = parse(articleBody, req.body);
    if (b.newsletterId) {
      const n = await prisma.newsletter.findUnique({ where: { id: b.newsletterId } });
      if (n?.ownerId !== me) throw forbidden('Not your newsletter');
    }
    const article = await prisma.article.create({ data: { ...b, authorId: me } });
    await prisma.post.create({ data: { authorId: me, kind: 'ARTICLE', articleId: article.id, body: '' } });
    if (b.newsletterId) {
      const subs = await prisma.newsletterSubscription.findMany({ where: { newsletterId: b.newsletterId } });
      const me_ = await prisma.user.findUniqueOrThrow({ where: { id: me }, select: { name: true } });
      for (const s of subs) await notify({ recipientId: s.userId, actorId: me, type: 'SYSTEM', text: `${me_.name} published “${article.title}”`, link: `/articles/${article.id}` });
    }
    return article;
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req) => {
    const a = await prisma.article.findUniqueOrThrow({ where: { id: req.params.id } });
    if (a.authorId !== uid(req)) throw forbidden();
    return prisma.article.update({ where: { id: a.id }, data: parse(articleBody.partial(), req.body) });
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    const a = await prisma.article.findUniqueOrThrow({ where: { id: req.params.id } });
    if (a.authorId !== uid(req)) throw forbidden();
    await prisma.article.delete({ where: { id: a.id } });
    return { ok: true };
  });

  // ───────── Newsletters ─────────
  app.get('/newsletters/all', async (req) => {
    const me = uid(req);
    const rows = await prisma.newsletter.findMany({
      where: visibleIn(req.orgId),
      orderBy: { createdAt: 'desc' },
      include: { owner: { select: userLite }, _count: { select: { subscribers: true, articles: true } }, subscribers: { where: { userId: me } } },
    });
    return rows.map(({ subscribers, ...n }) => ({ ...n, subscribed: subscribers.length > 0 }));
  });

  app.post('/newsletters', { preHandler: requirePerm('article.publish') }, async (req) => {
    const b = parse(z.object({ title: z.string().trim().min(1).max(100), description: z.string().max(500).nullish() }), req.body);
    // Owned by the active org (company-internal); personal newsletters (orgId null) arrive with phase 2c.
    return prisma.newsletter.create({ data: { ...b, orgId: req.orgId, ownerId: uid(req) } });
  });

  app.post<{ Params: { id: string } }>('/newsletters/:id/subscribe', async (req) => {
    if (!(await prisma.newsletter.count({ where: { id: req.params.id, ...visibleIn(req.orgId) } }))) throw notFound('Newsletter');
    const key = { newsletterId: req.params.id, userId: uid(req) };

    const existing = await prisma.newsletterSubscription.findUnique({ where: { newsletterId_userId: key } });
    if (existing) await prisma.newsletterSubscription.delete({ where: { newsletterId_userId: key } });
    else await prisma.newsletterSubscription.create({ data: key });
    return { subscribed: !existing };
  });
};
