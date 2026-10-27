import type { NotificationType } from '@nexus/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { emitToUser } from './realtime';

export const userLite = { id: true, name: true, headline: true, avatarUrl: true } as const;

export async function notify(n: { recipientId: string; actorId?: string | null; type: NotificationType; text: string; link?: string }) {
  if (n.actorId && n.actorId === n.recipientId) return;
  const row = await prisma.notification.create({
    data: { recipientId: n.recipientId, actorId: n.actorId ?? null, type: n.type, text: n.text, link: n.link },
    include: { actor: { select: userLite } },
  });
  emitToUser(n.recipientId, 'notification:new', row);
}

export function audit(actorId: string, action: string, target?: string, meta?: Prisma.InputJsonValue) {
  return prisma.auditLog.create({ data: { actorId, action, target, meta } });
}
