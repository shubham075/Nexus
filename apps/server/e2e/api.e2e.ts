/**
 * API end-to-end suite (SOT §12). Runs against a live API on a seeded database:
 *   pnpm dev:server        (or `start`)   then   pnpm test:e2e
 * Every run creates its own uniquely named data, so it can be re-run on the same database.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.E2E_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4000}`).replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Welcome@123';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@nexus.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
const run = Date.now().toString(36);

const token: Record<string, string> = {};
const uid: Record<string, string> = {};
const unit: Record<string, string> = {};
const ids: Record<string, string> = {};
const org: Record<string, string> = {};

/** `as` may be `user@orgId` to send that org as the active org (X-Org-Id, SOT §14.3). */
async function call(method: string, path: string, as: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (as?.includes('@')) {
    const [who, orgId] = as.split('@');
    headers['x-org-id'] = orgId;
    as = who;
  }
  if (as) headers.authorization = `Bearer ${token[as] ?? as}`;
  let payload: string | FormData | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let data: any = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: res.status, data };
}

/** Expects a 2xx and returns the body. */
async function ok(method: string, path: string, as: string | null, body?: unknown) {
  const r = await call(method, path, as, body);
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${path} as ${as} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

/** Expects the given error status and returns the error body. */
async function fails(status: number, method: string, path: string, as: string | null, body?: unknown) {
  const r = await call(method, path, as, body);
  assert.equal(r.status, status, `${method} ${path} as ${as} → expected ${status}, got ${r.status} ${JSON.stringify(r.data)}`);
  return r.data?.error ?? r.data;
}

const has = (haystack: unknown, needle: string) => JSON.stringify(haystack).includes(needle);
const tomorrow = () => new Date(Date.now() + 864e5).toISOString();

before(async () => {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  assert.ok(health?.ok, `API not reachable at ${BASE}. Start it first (pnpm dev:server) on a seeded database.`);
  const users: [string, string, string][] = [
    ['admin', ADMIN_EMAIL, ADMIN_PASSWORD],
    ...['priya', 'rahul', 'meera', 'neha', 'karan', 'vikram', 'divya'].map((u): [string, string, string] => [u, `${u}@nexus.local`, DEMO_PASSWORD]),
    // second seeded org, used only by the tenancy tests
    ['gina', 'owner@globex.local', DEMO_PASSWORD],
    ['sam', 'staff@globex.local', DEMO_PASSWORD],
  ];
  for (const [key, email, password] of users) {
    token[key] = (await ok('POST', '/auth/login', null, { email, password })).token;
    uid[key] = (await ok('GET', '/auth/me', key)).id;
  }
  const { nodes } = await ok('GET', '/hierarchy', 'admin');
  for (const n of nodes) unit[n.name] = n.id;
  for (const name of ['Engineering', 'Product', 'Sales']) assert.ok(unit[name], `seed unit "${name}" missing`);
  for (const [key, who] of [['nexus', 'admin'], ['globex', 'gina']]) org[key] = (await ok('GET', '/auth/me', who)).activeOrgId;
  assert.ok(org.nexus && org.globex && org.nexus !== org.globex, 'two seeded orgs');
});


test('auth: bad credentials and missing tokens are rejected', async () => {
  assert.equal((await fails(401, 'POST', '/auth/login', null, { email: 'rahul@nexus.local', password: 'wrong-password' })).code, 'INVALID_CREDENTIALS');
  await fails(401, 'GET', '/auth/me', null);
  await fails(401, 'GET', '/auth/me', 'not-a-jwt');
  const me = await ok('GET', '/auth/me', 'rahul');
  assert.ok(me.permissions.includes('post.create'));
  assert.ok(!me.permissions.includes('users.manage'));
});

test('hierarchy: multi-parent units; cycle, self, duplicate and last-parent edges rejected', async () => {
  const squad = await ok('POST', '/hierarchy/nodes', 'divya', { name: `E2E Squad ${run}`, type: 'TEAM', parentIds: [unit.Engineering] });
  ids.squad = squad.id;
  await ok('POST', '/hierarchy/edges', 'divya', { parentId: unit.Product, childId: squad.id });
  const edge = (parentId: string, childId: string) => ({ parentId, childId });
  assert.equal((await fails(409, 'POST', '/hierarchy/edges', 'divya', edge(squad.id, unit.Engineering))).code, 'CYCLE');
  assert.equal((await fails(409, 'POST', '/hierarchy/edges', 'divya', edge(squad.id, squad.id))).code, 'SELF_EDGE');
  assert.equal((await fails(409, 'POST', '/hierarchy/edges', 'divya', edge(unit.Engineering, squad.id))).code, 'DUPLICATE_EDGE');
  await ok('DELETE', `/hierarchy/edges?parentId=${unit.Product}&childId=${squad.id}`, 'divya');
  assert.equal((await fails(409, 'DELETE', `/hierarchy/edges?parentId=${unit.Engineering}&childId=${squad.id}`, 'divya')).code, 'LAST_PARENT');
  await fails(403, 'POST', '/hierarchy/nodes', 'rahul', { name: `Nope ${run}`, type: 'TEAM', parentIds: [unit.Engineering] });
});

test('admin invite: temporary password, forced change, then normal sign-in', async () => {
  const email = `e2e-${run}@nexus.local`;
  const newPassword = `E2e-${run}-pass`;
  await fails(403, 'POST', '/admin/users', 'rahul', { email, name: 'Nope', nodeIds: [ids.squad] });
  const invited = await ok('POST', '/admin/users', 'divya', { email, name: `E2E Tester ${run}`, nodeIds: [ids.squad], title: 'Tester' });
  uid.newbie = invited.user.id;
  token.newbie = (await ok('POST', '/auth/login', null, { email, password: invited.temporaryPassword })).token;
  assert.equal((await ok('GET', '/auth/me', 'newbie')).mustChangePassword, true);
  await fails(400, 'POST', '/auth/change-password', 'newbie', { currentPassword: invited.temporaryPassword, newPassword: 'short' });
  await ok('POST', '/auth/change-password', 'newbie', { currentPassword: invited.temporaryPassword, newPassword });
  token.newbie = (await ok('POST', '/auth/login', null, { email, password: newPassword })).token;
  assert.equal((await ok('GET', '/auth/me', 'newbie')).mustChangePassword, false);
  assert.ok(has(await ok('GET', '/admin/audit', 'divya'), uid.newbie), 'invite is audited');
});

test('rbac: a role granted on a unit applies to its members until revoked', async () => {
  const event = { title: `E2E grant check ${run}`, startsAt: tomorrow() };
  await fails(403, 'POST', '/events', 'newbie', event);
  await fails(400, 'POST', '/admin/roles', 'divya', { name: `Bad ${run}`, permissions: ['not.a.permission'] });
  const role = await ok('POST', '/admin/roles', 'divya', { name: `E2E Organizer ${run}`, permissions: ['event.create'] });
  const grant = await ok('POST', '/admin/grants', 'divya', { roleId: role.id, nodeId: ids.squad });
  assert.ok(has(await ok('GET', `/admin/users/${uid.newbie}/permissions`, 'divya'), 'event.create'));
  await ok('POST', '/events', 'newbie', event);
  await ok('DELETE', `/admin/grants/${grant.id}`, 'divya');
  await fails(403, 'POST', '/events', 'newbie', event);
});

test('posts: mentions, hashtags, reactions, one-level replies, edit, save, repost, poll', async () => {
  const tag = `e2e${run}`;
  const post = await ok('POST', '/posts', 'rahul', { body: `Shipped #${tag} with @[Priya Sharma](${uid.priya})` });
  ids.post = post.id;
  assert.ok(has(await ok('GET', '/notifications', 'priya'), post.id), 'mention notifies Priya');

  await ok('POST', `/posts/${post.id}/react`, 'priya', { type: 'CELEBRATE' });
  assert.ok(has(await ok('GET', `/posts/${post.id}/reactions`, 'rahul'), uid.priya));
  await fails(400, 'POST', `/posts/${post.id}/react`, 'priya', { type: 'ANGRY' });

  const comment = await ok('POST', `/posts/${post.id}/comments`, 'priya', { body: 'Great work' });
  const reply = await ok('POST', `/posts/${post.id}/comments`, 'rahul', { body: 'Thanks!', parentId: comment.id });
  const nested = await ok('POST', `/posts/${post.id}/comments`, 'meera', { body: 'Agreed', parentId: reply.id });
  assert.equal(nested.parentId, comment.id, 'a reply to a reply attaches to the top-level comment');
  await ok('POST', `/posts/${post.id}/comments/${comment.id}/react`, 'rahul', { type: 'LIKE' });

  await ok('PATCH', `/posts/${post.id}`, 'rahul', { body: `Shipped #${tag} (edited)` });
  await fails(403, 'PATCH', `/posts/${post.id}`, 'priya', { body: 'hijack' });

  assert.equal((await ok('POST', `/posts/${post.id}/save`, 'priya')).saved, true);
  assert.ok(has(await ok('GET', '/posts/saved', 'priya'), post.id));
  assert.ok(has(await ok('GET', `/posts/hashtag/${tag}`, 'karan'), post.id));

  const repost = await ok('POST', '/posts', 'meera', { body: 'Worth a read', repostOfId: post.id });
  assert.equal(repost.repostOfId, post.id);
  await ok('DELETE', `/posts/${repost.id}`, 'meera');
  await fails(403, 'DELETE', `/posts/${post.id}`, 'karan');

  const poll = await ok('POST', '/posts', 'neha', { poll: { question: `Tabs or spaces ${run}?`, options: ['Tabs', 'Spaces'] } });
  const [tabs, spaces] = poll.poll.options;
  await ok('POST', `/posts/${poll.id}/vote`, 'karan', { optionId: tabs.id });
  const voted = await ok('POST', `/posts/${poll.id}/vote`, 'karan', { optionId: spaces.id });
  assert.equal(voted.poll.myVote, spaces.id);
  assert.deepEqual([voted.poll.totalVotes, voted.poll.options.map((o: any) => o.votes)], [1, [0, 1]], 'changing a vote moves it');
  await fails(400, 'POST', `/posts/${poll.id}/vote`, 'karan', { optionId: 'nope' });

  await fails(400, 'POST', '/posts', 'rahul', { body: '   ' });
  assert.ok(Array.isArray((await ok('GET', '/posts/feed', 'rahul')).items));
});

test('network: invite, accept, list, remove; no self-connections', async () => {
  await fails(400, 'POST', '/network/connect', 'newbie', { userId: uid.newbie });
  await ok('POST', '/network/connect', 'newbie', { userId: uid.rahul, message: 'Hi from e2e' });
  const { received } = await ok('GET', '/network/invitations', 'rahul');
  const invitation = received.find((c: any) => c.requesterId === uid.newbie);
  assert.ok(invitation, 'Rahul received the invitation');
  await ok('POST', `/network/invitations/${invitation.id}/accept`, 'rahul');
  assert.ok(has(await ok('GET', '/network/connections', 'newbie'), uid.rahul));
  await ok('DELETE', `/network/connections/${uid.rahul}`, 'newbie');
  assert.ok(!has(await ok('GET', '/network/connections', 'newbie'), uid.rahul));
});

test('messaging: group chat delivery, unread count, read state, members only', async () => {
  const { id } = await ok('POST', '/conversations', 'priya', { userIds: [uid.rahul, uid.meera], title: `E2E chat ${run}` });
  await ok('POST', `/conversations/${id}/messages`, 'priya', { body: `Standup in 5 (${run})` });
  await fails(400, 'POST', `/conversations/${id}/messages`, 'priya', { body: '  ' });
  assert.ok(has(await ok('GET', `/conversations/${id}/messages`, 'meera'), `Standup in 5 (${run})`));
  const before = (await ok('GET', '/conversations/unread', 'meera')).unread;
  assert.ok(before >= 1);
  await ok('POST', `/conversations/${id}/read`, 'meera');
  assert.equal((await ok('GET', '/conversations/unread', 'meera')).unread, before - 1);
  const outsider = await call('GET', `/conversations/${id}/messages`, 'karan');
  assert.ok([403, 404].includes(outsider.status), `non-member read → ${outsider.status}`);
});

test('groups: private join requests need approval before posting', async () => {
  const group = await ok('POST', '/groups', 'neha', { name: `E2E Private ${run}`, privacy: 'PRIVATE' });
  assert.equal((await ok('POST', `/groups/${group.id}/join`, 'karan')).role, 'PENDING');
  await fails(403, 'POST', '/posts', 'karan', { body: 'hello group', groupId: group.id });
  await fails(403, 'PATCH', `/groups/${group.id}/members/${uid.karan}`, 'rahul', { role: 'MEMBER' });
  await ok('PATCH', `/groups/${group.id}/members/${uid.karan}`, 'neha', { role: 'MEMBER' });
  const post = await ok('POST', '/posts', 'karan', { body: `hello group ${run}`, groupId: group.id });
  assert.ok(has(await ok('GET', `/groups/${group.id}/posts`, 'neha'), post.id));
});

test('events: managers create, members RSVP and get invited', async () => {
  await fails(403, 'POST', '/events', 'karan', { title: 'Nope', startsAt: tomorrow() });
  const event = await ok('POST', '/events', 'priya', { title: `E2E Demo Day ${run}`, startsAt: tomorrow(), nodeId: unit.Engineering });
  await ok('POST', `/events/${event.id}/rsvp`, 'rahul', { status: 'GOING' });
  const detail = await ok('GET', `/events/${event.id}`, 'rahul');
  assert.equal(detail.myRsvp, 'GOING');
  await ok('POST', `/events/${event.id}/invite`, 'priya', { userIds: [uid.meera] });
  assert.ok(has(await ok('GET', '/notifications', 'meera'), event.id));
});

test('articles: publish, read, newsletter subscribe', async () => {
  const article = await ok('POST', '/articles', 'priya', { title: `E2E Engineering notes ${run}`, body: 'Long-form body for the e2e run.' });
  assert.equal((await ok('GET', `/articles/${article.id}`, 'karan')).title, article.title);
  await fails(400, 'POST', '/articles', 'priya', { title: '', body: 'x' });
  const newsletter = await ok('POST', '/articles/newsletters', 'priya', { title: `E2E Weekly ${run}` });
  await ok('POST', `/articles/newsletters/${newsletter.id}/subscribe`, 'rahul');
});

test('jobs: post, apply once, pipeline status notifies, only managers see applicants', async () => {
  const job = await ok('POST', '/jobs', 'vikram', { title: `E2E Platform Engineer ${run}`, description: 'Build the platform.', nodeId: unit.Engineering, skills: ['Go'] });
  await ok('POST', `/jobs/${job.id}/apply`, 'rahul', { note: 'Interested' });
  await fails(409, 'POST', `/jobs/${job.id}/apply`, 'rahul', {});
  await fails(400, 'POST', `/jobs/${job.id}/apply`, 'vikram', {});
  await ok('POST', `/jobs/${job.id}/apply`, 'admin', {}); // only the poster is blocked (QA log 2026-10-28 #9)
  await fails(403, 'GET', `/jobs/${job.id}/applications`, 'karan');
  const applications = await ok('GET', `/jobs/${job.id}/applications`, 'vikram');
  const rahulApp = applications.find((a: any) => a.userId === uid.rahul);
  await ok('PATCH', `/jobs/${job.id}/applications/${rahulApp.id}`, 'vikram', { status: 'INTERVIEW' });
  assert.ok(has(await ok('GET', '/notifications', 'rahul'), job.id));
});

test('moderation: reviewers act only on reports inside their unit scope', async () => {
  const salesPost = await ok('POST', '/posts', 'karan', { body: `Sales spam ${run}` });
  const engPost = await ok('POST', '/posts', 'rahul', { body: `Engineering spam ${run}` });
  await ok('POST', '/reports', 'meera', { postId: salesPost.id, reason: 'SPAM' });
  await ok('POST', '/reports', 'meera', { postId: engPost.id, reason: 'SPAM' });
  await fails(400, 'POST', '/reports', 'meera', { reason: 'SPAM' });
  await fails(403, 'GET', '/reports', 'rahul');

  const priyaQueue = await ok('GET', '/reports', 'priya'); // Moderator scoped to Engineering
  assert.ok(has(priyaQueue, engPost.id), 'Engineering report visible to Priya');
  assert.ok(!has(priyaQueue, salesPost.id), 'Sales report hidden from Priya');
  const adminQueue = await ok('GET', '/reports', 'admin');
  const salesReport = adminQueue.find((r: any) => r.postId === salesPost.id);
  const engReport = adminQueue.find((r: any) => r.postId === engPost.id);
  await fails(403, 'POST', `/reports/${salesReport.id}/resolve`, 'priya', { action: 'HIDE' });
  await ok('POST', `/reports/${engReport.id}/resolve`, 'priya', { action: 'HIDE', note: 'e2e' });
  const actioned = await ok('GET', '/reports?status=ACTIONED', 'priya');
  assert.equal(actioned.find((r: any) => r.id === engReport.id)?.post.isHidden, true);
});

test('search: people, posts and hashtags', async () => {
  const results = await ok('GET', `/search?q=${encodeURIComponent(`e2e${run}`)}`, 'karan');
  assert.ok(has(results.posts, ids.post), 'post found by hashtag text');
  assert.ok(has((await ok('GET', '/search?q=Rahul&type=people', 'karan')).people, uid.rahul));
  assert.deepEqual((await ok('GET', '/search?q=', 'karan')).people, []);
});

test('analytics and audit: HR can view, employees cannot', async () => {
  const stats = await ok('GET', '/admin/analytics', 'divya');
  assert.ok(stats.users > 0 && stats.posts > 0);
  assert.ok(Object.values(stats).some((v) => Array.isArray(v) && v.length === 14), '14-day zero-filled series');
  await fails(403, 'GET', '/admin/analytics', 'rahul');
  await fails(403, 'GET', '/admin/audit', 'rahul');
});

test('analytics: a manager sees only their units, and no audit log (SOT D18)', async () => {
  const all = await ok('GET', '/admin/analytics', 'divya');
  assert.equal(all.scope.all, true);
  const mine = await ok('GET', '/admin/analytics', 'priya'); // Manager granted on Engineering
  assert.equal(mine.scope.all, false);
  const names = mine.scope.units.map((u: { name: string }) => u.name);
  assert.ok(names.includes('Engineering') && names.includes('Mobile Squad'), 'Engineering sub-DAG incl. the matrix team');
  assert.ok(!names.includes('Sales'));
  assert.ok(mine.users > 0 && mine.users < all.users, 'scoped head-count is a subset');
  await fails(403, 'GET', '/admin/audit', 'priya');
});

test('media: allowed uploads are served back, other types rejected', async () => {
  // 1×1 transparent PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png');
  const [uploaded] = await ok('POST', '/media', 'rahul', form);
  assert.equal(uploaded.mimeType, 'image/png');
  const served = await fetch(uploaded.url.replace(/^https?:\/\/[^/]+/, BASE));
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');

  const svg = new FormData();
  svg.append('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }), 'x.svg');
  await fails(400, 'POST', '/media', 'rahul', svg);
  await fails(401, 'POST', '/media', null, form);
});

test('deactivation: a deactivated user is signed out everywhere', async () => {
  await fails(400, 'PATCH', `/admin/users/${uid.divya}`, 'divya', { isActive: false });
  await ok('PATCH', `/admin/users/${uid.newbie}`, 'divya', { isActive: false });
  await fails(401, 'GET', '/auth/me', 'newbie');
  await fails(401, 'POST', '/auth/login', null, { email: `e2e-${run}@nexus.local`, password: `E2e-${run}-pass` });
});

// ───────── Tenancy (SOT §14, phase 2a): no cross-org reads or writes ─────────

test('tenancy: /auth/me reports the mode and active org; X-Org-Id must be one of my orgs', async () => {
  const me = await ok('GET', '/auth/me', 'admin');
  assert.equal(me.tenancy, process.env.TENANCY ?? 'single');
  assert.deepEqual(me.orgs.map((o: any) => o.id), [org.nexus]);
  assert.equal((await ok('GET', '/auth/me', `admin@${org.nexus}`)).activeOrgId, org.nexus);
  await fails(403, 'GET', '/auth/me', `admin@${org.globex}`);
  await fails(403, 'GET', '/hierarchy', `gina@${org.nexus}`);
  await fails(403, 'GET', '/hierarchy', 'gina@no-such-org');
  const gina = await ok('GET', '/auth/me', 'gina');
  assert.ok(gina.permissions.includes('admin.all'), 'Gina is Super Admin in Globex');
  assert.ok(!has(gina.memberships, 'Nexus') && !has(me.memberships, 'Globex'));
});

test('tenancy: hierarchy is per org and cannot be read or changed across orgs', async () => {
  const globex = await ok('GET', '/hierarchy', 'gina');
  assert.deepEqual(globex.nodes.map((n: any) => n.name).sort(), ['Globex Inc', 'Globex Ops']);
  assert.ok(!has(await ok('GET', '/hierarchy', 'admin'), 'Globex'));
  const ops = globex.nodes.find((n: any) => n.name === 'Globex Ops').id;
  const root = globex.nodes.find((n: any) => n.name === 'Globex Inc').id;

  await fails(404, 'GET', `/hierarchy/nodes/${unit.Engineering}`, 'gina');
  await fails(404, 'GET', `/hierarchy/nodes/${ops}`, 'admin');
  await fails(404, 'POST', '/hierarchy/nodes', 'gina', { name: `Leak ${run}`, type: 'TEAM', parentIds: [unit.Engineering] });
  await fails(404, 'PATCH', `/hierarchy/nodes/${unit.Engineering}`, 'gina', { name: 'Hijacked' });
  await fails(404, 'DELETE', `/hierarchy/nodes/${unit.Sales}?reparent=true`, 'gina');
  await fails(404, 'POST', '/hierarchy/edges', 'gina', { parentId: root, childId: unit.Sales });
  await fails(404, 'POST', '/hierarchy/edges', 'admin', { parentId: unit.Engineering, childId: ops });
  await fails(404, 'DELETE', `/hierarchy/edges?parentId=${root}&childId=${ops}`, 'admin');
  await fails(400, 'POST', `/hierarchy/nodes/${unit.Engineering}/members`, 'admin', { userIds: [uid.sam] });
  await fails(404, 'POST', `/hierarchy/nodes/${ops}/members`, 'admin', { userIds: [uid.rahul] });
  assert.equal((await ok('GET', `/hierarchy/nodes/${unit.Engineering}`, 'admin')).name, 'Engineering');
});

test('tenancy: roles and grants are per org; names are unique per org only', async () => {
  const name = `Ops ${run}`;
  const gRole = await ok('POST', '/admin/roles', 'gina', { name, permissions: ['post.create'] });
  const nRole = await ok('POST', '/admin/roles', 'admin', { name, permissions: ['post.create'] });
  const gRoles = await ok('GET', '/admin/roles', 'gina');
  assert.ok(has(gRoles, gRole.id) && !has(gRoles, nRole.id));
  assert.ok(!has(await ok('GET', '/admin/roles', 'admin'), gRole.id));

  await fails(404, 'PATCH', `/admin/roles/${nRole.id}`, 'gina', { name: 'Hijacked' });
  await fails(404, 'DELETE', `/admin/roles/${nRole.id}`, 'gina');
  const ops = (await ok('GET', '/hierarchy', 'gina')).nodes.find((n: any) => n.name === 'Globex Ops').id;
  await fails(404, 'POST', '/admin/grants', 'gina', { roleId: nRole.id, nodeId: ops, userId: uid.sam });
  await fails(404, 'POST', '/admin/grants', 'gina', { roleId: gRole.id, nodeId: unit.Engineering });
  await fails(400, 'POST', '/admin/grants', 'gina', { roleId: gRole.id, nodeId: ops, userId: uid.rahul });
  await fails(404, 'POST', '/admin/grants', 'admin', { roleId: gRole.id, nodeId: unit.Engineering });

  const nGrants = await ok('GET', '/admin/grants', 'admin');
  assert.ok(!has(await ok('GET', '/admin/grants', 'gina'), 'Engineering'), 'no Nexus grants in Globex');
  await fails(404, 'DELETE', `/admin/grants/${nGrants[0].id}`, 'gina');

  // Gina is Super Admin in Globex only: no Nexus permissions leak through her grants
  const grant = await ok('POST', '/admin/grants', 'gina', { roleId: gRole.id, nodeId: ops, userId: uid.sam });
  assert.ok((await ok('GET', '/auth/me', 'sam')).permissions.includes('post.create'));
  await ok('DELETE', `/admin/grants/${grant.id}`, 'gina');
  await ok('DELETE', `/admin/roles/${gRole.id}`, 'gina');
  await ok('DELETE', `/admin/roles/${nRole.id}`, 'admin');
});

test('tenancy: admin users, permissions and exports stay inside the org', async () => {
  const gUsers = await ok('GET', '/admin/users', 'gina');
  assert.deepEqual(gUsers.items.map((u: any) => u.id).sort(), [uid.gina, uid.sam].sort());
  assert.ok(!has(await ok('GET', '/admin/users?limit=50', 'admin'), uid.sam));
  await fails(400, 'PATCH', `/admin/users/${uid.rahul}`, 'gina', { isActive: false });
  await fails(400, 'POST', `/admin/users/${uid.rahul}/reset-password`, 'gina');
  await fails(400, 'GET', `/admin/users/${uid.rahul}/permissions`, 'gina');
  await fails(400, 'GET', `/admin/users/${uid.rahul}/export`, 'gina');
  await fails(404, 'POST', '/admin/users', 'gina', { email: `leak-${run}@globex.local`, name: 'Leak', nodeIds: [unit.Engineering] });
  const samPerms = (await ok('GET', `/admin/users/${uid.sam}/permissions`, 'gina')).permissions;
  assert.ok(samPerms.includes('post.create') && !samPerms.includes('admin.all'));
});

test('tenancy: audit log, reports and analytics are per org', async () => {
  const gAudit = await ok('GET', '/admin/audit', 'gina');
  // every entry is by Globex people (the seed entry may have scrolled off the first page after many runs)
  assert.ok(gAudit.items.length && gAudit.items.every((e: any) => [uid.gina, uid.sam, null].includes(e.actorId)), 'Globex audit has only Globex actions');
  assert.ok(!has(gAudit, 'hierarchy.'));
  assert.ok(!has(await ok('GET', '/admin/audit?limit=50', 'admin'), 'globex.seed'));

  const gReports = await ok('GET', '/reports', 'gina');
  const gReport = gReports.find((r: any) => r.details === 'Globex test report');
  assert.ok(gReport, 'Globex report visible in Globex');
  assert.ok(!has(await ok('GET', '/reports', 'admin'), 'Globex test report'));
  await fails(404, 'POST', `/reports/${gReport.id}/resolve`, 'admin', { action: 'DISMISS' });
  // a report filed from Nexus lands in the Nexus queue only
  await ok('POST', '/reports', 'karan', { targetUserId: uid.rahul, reason: 'OTHER', details: `nexus-report-${run}` });
  assert.ok(has(await ok('GET', '/reports', 'admin'), `nexus-report-${run}`));
  assert.ok(!has(await ok('GET', '/reports', 'gina'), `nexus-report-${run}`));
  // Gina cannot moderate Nexus people's content
  const post = await ok('POST', '/posts', 'karan', { body: `tenancy ${run}` });
  await fails(403, 'POST', `/posts/${post.id}/hide`, 'gina');
  await fails(403, 'DELETE', `/posts/${post.id}`, 'gina');
  await fails(403, 'POST', `/posts/${post.id}/pin`, 'gina');

  const stats = await ok('GET', '/admin/analytics', 'gina');
  assert.equal(stats.users, 2, 'Globex analytics count only Globex people');
  assert.equal(stats.openReports, gReports.length);
  assert.ok((await ok('GET', '/admin/analytics', 'admin')).users >= 10);
});

test('tenancy: org-owned groups, events and jobs are invisible and untouchable from another org', async () => {
  const [gGroups, gEvents, gJobs] = await Promise.all(['/groups', '/events', '/jobs'].map((p) => ok('GET', p, 'gina')));
  const group = gGroups.find((g: any) => g.name === 'Globex Insiders');
  const event = gEvents.find((e: any) => e.title === 'Globex Offsite');
  const job = gJobs.find((j: any) => j.title === 'Globex Ops Lead');
  assert.ok(group && event && job, 'Globex sees its own groups/events/jobs');
  assert.ok(!has(gGroups, 'Frontend Guild') && !has(gJobs, 'Senior Mobile Engineer') && !has(gEvents, 'Engineering All-Hands'));

  const [nGroups, nEvents, nJobs] = await Promise.all(['/groups', '/events', '/jobs'].map((p) => ok('GET', p, 'rahul')));
  assert.ok(!has(nGroups, group.id) && !has(nEvents, event.id) && !has(nJobs, job.id));
  await fails(404, 'GET', `/groups/${group.id}`, 'rahul');
  await fails(404, 'POST', `/groups/${group.id}/join`, 'rahul');
  await fails(404, 'GET', `/groups/${group.id}/members`, 'rahul');
  await fails(404, 'DELETE', `/groups/${group.id}`, 'admin');
  await fails(403, 'POST', '/posts', 'rahul', { body: 'leak', groupId: group.id });
  await fails(404, 'GET', `/events/${event.id}`, 'rahul');
  await fails(404, 'POST', `/events/${event.id}/rsvp`, 'rahul', { status: 'GOING' });
  await fails(404, 'DELETE', `/events/${event.id}`, 'admin');
  await fails(404, 'GET', `/jobs/${job.id}`, 'rahul');
  await fails(404, 'POST', `/jobs/${job.id}/apply`, 'rahul', {});
  await fails(404, 'PATCH', `/jobs/${job.id}`, 'admin', { status: 'CLOSED' });
  await fails(404, 'POST', '/groups', 'gina', { name: `Leak ${run}`, nodeId: unit.Engineering });

  const found = await ok('GET', '/search?q=Globex', 'admin');
  assert.deepEqual([found.groups, found.events, found.jobs, found.units].map((r) => r.length), [0, 0, 0, 0]);
  const created = await ok('POST', '/groups', 'gina', { name: `Globex only ${run}` });
  assert.ok(has(await ok('GET', '/groups', 'gina'), created.id) && !has(await ok('GET', '/groups', 'admin'), created.id));
  await ok('DELETE', `/groups/${created.id}`, 'gina');
});
