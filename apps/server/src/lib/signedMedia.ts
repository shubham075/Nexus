import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed media URLs (SOT §8). `GET /api/v1/media/<key>?exp=<unix s>&sig=<hmac>` is only served while
 * `exp` is in the future and `sig = HMAC-SHA256(secret, "<key>:<exp>")`. Pure helpers (no env) so they can be unit-tested.
 */

export const MEDIA_PATH = '/api/v1/media/';
export const MEDIA_KEY_RE = /^[\w-]+\/[\w-]+\.\w+$/;
/** Any absolute media URL (old unsigned rows, signed rows, a previous PUBLIC_URL) → key in group 1. */
const MEDIA_URL_RE = /https?:\/\/[^\s"'<>()/]+\/api\/v1\/media\/([\w-]+\/[\w-]+\.\w+)(?:\?[^\s"'<>()]*)?/g;

export const mediaSig = (key: string, exp: number, secret: string) =>
  createHmac('sha256', secret).update(`${key}:${exp}`).digest('base64url');

/**
 * Expiry rounded up to a whole window so a URL stays identical (and browser-cacheable) for `ttl` seconds,
 * and is valid for between `ttl` and `2 * ttl` seconds after it is issued.
 */
export const mediaExpiry = (ttl: number, now = Date.now()) => (Math.floor(now / 1000 / ttl) + 2) * ttl;

export function signMediaUrl(publicUrl: string, key: string, secret: string, ttl: number, now = Date.now()): string {
  const exp = mediaExpiry(ttl, now);
  return `${publicUrl}${MEDIA_PATH}${key}?exp=${exp}&sig=${mediaSig(key, exp, secret)}`;
}

export type SigCheck = 'ok' | 'missing' | 'expired' | 'invalid';

export function verifyMediaSig(key: string, exp: unknown, sig: unknown, secret: string, now = Date.now()): SigCheck {
  if (typeof exp !== 'string' || typeof sig !== 'string' || !exp || !sig) return 'missing';
  const expN = Number(exp);
  if (!/^\d+$/.test(exp) || !Number.isSafeInteger(expN)) return 'invalid';
  const want = Buffer.from(mediaSig(key, expN, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return 'invalid';
  if (expN * 1000 <= now) return 'expired';
  return 'ok';
}

/** The canonical (unsigned) URL stored in the database. */
export const canonicalMediaUrl = (publicUrl: string, key: string) => `${publicUrl}${MEDIA_PATH}${key}`;

/** Rewrite every media URL inside strings (including article HTML) of a JSON-like value. Returns a new value. */
export function mapMediaUrls(value: unknown, rewrite: (key: string) => string): unknown {
  if (typeof value === 'string') {
    return value.includes(MEDIA_PATH) ? value.replace(MEDIA_URL_RE, (_m, key: string) => rewrite(key)) : value;
  }
  if (Array.isArray(value)) return value.map((v) => mapMediaUrls(v, rewrite));
  if (value && typeof value === 'object') {
    if (value instanceof Date || Buffer.isBuffer(value)) return value;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      // Class instances (streams etc.) pass through untouched; toJSON-able ones (Prisma Decimal) are serialised first.
      const json = (value as { toJSON?: () => unknown }).toJSON;
      return typeof json === 'function' ? mapMediaUrls(json.call(value), rewrite) : value;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapMediaUrls(v, rewrite);
    return out;
  }
  return value;
}
