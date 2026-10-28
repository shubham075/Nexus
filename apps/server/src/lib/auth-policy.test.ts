import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblem, PASSWORD_RULES } from '@nexus/shared';

// sso.ts and admin.ts read env at import time.
process.env.JWT_SECRET ??= 'test-secret';
process.env.S3_ACCESS_KEY ??= 'x';
process.env.S3_SECRET_KEY ??= 'x';
const { parseProviders, isLoopbackRedirect, emailFromClaims } = await import('./sso');
const { tempPassword } = await import('../routes/admin');

test('password policy: length and all four character classes', () => {
  assert.equal(passwordProblem('Admin@12345'), null);
  assert.equal(passwordProblem('Welcome@123'), null);
  assert.match(passwordProblem('Ab1!')!, /at least 10/);
  assert.match(passwordProblem('alllowercase1!')!, /upper-case/);
  assert.match(passwordProblem('ALLUPPERCASE1!')!, /lower-case/);
  assert.match(passwordProblem('NoDigitsHere!')!, /number/);
  assert.match(passwordProblem('NoSymbols123')!, /symbol/);
  assert.equal(passwordProblem('nosymbolsornumbers'), 'Add upper-case letter, number and symbol (e.g. ! @ # -)');
  assert.match(passwordProblem('Aa1!' + 'x'.repeat(70))!, /at most 72/);
  assert.equal(PASSWORD_RULES.every((r) => r.test('Çorrect-Hörse-9')), true);
});

test('temporary passwords satisfy the policy', () => {
  for (let i = 0; i < 200; i++) assert.equal(passwordProblem(tempPassword()), null);
});

test('OIDC providers are parsed from env and incomplete ones fail loudly', () => {
  const ps = parseProviders({
    OIDC_PROVIDERS: 'microsoft, google',
    OIDC_MICROSOFT_ISSUER: 'https://login.microsoftonline.com/t/v2.0',
    OIDC_MICROSOFT_CLIENT_ID: 'a',
    OIDC_MICROSOFT_CLIENT_SECRET: 'b',
    OIDC_MICROSOFT_EMAIL_CLAIM: 'preferred_username',
    OIDC_MICROSOFT_ALLOWED_DOMAINS: 'Acme.com, acme.co.uk',
    OIDC_GOOGLE_ISSUER: 'https://accounts.google.com',
    OIDC_GOOGLE_CLIENT_ID: 'c',
    OIDC_GOOGLE_CLIENT_SECRET: 'd',
    OIDC_GOOGLE_LABEL: 'Google Workspace',
  });
  assert.deepEqual(ps.map((p) => [p.id, p.label, p.emailClaim]), [
    ['microsoft', 'Microsoft', 'preferred_username'],
    ['google', 'Google Workspace', 'email'],
  ]);
  assert.deepEqual(ps[0].allowedDomains, ['acme.com', 'acme.co.uk']);
  assert.deepEqual(parseProviders({}), []);
  assert.throws(() => parseProviders({ OIDC_PROVIDERS: 'google', OIDC_GOOGLE_ISSUER: 'x' }), /OIDC_GOOGLE_CLIENT_ID/);
});

test('SSO only redirects to loopback URLs', () => {
  assert.equal(isLoopbackRedirect('http://127.0.0.1:53123/callback'), true);
  assert.equal(isLoopbackRedirect('http://localhost:5183/'), true);
  assert.equal(isLoopbackRedirect('http://[::1]:5000/cb'), true);
  assert.equal(isLoopbackRedirect('https://evil.example/cb'), false);
  assert.equal(isLoopbackRedirect('http://127.0.0.1.evil.example/cb'), false);
  assert.equal(isLoopbackRedirect('http://user@127.0.0.1:1/cb'), false);
  assert.equal(isLoopbackRedirect('nexus://callback'), false);
  assert.equal(isLoopbackRedirect('not a url'), false);
});

test('SSO email comes from a verified claim within allowed domains', () => {
  const p = { emailClaim: 'email', allowedDomains: ['acme.com'] };
  assert.equal(emailFromClaims({ email: 'Priya@Acme.com', email_verified: true }, p), 'priya@acme.com');
  assert.equal(emailFromClaims({ email: 'priya@acme.com', email_verified: false }, p), null);
  assert.equal(emailFromClaims({ email: 'priya@other.com' }, p), null);
  assert.equal(emailFromClaims({ sub: 'x' }, p), null);
  const azure = { emailClaim: 'preferred_username', allowedDomains: [] };
  assert.equal(emailFromClaims({ preferred_username: 'rahul@acme.com' }, azure), 'rahul@acme.com');
  assert.equal(emailFromClaims({ preferred_username: 'not-an-email' }, azure), null);
});
