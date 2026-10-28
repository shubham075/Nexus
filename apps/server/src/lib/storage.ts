import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { env } from './env';
import { canonicalMediaUrl, mapMediaUrls, signMediaUrl } from './signedMedia';

export const s3 = new S3Client({
  endpoint: env.s3.endpoint,
  region: env.s3.region,
  forcePathStyle: true,
  credentials: { accessKeyId: env.s3.accessKey, secretAccessKey: env.s3.secretKey },
});

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.s3.bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.s3.bucket }));
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: body, ContentType: contentType }));
}

export function getObject(key: string) {
  return s3.send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }));
}

export function deleteObject(key: string) {
  return s3.send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }));
}

/** Canonical, unsigned URL: what the database stores. Never fetchable on its own (SOT §8). */
export const mediaUrl = (key: string) => canonicalMediaUrl(env.publicUrl, key);

/** Short-lived signed URL handed to clients for <img>/<video>/links. */
export const signedMediaUrl = (key: string) => signMediaUrl(env.publicUrl, key, env.media.urlSecret, env.media.urlTtlSeconds);

/** Outgoing payloads (HTTP + realtime): every stored media URL → fresh signed URL. */
export const signMedia = <T>(payload: T): T => mapMediaUrls(payload, signedMediaUrl) as T;

/** Incoming bodies: strip signatures so only canonical URLs are stored. */
export const unsignMedia = <T>(payload: T): T => mapMediaUrls(payload, mediaUrl) as T;
