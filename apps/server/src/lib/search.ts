import { Prisma } from '@prisma/client';
import { prisma } from './db';

/**
 * Postgres full-text search (SOT §5.10). Every searchable table has a generated `search` tsvector
 * holding both 'english' (stemmed) and 'simple' (unstemmed) lexemes — see migration full_text_search.
 */

const MAX_TERMS = 8;

/** Words of a free-text query, lower-cased; punctuation (incl. a leading `#`) is dropped. */
export function searchTerms(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_TERMS);
}

/** `"senior eng"` → `"senior:* & eng:*"`: every word must match, the last ones as prefixes (search-as-you-type). */
export function prefixQuery(q: string): string | null {
  const terms = searchTerms(q);
  return terms.length ? terms.map((t) => `${t}:*`).join(' & ') : null;
}

/** Hashtag being searched for (`#Design` → `design`), or null when the query isn't a hashtag. */
export function hashtagTerm(q: string): string | null {
  const m = /^#([\p{L}\p{N}_]{1,50})$/u.exec(q.trim());
  return m ? m[1].toLowerCase() : null;
}

/** tsquery matching either lexeme set; terms are letters/digits only, so to_tsquery can't fail on syntax. */
const tsq = (query: string) => Prisma.sql`(to_tsquery('simple', ${query}) || to_tsquery('english', ${query}))`;

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

/** Re-applies the rank order from the id query to rows loaded with Prisma includes. */
export function inOrder<T extends { id: string }>(order: string[], rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return order.flatMap((id) => byId.get(id) ?? []);
}

/** Active users ranked by name (A) / headline (B), plus skills (B). */
export async function searchUserIds(query: string, take: number): Promise<string[]> {
  return ids(await prisma.$queryRaw<{ id: string }[]>`
    WITH q AS (SELECT ${tsq(query)} AS q), hits AS (
      SELECT u.id, ts_rank(u.search, q.q) AS r FROM "User" u, q WHERE u.search @@ q.q
      UNION ALL
      SELECT s."userId", ts_rank(s.search, q.q) FROM "Skill" s, q WHERE s.search @@ q.q
    )
    SELECT u.id FROM hits h JOIN "User" u ON u.id = h.id
    WHERE u."isActive"
    GROUP BY u.id, u.name
    ORDER BY sum(h.r) DESC, u.name
    LIMIT ${take}`);
}

/** Visible posts matching their body, their article's title/body, or (for `#tag`) a hashtag prefix. */
export async function searchPostIds(query: string, tag: string | null, take: number): Promise<string[]> {
  const byTag = tag
    ? Prisma.sql`UNION SELECT ph."postId" FROM "PostHashtag" ph JOIN "Hashtag" h ON h.id = ph."hashtagId" WHERE h.tag LIKE ${`${tag}%`}`
    : Prisma.empty;
  return ids(await prisma.$queryRaw<{ id: string }[]>`
    WITH q AS (SELECT ${tsq(query)} AS q), c AS (
      SELECT p.id FROM "Post" p, q WHERE p.search @@ q.q
      UNION SELECT p.id FROM "Post" p JOIN "Article" a ON a.id = p."articleId", q WHERE a.search @@ q.q
      ${byTag}
    )
    SELECT p.id FROM c JOIN "Post" p ON p.id = c.id LEFT JOIN "Article" a ON a.id = p."articleId", q
    WHERE NOT p."isHidden"
    ORDER BY ts_rank(p.search || coalesce(a.search, ''::tsvector), q.q) DESC, p."createdAt" DESC
    LIMIT ${take}`);
}

const TABLES = { Group: '"Group"', Event: '"Event"', Job: '"Job"' } as const;

/** Rows of a single-table index ranked by ts_rank; `tiebreak` / `filter` are fixed SQL from callers. */
export async function searchTableIds(
  table: keyof typeof TABLES,
  query: string,
  take: number,
  opts: { filter?: Prisma.Sql; tiebreak?: Prisma.Sql } = {},
): Promise<string[]> {
  const t = Prisma.raw(TABLES[table]);
  return ids(await prisma.$queryRaw<{ id: string }[]>`
    SELECT t.id FROM ${t} t, (SELECT ${tsq(query)} AS q) q
    WHERE t.search @@ q.q ${opts.filter ? Prisma.sql`AND ${opts.filter}` : Prisma.empty}
    ORDER BY ts_rank(t.search, q.q) DESC, ${opts.tiebreak ?? Prisma.sql`t."createdAt" DESC`}
    LIMIT ${take}`);
}
