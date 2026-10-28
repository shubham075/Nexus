import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapMediaUrls, mediaExpiry, mediaSig, signMediaUrl, verifyMediaSig } from './signedMedia';

const SECRET = 'test-secret';
const KEY = '2026-10/0b9c6f7e-1a2b-4c3d-9e8f-001122334455.png';
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);

function parts(url: string) {
  const u = new URL(url);
  return { key: u.pathname.replace('/api/v1/media/', ''), exp: u.searchParams.get('exp')!, sig: u.searchParams.get('sig')! };
}

test('signed media URL verifies until it expires', () => {
  const url = signMediaUrl('http://localhost:4000', KEY, SECRET, 3600, NOW);
  const { key, exp, sig } = parts(url);
  assert.equal(key, KEY);
  assert.equal(verifyMediaSig(key, exp, sig, SECRET, NOW), 'ok');
  // valid for at least one TTL, at most two
  assert.equal(verifyMediaSig(key, exp, sig, SECRET, NOW + 3600_000), 'ok');
  assert.equal(verifyMediaSig(key, exp, sig, SECRET, NOW + 7200_000 + 1), 'expired');
});

test('expired signature is rejected', () => {
  const exp = Math.floor(NOW / 1000) - 1;
  assert.equal(verifyMediaSig(KEY, String(exp), mediaSig(KEY, exp, SECRET), SECRET, NOW), 'expired');
});

test('tampered signature, expiry, key or secret is rejected', () => {
  const { exp, sig } = parts(signMediaUrl('http://x', KEY, SECRET, 3600, NOW));
  const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  assert.equal(verifyMediaSig(KEY, exp, flipped, SECRET, NOW), 'invalid');
  assert.equal(verifyMediaSig(KEY, String(Number(exp) + 3600), sig, SECRET, NOW), 'invalid');
  assert.equal(verifyMediaSig('2026-10/other.png', exp, sig, SECRET, NOW), 'invalid');
  assert.equal(verifyMediaSig(KEY, exp, sig, 'other-secret', NOW), 'invalid');
  assert.equal(verifyMediaSig(KEY, '1e12', sig, SECRET, NOW), 'invalid');
  assert.equal(verifyMediaSig(KEY, exp, sig.slice(2), SECRET, NOW), 'invalid');
});

test('missing signature is reported as missing', () => {
  assert.equal(verifyMediaSig(KEY, undefined, undefined, SECRET, NOW), 'missing');
  assert.equal(verifyMediaSig(KEY, '123', '', SECRET, NOW), 'missing');
});

test('URLs are stable within a window so browsers can cache them', () => {
  assert.equal(mediaExpiry(3600, NOW), mediaExpiry(3600, NOW + 1800_000));
  assert.notEqual(mediaExpiry(3600, NOW), mediaExpiry(3600, NOW + 3600_000));
});

test('mapMediaUrls re-signs stored URLs anywhere in a payload', () => {
  const sign = (k: string) => `https://api.example/api/v1/media/${k}?exp=1&sig=s`;
  const payload = {
    user: { avatarUrl: `http://localhost:4000/api/v1/media/${KEY}`, name: 'A' },
    media: [{ url: `http://old-host:4000/api/v1/media/${KEY}?exp=5&sig=stale` }],
    body: `<p><img src="http://localhost:4000/api/v1/media/${KEY}"></p>`,
    link: 'https://example.com/other',
    at: new Date(NOW),
    n: 3,
    nothing: null,
  };
  const out = mapMediaUrls(payload, sign) as typeof payload;
  assert.equal(out.user.avatarUrl, sign(KEY));
  assert.equal(out.media[0].url, sign(KEY));
  assert.equal(out.body, `<p><img src="${sign(KEY)}"></p>`);
  assert.equal(out.link, 'https://example.com/other');
  assert.ok(out.at instanceof Date);
  assert.equal(out.n, 3);
  assert.equal(out.nothing, null);
  assert.equal(payload.user.avatarUrl, `http://localhost:4000/api/v1/media/${KEY}`, 'input is not mutated');
});
