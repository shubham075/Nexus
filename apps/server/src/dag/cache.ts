import { prisma } from '../lib/db';
import { Dag } from './engine';

const cached = new Map<string, Promise<Dag>>();

/** In-memory DAG of one organization's hierarchy (SOT D11, §14.3). Invalidate after any hierarchy mutation. */
export function getDag(orgId: string): Promise<Dag> {
  let dag = cached.get(orgId);
  if (!dag) {
    dag = (async () => {
      const [nodes, edges] = await Promise.all([
        prisma.orgNode.findMany({ where: { orgId }, select: { id: true } }),
        prisma.orgEdge.findMany({ where: { parent: { orgId } }, select: { parentId: true, childId: true } }),
      ]);
      return new Dag(nodes.map((n) => n.id), edges);
    })().catch((e) => {
      cached.delete(orgId);
      throw e;
    });
    cached.set(orgId, dag);
  }
  return dag;
}

/** Drop one org's DAG, or every org's when called without an id. */
export function invalidateDag(orgId?: string): void {
  if (orgId) cached.delete(orgId);
  else cached.clear();
}
