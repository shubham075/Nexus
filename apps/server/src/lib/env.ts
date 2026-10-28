function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  publicUrl: req('PUBLIC_URL', 'http://localhost:4000'),
  jwtSecret: req('JWT_SECRET'),
  accessTokenTtl: req('ACCESS_TOKEN_TTL', '15m'),
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  rateLimit: process.env.RATE_LIMIT !== 'off',
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
