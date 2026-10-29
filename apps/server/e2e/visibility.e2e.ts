/**
 * Phase 2c visibility matrix (SOT §14.2/§14.3): viewer types × post audiences across feed, single post,
 * comments, reposts, hashtag, search, profile activity, notifications and media. Runs against a live API
 * like the other suites. Multi mode (TENANCY=multi, DNS_STUB=true, Mailpit) covers every audience and a
 * stranger without a company; single mode only has company posts (with and without unit audience).
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.E2E_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4000}`).replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const MAILPIT = (process.env.MAILPIT_API_URL ?? 'http://127.0.0.1:8026/api/v1').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@nexus.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Welcome@123';
const run = Date.now().toString(36);
const PASSWORD = `Pw-${run}-Strong1!`;
const TAG = `vis${run}`;
const WORD = `visq${run}`;

let multi = false;
const token: Record<string, string> = {};
const uid: Record<string, string> = {};

async function call(method: string, path: string, as: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (as) headers.authorization = `Bearer ${token[as]}`;
  let payload: string | FormData | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function ok(method: string, path: string, as: string | null, body?: unknown) {
  const r = await call(method, path, as, body);
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${path} as ${as} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function login(key: string, email: string, password: string) {
  token[key] = (await ok('POST', '/auth/login', null, { email, password })).token;
  uid[key] = (await ok('GET', '/auth/me', key)).id;
}

/** Admin-created colleague in `nodeId` of the admin's org, signed in with a changed password. */
async function colleague(key: string, nodeId: string) {
  const email = `${key}-${run}@nexus.local`;
  const { temporaryPassword } = await ok('POST', '/admin/users', 'admin', { email, name: `Vis ${key}`, nodeIds: [nodeId] });
  await login(key, email, temporaryPassword);
  await ok('POST', '/auth/change-password', key, { currentPassword: temporaryPassword, newPassword: PASSWORD });
  await login(key, email, PASSWORD);
}

