import type { NotificationType } from '@nexus/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { emitToUser } from './realtime';
import { userCanSeePost } from './visibility';

export const userLite = { id: true, name: true, headline: true, avatarUrl: true } as const;

/** `postId`: the post the notification is about; skipped when the recipient may not see it (SOT §14.3). */
export async function notify(n: { recipientId: string; actorId?: string | null; type: NotificationType; text: string; link?: string; postId?: string }) {
  if (n.actorId && n.actorId === n.recipientId) return;
  if (n.postId && !(await userCanSeePost(n.recipientId, n.postId))) return;
  const row = await prisma.notification.create({
    data: { recipientId: n.recipientId, actorId: n.actorId ?? null, type: n.type, text: n.text, link: n.link },
    include: { actor: { select: userLite } },
  });
  emitToUser(n.recipientId, 'notification:new', row);
}

/** Audit entries belong to the org the action happened in (SOT §14.2). */
export function audit(orgId: string, actorId: string, action: string, target?: string, meta?: Prisma.InputJsonValue) {
  return prisma.auditLog.create({ data: { orgId, actorId, action, target, meta } });
}
