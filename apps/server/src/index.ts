import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { API_PREFIX } from '@nexus/shared';
import { env } from './lib/env';
import { HttpError } from './lib/http';
import { DagError } from './dag/engine';
import { ensureBucket, signMedia, unsignMedia } from './lib/storage';
import { startRetentionJob } from './lib/retention';
import { closeRealtime, setupRealtime } from './lib/realtime';
import { registerObservability } from './lib/observability';
import { registerRateLimit } from './lib/rateLimit';
import { pruneSessions } from './lib/sessions';
import { authRoutes } from './routes/auth';
import { hierarchyRoutes } from './routes/hierarchy';
import { adminRoutes } from './routes/admin';
import { userRoutes } from './routes/users';
import { networkRoutes } from './routes/network';
import { postRoutes } from './routes/posts';
import { messageRoutes } from './routes/messages';
import { notificationRoutes } from './routes/notifications';
import { groupRoutes } from './routes/groups';
import { eventRoutes } from './routes/events';
import { articleRoutes } from './routes/articles';
import { jobRoutes } from './routes/jobs';
import { searchRoutes } from './routes/search';
import { mediaRoutes } from './routes/media';
import { reportRoutes } from './routes/reports';
import { companyRoutes } from './routes/companies';
import { platformRoutes } from './routes/platform';
import { devRoutes } from './routes/dev';
import { dnsStubEnabled } from './lib/domains';
import { updateRoutes } from './routes/updates';

// JSON logs to stdout (pino). TRUST_PROXY=true behind the reverse proxy so req.ip is the client, not the proxy.
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization'] },
  trustProxy: env.trustProxy,
});

app.decorateRequest('orgId', null); // set per request by authenticate (lib/org.ts)
await app.register(cors, { origin: true, credentials: true });
await app.register(jwt, { secret: env.jwtSecret, sign: { expiresIn: env.accessTokenTtl } });
await registerRateLimit(app);
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 10 } });

// Action endpoints (accept, hide, save…) are often POSTed with a JSON content-type and no body.
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  try {
    done(null, body === '' ? {} : JSON.parse(body as string));
  } catch {
    done(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }), undefined);
  }
});

app.setErrorHandler((err, req, reply) => {
  if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
  if (err instanceof DagError) return reply.status(409).send({ error: { code: err.code, message: err.message } });
  if (err instanceof ZodError) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: err.issues[0]?.message } });
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return reply.status(409).send({ error: { code: 'CONFLICT', message: 'Already exists' } });
    if (err.code === 'P2025') return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  }
  if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500) {
    return reply.status((err as { statusCode: number }).statusCode).send({ error: { code: 'BAD_REQUEST', message: err.message } });
  }
  req.log.error(err);
  return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
});

// Media URLs: stored canonical, sent signed (SOT §8). Covers every route, so old rows are re-signed on read.
app.addHook('preValidation', async (req) => {
  if (req.body && typeof req.body === 'object') req.body = unsignMedia(req.body);
});
app.addHook('preSerialization', async (_req, _reply, payload) => signMedia(payload));

registerObservability(app);
await app.register(updateRoutes);

await app.register(
  async (api) => {
    await api.register(authRoutes, { prefix: '/auth' });
    await api.register(hierarchyRoutes, { prefix: '/hierarchy' });
    await api.register(adminRoutes, { prefix: '/admin' });
    await api.register(userRoutes, { prefix: '/users' });
    await api.register(networkRoutes, { prefix: '/network' });
    await api.register(postRoutes, { prefix: '/posts' });
    await api.register(messageRoutes, { prefix: '/conversations' });
    await api.register(notificationRoutes, { prefix: '/notifications' });
    await api.register(groupRoutes, { prefix: '/groups' });
    await api.register(eventRoutes, { prefix: '/events' });
    await api.register(articleRoutes, { prefix: '/articles' });
    await api.register(jobRoutes, { prefix: '/jobs' });
    await api.register(searchRoutes, { prefix: '/search' });
    await api.register(mediaRoutes, { prefix: '/media' });
    await api.register(reportRoutes, { prefix: '/reports' });
    await api.register(companyRoutes, { prefix: '/companies' });
    await api.register(platformRoutes, { prefix: '/platform' });
    if (dnsStubEnabled) await api.register(devRoutes, { prefix: '/dev' });
  },
  { prefix: API_PREFIX },
);

await ensureBucket().catch((e) => app.log.warn(`MinIO not reachable, uploads disabled: ${e.message}`));
await app.ready();
await setupRealtime(app, app.server);
const stopRetention = startRetentionJob(app.log);
const prune = () => pruneSessions().catch((e) => app.log.warn(`Session prune failed: ${e.message}`));
prune();
setInterval(prune, 6 * 3600_000).unref();
// Exit promptly on restart/stop: open websockets otherwise keep the process (and the port) alive.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    stopRetention();
    setTimeout(() => process.exit(0), 1500).unref();
    Promise.allSettled([closeRealtime(), app.close()]).finally(() => process.exit(0));
  });
}

// '::' is dual-stack: on Windows `localhost` resolves to ::1 first, and an IPv4-only bind adds ~200 ms per request.
await app.listen({ port: env.port, host: '::' });
