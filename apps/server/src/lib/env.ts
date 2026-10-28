function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  publicUrl: req('PUBLIC_URL', 'http://localhost:4000'),
  jwtSecret: req('JWT_SECRET'),
  /** Optional: enables the Socket.IO Redis adapter and shared presence for multiple API instances. */
  redisUrl: process.env.REDIS_URL || undefined,
  s3: {
    endpoint: req('S3_ENDPOINT', 'http://localhost:9000'),
    region: req('S3_REGION', 'us-east-1'),
    bucket: req('S3_BUCKET', 'nexus-media'),
    accessKey: req('S3_ACCESS_KEY'),
    secretKey: req('S3_SECRET_KEY'),
  },
};
