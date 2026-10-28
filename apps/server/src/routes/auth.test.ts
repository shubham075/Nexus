import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Route tests for login / refresh / logout / change-password / SSO exchange against the dev database
 * (apps/server/.env). Skipped when the database or the auth migration isn't available.
 */
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env: rely on the environment */
}
process.env.JWT_SECRET ??= 'test-secret';
process.env.S3_ACCESS_KEY ??= 'x';
process.env.S3_SECRET_KEY ??= 'x';
process.env.RATE_LIMIT = 'on';

const { prisma } = await import('../lib/db');
const dbReady = await prisma.authSession
  .count()
  .then(() => true)
  .catch(() => false);

const opts = { skip: dbReady ? false : 'database or auth migration not available' };
after(() => prisma.$disconnect());

async function buildApp() {
  const Fastify = (await import('fastify')).default;
  const jwt = (await import('@fastify/jwt')).default;
  const { registerRateLimit } = await import('../lib/rateLimit');
  const { authRoutes } = await import('./auth');
  const { HttpError } = await import('../lib/http');
  const app = Fastify();
  await app.register(jwt, { secret: 'test-secret', sign: { expiresIn: '15m' } });
  await registerRateLimit(app);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    return reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: { message: err.message } });
  });
  await app.register(authRoutes, { prefix: '/auth' });
  await app.ready();
  return app;
}

const PASSWORD = 'Start-Pass-123';
async function withUser<T>(fn: (u: { id: string; email: string }) => Promise<T>): Promise<T> {
  const bcrypt = (await import('bcryptjs')).default;
  const email = `auth-test-${randomBytes(4).toString('hex')}@nexus.test`;
  const u = await prisma.user.create({ data: { email, name: 'Auth Test', passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  try {
    return await fn(u);
  } finally {
    await prisma.ssoRequest.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
  }
}

test('login → refresh rotates → old token replay revokes the session', opts, async () => {
  const app = await buildApp();
  await withUser(async (u) => {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.email, password: PASSWORD } });
    assert.equal(login.statusCode, 200);
    const first = login.json<{ token: string; refreshToken: string }>();
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${first.token}` } });
    assert.equal(me.statusCode, 200);

    const r1 = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: first.refreshToken } });
    assert.equal(r1.statusCode, 200);
    const second = r1.json<{ token: string; refreshToken: string }>();
    assert.notEqual(second.refreshToken, first.refreshToken);

    // Replaying the rotated-out token = theft: session revoked, the new token stops working too.
    const replay = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: first.refreshToken } });
    assert.equal(replay.statusCode, 401);
    const after = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: second.refreshToken } });
    assert.equal(after.statusCode, 401);
    const me2 = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${second.token}` } });
    assert.equal(me2.statusCode, 401);
  });
  await app.close();
});

test('logout revokes the session even with only the refresh token', opts, async () => {
  const app = await buildApp();
  await withUser(async (u) => {
    const { token, refreshToken } = (
      await app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.email, password: PASSWORD } })
    ).json<{ token: string; refreshToken: string }>();
    const out = await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken } });
    assert.equal(out.statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } })).statusCode, 401);
  });
  await app.close();
});

test('change-password enforces the policy and signs out other sessions only', opts, async () => {
  const app = await buildApp();
  await withUser(async (u) => {
    const login = () => app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.email, password: PASSWORD } });
    const a = (await login()).json<{ token: string; refreshToken: string }>();
    const b = (await login()).json<{ token: string; refreshToken: string }>();
    const change = (newPassword: string) =>
      app.inject({
        method: 'POST',
        url: '/auth/change-password',
        headers: { authorization: `Bearer ${a.token}` },
        payload: { currentPassword: PASSWORD, newPassword },
      });
    const weak = await change('password');
    assert.equal(weak.statusCode, 400);
    assert.equal(weak.json().error.code, 'WEAK_PASSWORD');
    assert.equal((await change('New-Strong-Pass-9')).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${a.token}` } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${b.token}` } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: b.refreshToken } })).statusCode, 401);
  });
  await app.close();
});

test('SSO exchange needs the matching PKCE verifier and is single-use', opts, async () => {
  const app = await buildApp();
  const sha = (s: string) => createHash('sha256').update(s).digest('base64url');
  await withUser(async (u) => {
    await prisma.user.update({ where: { id: u.id }, data: { mustChangePassword: true } });
    const verifier = randomBytes(32).toString('base64url');
    const code = randomBytes(32).toString('base64url');
    const seed = (oneTimeCode: string) =>
      prisma.ssoRequest.create({
        data: {
          id: randomBytes(16).toString('hex'), provider: 'test', redirectUri: 'http://127.0.0.1:1/cb', challenge: sha(verifier),
          nonce: 'n', codeVerifier: 'v', codeHash: sha(oneTimeCode), userId: u.id, expiresAt: new Date(Date.now() + 60_000),
        },
      });
    await seed(code);
    const wrong = await app.inject({ method: 'POST', url: '/auth/sso/exchange', payload: { code, codeVerifier: 'x'.repeat(43) } });
    assert.equal(wrong.statusCode, 401);
    // The failed attempt consumed the code.
    const again = await app.inject({ method: 'POST', url: '/auth/sso/exchange', payload: { code, codeVerifier: verifier } });
    assert.equal(again.statusCode, 401);

    await seed(`${code}-b`);
    const ok = await app.inject({ method: 'POST', url: '/auth/sso/exchange', payload: { code: `${code}-b`, codeVerifier: verifier } });
    assert.equal(ok.statusCode, 200);
    assert.ok(ok.json().refreshToken);
    // Temporary password retired.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    assert.equal(user.mustChangePassword, false);
    const pw = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.email, password: PASSWORD } });
    assert.equal(pw.statusCode, 401);
  });
  await app.close();
});

test('login is rate limited per IP + email', opts, async () => {
  const app = await buildApp();
  const email = `nobody-${randomBytes(3).toString('hex')}@nexus.test`;
  const codes: number[] = [];
  for (let i = 0; i < 11; i++) {
    codes.push((await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'x' } })).statusCode);
  }
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(401));
  assert.equal(codes[10], 429);
  await app.close();
});
