import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { HttpError, badRequest, notFound } from '../lib/http';
import { authenticate } from '../lib/auth';
import { env } from '../lib/env';
import { getObject, mediaUrl, putObject } from '../lib/storage';
import { MEDIA_KEY_RE, verifyMediaSig } from '../lib/signedMedia';

const ALLOWED = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|application\/pdf)$/;
const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf',
};

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  /** Upload one or more files → [{ url, mimeType, fileName }] (SOT §8 upload rules). */
  app.post('/', { preHandler: authenticate }, async (req) => {
    const out: { url: string; mimeType: string; fileName: string }[] = [];
    for await (const part of req.files()) {
      if (!ALLOWED.test(part.mimetype)) throw badRequest(`File type not allowed: ${part.mimetype}`);
      const buf = await part.toBuffer();
      const key = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${EXT[part.mimetype]}`;
      await putObject(key, buf, part.mimetype);
      out.push({ url: mediaUrl(key), mimeType: part.mimetype, fileName: part.filename });
    }
    if (!out.length) throw badRequest('No files');
    return out;
  });

  /**
   * Signed URL only (SOT §8): `?exp=&sig=` issued by the API on every response that carries media, so
   * <img>/<video> tags work without putting the bearer token in the URL. Expired or tampered links → 403.
   */
  app.get<{ Params: { '*': string }; Querystring: { exp?: string; sig?: string } }>('/*', async (req, reply) => {
    const key = req.params['*'];
    if (!MEDIA_KEY_RE.test(key)) throw notFound('File');
    const check = verifyMediaSig(key, req.query.exp, req.query.sig, env.media.urlSecret);
    if (check !== 'ok') throw new HttpError(403, 'FORBIDDEN', check === 'expired' ? 'Link expired; reload to get a new one' : 'Invalid media link');
    try {
      const obj = await getObject(key);
      reply.header('Content-Type', obj.ContentType ?? 'application/octet-stream');
      reply.header('Cache-Control', `private, max-age=${Math.max(0, Number(req.query.exp) - Math.floor(Date.now() / 1000))}`);
      if (obj.ContentLength) reply.header('Content-Length', obj.ContentLength);
      return reply.send(obj.Body as Readable);
    } catch {
      throw notFound('File');
    }
  });
};
