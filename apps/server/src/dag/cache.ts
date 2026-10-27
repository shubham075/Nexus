import { prisma } from '../lib/db';
import { Dag } from './engine';

let cached: Promise<Dag> | null = null;

/** In-memory DAG of the whole org (SOT D11: < 500 users). Invalidate after any hierarchy mutation. */
export function getDag(): Promise<Dag> {
  cached ??= (async () => {
    const [nodes, edges] = await Promise.all([
      prisma.orgNode.findMany({ select: { id: true } }),
      prisma.orgEdge.findMany({ select: { parentId: true, childId: true } }),
    ]);
    return new Dag(nodes.map((n) => n.id), edges);
  })().catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}

export function invalidateDag(): void {
  cached = null;
}
