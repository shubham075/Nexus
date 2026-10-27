/**
 * DAG engine for the company hierarchy (SOURCE_OF_TRUTH.md §3).
 * Pure, in-memory, no DB access — the cache in ./cache.ts feeds it.
 */
export interface DagEdge {
  parentId: string;
  childId: string;
}

export class DagError extends Error {
  constructor(public code: 'CYCLE' | 'SELF_EDGE' | 'DUPLICATE_EDGE' | 'UNKNOWN_NODE' | 'LAST_PARENT' | 'HAS_CHILDREN' | 'ROOT', message: string) {
    super(message);
  }
}

export class Dag {
  private parents = new Map<string, Set<string>>();
  private children = new Map<string, Set<string>>();

  constructor(nodeIds: Iterable<string>, edges: Iterable<DagEdge> = []) {
    for (const id of nodeIds) this.addNode(id);
    for (const e of edges) this.addEdge(e.parentId, e.childId);
  }

  /** Copy for validating a mutation before it is persisted. */
  clone(): Dag {
    const edges: DagEdge[] = [];
    for (const [parentId, cs] of this.children) for (const childId of cs) edges.push({ parentId, childId });
    return new Dag(this.nodeIds, edges);
  }

  get nodeIds(): string[] {
    return [...this.parents.keys()];
  }

  has(id: string): boolean {
    return this.parents.has(id);
  }

  addNode(id: string): void {
    if (!this.parents.has(id)) {
      this.parents.set(id, new Set());
      this.children.set(id, new Set());
    }
  }

  removeNode(id: string): void {
    this.assertNode(id);
    for (const p of this.parents.get(id)!) this.children.get(p)!.delete(id);
    for (const c of this.children.get(id)!) this.parents.get(c)!.delete(id);
    this.parents.delete(id);
    this.children.delete(id);
  }

  parentsOf(id: string): string[] {
    this.assertNode(id);
    return [...this.parents.get(id)!];
  }

  childrenOf(id: string): string[] {
    this.assertNode(id);
    return [...this.children.get(id)!];
  }

  roots(): string[] {
    return this.nodeIds.filter((id) => this.parents.get(id)!.size === 0);
  }

  /** True when adding parent → child would close a loop (child already reaches parent). */
  wouldCreateCycle(parentId: string, childId: string): boolean {
    if (parentId === childId) return true;
    return this.reachable(childId, parentId);
  }

  /** Validates and adds an edge; throws DagError on any invariant violation. */
  addEdge(parentId: string, childId: string): void {
    this.assertNode(parentId);
    this.assertNode(childId);
    if (parentId === childId) throw new DagError('SELF_EDGE', 'A node cannot be its own parent');
    if (this.children.get(parentId)!.has(childId)) throw new DagError('DUPLICATE_EDGE', 'Edge already exists');
    if (this.wouldCreateCycle(parentId, childId)) throw new DagError('CYCLE', 'This edge would create a cycle in the hierarchy');
    this.children.get(parentId)!.add(childId);
    this.parents.get(childId)!.add(parentId);
  }

  /** Removes an edge; refuses to orphan a node that had parents (SOT §3.2 #3). */
  removeEdge(parentId: string, childId: string, { allowOrphan = false } = {}): void {
    this.assertNode(parentId);
    this.assertNode(childId);
    const ps = this.parents.get(childId)!;
    if (!ps.has(parentId)) return;
    if (!allowOrphan && ps.size === 1) throw new DagError('LAST_PARENT', 'Cannot remove the last parent of a node; re-parent it first');
    ps.delete(parentId);
    this.children.get(parentId)!.delete(childId);
  }

  ancestors(id: string): Set<string> {
    return this.walk([id], this.parents);
  }

  descendants(id: string): Set<string> {
    return this.walk([id], this.children);
  }

  ancestorsOrSelf(ids: Iterable<string>): Set<string> {
    const start = [...ids].filter((i) => this.has(i));
    const out = this.walk(start, this.parents);
    for (const s of start) out.add(s);
    return out;
  }

  descendantsOrSelf(ids: Iterable<string>): Set<string> {
    const start = [...ids].filter((i) => this.has(i));
    const out = this.walk(start, this.children);
    for (const s of start) out.add(s);
    return out;
  }

  /** Kahn's algorithm. Throws if a cycle exists (integrity check). */
  topoSort(): string[] {
    const indeg = new Map<string, number>();
    for (const [id, ps] of this.parents) indeg.set(id, ps.size);
    const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
    const order: string[] = [];
    while (queue.length) {
      const n = queue.shift()!;
      order.push(n);
      for (const c of this.children.get(n)!) {
        const d = indeg.get(c)! - 1;
        indeg.set(c, d);
        if (d === 0) queue.push(c);
      }
    }
    if (order.length !== this.parents.size) throw new DagError('CYCLE', 'Hierarchy contains a cycle');
    return order;
  }

  /** All root → node paths, for breadcrumbs. Capped to avoid blow-ups in very dense graphs. */
  paths(id: string, limit = 20): string[][] {
    this.assertNode(id);
    const out: string[][] = [];
    const dfs = (node: string, suffix: string[]) => {
      if (out.length >= limit) return;
      const path = [node, ...suffix];
      const ps = this.parents.get(node)!;
      if (ps.size === 0) out.push(path);
      else for (const p of ps) dfs(p, path);
    };
    dfs(id, []);
    return out;
  }

  /** Longest distance from any root; used for layout hints. */
  depth(id: string): number {
    const ps = this.parentsOf(id);
    return ps.length === 0 ? 0 : 1 + Math.max(...ps.map((p) => this.depth(p)));
  }

  private reachable(from: string, to: string): boolean {
    const stack = [from];
    const seen = new Set<string>();
    while (stack.length) {
      const n = stack.pop()!;
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const c of this.children.get(n) ?? []) stack.push(c);
    }
    return false;
  }

  private walk(start: string[], dir: Map<string, Set<string>>): Set<string> {
    const seen = new Set<string>();
    const stack = start.flatMap((s) => [...(dir.get(s) ?? [])]);
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of dir.get(n) ?? []) stack.push(m);
    }
    return seen;
  }

  private assertNode(id: string): void {
    if (!this.parents.has(id)) throw new DagError('UNKNOWN_NODE', `Unknown node ${id}`);
  }
}
