import type { EmailTokenPurpose } from '@prisma/client';
import { prisma } from './db';
import { env } from './env';
import { HttpError } from './http';
import { newSecret, sha256 } from './sessions';

/** Single-use, hashed, time-limited email tokens (SOT §8 → Email). */

export const TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  VERIFY_EMAIL: 24 * 3_600_000,
  RESET_PASSWORD: 30 * 60_000,
};
export const INVITE_TTL_DAYS = 7;

/** Link into the web client's hash routes; the desktop app accepts the pasted link or the bare token. */
export const appLink = (route: string, token: string) => `${env.appUrl}/#/${route}?token=${encodeURIComponent(token)}`;

/** Issues a new token and retires older unused ones of the same purpose, so only the latest mail works. */
export async function issueEmailToken(userId: string, purpose: EmailTokenPurpose): Promise<string> {
  const token = newSecret();
  await prisma.$transaction([
    prisma.emailToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.emailToken.create({
      data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]) },
    }),
  ]);
  return token;
}

/** Consumes a token (conditional update, so a race can't use it twice) and returns its user id. */
export async function consumeEmailToken(token: string, purpose: EmailTokenPurpose): Promise<string> {
  const t = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
  const invalid = new HttpError(400, 'INVALID_TOKEN', 'This link is invalid or has expired. Request a new one.');
  if (!t || t.purpose !== purpose || t.usedAt || t.expiresAt < new Date()) throw invalid;
  const { count } = await prisma.emailToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
  if (count !== 1) throw invalid;
  return t.userId;
}

/** Accepts a full link (…?token=X) or the bare token. */
export function tokenFrom(input: string): string {
  const m = /[?&]token=([^&#\s]+)/.exec(input);
  return (m ? decodeURIComponent(m[1]) : input).trim();
}