async function mailedToken(to: string, route: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const found = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${to}"`)}`).then((r) => r.json());
    for (const m of found.messages ?? []) {
      const msg = await fetch(`${MAILPIT}/message/${m.ID}`).then((r) => r.json());
      const hit = new RegExp(`#/${route}\\?token=([\\w%-]+)`).exec(msg.Text ?? '');
      if (hit) return decodeURIComponent(hit[1]);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No "${route}" mail for ${to} in Mailpit`);
}

async function connect(a: string, b: string) {
  await ok('POST', '/network/connect', a, { userId: uid[b] });
  const { received } = await ok('GET', '/network/invitations', b);
  const inv = received.find((i: any) => i.requester?.id === uid[a] || i.requesterId === uid[a]);
  assert.ok(inv, `invitation from ${a} to ${b}`);
  await ok('POST', `/network/invitations/${inv.id}/accept`, b);
}

type Audience = 'PUBLIC' | 'CONNECTIONS' | 'ORG' | 'UNITS';
const post: Partial<Record<Audience, string>> = {};
let unitP = '';
let mediaKey = '';

/**
 * Org "Nexus": author in unit P; `unit` in C (below P); `other` in O (beside P). `conn` is Gina (Globex) and
 * connected to the author; `outsider` is Sam (Globex); `stranger` (multi only) has no company.
 */
const viewers = ['author', 'conn', 'unit', 'other', 'outsider', 'stranger'] as const;
type ViewerKey = (typeof viewers)[number];
const sees: Record<ViewerKey, Audience[]> = {
  author: ['PUBLIC', 'CONNECTIONS', 'ORG', 'UNITS'],
  conn: ['PUBLIC', 'CONNECTIONS'],
  unit: ['PUBLIC', 'ORG', 'UNITS'],
  other: ['PUBLIC', 'ORG'],
  outsider: ['PUBLIC'],
  stranger: ['PUBLIC'],
};
const active = () => viewers.filter((v) => multi || v !== 'stranger');
const audiences = (): Audience[] => (multi ? ['PUBLIC', 'CONNECTIONS', 'ORG', 'UNITS'] : ['ORG', 'UNITS']);

before(async () => {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  assert.ok(health?.ok, `API not reachable at ${BASE}. Start it first (pnpm dev:server) on a seeded database.`);
  multi = (await ok('GET', '/auth/config', null)).tenancy === 'multi';
  await login('admin', ADMIN_EMAIL, ADMIN_PASSWORD);
  await login('conn', 'owner@globex.local', DEMO_PASSWORD);
  await login('outsider', 'staff@globex.local', DEMO_PASSWORD);

  const { nodes } = await ok('GET', '/hierarchy', 'admin');
  const root = nodes.find((n: any) => n.isRoot)?.id ?? nodes[0].id;
  const node = async (name: string, parentId: string) => (await ok('POST', '/hierarchy/nodes', 'admin', { name: `${name} ${run}`, type: 'TEAM', parentIds: [parentId] })).id;
  unitP = await node('Vis P', root);
  const unitC = await node('Vis C', unitP);
  const unitO = await node('Vis O', root);
  await colleague('author', unitP);
  await colleague('unit', unitC);
  await colleague('other', unitO);
  await connect('author', 'conn');
  if (multi) {
    const email = `stranger-${run}@example.com`;
    await ok('POST', '/auth/signup', null, { email, name: 'Vis Stranger', password: PASSWORD });
    token.stranger = (await ok('POST', '/auth/verify-email', null, { token: await mailedToken(email, 'verify-email') })).token;
    uid.stranger = (await ok('GET', '/auth/me', 'stranger')).id;
  }

  // 1×1 PNG attached to the unit-only post
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png');
  const [media] = await ok('POST', '/media', 'author', form);
  mediaKey = /\/media\/([^?]+)/.exec(media.url)![1];

  for (const a of audiences()) {
    const body = `${a} post ${WORD} #${TAG} @[Vis](${uid.unit}) @[Sam](${uid.outsider})`;
    const p = await ok('POST', '/posts', 'author', {
      body,
      visibility: a === 'UNITS' ? 'ORG' : a,
      nodeIds: a === 'UNITS' ? [unitP] : [],
      media: a === 'UNITS' ? [media] : [],
    });
    assert.equal(p.visibility, a === 'UNITS' ? 'ORG' : a);
    post[a] = p.id;
    await ok('POST', `/posts/${p.id}/comments`, 'author', { body: 'first comment' });
  }
});

const visibleTo = (v: ViewerKey) => audiences().filter((a) => sees[v].includes(a));
const ours = (items: any[]) => new Set(items.map((p) => Object.entries(post).find(([, id]) => id === p.id)?.[0]).filter(Boolean));

test('single post, comments, reactions and reposts list follow the audience', async () => {
  for (const v of active()) {
    for (const a of audiences()) {
      const want = sees[v].includes(a) ? 200 : 404;
      const id = post[a]!;
      for (const path of [`/posts/${id}`, `/posts/${id}/comments`, `/posts/${id}/reactions`, `/posts/${id}/reposts`]) {
        assert.equal((await call('GET', path, v)).status, want, `${v} GET ${path} (${a})`);
      }
      if (want === 404) {
        assert.equal((await call('POST', `/posts/${id}/comments`, v, { body: 'sneaky' })).status, 404, `${v} comments on ${a}`);
        assert.equal((await call('POST', `/posts/${id}/react`, v, { type: 'LIKE' })).status, 404, `${v} reacts to ${a}`);
        assert.equal((await call('POST', `/posts/${id}/save`, v)).status, 404, `${v} saves ${a}`);
      }
    }
  }
});

