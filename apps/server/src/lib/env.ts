import { createHmac } from 'node:crypto';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

const int = (name: string, fallback: number) => {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number >= 0`);
  return n;
};

const jwtSecret = req('JWT_SECRET');

const tenancy = process.env.TENANCY || 'single';
if (tenancy !== 'single' && tenancy !== 'multi') throw new Error('TENANCY must be "single" or "multi"');

export const env = {
  port: Number(process.env.PORT ?? 4000),
  publicUrl: req('PUBLIC_URL', 'http://localhost:4000'),
  /** SOT D23: single = one internal company (no org switcher); multi = public SaaS with many orgs. */
  tenancy: tenancy as 'single' | 'multi',
  jwtSecret,
  /** Where links in emails point: the web client (hash routes); the desktop app accepts the pasted link too. */
  appUrl: (process.env.APP_URL || 'http://localhost:5183').replace(/\/$/, ''),
  media: {
    /** HMAC key for signed media URLs; derived from JWT_SECRET when unset (SOT §8). */
    urlSecret: process.env.MEDIA_URL_SECRET || createHmac('sha256', jwtSecret).update('nexus-media-url').digest('hex'),
    /** Signed URLs stay identical for this many seconds and are valid for 1–2× it. */
    urlTtlSeconds: Math.max(60, int('MEDIA_URL_TTL_SECONDS', 3600)),
  },
  /** Retention in days (SOT §11 proposal); 0 keeps forever. */
  retention: {
    hiddenContentDays: int('RETENTION_HIDDEN_CONTENT_DAYS', 30),
    messageDays: int('RETENTION_MESSAGE_DAYS', 730),
    readNotificationDays: int('RETENTION_READ_NOTIFICATION_DAYS', 90),
    notificationDays: int('RETENTION_NOTIFICATION_DAYS', 365),
    auditLogDays: int('RETENTION_AUDIT_LOG_DAYS', 0),
    /** Sign-ups never verified are deleted after this many days (2d abuse control); 0 keeps them. */
    unverifiedAccountDays: int('RETENTION_UNVERIFIED_ACCOUNT_DAYS', 7),
    /** How often the purge job runs (hours); 0 disables it. */
    purgeEveryHours: int('RETENTION_PURGE_EVERY_HOURS', 24),
  },
  /** Desktop update feed folder served at /updates/ (latest.yml + installers). Relative to apps/server. */
  updatesDir: process.env.UPDATES_DIR ?? 'updates',
  /** Optional: enables the Socket.IO Redis adapter and shared presence for multiple API instances. */
  redisUrl: process.env.REDIS_URL || undefined,
  accessTokenTtl: req('ACCESS_TOKEN_TTL', '15m'),
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  rateLimit: process.env.RATE_LIMIT !== 'off',
  /** Sign-up abuse controls (SOT §14.4, 2d). Limits are per hour; 0 = no extra limit. */
  abuse: {
    signupsPerIp: int('SIGNUP_LIMIT_PER_IP', 10),
    signupsPerEmail: int('SIGNUP_LIMIT_PER_EMAIL', 3),
    emailLinksPerIp: int('EMAIL_LINK_LIMIT_PER_IP', 20),
  },
  /** Fastify `trustProxy`: "true", a hop count, or a comma-separated list of proxy IPs/CIDRs. */
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  s3: {
    endpoint: req('S3_ENDPOINT', 'http://localhost:9000'),
    region: req('S3_REGION', 'us-east-1'),
    bucket: req('S3_BUCKET', 'nexus-media'),
    accessKey: req('S3_ACCESS_KEY'),
    secretKey: req('S3_SECRET_KEY'),
  },
};

function parseTrustProxy(v: string | undefined): boolean | number | string[] {
  if (!v || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
