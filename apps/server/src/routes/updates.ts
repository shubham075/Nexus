import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { env } from '../lib/env';

/**
 * Desktop auto-update feed (SOT §13): GET /updates/latest.yml, /updates/Nexus-Setup-<v>.exe(.blockmap).
 * Public on purpose (the updater sends no token); the folder only holds installers.
 * Range requests are supported, so clients download only the changed blocks.
 */
export async function updateRoutes(app: FastifyInstance) {
  const root = resolve(env.updatesDir);
  if (!existsSync(root)) {
    app.log.info(`Update feed folder ${root} not found, /updates disabled`);
    return;
  }
  await app.register(fastifyStatic, {
    root,
    prefix: '/updates/',
    index: false,
    list: false,
    dotfiles: 'deny',
    // latest.yml must never be cached or clients miss a release; installers are named per version.
    setHeaders: (res, path) => {
      res.setHeader('Cache-Control', path.endsWith('.yml') ? 'no-cache' : 'public, max-age=3600');
    },
  });
}
