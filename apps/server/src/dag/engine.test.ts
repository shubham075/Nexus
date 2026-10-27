import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dag, DagError } from './engine';
import { resolveCan, type Grant } from '../rbac/resolve';

// Company → Eng, Product ; Eng → Backend, Mobile ; Product → Mobile (matrix)
const org = () =>
  new Dag(['co', 'eng', 'prod', 'backend', 'mobile', 'sales'], [
    { parentId: 'co', childId: 'eng' },
    { parentId: 'co', childId: 'prod' },
    { parentId: 'co', childId: 'sales' },
    { parentId: 'eng', childId: 'backend' },
    { parentId: 'eng', childId: 'mobile' },
    { parentId: 'prod', childId: 'mobile' },
  ]);

test('ancestors follow every parent path', () => {
  assert.deepEqual([...org().ancestors('mobile')].sort(), ['co', 'eng', 'prod']);
});

test('descendants', () => {
  assert.deepEqual([...org().descendants('eng')].sort(), ['backend', 'mobile']);
});

test('rejects cycles, self edges and duplicates', () => {
  const d = org();
  assert.equal(d.wouldCreateCycle('mobile', 'co'), true);
  assert.throws(() => d.addEdge('mobile', 'eng'), (e: DagError) => e.code === 'CYCLE');
  assert.throws(() => d.addEdge('eng', 'eng'), (e: DagError) => e.code === 'SELF_EDGE');
  assert.throws(() => d.addEdge('eng', 'backend'), (e: DagError) => e.code === 'DUPLICATE_EDGE');
  d.addEdge('sales', 'backend'); // multi-parent is fine
  assert.deepEqual(d.parentsOf('backend').sort(), ['eng', 'sales']);
});

test('refuses to orphan a node', () => {
  const d = org();
  assert.throws(() => d.removeEdge('eng', 'backend'), (e: DagError) => e.code === 'LAST_PARENT');
  d.removeEdge('prod', 'mobile');
  assert.deepEqual(d.parentsOf('mobile'), ['eng']);
});

test('topoSort puts parents before children', () => {
  const order = org().topoSort();
  assert.ok(order.indexOf('co') < order.indexOf('eng'));
  assert.ok(order.indexOf('prod') < order.indexOf('mobile'));
});

test('paths enumerates all breadcrumbs', () => {
  const p = org().paths('mobile').map((x) => x.join('>')).sort();
  assert.deepEqual(p, ['co>eng>mobile', 'co>prod>mobile']);
});

test('RBAC: node grants inherit down, scope is the granted sub-DAG', () => {
  const d = org();
  const grants: Grant[] = [
    { nodeId: 'co', userId: null, permissions: ['post.create'] },
    { nodeId: 'eng', userId: 'mod', permissions: ['post.moderate'] },
  ];
  // Mobile member inherits company-wide post.create
  assert.equal(resolveCan(d, { isSuperAdmin: false, memberNodes: ['mobile'], userId: 'u1' }, grants, 'post.create'), true);
  const mod = { isSuperAdmin: false, memberNodes: ['sales'], userId: 'mod' };
  // moderator scoped to eng can moderate a mobile author (mobile ⊂ eng) but not a sales author
  assert.equal(resolveCan(d, mod, grants, 'post.moderate', ['mobile']), true);
  assert.equal(resolveCan(d, mod, grants, 'post.moderate', ['sales']), false);
  assert.equal(resolveCan(d, { isSuperAdmin: true, memberNodes: [], userId: 'x' }, [], 'roles.manage'), true);
});
