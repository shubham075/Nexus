import type { FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { notFound } from './http';
import { isOrgMember, postsVisibleIn } from './org';
import { getDag } from '../dag/cache';

/**
 * Post visibility (SOT §14.2/§14.3): the one place that decides who may see a post. Every read of a post,
 * or of anything hanging off one (comments, reactions, reposts, polls, saves, articles, hashtags, search,
 * profile activity, notifications, media URLs), goes through `postWhere` / `canSeePost`.
 *
 * - author: always (unless hidden by a moderator)
 * - PUBLIC: everyone signed in
 * - CONNECTIONS: the author's accepted connections
 * - ORG: members of `post.orgId` while it is their active org; with audience units, only members of
 *   those units or any unit below them in the DAG
 * Group/event/job posts also need that row to be visible in the active org, and a repost is only visible
 * where its original is, so reposting never widens an audience.
 */
export interface Viewer {
  userId: string;
  orgId: string | null;
  connections: string[];
  /** The viewer's units in `orgId` plus every ancestor: an ORG post targeting any of these reaches them. */
  audienceNodes: string[];
}

export async function connectionIds(userId: string): Promise<string[]> {
  const rows = await prisma.connection.findMany({
    where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
}

export async function viewerFor(userId: string, orgId: string | null): Promise<Viewer> {
  const [connections, memberships] = await Promise.all([
    connectionIds(userId),
    orgId ? prisma.membership.findMany({ where: { userId, node: { orgId } }, select: { nodeId: true } }) : [],
  ]);
  let audienceNodes: string[] = [];
  if (orgId && memberships.length) {
    const dag = await getDag(orgId);
    audienceNodes = [...dag.ancestorsOrSelf(memberships.map((m) => m.nodeId).filter((id) => dag.has(id)))];
  }
  return { userId, orgId, connections, audienceNodes };
}

const viewers = new WeakMap<FastifyRequest, Promise<Viewer>>();

/** The signed-in viewer in the request's active org, computed once per request. */
export function viewerOf(req: FastifyRequest): Promise<Viewer> {
  let v = viewers.get(req);
  if (!v) {
    v = viewerFor(req.user.sub, req.orgId);
    viewers.set(req, v);
  }
  return v;
}

/** Audience rule alone (no repost check), shared by a post and its original. */
function reach(v: Viewer): Prisma.PostWhereInput {
  const or: Prisma.PostWhereInput[] = [
    { authorId: v.userId },
    { visibility: 'PUBLIC' },
    { visibility: 'CONNECTIONS', authorId: { in: v.connections } },
  ];
  if (v.orgId) {
    or.push({
      visibility: 'ORG',
      orgId: v.orgId,
      OR: [{ audience: { none: {} } }, { audience: { some: { nodeId: { in: v.audienceNodes } } } }],
    });
  }
  return { AND: [{ OR: or }, postsVisibleIn(v.orgId)] };
}

/** Prisma `where` for "posts this viewer may see". Combine with other filters via `AND`, never by spreading. */
export function postWhere(v: Viewer): Prisma.PostWhereInput {
  return { AND: [{ isHidden: false }, reach(v), { OR: [{ repostOfId: null }, { repostOf: reach(v) }] }] };
}

export async function canSeePost(v: Viewer, postId: string): Promise<boolean> {
  return (await prisma.post.count({ where: { AND: [{ id: postId }, postWhere(v)] } })) > 0;
}

/** 404 (not 403) when the viewer may not see the post, so its existence isn't leaked. */
export async function assertSeePost(req: FastifyRequest, postId: string): Promise<void> {
  if (!(await canSeePost(await viewerOf(req), postId))) throw notFound('Post');
}

/**
 * For notifications: may this user see the post at all (in the post's org if they belong to it,
 * otherwise as an outsider)? Used so a mention or reaction never tells someone about a post they can't open.
 */
export async function userCanSeePost(userId: string, postId: string): Promise<boolean> {
  const p = await prisma.post.findUnique({ where: { id: postId }, select: { orgId: true } });
  if (!p) return false;
  const orgId = p.orgId && (await isOrgMember(p.orgId, userId)) ? p.orgId : null;
  return canSeePost(await viewerFor(userId, orgId), postId);
}
