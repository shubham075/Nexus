import type { FastifyBaseLogger } from 'fastify';
import { prisma } from './db';
import { env } from './env';
import { deleteObject } from './storage';
import { MEDIA_PATH } from './signedMedia';

/** Retention purge (SOT §11 proposal). Settings come from env (`RETENTION_*`); 0 days = keep forever. */
export type RetentionPolicy = typeof env.retention;

export interface PurgeResult {
  at: string;
  hiddenPosts: number;
  hiddenComments: number;
  messages: number;
  notifications: number;
  auditLogs: number;
  unverifiedUsers: number;
  files: number;
}

const DAY = 86_400_000;
const BATCH = 500;
const cutoff = (days: number, now: number) => (days > 0 ? new Date(now - days * DAY) : null);
const keyOf = (url: string | null | undefined) => (url?.includes(MEDIA_PATH) ? url.split(MEDIA_PATH)[1].split('?')[0] : null);

/** Delete stored files no remaining row points to (files are shared only via copied URLs). */
async function deleteUnreferencedFiles(keys: string[], log?: FastifyBaseLogger): Promise<number> {
  let n = 0;
  for (const key of new Set(keys)) {
    const has = { contains: key };
    const refs = await Promise.all([
      prisma.postMedia.count({ where: { url: has } }),
      prisma.message.count({ where: { attachmentUrl: has } }),
      prisma.user.count({ where: { OR: [{ avatarUrl: has }, { coverUrl: has }] } }),
      prisma.group.count({ where: { coverUrl: has } }),
      prisma.event.count({ where: { coverUrl: has } }),
      prisma.article.count({ where: { OR: [{ coverUrl: has }, { body: has }] } }),
    ]);
    if (refs.some((c) => c > 0)) continue;
    try {
      await deleteObject(key);
      n++;
    } catch (e) {
      log?.warn(`retention: could not delete file ${key}: ${(e as Error).message}`);
    }
  }
  return n;
}

export async function purgeExpired(policy: RetentionPolicy = env.retention, now = Date.now(), log?: FastifyBaseLogger): Promise<PurgeResult> {
  const r: PurgeResult = { at: new Date(now).toISOString(), hiddenPosts: 0, hiddenComments: 0, messages: 0, notifications: 0, auditLogs: 0, unverifiedUsers: 0, files: 0 };
  const files: string[] = [];

  const hidden = cutoff(policy.hiddenContentDays, now);
  if (hidden) {
    for (;;) {
      const posts = await prisma.post.findMany({
        where: { isHidden: true, hiddenAt: { lt: hidden } },
        take: BATCH,
        select: { id: true, media: { select: { url: true } } },
      });
      if (!posts.length) break;
      for (const p of posts) for (const m of p.media) files.push(keyOf(m.url) ?? '');
      r.hiddenPosts += (await prisma.post.deleteMany({ where: { id: { in: posts.map((p) => p.id) } } })).count;
    }
    r.hiddenComments = (await prisma.comment.deleteMany({ where: { isHidden: true, hiddenAt: { lt: hidden } } })).count;
  }

  const msgs = cutoff(policy.messageDays, now);
  if (msgs) {
    for (;;) {
      const rows = await prisma.message.findMany({ where: { createdAt: { lt: msgs } }, take: BATCH, select: { id: true, attachmentUrl: true } });
      if (!rows.length) break;
      for (const m of rows) files.push(keyOf(m.attachmentUrl) ?? '');
      r.messages += (await prisma.message.deleteMany({ where: { id: { in: rows.map((m) => m.id) } } })).count;
    }
  }

  const readN = cutoff(policy.readNotificationDays, now);
  const allN = cutoff(policy.notificationDays, now);
  if (readN || allN) {
    r.notifications = (
      await prisma.notification.deleteMany({
        where: { OR: [...(readN ? [{ readAt: { not: null }, createdAt: { lt: readN } }] : []), ...(allN ? [{ createdAt: { lt: allN } }] : [])] },
      })
    ).count;
  }

  const audit = cutoff(policy.auditLogDays, now);
  if (audit) r.auditLogs = (await prisma.auditLog.deleteMany({ where: { createdAt: { lt: audit } } })).count;

  // Sign-ups never verified (2d): they could not sign in, so they own no content. Skip anyone already
  // placed in a company or made an admin, in case an account was set up by hand.
  const unverified = cutoff(policy.unverifiedAccountDays, now);
  if (unverified) {
    r.unverifiedUsers = (
      await prisma.user.deleteMany({
        where: { emailVerifiedAt: null, createdAt: { lt: unverified }, isSuperAdmin: false, orgMemberships: { none: {} } },
      })
    ).count;
  }

  r.files = await deleteUnreferencedFiles(files.filter(Boolean), log);
  return r;
}

let lastRun: PurgeResult | null = null;
export const lastPurge = () => lastRun;

/** Runs the purge a minute after start-up, then every `purgeEveryHours`. Returns a stop function. */
export function startRetentionJob(log: FastifyBaseLogger): () => void {
  const hours = env.retention.purgeEveryHours;
  if (!hours) {
    log.info('retention: purge job disabled (RETENTION_PURGE_EVERY_HOURS=0)');
    return () => {};
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      lastRun = await purgeExpired(env.retention, Date.now(), log);
      log.info({ retention: lastRun }, 'retention: purge finished');
    } catch (e) {
      log.error(e, 'retention: purge failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, 60_000).unref();
  const every = setInterval(run, hours * 3_600_000).unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
