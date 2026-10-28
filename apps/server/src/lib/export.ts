import { APP_NAME } from '@nexus/shared';
import { prisma } from './db';
import { notFound } from './http';
import { audit, userLite } from './notify';

/**
 * Personal data export (SOT §8): everything a user authored or owns, as one JSON document.
 * Messages are the user's own; other participants appear by name only. Media links are signed
 * on the way out (index.ts) and so expire like any other media URL.
 */
export async function buildUserExport(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, headline: true, about: true, location: true, avatarUrl: true, coverUrl: true,
      pronouns: true, openTo: true, isActive: true, createdAt: true, updatedAt: true, lastSeenAt: true,
      memberships: { select: { title: true, isPrimary: true, createdAt: true, node: { select: { id: true, name: true, type: true } } } },
      experiences: true,
      educations: true,
      skills: { select: { name: true, endorsements: { select: { createdAt: true, endorser: { select: { id: true, name: true } } } } } },
    },
  });
  if (!user) throw notFound('User');

  const [posts, comments, reactions, savedPosts, messages, sentRequests, receivedRequests, following, followers, articles, groups, events, jobApplications] =
    await Promise.all([
      prisma.post.findMany({
        where: { authorId: userId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, kind: true, body: true, celebration: true, repostOfId: true, groupId: true, isPinned: true, isHidden: true,
          createdAt: true, editedAt: true,
          media: { select: { url: true, mimeType: true, fileName: true }, orderBy: { sortOrder: 'asc' } },
          poll: { select: { question: true, endsAt: true, options: { select: { text: true, _count: { select: { votes: true } } }, orderBy: { sortOrder: 'asc' } } } },
        },
      }),
      prisma.comment.findMany({
        where: { authorId: userId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, postId: true, parentId: true, body: true, isHidden: true, createdAt: true, editedAt: true },
      }),
      prisma.reaction.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { type: true, postId: true, commentId: true, createdAt: true } }),
      prisma.savedPost.findMany({ where: { userId }, select: { postId: true, createdAt: true } }),
      prisma.message.findMany({
        where: { senderId: userId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, body: true, attachmentUrl: true, attachmentName: true, attachmentMime: true, createdAt: true,
          conversation: { select: { id: true, title: true, isGroup: true, members: { select: { user: { select: { id: true, name: true } } } } } },
        },
      }),
      prisma.connection.findMany({ where: { requesterId: userId }, select: { status: true, message: true, createdAt: true, respondedAt: true, addressee: { select: userLite } } }),
      prisma.connection.findMany({ where: { addresseeId: userId }, select: { status: true, message: true, createdAt: true, respondedAt: true, requester: { select: userLite } } }),
      prisma.follow.findMany({ where: { followerId: userId }, select: { createdAt: true, followee: { select: { id: true, name: true } } } }),
      prisma.follow.findMany({ where: { followeeId: userId }, select: { createdAt: true, follower: { select: { id: true, name: true } } } }),
      prisma.article.findMany({ where: { authorId: userId }, select: { id: true, title: true, body: true, coverUrl: true, publishedAt: true, updatedAt: true } }),
      prisma.groupMember.findMany({ where: { userId }, select: { role: true, joinedAt: true, group: { select: { id: true, name: true } } } }),
      prisma.eventRsvp.findMany({ where: { userId }, select: { status: true, createdAt: true, event: { select: { id: true, title: true, startsAt: true } } } }),
      prisma.jobApplication.findMany({ where: { userId }, select: { note: true, status: true, createdAt: true, job: { select: { id: true, title: true } } } }),
    ]);

  const connections = [
    ...sentRequests.map(({ addressee, ...c }) => ({ ...c, direction: 'sent' as const, user: addressee })),
    ...receivedRequests.map(({ requester, ...c }) => ({ ...c, direction: 'received' as const, user: requester })),
  ];

  return {
    format: `${APP_NAME.toLowerCase()}-user-export`,
    version: 1,
    exportedAt: new Date().toISOString(),
    note: 'Media links in this file expire after a few hours; download any files you want to keep right away.',
    profile: user,
    posts,
    comments,
    reactions,
    savedPosts,
    articles,
    messages: messages.map(({ conversation, ...m }) => ({
      ...m,
      conversation: { id: conversation.id, title: conversation.title, isGroup: conversation.isGroup, participants: conversation.members.map((x) => x.user) },
    })),
    connections,
    following: following.map((f) => ({ ...f.followee, since: f.createdAt })),
    followers: followers.map((f) => ({ ...f.follower, since: f.createdAt })),
    groups,
    events,
    jobApplications,
  };
}

/** Builds the export and records who exported whom in the active org's audit log (`user.export`). */
export async function exportUser(actorId: string, userId: string, orgId: string | null) {
  const data = await buildUserExport(userId);
  if (orgId) await audit(orgId, actorId, 'user.export', userId, { self: actorId === userId });
  return data;
}

export const exportFileName = (name: string) =>
  `${APP_NAME.toLowerCase()}-export-${name.replace(/[^\w-]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
