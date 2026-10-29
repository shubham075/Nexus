/**
 * Phase 2d end-to-end suite (SOT §14.4): public jobs on company pages and sign-up abuse limits. Runs against
 * a live API like accounts.e2e.ts. Multi-mode tests need TENANCY=multi and DNS_STUB=true on the server and
 * SIGNUP_LIMIT_PER_IP raised above the default (the suites sign up many users from one IP); mails come from Mailpit.
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
    // Mailpit search is fuzzy: only take mail addressed to exactly this recipient
    for (const m of (found.messages ?? []).filter((x: any) => x.To?.some((a: any) => a.Address?.toLowerCase() === to.toLowerCase()))) {
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
  multi = (await ok('GET', '/auth/config', null)).tenancy === 'multi';
  token.admin = (await ok('POST', '/auth/login', null, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).token;
});

const job = (title: string, isPublic: boolean) => ({ title, description: 'E2E job', location: 'Remote', workplace: 'REMOTE', isPublic });

test('single mode: no public jobs', async (t) => {
  if (multi) return t.skip('multi mode');
  const j = await ok('POST', '/jobs', 'admin', job(`Single ${run}`, true));
  assert.equal(j.isPublic, false);
  assert.equal((await ok('PATCH', `/jobs/${j.id}`, 'admin', { isPublic: true, status: 'CLOSED' })).isPublic, false);
});

test('public jobs: company page, global search, anyone applies, internal stays private', async (t) => {
  if (!multi) return t.skip('single mode');
  await signUp('acme', `acme-${run}@jobs-${run}.test`);
  await signUp('beta', `beta-${run}@beta-${run}.test`);
  await signUp('solo', `solo-${run}@solo-${run}.test`);
  const acme = await ok('POST', '/companies', 'acme', { name: `JobsCo ${run}` });
  const beta = await ok('POST', '/companies', 'beta', { name: `BetaCo ${run}` });
  const A = `acme@${acme.id}`;
  const B = `beta@${beta.id}`;

  const pub = await ok('POST', '/jobs', A, job(`Public engineer ${run}`, true));
  const internal = await ok('POST', '/jobs', A, job(`Internal engineer ${run}`, false));
  assert.equal(pub.isPublic, true);
  assert.equal(internal.isPublic, false);

  // Company page list: public jobs only, with the company attached.
  const page = await ok('GET', `/jobs?public=true&orgId=${acme.id}`, 'solo');
  assert.deepEqual(page.map((j: any) => j.id), [pub.id]);
  assert.equal(page[0].org.name, `JobsCo ${run}`);
  // Owner's own company: both jobs, but the public filter still hides the internal one.
  assert.deepEqual((await ok('GET', `/jobs?orgId=${acme.id}`, A)).map((j: any) => j.id).sort(), [pub.id, internal.id].sort());
  assert.deepEqual((await ok('GET', `/jobs?public=true&orgId=${acme.id}`, A)).map((j: any) => j.id), [pub.id]);

  // Global search from another company and from a user with no company.
  for (const who of [B, 'solo']) {
    const ids = (await ok('GET', `/jobs?q=${encodeURIComponent(`engineer ${run}`)}`, who)).map((j: any) => j.id);
    assert.ok(ids.includes(pub.id), `${who} finds the public job`);
    assert.ok(!ids.includes(internal.id), `${who} does not see the internal job`);
    await fails(404, 'GET', `/jobs/${internal.id}`, who);
  }
  assert.equal((await ok('GET', `/jobs/${pub.id}`, 'solo')).canManage, false);

  // Anyone applies; only the company's job.manage holders see applicants.
  await ok('POST', `/jobs/${pub.id}/apply`, 'solo', { note: 'Hi' });
  await ok('POST', `/jobs/${pub.id}/apply`, B, {});
  await fails(404, 'POST', `/jobs/${internal.id}/apply`, 'solo', {});
  assert.ok((await ok('GET', '/jobs/applications/mine', 'solo')).some((a: any) => a.job.id === pub.id));
  await fails(403, 'GET', `/jobs/${pub.id}/applications`, 'solo');
  await fails(403, 'GET', `/jobs/${pub.id}/applications`, B);
  await fails(403, 'PATCH', `/jobs/${pub.id}`, B, { title: 'Hijack' });
  const applicants = await ok('GET', `/jobs/${pub.id}/applications`, A);
  assert.equal(applicants.length, 2);
  await ok('PATCH', `/jobs/${pub.id}/applications/${applicants[0].id}`, A, { status: 'REVIEWING' });

  // Making it internal again hides it from outsiders.
  await ok('PATCH', `/jobs/${pub.id}`, A, { isPublic: false });
  await fails(404, 'GET', `/jobs/${pub.id}`, 'solo');
  assert.deepEqual(await ok('GET', `/jobs?public=true&orgId=${acme.id}`, 'solo'), []);
});

test('sign-up abuse: disposable domains, unverified purge, per-address limit', async (t) => {
  if (!multi) return t.skip('single mode');
  const signup = (email: string) => call('POST', '/auth/signup', null, { email, name: 'Abuse test', password: PASSWORD });

  assert.equal((await signup(`x-${run}@mailinator.com`)).data.error.code, 'DISPOSABLE_EMAIL');
  assert.equal((await signup(`x-${run}@eu.yopmail.com`)).status, 400);

  // Unverified accounts are purged after RETENTION_UNVERIFIED_ACCOUNT_DAYS (default 7), verified ones kept.
  const stale = `stale-${run}@stale-${run}.test`;
  assert.equal((await signup(stale)).status, 200);
  const users = async (q: string) => (await ok('GET', `/platform/users?q=${encodeURIComponent(q)}`, 'admin')).items;
  assert.equal((await users(stale)).length, 1);
  // only this test's address, so sign-ups of suites running in parallel are left alone
  await ok('POST', '/dev/purge-unverified', null, { days: 0, emails: [stale] });
  assert.equal((await users(stale)).length, 1, 'a fresh sign-up is kept');
  assert.equal((await ok('POST', '/dev/purge-unverified', null, { days: 30, emails: [stale] })).unverifiedUsers, 1);
  assert.equal((await users(stale)).length, 0, 'an old unverified sign-up is purged');
  assert.equal((await users(ADMIN_EMAIL)).length, 1, 'verified accounts are kept');

  // Per address: SIGNUP_LIMIT_PER_EMAIL (default 3) per hour, then 429.
  const flood = `flood-${run}@flood-${run}.test`;
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await signup(flood)).status);
  if (codes[3] === 200) return t.skip('rate limits are off (RATE_LIMIT=off or SIGNUP_LIMIT_PER_EMAIL=0)');
  assert.deepEqual(codes, [200, 200, 200, 429]);
});
