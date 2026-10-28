import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ORG_NODE_TYPES } from '@nexus/shared';
import { prisma } from '../lib/db';
import { badRequest, notFound, parse } from '../lib/http';
import { authenticate, requirePerm, uid } from '../lib/auth';
import { audit, userLite } from '../lib/notify';
import { getDag, invalidateDag } from '../dag/cache';
import { DagError } from '../dag/engine';
import { invalidateRbac } from '../rbac';
import { assertNodesInOrg, assertOrgMembers, orgOf } from '../lib/org';

const nodeBody = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(ORG_NODE_TYPES),
  description: z.string().max(2000).nullish(),
});
const edgeBody = z.object({ parentId: z.string(), childId: z.string() });

function changed(orgId: string) {
  invalidateDag(orgId);
  invalidateRbac(orgId);
}

export const hierarchyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  /** Whole graph of the active org — every employee can view the org chart. */
  app.get('/', async (req) => {
    const org = orgOf(req);
    const [nodes, edges] = await Promise.all([
      prisma.orgNode.findMany({
        where: { orgId: org },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, type: true, description: true, isRoot: true, _count: { select: { memberships: true } } },
      }),
      prisma.orgEdge.findMany({ where: { parent: { orgId: org } }, select: { parentId: true, childId: true } }),
    ]);
    return {
      nodes: nodes.map(({ _count, ...n }) => ({ ...n, memberCount: _count.memberships })),
      edges,
    };
  });

  app.get<{ Params: { id: string } }>('/nodes/:id', async (req) => {
    const org = orgOf(req);
    const node = await prisma.orgNode.findFirst({
      where: { id: req.params.id, orgId: org },
      include: {
        memberships: { include: { user: { select: { ...userLite, email: true } } }, orderBy: { createdAt: 'asc' } },
        grants: { include: { role: true, user: { select: userLite } } },
      },
    });
    if (!node) throw notFound('Node');
    const dag = await getDag(org);
    const ids = new Set([...dag.ancestors(node.id), ...dag.parentsOf(node.id), ...dag.childrenOf(node.id)]);
    const names = new Map(
      (await prisma.orgNode.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, type: true } })).map((n) => [n.id, n]),
    );
    return {
      ...node,
      parents: dag.parentsOf(node.id).map((id) => names.get(id)),
      children: dag.childrenOf(node.id).map((id) => names.get(id)),
      paths: dag.paths(node.id).map((p) => p.map((id) => (id === node.id ? { id, name: node.name } : names.get(id)))),
      descendantCount: dag.descendants(node.id).size,
    };
  });

  app.post('/nodes', { preHandler: requirePerm('hierarchy.manage') }, async (req) => {
    const org = orgOf(req);
    const body = parse(nodeBody.extend({ parentIds: z.array(z.string()).min(1, 'Pick at least one parent') }), req.body);
    const dag = await getDag(org);
    for (const p of body.parentIds) if (!dag.has(p)) throw notFound('Parent node');
    const node = await prisma.orgNode.create({
      data: {
        orgId: org,
        name: body.name,
        type: body.type,
        description: body.description,
        parentEdges: { create: [...new Set(body.parentIds)].map((parentId) => ({ parentId })) },
      },
    });
    changed(org);
    await audit(org, uid(req), 'hierarchy.node.create', node.id, { name: node.name, parentIds: body.parentIds });
    return node;
  });

  app.patch<{ Params: { id: string } }>('/nodes/:id', { preHandler: requirePerm('hierarchy.manage') }, async (req) => {
    const org = orgOf(req);
    const body = parse(nodeBody.partial(), req.body);
    await assertNodesInOrg(org, [req.params.id]);
    const node = await prisma.orgNode.update({ where: { id: req.params.id }, data: body });
    await audit(org, uid(req), 'hierarchy.node.update', node.id, body);
    return node;
  });

  /** ?reparent=true attaches the node's children to its parents before deleting (SOT §3.2 #4). */
  app.delete<{ Params: { id: string }; Querystring: { reparent?: string } }>(
    '/nodes/:id',
    { preHandler: requirePerm('hierarchy.manage') },
    async (req) => {
      const org = orgOf(req);
      const node = await prisma.orgNode.findFirst({ where: { id: req.params.id, orgId: org } });
      if (!node) throw notFound('Node');
      if (node.isRoot) throw new DagError('ROOT', 'The company root cannot be deleted');
      const dag = (await getDag(org)).clone();
      const parents = dag.parentsOf(node.id);
      const children = dag.childrenOf(node.id);
      if (children.length && req.query.reparent !== 'true') {
        throw new DagError('HAS_CHILDREN', 'Node has child units; delete them first or re-parent them');
      }
      dag.removeNode(node.id);
      const newEdges: { parentId: string; childId: string }[] = [];
      for (const c of children) {
        for (const p of parents) {
          if (!dag.parentsOf(c).includes(p)) {
            dag.addEdge(p, c);
            newEdges.push({ parentId: p, childId: c });
          }
        }
      }
      await prisma.$transaction([
        prisma.orgEdge.createMany({ data: newEdges, skipDuplicates: true }),
        prisma.orgNode.delete({ where: { id: node.id } }),
      ]);
      changed(org);
      await audit(org, uid(req), 'hierarchy.node.delete', node.id, { name: node.name, reparented: newEdges.length });
      return { ok: true };
    },
  );

  app.post('/edges', { preHandler: requirePerm('hierarchy.manage') }, async (req) => {
    const org = orgOf(req);
    const { parentId, childId } = parse(edgeBody, req.body);
    await assertNodesInOrg(org, [parentId, childId]);
    const dag = (await getDag(org)).clone();
    dag.addEdge(parentId, childId); // throws DagError on cycle / duplicate / unknown
    const edge = await prisma.orgEdge.create({ data: { parentId, childId } });
    changed(org);
    await audit(org, uid(req), 'hierarchy.edge.add', `${parentId}->${childId}`);
    return edge;
  });

  app.delete('/edges', { preHandler: requirePerm('hierarchy.manage') }, async (req) => {
    const org = orgOf(req);
    const { parentId, childId } = parse(edgeBody, req.query);
    await assertNodesInOrg(org, [parentId, childId]);
    const dag = (await getDag(org)).clone();
    dag.removeEdge(parentId, childId); // throws on last parent
    await prisma.orgEdge.delete({ where: { parentId_childId: { parentId, childId } } });
    changed(org);
    await audit(org, uid(req), 'hierarchy.edge.remove', `${parentId}->${childId}`);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/nodes/:id/members', { preHandler: requirePerm('users.manage') }, async (req) => {
    const body = parse(
      z.object({ userIds: z.array(z.string()).min(1), title: z.string().max(120).nullish(), isPrimary: z.boolean().optional() }),
      req.body,
    );
    const org = orgOf(req);
    if (!(await getDag(org)).has(req.params.id)) throw notFound('Node');
    await assertOrgMembers(org, body.userIds);
    await prisma.membership.createMany({
      data: body.userIds.map((userId) => ({ userId, nodeId: req.params.id, title: body.title, isPrimary: body.isPrimary ?? false })),
      skipDuplicates: true,
    });
    changed(org);
    await audit(org, uid(req), 'membership.add', req.params.id, { userIds: body.userIds });
    return { ok: true };
  });

  app.patch<{ Params: { id: string; userId: string } }>(
    '/nodes/:id/members/:userId',
    { preHandler: requirePerm('users.manage') },
    async (req) => {
      const org = orgOf(req);
      const body = parse(z.object({ title: z.string().max(120).nullish(), isPrimary: z.boolean().optional() }), req.body);
      await assertNodesInOrg(org, [req.params.id]);
      if (body.isPrimary) {
        await prisma.membership.updateMany({ where: { userId: req.params.userId, node: { orgId: org } }, data: { isPrimary: false } });
      }
      return prisma.membership.update({
        where: { userId_nodeId: { userId: req.params.userId, nodeId: req.params.id } },
        data: body,
      });
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    '/nodes/:id/members/:userId',
    { preHandler: requirePerm('users.manage') },
    async (req) => {
      const org = orgOf(req);
      await assertNodesInOrg(org, [req.params.id]);
      const count = await prisma.membership.count({ where: { userId: req.params.userId, node: { orgId: org } } });
      if (count <= 1) throw badRequest('An employee must belong to at least one unit');
      await prisma.membership.delete({ where: { userId_nodeId: { userId: req.params.userId, nodeId: req.params.id } } });
      changed(org);
      await audit(org, uid(req), 'membership.remove', req.params.id, { userId: req.params.userId });
      return { ok: true };
    },
  );
};
