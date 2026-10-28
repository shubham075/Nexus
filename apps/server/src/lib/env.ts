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

export const env = {
  port: Number(process.env.PORT ?? 4000),
  publicUrl: req('PUBLIC_URL', 'http://localhost:4000'),
  jwtSecret,
  media: {
    /** HMAC key for signed media URLs; derived from JWT_SECRET when unset (SOT §8). */
    urlSecret: process.env.MEDIA_URL_SECRET || createHmac('sha256', jwtSecret).update('nexus-media-url').digest('hex'),
    /** Signed URLs stay identical for this many seconds and are valid for 1–2× it. */
    urlTtlSeconds: Math.max(60, int('MEDIA_URL_TTL_SECONDS', 3600)),
  },
  /** Retention in days (SOT §11 proposal); 0 keeps forever. */
  retention: {
    hiddenContentDays: int('RETENTION_HIDDEN_CONTENT_DAYS', 30),
    messageDays: int('RETENTION_MESSAGE_DAYS', 0),
    readNotificationDays: int('RETENTION_READ_NOTIFICATION_DAYS', 90),
    notificationDays: int('RETENTION_NOTIFICATION_DAYS', 365),
    auditLogDays: int('RETENTION_AUDIT_LOG_DAYS', 0),
    /** How often the purge job runs (hours); 0 disables it. */
    purgeEveryHours: int('RETENTION_PURGE_EVERY_HOURS', 24),
  },
  s3: {
    endpoint: req('S3_ENDPOINT', 'http://localhost:9000'),
    region: req('S3_REGION', 'us-east-1'),
    bucket: req('S3_BUCKET', 'nexus-media'),
    accessKey: req('S3_ACCESS_KEY'),
    secretKey: req('S3_SECRET_KEY'),
  },
};
