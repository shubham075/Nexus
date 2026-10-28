/**
 * Phase 2b end-to-end suite (SOT §14): sign-up, email verification, password reset, companies, domains,
 * join policies, invites, company follows and the platform admin console. Runs against a live API, like
 * api.e2e.ts. Multi-mode tests need TENANCY=multi and DNS_STUB=true on the server; mails are read from
 * Mailpit (`docker compose up -d`, API at :8026).
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.E2E_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4000}`).replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const MAILPIT = (process.env.MAILPIT_API_URL ?? 'http://127.0.0.1:8026/api/v1').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@nexus.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
const run = Date.now().toString(36);
const PASSWORD = `Pw-${run}-Strong1!`;

let multi = false;
const token: Record<string, string> = {};

/** `as` may be `user@orgId` to send X-Org-Id. */
async function call(method: string, path: string, as: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (as?.includes('@')) {
    const [who, orgId] = as.split('@');
    headers['x-org-id'] = orgId;
    as = who;
  }
  if (as) headers.authorization = `Bearer ${token[as] ?? as}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function ok(method: string, path: string, as: string | null, body?: unknown) {
  const r = await call(method, path, as, body);
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${path} as ${as} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function fails(status: number, method: string, path: string, as: string | null, body?: unknown) {
  const r = await call(method, path, as, body);
  assert.equal(r.status, status, `${method} ${path} as ${as} → expected ${status}, got ${r.status} ${JSON.stringify(r.data)}`);
  return r.data?.error ?? r.data;
}

/** Newest link `#/<route>?token=…` mailed to `to` (polls Mailpit briefly). */
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

/** Signs up, verifies through the mailed link and stores the session under `key`. */
async function signUp(key: string, email: string) {
  await ok('POST', '/auth/signup', null, { email, name: `E2E ${key}`, password: PASSWORD });
  const link = `http://app.example/#/verify-email?token=${encodeURIComponent(await mailedToken(email, 'verify-email'))}`;
  token[key] = (await ok('POST', '/auth/verify-email', null, { token: link })).token;
}

before(async () => {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  assert.ok(health?.ok, `API not reachable at ${BASE}. Start it first (pnpm dev:server) on a seeded database.`);
  const mailpit = await fetch(`${MAILPIT}/info`).catch(() => null);
  assert.ok(mailpit?.ok, `Mailpit not reachable at ${MAILPIT}. Run docker compose up -d.`);
  multi = (await ok('GET', '/auth/config', null)).tenancy === 'multi';
  token.admin = (await ok('POST', '/auth/login', null, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).token;
});

test('single mode: no public sign-up, company or platform routes', async (t) => {
  if (multi) return t.skip('multi mode');
  assert.equal((await ok('GET', '/auth/config', null)).signup, false);
  assert.equal((await fails(403, 'POST', '/auth/signup', null, { email: `x-${run}@acme.test`, name: 'X', password: PASSWORD })).code, 'SIGNUP_DISABLED');
  await fails(404, 'GET', '/companies', 'admin');
  await fails(404, 'GET', '/platform/orgs', 'admin');
});

test('password reset by email: single-use link, policy enforced, other sessions revoked', async () => {
  const email = `reset-${run}@nexus.local`;
  const nodeId = (await ok('GET', '/hierarchy', 'admin')).nodes[0].id;
  const { temporaryPassword } = await ok('POST', '/admin/users', 'admin', { email, name: 'Reset Me', nodeIds: [nodeId] });
  token.resetter = (await ok('POST', '/auth/login', null, { email, password: temporaryPassword })).token;

  await ok('POST', '/auth/forgot-password', null, { email: `nobody-${run}@nexus.local` }); // same answer for unknown addresses
  await ok('POST', '/auth/forgot-password', null, { email });
  const reset = await mailedToken(email, 'reset-password');
  assert.equal((await fails(400, 'POST', '/auth/reset-password', null, { token: reset, newPassword: 'weak' })).code, 'WEAK_PASSWORD');
  await ok('POST', '/auth/reset-password', null, { token: reset, newPassword: PASSWORD });
  assert.equal((await fails(400, 'POST', '/auth/reset-password', null, { token: reset, newPassword: PASSWORD })).code, 'INVALID_TOKEN');
  await fails(401, 'GET', '/auth/me', 'resetter');
  await fails(401, 'POST', '/auth/login', null, { email, password: temporaryPassword });
  const me = await ok('GET', '/auth/me', (await ok('POST', '/auth/login', null, { email, password: PASSWORD })).token);
  assert.equal(me.mustChangePassword, false);
});

test('sign-up: unusable until the emailed link is used; links are single-use', async (t) => {
  if (!multi) return t.skip('single mode');
  const email = `owner-${run}@acme-${run}.test`;
  assert.equal((await fails(400, 'POST', '/auth/signup', null, { email, name: 'Weak', password: 'short' })).code, 'WEAK_PASSWORD');
  await ok('POST', '/auth/signup', null, { email, name: 'Olivia Owner', password: PASSWORD });
  await ok('POST', '/auth/signup', null, { email, name: 'Again', password: PASSWORD }); // existing address: same answer
  assert.equal((await fails(403, 'POST', '/auth/login', null, { email, password: PASSWORD })).code, 'EMAIL_NOT_VERIFIED');
  const verify = await mailedToken(email, 'verify-email');
  token.owner = (await ok('POST', '/auth/verify-email', null, { token: verify })).token;
  assert.equal((await fails(400, 'POST', '/auth/verify-email', null, { token: verify })).code, 'INVALID_TOKEN');
  await ok('POST', '/auth/login', null, { email, password: PASSWORD });
  const me = await ok('GET', '/auth/me', 'owner');
  assert.deepEqual(me.orgs, []);
  assert.equal(me.activeOrgId, null);
});

test('companies: create, verify domain, auto-join, approval, invites, follow', async (t) => {
  if (!multi) return t.skip('single mode');
  const domain = `acme-${run}.test`;
  const co = await ok('POST', '/companies', 'owner', { name: `Acme ${run}`, website: `${domain}`, industry: 'Testing' });
  assert.equal(co.isAdmin, true);
  assert.equal(co.myStatus, 'ACTIVE');
  assert.equal(co.website, `https://${domain}`);
  const me = await ok('GET', '/auth/me', `owner@${co.id}`);
  assert.ok(me.permissions.includes('admin.all'));
  assert.ok((await ok('GET', '/hierarchy', `owner@${co.id}`)).nodes.some((n: any) => n.name === `Acme ${run}`));

  // Domain: TXT value shown, verification needs the record (stub resolver), one verified owner per domain.
  const d = await ok('POST', `/companies/${co.id}/domains`, 'owner', { domain: `https://www.${domain}/` });
  assert.equal(d.domain, domain);
  assert.match(d.txtValue, /^nexus-verification=/);
  assert.equal((await fails(400, 'POST', `/companies/${co.id}/domains/${d.id}/verify`, 'owner')).code, 'DOMAIN_NOT_VERIFIED');
  await ok('PUT', `/dev/dns/${domain}`, null, { txt: ['v=spf1 -all', d.txtValue] });
  assert.ok((await ok('POST', `/companies/${co.id}/domains/${d.id}/verify`, 'owner')).verifiedAt);

  // AUTO: a colleague on the domain joins directly and gets the Employee role.
  await signUp('ann', `ann-${run}@${domain}`);
  assert.equal((await ok('GET', `/companies/${co.slug}`, 'ann')).canJoin, null, 'default policy is invite-only');
  await fails(403, 'POST', `/companies/${co.id}/join`, 'ann');
  await fails(403, 'PATCH', `/companies/${co.id}`, 'ann', { joinPolicy: 'AUTO' });
  await ok('PATCH', `/companies/${co.id}`, 'owner', { joinPolicy: 'AUTO', about: 'We test things.' });
  assert.equal((await ok('GET', `/companies/${co.slug}`, 'ann')).canJoin, 'AUTO');
  assert.equal((await ok('POST', `/companies/${co.id}/join`, 'ann')).status, 'ACTIVE');
  const ann = await ok('GET', '/auth/me', `ann@${co.id}`);
  assert.equal(ann.activeOrgId, co.id);
  assert.ok(ann.permissions.length > 0 && !ann.permissions.includes('admin.all'));

  // APPROVAL: pending until an admin approves; rejected requests leave no membership.
  await ok('PATCH', `/companies/${co.id}`, 'owner', { joinPolicy: 'APPROVAL' });
  await signUp('bob', `bob-${run}@${domain}`);
  await signUp('cat', `cat-${run}@${domain}`);
  assert.equal((await ok('POST', `/companies/${co.id}/join`, 'bob')).status, 'PENDING');
  assert.equal((await ok('POST', `/companies/${co.id}/join`, 'cat')).status, 'PENDING');
  await fails(403, 'GET', '/auth/me', `bob@${co.id}`);
  await fails(403, 'GET', `/companies/${co.id}/requests`, 'ann');
  const requests = await ok('GET', `/companies/${co.id}/requests`, 'owner');
  const byEmail = (e: string) => requests.find((r: any) => r.user.email === e).user.id;
  await ok('POST', `/companies/${co.id}/requests/${byEmail(`bob-${run}@${domain}`)}`, 'owner', { approve: true });
  await ok('POST', `/companies/${co.id}/requests/${byEmail(`cat-${run}@${domain}`)}`, 'owner', { approve: false });
  assert.equal((await ok('GET', '/auth/me', `bob@${co.id}`)).activeOrgId, co.id);
  await fails(403, 'GET', '/auth/me', `cat@${co.id}`);
  assert.equal((await ok('GET', `/companies/${co.id}`, 'cat')).myStatus, null);

  // Invites: people outside the domain; only the invited address can accept, once.
  const outsider = `dan-${run}@elsewhere-${run}.test`;
  await signUp('dan', outsider);
  await signUp('eve', `eve-${run}@elsewhere-${run}.test`);
  await fails(403, 'POST', `/companies/${co.id}/join`, 'dan');
  await fails(403, 'POST', `/companies/${co.id}/invites`, 'ann', { email: outsider });
  await ok('POST', `/companies/${co.id}/invites`, 'owner', { email: outsider });
  assert.ok((await ok('GET', `/companies/${co.id}/invites`, 'owner')).some((i: any) => i.email === outsider));
  const invite = await mailedToken(outsider, 'invite');
  await fails(403, 'POST', '/companies/invites/accept', 'eve', { token: invite });
  assert.equal((await ok('POST', '/companies/invites/accept', 'dan', { token: invite })).myStatus, 'ACTIVE');
  await fails(400, 'POST', '/companies/invites/accept', 'dan', { token: invite });
  assert.equal((await ok('GET', '/auth/me', `dan@${co.id}`)).activeOrgId, co.id);

  // A second company can't take a verified domain.
  const other = await ok('POST', '/companies', 'eve', { name: `Other ${run}` });
  await fails(409, 'POST', `/companies/${other.id}/domains`, 'eve', { domain });
  await fails(403, 'GET', `/companies/${co.id}/domains`, 'eve');

  // Company page + follow.
  assert.equal((await ok('POST', `/companies/${co.id}/follow`, 'eve')).followerCount, 1);
  await ok('POST', `/companies/${co.id}/follow`, 'eve'); // idempotent
  const page = await ok('GET', `/companies/${co.slug}`, 'eve');
  assert.equal(page.isFollowing, true);
  assert.equal(page.followerCount, 1);
  assert.equal(page.memberCount, 4);
  assert.equal(page.about, 'We test things.');
  assert.ok((await ok('GET', `/companies?q=${encodeURIComponent(`Acme ${run}`)}`, 'eve')).items.some((c: any) => c.id === co.id));
  assert.equal((await ok('DELETE', `/companies/${co.id}/follow`, 'eve')).followerCount, 0);
  token.acme = co.id;
});

test('platform admin: suspended orgs and users are locked out', async (t) => {
  if (!multi) return t.skip('single mode');
  const orgId = token.acme;
  assert.ok(orgId, 'companies test ran first');
  await fails(403, 'GET', '/platform/orgs', 'owner');
  assert.ok((await ok('GET', `/platform/orgs?q=${run}`, 'admin')).items.some((o: any) => o.id === orgId));

  await ok('POST', `/platform/orgs/${orgId}/suspend`, 'admin', { suspended: true });
  assert.equal((await fails(403, 'GET', '/auth/me', `ann@${orgId}`)).code, 'ORG_SUSPENDED');
  assert.deepEqual((await ok('GET', '/auth/me', 'ann')).orgs, []);
  await fails(404, 'GET', `/companies/${orgId}`, 'eve');
  await ok('POST', `/platform/orgs/${orgId}/suspend`, 'admin', { suspended: false });
  assert.equal((await ok('GET', '/auth/me', `ann@${orgId}`)).activeOrgId, orgId);

  const { items } = await ok('GET', `/platform/users?q=${encodeURIComponent(`ann-${run}`)}`, 'admin');
  assert.equal(items.length, 1);
  await fails(400, 'POST', `/platform/users/${(await ok('GET', '/auth/me', 'admin')).id}/suspend`, 'admin', { suspended: true });
  await ok('POST', `/platform/users/${items[0].id}/suspend`, 'admin', { suspended: true });
  await fails(401, 'GET', '/auth/me', 'ann');
  await fails(401, 'POST', '/auth/login', null, { email: items[0].email, password: PASSWORD });
  await ok('POST', `/platform/users/${items[0].id}/suspend`, 'admin', { suspended: false });
  await ok('POST', '/auth/login', null, { email: items[0].email, password: PASSWORD });
});
