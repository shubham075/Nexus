/** Mentions are stored inline as @[Display Name](userId) — the composer inserts them. */
const MENTION = /@\[([^\]]+)\]\(([a-z0-9]+)\)/g;
const HASHTAG = /(?:^|\s)#([\p{L}\p{N}_]{1,50})/gu;

export function extractMentions(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((m) => m[2]))];
}

export function extractHashtags(body: string): string[] {
  return [...new Set([...body.matchAll(HASHTAG)].map((m) => m[1].toLowerCase()))];
}

export function plain(body: string, max = 80): string {
  const t = body.replace(MENTION, '@$1').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