test('hashtag page, search and profile activity only list visible posts', async () => {
  for (const v of active()) {
    const want = new Set(visibleTo(v));
    const tag = await ok('GET', `/posts/hashtag/${TAG}`, v);
    assert.deepEqual(ours(tag.items), want, `${v} hashtag`);
    assert.equal(tag.postCount, want.size, `${v} hashtag count`);
    const search = await ok('GET', `/search?q=${WORD}&type=posts`, v);
    assert.deepEqual(ours(search.posts), want, `${v} search`);
    const byAuthor = await ok('GET', `/posts/by/${uid.author}`, v);
    assert.deepEqual(ours(byAuthor.items), want, `${v} profile posts`);
    const activity = await ok('GET', `/users/${uid.author}/activity`, v);
    assert.deepEqual(ours(activity), want, `${v} profile activity`);
  }
});

test('feed shows only visible posts, and the ones meant for you', async () => {
  for (const v of active()) {
    const feed = ours((await ok('GET', '/posts/feed?limit=50', v)).items);
    for (const a of feed) assert.ok(sees[v].includes(a as Audience), `${v} feed must not show ${a}`);
  }
  const feed = async (v: ViewerKey) => ours((await ok('GET', '/posts/feed?limit=50', v)).items);
  assert.ok((await feed('unit')).has('UNITS'), 'unit member sees the unit post in the feed');
  assert.ok((await feed('other')).has('ORG'), 'colleague sees the company post in the feed');
  if (multi) {
    assert.ok((await feed('conn')).has('CONNECTIONS'), 'connection sees the connections post in the feed');
    assert.equal((await feed('stranger')).size, 0, 'a stranger’s feed has none of these posts');
  }
});

test('reposts never widen the original audience', async () => {
  // the unit member reposts the unit-only post; a colleague outside the unit can't see the repost
  const repost = await ok('POST', '/posts', 'unit', { body: 'sharing', repostOfId: post.UNITS, visibility: multi ? 'PUBLIC' : undefined });
  assert.equal(repost.visibility, 'ORG');
  assert.equal((await call('GET', `/posts/${repost.id}`, 'unit')).status, 200);
  for (const v of ['other', 'outsider', 'conn'] as const) assert.equal((await call('GET', `/posts/${repost.id}`, v)).status, 404, `${v} sees repost`);
  assert.equal((await call('POST', '/posts', 'outsider', { body: 'x', repostOfId: post.ORG })).status, 404, 'outsider reposts a company post');
  if (multi) {
    // a public repost of a connections-only post is still only visible to the original's audience
    const r = await ok('POST', '/posts', 'conn', { body: 'fwd', repostOfId: post.CONNECTIONS, visibility: 'PUBLIC' });
    assert.equal(r.visibility, 'CONNECTIONS');
    assert.equal((await call('GET', `/posts/${r.id}`, 'stranger')).status, 404);
  }
});

test('mention notifications only reach people who can see the post', async () => {
  const links = async (v: ViewerKey) => new Set((await ok('GET', '/notifications?limit=50', v)).items.map((n: any) => n.link));
  const unit = await links('unit');
  const outsider = await links('outsider');
  for (const a of audiences()) {
    assert.equal(unit.has(`/post/${post[a]}`), sees.unit.includes(a), `unit notified about ${a}`);
    assert.equal(outsider.has(`/post/${post[a]}`), sees.outsider.includes(a), `outsider notified about ${a}`);
  }
});

test('media: signed URLs only reach viewers of the post; unsigned links are refused', async () => {
  for (const v of active()) {
    const r = await call('GET', `/posts/${post.UNITS}`, v);
    if (!sees[v].includes('UNITS')) {
      assert.equal(r.status, 404, `${v} gets the media post`);
      continue;
    }
    const url: string = r.data.media[0].url;
    assert.ok(url.includes('sig='), 'media URL is signed');
    assert.equal((await fetch(url.replace(/^https?:\/\/[^/]+/, BASE))).status, 200, `${v} fetches media`);
  }
  assert.equal((await fetch(`${API}/media/${mediaKey}`)).status, 403, 'unsigned media link');
});

test('audience units must belong to the active org', async () => {
  const { nodes } = await ok('GET', '/hierarchy', 'conn');
  assert.equal((await call('POST', '/posts', 'author', { body: 'x', visibility: 'ORG', nodeIds: [nodes[0].id] })).status, 404);
});
