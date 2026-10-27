import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { badRequest, notFound } from '../lib/http';
import { authenticate } from '../lib/auth';
import { getObject, mediaUrl, putObject } from '../lib/storage';

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

  /** Served without auth so <img>/<video> tags work; keys are unguessable UUIDs (phase 1 trade-off). */
  app.get<{ Params: { '*': string } }>('/*', async (req, reply) => {
    const key = req.params['*'];
    if (!/^[\w-]+\/[\w-]+\.\w+$/.test(key)) throw notFound('File');
    try {
      const obj = await getObject(key);
      reply.header('Content-Type', obj.ContentType ?? 'application/octet-stream');
      reply.header('Cache-Control', 'private, max-age=31536000, immutable');
      if (obj.ContentLength) reply.header('Content-Length', obj.ContentLength);
      return reply.send(obj.Body as Readable);
    } catch {
      throw notFound('File');
    }
  });
};
