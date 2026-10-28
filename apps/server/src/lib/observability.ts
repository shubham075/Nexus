import type { FastifyInstance } from 'fastify';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { prisma } from './db';
import { s3 } from './storage';
import { env } from './env';

const CHECK_TIMEOUT_MS = 3000;

async function timed(check: () => Promise<unknown>): Promise<{ ok: boolean; ms: number; error?: string }> {
  const start = performance.now();
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS).unref()),
    ]);
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - start), error: (e as Error).name === 'Error' ? (e as Error).message : (e as Error).name };
  }
}

/**
 * /health/live — the process is up (use for restarts).
 * /health/ready and /health — Postgres and object storage answer (use for load balancers / monitors).
 * /metrics — Prometheus text format, only when METRICS_ENABLED=true; optional METRICS_TOKEN bearer.
 */
export function registerObservability(app: FastifyInstance) {
  // Probes run every few seconds, so their request logs are dropped below warn.
  app.get('/health/live', { logLevel: 'warn' }, async () => ({ ok: true, uptime: Math.round(process.uptime()) }));

  const ready = async (_req: unknown, reply: { status: (c: number) => unknown }) => {
    const [db, storage] = await Promise.all([
      timed(() => prisma.$queryRaw`SELECT 1`),
      timed(() => s3.send(new HeadBucketCommand({ Bucket: env.s3.bucket }))),
    ]);
    const ok = db.ok && storage.ok;
    if (!ok) reply.status(503);
    return { ok, checks: { db, storage } };
  };
  app.get('/health/ready', { logLevel: 'warn' }, ready);
  app.get('/health', { logLevel: 'warn' }, ready);

  if (process.env.METRICS_ENABLED !== 'true') return;

  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'nexus_' });
  const requests = new Counter({
    name: 'nexus_http_requests_total',
    help: 'HTTP requests by method, route and status',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'nexus_http_request_duration_seconds',
    help: 'HTTP request duration by method and route',
    labelNames: ['method', 'route'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  app.addHook('onResponse', async (req, reply) => {
    // routeOptions.url is the route pattern (/api/v1/posts/:id), so label cardinality stays bounded.
    const route = req.routeOptions.url ?? 'unmatched';
    if (route === '/metrics') return;
    requests.inc({ method: req.method, route, status: String(reply.statusCode) });
    duration.observe({ method: req.method, route }, reply.elapsedTime / 1000);
  });

  const token = process.env.METRICS_TOKEN;
  app.get('/metrics', { logLevel: 'warn' }, async (req, reply) => {
    if (token && req.headers.authorization !== `Bearer ${token}`) return reply.status(401).send();
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
}
