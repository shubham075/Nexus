import type { Dag } from '../dag/engine';

/** A role grant flattened to its permissions. userId null = node grant (SOT §4.3). */
export interface Grant {
  nodeId: string;
  userId: string | null;
  permissions: string[];
}

export interface Subject {
  userId: string;
  isSuperAdmin: boolean;
  memberNodes: string[];
}

/** Grants that apply to the subject: node grants on any ancestor-or-self of their nodes, plus their own user grants. */
export function applicableGrants(dag: Dag, subject: Subject, grants: Grant[]): Grant[] {
  const inherited = dag.ancestorsOrSelf(subject.memberNodes);
  return grants.filter((g) => (g.userId === null ? inherited.has(g.nodeId) : g.userId === subject.userId));
}

/** SOT §4.4 — targetNodes omitted means "anywhere"; otherwise the grant's scope must contain a target node. */
export function resolveCan(dag: Dag, subject: Subject, grants: Grant[], perm: string, targetNodes?: string[]): boolean {
  if (subject.isSuperAdmin) return true;
  const mine = applicableGrants(dag, subject, grants);
  if (mine.some((g) => g.permissions.includes('admin.all'))) return true;
  const withPerm = mine.filter((g) => g.permissions.includes(perm));
  if (!withPerm.length) return false;
  if (!targetNodes) return true;
  const targetScope = dag.ancestorsOrSelf(targetNodes);
  return withPerm.some((g) => targetScope.has(g.nodeId));
}

/**
 * Where a permission reaches: 'ALL' (super admin, admin.all, or granted on a root unit) or the set of
 * units covered by the grants' sub-DAGs. Empty set = no access. Used for scoped views like manager analytics.
 */
export function resolveScope(dag: Dag, subject: Subject, grants: Grant[], perm: string): 'ALL' | Set<string> {
  if (subject.isSuperAdmin) return 'ALL';
  const mine = applicableGrants(dag, subject, grants);
  if (mine.some((g) => g.permissions.includes('admin.all'))) return 'ALL';
  const nodes = mine.filter((g) => g.permissions.includes(perm)).map((g) => g.nodeId);
  if (nodes.some((n) => dag.has(n) && dag.parentsOf(n).length === 0)) return 'ALL';
  return dag.descendantsOrSelf(nodes);
}

export function effectivePermissions(dag: Dag, subject: Subject, grants: Grant[]): string[] {
  if (subject.isSuperAdmin) return ['admin.all'];
  return [...new Set(applicableGrants(dag, subject, grants).flatMap((g) => g.permissions))].sort();
}
