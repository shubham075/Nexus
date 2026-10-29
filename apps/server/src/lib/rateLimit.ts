import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { env } from './env';
import { HttpError } from './http';

/** Rate limits (SOT §8). Authenticated traffic is keyed per user so a shared office NAT doesn't throttle everyone. */

function userOrIp(app: FastifyInstance, req: FastifyRequest): string {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    try {
      return `u:${app.jwt.verify<{ sub: string }>(h.slice(7)).sub}`;
    } catch {
      /* invalid/expired token: fall back to IP */
    }
  }
  return `ip:${req.ip}`;
}

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  if (!env.rateLimit) return;
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    keyGenerator: (req) => userOrIp(app, req),
    errorResponseBuilder: (_req, ctx) =>
      new HttpError(429, 'RATE_LIMITED', `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)} seconds.`),
  });
}

export const email = (req: FastifyRequest) => String((req.body as { email?: unknown } | undefined)?.email ?? '').toLowerCase();

/** Per-route `config.rateLimit` presets for sensitive endpoints. */
export const limits = {
  // preHandler: the default onRequest hook runs before body parsing, so the email would always be empty
  // and every sign-in behind one office IP would share a single bucket.
  login: { max: 10, timeWindow: '1 minute', hook: 'preHandler' as const, keyGenerator: (req: FastifyRequest) => `login:${req.ip}:${email(req)}` },
  refresh: { max: 30, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => `refresh:${req.ip}` },
  changePassword: { max: 5, timeWindow: '1 minute' },
  /** Sign-up and "email me a link" requests: per IP and per address (see `keyedLimit`), so one inbox can't be flooded. */
  signup: { max: env.abuse.signupsPerIp || 1e9, timeWindow: '1 hour', hook: 'preHandler' as const, keyGenerator: (req: FastifyRequest) => `signup:${req.ip}` },
  emailLink: { max: 3, timeWindow: '15 minutes', hook: 'preHandler' as const, keyGenerator: (req: FastifyRequest) => `mail:${email(req)}` },
  /** Redeeming a token (verify / reset / invite): guessing is hopeless at 256 bits, this just caps abuse. */
  redeem: { max: 20, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => `redeem:${req.ip}` },
  companyWrite: { max: 30, timeWindow: '1 minute' },
  sso: { max: 20, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => `sso:${req.ip}` },
};

/**
 * A second, independent limit for a route that already has a `config.rateLimit` (the plugin allows one
 * per route). In-memory like the plugin's default store; use as a `preHandler` so the body is parsed.
 * `max` 0 disables it.
 */
export function keyedLimit(max: number, windowMs: number, key: (req: FastifyRequest) => string) {
  const hits = new Map<string, { n: number; reset: number }>();
  return async (req: FastifyRequest) => {
    if (!env.rateLimit || !max) return;
    const now = Date.now();
    const k = key(req);
    let h = hits.get(k);
    if (!h || h.reset <= now) {
      if (hits.size > 10_000) for (const [old, v] of hits) if (v.reset <= now) hits.delete(old);
      h = { n: 0, reset: now + windowMs };
      hits.set(k, h);
    }
    if (++h.n > max) throw new HttpError(429, 'RATE_LIMITED', `Too many requests. Try again in ${Math.ceil((h.reset - now) / 1000)} seconds.`);
  };
}
