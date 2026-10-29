import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/http';
import { stubTxt } from '../lib/domains';
import { normalizeDomain } from '../lib/companies';
import { purgeExpired } from '../lib/retention';
import { env } from '../lib/env';

/**
 * Dev/e2e helpers, registered only when DNS_STUB=true outside production: lets the e2e suite publish a
 * domain's TXT records without touching real DNS, and run the unverified-account purge as of a later date.
 */
export const devRoutes: FastifyPluginAsync = async (app) => {
  app.put<{ Params: { domain: string } }>('/dns/:domain', async (req) => {
    const { txt } = parse(z.object({ txt: z.array(z.string().max(500)).max(20) }), req.body);
    const domain = normalizeDomain(req.params.domain) ?? req.params.domain;
    stubTxt.set(domain, txt);
    return { domain, txt };
  });

  /** Runs only the unverified-account purge, `days` days from now. */
  app.post('/purge-unverified', async (req) => {
    const { days } = parse(z.object({ days: z.number().int().min(0).max(3650) }), req.body);
    const off = { ...env.retention, hiddenContentDays: 0, messageDays: 0, readNotificationDays: 0, notificationDays: 0, auditLogDays: 0 };
    return purgeExpired(off, Date.now() + days * 86_400_000);
  });
};
