import type { ZodType, ZodTypeDef } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, 'BAD_REQUEST', msg);
export const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (msg: string) => new HttpError(409, 'CONFLICT', msg);

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw badRequest(`${first.path.join('.') || 'body'}: ${first.message}`);
  }
  return r.data;
}

/** Cursor pagination over cuid ids (SOT §7). Query with take = limit + 1. */
export function page<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export function pageArgs(q: { cursor?: string; limit?: string | number }, def = 20) {
  const limit = Math.min(Math.max(Number(q.limit ?? def) || def, 1), 50);
  return { limit, take: limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) };
}
