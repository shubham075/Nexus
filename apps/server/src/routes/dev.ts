import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/http';
import { stubTxt } from '../lib/domains';
import { normalizeDomain } from '../lib/companies';

/**
 * Dev/e2e helpers, registered only when DNS_STUB=true outside production: lets the e2e suite publish a
 * domain's TXT records without touching real DNS.
 */
export const devRoutes: FastifyPluginAsync = async (app) => {
  app.put<{ Params: { domain: string } }>('/dns/:domain', async (req) => {
    const { txt } = parse(z.object({ txt: z.array(z.string().max(500)).max(20) }), req.body);
    const domain = normalizeDomain(req.params.domain) ?? req.params.domain;
    stubTxt.set(domain, txt);
    return { domain, txt };
  });
};
